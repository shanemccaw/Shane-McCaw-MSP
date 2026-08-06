-- ─────────────────────────────────────────────────────────────────────────────
-- tenant_sharepoint_consent — per-tenant consent record for the
-- "Office 365 SharePoint Online" resource (appId 00000003-0000-0ff1-ce00-000000000000)
--
-- WHY THIS TABLE EXISTS (audit result, 2026-07-23):
-- Before this change the platform had NO per-tenant record of whether a customer
-- tenant's admin had ever granted Sites.FullControl.All. The only SharePoint
-- "readiness" signal in the codebase was sharePointAdminCredentialsPresent()
-- (artifacts/api-server/src/lib/sharepoint-admin.ts), which merely checks that
-- MT_APP_CLIENT_ID / MT_APP_CERT_PRIVATE_KEY / MT_APP_CERT_THUMBPRINT env vars
-- are set — a PLATFORM-WIDE check, identical for every tenant, that says nothing
-- about any individual tenant's consent state.
--
-- Sites.FullControl.All is an Application permission on a DIFFERENT Azure
-- resource from Microsoft Graph. tenant_consent.scopes_granted is a snapshot of
-- REQUIRED_MT_SCOPES (Graph .default) only, so it must NOT be reused to answer
-- "has this tenant granted SharePoint access" — every tenant that consented
-- before Sites.FullControl.All was added to the app registration would read as
-- falsely consented.
--
-- Shape deliberately mirrors tenant_write_consent (the existing precedent for a
-- second, independent consent record), with scopes_granted renamed to
-- permissions_granted to match the SharePoint "Application permission" wording.
--
-- Drizzle definition: lib/db/src/schema/msp.ts → tenantSharePointConsentTable
-- Run manually per repo policy (no drizzle-kit push).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_sharepoint_consent (
  tenant_id            text PRIMARY KEY,
  customer_id          integer REFERENCES msp_customers(id) ON DELETE SET NULL,
  consent_status       text NOT NULL DEFAULT 'pending',
  consented_at         timestamptz,
  revoked_at           timestamptz,
  admin_email          text,
  admin_display_name   text,
  permissions_granted  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_sharepoint_consent_customer_id_idx
  ON tenant_sharepoint_consent (customer_id);

CREATE INDEX IF NOT EXISTS tenant_sharepoint_consent_status_idx
  ON tenant_sharepoint_consent (consent_status);

-- NOTE: intentionally NO backfill. Seeding rows as 'granted' for existing
-- tenants would fabricate consent that was never actually given. Every tenant
-- correctly starts with no row at all, which re-consent detection reports as
-- "SharePoint access not yet approved" until a real admin-consent callback
-- stamps a row.
