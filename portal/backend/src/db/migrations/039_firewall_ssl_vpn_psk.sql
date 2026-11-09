-- Portal - firewall SSL VPN pre-shared key
-- Migration 039
--
-- Firewall devices can store an SSL VPN pre-shared key. It's a secret, so it's stored
-- AES-256-GCM encrypted at rest like the other device passwords (column `*_enc`), and
-- the reveal endpoint audit-logs access. NULL/empty = not set.

ALTER TABLE customer_devices ADD COLUMN IF NOT EXISTS ssl_vpn_psk_enc TEXT;
