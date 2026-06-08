-- BlackCrow Admin — Sales table
-- Run this in your Supabase SQL editor to set up the sales table.

CREATE TABLE IF NOT EXISTS sales (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE NOT NULL,
  country     TEXT NOT NULL,
  order_id    TEXT NOT NULL UNIQUE,
  product     TEXT NOT NULL,
  variant     TEXT,
  quantity    INTEGER NOT NULL DEFAULT 1,
  revenue     NUMERIC(10,2) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'fulfilled'
                CHECK (status IN ('fulfilled','processing','cancelled','refunded')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast country + date filtering
CREATE INDEX IF NOT EXISTS idx_sales_country  ON sales (country);
CREATE INDEX IF NOT EXISTS idx_sales_date     ON sales (date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_status   ON sales (status);

-- Row-level security (optional — enable if needed)
-- ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- ── Seed data ────────────────────────────────────────────────────────────────
-- Paste this block to seed realistic sample data.

INSERT INTO sales (date, country, order_id, product, variant, quantity, revenue, status) VALUES
  ('2026-06-05', 'Australia', 'BC-0604', 'Crimson', 'Standard',  2, 160.00, 'fulfilled'),
  ('2026-06-05', 'Australia', 'BC-0603', 'Arctic',  'Standard',  1,  80.00, 'fulfilled'),
  ('2026-06-05', 'USA',       'BC-0602', 'Phantom', 'Pro Pack',  3, 240.00, 'processing'),
  ('2026-06-04', 'UK',        'BC-0601', 'Titan',   'Standard',  1,  80.00, 'processing'),
  ('2026-06-04', 'Australia', 'BC-0600', 'Crimson', 'Standard',  2, 160.00, 'fulfilled'),
  ('2026-06-04', 'Canada',    'BC-0599', 'Arctic',  'Standard',  1,  80.00, 'fulfilled'),
  ('2026-06-03', 'Sweden',    'BC-0598', 'Phantom', 'Standard',  2, 160.00, 'fulfilled'),
  ('2026-06-03', 'USA',       'BC-0597', 'Titan',   'Pro Pack',  1,  80.00, 'fulfilled'),
  ('2026-06-03', 'Australia', 'BC-0596', 'Crimson', 'Standard',  3, 240.00, 'fulfilled'),
  ('2026-06-02', 'UK',        'BC-0595', 'Arctic',  'Standard',  2, 160.00, 'fulfilled'),
  ('2026-06-02', 'Canada',    'BC-0594', 'Crimson', 'Standard',  1,  80.00, 'cancelled'),
  ('2026-06-02', 'Sweden',    'BC-0593', 'Titan',   'Standard',  2, 160.00, 'fulfilled'),
  ('2026-06-01', 'Australia', 'BC-0592', 'Phantom', 'Standard',  1,  80.00, 'fulfilled'),
  ('2026-06-01', 'USA',       'BC-0591', 'Crimson', 'Pro Pack',  2, 160.00, 'fulfilled'),
  ('2026-06-01', 'UK',        'BC-0590', 'Arctic',  'Standard',  1,  80.00, 'refunded'),
  ('2026-05-31', 'Canada',    'BC-0589', 'Titan',   'Standard',  3, 240.00, 'fulfilled'),
  ('2026-05-31', 'Australia', 'BC-0588', 'Crimson', 'Standard',  1,  80.00, 'fulfilled'),
  ('2026-05-30', 'Sweden',    'BC-0587', 'Phantom', 'Standard',  2, 160.00, 'fulfilled'),
  ('2026-05-30', 'USA',       'BC-0586', 'Arctic',  'Standard',  1,  80.00, 'processing'),
  ('2026-05-29', 'Australia', 'BC-0585', 'Titan',   'Pro Pack',  2, 160.00, 'fulfilled')
ON CONFLICT (order_id) DO NOTHING;
