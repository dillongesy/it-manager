-- Portal - WiFi passwords from UniFi + Microsoft 365 subscriptions from TD SYNNEX
-- Migration 059
--
-- 1. customer_credentials.unifi_wifi_id - a WiFi network (SSID) imported from UniFi lands
--    in the customer's Credentials tab ("WiFi" section) with its password encrypted like
--    every other stored credential (password_enc, AES-256-GCM). The UniFi WLAN ID links
--    it, so a re-import updates that entry instead of adding a second one.
--
-- 2. customer_recurring_charges - a Microsoft 365 subscription imported from TD SYNNEX
--    (StreamOne Stellr) becomes a recurring charge on the Billing tab:
--      source / external_id - 'tdsynnex' + the TD SYNNEX subscription ID ("1926227_2"),
--                             so a re-import updates seats/cost instead of duplicating
--      vendor_cost          - what we pay TD SYNNEX per license, per billing period
--      vendor_msrp          - Microsoft's list price per license (from TD SYNNEX invoices)
--      term_end_date        - when the commitment term ends / renews
--      external_status      - TD SYNNEX's status ("Activated", "Suspend", "Cancel", …)
--      synced_at            - last import that touched it
--    unit_price stays what we bill the customer; cost and MSRP sit beside it.

ALTER TABLE customer_credentials
  ADD COLUMN IF NOT EXISTS unifi_wifi_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_customer_credentials_unifi_wifi
  ON customer_credentials(unifi_wifi_id) WHERE unifi_wifi_id IS NOT NULL;

ALTER TABLE customer_recurring_charges
  ADD COLUMN IF NOT EXISTS source          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS external_id     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS vendor_cost     NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS vendor_msrp     NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS term_end_date   DATE,
  ADD COLUMN IF NOT EXISTS external_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS synced_at       TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_recurring_charges_external
  ON customer_recurring_charges(customer_id, source, external_id) WHERE external_id IS NOT NULL;
