using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>Outcome of one <see cref="VisualTestTrackerReExportService.ReconcileAsync"/> pass.</summary>
    public sealed class ReExportReconcileResult
    {
        public int SessionsScanned { get; set; }
        public int SessionsUpdated { get; set; }
        public List<string> UpdatedSessionDirs { get; set; } = new();
        public string? Error { get; set; }
    }

    /// <summary>
    /// Git #3980 — keeps a committed session's report.json (and its summary.md) a live mirror of
    /// Postgres after End &amp; Sync, instead of the export staying frozen at whatever
    /// status/git_issue_number/resolution/resolution_reason it had at sync time.
    ///
    /// A synced bug's real state keeps changing after export — a GitHub issue gets filed and
    /// stamped back (<see cref="VisualTestTrackerStore.UpdateGitIssueNumberAsync"/>), status moves
    /// Open → Verifying → Closed, resolution/resolution_reason get set — and none of that
    /// previously reached the committed file chat actually reads (per #3977: "chat has no live
    /// Postgres/route access... the real, already-working channel is report.json").
    ///
    /// This can't be a purely in-process event handler: the writes that need to trigger a
    /// re-export can come from a source with NO BuildConsole process running at all — a dispatched
    /// Claude Code build writing directly to Postgres via `psql` (Git #3985), or Shane's own review
    /// action. So it's a real poll, run on the same DispatcherTimer-tick pattern
    /// (<see cref="QueueWatcherService"/>) already used elsewhere in this app — see
    /// MainWindow.xaml.cs's `_visualTestTrackerReExportTimer`.
    ///
    /// Deliberately does NOT reuse VisualTestTrackerSessionSyncService.WriteSessionFiles /
    /// ExecuteGitSyncAsync wholesale to regenerate a session: that method's report.json/summary.md
    /// output is built from a full SessionSyncContext (console logs, network failures, API results,
    /// session-level notes, original screenshot source paths) that exists only in memory during the
    /// original End &amp; Sync call and is never persisted anywhere once that session ends.
    /// Reconstructing a fake context and calling WriteSessionFiles again would silently blank those
    /// fields in an otherwise-correct already-committed file — a regression, not a fix. Instead this
    /// surgically patches only the four lifecycle fields (status/gitIssueNumber/resolution/
    /// resolutionReason) per bug directly in the parsed JSON tree, preserving everything else
    /// byte-for-byte, and re-renders only the "Bugs &amp; Issues Logged" section of summary.md by
    /// reusing VisualTestTrackerSessionSyncService.AppendBugsSection — every field that section
    /// needs is already present in report.json's bugs[], so that regeneration is lossless. The
    /// other summary.md sections don't depend on lifecycle fields, so nothing there needs to move.
    /// Git staging/commit/push itself IS reused as-is via
    /// VisualTestTrackerSessionSyncService.StageCommitPushAsync, per the issue's own
    /// "reuse over duplication" instruction.
    /// </summary>
    public static class VisualTestTrackerReExportService
    {
        private const string BugsSectionStart = "## Bugs & Issues Logged (";
        private const string BugsSectionEnd = "## Console & Script Diagnostics";

        /// <summary>
        /// Runs one reconcile pass across every committed session under /Bugs (or /Bug) in
        /// repoRoot. Cheap no-op when nothing has drifted (one batched SELECT for every bug uuid
        /// referenced by any committed report.json). A session that fails to patch/commit logs and
        /// is simply retried on the next tick — nothing here blocks or retries in a loop itself.
        /// </summary>
        public static async Task<ReExportReconcileResult> ReconcileAsync(string repoRoot, VisualTestTrackerStore store)
        {
            var result = new ReExportReconcileResult();

            List<string> reportPaths;
            try
            {
                reportPaths = DiscoverReportJsonFiles(repoRoot);
            }
            catch (Exception ex)
            {
                result.Error = $"Could not enumerate session directories: {ex.Message}";
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"ReExport discovery failed: {ex.Message}");
                return result;
            }

            result.SessionsScanned = reportPaths.Count;
            if (reportPaths.Count == 0) return result;

            var sessions = new List<(string Path, JsonNode Root, JsonArray Bugs)>();
            var allUuids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var path in reportPaths)
            {
                try
                {
                    var node = JsonNode.Parse(File.ReadAllText(path));
                    if (node?["bugs"] is not JsonArray bugsArr) continue;
                    sessions.Add((path, node, bugsArr));
                    foreach (var b in bugsArr)
                    {
                        var uuid = b?["uuid"]?.GetValue<string>();
                        if (!string.IsNullOrWhiteSpace(uuid)) allUuids.Add(uuid);
                    }
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(VisualTestTrackerStore.Channel, $"ReExport: couldn't parse {path}: {ex.Message}");
                }
            }

            if (allUuids.Count == 0) return result;

            Dictionary<string, VisualTestTrackerStore.LifecycleSnapshot> live;
            try
            {
                live = await store.GetLifecycleSnapshotAsync(allUuids);
            }
            catch (Exception ex)
            {
                // Genuinely unreachable DB for this tick — report and stop (Git #2160's bounded-check
                // rule), rather than retry in a loop here. The next scheduled tick tries again.
                result.Error = $"Could not read live lifecycle state from Postgres: {ex.Message}";
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"ReExport: lifecycle read failed: {ex.Message}");
                return result;
            }

            if (live.Count == 0) return result;

            foreach (var (path, root, bugsArr) in sessions)
            {
                var changedUuids = new List<string>();

                foreach (var bugNode in bugsArr)
                {
                    if (bugNode is not JsonObject bug) continue;
                    var uuid = bug["uuid"]?.GetValue<string>();
                    if (string.IsNullOrWhiteSpace(uuid) || !live.TryGetValue(uuid, out var snap)) continue;

                    string curStatus = bug["status"]?.GetValue<string>() ?? "";
                    int? curGit = bug["gitIssueNumber"]?.GetValue<int?>();
                    string? curRes = bug["resolution"]?.GetValue<string>();
                    string? curReason = bug["resolutionReason"]?.GetValue<string>();

                    bool differs =
                        !string.Equals(curStatus, snap.Status, StringComparison.Ordinal) ||
                        curGit != snap.GitIssueNumber ||
                        !string.Equals(curRes, snap.Resolution, StringComparison.Ordinal) ||
                        !string.Equals(curReason, snap.ResolutionReason, StringComparison.Ordinal);

                    if (!differs) continue;

                    bug["status"] = snap.Status;
                    bug["gitIssueNumber"] = snap.GitIssueNumber;
                    bug["resolution"] = snap.Resolution;
                    bug["resolutionReason"] = snap.ResolutionReason;
                    changedUuids.Add(uuid);
                }

                if (changedUuids.Count == 0) continue;

                try
                {
                    await PatchSessionAsync(repoRoot, path, root, bugsArr, changedUuids);
                    result.SessionsUpdated++;
                    result.UpdatedSessionDirs.Add(Path.GetDirectoryName(path) ?? path);
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(VisualTestTrackerStore.Channel, $"ReExport: failed to patch/commit {path}: {ex.Message}");
                }
            }

            return result;
        }

        private static List<string> DiscoverReportJsonFiles(string repoRoot)
        {
            var found = new List<string>();
            foreach (var folder in new[] { "Bugs", "Bug" })
            {
                var dir = Path.Combine(repoRoot, folder);
                if (!Directory.Exists(dir)) continue;
                found.AddRange(Directory.EnumerateFiles(dir, "report.json", SearchOption.AllDirectories));
            }
            return found;
        }

        private static async Task PatchSessionAsync(string repoRoot, string reportJsonPath, JsonNode root, JsonArray bugsArr, List<string> changedUuids)
        {
            var opts = new JsonSerializerOptions { WriteIndented = true };
            File.WriteAllText(reportJsonPath, root.ToJsonString(opts));

            string sessionDir = Path.GetDirectoryName(reportJsonPath)!;
            PatchSummaryMarkdown(sessionDir, bugsArr);

            string relDir = Path.GetRelativePath(repoRoot, sessionDir).Replace('\\', '/');
            string sessionId = root["sessionId"]?.GetValue<string>() ?? Path.GetFileName(sessionDir);
            string productName = root["productName"]?.GetValue<string>() ?? "Unknown";
            string uuidList = string.Join(", ", changedUuids.Take(5)) + (changedUuids.Count > 5 ? ", …" : "");
            string commitMessage =
                $"QA Session {sessionId} – {productName}\n" +
                $"Re-export: lifecycle updated for {changedUuids.Count} bug(s) ({uuidList}).";

            var pushResult = await VisualTestTrackerSessionSyncService.StageCommitPushAsync(repoRoot, relDir, commitMessage, pushToRemote: true);
            if (!pushResult.Success)
            {
                throw new InvalidOperationException(pushResult.Error ?? "git stage/commit failed");
            }
            if (!pushResult.PushedToRemote)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"ReExport: committed {relDir} ({pushResult.CommitHash}) but push did not complete: {pushResult.PushOutput}");
            }
        }

        /// <summary>Re-renders just the "Bugs &amp; Issues Logged" section from the (already patched)
        /// report.json bugs[], and splices it into the committed summary.md between its two
        /// well-known static heading markers. Every field that section needs is already present in
        /// report.json, so this is a lossless regeneration of exactly the part that can be stale —
        /// unlike the rest of summary.md, which depends on session-level telemetry this reconcile
        /// pass never had. If the markers aren't found (a hand-edited or unexpected file), logs and
        /// leaves summary.md untouched rather than guessing at a splice point — report.json stays
        /// the authoritative artifact either way.</summary>
        private static void PatchSummaryMarkdown(string sessionDir, JsonArray bugsArr)
        {
            string summaryPath = Path.Combine(sessionDir, "summary.md");
            if (!File.Exists(summaryPath)) return;

            var entries = new List<VisualTestTrackerEntry>();
            foreach (var bugNode in bugsArr)
            {
                if (bugNode is not JsonObject bug) continue;
                entries.Add(new VisualTestTrackerEntry
                {
                    Title = bug["title"]?.GetValue<string>() ?? "",
                    Notes = bug["notes"]?.GetValue<string>() ?? "",
                    Severity = bug["severity"]?.GetValue<string>() ?? "Bug",
                    Status = bug["status"]?.GetValue<string>() ?? "Open",
                    StepsToReproduce = bug["stepsToReproduce"]?.GetValue<string>() ?? "",
                    ExpectedBehavior = bug["expectedBehavior"]?.GetValue<string>() ?? "",
                    ActualBehavior = bug["actualBehavior"]?.GetValue<string>() ?? "",
                    CurrentUrl = bug["url"]?.GetValue<string>() ?? "",
                    Tags = bug["tags"] is JsonArray tagsArr
                        ? tagsArr.Select(t => t?.GetValue<string>() ?? "").ToList()
                        : new List<string>(),
                    ScreenshotPaths = bug["screenshots"] is JsonArray shotsArr
                        ? shotsArr.Select(s => s?.GetValue<string>() ?? "").ToList()
                        : new List<string>(),
                });
            }

            var sb = new StringBuilder();
            VisualTestTrackerSessionSyncService.AppendBugsSection(sb, entries);
            string freshSection = sb.ToString();

            string original = File.ReadAllText(summaryPath);
            int startIdx = original.IndexOf(BugsSectionStart, StringComparison.Ordinal);
            int endIdx = original.IndexOf(BugsSectionEnd, StringComparison.Ordinal);
            if (startIdx < 0 || endIdx <= startIdx)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel,
                    $"ReExport: couldn't locate bugs-section markers in {summaryPath}; left summary.md untouched (report.json is still authoritative).");
                return;
            }

            string patched = original.Substring(0, startIdx) + freshSection + original.Substring(endIdx);
            File.WriteAllText(summaryPath, patched);
        }
    }
}
