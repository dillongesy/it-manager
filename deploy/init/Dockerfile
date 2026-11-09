# init — one-shot container that generates and distributes secrets (see init-secrets.sh).
FROM alpine:3.20
RUN apk add --no-cache openssl
COPY init-secrets.sh /usr/local/bin/init-secrets.sh
RUN chmod 0755 /usr/local/bin/init-secrets.sh
ENTRYPOINT ["/usr/local/bin/init-secrets.sh"]
