using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    public enum HealthStatus
    {
        Healthy,
        Degraded,
        Unhealthy,
        NotConfigured,
        Unknown
    }

    public class ComponentHealth
    {
        public string Name { get; set; } = string.Empty;
        public HealthStatus Status { get; set; } = HealthStatus.Unknown;
        public string Summary { get; set; } = string.Empty;
        public string Details { get; set; } = string.Empty;
        public long LatencyMs { get; set; }
        public bool IsConfigured { get; set; } = true;
        public bool IsHealthy => Status == HealthStatus.Healthy || Status == HealthStatus.NotConfigured;
    }

    public class MutexHealth
    {
        public bool IsHeld { get; set; }
        public int? OwnerPid { get; set; }
        public bool OwnerAlive { get; set; }
        public string? CycleId { get; set; }
        public TimeSpan HeldDuration { get; set; }
        public bool IsSuspicious { get; set; }
        public string Summary { get; set; } = "Idle (Available)";
        public string Details { get; set; } = string.Empty;
    }

    public class WorktreeHealth
    {
        public int InspectedCount { get; set; }
        public int ActiveCount { get; set; }
        public int StaleCount { get; set; }
        public int OrphanedCount { get; set; }
        public string Summary { get; set; } = "0 orphaned worktrees";
        public string Details { get; set; } = string.Empty;
        public List<string> OrphanedPaths { get; set; } = new();
    }

    /// <summary>
    /// Git #1447 Part 2. Distinct from <see cref="WorktreeHealth"/> — that checks
    /// local worktree checkout lifecycle only; this checks whether `agent/*` branch
    /// commits have actually landed on main. Deliberately different terminology
    /// ("stranded" vs "orphaned") to avoid the exact conflation that caused #1447.
    /// </summary>
    public class StrandedBranchHealth
    {
        public int InspectedCount { get; set; }
        public int StrandedCount { get; set; }
        public int CleanCount { get; set; }
        public string Summary { get; set; } = "0 stranded branches";
        public string Details { get; set; } = string.Empty;
        public List<string> StrandedBranches { get; set; } = new();
    }

    public class SystemHealthReport
    {
        public DateTime CheckedAt { get; set; } = DateTime.Now;
        // Note: StrandedBranches is deliberately NOT part of AllHealthy. Up to ~8
        // concurrent agent sessions can be legitimately mid-flight at once (per
        // CLAUDE.md worktree-isolation section) — every one of them is, by
        // definition, "ahead of main" until it lands. That's normal, not a fault.
        // The row still surfaces the real count so a genuinely stale/stranded
        // branch doesn't go unnoticed; it just doesn't flip the overall pill red
        // for ordinary concurrent work in progress.
        public bool AllHealthy => DevServer.IsHealthy &&
                                  Database.IsHealthy &&
                                  !Mutex.IsSuspicious &&
                                  OrphanedWorktrees.OrphanedCount == 0 &&
                                  (SshStaging.IsHealthy || !SshStaging.IsConfigured);

        public ComponentHealth DevServer { get; set; } = new() { Name = "Local Dev Server" };
        public ComponentHealth Database { get; set; } = new() { Name = "Local Database Pipe" };
        public MutexHealth Mutex { get; set; } = new();
        public WorktreeHealth OrphanedWorktrees { get; set; } = new();
        public StrandedBranchHealth StrandedBranches { get; set; } = new();
        public ComponentHealth SshStaging { get; set; } = new() { Name = "Staging SSH" };
    }

    /// <summary>
    /// Service for running genuine, live-checked system health evaluations across:
    ///   1. Local dev server reachability & latency.
    ///   2. Local database reachability via the SqlRunnerView pipe.
    ///   3. #92 coordination mutex status and stuck-cycle detection.
    ///   4. Orphaned worktrees detection (#94).
    ///   5. Remote SSH connectivity to Staging.
    /// </summary>
    public static class SystemHealthService
    {
        private const string LogChannel = "system.health";
        private static readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(3) };

        /// <summary>
        /// Runs a full live health check across all 5 system components.
        /// </summary>
        public static async Task<SystemHealthReport> RunFullHealthCheckAsync(BuildTrackerApiClient? api = null)
        {
            var report = new SystemHealthReport();

            // Run checks in parallel where appropriate
            var devServerTask = CheckDevServerAsync();
            var dbTask = CheckDatabaseAsync(api);
            var mutexTask = Task.Run(CheckMutexHealth);
            var worktreeTask = CheckWorktreesAsync();
            var strandedBranchTask = CheckStrandedBranchesAsync();
            var sshTask = CheckSshStagingAsync();

            await Task.WhenAll(devServerTask, dbTask, mutexTask, worktreeTask, strandedBranchTask, sshTask);

            report.DevServer = await devServerTask;
            report.Database = await dbTask;
            report.Mutex = await mutexTask;
            report.OrphanedWorktrees = await worktreeTask;
            report.StrandedBranches = await strandedBranchTask;
            report.SshStaging = await sshTask;

            // Wire logging
            string overallPill = report.AllHealthy ? "✅ ALL HEALTHY" : "⚠️ NEEDS ATTENTION";
            ActivityLog.Log(LogChannel,
                $"{overallPill} — DevServer: {report.DevServer.Status} ({report.DevServer.LatencyMs}ms) | " +
                $"DB: {report.Database.Status} | Mutex: {report.Mutex.Summary} | " +
                $"Worktrees: {report.OrphanedWorktrees.Summary} | StrandedBranches: {report.StrandedBranches.Summary} | " +
                $"SSH: {report.SshStaging.Status}");

            return report;
        }

        public static async Task<ComponentHealth> CheckDevServerAsync()
        {
            var h = new ComponentHealth { Name = "Local Dev Server" };
            var cfg = BuildTrackerConfig.Load();
            string url = cfg?.GetBaseUrl(TargetEnvironment.Dev) ?? "http://localhost:8080";
            if (string.IsNullOrWhiteSpace(url))
            {
                url = "http://localhost:8080";
            }
            string healthUrl = url.TrimEnd('/') + "/api/healthz";

            var sw = Stopwatch.StartNew();
            try
            {
                var response = await _httpClient.GetAsync(healthUrl);
                sw.Stop();
                h.LatencyMs = sw.ElapsedMilliseconds;

                if (response.IsSuccessStatusCode)
                {
                    h.Status = HealthStatus.Healthy;
                    h.Summary = $"Responding 200 OK ({h.LatencyMs}ms)";
                    h.Details = $"Target: {healthUrl}\nStatus: {response.StatusCode}\nLatency: {h.LatencyMs}ms";
                }
                else
                {
                    h.Status = HealthStatus.Degraded;
                    h.Summary = $"HTTP {(int)response.StatusCode} ({h.LatencyMs}ms)";
                    h.Details = $"Target: {healthUrl}\nStatus code: {(int)response.StatusCode} {response.ReasonPhrase}";
                }
            }
            catch (Exception ex)
            {
                sw.Stop();
                h.LatencyMs = sw.ElapsedMilliseconds;
                h.Status = HealthStatus.Unhealthy;
                h.Summary = "Unreachable (connection refused/timeout)";
                h.Details = $"Target: {healthUrl}\nError: {ex.Message}";
            }

            return h;
        }

        public static async Task<ComponentHealth> CheckDatabaseAsync(BuildTrackerApiClient? api)
        {
            var h = new ComponentHealth { Name = "Local Database Pipe" };

            if (api == null || !api.IsConfigured)
            {
                h.Status = HealthStatus.NotConfigured;
                h.IsConfigured = false;
                h.Summary = "API client not configured";
                h.Details = "Configure apiBaseUrl and ingestToken in scripts/build-queue-watcher.config.json";
                return h;
            }

            var sw = Stopwatch.StartNew();
            try
            {
                var results = await LocalSqlExecutor.ExecuteAsync(api, "SELECT 1 AS health_check;");
                sw.Stop();
                h.LatencyMs = sw.ElapsedMilliseconds;

                if (results != null && results.Count > 0 && results[0].Success)
                {
                    h.Status = HealthStatus.Healthy;
                    h.Summary = $"Connected via SqlRunner pipe ({h.LatencyMs}ms)";
                    h.Details = $"Query: SELECT 1 AS health_check;\nRows returned: {results[0].Rows?.Count ?? 0}\nExecution pipe: POST /api/simulator/sql/execute";
                }
                else
                {
                    string err = results != null && results.Count > 0 ? results[0].Error ?? "Unknown error" : "No result returned";
                    h.Status = HealthStatus.Unhealthy;
                    h.Summary = $"Query failed: {err}";
                    h.Details = $"Query execution failed through API pipe: {err}";
                }
            }
            catch (Exception ex)
            {
                sw.Stop();
                h.LatencyMs = sw.ElapsedMilliseconds;
                h.Status = HealthStatus.Unhealthy;
                h.Summary = $"Execution error: {ex.Message}";
                h.Details = $"Exception through SqlRunner pipe: {ex.Message}";
            }

            return h;
        }

        public static MutexHealth CheckMutexHealth()
        {
            var m = new MutexHealth();
            try
            {
                // Git #1985 — audited, genuinely tolerable: on Windows (this app's only real
                // target — same convention DevServerRollbackService.cs uses) the state dir is the
                // documented C:\dev-server-state default and never touches repoRoot at all; the
                // `repoRoot ?? "."` branch only matters on a hypothetical non-Windows build, and
                // even there a wrong dir just makes File.Exists(ownerFile) false below, reporting
                // "Idle" honestly rather than fabricating lock-holder data.
                string? repoRoot = BuildTrackerConfig.FindRepoRoot();
                string stateDir = Environment.GetEnvironmentVariable("DEV_SERVER_STATE_DIR")
                    ?? (OperatingSystem.IsWindows() ? @"C:\dev-server-state" : Path.Combine(repoRoot ?? ".", ".dev-server-state"));

                string ownerFile = Path.Combine(stateDir, "lock", "owner.json");
                if (!File.Exists(ownerFile))
                {
                    m.IsHeld = false;
                    m.Summary = "🟢 Idle (Available)";
                    m.Details = "No agent currently holds the dev-server coordination lock.";
                    return m;
                }

                string json = File.ReadAllText(ownerFile);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                int pid = root.TryGetProperty("pid", out var p) ? p.GetInt32() : -1;
                long startedAt = root.TryGetProperty("startedAt", out var s) ? s.GetInt64() : 0;
                string cycleId = root.TryGetProperty("cycleId", out var c) ? c.GetString() ?? "" : "";

                m.IsHeld = true;
                m.OwnerPid = pid;
                m.CycleId = cycleId;

                // Check process liveness
                bool alive = false;
                if (pid > 0)
                {
                    try
                    {
                        var proc = Process.GetProcessById(pid);
                        alive = !proc.HasExited;
                    }
                    catch
                    {
                        alive = false;
                    }
                }
                m.OwnerAlive = alive;

                if (startedAt > 0)
                {
                    var startedUtc = DateTimeOffset.FromUnixTimeMilliseconds(startedAt).UtcDateTime;
                    m.HeldDuration = DateTime.UtcNow - startedUtc;
                }

                // Check if held suspiciously long (> 90s per staleLockMs or dead PID)
                if (!alive && m.HeldDuration.TotalSeconds > 5)
                {
                    m.IsSuspicious = true;
                    m.Summary = $"🚨 DEAD-PID HOLDER (PID {pid}, {m.HeldDuration.TotalSeconds:F0}s elapsed)";
                    m.Details = $"Cycle: {cycleId}\nOwner PID: {pid} (DEAD)\nHeld since: {m.HeldDuration.TotalSeconds:F0}s ago.\nStale lock will be broken by next requester.";
                }
                else if (m.HeldDuration.TotalSeconds > 90)
                {
                    m.IsSuspicious = true;
                    m.Summary = $"⚠️ HELD SUSPICIOUSLY LONG ({m.HeldDuration.TotalMinutes:F1}m, PID {pid})";
                    m.Details = $"Cycle: {cycleId}\nOwner PID: {pid} (Alive: {alive})\nHeld for {m.HeldDuration.TotalSeconds:F0}s (threshold 90s). May indicate a hung merge or slow build.";
                }
                else
                {
                    m.IsSuspicious = false;
                    m.Summary = $"Active cycle {(string.IsNullOrEmpty(cycleId) ? "" : $"[{cycleId}] ")}— PID {pid} ({m.HeldDuration.TotalSeconds:F0}s)";
                    m.Details = $"Cycle: {cycleId}\nOwner PID: {pid} (Alive: {alive})\nElapsed: {m.HeldDuration.TotalSeconds:F0}s";
                }
            }
            catch (Exception ex)
            {
                m.Summary = $"Error inspecting lock: {ex.Message}";
                m.Details = ex.ToString();
            }

            return m;
        }

        public static async Task<WorktreeHealth> CheckWorktreesAsync()
        {
            var w = new WorktreeHealth();
            try
            {
                var sweepRes = await WorktreeCleanupService.SweepWorktreesAsync(dryRun: true);
                if (sweepRes.Ok)
                {
                    w.InspectedCount = sweepRes.InspectedCount;
                    w.OrphanedCount = sweepRes.RemovedCount;
                    w.ActiveCount = sweepRes.RetainedCount;

                    if (w.OrphanedCount > 0)
                    {
                        w.Summary = $"⚠️ {w.OrphanedCount} orphaned worktree(s) found";
                        w.Details = $"Inspected {w.InspectedCount} total worktrees.\nFound {w.OrphanedCount} orphaned or inactive worktree(s) eligible for cleanup.\n{w.ActiveCount} active worktree(s) retained.";
                    }
                    else
                    {
                        w.Summary = $"🟢 0 orphaned worktrees ({w.ActiveCount} active)";
                        w.Details = $"Inspected {w.InspectedCount} worktrees. All worktrees are active or cleanly managed.";
                    }
                }
                else
                {
                    w.Summary = $"Check error: {sweepRes.Error ?? "failed"}";
                    w.Details = sweepRes.Error ?? "Unknown error running sweep";
                }
            }
            catch (Exception ex)
            {
                w.Summary = $"Error: {ex.Message}";
                w.Details = ex.ToString();
            }

            return w;
        }

        /// <summary>
        /// Git #1447 Part 2. Real branch-vs-main sweep, distinct from
        /// <see cref="CheckWorktreesAsync"/>'s local-worktree-lifecycle check.
        /// </summary>
        public static async Task<StrandedBranchHealth> CheckStrandedBranchesAsync()
        {
            var s = new StrandedBranchHealth();
            try
            {
                var sweepRes = await StrandedBranchService.SweepStrandedBranchesAsync();
                if (sweepRes.Ok)
                {
                    s.InspectedCount = sweepRes.InspectedCount;
                    s.StrandedCount = sweepRes.StrandedCount;
                    s.CleanCount = sweepRes.CleanCount;
                    s.StrandedBranches = sweepRes.Stranded.ConvertAll(b => b.Branch);

                    if (s.StrandedCount > 0)
                    {
                        s.Summary = $"⚠️ {s.StrandedCount} branch(es) ahead of main, not merged";
                        var lines = new List<string>();
                        foreach (var b in sweepRes.Stranded)
                        {
                            lines.Add(b.Error != null
                                ? $"{b.Branch} ({b.HeadSha[..Math.Min(8, b.HeadSha.Length)]}) — ERROR: {b.Error}"
                                : $"{b.Branch} ({b.HeadSha[..Math.Min(8, b.HeadSha.Length)]}) — {b.AheadCount} commit(s) ahead, last commit {b.LastCommitDate}");
                        }
                        s.Details = $"Inspected {s.InspectedCount} agent/* branch(es).\n" +
                                    $"Found {s.StrandedCount} branch(es) with commits main does not have — real unmerged work, not just a stale local checkout.\n" +
                                    $"{s.CleanCount} branch(es) fully merged into main.\n\nStranded:\n" + string.Join("\n", lines);
                    }
                    else
                    {
                        s.Summary = $"🟢 0 stranded branches ({s.CleanCount} merged)";
                        s.Details = $"Inspected {s.InspectedCount} agent/* branch(es). All are ancestors of main.";
                    }
                }
                else
                {
                    s.Summary = $"Check error: {sweepRes.Error ?? "failed"}";
                    s.Details = sweepRes.Error ?? "Unknown error running stranded-branch sweep";
                }
            }
            catch (Exception ex)
            {
                s.Summary = $"Error: {ex.Message}";
                s.Details = ex.ToString();
            }

            return s;
        }

        public static async Task<ComponentHealth> CheckSshStagingAsync()
        {
            var h = new ComponentHealth { Name = "Staging SSH" };

            if (!ReplitSshService.Instance.IsConfigured)
            {
                h.Status = HealthStatus.NotConfigured;
                h.IsConfigured = false;
                h.Summary = "⚪ Not configured in Settings";
                h.Details = "SSH Host or private key path not configured in Settings -> SSH & Remote.";
                return h;
            }

            // Git #1828 — this probe runs on a background 30s health timer. When the Dev-only SSH lock
            // has real remote access gated (the normal Dev state), don't fire a doomed connection every
            // tick and don't flag it red as "unhealthy": SSH being disabled under Dev is the CORRECT,
            // expected state, not a fault. Report it honestly using the SAME gate as the executor.
            var blockReason = ReplitSshService.Instance.GetRemoteAccessBlockReason();
            if (blockReason != null)
            {
                h.Status = HealthStatus.NotConfigured;
                h.IsConfigured = true;
                h.Summary = "⚪ Disabled (Target Environment not Staging)";
                h.Details = blockReason;
                return h;
            }

            var sw = Stopwatch.StartNew();
            try
            {
                var (success, msg, latencyMs) = await ReplitSshService.Instance.TestConnectionAsync();
                sw.Stop();
                h.LatencyMs = latencyMs;

                if (success)
                {
                    h.Status = HealthStatus.Healthy;
                    h.Summary = $"Connected ({latencyMs}ms)";
                    h.Details = msg;
                }
                else
                {
                    h.Status = HealthStatus.Unhealthy;
                    h.Summary = "Connection failed";
                    h.Details = msg;
                }
            }
            catch (Exception ex)
            {
                sw.Stop();
                h.LatencyMs = sw.ElapsedMilliseconds;
                h.Status = HealthStatus.Unhealthy;
                h.Summary = $"SSH test error: {ex.Message}";
                h.Details = ex.ToString();
            }

            return h;
        }
    }
}
