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
    /// Durable spillover for Queue clicks made while a version Update was pending.
    ///
    /// Git #1934 — the auto-Update button no longer blocks/defers behind the Build
    /// Queue (that block-and-wait, #1370, was reversed once #1804's durable-file
    /// redirect + pid-adoption made in-flight builds survive the deploy restart). So
    /// there is no longer a "pending window" during which a Queue click is intercepted
    /// and written here: while the app is alive a Queue click writes straight to
    /// durable Postgres and survives the restart on its own, and once
    /// deploy-shanesbuild.cmd force-stops the app there is no live UI to click. The
    /// WRITE side of this feature is therefore retired.
    ///
    /// What remains is purely a one-way SAFETY NET across the reversal itself:
    /// <see cref="ReplayPersistedQueueRequestsOnLaunchAsync"/> still runs on every
    /// launch and DRAINS any spillover file a prior (pre-#1934) blocking build left on
    /// disk — re-queuing each saved request through the real queue API so nothing that
    /// was persisted before this shipped is silently lost. In steady state the file no
    /// longer exists and this is a cheap no-op. BuildQueuePanel's "Queued for Restart"
    /// group likewise just surfaces any such leftover until it drains.
    ///
    /// The original persisted shape and durable-diagnostics machinery are kept intact
    /// so a leftover file written by the old code still parses and replays correctly.
    ///
    /// Durability (2026-08-14 fix — the "restarted but nothing queued" bug):
    /// the relaunch fires the re-queue POSTs in the first moments of launch, when the
    /// dev api-server is very often still cold (it auto-sleeps ~every 15 min). The
    /// original code deleted the spillover file UNCONDITIONALLY right after the replay
    /// attempt, so a POST that failed against a sleeping server silently discarded the
    /// build forever — exactly the reported symptom. Now a request is only removed
    /// from the file once it has genuinely queued (a 2xx); anything that didn't queue
    /// is kept in the file so the NEXT launch retries it automatically, and each launch
    /// also does a small bounded retry to give a cold-starting server a chance to wake
    /// on this very launch.
    ///
    /// Diagnosability: <see cref="ActivityLog"/> is in-memory only (rendered to a panel,
    /// wiped on every restart), so a past failure left no forensic trail — which is why
    /// this recurrence needed a fresh live bug report. Every launch now ALSO writes a
    /// durable, append-only diagnostic line to <see cref="PendingUpdateQueueLogFile"/>
    /// (next to the JSON, under %AppData%\BuildConsole\): whether the file was found,
    /// its raw contents, each item's real HTTP outcome, and the final keep-or-delete
    /// decision. A future recurrence is diagnosable straight from that file.
    ///
    /// Logs to the same "version-update" ActivityLog channel
    /// (<see cref="MainWindow.VersionChannel"/>) as the rest of the pending-update
    /// feature this extends, in addition to the durable file log.
    /// </summary>
    public partial class MainWindow
    {
        private static readonly string PendingUpdateQueueFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BuildConsole", "pending-update-queue.json");

        /// <summary>
        /// Durable, append-only diagnostic log for the pending-update spillover feature,
        /// sitting next to the JSON under %AppData%\BuildConsole\. Unlike
        /// <see cref="ActivityLog"/> (in-memory, wiped every restart) this SURVIVES the
        /// deploy restart, so the write→restart→replay sequence — and any silent
        /// re-queue failure — is reconstructable after the fact without a live repro.
        /// </summary>
        private static readonly string PendingUpdateQueueLogFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BuildConsole", "pending-update-queue.log");

        // Serializes best-effort appends to the durable diag log (the write side runs on
        // the UI thread during a pending window; the replay runs on a launch background
        // continuation — they can in principle overlap).
        private static readonly object PendingUpdateQueueLogLock = new();

        // On relaunch the dev api-server is frequently still cold. Give it a few short
        // attempts to wake before giving up on THIS launch — anything still not queued
        // stays persisted for the next launch to retry, so nothing is ever lost.
        private const int ReplayMaxAttemptsPerItem = 3;
        private const int ReplayRetryDelayMs = 4000;

        /// <summary>
        /// Mirrors <see cref="Services.BuildQueuePostgresClient.QueueBuildAsync"/>'s
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
            public string? ChatUrl { get; set; }
            public string? OriginatingChatId { get; set; }
            public string? BuildSet { get; set; }
            public string? Cli { get; set; }
            /// <summary>Git #1416 — the chosen Claude account ("secondary" = overflow Pro; null/"primary" = default). Preserved across the update restart so a persisted request re-queues against the same account.</summary>
            public string? Account { get; set; }
        }

        /// <summary>
        /// Appends a single timestamped line to the durable spillover diagnostic log.
        /// Best-effort — never throws, never blocks launch on an IO error. Also mirrors
        /// to the live "version-update" ActivityLog panel when a channel is given.
        /// </summary>
        private static void PendingUpdateQueueDiag(string message, string? mirrorChannel = VersionChannel)
        {
            if (mirrorChannel != null)
                ActivityLog.Log(mirrorChannel, message);
            try
            {
                lock (PendingUpdateQueueLogLock)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(PendingUpdateQueueLogFile)!);
                    File.AppendAllText(PendingUpdateQueueLogFile,
                        $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}{Environment.NewLine}");
                }
            }
            catch { /* durable log is best-effort; a failed append must never wedge the app */ }
        }

        /// <summary>
        /// Called by <see cref="Controls.BuildQueuePanel"/> each time it actually
        /// (re)renders the "Queued for Restart" group with a changed item set, so the
        /// durable spillover log carries a real UI-refresh timestamp for any leftover
        /// pre-#1934 spillover items still surfacing there before they drain. Durable
        /// across the deploy restart (unlike <see cref="ActivityLog"/>, which is
        /// in-memory only). Durable-log only (mirrorChannel null): a render line can fire
        /// on any queue poll, so it must not spam the live version-update panel.
        /// </summary>
        public static void LogQueuedForRestartRender(int renderedCount) =>
            PendingUpdateQueueDiag(
                $"UI refresh — BuildQueuePanel rendered the \"Queued for Restart\" group with {renderedCount} item(s).",
                mirrorChannel: null);

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

        /// <summary>Serializes the spillover list back to disk (creating the folder if needed).</summary>
        private static void SavePersistedQueueRequests(List<PersistedQueueRequest> requests)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(PendingUpdateQueueFile)!);
            File.WriteAllText(PendingUpdateQueueFile, JsonSerializer.Serialize(requests));
        }

        /// <summary>
        /// Fired once on launch (fire-and-forget from the constructor). If a spillover
        /// file survived a pending-update deploy restart, re-queue each saved request
        /// through the real queue API — exactly as a live Queue click would. A request
        /// is removed from the file ONLY once it genuinely queues (a 2xx); anything that
        /// didn't queue (server cold/unreachable, or a non-2xx) is KEPT so the next
        /// launch retries it automatically — nothing is ever silently discarded.
        /// </summary>
        private async Task ReplayPersistedQueueRequestsOnLaunchAsync()
        {
            if (!File.Exists(PendingUpdateQueueFile))
            {
                // Routine no-op on nearly every launch — durable log only, don't spam
                // the live panel.
                PendingUpdateQueueDiag(
                    $"Launch check: no pending-update spillover file at {PendingUpdateQueueFile} — nothing to re-queue.",
                    mirrorChannel: null);
                return;
            }

            // Capture the raw bytes on disk BEFORE parsing, so the durable log records
            // exactly what was found even if it later fails to deserialize.
            string rawContents;
            try { rawContents = File.ReadAllText(PendingUpdateQueueFile); }
            catch (Exception ex) { rawContents = $"<unreadable: {ex.Message}>"; }

            var pending = LoadPersistedQueueRequests();
            PendingUpdateQueueDiag(
                $"Launch check: FOUND spillover file at {PendingUpdateQueueFile} — parsed {pending.Count} request(s). Raw contents: {rawContents}");

            if (pending.Count == 0)
            {
                // Either a genuinely-empty array or an unparseable/corrupt file (both
                // surface as 0 here). Nothing to replay — clear it so it can't linger;
                // the raw contents above are preserved in the durable log.
                PendingUpdateQueueDiag(
                    "Spillover file parsed to 0 request(s) (empty or corrupt) — deleting it; nothing to re-queue.");
                TryDeletePendingUpdateQueueFile();
                return;
            }

            if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured)
            {
                // Not connected yet (no Build Tracker config) — leave the file in place
                // so a later, configured launch can still pick it up rather than
                // silently dropping the requests.
                PendingUpdateQueueDiag(
                    $"Found {pending.Count} persisted Queue request(s) from a pending-update restart, but the queue API isn't configured — leaving them saved for a connected launch.");
                return;
            }

            PendingUpdateQueueDiag(
                $"Picking up {pending.Count} persisted Queue request(s) saved during a pending update — re-queuing now, as if just clicked.");

            // Anything that DOESN'T successfully queue this launch is retained and
            // written back, so the next launch retries it. Nothing is dropped on a
            // failed POST (the original unconditional-delete bug).
            var stillPending = new List<PersistedQueueRequest>();

            foreach (var req in pending)
            {
                bool queued = await TryReplayOneAsync(req);
                if (!queued) stillPending.Add(req);
            }

            if (stillPending.Count == 0)
            {
                TryDeletePendingUpdateQueueFile();
                PendingUpdateQueueDiag(
                    "All persisted Queue request(s) re-queued successfully — spillover file deleted.");
                // Surface the restart outcome to Shane through the app's own toast engine (the
                // pending-update-on-restart notice) rather than leaving it buried in the diag log.
                ToastEngine.Success("Builds re-queued",
                    $"{pending.Count} build request(s) saved during the last update were automatically re-queued after the restart.");
            }
            else
            {
                try
                {
                    SavePersistedQueueRequests(stillPending);
                    PendingUpdateQueueDiag(
                        $"{stillPending.Count} of {pending.Count} request(s) did NOT queue this launch (server cold/unreachable?) — " +
                        $"KEPT in the spillover file so the next launch retries them automatically. " +
                        $"Titles kept: {string.Join(", ", stillPending.Select(r => $"\"{r.Title}\""))}");
                    ToastEngine.Warning("Builds re-queued",
                        $"{pending.Count - stillPending.Count} of {pending.Count} saved build request(s) re-queued after the restart; " +
                        $"{stillPending.Count} will retry on the next launch (the server may still be waking up).");
                }
                catch (Exception ex)
                {
                    // Couldn't rewrite the trimmed file — leave the ORIGINAL file entirely
                    // in place (do NOT delete) so nothing is lost; the successfully-queued
                    // ones may re-queue again next launch (a harmless duplicate is far
                    // better than a silently-dropped build).
                    PendingUpdateQueueDiag(
                        $"FAILED to rewrite the spillover file with {stillPending.Count} still-pending request(s): {ex.Message}. " +
                        "Leaving the original file intact so nothing is lost (may re-queue a duplicate next launch).");
                }
            }

            try { await BuildQueuePanel.RefreshAsync(); } catch { /* best-effort visual refresh */ }
        }

        /// <summary>
        /// Attempts to re-queue a single persisted request, with a small bounded retry
        /// to let a cold-starting dev api-server wake on this very launch. Returns true
        /// only if it genuinely queued (a 2xx). Every attempt's real outcome — HTTP
        /// status/body or exception — is written to the durable diagnostic log.
        /// </summary>
        private async Task<bool> TryReplayOneAsync(PersistedQueueRequest req)
        {
            if (_queueDb == null)
            {
                PendingUpdateQueueDiag(
                    $"Couldn't re-queue \"{req.Title}\" — no direct Postgres connection (DATABASE_URL not found). Keeping it persisted for the next launch.");
                return false;
            }

            for (int attempt = 1; attempt <= ReplayMaxAttemptsPerItem; attempt++)
            {
                try
                {
                    await _queueDb.QueueBuildAsync(
                        req.Title, req.Prompt, req.Model, req.Effort, req.Cwd, req.GithubNumber, req.BlockedByNumbers, chatUrl: req.ChatUrl, originatingChatId: req.OriginatingChatId, buildSet: req.BuildSet, cli: req.Cli, account: req.Account);
                    PendingUpdateQueueDiag(
                        $"Re-queued persisted request \"{req.Title}\" after the update restart (attempt {attempt}/{ReplayMaxAttemptsPerItem}, direct Postgres).");
                    return true;
                }
                catch (Exception ex)
                {
                    PendingUpdateQueueDiag(
                        $"Re-queue of \"{req.Title}\" threw (attempt {attempt}/{ReplayMaxAttemptsPerItem}) — DB likely unreachable: {ex.Message}");
                }

                if (attempt < ReplayMaxAttemptsPerItem)
                    await Task.Delay(ReplayRetryDelayMs);
            }

            PendingUpdateQueueDiag(
                $"Gave up re-queuing \"{req.Title}\" this launch after {ReplayMaxAttemptsPerItem} attempt(s) — keeping it persisted for the next launch.");
            return false;
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
