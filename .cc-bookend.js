/*
 * .cc-bookend.js — append/replace ONE PLATFORM_BUILD.md row against origin/main
 * and push it as an isolated commit, without touching the shared working tree.
 *
 * Implements the Shared File Write Discipline in CLAUDE.md: always re-base on
 * the CURRENT remote content, change only my own line, assert the diff is
 * exactly 1 insertion / 0-1 deletions, then compare-and-swap push with retry.
 *
 *   node .cc-bookend.js insert <rowFile> <commitMsgFile>
 *   node .cc-bookend.js replace <matchSubstring> <rowFile> <commitMsgFile>
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FILE = "PLATFORM_BUILD.md";
const REPO = process.cwd();

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
}
function gitBuf(args) {
  return execFileSync("git", args, { cwd: REPO, maxBuffer: 256 * 1024 * 1024 });
}

const mode = process.argv[2];
const rowPath = mode === "replace" ? process.argv[4] : process.argv[3];
const msgPath = mode === "replace" ? process.argv[5] : process.argv[4];
const matchSub = mode === "replace" ? process.argv[3] : null;

const row = fs.readFileSync(rowPath, "utf8").replace(/\r?\n$/, "");
const commitMsg = fs.readFileSync(msgPath, "utf8").replace(/\r?\n$/, "");
if (!row.startsWith("|") || !row.endsWith("|")) throw new Error("row must be a full table row");

for (let attempt = 1; attempt <= 6; attempt++) {
  git(["fetch", "origin", "main", "-q"]);
  const base = git(["rev-parse", "origin/main"]).trim();
  const original = gitBuf(["show", `${base}:${FILE}`]).toString("utf8");
  const lines = original.split("\n");

  let next;
  if (mode === "insert") {
    const sep = lines.findIndex((l) => /^\|-+\|/.test(l));
    if (sep < 0) throw new Error("separator row not found");
    next = [...lines.slice(0, sep + 1), row, ...lines.slice(sep + 1)];
  } else {
    const hits = lines.reduce((a, l, i) => (l.includes(matchSub) ? [...a, i] : a), []);
    if (hits.length !== 1) throw new Error(`match '${matchSub}' hit ${hits.length} rows, need exactly 1`);
    next = [...lines];
    next[hits[0]] = row;
  }

  const content = next.join("\n");
  const tmp = path.join(os.tmpdir(), `pbm-${process.pid}-${attempt}.md`);
  fs.writeFileSync(tmp, content, "utf8");
  const blob = git(["hash-object", "-w", "--", tmp]).trim();
  fs.unlinkSync(tmp);

  // Build a tree = origin/main's tree with ONLY this file swapped, via a private index.
  const idx = path.join(os.tmpdir(), `pbm-idx-${process.pid}-${attempt}`);
  if (fs.existsSync(idx)) fs.unlinkSync(idx);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  git(["read-tree", base], { env });
  git(["update-index", "--cacheinfo", `100644,${blob},${FILE}`], { env });
  const tree = git(["write-tree"], { env }).trim();
  fs.unlinkSync(idx);

  // Assert the change is EXACTLY my one row and nothing else.
  const stat = git(["diff", "--numstat", base, tree, "--", FILE]).trim();
  const other = git(["diff", "--name-only", base, tree]).trim().split("\n").filter((f) => f && f !== FILE);
  if (other.length) throw new Error(`refusing: touches other files: ${other.join(", ")}`);
  const [add, del] = stat ? stat.split(/\s+/).map(Number) : [0, 0];
  const wantDel = mode === "insert" ? 0 : 1;
  if (add !== 1 || del !== wantDel) throw new Error(`refusing: diff is ${add}+/${del}- , expected 1+/${wantDel}-`);

  const commit = git(["commit-tree", tree, "-p", base, "-m", commitMsg]).trim();
  try {
    git(["push", "origin", `${commit}:refs/heads/main`, "--force-with-lease=refs/heads/main:" + base]);
    console.log(`PUSHED ${commit} (base ${base}, ${add}+/${del}-)`);
    process.exit(0);
  } catch (e) {
    console.log(`attempt ${attempt}: push rejected, re-basing on new origin/main`);
  }
}
throw new Error("exhausted retries");
