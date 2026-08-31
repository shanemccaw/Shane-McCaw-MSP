using System;
using System.Collections.Generic;
using System.Linq;

namespace BuildConsole.Services
{
    // ── Git #2109 — Dynamic Build Queue Map, Phase 1 (data layer) ──────────────────
    //
    // A single real snapshot of the live build queue that Phase 2 (#2110) binds to
    // directly: per-item live-checked blockers, genuine deadlock (cycle) detection
    // across the whole blocked-by graph, failed/crashed/orphaned items, and real age
    // computed from the timestamps already on bt_build_queue. No XAML, no rendering —
    // just a clear C# model plus the pure classifiers/graph walk that produce it.
    //
    // The DB read + live GitHub blocker check that assembles a BuildQueueMap lives in
    // BuildQueuePostgresClient.QueueMap.cs (GetQueueMapAsync) — it reuses the same
    // live-open-issue snapshot pattern GetNextAsync uses (Git #1600/#1904): never trust
    // a queue row's own cached status to decide whether a blocker is still open.

    /// <summary>Git #2109 — how a queue item ended up in an error condition, kept distinct
    /// so Phase 2 can style/triage each differently rather than lumping every non-zero
    /// exit together.</summary>
    public enum QueueMapErrorKind
    {
        /// <summary>Not an error.</summary>
        None = 0,
        /// <summary>status='failed' or a non-zero exit code that isn't one of the more specific
        /// kinds below — a build that ran to a real crash/failure conclusion.</summary>
        Failed,
        /// <summary>exit code -2 — <see cref="BuildQueuePostgresClient.MarkOrphanedFailedAsync"/>:
        /// the row was 'running' from a previous BuildConsole instance that died, and the orphan
        /// sweep (RecoverOrphanedRunningItemsAsync) marked it failed on restart.</summary>
        OrphanedByRestart,
        /// <summary>status='limit-paused' (<see cref="SessionLimitAutoRestartService.LimitPausedStatus"/>)
        /// — the CLI session hit the Claude usage limit. Surfaced as its own error kind per #2109's
        /// error scope (session-limit-related stalls while #2106 is still open), distinct from a
        /// genuine crash so Phase 2 can show "paused for limit" rather than "failed".</summary>
        SessionLimit,
    }

    /// <summary>Git #2109 — one blocker of a queue item, with its LIVE GitHub open/closed state
    /// (never the stale local queue-row state — see the class docs on the live-check pattern).</summary>
    public sealed class QueueMapBlocker
    {
        /// <summary>The blocking GitHub issue number.</summary>
        public int Number { get; init; }

        /// <summary>Live GitHub state this pass: <c>true</c> = open (still blocks), <c>false</c> = closed
        /// (cleared), <c>null</c> = GitHub was unreachable so the state is UNKNOWN. A null is treated as
        /// still-blocking (fail-closed, Git #1600) by <see cref="StillBlocking"/> — an unreachable check
        /// must never look identical to "closed, go ahead."</summary>
        public bool? IsOpenOnGitHub { get; init; }

        /// <summary>True when this blocker number is ALSO the github_number of another item currently in
        /// the map — i.e. the thing we're waiting on is itself a queued/running/failed build here, not an
        /// external issue. This is what makes cross-item chains and cycles possible.</summary>
        public bool IsQueueItem { get; init; }

        /// <summary>The queue item id whose github_number equals <see cref="Number"/>, when
        /// <see cref="IsQueueItem"/> is true; otherwise null.</summary>
        public int? BlockingQueueItemId { get; init; }

        /// <summary>Open OR unknown both hold the dependent (fail-closed). Only a blocker GitHub
        /// explicitly reports CLOSED releases it.</summary>
        public bool StillBlocking => IsOpenOnGitHub != false;
    }

    /// <summary>Git #2109 — a genuine dependency CYCLE (deadlock) in the blocked-by graph:
    /// A waits on B waits on C waits on A. Every node in it is permanently stuck with no single
    /// "obviously wrong" item, so it's flagged as its own distinct condition, not just a long chain.</summary>
    public sealed class QueueMapCycle
    {
        /// <summary>Stable 0-based index of this cycle within the snapshot (also each member item's
        /// <see cref="BuildQueueMapItem.CycleId"/>).</summary>
        public int Id { get; init; }

        /// <summary>The GitHub issue numbers forming the cycle, in traversal order (canonicalized to
        /// start at the smallest number so the same cycle is reported identically each pass). A
        /// single-element list is a self-loop (an item blocked_by its own issue number).</summary>
        public IReadOnlyList<int> IssueNumbers { get; init; } = Array.Empty<int>();

        /// <summary>The queue item ids whose github_number participates in this cycle. Several rows can
        /// share one issue number, so this can be longer than <see cref="IssueNumbers"/>.</summary>
        public IReadOnlyList<int> QueueItemIds { get; init; } = Array.Empty<int>();
    }

    /// <summary>Git #2109 — one queue item as it appears on the map: its live blocker state, whether it
    /// sits in a deadlock cycle, whether it errored, and how long it's been in its current state.</summary>
    public sealed class BuildQueueMapItem
    {
        public int Id { get; init; }
        public string Title { get; init; } = "";
        /// <summary>The GitHub issue this build is FOR, if any. Positive = a real issue; a negative
        /// sentinel is a --notGit LOCAL build (Git #1645); null = none. Only positive numbers form graph
        /// edges and can be blocked-on by other items.</summary>
        public int? GithubNumber { get; init; }
        public string Status { get; init; } = "queued";
        public int? ExitCode { get; init; }

        /// <summary>Every declared blocker with its live GitHub state.</summary>
        public IReadOnlyList<QueueMapBlocker> Blockers { get; init; } = Array.Empty<QueueMapBlocker>();

        /// <summary>True while any blocker is still open (or unknown/fail-closed).</summary>
        public bool IsBlocked => Blockers.Any(b => b.StillBlocking);

        /// <summary>The blockers still holding this item, for a ready "waiting on #N, #M" summary.</summary>
        public IReadOnlyList<QueueMapBlocker> UnresolvedBlockers => Blockers.Where(b => b.StillBlocking).ToList();

        /// <summary>True when this item's github_number is a node in a detected deadlock cycle.</summary>
        public bool IsInCycle { get; init; }
        /// <summary>The <see cref="QueueMapCycle.Id"/> this item belongs to, when <see cref="IsInCycle"/>.</summary>
        public int? CycleId { get; init; }

        public QueueMapErrorKind ErrorKind { get; init; }
        public bool IsError => ErrorKind != QueueMapErrorKind.None;

        /// <summary>created_at — when the row first entered the queue.</summary>
        public DateTimeOffset? EnqueuedAt { get; init; }
        /// <summary>Best-available "entered current state" timestamp (see the classifier): claimed_at for
        /// running, completed_at for terminal, else the last updated_at. Age is measured from here.</summary>
        public DateTimeOffset? CurrentStateSince { get; init; }
        /// <summary>now - <see cref="CurrentStateSince"/>: how long it's sat in its current state.</summary>
        public TimeSpan? Age { get; init; }
        /// <summary>now - <see cref="EnqueuedAt"/>: total lifetime in the queue.</summary>
        public TimeSpan? TotalAge { get; init; }
        /// <summary>Plain label for the current state bucket (e.g. "queued", "running", "failed").</summary>
        public string CurrentStateLabel { get; init; } = "";
    }

    /// <summary>Git #2109 — the whole live-queue snapshot Phase 2 (#2110) binds to.</summary>
    public sealed class BuildQueueMap
    {
        public IReadOnlyList<BuildQueueMapItem> Items { get; init; } = Array.Empty<BuildQueueMapItem>();

        /// <summary>Every genuine deadlock cycle detected across the full blocked-by graph.</summary>
        public IReadOnlyList<QueueMapCycle> Cycles { get; init; } = Array.Empty<QueueMapCycle>();

        /// <summary>False when the live GitHub open-issue check couldn't be reached this pass — every
        /// blocker's <see cref="QueueMapBlocker.IsOpenOnGitHub"/> is then null (unknown, fail-closed).
        /// Phase 2 shows "blocker state unverified" rather than pretending everything cleared.</summary>
        public bool BlockerCheckReachedGitHub { get; init; }
        /// <summary>The reason the live check failed, when <see cref="BlockerCheckReachedGitHub"/> is false.</summary>
        public string? BlockerCheckError { get; init; }

        public DateTimeOffset GeneratedAt { get; init; }

        public IEnumerable<BuildQueueMapItem> BlockedItems => Items.Where(i => i.IsBlocked);
        public IEnumerable<BuildQueueMapItem> ErrorItems => Items.Where(i => i.IsError);
        public IEnumerable<BuildQueueMapItem> CycleItems => Items.Where(i => i.IsInCycle);
        public bool HasCycles => Cycles.Count > 0;

        public static BuildQueueMap Empty(bool reached, string? error = null) => new()
        {
            Items = Array.Empty<BuildQueueMapItem>(),
            Cycles = Array.Empty<QueueMapCycle>(),
            BlockerCheckReachedGitHub = reached,
            BlockerCheckError = error,
            GeneratedAt = DateTimeOffset.UtcNow,
        };
    }

    /// <summary>Git #2109 — the pure (no-IO) classifiers and graph walk that turn raw queue rows into a
    /// <see cref="BuildQueueMap"/>. Kept static and side-effect-free so the deadlock detection is easy to
    /// reason about and exercise independently of the DB/GitHub layer.</summary>
    public static class BuildQueueMapAnalyzer
    {
        /// <summary>Classifies a row's error condition from its status + exit code. Order matters:
        /// the specific kinds (limit-paused, orphaned -2) are checked before the generic Failed.</summary>
        public static QueueMapErrorKind ClassifyError(string? status, int? exitCode)
        {
            if (string.Equals(status, SessionLimitAutoRestartService.LimitPausedStatus, StringComparison.OrdinalIgnoreCase))
                return QueueMapErrorKind.SessionLimit;
            if (exitCode == -2)
                return QueueMapErrorKind.OrphanedByRestart;
            if (string.Equals(status, "failed", StringComparison.OrdinalIgnoreCase))
                return QueueMapErrorKind.Failed;
            if (exitCode is int ec && ec != 0)
                return QueueMapErrorKind.Failed;
            return QueueMapErrorKind.None;
        }

        /// <summary>The "entered current state" timestamp + a plain state label, given the row's four
        /// real timestamps. Running measures from claimed_at; terminal states from completed_at; every
        /// pre-launch/pending state from the last updated_at (the column bumped on each status change),
        /// each falling back through updated_at → created_at when the preferred column is null.</summary>
        public static (DateTimeOffset? since, string label) CurrentState(
            string? status,
            DateTimeOffset? createdAt,
            DateTimeOffset? claimedAt,
            DateTimeOffset? completedAt,
            DateTimeOffset? updatedAt)
        {
            var s = status ?? "queued";
            if (string.Equals(s, "running", StringComparison.OrdinalIgnoreCase))
                return (claimedAt ?? updatedAt ?? createdAt, s);

            bool terminal =
                string.Equals(s, "done", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(s, "failed", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(s, "canceled", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(s, BuildQueuePostgresClient.VerifyingStatus, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(s, BuildQueuePostgresClient.SupersededStatus, StringComparison.OrdinalIgnoreCase);
            if (terminal)
                return (completedAt ?? updatedAt ?? createdAt, s);

            // queued / parked / capped / limit-paused / external / anything else pre-launch.
            return (updatedAt ?? createdAt, s);
        }

        /// <summary>
        /// Detects every genuine cycle in the blocked-by digraph. An edge runs FROM an item's own issue
        /// number TO each issue it is blocked_by ("waits on"), so a cycle A→B→C→A is a deadlock: each
        /// node waits on the next and none can ever proceed.
        ///
        /// Standard iterative DFS with white/gray/black coloring (gray = on the current recursion stack):
        /// encountering a gray node closes a cycle, which is sliced out of the current stack. Cycles are
        /// canonicalized (rotated to start at the smallest member) and de-duplicated so the same loop is
        /// reported once and identically each pass. Self-loops (a node blocked_by itself) are reported as
        /// single-element cycles. Long non-looping chains produce NO cycle — that's the whole point.
        /// </summary>
        /// <param name="adjacency">issue number → the issue numbers it is blocked_by (its out-edges).</param>
        public static List<List<int>> DetectCycles(IReadOnlyDictionary<int, HashSet<int>> adjacency)
        {
            var result = new List<List<int>>();
            var seenCanonical = new HashSet<string>();

            const int White = 0, Gray = 1, Black = 2;
            var color = new Dictionary<int, int>();
            foreach (var n in adjacency.Keys) color[n] = White;

            foreach (var start in adjacency.Keys)
            {
                if (color[start] != White) continue;

                // Iterative DFS. Each frame tracks the node and an enumerator over its out-edges so we
                // can find the exact back-edge that closes a cycle and recover the loop from the stack.
                var stack = new List<int>();                 // current DFS path (the gray nodes, in order)
                var iters = new List<IEnumerator<int>>();    // matching out-edge cursors

                stack.Add(start);
                color[start] = Gray;
                iters.Add(Neighbors(adjacency, start).GetEnumerator());

                while (stack.Count > 0)
                {
                    var it = iters[iters.Count - 1];
                    if (it.MoveNext())
                    {
                        int next = it.Current;
                        if (!adjacency.ContainsKey(next))
                            continue; // a blocker that is no item's issue number → a sink, can't be in a cycle

                        int c = color.TryGetValue(next, out var cc) ? cc : White;
                        if (c == Gray)
                        {
                            // Back-edge: 'next' is somewhere on the current path → cycle from there to here.
                            int idx = stack.LastIndexOf(next);
                            if (idx >= 0)
                            {
                                var cycle = stack.GetRange(idx, stack.Count - idx);
                                var canonical = Canonicalize(cycle);
                                var key = string.Join(",", canonical);
                                if (seenCanonical.Add(key))
                                    result.Add(canonical);
                            }
                        }
                        else if (c == White)
                        {
                            color[next] = Gray;
                            stack.Add(next);
                            iters.Add(Neighbors(adjacency, next).GetEnumerator());
                        }
                        // Black = fully explored, no new cycle through it from here.
                    }
                    else
                    {
                        // Done with this node — pop, mark black.
                        it.Dispose();
                        color[stack[stack.Count - 1]] = Black;
                        stack.RemoveAt(stack.Count - 1);
                        iters.RemoveAt(iters.Count - 1);
                    }
                }
            }

            return result;
        }

        private static IEnumerable<int> Neighbors(IReadOnlyDictionary<int, HashSet<int>> adjacency, int node)
            => adjacency.TryGetValue(node, out var set) ? set : Enumerable.Empty<int>();

        /// <summary>Rotate a cycle so it starts at its smallest member — a stable canonical form so the
        /// same loop discovered from a different entry point de-dupes to one entry.</summary>
        private static List<int> Canonicalize(List<int> cycle)
        {
            if (cycle.Count <= 1) return new List<int>(cycle);
            int minIdx = 0;
            for (int i = 1; i < cycle.Count; i++)
                if (cycle[i] < cycle[minIdx]) minIdx = i;
            var rotated = new List<int>(cycle.Count);
            for (int i = 0; i < cycle.Count; i++)
                rotated.Add(cycle[(minIdx + i) % cycle.Count]);
            return rotated;
        }
    }
}
