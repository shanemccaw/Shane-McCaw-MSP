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
    /// Not covered here (no primitive exists in the three named write types, and the dispatch does not
    /// name it): persisting a Feature's sub-issue <b>priority order</b> itself. A drag-reorder's real
    /// blocked_by (gate) consequences DO persist through the edge diff — the functional chain is
    /// correct on GitHub — but the raw sub-issue ordering is a separate GitHub write with no method on
    /// <see cref="GitHubApiClient"/>; see #2481's own findings for the filed gap.
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
    }
}
