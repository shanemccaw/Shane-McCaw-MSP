# CLAUDE.md

Instructions for Claude Code sessions working in this repository.

## Mandatory task planning & explicit progress reporting

Every session — including BuildConsole-launched build sessions — must report concrete progress milestones as work advances.

### Explicit Progress Reporting (`shaneapp://reportProgress` / `report-progress.mjs`)
Rather than relying on brittle free-form text inference, agents explicitly report structured progress at major milestones (e.g. Investigation, Implementation, Verification).

**How to call:**
```bash
node scripts/report-progress.mjs <buildId> <step> <total> "<phase description>"
```
or via the protocol:
```
shaneapp://reportProgress?buildId=<id>&step=<N>&total=<M>&label=<description>
```

**Minimum phase checkpoints — a template to adapt, not a literal script.** These three
are the floor, not the whole plan. Derive your actual `step`/`total`/label from your own
real work breakdown for *this* task — a session with more genuine phases reports more of
them (`total` isn't pinned to 3), and a label should describe what you're actually doing,
not just repeat these examples verbatim:

1. **Investigation** — understand the problem before changing anything, e.g.
   `node scripts/report-progress.mjs <id> 1 3 "Investigation & Discovery"`
2. **Implementation** — the core code change, e.g.
   `node scripts/report-progress.mjs <id> 2 3 "Core Implementation"`
3. **Verification** — confirm the change actually works, e.g.
   `node scripts/report-progress.mjs <id> 3 3 "Verification"`. This does **not** mean
   "write a test manifest" — `desktop/BuildConsole` (the WPF app) is explicitly out of
   scope for test manifests (see the Test Coverage section below), so a BuildConsole
   session's verification phase is normally a clean build, a real/simulated run, or a
   manual check, not a manifest. Use whatever real verification your task actually calls
   for and label it plainly (e.g. `"Verification & Build"`, `"Verification & Manual QA"`).

**Call it again at EVERY phase change — not just once (Git #1206).** The panel only advances when a report arrives, so reporting a single early step and then going quiet leaves Build Watch **frozen on that phase** while real work continues — it looks stalled even though it isn't. Re-report at each real transition (bump `step`, update `label`) to match your own checklist as it genuinely advances — at minimum the checkpoints above, more if your task actually has more phases. Keep it to major phases (not noisy per-line spam), but definitely **more than once**, and always send a **final** call with `step == total` (e.g. `... <id> 3 3 "Verification"`) so the panel reaches 100% instead of freezing mid-way.

BuildConsole displays this in Build Watch per-slot with visual progress bars, percentage, active phase card, and heuristic estimated time remaining. If a running build reports nothing new for a few minutes, the phase card now shows a soft "⚠ No progress update in Xm" notice — a cue that this reporting has gone quiet, not that the build is stuck. That same staleness window is also what lets Build Watch's checklist-derived fallback (Git #1251) resume advancing the panel from your visible checklist if your own explicit calls go quiet for that long (Git #1799) — another reason to keep re-reporting at real transitions rather than relying on one early call to hold the display.

## Customer Portal build — design source

**portal-v2 and `Design/design_handoff_customer_portal/` are retired.** Do not build
against them, do not treat their pages as a baseline, and do not copy their fixture
modules. The replacement effort is Epic #1485 (Portal New Design); read #1485 and the
module's own page epic before starting portal work. The one thing carried forward from
portal-v2 is the API surface under `artifacts/api-server/`, which is real.

**Live design source for #1485: `Design/portal/`.** New Claude Design exports land there as
`.dc.html`, one per page, alongside that module's contract pack markdown. A page has no design
until its `.dc.html` exists in `Design/portal/` — if you are asked to wire a page and no export
is there, say so and stop rather than wiring `portal-v2` by default. `portal-v2` is not a
fallback target.

Order of work under #1485 is fixed: **architect → build the endpoints → regenerate the contract
pack from the real code → Design → wire.** Do not run the steps out of order. A contract pack
written before the endpoints exist documents absence and is worthless; a design drawn against
endpoints that do not exist yet is what caused five failed portal attempts.

The conventions below apply to any `.dc.html` export, in `Design/portal/` or elsewhere:
- The accompanying README.md, where one exists, is the spec. Read it before writing code.
- The .dc.html files are design references, not code. Recreate them with this
  repo's existing React + Vite + Tailwind v4 + shadcn/ui (new-york) + lucide-react
  patterns. Ignore support.js entirely — do not port it.
- The logic class at the bottom of a Shell export holds the state machine and data
  shapes. Read it; it is the specification.
- Copy is final. Do not rewrite, shorten or "improve" any user-facing string.
- No emoji, ever. Icons come from lucide-react.
- Every number on screen comes from the data layer, and the data layer is a real
  endpoint. **Do not create a `*Data.ts` fixture module "in one place so it can be
  swapped later."** That instruction produced ~1,150 fake rows across 29 modules in
  portal-v2 and cost months; the swap never happens. If the endpoint does not exist
  yet, build it (see the HARD RULE below), then read from it.

## Mandatory session bookends

This project tracks every work session in a **per-issue bookend file** under
[`build-journal/`](build-journal/), so that even a session that crashes or gets
abandoned mid-way leaves proof an attempt was made.

**One file per issue. One writer per file. No shared append, ever.** Each session
writes `build-journal/<id>.md` — `<id>` is the GitHub issue number (e.g.
`build-journal/1371.md`), or the base-26 letter id for `--notGit` local work. Because
no two sessions write the same file, concurrent sessions can never clobber each
other's bookend rows — the Git #1267 collision class is structurally gone. The old
single shared files (`PLATFORM_BUILD.md`, `desktop/BuildConsole/BUILD_LOG.md`) are
**frozen archives**; do not append to them. There is **no product-vs-BuildConsole
split** anymore — everything bookends in `build-journal/`; note which side you touched
in the file's `Scope:` line. See [`build-journal/README.md`](build-journal/README.md)
for the full format; a session touching several issues writes one file per issue.

### Step 1 — first thing the session does, before any other work

Create `build-journal/<id>.md` for the work you're about to do, with `Status: ⏳ IN
FLIGHT` and an opening `Log` line (use the template in `build-journal/README.md`).
**Every status line carries a UTC ISO 8601 timestamp alongside the status (Git
#2131)** — not just once at file creation, but on every status transition, since a
bookend can be edited more than once in one session:

```
- **Status:** ⏳ IN FLIGHT 2026-08-31T23:23:47Z
- **Scope:** platform | buildconsole | both
```

The same applies to `desktop/BuildConsole/BUILD_LOG.md` for BuildConsole's own work,
and to a `🛑 BLOCKED` status line, if one is ever written. This exists so a fresh
session (or Shane) can tell at a glance whether a status is current or a stale
leftover re-read as current state — the same real confusion #2131 traces to #1511
and #1522.

Commit that single new file immediately, as its own small standalone commit — not
bundled with the real work that follows. A plain `git add build-journal/<id>.md &&
git commit` is safe: this file is yours alone, so no re-read/CAS discipline is needed.

### Last step — after all real work is done, tested, and typechecked

**Before writing DONE, verify your own branch's HEAD is actually an ancestor of
`main` (Git #1447).** A live check across 12 `agent/*` branches (the #1434
follow-up) found several sitting with unmerged commits main never got, with
nothing catching it — the branch *looked* done because a session had claimed it
was, not because the commits had actually landed. Run:

```
node scripts/dev-server/verify-branch-merged.mjs
```

(or `git merge-base --is-ancestor <branch> main` directly). Exit code 0 means the
branch is genuinely merged — safe to write DONE. Exit code 1 means it is not: do
**not** write DONE. Either retry the merge/push and re-run the check, or write an
honest `MERGE-BLOCKED` / still-`⏳ IN FLIGHT` bookend state instead, and say so
explicitly in the completion comment — never silently claim DONE while orphaned.

**Also before writing DONE: `git status --porcelain` must be clean** of anything you touched
(see "Leave the working tree clean" under Git conventions). Uncommitted modified files are as
disqualifying as an unmerged branch — both leave Shane to discover the mess. If files you did not
touch were already dirty when you arrived, name them in the completion comment and leave them.

Once verified, flip that file's status to:

```
- **Status:** ✅ DONE 2026-08-31T23:58:00Z
```

fill in the real commit hash(es) of the work, and append a `✅ DONE — …` log line
(itself timestamped, same as every other status line) recording what shipped and
the honest verification result. Commit that update — either as part of the final
commit or immediately after it.

If the work is abandoned, fails, or the session ends before this step, the file is
left at `⏳ IN FLIGHT` — that is the record. Do not go back and clean up or delete
other sessions' stale IN FLIGHT files.

## Mandatory: file every finding as its own GitHub issue

**A build that discovers a real problem and does not file it has lost the finding.** Mentioning
it in prose in the completion comment is not filing it. The open-issue count is how project size
is measured — a build that finds five real problems must be distinguishable from one that finds
none.

### Why you cannot file it under your own issue

When your build is verified, **your issue is closed** — that is how BuildConsole moves the card
from Verifying to Done. Anything recorded only on your issue disappears from the working set at
that moment. File findings as NEW issues, parented to the correct area epic.

### What counts as a finding

- A live endpoint the surface does not call
- A field, column or enum value the product plainly needs and does not have
- A bug you hit and worked around rather than fixed
- A test that was already failing before you arrived
- A stale comment, doc or issue body that contradicts the code
- Anything explicitly out of scope for your issue that you nonetheless proved is broken

Not a finding: a preference, a refactor you would have liked, or a gap you fixed in this build.

### Where it goes — area epic routing

Parent every new issue to the right area epic. Milestone 5 (v1.1). Pick by what the work touches,
not by which file you happened to be in:

| The work is... | Parent |
|---|---|
| Engines, workflow engine, PowerShell, Microsoft Graph, scanning, schema, auth, api-server internals | **#1096** EPIC: Application Core |
| AdminV2 / `artifacts/admin-panel` — platform admin, `/api/admin/*` | **#1095** EPIC: Admin Panel |
| BuildConsole, the WPF app, build queue, dev-server scripts | **#1202** Epic: Build Console |
| Customer portal — `/api/portal/*`, `/api/public/*`, `artifacts/portal` | **#1485** EPIC: Portal |
| MSP operator surface — `/api/msp/*`, per-customer delivery work | **#1571** EPIC: Portal Admin |
| Marketing site, `artifacts/msp-website`, `artifacts/shane-mccaw-consulting` | **#1093** EPIC: Marketing Website |
| Done in code, but needs Shane to verify or run something at release | **#1281** GATE: v1.1 release |

If a finding sits under a specific page or module epic (e.g. a Microsoft Changes gap belongs
under #1494, not directly under #1485), parent it there instead — the area epic is the fallback,
not the default.

**Manual SQL migrations are the exception** — they append a line to #1630, not a new issue. See
the `Shane To-Do` section.

### How

```
# create, with milestone 5 (v1.1)
gh issue create --title "<what is actually wrong>" --milestone 5 --body "<evidence, file:line>"

# parent it — integer id, NOT node_id
gh api repos/shanemccaw/Shane-McCaw-MSP/issues/<new> --jq .id
gh api -X POST repos/shanemccaw/Shane-McCaw-MSP/issues/<parent>/sub_issues -f sub_issue_id=<that id>
```

Write real evidence in the body — file:line, the query you ran, the actual output. A finding
filed as "this looks wrong" is not actionable later. Then **list every issue number you filed in
your DONE bookend**, so the trail from build to finding is readable without a search.

**You never close an issue** — not your own, not one you filed. Closing is Shane's call.

### A NOT_PLANNED closure always carries a real explanatory comment (Git #2167)

An issue was closed `NOT_PLANNED` with zero comment, and a later session found the bare
closure with no way to tell why — was it superseded, a duplicate, a decision that changed,
or a mistake? Nothing in the issue said.

**Any session/chat that performs a `NOT_PLANNED` closure must post a real comment on that
issue, in the same action, explaining the actual decision** — what changed, and what it's
superseded by if applicable. A silent `NOT_PLANNED` closure is never acceptable, the same
way a silent status-label flip elsewhere in this file is never acceptable. This is
independent of the "you never close an issue" rule above: if a closure happens at all —
by Shane directly, or by a session acting on his explicit instruction — it does not happen
without the comment.

### Board status — "AI Batter Up," not Backlog (Git #1708)

Every new issue you file under this section gets its project board status set to **"AI Batter
Up"** (option id `a0296971` on the Status field `PVTSSF_lAHOEiBDdc4BeoiYzhZBRB0`), not left at the
project's default. This is a genuinely different board status from "Batter Up" — landing here
triggers nothing; it is a review queue, not a launch queue. Shane reviews it and clicks Yes
(promotes to real "Batter Up," picked up on the next queue refresh) or No (demotes to "Backlog").
Never set "Batter Up" directly on a finding you filed yourself — only Shane's own Yes does that.

```
gh api graphql -f query='
  mutation {
    updateProjectV2ItemFieldValue(input: {
      projectId: "PVT_kwHOEiBDdc4BeoiY"
      itemId: "<the new issue''s project item id>"
      fieldId: "PVTSSF_lAHOEiBDdc4BeoiYzhZBRB0"
      value: { singleSelectOptionId: "a0296971" }
    }) { projectV2Item { id } }
  }'
```

## Mandatory: comment on the GitHub issue before finishing

Every session that works a real Git issue MUST post a comment on that issue before ending, no matter the outcome. This is not optional and is separate from the PLATFORM_BUILD.md bookend (which tracks build history) — the issue comment is what the next session or Shane will actually read.

Cover, honestly:
- What was actually done (real commits/hashes, or "no code changed")
- What was found, if this was investigation-only
- What's still blocking it, if it's not resolved — name the specific blocker (missing env var, needs Shane's decision, needs a migration run, etc.), not a vague "more work needed"
- What Shane needs to do, if anything, framed as a concrete next action

A session that lands nothing and says nothing on the issue leaves it indistinguishable from an issue nobody has looked at. A session that investigates, hits a real blocker, and stops without commenting wastes the next session's time re-discovering the same blocker. Post the comment even if the answer is just "investigated, found X, this needs your decision before I can proceed."

### GitHub issue label sync (same two moments as the bookend, when a Git issue is involved)

When the work is tied to a specific GitHub issue (referenced by number — e.g. `Git #684` — in the row you're about to append), keep that issue's labels in sync with the same two bookend moments. This is what drives the live status dot/overlay in Shane's BuildConsole desktop app (`desktop/BuildConsole/`, which replaced the old browser extension) — it reads these labels off the issue so he can tell at a glance whether something is actively being worked on or already confirmed done in code, without checking PLATFORM_BUILD.md or the git log himself.

Two labels, `in-flight` and `complete`. Create them once if they don't exist yet:

```
gh label create "in-flight" --color fbca04 --description "Claude Code is actively working on this"
gh label create "complete"  --color 0e8a16 --description "Confirmed done in code, awaiting Shane's review/close"
```

- **Step 1**, right alongside the IN FLIGHT bookend: `gh issue edit <number> --add-label "in-flight" --remove-label "complete"`
- **Last step**, right alongside the DONE bookend: `gh issue edit <number> --remove-label "in-flight" --add-label "complete"`

**Never close the issue as part of this.** `complete` means "the code is done and confirmed" — not "Shane has reviewed and signed off." Closing an issue stays a decision only Shane makes himself.

If the row has no Git # (the work isn't tied to a specific issue), skip this — there's nothing to label.

### "Shane To-Do" label — when the work leaves an action for Shane himself

Some finished work leaves something only Shane can do — run a manual SQL migration, restart a server, set an env var/secret, review something before it goes live. (Superseded the older `for-shane` label, which stays on old issues but is not used for new work going forward.)

```
gh label create "Shane To-Do" --color b60205 --description "An action Shane needs to take himself (run SQL, restart server, etc) - Claude applies this when done"
```

- **At the DONE bookend**, if the work leaves such an action: `gh issue edit <number> --add-label "Shane To-Do"`. Say plainly in the issue row what the action is.

- **EXCEPTION — manual SQL migrations are NOT `Shane To-Do`.** You run additive migrations
  against local PostgreSQL yourself, in-session (see the Database section). Local is therefore
  already current; only Replit/staging is not, and that is a release-time action, not a blocker.
  Do **not** label the issue `Shane To-Do` for a migration and do **not** mark it blocked. Instead
  append one line to the standing checklist on **#1630** (under the v1.1 release gate #1281):

  ```
  gh issue comment 1630 --body "- \`lib/db/migrations/manual/<file>.sql\` — #<issue> — <what it changes>"
  ```

  Record the filename in your own bookend as well, then finish normally. `Shane To-Do` is
  reserved for things only Shane can do that are genuinely not release-time — granting an Azure
  role, rotating a cert, exporting a design, a product decision.
- If the action is a manual SQL migration, reference the file's real repo-relative path in the issue body/comment somewhere — Shane's browser extension panel looks for a `lib/db/migrations/manual/*.sql` path in the issue body to offer a one-click "load into the floaty SQL Runner" action.
- **Never remove this label yourself.** Shane clears it (and closes the issue) himself once he's actually done the action — same reasoning as `complete` never auto-closing an issue.

### "blocked" label — when a session has to stop and wait on another build

Multiple builds sometimes run in parallel, and one genuinely can't proceed until another lands first (e.g. #782 needs #776's endpoint to exist first). Shane's own words: "one has to wait for another... and then I forget and it gets lost." This makes the wait — and exactly what it's waiting on — visible and structured instead of a comment buried in chat.

The `blocked` label already exists (`gh label list --search blocked` to confirm). Recording *what* it's waiting on uses GitHub's own real "blocked by" issue-dependency feature — not an invented convention, not a comment to parse, a real relationship GitHub tracks natively:

```
# Look up the blocking issue's real internal id (NOT its number) first:
gh api repos/shanemccaw/Shane-McCaw-MSP/issues/<blocking-number> --jq .id

# Then link it:
gh api -X POST repos/shanemccaw/Shane-McCaw-MSP/issues/<this-number>/dependencies/blocked_by -f issue_id=<that id>
```

**The moment a session realizes it's blocked** (not at the start — only once you actually hit the wall):
1. `gh issue edit <this-number> --add-label "blocked" --remove-label "in-flight"`
2. Set the real blocked-by dependency via the two commands above, pointing at the issue you're actually waiting on.
3. Leave a one-line comment on your own issue saying what you're waiting for and why, in plain language — the dependency link is structured data for tooling, the comment is for a human skimming later.
4. Stop there. Don't spin, don't guess at the blocker's shape, don't start unrelated work under the same issue — end the session/turn cleanly so it's obvious nothing further happened here until unblocked.

**Picking this back up later** (a fresh session, or the same one resuming): before doing anything else, check whether you were left blocked —

```
gh api repos/shanemccaw/Shane-McCaw-MSP/issues/<this-number>/dependencies/blocked_by
```

If that list is empty, or every issue in it is closed/`complete`-labeled, you're unblocked:
1. `gh issue edit <this-number> --remove-label "blocked" --add-label "in-flight"`
2. Remove the now-stale dependency link: `gh api -X DELETE repos/shanemccaw/Shane-McCaw-MSP/issues/<this-number>/dependencies/blocked_by/<that id>`
3. Say plainly in your first message that you found yourself unblocked and are resuming, then continue the actual work.

If it's still genuinely blocked (the dependency is still open and not `complete`), say so and stop again rather than guessing forward.

Shane's BuildConsole desktop app (`desktop/BuildConsole/`) reads both the label and the real dependency to show a blocked build nested under whatever it's waiting on, in a red box — and flags it a different color the moment that dependency clears, so he knows to go start it again without having to remember himself.

### A blocking conclusion must become a `blocked_by` edge, not just a comment (Git #1987)

**An agent that concludes work cannot proceed must make that machine-readable in the
same action.** A comment saying an issue is blocked, impossible, or waiting on a
decision is not sufficient — BuildConsole reads `blocked_by` edges, not prose. In one
pass:

1. File the real blocker as its own issue if it is not already one.
2. Wire the `blocked_by` edge from the blocked issue to it (the same
   `dependencies/blocked_by` POST used above).
3. **Remove any stale `blocked_by` edge that no longer reflects reality**, particularly
   one pointing at an issue that is closed or about to close — a closing blocker
   silently releases everything downstream.
4. Apply the `blocked` label and move the board status, but treat those as reporting,
   not the gate. Only the edge gates.

This is not hypothetical: on #1867, the only `blocked_by` edge pointed at #1847. A
comment titled "Blocked — the premise is false" landed on #1867 one second before
#1847 closed. Closing #1847 released the only edge, and #1867 dispatched anyway — the
blocking conclusion existed only as prose, the edge read clear, and the queue did
exactly what it was told. **A comment that says "blocked" while the edge says "clear"
is worse than saying nothing** — it creates a false record that the issue was handled
while the queue keeps treating it as ready.

## Mandatory worktree isolation (Git #1371 / #1372)

**Every build session works in its own isolated git worktree — never directly in the
shared checkout the dev server runs from.** This is now automatic and mandatory, not a
per-prompt request.

**Why:** up to ~8 concurrent sessions used to share one checkout with no coordination.
One session mid-edit (staged/uncommitted) while another commits, resets, or checks out
led to real, repeated data loss — working-tree reverts, staged-index bleed, whole
features silently deleted (Git #1267's thread documents six live recurrences in one
night). An isolated worktree per session removes the shared mutable state entirely.

**For a BuildConsole-launched build (the normal case): you don't have to do anything.**
BuildConsole provisions a fresh worktree off `origin/main` and launches you inside it
automatically (gated by the **`EnforceWorktreeIsolation`** setting, default ON; flip it
to `false` in `%AppData%\BuildConsole\settings.json` to fall back to the shared
checkout). Your `node_modules` + `lib/*/dist` are **junctioned** from the main checkout, not
re-installed — one shared copy, zero extra downloads even on a slow connection (#1372).
Just work and commit normally in your cwd. On completion BuildConsole merges your
committed changes into the dev-server checkout and cleans up your worktree for you.

**Getting work onto `origin/main` is still your job** (the dev-server merge-back only
makes the *local* dev server run your code). Commit in your worktree, then push to main
— rebasing onto the current `origin/main` and retrying if the push is rejected, since
main moves under concurrent load.

**For a session NOT launched by BuildConsole** (a direct `claude` invocation, or the
toggle is off), provision your own at the very start, before any edit:

```
node scripts/dev-server/provision-worktree.mjs <id> --link   # C:\wt\<id>, off origin/main, deps junctioned
# ...work + commit in C:\wt\<id>, push to origin/main as usual...
node scripts/dev-server/request-restart.mjs --agent <id>     # merge into the dev-server checkout + restart
node scripts/dev-server/cleanup-worktree.mjs <id>            # remove the worktree + its junctions + branch
```

The provisioner registers the worktree so the cleanup sweep (`cleanup-worktree.mjs
--sweep`, also the BuildConsole Home "🧹 Clean" button) never removes a live one while
its owning process is alive. See `scripts/dev-server/README.md` for the full mechanism.

## BuildConsole freeze policy — live app is bug fixes only (Git #2178)

**Live `desktop/BuildConsole` accepts genuine bug fixes and stability work only.
New features default to the new isolated project, `desktop/ShaneBuilder`, unless
Shane explicitly overrides that for the specific session he's in.** This has existed
as real practice since #2138, but until now it lived only in issue comments and chat
memory — never in the one document a live session actually reads. #2175 was scoped
for ShaneBuilder, got real-time redirected into live BuildConsole mid-session, and
the agent complied — correctly following the standing rule that a real-time
instruction overrides an issue's original scope, but with zero awareness the target
it was redirected onto is frozen for exactly this kind of work. 24 real
`MessageBox.Show` call sites across 15 live files got rewired before anyone caught
it.

This freeze is about **where new feature work lands**, not about touching live
BuildConsole at all — a real bug fix, a stability fix, or confirmed emergency work
(e.g. #2141's single-instance guard, which correctly targeted live BuildConsole
because it genuinely needed to run there) still goes there normally, no extra
confirmation required.

### The guard: a real-time redirect onto frozen ground still needs a real yes

A real-time instruction from Shane still overrides an issue's stated scope — that
capability is genuine and stays. But when a real-time redirect would move **new
feature work** (not a small, obviously-safe bug fix, not confirmed emergency work)
off its stated target and onto live BuildConsole, silently complying is wrong. The
agent must instead:

1. Name the conflict explicitly, in plain terms — e.g. *"this issue was scoped for
   ShaneBuilder; live BuildConsole is currently frozen for new features — confirming
   you want this built there instead?"*
2. Get a real, explicit yes from Shane before proceeding.

Only after that explicit confirmation does the redirect proceed. This does not slow
down a legitimate quick fix or genuine emergency work against live BuildConsole —
those were never in scope for this guard, and asking permission for them would just
be noise. It exists solely for the case where a redirect would quietly widen scope
onto ground that's supposed to be closed to exactly that kind of change.

## Build-prompt header convention (queued builds)

### `--title` must be a LEAF issue, never an epic

**A build targets one issue that a single commit can finish.** An epic is a container for
scope — it has no bookend, no branch and no DONE, because no commit completes it. An epic
closes when its children close.

If work needs doing and only an epic exists for it, **file the leaf sub-issue first**, then
dispatch against that number.

**Why this is a hard rule (2026-08-29):** thirteen contract-pack builds were dispatched with
`--title <module-epic>` — #1486, #1487, #1488, #1489, #1490, #1491, #1493, #1494, #1495,
#1595, #1597, #1598, #1616. Each wrote `build-journal/<epic>.md` with `✅ DONE`. The result:

1. Every module epic under #1485 read as complete while 87 of its 92 children were still open.
2. Acting on that, twelve of them were closed in a single sweep, hiding all their children.
3. A later re-dispatch against #1494 short-circuited — the agent pulled the epic, found its own
   DONE bookend and the artifact already on `main`, and correctly concluded there was nothing
   to do.

One wrong `--title` produced a board that lied, a mass closure, and a build that refused to run.

**If you are dispatched against an issue that has sub-issues, stop and say so** rather than
writing a bookend against it.

A queued build's prompt may start with a single leading line of `--flag value`
options that BuildConsole (`EditBuildPromptDialog` → `bt_build_queue`) parses off
the top before the real prompt body. The whole first line must be flags only, or
none are parsed (the line is treated as prompt text). Recognized flags:

| Flag | Meaning |
|------|---------|
| `--title <text>` | Build/queue title (a bare number is also read as the GitHub issue number). |
| `--model <id>` | Model override for the launched session (e.g. `claude-opus-5`). |
| `--effort <low\|medium\|high>` | Reasoning-effort size proxy. |
| `--cwd <path>` | Working directory the build runs in. |
| `--blocked-by <n,n,...>` / `--block-by <n,...>` | GitHub / local blockers that must clear before this build runs. |
| `--buildSet <name>` | **Build Set** — group this build with every other build sharing the same `<name>` so the local dev server restarts ONCE, after the whole set finishes, instead of once per build. |
| `--account <primary\|secondary>` | **Multi-account routing (Git #1416)** — which Claude account this build launches against. `secondary` runs Claude Code with `CLAUDE_CONFIG_DIR` pointed at the configured secondary config dir (Shane's overflow Pro account, set in BuildConsole Settings → General); omitted/`primary` uses the default account. Sequential overflow only — never concurrent, no automatic failover. Also selectable per-build via the Edit Build Prompt dialog's Account dropdown. |

### The `BUILD:` comment itself carries a `Posted:` timestamp (Git #2131)

The `--flag value` line above is the *last* line before the real prompt body. Above that sits the
`BUILD:` header line the comment opens with, and — as of #2131 — a mandatory second line right
under it:

```
BUILD: model=claude-sonnet-5 effort=medium buildSet=BuildConsole
Posted: 2026-08-31T23:23:47Z

--model claude-sonnet-5 --effort medium --title 2131 --buildSet BuildConsole

<the real, self-contained build prompt>
```

`Posted:` is UTC ISO 8601 (`<YYYY-MM-DDTHH:MM:SSZ>`), stamped at the moment the comment is
written. This exists so a fresh session — or Shane — can tell at a glance whether a `BUILD:`
comment is current or a stale leftover being re-pasted from an earlier run; old report text
getting re-read as current state caused real confusion on #1511 and #1522. A comment written
before this rule has no `Posted:` line — that's a legacy comment, not a parse failure; nothing
backfills it.

### `--buildSet` — when and why to use it

Shane routinely stacks 10-20 related builds in the queue, properly blocked by
their parents. Without grouping, every green build triggers a full teardown +
rebuild of all four local dev services (Marketing, Portal, Admin Panel, API
Server) — real memory/resource churn on his dev box. Put the **same**
`--buildSet <name>` on the header of every build in such a stack (use a **unique
name per wave**, e.g. `--buildSet enhanced-monitoring`) and the
`scripts/dev-server/` coordinator will:

- merge each member's committed changes into the shared dev-server checkout as it
  finishes, but **defer the restart** — no restart fires for an individual member;
- once **every** member of the set has completed, fire **exactly ONE**
  restart for the combined changes — and that restart is **selective** (only the
  services whose real code actually changed, see below) — then run the relevant
  tests **once** for the whole set.

Builds queued **without** `--buildSet` are unchanged — they keep the existing
per-build merge+restart+coalescing behavior. Use `--buildSet` only for a genuine
stack of related builds meant to go live together; a lone ad-hoc build doesn't
need it. See `scripts/dev-server/README.md` (“Build Sets”) for the full mechanism,
the failure/`close` backstop, and the `buildset.mjs status|close|drop` tools.

### Selective service targeting — a completed set rebuilds only what changed

The one restart a completed Build Set fires is **selective**, not a blanket
rebuild of everything. Shane's own words: *"I don't need all sites running at the
same time. I hardly use the Admin Center. No need for Marketing to be on when I'm
only working the Portal… The only thing that has to be on always is the API
server. If only the Portal code changes, why does API need a rebuild? It just
needs to be smarter to target its actual need."*

On completion the coordinator computes the set's **combined changed-file
footprint** (the union of each merged member's own changes) and maps those real
paths to services:

| Changed path | Service |
|--------------|---------|
| `artifacts/api-server/` | **API Server** (the one always-on service) |
| `artifacts/shane-mccaw-consulting/` | **Marketing** |
| `artifacts/admin-panel/` | **Admin** |
| `artifacts/msp-portal/` | **Portal** |
| `artifacts/msp-website/` | **Website** |
| `lib/`, `packages/`, root build config (`package.json`, `pnpm-*`, `tsconfig*`) | **shared → ALL services** |
| `test-manifests/`, `docs/`, `scripts/`, other non-shipped paths | **none** (no rebuild) |

Then it:

- rebuilds **only** the services whose code genuinely changed;
- keeps the **API Server always-on** — it is **never rebuilt just because a
  front-end changed**, only when API (or shared) code actually changed; if it
  isn't running, it is started;
- **doesn't spin up** a front-end the set didn't touch (that's the memory win —
  a Portal-only wave restarts only the Portal, not Marketing/Admin/Website);
- rebuilds/restarts **nothing** for a set that merged only non-service files
  (docs / test manifests / tooling);
- by default **never stops** an unrelated running front-end (so it can't yank a
  service Shane is using); opt into stopping unneeded front-ends with
  `DEV_SET_STOP_UNNEEDED=1` (the API server is never stopped).

Every decision — which services were determined to need a rebuild/start/stop, and
exactly which changed files drove it — is logged to
`<state-dir>/buildsets.log` (and mirrored into `cycles.log`). Ungrouped
(non-`--buildSet`) builds are unchanged: they still do a full restart via the
coordinator's `runCycle`. See `scripts/dev-server/README.md` (“Selective service
targeting”) for the full mechanism.

## Git conventions

- **Commit directly to `main`. Do not create a new branch**, unless explicitly told otherwise for a specific task. Branches in this project have repeatedly ended up orphaned/unpushed/unmerged, causing real work to be lost. `main` is the default target.
- **Commit only your own changes, on your own commit.** Never let your work get swept into or bundled with an unrelated concurrent commit, and never sweep unrelated uncommitted changes you find in the working tree into your own commit — if you find unrelated dirty files that aren't yours, leave them alone and report them rather than committing them.
- Commit message first line should be a plain descriptive name of the work (e.g. `Dashboard Metric Resolvers`, `resolveMspIdOrZero fix`) — no `IN FLIGHT`/`DONE` status prefixes in git history; those are for the session-naming convention used in chat, not commit messages.

### Leave the working tree clean — HARD RULE

**A session must not end with any tracked file it modified left uncommitted.** No exceptions,
including sessions that stop early, fail, get blocked, or are cancelled.

Every stray modified file becomes a merge conflict on Shane's next `git pull`, and with several
agents pushing to `main` he pulls constantly. This has cost a large share of his week, repeatedly.
A one-line config edit left dirty is not a small thing here.

Before the session ends — including on the failure path — run:

```
git status --porcelain
```

Then for every line it prints:

- **You changed it and it's part of your work** → commit and push it. If the work is incomplete,
  commit it anyway with an honest message saying so; an incomplete commit is recoverable, a dirty
  tree is not.
- **You changed it and it was a mistake or a scratch edit** → `git checkout -- <file>` to revert
  it. Do not leave it for someone else to discover.
- **You created it and it isn't part of the deliverable** (scratch scripts, dumps, logs, `.bak`
  files, ad-hoc query output) → delete it, or add it to `.gitignore` if that class of file will
  recur. Untracked scratch files count.
- **It was already dirty when you arrived and isn't yours** → leave it alone, and say so
  explicitly in your bookend comment naming the file. Do not commit it, do not revert it, do not
  stash it.

`git status --porcelain` returning empty (apart from pre-existing files you named in the bookend)
is a required condition for writing `DONE`, exactly like the ancestor check. A session that
verified its merge but left three modified files behind has not finished.

Never `git stash` as a way of ending a session. A stash is invisible to everyone else and to the
next session in that worktree; it hides the problem rather than closing it.

## Remote server access (SSH) — real, working, current

Direct SSH access to the Replit dev server is real and confirmed working end
to end (connection test, git fetch/pull, restart) — this supersedes any
earlier assumption that a build session has no way to reach the live
server or database directly. Implemented in
`desktop/BuildConsole/Services/ReplitSshService.cs`.

Real connection pattern:

```
ssh -i "$HOME\.ssh\replit" -p 22 -n -T -o StrictHostKeyChecking=accept-new <replUser>@<replHost> "<command>"
```

Remote repo path: `/home/runner/workspace`. The real host/user/key-path
values are environment-specific — confirm them from BuildConsole Settings
-> SSH & Remote (Replit) rather than hardcoding them.

SSH is now the **preferred mechanism** for git-pull/restart operations,
superseding the earlier HTTP-based #911/#805 deploy endpoints where SSH has
confirmed replaced them (see #82/#87's migration to the SSH pull+build
pre-step in `PostBuildDeployPipeline`).

SSH also reaches the real database directly, not just git/build commands —
but everything in this section is scoped to the **dev** server named above
(`ReplitSshService`, the Replit dev environment). This updates the Database
section below the same way `shaneapp://executeSql` did: the old "no direct
DB access, always write SQL for Shane" default is obsolete *for that dev
database*, and a build session can self-verify against it directly. Manual
SQL handed to Shane remains the right fallback only for genuinely
destructive/sensitive operations on that same dev database (irreversible
bulk deletes, anything he'd reasonably want eyes-on first) — the same
judgment call already established for `shaneapp://executeSql`.

### HARD RULE — production is never in scope, under any framing

**No agent session connects to, queries, or otherwise touches production —
not via SSH, not via any credential, not for a read-only count, not for
"just checking real impact," not for any reason — without Shane's own
explicit, real-time authorization for that specific action, given in that
specific session.** This is not a judgment call the way the dev-database
fallback above is; it is an absolute boundary. Production being reachable
with credentials that happen to exist somewhere is not authorization.
"I only ran a SELECT" is not a defense — read-only access to production
customer/tenant data is still production access. If a task seems to require
real production numbers, stop and ask Shane directly rather than reaching
for credentials to get them yourself — the same instinct that correctly
keeps Gov/GCC tenants out of scope and keeps `planOnly` builds pinned to the
testbed tenant applies here with zero exceptions. If you were handed
SSH/connection details that reach anything other than the dev server named
above, treat that as a stop-and-flag situation, not something to use.

## Production-change gate — the app registration is the boundary, not the tenant (Git #1913)

`mccawsoft2.onmicrosoft.com` is simultaneously the testbed tenant and Shane's real
production Microsoft 365 tenant. Because of that, "testbed only" in a build prompt is
a real constraint for **reads** and no constraint at all for the **write plane** — a
directory role assignment, an app-registration credential, or an admin-consent grant
against that tenant can be a production change even while the prompt says "testbed
only" in the same breath. The boundary that actually holds is the **app
registration**, not the tenant name:

- **DEV app registration `9f6f4772-b5be-421f-815e-b392336c373a`** — agent-modifiable,
  no gate. Same tier: `ca-ps-execution-dev`, reads against the testbed tenant, and the
  local PostgreSQL database with its manual migrations (see Database below).
- **PROD app registration `3308b280-e41e-42ba-9f73-73aac2ad3dee`** — an agent may read
  its current state, but writes only the plan for a change (a migration file, a
  documented step list, a PR) — it never applies that plan itself. Admin consent or
  permission grants on this registration, directory role assignments, and
  app-registration credentials against it are all out of agent reach.
- Also wrapped, same reason: production Key Vault (`ShaneMcCawConsulting`) secrets,
  `ca-ps-execution` (the non-`-dev` container), Staging/Replit deploys and their
  migrations, and tenant licensing purchases or service enablement.

Everything wrapped above goes into **#1281** (GATE: v1.1 release) as a documented
plan, not something executed in-session. This section is additive to, and does not
weaken, the "HARD RULE — production is never in scope" immediately above — that rule
already forbids direct production access outright; this section names the specific
in-between resources (the two app registrations, the Key Vault, the two
`ca-ps-execution*` containers, Staging/Replit) so "testbed only" cannot be misread as
authorizing a write against one of them.

**This is a different boundary than the "never invent data, BUILD IT" rule below, and
the two must never be conflated.** That rule says: when the backend genuinely lacks a
column, table, endpoint or enum value the surface needs, add it yourself in the same
session — a missing column is agent work, not a product decision, and rendering an
empty state and stopping there is an unfinished build. This rule covers a different
kind of gap and says the opposite: a production credential, an admin-consent grant, a
directory role assignment, or a Staging/Production deploy is not something an agent
completes in-session no matter how small the change looks — it is not "missing work,"
it is a boundary that Shane alone crosses. **Stopping at a correctly-identified
production boundary, having written the plan for #1281 to carry, is a successful,
finished build — not an unfinished one, and not the over-cautious "sorry, I cannot
work" failure this project has already had to correct once before.** Do not let this
rule talk you into rendering an empty state for a feature that is genuinely missing
(that is still a build-it case, unchanged); do not let the "BUILD IT" instinct talk
you into applying a change against the PROD app registration, production Key Vault,
`ca-ps-execution`, or a Staging/Production deploy (that is always a #1281 plan, never
a same-session apply).

## Database

- **Why this section no longer points at hosted Neon:** the hosted Neon Postgres instance previously used for local dev hit its free-plan monthly data-transfer quota and went unreachable (compute suspended, real, confirmed) — a real operational lesson about relying on a shared/limited hosted resource for high-frequency local dev traffic (Git #1209). Shane has since installed PostgreSQL 18 locally, and local dev now reads/writes that instance instead. The underlying philosophy is unchanged: agents connect directly for routine local dev/query verification rather than deferring everything to Shane — only the connection target changed.
- **Default for local day-to-day dev/testing: connect directly to the real local PostgreSQL 18 install, not `shaneapp://executeSql`.** The `DATABASE_URL` env var in `.env.local` is a genuine, directly-reachable local Postgres connection string: `postgresql://postgres:<password>@localhost:5432/shanemccawmsp` (host `localhost`, port `5432`, db `shanemccawmsp`; the real password is in `.env.local` itself, not repeated here) — the same database the local dev api-server itself reads/writes. While building, agents should use it directly (`psql "$DATABASE_URL"`, a one-off script, etc.) for reads to confirm state and for writes/`ALTER`/`UPDATE`/`INSERT` that are a normal, reversible part of the task — faster and with zero indirection through BuildConsole. Report the real result honestly, the same way test pass/fail is reported. Don't claim something is verified against live data unless it actually was queried.
- **`shaneapp://executeSql` stays real and available, but is for Replit/Staging debugging, not local dev work.** It runs SQL through BuildConsole's own dev api-server over HTTP (`POST /api/simulator/sql/execute`, the same pipe as the manual SQL Runner — see `desktop/BuildConsole/Services/LocalSqlExecutor.cs`), not a direct local Postgres connection. That HTTP round-trip is exactly the right tool when direct connection isn't — e.g. investigating the Replit/Staging environment via SSH (see below) where BuildConsole's dev api-server is the reachable path. Don't remove or deprecate it; just don't default to it for local work where the direct `DATABASE_URL` connection is faster and available.
- **Manual SQL for Shane's own SQL console stays as a real fallback, not the default** — reserved for anything genuinely too destructive or sensitive to self-execute (irreversible bulk deletes, production-affecting changes, anything Shane would reasonably want eyes-on before it runs). Judging what qualifies is Shane's call to make explicit when it matters; when in doubt on a risky write, say so and hand it to him rather than self-executing.
- **Schema changes require manual SQL, not `drizzle-kit push`.** Do not run `drizzle-kit push` or `push --force` — interactive push surfaces large pre-existing schema drift unrelated to the change at hand. Instead: add the Drizzle TS schema definitions, then hand-write the equivalent `CREATE TABLE`/`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` SQL into a new file under `lib/db/migrations/manual/`. **Additive DDL — new tables, new nullable columns, new enum values — the agent runs itself against the local `DATABASE_URL` in the same session, and reports what it ran.** Waiting on Shane to run an additive migration blocks the build for no benefit and is the reason features stalled at 'no backend exists.' Destructive or irreversible changes (dropping columns/tables, bulk rewrites, anything production-affecting) still go to Shane to run himself.
- No literal prices, tier names, or seat counts hardcoded in `.tsx` files outside API response handling (no-hardcoding rule) — these should flow through the Products Catalog / API responses, not be baked into UI code. Verifiable by grep.
- **Neon MCP server for schema/migration work is now stale.** The Neon MCP server (`https://mcp.neon.tech/mcp`) registered in `.mcp.json` was tied to the same now-abandoned hosted Neon project — with that project's compute suspended on quota exhaustion, its schema/migration tools (`complete_database_migration`, `compare_database_schema`, `create_branch`) have nothing live to operate against. Until/unless a new Neon project is provisioned for this purpose, do schema/migration work via the manual-SQL-file workflow above against the local PostgreSQL 18 install instead.

### Manual migration files (`lib/db/migrations/manual/`)

- Do not run `drizzle-kit push` / `push --force` against these.
- Every migration file that actually changes data or schema must end with a trailing self-marking `INSERT` so Simulator Studio's Migrations tree checkbox (Git #497) reflects DB reality regardless of which console ran the file:

  ```sql
  -- (at the very end of the file, inside the same transaction if one exists)
  INSERT INTO simulator_migration_runs (filename, ran_at)
  VALUES ('<this-file''s-own-exact-filename>.sql', now())
  ON CONFLICT (filename) DO UPDATE SET ran_at = now();
  ```

  Use the file's own real filename. Diagnostic/investigation-only files (pure `SELECT`/`WITH`, no DDL/DML) are exempt — they go in `archive/diagnostics/`, not the tracked set.

## Logging & telemetry

Every new subsystem or route must wire into the platform's logging/telemetry spine from the start: a module-level `logger` import with a `logger.child({ channel: "..." })` binding, using the locked channel taxonomy: `engine.*`, `workflow.*`, `billing`, `auth`, `comms.*`, `notification`, `tenant.*`, `admin.*`, `integration.azure`, `growth.*`, `crm`, `system.core`, `audit`. Extend with a new leaf channel only if the subsystem genuinely doesn't fit an existing one (e.g. `engine.dashboard`, reserved for the Dashboard / Web Part System). Do not create new untagged-logging debt.

## Email

Shane does **not** use Resend, ever, for any reason. All outgoing platform email goes exclusively through Exchange Online / Microsoft Graph. If you find or are about to write code referencing Resend as a mail transport or fallback, stop and flag it rather than proceeding — it's always wrong in this codebase.

## Workspace / monorepo

- This is a pnpm workspace monorepo (`pnpm-workspace.yaml` at repo root, packages under `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`). Run `pnpm install` **once at the repo root** after adding or changing any workspace package dependency — not scoped/filtered installs inside individual package directories, which can fail to properly link new `workspace:*` references. This is the one legitimate reason to run it; see the rule below for the illegitimate one.
- Cross-app shared code belongs in a `lib/*` workspace package (e.g. `@workspace/db`, `@workspace/dashboard-registry`, `@workspace/dashboard-canvas`), not duplicated per-app. `artifacts/*` apps (api-server, admin-panel, msp-portal, etc.) are independent Vite/Node apps with no direct shared-component mechanism between them other than `lib/*` packages.
- Single executor (one Claude Code session) at a time on any given set of files, to avoid merge conflicts when multiple sessions/tools are active concurrently.

## `pnpm install` is not a remedy, and bandwidth is a real constraint (Git #1987)

Agents have repeatedly told Shane to run `pnpm install` when module resolution breaks.
He has run it hundreds of times. It has never fixed that class of failure, and it
structurally cannot: on an unchanged lockfile, pnpm compares `pnpm-lock.yaml` against
`node_modules/.modules.yaml` and exits without walking a single symlink — observed
output `Already up to date. Done in 2.6s`. It has no integrity check for "this link
points at a directory that no longer exists," so a link dangling into a deleted
worktree survives every run. The real failures being chased in this class (#1951,
#1955, #1964, #1967, #1974) are dangling and cross-worktree symlinks — a worktree
dependency-isolation bug (#1988), not lockfile drift. Same failure shape as the
corrected rules elsewhere in this file: a standing instruction producing a useless
action on repeat, with everyone suspecting the tooling instead of the instruction.

1. **`pnpm install` is not a remedy for broken module resolution, and is never handed
   to Shane as an instruction** — not in a commit message, not in a code comment, not
   in a log line, not in a chat reply. When a resolve fails, diagnose the actual link:
   read where the symlink points (`dir` on Windows, `fsutil reparsepoint query` for
   junctions) and file what you find. A dangling link into `C:\wt\...` is a
   worktree-isolation bug, not a dependency problem.
2. **`pnpm install --force` is prohibited.** It refetches the full dependency graph —
   1,120 packages on this lockfile — which is a metered cost on Shane's capped Verizon
   connection, for a command that does not repair dangling links.
3. **Never run `pnpm install` from inside a worktree.** `scripts/dev-server/link-deps.mjs`
   exists precisely so worktrees do not each run one — its own header says so: junction
   the real dependency dirs from the main repo into the worktree instead of a full
   install per worktree. An install from a worktree both downloads and writes
   worktree-absolute paths into shared state, which is the poisoning mechanism behind
   this whole failure cluster.
4. **Bandwidth is a real constraint an agent cannot infer.** Treat any large download
   as a cost that needs justifying, not a free action.

**The other half of rule 4 — an agent does not grant itself the exception.** On hitting
a blocked or metered operation, stop and report what was needed and why. Do not retry
it, do not look for an alternate command that achieves the same download, and do not
write to settings to clear the block yourself. The override belongs to Shane, taken in
BuildConsole, and is one-shot. Failing closed here is correct behavior, not a stalled
build — report it as a finding (file it if it is a real gap) and continue with whatever
else the task allows. A constraint an agent can route around is a constraint that does
nothing — the old `*Data.ts` fixture rule failed exactly this way, by leaving an escape
hatch that every agent took.

## General

- Backup before any new execution layer or tool touches the codebase for the first time.
- Review the actual diff before committing any change.

## Verification defaults — don't default to "unable to verify"

A pattern showed up repeatedly across past sessions: honestly reporting things
like "not live-verified — I can't launch/restart BuildConsole from here" or
"no WebView2/BuildConsole runner or dev tenant is reachable from here." That
was true when it was written. It is no longer true and should not be assumed.

Both `shaneapp://runTest` (real UI/API/PowerShell test execution, in-process
through the same `RunManifestAsync` pipeline Play Test uses) and
`shaneapp://executeSql` (real SQL investigation/verification against
BuildConsole's own direct local Postgres connection) are confirmed working
and reachable from a build session on this machine — see
`desktop/BuildConsole/AGENT_PROTOCOLS.md` sections 1 and 2 for the exact
invocation contracts and result envelopes.

A session should no longer default to "unable to verify" language for UI
testing or SQL investigation. It should actually invoke the real protocol and
report the real result — pass, fail, or the actual data returned. Reserve
"unable to verify" for when the protocol itself genuinely fails for a
specific, statable reason (e.g. `shaneapp://` isn't registered on this
machine, no BuildConsole instance is running to courier the call to, or a
real timeout/error came back from the result envelope) — never as an assumed
default limitation.

## When a needed server is genuinely unreachable (Git #2160)

The rule above forbids assuming "unable to verify" as a default. This is its
counterpart for the case where a server or connection genuinely **is**
unreachable after a real check — not permission to skip verification when it
IS reachable, but the escape valve for when it truly is not, so a build
never sits in an indefinite retry/hold.

**A real check means a few real attempts with real evidence of failure** — not
one blind try, and never an unbounded loop. Once that check confirms the
resource is down (a specific connection error, a timeout with the actual
error text, a repeatable failure across attempts):

1. **Stop trying.** Do not keep retrying the same call hoping it resolves.
2. **Report the real, honest state** — what was needed, what was actually
   tried (the specific calls/attempts), and the actual failure (real error
   text, not a vague "couldn't connect").
3. **Do any other real work in scope that doesn't depend on the unreachable
   resource.** An unreachable verification target blocks only the piece that
   needs it, not the rest of the build.
4. **Write an honest bookend reflecting incomplete verification** — `⏳ IN
   FLIGHT` or a stated partial state, never a silent `✅ DONE` claim over
   work that was never actually verified.

**The same bounded-wait discipline applies to any background-task or
async-poll wait**, not just an initial connectivity check. If a session
triggers a scan/job and waits for a notification of completion, that wait
needs a real, stated timeout — not an indefinite hold. A resource being
polled can also be destroyed or invalidated by a concurrent process mid-wait
(a scan-run history row deleted out from under a poller is a real, confirmed
case); the wait logic must be able to detect that the thing it's waiting on
no longer exists and bail out to the report-and-stop path above, rather than
continuing to poll for something that can never resolve.

**Never hold real, completed work hostage to an unresolved wait.** If a
sub-piece of the task is genuinely done and verified (a fix confirmed against
live evidence, a doc grounded in that evidence), commit and push it as soon
as it's done, on its own commit — do not defer the only commit of the session
to the very end "once the last thing lands." A completed fix or document that
sits uncommitted because a final dependent step never resolved is real work
lost, not real work deferred.

This does not relax the requirement, immediately above, to actually invoke
the real protocol before claiming something can't be verified — it only
defines what "genuinely unreachable, after a real check" looks like, and what
to do once that's actually true.

## Test Coverage — Standing Practice

## HARD RULE — never invent data, and never stop at a missing backend

Two things get confused. They are opposites. Both halves of this rule are mandatory.

### 1. Never invent data to display

No fabricated rows. No demo tenants or plausible-looking placeholder names. No
hardcoded arrays of change requests, risks, findings, invoices, people or events
in a `.tsx` or a `*Data.ts` module. No silent fallback to a fixture constant when
a fetch returns empty, and no leaving an old fixture branch in place "for now."

If a row reaches a customer's screen, it came out of the database.

### 2. When the backend doesn't serve what the surface needs, BUILD IT

Do **not** render an "honest, no backend exists" empty state and stop. That is not
honesty, it is an unfinished task, and it is the single largest source of wasted
work on this project. An agent that draws a grey box where a feature should be has
failed the build.

In the same session, in this order:

1. Add the Drizzle TS schema definition for the column or table.
2. Write the `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE TABLE` SQL into
   `lib/db/migrations/manual/`, **and run it yourself** against the local
   `DATABASE_URL` (see the Database section). Additive DDL is a normal, reversible
   part of the task. Report what you ran.
3. Extend the route and its wire interface to serve the field.
4. Wire the UI to it.
5. Record both the migration filename and the commit hash in the bookend.

**Building is not faking.** A new column carrying real values is the product. A fake
array pretending that column exists is the failure.

Contracts: extract what already exists, and **author what is missing so that it then
exists.** "Extracted, not authored" describes how you document current state; it is not
a ban on extending the schema. Same for enums — "real vocabularies only" forbids
inventing a display vocabulary that maps onto nothing. Adding a status value the
product genuinely needs is ordinary work.

### When to actually stop and ask

Only for a real **product decision** that code cannot settle: two plausible models with
different customer-visible consequences; anything touching money, entitlement or a
promise made to a customer; or a direct conflict with a decision already recorded on an
issue. Hand those to Shane with the options stated plainly.

A missing column is not a product decision. Build it.

### Definition of done for a portal page

The page's `*Data.ts` fixture import is gone and every row on screen came from an
endpoint. Grep-verifiable, and checked before writing `DONE`:

```
grep -rn 'portal-v2/[a-z]*Data"' artifacts/msp-portal/src/pages/
```


**Scope: applies only to changes inside artifacts/msp-portal/ and
artifacts/shane-mccaw-consulting/.** Do not write test manifests for
desktop/BuildConsole (the WPF app) or other internal tooling - those are
Shane's own tools, not customer-facing product.

Whenever a build phase adds or changes testable behavior in those two
directories (a new API endpoint, a UI flow, an integration read/write
action), write or update a test manifest for it as part of that same build
phase - not only when explicitly asked.

- **Discover before you create.** Before writing any test manifest, search
  test-manifests/ for one that already covers the same route/feature -
  search by route path or component name, not by issue number (issue
  numbers are historical provenance, not a reliable lookup key). For
  example, before adding coverage for a checkout flow under
  `artifacts/shane-mccaw-consulting/`, run something like:

  ```
  grep -rl "checkout" test-manifests/ --include=*.json
  grep -rl "/api/portal/checkout" test-manifests/ --include=*.json
  ```

  If a match covers the same route/feature, update that file in place and
  keep its existing filename - do not create a duplicate. If nothing
  matches, create a new one under the naming convention below.
- Manifest location: test-manifests/{area}/{feature-slug}.json, where
  {area} is a coarse site section (e.g. copilot-readiness, admin, chat,
  auth) and {feature-slug} is a clear, readable feature name (e.g.
  checkout, home-quiz, verification-code-flow) - no leading issue number.
  This replaces the old flat test-manifests/{issue}-{feature-slug}.json
  convention going forward; existing files under the old convention are
  not required to be renamed, but any manifest touched under the
  discover-before-create rule should be moved to the new convention as
  part of that same edit.
- Every manifest carries a top-level `lastVerifiedAgainstCommit` field,
  set to the commit hash of the session that confirmed or edited it -
  update it every time a session touches the manifest, even if the only
  change is re-confirming it still matches current code.
- Schema sections as appropriate: apiTests / graphTests / zohoTests / uiSteps
  - see test-manifests/chat/escalation.json for a real example covering
  extraction/interpolation, captureResponse, and containsAny/containsNone.
- Register every new manifest in test-manifests/_regression-suite.json.
- Add data-testid to the specific interactive elements a manifest touches if
  they don't already have one - small and scoped, not a sweep of the page.
- Prefer real, already-proven selectors from prior PLATFORM_BUILD.md entries
  over guessing new ones.
- Where something genuinely can't be asserted programmatically, document
  that honestly in the manifest's own notes rather than faking coverage.
- Opt-in when the feature has meaningful API/UI surface - trivial internal
  refactors don't need a manifest.
- **Verifying an endpoint + that the DOM displays its data: use a plain
  `apiTests` call for the endpoint, and the uiStep `expect` `textContains`
  field for the DOM integration - NOT a uiStep `captureResponse`.** A
  `captureResponse` reads the response body out of WebView2's content stream
  (`GetContentAsync`), which is unreliable and was retired from
  test-manifests/smoke/hello-world-ui.json for exactly that reason (#1011 added
  a timeout guard, #1014 moved the read in-handler, neither made it read
  reliably). Instead: (1) a top-level `apiTests` GET/POST (HttpTestExecutor's
  proven HttpClient path, no browser) asserts the endpoint's real response and
  can `extract` (#877) a value into `{{name}}`; (2) a uiStep
  `{ "action": "expect", "textContains": "..." }` asserts the element's REAL
  rendered text (el.innerText/textContent) - interpolate the extracted
  `{{name}}` to prove the DOM genuinely shows what the API returned.
  `textContains` accepts a single string or an any-of array of strings
  (case-insensitive substring); it composes with `state`
  (visible/hidden/present/absent), which stays element-presence only. Reserve
  `captureResponse` for asserting a call the browser makes that has no
  independently-reachable endpoint to hit directly.
- **Run what you write, in the same session.** Writing or updating a manifest
  is not the finish line. Once a real manifest is written/updated for a build
  phase touching `artifacts/msp-portal/` or `artifacts/shane-mccaw-consulting/`,
  run it before the session ends via `shaneapp://runTest` (see
  `desktop/BuildConsole/AGENT_PROTOCOLS.md` section 2 for the invocation
  contract and result envelope) and report the real pass/fail result honestly
  in the build's own summary/commit. When extending an existing shared manifest,
  do not run the entire file; instead, write a unique `"sessionTag": "<tag>"`
  on the steps you added and use `shaneapp://runTest?file=<manifest>&onlyTag=<tag>`
  to run only those new steps by default, reserving full-file runs for explicit
  regression-sweep requests. Don't write a test and leave it
  unexecuted for someone else to discover was red. If the manifest genuinely
  fails, say so plainly rather than reporting the build as successful while a
  real test fails. Before calling it done, confirm the manifest actually lands
  at `test-manifests/{area}/{feature-slug}.json` per the discover-before-create
  convention above, and is registered in `test-manifests/_regression-suite.json`.

## Shared File Write Discipline

**Bookends no longer need this** — they live in per-issue `build-journal/<id>.md`
files (see "Mandatory session bookends"), each written by exactly one session, so
there is nothing to collide over. `PLATFORM_BUILD.md` and
`desktop/BuildConsole/BUILD_LOG.md` are frozen; don't write to them at all.

The discipline below still applies to any file that genuinely remains shared and
append-target across sessions — e.g. `test-manifests/_regression-suite.json`, or a
common source file two sessions edit at once. Before your FINAL commit to such a
file, always:

1. `git fetch origin main` (or `git pull --rebase origin main`) to get the current remote state.
2. Re-apply/re-append your own change against that now-current content -
   do not assume the file still looks like it did when your session started.
3. Commit and push.
4. If the push is rejected (someone else landed in the same instant),
   fetch/rebase again and retry from step 2.

Never overwrite unrelated rows/content you didn't intend to touch - if a
diff shows changes outside your own hunk, stop and re-isolate before
committing. Working in your own isolated worktree (now automatic for launched
builds — see "Mandatory worktree isolation") keeps your uncommitted edits out of
the shared index entirely, which is the real cure for the staged-index-bleed class
of collision.