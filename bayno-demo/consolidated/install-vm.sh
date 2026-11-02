#!/usr/bin/env bash
set -euo pipefail
# Run as root from the uploaded consolidated directory.
apt-get update -qq
apt-get install -y -qq python3-psycopg2 python3-confluent-kafka
id bayno_worker_login >/dev/null 2>&1 || useradd --system --home-dir /var/lib/bayno-demo --create-home --shell /usr/sbin/nologin bayno_worker_login
usermod -a -G magdemo bayno_worker_login
chmod g+x /srv/sftp/magdemo
install -d -o magdemo -g magdemo -m 2770 /srv/sftp/magdemo/{incoming,archive,ingestion-error,outgoing}
install -d -o bayno_worker_login -g magdemo -m 0750 /opt/bayno-demo /var/lib/bayno-demo
install -m 0644 worker.py reference.py /opt/bayno-demo/
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d magbayno -f sql/postgres.sql
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d magbayno <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='bayno_worker_login') THEN CREATE ROLE bayno_worker_login LOGIN; END IF;
END $$;
GRANT bayno_worker TO bayno_worker_login;
SQL
cat >/etc/systemd/system/bayno-demo-worker.service <<'UNIT'
[Unit]
Description=Durable BAYNO generator and destination verifier
After=network-online.target postgresql.service
[Service]
User=bayno_worker_login
Group=magdemo
Environment=BAYNO_WORKER_DSN=dbname=magbayno user=bayno_worker_login
EnvironmentFile=-/etc/bayno-demo/worker.env
WorkingDirectory=/opt/bayno-demo
ExecStart=/usr/bin/python3 /opt/bayno-demo/worker.py
Restart=always
RestartSec=5
UMask=0007
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/bayno-demo /srv/sftp/magdemo
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now bayno-demo-worker
systemctl restart bayno-demo-worker
