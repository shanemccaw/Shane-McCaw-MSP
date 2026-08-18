# Monitoring: Graph read-coverage research + 3-tier package proposal

**Issue:** #1129 (part of #1128, milestone *v1.1 – Monitoring & Launch Control*)
**Status:** Research & proposal only. No schema changes, no `monitoring_package_checks`
writes, no new checks built. This is a document for Shane to react to before anything
is built or reorganized.
**All catalog numbers below were read live from the dev DB via `shaneapp://executeSql`
on 2026-08-17, not inferred from code.**

---

## 0. TL;DR — the recommendation in five sentences

1. The three "packages" the issue tells us to forget (`core:security-baseline` 23,
   `core:enhanced-monitoring` 113, `detail:full-item-collection` 132) are **not a value
   ladder** — Enhanced and Full-Item are ~90% the same set of checks differentiated only
   by whether raw per-item detail is collected, and Security-Baseline is a security-only
   scoring set, not an entry tier.
2. Propose a genuinely **nested** three-tier ladder organised by *buyer value*, not by
   collection mechanics: **Assessment (32)** → **Managed Monitoring (135)** →
   **Enhanced / Compliance & Evidence (140 + full item detail)**.
3. The Assessment tier is deliberately **cross-pillar and opinionated** (the ~32 highest-
   severity, most-explainable, universally-applicable findings across *all* seven pillars)
   — not a clone of the security-only baseline.
4. The Managed→Enhanced jump is **depth, not breadth**: Enhanced = Managed + a small set
   of compliance-grade checks + full per-item evidence collection, which is the natural
   "audit / regulated client" upsell.
5. On vertical add-on modules (Teams / SharePoint / Exchange): **do not ship them as
   priced SKUs.** Fold their content into the core tiers. Keep exactly one *optional*
   narrowly-scoped exception on the shelf — a **Teams Governance depth pack** — and only
   turn it on if real demand appears. Shane's own catalog already proves thin workload
   SKUs dilute rather than add (see §5).

---

## 1. What actually exists today (inventory)

### 1.1 Checks
- **142 active** `monitor_checks` (+2 inactive, ignored here).
- Executor mix: **125 Graph REST**, **15 PowerShell** (Exchange/Purview cmdlets via the
  ps-execution container), **1 SharePoint-admin**, **1 DNS**.
- Primary-engine (pillar) tag distribution:

  | engine tag | n | | engine tag | n |
  |---|---|---|---|---|
  | security | 51 | | copilot | 9 |
  | governance | 32 | | adoption | 7 |
  | health | 12 | | priority | 3 |
  | cost | 11 | | architecture | 2 |
  | compliance | 10 | | licensing / monitoring | 1 / 1 |
  | *(none)* | 3 | | | |

  (Scoring uses 7 *impact* axes — governance, security, compliance, adoption, copilot,
  architecture, licensing — the `engines` tag is a looser categorisation than the scoring
  pillar, so a `governance`-tagged check like `teams:*` can still be relevant to security.)

### 1.2 Packages (live `monitoring_packages` + `monitoring_package_checks`)

| package key | label | checks |
|---|---|---:|
| `detail:full-item-collection` | Full Item Detail Collection | **132** |
| `core:enhanced-monitoring` | Enhanced Monitoring | **113** |
| `assess:copilot-readiness` | Copilot Readiness Scan | **99** |
| `core:security-baseline` | Security Baseline | **23** |
| `assess:adoption-maturity` | Adoption & Change Mgmt Maturity | 5 |
| `assess:teams-governance` | Teams Governance Scan | 3 |
| `assess:license-cost-optimization` | License & Cost Optimization | 3 |
| `cat-*` (×10) | Security Posture, Config Drift, … | **0 each** |

### 1.3 Three findings that shape the proposal

- **The current "tiers" aren't a ladder.** `enhanced-monitoring` (113) and
  `full-item-collection` (132) are near-duplicates; the delta is mostly *item-detail
  collection mode*, not different checks. `security-baseline` (23) is a security-only
  scoring set. Nothing here is a clean Base→Mid→Enhanced value story — which is exactly
  why the issue says to start fresh.
- **10 `cat-*` packages hold zero checks.** They are a UI taxonomy (Security Posture,
  Configuration Drift, Operational Maturity, Usage & Adoption, Compliance & Governance,
  Executive, Intune & Devices, Identity & Access, Collaboration & Sharing, Licensing &
  Cost). Useful as *report groupings*, not as sellable packages — keep them as a display
  facet, out of the SKU conversation.
- **7 checks are orphaned** — active but assigned to *no* package, so they never run under
  any tier:
  `compliance:audit-log-retention` (carries `critical`), `exchange:auto-forwarding-rules`
  (classic exfiltration signal), `cost:unused-unassigned-licenses`, `cost:license-count-by-sku`,
  `cost:utilization-by-sku`, `onedrive:external-sharing-settings`,
  `platform:tenant-password-expiration`, `security:platform:tenant-password-expiration`.
  Several are genuinely valuable (auto-forwarding, license waste, audit retention) and the
  proposal deliberately pulls them into a tier.
- **Two severity vocabularies are mixed** across the catalog: `{critical, warning, info}`
  (most checks) and `{high, medium, low}` (e.g. `license:unused-assigned`,
  `identity:risky-signins`, `copilot:licensed-but-inactive`). Not a blocker for packaging,
  but worth normalising before tiers are marketed on severity — flag for a follow-up, not
  this issue.
- **Two checks are internal/diagnostic, not product** — `diagnostics:ps-execution-test`
  ("PowerShell Execution Path (diagnostic)") and
  `appgov:enterprise-app-registration-list` ("ShaneMcCaw Consulting App Registration").
  Excluded from every customer tier below.

---

## 2. Graph read-surface gap analysis

Method: cross-referenced every existing check's real `endpoint` (read live) against the
Graph read surface per workload, so a "gap" below is genuinely *not already hit by an
existing endpoint*. Grouped by whether it's reachable with the permissions/executors
already in use, needs the (already-built) PowerShell path, or is gated on premium
(E5/Defender/Purview) licensing → which is the natural add-on-module frontier.

### 2.1 High-value gaps, readable with the delegated/app Graph scopes already in use

- **Authentication Methods Policy** (`/policies/authenticationMethodsPolicy`) — *what's
  allowed tenant-wide*: is SMS/voice still enabled, is Authenticator number-matching on,
  is Temporary Access Pass configured, is FIDO2/passkey enabled. Today we read *registration*
  (`userRegistrationDetails`) and CA policies, never the methods policy itself. **High value.**
- **Authentication Strength policies** (`/policies/authenticationStrengthPolicies`) —
  phishing-resistant MFA strengths defined/used. Not checked.
- **Restricted SharePoint Search / Restricted Content Discovery** — the tenant-level
  oversharing brake that is *the* pre-Copilot control. Directly relevant to Copilot
  readiness; not checked at all. **High value for the Copilot story.**
- **Default user-role permissions** (the `defaultUserRolePermissions` block of
  `authorizationPolicy`) — can users register apps, create groups/tenants, what's the guest
  role. We read `authorizationPolicy` for B2B/SSPR/consent but not these sub-fields.
- **Administrative Units** (`/administrativeUnits`) — delegated-admin scoping / blast-radius.
  Not checked.
- **Entitlement Management access packages** (`/identityGovernance/entitlementManagement/…`)
  — access-package catalogs/assignments. #1118 already confirmed *no* entitlement checks
  exist; access *reviews* are covered, access *packages* are not.
- **Passwordless / phishing-resistant adoption** — registration breakdown exists
  (`mfa-method-breakdown`) but not a dedicated "% on phishing-resistant methods" signal.
- **Cross-tenant sync (B2B direct-connect / Teams shared channels partners)** — policy is
  partly covered by `cross-tenant-access`; the actual sync jobs / connected orgs are not.

### 2.2 Gaps reachable via the existing PowerShell executor (Exchange / Purview cmdlets)

- **Mailbox audit enabled** (per-mailbox `AuditEnabled`) — not checked.
- **Per-mailbox SMTP forwarding** (`ForwardingSmtpAddress`) — transport/inbox-rule
  forwarding is covered (`auto-forwarding-rules`), the mailbox-object forward is a distinct
  leak path and isn't.
- **Tenant Allow/Block List, Quarantine policies, Outbound spam policy** — MDO hygiene not
  read today; only alerts and anti-spam *policy presence*.
- **Mobile device / ActiveSync policy, MRM retention policy on mailboxes, Journaling rules,
  Room/Bookings config** — Exchange governance surface not read.
- **eDiscovery cases & holds** (`/security/cases/ediscoveryCases`) / **Information barriers**
  / **Communication compliance policies** — Purview premium governance, not read (litigation
  hold *is* read, these are adjacent and separate).

### 2.3 Intune / device gaps

- **Windows LAPS** (local admin password rotation) — not checked; high-value security signal.
- **Intune Security Baselines / configuration baseline drift** (`deviceManagement` intents/
  templates) — not checked.
- **Attack Surface Reduction rules & Defender-for-Endpoint onboarding state** — not checked.
- **Enrollment restrictions / platform restrictions**, **required-app deployment status**,
  **stale managed devices (lastSyncDateTime)** — not checked (enrollment *count* is).

### 2.4 Usage-report gaps (all same `/reports/*` surface already in use)

- **Office activations** (`getOffice365ActivationsUserDetail`), **Mailbox storage usage**
  (`getMailboxUsageDetail`), **M365 Apps version/channel** (`getM365AppUserDetail`),
  **Group activity**, **Teams device/client usage** — none checked; SharePoint/OneDrive/
  Teams/Email/Copilot usage *are*.

### 2.5 Existing checks that are proxies, not real reads (quality gap, not a coverage gap)

- `security:safe-links-coverage`, `security:safe-attachments-coverage`,
  `security:antiphishing-coverage` all hit `/security/alerts_v2` — they infer *policy
  coverage* from **alert presence**, not from the actual MDO policy objects and their
  assignment scope. Reading the real policy config (EXO PowerShell `Get-SafeLinksPolicy` /
  `Get-SafeAttachmentPolicy` / `Get-AntiPhishPolicy`, already a viable executor path) would
  make these truthful. Flagged as a **quality upgrade**, not new coverage — out of scope to
  build here, but it changes how confidently these can headline the Assessment tier.

---

## 3. Proposed 3-tier core structure

Design principles: **nested** (each tier ⊇ the one below — the natural SKU ladder and it
matches how the scoring denominator already unions run packages), **cross-pillar at every
tier**, and a **clear differentiator between each step** (opinionation, then depth).

### Tier 1 — **Assessment** (a.k.a. "Posture Snapshot") — 32 checks
- **Buyer:** a prospect / first-run. The "get in the door" scan behind the Copilot-
  readiness and security-posture sales motion.
- **Character:** *opinionated, not exhaustive.* The ~32 highest-severity, most-explainable,
  most-universal findings **across all seven pillars** — the stuff that makes a prospect say
  "I didn't know that was wide open." Fast, low request volume, safe to run unattended.
- **Why it's not the old security-baseline:** it deliberately reaches beyond identity/
  security into sharing (`sharepoint:tenant-sharing-capability`, `compliance:eeeu-site-sharing`),
  data (`compliance:missing-labels`), licensing waste (`cost:unused-unassigned-licenses`,
  `license:unused-assigned` — the "we can save you money" hook), email auth
  (`exchange:dkim-spf-dmarc-status`), exfiltration (`exchange:auto-forwarding-rules`), and
  Copilot exposure (`copilot:data-exposure-risk`). Two of those headline checks are
  *currently orphaned* and would finally run.

### Tier 2 — **Managed Monitoring** (a.k.a. "Managed") — 135 checks (32 + 103)
- **Buyer:** the recurring managed-service client. The bread-and-butter "we watch your
  tenant every day" offering.
- **Character:** *comprehensive but still aggregate.* Every check that yields an actionable
  drift/config/alert an MSP would remediate — full Intune/device posture, Exchange mail
  hygiene, governance sprawl detail, adoption trends, license optimisation, all CA/identity
  detail. Runs daily.
- **Differentiator vs T1:** breadth + cadence. T1 is a curated headline; T2 is the whole
  operational surface.

### Tier 3 — **Enhanced / Compliance & Evidence** — 140 checks (135 + 5) **+ full item detail**
- **Buyer:** regulated / audit-driven / M&A-diligence clients, and quarterly deep reviews.
- **Character:** *depth, not more different checks.* T2 **plus** (a) the compliance-grade
  checks a normal managed client doesn't need — `compliance:audit-log-retention`,
  `exchange:litigation-hold-coverage`, `compliance:dlp-incidents`, `compliance:label-errors`,
  `security:insider-risk-alerts` — and (b) **full per-item evidence collection** (the raw
  per-site / per-mailbox / per-user item lists behind every aggregate, i.e. what
  `detail:full-item-collection` does today) so findings come with defensible evidence.
- **Differentiator vs T2:** evidence + compliance surface. This is the clean "audit/regulated"
  upsell and the only tier where the heavy fan-out per-entity collection is worth the request
  cost.

**Effective sizes (nested):** T1 = 32, T2 = 135, T3 = 140 + item-detail mode. Only the 2
internal/diagnostic checks sit outside all tiers.

**Where the §2 gaps land (once built, separate phase):** §2.1 identity/sharing gaps →
mostly **T1/T2**; §2.2–2.4 hygiene/device/usage → **T2**; premium Purview/Defender gaps
(§2.2 eDiscovery/IB/comms-compliance, MDE) → **T3** or the add-on frontier (§5).

---

## 4. Full check-to-tier mapping

Every active check placed. Tiers are nested, so a T1 check also runs under T2 and T3; the
column shows the **entry tier** (lowest tier the check first appears in). Generated from the
live catalog, not hand-typed.

**Counts:** Internal 2 · Assessment (T1) 32 · Managed (T2) 103 · Enhanced-only (T3) 5.

### Entry = Tier 1 — Assessment (32)
`adoption:overall-active-rate`, `appgov:risky-permission-grants`,
`compliance:eeeu-site-sharing`, `compliance:missing-labels`, `copilot:data-exposure-risk`,
`copilot:readiness-prerequisite`, `cost:unused-unassigned-licenses`,
`devices:bitlocker-key-escrow`, `devices:compliance-policy-coverage`,
`exchange:auto-forwarding-rules`, `exchange:dkim-spf-dmarc-status`,
`governance:guest-count`, `governance:ownerless-groups`,
`governance:retention-policy-coverage`, `identity:break-glass-health`,
`identity:ca-legacy-auth-block`, `identity:ca-mfa-coverage`, `identity:ca-policy-count`,
`identity:global-admin-count`, `identity:legacy-auth-usage`, `identity:mfa-registration`,
`identity:pim-permanent-roles`, `identity:risky-users`, `identity:sspr-config`,
`license:unused-assigned`, `m365:service-health`, `security:antiphishing-coverage`,
`security:open-incidents`, `security:safe-attachments-coverage`,
`security:safe-links-coverage`, `security:secure-score`,
`sharepoint:tenant-sharing-capability`.

### Entry = Tier 3 — Enhanced only (5)
`compliance:audit-log-retention`, `compliance:dlp-incidents`, `compliance:label-errors`,
`exchange:litigation-hold-coverage`, `security:insider-risk-alerts`.

### Internal / diagnostic — no customer tier (2)
`diagnostics:ps-execution-test`, `appgov:enterprise-app-registration-list`.

### Entry = Tier 2 — Managed (103, everything else)
*adoption:* `email-activity-trend`, `planner-usage`, `sharepoint-onedrive-trend`,
`teams-activity-trend`, `viva-engage-health`, `onedrive:active-users` ·
*architecture:* `identity:hybrid-sync-health`, `platform:multi-geo-status` ·
*compliance/governance-data:* `compliance:weak-dlp-policies`,
`governance:retention-label-adoption`, `identity:terms-of-use` ·
*copilot:* `active-usage-rate`, `license-vs-total-users`, `licensed-but-inactive`,
`sensitivity-labels-exist`, `usage-activity`, `usage-by-app`, `license:copilot-assignment` ·
*cost:* `duplicate-assignments`, `entra-license-tier-distribution`,
`group-based-licensing-adoption`, `license-count-by-sku`, `underutilized-premium`,
`utilization-by-sku`, `exchange:archive-mailbox-rate`, `exchange:mailbox-quota-utilization`,
`exchange:shared-mailbox-licensing`, `onedrive:storage-utilization` ·
*governance:* `appgov:stale-app-registrations`, `exchange:distribution-list-count`,
`access-review-completion`, `auto-labeling-coverage`, `dynamic-group-usage`,
`group-expiration-policy`, `guest-access-reviews`, `guest-staleness`,
`overdue-access-reviews`, `public-groups-discoverable`, `public-teams-discoverable`,
`sensitivity-label-adoption`, `identity:b2b-collaboration-settings`,
`identity:cross-tenant-access`, `identity:stale-accounts`, `onedrive:departed-user-access`,
`onedrive:external-sharing-settings`, `platform:branding-config`,
`sharepoint:inactive-sites`, `sharepoint:site-label-coverage`, `teams:channel-sprawl`,
`teams:external-access-settings`, `teams:guest-membership`,
`teams:guest-settings-governance`, `teams:inactive-teams`, `teams:inventory-count`,
`teams:meeting-policy-coverage`, `teams:messaging-policy-coverage`, `teams:ownerless-teams` ·
*health:* `appgov:cert-secret-expiration`, `devices:autopilot-coverage`,
`devices:enrollment-status`, `devices:update-rings-config`, `onedrive:sync-errors`,
`security:secure-score-by-category`, `sharepoint:site-count`, `sharepoint:storage-near-limit`,
`sharepoint:storage-utilization`, `teams:rooms-device-health`, `teams:team-count` ·
*licensing:* `licensing:project-online-detection`, `license:sku-utilization` ·
*security:* `appgov:consent-policy-status`, `appgov:enterprise-app-count`,
`appgov:unreviewed-consents`, `appgov:workload-identity-risk`,
`devices:app-protection-coverage`, `devices:compliant-vs-noncompliant`,
`devices:encryption-status`, `devices:os-patch-compliance`,
`exchange:antispam-policy-coverage`, `exchange:connector-health`,
`exchange:mail-flow-rule-review`, `exchange:transport-rule-count`,
`identity:ca-device-compliance`, `identity:ca-report-only`,
`identity:continuous-access-evaluation`, `identity:guest-mfa-enforcement`,
`identity:mfa-method-breakdown`, `identity:named-locations`,
`identity:password-expiration-policy`, `identity:pim-eligible-roles`, `identity:pim-groups`,
`identity:risky-signins`, `identity:signin-risk-policy`, `identity:user-risk-policy`,
`platform:tenant-password-expiration`, `security:alert-count-by-severity`,
`security:automated-investigation`, `security:azure-roleDefinitions-compliance`,
`security:dlp-true-positive-rate`, `security:dlp-violations`,
`security:password-protection-policy`, `teams:app-permission-policy` ·
*misc:* `m365:message-center`.

> Judgement calls worth Shane's eye: `security:automated-investigation` and
> `security:insider-risk-alerts` are E5/premium-dependent — I placed the first in T2 and the
> second in T3; either could move. The three MDO "coverage" checks
> (`safe-links`/`safe-attachments`/`antiphishing`) are alert-proxies (§2.5) — kept in T1 for
> the headline, but they'd be stronger if upgraded to real policy reads first.

---

## 5. Vertical add-on modules — recommendation

**Question:** Teams Governance, SharePoint-specific, Exchange-specific modules layered on
top of the core tiers — worth the SKU/catalog complexity, or dilutive?

**Recommendation: don't ship workload add-on SKUs. Fold their content into the three core
tiers. Keep exactly one narrowly-scoped exception on the shelf — a *Teams Governance depth
pack* — and only enable it if real demand shows up.**

Why, concretely:

1. **Buyers don't think in Microsoft's workload boundaries.** No real client wants "Exchange
   monitoring but not identity monitoring." Splitting by workload forces the buyer to reason
   about Microsoft's internal product lines and manufactures coverage gaps ("I bought
   Security + Exchange, why isn't my Teams guest sprawl covered?"). Comparable M365-assessment
   and MSP-posture tooling overwhelmingly packages by **depth/tier and by outcome**
   (security / compliance / governance), occasionally with a single **compliance/regulatory**
   add-on — almost never one SKU per Microsoft workload.
2. **Shane's own catalog already ran this experiment and it didn't land.** `assess:teams-
   governance` (3 checks), `assess:license-cost-optimization` (3), `assess:adoption-maturity`
   (5) are exactly these thin workload/topic SKUs — 3–5 checks each. They read as curated
   *views*, not standalone value, and they dilute the core rather than extend it. That's
   direct in-catalog evidence that thin vertical SKUs don't carry weight. Recommend
   **retiring them as sellable packages** and re-expressing them as report facets (the
   `cat-*` taxonomy already exists for exactly this).
3. **SharePoint- and Exchange-specific content is mostly hygiene/config that belongs in
   Managed (T2).** Carving it out weakens the core offer and confuses positioning; there's no
   coherent buyer for "SharePoint-only" or "Exchange-only" monitoring as a product.
4. **The one defensible exception is Teams Governance — as a *depth pack*, not a tier.** Teams
   is the single workload with a coherent, deep, separable governance body (guest access,
   external federation, channel/team sprawl, app governance, meeting/messaging policy, and the
   §2 gaps: Teams Phone, shared channels / Teams Connect, app-catalog inventory, meeting-
   recording retention). Some clients — heavy-Teams or regulated — genuinely want this deeper
   than the core. Even then, position it as an **add-on depth pack layered on T2/T3**
   (extra per-item Teams evidence + the Teams-specific gap checks), **never** as something a
   client buys *instead of* a core tier. Gate the build behind demonstrated demand; do not
   build it speculatively in this milestone.

Net: three clean core tiers + a display taxonomy, with a single optional Teams depth pack
held in reserve. Maximum legibility, minimum catalog sprawl.

---

## 6. Open questions for Shane (react before build)

1. **Tier names.** Assessment / Managed / Enhanced — or your own words (Snapshot / Monitor /
   Compliance, etc.)?
2. **Tier 1 line-up.** 32 is a first cut. Anything you'd cut (too noisy for a prospect) or
   add (a headline you always lead sales with that I didn't elevate)?
3. **Orphans.** OK to adopt the 7 orphaned checks into tiers (esp. `auto-forwarding-rules`,
   `audit-log-retention`, the license-waste pair)? Or were any deliberately parked?
4. **Retire the thin `assess:*` SKUs** (teams-governance / license-cost / adoption-maturity)
   as packages and move them to the report-taxonomy facet — agree?
5. **E5/premium placement.** How opinionated should Enhanced be about premium-licensed checks
   (Insider Risk, Automated Investigation, eDiscovery, Defender-for-Endpoint) — bundle them in
   Enhanced knowing some tenants can't run them, or fence them as clearly-labelled
   "requires E5" line items?
6. **Teams depth pack** — park it on the shelf as recommended, or drop the vertical-module idea
   entirely for now?
7. **Severity normalisation** (`{critical/warning/info}` vs `{high/medium/low}`) — worth a
   follow-up issue before any tier is marketed on severity?

*Next phase after Shane reacts: write-API coverage (#1128 phase 3 → Launch Control
#1072/#1074) — explicitly out of scope here.*
