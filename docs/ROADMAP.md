# Roadmap

Planned work, roughly in priority order. Shipped changes are listed in
[CHANGELOG.md](../CHANGELOG.md).

## Field App on its own host

Stage 2 of [FIELD-PUBLIC-HOSTING.md](FIELD-PUBLIC-HOSTING.md): an mTLS bridge between the
two hosts, `install.sh --role field|portal`, and pairing from Admin → System.

## Public-exposure hardening for the Field App

Stage 3 of the same document: optional TOTP for Field accounts, fail2ban on the edge
access log, and a scheduled purge of imported captures.
