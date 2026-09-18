using System;
using System.Collections.Generic;
using System.Linq;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #4693 (Feature #4692) — the one real answer to "is a build actually running on this issue
    /// right now?", read from BuildConsole's own local <c>bt_build_queue</c> rows instead of the
    /// GitHub <c>in-flight</c> label the Git Board used to trust.
    ///
    /// Why not the label: two independent writers (BuildConsole at queue time, the agent's own
    /// bookend at DONE) flipped it at the same lifecycle moments, and it could only refresh with a
    /// GitHub board fetch. The queue row is the single source of truth for "running", it changes the
    /// moment a build launches or ends, and reading it costs no GitHub call at all.
    ///
    /// <see cref="Controls.BuildQueuePanel"/> owns the 5-second local queue poll and is the only writer:
    /// it calls <see cref="Update"/> after every real queue fetch. Everything else (the Git Board
    /// tree, the search-result badge, the In-Flight tile) just reads <see cref="IsInFlight"/>.
    /// "Done" is deliberately NOT tracked here — that is the issue's own real
    /// <c>state == closed</c>, already carried on every board / search-result object.
    /// </summary>
    public static class LocalQueueActivity
    {
        /// <summary>The <c>bt_build_queue.status</c> values that count as in flight — exactly the
        /// set #4693 specifies: a queued build is committed work about to launch, a running build is
        /// live. Parked / limit-paused / external / verifying / terminal states are not.</summary>
        public static bool IsInFlightStatus(string? status) => status is "queued" or "running";

        /// <summary>True when <paramref name="item"/> is a queued/running build tied to a real GitHub
        /// issue in the repo this BuildConsole is configured for (issue numbers collide across repos
        /// under Multi-Repo #3578, so a secondary repo's #123 must never light up this repo's #123).</summary>
        public static bool IsInFlightRow(QueueItem item, string? mainOwnerRepo = null)
        {
            if (!item.GithubNumber.HasValue || !IsInFlightStatus(item.Status)) return false;
            mainOwnerRepo ??= BuildConsoleSettings.Load().GitHubOwnerRepo;
            return string.Equals(item.OwnerRepo, mainOwnerRepo, StringComparison.OrdinalIgnoreCase);
        }

        private static readonly object Gate = new();
        private static IReadOnlySet<int> _inFlight = new HashSet<int>();

        /// <summary>Raised (on whichever thread called <see cref="Update"/>) only when the set of
        /// in-flight issue numbers actually changed — never on an unchanged poll tick. Subscribers
        /// that touch UI must marshal to their own dispatcher.</summary>
        public static event Action? Changed;

        /// <summary>Snapshot of the issue numbers with a queued/running local build right now.</summary>
        public static IReadOnlySet<int> InFlightIssueNumbers
        {
            get { lock (Gate) return _inFlight; }
        }

        public static bool IsInFlight(int issueNumber) => InFlightIssueNumbers.Contains(issueNumber);

        /// <summary>Replaces the snapshot from a fresh read of the local queue. Idempotent; raises
        /// <see cref="Changed"/> only when the resulting set differs from the previous one.</summary>
        public static void Update(IEnumerable<QueueItem> queueItems)
        {
            var mainOwnerRepo = BuildConsoleSettings.Load().GitHubOwnerRepo;
            var next = queueItems
                .Where(i => IsInFlightRow(i, mainOwnerRepo))
                .Select(i => i.GithubNumber!.Value)
                .ToHashSet();

            bool changed;
            lock (Gate)
            {
                changed = !_inFlight.SetEquals(next);
                if (changed) _inFlight = next;
            }
            if (changed)
            {
                try { Changed?.Invoke(); }
                catch (Exception ex) { ActivityLog.Log("build-queue-panel", $"LocalQueueActivity.Changed subscriber threw: {ex.Message}"); }
            }
        }
    }
}
