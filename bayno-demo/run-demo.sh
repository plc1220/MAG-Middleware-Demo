#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DEMO="$ROOT/bayno-demo"
SFTP="$ROOT/sftp-demo"
FEED="FMCS0000_BAYNO000_20261029090000_00001P0001"

if [ ! -f "$DEMO/.env" ]; then
  python3 - "$DEMO/.env" <<'PY'
import secrets
import sys
from pathlib import Path
Path(sys.argv[1]).write_text("BAYNO_PG_PASSWORD=" + secrets.token_urlsafe(24) + "\n")
Path(sys.argv[1]).chmod(0o600)
PY
fi

mkdir -p "$DEMO/incoming"
docker compose -f "$SFTP/docker-compose.yml" up -d --build
docker compose -f "$DEMO/docker-compose.yml" build jobmanager
docker compose -f "$DEMO/docker-compose.yml" up -d --no-build

attempt=0
until docker compose -f "$DEMO/docker-compose.yml" exec -T jobmanager \
  /opt/flink/bin/flink list >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Flink JobManager did not become ready" >&2
    exit 1
  fi
  sleep 2
done

sftp -q -i "$SFTP/secrets/client_ed25519" \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o UserKnownHostsFile="$SFTP/secrets/known_hosts" \
  -o StrictHostKeyChecking=yes \
  -P 2222 -b - magdemo@127.0.0.1 <<EOF
get /bayno/$FEED $DEMO/incoming/$FEED
EOF

docker compose -f "$DEMO/docker-compose.yml" exec -T jobmanager \
  /opt/flink/bin/flink run \
  -c com.mag.demo.BaynoFlinkJob \
  /opt/flink/usrlib/bayno-flink-demo.jar \
  "file:///opt/flink/input/$FEED"

printf '\nDemo complete. Flink UI: http://127.0.0.1:18081\nPostgreSQL: 127.0.0.1:55432 (database bayno_demo)\n'
