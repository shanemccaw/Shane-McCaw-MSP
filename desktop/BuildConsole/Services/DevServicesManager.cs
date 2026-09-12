using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    public class DevServiceStatusInfo
    {
        public string Name { get; set; } = string.Empty;
        public string Title { get; set; } = string.Empty;
        public int Port { get; set; }
        public bool IsRunning { get; set; }
        public int? Pid { get; set; }
        public string LogPath { get; set; } = string.Empty;
        public string DirectoryPath { get; set; } = string.Empty;
        public string Url => $"http://localhost:{Port}";
    }

    /// <summary>
    /// Coordinates individual and multi-service development processes (Marketing, Portal, Admin, API Server)
    /// integrating with scripts/dev-all.mjs and file-based logging.
    /// </summary>
    public static class DevServicesManager
    {
        private const string LogChannel = "devserver.services";

        /// <summary>
        /// Icon glyphs are cosmetic and BuildConsole-specific, so they stay in a small
        /// C#-side lookup rather than in the shared JSON config that scripts/dev-all.mjs
        /// also reads (Git #1782). Anything not listed here falls back to <see cref="DefaultIconGlyph"/>.
        /// </summary>
        private static readonly Dictionary<string, string> IconGlyphs = new()
        {
            ["shane-mccaw-consulting"] = "🌐",
            ["portal"] = "💼",
            ["admin-panel"] = "⚙️",
            ["api-server"] = "🖥️",
            ["msp-website"] = "📄",
        };

        private const string DefaultIconGlyph = "🧩";

        /// <summary>
        /// The one real source of truth for the port-based dev service list is
        /// scripts/dev-server/services.json — the same file scripts/dev-all.mjs reads
        /// (Git #1782). Loaded once at startup; a new artifact needs only a line added
        /// to that JSON file, not a code change here.
        /// </summary>
        public static readonly Dictionary<string, (string Title, int Port, string RelPath, string Icon)> KnownServices = LoadKnownServices();

        private static Dictionary<string, (string Title, int Port, string RelPath, string Icon)> LoadKnownServices()
        {
            var result = new Dictionary<string, (string Title, int Port, string RelPath, string Icon)>();
            try
            {
                // Git #1985 — audited, genuinely tolerable: `?? "."` falls back to the process
                // cwd, but the very next line's File.Exists check already catches a wrong/missing
                // path and logs it honestly (never fabricates a service list from a guess) —
                // KnownServices just stays empty, same as any other "config not found" case.
                string? repoRoot = BuildTrackerConfig.FindRepoRoot();
                string configPath = Path.Combine(repoRoot ?? ".", "scripts", "dev-server", "services.json");
                if (!File.Exists(configPath))
                {
                    ActivityLog.Log(LogChannel, $"[dev-all] Shared services config not found at {configPath}.");
                    return result;
                }

                string json = File.ReadAllText(configPath);
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("services", out var servicesEl) && servicesEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var svcEl in servicesEl.EnumerateArray())
                    {
                        if (!svcEl.TryGetProperty("name", out var nameEl)) continue;
                        string name = nameEl.GetString() ?? string.Empty;
                        if (string.IsNullOrWhiteSpace(name)) continue;

                        string title = svcEl.TryGetProperty("title", out var titleEl) ? (titleEl.GetString() ?? name) : name;
                        int port = svcEl.TryGetProperty("port", out var portEl) ? portEl.GetInt32() : 0;
                        string relPath = $"artifacts/{name}";
                        string icon = IconGlyphs.TryGetValue(name, out var glyph) ? glyph : DefaultIconGlyph;

                        result[name] = (title, port, relPath, icon);
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"[dev-all] Failed to load shared services config: {ex.Message}");
            }

            return result;
        }

        // Git #1985 — audited, genuinely tolerable: `?? "."` here only relocates where THIS
        // process reads/writes its own dev-service log files. GetServiceLogPath (below) is the
        // only consumer, so writer and reader always agree on the same (possibly cwd-relative)
        // location — self-consistent, no risk of reading/writing against different directories.
        public static string GetLogDir()
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            string envDir = Environment.GetEnvironmentVariable("DEV_ALL_LOG_DIR") ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(envDir)) return envDir;
            return Path.Combine(repoRoot ?? ".", ".logs", "dev-all");
        }

        public static string GetServiceLogPath(string serviceName)
        {
            return Path.Combine(GetLogDir(), $"{serviceName}.log");
        }

        /// <summary>
        /// Checks if a service is currently listening on its port.
        /// Uses Socket with CancellationTokenSource so cancellation cleanly aborts the connect
        /// and guarantees no unobserved Task exceptions are leaked when the port is closed or timed out.
        /// </summary>
        public static async Task<bool> IsPortOpenAsync(int port, int timeoutMs = 400)
        {
            try
            {
                using var cts = new CancellationTokenSource(timeoutMs);
                using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
                await socket.ConnectAsync(IPAddress.Loopback, port, cts.Token);
                return socket.Connected;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Gets live status info for a specific service.
        /// </summary>
        public static async Task<DevServiceStatusInfo> GetServiceStatusAsync(string serviceName)
        {
            var info = new DevServiceStatusInfo
            {
                Name = serviceName,
                LogPath = GetServiceLogPath(serviceName)
            };

            if (KnownServices.TryGetValue(serviceName, out var def))
            {
                info.Title = def.Title;
                info.Port = def.Port;
                info.DirectoryPath = def.RelPath;
            }

            // Check meta file
            string metaFile = Path.Combine(GetLogDir(), $"{serviceName}.meta.json");
            if (File.Exists(metaFile))
            {
                try
                {
                    string json = await File.ReadAllTextAsync(metaFile);
                    using var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement;
                    if (root.TryGetProperty("pid", out var p) && p.ValueKind == JsonValueKind.Number)
                    {
                        info.Pid = p.GetInt32();
                    }
                }
                catch { }
            }

            // Verify live listening port
            info.IsRunning = await IsPortOpenAsync(info.Port);
            return info;
        }

        /// <summary>
        /// Starts a specific service independently.
        /// </summary>
        public static async Task<bool> StartServiceAsync(string serviceName)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                ActivityLog.Log(LogChannel, $"Cannot start {serviceName}: repo root not found.");
                return false;
            }

            int port = KnownServices.TryGetValue(serviceName, out var def) ? def.Port : 0;
            ActivityLog.Log(LogChannel, $"[dev-all] Starting service '{serviceName}' on port {port}…");

            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-all.mjs");
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = $"\"{scriptPath}\" --start {serviceName}",
                    WorkingDirectory = repoRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var proc = Process.Start(psi);
                if (proc != null)
                {
                    await Task.Delay(1500); // give process time to bind port
                    bool isUp = await IsPortOpenAsync(port);
                    ActivityLog.Log(LogChannel, $"[dev-all] Service '{serviceName}' start dispatched (PID {proc.Id}, listening: {isUp}).");
                    return true;
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"[dev-all] Failed to start '{serviceName}': {ex.Message}");
            }

            return false;
        }

        /// <summary>
        /// Stops a specific service independently.
        /// </summary>
        public static async Task<bool> StopServiceAsync(string serviceName)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null) return false;

            int port = KnownServices.TryGetValue(serviceName, out var def) ? def.Port : 0;
            ActivityLog.Log(LogChannel, $"[dev-all] Stopping service '{serviceName}' (port {port})…");

            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-all.mjs");
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = $"\"{scriptPath}\" --stop {serviceName}",
                    WorkingDirectory = repoRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var proc = Process.Start(psi);
                if (proc != null)
                {
                    await proc.WaitForExitAsync();
                }

                // Secondary port cleanup guarantee if still bound
                if (port > 0)
                {
                    string killPortScript = Path.Combine(repoRoot, "scripts", "kill-port.mjs");
                    if (File.Exists(killPortScript))
                    {
                        var killPsi = new ProcessStartInfo
                        {
                            FileName = "node",
                            Arguments = $"\"{killPortScript}\" {port}",
                            WorkingDirectory = repoRoot,
                            UseShellExecute = false,
                            CreateNoWindow = true
                        };
                        using var killProc = Process.Start(killPsi);
                        if (killProc != null) await killProc.WaitForExitAsync();
                    }
                }

                ActivityLog.Log(LogChannel, $"[dev-all] Service '{serviceName}' stopped successfully.");
                return true;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"[dev-all] Error stopping '{serviceName}': {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Git #3091 — the result of <see cref="EnsureFrontEndReadyAsync"/>: whether the service is
        /// actually reachable on its port by the time this returns, plus which real condition (if
        /// any) it had to correct so the caller can log/report a clear, specific reason on failure
        /// rather than a generic "not ready".
        /// </summary>
        public readonly record struct FrontEndReadiness(bool Ready, bool WasDown, bool WasStale, string Message);

        /// <summary>
        /// Git #3091 — closes the real gap: <c>shaneapp://runTest</c> resolved every <c>uiStep</c>
        /// <c>goto</c> to a local front-end origin via <see cref="DevServiceRouting"/> without ever
        /// confirming that SPECIFIC port was up, or serving current code — only the API server on
        /// :8080 got probed (MainWindow.EnsureServerReadyWithProbeAsync). Call this for every distinct
        /// front-end a manifest's uiSteps actually navigate to, before the first goto:
        ///
        ///  1. Not listening on its port at all → <see cref="StartServiceAsync"/> it.
        ///  2. Listening, but its process has been running since BEFORE the latest real commit under
        ///     its own <c>artifacts/&lt;serviceName&gt;</c> — genuinely stale, per the issue's own
        ///     account of why this happens (the dev-server restart coordinator only restarts a
        ///     service whose OWN changed-file footprint touched it, so a long-lived front-end process
        ///     can keep serving env/config baked in at its last startup through many merge cycles that
        ///     never touch its directory) → stop + restart it so uiSteps see current code.
        ///  3. Either way, poll the port for up to <paramref name="maxWaitSeconds"/> before giving up.
        ///
        /// Returns Ready=false (never throws) when the service never came up in time, so the caller
        /// can fail the uiSteps portion of the run clearly instead of silently navigating to a dead or
        /// stale port.
        /// </summary>
        public static async Task<FrontEndReadiness> EnsureFrontEndReadyAsync(string serviceName, string channel, int maxWaitSeconds = 60)
        {
            if (!KnownServices.TryGetValue(serviceName, out var def))
                return new FrontEndReadiness(false, false, false, $"Unknown dev service '{serviceName}' — not in scripts/dev-server/services.json.");

            string label = $"{def.Title} ({serviceName}, :{def.Port})";
            bool isUp = await IsPortOpenAsync(def.Port);
            bool wasDown = !isUp;
            bool wasStale = false;

            if (wasDown)
            {
                ActivityLog.Log(channel, $"[Front-End Readiness] {label} is not running — starting it before navigating a uiStep goto to it…");
                await StartServiceAsync(serviceName);
            }
            else
            {
                var startedAt = await GetServiceStartedAtUtcAsync(serviceName);
                var latestCommit = await GetLatestArtifactCommitUtcAsync(serviceName);
                if (startedAt.HasValue && latestCommit.HasValue && latestCommit.Value > startedAt.Value)
                {
                    wasStale = true;
                    ActivityLog.Log(channel,
                        $"[Front-End Readiness] {label} has been running since {startedAt:u} but artifacts/{serviceName} has a commit at {latestCommit:u} — restarting so this run's uiSteps see current code, not a stale long-lived process…");
                    await StopServiceAsync(serviceName);
                    await StartServiceAsync(serviceName);
                }
            }

            if (!wasDown && !wasStale)
                return new FrontEndReadiness(true, false, false, $"{label} already running current code.");

            var deadline = DateTime.UtcNow.AddSeconds(maxWaitSeconds);
            int attempt = 0;
            while (DateTime.UtcNow < deadline)
            {
                attempt++;
                if (await IsPortOpenAsync(def.Port))
                {
                    ActivityLog.Log(channel, $"[Front-End Readiness] {label} ready on attempt #{attempt}{(wasStale ? " (after stale restart)" : "")}.");
                    return new FrontEndReadiness(true, wasDown, wasStale, $"{label} ready.");
                }
                await Task.Delay(1500);
            }

            string reason = wasStale
                ? $"{label} was restarted for stale code but never came back up within {maxWaitSeconds}s."
                : $"{label} was down and did not start within {maxWaitSeconds}s.";
            ActivityLog.Log(channel, $"[Front-End Readiness] {reason}");
            return new FrontEndReadiness(false, wasDown, wasStale, reason);
        }

        /// <summary>Git #3091 — when the service's process last (re)started, read from the same
        /// meta.json <see cref="GetServiceStatusAsync"/> already reads for its pid (recordServiceMeta's
        /// <c>updatedAt</c>, written once at spawn time and again only on exit — so while a process is
        /// alive this is genuinely its start time, not a rolling heartbeat). Null if the meta file is
        /// missing/unparseable — the staleness check is then simply skipped (readiness still applies).</summary>
        private static async Task<DateTime?> GetServiceStartedAtUtcAsync(string serviceName)
        {
            try
            {
                string metaFile = Path.Combine(GetLogDir(), $"{serviceName}.meta.json");
                if (!File.Exists(metaFile)) return null;
                string json = await File.ReadAllTextAsync(metaFile);
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("updatedAt", out var u) && u.ValueKind == JsonValueKind.Number)
                    return DateTimeOffset.FromUnixTimeMilliseconds(u.GetInt64()).UtcDateTime;
            }
            catch { }
            return null;
        }

        /// <summary>Git #3091 — the commit time of the latest real commit under this service's own
        /// <c>artifacts/&lt;serviceName&gt;</c> directory in the SAME checkout <see cref="StartServiceAsync"/>
        /// runs <c>dev-all.mjs</c> from (<see cref="BuildTrackerConfig.FindRepoRoot"/> — the main
        /// checkout the dev server actually serves from, not necessarily this build session's own
        /// worktree). Routed through <see cref="SubprocessRunner"/> (Git #2539) rather than a raw
        /// <see cref="Process"/> spawn, same as every other git shell-out in this app. Null on any
        /// failure (unknown repo root, no matching commit, git launch failure) — the staleness check
        /// is then skipped rather than guessed at.</summary>
        private static async Task<DateTime?> GetLatestArtifactCommitUtcAsync(string serviceName)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null) return null;

            var res = await SubprocessRunner.RunAsync(
                "git",
                new[] { "log", "-1", "--format=%cI", "--", $"artifacts/{serviceName}" },
                repoRoot,
                TimeSpan.FromSeconds(10),
                LogChannel);

            if (!res.Ok) return null;
            string output = res.StdOut.Trim();
            if (string.IsNullOrEmpty(output)) return null;
            return DateTimeOffset.TryParse(output, out var dto) ? dto.UtcDateTime : null;
        }

        /// <summary>
        /// Starts all configured dev services.
        /// </summary>
        public static async Task<bool> StartAllServicesAsync()
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null) return false;

            ActivityLog.Log(LogChannel, "[dev-all] Launching all dev services…");
            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-all.mjs");
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = $"\"{scriptPath}\"",
                    WorkingDirectory = repoRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                Process.Start(psi);
                await Task.Delay(1000);
                ActivityLog.Log(LogChannel, "[dev-all] Multi-service development bundle started.");
                return true;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"[dev-all] Failed to launch dev-all: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Stops all running dev services.
        /// </summary>
        public static async Task<bool> StopAllServicesAsync()
        {
            ActivityLog.Log(LogChannel, "[dev-all] Stopping all dev services…");
            foreach (var kvp in KnownServices)
            {
                await StopServiceAsync(kvp.Key);
            }
            ActivityLog.Log(LogChannel, "[dev-all] All dev services stopped.");
            return true;
        }

        // ── Git #3844 — idle-service enforcement ────────────────────────────────

        /// <summary>The one always-on service (Git #3084). Never a target of the idle-stop logic
        /// below — that supervisor's whole job is keeping this one alive; this one's job is
        /// stopping everything else once nothing genuinely needs it.</summary>
        public const string AlwaysOnServiceName = "api-server";

        /// <summary>Mirrors scripts/dev-server/service-targeting.mjs's SHARED_DIR_PREFIXES — code
        /// every service compiles against, so a change here can't be cheaply attributed to one
        /// artifact and conservatively counts as "every service still needs this build".</summary>
        private static readonly string[] SharedDirPrefixes = { "lib/", "packages/" };

        /// <summary>Mirrors service-targeting.mjs's SHARED_ROOT_FILES.</summary>
        private static readonly HashSet<string> SharedRootFiles = new(StringComparer.OrdinalIgnoreCase)
        {
            "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "tsconfig.json", "tsconfig.base.json",
        };

        /// <summary>
        /// Git #3844 — real evidence of which <see cref="KnownServices"/> a set of active
        /// (queued/running/verifying) builds genuinely still need, so the idle-stop check never
        /// stops a service work is actually depending on.
        ///
        /// For each active build:
        ///   - a build targeting a genuinely different repo (RepoOwner/RepoName set and not this
        ///     repo) needs none of the local KnownServices — there's nothing here for it to touch;
        ///   - otherwise, a real `git diff` of its own worktree/cwd against origin/main (plus its
        ///     own uncommitted changes) narrows it down to just the artifact(s) it actually
        ///     touched, the same real-evidence approach scripts/dev-server/service-targeting.mjs
        ///     already uses for the post-build selective-restart plan;
        ///   - anything the diff can't resolve (no working directory yet — still queued and not
        ///     provisioned — a shared-code change, or an unclassified path) conservatively counts
        ///     as needing EVERY known service. An idle service left running a little longer than
        ///     strictly necessary is a far smaller cost than stopping one a build still needs out
        ///     from under it.
        /// </summary>
        public static HashSet<string> ComputeNeededServices(
            IEnumerable<BuildQueuePostgresClient.ActiveBuildIdentity> activeBuilds,
            Func<int, string?> resolveWorkingDirectory)
        {
            var needed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var allNames = KnownServices.Keys.ToList();

            foreach (var build in activeBuilds)
            {
                bool targetsThisRepo =
                    string.IsNullOrWhiteSpace(build.RepoOwner) || string.IsNullOrWhiteSpace(build.RepoName) ||
                    (string.Equals(build.RepoOwner, RepoIdentity.DefaultOwner, StringComparison.OrdinalIgnoreCase) &&
                     string.Equals(build.RepoName, RepoIdentity.DefaultName, StringComparison.OrdinalIgnoreCase));

                if (!targetsThisRepo) continue; // a different repo's build touches none of our local services

                string? dir = resolveWorkingDirectory(build.Id);
                if (string.IsNullOrWhiteSpace(dir)) dir = build.Cwd;

                var changedFiles = (!string.IsNullOrWhiteSpace(dir) && Directory.Exists(dir))
                    ? TryGetChangedFiles(dir!)
                    : null;

                if (changedFiles == null)
                {
                    // No working directory yet (still queued, not provisioned) or git couldn't
                    // answer — can't tell which artifact this build needs, so hold every service.
                    foreach (var n in allNames) needed.Add(n);
                    continue;
                }

                bool anyClassified = changedFiles.Count == 0; // nothing changed yet is not "unclassified"
                foreach (var raw in changedFiles)
                {
                    string norm = raw.Replace('\\', '/').Trim();
                    if (norm.Length == 0) continue;

                    bool matchedArtifact = false;
                    foreach (var kvp in KnownServices)
                    {
                        if (norm.StartsWith(kvp.Value.RelPath + "/", StringComparison.OrdinalIgnoreCase))
                        {
                            needed.Add(kvp.Key);
                            matchedArtifact = true;
                        }
                    }
                    if (matchedArtifact) { anyClassified = true; continue; }

                    bool isShared = SharedDirPrefixes.Any(p => norm.StartsWith(p, StringComparison.OrdinalIgnoreCase))
                        || (!norm.Contains('/') && SharedRootFiles.Contains(norm));
                    if (isShared)
                    {
                        foreach (var n in allNames) needed.Add(n);
                        anyClassified = true;
                    }
                }

                if (!anyClassified)
                {
                    // Real files changed but none matched a known artifact or shared prefix — an
                    // unclassified path. Conservative: hold everything rather than silently ignore it.
                    foreach (var n in allNames) needed.Add(n);
                }
            }

            return needed;
        }

        /// <summary>Real `git diff --name-only` of <paramref name="dir"/> against the point it
        /// diverged from origin/main (three-dot, matching PostBuildDeployPipeline/
        /// service-targeting.mjs's own convention), plus its own uncommitted working-tree changes
        /// (a build genuinely in progress may not have committed yet). Null when git can't answer
        /// at all (not a repo, no local origin/main, etc.) — the caller treats null as "unknown,
        /// hold everything".</summary>
        private static List<string>? TryGetChangedFiles(string dir)
        {
            string? committed = RunGit(dir, "diff --name-only origin/main...HEAD");
            string? uncommitted = RunGit(dir, "status --porcelain");
            if (committed == null && uncommitted == null) return null;

            var files = new List<string>();
            if (committed != null)
                files.AddRange(committed.Split('\n', StringSplitOptions.RemoveEmptyEntries));

            if (uncommitted != null)
            {
                foreach (var line in uncommitted.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                {
                    // Porcelain lines are "XY path" (or "XY orig -> path" for a rename) — take the
                    // real destination path.
                    string trimmed = line.TrimEnd('\r');
                    int arrow = trimmed.IndexOf("-> ", StringComparison.Ordinal);
                    string path = arrow >= 0 ? trimmed[(arrow + 3)..] : (trimmed.Length > 3 ? trimmed[3..] : trimmed);
                    files.Add(path.Trim());
                }
            }

            return files.Where(f => !string.IsNullOrWhiteSpace(f)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }

        private static string? RunGit(string dir, string args)
        {
            try
            {
                var psi = new ProcessStartInfo("git", args)
                {
                    WorkingDirectory = dir,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using var p = Process.Start(psi);
                if (p == null) return null;
                string outp = p.StandardOutput.ReadToEnd();
                p.StandardError.ReadToEnd();
                if (!p.WaitForExit(5000)) { try { p.Kill(); } catch { } return null; }
                return p.ExitCode == 0 ? outp : null;
            }
            catch { return null; }
        }
    }
}
