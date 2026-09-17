#!/usr/bin/env node
// scripts/dev-server/store-doctor-skipped-optional.selftest.mjs
//
// Git #4508 — self-test for store-doctor's SKIPPED-OPTIONAL classification. Real
// evidence (main checkout, 2026-09-17): the "store poisoned ... dangling=76 ... still
// not clean after repair" banner was 38 optional deps pnpm recorded as `skipped` in
// node_modules/.modules.yaml (other-OS/CPU native builds + @emnapi/runtime), each
// hoisted twice as a link to a .pnpm/<pkg> dir that never exists on this host. This
// proves those are excused (and never repaired) while a genuinely dangling link, a
// foreign link, and a store without .modules.yaml are all still reported.
//
// Everything lives in a throwaway temp dir — never touches the real checkout.
//
//   node scripts/dev-server/store-doctor-skipped-optional.selftest.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanSharedStore, repairSharedStore } from "./store-doctor.mjs";

let failures = 0;
function ok(cond, msg) {
  if (cond) {
    console.log(`  ok  - ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL - ${msg}`);
  }
}

function junction(link, target) {
  mkdirSync(path.dirname(link), { recursive: true });
  execFileSync("cmd", ["/c", "mklink", "/J", link, target], { stdio: "ignore" });
}

/** Lay out a store shaped like the real one: hoisted + root links to skipped and non-skipped packages. */
function buildStore(root, modulesYaml) {
  const nm = path.join(root, "node_modules");
  const pnpm = path.join(nm, ".pnpm");
  mkdirSync(pnpm, { recursive: true });
  if (modulesYaml !== null) writeFileSync(path.join(nm, ".modules.yaml"), modulesYaml);

  // A healthy, real package (so the store isn't trivially empty).
  const realPkg = path.join(pnpm, "real@1.0.0", "node_modules", "real");
  mkdirSync(realPkg, { recursive: true });
  writeFileSync(path.join(realPkg, "index.js"), "module.exports = 1;\n");
  junction(path.join(pnpm, "node_modules", "real"), realPkg);

  // Skipped, scoped: hoisted link straight at a never-created virtual-store dir.
  junction(
    path.join(pnpm, "node_modules", "@esbuild", "linux-x64"),
    path.join(pnpm, "@esbuild+linux-x64@0.27.3", "node_modules", "@esbuild", "linux-x64")
  );
  // Skipped, unscoped, as a CHAIN: root link -> hoisted link -> never-created dir.
  junction(path.join(pnpm, "node_modules", "fsevents"), path.join(pnpm, "fsevents@2.3.3", "node_modules", "fsevents"));
  junction(path.join(nm, "fsevents"), path.join(pnpm, "node_modules", "fsevents"));
  // Skipped with a peer suffix (pnpm renders "(peer)" into the dir name as "_peer").
  junction(
    path.join(pnpm, "node_modules", "peered"),
    path.join(pnpm, "peered@2.0.0_react@19.1.0", "node_modules", "peered")
  );
  // NOT skipped: a genuinely dangling link — must still be DANGLING.
  junction(path.join(pnpm, "node_modules", "lodash"), path.join(pnpm, "lodash@4.17.21", "node_modules", "lodash"));
  // Similar-prefix name that is NOT skipped (fsevents-extra must not match fsevents@...).
  junction(
    path.join(pnpm, "node_modules", "fsevents-extra"),
    path.join(pnpm, "fsevents-extra@2.3.3", "node_modules", "fsevents-extra")
  );
}

function main() {
  if (process.platform !== "win32") {
    console.log("store-doctor skipped-optional self-test is Windows-junction-specific — skipping on this platform.");
    process.exit(0);
  }
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "store-doctor-4508-"));
  const skipped = ["@esbuild/linux-x64@0.27.3", "fsevents@2.3.3", "peered@2.0.0(react@19.1.0)"];
  try {
    // --- pnpm 11 shape: .modules.yaml is JSON. ---
    const jsonRoot = path.join(tmpRoot, "json");
    buildStore(jsonRoot, JSON.stringify({ layoutVersion: 5, skipped }, null, 2));
    const scan = scanSharedStore(jsonRoot);
    const names = (arr) => arr.map((e) => path.relative(jsonRoot, e.link)).sort();
    console.log("  skippedOptional:", names(scan.skippedOptionalLinks).join(", "));
    console.log("  dangling:", names(scan.danglingLinks).join(", "));
    ok(scan.skippedOptionalLinks.length === 4, "4 links to skipped packages classified skipped-optional (incl. chain + peer suffix)");
    ok(
      names(scan.skippedOptionalLinks).includes(path.join("node_modules", "fsevents")),
      "root -> hoisted -> skipped chain is followed and excused"
    );
    ok(scan.danglingLinks.length === 2, "genuinely dangling non-skipped links (lodash, fsevents-extra) are still DANGLING");
    ok(scan.clean === false, "store with real dangling links is still not clean");
    ok(!("_skippedDirs" in JSON.parse(JSON.stringify(scan))), "internal skipped-dir set does not leak into --json output");

    const repair = repairSharedStore(jsonRoot, scan);
    ok(
      repair.unrepairable.every((u) => !u.link.includes("esbuild") && !path.basename(u.link).startsWith("peered")),
      "repair never attempts a skipped-optional link"
    );
    ok(
      lstatSync(path.join(jsonRoot, "node_modules", ".pnpm", "node_modules", "@esbuild", "linux-x64")).isSymbolicLink(),
      "skipped-optional link is left exactly as pnpm wrote it"
    );

    // --- Only skipped links left -> clean. ---
    const onlySkippedRoot = path.join(tmpRoot, "only-skipped");
    buildStore(onlySkippedRoot, JSON.stringify({ skipped: [...skipped, "lodash@4.17.21", "fsevents-extra@2.3.3"] }));
    const cleanScan = scanSharedStore(onlySkippedRoot);
    ok(cleanScan.clean === true && cleanScan.skippedOptionalLinks.length === 6, "a store whose only dangling links are pnpm-skipped reads CLEAN");

    // --- Older pnpm shape: real YAML. ---
    const yamlRoot = path.join(tmpRoot, "yaml");
    buildStore(yamlRoot, `layoutVersion: 5\nskipped:\n  - '@esbuild/linux-x64@0.27.3'\n  - fsevents@2.3.3\n  - peered@2.0.0(react@19.1.0)\nstoreDir: x\n`);
    const yamlScan = scanSharedStore(yamlRoot);
    ok(yamlScan.skippedOptionalLinks.length === 4 && yamlScan.danglingLinks.length === 2, "YAML-format .modules.yaml skipped list is honoured too");

    // --- Fail-safe: no .modules.yaml -> nothing is excused. ---
    const noManifestRoot = path.join(tmpRoot, "no-manifest");
    buildStore(noManifestRoot, null);
    const nmScan = scanSharedStore(noManifestRoot);
    ok(nmScan.skippedOptionalLinks.length === 0 && nmScan.danglingLinks.length === 6, "without .modules.yaml every dangling link is reported (fail-safe)");

    // --- A FOREIGN link is never excused, even to a skipped-looking path. ---
    const foreignRoot = path.join(tmpRoot, "foreign");
    buildStore(foreignRoot, JSON.stringify({ skipped }));
    junction(
      path.join(foreignRoot, "node_modules", "@esbuild", "linux-x64"),
      path.join(tmpRoot, "gone-wt", "node_modules", ".pnpm", "@esbuild+linux-x64@0.27.3", "node_modules", "@esbuild", "linux-x64")
    );
    const fScan = scanSharedStore(foreignRoot);
    ok(fScan.foreignLinks.length === 1 && !fScan.clean, "a foreign link to a skipped package name is still FOREIGN");

    console.log(failures === 0 ? "\nAll store-doctor skipped-optional self-tests passed." : `\n${failures} assertion(s) FAILED.`);
  } finally {
    try {
      if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
