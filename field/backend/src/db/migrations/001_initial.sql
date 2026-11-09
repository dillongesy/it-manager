-- Field App - Initial Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --- Users --------------------------------------------------------------------

CREATE TABLE users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(50)  UNIQUE NOT NULL,
  email         VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(100) NOT NULL,
  initials      VARCHAR(5),
  -- 'admin' | 'camera_tech' | 'biller'
  role          VARCHAR(20)  NOT NULL DEFAULT 'camera_tech',
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  is_revoked  BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user   ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash   ON refresh_tokens(token_hash) WHERE NOT is_revoked;

-- --- Inventory ----------------------------------------------------------------

CREATE TABLE inventory_items (
  id                    UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(255)   NOT NULL,
  description           TEXT,
  category              VARCHAR(100),
  -- App-generated barcode SKU (e.g. INV-00042; prefix from SKU_PREFIX)
  sku                   VARCHAR(100)   UNIQUE,
  -- Manufacturer barcode (UPC, EAN, etc.)
  manufacturer_barcode  VARCHAR(100),
  quantity              NUMERIC(10,2)  NOT NULL DEFAULT 0,
  low_stock_threshold   NUMERIC(10,2)  DEFAULT 5,
  unit                  VARCHAR(20)    NOT NULL DEFAULT 'ea',
  cost_per_unit         NUMERIC(10,2),
  notes                 TEXT,
  is_active             BOOLEAN        NOT NULL DEFAULT true,
  created_by            UUID           REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inventory_sku          ON inventory_items(sku)                 WHERE sku IS NOT NULL;
CREATE INDEX idx_inventory_mfr_barcode  ON inventory_items(manufacturer_barcode) WHERE manufacturer_barcode IS NOT NULL;
CREATE INDEX idx_inventory_name         ON inventory_items USING gin(to_tsvector('english', name));
CREATE INDEX idx_inventory_active       ON inventory_items(is_active, quantity);

-- Every quantity change is logged here (immutable ledger)
CREATE TABLE inventory_transactions (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID           NOT NULL REFERENCES inventory_items(id),
  -- 'receive' | 'checkout' | 'adjust' | 'return'
  type            VARCHAR(20)    NOT NULL,
  -- positive = stock added, negative = stock removed
  quantity_delta  NUMERIC(10,2)  NOT NULL,
  quantity_after  NUMERIC(10,2)  NOT NULL,
  -- where the items went/came from (optional)
  location        VARCHAR(100),
  reference_id    UUID,
  reference_type  VARCHAR(50),
  user_id         UUID           REFERENCES users(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inv_tx_item    ON inventory_transactions(item_id);
CREATE INDEX idx_inv_tx_created ON inventory_transactions(created_at DESC);

-- --- Field Work Orders --------------------------------------------------------

CREATE TABLE field_work_orders (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  number           SERIAL,
  customer_name    VARCHAR(255) NOT NULL,
  customer_address TEXT,
  work_date        DATE         NOT NULL DEFAULT CURRENT_DATE,
  -- 'draft' | 'submitted' | 'pending_billing' | 'invoiced' | 'paid'
  status           VARCHAR(20)  NOT NULL DEFAULT 'draft',
  hours            NUMERIC(6,2),
  description      TEXT,
  notes            TEXT,
  submitted_at     TIMESTAMPTZ,
  invoiced_at      TIMESTAMPTZ,
  paid_at          TIMESTAMPTZ,
  created_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fwo_status  ON field_work_orders(status);
CREATE INDEX idx_fwo_date    ON field_work_orders(work_date DESC);
CREATE UNIQUE INDEX idx_fwo_number ON field_work_orders(number);

CREATE TABLE field_work_order_technicians (
  work_order_id UUID NOT NULL REFERENCES field_work_orders(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (work_order_id, user_id)
);

CREATE TABLE field_work_order_items (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id     UUID          NOT NULL REFERENCES field_work_orders(id) ON DELETE CASCADE,
  inventory_item_id UUID          REFERENCES inventory_items(id) ON DELETE SET NULL,
  description       TEXT          NOT NULL,
  quantity          NUMERIC(8,2)  NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- --- Photos -------------------------------------------------------------------

CREATE TABLE field_photos (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id    UUID         REFERENCES field_work_orders(id) ON DELETE SET NULL,
  customer_name    VARCHAR(255),
  customer_address TEXT,
  stored_name      VARCHAR(255) NOT NULL,
  original_name    VARCHAR(255),
  mime_type        VARCHAR(100),
  size_bytes       BIGINT,
  notes            TEXT,
  uploaded_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_photos_wo       ON field_photos(work_order_id);
CREATE INDEX idx_photos_customer ON field_photos(customer_name, customer_address);

-- --- Schema migrations tracking -----------------------------------------------

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
