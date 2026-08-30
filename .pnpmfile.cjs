// Git #1986 — metered-connection install gate (BuildConsole Home/Rental switch).
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
// WHAT IT DOES:
// When BUILD_NETWORK=metered is present in the environment, refuse the install. BuildConsole
// injects BUILD_NETWORK into every launched build (QueueWatcherService.LaunchItem): "metered"
// when the title-bar Location toggle is Rental (Shane's capped Verizon line), "unmetered" when
// Home (fibre). This catches a `pnpm install` an agent shell runs that the BuildConsole UI gate
// cannot see — the concrete trigger being agents reflexively prescribing/running `pnpm install`
// (and `--force`, which refetches ~1,120 packages) as a supposed remedy for broken module
// resolution. It is not a remedy and it is a real metered cost.
//
// HONEST LIMITS (stated plainly, per the issue's "say so plainly" instruction):
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
//
// The message never prescribes `pnpm install` as a fix (that instruction has been run hundreds
// of times and never fixes broken resolution — Git #1987); it tells the session to stop and
// report so Shane decides.

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

module.exports = {
  hooks: {
    readPackage(pkg) {
      refuseIfMetered();
      return pkg;
    },
  },
};
