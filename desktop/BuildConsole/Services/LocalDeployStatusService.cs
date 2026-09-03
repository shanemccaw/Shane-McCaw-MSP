using System;
using System.IO;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1421 — replaces #805's HTTP <c>GET /api/internal/deploy-status</c> round-trip with a
    /// direct, real local read of the exact same information. Shane's real point: "it should not
    /// even be reading the API anymore... it can just read locally without having to route through
    /// the API. And I don't have to have it running all the time." The old endpoint required the
    /// local Dev api-server to be up just to answer "what commit is currently deployed" — a question
    /// BuildConsole can answer itself from the filesystem, since it already owns the coordination
    /// architecture (scripts/dev-server/, #92/#1371) that tracks exactly which checkout the local
    /// dev server runs from and when it was last restarted.
    ///
    /// version.ts's <c>computeVersionInfo()</c> computes <c>{ commitHash, timestamp }</c> as
    /// <c>git rev-parse --short HEAD</c> (run once, at server-process startup, against the server's
    /// own working directory) plus that startup instant. This class computes the exact same two
    /// values straight from disk, no HTTP, no running process required:
    ///   - <c>commitHash</c> — <c>git rev-parse --short HEAD</c> run directly against the SAME
    ///     checkout the real local dev server (and this BuildConsole.exe) actually runs from
    ///     (<see cref="VersionInfo.FindRepoRoot"/> — the MAIN checkout, per #1395; honors
    ///     <c>DEV_SERVER_WORKTREE</c> as an explicit override for anyone who genuinely wants
    ///     scripts/dev-server/config.mjs's separate <c>C:\dev-server</c> mirror instead — see the
    ///     "#1421 follow-up" note on <see cref="ResolveServerWorktree"/> for why that mirror is
    ///     NOT the right default here).
    ///   - <c>timestamp</c> — the coordinator's own <c>server.json</c> (<c>state-dir</c>'s
    ///     <c>serverMetaFile</c>) records the real process-start instant every time
    ///     scripts/dev-server actually launches the server, so reading it back reproduces
    ///     <c>versionInfo.startedAt</c> exactly. Falls back to the checkout's own HEAD commit
    ///     timestamp (still real, not a fixture) if server.json hasn't been written yet — e.g. the
    ///     server was started by hand, outside the coordinator.
    /// </summary>
    public static class LocalDeployStatusService
    {
        /// <summary>
        /// Git #1421 follow-up: this originally mirrored scripts/dev-server/config.mjs's
        /// <c>serverWorktree</c> default of <c>C:\dev-server</c> — but #1395 established that
        /// the local dev server BuildConsole actually watches (:8080 api-server, etc.) is
        /// launched by <c>DevServicesManager.StartServiceAsync</c> → <c>dev-all.mjs --start
        /// &lt;svc&gt;</c> with <c>WorkingDirectory = MAIN checkout</c> — NOT from
        /// <c>C:\dev-server</c>. The coordinator's own restart action
        /// (<c>refresh-main-server.mjs</c>) runs the real server from the MAIN checkout too;
        /// <c>C:\dev-server</c> is kept only as a secondary mirror whose merge is documented to
        /// fail/lag independently (#1395 Layer 1, <c>mergeNoEdit</c>'s dirty-pnpm-lock retries).
        /// Defaulting here to <c>C:\dev-server</c> would reintroduce the exact "reads the wrong
        /// checkout, reports a stale commit" bug class #1395 fixed for <c>/api/version</c> — so
        /// this now defaults to <see cref="VersionInfo.FindRepoRoot"/>, the SAME checkout the
        /// real server (and this very BuildConsole.exe) resolves. <c>DEV_SERVER_WORKTREE</c>
        /// still works as an explicit override for anyone who genuinely wants the
        /// <c>C:\dev-server</c> mirror's state instead.
        /// </summary>
        /// <summary>
        /// Git #1985 — was `?? @"C:\dev-server"`. This class's own doc comment above already
        /// explains why that fallback is dangerous, not just machine-specific: `C:\dev-server`
        /// is a real, existing secondary mirror on Shane's machine whose merge is documented to
        /// lag/fail independently of the main checkout. If the real repo root can't be resolved,
        /// silently falling back to it would read git state from that stale mirror and report it
        /// as the deployed commit — exactly the "reads the wrong checkout, reports a stale commit"
        /// bug class #1395 fixed for /api/version. Returns null instead so the caller reports
        /// honestly (this file's own contract: "never fabricate a placeholder value") rather than
        /// silently substituting a real-but-wrong checkout.
        /// </summary>
        public static string? ResolveServerWorktree()
        {
            var env = Environment.GetEnvironmentVariable("DEV_SERVER_WORKTREE");
            if (!string.IsNullOrWhiteSpace(env)) return env;
            return VersionInfo.FindRepoRoot();
        }

        /// <summary>Mirrors config.mjs's <c>stateDir</c>: <c>DEV_SERVER_STATE_DIR</c> env override,
        /// else <c>&lt;mainRepoRoot&gt;\.logs\dev-server</c>.</summary>
        private static string ResolveStateDir()
        {
            var env = Environment.GetEnvironmentVariable("DEV_SERVER_STATE_DIR");
            if (!string.IsNullOrWhiteSpace(env)) return env;
            // Git #1985 — genuinely tolerable: this only locates server.json for the process-start
            // TIMESTAMP. The caller (GetLocalDeployStatus) already wraps the read in try/catch and
            // falls through to `git log -1` on the checkout HEAD if server.json is missing/unreadable
            // — a wrong dir here just means that fallback fires a step earlier than usual; it never
            // fabricates a value, so a cwd-relative guess is an acceptable last resort here.
            var mainRepoRoot = VersionInfo.FindRepoRoot() ?? Directory.GetCurrentDirectory();
            return Path.Combine(mainRepoRoot, ".logs", "dev-server");
        }

        private static string? RunGit(string worktree, string arguments)
        {
            // Git #2539 — was an ad-hoc spawn that read stdout only, never checked the exit code,
            // and swallowed everything in a bare catch: a crashed/aborted git (empty stdout, an
            // NTSTATUS exit code) looked identical to "no output". Route through SubprocessRunner
            // so a crash is retried with backoff and a genuine failure returns null honestly (this
            // class's contract: never fabricate a value) instead of masquerading as absent data.
            var res = SubprocessRunner.Run("git", arguments, worktree, TimeSpan.FromSeconds(5), "deploy");
            if (!res.Ok) return null;
            var result = res.StdOut.Trim();
            return string.IsNullOrEmpty(result) ? null : result;
        }

        /// <summary>The direct local read replacing #805's HTTP call. Returns the same
        /// <c>{ commitHash, timestamp }</c> shape the old endpoint served — or null (never throws)
        /// if the server checkout doesn't exist on disk at all, so the caller can report that
        /// honestly rather than fabricating a placeholder value.</summary>
        public static DeployStatus? GetLocalDeployStatus()
        {
            var worktree = ResolveServerWorktree();
            if (string.IsNullOrWhiteSpace(worktree) || !Directory.Exists(worktree)) return null;

            var commitHash = RunGit(worktree, "rev-parse --short HEAD");
            if (string.IsNullOrEmpty(commitHash)) return null;

            string? timestamp = null;
            try
            {
                var serverMetaFile = Path.Combine(ResolveStateDir(), "server.json");
                if (File.Exists(serverMetaFile))
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(serverMetaFile));
                    if (doc.RootElement.TryGetProperty("startedAt", out var startedAtEl) &&
                        startedAtEl.TryGetInt64(out var startedAtMs))
                    {
                        timestamp = DateTimeOffset.FromUnixTimeMilliseconds(startedAtMs).ToString("o");
                    }
                }
            }
            catch
            {
                // fall through to the commit-timestamp fallback below
            }

            // server.json missing/unreadable (server started by hand, outside the coordinator) —
            // the checkout's own HEAD commit timestamp is still real, honest data, just a slightly
            // different real-world instant (commit time, not process-start time).
            timestamp ??= RunGit(worktree, "log -1 --format=%cI") ?? "";

            return new DeployStatus { CommitHash = commitHash, Timestamp = timestamp };
        }
    }
}
