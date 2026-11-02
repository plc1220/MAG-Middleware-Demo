#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
docker compose -f "$ROOT/bayno-demo/docker-compose.yml" down
