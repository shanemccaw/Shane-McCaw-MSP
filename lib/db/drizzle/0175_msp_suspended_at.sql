-- Add suspended_at to msps table
-- Records when an MSP transitions to "suspended" status.
-- Used to compute the 7-day customer-visible banner threshold.
-- Cleared (set to null) on re-activation.
ALTER TABLE msps ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

-- Backfill: for any MSP already in "suspended" status, use updated_at as a
-- conservative proxy for when suspension occurred.
UPDATE msps
SET suspended_at = COALESCE(updated_at, NOW())
WHERE status = 'suspended'
  AND suspended_at IS NULL;
