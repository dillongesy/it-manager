#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Host firewall for IT Manager (called by install.sh; safe to re-run).
#
# Two layers, because Docker-published ports never pass through ufw's INPUT chain:
#
#   ufw (host)         default deny incoming; SSH allowed (LAN only unless you say
#                      otherwise). Protects the host itself.
#   DOCKER-USER chain  filters traffic forwarded to containers. Kept in
#                      /etc/ufw/after.rules so it survives reboots and reloads:
#                        80/443        → LAN only   (Portal is LAN-only)
#                        FIELD_PORT    → LAN, or anywhere if FIELD_PUBLIC=yes
#                        anything else arriving on the external interface → DROP
#
# Domain mode: Let's Encrypt must reach 80/443 from the internet to issue
# certificates, and Portal + Field share 443 (told apart by hostname), so 80/443
# are open; Caddy then refuses every non-LAN client for the Portal hostname
# (PORTAL_ALLOWED_RANGES) and, unless FIELD_PUBLIC=yes, for the Field hostname too.
#
# Env: EXT_IF, LAN_CIDR, FIELD_PORT, FIELD_PUBLIC (yes/no), MODE (lan/domain),
#      SSH_FROM (default: LAN_CIDR; set "any" to allow SSH from anywhere)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${EXT_IF:?}"; : "${LAN_CIDR:?}"; : "${FIELD_PORT:=8443}"; : "${FIELD_PUBLIC:=no}"; : "${MODE:=lan}"
SSH_FROM="${SSH_FROM:-$LAN_CIDR}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
command -v ufw >/dev/null || { apt-get update -qq && apt-get install -y -qq ufw >/dev/null; }

# ── Host (ufw) ────────────────────────────────────────────────────────────────
ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
if [ "$SSH_FROM" = "any" ]; then
  ufw allow 22/tcp comment 'SSH' >/dev/null
else
  ufw allow from "$SSH_FROM" to any port 22 proto tcp comment 'SSH (LAN)' >/dev/null
fi

# ── Containers (DOCKER-USER via ufw after.rules) ──────────────────────────────
WEB_SRC="$LAN_CIDR"
FIELD_SRC="$LAN_CIDR"
[ "$FIELD_PUBLIC" = "yes" ] && FIELD_SRC="0.0.0.0/0"
[ "$MODE" = "domain" ] && WEB_SRC="0.0.0.0/0"

rule() { # rule <port> <source>
  echo "-A DOCKER-USER -i $EXT_IF -p tcp -s $2 -m conntrack --ctorigdstport $1 --ctdir ORIGINAL -j RETURN"
}

BLOCK="$(cat <<EOF
# BEGIN IT-MANAGER DOCKER-USER (managed by scripts/firewall.sh — do not edit)
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
$(rule 80 "$WEB_SRC")
$(rule 443 "$WEB_SRC")
$( [ "$FIELD_PORT" != "443" ] && rule "$FIELD_PORT" "$FIELD_SRC" )
-A DOCKER-USER -i $EXT_IF -m conntrack --ctstate NEW -j DROP
-A DOCKER-USER -j RETURN
COMMIT
# END IT-MANAGER DOCKER-USER
EOF
)"

AFTER=/etc/ufw/after.rules
cp -n "$AFTER" "$AFTER.it-manager.bak" 2>/dev/null || true
# Replace our previous block (if any), then append the new one.
sed -i '/# BEGIN IT-MANAGER DOCKER-USER/,/# END IT-MANAGER DOCKER-USER/d' "$AFTER"
printf '\n%s\n' "$BLOCK" >> "$AFTER"

ufw --force enable >/dev/null
# Start from an empty chain so re-runs never stack duplicate rules.
iptables -F DOCKER-USER 2>/dev/null || true
ufw reload >/dev/null
# Docker re-creates its own jump to DOCKER-USER on restart; make sure it's there now.
systemctl restart docker

echo "  ufw: $(ufw status | head -n1)"
echo "  Portal (80/443) from: $WEB_SRC   Field ($FIELD_PORT) from: $FIELD_SRC   SSH from: $SSH_FROM"
