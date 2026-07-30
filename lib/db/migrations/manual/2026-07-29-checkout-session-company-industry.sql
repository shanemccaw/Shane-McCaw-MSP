-- #142 (parent #132): capture the buyer's company/industry at the guest-info
-- step of checkout, so the tenant identity created for a direct-business buyer
-- (resolveOrCreateDirectTenant in portal.ts) is the COMPANY, not the person
-- filling out the form.
-- Additive/nullable: existing checkout_sessions rows predate this capture.
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS company text;
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS industry text;
