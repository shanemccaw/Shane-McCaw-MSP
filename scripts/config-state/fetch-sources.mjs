#!/usr/bin/env node
/**
 * #1794 — Fetch the two PUBLISHED sources the Graph configuration resource model is
 * derived from. Deliberately two downloads, not thousands of probes:
 *
 *   1. Microsoft Graph's own CSDL `$metadata` (v1.0 + beta) — the authoritative,
 *      machine-readable entity model: every entity/complex/enum type, its property
 *      set with EDM types, and the EntityContainer that gives real addressable paths.
 *   2. The Microsoft365DSC resource map — 500+ DSC resources, each pairing a
 *      configuration object with its workload, its read cmdlets and (critically)
 *      its required *application* (app-only) permissions. Third-party open source
 *      (MIT), read here for its factual map and attributed as such; nothing is
 *      copied into the product.
 *
 * Writes into a gitignored cache dir so re-runs are cheap and offline-repeatable.
 *
 * Usage:  node scripts/config-state/fetch-sources.mjs [--cache <dir>] [--force]
 */
import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { DEFAULT_CACHE_DIR, SOURCES } from "./sources.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const FORCE = process.argv.includes("--force");
const cacheDir = path.resolve(arg("--cache", DEFAULT_CACHE_DIR));

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/**
 * The `tar` resolved on PATH in this environment is MSYS/Git-Bash's GNU tar, which
 * expects POSIX-style paths. A native Windows path ("C:\wt\...") passed straight
 * through gets mis-parsed by MSYS's argv path translation (backslashes read as
 * escapes) and by GNU tar's own "host:path" remote-archive heuristic (the bare
 * drive-letter colon). Converting to the MSYS POSIX form ("/c/wt/...") avoids both.
 */
function toMsysPath(p) {
  const m = /^([A-Za-z]):(.*)$/.exec(p);
  if (!m) return p;
  return `/${m[1].toLowerCase()}${m[2].replace(/\\/g, "/")}`;
}

async function download(url, dest, { accept } = {}) {
  if (!FORCE && await exists(dest)) {
    const s = await stat(dest);
    console.log(`  cached  ${path.basename(dest)} (${s.size.toLocaleString()} bytes)`);
    return;
  }
  console.log(`  GET     ${url}`);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "shane-mccaw-msp-config-state/1794",
      ...(accept ? { Accept: accept } : {}),
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`  saved   ${path.basename(dest)} (${buf.length.toLocaleString()} bytes)`);
}

/** Untar just the DSC resource tree — settings.json, schema.mof and the psm1 we read URIs from. */
function extractDscResources(tarball, into) {
  return new Promise((resolve, reject) => {
    // --force-local, belt-and-braces against GNU tar's "host:path" remote-archive
    // heuristic (the drive-letter colon otherwise reads as a hostname separator —
    // "Cannot connect to C: resolve failed"), plus toMsysPath() for MSYS's own argv
    // path translation, which mis-parses a raw Windows backslash path outright
    // (Git #1865 — hit re-running this pipeline on Windows).
    const p = spawn("tar", ["xzf", toMsysPath(tarball), "-C", toMsysPath(into), "--force-local", "--wildcards", "*/Modules/Microsoft365DSC/DscResources/*"], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))));
  });
}

async function main() {
  await mkdir(cacheDir, { recursive: true });
  console.log(`config-state sources -> ${cacheDir}`);

  console.log("Microsoft Graph $metadata (CSDL):");
  for (const [version, url] of Object.entries(SOURCES.graphMetadata)) {
    await download(url, path.join(cacheDir, `graph-${version}-metadata.xml`));
  }

  console.log("Microsoft Graph permissions reference (Kibali schema):");
  await download(SOURCES.graphPermissions, path.join(cacheDir, "graph-permissions.json"));

  console.log("Microsoft365DSC resource map:");
  // Resolve the real HEAD commit first so the extraction records exact provenance
  // rather than a moving branch name.
  const repoRes = await fetch(`https://api.github.com/repos/${SOURCES.m365dsc.repo}/commits/${SOURCES.m365dsc.ref}`, {
    headers: { "User-Agent": "shane-mccaw-msp-config-state/1794", Accept: "application/vnd.github+json" },
    redirect: "follow",
  });
  if (!repoRes.ok) throw new Error(`M365DSC commit lookup -> HTTP ${repoRes.status}`);
  const commit = (await repoRes.json()).sha;
  console.log(`  ref     ${SOURCES.m365dsc.repo}@${SOURCES.m365dsc.ref} = ${commit}`);

  const tarball = path.join(cacheDir, "m365dsc.tar.gz");
  await download(
    `https://api.github.com/repos/${SOURCES.m365dsc.repo}/tarball/${commit}`,
    tarball,
    { accept: "application/vnd.github+json" },
  );

  const treeDir = path.join(cacheDir, "m365dsc");
  if (FORCE || !(await exists(treeDir))) {
    await mkdir(treeDir, { recursive: true });
    console.log("  extract DscResources/ ...");
    await extractDscResources(tarball, treeDir);
  } else {
    console.log("  cached  m365dsc/ tree");
  }

  await writeFile(
    path.join(cacheDir, "provenance.json"),
    JSON.stringify({ fetchedAt: new Date().toISOString(), m365dscCommit: commit, sources: SOURCES }, null, 2),
  );
  console.log("Done. Provenance written to provenance.json");
}

main().catch((err) => {
  console.error(`fetch-sources failed: ${err.message}`);
  process.exit(1);
});
