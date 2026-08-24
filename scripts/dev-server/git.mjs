// scripts/dev-server/git.mjs
//
// Thin, synchronous git wrappers used by the coordinator. Every merge / ancestry
// check runs against a specific worktree via `git -C <cwd>`. Because all agent
// worktrees and the dev-server worktree share one object store (`.git`), merging
// another worktree's commit is a purely local ref operation -- no fetch needed.

import { execFileSync } from "node:child_process";

/**
 * Run git, returning { code, stdout, stderr }. Never throws for a non-zero exit
 * (callers decide what a non-zero code means -- e.g. `--is-ancestor` uses 1 as a
 * real answer, not an error).
 */
export function git(cwd, args, { input } = {}) {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, stdout: stdout ?? "", stderr: "" };
  } catch (err) {
    return {
      code: typeof err.status === "number" ? err.status : 1,
      stdout: err.stdout ? String(err.stdout) : "",
      stderr: err.stderr ? String(err.stderr) : String(err.message || err),
    };
  }
}

/** Assert-style git: throws with context on any non-zero exit. */
export function gitOrThrow(cwd, args, opts) {
  const r = git(cwd, args, opts);
  if (r.code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${r.code}) in ${cwd}\n${r.stderr || r.stdout}`
    );
  }
  return r.stdout.trim();
}

export function revParse(cwd, ref = "HEAD") {
  const r = git(cwd, ["rev-parse", ref]);
  return r.code === 0 ? r.stdout.trim() : null;
}

export function shortSha(sha) {
  return sha ? sha.slice(0, 8) : sha;
}

/** True iff `ancestor` is an ancestor of (or equal to) `descendant`. */
export function isAncestor(cwd, ancestor, descendant) {
  const r = git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]);
  // 0 => yes, 1 => no, other => error (treat as no, surface via caller if needed)
  return r.code === 0;
}

export function currentBranch(cwd) {
  const r = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : null;
}

export function isGitRepo(cwd) {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).code === 0;
}

/** Resolve a commit for a ref, or null if it doesn't resolve. */
export function resolveCommit(cwd, ref) {
  const r = git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * Merge `commit` into the branch currently checked out in `cwd`.
 * Returns { ok, ff, sha, stderr }. On conflict it ABORTS the merge so the
 * worktree is left clean, and returns ok:false with the conflict text.
 */
export function mergeNoEdit(cwd, commit, message) {
  const before = revParse(cwd, "HEAD");
  const args = ["merge", "--no-edit"];
  if (message) args.push("-m", message);
  args.push(commit);
  const r = git(cwd, args);
  if (r.code === 0) {
    const after = revParse(cwd, "HEAD");
    return { ok: true, ff: after === before ? false : true, sha: after, stderr: "" };
  }
  // Leave the server checkout in a clean state -- never half-merged.
  git(cwd, ["merge", "--abort"]);
  return {
    ok: false,
    sha: before,
    stderr: (r.stdout + "\n" + r.stderr).trim(),
  };
}

/** List existing worktree paths for this repo. */
export function worktreePaths(cwd) {
  const r = git(cwd, ["worktree", "list", "--porcelain"]);
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length).trim());
}
