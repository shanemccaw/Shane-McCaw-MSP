-- Tenant/User Refactor Phase 2a (#102, parent #92): restore columns Phase 0's
-- msp_customers -> tenants cutover (91b1c8b9) dropped without a replacement.
-- portal-mission-control.ts, portal-assessment.ts and portal-customer-engines.ts
-- still read domain/industry/status/isTestbed off the customer row; there is
-- nowhere else on the new schema for them to live.
--
-- isTestbed keeps its exact old per-tenant semantics: it gates real Microsoft
-- Graph writes in the config-pack orchestrator and is deliberately independent
-- of mspsTable.isTestbed (an MSP being a testbed MSP must not authorize writes
-- for every one of its customers).
--
-- "name" is NOT restored here — tenants.customer_name already covers it
-- (msp_customers.name's replacement), so portal-customer-engines.ts's `.name`
-- reads repoint to that existing column instead of duplicating it.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'onboarding';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_testbed boolean NOT NULL DEFAULT false;
