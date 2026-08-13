-- 0181_sales_offers_missing_columns
-- The original 0164_sales_offer_engine migration was hand-written against an older
-- design. The Drizzle TypeScript schema subsequently evolved (column renames +
-- additions) without a matching migration. This brings the DB in line:
--
--  Renames:
--    rule_group_snapshot  → engine_snapshot
--
--  Adds:
--    title             TEXT NOT NULL DEFAULT ''
--    bundled_offer_ids JSONB NOT NULL DEFAULT '[]'
--    accepted_at       TIMESTAMP   (was folded into resolved_at)
--    closed_at         TIMESTAMP   (was folded into resolved_at)
--    rejection_reason  TEXT
--
--  Backfills:
--    title        ← services.name where service_id matches
--    accepted_at  ← resolved_at where state = 'accepted'
--    closed_at    ← resolved_at where state IN ('rejected','expired')

-- 1. Rename old column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales_offers' AND column_name = 'rule_group_snapshot'
  ) THEN
    ALTER TABLE sales_offers RENAME COLUMN rule_group_snapshot TO engine_snapshot;
  END IF;
END$$;

-- 2. Add missing columns
ALTER TABLE sales_offers
  ADD COLUMN IF NOT EXISTS title            TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bundled_offer_ids JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS accepted_at      TIMESTAMP,
  ADD COLUMN IF NOT EXISTS closed_at        TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 3. Backfill title from linked service name
UPDATE sales_offers o
SET title = COALESCE(s.name, '')
FROM services s
WHERE o.service_id = s.id
  AND o.title = '';

-- 4. Backfill accepted_at / closed_at from resolved_at
UPDATE sales_offers
SET accepted_at = resolved_at
WHERE state = 'accepted'
  AND resolved_at IS NOT NULL
  AND accepted_at IS NULL;

UPDATE sales_offers
SET closed_at = resolved_at
WHERE state IN ('rejected', 'expired')
  AND resolved_at IS NOT NULL
  AND closed_at IS NULL;
