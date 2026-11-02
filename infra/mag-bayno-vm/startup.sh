#!/usr/bin/env bash
set -euo pipefail

exec > >(tee -a /var/log/mag-bayno-startup.log | logger -t mag-bayno-startup -s 2>/dev/console) 2>&1

PROJECT_ID="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/project/project-id)"
EGRESS_CIDRS="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/attributes/confluent-egress-cidrs)"
SFTP_KEYS="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/attributes/magdemo-ssh-keys)"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y openssh-server postgresql postgresql-contrib curl ca-certificates

if ! getent group magdemo >/dev/null; then groupadd --system magdemo; fi
if ! id magdemo >/dev/null 2>&1; then
  useradd --create-home --home-dir /home/magdemo --shell /usr/sbin/nologin --gid magdemo magdemo
fi
passwd -l magdemo >/dev/null 2>&1 || true

install -d -o root -g root -m 0755 /srv/sftp /srv/sftp/magdemo
install -d -o magdemo -g magdemo -m 0750 /srv/sftp/magdemo/dropbox
install -d -o magdemo -g magdemo -m 0770 /srv/sftp/magdemo/dropbox/incoming
install -d -o magdemo -g magdemo -m 0750 /srv/sftp/magdemo/dropbox/finished /srv/sftp/magdemo/dropbox/error
install -d -o root -g root -m 0755 /etc/ssh/authorized_keys
printf '%s\n' "$SFTP_KEYS" | awk 'NF && !seen[$0]++' > /etc/ssh/authorized_keys/magdemo
chown root:root /etc/ssh/authorized_keys/magdemo
chmod 0644 /etc/ssh/authorized_keys/magdemo

cat >/etc/ssh/sshd_config.d/90-mag-bayno.conf <<'SSHD'
PubkeyAuthentication yes
PasswordAuthentication no
PermitRootLogin no

Match User magdemo
  AuthorizedKeysFile /etc/ssh/authorized_keys/%u
  ChrootDirectory /srv/sftp/%u
  ForceCommand internal-sftp -d /dropbox
  AllowTcpForwarding no
  X11Forwarding no
  PermitTunnel no
  PasswordAuthentication no
Match all
SSHD
sshd -t
systemctl enable --now ssh
systemctl restart ssh

PG_VERSION="$(ls /etc/postgresql | sort -V | tail -n 1)"
PG_CONF="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"
PG_HBA="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"
sed -i "s/^#\?listen_addresses.*/listen_addresses = '*'/" "$PG_CONF"
sed -i "s/^#\?password_encryption.*/password_encryption = 'scram-sha-256'/" "$PG_CONF"
for setting in \
  "shared_buffers = '128MB'" \
  "max_connections = 30" \
  "work_mem = '4MB'" \
  "effective_cache_size = '256MB'"; do
  grep -Fqx "$setting" "$PG_CONF" || printf '%s\n' "$setting" >> "$PG_CONF"
done
install -d -o postgres -g postgres -m 0700 /var/lib/postgresql/mag-bayno-tls
if [[ ! -s /var/lib/postgresql/mag-bayno-tls/server.key ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout /var/lib/postgresql/mag-bayno-tls/server.key \
    -out /var/lib/postgresql/mag-bayno-tls/server.crt \
    -subj '/CN=mag-bayno-demo'
  chown postgres:postgres /var/lib/postgresql/mag-bayno-tls/server.key /var/lib/postgresql/mag-bayno-tls/server.crt
  chmod 0600 /var/lib/postgresql/mag-bayno-tls/server.key
  chmod 0644 /var/lib/postgresql/mag-bayno-tls/server.crt
fi
for setting in \
  "ssl = on" \
  "ssl_cert_file = '/var/lib/postgresql/mag-bayno-tls/server.crt'" \
  "ssl_key_file = '/var/lib/postgresql/mag-bayno-tls/server.key'"; do
  grep -Fqx "$setting" "$PG_CONF" || printf '%s\n' "$setting" >> "$PG_CONF"
done

while IFS= read -r cidr; do
  [[ -n "$cidr" ]] || continue
  rule="hostssl magbayno magdemo ${cidr} scram-sha-256"
  grep -Fqx "$rule" "$PG_HBA" || printf '%s\n' "$rule" >> "$PG_HBA"
done < <(tr ';' '\n' <<<"$EGRESS_CIDRS")
rule='hostssl magbayno magdemo 10.74.0.0/24 scram-sha-256'
grep -Fqx "$rule" "$PG_HBA" || printf '%s\n' "$rule" >> "$PG_HBA"
systemctl enable --now postgresql
systemctl restart postgresql

TOKEN="$(curl -fsS -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"
SECRET_JSON="$(curl -fsS -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets/mag-bayno-postgres-password/versions/latest:access")"
DB_PASSWORD="$(python3 -c 'import base64,json,sys; print(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode(),end="")' <<<"$SECRET_JSON")"
unset TOKEN SECRET_JSON

runuser -u postgres -- psql -v ON_ERROR_STOP=1 -v db_password="$DB_PASSWORD" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'magdemo') THEN
    CREATE ROLE magdemo LOGIN;
  END IF;
END $$;
ALTER ROLE magdemo WITH LOGIN PASSWORD :'db_password';
SELECT 'CREATE DATABASE magbayno OWNER magdemo'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='magbayno')\gexec
SQL
unset DB_PASSWORD

runuser -u postgres -- psql -v ON_ERROR_STOP=1 --dbname=magbayno <<'SQL'
CREATE TABLE IF NOT EXISTS public.mag_bayno_hist (
  carr varchar(3) NOT NULL,
  flt_nbr varchar(5) NOT NULL,
  first_leg_flt_dt date NOT NULL,
  sched_dep_tm varchar(8) NOT NULL,
  dep_airpt varchar(3) NOT NULL,
  bay_no varchar(5),
  rec_ld_ts timestamptz NOT NULL,
  file_seq bigint NOT NULL,
  rec_src_sys varchar(8) NOT NULL,
  PRIMARY KEY (file_seq, carr, flt_nbr, first_leg_flt_dt, sched_dep_tm, dep_airpt)
);
GRANT CONNECT ON DATABASE magbayno TO magdemo;
GRANT USAGE, CREATE ON SCHEMA public TO magdemo;
GRANT SELECT, INSERT, UPDATE ON public.mag_bayno_hist TO magdemo;
SQL

echo 'MAG BAYNO SFTP and PostgreSQL bootstrap completed.'
