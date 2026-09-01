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
3. **Detection everywhere, repair only on request** — `store-doctor.mjs` scans
   the shared store for foreign (worktree-anchored) links, dangling links and
   poisoned `.bin` shims. `provision-worktree.mjs` runs the scan at provisioning
   (result on `storeHealth`, loud warning in human mode);
   `removeWorktreeSafe` re-scans after every removal into `cleanups.log`
   (`storeAfterRemoval`) so a poisoning is pinned to the removal that exposed
   it. Repair is **only** `node scripts/dev-server/store-doctor.mjs --repair` —
   explicit by design; an automatic repair would hide the recurrence.

Teardown is also hardened: junction unlinking is lstat-based (dangling junctions
are unlinked too), and `removeWorktreeSafe` REFUSES to delete a worktree while
any junction it found could not be removed — it marks the worktree stale instead
of risking a delete-through into the real store.

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
| `service-targeting.mjs` | **Selective service targeting** — pure (git-only) planner: classify a set's combined changed-file footprint into services and decide rebuild/start/stop/keep per service. |
| `request-restart.mjs` | **Agent entrypoint** — the coalescing algorithm, and the `--buildSet` deferred-restart path. |
| `status.mjs` | Diagnostic: current state + exact log paths. |
| `provision-worktree.mjs` | Create an isolated agent worktree off origin/main. |
| `bootstrap-server.mjs` | Create/launch the dedicated dev-server checkout. |
| `link-deps.mjs` | Junction `node_modules` into a worktree (Windows recipe) and build `lib/*/dist` from that worktree's own source (`buildLibDist`, Git #2117). |
| `store-doctor.mjs` | **Git #1988** — scan the shared main-checkout `node_modules` for links/`.bin` shims that resolve into a worktree or dangle; `--repair` is the ONLY (explicit, never automatic) repair path. |
| `selftest.mjs` | Cross-process verification of the whole mechanism. |
| `verify-branch-merged.mjs` | **Git #1447 Part 1** — `git merge-base --is-ancestor` check a session runs before writing a DONE bookend, to confirm its own branch actually landed on main (not just that the local worktree looks clean). |
| `check-stranded-branches.mjs` | **Git #1447 Part 2** — sweeps every `agent/*` branch against main and reports which have commits main doesn't have ("stranded"). Deliberately separate from the worktree-lifecycle orphan sweep above — different question, different terminology. |

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
