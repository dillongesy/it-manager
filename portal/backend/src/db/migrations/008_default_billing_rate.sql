-- Add a "Standard" rate to every customer that doesn't already have one.
INSERT INTO customer_billing_rates (customer_id, label, rate)
SELECT c.id, 'Standard', 90.00
FROM customers c
WHERE c.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM customer_billing_rates cbr
    WHERE cbr.customer_id = c.id AND LOWER(cbr.label) = 'standard'
  );
