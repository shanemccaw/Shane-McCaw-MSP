-- Cost Engine — Real SKU Pricing and License Waste Dollars
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- sku_price_reference is a flat reference table (mirrors industry_benchmark_reference's
-- style: text primary key, a couple of value columns, source/as_of_date provenance) that
-- backs cost-engine.ts's price lookup step. List price only for this pass — no per-MSP
-- negotiated pricing, no region pricing (msp_id/region columns can be added later without
-- a redesign; deliberately omitted now, not stubbed).
--
-- Seeded with the SKU part numbers this platform's own monitor checks and script-output
-- parser actually reference (SKU_LOOKUP in artifacts/api-server/src/lib/parse-m365-script-output.ts),
-- which is the same set of raw skuPartNumber values that flow through the
-- licensing:sku-utilization / cost:license-waste-estimate / copilot:license-readiness
-- monitor_checks' groupByCount transform (see 0191_update_monitor_checks_transforms.sql)
-- and land in the licensing.wasteEstimateBreakdown / skuBreakdown / copilotLicenseBreakdown
-- dashboard metrics. NOT a generic/guessed SKU catalog.
--
-- Prices are Microsoft's published US list prices (per user/month, annual commitment paid
-- monthly), current as of this platform's knowledge cutoff (2026-07-19). Shane should spot-
-- check these against https://www.microsoft.com/microsoft-365/licensing before relying on
-- them for anything customer-facing — Microsoft revises list pricing periodically and this
-- table is not wired to any live pricing feed. Two SKUs (MCOSTANDARD — Skype for Business
-- Online, retired standalone product; TEAMS_EXPLORATORY — a free trial SKU) are seeded with
-- NULL monthly_price_cents rather than a guessed figure — cost-engine.ts's safety rule is to
-- warn and treat unknown/no-price SKUs as $0, never fabricate a number.

CREATE TABLE IF NOT EXISTS "sku_price_reference" (
  "sku_part_number"     TEXT PRIMARY KEY,
  "display_name"        TEXT,
  "monthly_price_cents" INTEGER,
  "source"              TEXT,
  "as_of_date"          DATE
);

INSERT INTO "sku_price_reference" ("sku_part_number", "display_name", "monthly_price_cents", "source", "as_of_date") VALUES
  ('ENTERPRISEPACK',           'Office 365 E3',                     2300, 'Microsoft published list price', '2026-07-19'),
  ('ENTERPRISEPREMIUM',        'Office 365 E5',                     3800, 'Microsoft published list price', '2026-07-19'),
  ('STANDARDPACK',             'Office 365 E1',                     1000, 'Microsoft published list price', '2026-07-19'),
  ('SPE_E3',                   'Microsoft 365 E3',                  3600, 'Microsoft published list price', '2026-07-19'),
  ('SPE_E5',                   'Microsoft 365 E5',                  5700, 'Microsoft published list price', '2026-07-19'),
  ('SPB',                      'Microsoft 365 Business Premium',    2200, 'Microsoft published list price', '2026-07-19'),
  ('O365_BUSINESS_ESSENTIALS', 'Microsoft 365 Business Basic',       600, 'Microsoft published list price', '2026-07-19'),
  ('O365_BUSINESS_PREMIUM',    'Microsoft 365 Business Standard',   1250, 'Microsoft published list price', '2026-07-19'),
  ('SMB_BUSINESS',             'Microsoft 365 Apps for Business',    850, 'Microsoft published list price', '2026-07-19'),
  ('SMB_BUSINESS_PREMIUM',     'Microsoft 365 Business Premium',    2200, 'Microsoft published list price', '2026-07-19'),
  ('M365_F1',                  'Microsoft 365 F1',                   225, 'Microsoft published list price', '2026-07-19'),
  ('M365_F3',                  'Microsoft 365 F3',                   800, 'Microsoft published list price', '2026-07-19'),
  ('DESKLESSPACK',             'Office 365 F3',                      400, 'Microsoft published list price', '2026-07-19'),
  ('FLOW_FREE',                'Power Automate Free',                  0, 'Microsoft published list price', '2026-07-19'),
  ('POWER_BI_STANDARD',        'Power BI (free)',                      0, 'Microsoft published list price', '2026-07-19'),
  ('POWER_BI_PRO',             'Power BI Pro',                       1000, 'Microsoft published list price', '2026-07-19'),
  ('POWER_BI_PREMIUM_USER',    'Power BI Premium Per User',          2000, 'Microsoft published list price', '2026-07-19'),
  ('PROJECTPREMIUM',           'Project Plan 5',                    5500, 'Microsoft published list price', '2026-07-19'),
  ('PROJECTPROFESSIONAL',      'Project Plan 3',                    3000, 'Microsoft published list price', '2026-07-19'),
  ('VISIOCLIENT',              'Visio Plan 2',                      1500, 'Microsoft published list price', '2026-07-19'),
  ('VISIOONLINE_PLAN1',        'Visio Plan 1',                       500, 'Microsoft published list price', '2026-07-19'),
  ('MCOSTANDARD',              'Skype for Business Online Plan 2',    NULL, 'retired product — no current list price', '2026-07-19'),
  ('EXCHANGE_S_ENTERPRISE',    'Exchange Online Plan 2',              800, 'Microsoft published list price', '2026-07-19'),
  ('EXCHANGESTANDARD',         'Exchange Online Plan 1',              400, 'Microsoft published list price', '2026-07-19'),
  ('SHAREPOINTENTERPRISE',     'SharePoint Online Plan 2',           1000, 'Microsoft published list price', '2026-07-19'),
  ('SHAREPOINTSTANDARD',       'SharePoint Online Plan 1',            500, 'Microsoft published list price', '2026-07-19'),
  ('TEAMS_EXPLORATORY',        'Microsoft Teams Exploratory',           NULL, 'free trial SKU — no list price', '2026-07-19'),
  ('INTUNE_A',                 'Microsoft Intune',                    800, 'Microsoft published list price', '2026-07-19'),
  ('AAD_PREMIUM',              'Entra ID P1',                         600, 'Microsoft published list price', '2026-07-19'),
  ('AAD_PREMIUM_P2',           'Entra ID P2',                         900, 'Microsoft published list price', '2026-07-19'),
  ('EMS',                      'Enterprise Mobility + Security E3',  1060, 'Microsoft published list price', '2026-07-19'),
  ('EMSPREMIUM',               'Enterprise Mobility + Security E5',  1640, 'Microsoft published list price', '2026-07-19'),
  ('DEFENDER_ENDPOINT_P1',     'Defender for Endpoint P1',            300, 'Microsoft published list price', '2026-07-19'),
  ('DEFENDER_ENDPOINT_P2',     'Defender for Endpoint P2',            520, 'Microsoft published list price', '2026-07-19'),
  ('ATP_ENTERPRISE',           'Defender for Office 365 P1',          200, 'Microsoft published list price', '2026-07-19')
ON CONFLICT ("sku_part_number") DO NOTHING;
