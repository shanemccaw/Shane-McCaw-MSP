using System;
using System.Diagnostics;
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
    ///   - <c>commitHash</c> — <c>git rev-parse --short HEAD</c> run directly against the dev-server
    ///     coordinator's own dedicated checkout (scripts/dev-server/config.mjs's
    ///     <c>serverWorktree</c>, default <c>C:\dev-server</c>, honoring the same
    ///     <c>DEV_SERVER_WORKTREE</c> env override config.mjs itself honors).
    ///   - <c>timestamp</c> — the coordinator's own <c>server.json</c> (<c>state-dir</c>'s
    ///     <c>serverMetaFile</c>) records the real process-start instant every time
    ///     scripts/dev-server actually launches the server, so reading it back reproduces
    ///     <c>versionInfo.startedAt</c> exactly. Falls back to the checkout's own HEAD commit
    ///     timestamp (still real, not a fixture) if server.json hasn't been written yet — e.g. the
    ///     server was started by hand, outside the coordinator.
    /// </summary>
    public static class LocalDeployStatusService
    {
        /// <summary>Mirrors scripts/dev-server/config.mjs's <c>serverWorktree</c> default exactly:
        /// <c>DEV_SERVER_WORKTREE</c> env override, else the fixed short path used on this
        /// machine (a deep path blows past Windows MAX_PATH — see config.mjs's own comment).</summary>
        public static string ResolveServerWorktree()
        {
            var env = Environment.GetEnvironmentVariable("DEV_SERVER_WORKTREE");
            return string.IsNullOrWhiteSpace(env) ? @"C:\dev-server" : env;
        }

        /// <summary>Mirrors config.mjs's <c>stateDir</c>: <c>DEV_SERVER_STATE_DIR</c> env override,
        /// else <c>&lt;mainRepoRoot&gt;\.logs\dev-server</c>.</summary>
        private static string ResolveStateDir()
        {
            var env = Environment.GetEnvironmentVariable("DEV_SERVER_STATE_DIR");
            if (!string.IsNullOrWhiteSpace(env)) return env;
            var mainRepoRoot = VersionInfo.FindRepoRoot() ?? Directory.GetCurrentDirectory();
            return Path.Combine(mainRepoRoot, ".logs", "dev-server");
        }

        private static string? RunGit(string worktree, string arguments)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "git",
                    Arguments = arguments,
                    WorkingDirectory = worktree,
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using var proc = Process.Start(psi);
                if (proc == null) return null;
                string stdout = proc.StandardOutput.ReadToEnd();
                proc.WaitForExit(5000);
                var result = stdout.Trim();
                return string.IsNullOrEmpty(result) ? null : result;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>The direct local read replacing #805's HTTP call. Returns the same
        /// <c>{ commitHash, timestamp }</c> shape the old endpoint served — or null (never throws)
        /// if the server checkout doesn't exist on disk at all, so the caller can report that
        /// honestly rather than fabricating a placeholder value.</summary>
        public static DeployStatus? GetLocalDeployStatus()
        {
            var worktree = ResolveServerWorktree();
            if (!Directory.Exists(worktree)) return null;

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
