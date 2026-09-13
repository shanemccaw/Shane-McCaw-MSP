using System;
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
        /// <summary>Git #3871 — bound on how many DISTINCT issue numbers one <see cref="ResolveTopEpicsAsync"/>
        /// call will spend a live GitHub fallback fetch on. A big rollup render can have many rows
        /// dead-end locally at once (e.g. right after a burst of newly-created/closed issues, before the
        /// next full sync lands); this cap is what keeps that a small, bounded top-up rather than a
        /// rate-limit storm on every render. <see cref="GitHubApiClient.BatchGetParentInfoAsync"/> itself
        /// chunks in groups of 25, so this allows a couple of chunks at most per resolve call.</summary>
        private const int MaxLiveFallbackLookupsPerResolve = 40;

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
        /// for at all (unknown locally) still resolves to the LAST real ancestor node the chain
        /// actually reached — the best real answer this local data can give — rather than being
        /// discarded.
        ///
        /// Git #3871 — <paramref name="gh"/> (optional; every pre-existing caller passed none, so
        /// omitting it preserves the original mirror-only behaviour exactly) enables a narrow, capped
        /// LIVE fallback for the one case that isn't a genuine "this issue is a top-level Epic": a node
        /// whose OWN locally-mirrored <c>parent_number</c> is null NOT because it's really un-parented
        /// but because <see cref="GitHubIssueMirror.IncrementalSyncAsync"/> hadn't yet closed the real
        /// sync gap that used to leave every brand-new/just-closed issue's parent unfilled until the
        /// next full walk (or, for an issue that closed before that walk saw it, the much slower closed
        /// backfill). Once the mirror-only walk above genuinely can't progress a node any further for
        /// this reason, ONE real GitHub GraphQL fetch (<see cref="GitHubApiClient.BatchGetParentInfoAsync"/>,
        /// itself already batched/chunked) is made for the small set of dead-ended nodes — never a
        /// wholesale resync, never more than <see cref="MaxLiveFallbackLookupsPerResolve"/> distinct
        /// numbers per call — and any real parent it reveals is fed straight back into the same
        /// mirror-based walk (the revealed parent is normally an older, already-mirrored Feature/Epic,
        /// so no further live calls are needed to get its title). A node that still resolves to nothing
        /// after this — GitHub itself confirms no parent, or the revealed parent still isn't mirrored —
        /// is genuinely a top-level Epic or a real local gap, not a sync-timing artifact.
        /// </summary>
        public static async Task<Dictionary<int, ResolvedEpic>> ResolveTopEpicsAsync(
            IEnumerable<(int IssueNumber, int? ParentNumber)> rows,
            GitHubApiClient? gh = null)
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

            await RunMirrorWalkAsync(cursorByIssue, seenByIssue, result);

            // Git #3871 — narrow live fallback, only when the caller opted in and only for nodes that
            // dead-ended with NO resolved parent purely because the last locally-known node's own
            // parent_number is null (never for the separate "ancestor number the mirror has no row for
            // at all" case above, which stays exactly as it was — that's a missing Feature/Epic mirror
            // row, not a sync-timing gap, and chasing it live would be the "wholesale resync" this fix
            // explicitly must not become).
            if (gh != null)
            {
                // The node whose real parent we actually want: the issue itself if the walk never
                // resolved anything for it at all (its OWN parent_number was null from the very start —
                // the confirmed #3864/#3865 shape), otherwise the last real ancestor node the mirror
                // walk did reach (that node's own parent_number was null).
                var liveTargets = new Dictionary<int, int>();
                foreach (var issueNumber in cursorByIssue.Keys)
                {
                    if (cursorByIssue[issueNumber].HasValue) continue; // still has a pending cursor — shouldn't happen post-walk, but skip defensively
                    liveTargets[issueNumber] = result.TryGetValue(issueNumber, out var last) ? last.Number : issueNumber;
                }

                if (liveTargets.Count > 0)
                {
                    var distinctNodes = liveTargets.Values.Distinct().ToList();
                    if (distinctNodes.Count > MaxLiveFallbackLookupsPerResolve)
                    {
                        ActivityLog.Log("issue-mirror",
                            $"EpicResolver live fallback: {distinctNodes.Count} distinct dead-ended node(s) exceeds the {MaxLiveFallbackLookupsPerResolve}-node cap — checking only the first {MaxLiveFallbackLookupsPerResolve} this pass (Git #3871).");
                        distinctNodes = distinctNodes.Take(MaxLiveFallbackLookupsPerResolve).ToList();
                    }

                    try
                    {
                        var live = await gh.BatchGetParentInfoAsync(distinctNodes);
                        bool anyRevealed = false;
                        foreach (var (issueNumber, node) in liveTargets)
                        {
                            if (!distinctNodes.Contains(node)) continue;
                            if (live.TryGetValue(node, out var info) && info.ParentNumber.HasValue
                                && seenByIssue[issueNumber].Add(info.ParentNumber.Value))
                            {
                                cursorByIssue[issueNumber] = info.ParentNumber;
                                anyRevealed = true;
                            }
                        }

                        if (anyRevealed)
                        {
                            // The live-revealed parent is normally an older, already-mirrored
                            // Feature/Epic — resume the ordinary (cheap, local) mirror walk so its
                            // real title comes from the mirror, not a second live call.
                            await RunMirrorWalkAsync(cursorByIssue, seenByIssue, result);
                        }
                    }
                    catch (Exception ex)
                    {
                        ActivityLog.Log("issue-mirror",
                            $"EpicResolver live fallback fetch failed ({ex.Message}) — affected issue(s) stay unresolved this pass, corrected by the next full walk (Git #3871).");
                    }
                }
            }

            return result;
        }

        /// <summary>The real mirror-only level-by-level walk (unchanged Git #3336 logic), factored out
        /// so <see cref="ResolveTopEpicsAsync"/> can run it once normally and, only when its live
        /// fallback actually revealed a new parent for at least one node, resume it once more from
        /// there — never a third pass.</summary>
        private static async Task RunMirrorWalkAsync(
            Dictionary<int, int?> cursorByIssue,
            Dictionary<int, HashSet<int>> seenByIssue,
            Dictionary<int, ResolvedEpic> result)
        {
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
        }
    }
}
