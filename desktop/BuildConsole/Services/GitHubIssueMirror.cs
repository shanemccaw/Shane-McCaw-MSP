using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Npgsql;
using NpgsqlTypes;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3113 — a real, local, persistent mirror of the GitHub issue state that routine
    /// reads actually need (title, open/closed state, board Status column, blocked-by/blocking
    /// relationships), refreshed by ONE periodic, BATCHED GraphQL sync rather than by firing a
    /// separate <c>gh issue view #N</c> / per-issue board-status GraphQL call for every number
    /// on every refresh.
    ///
    /// This is Shane's own architectural redirect (2026-09-07) and the real root fix for the
    /// recurring 5-day rate-limit cycle: every previous fix (#2890 bounded concurrency, #3073
    /// shared semaphore, #3022 cross-subsystem stagger) correctly SLOWED a fundamentally
    /// request-per-issue pattern, but GitHub's secondary rate limit is sensitive to request
    /// FREQUENCY, so no amount of throttling a request-heavy pattern fully escapes it. Reading
    /// routine data from this local table means those reads never touch GitHub's API budget at
    /// all.
    ///
    /// ── What reads here vs. what stays LIVE (the #3113 audit) ─────────────────────────────
    /// Redirected to this mirror (routine, non-authoritative, tolerant of a few minutes' lag):
    ///   • <see cref="GitHubIssuesService.GetIssueTitleAsync"/> — the issue-title warm-up, the
    ///     single biggest per-issue <c>gh issue view</c> offender. Mirror-first; a genuine miss
    ///     falls back to the live CLI and self-populates this table.
    ///   • <see cref="ChatDockService"/> — the Floating Chat Window side dock's per-mentioned-issue
    ///     title + board-status + blocked-by chain enrichment (pure display).
    ///   • <see cref="BuildQueuePostgresClient.ReconcileQueueAgainstBoardAsync"/>'s BACKGROUND
    ///     Verifying-row board reconcile (reversible, self-healing).
    /// DELIBERATELY still LIVE (a stale mirror reading could be genuinely unsafe):
    ///   • The fail-closed dispatch/blocker gate (GetNextAsync / TryGetOpenIssueNumbersAsync) —
    ///     verifying a blocker is ACTUALLY closed immediately before launching a build.
    ///   • ReconcileQueueAgainstBoardAsync's SCOPED queued reconcile — confirming a board move
    ///     Shane just made on the Build Chain Map took effect.
    ///   • Every state-changing GitHub write.
    ///
    /// Every mirror read is wrapped so that ANY failure (unresolved DB, table not migrated, a
    /// query error) falls through to the caller's existing live path — this change can never make
    /// a read worse than it is today, only cheaper on the common hit.
    /// </summary>
    public static class GitHubIssueMirror
    {
        /// <summary>How stale the mirror may get before <see cref="MaybeSyncAsync"/> refreshes it.
        /// A full sync is ~40 batched GraphQL requests (one issues walk + one board-status sweep),
        /// spread and low-concurrency — trivial next to the hundreds of per-issue calls it replaces.
        /// Self-gated on the persisted <c>last_full_sync_at</c> so it survives restarts.</summary>
        public static readonly TimeSpan SyncInterval = TimeSpan.FromMinutes(5);

        /// <summary>Runaway guard on the per-blocked-issue <c>blocked_by</c> fetch during a sync
        /// (the one part of the sync that is still per-issue REST). Only issues carrying the
        /// <c>blocked</c> label are ever fetched — normally a handful — and this caps a pathological
        /// case rather than letting the sync itself become a mini-storm.</summary>
        private const int MaxBlockedByFetchesPerSync = 200;

        private static string? _connString;
        private static readonly object _connLock = new();

        /// <summary>0 = no sync running, 1 = a sync is in flight. Prevents overlapping syncs when a
        /// slow sync spans more than one watcher tick.</summary>
        private static int _syncing;

        /// <summary>In-memory time of the last sync ATTEMPT (success or failure). A failed sync does
        /// NOT advance the persisted <c>last_full_sync_at</c> (so the mirror is never falsely reported
        /// as populated), which would otherwise let <see cref="MaybeSyncAsync"/> re-attempt on every
        /// ~10s watcher tick while GitHub is down; this backs that off to once per
        /// <see cref="FailedAttemptBackoff"/>.</summary>
        private static DateTime _lastAttemptUtc = DateTime.MinValue;
        private static readonly TimeSpan FailedAttemptBackoff = TimeSpan.FromSeconds(60);

        private static string? ConnString()
        {
            lock (_connLock)
            {
                if (!string.IsNullOrEmpty(_connString)) return _connString;
                var raw = BuildQueuePostgresClient.TryResolveConnectionString(
                    BuildTrackerConfig.Load(), BuildTrackerConfig.FindRepoRoot());
                if (string.IsNullOrWhiteSpace(raw)) return null;
                _connString = BuildQueuePostgresClient.ParseConnectionString(raw!);
                return _connString;
            }
        }

        private static async Task<NpgsqlConnection?> TryOpenAsync()
        {
            var cs = ConnString();
            if (cs == null) return null;
            var conn = new NpgsqlConnection(cs);
            await conn.OpenAsync();
            return conn;
        }

        // ── Read model ───────────────────────────────────────────────────────────────────────
        public sealed class MirrorIssue
        {
            public int Number { get; init; }
            public string Title { get; init; } = "";
            /// <summary>"open" | "closed" — GitHub's real issue state (never a label).</summary>
            public string State { get; init; } = "open";
            public string? BoardStatusOptionId { get; init; }
            public string? BoardStatusName { get; init; }
            public List<string> Labels { get; init; } = new();
            public List<int> BlockedByNumbers { get; init; } = new();
            public List<int> BlockingNumbers { get; init; } = new();
            public string HtmlUrl { get; init; } = "";
            public DateTime LastSyncedAt { get; init; }

            public bool IsOpen => string.Equals(State, "open", StringComparison.OrdinalIgnoreCase);
            public bool IsClosed => string.Equals(State, "closed", StringComparison.OrdinalIgnoreCase);
        }

        private static MirrorIssue MapRow(NpgsqlDataReader r) => new()
        {
            Number = r.GetInt32(0),
            Title = r.IsDBNull(1) ? "" : r.GetString(1),
            State = r.IsDBNull(2) ? "open" : r.GetString(2),
            BoardStatusOptionId = r.IsDBNull(3) ? null : r.GetString(3),
            BoardStatusName = r.IsDBNull(4) ? null : r.GetString(4),
            Labels = r.IsDBNull(5) ? new List<string>() : r.GetFieldValue<string[]>(5).ToList(),
            BlockedByNumbers = r.IsDBNull(6) ? new List<int>() : r.GetFieldValue<int[]>(6).ToList(),
            BlockingNumbers = r.IsDBNull(7) ? new List<int>() : r.GetFieldValue<int[]>(7).ToList(),
            HtmlUrl = r.IsDBNull(8) ? "" : r.GetString(8),
            LastSyncedAt = r.IsDBNull(9) ? DateTime.MinValue : r.GetFieldValue<DateTime>(9),
        };

        private const string SelectColumns =
            "issue_number, title, state, board_status_option_id, board_status_name, " +
            "labels, blocked_by_numbers, blocking_numbers, html_url, last_synced_at";

        /// <summary>One issue's mirrored row, or null on a miss OR on any error (caller falls back to live).</summary>
        public static async Task<MirrorIssue?> TryGetAsync(int number)
        {
            if (number <= 0) return null;
            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null) return null;
                await using var cmd = new NpgsqlCommand(
                    $"SELECT {SelectColumns} FROM bt_issue_mirror WHERE issue_number = @n", conn);
                cmd.Parameters.AddWithValue("@n", number);
                await using var reader = await cmd.ExecuteReaderAsync();
                return await reader.ReadAsync() ? MapRow(reader) : null;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"TryGetAsync(#{number}) failed ({ex.Message}) — caller falls back to live.");
                return null;
            }
        }

        /// <summary>Every requested number that has a mirrored row, keyed by number. Numbers with no
        /// row (or on any error) are simply absent — the caller treats an absence as a live/unknown
        /// case, never as authoritative "does not exist".</summary>
        public static async Task<Dictionary<int, MirrorIssue>> GetManyAsync(IReadOnlyCollection<int> numbers)
        {
            var result = new Dictionary<int, MirrorIssue>();
            if (numbers == null || numbers.Count == 0) return result;
            var distinct = numbers.Where(n => n > 0).Distinct().ToArray();
            if (distinct.Length == 0) return result;
            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null) return result;
                await using var cmd = new NpgsqlCommand(
                    $"SELECT {SelectColumns} FROM bt_issue_mirror WHERE issue_number = ANY(@nums)", conn);
                cmd.Parameters.AddWithValue("@nums", NpgsqlDbType.Array | NpgsqlDbType.Integer, distinct);
                await using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    var row = MapRow(reader);
                    result[row.Number] = row;
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"GetManyAsync({distinct.Length} numbers) failed ({ex.Message}) — caller falls back to live.");
            }
            return result;
        }

        /// <summary>The mirrored title, or null on a miss/empty/error (caller falls back to a live
        /// <c>gh issue view</c> and then self-populates via <see cref="UpsertTitleOnFallbackAsync"/>).</summary>
        public static async Task<string?> TryGetTitleAsync(int number)
        {
            if (number <= 0) return null;
            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null) return null;
                await using var cmd = new NpgsqlCommand(
                    "SELECT title FROM bt_issue_mirror WHERE issue_number = @n", conn);
                cmd.Parameters.AddWithValue("@n", number);
                var val = await cmd.ExecuteScalarAsync();
                var title = val as string;
                return string.IsNullOrWhiteSpace(title) ? null : title;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"TryGetTitleAsync(#{number}) failed ({ex.Message}) — caller falls back to live.");
                return null;
            }
        }

        /// <summary>
        /// Git #3113 — self-population from a live-fallback title fetch: when a routine title read
        /// missed the mirror and fell back to a live <c>gh issue view</c>, record the fetched title
        /// here so the NEXT read of that number is a free local hit. Touches ONLY the title (a bare
        /// insert defaults state='open'); it never clobbers a board status / labels / relationships a
        /// full sync may already have set. Best-effort — a failure is logged and swallowed (the live
        /// title the caller already has is unaffected).
        /// </summary>
        public static async Task UpsertTitleOnFallbackAsync(int number, string title)
        {
            if (number <= 0 || string.IsNullOrWhiteSpace(title)) return;
            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null) return;
                await using var cmd = new NpgsqlCommand(@"
                    INSERT INTO bt_issue_mirror (issue_number, title, last_synced_at, updated_at)
                    VALUES (@n, @t, NOW(), NOW())
                    ON CONFLICT (issue_number) DO UPDATE
                       SET title = EXCLUDED.title, updated_at = NOW()", conn);
                cmd.Parameters.AddWithValue("@n", number);
                cmd.Parameters.AddWithValue("@t", title);
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"UpsertTitleOnFallbackAsync(#{number}) failed ({ex.Message}) — non-fatal, the live title is unaffected.");
            }
        }

        /// <summary>The persisted sync bookkeeping: when the last full sync completed, whether it
        /// succeeded, and a short note. All null/false before the first ever sync.</summary>
        public static async Task<(DateTime? LastFullSyncAt, bool Ok, string? Note)> GetSyncStateAsync()
        {
            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null) return (null, false, "db unavailable");
                await using var cmd = new NpgsqlCommand(
                    "SELECT last_full_sync_at, last_sync_ok, last_sync_note FROM bt_issue_mirror_sync_state WHERE id = 1", conn);
                await using var reader = await cmd.ExecuteReaderAsync();
                if (!await reader.ReadAsync()) return (null, false, "no sync-state row");
                DateTime? at = reader.IsDBNull(0) ? null : reader.GetFieldValue<DateTime>(0);
                bool ok = !reader.IsDBNull(1) && reader.GetBoolean(1);
                string? note = reader.IsDBNull(2) ? null : reader.GetString(2);
                return (at, ok, note);
            }
            catch (Exception ex)
            {
                return (null, false, ex.Message);
            }
        }

        /// <summary>True once the mirror has completed at least one full sync — i.e. its rows are a
        /// real reflection of GitHub, not an empty/never-populated table. Callers that need
        /// fail-closed semantics (the chat dock) use this to decide whether a miss means "closed /
        /// not-relevant" or "unknown, keep it".</summary>
        public static async Task<bool> HasUsableDataAsync()
        {
            var (at, _, _) = await GetSyncStateAsync();
            return at != null;
        }

        // ── Sync ───────────────────────────────────────────────────────────────────────────────

        public sealed class SyncSummary
        {
            public bool Ok { get; set; }
            public int OpenIssues { get; set; }
            public int BoardStatuses { get; set; }
            public int BlockedByFetched { get; set; }
            public int MarkedClosed { get; set; }
            public long ElapsedMs { get; set; }
            public string? Error { get; set; }
        }

        /// <summary>
        /// Runs a full sync only if the mirror is older than <see cref="SyncInterval"/> (or has never
        /// synced), and only if a sync isn't already in flight. Self-gates on the persisted
        /// <c>last_full_sync_at</c>, so it does the right thing across BuildConsole restarts and no
        /// matter how often the watcher tick calls it. <paramref name="force"/> bypasses the interval
        /// (a manual refresh). Returns null when it decided not to sync this call.
        /// </summary>
        public static async Task<SyncSummary?> MaybeSyncAsync(GitHubApiClient gh, bool force = false)
        {
            if (gh == null) return null;

            if (!force)
            {
                // last_full_sync_at only advances on a SUCCESSFUL sync, so this gate says "we have a
                // recent SUCCESS" — a failed sync leaves it stale and this returns false → eligible.
                var (lastAt, _, _) = await GetSyncStateAsync();
                if (lastAt != null && DateTime.UtcNow - lastAt.Value.ToUniversalTime() < SyncInterval)
                    return null; // still fresh enough

                // Back off failed attempts so a persistently-unreachable GitHub isn't re-hit every tick.
                if (DateTime.UtcNow - _lastAttemptUtc < FailedAttemptBackoff)
                    return null;
            }

            // Single-flight: never let two syncs overlap.
            if (Interlocked.CompareExchange(ref _syncing, 1, 0) != 0) return null;
            try
            {
                _lastAttemptUtc = DateTime.UtcNow;
                return await SyncAsync(gh);
            }
            finally
            {
                Interlocked.Exchange(ref _syncing, 0);
            }
        }

        /// <summary>
        /// The real batched sync/diff. In as few GitHub requests as possible:
        ///   1. ONE paginated GraphQL issues walk (<see cref="GitHubApiClient.ListBoardIssuesAsync"/>)
        ///      → every OPEN issue's number/title/state/labels/url/timestamps.
        ///   2. ONE paginated project-items sweep (<see cref="GitHubApiClient.GetAllIssueBoardStatusesAsync"/>)
        ///      → every issue's current board Status option id + name.
        ///   3. blocked_by only for issues carrying the <c>blocked</c> label (a handful), inverted to
        ///      derive the <c>blocking</c> direction — no per-issue call for the thousands that aren't.
        /// Then upserts every open issue and marks any previously-open mirror row that is no longer in
        /// the open set as closed. Fail-safe: if the board sweep or a blocked_by fetch fails, those
        /// columns are PRESERVED (CASE-guarded) rather than wiped, and the issues walk failing aborts
        /// the whole sync without touching the mirror.
        /// </summary>
        public static async Task<SyncSummary> SyncAsync(GitHubApiClient gh)
        {
            var sw = Stopwatch.StartNew();
            var summary = new SyncSummary();

            List<GitBoardIssue> openIssues;
            try
            {
                openIssues = await gh.ListBoardIssuesAsync(GitHubIssueState.Open);
            }
            catch (Exception ex)
            {
                summary.Ok = false;
                summary.Error = "issues walk failed: " + ex.Message;
                summary.ElapsedMs = sw.ElapsedMilliseconds;
                await RecordSyncStateAsync(false, summary.Error);
                ActivityLog.Log("issue-mirror", $"sync ABORTED (mirror left untouched): {summary.Error}");
                return summary;
            }
            summary.OpenIssues = openIssues.Count;

            // 2. Board-status sweep (best-effort — preserved on failure).
            bool boardSweepOk = true;
            Dictionary<int, GitHubApiClient.IssueBoardStatus> boardStatuses;
            try
            {
                boardStatuses = await gh.GetAllIssueBoardStatusesAsync();
            }
            catch (Exception ex)
            {
                boardSweepOk = false;
                boardStatuses = new();
                ActivityLog.Log("issue-mirror", $"sync: board-status sweep failed ({ex.Message}) — preserving existing board statuses this pass.");
            }
            summary.BoardStatuses = boardStatuses.Count;

            // 3. blocked_by for blocked-labeled issues only, inverted to blocking.
            bool blockedByPassComplete = true;
            var blockedByMap = new Dictionary<int, List<int>>();   // number -> declared blockers
            var blockingMap = new Dictionary<int, List<int>>();    // number -> what it blocks (inverse)
            var blockedNumbers = openIssues
                .Where(i => i.Labels.Any(l => string.Equals(l.Name, "blocked", StringComparison.OrdinalIgnoreCase)))
                .Select(i => i.Number)
                .Distinct()
                .ToList();
            if (blockedNumbers.Count > MaxBlockedByFetchesPerSync)
            {
                blockedByPassComplete = false;
                ActivityLog.Log("issue-mirror",
                    $"sync: {blockedNumbers.Count} blocked-labeled issues exceed the {MaxBlockedByFetchesPerSync} per-sync cap — fetching the first {MaxBlockedByFetchesPerSync}; blocking edges preserved this pass.");
                blockedNumbers = blockedNumbers.Take(MaxBlockedByFetchesPerSync).ToList();
            }
            // Non-blocked issues genuinely have no active blockers, so record [] for them (fresh data).
            var blockedSet = new HashSet<int>(blockedNumbers);
            foreach (var i in openIssues)
                if (!blockedSet.Contains(i.Number))
                    blockedByMap[i.Number] = new List<int>();
            foreach (var num in blockedNumbers)
            {
                try
                {
                    var blockers = await gh.GetBlockedByAsync(num);
                    blockedByMap[num] = blockers.Select(b => b.Number).Where(n => n > 0).Distinct().ToList();
                    summary.BlockedByFetched++;
                }
                catch (Exception ex)
                {
                    blockedByPassComplete = false; // don't refresh blocking from an incomplete pass
                    ActivityLog.Log("issue-mirror", $"sync: blocked_by fetch for #{num} failed ({ex.Message}) — its blocked_by preserved this pass.");
                }
            }
            // Invert whatever blocked_by we have into the blocking direction.
            foreach (var kv in blockedByMap)
                foreach (var blocker in kv.Value)
                {
                    if (!blockingMap.TryGetValue(blocker, out var list)) { list = new List<int>(); blockingMap[blocker] = list; }
                    if (!list.Contains(kv.Key)) list.Add(kv.Key);
                }

            // 4/5. Upsert every open issue + mark previously-open rows that dropped off as closed.
            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null)
                {
                    summary.Ok = false;
                    summary.Error = "db unavailable for upsert";
                    summary.ElapsedMs = sw.ElapsedMilliseconds;
                    ActivityLog.Log("issue-mirror", "sync: DB unavailable at upsert — mirror left untouched.");
                    return summary;
                }

                await using var tx = await conn.BeginTransactionAsync();

                await using (var cmd = new NpgsqlCommand(@"
                    INSERT INTO bt_issue_mirror
                        (issue_number, title, state, board_status_option_id, board_status_name,
                         labels, blocked_by_numbers, blocking_numbers, html_url, created_at, closed_at,
                         last_synced_at, updated_at)
                    VALUES
                        (@n, @title, 'open', @boardOpt, @boardName,
                         @labels, @blockedBy, @blocking, @url, @createdAt, NULL,
                         NOW(), NOW())
                    ON CONFLICT (issue_number) DO UPDATE SET
                        title  = EXCLUDED.title,
                        state  = 'open',
                        board_status_option_id = CASE WHEN @boardSweepOk THEN EXCLUDED.board_status_option_id ELSE bt_issue_mirror.board_status_option_id END,
                        board_status_name      = CASE WHEN @boardSweepOk THEN EXCLUDED.board_status_name      ELSE bt_issue_mirror.board_status_name      END,
                        labels = EXCLUDED.labels,
                        blocked_by_numbers = CASE WHEN @haveBlockedBy THEN EXCLUDED.blocked_by_numbers ELSE bt_issue_mirror.blocked_by_numbers END,
                        blocking_numbers   = CASE WHEN @blockingComplete THEN EXCLUDED.blocking_numbers ELSE bt_issue_mirror.blocking_numbers END,
                        html_url = EXCLUDED.html_url,
                        created_at = COALESCE(EXCLUDED.created_at, bt_issue_mirror.created_at),
                        closed_at = NULL,
                        last_synced_at = NOW(),
                        updated_at = NOW()", conn, tx))
                {
                    var pN = cmd.Parameters.Add(new NpgsqlParameter("@n", NpgsqlDbType.Integer));
                    var pTitle = cmd.Parameters.Add(new NpgsqlParameter("@title", NpgsqlDbType.Text));
                    var pBoardOpt = cmd.Parameters.Add(new NpgsqlParameter("@boardOpt", NpgsqlDbType.Text));
                    var pBoardName = cmd.Parameters.Add(new NpgsqlParameter("@boardName", NpgsqlDbType.Text));
                    var pLabels = cmd.Parameters.Add(new NpgsqlParameter("@labels", NpgsqlDbType.Array | NpgsqlDbType.Text));
                    var pBlockedBy = cmd.Parameters.Add(new NpgsqlParameter("@blockedBy", NpgsqlDbType.Array | NpgsqlDbType.Integer));
                    var pBlocking = cmd.Parameters.Add(new NpgsqlParameter("@blocking", NpgsqlDbType.Array | NpgsqlDbType.Integer));
                    var pUrl = cmd.Parameters.Add(new NpgsqlParameter("@url", NpgsqlDbType.Text));
                    var pCreated = cmd.Parameters.Add(new NpgsqlParameter("@createdAt", NpgsqlDbType.TimestampTz));
                    var pBoardSweepOk = cmd.Parameters.Add(new NpgsqlParameter("@boardSweepOk", NpgsqlDbType.Boolean) { Value = boardSweepOk });
                    var pHaveBlockedBy = cmd.Parameters.Add(new NpgsqlParameter("@haveBlockedBy", NpgsqlDbType.Boolean));
                    var pBlockingComplete = cmd.Parameters.Add(new NpgsqlParameter("@blockingComplete", NpgsqlDbType.Boolean) { Value = blockedByPassComplete });

                    foreach (var issue in openIssues)
                    {
                        pN.Value = issue.Number;
                        pTitle.Value = issue.Title ?? "";
                        if (boardStatuses.TryGetValue(issue.Number, out var bs))
                        {
                            pBoardOpt.Value = (object?)bs.OptionId ?? DBNull.Value;
                            pBoardName.Value = (object?)bs.StatusName ?? DBNull.Value;
                        }
                        else
                        {
                            // Not on the board (or sweep failed). When the sweep succeeded this is a
                            // real "off-board" → null; when it failed the CASE above preserves the row.
                            pBoardOpt.Value = DBNull.Value;
                            pBoardName.Value = DBNull.Value;
                        }
                        pLabels.Value = issue.Labels.Select(l => l.Name).Where(s => !string.IsNullOrEmpty(s)).Distinct().ToArray();
                        bool haveBlockedBy = blockedByMap.TryGetValue(issue.Number, out var bb);
                        pBlockedBy.Value = haveBlockedBy ? bb!.ToArray() : Array.Empty<int>();
                        pHaveBlockedBy.Value = haveBlockedBy;
                        pBlocking.Value = blockingMap.TryGetValue(issue.Number, out var bl) ? bl.ToArray() : Array.Empty<int>();
                        pUrl.Value = issue.HtmlUrl ?? "";
                        pCreated.Value = (object?)issue.CreatedAt ?? DBNull.Value;

                        await cmd.ExecuteNonQueryAsync();
                    }
                }

                // Mark-closed: any row we last saw OPEN that is no longer in the fetched open set has
                // been closed on GitHub since the last sync. (We don't re-walk the huge CLOSED set;
                // closed_at/board status of a freshly-closed issue is left as last known — no reader
                // depends on it, and PromoteVerifyingToDone's own LIVE open-set check covers the
                // Verifying→Done transition.)
                var openNums = openIssues.Select(i => i.Number).ToArray();
                await using (var closeCmd = new NpgsqlCommand(@"
                    UPDATE bt_issue_mirror
                       SET state = 'closed', last_synced_at = NOW(), updated_at = NOW()
                     WHERE state = 'open' AND NOT (issue_number = ANY(@open))", conn, tx))
                {
                    closeCmd.Parameters.AddWithValue("@open", NpgsqlDbType.Array | NpgsqlDbType.Integer, openNums);
                    summary.MarkedClosed = await closeCmd.ExecuteNonQueryAsync();
                }

                await tx.CommitAsync();
                summary.Ok = true;
            }
            catch (Exception ex)
            {
                summary.Ok = false;
                summary.Error = "upsert failed: " + ex.Message;
                ActivityLog.Log("issue-mirror", $"sync upsert failed ({ex.Message}) — mirror transaction rolled back.");
            }

            summary.ElapsedMs = sw.ElapsedMilliseconds;
            await RecordSyncStateAsync(summary.Ok,
                summary.Ok
                    ? $"ok: {summary.OpenIssues} open, {summary.BoardStatuses} board statuses, {summary.BlockedByFetched} blocked_by, {summary.MarkedClosed} closed, {summary.ElapsedMs}ms"
                    : summary.Error);

            ActivityLog.Log("issue-mirror",
                summary.Ok
                    ? $"sync ok — {summary.OpenIssues} open issues, {summary.BoardStatuses} board statuses, {summary.BlockedByFetched} blocked_by fetched, {summary.MarkedClosed} newly-closed, in {summary.ElapsedMs}ms. Routine title/board-status/chain reads now serve from the local mirror (Git #3113)."
                    : $"sync FAILED — {summary.Error} ({summary.ElapsedMs}ms). Routine reads fall back to live GitHub until the next successful sync.");
            return summary;
        }

        private static async Task RecordSyncStateAsync(bool ok, string? note)
        {
            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null) return;
                // last_full_sync_at advances ONLY on success — it is the "mirror is genuinely
                // populated / fresh" signal that HasUsableDataAsync and MaybeSyncAsync's interval gate
                // both read. A failure records last_sync_ok=false + the note for diagnostics but
                // leaves the last successful-sync timestamp untouched, so the mirror is never falsely
                // reported as fresh/usable and the next tick is free to retry (subject to the
                // in-memory FailedAttemptBackoff).
                string sql = ok
                    ? @"INSERT INTO bt_issue_mirror_sync_state (id, last_full_sync_at, last_sync_ok, last_sync_note)
                        VALUES (1, NOW(), true, @note)
                        ON CONFLICT (id) DO UPDATE
                           SET last_full_sync_at = NOW(), last_sync_ok = true, last_sync_note = @note"
                    : @"INSERT INTO bt_issue_mirror_sync_state (id, last_full_sync_at, last_sync_ok, last_sync_note)
                        VALUES (1, NULL, false, @note)
                        ON CONFLICT (id) DO UPDATE
                           SET last_sync_ok = false, last_sync_note = @note";
                await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("@note", (object?)note ?? DBNull.Value);
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"RecordSyncStateAsync failed ({ex.Message}) — sync bookkeeping not updated.");
            }
        }
    }
}
