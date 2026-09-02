# Product Catalog

**Source of truth: the real `services` table in the platform database (`lib/db/src/schema/index.ts` →
`servicesTable`), queried directly via local `DATABASE_URL` on 2026-09-02.** Every name, price, and
tier figure below is a real column (or `type_attributes` JSON key) value from that table, cited by
row `id`. Nothing here is carried forward from any prose spec — `Authority-Products.docx`,
`MSP_Portal_Master_Spec_v10.docx`, `RETAINER_TIERS.md`, `MSP_Full_Product_Catalog.xlsx`, and
`engagement-projects-2026-07-11.json` are all retired and were not read to produce this file.

**There is no separate "retainer tier" table.** Retainer products are ordinary rows in `services`
with `delivery_type = 'retainer'` (confirmed against `lib/db/src/schema/index.ts:458-585`, which
defines a single `servicesTable` with no retainer-specific table anywhere in the schema). A table
literally named `retainer_settings` does exist, but it holds per-customer runtime state
(`retained_minutes_per_month`, `hourly_rate_cents`, `architect_name` — 0 rows currently), not a
tier catalog — it is not a source for this document.

As of this build, `services` has **115 total rows / 96 `is_public = true`**. This document covers
the public, customer/MSP-facing catalog. A short **Internal-only rows** section at the end lists
what exists but is not public, for completeness.

Prices are shown as displayed to the buyer (`price_cents` / `annual_price_cents` in whole
dollars, or the `type_attributes` pricing fields where the flat price columns are null — noted per
section). `id` is the real `services.id` primary key so any figure here can be re-verified with
`SELECT * FROM services WHERE id = <id>`.

---

## 1. Architect Advisory Retainers (`category = 'retainer'`, `delivery_type = 'retainer'`)

6 real rows, all `is_public = true`, all `billing_type = 'recurring_monthly'`. Pricing lives in
the flat `price_cents` column for these six (not `type_attributes`, unlike the Monitoring bundles
in §3).

| id | Name | Price / mo | Hours/mo | Description |
|----|------|-----------:|---------:|-------------|
| 168 | Architect Advisory Retainer | $900 | 5 | Ongoing M365 architecture advisory, 5 hours/month. |
| 115 | Architect Essentials Retainer | $1,500 | 8 | Ongoing M365 architecture advisory, 8 hours/month. |
| 116 | Architect Growth Retainer | $3,000 | 16 | Ongoing M365 architecture advisory, 16 hours/month. |
| 117 | Architect Enterprise Retainer | $5,500 | 30 | Ongoing M365 architecture advisory, 30 hours/month. |
| 118 | vCISO / Governance Retainer | $4,500 base ($4,500–$12,000 range via `base_price`/`max_price`) | — | Ongoing virtual CISO advisory: security strategy, board-level reporting, compliance oversight. |
| 119 | Copilot Governance Retainer | $2,000 base ($2,000–$4,500 range via `base_price`/`max_price`) | — | Ongoing Copilot usage and governance oversight — narrower scope than the full vCISO retainer. |

**Confirms real:** the four "Architect" tier names/prices ($900 / $1,500 / $3,000 / $5,500) match
`Authority-Products.docx`'s naming for the top three and `RETAINER_TIERS.md`'s $900/mo figure for
the bottom one — but the real row name for the $900 tier is **"Architect Advisory Retainer,"** not
`RETAINER_TIERS.md`'s "Advisory." Neither old doc had "vCISO / Governance" or "Copilot Governance"
as their own retainer rows — both are real, live rows (118, 119) that should have been in either
doc and weren't.

**Discrepancy — no `inclusions`/`features`/`deliverables` on any of the 6 rows.** All three jsonb
columns are `NULL` for every retainer row. Whatever "what's included" copy exists in the old docs
for these tiers has no backing data — it is not carried forward here because it isn't a real
column value. This is a real product-catalog gap, not an omission from this doc.

---

## 2. MSP Platform Subscription (`category = 'platform_subscription'`, `fulfillment_type = 'msp_monthly_subscription'`)

3 real rows, all public, `recurring_monthly`. These are the tiers an MSP running on the platform
subscribes to (distinct from what an MSP sells its own customers). Full feature gating lives in
`type_attributes`, including a real `notIncluded` array per tier.

| id | Name | Price / mo | Tenant allowance | MSP staff seats | White-label | Not included |
|----|------|-----------:|------------------|-----------------|-------------|--------------|
| 120 | Free | $0 | 3 | 1 | No | CRM Engine, MSP Portfolio Engine, Custom SLA/Scope Creep rules, Sales Offer Engine, Config Packs, White-label branding, Command Center write actions |
| 121 | Growth | $129 | 25 | 5 | Yes | MSP Portfolio Engine, Command Center gated/destructive write actions, Custom bundle composition |
| 122 | Pro | $299 | Unlimited | Unlimited | Yes | (none) |

Descriptions (real, `description` column): Free — "Entry-level platform access for MSPs getting
started." Growth — "For MSPs building a real reseller business on the platform." Pro — "Full
platform access for MSPs scaling across an unlimited customer portfolio."

---

## 3. Monitoring Bundles (`category = 'monitoring'`, `delivery_type = 'bundle_subscription'`)

12 real rows, all public, `recurring_monthly`. **The flat `price` / `price_cents` / `base_price`
columns are all `NULL` on every one of these 12 rows** — real per-seat pricing lives entirely in
`type_attributes` (`pricePerUserMonth`, `monthlyFloor`, `flatMonthlySurcharge`, `seatMin`/`seatMax`).
Three package tiers (`Foundation` / `Growth` / `Premier`) × four tenant-size bands
(`Micro` 1–25 seats / `SMB` 26–100 / `Mid-Market` 101–499 / `Enterprise` 500+).

| id | Name | $/user/mo | Monthly floor | Flat surcharge | Included engines |
|----|------|----------:|---------------:|----------------:|-------------------|
| 1 | Foundation Monitoring — Micro | $12.00 | $180 | — | monitoring |
| 2 | Foundation Monitoring — SMB | $9.00 | $300 | — | monitoring |
| 3 | Foundation Monitoring — Mid-Market | $7.00 | $900 | — | monitoring |
| 4 | Foundation Monitoring — Enterprise | $5.00 | $3,000 | — | monitoring |
| 5 | Growth Monitoring — Micro | $18.00 | $350 | — | monitoring, live_monitor |
| 6 | Growth Monitoring — SMB | $14.00 | $500 | — | monitoring, live_monitor |
| 7 | Growth Monitoring — Mid-Market | $11.00 | $1,500 | — | monitoring, live_monitor |
| 8 | Growth Monitoring — Enterprise | $8.00 | $5,000 | — | monitoring, live_monitor |
| 9 | Premier Monitoring — Micro | $22.50 | $440 | $160 | monitoring, live_monitor |
| 10 | Premier Monitoring — SMB | $17.50 | $625 | $160 | monitoring, live_monitor |
| 11 | Premier Monitoring — Mid-Market | $13.75 | $1,875 | $160 | monitoring, live_monitor |
| 12 | Premier Monitoring — Enterprise | $10.00 | $6,250 | $160 | monitoring, live_monitor, priority, health, drift, crm, sla, sales_offer, scope_creep, msp, forecasting, security, pricing |

Only the four **Premier** rows carry `includedFeatures` (real jsonb, not invented): Micro/SMB/
Mid-Market get `["Configuration Drift & Change History Report", "SLA Scope Creep & Compliance
Report"]`; Enterprise additionally gets `advanced_signals`, `sla_scope_creep_custom_rules`,
`custom_bundle_composition`, `custom_workflows`.

---

## 4. Change Control Add-Ons (`category = 'Add-ons'`)

4 real rows, all public, `recurring_monthly`, all sharing the same description (real column value,
verbatim): *"Formal Dev→Test→Prod change-approval workflow for your team: every change raised
through the portal gets a two-gate sign-off before it runs against your tenant, plus a full
customer-facing register and audit trail of every change request, its risk rating and its approval
history."*

| id | Name | Price / mo |
|----|------|-----------:|
| 177 | Change Control — Micro (1–25 seats) | $99 |
| 179 | Change Control — SMB (26–100 seats) | $149 |
| 178 | Change Control — Mid-Market (101–499 seats) | $299 |
| 176 | Change Control — Enterprise (500+ seats) | $499 |

---

## 5. Assessments (`category = 'assessment'`, `delivery_type = 'assessment'`)

21 real rows, all public, `one_time`. Three are free lead-generation snapshots (`price_cents = 0`);
the remaining 18 carry a `base_price`/`max_price` range (shown), with `price_cents` set to the base.

| id | Name | Price |
|----|------|------:|
| 13 | Tenant Governance Snapshot | Free |
| 14 | Copilot Readiness Snapshot | Free |
| 15 | License Waste Audit | Free |
| 16 | M365 Tenant Health Audit | $3,500–$7,000 |
| 17 | Security Posture Assessment | $4,500–$9,500 |
| 18 | Compliance Framework Mapping Audit — SOC 2 | $6,000–$14,000 |
| 19 | Compliance Framework Mapping Audit — NIST CSF | $5,000–$12,000 |
| 20 | Compliance Framework Mapping Audit — ISO 27001 | $7,000–$16,000 |
| 21 | Compliance Framework Mapping Audit — CMMC Level 1–2 | $7,000–$18,000 |
| 22 | Data Governance Assessment | $5,000–$11,000 |
| 23 | Conditional Access Assessment | $3,000–$6,500 |
| 24 | Migration Readiness Assessment | $3,500–$6,000 |
| 25 | Copilot Readiness Assessment | $5,000–$9,500 |
| 26 | Copilot Data Exposure Assessment | $5,500–$12,000 |
| 27 | License & Cost Optimization Assessment | $2,500–$5,500 |
| 28 | Adoption & Change Management Maturity Assessment | $4,000–$8,000 |
| 29 | SharePoint Assessment | $4,000–$9,000 |
| 30 | Teams Assessment | $3,500–$7,500 |
| 31 | Exchange Online Assessment | $3,500–$7,000 |
| 32 | Entra ID / Identity Assessment | $4,000–$8,500 |
| 33 | Intune / Device Management Assessment | $3,500–$7,000 |

No `tagline`, `inclusions`, or `features` are set on any of these 21 rows (all `NULL`) — descriptions
above are the real `description` column; that is the only marketing copy currently attached to
these rows.

---

## 6. Config Packs (`category = 'config_pack'`)

14 real rows, all public, `one_time`. Real write-back remediation packages (not reports).

| id | Name | Price |
|----|------|------:|
| 169 | Break-Glass Access Pack | $249 |
| 170 | Conditional Access Baseline Pack | $199 |
| 171 | Privileged Access Pack | $299 |
| 172 | Device Compliance Pack (Intune) | $249 |
| 173 | Email Security Pack (Exchange Online) | $249 |
| 174 | Identity Hygiene Pack | $249 |
| 175 | Baseline Licensing Pack | $199 |
| 195 | MFA Enforcement Pack | $299 |
| 125 | Entra ID Quick-Start Pack | $799 |
| 127 | New Employee Onboarding Pack | $149 |
| 128 | Employee Offboarding Pack | $199 |
| 129 | Security Incident Response Pack | $299 |
| 130 | Compromised Account Recovery Pack | $149 |
| 196 | SharePoint & OneDrive Oversharing Pack | $349 |

---

## 7. Projects (`category = 'project'`)

37 real rows (33 public). The large implementation/remediation-project catalog. All `one_time`.

| id | Name | Price |
|----|------|------:|
| 34 | Identity Modernization & Conditional Access Build-Out | $8,000 |
| 35 | Privileged Identity Management (PIM) Rollout | $6,000 |
| 36 | MFA / Passwordless Rollout | $4,000 |
| 37 | Security & Compliance Hardening for Microsoft 365 | $9,000 |
| 38 | Email Security Hardening | $4,500 |
| 39 | Zero Trust Architecture Implementation | $12,000 |
| 40 | Governance Remediation & Architecture Hardening | $9,000 |
| 41 | Data Classification & Sensitivity Label Rollout | $9,000 |
| 42 | DLP Policy Implementation | $6,000 |
| 43 | Retention & Records Management Implementation | $5,500 |
| 44 | Compliance Framework Implementation | $15,000 |
| 45 | SharePoint & Teams Information Architecture Rebuild | $8,500 |
| 46 | Teams Sprawl & Lifecycle Automation | $5,500 |
| 47 | External Sharing & Guest Access Governance | $6,500 |
| 48 | Intranet / Hub Site Build-Out | $10,000 |
| 49 | Exchange Online Hygiene & Modernization | $4,500 |
| 50 | Microsoft 365 Migration Execution | $11,000 |
| 51 | Tenant-to-Tenant Migration | $15,000 |
| 52 | SharePoint Migration | $8,000 |
| 53 | Copilot for Microsoft 365 Deployment Project | $13,000 |
| 54 | Copilot Data Exposure Remediation | $6,000 |
| 55 | Copilot Adoption & Governance Program | $5,000 |
| 56 | License Waste Optimization & Cost Recovery | $3,000 |
| 57 | Intune Deployment & Device Compliance Build-Out | $6,000 |
| 58 | Business Continuity / Disaster Recovery Implementation | $8,000 |
| 59 | Teams Phone License & Calling Policy Configuration | $3,500 |
| 60 | Teams Rooms License & Policy Configuration | $3,000 |
| 158 | Identity & Access Hardening | *unset* |
| 159 | Sharing Exposure Remediation | *unset* |
| 160 | Data Protection Baseline | *unset* |
| 161 | Licence Rationalisation | *unset* |
| 162 | Adoption Enablement | *unset* |
| 163 | Drift Baseline & Handover | *unset* |
| 131 | M365 Launch Control — Plus Add-On (`category = NULL`, `service_class = subscription`) | $199/mo |

**Discrepancy — 6 rows (158–163, the Copilot-rollout-pillar engagement series: Identity & Access
Hardening, Sharing Exposure Remediation, Data Protection Baseline, Licence Rationalisation,
Adoption Enablement, Drift Baseline & Handover) have `price_cents = NULL`.** They are real, public,
named rows with real descriptions (durations stated in the description text — one-to-three-week
engagements), but no price is set anywhere on them (flat columns and `type_attributes` both empty).
Flagging rather than inventing a number.

Not public (private, `is_public = false`), so excluded from the table above: id 164–167,
"White-Glove Copilot Adoption — Micro/SMB/Mid-Market/Enterprise" — also no price set.

---

## 8. MSP Onboarding (`category = 'msp_onboarding'`)

2 real rows, public, `one_time`.

| id | Name | Price |
|----|------|------:|
| 123 | Self-Service Onboarding | $99 |
| 124 | White-Glove Onboarding | $1,800 |

---

## Internal-only rows (not in the public catalog, listed for completeness)

- **Micro-Remediation** (`category = 'micro_remediation'`, 14 rows, all `is_public = false`) — the
  one-click remediation actions surfaced from findings (e.g. id 101 "Force Password Reset" $25,
  id 106 "Block Malicious File Hash" $49, id 108 "Isolate Compromised Device" $49). Priced but not
  independently public — sold contextually against a specific finding, not browsed as a catalog
  item.
- **Document Product** (`category = 'document_product'`, 1 row, private): id 67 "Remediation Plan,"
  $299, `add_on`.
- **Copilot Adoption white-glove tiers** (ids 164–167, `category = 'project'`, private, no price
  set) — see §7.

---

## What was deliberately left out, and why

- **No separate "retainer tier" table exists** to cross-reference — see the note at the top. Any
  old doc implying a dedicated retainer-tiers table was wrong about the schema, not just the
  numbers.
- **`msp_plan_capabilities`** and the `minMspPlanTier` strings referenced inside Monitoring bundle
  `type_attributes` (`"free"`, `"growth"`) are gating references to the MSP Platform Subscription
  tiers in §2, not a separate product table — `msp_plan_capabilities` itself has exactly 1 row
  (a capability flag on id 131, the Launch Control add-on), so it isn't a catalog source either.
- No figure in this document was carried forward from `Authority-Products.docx`,
  `RETAINER_TIERS.md`, `MSP_Portal_Master_Spec_v10.docx`, `engagement-projects-2026-07-11.json`, or
  `MSP_Full_Product_Catalog.xlsx` on faith — every number above was independently re-derived from
  the live `services` row it cites.
