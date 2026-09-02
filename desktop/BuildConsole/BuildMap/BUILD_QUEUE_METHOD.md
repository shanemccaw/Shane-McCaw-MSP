\# Build Queue Method — Source of Truth

&#x20;

\*\*Status: STANDING PROCESS, ALL EPICS.\*\* This is how every Feature gets built from this point forward, across the whole platform — not a ShaneBuilder-only convention. It applies equally to `#1485` Portal, `#1571` MSP/Portal Admin, `#1093` Marketing Website, `#1095` Admin Panel, `#1096` Application Core, and `#1202`/`#2198` Build Console/ShaneBuilder. Any chat, any session, any agent working this repo — regardless of which epic — follows this document. If a chat is about to file or dispatch work under a Feature and hasn't read this, it stops and reads this first.

&#x20;

\*\*The core failure this fixes:\*\* a well-designed build queue is worthless if only one or two things run at a time. Big, consolidated builds don't go right — they produce partial coverage (Git Panel landed \~30% of what was actually designed because 23 real behaviors got squeezed into 7 dispatches), they collide with each other on shared files, and they leave the rest of a Feature sitting undispatched in Backlog waiting on a bookend that only closes a fraction of the real scope. The fix is mechanical, not aspirational: \*\*every real unit of work gets its own issue, its own dispatch, and its own place in the queue.\*\*

&#x20;

This document covers two related but distinct starting points:

\- \*\*§3\*\* — turning a \*design doc or fresh spec\* into real Features and Issues (the ShaneBuilder worked example in §10).

\- \*\*§9\*\* — organizing an epic's \*existing, already-scattered work\* (loose issues, built-but-untracked code, in-progress features with no Feature parent) into the same real Feature structure. This is the one Portal, Marketing, and Admin Panel need.

Both converge on the same rules from §4 onward: real dispatch discipline, real chaining, real verification.

&#x20;

\---

&#x20;

\## 1. What a Feature is in Git

&#x20;

The real hierarchy is exactly three levels: \*\*Epic → Feature → Issue.\*\* Never four, never two.

&#x20;

\- \*\*Epic\*\* — a container for scope. No bookend, no branch, no DONE — it closes when its children close.

\- \*\*Feature\*\* — a real, scoped capability inside an Epic. Title convention: `Feature: <Name> (<app/epic suffix>)`. A Feature is itself a real GitHub issue, parented to its Epic via native sub-issues (not a label, not "Part of #N" in prose).

\- \*\*Issue\*\* — one real, buildable, closeable unit of work. Parented to its Feature via native sub-issues.

\*\*GATE is not a fourth tree level.\*\* GATE is a Feature-tier (Epic-tier, really) issue like any other (`#1281`-style), sitting at the same depth as its siblings, not above them.

&#x20;

\*\*Never nest an issue as a sub-issue of a parent in a different Milestone.\*\* Cross-milestone relationships use `blocked\_by` only.

&#x20;

\---

&#x20;

\## 2. What counts as a Feature — per Epic

&#x20;

The generic rule (§1) is "a real, scoped capability" — but what that means concretely is different per Epic. Get the boundary right before filing anything.

&#x20;

\### 2.1 Portal (`#1485`) — backwards build order, phase-gated Features

&#x20;

Portal is built in a fixed, non-negotiable phase order, and that order is part of the Feature's own structure:

&#x20;

1\. \*\*API endpoints\*\* — build the real backend, validate the data is real and correct.

2\. \*\*Contract pack\*\* — extracted from the real, finished endpoints (`docs/{module-name}-contract-pack.md`), delivered to Design. A contract pack written before the endpoints exist documents absence, not the real module — never write it early.

3\. \*\*Design\*\* — Design produces the UI based on the real contract.

4\. \*\*UI build + wire\*\* — implement and wire the exported design against the real endpoints.

5\. \*\*Test + complete.\*\*

A Portal Feature's five phases are real sequential Issues (or Issue groups) inside that Feature — phase 2 is `blocked\_by` phase 1's completion, phase 3 needs the real contract pack delivered, phase 4 needs a real Design export (no export = no design, say so and stop), phase 5 needs a working build.

&#x20;

\### 2.2 MSP / Ops Portal (`#1571`) — derived from Portal, not independent

&#x20;

Every Feature here is derived from a real Portal Feature, defined by what admin CRUD/management that Portal Feature needs. Example: Portal has a Project view for customers → the matching MSP-side Feature is the admin CRUD and Kanban/workflow tooling needed to manage that same Project data.

&#x20;

Reference the corresponding Portal Feature explicitly in the new Feature's body. No clear Portal counterpart means the boundary is probably wrong — ask, don't invent one.

&#x20;

\### 2.3 Admin Panel (`#1095`) — two categories only

&#x20;

Every Feature is one of exactly two kinds, purely admin-function:

&#x20;

\- \*\*Configs\*\* — system-wide configuration surfaces (email templates, AI prompts, DLQ logs, etc.).

\- \*\*Tools\*\* — admin-only utilities (SQL Runner, JSON Viewer, Graph admin testing, etc.).

Tag which category a Feature is in its own body.

&#x20;

\### 2.4 Marketing Website (`#1093`) — Portal is the source of truth

&#x20;

Marketing Features are scoped by what Portal actually has, not by what would be nice to advertise. Check the real corresponding Portal Feature's actual state before writing content — content describing a capability that isn't real yet in Portal doesn't get built or shipped.

&#x20;

\### 2.5 Application Core (`#1096`) — the invisible engine layer

&#x20;

Engines, scanning, and the foundational processing work every other Epic's Features quietly depend on. Scoped by real subsystem/engine boundaries, not by which page triggers them. Real `blocked\_by` edges from a product-epic Feature to an Application Core Feature are common and expected.

&#x20;

\### 2.6 Build Console / ShaneBuilder (`#1202` / `#2198`)

&#x20;

Covered via the worked example (§10) and the BuildConsole freeze rule (§8).

&#x20;

\---

&#x20;

\## 3. Turning a Feature into real Issues

&#x20;

\### 3.1 Real audit before filing anything

&#x20;

A design doc, a Design pass, or a spec describes \*intent\*. It does not know what's already built. \*\*Before filing a single issue, check the real code.\*\*

&#x20;

\- Grep/read the actual files the Feature would touch.

\- Classify each described behavior as one of:

&#x20; - \*\*Already built, verified real\*\* — do not file an issue. Note it in the Feature's body as evidence (file:line), skip it.

&#x20; - \*\*Partially built\*\* — narrow the issue to the real remaining gap, not the whole described behavior.

&#x20; - \*\*Genuinely not built\*\* — file it as real new work.

\- If the doc's own claimed status doesn't match what the code shows, say so and go with the code, not the label.

\- If a source doc's scope reaches into a part of the app it has no real relationship to, \*\*stop and flag it\*\* rather than filing issues there.

\- \*\*Reset your local working tree before auditing.\*\* `git fetch` alone does not update checked-out files. Run `git fetch origin \&\& git reset --hard origin/main` before any code-based audit.

\### 3.2 Granularity — no huge builds

&#x20;

Break every Feature into the smallest real, independently-buildable, independently-closeable pieces. If a single dispatch's task description needs more than a handful of bullet points, it's too big and needs to split.

&#x20;

\### 3.3 The Feature issue's own body

&#x20;

Every Feature issue's body carries:

&#x20;

\- What it is (one or two sentences).

\- Which Epic-specific category it falls into if relevant (§2).

\- The real audit findings (built/narrowed/new).

\- A \*\*structured index\*\* — a checklist of every child Issue, one line each. Not optional.

\---

&#x20;

\## 4. Dispatching — every issue, no exceptions

&#x20;

\*\*When Shane says "build Feature X," every real sub-issue under that Feature gets:\*\*

&#x20;

1\. Its own real `BUILD:` comment (posted as a separate issue comment, never embedded in the body).

2\. Its own real `blocked\_by` edge(s) where a genuine dependency exists.

3\. A place in the queue — Batter Up if ready now, Backlog if gated on something not ready.

\*\*Do not consolidate multiple checklist items into one dispatch.\*\* Real dependency chains inside a Feature are fine and expected — but each downstream piece is still its own issue with its own dispatch.

&#x20;

\### 4.1 BUILD comment format

&#x20;

```

BUILD: model=<model> effort=<effort> buildSet=<name>

Posted: <UTC ISO8601>

&#x20;

\--model <model> --effort <effort> --title <issueNumber> --blocked-by <N>\[,<N>...]

&#x20;

<real, specific task description>

&#x20;

\## Standing rules

\- Pull #<N>'s full issue body AND all comments in order (later comments may supersede body)

\- If you discover a genuine finding/bug mid-build: parent it as a direct sibling sub-issue of #<Feature>

&#x20; (this issue's own Feature), NOT the Epic; label it `bug` (+ `security` if relevant);

&#x20; prefix title `URGENT:` only if it can't wait

\- Commit only your own changes on your own commit, push immediately after committing

\- Per-issue bookend at build-journal/<N>.md — IN FLIGHT first (own commit), DONE with real hash last (own commit)

\- Timestamp on this dispatch and on bookend status lines ("Posted: <UTC ISO8601>")

\- No fixture/hardcoded data

```

&#x20;

\- Full model ID strings only: `claude-sonnet-5`, `claude-opus-4-8`, `claude-fable-5`.

\- `--title` targets a single leaf issue, never an Epic or Feature.

\- `--blocked-by` only when a real dependency exists.

\### 4.2 buildSet naming

&#x20;

\- A Feature-tier issue's children use that Feature's own short name (PascalCase, no spaces, e.g. `Feature: Alerts and Critters` → `AlertsCritters`).

\- Non-Feature-tier infra with no Feature parent uses the app's blanket name (`ShaneBuilder`, `Portal`, `MSPPortal`, `AdminPanel`, `Marketing`).

\- `BuildConsole` is reserved for that app — see §8.

\### 4.3 Model/effort selection

&#x20;

\- Routine/small UI or copy changes → Sonnet 5, Low/Medium.

\- Everyday well-specified coding, most Feature work → Sonnet 5, Medium/High.

\- High-stakes, large-surface, or security/credential-adjacent work → Opus 4.8, High/xhigh.

\- Novel architecture, the hardest/most judgment-dependent work → Fable 5, High/xhigh.

Never default to the top tier without a reason.

&#x20;

\---

&#x20;

\## 5. Feature chaining — how the queue actually sequences

&#x20;

\### 5.1 Inside one Feature

&#x20;

Wire real `blocked\_by` edges only where a genuine dependency exists (a data-model change every downstream renderer needs, or Portal's phase order per §2.1). Everything else runs in parallel.

&#x20;

\### 5.2 Across Features, in priority order

&#x20;

Given an ordered list of Features, nothing in `F2` may launch until every real issue in `F1` has a verified DONE bookend. The cheap, correct version, avoiding a full `O(n·m)` cross-product of edges:

&#x20;

1\. \*\*Pick a sentinel\*\* for each Feature — the highest-numbered/last-filed issue is a fine consistent choice.

2\. \*\*Fan-in\*\*: wire that sentinel `blocked\_by` every \*other\* issue in its own Feature.

3\. \*\*Cross-feature gate\*\*: wire \*every\* issue in the next Feature `blocked\_by` the previous Feature's sentinel.

This is `O(n)` per transition and exact — the sentinel is provably the last thing in its Feature to clear.

&#x20;

\### 5.3 Manual cutover points

&#x20;

Some transitions need a human confirmation, not just an automatic bookend check:

&#x20;

\- Wire the real `blocked\_by` edge anyway — it's still a real technical floor.

\- \*\*Leave the gated Feature's issues in Backlog, not Batter Up.\*\* Batter Up auto-launches on refresh; Backlog waits for a human to move it.

\---

&#x20;

\## 6. Board status — what each column means

&#x20;

\- \*\*Batter Up\*\* — approved, ready to run. Auto-launches on refresh, subject to real `blocked\_by` edges clearing.

\- \*\*Backlog\*\* — held. Requires a human to move it. Use for anything not ready, or a manual cutover gate (§5.3).

\- \*\*AI Batter Up\*\* — a genuine agent-discovered finding, ready to dispatch on a plain yes/no.

\- \*\*Ask Shane\*\* — a real open question or decision with no proposed build attached.

\---

&#x20;

\## 7. Closing out — verification, not trust

&#x20;

Never accept a "done" claim without checking the real repo:

&#x20;

1\. `git fetch --unshallow` before any claim about `main`.

2\. `git merge-base --is-ancestor <sha> origin/main` — confirms the commit is really merged.

3\. `git show origin/main:build-journal/<N>.md` — confirms both IN FLIGHT and DONE entries are present.

4\. `git status --porcelain` clean is part of a valid DONE bookend.

5\. Only then close — via GraphQL `closeIssue` with a real `stateReason` (`COMPLETED` or `NOT\_PLANNED`; REST PATCH cannot set this). `NOT\_PLANNED` always carries a real explanatory comment.

A real finding discovered mid-build gets parented as a direct sibling of its own Feature (never the Epic), labeled `bug` (+ `security` if relevant), `URGENT:` title prefix only if it can't wait.

&#x20;

\---

&#x20;

\## 8. BuildConsole is frozen — genuine fixes only, nothing more

&#x20;

`desktop/BuildConsole` is frozen to new feature work. ShaneBuilder is replacing it entirely — no Feature, no enhancement, no "while we're in there" scope ever lands there. The \*\*one narrow exception\*\*: a genuine bug fix, something actually broken right now. Nothing else.

&#x20;

\- It fixes something currently broken, not something that could be nicer.

\- No new capability/UI/behavior beyond restoring the correct one.

\- Any real doubt whether it's a fix vs. an enhancement → treat as enhancement, file as ShaneBuilder's own future requirement instead.

A genuine fix still follows every rule in this document — its own issue, its own dispatch, `buildSet=BuildConsole`, real verification before closing.

&#x20;

\---

&#x20;

\## 9. Organizing an existing Epic's work into Features

&#x20;

This is the path for an Epic that already has real work — shipped code, in-progress issues, a scattered backlog — with no Feature tier yet. This is the situation for Portal, Marketing, and Admin Panel right now.

&#x20;

\### 9.1 Find the real Feature boundaries first

&#x20;

Walk the Epic's actual surface — real routes/endpoints, real pages, real modules — using that Epic's own definition from §2. Read the real code (`artifacts/portal`, `artifacts/msp-website`/`artifacts/shane-mccaw-consulting`, `artifacts/admin-panel`, or the equivalent), not issue titles alone.

&#x20;

\### 9.2 Sort every existing open issue

&#x20;

For every open issue under the Epic with no Feature parent:

&#x20;

\- \*\*Belongs to a real Feature boundary\*\* → re-parent it under that Feature (native sub-issue). Don't close-and-refile just to move it — only when the issue's own scope is genuinely superseded or wrong.

\- \*\*Real work, no fitting Feature\*\* → define a new Feature, or if it's a genuine one-off, leave it a direct Epic child.

\- \*\*Stale/superseded/already-done-but-open\*\* → verify against real code/git history (§7) before deciding; close properly rather than silently re-parenting dead work.

\### 9.3 Audit what's already built before filing new Issues

&#x20;

Same discipline as §3.1 — check what part of the Feature's real boundary is already shipped before assuming the existing open issues represent the \*whole\* remaining scope. Don't trust issue count as a proxy for completeness.

&#x20;

\### 9.4 Write the Feature's structured index from the real, reconciled set

&#x20;

Same requirement as §3.3, built from the real reconciled list (re-parented issues + newly filed gaps), not transcribed from a spec.

&#x20;

\### 9.5 Then follow §4 onward, same as any other Feature

&#x20;

Dispatching, chaining, and closing follow exactly the same rules regardless of which Epic — §4, §5, §6, §7.

&#x20;

\---

&#x20;

\## 10. Worked example (2026-09-02, real — ShaneBuilder)

&#x20;

Priority order given: Test Pad → Build Matrix → Shot Vault → I have a thought → Favorites → Focus Mode → App Shell \& Chrome → Command Palette → WebTester UI → \*\*\[manual gate]\*\* → Build Queue (the cutover Feature).

&#x20;

\- Every Feature's real remaining issues (28, 7, 7, 5, 7, 10, 8, 3, 2 respectively) got dispatched individually — 77 real `BUILD:` comments, 77 real Batter Up placements.

\- Each Feature's sentinel (its highest-numbered issue) was fanned in on its own siblings, then the next Feature's full issue set was gated on that sentinel.

\- The final Feature (Build Queue) was left in \*\*Backlog\*\*, wired `blocked\_by` the last sentinel, because Shane wants to personally confirm the WebTester UI is "working and looks correct" before that cutover work starts — a manual gate, not an automatic one.

\- Where a Feature's real scope included items blocked on something outside the queue entirely (WebTester's three items needing screenshots from Shane), those stayed in \*\*Ask Shane\*\*, separate from the cascade.

