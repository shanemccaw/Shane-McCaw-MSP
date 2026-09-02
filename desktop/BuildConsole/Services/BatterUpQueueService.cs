using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1709 — one Batter Up board row as the panel renders it: the real project-board
    /// item plus whatever this service could resolve about it (its `BUILD:` comment, its
    /// real GitHub blocked-by dependencies, and whether it's already tracked in the queue).
    /// </summary>
    public class BatterUpRow
    {
        public int Number { get; init; }
        public string Title { get; init; } = "";
        public string HtmlUrl { get; init; } = "";
        public string? Model { get; init; }
        public string? Effort { get; init; }
        public string? BuildSet { get; init; }
        /// <summary>Git #2131 — the `Posted: &lt;UTC ISO8601&gt;` line's parsed value, when the `BUILD:`
        /// comment carries one. Null for a legacy comment written before #2131 with no `Posted:`
        /// line — never backfilled, so its absence stays visible rather than being papered over.</summary>
        public DateTime? Posted { get; init; }
        /// <summary>Git #1870 — the resolved `BUILD:` comment prompt body, carried on the row so the
        /// manual per-row queue action (BatterUpPanel) can queue it without re-reading GitHub. Null
        /// when this item has no `BUILD:` comment yet (<see cref="HasBuildComment"/> is false).</summary>
        public string? Prompt { get; init; }
        /// <summary>False when this Batter Up item has no `BUILD:` comment yet — shown in the table, never auto-queued.</summary>
        public bool HasBuildComment { get; init; }
        /// <summary>Every real GitHub `blocked_by` dependency number declared on this issue (open or closed).</summary>
        public List<int> BlockedByNumbers { get; init; } = new();
        /// <summary>The subset of <see cref="BlockedByNumbers"/> GitHub currently reports still OPEN — the real
        /// open/closed display signal (Git #2225 keeps this as the honest GitHub-state badge). Note this is no
        /// longer the same thing as "genuinely still blocking": a blocker open here can still be safe to build
        /// on (see <see cref="SatisfiedByBookendNumbers"/> / <see cref="BlockingNumbers"/>).</summary>
        public List<int> OpenBlockedByNumbers { get; init; } = new();
        /// <summary>Git #2225 — the subset of <see cref="OpenBlockedByNumbers"/> that, although still OPEN on
        /// GitHub, is already satisfied by a real git-verified DONE bookend on origin/main (see
        /// <see cref="BuildConsole.Services.DoneBookendVerifier"/>). These no longer hold a dependent build.</summary>
        public List<int> SatisfiedByBookendNumbers { get; init; } = new();
        /// <summary>Git #2225 — the blockers GENUINELY still holding this item: open on GitHub AND not yet
        /// satisfied by a verified DONE bookend. This — not raw open/closed — is what "blocked" now means for the
        /// card, matching the live #1600 launch gate so the badge can't say "🔒 BLOCKED" on something that will
        /// actually auto-launch.</summary>
        public List<int> BlockingNumbers { get; init; } = new();
        public bool IsBlocked => BlockingNumbers.Count > 0;
        /// <summary>True when a `bt_build_queue` row already exists for this issue (any status) — this refresh left it alone.</summary>
        public bool AlreadyTracked { get; init; }
        /// <summary>Set true only on the refresh pass that actually inserted a fresh queue row for this item.</summary>
        public bool JustAutoQueued { get; set; }
        /// <summary>
        /// Git #1997 — when this item DOES have a `bt_build_queue` row but that row is terminal with
        /// no work landed (failed / canceled), the item is NOT dropped from the panel — it reappears
        /// here carrying the dead row's status, so a build that died in the queue can never go
        /// invisible in both places. Null on a normal Up-Next row (no dedup row, or the dedup row is
        /// still live / already done — those are hidden, not shown).
        /// </summary>
        public string? TrackedTerminalStatus { get; init; }
        /// <summary>Git #1997 — the id of the dead <see cref="TrackedTerminalStatus"/> row, so a manual
        /// Queue click re-queues that exact row (reuseRowId) instead of inserting a duplicate.</summary>
        public int? TrackedTerminalRowId { get; init; }
    }

    /// <summary>
    /// Git #1709 — reads the real "Batter Up" project-board status and parses each item's
    /// `BUILD:` comment. Git #1870 splits the old one-pass read+queue into two: the READ
    /// (<see cref="RefreshAsync"/>, which resolves and lists rows but QUEUES NOTHING) and the
    /// QUEUE (<see cref="QueueRowAsync"/>, which queues exactly one already-resolved row
    /// through the exact same <see cref="BuildQueuePostgresClient.QueueBuildAsync"/> path
    /// Queue / Send to Builder use). This is a new SOURCE feeding that one real pipeline, not
    /// a second launch mechanism. <see cref="RefreshAndAutoQueueAsync"/> is now just the free-
    /// flow composition of the two — the caller (BatterUpPanel) only invokes it when the Free
    /// flow gate is on; with the gate off it calls <see cref="RefreshAsync"/> alone. Blocked-by
    /// numbers are always passed straight through from GitHub's real dependency data so the
    /// existing #1600 fail-closed watcher (see BuildQueuePostgresClient.GetNextAsync) governs
    /// whether a queued item actually launches, exactly like every other launch path.
    /// </summary>
    public static class BatterUpQueueService
    {
        /// <summary>
        /// Parses a `BUILD:` comment body:
        /// <code>
        /// BUILD: model=claude-sonnet-5 effort=high buildSet=Portal
        /// Posted: 2026-08-31T23:23:47Z
        /// &lt;the rest of the comment is the self-contained prompt&gt;
        /// </code>
        /// The `Posted:` line (Git #2131) is optional — a legacy comment written before it was
        /// required has none, and that's not a parse failure, just a null <c>Posted</c>. When
        /// present it is consumed here so it never leaks into the returned <c>Prompt</c> text.
        /// Returns null if <paramref name="commentBody"/> doesn't start with a `BUILD:`
        /// header line, or the header line has no prompt text following it.
        /// </summary>
        public static (string? Model, string? Effort, string? BuildSet, DateTime? Posted, string Prompt)? ParseBuildComment(string commentBody)
        {
            if (string.IsNullOrWhiteSpace(commentBody)) return null;

            var lines = commentBody.Replace("\r\n", "\n").Split('\n');
            int headerIdx = Array.FindIndex(lines, l => l.TrimStart().StartsWith("BUILD:", StringComparison.OrdinalIgnoreCase));
            if (headerIdx < 0) return null;

            var headerLine = lines[headerIdx].TrimStart();
            var afterPrefix = headerLine.Substring(headerLine.IndexOf("BUILD:", StringComparison.OrdinalIgnoreCase) + "BUILD:".Length);

            string? model = null, effort = null, buildSet = null;
            foreach (var token in afterPrefix.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
            {
                int eq = token.IndexOf('=');
                if (eq <= 0) continue;
                var key = token.Substring(0, eq).Trim();
                var val = token.Substring(eq + 1).Trim();
                if (val.Length == 0) continue;
                if (string.Equals(key, "model", StringComparison.OrdinalIgnoreCase)) model = val;
                else if (string.Equals(key, "effort", StringComparison.OrdinalIgnoreCase)) effort = val;
                else if (string.Equals(key, "buildSet", StringComparison.OrdinalIgnoreCase)) buildSet = val;
            }

            int promptStartIdx = headerIdx + 1;
            DateTime? posted = null;
            if (promptStartIdx < lines.Length)
            {
                var nextLine = lines[promptStartIdx].TrimStart();
                if (nextLine.StartsWith("Posted:", StringComparison.OrdinalIgnoreCase))
                {
                    var postedRaw = nextLine.Substring("Posted:".Length).Trim();
                    if (DateTime.TryParse(postedRaw, null,
                        System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                        out var parsedPosted))
                    {
                        posted = parsedPosted;
                    }
                    promptStartIdx++;
                }
            }

            var prompt = string.Join("\n", lines.Skip(promptStartIdx)).Trim();
            if (prompt.Length == 0) return null;

            return (model, effort, buildSet, posted, prompt);
        }

        /// <summary>
        /// Real GitHub issue comments, most-recent-first, so an updated `BUILD:` comment
        /// (Shane editing launch params after the fact) wins over an older one.
        /// </summary>
        public static async Task<(string? RawComment, (string? Model, string? Effort, string? BuildSet, DateTime? Posted, string Prompt)? Parsed)>
            FindBuildCommentAsync(GitHubApiClient gh, int issueNumber)
        {
            var comments = await gh.GetIssueCommentsAsync(issueNumber);
            for (int i = comments.Count - 1; i >= 0; i--)
            {
                var parsed = ParseBuildComment(comments[i].Body);
                if (parsed.HasValue) return (comments[i].Body, parsed);
            }
            return (null, null);
        }

        /// <summary>
        /// Git #1870 — the READ half of the old one-pass refresh, split out so the board can
        /// be listed WITHOUT queuing anything (the Free flow gate). Reads the real Batter Up
        /// board and resolves each item EXACTLY as before — the `BUILD:` comment parse, the
        /// real GitHub blocked-by split (open vs closed), and the already-tracked check via
        /// <paramref name="queueDb"/>.FindDedupCandidateAsync — then returns the rows for
        /// display. It QUEUES NOTHING: no <see cref="BuildQueuePostgresClient.QueueBuildAsync"/>
        /// call is reachable from here. Same #1808 drop rule as before: an item already tracked
        /// in bt_build_queue is dropped from the list (the Build Queue panel owns it from then
        /// on), whichever path put it there. Rows with no `BUILD:` comment are listed (never
        /// queueable). Displayed rows always carry <c>AlreadyTracked = false</c> /
        /// <c>JustAutoQueued = false</c>, exactly as the old method's returned rows did.
        /// </summary>
        public static async Task<(List<BatterUpRow> Rows, int SuppressedCount)> RefreshAsync(
            GitHubApiClient gh, BuildQueuePostgresClient? queueDb, Action<string> log)
        {
            var boardItems = await gh.GetBatterUpIssuesAsync();
            var rows = new List<BatterUpRow>();
            // Git #1997 — count of items genuinely hidden this pass because they hold a LIVE (or
            // already-landed) queue row. Surfaced in the panel header so "nothing in this lane" and
            // "everything in this lane is hidden" are distinguishable at a glance.
            int suppressedCount = 0;

            foreach (var item in boardItems)
            {
                var (rawComment, parsed) = await FindBuildCommentAsync(gh, item.Number);
                var blockers = await gh.GetBlockedByAsync(item.Number);
                var blockedByNumbers = blockers.Select(b => b.Number).ToList();
                var openBlockedByNumbers = blockers.Where(b => !b.IsClosed).Select(b => b.Number).ToList();
                // Git #2225 — an open blocker can still be safe to build on when a real DONE bookend
                // for it is on origin/main with a git-verified ancestor commit. Split the open set into
                // "satisfied anyway" vs "genuinely still blocking" so the card badge matches the live
                // #1600 launch gate rather than over-reporting BLOCKED on something that will auto-launch.
                // OpenBlockedByNumbers is preserved as the honest raw GitHub open/closed signal.
                var satisfiedByBookend = openBlockedByNumbers.Count > 0
                    ? await DoneBookendVerifier.GetSatisfiedAsync(openBlockedByNumbers)
                    : new HashSet<int>();
                var satisfiedByBookendNumbers = openBlockedByNumbers.Where(n => satisfiedByBookend.Contains(n)).ToList();
                var blockingNumbers = openBlockedByNumbers.Where(n => !satisfiedByBookend.Contains(n)).ToList();

                if (rawComment == null)
                {
                    log($"Batter Up #{item.Number} \"{item.Title}\" — no BUILD: comment yet, listed but not auto-queued.");
                    rows.Add(new BatterUpRow
                    {
                        Number = item.Number,
                        Title = item.Title,
                        HtmlUrl = item.HtmlUrl,
                        HasBuildComment = false,
                        BlockedByNumbers = blockedByNumbers,
                        OpenBlockedByNumbers = openBlockedByNumbers,
                        SatisfiedByBookendNumbers = satisfiedByBookendNumbers,
                        BlockingNumbers = blockingNumbers,
                    });
                    continue;
                }

                var (model, effort, buildSet, posted, prompt) = parsed!.Value;

                string? trackedTerminalStatus = null;
                int? trackedTerminalRowId = null;
                if (queueDb != null)
                {
                    var existing = await queueDb.FindDedupCandidateAsync(item.Number, prompt);
                    if (existing != null)
                    {
                        // Git #1997 — #1808 dropped ANY item with a dedup row, silently, with no way
                        // back. Reconcile against the row's real status first: hide it ONLY while that
                        // row is genuinely live (queued/parked/running/verifying/…) or already landed
                        // ("done"). A row that died in the queue with no work landed (failed/canceled)
                        // must NOT keep the item invisible — it reappears here instead, carrying the
                        // dead status, so it is never gone from both Batter Up and the Build Queue.
                        bool dead = string.Equals(existing.Status, "failed", StringComparison.OrdinalIgnoreCase)
                                 || string.Equals(existing.Status, "canceled", StringComparison.OrdinalIgnoreCase);
                        if (!dead)
                        {
                            suppressedCount++;
                            log($"Batter Up #{item.Number} \"{item.Title}\" — hidden: tracked in bt_build_queue " +
                                $"(row {existing.Id}, status={existing.Status}). {suppressedCount} tracked+hidden so far this pass.");
                            continue;
                        }

                        // Dead row — reappear rather than vanish.
                        trackedTerminalStatus = existing.Status;
                        trackedTerminalRowId = existing.Id;
                        log($"Batter Up #{item.Number} \"{item.Title}\" — reappearing: dedup row {existing.Id} is " +
                            $"'{existing.Status}' (terminal, no work landed); shown for re-queue instead of staying hidden.");
                    }
                }

                rows.Add(new BatterUpRow
                {
                    Number = item.Number,
                    Title = item.Title,
                    HtmlUrl = item.HtmlUrl,
                    Model = model,
                    Effort = effort,
                    BuildSet = buildSet,
                    Posted = posted,
                    Prompt = prompt,
                    HasBuildComment = true,
                    BlockedByNumbers = blockedByNumbers,
                    OpenBlockedByNumbers = openBlockedByNumbers,
                    SatisfiedByBookendNumbers = satisfiedByBookendNumbers,
                    BlockingNumbers = blockingNumbers,
                    AlreadyTracked = false,
                    JustAutoQueued = false,
                    TrackedTerminalStatus = trackedTerminalStatus,
                    TrackedTerminalRowId = trackedTerminalRowId,
                });
            }

            return (rows, suppressedCount);
        }

        /// <summary>
        /// Git #1870 — the QUEUE half: queues exactly ONE already-resolved row through the same
        /// <see cref="BuildQueuePostgresClient.QueueBuildAsync"/> path Queue / Send to Builder use.
        /// It OWNS the <see cref="BuildQueuePostgresClient.FindDedupCandidateAsync"/> guard (so a
        /// double-click across the 90s refresh window can't queue twice) and the existing auto-queue
        /// log line, verbatim. Blocked-by numbers are passed straight through, unchanged — the #1600
        /// fail-closed watcher still governs whether a queued blocked item actually launches; there
        /// is NO bypass here. Returns true only when a fresh queue row was actually inserted this
        /// call; false when the row is not queueable (no `BUILD:` comment / no queue DB), was already
        /// tracked (dedup hit), or the insert failed (logged, not thrown — same stance as before).
        /// </summary>
        public static async Task<bool> QueueRowAsync(
            BuildQueuePostgresClient? queueDb, BatterUpRow row, Action<string> log,
            bool allowRequeueTerminal = false)
        {
            if (queueDb == null || !row.HasBuildComment || row.Prompt == null)
                return false;

            var existing = await queueDb.FindDedupCandidateAsync(row.Number, row.Prompt);
            int? reuseRowId = null;
            if (existing != null)
            {
                // Git #1997 — a row that reappeared in Batter Up because its queue row died
                // (failed/canceled) can be re-queued from here ONLY on an explicit manual click
                // (allowRequeueTerminal), by reusing that exact terminal row (reuseRowId) rather
                // than piling up a duplicate. This deliberately does NOT fire from free-flow
                // auto-queue (allowRequeueTerminal=false there), so a failing build can't loop:
                // fail → reappear → auto-requeue → fail. Any live/landed row still short-circuits.
                bool dead = BuildQueuePostgresClient.IsTerminalStatus(existing.Status)
                            && !string.Equals(existing.Status, "done", StringComparison.OrdinalIgnoreCase);
                if (allowRequeueTerminal && dead)
                {
                    reuseRowId = existing.Id;
                }
                else
                {
                    return false; // already tracked — dedup guard against a double-click / a peer pass
                }
            }

            try
            {
                await queueDb.QueueBuildAsync(
                    title: row.Title,
                    prompt: row.Prompt,
                    model: row.Model,
                    effort: row.Effort,
                    cwd: null,
                    githubNumber: row.Number,
                    blockedByNumbers: row.BlockedByNumbers,
                    buildSet: row.BuildSet,
                    reuseRowId: reuseRowId);
                log($"Batter Up #{row.Number} \"{row.Title}\" — {(reuseRowId != null ? $"re-queued (reused dead row {reuseRowId})" : "auto-queued")} " +
                    $"(model={row.Model ?? "default"}, effort={row.Effort ?? "default"}, buildSet={row.BuildSet ?? "none"}" +
                    (row.BlockedByNumbers.Count > 0 ? $", blocked-by={string.Join(",", row.BlockedByNumbers)}" : "") + ").");
                return true;
            }
            catch (Exception ex)
            {
                log($"Batter Up #{row.Number} \"{row.Title}\" — auto-queue FAILED: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// The free-flow path (Git #1870): now just <see cref="RefreshAsync"/> followed by
        /// <see cref="QueueRowAsync"/> for every eligible row, preserving the exact observable
        /// behaviour of the old one-pass method when free flow is on — same
        /// <c>(Rows, JustQueuedCount)</c> shape, same #1808 drop of anything that just got queued,
        /// same skip/log lines. Only the free-flow caller (<c>BatterUpPanel</c> when the Free flow
        /// setting is on) invokes this; with the gate off the panel calls <see cref="RefreshAsync"/>
        /// alone and queues nothing.
        /// </summary>
        public static async Task<(List<BatterUpRow> Rows, int JustQueuedCount, int SuppressedCount)> RefreshAndAutoQueueAsync(
            GitHubApiClient gh, BuildQueuePostgresClient? queueDb, Action<string> log)
        {
            var (resolved, suppressedCount) = await RefreshAsync(gh, queueDb, log);
            var rows = new List<BatterUpRow>();
            int justQueuedCount = 0;

            foreach (var row in resolved)
            {
                if (!row.HasBuildComment)
                {
                    rows.Add(row);
                    continue;
                }

                if (await QueueRowAsync(queueDb, row, log))
                {
                    // Git #1808 — just landed in bt_build_queue; drop from the displayed list.
                    justQueuedCount++;
                    continue;
                }

                // Not queued (dedup already handled by RefreshAsync's own drop, or a queue
                // failure that was logged, not thrown) — keep it visible, exactly as before.
                // Git #1997 — a reappeared terminal row (TrackedTerminalStatus != null) also lands
                // here: free-flow does NOT re-queue it (QueueRowAsync above passes no
                // allowRequeueTerminal), so it stays visible for a manual re-queue rather than looping.
                rows.Add(row);
            }

            return (rows, justQueuedCount, suppressedCount);
        }
    }
}
