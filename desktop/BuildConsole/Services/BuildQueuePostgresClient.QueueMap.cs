using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Npgsql;

namespace BuildConsole.Services
{
    // ── Git #2109 — Dynamic Build Queue Map, Phase 1 data layer ────────────────────
    //
    // GetQueueMapAsync produces the single BuildQueueMap snapshot Phase 2 (#2110) binds
    // to. It:
    //   1. Reads the live queue rows (any pre-launch state, running, or recently failed)
    //      WITH the real timestamp columns (created_at / claimed_at / completed_at /
    //      updated_at) that the shared MapRow path deliberately doesn't expose.
    //   2. Resolves every declared blocker's LIVE GitHub open/closed state in ONE call,
    //      reusing the exact same fail-closed live-open-issue pattern GetNextAsync uses
    //      (Git #1600/#1904) — never the stale local queue-row status.
    //   3. Walks the full blocked-by graph and flags genuine deadlock cycles distinctly
    //      from long chains (BuildQueueMapAnalyzer.DetectCycles).
    //   4. Classifies failed/crashed/orphaned/limit-paused items and computes real age.
    //
    // No XAML, no rendering — that is Phase 2's job.
    public partial class BuildQueuePostgresClient
    {
        /// <summary>Rows the map cares about: everything still live plus genuinely-recent failures. A
        /// failed row older than this drops off the map (it's history, not a current queue condition).</summary>
        private static readonly TimeSpan DefaultRecentFailedWindow = TimeSpan.FromHours(24);

        /// <summary>Git #2109 — the whole live build-queue map: per-item live-checked blockers, genuine
        /// deadlock cycles, errors, and age. This is the Phase-1 deliverable; Phase 2 (#2110) renders it.</summary>
        /// <param name="liveOpenIssuesFetcher">Test seam, identical to <see cref="GetNextAsync"/>'s: defaults
        /// to a real live `gh issue list --state open` snapshot (<see cref="GitHubIssuesService.TryGetOpenIssueNumbersAsync"/>).</param>
        /// <param name="recentFailedWindow">How far back a failed row still counts as a current queue error.
        /// Defaults to <see cref="DefaultRecentFailedWindow"/>.</param>
        public async Task<BuildQueueMap> GetQueueMapAsync(
            Func<Task<LiveOpenIssuesResult>>? liveOpenIssuesFetcher = null,
            TimeSpan? recentFailedWindow = null)
        {
            var now = DateTimeOffset.UtcNow;
            var window = recentFailedWindow ?? DefaultRecentFailedWindow;

            // ── Step 1 — read the live rows WITH real timestamps ──────────────────────
            // A dedicated SELECT (not the shared MapRow path) precisely because the map needs
            // created_at/claimed_at/completed_at, which QueueItem/MapRow don't carry (and threading
            // them through every MapRow SELECT is the #1384 fixed-ordinal minefield). Ordered oldest-
            // first, the same claim order the watcher uses.
            const string sql = @"
                SELECT id, title, github_number, blocked_by_number, blocked_by_numbers,
                       status, exit_code, created_at, claimed_at, completed_at, updated_at
                FROM bt_build_queue
                ORDER BY created_at ASC";

            var rows = new List<QueueMapRow>();
            await using (var conn = await OpenAsync())
            await using (var cmd = new NpgsqlCommand(sql, conn))
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    var blockedByNumbersRaw = reader.IsDBNull(4) ? null : reader.GetValue(4) as int[];
                    rows.Add(new QueueMapRow
                    {
                        Id               = reader.GetInt32(0),
                        Title            = reader.IsDBNull(1) ? "" : reader.GetString(1),
                        GithubNumber     = reader.IsDBNull(2) ? (int?)null : reader.GetInt32(2),
                        BlockedByNumber  = reader.IsDBNull(3) ? (int?)null : reader.GetInt32(3),
                        BlockedByNumbers = blockedByNumbersRaw != null ? new List<int>(blockedByNumbersRaw) : null,
                        Status           = reader.IsDBNull(5) ? "queued" : reader.GetString(5),
                        ExitCode         = reader.IsDBNull(6) ? (int?)null : reader.GetInt32(6),
                        CreatedAt        = reader.IsDBNull(7) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(7),
                        ClaimedAt        = reader.IsDBNull(8) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(8),
                        CompletedAt      = reader.IsDBNull(9) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(9),
                        UpdatedAt        = reader.IsDBNull(10) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(10),
                    });
                }
            }

            // Keep the live queue + genuinely-recent failures; drop old terminal history
            // (done/canceled/superseded, and failures older than the window).
            var included = rows.Where(r => IsMapRelevant(r, now, window)).ToList();

            // ── Step 2 — resolve every distinct blocker's LIVE GitHub state, ONCE ─────
            // Same pattern as SelectClaimCandidatesAsync/GetNextAsync (Git #1600/#1904): gather all
            // distinct blocker numbers across every included item, hit GitHub's real open-issue set a
            // single time, and decide each blocker from that one snapshot. Fail-closed: an unreachable
            // check leaves every blocker's open-state UNKNOWN (null), never silently "closed".
            var itemBlockerNums = included.ToDictionary(r => r.Id, r => EffectiveBlockers(ToQueueItem(r)));
            var distinctBlockers = itemBlockerNums.Values.SelectMany(b => b).Distinct().ToList();

            LiveOpenIssuesResult? live = null;
            if (distinctBlockers.Count > 0)
            {
                live = await (liveOpenIssuesFetcher != null
                    ? liveOpenIssuesFetcher()
                    : GitHubIssuesService.TryGetOpenIssueNumbersAsync());
                if (!live.Success)
                {
                    ActivityLog.Log("watcher",
                        $"Git #2109: couldn't reach GitHub to live-check queue-map blocker state ({live.Error}) — reporting every blocker as UNKNOWN (fail closed) this pass.");
                }
            }
            bool reached = live == null || live.Success; // no blockers to check is trivially "reached"
            string? blockerError = (live != null && !live.Success) ? live.Error : null;

            // Which included items carry each issue number, so a blocker that IS another queue item is
            // linked back to it (cross-item dependency, the substrate for chains and cycles).
            var itemsByIssue = new Dictionary<int, int>(); // issue number → first item id owning it
            foreach (var r in included)
                if (r.GithubNumber is int g && g > 0 && !itemsByIssue.ContainsKey(g))
                    itemsByIssue[g] = r.Id;

            // ── Step 3 — detect genuine deadlock cycles across the full graph ─────────
            // Edge: item's own issue number → each issue it is blocked_by. Only positive github_numbers
            // are real graph nodes (a --notGit negative sentinel or null can't be depended on).
            var adjacency = BuildAdjacency(included);
            var cycles = BuildQueueMapAnalyzer.DetectCycles(adjacency);

            // issue number → its cycle index, for O(1) per-item lookup.
            var issueToCycle = new Dictionary<int, int>();
            var cycleModels = new List<QueueMapCycle>();
            for (int ci = 0; ci < cycles.Count; ci++)
            {
                var nums = cycles[ci];
                foreach (var n in nums)
                    if (!issueToCycle.ContainsKey(n)) issueToCycle[n] = ci;
                var memberIds = included
                    .Where(r => r.GithubNumber is int g && g > 0 && nums.Contains(g))
                    .Select(r => r.Id)
                    .ToList();
                cycleModels.Add(new QueueMapCycle { Id = ci, IssueNumbers = nums, QueueItemIds = memberIds });
            }

            // ── Step 4 — assemble the per-item models (blockers, cycle, error, age) ───
            var items = new List<BuildQueueMapItem>(included.Count);
            foreach (var r in included)
            {
                var blockerNums = itemBlockerNums[r.Id];
                var blockers = blockerNums.Select(num => new QueueMapBlocker
                {
                    Number = num,
                    // Live state: open/closed from the single snapshot, or null when unreachable/unchecked.
                    IsOpenOnGitHub = live == null ? (bool?)null
                                    : !live.Success ? (bool?)null
                                    : live.OpenNumbers.Contains(num),
                    IsQueueItem = itemsByIssue.ContainsKey(num),
                    BlockingQueueItemId = itemsByIssue.TryGetValue(num, out var oid) ? oid : (int?)null,
                }).ToList();

                bool inCycle = r.GithubNumber is int gnum && gnum > 0 && issueToCycle.ContainsKey(gnum);
                int? cycleId = inCycle ? issueToCycle[r.GithubNumber!.Value] : (int?)null;

                var (since, label) = BuildQueueMapAnalyzer.CurrentState(
                    r.Status, r.CreatedAt, r.ClaimedAt, r.CompletedAt, r.UpdatedAt);

                items.Add(new BuildQueueMapItem
                {
                    Id = r.Id,
                    Title = r.Title,
                    GithubNumber = r.GithubNumber,
                    Status = r.Status,
                    ExitCode = r.ExitCode,
                    Blockers = blockers,
                    IsInCycle = inCycle,
                    CycleId = cycleId,
                    ErrorKind = BuildQueueMapAnalyzer.ClassifyError(r.Status, r.ExitCode),
                    EnqueuedAt = r.CreatedAt,
                    CurrentStateSince = since,
                    Age = since is DateTimeOffset s ? now - s : (TimeSpan?)null,
                    TotalAge = r.CreatedAt is DateTimeOffset c ? now - c : (TimeSpan?)null,
                    CurrentStateLabel = label,
                });
            }

            return new BuildQueueMap
            {
                Items = items,
                Cycles = cycleModels,
                BlockerCheckReachedGitHub = reached,
                BlockerCheckError = blockerError,
                GeneratedAt = now,
            };
        }

        /// <summary>A row is on the map if it's still live (any active status) or a genuinely-recent
        /// failure. Old terminal history (done/canceled/superseded, or a failure past the window) is not
        /// a current queue condition and is excluded.</summary>
        private static bool IsMapRelevant(QueueMapRow r, DateTimeOffset now, TimeSpan window)
        {
            if (IsActiveStatus(r.Status)) return true;
            if (string.Equals(r.Status, "failed", StringComparison.OrdinalIgnoreCase))
            {
                var when = r.CompletedAt ?? r.UpdatedAt;
                return when == null || (now - when.Value) <= window;
            }
            return false;
        }

        /// <summary>The blocked-by digraph: issue number → issues it is blocked_by. Only positive
        /// github_numbers are nodes (a --notGit negative sentinel/null can't be depended upon). Several
        /// rows may share one issue number, so their blocker sets are unioned.</summary>
        private static Dictionary<int, HashSet<int>> BuildAdjacency(List<QueueMapRow> included)
        {
            var adjacency = new Dictionary<int, HashSet<int>>();
            foreach (var r in included)
            {
                if (r.GithubNumber is not int g || g <= 0) continue;
                if (!adjacency.TryGetValue(g, out var set))
                    adjacency[g] = set = new HashSet<int>();
                foreach (var b in EffectiveBlockers(ToQueueItem(r)))
                    set.Add(b);
            }
            return adjacency;
        }

        /// <summary>Reuse <see cref="EffectiveBlockers"/> without duplicating its precedence logic by
        /// wrapping the two blocker columns in a throwaway <see cref="QueueItem"/>.</summary>
        private static QueueItem ToQueueItem(QueueMapRow r) => new()
        {
            Id = r.Id,
            BlockedByNumber = r.BlockedByNumber,
            BlockedByNumbers = r.BlockedByNumbers,
        };

        /// <summary>Raw bt_build_queue row for the map query — carries the timestamp columns the shared
        /// QueueItem/MapRow path deliberately omits.</summary>
        private sealed class QueueMapRow
        {
            public int Id { get; init; }
            public string Title { get; init; } = "";
            public int? GithubNumber { get; init; }
            public int? BlockedByNumber { get; init; }
            public List<int>? BlockedByNumbers { get; init; }
            public string Status { get; init; } = "queued";
            public int? ExitCode { get; init; }
            public DateTimeOffset? CreatedAt { get; init; }
            public DateTimeOffset? ClaimedAt { get; init; }
            public DateTimeOffset? CompletedAt { get; init; }
            public DateTimeOffset? UpdatedAt { get; init; }
        }
    }
}
