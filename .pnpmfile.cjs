// Git #1986 — metered-connection install gate (BuildConsole Home/Rental switch).
// Git #1988 — worktree shared-store install gate (fail closed, see refuseIfSharedStoreReachable).
//
// WHY THIS FILE AND NOT THE package.json `preinstall` HOOK:
// The issue proposed extending the root `preinstall` script to refuse installs on a
// metered connection. That was verified empirically and does NOT work: pnpm 11.13.0
// does not run the root project's `preinstall`/`postinstall` lifecycle scripts during
// `pnpm install` at all — not fresh, not with `--force`, not with
// `--enable-pre-post-scripts` (proven by writing a marker file from `preinstall` and
// observing it never appears, while `pnpm run preinstall` invoked directly does write
// it). A metered check placed there would silently never fire — exactly the failure the
// issue told us to avoid. The `.pnpmfile.cjs` `readPackage` hook, by contrast, IS run by
// pnpm during every install/resolution (including `--force`), can read `process.env`,
// and throwing from it hard-aborts the install (exit 1, node_modules not created) —
// verified the same way.
//
// Git #1988 re-verified hook coverage empirically on pnpm 11.13.0 (scratch workspace,
// offline): `preResolution` and `readPackage` both fire on EVERY install variant —
// fresh install, repeat "already up to date" install, headless install from an intact
// lockfile after node_modules was deleted, and the ".modules.yaml settings mismatch →
// recreate node_modules" path (which is exactly what a worktree install triggers
// through the shared junction). A throw from either hook aborts before anything is
// written (node_modules not created). Both hooks below carry both gates.
//
// WHAT THE METERED GATE DOES (#1986):
// When BUILD_NETWORK=metered is present in the environment, refuse the install. BuildConsole
// injects BUILD_NETWORK into every launched build (QueueWatcherService.LaunchItem): "metered"
// when the title-bar Location toggle is Rental (Shane's capped Verizon line), "unmetered" when
// Home (fibre). This catches a `pnpm install` an agent shell runs that the BuildConsole UI gate
// cannot see — the concrete trigger being agents reflexively prescribing/running `pnpm install`
// (and `--force`, which refetches ~1,120 packages) as a supposed remedy for broken module
// resolution. It is not a remedy and it is a real metered cost.
//
// WHAT THE WORKTREE GATE DOES (#1988):
// An agent worktree gets its dependencies as directory junctions into the shared main
// checkout's node_modules (scripts/dev-server/link-deps.mjs). Any pnpm install run inside
// such a worktree physically writes THROUGH those junctions into the store every other
// session shares, and pnpm anchors the new links/cmd-shims to the installing worktree's
// own path — so when that worktree is later cleaned up, every other concurrent session's
// toolchain breaks (six live incidents: #1951 #1955 #1959 #1964 #1967 #1974). This gate
// makes that install fail closed instead:
//   1. If any workspace package's node_modules is a junction/symlink resolving OUTSIDE
//      this workspace root, the install is refused unconditionally — there is no
//      environment override, because writing through the junction is never correct.
//   2. Otherwise, if this checkout is a linked git worktree (`.git` is a file, not a
//      directory), the install is refused unless WORKTREE_ISOLATED_INSTALL=1 is set —
//      the deliberate escape hatch for a fully local, junction-free install inside a
//      worktree, which touches nothing shared (the metered gate above still applies).
// The main checkout (`.git` is a directory, node_modules is real) is never blocked.
//
// HONEST LIMITS (stated plainly):
//   • pnpm exposes no `npm_config_*` to this hook, so it CANNOT distinguish `--force` from a
//     plain install. It therefore refuses ALL installs when metered. That is acceptable and
//     intended: inside a launched build, dependencies are junctioned by
//     scripts/dev-server/link-deps.mjs and a real `pnpm install` should not be run at all.
//   • BUILD_NETWORK is a signal an agent's own shell can technically override (e.g.
//     `BUILD_NETWORK= pnpm install`). No package-manager-layer check can stop a shell from
//     editing its own environment. This gate stops the COMPLIANT/reflexive-habit case (the
//     documented trigger), not a deliberately-evading one. It is deliberately NOT keyed to any
//     flag/file/settings value an agent could set to grant itself an exception — the override is
//     a Shane-only UI action in BuildConsole, never reachable from inside a build session.
//   • Shane's own terminal and CI have no BUILD_NETWORK set, so they are never blocked here — the
//     gate applies only inside launched build sessions on the metered connection.
//   • `pnpm install --ignore-pnpmfile` (or `--ignore-workspace` from a package dir) bypasses
//     this file entirely, and npm/yarn never read it (they are refused by the root
//     package.json `preinstall`, which npm does run). Like BUILD_NETWORK above, that is the
//     deliberate-evasion class no package-manager-layer check can close; the enforced layer
//     stops the reflexive/compliant case, and scripts/dev-server/store-doctor.mjs makes any
//     poisoning that does land visible in seconds.
//
// The messages never prescribe `pnpm install` as a fix (that instruction has been run hundreds
// of times and never fixes broken resolution — Git #1987); they tell the session to stop and
// report so Shane decides.

const fs = require("fs");
const path = require("path");

function isReparsePoint(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink(); // junctions AND symlinks both report true
  } catch {
    return false;
  }
}

function resolveLinkTarget(p) {
  try {
    const raw = fs.readlinkSync(p).replace(/^\\\\\?\\/, ""); // strip \\?\ long-path prefix
    return path.resolve(path.dirname(p), raw);
  } catch {
    return null;
  }
}

/**
 * Same host set scripts/dev-server/link-deps.mjs junctions: the workspace root itself,
 * every artifacts/* and lib/* / lib/integrations/* package dir, and scripts/.
 */
function junctionedNodeModulesOutsideRoot(root) {
  const hosts = [root];
  for (const group of ["artifacts", "lib", "lib/integrations", "scripts"]) {
    const dir = path.join(root, group);
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    if (group === "scripts") {
      hosts.push(dir);
      continue;
    }
    for (const name of entries) hosts.push(path.join(dir, name));
  }
  const rootPrefix = (root + path.sep).toLowerCase();
  const foreign = [];
  for (const h of hosts) {
    const nm = path.join(h, "node_modules");
    if (!isReparsePoint(nm)) continue;
    const target = resolveLinkTarget(nm);
    // A junction whose target can't be read still counts: installing through an
    // unreadable/dangling reparse point is never safe.
    if (!target || !(target + path.sep).toLowerCase().startsWith(rootPrefix)) {
      foreign.push({ link: nm, target: target || "(unreadable)" });
    }
  }
  return foreign;
}

// Cache the (filesystem-derived) verdict once per pnpm process; hooks are called per
// package and the layout cannot change mid-install. A blocking verdict is re-thrown on
// every call — if pnpm ever caught the first throw, the install must still not proceed.
let worktreeVerdict; // undefined = not yet computed; null = allowed; Error = blocked

function refuseIfSharedStoreReachable() {
  if (worktreeVerdict === undefined) {
    worktreeVerdict = null;
    const root = __dirname;
    const foreign = junctionedNodeModulesOutsideRoot(root);
    if (foreign.length > 0) {
      const list = foreign
        .slice(0, 5)
        .map((f) => `    ${f.link} -> ${f.target}`)
        .join("\n");
      worktreeVerdict = new Error(
        "BLOCKED: this checkout's dependencies are junctions into the SHARED main-checkout node_modules:\n" +
          list +
          (foreign.length > 5 ? `\n    ...and ${foreign.length - 5} more\n` : "\n") +
          "  Running any pnpm install here would write through those junctions into the store every other\n" +
          "  session shares, with link paths anchored to THIS worktree — when this worktree is cleaned up,\n" +
          "  every other concurrent session's toolchain breaks (Git #1988; incidents #1951 #1955 #1959\n" +
          "  #1964 #1967 #1974). There is NO override for this case; installing through a junction is\n" +
          "  never correct.\n" +
          "  The junctioned dependencies are already complete. If module resolution is broken, that is a\n" +
          "  dangling-link/shared-store problem, not a missing-dependency problem — diagnose it with:\n" +
          "      node scripts/dev-server/store-doctor.mjs\n" +
          "  and report what it finds. If you genuinely need a NEW dependency, add it to the package.json\n" +
          "  and commit; a real install runs only from the main checkout, and on the metered connection\n" +
          "  that is Shane's call (the #1986 gate enforces it)."
      );
    } else {
      let gitIsFile = false;
      try {
        gitIsFile = fs.lstatSync(path.join(root, ".git")).isFile();
      } catch {}
      if (gitIsFile && process.env.WORKTREE_ISOLATED_INSTALL !== "1") {
        worktreeVerdict = new Error(
          "BLOCKED: this is a linked git worktree (`.git` is a file), and worktree sessions do not run\n" +
            "  installs — dependencies arrive as junctions from the main checkout via\n" +
            "  scripts/dev-server/link-deps.mjs (Git #1988). No dependency junctions were detected here, so\n" +
            "  a fully LOCAL install would touch nothing shared; if that is genuinely what you intend\n" +
            "  (it downloads real bytes, and the metered gate still applies), set\n" +
            "  WORKTREE_ISOLATED_INSTALL=1 and re-run. Otherwise, if module resolution is broken, diagnose\n" +
            "  with: node scripts/dev-server/store-doctor.mjs — and report, rather than installing."
        );
      }
    }
  }
  if (worktreeVerdict) throw worktreeVerdict;
}

let refused = false;

function refuseIfMetered() {
  const net = (process.env.BUILD_NETWORK || "").trim().toLowerCase();
  if (net !== "metered") return; // Home/unmetered, or signal absent → allow, per Home-is-default.
  if (refused) return;
  refused = true;
  throw new Error(
    "BLOCKED: this is Shane's capped (metered) connection — BUILD_NETWORK=metered.\n" +
    "  A `pnpm install` here downloads against a lockfile of ~1,120 packages and is a real, metered cost.\n" +
    "  Inside a launched build, dependencies are already junctioned by scripts/dev-server/link-deps.mjs;\n" +
    "  a broken module resolution is a dangling-junction/worktree-isolation problem, NOT a dependency\n" +
    "  problem, and re-installing does not fix it. STOP and report this to Shane rather than retrying or\n" +
    "  looking for another command that downloads the same bytes. Only Shane clears the metered gate, via\n" +
    "  the Location toggle / one-shot override in BuildConsole — there is no flag or env var a build session\n" +
    "  can set to override it."
  );
}

function runGates() {
  refuseIfSharedStoreReachable(); // #1988 first: shared-store corruption outranks bandwidth
  refuseIfMetered(); // #1986
}

module.exports = {
  hooks: {
    // Both hooks proven (pnpm 11.13.0) to fire on every install variant, incl. headless
    // and the modules-dir-recreate path; either one throwing aborts before any write.
    preResolution() {
      runGates();
    },
    readPackage(pkg) {
      runGates();
      return pkg;
    },
  },
};
