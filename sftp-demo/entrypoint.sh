#!/bin/sh
set -eu
mkdir -p /etc/ssh/authorized_keys /var/run/sshd \
  /sftp/dropbox/incoming /sftp/dropbox/finished /sftp/dropbox/error
chmod 0777 /sftp/dropbox/incoming /sftp/dropbox/finished /sftp/dropbox/error
if [ ! -s /run/secrets/authorized_key ]; then
  echo "authorized key missing" >&2
  exit 1
fi
install -o magdemo -g sftp -m 0600 /run/secrets/authorized_key /etc/ssh/authorized_keys/magdemo
passwd -d magdemo >/dev/null
if [ ! -s /run/secrets/server_host_ed25519 ]; then
  echo "server host key missing" >&2
  exit 1
fi
/usr/sbin/sshd -t -f /etc/ssh/sshd_config
exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
