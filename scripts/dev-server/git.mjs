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
 * Parse the tracked-file paths git names in a "would be overwritten by merge"
 * refusal. git prints, on stdout+stderr:
 *
 *   error: Your local changes to the following files would be overwritten by merge:
 *   \tpnpm-lock.yaml
 *   \tpackage.json
 *   Please commit your changes or stash them before you merge.
 *   Aborting
 *
 * Returns the (tab-indented) path lines between that header and the trailer.
 */
export function parseMergeBlockedFiles(text) {
  const files = [];
  let capture = false;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    if (/would be overwritten by merge/i.test(rawLine)) {
      capture = true;
      continue;
    }
    if (!capture) continue;
    if (/^\s*(Please commit|Aborting|Updating|Merge|error:)/i.test(rawLine) || rawLine.trim() === "") {
      break;
    }
    const f = rawLine.trim();
    if (f) files.push(f);
  }
  return files;
}

/**
 * Paths whose merge conflicts the coordinator is allowed to auto-resolve.
 *
 * build-journal/<id>.md are per-issue, one-writer-per-file, append-only session
 * bookends (see build-journal/README.md). Independent agent sessions each ADD
 * their own file, and the coordinator merges those agent-branch commits into the
 * shared dev-server checkout one at a time. Two branches carrying divergent
 * histories for the SAME build-journal path collide as `CONFLICT (add/add)` --
 * the recurring #2830 / #3055 failure. The content of a build-journal file inside
 * the dev-server checkout is throwaway documentation (the authoritative bookend
 * history lives on origin/main), so a conflict confined ENTIRELY to these paths
 * is always safe to resolve automatically. `.gitattributes` already declares
 * `build-journal/*.md merge=union`, which resolves this at the git level in any
 * checkout that carries the attribute; this predicate is the code-level backstop
 * for a checkout that has not yet picked it up (e.g. the pre-existing divergence
 * already sitting in C:\dev-server before this fix reaches its dev-server branch).
 */
function isAutoResolvableConflictPath(p) {
  return /^build-journal\/[^/]+\.md$/.test(String(p || "").replace(/\\/g, "/"));
}

/** Unmerged (conflicted) paths after a failed merge, repo-relative, forward slashes. */
function unmergedPaths(cwd) {
  const r = git(cwd, ["diff", "--name-only", "--diff-filter=U"]);
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

/**
 * If a merge failed with conflicts confined ENTIRELY to auto-resolvable
 * build-journal paths, resolve each such path in favour of the incoming commit
 * (--theirs: the change being landed; the dev-server copy is non-authoritative)
 * and COMMIT the merge, leaving HEAD advanced and the tree clean. Returns the new
 * HEAD sha on success, or null if the conflict set is empty or includes any path
 * that is NOT auto-resolvable (in which case the caller aborts and reports
 * honestly -- a real code conflict must never be silently swallowed).
 */
function tryAutoResolveMerge(cwd, message) {
  const conflicts = unmergedPaths(cwd);
  if (conflicts.length === 0) return null;
  if (!conflicts.every(isAutoResolvableConflictPath)) return null; // mixed/real conflict -> caller aborts
  for (const p of conflicts) {
    // add/add has no base stage; --theirs takes the incoming (stage 3) version.
    if (git(cwd, ["checkout", "--theirs", "--", p]).code !== 0) return null;
    if (git(cwd, ["add", "--", p]).code !== 0) return null;
  }
  const commitArgs = ["commit", "--no-verify"];
  if (message) commitArgs.push("-m", message);
  else commitArgs.push("--no-edit");
  if (git(cwd, commitArgs).code !== 0) return null;
  return revParse(cwd, "HEAD");
}

/**
 * Merge `commit` into the branch currently checked out in `cwd`.
 * Returns { ok, ff, sha, stderr, autoRestored?, autoResolved? }. On conflict it
 * ABORTS the merge so the worktree is left clean, and returns ok:false with the
 * conflict text -- EXCEPT when every conflicted path is an auto-resolvable
 * build-journal bookend (#2830/#3055), which is resolved and committed instead.
 *
 * SELF-HEAL (Git #1395): the dedicated dev-server checkout legitimately carries
 * regeneratable local edits to dependency manifests (package.json / pnpm-lock.yaml
 * -- e.g. Windows-native binaries added so the local stack runs). A plain
 * `git merge` REFUSES to touch a locally-modified tracked file and aborts the
 * ENTIRE merge-back ("Your local changes to the following files would be
 * overwritten by merge"), silently freezing the server checkout at stale code
 * while builds appear to do nothing. When that (and only that) is why a merge
 * failed, discard exactly the tracked files git named -- which the incoming
 * merge was about to overwrite anyway -- and retry. node_modules is untracked
 * (a real dir / junction), so `git checkout --` never touches it or the
 * installed binaries. Bounded retries in case git names files in stages.
 */
export function mergeNoEdit(cwd, commit, message) {
  const before = revParse(cwd, "HEAD");
  const doMerge = () => {
    const args = ["merge", "--no-edit"];
    if (message) args.push("-m", message);
    args.push(commit);
    return git(cwd, args);
  };

  let r = doMerge();
  const autoRestored = [];
  let attempts = 0;
  while (
    r.code !== 0 &&
    attempts < 3 &&
    /would be overwritten by merge/i.test(r.stdout + r.stderr) &&
    !/untracked working tree files/i.test(r.stdout + r.stderr)
  ) {
    const blocked = parseMergeBlockedFiles(r.stdout + r.stderr).filter(
      (f) => !autoRestored.includes(f)
    );
    if (blocked.length === 0) break; // nothing new to restore -> give up, report honestly
    // Restore only the named tracked files to HEAD (discard local dep-manifest churn).
    const restore = git(cwd, ["checkout", "HEAD", "--", ...blocked]);
    if (restore.code !== 0) break; // couldn't clean them -> fall through to abort+report
    autoRestored.push(...blocked);
    attempts++;
    r = doMerge();
  }

  if (r.code === 0) {
    const after = revParse(cwd, "HEAD");
    return {
      ok: true,
      ff: after === before ? false : true,
      sha: after,
      stderr: "",
      autoRestored: autoRestored.length ? autoRestored : undefined,
    };
  }

  // The merge failed. If every conflicted path is an auto-resolvable build-journal
  // bookend (#2830/#3055), resolve them and complete the merge rather than aborting.
  // A conflict touching anything else falls through to the honest abort+report below.
  const resolvedSha = tryAutoResolveMerge(cwd, message);
  if (resolvedSha) {
    return {
      ok: true,
      ff: true,
      sha: resolvedSha,
      stderr: "",
      autoRestored: autoRestored.length ? autoRestored : undefined,
      autoResolved: true,
    };
  }

  // Leave the server checkout in a clean state -- never half-merged.
  git(cwd, ["merge", "--abort"]);
  return {
    ok: false,
    sha: before,
    stderr: (r.stdout + "\n" + r.stderr).trim(),
    autoRestored: autoRestored.length ? autoRestored : undefined,
  };
}

/**
 * List the files that differ between two commits, one repo-relative path per
 * entry. `threeDot` uses `base...head` (head's changes since it forked from base)
 * -- the precise footprint of a member commit even if the base ref advanced for
 * unrelated reasons in between. Two-dot (`base..head`) is the plain range diff.
 * Never throws; returns [] on any git error or unresolvable ref.
 */
export function diffNameOnly(cwd, base, head, { threeDot = false } = {}) {
  if (!base || !head) return [];
  const range = `${base}${threeDot ? "..." : ".."}${head}`;
  const r = git(cwd, ["diff", "--name-only", range]);
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
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

/** List existing worktrees for this repo with full parsed metadata. */
export function listWorktrees(cwd) {
  const r = git(cwd, ["worktree", "list", "--porcelain"]);
  if (r.code !== 0) return [];
  const lines = r.stdout.split(/\r?\n/);
  const worktrees = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      if (current) worktrees.push(current);
      current = {
        path: line.slice("worktree ".length).trim(),
        branch: null,
        detached: false,
        head: null,
      };
    } else if (line.startsWith("branch ") && current) {
      const ref = line.slice("branch ".length).trim();
      current.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
    } else if (line.startsWith("detached") && current) {
      current.detached = true;
    } else if (line.startsWith("HEAD ") && current) {
      current.head = line.slice("HEAD ".length).trim();
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

/** Remove a git worktree. */
export function removeWorktree(cwd, path, { force = false } = {}) {
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(path);
  return git(cwd, args);
}

/** Prune stale git worktree administrative files. */
export function pruneWorktrees(cwd) {
  return git(cwd, ["worktree", "prune"]);
}

/** Delete a git branch. */
export function deleteBranch(cwd, branchName, { force = false } = {}) {
  const args = ["branch", force ? "-D" : "-d", branchName];
  return git(cwd, args);
}
