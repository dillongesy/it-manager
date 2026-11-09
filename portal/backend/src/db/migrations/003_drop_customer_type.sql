-- All customers are treated as full MSP clients. Type distinction removed.
ALTER TABLE customers DROP COLUMN IF EXISTS type;
