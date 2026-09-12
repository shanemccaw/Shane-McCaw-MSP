# Local Dev-tier server-restart coordination

**Scope: the local Dev tier ONLY.** In the three-tier model
(**Dev (local)** → **Staging (Replit)** → **Production**), this subsystem
coordinates restarts of the *local* dev server that runs on Shane's machine.
Staging and Production have their own separate mechanisms and are **never**
touched here — the same hard boundary agent test execution already respects
(`shaneapp://runTest` is locked to Dev; see
`desktop/BuildConsole/AGENT_PROTOCOLS.md` and `TargetEnvironment.cs`).

## Why this exists

Up to ~8 concurrent agents now write against a local dev server. If two agents
wrote into the **same** directory the server runs from, one agent's mid-edit,
half-written change could be picked up by another agent's restart trigger —
crashing the server or running genuinely corrupted code. A remote `git push` is
atomic (no one sees it mid-edit); direct filesystem writes into one shared
directory have no such isolation.

So the local Dev tier is arranged like a small CI system:

```
  agent worktree A ─┐
  agent worktree B ─┤  commit    ┌─────────────────────────────────────────┐
  agent worktree C ─┼─ then ───► │  merge + restart + confirm  (MUTEX)      │
        ...         │  request-  │  drains the whole pending queue as ONE   │
  agent worktree H ─┘  restart   │  batch, restarts dev-all.mjs ONCE,       │
                                 │  confirms via git on the server checkout │
                                 └───────────────┬──────────────────────────┘
                                                 ▼
                        dedicated dev-server worktree (branch: dev-server)
                        the local stack actually runs from  ── dev-all.mjs
```

1. **Every agent works in its own isolated git worktree** — never directly in
   the directory the dev server runs from.
2. **The dev server runs from its own dedicated worktree/branch** (`dev-server`),
   launched via `scripts/dev-all.mjs`.
3. **On build-complete**, an agent's committed changes are **merged** into the
   server checkout, the server **process is restarted**, and the merge is
   **confirmed** with real git (`rev-parse HEAD`, `merge-base --is-ancestor`).
4. **A mutex serializes** merge+restart+confirm. Requests that arrive while a
   cycle is running **coalesce** into one restart — exactly how CI batches
   commits that land while a build is already running.

All agent worktrees and the server worktree share one `.git` object store, so a
merge of another worktree's commit is a purely local ref op — no fetch, no push.

## One-time setup (Shane / first agent)

```
# Create the dedicated dev-server checkout and launch it.
node scripts/dev-server/bootstrap-server.mjs --link --launch
```

* `--link` junctions `node_modules` from the main repo into the server worktree
  (fast; avoids a full per-worktree `pnpm install`), then builds `lib/*/dist`
  from THIS worktree's own source via `tsc --build` (Git #2117 — `dist` is no
  longer junctioned from the main repo, since that made a worktree's own
  schema/type edits invisible to `tsc`/`pnpm typecheck`). Omit `--link` and run
  `pnpm install` at the repo root yourself instead.
  * **Per-package `@workspace` linking (Git #2152):** a host whose `node_modules`
    holds an `@workspace/<lib-pkg>` scope (the in-repo `lib/*` packages) is NOT
    wholesale-junctioned — a Windows junction redirects the whole directory into
    the main checkout, so `@workspace/db` would resolve to main's `lib/db/src`
    rather than this worktree's own edited source (broken at both `tsc` typecheck
    **and** real Node runtime resolution). Instead such a host gets a REAL
    `node_modules`: every third-party entry junctioned from main as before, but
    each `@workspace/<pkg>` junctioned directly at this worktree's own `lib/<pkg>`.
    Hosts with no `@workspace` scope stay a single wholesale junction.
  * **This is the consolidated fix for the whole `@workspace/db` shared-junction
    family — Git #2088 / #2089 / #2094 / #2097 / #2121.** All five were one root
    cause: a worktree's `@workspace/db` was a shared link into main (or, under a
    provisioning race, into an *unrelated sibling worktree*), so a worktree's own
    `lib/db` schema edit was invisible to its consumers and the shared link
    dangled cross-worktree. Per-package linking makes each worktree write **only
    its own** links, so provisioning can never repoint main's link or a peer's.
    Note the isolation holds **regardless of pnpm's hoist layout**: even a
    consumer host that currently has *no* `@workspace` scope in its own
    `node_modules` (pnpm hoists `@workspace` to the root `node_modules`, so
    `artifacts/api-server` is wholesale-junctioned today) still resolves
    `@workspace/db` to the worktree's **own** `lib/db` via the root
    `node_modules`' per-package link and Node's normal upward resolution.
  * **Verifying a worktree-local `lib/*` edit — no `paths`-override needed
    anymore.** Because of #2152 + #2117, a worktree's normal `tsc` / `tsx` /
    `vitest` / `node` already resolve `@workspace/db` (and its freshly-built
    `dist`) to that worktree's own edited source. The throwaway `tsconfig`
    `paths`-override that earlier sessions improvised (#2089/#2094/#2097) is
    obsolete — run the ordinary typecheck/test. If you ever need to confirm the
    junctions are healthy from inside a worktree, resolve it directly:
    `cd artifacts/api-server && node -e 'import.meta.resolve("@workspace/db").then(u=>console.log(u))'`
    should print a path under **your** worktree, not `C:\Source\...` or another
    `C:\wt\...`. `store-doctor.mjs` (below) is the main-checkout-side scanner for
    the poison that used to cause this.
  * **A bare `tsc -p <artifact>/tsconfig.json --noEmit` is safe — Git #3522
    closed the stale-`dist` trap (#1778, #2087, #2778).** It used to be a
    separate trap: an artifact whose `tsconfig.json` listed a composite `lib/*`
    package under `"references"` had plain `tsc -p` swap every file of that
    package for its **already-built `dist/*.d.ts`**, so a same-session
    `lib/db/src/schema` edit read as "no exported member" (or silently
    typechecked against the pre-edit shape) until someone ran `tsc -b`. The
    `pretypecheck: tsc -b ...` hooks #2087/#2778 added only covered the
    `pnpm run typecheck` path. #3522 removed the cause instead: **no artifact
    `tsconfig.json` has `"references"` to `lib/*` any more**, so every
    invocation — bare `tsc --noEmit`, `pnpm run typecheck`, the editor —
    resolves `@workspace/*` through `package.json` `"exports"` to live
    `src/**/*.ts`, and the hooks are gone. Root `pnpm run typecheck` still
    typechecks each composite `lib/*` on its own via `typecheck:libs`
    (`tsc --build` over root `tsconfig.json`'s `references`). **Do not add a
    `"references"` entry to an artifact's `tsconfig.json`** — that reopens the
    trap for every package it lists. `lib/*/dist` (built at provisioning,
    `buildLibDist`) is now read only by root `tsc --build`'s own up-to-date
    check, never by a consumer's typecheck.
* `--launch` starts `dev-all.mjs`. Re-running bootstrap is safe/idempotent.

Default server worktree: `C:\dev-server` (short path — the deep `Design/_ds/...`
tree overruns Windows `MAX_PATH` from a long root). Override with
`DEV_SERVER_WORKTREE`.

## Per-agent workflow

```
# 1) Get an isolated worktree off origin/main.
node scripts/dev-server/provision-worktree.mjs 1234-my-feature --link

# 2) Work + commit in that worktree (C:\wt\1234-my-feature) as usual.

# 3) When your build is done and committed, publish it to the dev server:
cd C:\wt\1234-my-feature
node scripts/dev-server/request-restart.mjs --agent 1234-my-feature
```

`request-restart.mjs` returns only once your commit is **live and confirmed** on
the dev-server checkout (or it reports an honest failure — merge conflict,
timeout, etc.). Then run your tests via `shaneapp://runTest` as usual (which also
targets Dev/local).

### The coalescing contract

* If your commit is **already** an ancestor of the server HEAD, it's live. You
  wait for any in-flight cycle to finish (so the server has actually restarted
  with it) and return — **without triggering a second restart**. ("Your change
  got pulled into another agent's cycle → join it.")
* Otherwise your request is **enqueued**, then:
  * If you win the mutex, **you** become the cycle runner: drain the whole
    pending queue, merge every commit, restart once, confirm.
  * If someone else holds the mutex, you watch for **your** request's outcome
    (their running/next cycle batches it in) and return when it lands — again
    with no extra restart. Requests that arrive after a cycle already claimed its
    batch simply wait for the next cycle, which naturally coalesces everyone
    waiting into a single restart.

A crashed runner can't wedge the fleet: the mutex has a pid + heartbeat, and a
stale lock (dead pid, or heartbeat older than `DEV_SERVER_STALE_LOCK_MS`) is
broken and its in-flight batch re-queued.

## Build Sets — deferred single restart for a stack of builds

The coalescing above reacts to *timing* (an agent joins an in-flight cycle if its
changes happen to get swept in). **Build Sets** are the explicit, proactive
counterpart: declare a group of builds up front and defer the restart **entirely**
until the whole group is done — then restart **once**.

Shane's own words: *"The constant tear down and rebuild of ALL services —
Marketing, Portal, Admin Panel, API Server — is causing memory resource
management problems on my dev box… group builds into a build set, and when that
build set is done, ALL the builds in it, then a one-time restart/compile happens
and all build tests get run against that."* He regularly queues 10-20 related
builds together (properly blocked by their parents); without grouping that's
10-20 full-stack teardown/rebuild cycles.

### How it works

* Each build in the set carries the same set name — the `--buildSet <name>`
  build-prompt header flag (see the root `CLAUDE.md`). BuildConsole persists it on
  the queue row (`bt_build_queue.build_set`) and passes it to the launched build as
  env: `DEV_BUILD_SET`, `DEV_BUILD_SET_MEMBER` (the member key — issue # or queue
  id), and `DEV_BUILD_SET_EXPECTED` (the wave size). `request-restart.mjs` reads
  those automatically (flags override env).
* When a set member finishes, `request-restart.mjs` takes the mutex and **merges
  its commit into the server checkout using the exact same merge mechanics** as an
  ordinary cycle — but **does not restart**. It records the member in the set
  manifest and returns (`landed: true, restarted: false` — "merged; restart
  deferred").
* When **every** member has reached a terminal state, the completing call fires
  **exactly ONE** restart for the combined changes (all four services), marks the
  set done (single-shot — a second completion can never double-restart), and
  returns `restarted: true, runSetTests: true`. **Only that one caller runs the
  combined test pass** — the others returned `runSetTests: false`, so tests run
  once for the whole set, not once per build.
* Set members **never touch the general pending queue** — the ungrouped
  enqueue → `runCycle` → restart path (and its coalescing) is completely
  unchanged. A build with no `--buildSet` behaves exactly as before.

### When is a set "complete"?

Explicit and proactive, never timing-based:

* **Known expected count** (`DEV_BUILD_SET_EXPECTED`, from BuildConsole's count of
  the wave): complete once that many members have reached a terminal state.
* **Explicit close** (open-ended sets, or the failure backstop): `buildset.mjs
  close <name>` completes the set on exactly the members recorded so far.

A member that **fails or is dropped** still counts as terminal, so one bad build
can't wedge the set. BuildConsole's watcher also runs a backstop: once a set's
wave has fully drained from the queue it runs `buildset.mjs close <name>`
automatically (a harmless single-shot no-op if the expected-count path already
fired the restart). If a member merged nothing, completion is a no-op (there's
nothing new to restart into).

### CLI (`buildset.mjs`)

```
node scripts/dev-server/buildset.mjs status [<name>] [--json]   # inspect set(s)
node scripts/dev-server/buildset.mjs open   <name> [--expected N]
node scripts/dev-server/buildset.mjs close  <name>              # complete on current members
node scripts/dev-server/buildset.mjs drop   <name> --key <k> [--reason ...]
node scripts/dev-server/buildset.mjs sweep                      # report stale (wedged) sets
node scripts/dev-server/buildset.mjs reset  <name>              # delete a set manifest
```

State lives under `<state-dir>/buildsets/<name>.json`, and every membership /
completion / restart event is logged to `<state-dir>/buildsets.log` (JSONL); set
restarts are also mirrored into `cycles.log` alongside ordinary cycles.

### Selective service targeting

The one restart a completed Build Set fires is **selective**, not a blanket
rebuild of everything. Shane doesn't run all sites at once — the only always-on
service is the **API server** — so a Portal-only wave has no reason to tear down
and rebuild Marketing / Admin / Website.

On completion the coordinator computes the set's **combined changed-file
footprint** — the union of each merged member's own changes since the set's
recorded base (`baseHead`, the server HEAD stamped when the set first opened),
via a per-member three-dot diff so it stays precise even if unrelated cycles
advanced HEAD in between. `service-targeting.mjs` (a pure module, git-only)
classifies those paths into services:

| Changed path | Service |
|--------------|---------|
| `artifacts/api-server/` | **API Server** (always-on) |
| `artifacts/shane-mccaw-consulting/` | **Marketing** |
| `artifacts/admin-panel/` | **Admin** |
| `artifacts/portal/` | **Portal** |
| `artifacts/msp-website/` | **Website** |
| `lib/`, `packages/`, root build config (`package.json`, `pnpm-*`, `tsconfig*`) | **shared → ALL services** |
| `test-manifests/`, `docs/`, `scripts/`, `.github/`, … | **none** (no rebuild) |

then plans, per service, one of `rebuild` / `start` / `stop` / `keep`:

- the **API server is always-on** — kept running, and **never rebuilt just
  because a front-end changed** (only when API or shared code changed); started
  if it somehow isn't up;
- a **front-end (re)starts only** when its own code — or shared code it compiles
  against — changed; a front-end the set didn't touch **and** isn't already
  running is **not spun up** (the memory win);
- a running-but-unrelated front-end is **left alone by default** (never yanked);
  opt into stopping unneeded front-ends with `DEV_SET_STOP_UNNEEDED=1` (the API
  server is never stopped).

The plan is enforced by launching `dev-all.mjs` with `DEV_ALL_ONLY=<csv>` (the
set of services that must be running = changed ∪ still-needed-running ∪ the
always-on API); an unset `DEV_ALL_ONLY` starts everything, exactly as before.
Every decision — which services were determined to need rebuild/start/stop/keep,
and **exactly which changed files drove each** — is logged to
`<state-dir>/buildsets.log` and mirrored into `cycles.log`.

**Safe fallback:** if the combined footprint can't be resolved (e.g. a set
opened before `baseHead` was recorded, or an empty diff), the completion does a
**full** restart of all services rather than risk under-restarting. Ungrouped
(non-`--buildSet`) builds are unchanged — they always do a full `runCycle`
restart.

> Note: the actual per-service enforcement runs through `DEV_ALL_ONLY`, which the
> local (git-excluded) `dev-all.mjs` honors. Because it's one launcher process,
> a completed set that keeps a running front-end still bounces it (kill + relaunch
> the subset), rather than doing zero-downtime per-service supervision — the
> targeting decides *which* services run, not independent per-service uptime.

## Any request to :8080 can be dropped for minutes -- restart holds + resilient fetch (Git #1855)

**Any caller hitting the local api-server directly (not through `request-restart.mjs`)
can have its request dropped, with no warning, for as long as a rebuild+restart
takes.** Live evidence: #1793's app-only PowerShell capability survey ran for over
an hour against `POST /api/simulator/ps-execution/cmdlet`. A concurrent build
finished mid-survey and the coordinator restarted the api-server; `dev-all.log`
showed a **510-second** window where the server was simply gone. Every request in
that window failed with a raw `TypeError: fetch failed`, and the survey's first run
recorded 36 of those transport failures as if they were real per-cmdlet results --
a false-negative capability table, discarded and re-run from scratch.

Two tools close that gap. Neither requires going through `request-restart.mjs` --
they're for a caller (a script, an agent's own long-running probe) making ordinary
HTTP calls against `http://localhost:<DEV_API_PORT>` while a restart could land at
any time.

### 1. `api-fetch.mjs` -- a REAL signal, not a blind retry

`fetchResilient(url, fetchOpts, { config })` wraps `fetch()`: on a genuine transport
failure (connection refused/reset, "fetch failed" -- never a client-side deadline,
which is a real hang and is thrown through as-is) it reads the coordinator's OWN
state off disk (`current-cycle.json`'s phase, the restart mutex's owner) via
`describeRestartState(config)` and retries, instead of guessing blind. Exhausting
the retry budget (default 40 attempts × 15s ≈ 10 min, comfortably above the 510s
real-world window above) throws `ApiServerUnreachableError` carrying that real
state in its message, so a caller that gives up can say **why** instead of just
re-printing "fetch failed".

```js
import { fetchResilient, ApiServerUnreachableError } from "./api-fetch.mjs";
import { loadConfig } from "./config.mjs";

const config = loadConfig();
const res = await fetchResilient(`http://localhost:${config.apiPort}/api/...`, { method: "POST", ... }, { config });
```

### 2. `restart-hold.mjs` -- a bounded advisory lock the coordinator honors

A long-running task can register that it's mid-flight, so the coordinator's NEXT
restart (`runCycle` and the build-set completion restart both call this) waits --
**bounded** by `DEV_SERVER_RESTART_HOLD_MAX_WAIT_MS` (default 2 min) -- for active
holds to clear before actually tearing the server down. This is the ad-hoc-task
counterpart to `--buildSet`'s deferral: a build set is a *declared* group of
builds; a restart hold is any process announcing "give me a moment" without being
part of one. It is **advisory and bounded on purpose** -- other agents' work still
needs to land, so it is a grace window, not a way to indefinitely block a restart.
A hold whose heartbeat goes stale (`DEV_SERVER_RESTART_HOLD_DEFAULT_TTL_MS`,
default 10 min) is treated as abandoned and ignored, the same never-wedge-the-fleet
discipline as the mutex's own stale-lock recovery.

```
node scripts/dev-server/restart-hold.mjs acquire my-long-task   # or renew on your own cadence
node scripts/dev-server/restart-hold.mjs release my-long-task   # always release when done
node scripts/dev-server/restart-hold.mjs status                 # see what's currently held
```

Or programmatically: `acquireHold(config, name, { ttlMs })` / `renewHold` /
`releaseHold` / `activeHolds`. `scripts/src/ps-capability-survey.ts` -- the #1793
driver this was filed from -- uses both: it acquires (renewed on every cmdlet call)
a `ps-capability-survey` hold for the run's duration, and its own transport-failure
retry loop now reports the coordinator's real state via `describeRestartState`
instead of a generic "waiting for it to come back" guess.

## Shared-store protection (Git #1988)

A worktree's `node_modules` dirs are junctions into the **shared main-checkout
store**. Any `pnpm install` run inside a worktree writes THROUGH those junctions
into the store every session shares, with link/shim paths anchored to the
installing worktree — when that worktree is cleaned up, every other session's
toolchain breaks (incidents #1951 #1955 #1959 #1964 #1967 #1974). Three
enforced layers replace what used to be only a documented convention:

1. **Fail-closed install gate** — the root `.pnpmfile.cjs` (`preResolution` +
   `readPackage`, both proven on pnpm 11.13.0 to fire on every install variant,
   incl. headless) refuses any install where a workspace `node_modules` is a
   junction resolving outside the workspace root — no override. In a
   junction-free linked worktree it refuses unless `WORKTREE_ISOLATED_INSTALL=1`
   (a deliberate fully-local install that touches nothing shared).
2. **No silent auto-installs** — `verifyDepsBeforeRun: false` in
   `pnpm-workspace.yaml`. pnpm 11's built-in default is `"install"`, which is
   what fired #1951's poisoning install as a side effect of a plain `pnpm
   vitest`. Installs are always deliberate now.
3. **Detection everywhere, repair everywhere too (Git #1980)** — `store-doctor.mjs`
   scans the shared store for foreign (worktree-anchored) links, dangling links
   and poisoned `.bin` shims. `provision-worktree.mjs` runs the scan at
   provisioning (result on `storeHealth`) and `removeWorktreeSafe` re-scans after
   every removal into `cleanups.log` (`storeAfterRemoval`) so a poisoning is
   still pinned to the removal that exposed it — but both callers now also call
   `repairSharedStore()` themselves the instant a scan comes back poisoned,
   rather than only logging a warning. Real evidence showed why the old
   "explicit-only" design didn't hold: a poisoned store (670 foreign links) sat
   unrepaired across nine further sweep removals over 30+ minutes
   (`cleanups.log`, 2026-09-06T14:36Z-15:07Z) with nothing acting on the
   warnings. Nothing about this hides the recurrence — every detection AND the
   repair outcome (`autoRepair` on `storeHealth`/`storeAfterRemoval`) is still
   logged; `node scripts/dev-server/store-doctor.mjs --repair` remains available
   as the standalone, explicit entry point for a human diagnosing by hand.

Teardown is also hardened: junction unlinking is lstat-based (dangling junctions
are unlinked too), and `removeWorktreeSafe` REFUSES to delete a worktree while
any junction it found could not be removed — it marks the worktree stale instead
of risking a delete-through into the real store.

## `.pnpmfile.cjs` / `pnpm-lock.yaml` checksum drift guard (Git #2064)

`#2060` was caused by a commit that added `.pnpmfile.cjs` but committed
`pnpm-lock.yaml` without the `pnpmfileChecksum` pnpm records for a present
pnpmfile — with no checksum committed, every pnpm invocation in the shared main
checkout re-injected it, leaving `pnpm-lock.yaml` perpetually dirty and blocking
`deploy-shanesbuild.cmd`'s `git status --porcelain` gate. Any future edit to
`.pnpmfile.cjs` that doesn't re-commit the updated checksum reintroduces the
same drift, silently.

`check-pnpmfile-checksum.mjs` recomputes pnpm 11.13.0's own checksum algorithm
(`sha256-base64(sha256(LF-normalized .pnpmfile.cjs))`) offline — no `pnpm
install`, no network, no metered cost — and fails loudly if the committed
`pnpmfileChecksum` line in `pnpm-lock.yaml` is missing or doesn't match:

```
node scripts/dev-server/check-pnpmfile-checksum.mjs           # exit 0 clean, 1 drifted, 2 can't scan
node scripts/dev-server/check-pnpmfile-checksum.mjs --json    # machine-readable
node scripts/dev-server/check-pnpmfile-checksum.mjs --root <path>  # scan a different checkout (tests)
```

Wired into `desktop/BuildConsole/deploy-shanesbuild.cmd`, right after the
working-tree-clean check and before the `origin/main` fetch — a drifted
checksum is reported as a config error there instead of silently re-dirtying
the checkout again.

## Reading live server logs

`dev-all.mjs` streams stdout/stderr to **rotating log files** as well as the
launching terminal, so any agent can read live server output:

* `<DEV_ALL_LOG_DIR>/dev-all.log` — current run (default
  `<main-repo>/.logs/dev-all/dev-all.log`; the coordinator points
  `DEV_ALL_LOG_DIR` at this stable, machine-wide, git-ignored path).
* `<DEV_ALL_LOG_DIR>/dev-all.prev.log` — previous run (and the pre-rotation tail
  once the current log passes `DEV_ALL_LOG_MAX_BYTES`, default 15 MB).
* `<DEV_ALL_LOG_DIR>/dev-all.meta.json` — pid + resolved log paths.

Find the exact paths + current state any time:

```
node scripts/dev-server/status.mjs        # human-readable
node scripts/dev-server/status.mjs --json  # machine-readable
```

## Verify the coordination logic

```
node scripts/dev-server/selftest.mjs
```

Spins up throwaway temp git repos with a **fake** restart (never touches the real
server) and asserts: deterministic batch coalescing, already-live join with no
extra restart, real cross-process concurrency (N concurrent CLI calls → all
commits land, restarts < N), merge-conflict abort leaving a clean checkout, and
stale-lock recovery.

## Verify worktree `@workspace` isolation (Git #2121)

```
node scripts/dev-server/worktree-isolation.selftest.mjs
```

The automated regression guard for the per-package `@workspace` linking above —
the consolidated fix for #2088 / #2089 / #2094 / #2097 / #2121. It builds a
faithful throwaway workspace fixture in `os.tmpdir()` (a main checkout with a
shared store, plus two "worktrees" each carrying their own distinctly-marked
`lib/db`), runs the **real** `linkDeps()`, and asserts the end-user OUTCOME with
Node's real resolver: a worktree consumer (both an `@workspace`-scope host and a
wholesale-junctioned one) resolves + executes its **own** `lib/db`, main's own
links are never repointed at a worktree, two concurrent worktrees never see each
other's `lib/db`, third-party deps still come from the shared store, and cleanup
leaves no junction that would delete THROUGH into the store. Windows-only (SKIPs
cleanly elsewhere); touches nothing real. Because it asserts the marker the
consumer actually executes, the OLD wholesale-junction bug (consumer resolves
main's `lib/db`) makes it go red — it is a real guard, not a rubber stamp.

## Database is NOT worktree-isolated (Git #3177)

Everything above isolates **file state** — a worktree's own checkout, its own
`node_modules`/`lib/*/dist` links, its own `@workspace` resolution. None of it
isolates **database state**. Every concurrent Shane's Life build shares one real
local Postgres database (the `finances` DB — see CLAUDE.md's Database section),
and a session running inside a worktree talks to that one shared database
directly, same as any other local dev work.

That gap is real, not hypothetical: a #3153 build session found a live `catches`
table and a live `list_items.requested_by` column in that shared database with
**no matching migration file anywhere in git history and no `schema_migrations`
ledger row** — evidence that an earlier attempt at that same work ran a manual
mutation against the shared database from inside a worktree, then that worktree
was cleaned up (or the session was interrupted) before the migration file or the
code referencing it was ever committed. `cleanup-worktree.mjs` removes the git
checkout; it cannot undo — and does not know about — a real database mutation a
session already made from inside it.

**Mitigation shipped (not a full fix): a live schema-drift audit**, not a
worktree-DB binding. `scripts/check-schema-drift.mjs` parses every `CREATE
TABLE` / `ADD COLUMN` (and `DROP`/`RENAME`) out of both real migrations
directories (`desktop/ShanesSurvival/migrations/`, `web/shanes-life/migrations/`)
and diffs the result against `information_schema` on the real shared database.
Any live table/column neither directory's SQL declares is reported — exactly the
shape the `catches` incident left behind. It runs two ways:

- **Non-fatal, automatic, on every real server boot** — wired into
  `web/shanes-life/src/migrate.mjs`'s `runMigrations()`, right after migrations
  apply. A finding is logged, never a failed boot; the audit itself is
  best-effort by design (see below).
- **On demand**: `node bin/check-schema-drift.mjs` from `web/shanes-life`, which
  exits non-zero on drift for a manual check or a CI/pre-deploy step.

It cross-references the same shared `schema_migrations` ledger this whole
worktree-per-build setup already produces "ahead" rows for (see
`check-migration-numbers.mjs`'s `classifyOrphanLedgerFilenames`): a table/column
explained only by a ledger row that's ahead of this checkout — i.e. a concurrent
sibling build's real, tracked, not-yet-merged migration — is reported as a
separate, non-alarming caveat rather than conflated with the genuinely-untracked
case (no ledger row at all) the `catches` table actually was. This is a
heuristic regex/paren-scan parser, not a real SQL parser — good enough to catch
the concrete shape #3153 hit, not a guarantee against every possible DDL form.

**What this does NOT do**, honestly: it does not tie a worktree's DB mutations
to that worktree's lifecycle (no per-worktree schema/prefix, no
rollback-on-cleanup) — that would be a materially larger change (transaction
wrapping every session's DB access, or a schema-per-worktree scheme with its own
cross-worktree-read implications) than this build was scoped to make. This audit
is the "at minimum" floor #3177 asked for: visibility, so a future orphaned
mutation gets caught on the next boot instead of sitting silent until someone
happens to compare `\d` output against git history by hand.

Self-test (pure, no database touched — builds real temp migration files and
runs the real extractor):

```
node scripts/check-schema-drift.selftest.mjs
```

## Files

| File | Role |
|------|------|
| `config.mjs` | Resolves paths/branch/state, anchored to the shared git-common-dir so every worktree agrees. Every field is env-overridable. |
| `git.mjs` | Synchronous git wrappers (revParse, isAncestor, mergeNoEdit w/ auto-abort, …). |
| `lock.mjs` | Atomic mkdir mutex with pid+heartbeat liveness and stale-lock recovery. |
| `queue.mjs` | Directory-of-files request queue (lock-free enqueue; claim/finalize/recover). |
| `server-process.mjs` | Start/stop/**restart by pid-tree** (never by name) + readiness probe. |
| `coordinator.mjs` | `runCycle()` — the mutex-held merge→restart→confirm batch. Plus the Build-Set functions `runSetMemberCycle()` / `maybeFireSetRestart()` / `finishSetFromCli()` (merge-no-restart per member, then ONE restart on completion). |
| `buildset.mjs` | **Build Sets** — per-set manifest state machine (now incl. `baseHead`) + CLI (`open`/`status`/`close`/`drop`/`sweep`/`reset`). |
| `restart-hold.mjs` | **Git #1855** — bounded advisory restart holds a long-running agent task can take so the coordinator's next restart waits, briefly, for it to clear. CLI (`acquire`/`renew`/`release`/`status`) + `.d.mts` types for TS callers. |
| `api-fetch.mjs` | **Git #1855** — `fetchResilient()`, a retry-aware `fetch()` wrapper that reads the coordinator's real state (`describeRestartState`) to distinguish an in-progress restart from a genuine failure, instead of guessing off a raw `TypeError: fetch failed`. `.d.mts` types for TS callers. |
| `service-targeting.mjs` | **Selective service targeting** — pure (git-only) planner: classify a set's combined changed-file footprint into services and decide rebuild/start/stop/keep per service. |
| `request-restart.mjs` | **Agent entrypoint** — the coalescing algorithm, and the `--buildSet` deferred-restart path. |
| `push-blocked-bookend.mjs` | **Git #3628** — reads a worktree's own committed `build-journal/{issue}.md` at HEAD (not `origin/main`) and, only when its effective `**Status:**` says BLOCKED, pushes that HEAD directly to `origin/main` (one fetch+rebase retry if main moved). Fixes a self-blocked session's 🛑 BLOCKED bookend stranding on its agent branch — `request-restart.mjs` above only ever publishes into the local dev-server checkout, never origin. Called by `WorktreeProvisionService.PushBlockedBookendIfAnyAsync` at reap time as a backstop; a session should still push its own BLOCKED bookend itself (CLAUDE.md's "blocked" flow). |
| `status.mjs` | Diagnostic: current state + exact log paths. |
| `provision-worktree.mjs` | Create an isolated agent worktree off origin/main. |
| `bootstrap-server.mjs` | Create/launch the dedicated dev-server checkout. |
| `link-deps.mjs` | Junction `node_modules` into a worktree (Windows recipe) and build `lib/*/dist` from that worktree's own source (`buildLibDist`, Git #2117). |
| `store-doctor.mjs` | **Git #1988/#1980** — scan the shared main-checkout `node_modules` for links/`.bin` shims that resolve into a worktree or dangle. `--repair` is the standalone CLI entry point; `provision-worktree.mjs` and `worktree-lifecycle.mjs` also call `repairSharedStore()` directly the moment their own scan finds poisoning. |
| `selftest.mjs` | Cross-process verification of the whole mechanism. |
| `worktree-isolation.selftest.mjs` | **Git #2121** — regression guard for per-package `@workspace` isolation (#2088/#2089/#2094/#2097/#2121): real `linkDeps()` over a throwaway fixture, asserts a worktree consumer resolves + executes its own `lib/db`, no cross-worktree bleed, no delete-through. |
| `worktree-sweep.selftest.mjs` | **Git #2537 / #1958** — sweep decision self-test: a live/recently-active worktree is retained (#2537), and an aged-out worktree that still holds uncommitted/unpushed work is retained-for-resume rather than removed (#1958), while `--force` still reclaims it. |
| `worktree-reprovision.selftest.mjs` | **Git #1958** — pause/resume guards: `detectWorktreeWork` (shared dirty/unpushed truth, markers filtered), `findOrphanedRescueBranches` + `writeReprovisionMarker` (tell a resumed session its prior work was rescued to `rescued/<name>-*` instead of silently handing it a clean tree). |
| `verify-branch-merged.mjs` | **Git #1447 Part 1** — `git merge-base --is-ancestor` check a session runs before writing a DONE bookend, to confirm its own branch actually landed on main (not just that the local worktree looks clean). |
| `check-stranded-branches.mjs` | **Git #1447 Part 2** — sweeps every `agent/*` branch against main and reports which have commits main doesn't have ("stranded"). Deliberately separate from the worktree-lifecycle orphan sweep above — different question, different terminology. |
| `push-blocked-bookend.selftest.mjs` | **Git #3628** — throwaway bare-origin fixtures proving: a non-BLOCKED (or missing) bookend is left alone; a genuine BLOCKED bookend is pushed straight to `origin/main`; a rejected push (main moved under a peer's commit) recovers via one fetch+rebase+retry without clobbering the peer's commit. |
| `check-schema-drift.mjs` | **Git #3177** — live schema-drift audit for the shared Shane's Life/ShanesSurvival database: diffs `information_schema` against both migrations directories' real `CREATE TABLE`/`ADD COLUMN` statements, flags anything live with no matching migration file. See "Database is NOT worktree-isolated" above. |
| `check-schema-drift.selftest.mjs` | **Git #3177** — pure self-test for the extraction parser above (comma-in-comment trap, `numeric(10,2)` type-modifier trap, multi-clause `ALTER TABLE`, rename/drop). No database touched. |

## Config knobs (env)

`DEV_SERVER_WORKTREE`, `DEV_SERVER_BRANCH` (default `dev-server`),
`DEV_SERVER_BASE_REF` (default `origin/main`), `DEV_SERVER_STATE_DIR`,
`DEV_ALL_LOG_DIR`, `DEV_API_PORT` (default 8080), `DEV_SERVER_STALE_LOCK_MS`,
`DEV_SERVER_MAX_WAIT_MS`, `DEV_ALL_LOG_MAX_BYTES`,
`DEV_SERVER_FAKE_RESTART=1` (record restarts instead of touching a real process
— used by selftest / dry runs).

Build Sets: `DEV_BUILD_SET` (set name — presence switches `request-restart.mjs`
into the deferred-restart path), `DEV_BUILD_SET_MEMBER` (this member's key),
`DEV_BUILD_SET_EXPECTED` (wave size for auto-completion), `DEV_BUILD_SET_STALE_MS`
(when `buildset.mjs sweep` flags a set as wedged, default 6h). BuildConsole sets
the first three at launch; flags (`--buildSet` / `--set-member` / `--set-expected`)
override them.

Selective service targeting: `DEV_SET_STOP_UNNEEDED=1` (let a completed set stop
running-but-unrelated front-ends; off by default so a set never yanks a service
in use — the API server is never stopped regardless). `DEV_ALL_ONLY` (csv of
services `dev-all.mjs` should start; set automatically by the coordinator from
the computed plan — unset starts all).

Restart holds (Git #1855): `DEV_SERVER_RESTART_HOLD_DEFAULT_TTL_MS` (default 10
min — how long a hold survives without being renewed before it's treated as
abandoned), `DEV_SERVER_RESTART_HOLD_MAX_WAIT_MS` (default 2 min — the bounded
grace window the coordinator waits for active holds to clear before restarting
anyway).

## Known follow-ups (honest limits)

* **`dev-all.mjs` is git-excluded on this machine** (`.git/info/exclude`), so it
  is never committed and a fresh worktree doesn't contain it. `startServer`
  copies the main checkout's `dev-all.mjs` into the server worktree on every
  launch/restart, so the server always runs the current launcher. The file-based
  logging added to `dev-all.mjs` therefore lives on disk in your working copy,
  not in git. If you want the launcher (and its logging) tracked/shared, remove
  the `scripts/dev-all.mjs` line from `.git/info/exclude` and commit it — that's
  Shane's call, not something this change forces.
* **`node_modules` provisioning** for the server + agent worktrees uses the
  proven Windows junction recipe (`--link`); it is real but machine-path
  specific and was **not** executed live in the authoring session (doing so
  would have disrupted running agents). Run `bootstrap-server.mjs --link` once to
  materialize it.
* **`dev-server` ↔ `origin/main` reconciliation** is not automated: the
  `dev-server` branch accumulates merged agent commits. Periodically reconcile it
  with `origin/main` (or reset it to a fresh base and re-bootstrap). This is a
  deliberate manual step, like promoting Dev→Staging.
* The end-to-end **live** restart (real `taskkill` + real `dev-all.mjs` relaunch)
  was not exercised in the authoring session for the same non-disruption reason;
  the merge/confirm/coalescing/lock logic and the logging are verified (see
  `selftest.mjs`).
