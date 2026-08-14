using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Durable spillover for Queue clicks made while a version Update is pending.
    ///
    /// The auto-Update button (see <see cref="MainWindow"/> in
    /// MainWindow.VersionUpdate.cs) defers its deploy until the Build Queue drains,
    /// then shells out to deploy-shanesbuild.cmd — which stops and relaunches THIS
    /// whole process. A build request queued during that waiting window
    /// (BT_QUEUE_BUILD → <see cref="Services.BuildTrackerApiClient.QueueBuildAsync"/>)
    /// is, until the server round-trip returns, only ever an in-flight HTTP POST and
    /// an in-memory panel row — nothing durable on this machine. If the restart lands
    /// first, that request is simply lost. Shane hit exactly this: clicking Queue
    /// while an update sat waiting.
    ///
    /// So while <c>_updatePending</c> is set, we do NOT touch the live/in-memory
    /// queue for a new Queue click. Instead we serialize the exact QueueBuildAsync
    /// argument list to a tiny local JSON file under %AppData%\BuildConsole\ (the
    /// same store settings/cache already use), which survives the restart. On the
    /// next launch — after the Build Tracker client is reconnected and the panels
    /// have initialized normally — <see cref="ReplayPersistedQueueRequestsOnLaunchAsync"/>
    /// reads that file and re-queues each saved request through the real queue API,
    /// exactly as if Shane had just clicked Queue, then deletes the file so it can
    /// never re-apply on a later launch.
    ///
    /// Multiple Queue clicks during a single pending window all survive: the file
    /// holds an array and each interception appends to it.
    ///
    /// Logs to the same "version-update" ActivityLog channel
    /// (<see cref="MainWindow.VersionChannel"/>) as the rest of the pending-update
    /// feature this extends.
    /// </summary>
    public partial class MainWindow
    {
        private static readonly string PendingUpdateQueueFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BuildConsole", "pending-update-queue.json");

        /// <summary>
        /// Mirrors <see cref="Services.BuildTrackerApiClient.QueueBuildAsync"/>'s
        /// argument list exactly, so a request replayed on next launch is byte-for-byte
        /// the same call a live Queue click would have made.
        /// </summary>
        private sealed class PersistedQueueRequest
        {
            public string Title { get; set; } = "Untitled";
            public string Prompt { get; set; } = "";
            public string? Model { get; set; }
            public string? Effort { get; set; }
            public string? Cwd { get; set; }
            public int? GithubNumber { get; set; }
            public List<int>? BlockedByNumbers { get; set; }
        }

        /// <summary>
        /// Called from the BT_QUEUE_BUILD handler while <c>_updatePending</c> is set,
        /// in place of hitting the live queue. Appends the request to the on-disk
        /// spillover file (so several Queue clicks during the wait all survive) rather
        /// than adding it to the in-memory/live queue that the imminent deploy restart
        /// would drop. Returns true on a successful persist, false if the write failed.
        /// </summary>
        private bool PersistQueueRequestDuringPendingUpdate(
            string title, string prompt, string? model, string? effort, string? cwd,
            int? githubNumber, List<int>? blockedByNumbers)
        {
            var pending = LoadPersistedQueueRequests();
            pending.Add(new PersistedQueueRequest
            {
                Title = title,
                Prompt = prompt,
                Model = model,
                Effort = effort,
                Cwd = cwd,
                GithubNumber = githubNumber,
                BlockedByNumbers = blockedByNumbers,
            });

            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(PendingUpdateQueueFile)!);
                File.WriteAllText(PendingUpdateQueueFile, JsonSerializer.Serialize(pending));
                ActivityLog.Log(VersionChannel,
                    $"Update pending — intercepted Queue request \"{title}\" and persisted it to {PendingUpdateQueueFile} " +
                    $"instead of the live queue; it will auto-requeue after the deploy restart ({pending.Count} now saved).");
                return true;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VersionChannel,
                    $"FAILED to persist intercepted Queue request \"{title}\": {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Lightweight, read-only view of a persisted spillover entry for display
        /// purposes only — deliberately drops Prompt/Model/Effort/Cwd/BlockedByNumbers,
        /// which the Build Queue panel's "Queued for Restart" group has no use for and
        /// which <see cref="PersistedQueueRequest"/> keeps private to this file.
        /// </summary>
        public sealed class PersistedQueueDisplayItem
        {
            public string Title { get; set; } = "Untitled";
            public int? GithubNumber { get; set; }
        }

        /// <summary>
        /// Read-only snapshot of whatever's currently sitting in the pending-update
        /// spillover file, for BuildQueuePanel's "Queued for Restart" tree group —
        /// these items are intercepted-and-persisted, NOT in the real live queue, so
        /// the panel renders them as a visually distinct group rather than mixing them
        /// into the normal active/pending/running rows. Safe to call anytime (never
        /// throws, returns empty on a missing/corrupt file — see LoadPersistedQueueRequests).
        /// </summary>
        public static List<PersistedQueueDisplayItem> GetPersistedQueueDisplayItems() =>
            LoadPersistedQueueRequests()
                .Select(r => new PersistedQueueDisplayItem { Title = r.Title, GithubNumber = r.GithubNumber })
                .ToList();

        private static List<PersistedQueueRequest> LoadPersistedQueueRequests()
        {
            try
            {
                if (!File.Exists(PendingUpdateQueueFile)) return new();
                return JsonSerializer.Deserialize<List<PersistedQueueRequest>>(File.ReadAllText(PendingUpdateQueueFile))
                    ?? new();
            }
            catch
            {
                // A corrupt/half-written file shouldn't wedge launch — treat it as empty.
                return new();
            }
        }

        /// <summary>
        /// Fired once on launch (fire-and-forget from the constructor). If a spillover
        /// file survived a pending-update deploy restart, re-queue each saved request
        /// through the real queue API — exactly as a live Queue click would — then
        /// delete the file so it can't replay again on a future launch.
        /// </summary>
        private async Task ReplayPersistedQueueRequestsOnLaunchAsync()
        {
            if (!File.Exists(PendingUpdateQueueFile)) return;

            var pending = LoadPersistedQueueRequests();
            if (pending.Count == 0)
            {
                TryDeletePendingUpdateQueueFile();
                return;
            }

            if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured)
            {
                // Not connected yet (no Build Tracker config) — leave the file in place
                // so a later, configured launch can still pick it up rather than
                // silently dropping the requests.
                ActivityLog.Log(VersionChannel,
                    $"Found {pending.Count} persisted Queue request(s) from a pending-update restart, but the queue API isn't configured — leaving them saved for a connected launch.");
                return;
            }

            ActivityLog.Log(VersionChannel,
                $"Picking up {pending.Count} persisted Queue request(s) saved during a pending update — re-queuing now, as if just clicked.");

            foreach (var req in pending)
            {
                try
                {
                    var res = await _buildTrackerApi.QueueBuildAsync(
                        req.Title, req.Prompt, req.Model, req.Effort, req.Cwd, req.GithubNumber, req.BlockedByNumbers);
                    if (res.IsSuccessStatusCode)
                    {
                        ActivityLog.Log(VersionChannel, $"Re-queued persisted request \"{req.Title}\" after the update restart.");
                    }
                    else
                    {
                        var body = await res.Content.ReadAsStringAsync();
                        ActivityLog.Log(VersionChannel, $"FAILED to re-queue persisted request \"{req.Title}\": {body}");
                    }
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(VersionChannel, $"FAILED to re-queue persisted request \"{req.Title}\": {ex.Message}");
                }
            }

            // Delete regardless of individual outcomes — this file is a one-shot
            // spillover. A request that genuinely failed to POST is logged above (Shane
            // can re-issue it, same as a live Queue click that errored), but we never
            // want the file replaying itself on a future launch.
            TryDeletePendingUpdateQueueFile();
            try { await BuildQueuePanel.RefreshAsync(); } catch { /* best-effort visual refresh */ }
        }

        private static void TryDeletePendingUpdateQueueFile()
        {
            try
            {
                if (File.Exists(PendingUpdateQueueFile)) File.Delete(PendingUpdateQueueFile);
            }
            catch { /* best-effort */ }
        }
    }
}
