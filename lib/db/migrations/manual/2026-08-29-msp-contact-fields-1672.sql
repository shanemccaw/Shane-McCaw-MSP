-- Git #1672 — AdminV2 MSP canvas edit/contact fields.
--
-- The archived msp-portal admin pages (msps.tsx, msp-detail.tsx) edited a
-- primary-contact name/email/phone, an office address, and internal notes on
-- an MSP partner record. None of these columns existed on `msps` — the old
-- pages either silently dropped the write or (msp-detail.tsx) fell back to
-- fabricated demo data when the real endpoint returned nothing. Real,
-- nullable columns, additive only.

ALTER TABLE "msps" ADD COLUMN IF NOT EXISTS "primary_contact_name" TEXT;
ALTER TABLE "msps" ADD COLUMN IF NOT EXISTS "primary_contact_email" TEXT;
ALTER TABLE "msps" ADD COLUMN IF NOT EXISTS "primary_contact_phone" TEXT;
ALTER TABLE "msps" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "msps" ADD COLUMN IF NOT EXISTS "notes" TEXT;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-msp-contact-fields-1672.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
