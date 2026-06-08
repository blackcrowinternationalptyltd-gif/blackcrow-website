-- ================================================================
-- BlackCrow CRM Schema v2
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ================================================================

-- 1. CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  company       TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city          TEXT,
  state         TEXT,
  postcode      TEXT,
  country       TEXT NOT NULL DEFAULT 'Australia',
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. ORDERS
CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number    TEXT NOT NULL UNIQUE,
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  status          TEXT NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing','fulfilled','cancelled','refunded')),
  payment_status  TEXT NOT NULL DEFAULT 'pending'
                    CHECK (payment_status IN ('pending','paid','failed','refunded')),
  shipping_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (shipping_status IN ('pending','processing','shipped','delivered','returned')),
  refund_status   TEXT NOT NULL DEFAULT 'none'
                    CHECK (refund_status IN ('none','partial','full')),
  subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0,
  shipping_cost   NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax             NUMERIC(10,2) NOT NULL DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'AUD',
  country         TEXT,
  source          TEXT NOT NULL DEFAULT 'website',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. ORDER ITEMS
CREATE TABLE IF NOT EXISTS order_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product     TEXT NOT NULL,
  variant     TEXT,
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit_price  NUMERIC(10,2) NOT NULL,
  subtotal    NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. INVOICES
CREATE TABLE IF NOT EXISTS invoices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  issued_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date       DATE,
  status         TEXT NOT NULL DEFAULT 'issued'
                   CHECK (status IN ('draft','issued','paid','overdue','cancelled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. REFUNDS
CREATE TABLE IF NOT EXISTS refunds (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount     NUMERIC(10,2) NOT NULL,
  reason     TEXT,
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected','processed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. EMAIL LOGS
CREATE TABLE IF NOT EXISTS email_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID REFERENCES orders(id) ON DELETE SET NULL,
  type             TEXT NOT NULL
                     CHECK (type IN ('invoice','refund_remittance','review_request','custom')),
  recipient_email  TEXT,
  recipient_name   TEXT,
  subject          TEXT,
  status           TEXT NOT NULL DEFAULT 'sent'
                     CHECK (status IN ('sent','failed','pending')),
  provider         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. INTERNAL NOTES
CREATE TABLE IF NOT EXISTS internal_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author     TEXT NOT NULL DEFAULT 'Admin',
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. REVIEW REQUESTS
CREATE TABLE IF NOT EXISTS review_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_email TEXT,
  status         TEXT NOT NULL DEFAULT 'sent'
                   CHECK (status IN ('sent','opened','reviewed')),
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_orders_customer   ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_date       ON orders(date DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_order  ON email_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_notes_order       ON internal_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order     ON refunds(order_id);

-- ================================================================
-- SEED DATA
-- ================================================================

INSERT INTO customers (id, name, email, phone, company, address_line1, city, state, postcode, country) VALUES
  ('a1000000-0000-0000-0000-000000000001','James Harrington','james.h@example.com','+61 412 345 678','Harrington Detailing','14 Clifton St','Melbourne','VIC','3000','Australia'),
  ('a1000000-0000-0000-0000-000000000002','Sarah Mitchell','sarah.mitchell@example.com','+1 310 555 0192',NULL,'2801 Ocean Park Blvd','Santa Monica','CA','90405','USA'),
  ('a1000000-0000-0000-0000-000000000003','Liam Fletcher','liam.fletcher@example.com','+44 7911 234567','Fleet Solutions UK','42 Kings Road','London',NULL,'SW3 4UD','UK'),
  ('a1000000-0000-0000-0000-000000000004','Emma Kowalski','emma.k@example.com','+1 647 555 0138',NULL,'301 Front St W','Toronto','ON','M5V 2T6','Canada'),
  ('a1000000-0000-0000-0000-000000000005','Erik Lindqvist','erik.lindqvist@example.com','+46 70 123 4567','Nordic Auto Care','Kungsgatan 12','Stockholm',NULL,'111 43','Sweden'),
  ('a1000000-0000-0000-0000-000000000006','Tom Nguyen','tom.n@example.com','+61 423 987 654','Sydney Detailing Co','88 George St','Sydney','NSW','2000','Australia'),
  ('a1000000-0000-0000-0000-000000000007','Alexandra Ross','alex.ross@example.com','+1 212 555 0177',NULL,'350 Fifth Ave','New York','NY','10118','USA')
ON CONFLICT (id) DO NOTHING;

INSERT INTO orders (id, order_number, customer_id, date, status, payment_status, shipping_status, refund_status, subtotal, shipping_cost, tax, total, currency, country, source) VALUES
  ('b1000000-0000-0000-0000-000000000001','BC-1001','a1000000-0000-0000-0000-000000000001','2026-06-03','fulfilled', 'paid',    'delivered',  'none',   320.00,15.00,33.50,368.50,'AUD','Australia','website'),
  ('b1000000-0000-0000-0000-000000000002','BC-1002','a1000000-0000-0000-0000-000000000002','2026-06-04','fulfilled', 'paid',    'delivered',  'none',   240.00,25.00,26.50,291.50,'USD','USA','website'),
  ('b1000000-0000-0000-0000-000000000003','BC-1003','a1000000-0000-0000-0000-000000000003','2026-06-04','processing','paid',    'shipped',    'none',   160.00,20.00,18.00,198.00,'GBP','UK','website'),
  ('b1000000-0000-0000-0000-000000000004','BC-1004','a1000000-0000-0000-0000-000000000004','2026-06-05','processing','pending', 'processing', 'none',   480.00,30.00,51.00,561.00,'CAD','Canada','website'),
  ('b1000000-0000-0000-0000-000000000005','BC-1005','a1000000-0000-0000-0000-000000000005','2026-06-05','fulfilled', 'paid',    'delivered',  'none',   320.00,15.00,33.50,368.50,'SEK','Sweden','website'),
  ('b1000000-0000-0000-0000-000000000006','BC-1006','a1000000-0000-0000-0000-000000000006','2026-06-02','fulfilled', 'paid',    'delivered',  'none',   160.00,15.00,17.50,192.50,'AUD','Australia','website'),
  ('b1000000-0000-0000-0000-000000000007','BC-1007','a1000000-0000-0000-0000-000000000007','2026-06-01','refunded',  'refunded','returned',   'full',   240.00,0.00,0.00,240.00,'USD','USA','website'),
  ('b1000000-0000-0000-0000-000000000008','BC-1008','a1000000-0000-0000-0000-000000000001','2026-05-28','fulfilled', 'paid',    'delivered',  'none',   160.00,15.00,17.50,192.50,'AUD','Australia','website'),
  ('b1000000-0000-0000-0000-000000000009','BC-1009','a1000000-0000-0000-0000-000000000003','2026-05-25','cancelled', 'failed',  'pending',    'none',   320.00,20.00,0.00,340.00,'GBP','UK','website'),
  ('b1000000-0000-0000-0000-000000000010','BC-1010','a1000000-0000-0000-0000-000000000005','2026-05-20','fulfilled', 'paid',    'delivered',  'none',   480.00,15.00,49.50,544.50,'SEK','Sweden','website')
ON CONFLICT (id) DO NOTHING;

INSERT INTO order_items (order_id, product, variant, quantity, unit_price, subtotal) VALUES
  ('b1000000-0000-0000-0000-000000000001','Crimson','Standard',  2,160.00,320.00),
  ('b1000000-0000-0000-0000-000000000002','Phantom','Pro Pack',  1,240.00,240.00),
  ('b1000000-0000-0000-0000-000000000003','Titan',  'Standard',  1,160.00,160.00),
  ('b1000000-0000-0000-0000-000000000004','Arctic', 'Standard',  2,160.00,320.00),
  ('b1000000-0000-0000-0000-000000000004','Crimson','Standard',  1,160.00,160.00),
  ('b1000000-0000-0000-0000-000000000005','Crimson','Pro Pack',  2,160.00,320.00),
  ('b1000000-0000-0000-0000-000000000006','Titan',  'Standard',  1,160.00,160.00),
  ('b1000000-0000-0000-0000-000000000007','Phantom','Pro Pack',  1,240.00,240.00),
  ('b1000000-0000-0000-0000-000000000008','Arctic', 'Standard',  1,160.00,160.00),
  ('b1000000-0000-0000-0000-000000000009','Crimson','Standard',  2,160.00,320.00),
  ('b1000000-0000-0000-0000-000000000010','Phantom','Pro Pack',  2,240.00,480.00)
ON CONFLICT DO NOTHING;

INSERT INTO invoices (order_id, invoice_number, issued_date, due_date, status) VALUES
  ('b1000000-0000-0000-0000-000000000001','INV-1001','2026-06-03','2026-06-17','paid'),
  ('b1000000-0000-0000-0000-000000000002','INV-1002','2026-06-04','2026-06-18','paid'),
  ('b1000000-0000-0000-0000-000000000003','INV-1003','2026-06-04','2026-06-18','issued'),
  ('b1000000-0000-0000-0000-000000000005','INV-1005','2026-06-05','2026-06-19','paid'),
  ('b1000000-0000-0000-0000-000000000006','INV-1006','2026-06-02','2026-06-16','paid'),
  ('b1000000-0000-0000-0000-000000000008','INV-1008','2026-05-28','2026-06-11','paid'),
  ('b1000000-0000-0000-0000-000000000010','INV-1010','2026-05-20','2026-06-03','paid')
ON CONFLICT DO NOTHING;

INSERT INTO refunds (order_id, amount, reason, status) VALUES
  ('b1000000-0000-0000-0000-000000000007',240.00,'Customer changed mind — returned unopened','processed')
ON CONFLICT DO NOTHING;

INSERT INTO internal_notes (order_id, author, content) VALUES
  ('b1000000-0000-0000-0000-000000000001','Admin','Customer requested gift wrapping. Dispatched with card.'),
  ('b1000000-0000-0000-0000-000000000004','Admin','Payment pending — follow up with customer by EOD.'),
  ('b1000000-0000-0000-0000-000000000007','Admin','Refund approved 2 Jun. Return received in good condition.')
ON CONFLICT DO NOTHING;

INSERT INTO email_logs (order_id, type, recipient_email, recipient_name, subject, status) VALUES
  ('b1000000-0000-0000-0000-000000000001','invoice','james.h@example.com','James Harrington','Your BlackCrow invoice — BC-1001','sent'),
  ('b1000000-0000-0000-0000-000000000002','invoice','sarah.mitchell@example.com','Sarah Mitchell','Your BlackCrow invoice — BC-1002','sent'),
  ('b1000000-0000-0000-0000-000000000007','refund_remittance','alex.ross@example.com','Alexandra Ross','Refund remittance — BC-1007','sent')
ON CONFLICT DO NOTHING;

INSERT INTO review_requests (order_id, customer_email, status) VALUES
  ('b1000000-0000-0000-0000-000000000001','james.h@example.com','reviewed'),
  ('b1000000-0000-0000-0000-000000000002','sarah.mitchell@example.com','sent'),
  ('b1000000-0000-0000-0000-000000000006','tom.n@example.com','opened')
ON CONFLICT DO NOTHING;

-- ================================================================
-- 9. INVENTORY
-- ================================================================
CREATE TABLE IF NOT EXISTS inventory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name        TEXT NOT NULL,
  sku                 TEXT NOT NULL UNIQUE,
  units               INT NOT NULL DEFAULT 0,
  low_stock_threshold INT NOT NULL DEFAULT 25,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO inventory (product_name, sku, units, low_stock_threshold) VALUES
  ('CRIMSON', 'BC-CRIMSON-01', 89,  25),
  ('PHANTOM', 'BC-PHANTOM-01', 18,  25),
  ('TITAN',   'BC-TITAN-01',   22,  25),
  ('ARCTIC',  'BC-ARCTIC-01',  145, 25)
ON CONFLICT (sku) DO NOTHING;

-- ================================================================
-- 10. TASKS
-- ================================================================
CREATE TABLE IF NOT EXISTS tasks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  due_date   DATE,
  completed  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tasks (title, due_date) VALUES
  ('Reply to wholesale inquiry — AutoDetail Co.',  CURRENT_DATE),
  ('Update product photography for TITAN',         CURRENT_DATE),
  ('Review June ad spend report',                  CURRENT_DATE + 1),
  ('Reorder PHANTOM stock (min. 200 units)',        CURRENT_DATE + 3),
  ('Launch Instagram giveaway post',               CURRENT_DATE + 5)
ON CONFLICT DO NOTHING;

-- ================================================================
-- 11. INVOICE ENHANCEMENTS
-- Run this block if you already have the base schema.
-- ================================================================

-- Extend invoices with full financial + customer snapshot fields
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_name    TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_email   TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_phone   TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_address  TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS shipping_address TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method   TEXT DEFAULT 'Credit Card';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal         NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS freight          NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS rounding         NUMERIC(10,4) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gst              NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total            NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes            TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_url          TEXT;

-- Extend customers with CRM stats
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags           TEXT[]        DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_orders   INTEGER       NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lifetime_spend  NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order_date DATE;

-- Back-fill financial data into existing invoice seed rows
-- (safe to run multiple times — only updates rows missing subtotal)
UPDATE invoices AS inv
SET
  subtotal        = o.subtotal,
  freight         = o.shipping_cost,
  gst             = o.tax,
  total           = o.total,
  customer_name   = c.name,
  customer_email  = c.email,
  customer_phone  = c.phone,
  billing_address = CONCAT_WS(', ',
                      c.address_line1, c.city,
                      c.state, c.postcode, c.country),
  shipping_address = CONCAT_WS(', ',
                      c.address_line1, c.city,
                      c.state, c.postcode, c.country)
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE inv.order_id = o.id
  AND inv.subtotal = 0;

-- Update invoice numbering to BCA-INV format for seed rows
-- (only changes rows that still use the legacy INV-XXXX format)
DO $$
DECLARE
  r RECORD;
  seq INT := 1;
BEGIN
  FOR r IN
    SELECT id FROM invoices
    WHERE invoice_number NOT LIKE 'BCA-INV-%'
    ORDER BY created_at
  LOOP
    UPDATE invoices
    SET invoice_number = 'BCA-INV-' || LPAD(seq::TEXT, 7, '0')
    WHERE id = r.id;
    seq := seq + 1;
  END LOOP;
END $$;

-- ================================================================
-- 12. INVOICE EDIT & ORDER NUMBERING ENHANCEMENTS
-- Run this block after Section 11.
-- ================================================================

-- Track which country entity was used for this invoice
-- (drives company header + tax label on the printed invoice)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS country_entity TEXT NOT NULL DEFAULT 'Australia';

-- Warehouse / location reference shown on invoice line items
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS location TEXT;

-- Migrate existing orders to BCA-ORD-XXXXXXX sequential format.
-- Only updates rows whose order_number does NOT already start with BCA-ORD-.
DO $$
DECLARE
  r   RECORD;
  seq INT := 1;
BEGIN
  FOR r IN
    SELECT id FROM orders
    WHERE order_number NOT LIKE 'BCA-ORD-%'
    ORDER BY created_at
  LOOP
    UPDATE orders
    SET order_number = 'BCA-ORD-' || LPAD(seq::TEXT, 7, '0')
    WHERE id = r.id;
    seq := seq + 1;
  END LOOP;
END $$;

-- ================================================================
-- 13. PRODUCT CATALOGUE
-- Run this block to add database-driven product management.
-- ================================================================
-- NOTE: Before using image uploads, create a public bucket named
-- "product-images" in Supabase Storage (Storage → New Bucket →
-- Name: product-images, Public: ON).
-- ================================================================

CREATE TABLE IF NOT EXISTS products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  category            TEXT NOT NULL DEFAULT 'Drying'
                        CHECK (category IN ('Drying','Interior','Exterior')),
  short_tagline       TEXT,
  description         TEXT,
  price               NUMERIC(10,2) NOT NULL DEFAULT 0,
  compare_at_price    NUMERIC(10,2),
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('active','coming_soon','draft','archived')),
  main_image_url      TEXT,
  gallery_image_urls  TEXT[] DEFAULT '{}',
  sku                 TEXT,
  tax_code            TEXT DEFAULT 'GST',
  display_order       INT NOT NULL DEFAULT 0,
  available_countries TEXT[] DEFAULT '{Australia,USA,UK,Canada,Sweden}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the 4 existing products (safe to re-run — skips on conflict)
INSERT INTO products
  (name, slug, category, short_tagline, description, price, status,
   main_image_url, gallery_image_urls, sku, display_order, available_countries)
VALUES
  (
    'CRIMSON', 'crimson', 'Drying',
    'Engineered for one-pass drying.',
    'Engineered for one-pass drying and premium detailing performance.',
    80.00, 'active',
    '/images/product-crimson.jpg',
    '{"/images/crimson-1.jpg","/images/crimson-2.jpg","/images/crimson-3.jpg","/images/crimson-4.jpg"}',
    'BC-CRIMSON-01', 1,
    '{Australia,USA,UK,Canada,Sweden}'
  ),
  (
    'PHANTOM', 'phantom', 'Drying',
    'Ultra-soft, ultra-capable.',
    'Engineered for one-pass drying and premium detailing performance.',
    80.00, 'active',
    '/images/product-phantom.jpg',
    '{"/images/phantom-1.jpg","/images/phantom-2.jpg","/images/phantom-3.jpg","/images/phantom-4.jpg"}',
    'BC-PHANTOM-01', 2,
    '{Australia,USA,UK,Canada,Sweden}'
  ),
  (
    'TITAN', 'titan', 'Drying',
    'Maximum coverage, zero marring.',
    'Engineered for one-pass drying and premium detailing performance.',
    80.00, 'active',
    '/images/product-titan.jpg',
    '{"/images/titan-1.jpg","/images/titan-2.jpg","/images/titan-3.jpg","/images/titan-4.jpg"}',
    'BC-TITAN-01', 3,
    '{Australia,USA,UK,Canada,Sweden}'
  ),
  (
    'ARCTIC', 'arctic', 'Drying',
    'The ultimate winter detailer.',
    'Engineered for one-pass drying and premium detailing performance.',
    80.00, 'active',
    '/images/product-arctic.jpg',
    '{"/images/arctic-1.jpg","/images/arctic-2.jpg","/images/arctic-3.jpg","/images/arctic-4.jpg"}',
    'BC-ARCTIC-01', 4,
    '{Australia,USA,UK,Canada,Sweden}'
  )
ON CONFLICT (slug) DO NOTHING;

-- ================================================================
-- 14. ORDER FULFILMENT ENHANCEMENTS
-- Adds tracking, timestamp, and timeline event support to orders.
-- ================================================================

-- Tracking & fulfilment timestamps on the orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number  TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_carrier TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS packed_at        TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at       TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at     TIMESTAMPTZ;

-- Order event timeline (packed, shipped, delivered, notes, emails, refunds)
CREATE TABLE IF NOT EXISTS order_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL
                CHECK (event_type IN ('created','packed','shipped','delivered','note','email','refund','tracking','status')),
  description TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT 'System',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);

-- ================================================================
-- 15. INVENTORY MANAGEMENT (v2)
-- Shopify-ready. Full movement ledger. Per product × country.
-- Run this block fresh — drops old inventory tables first.
-- ================================================================

DROP TABLE IF EXISTS stock_transfers    CASCADE;
DROP TABLE IF EXISTS stock_adjustments  CASCADE;
DROP TABLE IF EXISTS inventory_movements CASCADE;
DROP TABLE IF EXISTS inventory           CASCADE;

-- ── Core inventory (one row per product × country) ────────────
CREATE TABLE inventory (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id                UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id                UUID,          -- future: product_variants.id
  sku                       TEXT,          -- denormalised from product/variant
  country                   TEXT NOT NULL DEFAULT 'Australia',
  location_name             TEXT,          -- e.g. "Sydney Warehouse"

  -- Stock figures
  stock_on_hand             INT NOT NULL DEFAULT 0 CHECK (stock_on_hand >= 0),
  stock_reserved            INT NOT NULL DEFAULT 0 CHECK (stock_reserved >= 0),
  incoming_stock            INT NOT NULL DEFAULT 0 CHECK (incoming_stock >= 0),
  minimum_stock_level       INT NOT NULL DEFAULT 5  CHECK (minimum_stock_level >= 0),
  cost_per_unit             NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Status (auto-managed by trigger; override to 'discontinued' manually)
  status                    TEXT NOT NULL DEFAULT 'in_stock'
                              CHECK (status IN ('in_stock','low_stock','out_of_stock','incoming','discontinued')),

  -- Shopify integration (connect later — fields prepared now)
  shopify_product_id        TEXT,
  shopify_variant_id        TEXT,
  shopify_inventory_item_id TEXT,
  shopify_location_id       TEXT,
  sync_status               TEXT NOT NULL DEFAULT 'unsynced'
                              CHECK (sync_status IN ('unsynced','synced','pending','error')),
  last_synced_at            TIMESTAMPTZ,

  -- Timestamps
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (product_id, country)
);
CREATE INDEX idx_inventory_product    ON inventory(product_id);
CREATE INDEX idx_inventory_country    ON inventory(country);
CREATE INDEX idx_inventory_status     ON inventory(status);
CREATE INDEX idx_inventory_sync       ON inventory(sync_status);

-- ── Movement ledger ───────────────────────────────────────────
CREATE TABLE inventory_movements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id   UUID REFERENCES inventory(id) ON DELETE SET NULL,
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type  TEXT NOT NULL CHECK (movement_type IN (
    'initial_stock','manual_adjustment',
    'stock_added','stock_removed',
    'sale','refund_return',
    'transfer_in','transfer_out',
    'incoming_shipment',
    'damage','lost'
  )),
  quantity       INT NOT NULL,
  previous_stock INT NOT NULL DEFAULT 0,
  new_stock      INT NOT NULL DEFAULT 0,
  reason         TEXT,
  reference_type TEXT,   -- e.g. 'order', 'transfer', 'po'
  reference_id   TEXT,   -- e.g. order_id, PO number
  created_by     TEXT NOT NULL DEFAULT 'Admin',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inv_movements_inventory ON inventory_movements(inventory_id);
CREATE INDEX idx_inv_movements_product   ON inventory_movements(product_id);
CREATE INDEX idx_inv_movements_type      ON inventory_movements(movement_type);

-- ── Adjustment audit trail ────────────────────────────────────
CREATE TABLE stock_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id    UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  before_quantity INT NOT NULL,
  after_quantity  INT NOT NULL,
  reason          TEXT,
  adjusted_by     TEXT NOT NULL DEFAULT 'Admin',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_adj_inventory ON stock_adjustments(inventory_id);

-- ── Inter-country transfers ───────────────────────────────────
CREATE TABLE stock_transfers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  from_country   TEXT NOT NULL,
  to_country     TEXT NOT NULL,
  quantity       INT NOT NULL,
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'completed'
                   CHECK (status IN ('pending','in_transit','completed','cancelled')),
  transferred_by TEXT NOT NULL DEFAULT 'Admin',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_transfers_product ON stock_transfers(product_id);

-- ── Auto-status trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_inventory_status()
RETURNS TRIGGER AS $$
BEGIN
  -- stock_available = stock_on_hand - stock_reserved
  -- Logic: discontinued is never auto-overridden
  IF NEW.status <> 'discontinued' THEN
    IF NEW.stock_on_hand = 0 THEN
      NEW.status = 'out_of_stock';
    ELSIF NEW.stock_on_hand <= NEW.minimum_stock_level THEN
      NEW.status = 'low_stock';
    ELSE
      NEW.status = 'in_stock';
    END IF;
    -- Promote to 'incoming' if stock is low/zero but shipment en route
    IF NEW.status IN ('out_of_stock','low_stock') AND NEW.incoming_stock > 0 THEN
      NEW.status = 'incoming';
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_status ON inventory;
CREATE TRIGGER trg_inventory_status
  BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION update_inventory_status();

-- ── Seed: 4 products × 5 countries = 20 rows ─────────────────
INSERT INTO inventory
  (product_id, sku, country, location_name,
   stock_on_hand, incoming_stock, minimum_stock_level, cost_per_unit, status)
SELECT
  p.id,
  p.sku,
  c.country,
  c.country || ' Warehouse',
  CASE c.country
    WHEN 'Australia' THEN 48
    WHEN 'USA'       THEN 32
    WHEN 'UK'        THEN 18
    WHEN 'Canada'    THEN 12
    WHEN 'Sweden'    THEN 8
  END,
  CASE c.country WHEN 'Australia' THEN 100 ELSE 0 END,
  10,
  ROUND((p.price * 0.4)::NUMERIC, 2),
  CASE c.country
    WHEN 'Sweden' THEN 'low_stock'
    ELSE 'in_stock'
  END
FROM products p
CROSS JOIN (VALUES ('Australia'),('USA'),('UK'),('Canada'),('Sweden')) AS c(country)
ON CONFLICT (product_id, country) DO NOTHING;

-- ================================================================
-- 16. TASKS & ACTIVITY TRACKING
-- Operational task management across all countries.
-- Auto-generates BCA-TSK-0000001 style task numbers.
-- ================================================================

DROP TABLE IF EXISTS task_attachments CASCADE;
DROP TABLE IF EXISTS task_activity    CASCADE;
DROP TABLE IF EXISTS task_comments    CASCADE;
DROP TABLE IF EXISTS tasks            CASCADE;
DROP SEQUENCE IF EXISTS task_number_seq;

CREATE SEQUENCE task_number_seq START 1;

CREATE TABLE tasks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_number       TEXT        UNIQUE NOT NULL DEFAULT ('BCA-TSK-' || LPAD(nextval('task_number_seq')::TEXT, 7, '0')),
  title             TEXT        NOT NULL,
  description       TEXT,
  country           TEXT        NOT NULL DEFAULT 'Australia'
                                CHECK (country IN ('Australia','USA','UK','Canada','Sweden','All')),
  assigned_to       TEXT,
  assigned_to_email TEXT,
  created_by        TEXT        NOT NULL DEFAULT 'Admin',
  category          TEXT        NOT NULL
                                CHECK (category IN ('Sales','Inventory','Orders','Customer Service','Marketing','Product','Admin','Website','Finance','Country Operations')),
  priority          TEXT        NOT NULL DEFAULT 'Medium'
                                CHECK (priority IN ('Low','Medium','High','Urgent')),
  status            TEXT        NOT NULL DEFAULT 'To Do'
                                CHECK (status IN ('To Do','In Progress','Under Review','Completed','Overdue','Cancelled')),
  due_date          DATE,
  completed_at      TIMESTAMPTZ,
  completion_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE task_comments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  comment    TEXT        NOT NULL,
  created_by TEXT        NOT NULL DEFAULT 'Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE task_activity (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action       TEXT        NOT NULL,
  old_value    TEXT,
  new_value    TEXT,
  performed_by TEXT        NOT NULL DEFAULT 'Admin',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE task_attachments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_name   TEXT        NOT NULL,
  file_url    TEXT        NOT NULL,
  uploaded_by TEXT        NOT NULL DEFAULT 'Admin',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_status    ON tasks(status);
CREATE INDEX idx_tasks_country   ON tasks(country);
CREATE INDEX idx_tasks_due_date  ON tasks(due_date);
CREATE INDEX idx_task_comments   ON task_comments(task_id);
CREATE INDEX idx_task_activity   ON task_activity(task_id);
CREATE INDEX idx_task_attachments ON task_attachments(task_id);

CREATE OR REPLACE FUNCTION tasks_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_set_updated_at();

-- ── Seed tasks ────────────────────────────────────────────────
INSERT INTO tasks (title, description, country, assigned_to, assigned_to_email, created_by, category, priority, status, due_date, completed_at) VALUES
  ('Review Q2 inventory levels',        'Check stock across all SKUs and flag critical shortfalls.',            'Australia', 'James Parker',   'james@blackcrow.com.au',  'Admin', 'Inventory',          'High',   'In Progress',  CURRENT_DATE + 2, NULL),
  ('Follow up on overdue invoices',     'Contact customers with invoices >30 days overdue.',                   'USA',       'Sarah Mitchell',  'sarah@blackcrow.com.au',  'Admin', 'Finance',            'Urgent', 'To Do',        CURRENT_DATE,     NULL),
  ('Update Phantom product listings',   'Add new images and update descriptions for the Phantom range.',       'Australia', 'Tom Harris',      'tom@blackcrow.com.au',    'Admin', 'Website',            'Medium', 'Under Review', CURRENT_DATE + 5, NULL),
  ('Prepare monthly sales report',      'Compile sales data for all countries and prepare board presentation.','All',       'Admin',           'admin@blackcrow.com.au',  'Admin', 'Sales',              'High',   'To Do',        CURRENT_DATE + 1, NULL),
  ('Resolve UK customer complaints',    'Three unresolved complaints in the UK queue need urgent attention.',  'UK',        'Emma White',      'emma@blackcrow.com.au',   'Admin', 'Customer Service',   'Urgent', 'Overdue',      CURRENT_DATE - 1, NULL),
  ('Onboard Canadian distributor',      'Set up account for new Toronto distributor.',                         'Canada',    'Admin',           'admin@blackcrow.com.au',  'Admin', 'Country Operations', 'Medium', 'Completed',    CURRENT_DATE - 3, now() - INTERVAL '3 days'),
  ('Sweden Q1 marketing review',        'Analyse performance of Q1 social media campaign.',                    'Sweden',    'Admin',           'admin@blackcrow.com.au',  'Admin', 'Marketing',          'Low',    'Completed',    CURRENT_DATE - 5, now() - INTERVAL '5 days'),
  ('Audit admin user access levels',    'Review all admin accounts and confirm correct permissions.',           'All',       'Admin',           'admin@blackcrow.com.au',  'Admin', 'Admin',              'High',   'To Do',        CURRENT_DATE + 3, NULL),
  ('USA warehouse restock order',       'Place restock order for top 5 SKUs below threshold.',                 'USA',       'James Parker',    'james@blackcrow.com.au',  'Admin', 'Inventory',          'High',   'In Progress',  CURRENT_DATE + 1, NULL),
  ('Respond to product inquiry emails', 'Clear inbox of unanswered product enquiries from past week.',         'UK',        'Emma White',      'emma@blackcrow.com.au',   'Admin', 'Customer Service',   'Medium', 'To Do',        CURRENT_DATE + 2, NULL);

-- ── Seed activity for seeded tasks ───────────────────────────
INSERT INTO task_activity (task_id, action, new_value, performed_by)
SELECT id, 'Task created', status, 'Admin' FROM tasks;

-- ================================================================
-- SECTION 17: CRM TABLES
-- Run this AFTER all previous sections
-- ================================================================

-- ── Extend existing customers table ──────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_number  TEXT UNIQUE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_name       TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_name        TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status           TEXT DEFAULT 'Active';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lifetime_spend   NUMERIC(12,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_orders     INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order_date  DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT now();

-- ── Customer number sequence ──────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS customer_number_seq START 1;

-- ── Auto-generate customer numbers on insert ──────────────────
CREATE OR REPLACE FUNCTION generate_customer_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_number IS NULL THEN
    NEW.customer_number := 'BCA-CUS-' || LPAD(nextval('customer_number_seq')::TEXT, 7, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customers_set_number ON customers;
CREATE TRIGGER customers_set_number
  BEFORE INSERT ON customers
  FOR EACH ROW EXECUTE FUNCTION generate_customer_number();

-- ── Updated_at trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION customers_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customers_updated_at ON customers;
CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_set_updated_at();

-- ── Back-fill customer numbers for existing rows ──────────────
UPDATE customers
SET customer_number = 'BCA-CUS-' || LPAD(nextval('customer_number_seq')::TEXT, 7, '0')
WHERE customer_number IS NULL;

-- ── Back-fill status for existing rows ───────────────────────
UPDATE customers SET status = 'Active' WHERE status IS NULL;

-- ── customer_notes ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  note        TEXT        NOT NULL,
  created_by  TEXT        NOT NULL DEFAULT 'Admin',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── customer_tags ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_tags (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tag         TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id, tag)
);

-- ── customer_communications ───────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_communications (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  communication_type TEXT        NOT NULL,
  description        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customer_notes_cid  ON customer_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_tags_cid   ON customer_tags(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_comms_cid  ON customer_communications(customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_status    ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_country   ON customers(country);

-- ── Seed: VIP tags for high-spend customers ───────────────────
INSERT INTO customer_tags (customer_id, tag)
SELECT id, 'VIP'
FROM customers
WHERE lifetime_spend > 500
ON CONFLICT DO NOTHING;

INSERT INTO customer_tags (customer_id, tag)
SELECT id, 'Repeat Buyer'
FROM customers
WHERE total_orders >= 2
ON CONFLICT DO NOTHING;

-- ── Seed: sample communications ───────────────────────────────
INSERT INTO customer_communications (customer_id, communication_type, description)
SELECT id, 'Review Request Sent', 'Initial review request sent after first order'
FROM customers
WHERE total_orders >= 1
LIMIT 5;

INSERT INTO customer_communications (customer_id, communication_type, description)
SELECT id, 'Invoice Emailed', 'Invoice emailed for most recent order'
FROM customers
WHERE total_orders >= 1
LIMIT 8;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 18 — USERS & ACCESS (profiles, user_permissions, user_activity)
-- ════════════════════════════════════════════════════════════════════════════

-- ── profiles ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_number    TEXT UNIQUE,
  email          TEXT NOT NULL UNIQUE,
  full_name      TEXT,
  role           TEXT NOT NULL DEFAULT 'Read Only'
                   CHECK (role IN ('Final Admin','Country Admin','Operations','Inventory Manager','Customer Service','Marketing','Read Only')),
  country_access TEXT[],          -- NULL = all countries; array = restricted list
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','suspended','disabled','invited')),
  last_login     TIMESTAMPTZ,
  invited_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  invited_at     TIMESTAMPTZ,
  avatar_url     TEXT,
  phone          TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Auto-number: BCA-USR-XXXXXXX ─────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS user_number_seq START 1000001 INCREMENT 1;

CREATE OR REPLACE FUNCTION profiles_set_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_number IS NULL OR NEW.user_number = '' THEN
    NEW.user_number := 'BCA-USR-' || LPAD(nextval('user_number_seq')::TEXT, 7, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_number_trigger ON profiles;
CREATE TRIGGER profiles_number_trigger
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_set_number();

-- ── user_permissions ──────────────────────────────────────────────────────
-- Fine-grained per-user overrides on top of role defaults
CREATE TABLE IF NOT EXISTS user_permissions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  page       TEXT NOT NULL,
  can_view   BOOLEAN NOT NULL DEFAULT TRUE,
  can_edit   BOOLEAN NOT NULL DEFAULT FALSE,
  can_export BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, page)
);

-- ── user_activity ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_activity (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,   -- 'login','logout','page_view','edit','export','role_change','status_change'
  detail      TEXT,
  ip_address  INET,
  user_agent  TEXT,
  performed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_role     ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_status   ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_email    ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_perms_user   ON user_permissions(user_id);

-- ── updated_at trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Seed: admin user ─────────────────────────────────────────────────────
INSERT INTO profiles (email, full_name, role, status, country_access)
VALUES
  ('admin@blackcrow.com',     'Black Crow Admin',    'Final Admin',       'active', NULL),
  ('ops@blackcrow.com',       'Operations Manager',  'Operations',        'active', NULL),
  ('cs@blackcrow.com',        'Customer Service',    'Customer Service',  'active', ARRAY['Australia','New Zealand']),
  ('marketing@blackcrow.com', 'Marketing Lead',      'Marketing',         'active', NULL),
  ('inv@blackcrow.com',       'Inventory Manager',   'Inventory Manager', 'active', NULL),
  ('readonly@blackcrow.com',  'Read Only User',      'Read Only',         'invited', NULL)
ON CONFLICT (email) DO NOTHING;

-- ── Seed: activity log entries ────────────────────────────────────────────
INSERT INTO user_activity (user_id, action_type, detail)
SELECT id, 'login',  'Initial login after account creation'
FROM profiles WHERE role = 'Final Admin'
LIMIT 1;

INSERT INTO user_activity (user_id, action_type, detail)
SELECT id, 'page_view', 'Viewed KPI Performance dashboard'
FROM profiles WHERE role = 'Final Admin'
LIMIT 1;

INSERT INTO user_activity (user_id, action_type, detail)
SELECT id, 'login', 'First login'
FROM profiles WHERE role = 'Operations'
LIMIT 1;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 19 — TRADE ACCOUNTS
-- (trade_accounts, trade_contacts, trade_notes, trade_communications, trade_pricing_rules)
-- ════════════════════════════════════════════════════════════════════════════

-- ── trade_accounts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_number   TEXT UNIQUE,
  business_name  TEXT NOT NULL,
  trading_name   TEXT,
  business_number TEXT,
  country        TEXT,
  address        TEXT,
  website        TEXT,
  status         TEXT NOT NULL DEFAULT 'Pending'
                   CHECK (status IN ('Pending','Approved','Distributor','Suspended','Rejected')),
  trade_tier     TEXT NOT NULL DEFAULT 'Trade'
                   CHECK (trade_tier IN ('Retail','Trade','Distributor','Major Account')),
  payment_terms  TEXT NOT NULL DEFAULT 'NET 30'
                   CHECK (payment_terms IN ('Prepaid','Due On Receipt','NET 7','NET 14','NET 30','NET 45','NET 60')),
  credit_limit   NUMERIC(12,2) DEFAULT 0,
  lifetime_spend NUMERIC(12,2) DEFAULT 0,
  total_orders   INTEGER DEFAULT 0,
  last_order_date DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Auto-number: BCA-TRD-XXXXXXX ─────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS trade_number_seq START 1000001 INCREMENT 1;

CREATE OR REPLACE FUNCTION trade_accounts_set_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trade_number IS NULL OR NEW.trade_number = '' THEN
    NEW.trade_number := 'BCA-TRD-' || LPAD(nextval('trade_number_seq')::TEXT, 7, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trade_accounts_number_trigger ON trade_accounts;
CREATE TRIGGER trade_accounts_number_trigger
  BEFORE INSERT ON trade_accounts
  FOR EACH ROW EXECUTE FUNCTION trade_accounts_set_number();

-- ── updated_at trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trade_accounts_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trade_accounts_updated_at ON trade_accounts;
CREATE TRIGGER trade_accounts_updated_at
  BEFORE UPDATE ON trade_accounts
  FOR EACH ROW EXECUTE FUNCTION trade_accounts_set_updated_at();

-- ── trade_contacts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_contacts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_account_id UUID NOT NULL REFERENCES trade_accounts(id) ON DELETE CASCADE,
  contact_name     TEXT,
  email            TEXT,
  phone            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── trade_notes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_account_id UUID NOT NULL REFERENCES trade_accounts(id) ON DELETE CASCADE,
  note             TEXT NOT NULL,
  created_by       TEXT NOT NULL DEFAULT 'Admin',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── trade_communications ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_communications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_account_id   UUID NOT NULL REFERENCES trade_accounts(id) ON DELETE CASCADE,
  communication_type TEXT NOT NULL,
  description        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── trade_pricing_rules ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_pricing_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_account_id UUID NOT NULL REFERENCES trade_accounts(id) ON DELETE CASCADE,
  product_id       TEXT,
  minimum_quantity INTEGER NOT NULL DEFAULT 1,
  custom_price     NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_trade_accounts_status   ON trade_accounts(status);
CREATE INDEX IF NOT EXISTS idx_trade_accounts_tier     ON trade_accounts(trade_tier);
CREATE INDEX IF NOT EXISTS idx_trade_accounts_country  ON trade_accounts(country);
CREATE INDEX IF NOT EXISTS idx_trade_contacts_account  ON trade_contacts(trade_account_id);
CREATE INDEX IF NOT EXISTS idx_trade_notes_account     ON trade_notes(trade_account_id);
CREATE INDEX IF NOT EXISTS idx_trade_comms_account     ON trade_communications(trade_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_pricing_account   ON trade_pricing_rules(trade_account_id);

-- ── Seed: sample trade accounts ───────────────────────────────────────────
INSERT INTO trade_accounts (business_name, trading_name, business_number, country, status, trade_tier, payment_terms, credit_limit, lifetime_spend, total_orders)
VALUES
  ('AutoPro Supplies Pty Ltd',   'AutoPro',         '12 345 678 901', 'Australia',    'Approved',    'Trade',         'NET 30', 5000,  12450.00, 8),
  ('Global Wheel Distributors',  'GWD',             '98 765 432 109', 'Australia',    'Distributor', 'Distributor',   'NET 60', 25000, 87300.00, 42),
  ('Pacific Automotive Group',   'PAG',             '45 678 901 234', 'New Zealand',  'Approved',    'Major Account', 'NET 45', 50000, 234800.00, 115),
  ('UK Parts Direct Ltd',        'UKPD',            'GB123456789',    'UK',           'Approved',    'Trade',         'NET 30', 8000,  19200.00, 14),
  ('Nordic Auto AB',             'Nordic Auto',     'SE556789012345', 'Sweden',       'Pending',     'Retail',        'Prepaid', 0,    0,        0),
  ('Eastside Motorsport',        'Eastside MS',     '67 890 123 456', 'Australia',    'Suspended',   'Trade',         'NET 14', 3000,  5600.00,  4)
ON CONFLICT DO NOTHING;

-- ── Seed: contacts for each trade account ─────────────────────────────────
INSERT INTO trade_contacts (trade_account_id, contact_name, email, phone)
SELECT id, 'James Mitchell',   'james@autoprosupplies.com.au', '+61 2 9876 5432' FROM trade_accounts WHERE business_name='AutoPro Supplies Pty Ltd'
ON CONFLICT DO NOTHING;

INSERT INTO trade_contacts (trade_account_id, contact_name, email, phone)
SELECT id, 'Sarah Chen',       'sarah@gwd.com.au',              '+61 3 8765 4321' FROM trade_accounts WHERE business_name='Global Wheel Distributors'
ON CONFLICT DO NOTHING;

INSERT INTO trade_contacts (trade_account_id, contact_name, email, phone)
SELECT id, 'David Ngata',      'david@pag.co.nz',               '+64 9 765 4321'  FROM trade_accounts WHERE business_name='Pacific Automotive Group'
ON CONFLICT DO NOTHING;

INSERT INTO trade_contacts (trade_account_id, contact_name, email, phone)
SELECT id, 'Emma Thompson',    'emma@ukpartsdirect.co.uk',       '+44 20 7654 3210' FROM trade_accounts WHERE business_name='UK Parts Direct Ltd'
ON CONFLICT DO NOTHING;

INSERT INTO trade_contacts (trade_account_id, contact_name, email, phone)
SELECT id, 'Lars Eriksson',    'lars@nordicauto.se',             '+46 8 765 432 10' FROM trade_accounts WHERE business_name='Nordic Auto AB'
ON CONFLICT DO NOTHING;

INSERT INTO trade_contacts (trade_account_id, contact_name, email, phone)
SELECT id, 'Mike Robertson',   'mike@eastsidems.com.au',         '+61 7 8765 4321' FROM trade_accounts WHERE business_name='Eastside Motorsport'
ON CONFLICT DO NOTHING;

-- ── Seed: communications ──────────────────────────────────────────────────
INSERT INTO trade_communications (trade_account_id, communication_type, description)
SELECT id, 'Account Created', 'Trade account created and pending review'
FROM trade_accounts WHERE status IN ('Approved','Distributor','Pending','Suspended');

INSERT INTO trade_communications (trade_account_id, communication_type, description)
SELECT id, 'Account Approved', 'Trade account approved by Final Admin'
FROM trade_accounts WHERE status IN ('Approved','Distributor');


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 20 — SETTINGS
-- (settings, email_templates, review_templates, country_settings)
-- ════════════════════════════════════════════════════════════════════════════

-- ── settings (key-value store) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key   TEXT NOT NULL UNIQUE,
  setting_value TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(setting_key);

-- ── email_templates ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name TEXT NOT NULL UNIQUE,
  subject       TEXT,
  body          TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── review_templates ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name TEXT NOT NULL UNIQUE,
  subject       TEXT,
  body          TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── country_settings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS country_settings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country    TEXT NOT NULL UNIQUE,
  currency   TEXT NOT NULL DEFAULT 'AUD',
  tax_rate   NUMERIC(5,2) NOT NULL DEFAULT 10,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_country_settings_country ON country_settings(country);

-- ── Seed: default settings ────────────────────────────────────────────────
INSERT INTO settings (setting_key, setting_value) VALUES
  ('company_name',        'BLACKCROW INTERNATIONAL PTY LTD'),
  ('trading_name',        'BLACKCROW AUTOMOTIVE ACCESSORIES'),
  ('abn',                 ''),
  ('address',             ''),
  ('phone',               ''),
  ('email',               'admin@blackcrow.com'),
  ('website',             'https://blackcrow.com'),
  ('invoice_prefix',      'BCA-INV-'),
  ('invoice_start_number','0000001'),
  ('refund_prefix',       'BCA-RFD-'),
  ('trade_invoice_prefix','BCA-TRD-'),
  ('order_prefix',        'BCA-ORD-'),
  ('order_start_number',  '0000001'),
  ('customer_prefix',     'BCA-CUS-'),
  ('tax_enabled',         'true'),
  ('tax_type',            'GST'),
  ('tax_name',            'GST'),
  ('tax_percentage',      '10'),
  ('tax_applies_to',      'all'),
  ('primary_colour',      '#cc0000'),
  ('secondary_colour',    '#ffffff'),
  ('logo_url',            ''),
  ('invoice_logo_url',    ''),
  ('favicon_url',         ''),
  ('shopify_store_url',   ''),
  ('shopify_storefront_token', ''),
  ('shopify_admin_token', ''),
  ('shopify_sync_products',   'false'),
  ('shopify_sync_orders',     'false'),
  ('shopify_sync_inventory',  'false'),
  ('shopify_sync_customers',  'false'),
  ('maintenance_mode',         'false'),
  ('enable_notifications',     'true'),
  ('enable_email_logging',     'true'),
  ('enable_activity_tracking', 'true'),
  ('enable_review_requests',   'true')
ON CONFLICT (setting_key) DO NOTHING;

-- ── Seed: email templates ─────────────────────────────────────────────────
INSERT INTO email_templates (template_name, subject, body) VALUES
  ('Invoice Email',
   'Your BlackCrow Invoice {{invoice_number}}',
   'Hi {{customer_name}},

Please find your invoice {{invoice_number}} attached.

Order: {{order_number}}
Total: {{total}}
Due Date: {{due_date}}

Thank you for your business.

BlackCrow Automotive Accessories
{{business_name}}'),

  ('Refund Email',
   'Your BlackCrow Refund {{invoice_number}}',
   'Hi {{customer_name}},

Your refund for order {{order_number}} has been processed.

Refund Amount: {{total}}

Please allow 3–5 business days for the refund to appear.

BlackCrow Automotive Accessories'),

  ('Trade Invoice Email',
   'Trade Invoice {{invoice_number}} — BlackCrow',
   'Dear {{customer_name}},

Please find attached your trade invoice {{invoice_number}}.

Total: {{total}}
Payment Terms: {{payment_terms}}
Due Date: {{due_date}}

BlackCrow Trade Accounts
{{business_name}}'),

  ('Payment Reminder Email',
   'Payment Reminder — Invoice {{invoice_number}}',
   'Hi {{customer_name}},

This is a friendly reminder that invoice {{invoice_number}} is due.

Amount Due: {{total}}
Due Date: {{due_date}}

Please arrange payment at your earliest convenience.

BlackCrow Automotive Accessories'),

  ('Welcome Email',
   'Welcome to BlackCrow, {{customer_name}}',
   'Hi {{customer_name}},

Welcome to BlackCrow Automotive Accessories.

Your account has been created and you can now log in to manage your orders and invoices.

If you have any questions, please contact us at admin@blackcrow.com.

BlackCrow Automotive Accessories')
ON CONFLICT (template_name) DO NOTHING;

-- ── Seed: review template ─────────────────────────────────────────────────
INSERT INTO review_templates (template_name, subject, body) VALUES
  ('Default Review Request',
   'How was your BlackCrow experience, {{customer_name}}?',
   'Hi {{customer_name}},

Thank you for your recent order {{order_number}} with BlackCrow Automotive Accessories.

We would love to hear about your experience. It only takes 2 minutes and helps us improve our products and service.

Leave a review: [Review Link]

Thank you for your support.

BlackCrow Automotive Accessories')
ON CONFLICT (template_name) DO NOTHING;

-- ── Seed: country settings ────────────────────────────────────────────────
INSERT INTO country_settings (country, currency, tax_rate, enabled) VALUES
  ('Australia',   'AUD', 10.00, true),
  ('USA',         'USD',  0.00, true),
  ('UK',          'GBP', 20.00, true),
  ('Canada',      'CAD',  5.00, true),
  ('Sweden',      'SEK', 25.00, true)
ON CONFLICT (country) DO UPDATE SET
  currency   = EXCLUDED.currency,
  tax_rate   = EXCLUDED.tax_rate,
  enabled    = EXCLUDED.enabled,
  updated_at = NOW();


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 21 — AUTHENTICATION SETUP
-- ════════════════════════════════════════════════════════════════════════════
--
-- PRE-REQUISITES (do these before running this section):
--
-- 1. Add to .env:
--      SUPABASE_SERVICE_KEY="your-service-role-key"
--        (Get from: Supabase Dashboard → Settings → API → service_role secret)
--      APP_URL="http://localhost:3000"
--        (Your app's base URL — used for password reset redirect links)
--
-- 2. In Supabase Auth dashboard (Authentication → Users → Add User):
--      Create the Final Admin user:
--        Email:    admin@blackcrow.com
--        Password: (set a secure password)
--        Auto Confirm: ON
--
--    The Section 18 seed already inserted a matching profiles row for this email.
--
-- 3. For Country Admins:
--      Create their Supabase Auth users the same way, OR use the
--      Users & Access page (Final Admin only) → Create / Invite User.
--
-- ── No schema changes are required for authentication ──
-- The profiles table from Section 18 is fully compatible:
--   - role column: CHECK constraint includes 'Final Admin' and 'Country Admin'
--   - country_access TEXT[]: stores assigned country for Country Admins
--   - email TEXT UNIQUE: used to link Supabase Auth users to profiles
--
-- ── Optional index (profiles already has idx_profiles_email) ──
CREATE INDEX IF NOT EXISTS idx_profiles_role_status ON profiles(role, status);

-- ── Role descriptions (for reference) ──
-- final_admin   → role = 'Final Admin'   → full access to all pages and all countries
-- country_admin → role = 'Country Admin' → access to all pages EXCEPT Settings and Users,
--                                          data filtered to their assigned country only
--
-- Country Admin country assignment:
--   country_access = ARRAY['Australia']   -- Australia Admin
--   country_access = ARRAY['USA']         -- USA Admin
--   country_access = ARRAY['UK']          -- UK Admin
--   country_access = ARRAY['Canada']      -- Canada Admin
--   country_access = ARRAY['Sweden']      -- Sweden Admin
--   country_access = NULL                 -- All countries (Final Admin)

-- ════════════════════════════════════════════════════════════════
-- SECTION 22: CRM ENHANCEMENTS
-- ════════════════════════════════════════════════════════════════

-- Add missing columns to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS average_order_value NUMERIC(12,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS refund_count INTEGER DEFAULT 0;

-- Add missing columns to customer_communications (may already have some, use IF NOT EXISTS or DO $$ blocks)
ALTER TABLE customer_communications ADD COLUMN IF NOT EXISTS related_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE customer_communications ADD COLUMN IF NOT EXISTS related_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE customer_communications ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'System';

-- customer_reviews table
CREATE TABLE IF NOT EXISTS customer_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  review_request_sent_at TIMESTAMPTZ,
  review_submitted_at TIMESTAMPTZ,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,
  review_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_reviews_cid ON customer_reviews(customer_id);

-- auto_customer_status function
CREATE OR REPLACE FUNCTION auto_customer_status(p_customer_id UUID)
RETURNS VOID AS $$
DECLARE
  v_orders  INTEGER;
  v_spend   NUMERIC;
  v_refunds INTEGER;
  v_cur_status TEXT;
  v_new_status TEXT;
BEGIN
  SELECT total_orders, lifetime_spend, refund_count, status
  INTO v_orders, v_spend, v_refunds, v_cur_status
  FROM customers WHERE id = p_customer_id;
  IF v_cur_status IN ('Trade Account','Trade Lead','Suspended') THEN RETURN; END IF;
  IF v_refunds >= 2 THEN v_new_status := 'Refund Risk';
  ELSIF v_spend >= 2000 THEN v_new_status := 'VIP';
  ELSIF v_orders >= 2 THEN v_new_status := 'Repeat Buyer';
  ELSIF v_orders = 1 THEN v_new_status := 'Active';
  ELSE v_new_status := 'Lead';
  END IF;
  UPDATE customers SET status = v_new_status WHERE id = p_customer_id;
END;
$$ LANGUAGE plpgsql;
