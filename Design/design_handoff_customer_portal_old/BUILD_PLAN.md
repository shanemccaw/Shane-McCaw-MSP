# Customer Portal — Build Plan

Implementation plan for `Design/design_handoff_customer_portal/` against
`artifacts/msp-portal/`. Written from the handoff README, the logic class in
`Customer Portal Shell.dc.html` (lines 6388–18121), and a full read of the
target app's routing, theme, components and data layer.

**Namespace: `/portal-v2` inside msp-portal.** Every route below is namespaced
accordingly.

> **Superseded scoping note.** An earlier revision of this plan scoped the build
> under `/monitoring`. That is stale — it predates the isolated build that is now
> real and committed under `/portal-v2` (`50fa62af`, `393afe75`). `/portal-v2` is
> the one true namespace; `/monitoring` should not reappear anywhere.

**Status: Phases 1 and 2 are built and live-verified.** The Overview and all six
pillar dashboards render real data from
`GET /api/portal/assessment/war-room-pillars` on the deployed dev server
(21/21 green, `test-manifests/portal/portal-v2-pillars.json`, commit
`393afe75`). Everything from Phase 3 onward is still proposal.

---

## 0. What the design actually is, in numbers

Measured from the logic class, not estimated:

| Thing | Count | Where in the .dc.html |
|---|---|---|
| `class Component extends DCLogic` | — | 6388–18121 |
| Flat `state` object | **144 top-level keys** | 6389–6551 |
| Handlers/methods on the class | ~60 | 6553–6879 |
| `renderVals()` return | **one flat object, ~700 keys** | 17969–18119 |
| `GOV_PAGES` drill-down fixtures | 25+ page objects | 7321–10390 |
| `EVIDENCE_PAGES` / `EVIDENCE_FIXES` | 29 fixes | ~15900–16400 |
| `fixPanelLibrary` | 8 merged libraries + 2 literals | ~16400 |
| `SOP_LIBRARY` | 17 (10 baseline, 7 authored) | ~14396 |
| `CC_SEED` change requests | 8 (`CR-2026-0168`…`0184`) | ~14949 |
| `RR_RISKS` risk register | 12 (`RSK-001`…`012`) | ~15200 |
| `HOLD_DEFS` hold windows | **4** | 7009 |
| `DOC_LIB` / `DOC_CATALOG` | 33 written of a target 80+ | 11489 / 11673 |
| Command palette index + ranking | — | 16957 |
| `HOLD_NOW` fixed clock | `2026-08-18T09:00:00Z` | 7008 (one use, 7048) |

The single most important structural fact: **the prototype is one component with
one flat state bag and one flat view-model.** Every page is a boolean flag
(`isBilling`, `isReceipt`, `isRetainer`…) computed off `state.active`. Splitting
that into routed pages is the main translation work, and it is not mechanical —
see §5.

---

## 1. Route structure

### 1.1 The base you are actually mounting under

`artifacts/msp-portal/src/App.tsx` runs **two nested wouter routers**:

- outer `<WouterRouter base="/portal">` — flat/public routes
- inner `<WouterRouter base={`/${slug}`}>` inside `SlugScope`

Effective base is **`/portal/{slug}`**. Wouter *appends* nested bases, so inside
the inner switch you write `/portal-v2`, never `/portal/{slug}/portal-v2`.
Passing the prefix again yields `/portal/portal/{slug}` and silently breaks every
match. App.tsx carries an explicit comment warning about this.

So `/portal-v2/governance` in code resolves to
`https://…/portal/{slug}/portal-v2/governance` in the browser. Deep links —
which the README flags as a round-one requirement — come free from this.

This is verified, not theoretical: the shipped routes are exactly this shape and
the live test navigates `/portal/shane-mccaw-consulting/portal-v2/governance`.

### 1.2 Route idiom to copy

The house form is the **children** form, not `component=`:

```tsx
<Route path="/portal-v2">
  <ProtectedRoute component={PortalV2OverviewPage} />
</Route>
```

`component=` appears exactly once in App.tsx, on the `<Route component={NotFound} />`
catch-all. `ProtectedRoute`'s own `component` prop is a different thing.

Route **order matters** — wouter's `Switch` takes the first match. Declare
`/portal-v2/:pillar/:area` before `/portal-v2/:pillar`, and both before
`/portal-v2`. The shipped code already relies on this: `/portal-v2` is declared
above `/portal-v2/:pillar` so the index is not swallowed by the param match.

### 1.3 Routes

**Built** ✅ / proposed.

| Route | Page component | Design key(s) | |
|---|---|---|---|
| `/portal-v2` | `portal-v2-overview.tsx` | `overview` | ✅ |
| `/portal-v2/:pillar` | `portal-v2-pillar.tsx` | `governance` … `health` (6) | ✅ |
| `/portal-v2/:pillar/:area` | `portal-v2-finding.tsx` | `governance-*`, `security-*`, `compliance-*` | |
| `/portal-v2/copilot` | `portal-v2-copilot.tsx` | `copilot` | |
| `/portal-v2/change-control` | `portal-v2-change-control.tsx` | `change-control` | |
| `/portal-v2/change-control/:crCode` | *(same page, row expand)* | `ccExpanded` | |
| `/portal-v2/runbooks` | `portal-v2-runbooks.tsx` | `operate-runbooks` | |
| `/portal-v2/runbooks/holds/:holdId` | *(same page, deep-link a hold)* | `HOLD_DEFS[].id` | |
| `/portal-v2/remediation` | `portal-v2-remediation.tsx` | `remediation` | |
| `/portal-v2/sops` | `portal-v2-sops.tsx` | `sop-hub` | |
| `/portal-v2/sops/:category` | *(same page, filtered)* | `sop-incident-response`, `sop-security-drift`, `sop-mail-flow`, `sop-device-mgmt` | |
| `/portal-v2/risk-register` | `portal-v2-risk-register.tsx` | `risk-register` | |
| `/portal-v2/microsoft-changes` | `portal-v2-ms-changes.tsx` | `ms-changes` | |
| `/portal-v2/projects` | `portal-v2-projects.tsx` | `projects` | |
| `/portal-v2/architect` | `portal-v2-architect.tsx` | `retainer` | |
| `/portal-v2/documents` | `portal-v2-documents.tsx` | `documents` | |
| `/portal-v2/documents/:docKey` | *(same page, expand-in-place)* | `docOpenKey` | |

Settings pages (`alert-preferences`, `webhooks`, `billing`, `receipt`,
`account-security`) are reached from the account menu in the design. **Do not
rebuild them** — see §3.4; they already exist outside `/portal-v2`.

`:pillar` is validated against the six-key union from `journeyTokens`, not a free
string; an unknown pillar renders `NotFound`. Verified live —
`/portal-v2/nonsense` falls through to `NotFound` rather than an empty shell.

### 1.4 The pillar-route collision — RESOLVED: supersede, but not yet

msp-portal **already routes five of the six pillars at the top level**:
`/governance`, `/compliance`, `/adoption`, `/licensing`, `/security-overview`,
plus `/architecture` (labelled "Health") and `/m365-health` (the rollup). They
are live pages with real components.

`/portal-v2/governance` is therefore a **second** governance page, deliberately.

**Decision (Shane): supersede eventually — approval-gated.** The `/portal-v2`
pages are built to full parity first, Shane reviews the finished result, and only
on his explicit say-so do the old routes get redirected and the old pages
retired.

Until that approval, the rule is absolute and applies to **every** phase below:

> **Do not touch, redirect, or delete `/governance`, `/security-overview`,
> `/m365-health`, `/compliance`, `/adoption`, `/licensing`, or their page
> components.** They stay live and completely unmodified for the whole build.
> Everything continues to go under `/portal-v2` in isolation.

Two practical consequences worth stating, because they are easy to violate by
accident:

- **`App.tsx` edits stay purely additive** — new imports and new `<Route>`
  blocks only. The Phase 1/2 commit is the precedent: +20 lines, zero existing
  routes touched, verified by reading the staged diff before committing.
- **Every phase's test manifest should keep an isolation assertion** — one step
  that loads a live old route and confirms it still renders. The shipped manifest
  does this (`U8` loads `/governance` and asserts its real content), and it is
  what turns "we didn't mean to break it" into "we proved we didn't".

The one thing that *does* legitimately reach the old pages is the app-wide
retheme (§4). That changes how they look, not what they are — see §4.1 for why
that is the intended reading of the theme decision and not a violation of this
one.

---

## 2. File structure

Built files are marked ✅ — they exist on `main` today and the names below are
the real ones, not proposals.

```
artifacts/msp-portal/src/
├── pages/
│   ├── portal-v2-overview.tsx          ✅
│   ├── portal-v2-pillar.tsx            ✅
│   ├── portal-v2-finding.tsx
│   ├── portal-v2-copilot.tsx
│   ├── portal-v2-documents.tsx
│   ├── portal-v2-change-control.tsx
│   ├── portal-v2-runbooks.tsx
│   ├── portal-v2-remediation.tsx
│   ├── portal-v2-sops.tsx
│   ├── portal-v2-risk-register.tsx
│   ├── portal-v2-ms-changes.tsx
│   ├── portal-v2-projects.tsx
│   └── portal-v2-architect.tsx
│
├── components/portal-v2/
│   ├── PortalV2Shell.tsx               ✅ own chrome + pillar nav, NOT AppShell
│   ├── PortalV2Pieces.tsx              ✅ Panel/ScoreBlock/StatCallout/FindingRow/TrendLine
│   ├── portalV2Model.ts                ✅ wire types + view model, no scoring
│   ├── usePortalV2Pillars.ts           ✅ the one data seam
│   ├── portal-v2.css                   ✅ (folds into index.css — see §4)
│   ├── drilldown/
│   │   ├── ProvenanceBlock.tsx        # Graph endpoint / what was read / when
│   │   ├── EvidenceTable.tsx          # expandable rows, pager, filter
│   │   ├── PolicyBlock.tsx
│   │   └── StatCardRow.tsx
│   ├── fix/
│   │   ├── FixPanel.tsx               # Sheet: choose → cr steps
│   │   ├── FixCrStep.tsx
│   │   └── fixPanelLibrary.ts         # merged fix catalogue
│   ├── holds/
│   │   ├── HoldCard.tsx
│   │   ├── HoldTrack.tsx              # day-tick track + T-minus readout
│   │   ├── useHoldWindows.ts          # REAL clock + interval re-derive
│   │   └── holdState.ts               # pure derivation, unit-testable
│   ├── documents/
│   │   ├── DocumentRow.tsx
│   │   ├── DocumentExpanded.tsx
│   │   ├── DocumentCover.tsx          # generated SVG/CSS cover + spine
│   │   ├── DocumentFilterSheet.tsx
│   │   └── useDocumentFacets.ts       # counts exclude own group
│   ├── palette/
│   │   └── portalV2PaletteIndex.ts    # feeds the EXISTING command palette
│   ├── shanebot/
│   │   ├── SelectionChip.tsx          # Phase 7a
│   │   └── ShaneBotPanel.tsx          # Phase 7a
│   └── forms/
│       └── FormDrawer.tsx             # the one openForm() primitive
│
└── lib/portal-v2/
    ├── fixtures/                      # ← the single swappable fixture layer
    │   ├── index.ts                   # one export surface; swap here for live
    │   ├── holds.ts                   # HOLD_DEFS
    │   ├── documents.ts               # DOC_LIB + DOC_CATALOG
    │   ├── changeRequests.ts          # CC_SEED
    │   ├── risks.ts                   # RR_RISKS
    │   ├── sops.ts                    # SOP_LIBRARY
    │   └── pillars.ts                 # per-pillar scores/trends/findings
    ├── types.ts                       # shared shapes
    └── usePortalV2Data.ts             # the seam: fixture ⟷ API
```

**Naming follows the house conventions**, verified against the repo: pages are
`src/pages/<kebab-name>.tsx` with `export default function XxxPage()` (115 of 121
do this); feature components are `PascalCase.tsx`; logic/hooks are `camelCase.ts`;
folders are kebab-case; `ui/**` is all lowercase-kebab.

### The fixture seam (a stated requirement)

CLAUDE.md requires: *"Every number on screen comes from the data layer. Never
hardcode a tenant number in a component — put the fixture in one place so it can
be swapped for real data."*

The repo has a **house mock pattern** (`components/{feature}/mockData.ts`, 11
files) but **no swappable seam** — no `USE_MOCK`, no `VITE_MOCK`, no `isDemo`
flag anywhere. Mocks are seeded straight into `useState`, and when a page goes
live the import is deleted; 4 of the 11 `mockData.ts` files are already orphaned
dead code from exactly that.

So the seam has to be invented. `lib/portal-v2/fixtures/index.ts` +
`usePortalV2Data.ts` is that seam: components consume the hook only, never a
fixture module directly, and the hook is the one file that flips from fixture to
`fetchWithAuth`. That satisfies the rule and avoids the orphaning failure mode.

**The shipped pillar pages already follow this and needed no fixture at all** —
`usePortalV2Pillars.ts` is the seam, and it wraps the real endpoint directly. The
fixture layer above is only for the systems whose backend does not exist yet
(holds, documents), so it should shrink as those get real routes, not grow.

**Leak guard:** `components/copilot-journey/liveReportFixtures.ts` exports
`FIXTURE_LEAKS`, a list of fictional names that **5 test files assert never
appear in live output**. "Halden Materials" is a new fictional tenant — it must be
added to that list, or it will eventually ship into a real customer's report.

---

## 3. Reuse vs. create

### 3.1 Reuse as-is

| Need | Use | Note |
|---|---|---|
| Page chrome | `AppShell` (`components/app-shell.tsx`) | `{ children, title, actions }`. 87 of 116 pages use it. Pages wrap themselves — there is **no** route-level layout. |
| Score rings | **`ui/score-ring.tsx`** | Already exists: `value`, `color: blue\|red\|amber\|green\|violet`, `size`, `strokeWidth`, `label`. Token-driven. |
| Right slide-outs | **`ui/sheet.tsx`** | `side` defaults to `right`, 7 real users. |
| ⌘K palette | `components/command-palette.tsx` | Already server-backed via `/api/portal/customer/search`. |
| Toasts | `import { toast } from "sonner"` | `<Toaster richColors position="top-right" />` mounted at App.tsx:1122. |
| Tables | `ui/table.tsx` + `useMemo` sort | House tri-state sort pattern is in `pages/customers.tsx`. |
| Loading | `ui/skeleton.tsx` (62 files) / `Loader2` (82 files) | Ladder is loading → empty → content. |
| Class merge | `cn` from `@/lib/utils` | **Not** the duplicate in `components/msp-portal/utils.ts`. |
| Icons | `lucide-react` | House sizing is `size-N` (1226 uses), not `h-4 w-4`. |
| Pillar tokens | **`components/copilot-journey/journeyTokens.ts`** | See §3.2 — this is the anchor. |
| Stat tiles | `components/health-suite/MetricGrid.tsx` | Clean, token-based. |
| Gantt | `buildGanttLayout` + `PhaseGanttChart` in `copilot-journey/StatementOfWorkBody.tsx:299-450` | The real implementation. |
| Webhooks page | `pages/webhooks.tsx` (705 lines) | Complete and live — CRUD, secret rotate, delivery log, retry. Ship as-is. |
| Billing/receipt | `pages/customer-billing.tsx` + `components/billing/*` | Already declares a `StripeReceipt` type. |

### 3.2 The pillar taxonomy is already solved — use it

This was the biggest open risk and it resolves cleanly.

`components/copilot-journey/journeyTokens.ts:60` defines `PILLAR_KEYS` as
**governance, security, compliance, licensing, adoption, health** — *exactly* the
design's six — carrying the README's exact hex values (`#3B82F6`, `#8B5CF6`,
`#F3F4F6`, `#14B8A6`, `#F97316`, `#22C55E`). Do not invent a new pillar list.

Three rules that must not be broken:

- **Never add `"security"` to `HEALTH_PILLARS`** (`api-server/src/lib/health-engine.ts:53`).
  It holds six *backend* keys — governance, compliance, adoption, copilot,
  architecture, licensing. Security is excluded *because it is scored by a
  separate engine* (`security-engine.ts`) and recombined one level up in
  `calculateArchitectureHealthScore`. Adding it double-counts the score.
- **Backend `architecture` displays as "Health"** (Git #1098, Shane-signed-off).
  Same pillar, different label. Mapping lives in `war-room-pillar-stats.ts`
  (`RADAR_PILLAR_BY_RULE_PILLAR`) and `PillarGrid.tsx` (`PILLAR_UNIVERSE`). Do
  not rename the backend key or add a seventh pillar.
- **Copilot is not a health pillar** on the customer report — it is tracked
  separately and filtered out of the radar in `HeroHealthScore.tsx:64-70`. The
  design agrees: Copilot is its own nav section, not a pillar tile.

The Copilot gate **82** is a real constant in two files that cannot import each
other — `api-server/src/lib/copilot-gate.ts:66` (`COPILOT_GATE_THRESHOLD`) and
msp-portal `journeyTokens.ts:269` (`COPILOT_GATE_TARGET`) — each with its own test
asserting the value. The design's "41 of 82" is this constant. Change one, change
and re-test both.

### 3.3 Build new

| System | Why new |
|---|---|
| **Hold windows** (all of it) | The only design system with **zero** existing implementation. Repo-wide grep for `hold window` / `HOLD_DEFS` / `hold_window` hits only the design files. |
| **Portal v2 sidebar IA** | The design's grouped nav (Overview / My Architect / Projects / Pillars / Copilot / Operate / Standards & risk / Library) does not match `NAV_SECTIONS`. `PortalV2Shell` owns its own nav rather than bending the global one. Built ✅ with Overview + the six pillars only; the remaining groups get added as their phases land, never as dead rows. |
| **Drill-down template** | `assessment-modules/*` render only a score bar + findings list + recommendations. No provenance, sparklines, evidence table, policy block or playbook links. Not the design's template. |
| **Structured provenance block** | The data is all there (`monitor_checks.endpoint`, `tenant_monitor_profiles.collectedAt`, `tenant_check_item_details.items`) but is currently rendered as a **prose sentence** via `buildProvenance()` in `liveReportBlocks.ts:1129`. |
| **Document library** | No price/ownership/facet/freshness model exists. See §5.4. |
| **Retainer hours ledger** | Grep for `retainerHours`/`hoursRemaining`/`hoursUsed` returns **zero** hits. `portal-retainer-billing.ts` only switches monthly/yearly Stripe intervals. Greenfield. |
| **`FormDrawer`** primitive | The one `openForm({ kicker, title, intro, submitLabel, fields[], doneNote })` that drives every form. Nothing equivalent exists. |
| **Selection chip / ShaneBot Active Cards** | See §5.6. |
| **Customer-scoped CR / SOP / risk / MS-changes routes** | See §3.5. |

### 3.4 Do **not** rebuild

The design lists five settings pages. Four already exist and are live:
`webhooks`, customer billing + receipt, account security, notification
preferences. Reach them from the account menu as the design does; do not clone
them into `/portal-v2`.

`ai-billing.tsx` is **AI-credit metering for an MSP** (token usage, top-ups,
ledger) — *not* the design's customer billing page. Easy and costly to confuse.

### 3.5 Exists, but MSP-only — needs new customer-scoped routes

Change Control, SOPs & Runbooks, Risk Register and Microsoft Changes all exist —
but only as **MSP-operator** surfaces (`components/msp-portal/views/*Console.tsx`
plus `/api/msp/*` routes gated by `requireRole('MSPOperator')` and
`resolveMspIdStrict`). There is **no customer-facing route for any of them**.

Reusing an MSP endpoint from a customer page would **leak other tenants' data**.
Each needs a new customer-scoped route with `requireRole('CustomerUser')` and
`customerId`-from-JWT scoping.

The schema is largely already right, which is the good news:

- `msp_change_requests` (`lib/db/src/schema/msp.ts:3221`) already carries
  `preChangeSnapshot` jsonb, `proposedPayload` jsonb, `rollbackScriptSnippet`,
  `changeClass`/`riskLevel`/`category` enums and a 6-value status — the design's
  CR pre/post diff and rollback, already modelled.
- `msp_risk_decisions` (`msp.ts:3350`) already carries `expirationDate`,
  `clientApprover{name,title,email,signedAt,ipAddress,signatureHash}`,
  `graphEndpoint`, `compensatingControls[]` — the design's risk register
  owner/review-date/expiry.
- Remediation is the deepest overlap: `remediation_knowledge_base` (`msp.ts:3459`),
  `remediation_tracker_steps` (`msp.ts:3613`), and `remediation-tracker-pricing.ts`
  which **ports the design file's own `PILLAR_FEE`/`PHASE_PILLARS`/`phaseReady`
  logic verbatim** (Phase 1 gov+sec, Phase 2 comp+lic, Phase 3 adopt+health).

Careful — two components are **mock-only** despite their size:
`M365MessageCenterConsole.tsx` (1,162 lines, `// Mock Announcements Database`,
zero API calls) and `WebhooksConsole.tsx` (2,056 lines). Do not mistake line
count for a working feature. `StandardOperatingProceduresConsole`,
`RiskBasedDecisionConsole` and `ChangeManagementConsole` *are* live-wired.

### 3.6 Components to avoid copying

Several feature folders are near-verbatim design imports and are **not** house
style: `components/msp-portal/`, `components/msp-tenants/`,
`components/assessment-test/`, and `components/m365-health/Header.tsx`. They use
hardcoded hex (`#101419`, `#404752`, `#479ef5`), some carry `// @ts-nocheck`, and
they reference CSS classes that **do not exist** in `index.css` (`glass-dark`,
`sparkline`, `sparkline-bar`). `m365-health/Header.tsx` still renders
`OBSIDIAN METRIC v4.2.1` with three mock tenant names. Copying from these
produces broken, off-token UI.

Also: **`ScoreRing` is duplicated at least 11 times** across the app. Use
`ui/score-ring.tsx`. Do not add a twelfth.

And `ui/sidebar.tsx` exists in full (23 exports) with **zero importers** — the
real sidebar is hand-rolled in `app-shell.tsx`. Adopting it means running two
competing sidebar systems that both bind global shortcuts (`ui/sidebar` → ⌘B,
`AppShell` → ⌘K). Don't.

---

## 4. Design tokens → repo theme

### 4.1 How the repo's theme actually works

- Tailwind **v4**, CSS-first. **No `tailwind.config.js` anywhere.** Config is
  `@theme inline` in `src/index.css` (lines 14–112), via `@tailwindcss/vite`.
- Colour space is **raw space-separated HSL triplets** (`--background: 0 0% 98%`),
  consumed as `hsl(var(--token))`. Zero `oklch`.
- **Bare `:root` is LIGHT** — `index.css:130` literally comments `/* LIGHT MODE */`.
  `.dark` (line 239) redeclares the same names. Class-based via
  `@custom-variant dark (&:is(.dark *))`, not `prefers-color-scheme`.
  *(Note: this is the opposite of the marketing site, where bare `:root` is dark.)*
- Theme provider is **hand-rolled** at `src/lib/theme-context.tsx`, mounted in
  App.tsx:1114, persisted per account via `GET/PUT /api/portal/theme-preference`.
  `next-themes` is a dependency but **has no provider mounted** — only
  `ui/sonner.tsx` imports it, and that file is dead code.
- shadcn: style `new-york`, baseColor **`neutral`**, `cssVariables: true`.

**Every new colour token needs TWO edits:** the raw triplet on both `:root` and
`.dark`, *and* a `--color-<name>: hsl(var(--<name>))` line inside `@theme inline`.
Without the second, no `bg-*`/`text-*` utility is emitted at all.

### 4.2 The palette conflict — read this before touching tokens

The handoff README specs the portal canvas as `#020617` / `#0b1524` (slate) with
Electric Blue `#0078D4`. The bundled `_ds/tokens/colors.css` specs Deep Navy
`#0A2540` with the same Electric Blue.

**msp-portal is neither.** Its real palette is **Fluent 2 neutral**, and
`index.css` says so twice in comments — *"Neutral gray background — #1a1a1a, not
navy"*, *"Neutral off-white background (not blue-white)"*:

| | Design README | `_ds/` bundle | **msp-portal (real)** |
|---|---|---|---|
| Dark canvas | `#020617` slate | `213 74% 10%` navy | **`0 0% 10.2%` = `#1a1a1a` neutral** |
| Dark panel/card | `#0b1524` | `213 60% 13%` | **`0 0% 14.1%` = `#242424`** |
| Primary | `#0078D4` | `#0078D4` | **`212 87% 64%` = `#479ef5`** |
| Default mode | dark only | light default | **light default** |
| Sans | Inter only | Inter only | **`'Segoe UI', 'Inter', system-ui`** |
| Mono | `SF Mono`/Menlo/Consolas | Menlo | **`IBM Plex Mono`** |
| Radius | 5–7 / 9–12 / 14px | 6px | **4 / 6 / 8px** |

The `_ds/` bundle's own readme says it was built by reading
`artifacts/msp-portal/src/index.css` — **but the portal has since migrated to
Fluent 2 neutral. The bundled design system is stale relative to the repo.**

Three further traps:

- **Do not `@import` `_ds/tokens/colors.css`.** It redeclares
  `--background`/`--foreground`/`--primary`/`--accent`/`--sidebar`/`--chart-*` on
  bare `:root` with navy values at equal specificity and later source order — it
  would silently repaint the entire portal navy — and it omits every `--status-*`
  token the app's components consume. `journeyTokens.ts:5-25` documents this as a
  settled decision.
- `--app-font-sans` puts **`'Segoe UI'` before `'Inter'`**, so on Windows (Shane's
  machine, and most customers) **Inter never renders** despite being loaded.
- Inter is loaded at weights **400;500;600;700 only**. The design uses **800** for
  headlines — today any `font-extrabold` is browser-synthesised. `IBM Plex Mono`
  is referenced but **never loaded at all**, so `font-mono` silently falls back to
  generic monospace — and the design puts *every number, score, timer and date* in
  mono.

### 4.3 The mapping — RESOLVED: app-wide retheme

**Decision (Shane): retheme the app globally to the design's navy/slate palette.
This IS the new portal — not a themed section living beside the old Fluent 2
neutral pages.** The `.pv2-root` scoped theme built in Phase 1 was the
provisional answer and is superseded; its values move onto the app's own tokens
in `index.css`.

Read this together with §1.4: the old pillar *routes and page components* stay
untouched, but they will **inherit the new palette**, because that is what
app-wide means. Changing how a page looks is not the same as changing what it is,
and the decision is explicit that the old pages must not stay Fluent 2 neutral.

**The honest caveat, and it is a real one.** A token retheme only moves the parts
of the app that actually read tokens. This repo has a large amount of hardcoded
colour that will *not* follow:

- **1163 hardcoded `#0078D4` arbitrary-value class usages across 91 files.**
- Whole feature folders written against literal hex rather than tokens —
  `components/msp-portal/`, `components/msp-tenants/`, `components/assessment-test/`,
  `components/m365-health/Header.tsx` (`#101419`, `#404752`, `#479ef5`, some with
  `// @ts-nocheck`, some referencing CSS classes that do not exist).
- `components/copilot-journey/` (87 files) is deliberately inline-style and reads
  `journeyTokens` directly — it is *already* on the target palette, so it needs no
  change, but it also will not respond to token edits.

So the retheme lands in two parts, and the second is the long tail:

1. **Tokens** (small, mechanical, reversible): rewrite the `:root` and `.dark`
   colour blocks in `index.css`. Everything token-driven — shadcn primitives,
   `ScoreRing`, cards, borders — moves in one commit.
2. **Hardcoded-hex sweep** (large, per-file, ongoing): replace literal hex with
   tokens, folder by folder. This is not a prerequisite for `/portal-v2` and
   should not block it; it is the debt the retheme makes visible.

Between (1) and (2) the app will look **partly rethemed**. That is expected and
should be stated plainly rather than discovered — pages that were already
token-clean will look right immediately; the folders listed above will look wrong
until swept.

| Design token | Map to | Action |
|---|---|---|
| canvas `#020617` | `--background` (`.dark`) | **retheme app-wide** |
| panel `#0b1524` | `--card` / `--popover` (`.dark`) | **retheme app-wide** |
| input `#0b1a2e` | `--input` surface (`.dark`) | **retheme app-wide** |
| border `rgba(30,41,59,.9)` | `--border` (`.dark`) | **retheme app-wide** |
| sidebar `#0b1524` | `--sidebar` + `--sidebar-*` (`.dark`) | **retheme app-wide** |
| Governance `#3B82F6`/`#60a5fa` | `PILLAR_KEYS` colours in `journeyTokens.ts` | **already exact** |
| Security `#8B5CF6`/`#a78bfa` | ditto | already exact |
| Compliance `#F3F4F6`/`#cbd5e1` | ditto | already exact |
| Licensing `#14B8A6`/`#2dd4bf` | ditto | already exact |
| Adoption `#F97316`/`#fb923c` | ditto | already exact |
| Health `#22C55E`/`#4ade80` | ditto | already exact |
| red `#f87171` | `--status-red` | **retheme** — repo value is more muted |
| amber `#fbbf24` | `--status-amber` | **retheme** — repo value is more muted |
| green `#34d399` | `--status-green` | **retheme** |
| info `#60a5fa` | `--status-blue` | **retheme** |
| teal `#22d3ee` | `--status-teal` | **retheme** |
| Governance `#3B82F6`/`#60a5fa` | `PILLARS` in `journeyTokens.ts` | **already exact — do not duplicate** |
| Security `#8B5CF6`/`#a78bfa` | ditto | already exact |
| Compliance `#F3F4F6`/`#cbd5e1` | ditto | already exact |
| Licensing `#14B8A6`/`#2dd4bf` | ditto | already exact |
| Adoption `#F97316`/`#fb923c` | ditto | already exact |
| Health `#22C55E`/`#4ade80` | ditto | already exact |
| Inter 400–800 | `--app-font-sans` | reorder Inter first **+ add `;800`** to the Google Fonts URL |
| `SF Mono`… | `--app-font-mono` | either load IBM Plex Mono or switch the stack |
| radius 5–7 / 9–12 / 14 | `--radius-control/card/large` | repo is 4/6/8 |

Pillar identity colours stay in `journeyTokens.ts` and are **not** promoted to CSS
tokens. They are a fixed identity axis that must never be severity-driven, and
they are already consumed correctly by both `copilot-journey` and `/portal-v2`.
Copying them into `index.css` would create a second source that can drift.

There is **no `--success` and no `--warning`** token in msp-portal; semantics run
through `--destructive` plus the six `--status-*`. And there is no
`status-orange`/`pink`/`cyan` — anything else must be added to `@theme` first.

**Every colour token needs TWO edits**: the raw HSL triplet on `:root` *and*
`.dark`, plus a `--color-<name>: hsl(var(--<name>))` line inside `@theme inline`.
Without the second, no `bg-*`/`text-*` utility is emitted at all.

The living style guide at `pages/dev-style-guide.tsx` renders every token,
variant, `ScoreRing` and card — it is the fastest way to eyeball the retheme, and
should be the first page checked after the token commit.

**Light mode.** msp-portal is light-default with a real per-account toggle
(`lib/theme-context.tsx`, persisted via `/api/portal/theme-preference`). The
design is dark-only, so it says nothing about light. The retheme therefore moves
`.dark` onto the design's slate canvas and moves `:root` onto the brand's own
light values (Off-White `#F7F9FC` + navy ink, per `_ds`), rather than stranding
light mode on Fluent 2 neutral or deleting a feature the design simply did not
cover. If Shane would rather the portal be dark-only, that is a smaller change
than this one and can follow.

---

## 5. Conflicts with the README

Ordered by severity. Each is evidenced against a real file.

### 5.1 ~~BLOCKER~~ RESOLVED — the design's palette is not this app's palette

Covered in §4.2. The README presents its hexes as *the* spec and the `_ds/`
bundle claims to be derived from this repo, but msp-portal is Fluent 2 neutral,
light-default. Recreating the design literally is a wholesale visual redesign of
the portal, not a token addition.

**Resolved (Shane): app-wide retheme to the design's navy/slate palette.** The
design's palette wins; Fluent 2 neutral is the *old* palette being replaced and is
no longer a reference for anything new. See §4.3 for the mapping and for the
hardcoded-hex long tail this makes visible.

Note the `_ds/` bundle is still stale in the other direction — it resolves the
portal to Deep Navy `#0A2540`, while the handoff and the shipped build use slate
`#020617`. Where they disagree, the handoff README and `journeyTokens.ts` win.

### 5.2 BLOCKER — the document library has no data model

The README's system #4 assumes per-document `price`, `owned`, `availability`,
facets, cart and freshness state. **None of that exists.** Documents in this repo
are *generated deliverables*: there is no price/ownership field on any document
table, and purchase runs through `services` + `portal-marketplace.ts` +
`portal-checkout.ts`. Building the library means **new schema**, which per
CLAUDE.md means hand-written SQL in `lib/db/migrations/manual/` for Shane to run —
not `drizzle-kit push`.

Also: `LIVE_RENDERED_DOC_TYPES` (`portal-documents.ts:30`) names 7 doc types that
render client-side and are deliberately **refused** as server HTML, because stale
rows diverge from what renders. Any new document-serving path must respect that.

The README already concedes ~51 of the 80+ documents have no content written.

### 5.3 SIGNIFICANT — "no router" vs. 122 existing routes

The README flags routing as out of scope. In practice this is the largest single
translation cost: **144 flat state keys and a ~700-key flat view-model** must be
split into routed pages. Triage each key as URL state / client state / server
state. `active` becomes the route. `docOpenKey`, `ccExpanded`, `fixPanelKey` and
the hold id become **route params or search params** so the README's deep-link
requirement is actually met. Pagers, filters and search boxes are search params.
`sbOpen`, `askX/askY`, drawer open flags stay client state.

Note also **no code splitting exists** — App.tsx eagerly imports all ~121 pages.
Adding 13 pages grows the single bundle for every user. Introducing `React.lazy`
would be a first-of-its-kind change here, worth doing but worth naming.

### 5.4 SIGNIFICANT — pick a data-fetching idiom, explicitly

The repo points two ways at once. React Query is mounted (`retry: 1`,
`staleTime: 30_000`) but has **2 real call sites and zero `useMutation`**, versus
**140 files** using `fetchWithAuth` + `useEffect`/`useState`. "Follow the house
pattern" and "use the installed libraries" give opposite answers.

**Recommendation: `fetchWithAuth`**, matching the 140. Its contract has sharp
edges to respect:

- returns a **raw `Response`** — never throws, never parses. Every caller does its
  own `if (!res.ok)` and `await res.json()`.
- **globally toasts every non-OK, non-401 response** unless you pass
  `{ silent: true }` as the third arg. Adding your own catch→toast double-toasts.
- is **rebuilt on every token refresh** (13-min silent refresh). Putting it in a
  `useEffect` dep array tears down polling loops mid-flight — every existing
  polling hook holds it in a `useRef`. Copy that, which matters directly for the
  hold-window interval.

Two shell-wide polling contexts already exist and should be reused rather than
duplicated: `ScanStatusProvider` (`useScanStatus`, 10s idle / 3s active) and
`ShellStatusProvider` (`useShellStatus`, 5-min poll).

Do **not** introduce an absolute API base — there is no `VITE_API_URL` and no
vite proxy; Replit's path router puts `/portal/*` and `/api/*` on one origin.
Always emit relative `/api/...`.

`@workspace/api-client-react` is **not** a shortcut: its spec covers 11 paths and
**none** of the ~105 `/api/portal/*` endpoints. Worse, `setAuthTokenGetter()` is
never called in msp-portal, so any generated hook fires unauthenticated and 401s.

### 5.5 SIGNIFICANT — hold-window derivation has real bugs to fix, not port

The README says to use the real clock and re-derive on an interval. Beyond that,
the prototype's own state machine has defects found in the logic class:

- **`closing` is unreachable when `scanVerdict` is `clear`.** The ternary tests
  `clear ? 'early' : hoursLeft <= 24 ? 'closing'`, so a clear hold with 3 hours
  left still reads "Can close early", never "closes tomorrow".
- **`early` has no proximity requirement** — `hold-guest` shows "Can close early"
  with **217 hours (T-10d)** remaining, and the button reads "Close the window 10
  days early".
- **"closes tomorrow" is asserted purely from `hoursLeft <= 24`** — at 23:30 UTC a
  20-hour remainder closes *today*. Same wording is reused verbatim in the tray.
- `badge` and `tMinus` use **different thresholds** (24h vs 48h), so a hold at 30
  hours shows an inconsistent pair.
- `HOLD_DEFS.c` (`#a78bfa`/`#60a5fa`) is **never read** — card colour comes
  entirely from `tone`. Dead field.

These need decisions, not transcription. The alerting contract (T-24, T-0, and
early-clear) also has no existing channel wired — that is real backend work.

### 5.6 ~~SIGNIFICANT~~ RESOLVED (split across two phases) — ShaneBot's card taxonomy doesn't match

ShaneBot exists server-side: `lib/shanebot-engine.ts`,
`BOT_INSTANCES.shanebot_paid`, with `allowedCardTypes` of
`['invoice','subscription','score','data-answer']`. The design specifies
`finding | fix | datum | ticket | escalate`. Only `datum`≈`data-answer` overlaps.
Escalation is fine: `enqueueEscalationTicket` → Zoho Desk already matches the
design.

**Resolved (Shane): do both, in that order, split across two phases.**

- **Phase 7a — basic wire-in.** Connect only what exists *today*: the real
  engine, the real Zoho Desk escalation path, and the four card types the engine
  already supports. **Do not extend the taxonomy in this phase.** The point is to
  get something real and testable in front of a user.
- **Phase 9 — full upgrade.** Extend the taxonomy to the design's five cards,
  plus whatever falls out of actually using 7a.

The reasoning is worth preserving because it shapes how 7a should be built:
**ShaneBot has never been exercised end-to-end by Shane.** Extending a taxonomy
before anyone has used the thing would be designing against assumptions. Expect
7a to generate real findings, and treat Phase 9's scope as partly unknown until
it does — it is a placeholder for "what we learn", not a fixed spec.

### 5.7 MINOR — component primitives that fight the spec

- **`ui/drawer.tsx` (vaul) is hardcoded bottom-anchored** (`fixed inset-x-0
  bottom-0 … rounded-t-[10px]`, grab handle) with **no `side`/`direction` prop.**
  The design's right slide-outs **must** use `ui/sheet.tsx`.
- `ui/popover.tsx`, `ui/accordion.tsx`, `ui/empty.tsx`, `ui/sonner.tsx` all exist
  with **zero importers** — they compile but have never rendered in this app.
  Treat first use as new, unverified surface.
- `ui/*` contains **mixed shadcn vintages** — `ui/sidebar.tsx` is the newer
  Tailwind-v4 generation (`data-slot`, `w-8!`) while `ui/sheet.tsx`,
  `ui/dialog.tsx`, `ui/command.tsx` beside it are the older forwardRef
  generation. Don't assume a file matches the docs you remember.
- `ui/table.tsx` is the **old** generation (`TableHead h-10 px-2`, `TableCell p-2`)
  — tighter than current shadcn. The design's dense rows (11px × 20–26px) will
  need explicit padding.
- **`framer-motion` is declared but imported zero times** repo-wide. The design's
  motion spec (150–300ms `transition-colors`/`transition-all`, rotating chevrons)
  maps cleanly onto Tailwind + `tw-animate-css`, which is what the repo does.
  Reaching for framer-motion introduces a new pattern rather than following one.
- The design's z-index ladder (80 / 124 / 125 / 200 / 201) must be checked against
  Radix's own portal/overlay stacking rather than assumed.

### 5.8 MINOR — icon names

The README claims its icon names map 1:1 to `lucide-react`. Mostly true, but
verify at build time: `lucide-react` exports PascalCase (`ShieldCheck`,
`GitCommit`, `PanelLeft`), and a few README names need care —
`play-circle` is `PlayCircle` (deprecated alias of `CirclePlay` in recent
versions), and `shield-off` / `life-buoy` (`LifeBuoy`) have both kebab and
renamed forms across versions. Pin the check to the installed version rather
than trusting the list.

### 5.9 Standing project rules this build must satisfy

- **No emoji, ever** — matches the design and the repo's own voice guide.
- **No hardcoded prices, tier names or seat counts in `.tsx`** outside API
  response handling (grep-verifiable). This directly constrains "1,240 seats" and
  "41 of 82" — they must flow through the data layer.
  `remediation-tracker-pricing.ts` is the correct precedent: fees live in an
  api-server lib, not a component.
- **Logging**: any new route wires a `logger.child({ channel })` binding from the
  locked taxonomy. `engine.dashboard` is the closest existing leaf; a new
  `engine.portal-v2` leaf may be justified.
- **Test manifests** are mandatory for msp-portal changes:
  `test-manifests/{area}/{feature-slug}.json`, registered in
  `_regression-suite.json`, and actually **run** via `shaneapp://runTest` in the
  same session. Note `runTest` hits the **deployed** build, so these need a deploy
  first. Discover before creating — search by route/feature, not issue number.
- **Schema changes** are hand-written SQL under `lib/db/migrations/manual/` with
  the trailing `simulator_migration_runs` self-marking INSERT. Never
  `drizzle-kit push`.

---

## 6. Build order

Sequenced so each phase is independently shippable and the risky decisions land
before anything expensive is built on them.

### Phase 0 — Decisions ✅ RESOLVED

All five are settled. They are recorded here as the standing basis for every
phase below; none is an open question any more.

1. **Namespace** — `/portal-v2`. The earlier `/monitoring` scoping is stale and
   must not reappear. (§1)
2. **Theme** — **app-wide retheme** to the design's navy/slate palette. Not a
   scoped section theme. (§4.3, §5.1)
3. **Pillar route collision** — **supersede eventually, approval-gated.** Build
   `/portal-v2` to full parity, Shane reviews, and only then do the old routes
   get redirected. Until then the old routes and page components are untouched.
   (§1.4)
4. **Document library** — confirmed **last** (Phase 8). It is the only system
   needing new schema. (§5.2)
5. **ShaneBot** — **split.** Phase 7a wires in only what exists today; the full
   taxonomy upgrade becomes the final phase. (§5.6)

Two smaller ones already settled in code by the Phase 1/2 build:

6. **`fetchWithAuth` over React Query**, matching the 140 files that use it. (§5.4)
7. **Reuse `ScoreRing`**, don't fork it — token scoping makes it render correctly
   on the new palette. (§3.1)

### Phase 1 — Shell and spine ✅ BUILT

`PortalV2Shell` (own chrome, deliberately not `AppShell`) + the `/portal-v2` and
`/portal-v2/:pillar` routes + the `usePortalV2Pillars` seam. Landed in `50fa62af`.

Two carry-overs, neither blocking:

- **The app-wide retheme** (§4.3) replaces the provisional `.pv2-root` scoped
  theme. Doing it folds `portal-v2.css`'s values into `index.css`.
- **"Halden Materials" → `FIXTURE_LEAKS`** is still outstanding, but only becomes
  necessary when a phase actually introduces that fixture. The pillar pages
  needed no fixture at all, so nothing has leaked yet.

### Phase 2 — Overview + the six pillar dashboards ✅ BUILT

Landed in `50fa62af` / `393afe75`, verified 21/21 live against the deployed dev
server. Reuses `ui/score-ring.tsx` and `journeyTokens` pillar colours; the gate is
the `copilot` card in the same payload, so no second request.

**The sparkline question resolved itself**: a small token-free `TrendLine` in
`PortalV2Pieces.tsx` renders the real `trend.series` the API already returns, so
`PillarSparkline` was not adapted and `<JourneySvgDefs />` is not needed.

Two findings from this phase that later phases must respect:

- **`evaluation` is an object**, not a status string — `{status, reason,
  evaluableSignalCount, minRequiredSignals, theoreticalMax, score}`. Read
  `.status`, and prefer its `reason` for customer-facing copy. A self-declared
  type made `tsc` pass while being wrong about the wire; only running the test
  caught it.
- **Withhold platform wiring faults.** Real responses carry
  `unavailableReason: "unknown_check_key"`, which the server classifies as *our*
  defect (`WAR_ROOM_STAT_WIRING_FAULT_REASONS`). Never print those to a customer
  as a gap in their tenant — drop the callout and disclose the count.

Known cosmetic gap: `ScoreRing` renders a `%` suffix, so scores read "56%" rather
than the design's plain numeral. Left alone rather than forking the shared
component; an optional `suffix` prop is the clean fix when it matters.

### Phase 3 — The drill-down template

Build once against `governance-oversharing-full` (the README's reference
implementation), then apply to the rest: purpose → provenance → stat cards →
evidence table → policy block → wrench fixes. This is the highest-leverage phase —
25+ pages fall out of one template.

Evidence must come from `tenant_check_item_details.items` (full list or none),
**not** `tenant_monitor_profiles.rawResponse`, which is only the first page and a
debug trace. And `tenant_check_item_details` is keyed on `tenants.tenantId` (the
M365 GUID), **not** `tenants.id`/the `customerId` JWT claim — resolve first, as
`portal-tenant-check-items.ts:21-33` does, or you silently miss real rows.

### Phase 4 — The change-request gate

`FixPanel` (Sheet) + `FixCrStep` + `fixPanelLibrary`, plus the customer-scoped CR
routes. Schema is already right (`msp_change_requests`). This is the gate every
other system routes through, so it precedes runbooks and remediation.

### Phase 5 — Hold windows

Pure `holdState.ts` derivation first, unit-tested against the four fixtures and
against the §5.5 defects (fix them deliberately). Then `useHoldWindows` with the
real clock + interval, held in a `useRef` per §5.4. Then the three surfaces
(runbooks panel, runbook card band, alerts tray) off the one source. T-24 / T-0 /
early-clear notification wiring is a separate backend task.

### Phase 6 — Operate + Standards & risk

Active Runbooks, Remediation Tracker, SOP hub + 4 categories, Risk Register,
Microsoft Changes. Mostly new customer-scoped routes over existing schema.
Remediation reuses `remediation-tracker-pricing.ts` as-is. Respect the
`status`/`verificationState` separation — only `reverifyRemediationTrackerSteps()`
inside a real scan may set `verified`.

### Phase 7 — Command palette + ShaneBot basic wire-in

**7a is the last phase before Documents.** Two separable pieces:

**Command palette.** Extend the existing `components/command-palette.tsx` rather
than replacing it — it is already server-backed by
`/api/portal/customer/search`, which is exactly the "needs a real search
endpoint" item the README flags as out of scope. Add the design's ranking rules
(exact → prefix → contains → sub/kind), the 14-cap, the indexed-count footer,
coloured type labels, and the always-last `Ask ShaneBot: "<query>"` row so a
search that finds nothing becomes a question rather than a dead end.

**ShaneBot — basic wire-in only.** Build the selection chip and the chat panel
against what is real today:

- the existing engine (`lib/shanebot-engine.ts`, `BOT_INSTANCES.shanebot_paid`),
- the existing Zoho Desk escalation (`enqueueEscalationTicket`), which already
  matches the design,
- **only the four card types the engine already supports** — `invoice`,
  `subscription`, `score`, `data-answer`.

> **Do not extend the card taxonomy in this phase.** No new Active Card types, no
> `finding`/`fix`/`ticket` cards. Wire in what is real and testable, ship it, and
> let real use tell us what Phase 9 should be.

### Phase 8 — Document library

Second to last, because it is the only system needing new schema, and the one
whose content is most incomplete (33 of 80+ written).

### Phase 9 — ShaneBot full upgrade (final phase)

Extend the engine's Active Card taxonomy to the design's five —
`finding | fix | datum | ticket | escalate` — mapping `datum` onto the existing
`data-answer` rather than duplicating it.

**Scope here is deliberately provisional.** ShaneBot has never been driven
end-to-end by Shane, so Phase 7a is the first real use it will ever get. Expect
that to produce findings that change this phase's content. Treat the card
taxonomy as the known part and reserve room for the rest; do not freeze a spec
for it before 7a has been used.

Grounding replies on documents, findings and SOWs stays out of scope — the README
is right that it needs its own architecture proposal.

### Phase 10 — Copilot, Projects, My Architect

`/portal-v2/copilot` reuses the real gate constant (`COPILOT_GATE_TARGET`, mirrored
server-side — change one, change and re-test both). Projects reuses
`buildGanttLayout`/`PhaseGanttChart` from `copilot-journey/StatementOfWorkBody.tsx`.
My Architect's retainer-hours ledger is greenfield — no ledger exists anywhere in
the repo today.

### After all phases — the supersede step (Shane-gated)

Only once `/portal-v2` is at full parity **and Shane has explicitly approved the
finished result**: redirect `/governance`, `/security-overview`, `/m365-health`,
`/compliance`, `/adoption`, `/licensing` to their `/portal-v2` equivalents, then
retire the old page components in a follow-up. Not before. See §1.4.

---

## 7. Explicitly out of round one

Carried from the README, plus what this analysis adds:

- Mobile. Desktop only; nothing below ~1000px has been designed.
- The remaining ~51 document catalogue entries.
- Licensing / Adoption / Health drill-down pages (template exists; pages not
  written in the design).
- ShaneBot grounding on documents/findings/SOWs — needs its own architecture
  proposal.
- Document generation pipeline, versioning, freshness comparison.
- **Added:** the T-24 / T-0 / early-clear notification transport.
- **Added:** retainer-hours ledger schema.
- **Added:** the hardcoded-hex sweep the app-wide retheme makes visible (§4.3).
  Not a prerequisite for `/portal-v2`; it should not block any phase.

---

## 8. Open questions for Shane

The five that were here are **resolved** — see Phase 0. What remains:

1. **The supersede sign-off itself.** Nothing redirects or retires an old pillar
   route until Shane looks at finished `/portal-v2` and says go. That approval is
   the gate, and it has not been given. (§1.4)
2. **Light mode's fate.** The design is dark-only and says nothing about light,
   but the portal has a real per-account light/dark toggle. §4.3 keeps light and
   moves it onto the brand's own light values; dark-only would be a smaller,
   separate change if that is what Shane wants.
3. **The `_ds/` bundle is stale** relative to the repo — it resolves the portal to
   navy `#0A2540`, the handoff uses slate `#020617`, and the repo was Fluent 2
   neutral until this retheme. Worth regenerating from the post-retheme
   `index.css` so the next handoff does not inherit the same three-way
   disagreement.
