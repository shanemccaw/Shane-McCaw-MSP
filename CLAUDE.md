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

**Standard Phase Checkpoints:**
1. **Phase 1: Investigation & Research** — `node scripts/report-progress.mjs <id> 1 3 "Investigation & Discovery"`
2. **Phase 2: Core Implementation** — `node scripts/report-progress.mjs <id> 2 3 "Core Implementation"`
3. **Phase 3: Verification & Test Suite** — `node scripts/report-progress.mjs <id> 3 3 "Verification & Testing"`

**Call it again at EVERY phase change — not just once (Git #1206).** The panel only advances when a report arrives, so reporting a single early step and then going quiet leaves Build Watch **frozen on that first phase** while real work continues — it looks stalled even though it isn't. Re-report at each real transition (bump `step`, update `label`), matching the milestones you're already tracking in your own checklist — at minimum the three standard checkpoints above, and again whenever your checklist genuinely advances to a new phase. Keep it to major phases (not noisy per-line spam), but definitely **more than once**, and always send a **final** call with `step == total` (e.g. `... <id> 3 3 "Verification & Testing"`) so the panel reaches 100% instead of freezing mid-way.
BuildConsole displays this in Build Watch per-slot with visual progress bars, percentage, active phase card, and heuristic estimated time remaining. If a running build reports nothing new for a few minutes, the phase card now shows a soft "⚠ No progress update in Xm" notice — a cue that this reporting has gone quiet, not that the build is stuck.

## Customer Portal build — design source

Design source: Design/design_handoff_customer_portal/
- README.md is the spec. Read it before writing code.
- The .dc.html files are design references, not code. Recreate them with this
  repo's existing React + Vite + Tailwind v4 + shadcn/ui (new-york) + lucide-react
  patterns. Ignore support.js entirely — do not port it.
- The logic class at the bottom of Customer Portal Shell.dc.html holds the state
  machine and data shapes. Read it; it is the specification.
- Copy is final. Do not rewrite, shorten or "improve" any user-facing string.
- No emoji, ever. Icons come from lucide-react.
- Every number on screen comes from the data layer. Never hardcode a tenant number
  in a component — put the fixture in one place so it can be swapped for real data.

## Mandatory session bookends

This project tracks every work session in [PLATFORM_BUILD.md](PLATFORM_BUILD.md), so that even a session that crashes or gets abandoned mid-way leaves proof an attempt was made.

**Which file to bookend in:** a session whose work is entirely within `desktop/BuildConsole/` (Shane's own WPF tool, not customer-facing product) bookends in [desktop/BuildConsole/BUILD_LOG.md](desktop/BuildConsole/BUILD_LOG.md) instead of the root file. A session touching the actual product — anything outside `desktop/BuildConsole/` — continues bookending in the root PLATFORM_BUILD.md as today. A session touching both bookends in both files, one row per file for its respective piece of work. Everything below (row format, timing, Shared File Write Discipline) applies identically to whichever file a given piece of work targets.

### Step 1 — first thing the session does, before any other work

Append a new row to the table in the applicable file (PLATFORM_BUILD.md and/or desktop/BuildConsole/BUILD_LOG.md, per above) for the step you're about to do, with status:

```
⏳ IN FLIGHT — {step name}
```

Commit that single-line change immediately, as its own small standalone commit — not bundled with the real work that follows.

### Last step — after all real work is done, tested, and typechecked

Update that same row's status to:

```
✅ DONE — {step name}
```

and fill in the real commit hash of the work itself. Commit that update — either as part of the final commit or immediately after it.

If the work is abandoned, fails, or the session ends before this step, the row is left as `⏳ IN FLIGHT`. Do not go back and clean up or delete stale IN FLIGHT rows from other sessions — they are the record.

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

- **At the DONE bookend**, if the work leaves such an action: `gh issue edit <number> --add-label "Shane To-Do"`. Say plainly in the issue/PLATFORM_BUILD.md row what the action is (e.g. "Shane needs to run `lib/db/migrations/manual/....sql`").
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

## Build-prompt header convention (queued builds)

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

SSH also reaches the real database directly, not just git/build commands.
This updates the Database section below: the old "no direct DB access,
always write SQL for Shane" default is obsolete for the same reason
`shaneapp://executeSql` made it obsolete — direct DB access via SSH is now
a real, available option for a build session to self-verify against. Manual
SQL handed to Shane remains the right fallback only for genuinely
destructive/sensitive operations (irreversible bulk deletes,
production-affecting changes, anything he'd reasonably want eyes-on first)
— the same judgment call already established for `shaneapp://executeSql`.

## Database

- **Why this section no longer points at hosted Neon:** the hosted Neon Postgres instance previously used for local dev hit its free-plan monthly data-transfer quota and went unreachable (compute suspended, real, confirmed) — a real operational lesson about relying on a shared/limited hosted resource for high-frequency local dev traffic (Git #1209). Shane has since installed PostgreSQL 18 locally, and local dev now reads/writes that instance instead. The underlying philosophy is unchanged: agents connect directly for routine local dev/query verification rather than deferring everything to Shane — only the connection target changed.
- **Default for local day-to-day dev/testing: connect directly to the real local PostgreSQL 18 install, not `shaneapp://executeSql`.** The `DATABASE_URL` env var in `.env.local` is a genuine, directly-reachable local Postgres connection string: `postgresql://postgres:<password>@localhost:5432/shanemccawmsp` (host `localhost`, port `5432`, db `shanemccawmsp`; the real password is in `.env.local` itself, not repeated here) — the same database the local dev api-server itself reads/writes. While building, agents should use it directly (`psql "$DATABASE_URL"`, a one-off script, etc.) for reads to confirm state and for writes/`ALTER`/`UPDATE`/`INSERT` that are a normal, reversible part of the task — faster and with zero indirection through BuildConsole. Report the real result honestly, the same way test pass/fail is reported. Don't claim something is verified against live data unless it actually was queried.
- **`shaneapp://executeSql` stays real and available, but is for Replit/Staging debugging, not local dev work.** It runs SQL through BuildConsole's own dev api-server over HTTP (`POST /api/simulator/sql/execute`, the same pipe as the manual SQL Runner — see `desktop/BuildConsole/Services/LocalSqlExecutor.cs`), not a direct local Postgres connection. That HTTP round-trip is exactly the right tool when direct connection isn't — e.g. investigating the Replit/Staging environment via SSH (see below) where BuildConsole's dev api-server is the reachable path. Don't remove or deprecate it; just don't default to it for local work where the direct `DATABASE_URL` connection is faster and available.
- **Manual SQL for Shane's own SQL console stays as a real fallback, not the default** — reserved for anything genuinely too destructive or sensitive to self-execute (irreversible bulk deletes, production-affecting changes, anything Shane would reasonably want eyes-on before it runs). Judging what qualifies is Shane's call to make explicit when it matters; when in doubt on a risky write, say so and hand it to him rather than self-executing.
- **Schema changes require manual SQL, not `drizzle-kit push`.** Do not run `drizzle-kit push` or `push --force` — interactive push surfaces large pre-existing schema drift unrelated to the change at hand. Instead: add the Drizzle TS schema definitions, then hand-write the equivalent `CREATE TABLE`/`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` SQL into a new file under `lib/db/migrations/manual/`, for Shane to review and run himself.
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

- This is a pnpm workspace monorepo (`pnpm-workspace.yaml` at repo root, packages under `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`). Run `pnpm install` **once at the repo root** after adding or changing any workspace package dependency — not scoped/filtered installs inside individual package directories, which can fail to properly link new `workspace:*` references.
- Cross-app shared code belongs in a `lib/*` workspace package (e.g. `@workspace/db`, `@workspace/dashboard-registry`, `@workspace/dashboard-canvas`), not duplicated per-app. `artifacts/*` apps (api-server, admin-panel, msp-portal, etc.) are independent Vite/Node apps with no direct shared-component mechanism between them other than `lib/*` packages.
- Single executor (one Claude Code session) at a time on any given set of files, to avoid merge conflicts when multiple sessions/tools are active concurrently.

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

## Test Coverage — Standing Practice

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
  in the build's own summary/commit - don't write a test and leave it
  unexecuted for someone else to discover was red. If the manifest genuinely
  fails, say so plainly rather than reporting the build as successful while a
  real test fails. Before calling it done, confirm the manifest actually lands
  at `test-manifests/{area}/{feature-slug}.json` per the discover-before-create
  convention above, and is registered in `test-manifests/_regression-suite.json`.

## Shared File Write Discipline

PLATFORM_BUILD.md, desktop/BuildConsole/BUILD_LOG.md (and any other shared,
frequently-appended-to file) are written to by many independent Claude Code
sessions. Before your FINAL commit to such a file (e.g. flipping your
bookend row from IN FLIGHT to DONE), always:

1. `git pull --rebase origin main` to get the current remote state.
2. Re-apply/re-append your own change against that now-current content -
   do not assume the file still looks like it did when your session started.
3. Commit and push.
4. If the push is rejected (someone else landed in the same instant),
   pull --rebase again and retry from step 2.

Never overwrite unrelated rows/content you didn't intend to touch - if a
diff shows changes outside your own hunk, stop and re-isolate before
committing.