using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3336 — resolves an issue's real top-level Epic ancestor from the local
    /// <see cref="GitHubIssueMirror"/>'s already-persisted <c>parent_number</c> chain (landed via
    /// Git #3358 for the Git Board tree, unrelated to this fix — no new sync/migration needed).
    ///
    /// <c>parent_number</c> is each issue's IMMEDIATE parent — a Feature, for most real issues —
    /// not necessarily the top Epic; a Feature-tier issue's own <c>parent_number</c> points at its
    /// Epic. This walks the chain all the way to the real top (no further <c>parent_number</c>),
    /// reusing the exact cursor/seen-set walk shape <see cref="GitBoardIssueFilters.IsUnderInternalToolingEpic"/>
    /// already uses against its own live <see cref="GitBoardIssue"/>/byNumber model — same shape,
    /// adapted here to the mirror-backed <see cref="GitHubIssueMirror.MirrorIssue"/> model the three
    /// real consumers (Batter Up, AI Batter Up, the BUILD SETS rollup) actually read.
    /// </summary>
    public static class EpicResolver
    {
        /// <summary>The real resolved top-of-chain ancestor: its issue number and title, as mirrored.
        /// Not necessarily a true GitHub "Epic" in the tier sense — it's simply the end of the real
        /// parent_number chain (a genuinely un-parented top-level Epic, or the last node the mirror
        /// could resolve before the chain ran out of local data).</summary>
        public sealed class ResolvedEpic
        {
            public int Number { get; init; }
            public string Title { get; init; } = "";
        }

        /// <summary>
        /// Batch-resolves the real top ancestor for every <c>(IssueNumber, ParentNumber)</c> pair in
        /// <paramref name="rows"/>, walking each chain level-by-level with the ancestor lookups
        /// BATCHED per level (one <see cref="GitHubIssueMirror.GetManyAsync"/> round-trip per chain
        /// depth across ALL rows, not one round-trip per row) so N issues cost O(max chain depth)
        /// mirror reads rather than O(N). A per-issue visited-set guards against a cyclic mis-link the
        /// same way <see cref="GitBoardIssueFilters.IsUnderInternalToolingEpic"/> does.
        ///
        /// An issue with a null <see cref="ParentNumber"/> resolves to nothing (absent from the
        /// result) — a real top-level Epic directly, or a genuinely un-parented issue; callers treat
        /// an absent entry as "no group" and render it under their own honest "Ungrouped"/"No Epic"
        /// section, never silently. An issue whose chain hits an ancestor number the mirror has no row
        /// for (unknown locally) still resolves to the LAST real ancestor node the chain actually
        /// reached — the best real answer this local data can give — rather than being discarded.
        /// </summary>
        public static async Task<Dictionary<int, ResolvedEpic>> ResolveTopEpicsAsync(
            IEnumerable<(int IssueNumber, int? ParentNumber)> rows)
        {
            var result = new Dictionary<int, ResolvedEpic>();
            var seenByIssue = new Dictionary<int, HashSet<int>>();
            var cursorByIssue = new Dictionary<int, int?>();

            foreach (var (issueNumber, parentNumber) in rows)
            {
                if (cursorByIssue.ContainsKey(issueNumber)) continue; // de-dup a repeated issue number
                seenByIssue[issueNumber] = new HashSet<int> { issueNumber };
                cursorByIssue[issueNumber] = parentNumber;
            }

            while (true)
            {
                var pending = cursorByIssue.Values.Where(c => c.HasValue).Select(c => c!.Value).Distinct().ToList();
                if (pending.Count == 0) break;

                var fetched = await GitHubIssueMirror.GetManyAsync(pending);
                bool progressed = false;

                foreach (var issueNumber in cursorByIssue.Keys.ToList())
                {
                    var cursor = cursorByIssue[issueNumber];
                    if (!cursor.HasValue) continue;

                    if (!fetched.TryGetValue(cursor.Value, out var mirror))
                    {
                        // Unknown locally — can't go further up this chain; whatever was already
                        // resolved (the last real node reached) stands.
                        cursorByIssue[issueNumber] = null;
                        continue;
                    }

                    result[issueNumber] = new ResolvedEpic { Number = mirror.Number, Title = mirror.Title };

                    var seen = seenByIssue[issueNumber];
                    if (mirror.ParentNumber.HasValue && seen.Add(mirror.ParentNumber.Value))
                    {
                        cursorByIssue[issueNumber] = mirror.ParentNumber;
                        progressed = true;
                    }
                    else
                    {
                        // Reached the real top (no further parent), or a cyclic mis-link — stop either way.
                        cursorByIssue[issueNumber] = null;
                    }
                }

                if (!progressed) break;
            }

            return result;
        }
    }
}
