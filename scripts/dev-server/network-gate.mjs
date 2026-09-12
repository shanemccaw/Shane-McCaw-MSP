// scripts/dev-server/network-gate.mjs
//
// Git #3006 — extend the `.pnpmfile.cjs` metered-connection hard-block (Git #1986) to the
// other real large-download vectors #3001's audit found were only ADVISORY (BUILD_NETWORK
// injected into every launched build, but read by exactly one consumer — the pnpmfile).
//
// This is the same throw-and-report pattern `.pnpmfile.cjs` already proved, factored out
// so more than one call site can share it instead of each re-inventing the check:
//   - scripts/dev-server/repo-clone.mjs (a real `git clone` of a secondary repo)
//   - desktop/Directory.Build.props (a real `dotnet restore`/`build`/`publish` NuGet
//     restore run directly against a desktop .csproj, outside the already-gated
//     BuildConsole version-update deploy path — see MainWindow.VersionUpdate.cs, which
//     gates on BuildConsoleSettings.CurrentNetworkIsMetered() directly and never sets
//     BUILD_NETWORK on its own process, so that path is untouched by this gate)
//
// HONEST LIMITS (same as `.pnpmfile.cjs`'s own section): BUILD_NETWORK is a signal a build
// session's own shell can technically unset before invoking a command — no process-level
// check can stop a shell from editing its own environment. This stops the reflexive/
// compliant case (the documented trigger for #1986/#3006), not a deliberately-evading one.
// There is deliberately NO flag/file/settings value a build session can set to grant itself
// an exception; the only override is Shane's own Location toggle / one-shot override in
// BuildConsole, never reachable from inside a build session.
//
// A raw `curl`/`Invoke-WebRequest` of an arbitrary large asset, or a `dotnet`/`git` restore
// path that bypasses project-file evaluation entirely, is NOT hard-blockable at this layer
// for the same reason `.pnpmfile.cjs` can't stop `pnpm install --ignore-pnpmfile` — there is
// no shared hook every possible invocation is guaranteed to pass through. That residual gap
// is named, not silently pretended solved.

export function isMetered(env = process.env) {
  return (env.BUILD_NETWORK || "").trim().toLowerCase() === "metered";
}

/**
 * Throws with a `.pnpmfile.cjs`-style message if BUILD_NETWORK=metered. `operation` is a
 * short real description of what's about to run (e.g. "git clone of shanemccaw/other-repo"),
 * `detail` optional extra context (a real size estimate, the real command, etc).
 */
export function refuseIfMetered(operation, detail, env = process.env) {
  if (!isMetered(env)) return; // Home/unmetered, or signal absent -> allow, per Home-is-default.
  throw new Error(
    `BLOCKED: this is Shane's capped (metered) connection — BUILD_NETWORK=metered.\n` +
      `  Refusing: ${operation}.\n` +
      (detail ? `  ${detail}\n` : "") +
      "  STOP and report this to Shane rather than retrying, working around it, or looking for another\n" +
      "  command that downloads the same bytes. Only Shane clears the metered gate, via the Location\n" +
      "  toggle / one-shot override in BuildConsole — there is no flag or env var a build session can\n" +
      "  set to override it (Git #1986 / #3006)."
  );
}
