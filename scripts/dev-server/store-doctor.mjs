#!/usr/bin/env node
// scripts/dev-server/store-doctor.mjs
//
// Git #1988 — detect (and, only when explicitly asked, repair) the poisoned
// shared-store state: pnpm links or .bin cmd-shims inside the MAIN checkout's
// node_modules trees that resolve into an agent worktree (C:\wt\<id>\...) or
// dangle at a target that no longer exists. This is the state a worktree
// `pnpm install` used to leave behind (incidents #1951 #1955 #1959 #1964 #1967
// #1974) — the .pnpmfile.cjs gate now fails that install closed; this script is
// what makes any occurrence that still lands visible in seconds instead of
// after a lost session.
//
// Usage:
//   node scripts/dev-server/store-doctor.mjs                  # scan, report, exit 0 clean / 1 poisoned
//   node scripts/dev-server/store-doctor.mjs --json           # machine-readable report
//   node scripts/dev-server/store-doctor.mjs --repair         # EXPLICIT repair pass, then rescan
//   node scripts/dev-server/store-doctor.mjs --root <path>    # scan a different checkout (tests)
//
// Scan targets, per workspace-package host (root, artifacts/*, lib/*,
// lib/integrations/*, scripts — the same set link-deps.mjs junctions):
//   * every per-package link in <host>/node_modules (top level and @scoped), plus
//     the hidden hoisted links under <root>/node_modules/.pnpm/node_modules:
//       - FOREIGN : a reparse point resolving OUTSIDE the scanned root
//       - DANGLING: a reparse point whose resolved target no longer exists
//   * every file in <host>/node_modules/.bin: absolute paths baked into shims
//     that point into a worktree (`\wt\`) or point outside the root at a path
//     that no longer exists (#1967's vitest shim class).
//
// Repair (--repair only — NEVER automatic; an automatic repair would hide the
// recurrence this exists to surface):
//   * a foreign/dangling link is re-pointed — as an absolute junction — at the
//     same store-relative path under the scanned root, but only when that
//     target really exists and is non-empty. Absolute junctions also dodge the
//     relative-symlink-under-junction NTFS resolution quirk documented in #1959.
//   * a poisoned .bin shim has its baked worktree root rewritten to the scanned
//     root, only when the resulting target file really exists.
//   * anything else is reported as unrepairable, honestly. NOTE: an unrepairable
//     entry (e.g. #1974's empty .pnpm store dir) means the store copy itself is
//     missing — relinking cannot fix that, and per the #1987/#1988 bandwidth
//     rule this script neither runs nor prescribes an install; a deliberate
//     reinstall decision belongs to Shane.
//
// Exit codes: 0 = clean (after repair, if requested), 1 = poisoned/unrepaired,
// 2 = could not scan at all.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";

const WT_ROOT_RE = /^[A-Za-z]:[\\/]wt[\\/]([^\\/]+)[\\/]?/i;
const WT_SEGMENT_RE = /[\\/]wt[\\/]/i;

function isReparsePoint(p) {
  try {
    return lstatSync(p).isSymbolicLink(); // junctions and symlinks both report true
  } catch {
    return false;
  }
}

function resolveLinkTarget(link) {
  try {
    const raw = readlinkSync(link).replace(/^\\\\\?\\/, "");
    return path.resolve(path.dirname(link), raw);
  } catch {
    return null;
  }
}

function isUnder(child, root) {
  return (child + path.sep).toLowerCase().startsWith((root + path.sep).toLowerCase());
}

/** Workspace-package dirs that can host a node_modules (mirrors link-deps.mjs). */
function nodeModulesHosts(root) {
  const hosts = [root];
  for (const group of ["artifacts", "lib", "lib/integrations", "scripts"]) {
    const dir = path.join(root, group);
    if (!existsSync(dir)) continue;
    if (group === "scripts") {
      hosts.push(dir);
      continue;
    }
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const sub = path.join(dir, name);
      if (existsSync(path.join(sub, "package.json"))) hosts.push(sub);
    }
  }
  return hosts.filter((h) => existsSync(path.join(h, "node_modules")));
}

function checkLink(root, link, out) {
  if (!isReparsePoint(link)) return;
  out.linksChecked++;
  const target = resolveLinkTarget(link);
  if (!target) {
    out.danglingLinks.push({ link, target: "(unreadable)" });
    return;
  }
  if (!isUnder(target, root)) {
    out.foreignLinks.push({ link, target });
    return;
  }
  if (!existsSync(target)) {
    out.danglingLinks.push({ link, target });
  }
}

function scanPackageLinks(root, nmDir, out) {
  let entries;
  try {
    entries = readdirSync(nmDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === ".bin" || name === ".pnpm" || name.startsWith(".")) continue;
    const p = path.join(nmDir, name);
    if (name.startsWith("@")) {
      let scoped;
      try {
        scoped = readdirSync(p);
      } catch {
        continue;
      }
      for (const inner of scoped) checkLink(root, path.join(p, inner), out);
    } else {
      checkLink(root, p, out);
    }
  }
}

function scanBinShims(root, nmDir, out) {
  const binDir = path.join(nmDir, ".bin");
  let entries;
  try {
    entries = readdirSync(binDir);
  } catch {
    return;
  }
  for (const name of entries) {
    const file = path.join(binDir, name);
    let st;
    try {
      st = lstatSync(file);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      checkLink(root, file, out);
      continue;
    }
    if (!st.isFile() || st.size > 1024 * 1024) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    out.binFilesChecked++;
    const badPaths = new Set();
    // Windows-style absolute paths. The drive letter must sit at a real boundary
    // (sh/ps1 shims carry POSIX NODE_PATH lists like "...node_modules:/mnt/c/..."
    // where the trailing 's' + ':' fakes a drive), and ':' is excluded from the
    // path body (a Windows path never contains one past the drive — colons there
    // are POSIX list separators).
    for (const m of text.matchAll(/(?<![A-Za-z0-9_$])[A-Za-z]:[\\/][^\r\n"'<>|;:]+/g)) {
      const p = m[0].trim();
      if (WT_SEGMENT_RE.test(p)) {
        // Anything anchored into a C:\wt\<id> worktree is poison even if the
        // worktree still exists right now — it is transient by definition.
        badPaths.add(p);
      } else if (!isUnder(p, root) && !existsSync(p)) {
        badPaths.add(p);
      }
    }
    // POSIX-form worktree anchors in sh shims (e.g. /mnt/c/wt/<id>/... or /c/wt/<id>/...).
    for (const m of text.matchAll(/\/(?:mnt\/)?[a-z]\/wt\/[^\s"':]+/gi)) {
      badPaths.add(m[0]);
    }
    if (badPaths.size > 0) {
      out.poisonedBins.push({ file, badPaths: [...badPaths] });
    }
  }
}

/**
 * Scan a checkout's shared node_modules trees for foreign/dangling links and
 * poisoned .bin shims. Read-only. Safe to run from any worktree.
 */
export function scanSharedStore(root) {
  const out = {
    root,
    hostsScanned: 0,
    linksChecked: 0,
    binFilesChecked: 0,
    foreignLinks: [],
    danglingLinks: [],
    poisonedBins: [],
    clean: true,
  };
  const rootNm = path.join(root, "node_modules");
  if (isReparsePoint(rootNm)) {
    // Scanning THROUGH a junctioned view double-reports someone else's store; the
    // caller should scan the main checkout (the default via loadConfig()).
    out.note = `node_modules at ${root} is itself a junction — scan the real checkout instead`;
    return out;
  }
  for (const host of nodeModulesHosts(root)) {
    out.hostsScanned++;
    const nm = path.join(host, "node_modules");
    if (isReparsePoint(nm)) continue; // a junctioned host inside a real checkout: nothing of ours to scan
    scanPackageLinks(root, nm, out);
    scanBinShims(root, nm, out);
  }
  // pnpm's hidden hoisted links live under <root>/node_modules/.pnpm/node_modules.
  const hoisted = path.join(rootNm, ".pnpm", "node_modules");
  if (existsSync(hoisted)) scanPackageLinks(root, hoisted, out);
  out.clean =
    out.foreignLinks.length === 0 && out.danglingLinks.length === 0 && out.poisonedBins.length === 0;
  return out;
}

/** Map a foreign/dangling target to its equivalent path under `root`, or null. */
function candidateUnderRoot(root, target) {
  const wt = target.match(WT_ROOT_RE);
  if (wt) {
    const rel = target.replace(WT_ROOT_RE, "");
    return rel ? path.join(root, rel) : null;
  }
  const lower = target.toLowerCase();
  const marker = `${path.sep}node_modules${path.sep}`;
  const idx = lower.indexOf(marker.toLowerCase());
  if (idx >= 0) return path.join(root, target.slice(idx + 1));
  return null;
}

function replaceWithJunction(link, target) {
  try {
    rmdirSync(link); // removes the reparse point only, never the target's contents
  } catch {
    unlinkSync(link);
  }
  execFileSync("cmd", ["/c", "mklink", "/J", link, target], { stdio: "ignore" });
}

/**
 * EXPLICIT repair pass over a scan result. Only re-points entries whose real
 * store copy exists under root; everything else lands in `unrepairable`.
 */
export function repairSharedStore(root, scan) {
  const res = { repairedLinks: [], repairedBins: [], unrepairable: [] };

  for (const bad of [...scan.foreignLinks, ...scan.danglingLinks]) {
    const cand = bad.target === "(unreadable)" ? null : candidateUnderRoot(root, bad.target);
    let usable = false;
    if (cand && existsSync(cand)) {
      try {
        const st = statSync(cand);
        usable = st.isDirectory() ? readdirSync(cand).length > 0 : st.isFile();
      } catch {}
    }
    if (!usable) {
      res.unrepairable.push({
        link: bad.link,
        target: bad.target,
        reason: cand
          ? `store copy at ${cand} is missing or empty — relinking cannot fix this (see header note)`
          : "no equivalent path under this root could be derived",
      });
      continue;
    }
    try {
      replaceWithJunction(bad.link, cand);
      res.repairedLinks.push({ link: bad.link, from: bad.target, to: cand });
    } catch (e) {
      res.unrepairable.push({ link: bad.link, target: bad.target, reason: `relink failed: ${e.message}` });
    }
  }

  for (const bin of scan.poisonedBins) {
    let text;
    try {
      text = readFileSync(bin.file, "utf8");
    } catch (e) {
      res.unrepairable.push({ link: bin.file, target: bin.badPaths.join(", "), reason: `read failed: ${e.message}` });
      continue;
    }
    let changed = false;
    const stillBad = [];
    for (const p of bin.badPaths) {
      const wt = p.match(WT_ROOT_RE);
      if (!wt) {
        stillBad.push(p);
        continue;
      }
      const mapped = path.join(root, p.replace(WT_ROOT_RE, ""));
      if (!existsSync(mapped)) {
        stillBad.push(p);
        continue;
      }
      text = text.split(p).join(mapped);
      changed = true;
    }
    if (changed) {
      try {
        writeFileSync(bin.file, text);
        res.repairedBins.push({ file: bin.file, remaining: stillBad });
      } catch (e) {
        res.unrepairable.push({ link: bin.file, target: bin.badPaths.join(", "), reason: `write failed: ${e.message}` });
        continue;
      }
    }
    if (stillBad.length > 0) {
      res.unrepairable.push({
        link: bin.file,
        target: stillBad.join(", "),
        reason: "baked path has no existing equivalent under this root — the real binary is gone (see header note)",
      });
    }
  }

  return res;
}

function printScan(scan) {
  console.log(`store-doctor — scanned ${scan.root}`);
  console.log(
    `  hosts: ${scan.hostsScanned}, links checked: ${scan.linksChecked}, .bin files checked: ${scan.binFilesChecked}`
  );
  if (scan.note) console.log(`  ! ${scan.note}`);
  const show = (label, arr, fmt) => {
    if (arr.length === 0) return;
    console.log(`  ${label}: ${arr.length}`);
    for (const item of arr.slice(0, 25)) console.log(`    - ${fmt(item)}`);
    if (arr.length > 25) console.log(`    ...and ${arr.length - 25} more`);
  };
  show("FOREIGN links (resolve outside this checkout)", scan.foreignLinks, (f) => `${f.link} -> ${f.target}`);
  show("DANGLING links (target gone)", scan.danglingLinks, (f) => `${f.link} -> ${f.target}`);
  show("POISONED .bin shims", scan.poisonedBins, (b) => `${b.file} [${b.badPaths.join(", ")}]`);
  console.log(scan.clean ? "  CLEAN — no foreign, dangling or poisoned entries." : "  POISONED — see entries above.");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const repair = argv.includes("--repair");
  const rootIdx = argv.indexOf("--root");
  let root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1] || "") : null;
  if (!root) {
    try {
      root = loadConfig().mainRepoRoot;
    } catch (e) {
      console.error(`store-doctor: could not resolve the main checkout: ${e.message}`);
      process.exit(2);
    }
  }
  if (!root || !existsSync(path.join(root, "node_modules"))) {
    console.error(`store-doctor: no node_modules at ${root || "(unresolved root)"} — nothing to scan.`);
    process.exit(2);
  }

  let scan = scanSharedStore(root);
  let repairRes = null;
  if (repair && !scan.clean) {
    repairRes = repairSharedStore(root, scan);
    scan = scanSharedStore(root); // rescan so the verdict reflects post-repair reality
  }

  if (json) {
    console.log(JSON.stringify({ scan, repair: repairRes }, null, 2));
  } else {
    if (repairRes) {
      console.log(
        `store-doctor --repair: relinked ${repairRes.repairedLinks.length} link(s), rewrote ${repairRes.repairedBins.length} shim(s), unrepairable ${repairRes.unrepairable.length}`
      );
      for (const u of repairRes.unrepairable) console.log(`    ! ${u.link}: ${u.reason}`);
    }
    printScan(scan);
  }
  process.exit(scan.clean ? 0 : 1);
}
