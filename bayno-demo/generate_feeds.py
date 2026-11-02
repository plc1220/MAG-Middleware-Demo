#!/usr/bin/env python3
"""Continuously generate synthetic BAYNO flat files and upload them over SFTP."""

from __future__ import annotations

import argparse
import csv
import io
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SFTP_DIR = ROOT / "sftp-demo"
SFTP_KEY = Path(os.environ.get("MAG_BAYNO_SFTP_KEY", SFTP_DIR / "secrets" / "client_ed25519"))
KNOWN_HOSTS = Path(os.environ.get("MAG_BAYNO_KNOWN_HOSTS", SFTP_DIR / "secrets" / "known_hosts"))
SEQUENCE_FILE = ROOT / "bayno-demo" / ".feed-sequence"
GENERATED_DIR = ROOT / "bayno-demo" / "generated"

COLUMNS = [
    "RECORD_KIND",
    "FILE_SEQ",
    "SOURCE_SYSTEM",
    "FEED_TYPE",
    "EFFECTIVE_DATE",
    "EFFECTIVE_TIME",
    "DETAIL_REC_TYPE",
    "REC_TYPE",
    "CARRIER",
    "FLT_NBR",
    "FIRST_LEG_DEP_DT",
    "SCHED_DEP_TM",
    "DISCH_AIRPT",
    "BAY_NO",
    "TRAILER_COUNT",
]


def next_sequence() -> int:
    try:
        previous = int(SEQUENCE_FILE.read_text(encoding="ascii").strip())
    except FileNotFoundError:
        previous = 0
    except ValueError as exc:
        raise RuntimeError(f"Invalid sequence state in {SEQUENCE_FILE}") from exc
    sequence = previous % 99999 + 1
    SEQUENCE_FILE.write_text(f"{sequence}\n", encoding="ascii")
    return sequence


def make_rows(sequence: int, created_at: datetime) -> list[list[str]]:
    file_seq = f"S{sequence:05d}"
    tomorrow = (created_at.date() + timedelta(days=1)).strftime("%d/%m/%Y")
    blank = ""

    rows = [
        [
            "00", file_seq, "FMCS0000", "BAYNO000",
            created_at.strftime("%Y%m%d"), created_at.strftime("%H%M%S"),
            "01", blank, blank, blank, blank, blank, blank, blank, blank,
        ],
        # Deliberately unsorted so the downstream demo can demonstrate sorting.
        [
            "01", file_seq, blank, blank, blank, blank, blank,
            "01", "CCC", f"{(8 + sequence - 1) % 99999 + 1:05d}",
            tomorrow, "10:00:00", "KUL", f"C{(sequence - 1) % 99 + 1:02d}", blank,
        ],
        [
            "01", file_seq, blank, blank, blank, blank, blank,
            "01", "AAA", f"{(17 + sequence - 1) % 99999 + 1:05d}",
            tomorrow, "08:30:00", "KUL", f"A{(sequence - 1) % 99 + 1:02d}", blank,
        ],
        [
            "01", file_seq, blank, blank, blank, blank, blank,
            "01", "BBB", f"{(22 + sequence - 1) % 99999 + 1:05d}",
            tomorrow, "09:15:00", "SIN", f"B{(sequence - 1) % 99 + 1:02d}", blank,
        ],
        [
            "99", file_seq, "FMCS0000", blank, blank, blank, blank,
            blank, blank, blank, blank, blank, blank, blank, "3",
        ],
    ]
    if any(len(row) != len(COLUMNS) for row in rows):
        raise RuntimeError("Generated row does not match the declared 15-column demo layout")
    return rows


def render_file(sequence: int, created_at: datetime) -> tuple[str, str]:
    filename = (
        "FMCS0000_BAYNO000_"
        f"{created_at:%Y%m%d%H%M%S}_{sequence:05d}P0001"
    )
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, delimiter="|", lineterminator="\n")
    writer.writerow(COLUMNS)
    writer.writerows(make_rows(sequence, created_at))
    return filename, buffer.getvalue()


def upload(filename: str, local_path: Path, host: str, port: int, username: str) -> None:
    if not SFTP_KEY.is_file() or not KNOWN_HOSTS.is_file():
        raise RuntimeError(
            "SFTP keys are missing. Start with ./bayno-demo/start-feed-generator.sh "
            "so the local SFTP service can be prepared first."
        )

    partial = f"/dropbox/incoming/.{filename}.part"
    final = f"/dropbox/incoming/{filename}"
    batch = f"put {local_path} {partial}\nrename {partial} {final}\n"
    command = [
        "sftp", "-q", "-i", str(SFTP_KEY),
        "-o", "IdentitiesOnly=yes",
        "-o", "BatchMode=yes",
        "-o", f"UserKnownHostsFile={KNOWN_HOSTS}",
        "-o", "StrictHostKeyChecking=yes",
        "-P", str(port), "-b", "-", f"{username}@{host}",
    ]
    subprocess.run(command, input=batch, text=True, check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate unique synthetic BAYNO files and upload them to the demo SFTP server."
    )
    parser.add_argument("--interval-seconds", type=float, default=10.0)
    parser.add_argument("--max-files", type=int, default=0,
                        help="Stop after this many files; 0 means run until Ctrl-C.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=2222)
    parser.add_argument("--username", default="magdemo")
    args = parser.parse_args()
    if args.interval_seconds < 1:
        parser.error("--interval-seconds must be at least 1")
    if args.max_files < 0:
        parser.error("--max-files cannot be negative")
    return args


def main() -> int:
    args = parse_args()
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    generated = 0
    try:
        while args.max_files == 0 or generated < args.max_files:
            created_at = datetime.now().astimezone().replace(microsecond=0)
            sequence = next_sequence()
            filename, contents = render_file(sequence, created_at)
            local_path = GENERATED_DIR / filename
            temporary_path = GENERATED_DIR / f".{filename}.tmp"
            temporary_path.write_text(contents, encoding="utf-8", newline="")
            temporary_path.replace(local_path)
            upload(filename, local_path, args.host, args.port, args.username)
            generated += 1
            print(
                f"Uploaded {filename} to sftp://{args.host}:{args.port}/dropbox/incoming/ "
                f"({len(make_rows(sequence, created_at)) - 2} details)",
                flush=True,
            )
            if args.max_files == 0 or generated < args.max_files:
                time.sleep(args.interval_seconds)
    except KeyboardInterrupt:
        print("Stopped. Uploaded files remain on the SFTP server.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
