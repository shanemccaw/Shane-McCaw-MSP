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
        /// <summary>Git #3336 — this item's resolved top-level Epic ancestor (see
        /// <see cref="EpicResolver"/>), walked from the mirror's real <c>parent_number</c> chain. Null
        /// when the chain resolves to nothing — a real top-level Epic itself, or a genuinely
        /// un-parented issue; the panel groups these under a real "Ungrouped"/"No Epic" section, never
        /// silently.</summary>
        public int? EpicNumber { get; init; }
        public string? EpicTitle { get; init; }
    }

    /// <summary>
    /// Git #3448 — the real, honest result of one closed-sweep pass
    /// (<see cref="BatterUpQueueService.SweepClosedCandidatesToDoneAsync"/>), carried out of the
    /// service layer instead of dying as log-only text, so a refresh's caller (the panel, and
    /// ultimately the manual "Git Sync" toast) can report what was ACTUALLY found — genuinely out
    /// of sync vs. genuinely clean — instead of a generic "Refreshed!" message. <see cref="Clean"/>
    /// is the real positive case: zero closed-but-still-shown candidates this pass.
    /// </summary>
    public readonly struct ClosedSweepResult
    {
        /// <summary>Real count of closed-but-still-shown candidates this pass found, BEFORE the
        /// per-run cap (<see cref="BatterUpQueueService.MaxClosedSweepPerRun"/>) or live re-check.
        /// Zero means genuinely clean — nothing was ever out of sync.</summary>
        public int TotalCandidates { get; init; }
        /// <summary>Real count actually moved to Done this pass.</summary>
        public int Moved { get; init; }
        /// <summary>Real count that were already off the source status by the time of the live
        /// re-check (mirror lag, #3337) — found stale, but zero writes needed.</summary>
        public int AlreadyOffStatus { get; init; }
        /// <summary>Real count still left out of sync after this pass — a failed move, or an
        /// overflow past the per-run cap — that a later refresh will retry.</summary>
        public int Deferred { get; init; }
        /// <summary>True when the sweep was skipped entirely because the #2815 rate-limit circuit
        /// was open — a real, transient, self-recovering "couldn't check" state, not "clean".</summary>
        public bool CircuitOpen { get; init; }
        /// <summary>Real error text when the sweep itself failed (mirror read / live scan / batched
        /// GraphQL call threw) — also a "couldn't check" state, distinct from genuinely clean.</summary>
        public string? Error { get; init; }

        /// <summary>The real, positive confirmation: this pass found zero stale candidates.</summary>
        public static readonly ClosedSweepResult Clean = default;
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
        /// Git #3521 — how many times the free-flow path will AUTO-re-queue one supervisory cancel
        /// (a 'canceled' row with exit_code=0 whose work never landed) before it stops and leaves the
        /// row for a manual Queue click. One auto attempt: a supervisory cancel whose blocker has
        /// cleared (or is still open, held by the #1600 gate) gets exactly one automatic shot; if that
        /// relaunch false-done-s and re-cancels, it is not auto-re-queued again — the #1997 no-auto-loop
        /// guard. Kept at 1 deliberately; raising it would trade loop-safety for forgiveness.
        /// </summary>
        public const int MaxSupervisoryAutoRequeues = 1;

        // ── Git #3512 — in-memory BUILD-comment resolution cache ─────────────────────────────
        // Why: #3494 made both Batter Up panels THROW when the shared #2815 rate-limit circuit was
        // open, because ResolveBuildCommentsAsync could make no live GitHub call and returned
        // nothing — so every board item rendered as "no BUILD: comment yet — needs dispatch" (the
        // false "their BUILD comments were lost" reversion). Throwing kept the last-known ROWS but
        // stopped the whole pass, which also silenced Free Flow auto-queuing overnight (the exact
        // 7-day symptom this issue exists to end). This cache lets a cooldown pass serve each item's
        // LAST SUCCESSFULLY-RESOLVED BUILD: comment instead: a resolved item stays resolved (and
        // Free Flow keeps queuing it) across the ~60s the #2815 circuit is open. Only an item never
        // resolved yet (brand new on the board during a sustained cooldown) stays unresolved, and it
        // self-heals on the next closed window — never a REVERSION of a previously-resolved item.
        // Bounded by a generous TTL so a stale prompt can't be re-served forever and the cache can't
        // grow without limit over a long session; every successful live resolve refreshes the entry.
        private sealed class BuildCommentCacheEntry
        {
            public string? RawComment { get; init; }
            public (string? Model, string? Effort, string? BuildSet, DateTime? Posted, string Prompt)? Parsed { get; init; }
            public DateTime StoredUtc { get; init; }
        }

        private static readonly System.Collections.Concurrent.ConcurrentDictionary<int, BuildCommentCacheEntry> _buildCommentCache = new();

        /// <summary>Git #3512 — how long a cached BUILD-comment resolution may back a cooldown pass.
        /// Far longer than the ~60s the #2815 circuit typically stays open (so overnight cooldowns
        /// always hit a warm cache), but bounded so an edited-then-abandoned prompt can't be re-served
        /// forever and the cache can't grow without limit.</summary>
        private static readonly TimeSpan BuildCommentCacheTtl = TimeSpan.FromHours(12);

        private static void StoreInCache(int number,
            (string? RawComment, (string? Model, string? Effort, string? BuildSet, DateTime? Posted, string Prompt)? Parsed) value)
        {
            _buildCommentCache[number] = new BuildCommentCacheEntry
            {
                RawComment = value.RawComment,
                Parsed = value.Parsed,
                StoredUtc = DateTime.UtcNow,
            };
            // Opportunistic prune — cheap, only on a store; keeps the cache from growing unbounded as
            // many different issues pass through Batter Up over a multi-day session.
            var cutoff = DateTime.UtcNow - BuildCommentCacheTtl;
            foreach (var kv in _buildCommentCache)
                if (kv.Value.StoredUtc < cutoff)
                    _buildCommentCache.TryRemove(kv.Key, out _);
        }

        private static bool TryGetFreshCache(int number,
            out (string? RawComment, (string? Model, string? Effort, string? BuildSet, DateTime? Posted, string Prompt)? Parsed) value)
        {
            value = default;
            if (_buildCommentCache.TryGetValue(number, out var e)
                && DateTime.UtcNow - e.StoredUtc < BuildCommentCacheTtl)
            {
                value = (e.RawComment, e.Parsed);
                return true;
            }
            return false;
        }

        /// <summary>Git #3512 — fill any still-unresolved requested numbers from the last-known cache
        /// (fresh entries only). Returns how many were served from cache, for an honest log line.</summary>
        private static int FillFromCache(IReadOnlyList<int> numbers,
            Dictionary<int, (string? RawComment, (string? Model, string? Effort, string? BuildSet, DateTime? Posted, string Prompt)? Parsed)> result)
        {
            int served = 0;
            foreach (var n in numbers)
                if (!result.ContainsKey(n) && TryGetFreshCache(n, out var cached)) { result[n] = cached; served++; }
            return served;
        }

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
            var found = FindBuildCommentInBodies(comments.Select(c => c.Body).ToList());
            return found ?? (null, null);
        }

        /// <summary>
        /// Git #3350 — scans a set of comment BODIES in GitHub's own chronological (oldest→newest)
        /// order and returns the NEWEST one that parses as a `BUILD:` comment (so an updated `BUILD:`
        /// comment wins over an older one), exactly as <see cref="FindBuildCommentAsync"/>'s reverse
        /// REST loop did. Returns null when none of the provided bodies parse — the caller decides
        /// whether that's a definitive "no BUILD comment" (whole thread present) or "look deeper"
        /// (only a recent window was fetched and older comments remain).
        /// </summary>
        private static (string? RawComment, (string? Model, string? Effort, string? BuildSet, DateTime? Posted, string Prompt)? Parsed)?
            FindBuildCommentInBodies(IReadOnlyList<string> bodiesChronological)
        {
            for (int i = bodiesChronological.Count - 1; i >= 0; i--)
            {
                var parsed = ParseBuildComment(bodiesChronological[i]);
                if (parsed.HasValue) return (bodiesChronological[i], parsed);
            }
            return null;
        }

        /// <summary>
        /// Git #3350 — resolves the `BUILD:` comment for MANY open board items in a handful of batched
        /// GraphQL reads instead of one live REST call per item (the open-item counterpart of #3347's
        /// closed-sweep de-burst). Shared by BOTH panels — the same cross-service reuse
        /// <see cref="AiBatterUpQueueService"/> already makes of <see cref="FindBuildCommentAsync"/>.
        /// <list type="number">
        /// <item>Short-circuits entirely if the shared rate-limit circuit is already open (never pile
        /// onto an open breaker — the #3022 / #3347 stance). Returns an empty map; the caller treats a
        /// missing entry as "unresolved this pass", which resolves on a later refresh — never worse than
        /// a per-item burst that would just trip the breaker harder.</item>
        /// <item>Pulls each item's most-recent <see cref="GitHubApiClient.RecentCommentsPerIssue"/>
        /// comment bodies via <see cref="GitHubApiClient.BatchGetRecentIssueCommentsAsync"/> and finds
        /// the newest parseable `BUILD:` comment (<see cref="FindBuildCommentInBodies"/>).</item>
        /// <item>Falls back to a per-item full <see cref="FindBuildCommentAsync"/> ONLY for an item whose
        /// recent window held no `BUILD:` comment AND whose real <c>totalCount</c> shows older comments
        /// exist — so a `BUILD:` comment buried under a deep later thread is never missed, while the
        /// common case costs zero extra calls. An item definitively without any `BUILD:` comment (whole
        /// thread seen, none parsed) is recorded as <c>(null, null)</c> with no extra call.</item>
        /// </list>
        /// A per-item fallback that throws is logged and left unresolved (absent from the map) rather
        /// than aborting the whole resolve.
        /// </summary>
        public static async Task<Dictionary<int, (string? RawComment, (string? Model, string? Effort, string? BuildSet, DateTime? Posted, string Prompt)? Parsed)>>
            ResolveBuildCommentsAsync(GitHubApiClient gh, IReadOnlyList<int> issueNumbers, Action<string> log)
        {
            var result = new Dictionary<int, (string?, (string?, string?, string?, DateTime?, string)?)>();
            if (issueNumbers == null || issueNumbers.Count == 0) return result;
            var distinct = issueNumbers.Where(n => n > 0).Distinct().ToList();
            if (distinct.Count == 0) return result;

            // Git #3512 — when the shared #2815 rate-limit circuit is open we cannot make the live
            // GraphQL comment read, but we must NOT report every item as "no BUILD: comment" (the
            // #3494 reversion). Serve each item's LAST SUCCESSFULLY-RESOLVED BUILD: comment from the
            // in-memory cache instead, so a resolved item stays resolved (and Free Flow keeps queuing
            // it) across the cooldown. An item never resolved yet stays absent — genuinely unknown,
            // resolved on the next closed window — never falsely flipped to needs-dispatch.
            if (GitHubRateLimitCircuit.IsOpen)
            {
                int servedFromCache = FillFromCache(distinct, result);
                log($"BUILD-comment resolve skipped live read — GitHub rate-limit circuit open ({GitHubRateLimitCircuit.RemainingOpenSeconds()}s left); " +
                    $"served {servedFromCache} of {distinct.Count} item(s) from the last-known cache, the rest resolve on a later refresh (Git #3512/#3350).");
                return result;
            }

            // Only query GitHub for distinct items not yet in result
            var needFetch = distinct.Where(n => !result.ContainsKey(n)).ToList();
            if (needFetch.Count == 0) return result;

            Dictionary<int, (List<string> Bodies, int TotalCount)> batch;
            try
            {
                batch = await gh.BatchGetRecentIssueCommentsAsync(needFetch, 0);
            }
            catch (Exception ex)
            {
                int servedFromCache = FillFromCache(distinct, result);
                log($"BUILD-comment resolve — batched comment lookup failed ({ex.Message}); served {servedFromCache} of {distinct.Count} item(s) from the last-known cache, the rest resolve on a later refresh (Git #3512/#3350).");
                return result;
            }

            var needFullFetch = new List<int>();
            foreach (var n in needFetch)
            {
                if (batch.TryGetValue(n, out var c))
                {
                    var found = FindBuildCommentInBodies(c.Bodies);
                    // Git #3512 — cache every DEFINITIVE resolution (a real BUILD: comment, or a
                    // whole-thread-seen "no BUILD: comment") so a later cooldown pass can serve it.
                    if (found.HasValue) { result[n] = found.Value; StoreInCache(n, found.Value); continue; }
                    // No BUILD: comment in the recent window. If the real thread is deeper than the
                    // window we fetched, one could still be older — resolve just that item live.
                    if (c.TotalCount > c.Bodies.Count) needFullFetch.Add(n);
                    else { result[n] = (null, null); StoreInCache(n, (null, null)); } // whole thread seen — definitively no BUILD: comment
                }
                else needFullFetch.Add(n); // GraphQL returned nothing for this number — resolve live
            }

            if (needFullFetch.Count > 0)
                log($"BUILD-comment resolve — {needFetch.Count} item(s) via batched GraphQL; {needFullFetch.Count} need a per-item deep fetch (deeper comment history than the batched window) (Git #3350).");

            foreach (var n in needFullFetch)
            {
                try { var found = await FindBuildCommentAsync(gh, n); result[n] = found; StoreInCache(n, found); }
                catch (Exception ex)
                {
                    // Git #3512 — a failed deep fetch falls back to the last-known cached resolution
                    // rather than leaving the item unresolved (which would read as needs-dispatch).
                    if (TryGetFreshCache(n, out var cached))
                    {
                        result[n] = cached;
                        log($"BUILD-comment resolve — per-item deep fetch for #{n} failed ({ex.Message}); served last-known cached resolution (Git #3512).");
                    }
                    else log($"BUILD-comment resolve — per-item deep fetch for #{n} failed ({ex.Message}); left unresolved this pass (Git #3350).");
                }
            }

            return result;
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
        public static async Task<(List<BatterUpRow> Rows, int SuppressedCount, ClosedSweepResult SweepResult)> RefreshAsync(
            GitHubApiClient gh, BuildQueuePostgresClient? queueDb, Action<string> log)
        {
            // Git #3494 originally THREW here when the shared #2815 rate-limit circuit was open, to
            // stop the pass rebuilding every item as "no BUILD: comment — needs dispatch" (the false
            // "their BUILD comments were lost" reversion). Git #3512 removes that throw: throwing also
            // stopped the WHOLE pass, which silenced Free Flow auto-queuing overnight (the exact 7-day
            // symptom). The pass is now safe to run under an open circuit because every step it takes
            // is already circuit-aware and mirror-backed, adding ZERO live GitHub pressure:
            //   • the board LIST is a local-mirror read (GetBatterUpBoardItemsAsync);
            //   • BUILD-comment resolution serves each item's LAST-KNOWN resolution from the in-memory
            //     cache (ResolveBuildCommentsAsync, Git #3512) rather than flipping it to needs-dispatch;
            //   • the closed-sweep short-circuits on an open circuit (SweepClosedCandidatesToDoneAsync);
            //   • blocked-by is read from the mirror; DoneBookendVerifier uses local git only.
            // So a resolved item stays resolved and Free Flow keeps queuing it across the ~60s the
            // circuit is open; a genuinely-never-resolved item (brand new during a sustained cooldown)
            // simply stays listed until the next closed window resolves it — never a reversion.
            if (GitHubRateLimitCircuit.IsOpen)
            {
                log($"Batter Up refresh proceeding in degraded (cache-backed) mode — GitHub rate-limit circuit open " +
                    $"({GitHubRateLimitCircuit.RemainingOpenSeconds()}s left); board list + blocked-by from the local mirror, " +
                    "BUILD: comments served from the last-known cache, closed-sweep deferred. Free Flow keeps queuing resolved items (Git #3512).");
            }

            var (boardItems, fromMirror, mirrorRows) = await GetBatterUpBoardItemsAsync(gh, log);
            var rows = new List<BatterUpRow>();

            // Git #3336 — resolve each item's real top-level Epic ancestor, mirror-first: the mirror
            // path already carries each row's own ParentNumber; the degraded live-walk fallback does
            // not, so re-fetch it from the (still-real, still-local) mirror regardless of path — a
            // cheap local Postgres read, no live GitHub cost either way.
            var parentByNumber = fromMirror
                ? mirrorRows.ToDictionary(m => m.Number, m => m.ParentNumber)
                : (await GitHubIssueMirror.GetManyAsync(boardItems.Select(b => b.Number).ToList()))
                    .ToDictionary(kv => kv.Key, kv => kv.Value.ParentNumber);
            var resolvedEpics = await EpicResolver.ResolveTopEpicsAsync(
                boardItems.Select(b => (b.Number, parentByNumber.TryGetValue(b.Number, out var pn) ? pn : (int?)null)));
            // Git #1997 — count of items genuinely hidden this pass because they hold a LIVE (or
            // already-landed) queue row. Surfaced in the panel header so "nothing in this lane" and
            // "everything in this lane is hidden" are distinguishable at a glance.
            int suppressedCount = 0;

            // Git #3350 — resolve every open item's BUILD: comment in a handful of batched GraphQL
            // reads up front, instead of one live REST call per item inside the loop below. Empty when
            // the rate-limit circuit is open or the batch failed — a missing entry just means "resolve
            // it next refresh", the same non-queueable-this-pass outcome a null comment already had.
            // Git #3497 — this now runs BEFORE the closed-sweep below: under the #2815 circuit, a
            // scarce closed-window's GitHub budget goes to real BUILD-comment dispatch first, not to
            // the purely cosmetic closed-sweep.
            var buildComments = await ResolveBuildCommentsAsync(gh, boardItems.Select(b => b.Number).ToList(), log);

            // Git #2557 — auto-sweep: a closed issue sitting in "Batter Up" status is
            // structurally invisible to the OPEN-only board read above (GetBatterUpIssuesAsync),
            // so nothing ever demotes it on its own. Git #3448 — its real result is now carried out
            // (not just logged) so the caller can report honest sync status via a toast. Git #3497 —
            // moved to run AFTER ResolveBuildCommentsAsync (previously ran first): this is cosmetic
            // board hygiene, so a scarce circuit-closed window is spent on real dispatch work before
            // it, at the cost of a just-closed item potentially flashing into this pass's list one
            // refresh later than before.
            var sweepResult = await SweepClosedIssuesAsync(gh, log);

            // Git #3350 — resolve blocked-by from the local mirror rather than one live
            // `GetBlockedByAsync` REST call per item (the exact per-item burst this issue removes; the
            // fail-closed #1600 launch gate still re-checks every stored blocker's state LIVE at launch,
            // so this refresh-time read only needs to be mirror-fresh). `blockedByByNumber` holds each
            // item's declared blocker set; `blockerStateByNumber` holds each blocker's open/closed state
            // (one batched mirror read), so the open/closed split below costs zero GitHub calls on the
            // common mirror-sourced path. On the degraded live-walk fallback (mirror not usable) these
            // stay empty and the loop keeps today's per-item live `GetBlockedByAsync`.
            var blockedByByNumber = new Dictionary<int, List<int>>();
            var blockerStateByNumber = new Dictionary<int, bool>(); // number -> isClosed
            if (fromMirror)
            {
                foreach (var m in mirrorRows)
                {
                    var declared = m.BlockedByNumbers ?? new List<int>();
                    // Fresh-edge safety net: a `blocked`-labeled item whose mirror row hasn't captured
                    // its edge yet (the mirror only fetches blocked_by for blocked-labeled issues, and
                    // an edge added since the last sync may not be in yet) is resolved live for JUST
                    // that item — vanishingly rare in practice, and never a per-item burst for the
                    // common case (an unblocked item's declared set is genuinely empty).
                    if (declared.Count == 0 && m.Labels.Any(l => string.Equals(l, "blocked", StringComparison.OrdinalIgnoreCase)))
                    {
                        try
                        {
                            var liveBlockers = await gh.GetBlockedByAsync(m.Number);
                            declared = liveBlockers.Select(b => b.Number).Where(n => n > 0).Distinct().ToList();
                            foreach (var b in liveBlockers) blockerStateByNumber[b.Number] = b.IsClosed;
                            log($"Batter Up #{m.Number} — carries the 'blocked' label but the mirror had no blocked_by edge yet; resolved {declared.Count} blocker(s) live (Git #3350 fresh-edge safety net).");
                        }
                        catch (Exception ex)
                        {
                            log($"Batter Up #{m.Number} — live blocked_by safety-net fetch failed ({ex.Message}); treating as no declared blockers this pass (Git #3350).");
                        }
                    }
                    blockedByByNumber[m.Number] = declared;
                }

                // One batched mirror read for the open/closed state of every distinct blocker number.
                var allBlockerNums = blockedByByNumber.Values.SelectMany(v => v).Distinct().Where(n => n > 0).ToList();
                if (allBlockerNums.Count > 0)
                {
                    var blockerMirror = await GitHubIssueMirror.GetManyAsync(allBlockerNums);
                    foreach (var num in allBlockerNums)
                        // Present in the mirror → use its real state. Absent → treat as OPEN (conservative:
                        // over-reporting a blocker as still-open is fail-closed-safe for display, and the
                        // #1600 launch gate re-checks live regardless).
                        if (!blockerStateByNumber.ContainsKey(num))
                            blockerStateByNumber[num] = blockerMirror.TryGetValue(num, out var bm) && bm.IsClosed;
                }
            }

            foreach (var item in boardItems)
            {
                string? rawComment = null;
                (string? Model, string? Effort, string? BuildSet, DateTime? Posted, string Prompt)? parsed = null;
                if (buildComments.TryGetValue(item.Number, out var bc)) { rawComment = bc.RawComment; parsed = bc.Parsed; }

                List<int> blockedByNumbers;
                List<int> openBlockedByNumbers;
                if (fromMirror)
                {
                    blockedByNumbers = blockedByByNumber.TryGetValue(item.Number, out var bb) ? bb : new List<int>();
                    openBlockedByNumbers = blockedByNumbers
                        .Where(n => !(blockerStateByNumber.TryGetValue(n, out var closed) && closed))
                        .ToList();
                }
                else
                {
                    // Degraded fallback (mirror not usable this pass) — keep the pre-#3350 per-item live
                    // read; rare, and this pass already did a live project-page walk to list the items.
                    var blockers = await gh.GetBlockedByAsync(item.Number);
                    blockedByNumbers = blockers.Select(b => b.Number).ToList();
                    openBlockedByNumbers = blockers.Where(b => !b.IsClosed).Select(b => b.Number).ToList();
                }
                // Git #2225 — an open blocker can still be safe to build on when a real DONE bookend
                // for it is on origin/main with a git-verified ancestor commit. Split the open set into
                // "satisfied anyway" vs "genuinely still blocking" so the card badge matches the live
                // #1600 launch gate rather than over-reporting BLOCKED on something that will auto-launch.
                // OpenBlockedByNumbers is preserved as the honest raw open/closed signal.
                var satisfiedByBookend = openBlockedByNumbers.Count > 0
                    ? await DoneBookendVerifier.GetSatisfiedAsync(openBlockedByNumbers)
                    : new HashSet<int>();
                var satisfiedByBookendNumbers = openBlockedByNumbers.Where(n => satisfiedByBookend.Contains(n)).ToList();
                var blockingNumbers = openBlockedByNumbers.Where(n => !satisfiedByBookend.Contains(n)).ToList();

                resolvedEpics.TryGetValue(item.Number, out var epic);

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
                        EpicNumber = epic?.Number,
                        EpicTitle = epic?.Title,
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
                    EpicNumber = epic?.Number,
                    EpicTitle = epic?.Title,
                });
            }

            return (rows, suppressedCount, sweepResult);
        }

        /// <summary>
        /// Git #3134 — the real "Batter Up" board rows, mirror-first: reads the local
        /// <see cref="GitHubIssueMirror"/> (whose periodic whole-board sweep already captured every
        /// issue's Status option) instead of firing this panel's own live paginated project-page walk
        /// (<see cref="GitHubApiClient.GetBatterUpIssuesAsync"/>). Falls back to that live walk only
        /// when the mirror has no usable data yet (never synced) or errored — the same fail-to-live
        /// pattern every #3113 mirror read uses, so this can never be worse than the old behaviour.
        /// </summary>
        private static async Task<(List<BatterUpBoardIssue> Items, bool FromMirror, List<GitHubIssueMirror.MirrorIssue> MirrorRows)>
            GetBatterUpBoardItemsAsync(GitHubApiClient gh, Action<string> log)
        {
            var mirror = await GitHubIssueMirror.TryGetByBoardStatusAsync(GitHubApiClient.BatterUpPromoteOptionId, "open");
            if (mirror != null)
            {
                log($"Batter Up board read from local mirror (Git #3134) — {mirror.Count} open item(s), no live project-page walk.");
                // Git #3350 — carry the mirror rows themselves (labels + blocked_by_numbers) so the
                // refresh can resolve blocked-by from the mirror instead of one live REST call per item.
                var items = mirror.Select(m => new BatterUpBoardIssue { Number = m.Number, Title = m.Title, HtmlUrl = m.HtmlUrl }).ToList();
                return (items, true, mirror);
            }
            log("Batter Up board — mirror not usable yet; falling back to a live project-page walk this pass.");
            return (await gh.GetBatterUpIssuesAsync(), false, new List<GitHubIssueMirror.MirrorIssue>());
        }

        /// <summary>
        /// Git #3469 — the badge-only path for a mirror sync while the panel's document tab isn't
        /// open: a plain local-mirror read of the open board count, with ZERO live GitHub calls —
        /// no closed-sweep, no batched BUILD-comment resolution, no free-flow auto-queue, no
        /// fallback to a live project-page walk. Returns null (leave the badge at its last value)
        /// when the mirror isn't usable yet; the next visible-panel refresh (or the next sync once
        /// the mirror IS usable) catches up.
        /// </summary>
        public static async Task<int?> GetMirrorOnlyOpenCountAsync() =>
            (await GitHubIssueMirror.TryGetByBoardStatusAsync(GitHubApiClient.BatterUpPromoteOptionId, "open"))?.Count;

        /// <summary>
        /// Git #2557 — sweeps every real CLOSED issue still sitting in "Batter Up" status to
        /// "Done" (<see cref="GitHubApiClient.DoneOptionId"/>). Git #3134 — the closed-issue READ is
        /// mirror-first (<see cref="GitHubIssueMirror.TryGetByBoardStatusAsync"/> with
        /// <c>state="closed"</c>; an open→closed transition preserves the row's board Status option,
        /// so a just-closed Batter Up item is a real mirror row), falling back to the live
        /// <see cref="GitHubApiClient.GetClosedBatterUpIssuesAsync"/> project-page walk only when the
        /// mirror isn't usable.
        ///
        /// Git #3347 — the actual MOVE is no longer one resolve+mutation per item. That loop fired
        /// ~2N rapid GraphQL calls (59 candidates ≈ 118 calls in ~2s), tripping GitHub's secondary
        /// rate limit at cold start and cascading into the whole app appearing broken. It now
        /// delegates to <see cref="SweepClosedCandidatesToDoneAsync"/>, which reads every candidate's
        /// LIVE status and moves the survivors to Done in a handful of batched, bounded, circuit-aware
        /// GraphQL calls.
        /// </summary>
        private static async Task<ClosedSweepResult> SweepClosedIssuesAsync(GitHubApiClient gh, Action<string> log)
        {
            List<(int Number, string Title)> stale;
            try
            {
                var mirror = await GitHubIssueMirror.TryGetByBoardStatusAsync(GitHubApiClient.BatterUpPromoteOptionId, "closed");
                if (mirror != null)
                {
                    stale = mirror.Select(m => (m.Number, m.Title)).ToList();
                    if (stale.Count > 0)
                        log($"Batter Up closed-sweep read from local mirror (Git #3134) — {stale.Count} closed item(s) still in Batter Up, no live (closed sweep) walk.");
                }
                else
                {
                    stale = await gh.GetClosedBatterUpIssuesAsync();
                }
            }
            catch (Exception ex)
            {
                log($"Batter Up auto-sweep: closed-issue scan failed: {ex.Message}");
                return new ClosedSweepResult { Error = ex.Message };
            }

            return await SweepClosedCandidatesToDoneAsync(gh, GitHubApiClient.BatterUpPromoteOptionId, stale,
                s => log("Batter Up " + s));
        }

        /// <summary>Git #3347 — hard per-run cap on how many stale closed-sweep candidates one refresh
        /// processes. #3337 slowed the board-status full-sync (to 30 min), so the mirror's stale
        /// "closed but still shown here" backlog can grow between syncs; capping keeps even the
        /// batched calls bounded, so a large backlog drains over several refreshes rather than one
        /// big burst (the exact "don't verify hundreds in one go" concern #3347 raised).</summary>
        private const int MaxClosedSweepPerRun = 100;

        /// <summary>
        /// Git #3347 — the batched, bounded, circuit-aware closed-sweep shared by BOTH the Batter Up
        /// and AI Batter Up panels (AI Batter Up calls this exactly as it already reuses
        /// <see cref="FindBuildCommentAsync"/>). Given the stale candidates a panel read from the
        /// local mirror — issues that closed while still sitting in <paramref name="sourceOptionId"/> —
        /// it:
        /// <list type="number">
        /// <item>short-circuits entirely if the shared rate-limit circuit is already open (never worth
        /// piling onto an open breaker — the #3022 blocked-by-sweep stance);</item>
        /// <item>caps the candidate set at <see cref="MaxClosedSweepPerRun"/> so a backlog grown large
        /// between #3337's slow full-syncs drains over several runs, never in one burst;</item>
        /// <item>reads every capped candidate's LIVE board status in a handful of batched GraphQL
        /// reads (<see cref="GitHubApiClient.BatchGetProjectItemStatusesAsync"/>) and keeps only those
        /// STILL in <paramref name="sourceOptionId"/> — the mirror lags board status by up to #3337's
        /// full-sync interval, so on a repeat cold start most candidates have already been moved and
        /// are skipped with ZERO writes (this is what stops the recurring burst);</item>
        /// <item>moves the survivors to Done in a handful of batched GraphQL mutations
        /// (<see cref="GitHubApiClient.BatchSetProjectItemsStatusAsync"/>).</item>
        /// </list>
        /// A rate-limit mid-sweep stops the remaining chunks and reports the partial result rather
        /// than hammering. Replaces the old one-resolve-plus-one-mutation-per-item loop.
        /// </summary>
        public static async Task<ClosedSweepResult> SweepClosedCandidatesToDoneAsync(
            GitHubApiClient gh, string sourceOptionId,
            IReadOnlyList<(int Number, string Title)> candidates, Action<string> log)
        {
            if (candidates == null || candidates.Count == 0) return ClosedSweepResult.Clean;

            if (GitHubRateLimitCircuit.IsOpen)
            {
                log($"closed-sweep skipped — GitHub rate-limit circuit open ({GitHubRateLimitCircuit.RemainingOpenSeconds()}s left); " +
                    $"{candidates.Count} candidate(s) reattempted on a later refresh (Git #3347).");
                return new ClosedSweepResult { TotalCandidates = candidates.Count, CircuitOpen = true, Deferred = candidates.Count };
            }

            var work = candidates;
            int capOverflow = 0;
            if (candidates.Count > MaxClosedSweepPerRun)
            {
                log($"closed-sweep — {candidates.Count} stale candidate(s) exceeds the per-run cap of {MaxClosedSweepPerRun}; " +
                    $"sweeping the first {MaxClosedSweepPerRun} this run, the rest next refresh (Git #3347).");
                work = candidates.Take(MaxClosedSweepPerRun).ToList();
                capOverflow = candidates.Count - work.Count;
            }

            var titleByNumber = new Dictionary<int, string>();
            foreach (var c in work) titleByNumber[c.Number] = c.Title;

            // 1) Batched live-status read — replaces the per-item resolve AND verifies current state,
            //    so a candidate the (lagged) mirror still shows here but that already moved is skipped.
            Dictionary<int, GitHubApiClient.IssueBoardStatus> live;
            try
            {
                live = await gh.BatchGetProjectItemStatusesAsync(work.Select(c => c.Number).Distinct().ToList());
            }
            catch (Exception ex)
            {
                log($"closed-sweep — batched live-status lookup failed ({ex.Message}); nothing moved this run (Git #3347).");
                return new ClosedSweepResult { TotalCandidates = candidates.Count, Error = ex.Message, Deferred = candidates.Count };
            }

            var toMoveItemIds = new List<string>();
            var numberByItemId = new Dictionary<string, int>();
            int alreadyGone = 0;
            foreach (var c in work)
            {
                if (live.TryGetValue(c.Number, out var st)
                    && !string.IsNullOrEmpty(st.ItemId)
                    && string.Equals(st.OptionId, sourceOptionId, StringComparison.OrdinalIgnoreCase))
                {
                    if (!numberByItemId.ContainsKey(st.ItemId))
                    {
                        numberByItemId[st.ItemId] = c.Number;
                        toMoveItemIds.Add(st.ItemId);
                    }
                }
                else alreadyGone++;
            }

            if (toMoveItemIds.Count == 0)
            {
                log($"closed-sweep — nothing to move: all {work.Count} candidate(s) already off this status on the real " +
                    $"board (mirror lag, #3337); zero writes (Git #3347).");
                return new ClosedSweepResult
                {
                    TotalCandidates = candidates.Count,
                    AlreadyOffStatus = alreadyGone,
                    Deferred = capOverflow,
                };
            }

            // 2) Batched Done move — replaces the per-item mutation burst.
            HashSet<string> moved;
            try
            {
                moved = await gh.BatchSetProjectItemsStatusAsync(toMoveItemIds, GitHubApiClient.DoneOptionId);
            }
            catch (Exception ex)
            {
                log($"closed-sweep — batched Done move failed ({ex.Message}); {toMoveItemIds.Count} item(s) still stale, " +
                    $"retry next refresh (Git #3347).");
                return new ClosedSweepResult
                {
                    TotalCandidates = candidates.Count,
                    AlreadyOffStatus = alreadyGone,
                    Error = ex.Message,
                    Deferred = toMoveItemIds.Count + capOverflow,
                };
            }

            var okNumbers = new List<int>();
            foreach (var itemId in toMoveItemIds)
            {
                int number = numberByItemId[itemId];
                if (moved.Contains(itemId)) okNumbers.Add(number);
                else
                {
                    string title = titleByNumber.TryGetValue(number, out var t) ? t : "";
                    log($"closed-sweep #{number} \"{title}\" — Done move did not apply (no matching mutation result); retry next refresh.");
                }
            }

            int deferredCount = (toMoveItemIds.Count - okNumbers.Count) + capOverflow;
            string movedList = okNumbers.Count == 0 ? "" : "#" + string.Join(" #", okNumbers) + "; ";
            log($"closed-sweep complete — moved {okNumbers.Count} closed item(s) to Done ({movedList}" +
                $"{alreadyGone} already off-status, {deferredCount} deferred) (Git #3347).");

            return new ClosedSweepResult
            {
                TotalCandidates = candidates.Count,
                Moved = okNumbers.Count,
                AlreadyOffStatus = alreadyGone,
                Deferred = deferredCount,
            };
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

                // Git #3517, corrected by #3521 — the ONE free-flow exception to the #1997
                // no-auto-requeue guard. A SUPERVISORY cancel (status 'canceled' with exit_code == 0)
                // is not a genuine build failure: the build ran and exited clean but landed no work
                // because it was dispatched against a blocker that wasn't actually finished, so the
                // false-done / board reconcile (MarkFalseDoneReconciledAsync / FalseDoneReconciler)
                // reset it to 'canceled' while leaving its clean exit_code=0 intact. (A genuinely-failed
                // build is 'failed'; a user-cancelled queued row is 'canceled' with exit_code NULL — it
                // never ran — so neither matches this predicate.)
                //
                // #3517 originally re-queued such a row ONLY while it was STILL blocked (row.IsBlocked).
                // That stranded the exact case #3521 was filed for: once the real blocker CLOSES,
                // row.IsBlocked flips false, so the one condition meant to catch it — "blocker cleared,
                // should launch now" — instead DISQUALIFIED it, and it sat 'canceled' forever (confirmed
                // live for #3459 after its blocker #3493 closed: the manual Refresh Git DID invoke this
                // re-check under free flow, and it declined purely because IsBlocked was false). So the
                // gate is no longer "still blocked" — a supervisory cancel is re-queued whether or not
                // its blocker is currently open: still-blocked → the #1600 fail-closed launch gate holds
                // the re-queued 'queued' row until the blocker genuinely closes; blocker-cleared → it
                // launches on the next pass. Either way it re-enters the queue automatically.
                //
                // Loop-safe WITHOUT relying on IsBlocked (which no longer gates it): each free-flow
                // supervisory re-queue increments supervisory_requeue_count, and this fires only while
                // that count is below MaxSupervisoryAutoRequeues (1). The re-queued row is written
                // 'queued' (exit_code reset to NULL) so on the next pass the dedup candidate is not
                // terminal and this branch no longer matches; if the relaunch false-done-s and
                // re-cancels (canceled+exit 0 again), the count is now at the cap, so it is NOT
                // auto-re-queued again — it stays visible for a manual Queue click (allowRequeueTerminal),
                // exactly the fail→requeue→fail loop the #1997 guard exists to prevent.
                bool isSupervisoryCancel =
                    string.Equals(existing.Status, "canceled", StringComparison.OrdinalIgnoreCase)
                    && existing.ExitCode == 0;
                bool freeFlowSupervisoryRequeue = false;
                if (isSupervisoryCancel && !allowRequeueTerminal)
                {
                    int priorRequeues = await queueDb.GetSupervisoryRequeueCountAsync(existing.Id);
                    freeFlowSupervisoryRequeue = priorRequeues < MaxSupervisoryAutoRequeues;
                }

                if ((allowRequeueTerminal && dead) || freeFlowSupervisoryRequeue)
                {
                    reuseRowId = existing.Id;
                }
                else
                {
                    return false; // already tracked — dedup guard against a double-click / a peer pass
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

                    // Git #3521 — consume one auto-attempt for a free-flow supervisory re-queue (see the
                    // loop-safety note above). Not incremented for a manual re-queue (Shane's explicit
                    // click is never budget-bound) nor for a first-time auto-queue (no reuse row).
                    if (freeFlowSupervisoryRequeue)
                        await queueDb.IncrementSupervisoryRequeueCountAsync(existing.Id);

                    string action = allowRequeueTerminal
                        ? $"re-queued (reused dead row {reuseRowId})"
                        // Git #3517/#3521 — free-flow re-queue of a supervisory cancel (exit 0), now
                        // regardless of whether its blocker is still open; held 'queued' by the #1600 gate
                        // until the blocker clears, then launches once. One auto attempt (bounded by
                        // supervisory_requeue_count) to stay loop-safe.
                        : $"re-queued (supervisory cancel exit 0{(row.IsBlocked ? ", still blocked — held by #1600 gate" : ", blocker cleared — will launch")} — reused row {reuseRowId}, Git #3521)";
                    log($"Batter Up #{row.Number} \"{row.Title}\" — {action} " +
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

            // existing == null here (a null dedup candidate falls through to a fresh insert): this is a
            // first-time auto-queue of a never-before-tracked row, so reuseRowId is null by construction.
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
                log($"Batter Up #{row.Number} \"{row.Title}\" — auto-queued " +
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
        public static async Task<(List<BatterUpRow> Rows, int JustQueuedCount, int SuppressedCount, ClosedSweepResult SweepResult)> RefreshAndAutoQueueAsync(
            GitHubApiClient gh, BuildQueuePostgresClient? queueDb, Action<string> log)
        {
            var (resolved, suppressedCount, sweepResult) = await RefreshAsync(gh, queueDb, log);
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
                // here: free-flow does NOT re-queue a genuine failure (QueueRowAsync above passes no
                // allowRequeueTerminal), so it stays visible for a manual re-queue rather than looping.
                // Git #3517 — the one exception QueueRowAsync itself makes is a supervisory cancel
                // (canceled + exit 0) that is still blocked: that IS re-queued above (returned true and
                // dropped from view), so only genuine failures / user-cancels / unblocked cancels reach here.
                rows.Add(row);
            }

            return (rows, justQueuedCount, suppressedCount, sweepResult);
        }

        /// <summary>
        /// Git #3448 — turns a real <see cref="ClosedSweepResult"/> into the honest toast text
        /// Shane asked for: a genuine "out of sync" report when the sweep found (or is still
        /// working through) stale candidates, and an explicit positive "no issues" confirmation
        /// when it didn't — never a generic "Refreshed!" that says nothing about what was
        /// actually checked. <paramref name="label"/> is the board lane name ("Batter Up" /
        /// "AI Batter Up") so one summary string can be built per lane and concatenated.
        /// </summary>
        public static string BuildSyncSummary(string label, ClosedSweepResult r)
        {
            if (r.CircuitOpen)
                return $"{label}: sync check skipped (GitHub rate limit cooling down, Git #2815) — retried automatically next refresh.";
            if (!string.IsNullOrEmpty(r.Error))
                return $"{label}: sync check failed — {r.Error}.";
            if (r.TotalCandidates == 0)
                return $"{label}: no issues — every item is current.";
            if (r.Moved > 0 && r.Deferred == 0)
                return $"{label}: was out of sync — {r.Moved} stale item(s) found and cleared.";
            if (r.Moved > 0 && r.Deferred > 0)
                return $"{label}: was out of sync — {r.Moved} cleared now, {r.Deferred} still pending next refresh.";
            if (r.Moved == 0 && r.Deferred == 0)
                return $"{label}: was out of sync — {r.TotalCandidates} stale item(s) found, already reconciled (zero writes needed).";
            return $"{label}: still out of sync — {r.Deferred} item(s) pending, retrying next refresh.";
        }
    }
}
