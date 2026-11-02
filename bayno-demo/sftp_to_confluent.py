#!/usr/bin/env python3
"""Forward completed synthetic BAYNO files from local SFTP to Confluent Cloud."""

from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent.parent
SFTP_DIR = ROOT / "sftp-demo"
SFTP_KEY = Path(os.environ.get("MAG_BAYNO_SFTP_KEY", SFTP_DIR / "secrets" / "client_ed25519"))
KNOWN_HOSTS = Path(os.environ.get("MAG_BAYNO_KNOWN_HOSTS", SFTP_DIR / "secrets" / "known_hosts"))
STATE_FILE = ROOT / "bayno-demo" / ".bridge-state.json"
CLUSTER_ID = "lkc-0xy8qdp"
REST_ENDPOINT = "https://pkc-ldvr1.asia-southeast1.gcp.confluent.cloud:443"
DEFAULT_TOPIC = "mag_bayno_raw"
FILENAME_RE = re.compile(r"^FMCS0000_BAYNO000_(\d{14})_\d{5}P0001$")
EXPECTED_COLUMNS = [
    "RECORD_KIND", "FILE_SEQ", "SOURCE_SYSTEM", "FEED_TYPE", "EFFECTIVE_DATE",
    "EFFECTIVE_TIME", "DETAIL_REC_TYPE", "REC_TYPE", "CARRIER", "FLT_NBR",
    "FIRST_LEG_DEP_DT", "SCHED_DEP_TM", "DISCH_AIRPT", "BAY_NO", "TRAILER_COUNT",
]


def sftp_batch(commands: list[str], args: argparse.Namespace) -> str:
    command = [
        "sftp", "-q", "-i", str(SFTP_KEY), "-o", "IdentitiesOnly=yes",
        "-o", "BatchMode=yes", "-o", f"UserKnownHostsFile={KNOWN_HOSTS}",
        "-o", "StrictHostKeyChecking=yes", "-P", str(args.port), "-b", "-",
        f"{args.username}@{args.host}",
    ]
    result = subprocess.run(command, input="\n".join(commands) + "\n", text=True,
                            capture_output=True, check=True)
    return result.stdout


def list_files(args: argparse.Namespace) -> list[str]:
    output = sftp_batch([f"ls -1 {args.remote_incoming}"], args)
    files = []
    for line in output.splitlines():
        candidate = line.strip().rsplit("/", 1)[-1]
        if FILENAME_RE.fullmatch(candidate):
            files.append(candidate)
    return sorted(set(files))


def download_file(filename: str, destination: Path, args: argparse.Namespace) -> None:
    if not FILENAME_RE.fullmatch(filename):
        raise ValueError("Refusing an unexpected remote filename")
    sftp_batch([f"get {args.remote_incoming}/{filename} {destination}"], args)


def finish_file(filename: str, args: argparse.Namespace) -> None:
    if not FILENAME_RE.fullmatch(filename):
        raise ValueError("Refusing an unexpected remote filename")
    sftp_batch([f"rename {args.remote_incoming}/{filename} {args.remote_finished}/{filename}"], args)


def load_state() -> dict[str, int]:
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    if not isinstance(data, dict) or any(
        not isinstance(name, str) or not isinstance(offset, int) or offset < 0
        for name, offset in data.items()
    ):
        raise RuntimeError(f"Invalid bridge checkpoint: {STATE_FILE}")
    return data


def save_state(state: dict[str, int]) -> None:
    temporary = STATE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(STATE_FILE)


def read_records(path: Path) -> list[str]:
    raw = path.read_text(encoding="utf-8-sig")
    physical_lines = raw.splitlines()
    if not physical_lines:
        raise ValueError("File is empty")
    parsed = list(csv.reader(physical_lines, delimiter="|"))
    if parsed[0] != EXPECTED_COLUMNS:
        raise ValueError("Column-name row does not match the declared 15-column demo layout")
    rows = parsed[1:]
    if not rows or any(len(row) != len(EXPECTED_COLUMNS) for row in rows):
        raise ValueError("One or more data rows do not have 15 columns")
    kinds = [row[0] for row in rows]
    if not set(kinds).issubset({"00", "01", "99"}):
        raise ValueError("File contains an unsupported record kind")
    if kinds.count("00") != 1 or kinds.count("99") != 1:
        raise ValueError("Each file must contain exactly one 00 header and one 99 trailer")
    if kinds[0] != "00" or kinds[-1] != "99":
        raise ValueError("The header must precede detail rows and the trailer must be last")
    file_sequences = {row[1] for row in rows}
    if len(file_sequences) != 1:
        raise ValueError("Rows in one file have inconsistent FILE_SEQ values")
    header = rows[0]
    if header[6] != "01":
        raise ValueError("The demo header does not declare 01 as its detail record type")
    trailer = next(row for row in rows if row[0] == "99")
    detail_count = kinds.count("01")
    if trailer[14] != str(detail_count):
        raise ValueError("Trailer detail count does not match the file")
    # These fixture records contain no embedded pipes or quoting; join cells back
    # into the exact field-delimited value that Flink will parse.
    return ["|".join(row) for row in rows]


def file_timestamp(filename: str) -> str:
    match = FILENAME_RE.fullmatch(filename)
    if not match:
        raise ValueError("Filename does not contain the expected demo timestamp")
    local_time = datetime.strptime(match.group(1), "%Y%m%d%H%M%S").replace(
        tzinfo=ZoneInfo("Asia/Kuala_Lumpur")
    )
    return local_time.isoformat(timespec="seconds")


def secret_manager_credentials(project: str) -> tuple[str, str]:
    if not shutil.which("gcloud"):
        raise RuntimeError("gcloud is required to read the Confluent API key from Secret Manager")
    try:
        text = subprocess.check_output(
            [
                "gcloud", "secrets", "versions", "access", "latest",
                "--secret=mag-bayno-demo-kafka-auth", f"--project={project}",
            ],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        raise RuntimeError(
            "Could not read mag-bayno-demo-kafka-auth from Secret Manager; "
            "check gcloud login and Secret Manager access"
        ) from None
    lines = text.splitlines()

    def value(label: str) -> str:
        for index, line in enumerate(lines):
            if line.strip() == label and index + 1 < len(lines):
                return lines[index + 1].strip()
        raise RuntimeError("Secret Manager key payload has an unexpected format")

    key, secret = value("API key:"), value("API secret:")
    if not key or not secret:
        raise RuntimeError("Secret Manager returned an incomplete Confluent API key")
    return key, secret


def credentials(project: str) -> tuple[str, str]:
    key = os.environ.get("CONFLUENT_KAFKA_API_KEY", "")
    secret = os.environ.get("CONFLUENT_KAFKA_API_SECRET", "")
    if not key or not secret:
        key, secret = secret_manager_credentials(project)
    if not key or not secret:
        raise RuntimeError("Both Confluent Kafka API key and secret are required")
    return key, secret


def publish_record(value: str, timestamp: str, topic: str, key: str, secret: str,
                   args: argparse.Namespace) -> None:
    endpoint = args.rest_endpoint.rstrip("/")
    url = f"{endpoint}/kafka/v3/clusters/{args.cluster_id}/topics/{topic}/records"
    payload = json.dumps({
        "value": {"type": "STRING", "data": value},
        "timestamp": timestamp,
    }).encode("utf-8")
    authorization = base64.b64encode(f"{key}:{secret}".encode("utf-8")).decode("ascii")
    request = Request(url, data=payload, method="POST", headers={
        "Authorization": f"Basic {authorization}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    try:
        with urlopen(request, timeout=args.request_timeout) as response:
            report = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        # Do not include request headers or credentials in an error message.
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Kafka REST returned HTTP {exc.code}: {detail}") from None
    except (URLError, TimeoutError) as exc:
        raise RuntimeError(
            f"Kafka REST request outcome is unknown ({type(exc).__name__}); "
            "the last record may have been accepted"
        ) from None
    reports = report if isinstance(report, list) else [report]
    if len(reports) != 1 or reports[0].get("error_code") != 200:
        raise RuntimeError(f"Kafka REST delivery report was not successful: {report!r}")


def process_file(filename: str, state: dict[str, int], key: str, secret: str,
                 args: argparse.Namespace) -> None:
    with tempfile.TemporaryDirectory(prefix="mag-bayno-bridge-") as temp_dir:
        local_path = Path(temp_dir) / filename
        download_file(filename, local_path, args)
        records = read_records(local_path)
        offset = state.get(filename, 0)
        if offset > len(records):
            raise RuntimeError(f"Checkpoint for {filename} is beyond the file length")
        timestamp = file_timestamp(filename)
        for index in range(offset, len(records)):
            publish_record(records[index], timestamp, args.topic, key, secret, args)
            state[filename] = index + 1
            save_state(state)
            print(f"Published {filename}: record {index + 1}/{len(records)}", flush=True)
    # Only archive after every record has an affirmative Kafka delivery report.
    finish_file(filename, args)
    state.pop(filename, None)
    save_state(state)
    print(f"Archived {filename} to {args.remote_finished}", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Bridge completed synthetic BAYNO files from local SFTP to Confluent Cloud."
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=2222)
    parser.add_argument("--username", default="magdemo")
    parser.add_argument("--remote-incoming", default="/dropbox/incoming")
    parser.add_argument("--remote-finished", default="/dropbox/finished")
    parser.add_argument("--rest-endpoint", default=os.environ.get("CONFLUENT_REST_ENDPOINT", REST_ENDPOINT))
    parser.add_argument("--cluster-id", default=os.environ.get("CONFLUENT_CLUSTER_ID", CLUSTER_ID))
    parser.add_argument("--gcp-project", default=os.environ.get("MAG_BAYNO_GCP_PROJECT", "my-rd-coe-demo-gen-ai"))
    parser.add_argument("--topic", default=DEFAULT_TOPIC)
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    parser.add_argument("--request-timeout", type=float, default=30.0)
    parser.add_argument("--once", action="store_true", help="Process current files and exit")
    args = parser.parse_args()
    if args.poll_seconds < 1:
        parser.error("--poll-seconds must be at least 1")
    if args.request_timeout < 1:
        parser.error("--request-timeout must be at least 1")
    if not SFTP_KEY.is_file() or not KNOWN_HOSTS.is_file():
        parser.error("SFTP client key or pinned known_hosts file is missing")
    return args


def main() -> int:
    args = parse_args()
    key, secret = credentials(args.gcp_project)
    state = load_state()
    print(
        f"Watching local SFTP {args.host}:{args.port}{args.remote_incoming}; "
        f"publishing to Confluent topic {args.topic}. Ctrl-C to stop.",
        flush=True,
    )
    try:
        while True:
            files = list_files(args)
            for filename in files:
                process_file(filename, state, key, secret, args)
            if args.once:
                return 0
            time.sleep(args.poll_seconds)
    except KeyboardInterrupt:
        print("Stopped. Unfinished files remain in incoming with a local resume checkpoint.",
              file=sys.stderr)
        return 0
    except (RuntimeError, subprocess.CalledProcessError, OSError, ValueError) as exc:
        print(f"Bridge stopped: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
