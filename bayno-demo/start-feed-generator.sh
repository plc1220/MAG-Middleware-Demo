#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SFTP="$ROOT/sftp-demo"
SECRETS="$SFTP/secrets"
DROPBOX="$SFTP/dropbox"

mkdir -p "$SECRETS" "$DROPBOX/incoming" "$DROPBOX/finished" "$DROPBOX/error"
chmod 0777 "$DROPBOX/incoming" "$DROPBOX/finished" "$DROPBOX/error"

if [ ! -s "$SECRETS/client_ed25519" ]; then
  ssh-keygen -q -t ed25519 -N "" -C "mag-bayno-demo-client" -f "$SECRETS/client_ed25519"
fi
if [ ! -s "$SECRETS/authorized_keys" ]; then
  cp "$SECRETS/client_ed25519.pub" "$SECRETS/authorized_keys"
fi
if [ ! -s "$SECRETS/server_host_ed25519" ]; then
  ssh-keygen -q -t ed25519 -N "" -C "mag-bayno-demo-sftp-host" -f "$SECRETS/server_host_ed25519"
fi

chmod 0700 "$SECRETS"
chmod 0600 "$SECRETS/client_ed25519" "$SECRETS/server_host_ed25519"
chmod 0644 "$SECRETS/authorized_keys" "$SECRETS/client_ed25519.pub" \
  "$SECRETS/server_host_ed25519.pub"

docker compose -f "$SFTP/docker-compose.yml" up -d --build

if [ ! -s "$SECRETS/known_hosts" ]; then
  attempt=0
  until ssh-keyscan -p 2222 127.0.0.1 > "$SECRETS/known_hosts" 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 20 ]; then
      echo "Local SFTP server did not become ready" >&2
      exit 1
    fi
    sleep 1
  done
fi
chmod 0600 "$SECRETS/known_hosts"

exec python3 "$ROOT/bayno-demo/generate_feeds.py" "$@"
