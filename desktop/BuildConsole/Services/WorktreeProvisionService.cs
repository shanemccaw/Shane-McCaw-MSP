using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>Git #2084 — the shared-store health scan `provision-worktree.mjs --json` runs
    /// (via store-doctor.mjs's <c>scanSharedStore</c>) against the main-checkout node_modules
    /// every fresh worktree junctions into, plus whatever auto-repair (Git #1980) it applied.
    /// Mirrors the real `storeHealth` shape on both provision result paths (reuse + fresh
    /// create) — see provision-worktree.mjs.</summary>
    public class StoreHealthAutoRepairInfo
    {
        public int RepairedLinks { get; set; }
        public int RepairedBins { get; set; }
        public int Unrepairable { get; set; }
        public string? Error { get; set; }
        public bool CleanAfterRepair { get; set; }
    }

    public class StoreHealthInfo
    {
        public bool Clean { get; set; }
        public int Foreign { get; set; }
        public int Dangling { get; set; }
        public int PoisonedBins { get; set; }
        /// <summary>Set only when the scan itself threw (e.g. the shared store path doesn't exist yet).</summary>
        public string? Error { get; set; }
        /// <summary>Present only when the pre-repair scan found poisoning (Git #1980's auto-repair ran).</summary>
        public StoreHealthAutoRepairInfo? AutoRepair { get; set; }

        /// <summary>True when this build's launch should surface a warning: the scan failed outright,
        /// or the store was poisoned and either no repair ran or it didn't fully clean things up.</summary>
        public bool NeedsWarning => Error != null || (!Clean && (AutoRepair == null || !AutoRepair.CleanAfterRepair));
    }

    /// <summary>Result of provisioning (or reusing) an isolated agent worktree.</summary>
    public class WorktreeProvisionResult
    {
        public bool Ok { get; set; }
        public string? Path { get; set; }
        public string? Branch { get; set; }
        public bool Reused { get; set; }
        public string? Error { get; set; }
        public string RawOutput { get; set; } = string.Empty;
        /// <summary>Git #1958 — non-empty when this (re-)provisioned worktree does NOT contain a
        /// prior session's rescued work; each entry is a <c>rescued/&lt;name&gt;-*</c> branch the
        /// earlier session's uncommitted/unpushed work was preserved to. A resumed build must not
        /// trust a clean <c>git status</c> when this is set.</summary>
        public List<string> PriorWorkRescued { get; set; } = new();
        /// <summary>Git #2084 — the shared-store health scan this provision performed. Null only if
        /// the child process's JSON genuinely omitted the field (a foreign/legacy output shape).</summary>
        public StoreHealthInfo? StoreHealth { get; set; }
    }

    /// <summary>
    /// Git #1371 — provisions the per-build isolated git worktree BuildConsole launches each
    /// build inside, and (on completion) merges that worktree's committed changes into the
    /// local dev-server checkout. A thin C# dispatcher to the proven dev-server scripts
    /// (scripts/dev-server/provision-worktree.mjs + request-restart.mjs) — no logic is
    /// reimplemented here. Cleanup lives in <see cref="WorktreeCleanupService"/>.
    /// </summary>
    public static class WorktreeProvisionService
    {
        private const string LogChannel = "worktree.provision";

        /// <summary>Git #2084 — one pending "this build launched against a poisoned shared store"
        /// warning per queue item id, stashed here by <see cref="QueueWatcherService"/>'s launch path
        /// right after provisioning and popped by <c>BuildWatchWindow.OccupySlot</c> so the Build Watch
        /// slot shows it the moment the build's pane is created. Cross-class rather than a QueueItem
        /// field because the queue row is server-synced JSON — this is purely local, launch-time state.</summary>
        public static readonly ConcurrentDictionary<int, string> PendingLaunchWarnings = new();

        /// <summary>Human-readable warning text for a Build Watch slot, or null when nothing needs
        /// surfacing. Never prescribes `pnpm install` (Git #1987) — always points at store-doctor.mjs.</summary>
        public static string? BuildStoreHealthWarning(StoreHealthInfo? health)
        {
            if (health == null || !health.NeedsWarning) return null;
            string detail = health.Error != null
                ? $"scan error: {health.Error}"
                : $"foreign={health.Foreign} dangling={health.Dangling} poisonedBins={health.PoisonedBins}" +
                  (health.AutoRepair != null ? " (auto-repair attempted, still not clean after repair)" : "");
            return $"⚠ Shared pnpm store poisoned (Git #1988) — {detail}. Run `node scripts/dev-server/store-doctor.mjs` to repair. Do NOT run pnpm install (#1987).";
        }

        /// <summary>Create (or idempotently reuse) an isolated worktree off origin/main for
        /// <paramref name="name"/>, junctioning a shared node_modules when <paramref name="link"/>
        /// is set (#1372 — no per-worktree install/download). The worktree is registered to
        /// <paramref name="ownerPid"/> so the cleanup sweep never removes it while that process
        /// is alive.</summary>
        public static Task<WorktreeProvisionResult> ProvisionWorktreeAsync(string name, int ownerPid, bool link = true)
        {
            string args = $"\"{{script}}\" \"{name}\" --owner-pid {ownerPid} --json";
            if (link) args = $"\"{{script}}\" \"{name}\" --link --owner-pid {ownerPid} --json";
            return RunProvisionAsync(args, $"Provision worktree '{name}'");
        }

        /// <summary>Re-point an already-provisioned worktree's owner pid (e.g. from the launcher's
        /// pid to the freshly-started build process's pid) so the sweep tracks the real build
        /// process. Uses the provisioner's idempotent reuse path — does not re-checkout or re-link.</summary>
        public static Task<WorktreeProvisionResult> StampOwnerAsync(string name, int ownerPid)
        {
            string args = $"\"{{script}}\" \"{name}\" --owner-pid {ownerPid} --json";
            return RunProvisionAsync(args, $"Re-stamp worktree owner '{name}' -> pid {ownerPid}");
        }

        private static async Task<WorktreeProvisionResult> RunProvisionAsync(string argTemplate, string actionDescription)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                ActivityLog.Log(LogChannel, $"{actionDescription}: repo root not found.");
                return new WorktreeProvisionResult { Ok = false, Error = "Repo root not found" };
            }
            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-server", "provision-worktree.mjs");
            if (!File.Exists(scriptPath))
            {
                ActivityLog.Log(LogChannel, $"{actionDescription}: provisioner missing at {scriptPath}");
                return new WorktreeProvisionResult { Ok = false, Error = "provision-worktree.mjs not found" };
            }
            string args = argTemplate.Replace("{script}", scriptPath);

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
                // Git #2792 — time the provisioning call. A fresh `git worktree add` (reused=False)
                // silently grew from ~1s to tens-of-seconds/minutes as the repo accumulated branches
                // and loose objects, and — because launches were serialized — that turned a whole
                // batch into a multi-minute one-at-a-time stagger with no visible signal WHY. Logging
                // the elapsed time makes any future provisioning slowdown immediately diagnosable from
                // the activity log instead of manifesting only as "builds seem to hang".
                var sw = System.Diagnostics.Stopwatch.StartNew();
                using var process = Process.Start(psi);
                if (process == null)
                    return new WorktreeProvisionResult { Ok = false, Error = "Failed to launch node" };

                string stdout = await process.StandardOutput.ReadToEndAsync();
                string stderr = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();
                sw.Stop();

                var res = new WorktreeProvisionResult { RawOutput = stdout };
                try
                {
                    using var doc = JsonDocument.Parse(stdout.Trim());
                    var root = doc.RootElement;
                    res.Ok = root.TryGetProperty("ok", out var okEl) && okEl.GetBoolean();
                    if (root.TryGetProperty("path", out var p) && p.ValueKind == JsonValueKind.String) res.Path = p.GetString();
                    if (root.TryGetProperty("branch", out var b) && b.ValueKind == JsonValueKind.String) res.Branch = b.GetString();
                    if (root.TryGetProperty("reused", out var r) && r.ValueKind != JsonValueKind.Null) res.Reused = r.ValueKind == JsonValueKind.True;
                    if (root.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String) res.Error = e.GetString();
                    // Git #1958 — capture the rescued-branch list so a re-provision over prior
                    // work is durably visible in the activity log, not just in the worktree marker.
                    if (root.TryGetProperty("priorWorkRescued", out var pw) && pw.ValueKind == JsonValueKind.Array)
                        foreach (var el in pw.EnumerateArray())
                            if (el.ValueKind == JsonValueKind.String) res.PriorWorkRescued.Add(el.GetString()!);
                    // Git #2084 — parse the shared-store health scan. Present on both the reuse and
                    // fresh-create result paths (provision-worktree.mjs); previously dropped entirely,
                    // so a build launched against a poisoned store started with no visible warning.
                    if (root.TryGetProperty("storeHealth", out var sh) && sh.ValueKind == JsonValueKind.Object)
                    {
                        var health = new StoreHealthInfo();
                        if (sh.TryGetProperty("error", out var shErr) && shErr.ValueKind == JsonValueKind.String)
                            health.Error = shErr.GetString();
                        if (sh.TryGetProperty("clean", out var shClean) && shClean.ValueKind != JsonValueKind.Null)
                            health.Clean = shClean.ValueKind == JsonValueKind.True;
                        if (sh.TryGetProperty("foreign", out var shForeign) && shForeign.ValueKind == JsonValueKind.Number)
                            health.Foreign = shForeign.GetInt32();
                        if (sh.TryGetProperty("dangling", out var shDangling) && shDangling.ValueKind == JsonValueKind.Number)
                            health.Dangling = shDangling.GetInt32();
                        if (sh.TryGetProperty("poisonedBins", out var shBins) && shBins.ValueKind == JsonValueKind.Number)
                            health.PoisonedBins = shBins.GetInt32();
                        if (sh.TryGetProperty("autoRepair", out var ar) && ar.ValueKind == JsonValueKind.Object)
                        {
                            var repair = new StoreHealthAutoRepairInfo();
                            if (ar.TryGetProperty("repairedLinks", out var rl) && rl.ValueKind == JsonValueKind.Number) repair.RepairedLinks = rl.GetInt32();
                            if (ar.TryGetProperty("repairedBins", out var rb) && rb.ValueKind == JsonValueKind.Number) repair.RepairedBins = rb.GetInt32();
                            if (ar.TryGetProperty("unrepairable", out var ur) && ur.ValueKind == JsonValueKind.Number) repair.Unrepairable = ur.GetInt32();
                            if (ar.TryGetProperty("error", out var re) && re.ValueKind == JsonValueKind.String) repair.Error = re.GetString();
                            if (ar.TryGetProperty("cleanAfterRepair", out var car) && car.ValueKind != JsonValueKind.Null) repair.CleanAfterRepair = car.ValueKind == JsonValueKind.True;
                            health.AutoRepair = repair;
                        }
                        res.StoreHealth = health;
                    }
                }
                catch
                {
                    // Non-JSON output (shouldn't happen with --json) — treat as failure with raw text.
                    res.Ok = process.ExitCode == 0 && string.IsNullOrEmpty(stderr);
                    if (!res.Ok) res.Error = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
                }

                // Git #2792 — a slow fresh provision is the real cost the serialized launch loop used
                // to sum; flag it loudly (WARN-shaped wording) so a future regression is obvious.
                string slow = (!res.Reused && sw.ElapsedMilliseconds >= 15000) ? " ⚠ SLOW fresh worktree add" : "";
                if (res.Ok)
                    ActivityLog.Log(LogChannel, $"{actionDescription}: ok (path={res.Path}, reused={res.Reused}) in {sw.ElapsedMilliseconds}ms.{slow}");
                else
                    ActivityLog.Log(LogChannel, $"{actionDescription}: FAILED in {sw.ElapsedMilliseconds}ms — {res.Error}");
                // Git #1958 — a re-provision over prior work is a data-loss-adjacent event: the
                // resumed build's checkout is missing an earlier session's work (now on rescued/*).
                // Log it loudly and durably so it's discoverable from the activity log alone.
                if (res.Ok && res.PriorWorkRescued.Count > 0)
                    ActivityLog.Log(LogChannel, $"{actionDescription}: ⚠ RE-PROVISION over prior work (Git #1958) — this checkout does NOT contain it; rescued to: {string.Join(", ", res.PriorWorkRescued)}. See {res.Path}\\.worktree-reprovisioned.json.");
                // Git #2084 — a poisoned shared store was previously invisible at launch (the field
                // was parsed nowhere), so a build hit inexplicable tsc/vitest failures mid-session with
                // no signal why (#1955/#1967's failure mode). Log it loudly here regardless of outcome
                // — this worktree's node_modules junctions point straight at that same shared store —
                // and point at store-doctor.mjs, never `pnpm install` (Git #1987).
                if (res.Ok && res.StoreHealth?.NeedsWarning == true)
                {
                    var h = res.StoreHealth;
                    string detail = h.Error != null
                        ? $"scan error: {h.Error}"
                        : $"foreign={h.Foreign} dangling={h.Dangling} poisonedBins={h.PoisonedBins}" +
                          (h.AutoRepair != null
                              ? $", auto-repair ran (repairedLinks={h.AutoRepair.RepairedLinks}, repairedBins={h.AutoRepair.RepairedBins}, unrepairable={h.AutoRepair.Unrepairable}{(h.AutoRepair.Error != null ? $", error={h.AutoRepair.Error}" : "")}) — still not clean after repair"
                              : "");
                    ActivityLog.Log(LogChannel, $"{actionDescription}: ⚠ SHARED STORE POISONED (Git #1988) — {detail}. Run `node scripts/dev-server/store-doctor.mjs` (do NOT run pnpm install, per #1987).");
                }
                return res;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"{actionDescription}: exception {ex.Message}");
                return new WorktreeProvisionResult { Ok = false, Error = ex.Message };
            }
        }

        /// <summary>Merge a completed build's committed worktree changes into the local dev-server
        /// checkout (and trigger its coalesced restart) via scripts/dev-server/request-restart.mjs,
        /// run from inside the worktree. Best-effort and idempotent: if the commit is already live
        /// (the session ran this itself, or nothing was committed) it is a no-op. Build-set members
        /// pass their DEV_BUILD_SET* env so the restart stays deferred until the whole set completes.</summary>
        public static async Task<bool> MergeBackAsync(string worktreePath, string agentName, IReadOnlyDictionary<string, string>? buildSetEnv = null)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null) { ActivityLog.Log(LogChannel, $"Merge-back '{agentName}': repo root not found."); return false; }
            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-server", "request-restart.mjs");
            if (!File.Exists(scriptPath)) { ActivityLog.Log(LogChannel, $"Merge-back '{agentName}': request-restart.mjs not found."); return false; }
            if (string.IsNullOrWhiteSpace(worktreePath) || !Directory.Exists(worktreePath))
            {
                ActivityLog.Log(LogChannel, $"Merge-back '{agentName}': worktree path gone ({worktreePath}) — nothing to merge.");
                return false;
            }

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = $"\"{scriptPath}\" --agent \"{agentName}\" --json",
                    WorkingDirectory = worktreePath, // request-restart merges the worktree's HEAD
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                if (buildSetEnv != null)
                    foreach (var kv in buildSetEnv) psi.Environment[kv.Key] = kv.Value;

                using var process = Process.Start(psi);
                if (process == null) return false;
                string stdout = await process.StandardOutput.ReadToEndAsync();
                string stderr = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();

                bool ok = process.ExitCode == 0;
                ActivityLog.Log(LogChannel, ok
                    ? $"Merge-back '{agentName}': {stdout.Trim()}"
                    : $"Merge-back '{agentName}': FAILED (exit {process.ExitCode}) — {(string.IsNullOrWhiteSpace(stderr) ? stdout : stderr).Trim()}");
                return ok;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"Merge-back '{agentName}': exception {ex.Message}");
                return false;
            }
        }
    }
}
