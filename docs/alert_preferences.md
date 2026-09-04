# Alert Preferences — design field inventory

Design surface: `Customer Portal.dc.html`, page key `alertprefs` (Account menu → Alert Preferences).

Built against ONLY these six files. Every field below traces to one of them; nothing else was invented.

- `artifacts/api-server/src/routes/portal-alert-preferences.ts`
- `artifacts/api-server/src/lib/customer-tenant-alert-engine.ts`
- `artifacts/api-server/src/lib/customer-alert-delivery.ts`
- `lib/db/migrations/manual/2026-08-25-customer-tenant-alert-rules-1278.sql`
- `lib/db/migrations/manual/2026-08-25-customer-alert-preferences-1276.sql`
- `artifacts/portal/src/pages/portal-v2-alert-preferences.tsx` (NOT carried over —
  retired in `f40438cdc`'s #1485 portal-v2 rebuild; this file does not exist in
  `artifacts/portal`)

## Fields drawn, with source

| Field | Source |
|---|---|
| 7 categories: `findings, drift, progress, reviews, remediation, billing, support` | `customer-alert-delivery.ts` → `CUSTOMER_ALERT_BALANCED_DEFAULTS` keys |
| Per-category `enabled`, `emailEnabled`, `mode` (`immediate`\|`daily`\|`weekly`), `threshold` | `portal-alert-preferences.ts` `CategoryPrefShape` / GET response `categories[cat]` |
| Balanced-preset default values per category | `customer-alert-delivery.ts` `CUSTOMER_ALERT_BALANCED_DEFAULTS` (used verbatim for the empty state) |
| All 23 rule rows: `rule_key`, `label`, `severity`, `detector_status` | `2026-08-25-customer-tenant-alert-rules-1278.sql` seed INSERT — 19 `live`, 4 `pending_detector` (`finding.mfa_gap`, `finding.global_admin_added`, `drift.regression`, `billing.license_change`) |
| Pending-detector visual distinction (dashed, muted, "NO DETECTOR YET — CAN'T FIRE" badge) | `detector_status` column, same migration; hard rule from the design brief |
| `settings.activePreset`, `quietHoursEnabled`, `quietHoursFrom`, `quietHoursTo`, `quietBreakForCritical` | `portal-alert-preferences.ts` GET response `settings` |
| `settings.updatedAt` / `updatedByName` — null when no row saved (degrades to Balanced) | same route; null case is the real "no saved preferences yet" state |
| `primaryRecipient.email`, `.name` | same route, always resolved live from the requesting user |
| `recipients[].email`, `.role`, `.scopeCategories` (null = all categories) | same route, backed by `customer_alert_recipients` table |
| GET failure copy: *"Unable to load alert preferences right now. Please try again shortly."* | `portal-alert-preferences.ts` GET catch block, verbatim |
| PUT failure copy: *"Unable to save alert preferences right now. Please try again shortly."* | `portal-alert-preferences.ts` PUT catch block, verbatim |
| Accepted-risk suppression note (Findings category only, explanatory copy, no live count) | `customer-tenant-alert-engine.ts` `NOT_ACCEPTED_AS_RISK` — every `finding.*` evaluator excludes items with an active, check-key-linked `msp_risk_decisions` row |
| Save/Reset button gating (disabled unless dirty; error blocks save) | `portal-v2-alert-preferences.tsx` `save()`/`reset()` behavior |
| Toggle visual (38×21 pill + knob) | `portal-v2-alert-preferences.tsx` `Toggle` component, reproduced at the same dimensions |

## States drawn (not just the populated one)

- **Populated** — categories/settings/recipients loaded from saved rows.
- **Empty** — `settings.updatedAt === null`: every category silently running on the Balanced default, shown with a banner rather than blank fields.
- **Error** — GET failure: the route's own error string in a red banner; Save is disabled (per the tsx's own `!!error` gate).

A `apViewState` prop (`populated` \| `empty` \| `error`) switches between them for review.

## Requested — wanted but not present in these six files

- Category display names, "trigger" description, and "volume" copy, plus each category's full per-category threshold option list — these live in `alertPrefsData.ts` / `ALERT_CATS`, which was not in scope. Substituted: category key as the label, and the rule catalog's own `label`/`description` text for the condition list; current `threshold` shown as a read-only value chip rather than a dropdown of unknown options.
- Any endpoint returning recent `customer_tenant_alert_events` (fired-alert history, `customer_delivery_status` per event) — no read route for that table exists in the given files, so no activity feed was drawn.
- The full `CUSTOMER_ALERT_PRESETS` enum beyond `balanced` / `custom` (only those two are confirmed in the given files).
- The "Add recipient" drawer's real field spec — the tsx notes it opens shell drawer machinery not defined here; a minimal inline substitute (email + role + scope) was built instead, following the PUT schema's recipient shape.
