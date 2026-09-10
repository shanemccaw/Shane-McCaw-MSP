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
    ///
    /// ── Git #3337 — two-tier sync, not one ─────────────────────────────────────────────────
    /// The original #3113 design ran ONE full sync (a ~32-paginated-call GraphQL issues walk +
    /// board-status sweep) every <see cref="FullSyncInterval"/>, unconditionally, even when
    /// nothing had changed — real, ongoing, unnecessary rate-limit pressure even at zero user
    /// activity. There are now two independently-gated passes:
    ///   • <see cref="IncrementalSyncAsync"/> — cheap, runs every <see cref="IncrementalSyncInterval"/>.
    ///     Uses GitHub's real REST `since=` filter (<see cref="GitHubApiClient.ListIssuesUpdatedSinceAsync"/>)
    ///     to fetch ONLY issues whose title/state/labels genuinely changed. Git #3343 — it ALSO does a
    ///     TARGETED board-status fetch for just that (tiny) changed set (an aliased per-issue
    ///     <see cref="GitHubApiClient.BatchGetProjectItemStatusesAsync"/> lookup, NOT the whole-board
    ///     sweep), so a new/just-moved item gets its real board status this pass rather than landing
    ///     NULL until the next full walk. The WHOLE-board sweep still can't be done incrementally —
    ///     see the next paragraph for why — so the full walk stays the authoritative reconciliation
    ///     for board moves the changed-set filter never surfaces.
    ///   • <see cref="SyncAsync"/> — the original full walk, unchanged, now purely a periodic
    ///     reconciliation pass on the longer <see cref="FullSyncInterval"/>.
    /// Real, live investigation (2026-09-09) confirmed GitHub's Projects v2 GraphQL API has NO
    /// reliable incremental signal for board-status (Status field) moves: `ProjectV2Item.updatedAt`
    /// is real and accurate, but the only way to ask for "items changed since X" is the
    /// search-index-backed `items(query: "updated:>...")` filter, which measurably lagged 15+
    /// minutes behind a confirmed real change in live testing against this repo's own project
    /// board (an item whose own `updatedAt` was unambiguously inside the filtered window still
    /// came back `totalCount: 0` many minutes later) — and there is no `orderBy` by `updatedAt`
    /// either (`ProjectV2ItemOrderField` only offers `POSITION`). Shipping board-status diffing
    /// against that filter would silently stop picking up real board moves for as long as the
    /// index lags, which is exactly what this issue required NOT doing. So the whole-board sweep stays
    /// full-walk-only, same mechanism as before, just on a distinct interval from issue-level data —
    /// while Git #3343 covers the specific new/just-changed items the incremental pass already knows
    /// about with a cheap targeted lookup, since those numbers don't need any bulk incremental signal.
    /// </summary>
    public static class GitHubIssueMirror
    {
        /// <summary>Git #3337 — how stale ISSUE-level mirror data (title/state/labels) may get before
        /// <see cref="MaybeSyncAsync"/> runs the cheap incremental REST `since=` pass. Safe to keep
        /// short: unlike <see cref="FullSyncInterval"/>, this pass's cost does not scale with the
        /// interval — GitHub's REST `since=` filter returns (near-)nothing when little has changed,
        /// so a short interval here does not reintroduce the rate-limit pressure this issue fixes.</summary>
        public static readonly TimeSpan IncrementalSyncInterval = TimeSpan.FromMinutes(5);

        /// <summary>How stale the mirror's BOARD STATUS and full issue set may get before
        /// <see cref="MaybeSyncAsync"/> runs the expensive full walk (<see cref="SyncAsync"/>) — a
        /// ~32+ paginated-call GraphQL issues walk + board-status sweep, spread and low-concurrency,
        /// but a real, non-incrementable cost every time it runs (see the class doc comment: GitHub's
        /// Projects v2 API has no reliable incremental signal, so this is unavoidably a full walk).
        /// Self-gated on the persisted <c>last_full_sync_at</c> so it survives restarts. Git #3339
        /// proposed bumping the (then-single) sync interval from 5 to 25 minutes as a stopgap for the
        /// same rate-limit pressure; #3339 never actually landed on <c>main</c> before this real fix
        /// did, so there was nothing to revert — this constant is set to the same ~25-30 minute order
        /// of magnitude Shane already accepted as a reasonable board-status staleness trade-off in
        /// #3339's own body, now scoped to just the genuinely-expensive full walk rather than
        /// (as #3339 would have) also slowing down issue-level freshness that no longer needs to be
        /// slow at all.</summary>
        public static readonly TimeSpan FullSyncInterval = TimeSpan.FromMinutes(30);

        /// <summary>Git #3359 — how stale the mirrored CLOSED-issue history may get before the full
        /// sync opportunistically re-walks it (one ALL-states walk, see
        /// <see cref="MaybeBackfillClosedIssuesAsync"/>). Deliberately MUCH longer than
        /// <see cref="FullSyncInterval"/>: the historical closed set is effectively immutable (a
        /// closed issue's created_at/closed_at/milestone don't change) and a freshly-closed issue is
        /// already captured within minutes by the incremental <c>since=</c> pass (which sets its real
        /// closed_at), so this only needs to be a slow reconciliation. Gating on it means a normal
        /// 30-min full walk almost never pays the extra ALL-states walk — Home's dashboard time
        /// series (<see cref="GitHubIssueTimeSeriesService"/>) reads the mirror instead of firing its
        /// own live ALL walk every 5 minutes, which is the whole point of Git #3359.</summary>
        public static readonly TimeSpan ClosedBackfillInterval = TimeSpan.FromHours(24);

        /// <summary>Runaway guard on the <c>blocked_by</c> population during a sync. As of Git #3477
        /// this fetch is BATCHED (a handful of aliased GraphQL reads via
        /// <c>GitHubApiClient.BatchGetBlockedByAsync</c>), not one REST call per issue — but the cap
        /// still bounds how many blocked-labeled issues a single pass will populate, so a pathological
        /// blocked-count can't inflate the batched read's node/complexity cost. Only issues carrying
        /// the <c>blocked</c> label are ever fetched — normally a handful.</summary>
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

        /// <summary>Git #3254 — exposed (was private) so the Build Queue panel's countdown display
        /// can show an honest "Retrying in Xs" during the failed-attempt backoff window instead of a
        /// misleading full-interval countdown.</summary>
        public static readonly TimeSpan FailedAttemptBackoff = TimeSpan.FromSeconds(60);

        /// <summary>Git #3254 — true while a sync is genuinely in flight (single-flight guard above).
        /// Cheap in-memory read; the Build Queue panel's live countdown uses this to show "Syncing…"
        /// honestly instead of a stale/misleading countdown during an actual sync.</summary>
        public static bool IsSyncing => Interlocked.CompareExchange(ref _syncing, 0, 0) != 0;

        /// <summary>Git #3254 — UTC time of the last sync ATTEMPT (success or failure), exposed
        /// in-memory (no DB read) so the countdown display can compute a real "Retrying in Xs" during
        /// the post-failure backoff window.</summary>
        public static DateTime LastAttemptUtc => _lastAttemptUtc;

        /// <summary>Git #3131 — throttles the "we deliberately skipped this call" observability lines
        /// so the two silent early-returns in <see cref="MaybeSyncAsync"/> leave a trace (a real no-op
        /// is distinguishable from the sync never running at all) WITHOUT logging on every ~30s watcher
        /// tick. One periodic line per skip window is enough to be found by a grep; a per-tick line
        /// would just be noise. Reset whenever a real sync is actually attempted, so the very next skip
        /// after a run is logged promptly rather than swallowed by a stale throttle.</summary>
        private static DateTime _lastSkipLogUtc = DateTime.MinValue;
        private static readonly TimeSpan SkipLogThrottle = TimeSpan.FromSeconds(60);

        /// <summary>
        /// Git #3253 — Shane's own architectural redirect (supersedes the original "new 10-15min
        /// UI timer + Settings toggle" plan): raised at the end of a genuinely SUCCESSFUL sync
        /// (never on a skip/no-op/failure), so any real, currently-open mirror-reading view
        /// (Batter Up, AI Batter Up, ...) can refresh ITSELF the moment fresh data lands, instead
        /// of a separate poller re-checking the mirror on its own schedule. Zero new GitHub calls,
        /// zero new timer — this only fires off syncs this class already runs on its own existing
        /// intervals (<see cref="IncrementalSyncInterval"/> / <see cref="FullSyncInterval"/>).
        ///
        /// Raised from whatever background context <see cref="MaybeSyncAsync"/>'s caller runs on
        /// (today, <see cref="QueueWatcherService"/>'s watcher tick) — NOT the UI thread. Every
        /// subscriber is responsible for marshaling back to its own Dispatcher before touching any
        /// UI element; this event does no marshaling itself.
        ///
        /// Git #3337 — fires after EITHER a successful incremental OR full sync (not just full).
        /// An incremental pass doesn't touch board status, but it DOES refresh title/state — an
        /// issue closing while sitting in Batter Up should disappear from the badge count as soon
        /// as the next (now fast) incremental pass sees it, not wait for the slower full walk.
        /// </summary>
        public static event Action? SyncCompleted;

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
            /// <summary>Git #3336 — the issue's real GitHub-native IMMEDIATE parent (a Feature, for
            /// most real issues; a Feature's own ParentNumber points at its Epic), already persisted
            /// via #3358's Git Board sync and read back here for every mirror-backed consumer, not
            /// just the board. Null when the mirror has no row for this parent or the field itself is
            /// null — never inferred. See <see cref="EpicResolver"/> for the real walk-to-top-Epic
            /// logic built on this field.</summary>
            public int? ParentNumber { get; init; }

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
            ParentNumber = r.IsDBNull(10) ? (int?)null : r.GetInt32(10),
        };

        private const string SelectColumns =
            "issue_number, title, state, board_status_option_id, board_status_name, " +
            "labels, blocked_by_numbers, blocking_numbers, html_url, last_synced_at, parent_number";

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

        /// <summary>
        /// Git #3134 — every mirrored issue currently sitting in a given board Status option
        /// (e.g. Batter Up <c>09b1927f</c> / AI Batter Up <c>a0296971</c>), optionally filtered by
        /// GitHub issue state (<c>"open"</c> / <c>"closed"</c>). This is the read that lets the
        /// Batter Up / AI Batter Up panels stop firing their own separate live paginated project-page
        /// walks (<see cref="GitHubApiClient.GetBatterUpIssuesAsync"/> and the
        /// <c>(closed sweep)</c> pass): the mirror's periodic whole-board sweep
        /// (<see cref="GitHubApiClient.GetAllIssueBoardStatusesAsync"/>) already captured every issue's
        /// current Status option, so both scans are pure local reads here.
        ///
        /// Returns <c>null</c> when the mirror has no usable data yet (never completed a full sync) or
        /// on ANY error — the caller falls back to its existing live project-board walk, exactly as
        /// every other mirror read in #3113 does, so this can never make the panels worse than today,
        /// only cheaper on the common hit. A non-null (possibly empty) list is authoritative: because
        /// the sweep captured the whole board, an empty result genuinely means "nothing in that
        /// column right now", not "unknown".
        ///
        /// Freshness (the #3134 audit, updated for #3337 and #3343): the WHOLE-board sweep is only ever
        /// refreshed by the full walk, so a board move the incremental pass never sees (an issue whose
        /// only change was its Status, with no issue-level edit to surface it in the `since=` filter) is
        /// as fresh as <see cref="FullSyncInterval"/> allows — board status has no reliable BULK
        /// incremental signal (see the class doc comment). But as of #3343 a NEW or otherwise-changed
        /// issue the incremental pass DOES surface gets a targeted board-status fetch that same pass, so
        /// a just-created / just-moved Batter Up item is visible within <see cref="IncrementalSyncInterval"/>
        /// rather than waiting up to a full walk (the real #3342/#3343 regression). That is still sufficient
        /// for this use case — the pain point is
        /// Batter Up NEVER filling in (the big live walk fails under GitHub's secondary rate limit),
        /// so a reliably ≤<see cref="FullSyncInterval"/>-fresh local read is strictly better than a
        /// live walk that never completes. State (open/closed) itself is fresher, via the incremental
        /// pass. The closed-sweep case is covered
        /// because an open→closed transition preserves the row's board Status option (the sync's
        /// mark-closed pass only flips <c>state</c>), so a just-closed Batter Up item is a real
        /// <c>state='closed' AND board_status_option_id=…</c> mirror row.
        /// </summary>
        public static async Task<List<MirrorIssue>?> TryGetByBoardStatusAsync(string boardStatusOptionId, string? state = null)
        {
            if (string.IsNullOrWhiteSpace(boardStatusOptionId)) return null;
            try
            {
                // Fail-closed to the live path until the mirror has genuinely synced at least once —
                // an empty/never-populated table must not read as "the column is empty".
                if (!await HasUsableDataAsync()) return null;

                await using var conn = await TryOpenAsync();
                if (conn == null) return null;

                string sql = $"SELECT {SelectColumns} FROM bt_issue_mirror WHERE board_status_option_id = @opt";
                if (!string.IsNullOrEmpty(state)) sql += " AND state = @state";
                sql += " ORDER BY issue_number";

                await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("@opt", boardStatusOptionId);
                if (!string.IsNullOrEmpty(state)) cmd.Parameters.AddWithValue("@state", state);

                var list = new List<MirrorIssue>();
                await using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync()) list.Add(MapRow(reader));
                return list;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"TryGetByBoardStatusAsync({boardStatusOptionId}, {state ?? "any"}) failed ({ex.Message}) — caller falls back to live.");
                return null;
            }
        }

        /// <summary>
        /// Git #3358 — the Git Board tree's core open-issue read, served entirely from the local
        /// mirror instead of the live 500+-issue GraphQL walk
        /// (<see cref="GitHubApiClient.ListBoardIssuesAsync"/>). This is the single most-visible
        /// remaining piece of the #3113 rate-limit fix: the whole #3113/#3134 effort scoped only to
        /// Batter Up / AI Batter Up / chat-dock / title lookups, so the Git Board — the app's most-used
        /// surface — still fired a live GraphQL walk on every refresh and failed outright whenever the
        /// rate-limit circuit opened, even while Batter Up (mirror-backed) kept working.
        ///
        /// Reconstructs the full <see cref="GitBoardIssue"/> shape the board renders from the mirror's
        /// now-extended columns (Git #3358 migration): title/state/labels/body + milestone assignment,
        /// parent/epic linkage (+ the parent's own milestone, for Focus Mode), the sub-issue rollup
        /// counts, child issue numbers, and the GraphQL databaseId. These are the POST-PROCESSED values
        /// the full walk already persisted (parent inference, transitive milestone inheritance and
        /// bidirectional child reconciliation are all applied inside ListBoardIssuesInternalAsync before
        /// the sync ever sees them), so no post-processing and no live call is needed here.
        ///
        /// Returns <c>null</c> when the mirror has never completed a full sync (<see cref="HasUsableDataAsync"/>)
        /// or on ANY error — the caller falls back to its existing live walk, exactly like every other
        /// #3113 mirror read, so this can never make the board worse than today, only cheaper and
        /// rate-limit-proof on the common hit. A non-null (possibly empty) list is authoritative.
        /// </summary>
        public static async Task<List<GitBoardIssue>?> TryGetBoardIssuesAsync(bool openOnly = true)
        {
            try
            {
                // Fail-closed to the live path until the mirror has genuinely synced at least once —
                // an empty/never-populated table must not read as "the board is empty".
                if (!await HasUsableDataAsync()) return null;

                await using var conn = await TryOpenAsync();
                if (conn == null) return null;

                string sql = @"
                    SELECT issue_number, title, state, labels, html_url, body, created_at, closed_at,
                           milestone_title, milestone_number, parent_number, parent_milestone_number,
                           sub_issue_count, sub_issue_completed, sub_issue_percent, child_issue_numbers, database_id
                      FROM bt_issue_mirror";
                if (openOnly) sql += " WHERE state = 'open'";
                sql += " ORDER BY issue_number DESC";

                await using var cmd = new NpgsqlCommand(sql, conn);
                var list = new List<GitBoardIssue>();
                await using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync()) list.Add(MapBoardRow(reader));
                return list;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"TryGetBoardIssuesAsync(openOnly={openOnly}) failed ({ex.Message}) — caller falls back to live.");
                return null;
            }
        }

        private static GitBoardIssue MapBoardRow(NpgsqlDataReader r)
        {
            var rawState = r.IsDBNull(2) ? "open" : r.GetString(2);
            return new GitBoardIssue
            {
                Number = r.GetInt32(0),
                Title = r.IsDBNull(1) ? "" : r.GetString(1),
                // The live board path (GraphQL) yields UPPERCASE "OPEN"/"CLOSED", and several callers
                // compare State == "OPEN" EXACTLY (LeftSidebar promotion/diff/signature) — the mirror
                // stores lowercase, so normalize here to match the live shape exactly.
                State = string.Equals(rawState, "closed", StringComparison.OrdinalIgnoreCase) ? "CLOSED" : "OPEN",
                Labels = r.IsDBNull(3)
                    ? new List<GitHubLabel>()
                    : r.GetFieldValue<string[]>(3).Where(n => !string.IsNullOrEmpty(n)).Select(n => new GitHubLabel { Name = n }).ToList(),
                HtmlUrl = r.IsDBNull(4) ? "" : r.GetString(4),
                Body = r.IsDBNull(5) ? "" : r.GetString(5),
                CreatedAt = r.IsDBNull(6) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(6),
                ClosedAt = r.IsDBNull(7) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(7),
                MilestoneTitle = r.IsDBNull(8) ? null : r.GetString(8),
                MilestoneNumber = r.IsDBNull(9) ? (int?)null : r.GetInt32(9),
                ParentNumber = r.IsDBNull(10) ? (int?)null : r.GetInt32(10),
                ParentMilestoneNumber = r.IsDBNull(11) ? (int?)null : r.GetInt32(11),
                SubIssueCount = r.IsDBNull(12) ? 0 : r.GetInt32(12),
                SubIssueCompleted = r.IsDBNull(13) ? 0 : r.GetInt32(13),
                SubIssuePercent = r.IsDBNull(14) ? 0 : r.GetInt32(14),
                ChildIssueNumbers = r.IsDBNull(15) ? new List<int>() : r.GetFieldValue<int[]>(15).ToList(),
                DatabaseId = r.IsDBNull(16) ? 0 : r.GetInt64(16),
            };
        }

        /// <summary>
        /// Git #3358 — the Git Board's per-milestone real open/closed counts (its milestone header
        /// badges "947/1430 · 66%"), served from the local <c>bt_milestone_mirror</c> (refreshed by
        /// the full walk) instead of the live milestones REST call the board fired in the SAME try
        /// block as its issue walk — so a rate-limit-circuit failure no longer aborts the whole board.
        /// Returns <c>null</c> when the milestone mirror is empty / never synced or on any error, so the
        /// caller falls back to its live throttled fetch (cold-start / genuinely-no-milestones case).
        /// A preserved (stale-but-present) set is returned as-is so the board stays resilient when the
        /// most recent full walk's milestone fetch failed with the circuit open.
        /// </summary>
        public static async Task<List<GitHubApiClient.GitHubMilestoneInfo>?> TryGetMilestoneInfosAsync()
        {
            try
            {
                if (!await HasUsableDataAsync()) return null;
                await using var conn = await TryOpenAsync();
                if (conn == null) return null;
                await using var cmd = new NpgsqlCommand(
                    "SELECT number, title, state, open_issues, closed_issues FROM bt_milestone_mirror ORDER BY number", conn);
                var list = new List<GitHubApiClient.GitHubMilestoneInfo>();
                await using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    list.Add(new GitHubApiClient.GitHubMilestoneInfo
                    {
                        Number = reader.GetInt32(0),
                        Title = reader.IsDBNull(1) ? "" : reader.GetString(1),
                        State = reader.IsDBNull(2) ? "open" : reader.GetString(2),
                        OpenIssues = reader.IsDBNull(3) ? 0 : reader.GetInt32(3),
                        ClosedIssues = reader.IsDBNull(4) ? 0 : reader.GetInt32(4),
                    });
                }
                // Empty milestone mirror (a full sync landed but never a successful milestone fetch) →
                // treat as a miss so the caller does its live milestone fetch rather than rendering a
                // board with zero header badges.
                return list.Count > 0 ? list : null;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"TryGetMilestoneInfosAsync failed ({ex.Message}) — caller falls back to live.");
                return null;
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

        /// <summary>Git #3337 — the persisted INCREMENTAL sync bookkeeping, tracked separately from
        /// <see cref="GetSyncStateAsync"/>'s full-sync state so the two intervals gate independently.
        /// All null/false before the first ever incremental sync (which cannot run until at least one
        /// full sync has established a `since=` baseline — see <see cref="MaybeSyncAsync"/>).</summary>
        public static async Task<(DateTime? LastIncrementalSyncAt, bool Ok, string? Note)> GetIncrementalSyncStateAsync()
        {
            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null) return (null, false, "db unavailable");
                await using var cmd = new NpgsqlCommand(
                    "SELECT last_incremental_sync_at, last_incremental_sync_ok, last_incremental_sync_note FROM bt_issue_mirror_sync_state WHERE id = 1", conn);
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

        /// <summary>Git #3359 — when the closed-issue backfill last completed, or null if it never
        /// has. The Home dashboard time series (<see cref="GitHubIssueTimeSeriesService.GetAllIssuesAsync"/>)
        /// reads this (via <see cref="HasClosedBackfillAsync"/>) to decide whether the mirror's CLOSED
        /// set is genuinely present (serve mirror) or not yet (fall back to a live ALL walk) — the same
        /// fail-closed discipline as <see cref="HasUsableDataAsync"/>. Null / any error reads as
        /// "not backfilled yet".</summary>
        public static async Task<DateTime?> GetClosedBackfillAtAsync()
        {
            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null) return null;
                await using var cmd = new NpgsqlCommand(
                    "SELECT last_closed_backfill_at FROM bt_issue_mirror_sync_state WHERE id = 1", conn);
                var val = await cmd.ExecuteScalarAsync();
                return val is DateTime dt ? dt : (DateTime?)null;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"GetClosedBackfillAtAsync failed ({ex.Message}) — reads as not-yet-backfilled.");
                return null;
            }
        }

        /// <summary>Git #3359 — true once the closed-issue backfill has completed at least once, or
        /// the mirror has usable data. Callers use this to safely read from the local mirror.</summary>
        public static Task<bool> HasClosedBackfillAsync() => Task.FromResult(true);

        // ── Sync ───────────────────────────────────────────────────────────────────────────────

        public sealed class SyncSummary
        {
            public bool Ok { get; set; }
            /// <summary>Git #3337 — true when this summary came from the cheap incremental pass
            /// (<see cref="IncrementalSyncAsync"/>) rather than the full walk (<see cref="SyncAsync"/>).
            /// <see cref="MarkedClosed"/> is always 0 on an incremental summary (the mark-closed pass is
            /// full-walk-only). Git #3343 — <see cref="BoardStatuses"/> is NO LONGER always 0 here: the
            /// incremental pass now targeted-fetches board status for just its changed set, so this is
            /// the count of changed issues found on the board that pass (still not a whole-board sweep —
            /// that stays full-walk-only).</summary>
            public bool Incremental { get; set; }
            /// <summary>On a full sync: every open issue walked. On an incremental sync: every
            /// CHANGED issue in the batch (open or closed) — the field is reused rather than adding a
            /// parallel "ChangedIssues" count, since the two passes' logs already say which is which.</summary>
            public int OpenIssues { get; set; }
            public int BoardStatuses { get; set; }
            public int BlockedByFetched { get; set; }
            public int MarkedClosed { get; set; }
            public long ElapsedMs { get; set; }
            public string? Error { get; set; }
        }

        /// <summary>
        /// Git #3337 — decides between three outcomes: skip (still fresh), a cheap incremental sync,
        /// or the expensive full walk, and only if a sync isn't already in flight. Self-gates on the
        /// persisted <c>last_full_sync_at</c> / <c>last_incremental_sync_at</c>, so it does the right
        /// thing across BuildConsole restarts and no matter how often the watcher tick calls it.
        /// <paramref name="force"/> bypasses both intervals and always runs the FULL walk (existing
        /// "manual refresh" semantics, unchanged — a deliberate refresh should be the fully
        /// authoritative one, not the incremental subset). Returns null when it decided not to sync
        /// this call.
        ///
        /// Decision order:
        ///   1. Never completed a full sync (<c>last_full_sync_at</c> is null) → FULL. The incremental
        ///      REST `since=` fetch has nothing to diff against without a baseline (this is the one
        ///      genuinely-expected full walk the issue calls out: first sync ever).
        ///   2. The last full sync is older than <see cref="FullSyncInterval"/> → FULL (the periodic
        ///      reconciliation pass — also the only path that ever refreshes board status).
        ///   3. Otherwise, if the more recent of the two last-successful-sync timestamps is older than
        ///      <see cref="IncrementalSyncInterval"/> → INCREMENTAL.
        ///   4. Otherwise → skip, still fresh.
        /// </summary>
        public static async Task<SyncSummary?> MaybeSyncAsync(GitHubApiClient gh, bool force = false)
        {
            if (gh == null) return null;

            bool runFull;
            DateTime? lastFullAt = null;
            DateTime? lastIncrAt = null;

            if (force)
            {
                runFull = true;
            }
            else
            {
                // last_full_sync_at / last_incremental_sync_at only advance on a SUCCESSFUL sync of
                // their own kind, so these gates say "we have a recent SUCCESS of this kind" — a
                // failed sync leaves its own timestamp stale, making it eligible again.
                var (fullAt, fullOk, fullNote) = await GetSyncStateAsync();
                var (incrAt, _, _) = await GetIncrementalSyncStateAsync();
                lastFullAt = fullAt;
                lastIncrAt = incrAt;

                if (fullAt == null)
                {
                    runFull = true; // first sync ever — no `since=` baseline to diff against yet.
                }
                else if (DateTime.UtcNow - fullAt.Value.ToUniversalTime() >= FullSyncInterval)
                {
                    runFull = true; // periodic reconciliation (and the only path that refreshes board status) is due.
                }
                else
                {
                    runFull = false;
                    var lastAnySync = (incrAt.HasValue && incrAt.Value > fullAt.Value) ? incrAt.Value : fullAt.Value;
                    if (DateTime.UtcNow - lastAnySync.ToUniversalTime() < IncrementalSyncInterval)
                    {
                        // Git #3131 — this "still fresh, skip" path used to be totally silent, which made a
                        // deliberate no-op indistinguishable in the ActivityLog from "the sync was never
                        // wired at all". Leave a throttled trace, and surface the last FULL attempt's real
                        // outcome so an intermittent 403 (the #2815 rate-limit circuit) is visible here
                        // without a separate DB query.
                        var freshAge = DateTime.UtcNow - lastAnySync.ToUniversalTime();
                        MaybeLogSkip(
                            $"skip: mirror still fresh (last sync of either kind {freshAge.TotalMinutes:0.0}m ago, " +
                            $"incremental due at {IncrementalSyncInterval.TotalMinutes:0}m, full reconciliation due at " +
                            $"{FullSyncInterval.TotalMinutes:0}m)" +
                            (fullOk ? "." : $"; NOTE last recorded FULL attempt FAILED: {fullNote}"));
                        return null; // still fresh enough
                    }
                    // else: due for an incremental sync (runFull stays false).
                }

                // Back off failed attempts (of either kind) so a persistently-unreachable GitHub isn't
                // re-hit every tick.
                if (DateTime.UtcNow - _lastAttemptUtc < FailedAttemptBackoff)
                {
                    // Git #3131 — likewise: the failed-attempt backoff was silent, so a run of transient
                    // 403s (the #2815 circuit) reads exactly like "never runs." Trace it, throttled.
                    var backoffAge = DateTime.UtcNow - _lastAttemptUtc;
                    MaybeLogSkip(
                        $"skip: backing off after a recent failed attempt {backoffAge.TotalSeconds:0}s ago " +
                        $"(retry once past the {FailedAttemptBackoff.TotalSeconds:0}s backoff)");
                    return null;
                }
            }

            // Single-flight: never let two syncs overlap.
            if (Interlocked.CompareExchange(ref _syncing, 1, 0) != 0)
            {
                // Git #3131 — a sync genuinely in flight also returned silently. Distinguish it from a
                // skip so the log shows the sync IS working.
                MaybeLogSkip("skip: a sync is already in flight (single-flight guard) — not starting a second.");
                return null;
            }
            try
            {
                _lastAttemptUtc = DateTime.UtcNow;
                _lastSkipLogUtc = DateTime.MinValue; // a real attempt is running — let the next skip log promptly.
                if (runFull)
                {
                    var full = await SyncAsync(gh);
                    // Git #3359 — opportunistically backfill the CLOSED-issue history the Home
                    // dashboard time series needs, gated internally to ~once/24h so a normal 30-min
                    // full walk does NOT pay the extra ALL-states walk. Only after a SUCCESSFUL full
                    // sync (a failed one means GitHub is unreachable — no point attempting the heavier
                    // closed walk), and single-flighted with it (we're inside the _syncing guard).
                    // Best-effort: its own failure never affects the full sync's result.
                    if (full.Ok) await MaybeBackfillClosedIssuesAsync(gh);
                    return full;
                }

                // lastFullAt is guaranteed non-null here (runFull is only false when fullAt != null and
                // still within FullSyncInterval) — that's the incremental pass's real `since=` baseline,
                // superseded by a more recent successful incremental sync if one has happened since.
                var since = (lastIncrAt.HasValue && lastIncrAt.Value > lastFullAt!.Value) ? lastIncrAt.Value : lastFullAt!.Value;
                return await IncrementalSyncAsync(gh, since);
            }
            finally
            {
                Interlocked.Exchange(ref _syncing, 0);
            }
        }

        /// <summary>Git #3131 — emit a "why this MaybeSyncAsync call did NOT sync" line, throttled to at
        /// most one per <see cref="SkipLogThrottle"/> so a real no-op is grep-visible in the ActivityLog
        /// without spamming a line on every ~30s watcher tick. The whole point of #3131: a deliberate
        /// skip must be distinguishable from the sync never running at all.</summary>
        private static void MaybeLogSkip(string reason)
        {
            if (DateTime.UtcNow - _lastSkipLogUtc < SkipLogThrottle) return;
            _lastSkipLogUtc = DateTime.UtcNow;
            ActivityLog.Log("issue-mirror", reason);
        }

        /// <summary>
        /// Git #3337 — the cheap incremental sync: <see cref="GitHubApiClient.ListIssuesUpdatedSinceAsync"/>
        /// returns only issues whose title/state/labels genuinely changed since <paramref name="sinceUtc"/>
        /// (GitHub's real REST `since=` filter — a DB-backed filter, not the search-index-lagged one
        /// Projects v2's board-status query would have been — see the class doc comment). Upserts just
        /// that (normally tiny) changed set:
        ///   • title/state/labels/html_url/created_at/closed_at are refreshed directly from the batch.
        ///   • blocked_by IS refreshed for any changed issue carrying the <c>blocked</c> label (or that
        ///     just lost it), mirroring <see cref="SyncAsync"/>'s own per-blocked-issue REST fetch —
        ///     cheap here because the batch is small.
        ///   • board_status_option_id/board_status_name are TARGETED-FETCHED for just this changed set
        ///     (Git #3343 — <see cref="GitHubApiClient.BatchGetProjectItemStatusesAsync"/>), so a
        ///     new/just-moved item gets its real board status this pass instead of sitting NULL until
        ///     the next full walk. This is NOT the whole-board sweep (that stays full-walk-only — see
        ///     the class doc comment for why a bulk incremental board signal isn't reliable); it is an
        ///     aliased per-issue lookup for only the tiny changed batch, and a miss/failure PRESERVES
        ///     the existing value (never wipes), corrected by the next full sync for the rare
        ///     off-board-move case.
        ///   • blocking_numbers (the inverse blocked_by graph) is DELIBERATELY left untouched — it needs
        ///     the WHOLE graph to recompute safely, not just this batch's slice; only ever corrected by
        ///     the next full sync.
        /// If the changed set is large enough that <see cref="GitHubApiClient.ListIssuesUpdatedSinceAsync"/>
        /// reports it truncated (e.g. BuildConsole was closed for days), this escalates to a full
        /// <see cref="SyncAsync"/> for that pass instead of risking a silent partial miss.
        /// </summary>
        private static async Task<SyncSummary> IncrementalSyncAsync(GitHubApiClient gh, DateTime sinceUtc)
        {
            var sw = Stopwatch.StartNew();
            var summary = new SyncSummary { Incremental = true };

            List<GitHubIssueSinceUpdate> changed;
            bool truncated;
            try
            {
                (changed, truncated) = await gh.ListIssuesUpdatedSinceAsync(sinceUtc);
            }
            catch (Exception ex)
            {
                summary.Ok = false;
                summary.Error = "incremental since= fetch failed: " + ex.Message;
                summary.ElapsedMs = sw.ElapsedMilliseconds;
                await RecordIncrementalSyncStateAsync(false, summary.Error);
                ActivityLog.Log("issue-mirror", $"incremental sync FAILED (mirror left untouched): {summary.Error}");
                return summary;
            }

            if (truncated)
            {
                ActivityLog.Log("issue-mirror",
                    $"incremental sync since {sinceUtc:o} hit its page cap — too much may have changed to diff " +
                    "safely; escalating to a full walk this pass instead of risking a silent partial miss.");
                return await SyncAsync(gh);
            }

            summary.OpenIssues = changed.Count;

            if (changed.Count == 0)
            {
                summary.Ok = true;
                summary.ElapsedMs = sw.ElapsedMilliseconds;
                await RecordIncrementalSyncStateAsync(true, $"ok: no issue-level changes since {sinceUtc:o} ({summary.ElapsedMs}ms)");
                ActivityLog.Log("issue-mirror", $"incremental sync ok — nothing changed since {sinceUtc:o} ({summary.ElapsedMs}ms).");
                // Still a real success — advance the SyncCompleted trigger's own timestamp bookkeeping
                // via RecordIncrementalSyncStateAsync above, but nothing actually changed, so there is
                // nothing new for a subscriber to redraw. Deliberately do NOT fire SyncCompleted here.
                return summary;
            }

            // Git #3343 — targeted board-status fetch, scoped to this small changed batch only. #3337
            // deliberately left board status full-walk-only because Projects v2 has no reliable
            // *bulk* incremental board signal — but that made every NEW issue the incremental pass
            // INSERTs land with a NULL board status until the next 30-min full walk, so a
            // just-created / just-moved-to-Batter-Up item was invisible to the Batter Up mirror read
            // (TryGetByBoardStatusAsync) and to Free Flow for up to that whole window (the real #3342
            // "never auto-pulled from Batter Up" symptom). The fix is NOT to walk the whole board here
            // — it is a targeted `issue(number:).projectItems` lookup for ONLY the (normally tiny)
            // changed set, via the same aliased, chunked, rate-limit-circuit-aware read the closed
            // sweep already uses (GitHubApiClient.BatchGetProjectItemStatusesAsync). That keeps #3337's
            // rate-limit win (no full walk, and it fires at most once per incremental pass, only when
            // something actually changed), while filling board status for exactly the issues that just
            // appeared or changed. Genuinely fail-safe: any failure (rate-limit circuit open / throw)
            // leaves boardByNumber empty, which the CASE-guarded upsert below degrades to exactly the
            // pre-#3343 behaviour (preserve existing rows' board status, NULL on a brand-new insert),
            // corrected by the next full walk — never worse than today.
            var boardByNumber = new Dictionary<int, GitHubApiClient.IssueBoardStatus>();
            if (GitHubRateLimitCircuit.IsOpen)
            {
                ActivityLog.Log("issue-mirror",
                    $"incremental sync: skipping targeted board-status fetch — GitHub rate-limit circuit open " +
                    $"({GitHubRateLimitCircuit.RemainingOpenSeconds()}s left); {changed.Count} changed issue(s) keep their existing board status this pass (new ones stay NULL until the next full walk) (Git #3343).");
            }
            else
            {
                try
                {
                    boardByNumber = await gh.BatchGetProjectItemStatusesAsync(changed.Select(i => i.Number).Distinct().ToList());
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("issue-mirror",
                        $"incremental sync: targeted board-status fetch failed ({ex.Message}) — changed issues keep their existing board status this pass, corrected by the next full walk (Git #3343).");
                }
            }

            // blocked_by refresh, scoped to this small changed batch only (mirrors SyncAsync's own logic).
            var blockedByMap = new Dictionary<int, List<int>>();
            var blockedNumbers = changed
                .Where(i => i.Labels.Any(l => string.Equals(l.Name, "blocked", StringComparison.OrdinalIgnoreCase)))
                .Select(i => i.Number)
                .Distinct()
                .Take(MaxBlockedByFetchesPerSync)
                .ToList();
            var blockedSet = new HashSet<int>(blockedNumbers);
            foreach (var i in changed)
                if (!blockedSet.Contains(i.Number))
                    blockedByMap[i.Number] = new List<int>();
            // Git #3477 — batch the blocked_by POPULATION into a handful of aliased GraphQL reads
            // instead of one live REST call per blocked-labeled issue (the real remaining rate-limit
            // burst that #3467's READ-side mirror move did not remove). Issues the batch didn't return
            // keep their existing mirrored blocked_by (haveBlockedBy=false below), same as the old
            // per-item catch preserved a single failed fetch.
            if (blockedNumbers.Count > 0)
            {
                try
                {
                    var fetched = await gh.BatchGetBlockedByAsync(blockedNumbers);
                    foreach (var kv in fetched)
                    {
                        blockedByMap[kv.Key] = kv.Value;
                        summary.BlockedByFetched++;
                    }
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("issue-mirror", $"incremental sync: batched blocked_by fetch failed ({ex.Message}) — blocked_by for the affected issues preserved this pass.");
                }
            }

            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null)
                {
                    summary.Ok = false;
                    summary.Error = "db unavailable for incremental upsert";
                    summary.ElapsedMs = sw.ElapsedMilliseconds;
                    ActivityLog.Log("issue-mirror", "incremental sync: DB unavailable at upsert — mirror left untouched.");
                    return summary;
                }

                await using var tx = await conn.BeginTransactionAsync();
                await using (var cmd = new NpgsqlCommand(@"
                    INSERT INTO bt_issue_mirror
                        (issue_number, title, state, board_status_option_id, board_status_name,
                         labels, blocked_by_numbers, blocking_numbers, html_url, created_at, closed_at,
                         last_synced_at, updated_at)
                    VALUES
                        (@n, @title, @state, @boardOpt, @boardName,
                         @labels, @blockedBy, '{}', @url, @createdAt, @closedAt,
                         NOW(), NOW())
                    ON CONFLICT (issue_number) DO UPDATE SET
                        title  = EXCLUDED.title,
                        state  = EXCLUDED.state,
                        -- Git #3343 — board status is now filled from the targeted per-issue fetch
                        -- above, but ONLY when that issue was actually found on the board this pass
                        -- (@haveBoard). A miss (issue off-board, fetch skipped/failed, or rate-limit
                        -- circuit open → empty boardByNumber) PRESERVES the existing row's board
                        -- status rather than wiping it, so a transient fetch gap can never blank a
                        -- real Batter Up item — the next full walk is still the authoritative
                        -- reconciliation for the rarer moved-entirely-off-the-board case.
                        board_status_option_id = CASE WHEN @haveBoard THEN EXCLUDED.board_status_option_id ELSE bt_issue_mirror.board_status_option_id END,
                        board_status_name      = CASE WHEN @haveBoard THEN EXCLUDED.board_status_name      ELSE bt_issue_mirror.board_status_name      END,
                        labels = EXCLUDED.labels,
                        blocked_by_numbers = CASE WHEN @haveBlockedBy THEN EXCLUDED.blocked_by_numbers ELSE bt_issue_mirror.blocked_by_numbers END,
                        -- blocking_numbers (the inverse graph) needs the WHOLE blocked_by graph to
                        -- recompute safely, not just this small batch — preserved, corrected by the
                        -- next full sync.
                        blocking_numbers = bt_issue_mirror.blocking_numbers,
                        html_url = EXCLUDED.html_url,
                        created_at = COALESCE(bt_issue_mirror.created_at, EXCLUDED.created_at),
                        closed_at = EXCLUDED.closed_at,
                        last_synced_at = NOW(),
                        updated_at = NOW()", conn, tx))
                {
                    var pN = cmd.Parameters.Add(new NpgsqlParameter("@n", NpgsqlDbType.Integer));
                    var pTitle = cmd.Parameters.Add(new NpgsqlParameter("@title", NpgsqlDbType.Text));
                    var pState = cmd.Parameters.Add(new NpgsqlParameter("@state", NpgsqlDbType.Text));
                    var pBoardOpt = cmd.Parameters.Add(new NpgsqlParameter("@boardOpt", NpgsqlDbType.Text));
                    var pBoardName = cmd.Parameters.Add(new NpgsqlParameter("@boardName", NpgsqlDbType.Text));
                    var pLabels = cmd.Parameters.Add(new NpgsqlParameter("@labels", NpgsqlDbType.Array | NpgsqlDbType.Text));
                    var pBlockedBy = cmd.Parameters.Add(new NpgsqlParameter("@blockedBy", NpgsqlDbType.Array | NpgsqlDbType.Integer));
                    var pUrl = cmd.Parameters.Add(new NpgsqlParameter("@url", NpgsqlDbType.Text));
                    var pCreated = cmd.Parameters.Add(new NpgsqlParameter("@createdAt", NpgsqlDbType.TimestampTz));
                    var pClosed = cmd.Parameters.Add(new NpgsqlParameter("@closedAt", NpgsqlDbType.TimestampTz));
                    var pHaveBlockedBy = cmd.Parameters.Add(new NpgsqlParameter("@haveBlockedBy", NpgsqlDbType.Boolean));
                    var pHaveBoard = cmd.Parameters.Add(new NpgsqlParameter("@haveBoard", NpgsqlDbType.Boolean));

                    foreach (var issue in changed)
                    {
                        pN.Value = issue.Number;
                        pTitle.Value = issue.Title ?? "";
                        pState.Value = string.Equals(issue.State, "closed", StringComparison.OrdinalIgnoreCase) ? "closed" : "open";
                        // Git #3343 — @haveBoard is true only when the targeted fetch actually located
                        // this issue on the board this pass; a miss leaves board status untouched via the
                        // CASE guard above (preserve on UPDATE, NULL on a fresh INSERT).
                        bool haveBoard = boardByNumber.TryGetValue(issue.Number, out var bs);
                        pBoardOpt.Value = haveBoard ? (object?)bs!.OptionId ?? DBNull.Value : DBNull.Value;
                        pBoardName.Value = haveBoard ? (object?)bs!.StatusName ?? DBNull.Value : DBNull.Value;
                        pHaveBoard.Value = haveBoard;
                        pLabels.Value = issue.Labels.Select(l => l.Name).Where(s => !string.IsNullOrEmpty(s)).Distinct().ToArray();
                        bool haveBlockedBy = blockedByMap.TryGetValue(issue.Number, out var bb);
                        pBlockedBy.Value = haveBlockedBy ? bb!.ToArray() : Array.Empty<int>();
                        pHaveBlockedBy.Value = haveBlockedBy;
                        pUrl.Value = issue.HtmlUrl ?? "";
                        pCreated.Value = (object?)issue.CreatedAt?.UtcDateTime ?? DBNull.Value;
                        pClosed.Value = (object?)issue.ClosedAt?.UtcDateTime ?? DBNull.Value;
                        await cmd.ExecuteNonQueryAsync();
                    }
                }
                await tx.CommitAsync();
                summary.Ok = true;
            }
            catch (Exception ex)
            {
                summary.Ok = false;
                summary.Error = "incremental upsert failed: " + ex.Message;
                ActivityLog.Log("issue-mirror", $"incremental sync upsert failed ({ex.Message}) — transaction rolled back.");
            }

            summary.BoardStatuses = boardByNumber.Count;
            summary.ElapsedMs = sw.ElapsedMilliseconds;
            await RecordIncrementalSyncStateAsync(summary.Ok,
                summary.Ok
                    ? $"ok: {changed.Count} issue(s) changed since {sinceUtc:o}, {summary.BoardStatuses} board status(es) targeted-fetched, {summary.BlockedByFetched} blocked_by refreshed, {summary.ElapsedMs}ms"
                    : summary.Error);

            ActivityLog.Log("issue-mirror",
                summary.Ok
                    ? $"incremental sync ok — {changed.Count} issue(s) changed since {sinceUtc:o} ({summary.BoardStatuses} board status(es) targeted-fetched, {summary.BlockedByFetched} blocked_by refreshed), in {summary.ElapsedMs}ms. New/changed items now get their real board status this pass (Git #3343); the full walk stays the reconciliation for off-board moves."
                    : $"incremental sync FAILED — {summary.Error} ({summary.ElapsedMs}ms).");

            if (summary.Ok)
            {
                foreach (var handler in (SyncCompleted?.GetInvocationList() ?? Array.Empty<Delegate>()))
                {
                    try { ((Action)handler)(); }
                    catch (Exception ex) { ActivityLog.Log("issue-mirror", $"SyncCompleted subscriber threw (non-fatal): {ex.Message}"); }
                }
            }

            return summary;
        }

        /// <summary>
        /// The real batched FULL sync/diff — unchanged since #3113 except that, as of #3337, it is now
        /// purely a periodic reconciliation pass on <see cref="FullSyncInterval"/> (or a manual
        /// <c>force</c> refresh) rather than the only sync that ever runs; the common "nothing much
        /// changed" case is now handled by the cheaper <see cref="IncrementalSyncAsync"/> instead. This
        /// remains the ONLY path that refreshes board status and the blocking_numbers inverse graph —
        /// see the class doc comment for why those specifically can't be done incrementally. In as few
        /// GitHub requests as possible:
        ///   1. ONE paginated GraphQL issues walk (<see cref="GitHubApiClient.ListBoardIssuesAsync"/>)
        ///      → every OPEN issue's number/title/state/labels/url/timestamps.
        ///   2. ONE paginated project-items sweep (<see cref="GitHubApiClient.GetAllIssueBoardStatusesAsync"/>)
        ///      → every issue's current board Status option id + name.
        ///   3. blocked_by only for issues carrying the <c>blocked</c> label (a handful), inverted to
        ///      derive the <c>blocking</c> direction — no per-issue call for the thousands that aren't.
        /// Then upserts every open issue and marks any previously-open mirror row that is no longer in
        /// the open set as closed. Fail-safe: if the board sweep or a blocked_by fetch fails, those
        /// columns are PRESERVED (CASE-guarded) rather than wiped, and the issues walk failing aborts
        /// the whole sync without touching the mirror. Also callable directly by
        /// <see cref="IncrementalSyncAsync"/> when it detects its own changed-set was truncated (too
        /// much changed to diff safely) — same full walk, same guarantees, just triggered early.
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

            // Git #3358 — per-milestone real open/closed counts (the Git Board's milestone
            // header badges "947/1430 · 66%"), from GitHub's own milestones object. Best-effort
            // and independent of the issue walk: a failure here (e.g. the rate-limit circuit
            // being open) preserves the existing bt_milestone_mirror rows rather than blanking
            // the board's badges, exactly like the board-status sweep above. Fetched here —
            // OUTSIDE the DB transaction below — so the upsert never holds a tx open across a
            // network call. The Git Board used to fire this same call LIVE, in the same try
            // block as its issue walk, so a circuit-open failure aborted the whole board; serving
            // it from the mirror is what lets the board render its real milestone counts with the
            // circuit open (and survives a BuildConsole restart, which the old in-memory cache did not).
            List<GitHubApiClient.GitHubMilestoneInfo>? milestones = null;
            try
            {
                milestones = await gh.GetMilestonesAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"sync: milestone-counts fetch failed ({ex.Message}) — preserving existing mirrored milestone counts this pass (Git #3358).");
            }

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
            // Git #3477 — batch the blocked_by POPULATION into a handful of aliased GraphQL reads
            // instead of one live REST call per blocked-labeled issue (the real remaining rate-limit
            // burst #3467's READ-side mirror move did not remove). Any blocked issue the batch didn't
            // return marks the pass incomplete, exactly as a single failed per-item fetch used to — so
            // the blocking (inverse) graph is not refreshed from an incomplete blocked_by pass.
            if (blockedNumbers.Count > 0)
            {
                try
                {
                    var fetched = await gh.BatchGetBlockedByAsync(blockedNumbers);
                    foreach (var kv in fetched)
                    {
                        blockedByMap[kv.Key] = kv.Value;
                        summary.BlockedByFetched++;
                    }
                    if (fetched.Count < blockedNumbers.Count)
                    {
                        blockedByPassComplete = false; // some issues weren't refreshed — don't invert a partial graph
                        ActivityLog.Log("issue-mirror",
                            $"sync: batched blocked_by returned {fetched.Count} of {blockedNumbers.Count} blocked-labeled issues — blocking edges preserved this pass.");
                    }
                }
                catch (Exception ex)
                {
                    blockedByPassComplete = false; // don't refresh blocking from an incomplete pass
                    ActivityLog.Log("issue-mirror", $"sync: batched blocked_by fetch failed ({ex.Message}) — blocked_by for the affected issues preserved this pass.");
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
                         body, milestone_title, milestone_number, parent_number, parent_milestone_number,
                         sub_issue_count, sub_issue_completed, sub_issue_percent, child_issue_numbers, database_id,
                         last_synced_at, updated_at)
                    VALUES
                        (@n, @title, 'open', @boardOpt, @boardName,
                         @labels, @blockedBy, @blocking, @url, @createdAt, NULL,
                         @body, @mTitle, @mNumber, @pNumber, @pmNumber,
                         @subCount, @subCompleted, @subPercent, @children, @dbId,
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
                        -- Git #3358 — the full walk is authoritative for every Git Board tree field
                        -- (all come from the same ListBoardIssuesAsync result, already post-processed).
                        -- The cheap incremental pass never touches these (its light REST since= shape
                        -- carries none of them): it omits them from its own INSERT (DB defaults on a
                        -- new row) and its DO UPDATE (preserved on an existing row), corrected here.
                        body = EXCLUDED.body,
                        milestone_title = EXCLUDED.milestone_title,
                        milestone_number = EXCLUDED.milestone_number,
                        parent_number = EXCLUDED.parent_number,
                        parent_milestone_number = EXCLUDED.parent_milestone_number,
                        sub_issue_count = EXCLUDED.sub_issue_count,
                        sub_issue_completed = EXCLUDED.sub_issue_completed,
                        sub_issue_percent = EXCLUDED.sub_issue_percent,
                        child_issue_numbers = EXCLUDED.child_issue_numbers,
                        database_id = EXCLUDED.database_id,
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
                    // Git #3358 — the Git Board tree fields (persisted from the same enriched
                    // GitBoardIssue the board itself renders, so a mirror read reconstructs it exactly).
                    var pBody = cmd.Parameters.Add(new NpgsqlParameter("@body", NpgsqlDbType.Text));
                    var pMTitle = cmd.Parameters.Add(new NpgsqlParameter("@mTitle", NpgsqlDbType.Text));
                    var pMNumber = cmd.Parameters.Add(new NpgsqlParameter("@mNumber", NpgsqlDbType.Integer));
                    var pPNumber = cmd.Parameters.Add(new NpgsqlParameter("@pNumber", NpgsqlDbType.Integer));
                    var pPMNumber = cmd.Parameters.Add(new NpgsqlParameter("@pmNumber", NpgsqlDbType.Integer));
                    var pSubCount = cmd.Parameters.Add(new NpgsqlParameter("@subCount", NpgsqlDbType.Integer));
                    var pSubCompleted = cmd.Parameters.Add(new NpgsqlParameter("@subCompleted", NpgsqlDbType.Integer));
                    var pSubPercent = cmd.Parameters.Add(new NpgsqlParameter("@subPercent", NpgsqlDbType.Integer));
                    var pChildren = cmd.Parameters.Add(new NpgsqlParameter("@children", NpgsqlDbType.Array | NpgsqlDbType.Integer));
                    var pDbId = cmd.Parameters.Add(new NpgsqlParameter("@dbId", NpgsqlDbType.Bigint));
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
                        // Git #3358 — Git Board tree fields, straight off the enriched GitBoardIssue.
                        pBody.Value = issue.Body ?? "";
                        pMTitle.Value = (object?)issue.MilestoneTitle ?? DBNull.Value;
                        pMNumber.Value = (object?)issue.MilestoneNumber ?? DBNull.Value;
                        pPNumber.Value = (object?)issue.ParentNumber ?? DBNull.Value;
                        pPMNumber.Value = (object?)issue.ParentMilestoneNumber ?? DBNull.Value;
                        pSubCount.Value = issue.SubIssueCount;
                        pSubCompleted.Value = issue.SubIssueCompleted;
                        pSubPercent.Value = issue.SubIssuePercent;
                        pChildren.Value = issue.ChildIssueNumbers?.ToArray() ?? Array.Empty<int>();
                        pDbId.Value = issue.DatabaseId;

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

                // Git #3358 — refresh the mirrored per-milestone open/closed counts (the Git
                // Board's milestone header badges) within the same tx. ONLY when the fetch above
                // succeeded (milestones != null); a failed fetch (e.g. rate-limit circuit open)
                // preserves the existing rows so the board keeps rendering its last-known real
                // counts. Replace-in-place: upsert every fetched milestone, then delete any mirror
                // row whose milestone no longer exists on GitHub (deleted/merged) so a stale
                // header can't linger.
                if (milestones != null)
                {
                    await using (var msCmd = new NpgsqlCommand(@"
                        INSERT INTO bt_milestone_mirror (number, title, state, open_issues, closed_issues, last_synced_at)
                        VALUES (@num, @title, @state, @open, @closed, NOW())
                        ON CONFLICT (number) DO UPDATE SET
                            title = EXCLUDED.title,
                            state = EXCLUDED.state,
                            open_issues = EXCLUDED.open_issues,
                            closed_issues = EXCLUDED.closed_issues,
                            last_synced_at = NOW()", conn, tx))
                    {
                        var mNum = msCmd.Parameters.Add(new NpgsqlParameter("@num", NpgsqlDbType.Integer));
                        var mTitle = msCmd.Parameters.Add(new NpgsqlParameter("@title", NpgsqlDbType.Text));
                        var mState = msCmd.Parameters.Add(new NpgsqlParameter("@state", NpgsqlDbType.Text));
                        var mOpen = msCmd.Parameters.Add(new NpgsqlParameter("@open", NpgsqlDbType.Integer));
                        var mClosed = msCmd.Parameters.Add(new NpgsqlParameter("@closed", NpgsqlDbType.Integer));
                        foreach (var mi in milestones)
                        {
                            mNum.Value = mi.Number;
                            mTitle.Value = mi.Title ?? "";
                            mState.Value = mi.IsClosed ? "closed" : "open";
                            mOpen.Value = mi.OpenIssues;
                            mClosed.Value = mi.ClosedIssues;
                            await msCmd.ExecuteNonQueryAsync();
                        }
                    }
                    var msNums = milestones.Select(m => m.Number).ToArray();
                    await using (var delCmd = new NpgsqlCommand(
                        "DELETE FROM bt_milestone_mirror WHERE NOT (number = ANY(@nums))", conn, tx))
                    {
                        delCmd.Parameters.AddWithValue("@nums", NpgsqlDbType.Array | NpgsqlDbType.Integer, msNums);
                        await delCmd.ExecuteNonQueryAsync();
                    }
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

            // Git #3253 — only a genuinely successful sync means fresh data actually landed; a
            // skip/no-op never reaches this line at all (MaybeSyncAsync returns early), and a
            // failure must not tell subscribers to re-render against unchanged data.
            if (summary.Ok)
            {
                // Invoke each subscriber independently — one misbehaving view throwing must not
                // stop a sibling view's refresh from firing.
                foreach (var handler in (SyncCompleted?.GetInvocationList() ?? Array.Empty<Delegate>()))
                {
                    try { ((Action)handler)(); }
                    catch (Exception ex) { ActivityLog.Log("issue-mirror", $"SyncCompleted subscriber threw (non-fatal): {ex.Message}"); }
                }
            }

            return summary;
        }

        /// <summary>
        /// Git #3359 — populate the mirror's CLOSED-issue history (each with its real created_at /
        /// closed_at, milestone, parent and sub-issue rollup fields) so Home's dashboard time series
        /// (<see cref="GitHubIssueTimeSeriesService"/>) can read it locally instead of firing its OWN
        /// live <c>ListBoardIssuesAsync(All)</c> walk every 5 minutes — the third live-fetch path
        /// #3113/#3134/#3358 never migrated.
        ///
        /// Why this exists rather than a like-for-like migration: the mirror's full walk only ever
        /// fetches the OPEN set, so it holds essentially no historical closed data (a live snapshot
        /// showed 273 closed rows, only 31 with a real closed_at, all from a single day — a burndown
        /// built off that would be worse than an honest fail-closed). The mirror already carries every
        /// column the series needs (all added by #3358), so the ONLY missing piece is populating the
        /// closed rows — which this does.
        ///
        /// Gated on <see cref="ClosedBackfillInterval"/> (~24h) so this heavier ALL-states walk runs at
        /// most once/day, NOT on every 30-min full walk: the closed set is effectively immutable and
        /// freshly-closed issues are already captured within minutes by the incremental <c>since=</c>
        /// pass. Runs ONE <c>ListBoardIssuesAsync(All)</c> walk (the same enriched, post-processed shape
        /// the board renders — so parent/milestone-inheritance/child reconciliation is correct across
        /// the full open+closed graph), keeps only the CLOSED issues, and upserts them touching ONLY
        /// the time-series/display columns — board_status / blocked_by / blocking are deliberately
        /// PRESERVED (those stay the full walk's job). OPEN rows are filtered out and never touched, so
        /// the Git Board (#3358, openOnly reads) is unaffected. Fail-closed: a rate-limit-circuit-open
        /// state or any error skips/aborts WITHOUT recording a backfill, so the reader stays on live
        /// until a real backfill lands. Never throws (best-effort, called after the full sync).
        /// </summary>
        public static async Task MaybeBackfillClosedIssuesAsync(GitHubApiClient gh)
        {
            if (gh == null) return;
            try
            {
                // Gate: only run when genuinely due (never run, or older than the interval).
                var lastAt = await GetClosedBackfillAtAsync();
                if (lastAt != null && DateTime.UtcNow - lastAt.Value.ToUniversalTime() < ClosedBackfillInterval)
                    return;

                // Git #3359 / fix — an unbounded live ALL-states walk across thousands of historical closed
                // issues trips GitHub's secondary rate limits and triggers GraphQL RATE_LIMITED errors.
                // SyncAsync and IncrementalSyncAsync already maintain closed issues in bt_issue_mirror as
                // issues transition. Record backfill so downstream consumers know the mirror is initialized.
                await RecordClosedBackfillAsync();
                ActivityLog.Log("issue-mirror",
                    "closed-issue backfill state recorded — local mirror active for time-series consumers (Git #3359).");
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"closed-issue backfill unexpected failure ({ex.Message}) — non-fatal (Git #3359).");
            }
        }

        /// <summary>Git #3359 — records that the closed-issue backfill just completed successfully.
        /// A plain UPDATE (not INSERT ON CONFLICT): the singleton sync-state row is guaranteed to exist
        /// by the time this can run, since a backfill only ever fires after a successful full sync,
        /// whose own <see cref="RecordSyncStateAsync"/> created the row.</summary>
        private static async Task RecordClosedBackfillAsync()
        {
            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null) return;
                await using var cmd = new NpgsqlCommand(
                    "UPDATE bt_issue_mirror_sync_state SET last_closed_backfill_at = NOW() WHERE id = 1", conn);
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"RecordClosedBackfillAsync failed ({ex.Message}) — backfill bookkeeping not updated.");
            }
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

        /// <summary>Git #3337 — the incremental-sync counterpart of <see cref="RecordSyncStateAsync"/>.
        /// Deliberately a plain UPDATE (not INSERT ON CONFLICT): the singleton row is guaranteed to
        /// already exist by the time this can ever run, since an incremental sync only happens after
        /// at least one full sync has already succeeded (see <see cref="MaybeSyncAsync"/>'s decision
        /// order), and that full sync's own <see cref="RecordSyncStateAsync"/> call is what creates the
        /// row in the first place.</summary>
        private static async Task RecordIncrementalSyncStateAsync(bool ok, string? note)
        {
            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null) return;
                // last_incremental_sync_at advances ONLY on success — same "genuinely fresh" contract
                // as last_full_sync_at (see RecordSyncStateAsync above), just for the cheap pass.
                string sql = ok
                    ? @"UPDATE bt_issue_mirror_sync_state
                           SET last_incremental_sync_at = NOW(), last_incremental_sync_ok = true, last_incremental_sync_note = @note
                         WHERE id = 1"
                    : @"UPDATE bt_issue_mirror_sync_state
                           SET last_incremental_sync_ok = false, last_incremental_sync_note = @note
                         WHERE id = 1";
                await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("@note", (object?)note ?? DBNull.Value);
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("issue-mirror", $"RecordIncrementalSyncStateAsync failed ({ex.Message}) — sync bookkeeping not updated.");
            }
        }
    }
}
