-- Migrate services.deliverables from text → jsonb string[]
-- Idempotent: skips if the column is already jsonb
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services'
      AND column_name = 'deliverables'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE services ADD COLUMN IF NOT EXISTS deliverables_new jsonb;
    UPDATE services
    SET deliverables_new = (
      SELECT jsonb_agg(line)
      FROM unnest(string_to_array(deliverables, E'\n')) AS line
      WHERE trim(line) != ''
    )
    WHERE deliverables IS NOT NULL;
    ALTER TABLE services DROP COLUMN deliverables;
    ALTER TABLE services RENAME COLUMN deliverables_new TO deliverables;
  END IF;
END;
$$;
