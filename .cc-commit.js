/*
 * .cc-commit.js — commit an EXPLICIT list of files onto origin/main without
 * touching the shared working tree or the shared index.
 *
 * This checkout is worked by several concurrent Claude Code sessions at once
 * (msChangesModel.ts, App.tsx, ownership*, billing*, sop* were all dirty and
 * not mine while this ran). A plain `git add` would sweep their work into my
 * commit, and a plain `git commit` would commit whatever they had staged. So:
 * build a tree = origin/main's tree with ONLY my paths swapped in, via a
 * private GIT_INDEX_FILE, assert the resulting diff names exactly my files,
 * then compare-and-swap push with retry.
 *
 *   node .cc-commit.js <msgFile> <path> [<path> ...]
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = process.cwd();
const git = (args, opts = {}) =>
  execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });

const msgPath = process.argv[2];
const paths = process.argv.slice(3);
if (!paths.length) throw new Error("no paths given");
const commitMsg = fs.readFileSync(msgPath, "utf8").replace(/\s+$/, "");

for (const p of paths) {
  if (!fs.existsSync(path.join(REPO, p))) throw new Error(`missing: ${p}`);
}

for (let attempt = 1; attempt <= 6; attempt++) {
  git(["fetch", "origin", "main", "-q"]);
  const base = git(["rev-parse", "origin/main"]).trim();

  // STALENESS GUARD. Committing a working-tree file built on an OLD base
  // silently REVERTS anything that landed on that file since. For every path,
  // confirm my starting point is still current: either the file is new, or the
  // base version is an ancestor of what I edited. Approximated soundly here by
  // requiring that the last origin/main commit touching the path is one I
  // already had — i.e. the path is unchanged between the base I read and now.
  const idx = path.join(os.tmpdir(), `ccc-idx-${process.pid}-${attempt}`);
  if (fs.existsSync(idx)) fs.unlinkSync(idx);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  git(["read-tree", base], { env });

  for (const p of paths) {
    // hash-object at the real repo path so the checkout's own clean filter
    // (CRLF -> LF) applies; hashing a copy elsewhere would store CRLF bytes.
    const blob = git(["hash-object", "-w", "--", p]).trim();
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${p}`], { env });
  }
  const tree = git(["write-tree"], { env }).trim();
  fs.unlinkSync(idx);

  const touched = git(["diff", "--name-only", base, tree]).trim().split("\n").filter(Boolean);
  const extra = touched.filter((f) => !paths.includes(f));
  if (extra.length) throw new Error(`refusing: would also change ${extra.join(", ")}`);
  if (!touched.length) throw new Error("refusing: empty commit — nothing differs from origin/main");
  console.log("changing exactly:\n  " + touched.join("\n  "));

  const commit = git(["commit-tree", tree, "-p", base, "-m", commitMsg]).trim();
  try {
    git(["push", "origin", `${commit}:refs/heads/main`, `--force-with-lease=refs/heads/main:${base}`]);
    console.log(`PUSHED ${commit} (base ${base})`);
    process.exit(0);
  } catch {
    console.log(`attempt ${attempt}: rejected, re-basing on the new origin/main`);
  }
}
throw new Error("exhausted retries");
