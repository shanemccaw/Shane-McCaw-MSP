using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services.BuildMap
{
    /// <summary>
    /// Git #2475 (Build Chain Map, item #1 of #2473's structured index) — the real GitHub read
    /// layer. Given one Epic number, produces a <see cref="ChainDoc"/> whose every field traces to
    /// a real GitHub API response:
    ///
    ///   • Epic → Feature → Issue — GitHub's native sub-issues API
    ///     (<see cref="GitHubApiClient.GetSubIssuesAsync"/>), including the real priority order
    ///     GitHub itself stores for a parent's sub-issues (drag-reorderable in the GitHub UI; this
    ///     is NOT invented here — it's the literal order the endpoint returns).
    ///   • `blocked_by` edges — <see cref="GitHubApiClient.GetBlockedByAsync"/>, the real GitHub
    ///     issue-dependencies API, filtered to edges whose both endpoints are inside this Epic's
    ///     chain and classified fanin/gate/manual by direct application of
    ///     BUILD_QUEUE_METHOD.md §5.2's stated rule (see <see cref="ClassifyEdgeKind"/>).
    ///   • Board Status — <see cref="GitHubApiClient.GetIssueBoardStatusAsync"/>, the real
    ///     `Status` field on project <c>PVT_kwHOEiBDdc4BeoiY</c> (same field/project the rest of
    ///     BuildConsole's Git Board and Batter Up panels already read/write).
    ///   • DONE — <see cref="DoneBookendVerifier"/>'s real §7 protocol: a `build-journal/&lt;n&gt;.md`
    ///     bookend on `origin/main` with a `DONE` status whose cited commit is both a real commit
    ///     object AND a genuine ancestor of `origin/main` (`git merge-base --is-ancestor`). This is
    ///     authoritative over the board's own "Done" label — a label can be stale or wrong; the
    ///     bookend + merge-ancestor check can't.
    ///
    /// No fixture data anywhere in this file. An Epic with zero real Features returns a ChainDoc
    /// with an empty Features list — a true, un-fabricated result, not a placeholder.
    ///
    /// <b>Scope note (read this before touching #2476):</b> this class performs a one-time, READ-ONLY
    /// classification of already-existing real `blocked_by` edges so the initial ChainDoc is valid
    /// and renderable (`Edge.Kind` and `Feature.Sentinel` are non-optional fields the UI needs from
    /// the first paint). It does not mutate anything on GitHub and does not implement the
    /// INTERACTIVE chain-rules engine (`rechainFanin`, `rechainGates`, `rechainAll`, the "Re-wire
    /// §5.2" button, drag-to-reorder edge regeneration) — that's #2476's own scope, operating on the
    /// ChainDoc this class produces. The two intentionally implement the same §5.2/§5.3 rule for two
    /// different purposes (classify vs. regenerate); #2476 may reuse or supersede
    /// <see cref="ClassifyEdgeKind"/> and <see cref="DefaultSentinel"/> rather than duplicate them.
    /// </summary>
    public static class BuildChainMapService
    {
        // Bounded concurrency for the per-issue GitHub reads (board status, blocked_by, comments,
        // bookend check) below — a real Epic in this project is ~10 Features / ~80-90 issues
        // (BuildMap/README.md's §10 worked example: 10 Features, 84 issues), so an unbounded
        // fan-out would be a real burst against GitHub's rate limit. GitHubApiClient's own
        // conditional-GET (ETag) cache and DoneBookendVerifier's own short-TTL cache still apply
        // underneath this.
        private const int MaxConcurrency = 8;

        private static readonly Regex BuildCommentHeaderRx =
            new(@"^BUILD:\s*model=(\S+)\s+effort=(\S+)", RegexOptions.Multiline | RegexOptions.Compiled);
        private static readonly Regex FeaturePrefixRx =
            new(@"^\s*Feature:\s*", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /// <summary>Builds the real ChainDoc for the given Epic issue number. Throws if the epic
        /// number itself doesn't resolve to a real GitHub issue (fail loud — a caller asking to map
        /// a non-existent Epic has a real bug, not something to paper over with an empty screen).</summary>
        public static async Task<ChainDoc> BuildAsync(GitHubApiClient client, int epicNumber)
        {
            var epicIssue = await client.GetIssueAsync(epicNumber)
                ?? throw new InvalidOperationException($"#{epicNumber} is not a real GitHub issue — cannot build a chain map for it.");

            var doc = new ChainDoc
            {
                Epic = new ChainEpic { Num = epicNumber, Name = StripFeaturePrefix(epicIssue.Title) },
            };

            // Real priority order: the literal order GitHub's sub_issues endpoint returns the
            // Epic's direct children in. Every direct sub-issue is a Feature-tier issue — GATE
            // issues sit at the same depth as any other Feature (BUILD_QUEUE_METHOD.md §1).
            var featureRefs = await client.GetSubIssuesAsync(epicNumber, bypassCache: true);

            using var gate = new SemaphoreSlim(MaxConcurrency);
            var featureTasks = featureRefs.Select(f => BuildFeatureAsync(client, f, gate));
            var features = (await Task.WhenAll(featureTasks)).ToList();

            doc.Features = features;
            doc.Order = features.Select(f => f.Id).ToList();

            // The full set of real issue numbers inside this Epic's chain — used to keep edges
            // scoped to nodes this ChainDoc actually renders (a blocked_by edge reaching outside
            // the Epic, e.g. to an Application Core Feature, is real but has no node to draw here).
            var knownNumbers = new HashSet<int>(features.SelectMany(f => f.Issues.Select(i => i.Num)));

            doc.Edges = await BuildEdgesAsync(client, features, knownNumbers, gate);
            doc.Gates = BuildGatesMap(features, doc.Edges);

            return doc;
        }

        private static async Task<ChainFeature> BuildFeatureAsync(GitHubApiClient client, GitHubSubIssue featureRef, SemaphoreSlim gate)
        {
            var name = StripFeaturePrefix(featureRef.Title);
            var feature = new ChainFeature
            {
                Id = "F" + featureRef.Number,
                Num = featureRef.Number,
                Name = name,
                Short = DeriveBuildSetShortName(name),
                HtmlUrl = featureRef.HtmlUrl,
            };

            var issueRefs = await client.GetSubIssuesAsync(featureRef.Number, bypassCache: true);
            var issueTasks = issueRefs.Select(i => BuildIssueAsync(client, i, gate));
            feature.Issues = (await Task.WhenAll(issueTasks)).ToList();

            feature.Sentinel = DefaultSentinel(feature.Issues);
            return feature;
        }

        private static async Task<ChainIssue> BuildIssueAsync(GitHubApiClient client, GitHubSubIssue issueRef, SemaphoreSlim gate)
        {
            await gate.WaitAsync();
            try
            {
                var ghClosed = string.Equals(issueRef.State, "CLOSED", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(issueRef.State, "closed", StringComparison.OrdinalIgnoreCase);

                // §7: a verified DONE bookend is authoritative for the `done` status, independent of
                // (and safer than) whichever board label the issue currently carries.
                var doneTask = DoneBookendVerifier.IsSatisfiedAsync(issueRef.Number);
                var boardTask = client.GetIssueBoardStatusAsync(issueRef.Number);
                var commentsTask = client.GetIssueCommentsAsync(issueRef.Number);

                await Task.WhenAll(doneTask, boardTask, commentsTask);

                var status = await doneTask
                    ? ChainStatus.Done
                    : MapBoardStatus((await boardTask)?.OptionId);

                var (model, effort) = ParseLatestBuildComment(await commentsTask);

                return new ChainIssue
                {
                    Num = issueRef.Number,
                    Title = issueRef.Title,
                    Status = status,
                    Model = model,
                    Effort = effort,
                    HtmlUrl = issueRef.HtmlUrl,
                    IsClosed = ghClosed,
                };
            }
            finally
            {
                gate.Release();
            }
        }

        /// <summary>
        /// Narrows GitHub's real Status field (14 real options on this project — see
        /// GitHubApiClient's DoneOptionId/AskShaneOptionId/BacklogOptionId/BatterUpPromoteOptionId
        /// and neighbors) down to the ChainDoc's 4-value vocabulary. Only the two options the §5/§6
        /// cascade rules name explicitly (`Batter Up`, `Ask Shane`) map directly; every other real
        /// option — `Backlog`, `AI Batter Up` (a review queue, not a launch queue — CLAUDE.md:
        /// "landing here triggers nothing"), `Park`, `Verifying`, `Crashed`, `In review`,
        /// `Architecting`, `In progress`, `Need to Test`, `Zoho`, `EngageBay`, `Shane Declined`, a
        /// `Done` label that DIDN'T pass the bookend check above, or the issue not being on the
        /// project at all — falls back to `backlog`, §6's own "held... anything not ready" bucket.
        /// This is a deliberate, documented narrowing, not an omission.
        /// </summary>
        private static ChainStatus MapBoardStatus(string? optionId)
        {
            if (string.Equals(optionId, GitHubApiClient.BatterUpPromoteOptionId, StringComparison.OrdinalIgnoreCase))
                return ChainStatus.Batter;
            if (string.Equals(optionId, GitHubApiClient.AskShaneOptionId, StringComparison.OrdinalIgnoreCase))
                return ChainStatus.Ask;
            return ChainStatus.Backlog;
        }

        /// <summary>§5.2 step 1: the highest-numbered cascade issue (status != Ask) by default. Null
        /// when the Feature has no cascade issues.</summary>
        private static int? DefaultSentinel(List<ChainIssue> issues)
        {
            var cascade = issues.Where(i => i.Status != ChainStatus.Ask).ToList();
            return cascade.Count == 0 ? null : cascade.Max(i => i.Num);
        }

        private static async Task<List<ChainEdge>> BuildEdgesAsync(
            GitHubApiClient client, List<ChainFeature> features, HashSet<int> knownNumbers, SemaphoreSlim gate)
        {
            var allIssueNums = features.SelectMany(f => f.Issues.Select(i => i.Num)).ToList();

            var rawTasks = allIssueNums.Select(async to =>
            {
                await gate.WaitAsync();
                try
                {
                    var blockers = await client.GetBlockedByAsync(to);
                    return blockers.Where(b => knownNumbers.Contains(b.Number))
                        .Select(b => (From: b.Number, To: to));
                }
                finally
                {
                    gate.Release();
                }
            });

            var rawEdges = (await Task.WhenAll(rawTasks)).SelectMany(e => e).Distinct().ToList();

            // §5.2's fan-in/gate pattern needs each issue's owning Feature + that Feature's cascade
            // + the Feature's sentinel + the real priority order — all already on hand.
            var featureByIssue = new Dictionary<int, ChainFeature>();
            foreach (var f in features)
                foreach (var i in f.Issues)
                    featureByIssue[i.Num] = f;

            var orderIndex = features.Select((f, idx) => (f.Id, idx)).ToDictionary(x => x.Id, x => x.idx);

            return rawEdges
                .Select(e => new ChainEdge
                {
                    From = e.From,
                    To = e.To,
                    Kind = ClassifyEdgeKind(e.From, e.To, featureByIssue, orderIndex),
                })
                .ToList();
        }

        /// <summary>
        /// Direct application of BUILD_QUEUE_METHOD.md §5.2 to a real, already-existing edge:
        ///   • fanin — `from` and `to` share a Feature, `to` is that Feature's sentinel, `from` != `to`.
        ///   • gate  — `to`'s Feature is the immediate next Feature (in real priority order) after
        ///             `from`'s Feature, AND `from` is `from`'s Feature's own sentinel.
        ///   • manual — anything else: a real GitHub blocked_by edge that doesn't match either
        ///             auto-generated §5.2 pattern, i.e. a human added it deliberately.
        /// </summary>
        private static ChainEdgeKind ClassifyEdgeKind(
            int from, int to,
            Dictionary<int, ChainFeature> featureByIssue,
            Dictionary<string, int> orderIndex)
        {
            if (!featureByIssue.TryGetValue(from, out var fromFeature) || !featureByIssue.TryGetValue(to, out var toFeature))
                return ChainEdgeKind.Manual;

            if (fromFeature.Id == toFeature.Id)
            {
                if (toFeature.Sentinel == to && from != to)
                    return ChainEdgeKind.FanIn;
                return ChainEdgeKind.Manual;
            }

            if (orderIndex.TryGetValue(fromFeature.Id, out var fromIdx)
                && orderIndex.TryGetValue(toFeature.Id, out var toIdx)
                && toIdx == fromIdx + 1
                && fromFeature.Sentinel == from)
            {
                return ChainEdgeKind.Gate;
            }

            return ChainEdgeKind.Manual;
        }

        /// <summary>
        /// §5.3's "manual gate" flag has no native GitHub field (Build Chain Map is the first thing
        /// to need it; real persistence is item #7 of #2473, not yet built). Derived here from real,
        /// observed board state: a downstream Feature reads as gated when a real §5.2 `gate` edge
        /// from the previous Feature's sentinel exists AND every one of its own cascade issues is
        /// currently sitting in Backlog rather than Batter Up — exactly the effect §5.3 describes
        /// ("Leave the gated Feature's issues in Backlog, not Batter Up").
        /// </summary>
        private static Dictionary<string, bool> BuildGatesMap(List<ChainFeature> features, List<ChainEdge> edges)
        {
            var gates = new Dictionary<string, bool>();
            for (int idx = 1; idx < features.Count; idx++)
            {
                var feature = features[idx];
                var cascade = feature.Issues.Where(i => i.Status != ChainStatus.Ask).ToList();
                bool hasGateEdgeIn = edges.Any(e => e.Kind == ChainEdgeKind.Gate
                    && cascade.Any(i => i.Num == e.To));
                bool allBacklog = cascade.Count > 0 && cascade.All(i => i.Status == ChainStatus.Backlog);
                gates[feature.Id] = hasGateEdgeIn && allBacklog;
            }
            return gates;
        }

        /// <summary>BUILD_QUEUE_METHOD.md §4.2: PascalCase, no spaces, mechanically derived from the
        /// real Feature title — e.g. "Feature: Alerts and Critters" → "AlertsCritters".</summary>
        private static string DeriveBuildSetShortName(string featureNameWithoutPrefix)
        {
            var words = Regex.Split(featureNameWithoutPrefix, @"[^A-Za-z0-9]+")
                .Where(w => w.Length > 0);
            return string.Concat(words.Select(w => char.ToUpperInvariant(w[0]) + w.Substring(1)));
        }

        private static string StripFeaturePrefix(string title) => FeaturePrefixRx.Replace(title ?? "", "").Trim();

        /// <summary>Parses `model=`/`effort=` off the most recent real `BUILD:` comment header
        /// (BUILD_QUEUE_METHOD.md §4.1's exact format). Returns ("", "") when no BUILD comment
        /// exists yet — never a fabricated default.</summary>
        private static (string Model, string Effort) ParseLatestBuildComment(List<GitHubIssueComment> comments)
        {
            for (int i = comments.Count - 1; i >= 0; i--)
            {
                var m = BuildCommentHeaderRx.Match(comments[i].Body ?? "");
                if (m.Success)
                    return (m.Groups[1].Value, m.Groups[2].Value);
            }
            return ("", "");
        }
    }
}
