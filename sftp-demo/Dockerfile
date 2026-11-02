FROM alpine:3.24
RUN apk add --no-cache openssh-server \
 && addgroup -S sftp \
 && adduser -S -D -H -h /data -s /bin/sh -G sftp -u 10001 magdemo \
 && mkdir -p /sftp/data /etc/ssh/authorized_keys /var/run/sshd \
 && chown root:root /sftp \
 && chmod 0755 /sftp
COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh
EXPOSE 2222
ENTRYPOINT ["/entrypoint.sh"]
