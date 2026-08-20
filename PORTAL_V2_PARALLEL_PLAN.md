# Customer Portal v2 — parallel build plan

Work-breakdown for finishing `/portal-v2` against
`Design/design_handoff_customer_portal/`, partitioned so several agents can run
at once without colliding.

**Measured position** (`npx tsx scripts/audit-portal-fidelity.mts`):
36 design sections · 18 at 60%+ copy coverage · **18 substantially unbuilt**.

---

## How to read a percentage in this document

The number is **copy coverage**: how much of that design section's visible text
appears anywhere in `artifacts/msp-portal/src`. It is a **floor, not a score**:

- it searches the whole tree concatenated, so a string counts as present even
  when it renders on a different page — real fidelity is `<=` the number;
- it says **nothing about layout**. Overview scored 44% while also being laid
  out completely differently from the design;
- text split across JSX elements can read as absent. Overview's last 11% is a
  deliberate derivation (`{rows.length} verified fixes` vs the design's literal
  `3`), not a gap.

So: use it to triage and to prove movement, never as the definition of done.
**Done means the page matches the design when you look at it.**

---

## The two rules that make parallelism safe

1. **One agent per file set.** `CLAUDE.md` already says single-executor per
   file set. Every part below lists the files it OWNS and the files it must NOT
   touch. If two parts would edit one file, that file belongs to Part 0.
2. **Part 0 runs alone, first.** It creates the seams that let everything else
   proceed in parallel. Until it lands, every new page has to edit
   `PortalV2Shell.tsx` and `App.tsx`, and those are guaranteed conflicts.

### The three files that will collide, and the fix

| File | Why it collides | Handled by |
|---|---|---|
| `PortalV2Shell.tsx` | every new page adds a nav row | Part 0 extracts a nav registry |
| `App.tsx` | every new page adds routes | Part 0 adds an explicit insertion marker |
| `portal-v2.css` | shared classes | append-only; never edit another part's block |

`PLATFORM_BUILD.md` and `test-manifests/_regression-suite.json` are appended to
by every part. `CLAUDE.md`'s Shared File Write Discipline already covers them:
pull --rebase, re-apply your own line, confirm the diff is 1 line, push, retry
on rejection.

---

## Standing acceptance gate — every part

A part is done when **all** of these hold. Report the real numbers, not a
summary.

- [ ] Design section's copy coverage reported **before and after**
- [ ] The page **looks like the design** — structure, order of sections,
      spacing, and the layout shapes (grid columns, fixed vs fluid). Say what
      you compared against.
- [ ] Every number on screen derives from the data layer or a single fixture
      module. No tenant number hardcoded in a `.tsx`.
- [ ] Copy reproduced **verbatim**. No rewriting, no shortening, no emoji.
- [ ] Derivations have unit tests (`*.test.ts`, `node --test` via `tsx`)
- [ ] `npx tsc --noEmit -p tsconfig.json` clean apart from the known
      pre-existing `SowScreen.tsx(359,13) TS7030`
- [ ] `npm test` green in `artifacts/msp-portal`
- [ ] `npm run build` clean (needs `PORT` and `BASE_PATH` set)
- [ ] Test manifest written, registered, and **run** via `shaneapp://runTest`
- [ ] `PLATFORM_BUILD.md` bookend: `IN FLIGHT` before code, `DONE` after
- [ ] Anything deliberately not built is **stated on the page or in the file
      header** — never silently dropped

### What the manifests do and do not prove

They assert a testid exists and that text sits inside it. **They cannot detect
a page that looks wrong.** Three ran fully green against pages carrying 5% of
their design copy. Never report a manifest pass as evidence of fidelity.

---

## Part 0 — Seams · RUN ALONE, FIRST

**Nothing else can start safely until this lands.**

**Owns:** `components/portal-v2/PortalV2Shell.tsx`,
`components/portal-v2/portalV2Nav.ts` (new), `App.tsx`

**Do:**
1. Extract the nav out of `PortalV2Shell.tsx` into `portalV2Nav.ts` — a data
   module of groups → items → subs. The shell renders it; it no longer declares
   it. Keep the current rendering exactly: the `↳` on every sub-item, the
   blue-border active row, `subsVisible = subs && isActive && expanded`,
   collapsed-mode dividers and badge dots.
2. Keep the standing rule in the registry's header: **never a row pointing at a
   route that does not exist.** A part adds its nav entry in the same change as
   its route.
3. Add a literal insertion marker in `App.tsx` immediately before
   `<Route path="/portal-v2/:pillar">`, so every later part appends at one known
   point rather than choosing a line.

**Gate:** the nav renders identically before and after — verify by running
`test-manifests/portal/portal-v2-risk-register.json` and
`portal-v2-ownership.json` green.

---

## Part 1 — The shell's five systems · 2 sessions · depends on Part 0

The largest missing thing in the build. Every one is at **zero**.

| System | Design refs |
|---|---|
| Command palette (⌘K) | `paletteOpen` / `paletteQ` / `paletteSel`, 13 refs |
| ShaneBot + selection chip | `sbOpen`, `askLabel`/`askX`/`askY`, 13 refs |
| Alerts tray (real content) | `alertsOpen`, 11 refs — ours is an empty placeholder |
| Account menu | `accountMenuOpen`, 11 refs |
| "New" menu | `newMenuOpen`, 18 refs |
| Knowledge-base overlay | `kbOpen`, 17 refs |
| Change-control header badge | `ccBadge`, 5 refs |

**Owns:** `components/portal-v2/PortalV2Shell.tsx`, new files under
`components/portal-v2/shell/`
**Must not touch:** any `pages/portal-v2-*.tsx`

**Read first:** the handoff README's "The five systems" section — it is the
specification for the palette's ranking rules, the 14-result cap, the
always-last `Ask ShaneBot: "<query>"` row, and the selection-chip behaviour.

**Note:** the command palette should extend the existing
`components/command-palette.tsx`, which is already server-backed by
`/api/portal/customer/search` — that is the "needs a real search endpoint" item
the README flags as out of scope.

---

## Part 2 — Pillar redesigns: Governance · Security · Compliance

**Now:** 70% / 73% / 70%
**Design:** shell 551-769 · 769-1001 · 3864-4106

**Owns:** `pages/portal-v2-{governance,security,compliance}.tsx`,
`components/portal-v2/{gov,sec,cmp}DashboardData.ts`,
`components/portal-v2/{cmp}FixPlaybooks.ts`, `govPages.ts`, `govOversharingData.ts`

Known gaps include the risk heat-map ("Likelihood against impact", "Rows run
from most likely at the top…"), "What happens if it lands", "What is holding it
down", and "Open in the register →".

---

## Part 3 — Pillar top-ups: Licensing · Adoption · Health

**Now:** 83% / 88% / 90% — closest to done; good first task for a new agent.
**Design:** shell 3558-3864 · 3227-3558 · 2875-3227

**Owns:** `pages/portal-v2-{licensing,adoption,health}.tsx`,
`components/portal-v2/{lic,adp,hlt}DashboardData.ts` and `*FixPlaybooks.ts`

---

## Part 4 — Change Control rebuild · **largest single gap**

**Now: 5%.** Our page was built from the round-one inline shell section; the
design is now a separate module and a different page.
**Design:** `Change Control.dc.html` (2,795 lines) — read it whole.

**Owns:** `pages/portal-v2-change-control.tsx`, `components/portal-v2/ccPageData.ts`,
`components/portal-v2/useChangeControl.ts`, `test-manifests/portal/change-control.json`

**Structural change to expect:** ours is a horizontal tab strip
(register / schedule / vault). The design has a **left sub-nav** with
briefing / register / catalogue / calendar / review — and Round Two removed
"Policy & settings" from it, because the policy UI now lives in Settings. The
module keeps a deep-linkable policy view (`ccView === 'settings'`) that other
entry points still target; that view is not built.

Missing copy includes the whole freeze-calendar surface: "When it lands",
"Change freeze", "Grant a freeze exception", "Microsoft · not yours to approve",
"Collisions detected".

---

## Part 5 — Operate: Remediation Tracker + Policy Decisions

**Now:** Remediation has no route; Policy Decisions 25%.
**Design:** shell 5961-6013 · 4578-4659

**Owns:** `pages/portal-v2-remediation.tsx` (new),
`pages/portal-v2-policy-decisions.tsx` (new), their data/model modules

**Reuse, do not rebuild:** `remediation-tracker-pricing.ts` exists. Respect the
`status` / `verificationState` separation — only `reverifyRemediationTrackerSteps()`
inside a real scan may set `verified`.

**Note:** Overview already ships `OV_POLICY_DECISIONS` (4 decisions, extracted).
Policy Decisions should take ownership of that fixture and Overview import it.

---

## Part 6 — Operate: SOPs & Runbooks + 4 categories

**Now: 7%.** No route.
**Design:** shell 1633-1981, plus the four `sop-*` category pages

**Owns:** `pages/portal-v2-sop-hub.tsx` (new) and category pages, data/model modules

Missing copy includes "Executions run one at a time per tenant so two procedures
never touch the same object at once", "Audit history & verification logs",
"Every entry is hashed and exportable — this is the evidence an auditor asks
for", "Execute automated steps only".

---

## Part 7 — Governance: PII Governance + Security Plan

**Now: 0% and 0%.** Neither exists.
**Design:** shell 4106-4258 · 4258-4345

**Owns:** `pages/portal-v2-pii.tsx` (new), `pages/portal-v2-security-plan.tsx` (new)

PII carries a nav badge (`3 exposed`) in the design's `navGroupDefs` — wire it
through the Part 0 nav registry.

---

## Part 8 — Projects

**Now: 9%.** No route. Named explicitly as missing.
**Design:** shell 1231-1495

**Owns:** `pages/portal-v2-projects.tsx` (new) + data/model

**Reuse:** `buildGanttLayout` / `PhaseGanttChart` from
`components/copilot-journey/StatementOfWorkBody.tsx`.
**Also:** Overview already ships `OV_PROJECT_PHASES` and the gantt geometry
(`PJ_SPANS`, `PJ_SLIPS`, `PJ_WIN`, `PJ_TODAY`) in `overviewData.ts`, extracted
from the same `PJ_PHASES`. Projects should own that fixture and Overview import
it — do not fork a second copy.

Round Two item 6 applies here: the Projects Gantt and the 5-lane task board must
be **fluid**, with the board wrapping lanes via `auto-fit` rather than scrolling.

---

## Part 9 — My Architect + Copilot

**Now:** 19% and 10%. Neither has a route.
**Design:** shell 1981-2199 · 6093-6203

**Owns:** `pages/portal-v2-retainer.tsx` (new), `pages/portal-v2-copilot.tsx` (new)

**Copilot must reuse the real gate constant** `COPILOT_GATE_TARGET`, mirrored
server-side in `copilot-gate.ts` — change one, change and re-test both.

**This part closes a hole the Overview rebuild opened:** the design's overview
has no gate band, so the Copilot gate currently has **no surface anywhere** in
the portal until this page exists.

My Architect's retainer-hours ledger is greenfield — no ledger exists anywhere
in the repo.

---

## Part 10 — Ownership + Microsoft Changes top-up

**Now:** 34% and 23%. Both built this round, both partial.
**Design:** `Ownership.dc.html` · `Microsoft Changes.dc.html`

**Owns:** `components/portal-v2/OwnershipMatrix.tsx`, `ownership*.ts`,
`pages/portal-v2-ms-changes.tsx`, `msChanges*.ts`, and their two manifests

Ownership is missing the assign slide-over's own surface ("Assign to more",
"Mark accepted", "Who held it before", "Leave unassigned — record it as a gap"),
the add-a-row flow, and delegation/handover.

Microsoft Changes is missing "Did this release?", the seen-in-the-wild list, the
per-group impact panel, the thread/snooze/decision overlays, and the workload
filter rail — all listed in that page's file header.

---

## Part 11 — Drill-downs

**Now:** Security MFA 4% · Security CA 40% · Evidence 33% · Compliance
gaps 75% / decisions 60% / obligations 60% · Governance list/drift/inventory.
**Design:** shell 4816-4975 · 4975-5041 · 5041-5204 · 4659-4732 · 4732-4783 ·
4783-4816 · 5871-5961

**Owns:** new `pages/portal-v2-*` for each, plus `govPages.ts` **only if Part 2
is finished** — otherwise coordinate, this is the one real overlap in the plan.

**Follow the reference implementation:** the Overshared SharePoint page
(`governance-oversharing-full`) is the drill-down template — purpose paragraph →
Graph API provenance → stat cards → expandable evidence table → tenant-policy
block → wrench fixes.

---

## Part 12 — Account settings

**Now:** Billing 17% · Webhooks 4% · Account security 7% · Alert prefs 12% ·
Receipt 13%. Reached from the account menu, so it pairs naturally with Part 1.
**Design:** shell 2371-2520 · 2520-2722 · 2199-2371 · 2722-2875 · 6013-6093

**Owns:** new `pages/portal-v2-{billing,webhooks,account-security,alert-preferences,receipt}.tsx`

**⚠ Resolve before building Billing.** The new shell contains **two conflicting
tier ladders** and no changelog mentions it:

- `BILL_TIERS` (shell 15478) — Foundation 690 / Growth 1180 / **Premier 2350**
- `BILL_TIER_CARDS` (shell 15510) — Foundation 690 / Growth 1180 / **Command 1980**, no Premier

Both render on the billing page. They disagree on the third tier's **name and
price**. This is Shane's call, not an implementation detail.

---

## Suggested wave order

```
Wave 1   Part 0                     (alone — creates the seams)
Wave 2   Part 1 · 3 · 8 · 9         (shell systems + easiest pillars + the two named-missing pages)
Wave 3   Part 2 · 4 · 5 · 7         (pillar redesigns + the biggest gap + the zero-coverage pages)
Wave 4   Part 6 · 10 · 11 · 12      (SOPs, top-ups, drill-downs, account)
```

Wave 2 is the one that most directly answers what was reported: the top shell,
Projects, and My Architect.

---

## Prompt template for an agent

> Read `PORTAL_V2_PARALLEL_PLAN.md` and take **Part N**.
>
> Read `CLAUDE.md` first and follow it — especially the session bookends, the
> single-executor-per-file-set rule, and the shared-file write discipline.
>
> The design is the specification. Read the `.dc.html` markup AND the logic class
> at the bottom of the file; ignore `support.js` entirely. Copy is final —
> reproduce it verbatim, never rewrite or shorten it, and no emoji.
>
> Work only on the files your Part lists as OWNED. If you need to change a file
> another Part owns, stop and say so instead.
>
> Before you start, run `npx tsx scripts/audit-portal-fidelity.mts` and record
> your section's percentage. Before you finish, run it again and report the
> movement. **Do not report a test-manifest pass as evidence the page matches
> the design — it cannot detect that.** Say plainly what you compared against
> and what you deliberately did not build.
