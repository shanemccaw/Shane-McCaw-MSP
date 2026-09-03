using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services.BuildMap
{
    /// <summary>
    /// Git #2481 (Build Chain Map, item #7 of #2473's structured index) — real GitHub persistence.
    ///
    /// #2479/#2480 shipped every Build Chain Map mutation (board status, sentinel via re-fan-in,
    /// manual gate, reorder, add/remove blocker, Re-wire §5.2) as an <b>in-memory <see cref="ChainDoc"/>
    /// write only</b>, deferring the real write to this issue. There is no localStorage in the WPF
    /// port — the "prototype's localStorage persistence" the dispatch names is, in this codebase, that
    /// in-memory-only state. This class replaces it with real, verifiable GitHub writes and audits
    /// every one of them by re-reading it back.
    ///
    /// It is deliberately <b>diff-based</b> rather than one bespoke write path per action: a mutation
    /// hands over a <see cref="ChainSnapshot"/> captured <i>before</i> it ran plus the current
    /// <see cref="ChainDoc"/>, and this class computes and applies exactly the real GitHub changes that
    /// produced the difference — no more, no less. That single mechanism covers all three write types
    /// the dispatch names, because every named action reduces to one or both of them:
    ///
    ///   • <b>blocked_by edge add/remove</b> (the real <c>dependencies/blocked_by</c> API) — covers
    ///     Add/Remove blocker, and the fan-in / cross-feature-gate edge churn a sentinel change,
    ///     reorder, status-to/from-Ask, or Re-wire §5.2 produces. Diffed by the raw <c>(from,to)</c>
    ///     pair only: GitHub stores no "edge kind", so a fanin/gate/manual re-classification of the
    ///     <i>same</i> pair is not a real change and must not churn a write.
    ///   • <b>board-column move</b> (the real <c>updateProjectV2ItemFieldValue</c> mutation) — covers
    ///     the four board-status buttons and the manual-gate toggle's Batter Up↔Backlog moves.
    ///
    /// The one write NOT expressible as an edge/board diff — persisting a Feature's sub-issue
    /// <b>priority order</b> itself — is Git #2498, now covered by <see cref="PersistReorderAsync"/>
    /// (GitHub's real `sub_issues/priority` reprioritize via
    /// <see cref="GitHubApiClient.ReprioritizeSubIssueAsync"/>), audited by re-reading the Epic's
    /// sub-issue order back. A reorder therefore persists both halves: its gate <c>blocked_by</c> edges
    /// through the diff above, and the raw ordering through that dedicated write.
    /// </summary>
    public sealed class ChainSnapshot
    {
        /// <summary>Every real blocked_by pair (<c>To</c> is blocked_by <c>From</c>), kind-agnostic.</summary>
        public HashSet<(int From, int To)> Edges { get; }

        /// <summary>Issue number → its <see cref="ChainStatus"/> at snapshot time.</summary>
        public Dictionary<int, ChainStatus> Statuses { get; }

        private ChainSnapshot(HashSet<(int, int)> edges, Dictionary<int, ChainStatus> statuses)
        {
            Edges = edges;
            Statuses = statuses;
        }

        /// <summary>Captures the persistable state of a <see cref="ChainDoc"/> at a moment in time.
        /// Called synchronously on the UI thread (before and after a mutation) so a later async
        /// write can diff two frozen points without racing a concurrent edit.</summary>
        public static ChainSnapshot Capture(ChainDoc doc)
        {
            var edges = new HashSet<(int, int)>(doc.Edges.Select(e => (e.From, e.To)));
            var statuses = new Dictionary<int, ChainStatus>();
            foreach (var f in doc.Features)
                foreach (var i in f.Issues)
                    statuses[i.Num] = i.Status;
            return new ChainSnapshot(edges, statuses);
        }
    }

    /// <summary>The real, audited outcome of persisting one mutation's diff to GitHub.</summary>
    public sealed class ChainPersistResult
    {
        public List<(int From, int To)> EdgesAdded { get; } = new();
        public List<(int From, int To)> EdgesRemoved { get; } = new();
        public List<(int Num, ChainStatus Status)> StatusChanges { get; } = new();

        /// <summary>A write that threw (or a board move that couldn't apply) — human-readable.</summary>
        public List<string> Failures { get; } = new();

        /// <summary>A write that returned success but whose re-read did NOT confirm the intended
        /// state — the audit half of "confirm each write actually landed by re-reading it back".</summary>
        public List<string> AuditMismatches { get; } = new();

        /// <summary>Every write that was both applied AND re-read-verified — the honest success set.</summary>
        public List<string> Verified { get; } = new();

        public int WritesIntended => EdgesAdded.Count + EdgesRemoved.Count + StatusChanges.Count;
        public bool NothingToDo => WritesIntended == 0;
        public bool AllVerified => Failures.Count == 0 && AuditMismatches.Count == 0;

        /// <summary>Compact one-liner for the status-strip confirmation.</summary>
        public string ShortSummary()
        {
            var parts = new List<string>();
            int edges = EdgesAdded.Count + EdgesRemoved.Count;
            if (edges > 0) parts.Add($"{edges} edge{(edges == 1 ? "" : "s")}");
            if (StatusChanges.Count > 0) parts.Add($"{StatusChanges.Count} board move{(StatusChanges.Count == 1 ? "" : "s")}");
            string what = parts.Count > 0 ? string.Join(", ", parts) : "no changes";
            if (AllVerified)
                return $"saved to GitHub ✓ {what}, re-read verified";
            int bad = Failures.Count + AuditMismatches.Count;
            return $"saved {Verified.Count}/{WritesIntended} to GitHub ⚠ {bad} unverified ({what})";
        }

        /// <summary>Full detail for the ActivityLog — one line per intended write and its real result.</summary>
        public IEnumerable<string> LogLines()
        {
            foreach (var v in Verified) yield return "  ✓ " + v;
            foreach (var m in AuditMismatches) yield return "  ✗ UNVERIFIED " + m;
            foreach (var f in Failures) yield return "  ✗ FAILED " + f;
        }
    }

    /// <summary>Git #2498 — the real, audited outcome of persisting one Feature priority reorder as a
    /// GitHub sub-issue reprioritize. Separate from <see cref="ChainPersistResult"/> because a reorder's
    /// real GitHub consequence is a sub-issue ORDER change, not the blocked_by/board diff that class
    /// covers — the two run together for a single reorder action and their summaries are merged.</summary>
    public sealed class ChainReorderResult
    {
        /// <summary>False when the move had no anchor to write (e.g. a single-Feature Epic) — a true
        /// no-op, not a failure.</summary>
        public bool Intended { get; init; }
        /// <summary>The write was applied AND the re-read confirmed the new adjacency landed.</summary>
        public bool Verified { get; init; }
        /// <summary>Human-readable success line (audit-confirmed) for the ActivityLog, when verified.</summary>
        public string? VerifiedLine { get; init; }
        /// <summary>Human-readable failure/mismatch reason, when not verified.</summary>
        public string? Failure { get; init; }

        public static ChainReorderResult NoOp() => new() { Intended = false, Verified = true };

        /// <summary>Compact clause folded into the reorder action's status-strip confirmation.</summary>
        public string ShortSummary()
        {
            if (!Intended) return "order unchanged";
            return Verified ? "order saved to GitHub ✓ re-read verified" : $"order NOT saved ⚠ {Failure}";
        }

        public IEnumerable<string> LogLines()
        {
            if (!Intended) yield break;
            if (Verified && VerifiedLine != null) yield return "  ✓ " + VerifiedLine;
            else if (!Verified) yield return "  ✗ UNVERIFIED " + Failure;
        }
    }

    public static class ChainPersistence
    {
        private static string OptionIdFor(ChainStatus status) => status switch
        {
            ChainStatus.Batter => GitHubApiClient.BatterUpPromoteOptionId,
            ChainStatus.Backlog => GitHubApiClient.BacklogOptionId,
            ChainStatus.Ask => GitHubApiClient.AskShaneOptionId,
            _ => GitHubApiClient.DoneOptionId,
        };

        private static string StatusLabel(ChainStatus status) => status switch
        {
            ChainStatus.Batter => "Batter Up",
            ChainStatus.Backlog => "Backlog",
            ChainStatus.Ask => "Ask Shane",
            _ => "Done",
        };

        /// <summary>
        /// Applies the real GitHub writes that turn <paramref name="before"/> into
        /// <paramref name="after"/>, then audits every applied write by re-reading it. Edge writes and
        /// board moves for the same issue are batched so the audit re-reads each affected issue once.
        /// </summary>
        public static async Task<ChainPersistResult> PersistAndAuditAsync(
            GitHubApiClient client, ChainSnapshot before, ChainSnapshot after)
        {
            var result = new ChainPersistResult();

            foreach (var pair in after.Edges)
                if (!before.Edges.Contains(pair)) result.EdgesAdded.Add(pair);
            foreach (var pair in before.Edges)
                if (!after.Edges.Contains(pair)) result.EdgesRemoved.Add(pair);
            foreach (var (num, status) in after.Statuses)
                if (before.Statuses.TryGetValue(num, out var was) && was != status)
                    result.StatusChanges.Add((num, status));

            if (result.NothingToDo) return result;

            // ── Apply edge writes (blocked_by add/remove) ────────────────────────────────────────
            // Track which writes actually succeeded so the audit only re-verifies applied changes
            // (a write that already threw is a known failure — no need to also report it unverified).
            var appliedAdds = new List<(int From, int To)>();
            var appliedRemoves = new List<(int From, int To)>();
            var appliedStatuses = new List<(int Num, ChainStatus Status)>();

            foreach (var (from, to) in result.EdgesAdded)
            {
                try { await client.SetBlockedByAsync(to, from); appliedAdds.Add((from, to)); }
                catch (Exception ex) { result.Failures.Add($"add #{to} blocked_by #{from}: {ex.Message}"); }
            }
            foreach (var (from, to) in result.EdgesRemoved)
            {
                try { await client.RemoveBlockedByEdgeAsync(to, from); appliedRemoves.Add((from, to)); }
                catch (Exception ex) { result.Failures.Add($"remove #{to} blocked_by #{from}: {ex.Message}"); }
            }
            foreach (var (num, status) in result.StatusChanges)
            {
                try
                {
                    bool ok = await client.SetIssueStatusByNumberAsync(num, OptionIdFor(status));
                    if (ok) appliedStatuses.Add((num, status));
                    else result.Failures.Add($"move #{num} → {StatusLabel(status)}: issue is not on the project board");
                }
                catch (Exception ex) { result.Failures.Add($"move #{num} → {StatusLabel(status)}: {ex.Message}"); }
            }

            // ── Audit: re-read every applied write back and confirm it landed ────────────────────
            // Edges are audited per affected `to` issue (one cache-bypassing blocked_by read serves
            // every add/remove touching that issue); board moves per issue via a fresh GraphQL read.
            var edgeToIssues = appliedAdds.Select(e => e.To).Concat(appliedRemoves.Select(e => e.To)).Distinct();
            var blockersByIssue = new Dictionary<int, HashSet<int>>();
            foreach (var to in edgeToIssues)
            {
                try
                {
                    var live = await client.GetBlockedByAsync(to, bypassCache: true);
                    blockersByIssue[to] = new HashSet<int>(live.Select(b => b.Number));
                }
                catch (Exception ex) { result.AuditMismatches.Add($"re-read of #{to}'s blockers failed: {ex.Message}"); }
            }

            foreach (var (from, to) in appliedAdds)
            {
                if (!blockersByIssue.TryGetValue(to, out var live)) continue; // read already reported failed
                if (live.Contains(from)) result.Verified.Add($"#{to} blocked_by #{from} (added)");
                else result.AuditMismatches.Add($"#{to} blocked_by #{from} — add did not show up on re-read");
            }
            foreach (var (from, to) in appliedRemoves)
            {
                if (!blockersByIssue.TryGetValue(to, out var live)) continue;
                if (!live.Contains(from)) result.Verified.Add($"#{to} no longer blocked_by #{from} (removed)");
                else result.AuditMismatches.Add($"#{to} blocked_by #{from} — still present on re-read after remove");
            }

            foreach (var (num, status) in appliedStatuses)
            {
                try
                {
                    var live = await client.GetIssueBoardStatusAsync(num);
                    string want = OptionIdFor(status);
                    if (live != null && string.Equals(live.OptionId, want, StringComparison.OrdinalIgnoreCase))
                        result.Verified.Add($"#{num} board status → {StatusLabel(status)}");
                    else
                        result.AuditMismatches.Add($"#{num} → {StatusLabel(status)} — board re-read shows '{live?.StatusName ?? "(not on board)"}'");
                }
                catch (Exception ex) { result.AuditMismatches.Add($"re-read of #{num}'s board status failed: {ex.Message}"); }
            }

            return result;
        }

        /// <summary>
        /// The single-edge fast path for the canvas "Add blocker…" link mode, whose mutation happens
        /// inside <c>ChainCanvasControl</c> and hands the window a precise <c>(from,to,wasNew)</c> —
        /// no snapshot needed. Persists the one real blocked_by edge and audits it the same way.
        /// </summary>
        public static async Task<ChainPersistResult> PersistSingleEdgeAddAsync(GitHubApiClient client, int from, int to)
        {
            var result = new ChainPersistResult();
            result.EdgesAdded.Add((from, to));
            try { await client.SetBlockedByAsync(to, from); }
            catch (Exception ex) { result.Failures.Add($"add #{to} blocked_by #{from}: {ex.Message}"); return result; }

            try
            {
                var live = await client.GetBlockedByAsync(to, bypassCache: true);
                if (live.Any(b => b.Number == from)) result.Verified.Add($"#{to} blocked_by #{from} (added)");
                else result.AuditMismatches.Add($"#{to} blocked_by #{from} — add did not show up on re-read");
            }
            catch (Exception ex) { result.AuditMismatches.Add($"re-read of #{to}'s blockers failed: {ex.Message}"); }

            return result;
        }

        /// <summary>
        /// Git #2498 — persists a single Feature priority reorder as a real GitHub sub-issue
        /// reprioritize, then audits it by re-reading the Epic's sub-issue order back. This is the one
        /// piece #2481's edge/board diff could not cover: a drag/arrow reorder splices
        /// <c>ChainDoc.Order</c> in memory and #2481 persists the gate <c>blocked_by</c> edges it
        /// regenerates, but the underlying sub-issue ORDER — what <see cref="BuildChainMapService"/>
        /// reads back as <c>doc.Order</c> — had no write primitive, so GitHub's old order won on the next
        /// refresh and <c>ClassifyEdgeKind</c> re-labelled the just-written gate edges as <c>manual</c>.
        ///
        /// <paramref name="newOrder"/> is the Feature ISSUE NUMBERS in their post-splice order (i.e. the
        /// order the Epic's sub-issues should now be in). The moved Feature is anchored to a genuine
        /// adjacent sibling — after its new predecessor, or (only when it lands at the very top) before its
        /// new successor — so the write never relies on GitHub's implicit "no anchor = top" semantics. The
        /// audit re-reads the Epic's live sub-issue numbers and confirms the moved Feature sits in exactly
        /// that relative position, the same re-read discipline every other write here uses.
        /// </summary>
        public static async Task<ChainReorderResult> PersistReorderAsync(
            GitHubApiClient client, int epicNumber, int movedFeatureNumber, IReadOnlyList<int> newOrder)
        {
            int idx = -1;
            for (int i = 0; i < newOrder.Count; i++)
                if (newOrder[i] == movedFeatureNumber) { idx = i; break; }

            // No anchor available (single-Feature Epic, or the moved Feature isn't in the order for some
            // reason): nothing real to write. A true no-op, reported as such rather than as a failure.
            if (idx < 0 || newOrder.Count < 2) return ChainReorderResult.NoOp();

            int? afterNumber = idx > 0 ? newOrder[idx - 1] : (int?)null;
            int? beforeNumber = idx == 0 ? newOrder[idx + 1] : (int?)null;

            try
            {
                await client.ReprioritizeSubIssueAsync(epicNumber, movedFeatureNumber, afterNumber, beforeNumber);
            }
            catch (Exception ex)
            {
                return new ChainReorderResult { Intended = true, Verified = false, Failure = $"reprioritize #{movedFeatureNumber} in Epic #{epicNumber}: {ex.Message}" };
            }

            // Audit: re-read the Epic's live sub-issue order (cache-bypassing) and confirm the moved
            // Feature now sits immediately after its intended predecessor / before its intended successor.
            List<int> liveNums;
            try
            {
                var live = await client.GetSubIssuesAsync(epicNumber, bypassCache: true);
                liveNums = live.Select(s => s.Number).ToList();
            }
            catch (Exception ex)
            {
                return new ChainReorderResult { Intended = true, Verified = false, Failure = $"re-read of Epic #{epicNumber}'s sub-issue order failed: {ex.Message}" };
            }

            int liveIdx = liveNums.IndexOf(movedFeatureNumber);
            if (liveIdx < 0)
                return new ChainReorderResult { Intended = true, Verified = false, Failure = $"#{movedFeatureNumber} not found in Epic #{epicNumber}'s sub-issues on re-read" };

            if (afterNumber.HasValue)
            {
                int anchor = liveNums.IndexOf(afterNumber.Value);
                if (anchor < 0 || liveIdx != anchor + 1)
                    return new ChainReorderResult { Intended = true, Verified = false, Failure = $"re-read shows #{movedFeatureNumber} is not immediately after #{afterNumber.Value}" };
                return new ChainReorderResult { Intended = true, Verified = true, VerifiedLine = $"#{movedFeatureNumber} reprioritized after #{afterNumber.Value} in Epic #{epicNumber}" };
            }
            else // beforeNumber has a value (idx == 0)
            {
                int anchor = liveNums.IndexOf(beforeNumber!.Value);
                if (anchor < 0 || liveIdx != anchor - 1)
                    return new ChainReorderResult { Intended = true, Verified = false, Failure = $"re-read shows #{movedFeatureNumber} is not immediately before #{beforeNumber.Value}" };
                return new ChainReorderResult { Intended = true, Verified = true, VerifiedLine = $"#{movedFeatureNumber} reprioritized to the top, before #{beforeNumber.Value}, in Epic #{epicNumber}" };
            }
        }
    }
}
