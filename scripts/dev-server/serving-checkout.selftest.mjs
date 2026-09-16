#!/usr/bin/env node
// scripts/dev-server/serving-checkout.selftest.mjs
//
// Git #4033 -- focused self-test for "is the checkout that was just refreshed the
// one actually serving the dev ports?" and for reconciling a serving checkout
// stuck behind local-only commits. Stands up throwaway git repos and a synthetic
// process table / listener map, so it never touches the real dev server, the real
// checkout, or any real process.
//
//   node scripts/dev-server/serving-checkout.selftest.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log(`  ok  - ${msg}`);
  else {
    failures++;
    console.error(`  FAIL - ${msg}`);
  }
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function commitFile(repo, rel, content, msg) {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  writeFileSync(path.join(repo, rel), content);
  git(repo, ["add", "--", rel]); // only this file: other dirty files must stay dirty
  git(repo, ["commit", "-q", "-m", msg]);
  return git(repo, ["rev-parse", "HEAD"]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "serving-4033-"));
  const origin = path.join(tmp, "origin.git");
  const serving = path.join(tmp, "serving");
  const other = path.join(tmp, "other");
  process.env.DEV_SERVER_MAIN_ROOT = serving;
  process.env.DEV_SERVER_STATE_DIR = path.join(tmp, "state");
  process.env.DEV_SERVER_WORKTREE = path.join(tmp, "dev-server"); // mirror, never created

  const sc = await import("./serving-checkout.mjs");
  const { assessDivergence, fastForwardMainCheckout, assessServingDivergence } = await import("./refresh-main-server.mjs");
  const { exitCodeFor } = await import("./request-restart.mjs");
  const { loadConfig } = await import("./config.mjs");

  try {
    // --- pure parsing / attribution ---------------------------------------------
    const netstat = [
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       8736",
      "  TCP    [::]:8080              [::]:0                 LISTENING       8736",
      "  TCP    127.0.0.1:49887        127.0.0.1:8080         TIME_WAIT       0",
      "  TCP    0.0.0.0:5175           0.0.0.0:0              LISTENING       15620",
    ].join("\r\n");
    const l = sc.parseNetstatListeners(netstat);
    ok(JSON.stringify(l.get(8080)) === "[8736]", "netstat: :8080 listener parsed once, TIME_WAIT client line ignored");
    ok(JSON.stringify(l.get(5175)) === "[15620]", "netstat: :5175 listener parsed");

    ok(
      sc.samePath(sc.rootFromCommandLine('"node" "C:\\Source\\Repo\\scripts\\dev-all.mjs" --start api-server'), "C:\\Source\\Repo"),
      "cmdline: quoted dev-all.mjs path -> repo root"
    );
    ok(sc.rootFromCommandLine("node --enable-source-maps ./dist/index.mjs") === null, "cmdline: relative dist entry names no checkout");

    const t0 = 1_700_000_000_000;
    const table = new Map([
      [8736, { pid: 8736, ppid: 23976, created: t0 + 5000, cmd: "node --enable-source-maps ./dist/index.mjs" }],
      [23976, { pid: 23976, ppid: 25900, created: t0 + 1000, cmd: `"node" "${serving}${path.sep}scripts${path.sep}dev-all.mjs" --start api-server` }],
      [25900, { pid: 25900, ppid: 4, created: t0, cmd: "BuildConsole.exe" }],
      // pid-reuse trap: this "parent" was created AFTER its child
      [900, { pid: 900, ppid: 901, created: t0 + 5000, cmd: "node ./dist/index.mjs" }],
      [901, { pid: 901, ppid: 4, created: t0 + 9000, cmd: `"node" "${other}${path.sep}scripts${path.sep}dev-all.mjs"` }],
    ]);
    const a = sc.attributeRoot(8736, table);
    ok(a.kind === "dev-all" && sc.samePath(a.root, serving) && a.viaPid === 23976, "attribution: listener -> parent dev-all launcher -> serving root");
    ok(sc.attributeRoot(900, table).root === null, "attribution: a recycled-pid 'parent' newer than its child is not trusted");

    // --- a real serving repo + origin -------------------------------------------
    git(tmp, ["init", "-q", "--bare", "-b", "main", origin]);
    git(tmp, ["clone", "-q", origin, serving]);
    for (const r of [serving]) {
      git(r, ["config", "user.email", "t@t"]);
      git(r, ["config", "user.name", "t"]);
      git(r, ["checkout", "-q", "-b", "main"]);
    }
    commitFile(serving, "artifacts/api-server/src/index.ts", "v1\n", "api v1");
    git(serving, ["push", "-q", "origin", "main"]);
    git(serving, ["branch", "-q", "--set-upstream-to=origin/main", "main"]);
    await sleep(1100); // reflog stamps are whole seconds
    const startedAt = Date.now() + 1000;
    await sleep(2100);
    const probe = (tbl, listeners) => ({ readProcessTable: () => ({ table: tbl, error: null }), readListeners: () => listeners });
    const liveTable = (created, root = serving) =>
      new Map([
        [8736, { pid: 8736, ppid: 23976, created, cmd: "node ./dist/index.mjs" }],
        [23976, { pid: 23976, ppid: 1, created: created - 10, cmd: `"node" "${root}${path.sep}scripts${path.sep}dev-all.mjs" --start api-server` }],
      ]);
    const config = loadConfig({ cwd: serving });
    ok(sc.samePath(config.servingRoot, serving), "config: servingRoot defaults to the main repo root");

    let v = sc.verifyServingCheckout(config, { probe: probe(liveTable(startedAt), new Map([[8080, [8736]]])) });
    ok(v.verified, `verify: api built from current HEAD, launched from serving root -> verified (${v.problems.join(" | ")})`);

    v = sc.verifyServingCheckout(config, { probe: probe(liveTable(startedAt, other), new Map([[8080, [8736]]])) });
    ok(!v.verified && v.problems.some((p) => p.includes("NOT from the serving checkout")), "verify: port held by a process from ANOTHER checkout -> not verified (the #4033 shape)");

    v = sc.verifyServingCheckout(config, { probe: probe(liveTable(startedAt), new Map()) });
    ok(!v.verified && v.problems.some((p) => p.includes("nothing is listening")), "verify: nothing on :8080 -> not verified");

    v = sc.verifyServingCheckout(config, { apiSpawnedAt: startedAt + 60_000, probe: probe(liveTable(startedAt), new Map([[8080, [8736]]])) });
    ok(!v.verified && v.problems.some((p) => p.includes("predates the rebuild")), "verify: listener older than the rebuild spawn -> the old process never gave up the port");

    // an api-affecting commit lands AFTER the process started -> stale
    await sleep(1100);
    const apiV2 = commitFile(serving, "artifacts/api-server/src/index.ts", "v2\n", "api v2");
    v = sc.verifyServingCheckout(config, { commits: [apiV2], probe: probe(liveTable(startedAt), new Map([[8080, [8736]]])) });
    ok(!v.verified && v.problems.some((p) => p.includes("serving stale code")), "verify: api-affecting change since process start -> stale");

    // a docs-only commit after start is not stale for the api
    const lateStart = Date.now() + 1500;
    await sleep(3100);
    const docs = commitFile(serving, "docs/note.md", "x\n", "docs only");
    v = sc.verifyServingCheckout(config, { commits: [docs], probe: probe(liveTable(lateStart), new Map([[8080, [8736]]])) });
    ok(v.verified, `verify: docs-only change since process start does not make the api stale (${v.problems.join(" | ")})`);

    // a commit that never reached the serving checkout
    const side = path.join(tmp, "side");
    git(tmp, ["clone", "-q", origin, side]);
    git(side, ["config", "user.email", "t@t"]);
    git(side, ["config", "user.name", "t"]);
    const foreign = commitFile(side, "artifacts/api-server/src/other.ts", "y\n", "never fetched");
    v = sc.verifyServingCheckout(config, { commits: [foreign], probe: probe(liveTable(lateStart), new Map([[8080, [8736]]])) });
    ok(!v.verified && v.problems.some((p) => p.includes("not in the serving checkout")), "verify: commit absent from the serving checkout -> not verified");

    // --- divergence reconciliation ----------------------------------------------
    git(serving, ["push", "-q", "origin", "main"]);
    // local-only artifact commit (the QA auto-commit shape), then origin moves on
    const qa = commitFile(serving, "Bugs/Portal/s1/automation/report.json", "{}\n", "Automated QA Session s1");
    git(side, ["pull", "-q", "--rebase", "origin", "main"]);
    commitFile(side, "artifacts/api-server/src/index.ts", "v3\n", "api v3 upstream");
    git(side, ["push", "-q", "origin", "main"]);
    git(serving, ["fetch", "-q", "origin"]);

    let d = assessDivergence(serving, "origin/main");
    ok(!d.lossless && d.notUpstream.length === 1 && d.notUpstream[0].sha === qa, "divergence: an unpushed local commit is NOT lossless and is named");
    let ff = fastForwardMainCheckout(config);
    ok(!ff.pulled && ff.reason.includes("Automated QA Session s1") && git(serving, ["rev-parse", "HEAD"]) === qa, "ff: skipped, reason names the local-only commit, HEAD untouched");

    // Git #4330: the divergence itself is a request-restart FAILURE (exit 4), not a quiet NOT LIVE note
    let sd = assessServingDivergence(config);
    ok(sd.checked && sd.diverged && !sd.lossless && sd.localOnlyCommits.includes(qa) && sd.reason.includes("Automated QA Session s1"), "#4330: serving HEAD not an ancestor of origin/main -> diverged, names the local-only commit");
    ok(exitCodeFor({ landed: true, live: true, servingDivergence: sd }) === 4, "#4330: diverged beats a live commit -> exit 4");
    ok(exitCodeFor({ landed: true, live: null, buildSet: "s", servingDivergence: sd }) === 4, "#4330: diverged fails a deferred build-set member too -> exit 4");
    ok(exitCodeFor({ landed: false, servingDivergence: sd }) === 1, "#4330: not merged still exits 1");

    // the same commit gets published upstream via cherry-pick (different sha)
    git(side, ["pull", "-q", "--rebase", "origin", "main"]);
    git(side, ["fetch", "-q", serving, qa]);
    git(side, ["cherry-pick", "-x", "FETCH_HEAD"]);
    git(side, ["push", "-q", "origin", "main"]);
    // an unrelated uncommitted change in the serving checkout must survive
    writeFileSync(path.join(serving, "docs", "note.md"), "local edit\n");
    git(serving, ["fetch", "-q", "origin"]);
    d = assessDivergence(serving, "origin/main");
    ok(d.lossless, `divergence: after the commit is upstream, moving is lossless (${d.basis})`);
    ff = fastForwardMainCheckout(config);
    const originHead = git(serving, ["rev-parse", "origin/main"]);
    ok(ff.pulled && ff.reconciled && git(serving, ["rev-parse", "HEAD"]) === originHead, "ff: reconciled to origin/main with reset --keep");
    sd = assessServingDivergence(config);
    ok(sd.checked && !sd.diverged, "#4330: after reconcile the serving HEAD is an ancestor of origin/main -> not diverged");
    ok(exitCodeFor({ landed: true, live: true, servingDivergence: sd }) === 0 && exitCodeFor({ landed: true, live: false, servingDivergence: sd }) === 3, "#4330: not diverged -> 0 live / 3 not live, unchanged");
    ok(!assessServingDivergence({ servingRoot: tmp }).checked, "#4330: a root with no origin/main is reported unchecked, never diverged");
    ok(readFileSync(path.join(serving, "docs", "note.md"), "utf8") === "local edit\n", "ff: unrelated uncommitted change carried over, not discarded");
    ok(readFileSync(path.join(serving, "Bugs/Portal/s1/automation/report.json"), "utf8") === "{}\n", "ff: the QA artifact content is still present (now via origin/main)");

    // lossless, but a dirty file origin also changes -> reset --keep refuses, nothing moves
    const qa2 = commitFile(serving, "Bugs/Portal/s2/automation/report.json", "{}\n", "Automated QA Session s2");
    git(side, ["pull", "-q", "--rebase", "origin", "main"]);
    git(side, ["fetch", "-q", serving, qa2]);
    git(side, ["cherry-pick", "-x", "FETCH_HEAD"]);
    commitFile(side, "docs/note.md", "upstream edit\n", "docs upstream");
    git(side, ["push", "-q", "origin", "main"]);
    ff = fastForwardMainCheckout(config);
    ok(!ff.pulled && ff.reason.includes("reset --keep refused") && git(serving, ["rev-parse", "HEAD"]) === qa2, "ff: lossless but a dirty file origin changes -> refused, HEAD untouched");
    ok(readFileSync(path.join(serving, "docs", "note.md"), "utf8") === "local edit\n", "ff: the conflicting uncommitted change is left exactly as it was");
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }

  if (failures) {
    console.error(`\nserving-checkout selftest: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log("\nserving-checkout selftest: all passed");
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(2);
});
