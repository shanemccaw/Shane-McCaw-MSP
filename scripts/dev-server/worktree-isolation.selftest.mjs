#!/usr/bin/env node
// scripts/dev-server/worktree-isolation.selftest.mjs
//
// Git #2121 (consolidating #2088 / #2089 / #2094 / #2097) — real, standalone
// regression lock for link-deps.mjs's per-package `@workspace/*` isolation.
//
// The five issues above are all the SAME root cause: a worktree's
// node_modules/@workspace/db used to be a wholesale junction into the MAIN
// checkout (or, under a provisioning race, into an UNRELATED sibling worktree),
// so:
//   * a worktree's own lib/db schema edit was invisible to its consuming
//     artifacts/* code — tsc/tsx/vitest resolved @workspace/db to main's (or a
//     sibling's) unmerged lib/db (#2089-finding1, #2094, #2121);
//   * that single shared link was repointed under concurrent provisioning and
//     dangled cross-worktree, silently breaking type resolution for main and
//     every worktree at once (#2088, #2089-finding2, #2097).
//
// #2152 fixed the mechanism (per-package @workspace linking; third-party stays a
// wholesale junction into the shared store) and it was verified by hand ONCE. It
// had no automated guard — the exact class of "a standing fix silently rots and
// nobody notices until a build loses a day" this repo keeps getting bitten by.
// This test IS that guard: it stands up a faithful throwaway workspace, runs the
// REAL linkDeps(), and asserts the end-user OUTCOME with Node's real resolver —
// so the guarantee is layout-independent (it holds whether pnpm hoists
// @workspace per-package or only to the root node_modules, which is the live
// state today) and every one of the five symptom scenarios is reproduced and
// proven resolved.
//
//   node scripts/dev-server/worktree-isolation.selftest.mjs
//
// Windows-only (linkDeps implements the Windows junction recipe only); prints a
// SKIP and exits 0 elsewhere. Touches nothing outside its own os.tmpdir()
// fixture — no real dev server, checkout, worktree, store or database.
//
// NOTE ON THE FIXTURE: the real lib/db exports source `.ts`; this fixture's
// @workspace/db exports plain `.js`. That is deliberate and faithful — the
// isolation under test is which lib/db a junction TARGETS, which is entirely
// orthogonal to file extension. Using .js lets the probe both RESOLVE and
// EXECUTE-import the marker with zero TypeScript-loader dependency, so the test
// can never go red for a reason unrelated to junction targeting.

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { isWindows } from "./config.mjs";
import { linkDeps, findAndUnlinkWorktreeJunctions, isReparsePoint } from "./link-deps.mjs";

let failures = 0;
function ok(cond, msg) {
  if (cond) {
    console.log(`  ok   - ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL - ${msg}`);
  }
}

function junction(link, target) {
  mkdirSync(path.dirname(link), { recursive: true });
  execFileSync("cmd", ["/c", "mklink", "/J", link, target], { stdio: "ignore" });
}

function writeJson(file, obj) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 2));
}

function writeFile(file, contents) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

/** realpath -> forward-slash + lowercase, or null. Canonicalises links + tmpdir. */
function realNorm(p) {
  try {
    return realpathSync(p).split("\\").join("/").toLowerCase();
  } catch {
    return null;
  }
}

/** True if `child` (a real path or a link) canonically resolves under directory `parent`. */
function under(child, parent) {
  const c = realNorm(child);
  const p = realNorm(parent);
  if (!c || !p) return false;
  return c === p || c.startsWith(p + "/");
}

/**
 * Build one lib/db provider package carrying a distinct DB_MARKER, so we can tell
 * WHICH copy (main / wt1 / wt2) a consumer actually resolved.
 */
function makeLibDb(rootDir, marker) {
  writeJson(path.join(rootDir, "lib", "db", "package.json"), {
    name: "@workspace/db",
    version: "0.0.0",
    type: "module",
    exports: { ".": "./src/index.js", "./schema": "./src/schema/index.js" },
  });
  writeFile(path.join(rootDir, "lib", "db", "src", "index.js"), `export const DB_MARKER = ${JSON.stringify(marker)};\n`);
  writeFile(
    path.join(rootDir, "lib", "db", "src", "schema", "index.js"),
    `export const SCHEMA_MARKER = ${JSON.stringify(marker + "-schema")};\n`
  );
}

/** A source-only consumer host (package.json only; no node_modules — as a fresh worktree checkout has). */
function makeConsumerSource(rootDir, name) {
  writeJson(path.join(rootDir, "artifacts", name, "package.json"), {
    name: `@workspace/${name}`,
    version: "0.0.0",
    type: "module",
    dependencies: { "@workspace/db": "workspace:*", leftpad: "*" },
  });
}

/**
 * Resolve + execute-import @workspace/db (and third-party `leftpad`) from INSIDE a
 * consumer dir, using Node's real resolver. Returns { file, dbMarker, thirdparty }
 * or { error }. A spawned child is the only faithful way — import.meta.resolve
 * resolves relative to the probe module's own location, i.e. the consumer host.
 */
function probeConsumer(consumerDir) {
  const probe = path.join(consumerDir, "__wt_iso_probe.mjs");
  writeFile(
    probe,
    [
      'import { fileURLToPath } from "node:url";',
      'const url = await import.meta.resolve("@workspace/db");',
      "const file = fileURLToPath(url);",
      'const db = await import("@workspace/db");',
      "let thirdparty = null;",
      'try { thirdparty = (await import("leftpad")).THIRDPARTY_MARKER; } catch (e) { thirdparty = "ERR:" + e.code; }',
      "console.log(JSON.stringify({ file, dbMarker: db.DB_MARKER, thirdparty }));",
    ].join("\n")
  );
  try {
    const r = spawnSync(process.execPath, [probe], { cwd: consumerDir, encoding: "utf8" });
    if (r.status !== 0) return { error: `exit ${r.status}: ${(r.stderr || "").trim().slice(0, 500)}` };
    const line = (r.stdout || "").trim().split(/\r?\n/).pop();
    return JSON.parse(line);
  } catch (e) {
    return { error: e.message };
  } finally {
    try { rmSync(probe, { force: true }); } catch {}
  }
}

/** Reparse points still present under a worktree's node_modules trees (top-level + @workspace/*). */
function residualReparsePoints(rootDir) {
  const found = [];
  const hosts = [rootDir, path.join(rootDir, "artifacts", "api-server"), path.join(rootDir, "artifacts", "api-lite")];
  for (const host of hosts) {
    const nm = path.join(host, "node_modules");
    if (!existsSync(nm)) continue;
    if (isReparsePoint(nm)) {
      found.push(nm);
      continue;
    }
    for (const walk of [nm, path.join(nm, "@workspace")]) {
      let entries = [];
      try {
        entries = readdirSync(walk);
      } catch {
        continue;
      }
      for (const e of entries) {
        const p = path.join(walk, e);
        if (isReparsePoint(p)) found.push(p);
      }
    }
  }
  return found;
}

function main() {
  console.log("worktree-isolation.selftest — per-package @workspace isolation (Git #2121 / #2088 / #2089 / #2094 / #2097)");

  if (!isWindows()) {
    console.log("  SKIP - linkDeps implements the Windows junction recipe only; nothing to test on this platform.");
    process.exit(0);
  }

  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "wt-iso-2121-"));
  const main = path.join(tmpRoot, "main");
  const wt1 = path.join(tmpRoot, "wt1");
  const wt2 = path.join(tmpRoot, "wt2");
  const mainJunctions = [];
  const mkMainJunction = (link, target) => {
    junction(link, target);
    mainJunctions.push(link);
  };

  try {
    // ---------------------------------------------------------------------
    // Fixture: a faithful MAIN checkout.
    //   - lib/db provider (DB_MARKER "main-db")
    //   - a shared third-party dep `leftpad` in root node_modules (THIRDPARTY_MARKER
    //     "main-store") — proves worktrees still share the store, never re-download
    //   - root node_modules: per-package @workspace scope (always true in the real
    //     repo — pnpm hoists @workspace to root) + the third-party dep
    //   - artifacts/api-server: a consumer WITH an @workspace scope in its own
    //     node_modules (exercises linkHostPerPackage's @workspace branch)
    //   - artifacts/api-lite: a consumer WITHOUT an @workspace scope (mirrors the
    //     LIVE hoisted layout — its node_modules is wholesale-junctioned and
    //     @workspace/db must resolve via the root node_modules fall-through)
    // ---------------------------------------------------------------------
    writeJson(path.join(main, "package.json"), { name: "iso-fixture-main", private: true });
    makeLibDb(main, "main-db");

    // shared third-party in root store
    writeJson(path.join(main, "node_modules", "leftpad", "package.json"), {
      name: "leftpad",
      version: "0.0.0",
      type: "module",
      exports: { ".": "./index.js" },
    });
    writeFile(path.join(main, "node_modules", "leftpad", "index.js"), 'export const THIRDPARTY_MARKER = "main-store";\n');

    // root node_modules @workspace scope (per-package, as pnpm lays it out)
    mkMainJunction(path.join(main, "node_modules", "@workspace", "db"), path.join(main, "lib", "db"));

    // consumer WITH @workspace scope
    writeJson(path.join(main, "artifacts", "api-server", "package.json"), {
      name: "@workspace/api-server",
      version: "0.0.0",
      type: "module",
      dependencies: { "@workspace/db": "workspace:*", leftpad: "*" },
    });
    mkMainJunction(path.join(main, "artifacts", "api-server", "node_modules", "@workspace", "db"), path.join(main, "lib", "db"));
    mkMainJunction(path.join(main, "artifacts", "api-server", "node_modules", "leftpad"), path.join(main, "node_modules", "leftpad"));

    // consumer WITHOUT @workspace scope (hoisted layout — only third-party in its own nm)
    writeJson(path.join(main, "artifacts", "api-lite", "package.json"), {
      name: "@workspace/api-lite",
      version: "0.0.0",
      type: "module",
      dependencies: { "@workspace/db": "workspace:*", leftpad: "*" },
    });
    mkMainJunction(path.join(main, "artifacts", "api-lite", "node_modules", "leftpad"), path.join(main, "node_modules", "leftpad"));

    // ---------------------------------------------------------------------
    // Two worktrees: SOURCE-ONLY copies, each with its OWN edited lib/db and NO
    // node_modules — exactly what `git worktree add` yields before link-deps runs.
    // ---------------------------------------------------------------------
    for (const [wt, marker] of [[wt1, "wt1-db"], [wt2, "wt2-db"]]) {
      writeJson(path.join(wt, "package.json"), { name: "iso-fixture-wt", private: true });
      makeLibDb(wt, marker);
      makeConsumerSource(wt, "api-server");
      makeConsumerSource(wt, "api-lite");
    }

    // ---------------------------------------------------------------------
    // THE REAL FIX UNDER TEST: provision wt1 via the production linkDeps().
    // ---------------------------------------------------------------------
    const created1 = linkDeps(main, wt1);
    ok(Array.isArray(created1) && created1.length > 0, "linkDeps created worktree links");

    // #2094/#2121 — root node_modules is a REAL per-package dir (not a wholesale
    // junction), and @workspace/db targets THIS worktree's own lib/db.
    ok(existsSync(path.join(wt1, "node_modules")) && !isReparsePoint(path.join(wt1, "node_modules")),
      "wt1 root node_modules is a real per-package dir, not a wholesale junction");
    const wt1RootDb = path.join(wt1, "node_modules", "@workspace", "db");
    ok(isReparsePoint(wt1RootDb) && under(wt1RootDb, path.join(wt1, "lib", "db")),
      "wt1 node_modules/@workspace/db targets wt1's OWN lib/db (not main, not a sibling)");
    ok(!under(wt1RootDb, main), "wt1 @workspace/db does NOT resolve into the MAIN checkout");

    // #2089-finding1 / #2094 — a consumer WITH an @workspace scope resolves +
    // executes wt1's own lib/db edit (the schema-edit-visibility core of the bug).
    const apiServer = probeConsumer(path.join(wt1, "artifacts", "api-server"));
    ok(!apiServer.error, `wt1 api-server probe ran (${apiServer.error || "ok"})`);
    ok(apiServer.file && under(apiServer.file, path.join(wt1, "lib", "db")),
      `wt1 api-server resolves @workspace/db under wt1's own lib/db (${apiServer.file})`);
    ok(apiServer.dbMarker === "wt1-db",
      `wt1 api-server EXECUTES wt1's own lib/db edit (DB_MARKER=${apiServer.dbMarker}, expected wt1-db)`);

    // #2088/#2089-finding2 — a consumer WITHOUT an @workspace scope (the LIVE
    // hoisted layout) is ALSO isolated: @workspace/db resolves via the root
    // node_modules fall-through to wt1's own lib/db, never main's.
    const apiLite = probeConsumer(path.join(wt1, "artifacts", "api-lite"));
    ok(!apiLite.error, `wt1 api-lite probe ran (${apiLite.error || "ok"})`);
    ok(apiLite.file && under(apiLite.file, path.join(wt1, "lib", "db")),
      `wt1 api-lite resolves @workspace/db under wt1's own lib/db (${apiLite.file})`);
    ok(apiLite.dbMarker === "wt1-db",
      `wt1 api-lite (wholesale-junction host, root fall-through) resolves wt1's OWN lib/db (DB_MARKER=${apiLite.dbMarker}, expected wt1-db)`);

    // Junction economy still holds: third-party deps come from MAIN's shared store,
    // not re-downloaded per worktree.
    ok(apiServer.thirdparty === "main-store" && apiLite.thirdparty === "main-store",
      `third-party (leftpad) still resolves from MAIN's shared store (api-server=${apiServer.thirdparty}, api-lite=${apiLite.thirdparty})`);

    // #2088/#2097 — provisioning a worktree NEVER repoints the MAIN checkout's own
    // @workspace links at a worktree (the poison that broke main + all worktrees).
    ok(under(path.join(main, "node_modules", "@workspace", "db"), path.join(main, "lib", "db")),
      "MAIN root @workspace/db still targets main's own lib/db (never repointed at a worktree)");
    ok(under(path.join(main, "artifacts", "api-server", "node_modules", "@workspace", "db"), path.join(main, "lib", "db")),
      "MAIN api-server @workspace/db still targets main's own lib/db (never repointed at a worktree)");

    // ---------------------------------------------------------------------
    // #2088/#2089-finding2 — CROSS-WORKTREE independence. Provisioning wt2 must not
    // perturb wt1, and each worktree resolves strictly its OWN lib/db.
    // ---------------------------------------------------------------------
    const created2 = linkDeps(main, wt2);
    ok(Array.isArray(created2) && created2.length > 0, "linkDeps provisioned a second concurrent worktree");

    const wt1After = probeConsumer(path.join(wt1, "artifacts", "api-server"));
    ok(wt1After.dbMarker === "wt1-db",
      `wt1 STILL resolves its own lib/db after wt2 was provisioned (DB_MARKER=${wt1After.dbMarker}, expected wt1-db — not clobbered cross-worktree)`);
    const wt2Probe = probeConsumer(path.join(wt2, "artifacts", "api-server"));
    ok(wt2Probe.dbMarker === "wt2-db",
      `wt2 resolves its OWN lib/db, not wt1's or main's (DB_MARKER=${wt2Probe.dbMarker}, expected wt2-db)`);

    // ---------------------------------------------------------------------
    // #2152 delete-through safety — cleanup unlinks every inner junction with no
    // survivor, so a subsequent recursive worktree removal can never delete THROUGH
    // a junction into the shared store (which is how one swept worktree used to
    // break main + all others).
    // ---------------------------------------------------------------------
    const cleanup1 = findAndUnlinkWorktreeJunctions(wt1);
    ok(cleanup1.remaining.length === 0,
      `cleanup unlinked every wt1 inner junction, none survived (remaining=${cleanup1.remaining.length})`);
    ok(residualReparsePoints(wt1).length === 0, "no reparse point survives under wt1's node_modules after cleanup");

    // Now a real recursive removal of wt1 must NOT touch main's lib/db.
    rmSync(wt1, { recursive: true, force: true });
    ok(
      existsSync(path.join(main, "lib", "db", "src", "index.js")) &&
        readFileSync(path.join(main, "lib", "db", "src", "index.js"), "utf8").includes("main-db"),
      "MAIN lib/db survived a recursive removal of wt1 intact (no delete-through into the shared store)"
    );
    // main's own @workspace/db link is still healthy after the removal.
    ok(under(path.join(main, "node_modules", "@workspace", "db"), path.join(main, "lib", "db")),
      "MAIN @workspace/db still resolves to main's lib/db after wt1 removal");

    console.log(
      failures === 0
        ? "\nAll worktree-isolation self-tests passed — #2088 / #2089 / #2094 / #2097 / #2121 isolation holds."
        : `\n${failures} assertion(s) FAILED — worktree @workspace isolation has regressed.`
    );
  } finally {
    // Unlink every junction we created (worktree AND main-fixture) BEFORE the
    // recursive temp-dir removal, so rmSync never follows a reparse point.
    try { findAndUnlinkWorktreeJunctions(wt1); } catch {}
    try { findAndUnlinkWorktreeJunctions(wt2); } catch {}
    for (const link of mainJunctions) {
      try {
        if (isReparsePoint(link)) execFileSync("cmd", ["/c", "rmdir", link], { stdio: "ignore" });
      } catch {}
    }
    try {
      if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }

  process.exit(failures === 0 ? 0 : 1);
}

main();
