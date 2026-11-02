#!/usr/bin/env bash
set -euo pipefail
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d magbayno < /tmp/consolidated-roles.sql
rm /tmp/consolidated-roles.sql
PG_HBA="$(find /etc/postgresql -name pg_hba.conf | head -1)"
# Source/sink users authenticate with separate connector credentials; web uses the VPC.
for cidr in 34.142.160.38/32 34.142.175.53/32 34.142.214.61/32 34.87.40.184/32 35.187.235.99/32 35.197.135.97/32 35.240.163.252/30 35.240.227.240/30; do
 rule="hostssl magbayno +bayno_sink ${cidr} scram-sha-256"
 grep -Fqx "$rule" "$PG_HBA" || printf '%s\n' "$rule" >>"$PG_HBA"
done
for cidr in 10.74.0.0/24 127.0.0.1/32; do
 rule="hostssl magbayno +bayno_web ${cidr} scram-sha-256"
 grep -Fqx "$rule" "$PG_HBA" || printf '%s\n' "$rule" >>"$PG_HBA"
done
systemctl reload postgresql
