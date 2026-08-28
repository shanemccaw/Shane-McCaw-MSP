using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// One `agent/*` branch found to have commits main does not have.
    /// </summary>
    public class StrandedBranch
    {
        public string Branch { get; set; } = string.Empty;
        public string HeadSha { get; set; } = string.Empty;
        public int? AheadCount { get; set; }
        public string? LastCommitDate { get; set; }
        public string? Error { get; set; }
    }

    /// <summary>
    /// Result of a branch-vs-main stranded sweep.
    /// </summary>
    public class StrandedBranchResult
    {
        public bool Ok { get; set; }
        public int InspectedCount { get; set; }
        public int StrandedCount { get; set; }
        public int CleanCount { get; set; }
        public List<StrandedBranch> Stranded { get; set; } = new();
        public string? Error { get; set; }
        public string RawOutput { get; set; } = string.Empty;
    }

    /// <summary>
    /// Git #1447 Part 2. A genuinely NEW check, separate from
    /// <see cref="WorktreeCleanupService"/>'s local-worktree-lifecycle sweep — that
    /// sweep only answers "is this checkout directory stale and safe to delete", with
    /// zero concept of whether a branch's commits actually landed on main. This
    /// service answers the other question: does any `agent/*` branch have commits
    /// main does not have? (#1434 follow-up: several branches sat exactly in that
    /// state with nothing catching it.) Dispatches to
    /// scripts/dev-server/check-stranded-branches.mjs. Reuses the `worktree.cleanup`
    /// ActivityLog channel — same underlying concern (agent branch/worktree
    /// lifecycle), not a rename of the worktree-lifecycle check itself.
    /// </summary>
    public static class StrandedBranchService
    {
        private const string LogChannel = "worktree.cleanup";

        /// <summary>
        /// Sweep every `agent/*` branch (local + `origin/agent/*`) against `main`
        /// and report which ones have commits main does not have.
        /// </summary>
        public static async Task<StrandedBranchResult> SweepStrandedBranchesAsync()
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                ActivityLog.Log(LogChannel, "Cannot sweep stranded branches: repo root not found.");
                return new StrandedBranchResult { Ok = false, Error = "Repo root not found" };
            }

            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-server", "check-stranded-branches.mjs");
            if (!File.Exists(scriptPath))
            {
                ActivityLog.Log(LogChannel, $"Stranded-branch check script missing at {scriptPath}");
                return new StrandedBranchResult { Ok = false, Error = "Script not found" };
            }

            string args = $"\"{scriptPath}\" --json";

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = args,
                    WorkingDirectory = repoRoot,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };

                using var process = Process.Start(psi);
                if (process == null)
                {
                    ActivityLog.Log(LogChannel, "Failed to launch node for stranded-branch sweep");
                    return new StrandedBranchResult { Ok = false, Error = "Failed to launch process" };
                }

                string stdout = await process.StandardOutput.ReadToEndAsync();
                string stderr = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();

                if (process.ExitCode != 0)
                {
                    string err = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
                    ActivityLog.Log(LogChannel, $"Stranded-branch sweep failed (exit {process.ExitCode}): {err}");
                    return new StrandedBranchResult { Ok = false, Error = err, RawOutput = stdout };
                }

                var res = new StrandedBranchResult { Ok = true, RawOutput = stdout };
                try
                {
                    using var doc = JsonDocument.Parse(stdout);
                    var root = doc.RootElement;
                    if (root.TryGetProperty("ok", out var okEl) && !okEl.GetBoolean())
                    {
                        res.Ok = false;
                        res.Error = root.TryGetProperty("error", out var errEl) ? errEl.GetString() : "Sweep reported failure";
                        ActivityLog.Log(LogChannel, $"Stranded-branch sweep reported failure: {res.Error}");
                        return res;
                    }

                    if (root.TryGetProperty("inspectedCount", out var ic)) res.InspectedCount = ic.GetInt32();
                    if (root.TryGetProperty("strandedCount", out var sc)) res.StrandedCount = sc.GetInt32();
                    if (root.TryGetProperty("cleanCount", out var cc)) res.CleanCount = cc.GetInt32();

                    if (root.TryGetProperty("stranded", out var strandedArr) && strandedArr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in strandedArr.EnumerateArray())
                        {
                            res.Stranded.Add(new StrandedBranch
                            {
                                Branch = el.TryGetProperty("branch", out var b) ? b.GetString() ?? "" : "",
                                HeadSha = el.TryGetProperty("headSha", out var h) ? h.GetString() ?? "" : "",
                                AheadCount = el.TryGetProperty("aheadCount", out var a) && a.ValueKind == JsonValueKind.Number ? a.GetInt32() : (int?)null,
                                LastCommitDate = el.TryGetProperty("lastCommitDate", out var d) ? d.GetString() : null,
                                Error = el.TryGetProperty("error", out var eEl) ? eEl.GetString() : null,
                            });
                        }
                    }
                }
                catch (Exception parseEx)
                {
                    ActivityLog.Log(LogChannel, $"Stranded-branch sweep: failed to parse JSON output: {parseEx.Message}");
                    return new StrandedBranchResult { Ok = false, Error = $"Failed to parse sweep output: {parseEx.Message}", RawOutput = stdout };
                }

                ActivityLog.Log(LogChannel,
                    $"Stranded-branch sweep: inspected={res.InspectedCount}, stranded={res.StrandedCount}, clean={res.CleanCount}.");
                return res;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"Stranded-branch sweep exception: {ex.Message}");
                return new StrandedBranchResult { Ok = false, Error = ex.Message };
            }
        }
    }
}
