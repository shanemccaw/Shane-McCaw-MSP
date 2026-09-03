using System;
using System.Collections.Generic;
using System.Linq;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2739 — the ONE shared "does this issue count as real work" predicate every real
    /// progress/report count in the app must apply before counting an issue: the milestone
    /// progress bar (<see cref="FocusModeService"/>), Home dashboard's burndown/rate-chart/ETA
    /// panels (<see cref="GitHubIssueTimeSeriesService.BuildSeries"/>), and the Git Board tree's
    /// per-Epic rollup pills (<c>LeftSidebar</c>). Defined once here, used everywhere, so the
    /// three consumers can never drift into three slightly-different definitions of "real work."
    ///
    /// Two independent real conditions exclude an issue, either is sufficient:
    ///   1. <see cref="IsPlaceholder"/> — the issue itself is a tier-level organizational holder
    ///      (a real Epic or a real Feature), not real work.
    ///   2. <see cref="IsUnderInternalToolingEpic"/> — the issue's real top-level Epic ancestor is
    ///      internal tooling (#1202 Build Console / #1095 Admin Panel), not customer-facing product
    ///      work, regardless of the issue's own tier.
    /// </summary>
    public static class GitBoardIssueFilters
    {
        /// <summary>
        /// Git #2739 scope amendment #1 — real top-level Epic numbers whose entire real descendant
        /// tree is internal tooling, not customer-facing product work, and is excluded from every
        /// real progress/report count regardless of each descendant's own tier.
        /// #1202 = EPIC: Build Console. #1095 = EPIC: Admin Panel.
        /// </summary>
        public static readonly IReadOnlySet<int> InternalToolingEpicNumbers = new HashSet<int> { 1202, 1095 };

        /// <summary>
        /// True iff <paramref name="issue"/> is a placeholder — a tier-level organizational holder,
        /// not real work — per Git #2739's shared definition:
        ///   - a real Epic, using #2677's exact <see cref="GitBoardIssue.IsEpic"/> definition, or
        ///   - a real Feature, using the established "Feature:" title-prefix convention
        ///     (BUILD_QUEUE_METHOD.md's own real Feature-title format).
        /// </summary>
        public static bool IsPlaceholder(GitBoardIssue issue)
        {
            if (issue == null) return false;
            if (issue.IsEpic) return true;
            return (issue.Title ?? "").TrimStart().StartsWith("Feature:", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// True iff <paramref name="issue"/>'s real top-level Epic ancestor is one of
        /// <see cref="InternalToolingEpicNumbers"/> — walks <see cref="GitBoardIssue.ParentNumber"/>
        /// to the top, the same real ancestor climb the transitive milestone-inheritance fix (Git
        /// #2543) already does elsewhere in this file's sibling <c>GitHubApiClient.cs</c>.
        /// <paramref name="byNumber"/> is the full known-issue lookup (every issue the caller has in
        /// hand, ideally ALL states) so the climb can resolve an ancestor even when it isn't in the
        /// caller's own scoped subset. A cyclic mis-link can't loop forever (visited-set guard).
        /// </summary>
        public static bool IsUnderInternalToolingEpic(GitBoardIssue issue, IReadOnlyDictionary<int, GitBoardIssue> byNumber)
        {
            if (issue == null) return false;
            if (InternalToolingEpicNumbers.Contains(issue.Number)) return true;

            var seen = new HashSet<int> { issue.Number };
            var cursor = issue.ParentNumber;
            while (cursor.HasValue && seen.Add(cursor.Value))
            {
                if (InternalToolingEpicNumbers.Contains(cursor.Value)) return true;
                if (!byNumber.TryGetValue(cursor.Value, out var parent)) break;
                cursor = parent.ParentNumber;
            }
            return false;
        }

        /// <summary>
        /// The one shared "counts as real work" test — NOT a placeholder AND NOT owned by an
        /// internal-tooling Epic. This is what every real progress/report count in Git #2739
        /// (milestone bar, Home dashboard, Git Board tree rollups) filters its issue set down to
        /// before counting.
        /// </summary>
        public static bool CountsAsRealWork(GitBoardIssue issue, IReadOnlyDictionary<int, GitBoardIssue> byNumber)
            => !IsPlaceholder(issue) && !IsUnderInternalToolingEpic(issue, byNumber);

        /// <summary>Convenience overload for a caller that already has its full issue set as a flat
        /// list — builds the by-number lookup once and applies <see cref="CountsAsRealWork(GitBoardIssue, IReadOnlyDictionary{int, GitBoardIssue})"/>.</summary>
        public static IReadOnlyDictionary<int, GitBoardIssue> BuildByNumberLookup(IEnumerable<GitBoardIssue> allIssues)
        {
            var byNumber = new Dictionary<int, GitBoardIssue>();
            foreach (var issue in allIssues)
                byNumber[issue.Number] = issue; // last-write-wins on a dup id; callers pass de-duped fetches in practice
            return byNumber;
        }

        /// <summary>
        /// Every transitive descendant of <paramref name="rootNumber"/> present in
        /// <paramref name="all"/> (children, grandchildren, …), excluding the root itself. Builds
        /// the parent→children adjacency from BOTH real directions the board fetch reconciles
        /// (<see cref="GitBoardIssue.ChildIssueNumbers"/> and each issue's
        /// <see cref="GitBoardIssue.ParentNumber"/>), and BFS-walks it with a visited-set so a
        /// cyclic mis-link can't loop forever. Shared by <see cref="GitHubIssueTimeSeriesService.GetEpicSeriesAsync"/>
        /// (Git #2711) and the Git Board tree's transitive rollup pills (Git #2739) — one real walk,
        /// not two slightly-different ones.
        /// </summary>
        public static List<GitBoardIssue> CollectDescendants(IReadOnlyList<GitBoardIssue> all, int rootNumber)
        {
            var byNumber = all.GroupBy(i => i.Number).ToDictionary(g => g.Key, g => g.First());
            var children = new Dictionary<int, HashSet<int>>();
            void AddChild(int parent, int child)
            {
                if (parent == child) return;
                if (!children.TryGetValue(parent, out var set)) { set = new HashSet<int>(); children[parent] = set; }
                set.Add(child);
            }
            foreach (var issue in all)
            {
                if (issue.ParentNumber.HasValue) AddChild(issue.ParentNumber.Value, issue.Number);
                foreach (var c in issue.ChildIssueNumbers) AddChild(issue.Number, c);
            }

            var result = new List<GitBoardIssue>();
            var visited = new HashSet<int> { rootNumber };
            var queue = new Queue<int>();
            queue.Enqueue(rootNumber);
            while (queue.Count > 0)
            {
                var cur = queue.Dequeue();
                if (!children.TryGetValue(cur, out var kids)) continue;
                foreach (var kid in kids)
                {
                    if (!visited.Add(kid)) continue;
                    if (byNumber.TryGetValue(kid, out var kidIssue)) result.Add(kidIssue);
                    queue.Enqueue(kid);
                }
            }
            return result;
        }

        /// <summary>
        /// Git #2739 — real, placeholder-filtered open/closed issue counts per real GitHub Milestone
        /// number, computed from a real ALL-states issue set. Shared by every real per-milestone
        /// progress consumer (Focus Mode's progress bar, the Git Board tree's own milestone-node
        /// badge) so they can never drift into two different counts for the same milestone — the
        /// exact "inconsistent second source of the same (wrong) number" this issue calls out.
        /// </summary>
        public static Dictionary<int, (int Open, int Closed)> ComputeRealMilestoneCounts(IReadOnlyList<GitBoardIssue> allIssues)
        {
            var byNumber = BuildByNumberLookup(allIssues);
            return allIssues
                .Where(i => i.MilestoneNumber.HasValue && CountsAsRealWork(i, byNumber))
                .GroupBy(i => i.MilestoneNumber!.Value)
                .ToDictionary(g => g.Key, g => (g.Count(i => !i.IsClosed), g.Count(i => i.IsClosed)));
        }

        /// <summary>
        /// Git #2739 — the real, transitively-computed rollup for one Epic/Feature node in the Git
        /// Board tree: walks <paramref name="root"/>'s FULL real descendant tree (Features → their
        /// real child Issues, arbitrarily deep — not just direct sub-issues), then counts only real
        /// leaf work (<see cref="CountsAsRealWork"/> — no Epic/Feature placeholder counted as "1",
        /// no internal-tooling-Epic-owned issue counted at all). Replaces GitHub's native
        /// <c>subIssuesSummary</c> fields (<see cref="GitBoardIssue.SubIssueCount"/> /
        /// <see cref="GitBoardIssue.SubIssueCompleted"/>), which only ever count DIRECT sub-issues
        /// one level down (Epic→Feature), never the full transitive tree (Epic→Feature→Issue) — the
        /// exact "53 sub, really just the Feature count" bug this issue reports.
        /// <paramref name="allIssues"/> should be the real ALL-states issue set (open + closed) so a
        /// completed Feature's already-closed child Issues are still counted.
        /// </summary>
        public static (int Total, int Closed) ComputeTransitiveLeafRollup(GitBoardIssue root, IReadOnlyList<GitBoardIssue> allIssues)
        {
            var byNumber = BuildByNumberLookup(allIssues);
            var descendants = CollectDescendants(allIssues, root.Number);
            var realLeaves = descendants.Where(i => CountsAsRealWork(i, byNumber)).ToList();
            return (realLeaves.Count, realLeaves.Count(i => i.IsClosed));
        }
    }
}
