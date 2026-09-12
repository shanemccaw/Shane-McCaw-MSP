#!/usr/bin/env node
// scripts/dev-server/push-blocked-bookend.mjs
//
// Git #3628 -- a self-blocked build session (the CLAUDE.md "blocked" label flow, the
// "layer 2" self-check #3623 built) correctly detects it's genuinely blocked, labels
// itself, wires the real blocked_by edge, comments, and writes a real 🛑 BLOCKED
// bookend -- then exits cleanly (process exit 0, nothing crashed). Confirmed live for
// #3584/#3585: that bookend commit landed only on the agent's own branch
// (agent/3585-q2260, agent/3584-q2258) and the local dev-server checkout (the
// existing merge-back in request-restart.mjs only ever publishes there) -- it never
// reached origin/main:
//
//   $ git show origin/main:build-journal/3585.md -> fatal: path does not exist
//
// Meanwhile QueueWatcherService's MarkCompleteAsync had already landed the row on
// 'verifying'/'done' and mirrored the board to Verifying, exactly as if real work had
// completed -- and FalseDoneReconciler's own Shape-A correction (DoneBookendVerifier.
// GetBlockedAsync) can never catch this: it reads `origin/main:build-journal/{n}.md`,
// which is exactly the ref this stranded commit never reached.
//
// AGENT ENTRYPOINT (also called by BuildConsole's own watcher at reap time --
// WorktreeProvisionService.PushBlockedBookendIfAnyAsync): given a build's own
// worktree (which still has the file on disk right after its process exits, before
// the cleanup sweep can reclaim it) and the GitHub issue number it was building,
// reads the bookend build-journal/<issue>.md AS COMMITTED AT THE WORKTREE'S OWN
// HEAD (not origin/main -- that's the whole point) and, only when its EFFECTIVE
// (last) **Status:** line says BLOCKED, pushes that HEAD directly onto origin/main --
// mirroring exactly what CLAUDE.md already tells a normal session to do for its own
// DONE bookend ("push to main -- rebasing onto the current origin/main and retrying
// if the push is rejected"), which the self-block flow was silently skipping.
//
// Usage:
//   node scripts/dev-server/push-blocked-bookend.mjs --worktree <path> --issue <n> [--json]
//
// Exit codes: 0 = ran fine (whether or not there was anything BLOCKED to push),
// 1 = a BLOCKED bookend was found but the push genuinely failed (needs attention --
// see `detail`), 2 = bad arguments / script-level error.

import { pathToFileURL } from "node:url";
import { git } from "./git.mjs";

const STATUS_RX = /\*\*Status:\*\*\s*(.+)/gi;
const NON_FAST_FORWARD_RX = /non-fast-forward|fetch first|rejected/i;

/**
 * The EFFECTIVE (last) **Status:** field value in a bookend's raw text. A
 * self-blocked bookend commonly reads "IN FLIGHT" then "BLOCKED" as two separate
 * status lines -- the final line is the true current state, matching
 * DoneBookendVerifier's own "take the last match" rule on the C# side.
 */
export function extractEffectiveStatus(bookendText) {
  STATUS_RX.lastIndex = 0;
  let last = null;
  let m;
  while ((m = STATUS_RX.exec(String(bookendText || ""))) !== null) last = m[1];
  return last ? last.trim() : null;
}

export function isBlockedStatus(statusValue) {
  return !!statusValue && /BLOCKED/i.test(statusValue);
}

/**
 * Reads build-journal/<issueNumber>.md as committed at HEAD inside `worktree` --
 * deliberately the worktree's own local HEAD, not origin/main, since a stranded
 * BLOCKED bookend by definition has not reached origin/main yet. Never throws --
 * a missing file or a git error both just mean "nothing to report here".
 */
export function readWorktreeBookendStatus(worktree, issueNumber) {
  const show = git(worktree, ["show", `HEAD:build-journal/${issueNumber}.md`]);
  if (show.code !== 0 || !show.stdout.trim()) {
    return { found: false, blocked: false, statusValue: null };
  }
  const statusValue = extractEffectiveStatus(show.stdout);
  return { found: true, blocked: isBlockedStatus(statusValue), statusValue };
}

/**
 * Pushes `worktree`'s current HEAD directly onto origin/main. One retry after a
 * fetch+rebase covers the ordinary "main moved while this build ran" race -- the
 * same race CLAUDE.md's own push instructions call out. A genuine conflict is
 * reported, never auto-resolved: this must never silently drop or garble a commit.
 */
export function pushHeadToOriginMain(worktree) {
  const first = git(worktree, ["push", "origin", "HEAD:main"]);
  if (first.code === 0) {
    return { ok: true, detail: "pushed directly (fast-forward)." };
  }

  const combined = `${first.stdout}\n${first.stderr}`;
  if (!NON_FAST_FORWARD_RX.test(combined)) {
    return { ok: false, detail: `push failed (exit ${first.code}): ${combined.trim()}` };
  }

  const fetch = git(worktree, ["fetch", "origin", "main"]);
  if (fetch.code !== 0) {
    return { ok: false, detail: `push rejected and the retry fetch failed: ${fetch.stderr.trim()}` };
  }

  const rebase = git(worktree, ["rebase", "origin/main"]);
  if (rebase.code !== 0) {
    git(worktree, ["rebase", "--abort"]);
    return {
      ok: false,
      detail: `push rejected; rebase onto the fresh origin/main hit a real conflict (aborted, not resolved automatically): ${rebase.stderr.trim()}`,
    };
  }

  const second = git(worktree, ["push", "origin", "HEAD:main"]);
  return second.code === 0
    ? { ok: true, detail: "pushed after one fetch+rebase retry (main had moved)." }
    : {
        ok: false,
        detail: `push still failed after rebase retry (exit ${second.code}): ${(second.stdout + second.stderr).trim()}`,
      };
}

/** Core entrypoint, importable directly (used by the selftest and, in spirit, by
 * whatever calls this without shelling out). Returns a plain result object; never
 * throws for an ordinary "nothing BLOCKED here" outcome. */
export function runPushBlockedBookend({ worktree, issue }) {
  const issueNumber = Number(issue);
  if (!worktree || !Number.isInteger(issueNumber) || issueNumber <= 0) {
    return { ok: false, blocked: false, pushed: false, error: "requires --worktree <path> --issue <positive integer>" };
  }

  const status = readWorktreeBookendStatus(worktree, issueNumber);
  if (!status.found) {
    return {
      ok: true,
      blocked: false,
      pushed: false,
      detail: `no build-journal/${issueNumber}.md committed at this worktree's HEAD -- nothing to check.`,
    };
  }
  if (!status.blocked) {
    return {
      ok: true,
      blocked: false,
      pushed: false,
      statusValue: status.statusValue,
      detail: "bookend's effective status is not BLOCKED -- nothing to do here.",
    };
  }

  const push = pushHeadToOriginMain(worktree);
  return { ok: push.ok, blocked: true, pushed: push.ok, statusValue: status.statusValue, detail: push.detail };
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--worktree") a.worktree = argv[++i];
    else if (t === "--issue") a.issue = argv[++i];
    else if (t === "--json") a.json = true;
  }
  return a;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  const res = runPushBlockedBookend(a);

  if (a.json) {
    console.log(JSON.stringify(res, null, 2));
  } else if (res.error) {
    console.error(`[push-blocked-bookend] ${res.error}`);
  } else if (!res.blocked) {
    console.log(`[push-blocked-bookend] ${res.detail}`);
  } else {
    console.log(
      `[push-blocked-bookend] BLOCKED bookend detected (status: "${res.statusValue}") -- ${res.detail}`
    );
  }

  process.exit(res.error ? 2 : res.blocked && !res.pushed ? 1 : 0);
}
