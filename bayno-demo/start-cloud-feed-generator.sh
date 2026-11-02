#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS="$ROOT/sftp-demo/secrets"
PROJECT="${GOOGLE_CLOUD_PROJECT:-my-rd-coe-demo-gen-ai}"
ZONE="${MAG_BAYNO_SFTP_ZONE:-asia-southeast1-a}"
VM="${MAG_BAYNO_SFTP_VM:-mag-bayno-demo}"
HOST="127.0.0.1"
PORT="${MAG_BAYNO_IAP_PORT:-22222}"

while (($#)); do
  case "$1" in
    --*) break ;;
    *) echo "Unexpected argument: $1" >&2; exit 2 ;;
  esac
done

if [[ ! -s "$SECRETS/client_ed25519" ]]; then
  echo 'SFTP client key is missing. Run infra/mag-bayno-vm/scripts/deploy.sh first.' >&2
  exit 2
fi
command -v gcloud >/dev/null || { echo 'gcloud is required for the IAP tunnel.' >&2; exit 2; }

gcloud compute start-iap-tunnel "$VM" 22 --project="$PROJECT" --zone="$ZONE" \
  --local-host-port="${HOST}:${PORT}" >/dev/null 2>&1 &
TUNNEL_PID=$!
cleanup() { kill "$TUNNEL_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

for attempt in {1..30}; do
  if nc -z "$HOST" "$PORT" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$TUNNEL_PID" >/dev/null 2>&1; then
    echo 'The IAP tunnel stopped before SFTP became available.' >&2
    exit 1
  fi
  sleep 1
done
if ! nc -z "$HOST" "$PORT" >/dev/null 2>&1; then
  echo 'Timed out waiting for the IAP tunnel.' >&2
  exit 1
fi

if [[ ! -s "$SECRETS/cloud_known_hosts" ]] || ! ssh-keygen -F "[$HOST]:$PORT" -f "$SECRETS/cloud_known_hosts" >/dev/null 2>&1; then
  touch "$SECRETS/cloud_known_hosts"
  chmod 0600 "$SECRETS/cloud_known_hosts"
  ssh-keyscan -p "$PORT" "$HOST" >> "$SECRETS/cloud_known_hosts" 2>/dev/null
fi

export MAG_BAYNO_SFTP_KEY="$SECRETS/client_ed25519"
export MAG_BAYNO_KNOWN_HOSTS="$SECRETS/cloud_known_hosts"
python3 "$ROOT/bayno-demo/generate_feeds.py" --host "$HOST" --port "$PORT" --username magdemo "$@"
