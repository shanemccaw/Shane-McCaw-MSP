# Customer Portal v2 — parallel build plan

Work-breakdown for finishing `/portal-v2` against
`Design/design_handoff_customer_portal/`, partitioned so several agents can run
at once without colliding.

**Measured position** (`npx tsx scripts/audit-portal-fidelity.mts`):
36 design sections · 18 at 60%+ copy coverage · **18 substantially unbuilt**.

---

## How to use this document

**Reference this file. Do not paste it.** It lives in the repo root, so an agent
reads it itself, and it stays the single copy — a pasted one goes stale the
moment this file changes.

Every part below ends with a **ready-to-paste prompt** in a code block. Copy that
block, paste it, and the agent goes. Nothing to fill in and nothing to edit.

Give each agent **one part**. An agent that has read all thirteen is measurably
more likely to wander into files another part owns, which is the one failure
this partition exists to prevent — so the prompts tell it to read only the top
matter and its own part.

### Before you launch a wave

1. **Part 0 must have landed.** Until it has, every agent edits
   `PortalV2Shell.tsx` and `App.tsx`, and they will conflict.
2. **Use the wave order at the bottom** — the parts in each wave are already
   checked for disjoint file ownership. If you deviate, check it yourself.
3. **Launch them against the same `main`.** Each bookends and pushes
   independently, per the shared-file write discipline in `CLAUDE.md`.

### When an agent reports back

Ask for the before/after audit number **and** what it compared against visually.
If it only offers a test-manifest pass, that is not an answer — see "What the
manifests do and do not prove".

---

## ⚠ READ THIS FIRST — this phase is UI ONLY

**Build the screens. Do not wire up data. Mock data is expected, correct, and
what you should use.** A later pass connects everything to real sources.

That means, concretely:

- **Use the design's own fixture values.** They are in the `.dc.html` logic
  class. Extract them mechanically where you can rather than retyping — see
  `overviewData.ts` and `msChangesData.ts` for the pattern.
- **Do not skip a section because you have no real data for it.** There is no
  real data for almost any of this yet. Build it from the design's numbers.
- **Do not add a note to the page apologising for mock data**, and do not leave
  a section out with a "joins this view when wired to live data" line. If the
  design has a section, build the section.
- **Do not go hunting for an API to hang a page off.** If one already exists and
  is trivially reusable, fine — but that is a bonus, never a prerequisite.

> This instruction exists because it was got wrong once. The Overview rebuild
> initially shipped four of the design's six "Everything in motion" sections and
> put a line on the page explaining that hold windows and accepted risks would
> arrive "when their lanes are wired to live data". That was the wrong call:
> both were UI work with fixture data available, and leaving them out made the
> page look unfinished for no benefit. Both are now built.

**What still applies:** keep the fixture in ONE module per page
(`<page>Data.ts`), never inline a tenant number in a `.tsx`. That is not about
real-vs-mock — it is so the later wiring pass has one place to change per page
instead of hunting through JSX.

**Where a page already has a real source, keep it.** The Overview pillar strip
reads `/api/portal/assessment/war-room-pillars` and the runbook hold derivation
is real and tested. Do not tear working wiring out in the name of UI-only.

---

## How to read a percentage in this document

The number is **copy coverage**: how much of that design section's visible text
appears anywhere in `artifacts/msp-portal/src`. It is a **floor, not a score**:

- it searches the whole tree concatenated, so a string counts as present even
  when it renders on a different page — real fidelity is `<=` the number;
- it says **nothing about layout**. Overview scored 44% while also being laid
  out completely differently from the design;
- text split across JSX elements can read as absent;
- **it only sees text in the MARKUP.** Strings built in the logic class never
  appear. Overview's score was identical with four sections rendered and with
  six, because all six labels are built in `ovSecDef`. A rising number is
  evidence; a flat one is not evidence of no progress.

Use it to triage and to prove movement, never as the definition of done.
**Done means the page matches the design when you look at it.**

---

## The two rules that make parallelism safe

1. **One agent per file set.** `CLAUDE.md` already says single-executor per
   file set. Every part lists the files it OWNS and the files it must NOT touch.
   If two parts would edit one file, that file belongs to Part 0.
2. **Part 0 runs alone, first.** It creates the seams that let everything else
   proceed in parallel.

### The three files that will collide, and the fix

| File | Why it collides | Handled by |
|---|---|---|
| `PortalV2Shell.tsx` | every new page adds a nav row | Part 0 extracts a nav registry |
| `App.tsx` | every new page adds routes | Part 0 adds an explicit insertion marker |
| `portal-v2.css` | shared classes | append-only; never edit another part's block |

`PLATFORM_BUILD.md` and `test-manifests/_regression-suite.json` are appended to
by every part. `CLAUDE.md`'s Shared File Write Discipline covers them: pull
--rebase, re-apply your own line, confirm the diff is 1 line, push, retry on
rejection.

---

## Standing acceptance gate — every part

- [ ] Design section's copy coverage reported **before and after**
- [ ] The page **looks like the design** — structure, order of sections,
      spacing, and the layout shapes. Say what you compared against.
- [ ] **Every section the design has is built.** Not "most of them". If you
      genuinely cannot build one, say which and why — do not quietly ship a
      shorter page.
- [ ] Fixture values live in ONE module per page, not inline in `.tsx`
- [ ] Copy reproduced **verbatim**. No rewriting, no shortening, no emoji.
- [ ] Derivations have unit tests (`*.test.ts`, run with `npx tsx --test`)
- [ ] `npx tsc --noEmit -p tsconfig.json` clean apart from the known
      pre-existing `SowScreen.tsx(359,13) TS7030`
- [ ] `npm test` green in `artifacts/msp-portal`
- [ ] `npm run build` clean (`PORT` and `BASE_PATH` must be set)
- [ ] Test manifest written, registered, and **run** via `shaneapp://runTest`
- [ ] `PLATFORM_BUILD.md` bookend: `IN FLIGHT` before code, `DONE` after

### What the manifests do and do not prove

They assert a testid exists and that text sits inside it. **They cannot detect a
page that looks wrong.** Three ran fully green against pages carrying 5% of
their design copy. Never report a manifest pass as evidence of fidelity.

---

# Part 0 — Seams · RUN ALONE, FIRST

**Nothing else can start safely until this lands.**

**Owns:** `components/portal-v2/PortalV2Shell.tsx`,
`components/portal-v2/portalV2Nav.ts` (new), `App.tsx`

**Gate:** the nav renders identically before and after — verified by running
`portal-v2-risk-register.json` and `portal-v2-ownership.json` green.

```
Take Part 0 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 0 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

YOUR JOB is to create the seams that let twelve other agents work in parallel
without conflicting. No new pages, no new features. Three changes:

1. Extract the left nav out of components/portal-v2/PortalV2Shell.tsx into a new
   components/portal-v2/portalV2Nav.ts — a data module of groups -> items ->
   subs. The shell renders it; it no longer declares it. Keep the current
   rendering EXACTLY as it is: the leading "↳" on every sub-item, the active
   sub-item's blue border and wash and 800-weight label, subs visible only when
   the parent is active AND the sidebar is expanded, collapsed-mode 1px group
   dividers, and the hold-window badge and its collapsed-mode 6px dot.

2. Put this rule in the new file's header comment and keep it true: NEVER A ROW
   POINTING AT A ROUTE THAT DOES NOT EXIST. A later part adds its nav entry in
   the same change as its route.

3. Add a literal, greppable insertion marker comment in src/App.tsx immediately
   before <Route path="/portal-v2/:pillar">, so every later part appends its
   routes at one known point instead of choosing a line. Say in the marker that
   routes must be added ABOVE it, because the :pillar param route would
   otherwise swallow them.

This is a refactor: the nav must look and behave identically afterwards. Prove
it by running these two manifests green via shaneapp://runTest (see
desktop/BuildConsole/AGENT_PROTOCOLS.md section 2):
  test-manifests/portal/portal-v2-risk-register.json
  test-manifests/portal/portal-v2-ownership.json

Then: npx tsc --noEmit -p tsconfig.json (clean apart from the known pre-existing
SowScreen.tsx(359,13) TS7030), npm test in artifacts/msp-portal, and npm run
build with PORT=5199 and BASE_PATH=/portal set.

Report what you changed and the two manifest results. If anything about the nav
renders differently afterwards, say so plainly rather than calling it done.
```

---

# Part 1 — The shell's five systems · 2 sessions · depends on Part 0

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

```
Take Part 1 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 1 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

THIS PHASE IS UI ONLY. Mock data is expected — use the design's own fixture
values from its logic class. Do not wire up data sources, and do not leave a
section out because there is no real data behind it. A later pass does the
wiring. Keep fixtures in one data module, never inline in a .tsx.

YOUR JOB: build the shell's five systems. All are currently at zero in our
build. Read the "The five systems" section of
Design/design_handoff_customer_portal/README.md first — it is the specification
for the command palette's ranking rules (exact match -> label prefix -> label
contains -> sub/kind contains), the 14-result cap, the indexed-count footer, the
coloured type labels, the always-last `Ask ShaneBot: "<query>"` row, and the
selection-chip behaviour. Then read the shell markup and logic class for each:
Design/design_handoff_customer_portal/Customer Portal Shell.dc.html.

Build:
  - The command palette (⌘K). EXTEND the existing
    src/components/command-palette.tsx rather than replacing it — it is already
    server-backed by /api/portal/customer/search, which is the "needs a real
    search endpoint" item the README flags as out of scope. ⌘K with a text
    selection asks ShaneBot about the selection instead of opening the palette.
  - ShaneBot: the selection chip that appears AT the selection (not a floating
    widget, nothing follows the pointer, Escape dismisses), and the chat panel.
  - The alerts tray with real content, including the hold-windows section that
    lists only windows needing a decision. Ours today is an empty placeholder.
  - The account menu (it currently has only Settings and Sign out).
  - The "New" menu.
  - The knowledge-base overlay.
  - The change-control badge in the header, which deep-links into the Change
    Control module's own policy view.

OWNS: components/portal-v2/PortalV2Shell.tsx and new files under
components/portal-v2/shell/. You may also extend
src/components/command-palette.tsx.

MUST NOT TOUCH: any pages/portal-v2-*.tsx. If a page needs changing for a system
to work, stop and tell me instead of editing it.

Write unit tests for the palette's ranking and cap. Then run the standing gate
in the plan: the fidelity audit before and after, tsc, npm test, npm run build
with PORT and BASE_PATH set, and a test manifest run via shaneapp://runTest.
Report what you compared against visually — do not report a manifest pass as
evidence the shell matches the design.
```

---

# Part 2 — Pillar redesigns: Governance · Security · Compliance

**Now:** 70% / 73% / 70%
**Design:** shell 551-769 · 769-1001 · 3864-4106

```
Take Part 2 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 2 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

THIS PHASE IS UI ONLY. Mock data is expected — use the design's own fixture
values from its logic class. Do not wire up data sources, and do not leave a
section out because there is no real data behind it. A later pass does the
wiring. Keep fixtures in one data module per page, never inline in a .tsx.

YOUR JOB: bring the Governance, Security and Compliance pillar pages up to the
current design. They currently carry 70%, 73% and 70% of their design copy —
they were built from an earlier revision and the design has moved.

Design sources, in Design/design_handoff_customer_portal/Customer Portal
Shell.dc.html — read the markup AND the logic class at the bottom of the file,
and ignore support.js entirely:
  Governance  lines 551-769
  Security    lines 769-1001
  Compliance  lines 3864-4106

Known missing surfaces include the risk heat-map ("Likelihood against impact",
"Rows run from most likely at the top. A filled cell is a risk sitting at that
pair — hover it for the name."), "What happens if it lands", "What is holding it
down", and "Open in the register →". Diff the whole section rather than only
fixing those — that list is what one audit surfaced, not a complete inventory.

OWNS:
  pages/portal-v2-governance.tsx
  pages/portal-v2-security.tsx
  pages/portal-v2-compliance.tsx
  pages/portal-v2-gov-detail.tsx
  pages/portal-v2-gov-oversharing.tsx
  pages/portal-v2-gov-oversharing-all.tsx
  components/portal-v2/govDashboardData.ts
  components/portal-v2/secDashboardData.ts
  components/portal-v2/cmpDashboardData.ts
  components/portal-v2/cmpFixPlaybooks.ts
  components/portal-v2/govPages.ts
  components/portal-v2/govOversharingData.ts

MUST NOT TOUCH: PortalV2Shell.tsx, portalV2Nav.ts, or any other page. Add routes
only at the marker in App.tsx.

Copy is final — reproduce it verbatim, never rewrite or shorten it, and no
emoji. Run the standing gate in the plan: fidelity audit before and after, tsc,
npm test, npm run build with PORT and BASE_PATH set, and manifests run via
shaneapp://runTest. Report what you compared against visually.
```

---

# Part 3 — Pillar top-ups: Licensing · Adoption · Health

**Now:** 83% / 88% / 90% — closest to done; good first task for a new agent.
**Design:** shell 3558-3864 · 3227-3558 · 2875-3227

```
Take Part 3 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 3 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

THIS PHASE IS UI ONLY. Mock data is expected — use the design's own fixture
values from its logic class. Do not wire up data sources, and do not leave a
section out because there is no real data behind it. A later pass does the
wiring. Keep fixtures in one data module per page, never inline in a .tsx.

YOUR JOB: close the remaining gap on the Licensing, Adoption and Health pillar
pages. They carry 83%, 88% and 90% of their design copy — the closest to done in
the whole build, so this is a contained piece of work.

Design sources, in Design/design_handoff_customer_portal/Customer Portal
Shell.dc.html — read the markup AND the logic class at the bottom of the file,
and ignore support.js entirely:
  Licensing  lines 3558-3864
  Adoption   lines 3227-3558
  Health     lines 2875-3227

Diff each section against our page in full. A high percentage means most copy is
present somewhere, NOT that the layout matches — check the structure, the order
of sections, and the grid shapes too.

Note that Licensing is a MONEY page, not a risk page — the prototype says so in
its own source comment, and it deliberately has no scan strip, no status pill
and no area cards, plus a wider container for the ledger table.

OWNS:
  pages/portal-v2-licensing.tsx
  pages/portal-v2-adoption.tsx
  pages/portal-v2-health.tsx
  components/portal-v2/licDashboardData.ts
  components/portal-v2/adpDashboardData.ts
  components/portal-v2/hltDashboardData.ts
  components/portal-v2/licFixPlaybooks.ts
  components/portal-v2/adpFixPlaybooks.ts
  components/portal-v2/hltFixPlaybooks.ts

MUST NOT TOUCH: PortalV2Shell.tsx, portalV2Nav.ts, or any other page.

Copy is final — reproduce it verbatim, never rewrite or shorten it, and no
emoji. Run the standing gate in the plan: fidelity audit before and after, tsc,
npm test, npm run build with PORT and BASE_PATH set, and manifests run via
shaneapp://runTest. Report what you compared against visually.
```

---

# Part 4 — Change Control rebuild · **largest single gap**

**Now: 5%.** Our page was built from the round-one inline shell section; the
design is now a separate module and a different page.

```
Take Part 4 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 4 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

THIS PHASE IS UI ONLY. Mock data is expected — use the design's own fixture
values from its logic class. Do not wire up data sources, and do not leave a
section out because there is no real data behind it. A later pass does the
wiring. Keep fixtures in one data module per page, never inline in a .tsx.

YOUR JOB: rebuild the Change Control page. It is the largest single gap in the
build — it carries 5% of its design copy, because our page was built from the
round-one inline shell section and the design has since become a separate module
and a materially different page.

Design source: Design/design_handoff_customer_portal/Change Control.dc.html
(2,795 lines). Read it whole — markup AND the logic class at the bottom. Ignore
support.js entirely.

EXPECT A STRUCTURAL CHANGE. Ours is a horizontal tab strip (register / schedule
/ vault). The design has a LEFT SUB-NAV with briefing / register / catalogue /
calendar / review. Round Two removed "Policy & settings" from that sub-nav
because the policy UI now lives in the Settings page — but the module keeps a
deep-linkable policy view (ccView === 'settings') that the header badge and
alerts still target, and that view is not built. Build it.

The sub-nav belongs in the shell's nav registry (Part 0 created portalV2Nav.ts)
as sub-items under Change Control, with the leading "↳" on every sub-item, the
same way Ownership and Microsoft Changes already work. Make each sub-view a real
URL so it is linkable.

Whole surfaces are missing, including the freeze calendar: "When it lands",
"Change freeze", "Grant a freeze exception", "Revoke the exception", "Microsoft ·
not yours to approve", "Collisions detected", and "Nothing of yours is aimed at
these two weeks under this filter — check the off-timeline items below."

Round Two item 6 applies: the CR Gantt rows must be FLUID — fluid
minmax(0,1fr) columns, no fixed min-width floor and no overflow-x wrapper.

OWNS:
  pages/portal-v2-change-control.tsx
  components/portal-v2/ccPageData.ts
  components/portal-v2/useChangeControl.ts
  test-manifests/portal/change-control.json

MUST NOT TOUCH: PortalV2Shell.tsx or any other page. You MAY add Change
Control's sub-items to portalV2Nav.ts — that is the one file you share, so make
that edit small and self-contained. Add routes only at the marker in App.tsx.

Copy is final — reproduce it verbatim, never rewrite or shorten it, and no
emoji. Run the standing gate in the plan: fidelity audit before and after, tsc,
npm test, npm run build with PORT and BASE_PATH set, and the manifest run via
shaneapp://runTest. Report what you compared against visually.
```

---

# Part 5 — Operate: Remediation Tracker + Policy Decisions

**Now:** Remediation has no route; Policy Decisions 25%.
**Design:** shell 5961-6013 · 4578-4659

```
Take Part 5 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 5 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

THIS PHASE IS UI ONLY. Mock data is expected — use the design's own fixture
values from its logic class. Do not wire up data sources, and do not leave a
section out because there is no real data behind it. A later pass does the
wiring. Keep fixtures in one data module per page, never inline in a .tsx.

YOUR JOB: build two Operate pages that do not exist. Remediation Tracker has no
route at all; Policy Decisions carries 25% of its design copy and has no route.

Design sources, in Design/design_handoff_customer_portal/Customer Portal
Shell.dc.html — read the markup AND the logic class at the bottom of the file,
and ignore support.js entirely:
  Remediation Tracker  lines 5961-6013
  Policy Decisions     lines 4578-4659

Policy Decisions missing copy includes "Gaps you have decided to live with. An
undocumented gap is a finding on every scan and every audit; a documented one is
a position, with a name against it", "Record a decision", "Why this is the
position", "Where it stands today", "Withdraw and fix instead", "Click to read
it".

TAKE OWNERSHIP OF AN EXISTING FIXTURE. The Overview page already ships
OV_POLICY_DECISIONS in components/portal-v2/overviewData.ts — four decisions,
extracted from the prototype's POLICY_DECISIONS, with the six fields the
Overview lane reads. Move that fixture into your Policy Decisions data module,
widen it to the full field set the page needs, and have overviewData import it.
Do not fork a second copy of the decisions.

For Remediation Tracker: remediation-tracker-pricing.ts already exists — reuse
it rather than rebuilding pricing. Respect the status / verificationState
separation: only reverifyRemediationTrackerSteps() inside a real scan may set
verified, so never render a step as verified from UI state.

OWNS:
  pages/portal-v2-remediation.tsx (new)
  pages/portal-v2-policy-decisions.tsx (new)
  their new data and model modules
  components/portal-v2/overviewData.ts — ONLY to remove OV_POLICY_DECISIONS and
    import it from its new home

MUST NOT TOUCH: PortalV2Shell.tsx, or any other page. Add your nav rows to
portalV2Nav.ts and your routes at the marker in App.tsx, in the same change.

Copy is final — reproduce it verbatim, never rewrite or shorten it, and no
emoji. Run the standing gate in the plan: fidelity audit before and after, tsc,
npm test, npm run build with PORT and BASE_PATH set, and manifests run via
shaneapp://runTest. Report what you compared against visually.
```

---

# Part 6 — Operate: SOPs & Runbooks + 4 categories

**Now: 7%.** No route.
**Design:** shell 1633-1981, plus the four `sop-*` category pages

```
Take Part 6 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 6 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

THIS PHASE IS UI ONLY. Mock data is expected — use the design's own fixture
values from its logic class. Do not wire up data sources, and do not leave a
section out because there is no real data behind it. A later pass does the
wiring. Keep fixtures in one data module per page, never inline in a .tsx.

YOUR JOB: build the SOPs & Runbooks hub and its four category pages. None of
them exist — the hub carries 7% of its design copy and has no route.

Design source: Design/design_handoff_customer_portal/Customer Portal
Shell.dc.html lines 1633-1981 for the hub, plus the four sop-* category sections
(Incident Response, Security Drift, Mail Flow, Device Management). Read the
markup AND the logic class at the bottom of the file; ignore support.js.

Missing copy includes "Open active runbooks", "Refresh logs", "Export master
index PDF", "Executions run one at a time per tenant so two procedures never
touch the same object at once", "Watch it run", "Audit history & verification
logs", "Every entry is hashed and exportable — this is the evidence an auditor
asks for", "Action and detail", "Maintained by", "The procedure, in full",
"Execute this SOP", "Execute automated steps only".

The hub has three sub-views in the design's nav — library / execution queue /
execution history. Add them as sub-items under SOPs & Runbooks in
portalV2Nav.ts, with the leading "↳" on every sub-item, the same way Ownership
and Microsoft Changes already work, and make each a real URL.

There is an existing RunbookSteps component at
components/portal-v2/RunbookSteps.tsx and an Active Runbooks page at
pages/portal-v2-runbooks.tsx. Read them for the house pattern, but DO NOT EDIT
either — Active Runbooks is not yours.

OWNS:
  pages/portal-v2-sop-hub.tsx (new)
  the four new category pages
  their new data and model modules

MUST NOT TOUCH: PortalV2Shell.tsx, pages/portal-v2-runbooks.tsx,
components/portal-v2/RunbookSteps.tsx, components/portal-v2/holds/*, or any
other page. Add your nav rows to portalV2Nav.ts and your routes at the marker in
App.tsx, in the same change.

Copy is final — reproduce it verbatim, never rewrite or shorten it, and no
emoji. Run the standing gate in the plan: fidelity audit before and after, tsc,
npm test, npm run build with PORT and BASE_PATH set, and manifests run via
shaneapp://runTest. Report what you compared against visually.
```

---

# Part 7 — Governance: PII Governance + Security Plan

**Now: 0% and 0%.** Neither exists.
**Design:** shell 4106-4258 · 4258-4345

```
Take Part 7 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 7 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

THIS PHASE IS UI ONLY. Mock data is expected — use the design's own fixture
values from its logic class. Do not wire up data sources, and do not leave a
section out because there is no real data behind it. A later pass does the
wiring. Keep fixtures in one data module per page, never inline in a .tsx.

YOUR JOB: build two Governance pages that do not exist at all. Both measure 0%
of their design copy — nothing of either has ever been built.

Design sources, in Design/design_handoff_customer_portal/Customer Portal
Shell.dc.html — read the markup AND the logic class at the bottom of the file,
and ignore support.js entirely:
  PII Governance  lines 4106-4258
  Security Plan   lines 4258-4345

PII Governance copy includes "PII governance", "Answers for personal data",
"What it looks for", "Where it was found", "Who can reach it", "What a finding
is wired into", "Add a pattern", "Raise the change to fix it", "Accept it as a
decision".

Security Plan copy includes "The authoritative record of how this tenant must be
configured, monitored, governed and changed. Every requirement points at the
module that proves it" and "Version history".

PII Governance carries a nav badge in the design's navGroupDefs — the string is
"3 exposed". Wire it through the nav registry portalV2Nav.ts that Part 0
created, the same way the Active Runbooks hold badge works.

Both pages belong in the GOVERNANCE nav group, which already exists and
currently holds Ownership and Risk Register. The design's full Governance group
is Ownership, Risk Register, Security Plan, PII Governance — in that order. Put
your two rows in the right positions.

OWNS:
  pages/portal-v2-pii.tsx (new)
  pages/portal-v2-security-plan.tsx (new)
  their new data and model modules

MUST NOT TOUCH: PortalV2Shell.tsx, or any other page. Add your nav rows to
portalV2Nav.ts and your routes at the marker in App.tsx, in the same change.

Copy is final — reproduce it verbatim, never rewrite or shorten it, and no
emoji. Run the standing gate in the plan: fidelity audit before and after, tsc,
npm test, npm run build with PORT and BASE_PATH set, and manifests run via
shaneapp://runTest. Report what you compared against visually.
```

---

# Part 8 — Projects

**Now: 9%.** No route.
**Design:** shell 1231-1495

```
Take Part 8 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 8 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

THIS PHASE IS UI ONLY. Mock data is expected — use the design's own fixture
values from its logic class. Do not wire up data sources, and do not leave a
section out because there is no real data behind it. A later pass does the
wiring. Keep fixtures in one data module per page, never inline in a .tsx.

YOUR JOB: build the Projects page. It does not exist — no route, no file — and
carries 9% of its design copy.

Design source: Design/design_handoff_customer_portal/Customer Portal
Shell.dc.html lines 1231-1495. Read the markup AND the logic class at the bottom
of the file; ignore support.js entirely.

Missing copy includes "Fixed-scope project · SOW-2026-0114", "A defined scope
with a start, five phases and an end. This page answers two questions: how much
of the contracted scope is done, and whose move it is.", "Priya Raman · delivery
lead", "4 Aug – 26 Sep 2026 · fixed fee $14,800", "Day 19 of 53 · next report
Friday", "Waiting on you", "Nothing overdue on our side", "Scope delivered",
"Contracted deliverables accepted", "Tasks closed".

TAKE OWNERSHIP OF AN EXISTING FIXTURE. The Overview page already ships
OV_PROJECT_PHASES and the gantt geometry (PJ_SPANS, PJ_SLIPS, PJ_WIN, PJ_TODAY,
PJ_WEEKS, PJ_CONTRACT_END, PJ_PHASE_TONE) in
components/portal-v2/overviewData.ts, all extracted from the prototype's own
PJ_PHASES. Move that into your Projects data module, widen it to the full field
set the page needs, and have overviewData import it. Do not fork a second copy
of the phases — the Overview's mini-gantt and this page's full one must agree.
components/portal-v2/overviewModel.ts has the pjRows/pjPct derivation and its
tests; reuse rather than reimplement.

Also reuse buildGanttLayout / PhaseGanttChart from
components/copilot-journey/StatementOfWorkBody.tsx if they fit — read them
before writing a third gantt.

ROUND TWO ITEM 6 APPLIES HERE, and it is the reason this part is called out: the
Projects Gantt and the 5-lane task board must be FLUID. No fixed min-width
floor, no overflow-x wrapper. The board wraps its lanes with auto-fit rather
than scrolling.

OWNS:
  pages/portal-v2-projects.tsx (new)
  its new data and model modules
  components/portal-v2/overviewData.ts and overviewModel.ts — ONLY to move the
    project fixture and geometry out and import them from their new home

MUST NOT TOUCH: PortalV2Shell.tsx, pages/portal-v2-overview.tsx, or any other
page. Add your nav row to portalV2Nav.ts and your route at the marker in
App.tsx, in the same change. Projects is UNGROUPED in the design's nav, above
the Pillars group, beside My Architect.

Copy is final — reproduce it verbatim, never rewrite or shorten it, and no
emoji. Run the standing gate in the plan: fidelity audit before and after, tsc,
npm test, npm run build with PORT and BASE_PATH set, and manifests run via
shaneapp://runTest. Report what you compared against visually.
```

---

# Part 9 — My Architect + Copilot

**Now:** 19% and 10%. Neither has a route.
**Design:** shell 1981-2199 · 6093-6203

**This part closes a hole the Overview rebuild opened:** the design's overview
has no gate band, so the Copilot gate currently has **no surface anywhere** in
the portal until this page exists.

```
Take Part 9 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 9 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

THIS PHASE IS UI ONLY. Mock data is expected — use the design's own fixture
values from its logic class. Do not wire up data sources, and do not leave a
section out because there is no real data behind it. A later pass does the
wiring. Keep fixtures in one data module per page, never inline in a .tsx.

YOUR JOB: build two pages that do not exist. My Architect carries 19% of its
design copy and Copilot 10%; neither has a route.

Design sources, in Design/design_handoff_customer_portal/Customer Portal
Shell.dc.html — read the markup AND the logic class at the bottom of the file,
and ignore support.js entirely:
  My Architect (retainer)  lines 1981-2199
  Copilot readiness        lines 6093-6203

THE COPILOT PAGE IS URGENT FOR A SPECIFIC REASON. The Overview was rebuilt to
the current design, and the design's overview has no Copilot gate band — so the
gate currently has NO SURFACE ANYWHERE in the portal. This page is where it
lives now.

The Copilot page MUST reuse the real gate constant COPILOT_GATE_TARGET from
components/copilot-journey/journeyTokens.ts. It is mirrored server-side in
copilot-gate.ts and each side is asserted by its own test — change one and you
must change and re-test both. Do not hardcode 82.

Copilot copy includes "Copilot readiness · standalone offer", "Copilot inherits
every permission, label and retention rule you already have. This page is the
assessment verdict: where the tenant stands, what each gap costs, and what
clears it.", "Copilot gate today", "of 82 · not safe to deploy", "clears the
gate · +27 points", "What each pillar is worth once remediated", "Assessed 3
August 2026 · 150+ signals via Microsoft Graph, read-only", "What the assessment
produced".

My Architect copy includes "My Architect · August 2026", "8 hours a month with a
named architect. Every hour below is attached to the work it went into and,
where there is one, the finding it closed.", "Priya Raman · M365 Architect",
"$2,400/mo · next status report Friday", "Time this period", "Logged per work
item · running total", "Retained monthly", "Rolled from July", "27 August ·
Connect upgrade". Its retainer-hours ledger is greenfield — no ledger exists
anywhere in the repo, so build the UI from the design's fixture.

Both pages are UNGROUPED in the design's nav, above the Pillars group. Copilot
has its own nav group carrying the live gate score as a pill ("41 / 82").

OWNS:
  pages/portal-v2-retainer.tsx (new)
  pages/portal-v2-copilot.tsx (new)
  their new data and model modules

MUST NOT TOUCH: PortalV2Shell.tsx, pages/portal-v2-overview.tsx, or any other
page. Add your nav rows to portalV2Nav.ts and your routes at the marker in
App.tsx, in the same change.

Copy is final — reproduce it verbatim, never rewrite or shorten it, and no
emoji. Run the standing gate in the plan: fidelity audit before and after, tsc,
npm test, npm run build with PORT and BASE_PATH set, and manifests run via
shaneapp://runTest. Report what you compared against visually.
```

---

# Part 10 — Ownership + Microsoft Changes top-up

**Now:** 34% and 23%. Both built recently, both partial.
**Design:** `Ownership.dc.html` · `Microsoft Changes.dc.html`

```
Take Part 10 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 10 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

THIS PHASE IS UI ONLY. Mock data is expected — use the design's own fixture
values from its logic class. Do not wire up data sources, and do not leave a
section out because there is no real data behind it. A later pass does the
wiring. Keep fixtures in one data module per page, never inline in a .tsx.

YOUR JOB: finish the Ownership and Microsoft Changes modules. Both were built
recently and both are partial — Ownership carries 34% of its design copy and
Microsoft Changes 23%. The core of each works; whole secondary surfaces are
missing, and each page's file header already lists what was deferred.

Design sources — read each whole, markup AND the logic class at the bottom;
ignore support.js entirely:
  Design/design_handoff_customer_portal/Ownership.dc.html (1,269 lines)
  Design/design_handoff_customer_portal/Microsoft Changes.dc.html (2,176 lines)

OWNERSHIP is missing the assign slide-over's own surface ("Assign to more",
"Mark accepted", "Who held it before", "Leave unassigned — record it as a gap"),
the add-a-row flow ("Add something to the matrix", "Anything that can go wrong
and needs a name against it. It arrives with four gaps, which is honest — it is
what you had before the row existed.", "What kind of thing is it", "The detail
underneath"), delegation and handover, and "What ownership drives". Note the
assign flow currently uses the shared FormDrawer rather than the design's own
slide-over — read OwnershipMatrix.tsx's header for why, and decide deliberately.

MICROSOFT CHANGES is missing "Did this release?" (the retrospective), the
seen-in-the-wild list, the per-group impact panel (GROUPS), the thread / snooze
/ decision overlays, the workload filter rail, and copy including "Microsoft
ships in waves. Pick a wave and this page becomes that wave.", "Export a board
briefing", "Digest settings", "Next 12 months", "Brief this wave", "What your
people will see", "Decide before it lands", "Nothing in this wave stops working
here.", "No decision closes in this wave. Nothing here expires while you wait."

Keep what already works: the density grid's rows are deliberately fluid
(Round Two item 6) while the wave band above them keeps its overflow-x and
min-width, because the prototype still carries both. Do not "fix" the wave band.

OWNS:
  components/portal-v2/OwnershipMatrix.tsx
  components/portal-v2/ownershipData.ts, ownershipModel.ts, ownershipModel.test.ts
  pages/portal-v2-ownership.tsx
  pages/portal-v2-ms-changes.tsx
  components/portal-v2/msChangesData.ts, msChangesModel.ts, msChangesModel.test.ts
  test-manifests/portal/portal-v2-ownership.json
  test-manifests/portal/portal-v2-ms-changes.json

MUST NOT TOUCH: PortalV2Shell.tsx, pages/portal-v2-settings.tsx,
components/portal-v2/settingsData.ts, components/portal-v2/portalV2People.ts, or
any other page. The people list is SHARED STATE owned by Settings and read by
Ownership through a people prop and an onPeopleChange callback — keep that
contract exactly as it is.

Copy is final — reproduce it verbatim, never rewrite or shorten it, and no
emoji. Run the standing gate in the plan: fidelity audit before and after, tsc,
npm test, npm run build with PORT and BASE_PATH set, and both manifests run via
shaneapp://runTest. Report what you compared against visually.
```

---

# Part 11 — Drill-downs

**Now:** Security MFA 4% · Security CA 40% · Evidence 33% · Compliance
gaps 75% / decisions 60% / obligations 60% · Governance list/drift/inventory.

**Depends on Part 2** — `govPages.ts` belongs to Part 2, so run this after it.

```
Take Part 11 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 11 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

THIS PHASE IS UI ONLY. Mock data is expected — use the design's own fixture
values from its logic class. Do not wire up data sources, and do not leave a
section out because there is no real data behind it. A later pass does the
wiring. Keep fixtures in one data module per page, never inline in a .tsx.

YOUR JOB: build the drill-down pages. Most do not exist; the rest are partial.

Design sources, in Design/design_handoff_customer_portal/Customer Portal
Shell.dc.html — read the markup AND the logic class at the bottom of the file,
and ignore support.js entirely:
  Security MFA             lines 4816-4975   (4%)
  Security CA              lines 4975-5041   (40%)
  Evidence                 lines 5041-5204   (33%)
  Compliance gaps          lines 4659-4732   (75%)
  Compliance decisions     lines 4732-4783   (60%)
  Compliance obligations   lines 4783-4816   (60%)
  Governance list/drift/inventory  lines 5871-5961

FOLLOW THE REFERENCE IMPLEMENTATION. The handoff README names the Overshared
SharePoint page (governance-oversharing-full) as the drill-down template, and it
is already built at pages/portal-v2-gov-oversharing-all.tsx. Every drill-down
follows the same shape: purpose paragraph -> Graph API provenance block (which
endpoint, what was read, when) -> stat cards with sparkle icons -> expandable
evidence table -> tenant-policy block -> wrench fixes tied to named playbooks.
Read that page first, then build to the same template.

Evidence copy includes "Every number on this page traces to one of these
queries." and "For the page you are on".

OWNS: a new pages/portal-v2-* file per drill-down above, plus their new data and
model modules.

MUST NOT TOUCH: components/portal-v2/govPages.ts — that file belongs to Part 2.
If a drill-down needs a change there, STOP and tell me rather than editing it.
Also do not touch PortalV2Shell.tsx or any pillar page. Add your routes at the
marker in App.tsx. These are drill-downs reached from their pillar pages, so
they do NOT get their own top-level nav rows — check the design's nav before
adding any.

Copy is final — reproduce it verbatim, never rewrite or shorten it, and no
emoji. Run the standing gate in the plan: fidelity audit before and after, tsc,
npm test, npm run build with PORT and BASE_PATH set, and manifests run via
shaneapp://runTest. Report what you compared against visually.
```

---

# Part 12 — Account settings

**Now:** Billing 17% · Webhooks 4% · Account security 7% · Alert prefs 12% ·
Receipt 13%. Reached from the account menu, so it pairs naturally with Part 1.

```
Take Part 12 of PORTAL_V2_PARALLEL_PLAN.md in the repo root. Read everything in
that file above "Part 0", then the Part 12 section. Do not read or work on any
other part.

Read CLAUDE.md first and follow it — especially the session bookends (IN FLIGHT
row before any code change, DONE row after), and the shared-file write
discipline for PLATFORM_BUILD.md.

THIS PHASE IS UI ONLY. Mock data is expected — use the design's own fixture
values from its logic class. Do not wire up data sources, and do not leave a
section out because there is no real data behind it. A later pass does the
wiring. Keep fixtures in one data module per page, never inline in a .tsx.

YOUR JOB: build the five account-settings pages. None exists.

Design sources, in Design/design_handoff_customer_portal/Customer Portal
Shell.dc.html — read the markup AND the logic class at the bottom of the file,
and ignore support.js entirely:
  Account security     lines 2199-2371   (7%)
  Billing              lines 2371-2520   (17%)
  Webhooks             lines 2520-2722   (4%)
  Alert preferences    lines 2722-2875   (12%)
  Receipt              lines 6013-6093   (13%)

These are reached from the ACCOUNT MENU, not the left nav — the design puts them
there and the existing Settings page already follows that pattern at
/portal-v2/settings. Do not add left-nav rows for them.

Account security copy includes "Your login to this portal — not your Microsoft
365 tenant. Tenant findings live under the six pillars. This page is about the
one account that reaches them."

A CONFLICT TO FLAG, NOT TO STALL ON. The shell contains TWO tier ladders for
billing and no changelog mentions it:
  BILL_TIERS      (shell line 15478) — Foundation 690 / Growth 1180 / Premier 2350
  BILL_TIER_CARDS (shell line 15510) — Foundation 690 / Growth 1180 / Command 1980, no Premier
Both render on the billing page, and they disagree on the third tier's NAME and
PRICE. Since this phase is UI only, build both surfaces as the design draws them
and raise the conflict in your report. Which ladder is authoritative is Shane's
call and has to be settled before this page carries real prices — not before the
UI exists.

Billing reuses the live Stripe integration in a later wiring pass; do not wire
payments now.

OWNS:
  pages/portal-v2-billing.tsx (new)
  pages/portal-v2-receipt.tsx (new)
  pages/portal-v2-webhooks.tsx (new)
  pages/portal-v2-alert-preferences.tsx (new)
  pages/portal-v2-account-security.tsx (new)
  their new data and model modules

MUST NOT TOUCH: PortalV2Shell.tsx, pages/portal-v2-settings.tsx, or any other
page. If the account menu needs new entries and Part 1 has already rebuilt it,
STOP and tell me rather than editing the shell. Add your routes at the marker in
App.tsx.

Copy is final — reproduce it verbatim, never rewrite or shorten it, and no
emoji. Run the standing gate in the plan: fidelity audit before and after, tsc,
npm test, npm run build with PORT and BASE_PATH set, and manifests run via
shaneapp://runTest. Report what you compared against visually.
```

---

## Suggested wave order

```
Wave 1   Part 0                     (alone — creates the seams)
Wave 2   Part 1 · 3 · 8 · 9         (shell systems + easiest pillars + the two named-missing pages)
Wave 3   Part 2 · 4 · 5 · 7         (pillar redesigns + the biggest gap + the zero-coverage pages)
Wave 4   Part 6 · 10 · 11 · 12      (SOPs, top-ups, drill-downs, account)
```

Wave 2 is the one that most directly answers what was reported as missing: the
top shell, Projects, and My Architect.

**Part 11 must come after Part 2** (`govPages.ts` ownership).
**Part 12 pairs with Part 1** — the account menu is Part 1's, the pages behind
it are Part 12's, so run Part 1 first or accept that Part 12 will stop and ask.
