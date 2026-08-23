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

* `--link` junctions `node_modules` + `lib/*/dist` from the main repo into the
  server worktree (fast; avoids a full per-worktree `pnpm install`). Omit it and
  run `pnpm install` at the repo root yourself instead.
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
| `coordinator.mjs` | `runCycle()` — the mutex-held merge→restart→confirm batch. |
| `request-restart.mjs` | **Agent entrypoint** — the coalescing algorithm. |
| `status.mjs` | Diagnostic: current state + exact log paths. |
| `provision-worktree.mjs` | Create an isolated agent worktree off origin/main. |
| `bootstrap-server.mjs` | Create/launch the dedicated dev-server checkout. |
| `link-deps.mjs` | Junction `node_modules` + `lib/*/dist` into a worktree (Windows recipe). |
| `selftest.mjs` | Cross-process verification of the whole mechanism. |

## Config knobs (env)

`DEV_SERVER_WORKTREE`, `DEV_SERVER_BRANCH` (default `dev-server`),
`DEV_SERVER_BASE_REF` (default `origin/main`), `DEV_SERVER_STATE_DIR`,
`DEV_ALL_LOG_DIR`, `DEV_API_PORT` (default 8080), `DEV_SERVER_STALE_LOCK_MS`,
`DEV_SERVER_MAX_WAIT_MS`, `DEV_ALL_LOG_MAX_BYTES`,
`DEV_SERVER_FAKE_RESTART=1` (record restarts instead of touching a real process
— used by selftest / dry runs).

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
