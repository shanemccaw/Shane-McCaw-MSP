# Email Authentication Setup (Portal) — contract extraction pack

**Issue:** #2445, part of #1654 ("Feature: Email Authentication Setup (Portal)"), part
of #1485 (EPIC: Portal). Method per #1642. Extracted, not authored — every field below
traces to one of the files listed, cited to file:line. This is Phase 2 of the Portal
build order (architect → build the endpoints → regenerate the contract pack →
Design → wire) — no page/UI-shape decisions are made here.

The one endpoint named in #2445's Step 1 was confirmed real and live in the current
codebase before any of this was written:

- `GET /api/portal/email-auth-status` — `portal-email-auth-status.ts:61`

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/portal-email-auth-status.ts` — the one route
- `artifacts/api-server/src/lib/monitor-executor.ts` — `runDnsCheck()` (`:2482-2583`),
  `resolveTenantDnsDomain()` (`:2465-2480`), `DKIM_DEFAULT_SELECTORS` (`:2456`), the
  producer of the data this route reads
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireRole()`, `ROLE_ORDER`
  (`:75-88`), `AuthUser` shape
- `lib/db/src/schema/msp.ts` — `tenantsTable` (`:199-…`), `tenantMonitorProfilesTable`
  (`:2071-…`) (real column sources)
- `monitor_checks` table (queried live, `key = 'exchange:dkim-spf-dmarc-status'`) —
  the check's real `mapping`, `properties`, `executor_type`, `severity_rules`
- `artifacts/api-server/src/lib/drift-check-specs.ts` — `DRIFT_CHECK_SPECS["exchange:dkim-spf-dmarc-status"]`
  (`:269-273`), the same check's drift registration
- `lib/dashboard-registry/src/metrics.ts` — `security.emailAuthFindingCount`
  (`:686-703`), a second, aggregate-shaped live consumer of the same check
- `artifacts/api-server/src/lib/dashboard-resolvers.ts` — `resolveMonitorAggregation()`'s
  `"security.emailAuthFindingCount"` case (`:902-910`)
- `artifacts/portal/src/components/useSecEvidenceEmailLive.ts` — the current portal
  scaffold's own comment on this exact endpoint (`:23-28`), confirming it as a real,
  cited gap rather than something this pack is inventing
- `artifacts/portal/src/App.tsx` — comparison surface for the orphaned-endpoint check
  (the current portal scaffold's real route list)

---

## 1. Wire contract — `GET /api/portal/email-auth-status`

Auth: `requireRole("Assessment")` (`:65`) — the lowest role carrying a `customerId`;
in practice any authenticated login clears this floor (`ROLE_ORDER`,
`requireAuth.ts:75-88`).

No query params, no request body. Response is one of two disjoint shapes, both under
the same `WireEmailAuthStatus` interface (`:36-43`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `checked` | `boolean` | not null | `true` once a profile row exists for this tenant+check; `false` for the not-yet-scanned state |
| `domain` | `string \| null` | nullable | `tenant_monitor_profiles.extracted_properties.domain` |
| `spfConfigured` | `boolean \| null` | nullable | `tenant_monitor_profiles.extracted_properties.spfConfigured` |
| `dmarcConfigured` | `boolean \| null` | nullable | `tenant_monitor_profiles.extracted_properties.dmarcConfigured` |
| `dkimConfiguredAtDefaultSelectors` | `boolean \| null` | nullable | `tenant_monitor_profiles.extracted_properties.dkimConfiguredAtDefaultSelectors` |
| `collectedAt` | `string \| null` (ISO) | nullable | `tenant_monitor_profiles.collected_at` |

When `checked: false`, every other field is a hardcoded `null` (`NOT_CHECKED`,
`:45-52`) — not a fallback/fixture value, a genuine "this check has never run for
this tenant" state.

### Resolution path (`:66-118`)

1. `customerId` off the JWT (`req.user.customerId`, `:55-58`). 403
   `{ error: "No customer identity on token" }` if absent (`:68-71`).
2. `tenants.id -> tenants.tenant_id` lookup (`:74-78`) — the same
   `tenants.id`-vs-`tenants.tenantId` bridge every other route on this journey uses
   (route's own header comment, `:17-20`, citing `portal-tenant-check-items.ts`).
   If no `tenants` row matches the customer's id, responds `NOT_CHECKED` (`:80-83`)
   rather than 404 — an unresolvable tenant is treated the same as "never scanned,"
   not surfaced as a distinct error.
3. Latest `tenant_monitor_profiles` row for
   `(tenant_id = tenantRow.tenantId, check_key = "exchange:dkim-spf-dmarc-status")`,
   ordered `desc(collectedAt)`, `limit(1)` (`:85-98`). No row → `NOT_CHECKED`
   (`:100-103`).
4. Field-by-field `typeof` guards on `extractedProperties` (`:106-116`) — each of
   `domain`/`spfConfigured`/`dmarcConfigured`/`dkimConfiguredAtDefaultSelectors` is
   read only if its stored type matches (`string`/`boolean`/`boolean`/`boolean`
   respectively); a malformed or missing key degrades that one field to `null`
   rather than throwing or 500ing the whole response.

500 `{ error: "Failed to load email authentication status" }` on any thrown error
(`:119-122`), logged to `logger.child({ channel: "engine.remediation-tracker" })`
(`:30`) — this route logs under the Remediation Tracker channel, not a dedicated
`email-auth` leaf, per its own header comment (`:2-3`, "sub-issue of epic #647
(Remediation Tracker)").

**Read-only, by design.** The route's own header (`:12-15`) states no DNS registrar
writes, no `New-DkimSigningConfig`/`Set-DkimSigningConfig` execution, no
ps-execution container calls — this endpoint serves customer self-service
*instructions* only; it does not remediate.

---

## 2. What produces the data — `runDnsCheck` (`exchange:dkim-spf-dmarc-status`)

Not a route this pack extracts a wire contract for (it's a monitor-executor
check, triggered by the scan pipeline, not a portal endpoint), but its shape is
what `extractedProperties` actually contains, and it carries more than the route
above forwards to the customer — real, current state worth Design knowing.

`monitor_checks` (`key = 'exchange:dkim-spf-dmarc-status'`, queried live):
`executor_type = 'dns'`, `properties = []` (no field-level projection —
`applyMapping` keeps every mapped field), and `mapping` carries **8** fields, of
which the portal route above forwards only **4**:

| `extractedProperties` field | Forwarded by `/portal/email-auth-status`? | Source (`runDnsCheck`, `monitor-executor.ts`) |
|---|---|---|
| `domain` | yes | `resolveTenantDnsDomain()` result — `tenants.domain`, or a live Graph `/organization` initial-domain fallback if unset (`:2465-2480`) |
| `spfRecord` | **no** | the actual matched `v=spf1...` TXT record string, or `null` (`:2500, 2508`) |
| `spfConfigured` | yes | `spfRecord !== null` (`:2509`) |
| `dmarcRecord` | **no** | the actual matched `v=DMARC1...` TXT record string at `_dmarc.<domain>`, or `null` (`:2501, 2510`) |
| `dmarcConfigured` | yes | `dmarcRecord !== null` (`:2511`) |
| `dkimCheckedSelectors` | **no** | `["selector1", "selector2"]` — `DKIM_DEFAULT_SELECTORS` (`:2456, 2512`), the fixed set of Microsoft 365 default DKIM selector names probed |
| `dkimFoundAtDefaultSelectors` | **no** | the subset of `dkimCheckedSelectors` where a `<selector>._domainkey.<domain>` TXT record was actually found (`:2502, 2513`) |
| `dkimConfiguredAtDefaultSelectors` | yes | `dkimFoundAtDefaultSelectors.length > 0` (`:2518`) |

**Deliberately not "DKIM is not configured."** The check's own comment (`:2514-2517`)
is explicit: `dkimConfiguredAtDefaultSelectors: false` means "not found at the two
default selectors checked," not "DKIM is absent" — a tenant on custom/rotated
selector names can have real DKIM this check cannot see. Any UI text built against
this field should preserve that distinction, not collapse it to a flat "not
configured."

**Severity classification** (`monitor_checks.severity_rules`, queried live) is a
distinct signal the portal route does not expose at all — 3 rules, all evaluated
against the same booleans the route forwards:

| Rule | Severity | Fires when |
|---|---|---|
| "No SPF record found on the domain" | `warning` | `spfConfigured == false` |
| "No DMARC record found at _dmarc.<domain>" | `warning` | `dmarcConfigured == false` |
| "No DKIM record found at Microsoft 365's default selectors (selector1/selector2) — a tenant using custom or rotated selector names may still have DKIM configured; this does not rule that out" | `info` | `dkimConfiguredAtDefaultSelectors == false` |

`classifySeverity()` returns only the *first* matching rule (`monitor-executor.ts`
mapping/severity pipeline, same mechanism documented at
`lib/db/src/schema/msp.ts:2091-2096` for this exact check) — `tenant_monitor_profiles.severityMatched`/`severityLabel`
on the underlying row carry one label even when two or three of these conditions
are simultaneously true. `/portal/email-auth-status` reads neither
`severityMatched` nor `severityLabel`; a caller of this route has to re-derive
"how many things are wrong" from the three raw booleans itself (which is exactly
what `security.emailAuthFindingCount`, §3, already does server-side for the
Security overview page).

---

## 3. Cross-surface edges

- **`security.emailAuthFindingCount`** (`lib/dashboard-registry/src/metrics.ts:686-703`,
  resolved by `resolveMonitorAggregation()`'s `"security.emailAuthFindingCount"` case,
  `dashboard-resolvers.ts:902-910`) reads the **same** `tenant_monitor_profiles` row
  this pack's route reads (same `sourceKey: "exchange:dkim-spf-dmarc-status"`), but
  through `POST /api/dashboard/resolve` rather than this route, and collapses the
  same three booleans (`spfConfigured`/`dmarcConfigured`/`dkimConfiguredAtDefaultSelectors`)
  to a single open-findings count (0–3) instead of surfacing them individually. This
  is a genuinely different shape for a genuinely different consumer, not a
  duplicate: `emailAuthFindingCount` is a scalar for a summary card, this pack's
  route is the three-boolean form the Setup Instructions page needs to tell the
  customer *which* protocol to fix.
- **`useSecEvidenceEmailLive.ts`** (`artifacts/portal/src/components/useSecEvidenceEmailLive.ts:23-28`)
  is the live consumer of `security.emailAuthFindingCount` on the current portal
  scaffold's Security evidence drill-down, and its own header comment already
  names this pack's endpoint by path (`GET /api/portal/email-auth-status`) as
  carrying "real per-tenant SPF/DKIM/DMARC booleans for the tenant's own primary
  domain," explicitly out of scope for that component's own issue (#1430) and
  deferred to "a future issue" — this pack is that future issue's groundwork.
- **`useSecAreaLinksLive.ts`** (same directory) is cited by that same comment as
  having "already proved [`security.emailAuthFindingCount`] reachable" on the
  Security overview page's "Email Security" card — i.e. the *aggregate* shape of
  this check's data is already live-wired into the current portal scaffold, even
  though the *per-protocol* shape this pack's own route serves has no caller yet
  (see Orphaned-endpoint check below).
- **`drift-check-specs.ts`** (`:269-273`): `exchange:dkim-spf-dmarc-status` is
  drift-tracked (`domainKey: "email-authentication"`, `buildEmailAuthDriftConfig`)
  — an edited SPF/DMARC record string or a vanished DKIM key at the default
  selectors surfaces as Configuration Drift (#1287) independently of this portal
  route. Both features read the same underlying check; this pack's route is a
  point-in-time snapshot, drift is the change-over-time view of the identical data.
- **The retired `artifacts/msp-portal`'s `email-auth-setup.tsx`** (confirmed via
  `git ls-tree portal-archive-2026-08-29`, the tag for the 2026-08-29 retirement
  commit `f40438cdc`) was this endpoint's original, and to date only, real
  caller. It no longer exists in the current tree. `test-manifests/copilot-readiness/email-auth-setup.json`
  (still present on disk) is a manifest written against that retired page and is
  now stale relative to the current `artifacts/portal` scaffold — noted for
  awareness, not rewritten here per #2445 Step 3 (no UI-shape decisions in this
  pack).

---

## 4. Honest-empty / partial-data contract

Three real, distinguishable states, no fixture branch anywhere in the route:

1. **Never scanned** — no matching `tenants` row, or a `tenants` row with no
   `tenant_monitor_profiles` row for this check key yet: `{ checked: false, domain:
   null, spfConfigured: null, dmarcConfigured: null,
   dkimConfiguredAtDefaultSelectors: null, collectedAt: null }` (`NOT_CHECKED`,
   `:45-52`, returned at `:81-82` and `:101-102`).
2. **Scanned, real data** — `checked: true` plus whichever of the four data
   fields actually type-checked out of `extractedProperties` (`:106-116`); a field
   that fails its `typeof` guard degrades to `null` individually rather than
   failing the whole response — e.g. a check run before `domain` was added to the
   mapping would still return real `spfConfigured`/`dmarcConfigured`/
   `dkimConfiguredAtDefaultSelectors` values with `domain: null`.
3. **Read failure** — `500 { error: "Failed to load email authentication status"
   }` (`:121`), a real 5xx a caller can distinguish from either data state above.
   No partial/silent-empty fallback on error.

No "loading" state exists server-side (as with every route in this repo's
contract-pack series) — that is a client concern.

---

## 5. Real enum unions

None. Every scannable field on this route is a plain `boolean` or `string`, not a
constrained vocabulary — `domain` is free text (an actual DNS domain name),
`checked`/`spfConfigured`/`dmarcConfigured`/`dkimConfiguredAtDefaultSelectors` are
plain booleans, `collectedAt` is an ISO timestamp string. The one bounded set in
this pack's scope is `DKIM_DEFAULT_SELECTORS = ["selector1", "selector2"]`
(`monitor-executor.ts:2456`) — a fixed, hardcoded pair (Microsoft 365's two default
DKIM selector names), not a DB-backed enum, and not itself returned by the portal
route (only its boolean derivative, `dkimConfiguredAtDefaultSelectors`, is — see §2).

---

## Orphaned-endpoint check

```
grep -rn "email-auth-status" --include=*.ts --include=*.tsx .
```

returns exactly two non-route hits outside `portal-email-auth-status.ts` itself:
the router registration (`routes/index.ts:183`) and the one comment in
`useSecEvidenceEmailLive.ts` (§3) that names this route as real but explicitly
out of scope for its own issue. **No current frontend page calls this route.**
`artifacts/portal/src/App.tsx` registers exactly one real route (`/`, confirmed
by the same App.tsx that every prior pack in this series cites) — every other
path, including a future Email Authentication Setup page, falls through to
`NotFound` today. The endpoint's only prior real caller,
`artifacts/msp-portal/src/pages/email-auth-setup.tsx`, was retired wholesale on
2026-08-29 (`f40438cdc`, tag `portal-archive-2026-08-29`) along with the rest of
`artifacts/msp-portal`. This is expected, current state per the Portal build
order (endpoints exist before Design/wire), not a gap this pack needs to close.

---

## Not covered by this pack

Per #2445 Step 3, no page/UI-shape decisions are made here. This pack extracts
what exists on the one endpoint named in #2445's own Step 1, plus the producing
check (`runDnsCheck`) and its cross-surface consumers, to the depth needed to
document the wire contract honestly. It does not decide what an Email
Authentication Setup Instructions page should look like, whether it should also
surface the raw `spfRecord`/`dmarcRecord`/`dkimCheckedSelectors`/
`dkimFoundAtDefaultSelectors` fields the route currently drops (§2), or whether
the route should be extended to forward them — that is Design's and a future
issue's call, not this pack's.
