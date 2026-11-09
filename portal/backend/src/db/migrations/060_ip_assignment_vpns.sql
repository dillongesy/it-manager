-- Portal - how a device gets its IP address + VPNs on a firewall
-- Migration 060
--
-- 1. customer_devices.ip_assignment - how the device's IP is assigned:
--      'dhcp'         handed out by DHCP and free to change
--      'reservation'  DHCP, but reserved for this device (UniFi "Fixed IP")
--      'static'       set by hand on the device itself
--    Filled by the UniFi import (from the device's own network config, or by checking the
--    address against the network's DHCP range) and editable on any device.
--
-- 2. customer_devices.vpns - a firewall's VPNs, documented (never their keys):
--      [{ type, name, subnet, port, peer, remote_subnets, users, details, enabled, notes,
--         source, external_id }]
--    e.g. a WireGuard server with its users, or a site-to-site IPsec tunnel with its peer.
--    UniFi-imported entries carry source 'unifi' + the UniFi network ID; a site-to-site
--    tunnel's pre-shared key goes to the Credentials tab (encrypted), linked through
--    customer_credentials.unifi_wifi_id - that column now links any UniFi-sourced secret
--    (WiFi network or VPN), not only WiFi.

ALTER TABLE customer_devices
  ADD COLUMN IF NOT EXISTS ip_assignment VARCHAR(20),
  ADD COLUMN IF NOT EXISTS vpns          JSONB NOT NULL DEFAULT '[]'::jsonb;
