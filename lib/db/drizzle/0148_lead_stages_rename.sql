-- Rename lead stages: Lead→Cold, AQL→Warm, SQL→Hot. Add Junk.
-- Drizzle text() enums are TypeScript-only; the column stays text.
-- We only need to migrate existing data values and update the column default.

UPDATE "leads" SET "stage" = 'Cold' WHERE "stage" = 'Lead';
UPDATE "leads" SET "stage" = 'Warm' WHERE "stage" = 'AQL';
UPDATE "leads" SET "stage" = 'Hot'  WHERE "stage" = 'SQL';

ALTER TABLE "leads" ALTER COLUMN "stage" SET DEFAULT 'Cold';

UPDATE "lead_qualifications" SET "stage" = 'Warm' WHERE "stage" = 'AQL';
UPDATE "lead_qualifications" SET "stage" = 'Hot'  WHERE "stage" = 'SQL';
