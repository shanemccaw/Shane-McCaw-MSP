using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Npgsql;
using NpgsqlTypes;

namespace BuildConsole.Services
{
    /// <summary>Git #2068 — the minimal live-board info the chat-link write path needs to
    /// self-heal when the target epic/issue hasn't been GitHub-synced into bt_epics/
    /// bt_issues yet. The caller (LeftSidebar) builds this from data it already fetched
    /// for the Git Board (<c>_lastBoardIssues</c> — the same source
    /// <c>BackfillSyntheticEpicsFromBoard</c> reads for the read/grouping side, #1362) —
    /// this DB client never makes its own network call.</summary>
    public readonly record struct LiveBoardIssueInfo(bool IsEpic, string Title, int? ParentEpicGithubNumber);

    /// <summary>
    /// Direct Npgsql connection to the Neon Postgres database for all build-queue
    /// operations previously routed through the Replit API server (HTTP).
    ///
    /// ── Why direct Postgres instead of the API server? ──────────────────────────
    /// The API server was the original transport for queue state mutations
    /// (GET /extension/queue/next → claim rows, POST /extension/queue/:id/complete
    /// → mark done/failed). That server lives on Replit, which shuts down after
    /// ~15 min of inactivity — so a build finishing while the server was napping
    /// would silently fail to report completion, leading to stuck "running" rows.
    /// The Neon Postgres server is always on; a direct connection from BuildConsole
    /// is faster, more reliable, and removes the "server asleep" class of failure
    /// entirely. Npgsql 7.0.7 is already a project dependency (see BuildConsole.csproj).
    ///
    /// ── Connection string ────────────────────────────────────────────────────────
    /// Reads DATABASE_URL from:
    ///   1. The build-queue-watcher.config.json "databaseUrl" field (if set), OR
    ///   2. A DATABASE_URL line in &lt;repoRoot&gt;/.env.local (the standard local
    ///      development file already used by the Next.js/Node side of the stack),
    ///   so no separate configuration step is needed — Shane already has .env.local
    ///   with the real Neon connection string, and the config loader reads it
    ///   automatically the first time it's needed.
    ///
    /// ── What this does NOT replace ───────────────────────────────────────────────
    /// QueueBuildAsync (ADDING/re-queuing an item — from chat buttons, the "Retry"
    /// menu action, a Reply continuation, or the pending-update replay) and
    /// CancelAsync (right-click Cancel on a still-queued item) also run
    /// direct-Postgres now, same reasoning as everything else above: BuildConsole is
    /// Shane's own app and shouldn't need a live, correctly-tokened server round-trip
    /// just to click Queue or Cancel. The API server still handles:
    ///   • ToggleLabelAsync — a GitHub label mutation, not a queue-row mutation.
    ///   • BuildQueuePanel's display (GetQueueAsync / GetQueueCachedAsync) — those
    ///     reads are still HTTP because they also join GitHub blocker state that the
    ///     server resolves; the direct Postgres reads here only support the watcher's
    ///     claim loop and completion reporting.
    ///
    /// ── Blocker check (Git #1600) ────────────────────────────────────────────────
    /// #1483 started while its real GitHub blocker (#1482) was still open — the local
    /// queue-row state (a "done"/"verifying" row, itself set by nothing more than the
    /// session exiting 0) had been trusted as if it meant the same thing as the real
    /// GitHub issue closing. It never does: a session exiting is not the work being
    /// verified, and a commit landing on main is not the issue closing. The claim
    /// logic (GetNextAsync) now re-queries GitHub LIVE for every blocker number any
    /// queued candidate declares, right before claiming — no exceptions for a "done"
    /// local row, a "verifying" row, a cleanly-exited session, or commits already on
    /// main. Only a blocker issue GitHub itself reports closed releases a dependent.
    /// If GitHub can't be reached, every blocked candidate is held (fail closed) —
    /// see GetNextAsync's Step 2.
    /// </summary>
    public partial class BuildQueuePostgresClient
    {
        /// <summary>
        /// Git #1469 — a queue row's real terminal state after its session exits
        /// successfully (exit 0) AND it has a real github_number: distinct from
        /// "done", stays visible in the active Build Queue view (not archived) until
        /// a manual GitHub refresh confirms the real issue actually closed. A
        /// session's own claim of completion has repeatedly not been the final word —
        /// this is what makes genuine verification (Shane closing the issue) the real
        /// gate instead. Rows with no github_number skip this entirely and go
        /// straight to "done" (nothing to poll).
        /// </summary>
        public const string VerifyingStatus = "verifying";

        /// <summary>Git #2119 — terminal status set on the ORIGINAL row when a Reply/resume spawns a
        /// fresh <c>Reply → …</c> row to take over its session (<see cref="MarkSupersededByReplyAsync"/>).
        /// Deliberately not in any of ApplyFilter's active buckets nor <see cref="IsActiveStatus"/>, so a
        /// superseded row drops out of Running/Queued/RunningAndQueued and is never re-claimed — it exists
        /// only so the original card reads "↩ REPLIED → #N" instead of sitting stuck showing stale
        /// active status forever while the resumed work runs under a disconnected new entry.</summary>
        public const string SupersededStatus = "superseded";

        private readonly string _connectionString;

        public BuildQueuePostgresClient(string connectionString)
        {
            if (string.IsNullOrWhiteSpace(connectionString))
                throw new ArgumentException("connectionString must not be empty", nameof(connectionString));

            _connectionString = ParseConnectionString(connectionString);
        }

        public static string ParseConnectionString(string input)
        {
            if (string.IsNullOrWhiteSpace(input)) return input;

            var trimmed = input.Trim();
            if (!trimmed.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase) &&
                !trimmed.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase))
            {
                return input; // Not a URI, return as-is
            }

            try
            {
                string rawUri = trimmed;
                int prefixLen = rawUri.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase) ? 13 : 11;
                string remaining = rawUri.Substring(prefixLen);

                string userPass = "";
                string hostPortDbQuery = remaining;
                int atIndex = remaining.IndexOf('@');
                if (atIndex >= 0)
                {
                    userPass = remaining.Substring(0, atIndex);
                    hostPortDbQuery = remaining.Substring(atIndex + 1);
                }

                string username = "";
                string password = "";
                if (!string.IsNullOrEmpty(userPass))
                {
                    int colonIndex = userPass.IndexOf(':');
                    if (colonIndex >= 0)
                    {
                        username = Uri.UnescapeDataString(userPass.Substring(0, colonIndex));
                        password = Uri.UnescapeDataString(userPass.Substring(colonIndex + 1));
                    }
                    else
                    {
                        username = Uri.UnescapeDataString(userPass);
                    }
                }

                string hostPortDb = hostPortDbQuery;
                string query = "";
                int qIndex = hostPortDbQuery.IndexOf('?');
                if (qIndex >= 0)
                {
                    hostPortDb = hostPortDbQuery.Substring(0, qIndex);
                    query = hostPortDbQuery.Substring(qIndex + 1);
                }

                string hostPort = hostPortDb;
                string database = "";
                int slashIndex = hostPortDb.IndexOf('/');
                if (slashIndex >= 0)
                {
                    hostPort = hostPortDb.Substring(0, slashIndex);
                    database = Uri.UnescapeDataString(hostPortDb.Substring(slashIndex + 1));
                }

                string host = hostPort;
                string port = "";
                int colonHostIndex = hostPort.IndexOf(':');
                if (colonHostIndex >= 0)
                {
                    host = hostPort.Substring(0, colonHostIndex);
                    port = hostPort.Substring(colonHostIndex + 1);
                }

                var parts = new List<string>();
                if (!string.IsNullOrEmpty(host)) parts.Add($"Host={host}");
                if (!string.IsNullOrEmpty(port)) parts.Add($"Port={port}");
                if (!string.IsNullOrEmpty(database)) parts.Add($"Database={database}");
                if (!string.IsNullOrEmpty(username)) parts.Add($"Username={username}");
                if (!string.IsNullOrEmpty(password)) parts.Add($"Password={password}");
                parts.Add("Trust Server Certificate=true");

                if (!string.IsNullOrEmpty(query))
                {
                    foreach (var pair in query.Split('&'))
                    {
                        var kv = pair.Split('=');
                        if (kv.Length == 2)
                        {
                            var key = kv[0].Trim();
                            var val = Uri.UnescapeDataString(kv[1].Trim());
                            if (key.Equals("sslmode", StringComparison.OrdinalIgnoreCase))
                            {
                                parts.Add($"SSL Mode={val}");
                            }
                            else
                            {
                                parts.Add($"{key}={val}");
                            }
                        }
                    }
                }

                return string.Join(";", parts) + ";";
            }
            catch
            {
                return input; // Fallback to raw if parsing fails
            }
        }

        // ── GetQueueAsync ─────────────────────────────────────────────────────────
        /// <summary>
        /// Returns ALL rows from bt_build_queue ordered by created_at ASC, exactly
        /// as GET /extension/queue does. Used by RecoverOrphanedRunningItemsAsync
        /// to find "running" rows that belong to a dead previous instance.
        /// NOTE: unlike the HTTP version, this does NOT resolve GitHub blockers
        /// (that's a server-only enrichment used for display; the watcher only needs
        /// the raw status column for its orphan sweep).
        /// </summary>
        public async Task<List<QueueItem>> GetQueueAsync()
        {
            // Git #2119 — superseded_by_id is appended LAST (ordinal 21), read by MapRow
            // via its FieldCount>21 guard. Only this display query needs it; every other
            // SELECT feeding MapRow can safely omit it (see MapRow's ordinal note).
            const string sql = @"
                SELECT id, title, prompt, model, effort, cwd,
                       github_number, blocked_by_number, blocked_by_numbers,
                       status, exit_code, session_id, resume_session_id,
                       originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at,
                       superseded_by_id
                FROM bt_build_queue
                ORDER BY created_at ASC";

            var items = new List<QueueItem>();
            await using var conn = await OpenAsync();
            await using (var cmd = new NpgsqlCommand(sql, conn))
            {
                await using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                        items.Add(MapRow(reader));
                }
            }
            await PopulateAssociatedIssueNumbersAsync(items, conn);
            return items;
        }

        /// <summary>
        /// Git #1600 — the reason a currently-queued item is being held, keyed by its
        /// queue row id. Recomputed on every <see cref="GetNextAsync"/> call (i.e. every
        /// watcher tick that has a free slot) so BuildQueuePanel can show a real,
        /// current "waiting on #NNNN (open)" instead of guessing from stale local
        /// columns. An id with no entry here either has no blocker or was never
        /// evaluated this pass (e.g. no free slot that tick — see TickAsync).
        /// </summary>
        public IReadOnlyDictionary<int, string> LastHeldReasons { get; private set; } = new Dictionary<int, string>();

        // ── GetNextAsync ──────────────────────────────────────────────────────────
        /// <summary>
        /// Atomically claims up to <paramref name="limit"/> ready rows:
        ///   • status = 'queued'
        ///   • every declared blocker is confirmed CLOSED on GitHub right now (Git
        ///     #1600 — a live re-query, not the local queue row's own status/exit_code;
        ///     see the class doc comment and Step 2 below)
        /// Marks claimed rows status='running', claimed_at=NOW(), updated_at=NOW()
        /// in the same transaction so a double-poll can never double-claim.
        /// </summary>
        /// <param name="liveOpenIssuesFetcher">Test seam — defaults to a real
        /// `gh issue list --state open` call (GitHubIssuesService). Overridden by
        /// tests to simulate GitHub open/closed/unreachable without a real network
        /// call or a real queued build actually launching.</param>
        /// <summary>
        /// The queued-candidate scan shared by the claim path (<see cref="GetNextAsync"/>)
        /// and the read-only peek (<see cref="PeekNextAsync"/>): all rows at status='queued',
        /// in real claim order (created_at ASC).
        /// </summary>
        private const string QueuedCandidateSql = @"
                SELECT id, title, prompt, model, effort, cwd,
                       github_number, blocked_by_number, blocked_by_numbers,
                       status, exit_code, session_id, resume_session_id,
                       originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at
                FROM bt_build_queue
                WHERE status = 'queued'
                ORDER BY created_at ASC";

        /// <summary>Result of <see cref="SelectClaimCandidatesAsync"/>: the ordered ready
        /// rows (capped to the requested limit) plus the per-id held-reason map.</summary>
        private sealed record CandidateSelection(List<QueueItem> Ready, Dictionary<int, string> HeldReasons);

        /// <summary>
        /// Git #1862 — the shared, strictly READ-ONLY candidate selection that both
        /// <see cref="GetNextAsync"/> (which then claims the result) and
        /// <see cref="PeekNextAsync"/> (which never claims) run, so the QUEUE dropdown can
        /// never drift from what the watcher will actually claim next.
        ///
        /// Selects queued rows in real claim order (created_at ASC), drops
        /// <c>PausedBuildIds</c>, then filters to rows whose every declared blocker GitHub
        /// reports CLOSED, capped to <paramref name="limit"/>. Fail-closed (Git #1600): an
        /// unreachable/undetermined open-issue set holds every blocked candidate.
        ///
        /// Git #1904 — the same live snapshot also self-checks each candidate's OWN issue:
        /// a row whose <c>github_number</c> is a real (positive) issue that GitHub reports
        /// CLOSED (completed or not_planned) is HELD with a distinct reason, never claimed,
        /// even with zero unresolved blockers. --notGit rows (negative sentinel
        /// <c>github_number</c>, Git #1645) and null-numbered rows have no real issue to
        /// check and are exempt from the self-check.
        ///
        /// This method issues NO UPDATE and claims nothing — the ONLY write in the entire
        /// claim path is GetNextAsync's Step 3, which runs AFTER this returns.
        ///
        /// <paramref name="presuppliedOpen"/>: when non-null it is used directly as the
        /// live open-issue snapshot (PeekNextAsync reuses the panel's already-fetched Git
        /// Board set, so it fires no `gh` call). When null, the snapshot is fetched via
        /// <paramref name="liveOpenIssuesFetcher"/> or GitHubIssuesService (GetNextAsync's
        /// own path).
        /// </summary>
        private async Task<CandidateSelection> SelectClaimCandidatesAsync(
            NpgsqlConnection conn,
            int limit,
            LiveOpenIssuesResult? presuppliedOpen,
            Func<Task<LiveOpenIssuesResult>>? liveOpenIssuesFetcher)
        {
            // Step 1 — fetch all queued rows (cheapest scan; the queue is tiny),
            // minus manually-paused ids.
            var pausedIds = BuildConsoleSettings.Load().PausedBuildIds;
            var candidates = new List<QueueItem>();
            var heldReasons = new Dictionary<int, string>();

            // "Build Only This Set" exclusive hold — a build-set group header context-menu
            // action (BuildQueuePanel.BuildBuildSetHeaderContextMenu). While a set is marked
            // exclusive, every queued row NOT belonging to it is held here, before it ever
            // reaches the live GitHub blocker check below — cheapest possible gate, and it
            // needs no live round trip to decide. Auto-clears on its own (see
            // BuildQueuePanel.CheckExclusiveBuildSetCompletion) once every member of the
            // exclusive set reaches a terminal state.
            var exclusiveSet = BuildSetExclusiveStore.ActiveSet;

            await using (var fetchCmd = new NpgsqlCommand(QueuedCandidateSql, conn))
            await using (var reader = await fetchCmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    var item = MapRow(reader);
                    if (pausedIds.Contains(item.Id)) continue;

                    if (exclusiveSet != null &&
                        !string.Equals((item.BuildSet ?? "").Trim(), exclusiveSet, StringComparison.OrdinalIgnoreCase))
                    {
                        heldReasons[item.Id] = $"holding — build set \"{exclusiveSet}\" is marked exclusive (\"Build Only This Set\")";
                        continue;
                    }

                    candidates.Add(item);
                }
            }

            // Step 2 — filter to items whose blockers are all confirmed closed on
            // GitHub, live, right now (Git #1600 — no exceptions for local queue-row
            // state). One live query covers every candidate this pass: gather the
            // full set of distinct blocker numbers across ALL candidates first, resolve
            // GitHub's real open-issue set ONCE, then decide each candidate from that
            // single snapshot — a blocked queue of N items costs one `gh` call per
            // tick, not N (and zero when the caller supplies the snapshot).
            var ready = new List<QueueItem>();
            var distinctBlockerNums = candidates.SelectMany(EffectiveBlockers).Distinct().ToList();
            // Git #1904 — the same live open-issue snapshot also drives the self-check
            // below (is the candidate's OWN issue still open?). A candidate carries a real
            // GitHub issue to verify only when its github_number is POSITIVE: a --notGit
            // LOCAL build stores a NEGATIVE sentinel (Git #1645) that is never a real issue,
            // and a null github_number has nothing to check. So we still need the one live
            // fetch whenever ANY candidate has blockers OR a real own-issue to verify —
            // reusing that single result for both checks, never a second `gh` call.
            bool anyOwnIssueToCheck = candidates.Any(c => c.GithubNumber is int g && g > 0);
            LiveOpenIssuesResult? live = presuppliedOpen;
            if ((distinctBlockerNums.Count > 0 || anyOwnIssueToCheck) && live == null)
            {
                live = await (liveOpenIssuesFetcher != null ? liveOpenIssuesFetcher() : GitHubIssuesService.TryGetOpenIssueNumbersAsync());
                if (!live.Success)
                {
                    ActivityLog.Log("watcher", $"Git #1600/#1904: couldn't reach GitHub to re-check blocker(s)/own-issue state ({live.Error}) — holding every candidate that needs a live check this tick (fail closed).");
                }
            }

            // Git #2225 — a blocker that GitHub still reports OPEN can nonetheless be safe to build
            // on if its work genuinely landed: a real DONE bookend on origin/main whose cited commit
            // passes `git cat-file -t` (real commit object) AND `git merge-base --is-ancestor <sha>
            // origin/main`. Closing an issue is a deliberately slower human step; requiring it before
            // a dependent can even START is what stalled whole dependency chains overnight (Shane: "I
            // can't queue up a big feature and go to bed"). So a blocker counts satisfied on EITHER
            // GitHub-closed OR a verified DONE bookend — whichever comes first. Computed ONCE for every
            // blocker still open across all candidates this pass (same single-snapshot discipline as
            // the live open-issue fetch above), and ONLY when GitHub was actually reachable — a
            // fail-closed live snapshot already holds every blocked candidate in the loop below. The
            // verifier itself fails closed on every error, so this can only ever RELEASE work that is
            // provably on origin/main, never work that isn't.
            HashSet<int> satisfiedByDoneBookend = new();
            if (live != null && live.Success)
            {
                var stillOpenAcrossAll = candidates
                    .SelectMany(EffectiveBlockers)
                    .Where(b => live.OpenNumbers.Contains(b))
                    .Distinct()
                    .ToList();
                if (stillOpenAcrossAll.Count > 0)
                {
                    try
                    {
                        satisfiedByDoneBookend = await DoneBookendVerifier.GetSatisfiedAsync(stillOpenAcrossAll);
                    }
                    catch (Exception ex)
                    {
                        ActivityLog.Log("watcher", $"Git #2225: DONE-bookend blocker check threw ({ex.Message}) — treating all still-open blockers as unsatisfied this tick (fail closed).");
                    }
                }
            }

            foreach (var item in candidates)
            {
                if (ready.Count >= limit) break;
                var blockers = EffectiveBlockers(item);
                bool hasOwnIssue = item.GithubNumber is int gh && gh > 0;

                // Nothing to verify against GitHub — no blockers and no real own-issue.
                // (--notGit sentinel or null github_number, and unblocked.) Ready as before.
                if (blockers.Count == 0 && !hasOwnIssue) { ready.Add(item); continue; }

                // Fail-closed (Git #1600 / #1904): any candidate that needs a live GitHub
                // check is held when we couldn't get a trustworthy open-issue snapshot.
                if (live == null || !live.Success)
                {
                    heldReasons[item.Id] = live == null
                        ? "internal error — GitHub open-issue set not evaluated"
                        : $"GitHub unreachable ({live.Error}) — holding until it can be re-checked";
                    continue;
                }

                // Git #1904 self-check FIRST: a queue row whose OWN issue has been closed
                // (for any reason — completed or not_planned) must never be claimed, even
                // with zero unresolved blockers. Surface it as a distinct held reason so
                // Shane sees the stale row and can cancel it, rather than it running
                // unwanted or vanishing silently.
                if (hasOwnIssue && !live.OpenNumbers.Contains(item.GithubNumber!.Value))
                {
                    heldReasons[item.Id] = $"underlying issue #{item.GithubNumber!.Value} is closed — this queue row needs manual review/cancellation";
                    continue;
                }

                if (blockers.Count == 0) { ready.Add(item); continue; }
                // Git #2225 — held only by blockers that are BOTH still open on GitHub AND not yet
                // satisfied by a verified DONE bookend. A blocker open on GitHub but proven-landed
                // (verified bookend) no longer holds a dependent — that's the whole liveness fix.
                var stillOpen = blockers.Where(b => live.OpenNumbers.Contains(b) && !satisfiedByDoneBookend.Contains(b)).ToList();
                if (stillOpen.Count == 0) { ready.Add(item); continue; }
                heldReasons[item.Id] = $"waiting on {string.Join(", ", stillOpen.Select(b => $"#{b}"))} (open)";
            }
            return new CandidateSelection(ready, heldReasons);
        }

        public async Task<List<QueueItem>> GetNextAsync(
            int limit, Func<Task<LiveOpenIssuesResult>>? liveOpenIssuesFetcher = null)
        {
            if (limit <= 0) return new List<QueueItem>();
            limit = Math.Min(limit, 20); // same cap as the server

            await using var conn = await OpenAsync();

            // Steps 1 & 2 — the shared, read-only selection (identical to what the
            // dropdown's PeekNextAsync sees). Only Step 3 below mutates anything.
            var selection = await SelectClaimCandidatesAsync(
                conn, limit, presuppliedOpen: null, liveOpenIssuesFetcher);
            LastHeldReasons = selection.HeldReasons;

            var ready = selection.Ready.Select(i => i.Id).ToList(); // ids to claim
            if (ready.Count == 0) return new List<QueueItem>();

            // Step 3 — claim atomically: WHERE status='queued' guards double-claim.
            var paramNames = new List<string>();
            var claimCmd = new NpgsqlCommand { Connection = conn };
            for (int i = 0; i < ready.Count; i++)
            {
                var p = $"@id{i}";
                paramNames.Add(p);
                claimCmd.Parameters.AddWithValue(p, ready[i]);
            }
            claimCmd.CommandText = $@"
                UPDATE bt_build_queue
                   SET status = 'running',
                       claimed_at = NOW(),
                       updated_at = NOW()
                 WHERE id = ANY(ARRAY[{string.Join(",", paramNames)}])
                   AND status = 'queued'
                RETURNING id, title, prompt, model, effort, cwd,
                          github_number, blocked_by_number, blocked_by_numbers,
                          status, exit_code, session_id, resume_session_id,
                          originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at";

            var claimed = new List<QueueItem>();
            await using (var reader = await claimCmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    claimed.Add(MapRow(reader));
            }
            await PopulateAssociatedIssueNumbersAsync(claimed, conn);
            return claimed;
        }

        // ── PeekNextAsync ─────────────────────────────────────────────────────────
        /// <summary>Git #1862 — result of <see cref="PeekNextAsync"/>. <see cref="BlockerKnowledgeAvailable"/>
        /// is false only when the caller has no live open-issue set yet (app start, before the
        /// first Git Board refresh); the dropdown then says so honestly rather than showing an
        /// order computed without blocker knowledge.</summary>
        public sealed record PeekResult(List<QueueItem> Items, bool BlockerKnowledgeAvailable);

        /// <summary>
        /// Git #1862 — a strictly READ-ONLY peek at the next <paramref name="limit"/> builds
        /// the watcher would claim, in the exact order <see cref="GetNextAsync"/> would claim
        /// them, WITHOUT claiming or mutating anything.
        ///
        /// This runs the same shared <see cref="SelectClaimCandidatesAsync"/> selection the
        /// real claim path runs and returns its ordered result verbatim. It issues NO UPDATE,
        /// writes no status, sets no <c>claimed_at</c>, and does not touch
        /// <see cref="LastHeldReasons"/> — a mistake here would claim work the dropdown is only
        /// meant to preview, so the read-only guarantee is structural, not just documented.
        ///
        /// It also fires NO `gh` call of its own: it reuses <paramref name="openIssues"/>, the
        /// panel's already-fetched Git Board open-issue set (Step 1 of #1862). Pass
        /// <c>null</c> when that set hasn't arrived yet — the peek then returns
        /// <see cref="PeekResult.BlockerKnowledgeAvailable"/> = false and no rows, so the UI can
        /// say "waiting for issue status" instead of guessing an order blockers might reorder.
        /// </summary>
        public async Task<PeekResult> PeekNextAsync(int limit, HashSet<int>? openIssues)
        {
            if (limit <= 0) return new PeekResult(new List<QueueItem>(), openIssues != null);
            limit = Math.Min(limit, 20);

            // No blocker knowledge yet → don't invent an order. Say so instead.
            if (openIssues == null)
                return new PeekResult(new List<QueueItem>(), BlockerKnowledgeAvailable: false);

            await using var conn = await OpenAsync();
            var selection = await SelectClaimCandidatesAsync(
                conn, limit,
                presuppliedOpen: LiveOpenIssuesResult.Ok(openIssues),
                liveOpenIssuesFetcher: null);
            return new PeekResult(selection.Ready, BlockerKnowledgeAvailable: true);
        }

        // ── QueueBuildAsync ───────────────────────────────────────────────────────
        /// <summary>Git #1638 — active states: still eligible to run (or run again automatically), so a
        /// duplicate Queue/Park click on top of one of these must never insert a second row — it should
        /// surface the existing item instead. Includes "external" (Send to Builder rows, Git #1638): not
        /// claimable by the watcher, but a second click while one is still running outside the cap is the
        /// same kind of accidental duplicate the rest of this bucket exists to catch. Includes
        /// AccountCapPolicy.CappedStatus (Git #1989) — a build parked by the Conservation Cap is a real,
        /// still-pending row, same reasoning as "parked".</summary>
        public static bool IsActiveStatus(string? status) => status is "queued" or "parked" or "running"
            or AccountCapPolicy.CappedStatus
            or VerifyingStatus or Services.SessionLimitAutoRestartService.LimitPausedStatus or "external";

        /// <summary>Git #1638 — terminal states: the row already ran to a real conclusion. A duplicate
        /// Queue/Park click matching one of these must NOT silently reset it back to queued/parked (that
        /// would erase the fact it already ran) — the caller shows an explicit "run it again?" confirm and
        /// only then re-queues via <paramref name="reuseRowId"/> on <see cref="QueueBuildAsync"/>.</summary>
        public static bool IsTerminalStatus(string? status) => status is "done" or "failed" or "canceled";

        /// <summary>
        /// Git #1638 — the generalized dedup lookup shared by Queue and Park (before either inserts a new
        /// row, the caller checks this first). GitHub-linked builds (githubNumber != null) match the most
        /// recent row for that issue number, regardless of its current status — this is a superset of the
        /// old "status &lt;&gt; running" lookup QueueBuildAsync's own upsert still uses internally, because a
        /// duplicate click must also be able to say "Already Running", not just silently reuse it. Local
        /// (--notGit) builds have no github_number to key off, so they match on an exact, whitespace-
        /// normalized comparison of the prompt text — bounded to rows created in the last 24 hours (an
        /// arbitrary but explicit window: a local prompt typed once six months ago re-appearing verbatim is
        /// far more likely coincidence than Shane re-sending it, and an unbounded scan only grows costlier
        /// over the life of the queue). Returns null when nothing matches.
        /// </summary>
        public async Task<QueueItem?> FindDedupCandidateAsync(int? githubNumber, string prompt)
        {
            await using var conn = await OpenAsync();
            QueueItem? row = null;

            if (githubNumber.HasValue)
            {
                await using var cmd = new NpgsqlCommand(@"
                    SELECT id, title, prompt, model, effort, cwd,
                           github_number, blocked_by_number, blocked_by_numbers,
                           status, exit_code, session_id, resume_session_id,
                           originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at
                    FROM bt_build_queue
                    WHERE github_number = @num
                    ORDER BY created_at DESC
                    LIMIT 1", conn);
                cmd.Parameters.AddWithValue("@num", githubNumber.Value);
                await using var reader = await cmd.ExecuteReaderAsync();
                if (await reader.ReadAsync()) row = MapRow(reader);
            }
            else
            {
                await using var cmd = new NpgsqlCommand(@"
                    SELECT id, title, prompt, model, effort, cwd,
                           github_number, blocked_by_number, blocked_by_numbers,
                           status, exit_code, session_id, resume_session_id,
                           originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at
                    FROM bt_build_queue
                    WHERE github_number IS NULL
                      AND created_at > @since
                      AND btrim(regexp_replace(prompt, '\s+', ' ', 'g')) = btrim(regexp_replace(@prompt, '\s+', ' ', 'g'))
                    ORDER BY created_at DESC
                    LIMIT 1", conn);
                cmd.Parameters.AddWithValue("@since", DateTime.UtcNow.AddHours(-24));
                cmd.Parameters.AddWithValue("@prompt", prompt ?? "");
                await using var reader = await cmd.ExecuteReaderAsync();
                if (await reader.ReadAsync()) row = MapRow(reader);
            }

            if (row != null)
                await PopulateAssociatedIssueNumbersAsync(new List<QueueItem> { row }, conn);
            return row;
        }

        /// <summary>
        /// Adds (or, for an issue-linked build, re-queues) a build. Replicates
        /// POST /admin/build-tracker/extension/queue's DB logic verbatim, including
        /// the Git #823 dedupe-by-githubNumber behavior: an issue-linked build
        /// (githubNumber != null) reuses its existing row instead of piling up a new
        /// one on every Queue/Retry click; a build with no githubNumber always
        /// inserts fresh. Also mirrors the server's fire-and-forget, non-fatal
        /// in-flight/complete label sync — via the local `gh` CLI
        /// (<see cref="GitHubIssuesService"/>) instead of a server-side GITHUB_TOKEN
        /// call, since this bypasses the server entirely.
        ///
        /// Git #1638 — <paramref name="park"/> writes the row's final status as
        /// "parked" instead of "queued" (a staging spot the watcher's claim query,
        /// WHERE status = 'queued', never picks up — see BuildQueuePostgresClient's
        /// class doc). <paramref name="reuseRowId"/> lets a caller that already ran
        /// FindDedupCandidateAsync and got an explicit "run it again?" confirmation
        /// reuse that exact terminal row instead of inserting a fresh one — it takes
        /// priority over the githubNumber-based lookup below (which stays unchanged
        /// for every other caller that doesn't pass it).
        /// </summary>
        public async Task<QueueItem> QueueBuildAsync(
            string title, string prompt, string? model, string? effort, string? cwd,
            int? githubNumber, List<int>? blockedByNumbers, string? resumeSessionId = null,
            string? chatUrl = null, string? originatingChatId = null, string? buildSet = null, string? cli = null,
            string? account = null, bool park = false, int? reuseRowId = null)
        {
            var finalStatus = park ? "parked" : "queued";
            var titleTrimmed = title.Trim();
            var modelTrimmed = string.IsNullOrWhiteSpace(model) ? null : model.Trim();
            var effortTrimmed = string.IsNullOrWhiteSpace(effort) ? null : effort.Trim();
            var cwdTrimmed = string.IsNullOrWhiteSpace(cwd) ? null : cwd.Trim();
            var buildSetTrimmed = string.IsNullOrWhiteSpace(buildSet) ? null : buildSet.Trim();
            var originatingChatIdTrimmed = string.IsNullOrWhiteSpace(originatingChatId) ? null : originatingChatId.Trim();
            var chatUrlTrimmed = string.IsNullOrWhiteSpace(chatUrl) ? null : chatUrl.Trim();
            var cliTrimmed = string.IsNullOrWhiteSpace(cli) ? null : cli.Trim();
            // Git #1416 — normalize the account: only an explicit "secondary" persists; anything
            // else (null, blank, "primary") stores NULL and launches against the default config dir.
            var accountTrimmed = string.Equals(account?.Trim(), "secondary", StringComparison.OrdinalIgnoreCase)
                ? "secondary" : null;

            var allBlockers = (blockedByNumbers ?? new List<int>()).Distinct().ToList();
            int? firstBlocker = allBlockers.Count > 0 ? allBlockers[0] : null;
            int[]? blockerArray = allBlockers.Count > 0 ? allBlockers.ToArray() : null;

            await using var conn = await OpenAsync();

            QueueItem? row = null;
            // Git #1638 — an explicit caller-confirmed reuse (a terminal-state dedup match the
            // user said "run it again" to) always wins over the githubNumber lookup below, and
            // applies whether or not this build has a github number (a local/--notGit rerun has
            // no github_number to key a lookup off at all).
            int? existingId = reuseRowId;
            if (!existingId.HasValue && githubNumber.HasValue)
            {
                await using var findCmd = new NpgsqlCommand(@"
                    SELECT id FROM bt_build_queue
                     WHERE github_number = @num
                       AND status <> 'running'
                     ORDER BY created_at DESC
                     LIMIT 1", conn);
                findCmd.Parameters.AddWithValue("@num", githubNumber.Value);
                var found = await findCmd.ExecuteScalarAsync();
                if (found != null && found != DBNull.Value) existingId = (int)found;
            }

            if (existingId.HasValue)
            {
                await using var updateCmd = new NpgsqlCommand(@"
                    UPDATE bt_build_queue
                       SET title = @title, prompt = @prompt, model = @model, effort = @effort, cwd = @cwd,
                           build_set = @buildSet, cli = @cli, account = @account,
                           blocked_by_number = @blockedByNumber, blocked_by_numbers = @blockedByNumbers,
                           resume_session_id = @resumeSessionId, originating_chat_id = @originatingChatId,
                           chat_url = @chatUrl, status = @status, claimed_at = NULL, completed_at = NULL,
                           exit_code = NULL, updated_at = NOW()
                      WHERE id = @id
                    RETURNING id, title, prompt, model, effort, cwd,
                              github_number, blocked_by_number, blocked_by_numbers,
                              status, exit_code, session_id, resume_session_id,
                              originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at", conn);
                updateCmd.Parameters.AddWithValue("@title", titleTrimmed);
                updateCmd.Parameters.AddWithValue("@prompt", prompt);
                updateCmd.Parameters.AddWithValue("@model", (object?)modelTrimmed ?? DBNull.Value);
                updateCmd.Parameters.AddWithValue("@effort", (object?)effortTrimmed ?? DBNull.Value);
                updateCmd.Parameters.AddWithValue("@cwd", (object?)cwdTrimmed ?? DBNull.Value);
                updateCmd.Parameters.AddWithValue("@buildSet", (object?)buildSetTrimmed ?? DBNull.Value);
                updateCmd.Parameters.AddWithValue("@cli", (object?)cliTrimmed ?? DBNull.Value);
                updateCmd.Parameters.AddWithValue("@account", (object?)accountTrimmed ?? DBNull.Value);
                updateCmd.Parameters.AddWithValue("@blockedByNumber", (object?)firstBlocker ?? DBNull.Value);
                updateCmd.Parameters.Add(new NpgsqlParameter("@blockedByNumbers", NpgsqlDbType.Array | NpgsqlDbType.Integer)
                { Value = (object?)blockerArray ?? DBNull.Value });
                updateCmd.Parameters.AddWithValue("@resumeSessionId", (object?)resumeSessionId ?? DBNull.Value);
                updateCmd.Parameters.AddWithValue("@originatingChatId", (object?)originatingChatIdTrimmed ?? DBNull.Value);
                updateCmd.Parameters.AddWithValue("@chatUrl", (object?)chatUrlTrimmed ?? DBNull.Value);
                updateCmd.Parameters.AddWithValue("@status", finalStatus);
                updateCmd.Parameters.AddWithValue("@id", existingId.Value);
                await using var reader = await updateCmd.ExecuteReaderAsync();
                if (await reader.ReadAsync()) row = MapRow(reader);
            }

            if (row == null)
            {
                await using var insertCmd = new NpgsqlCommand(@"
                    INSERT INTO bt_build_queue
                        (title, prompt, model, effort, cwd, github_number,
                         blocked_by_number, blocked_by_numbers, resume_session_id,
                         originating_chat_id, chat_url, build_set, cli, account, status)
                    VALUES
                        (@title, @prompt, @model, @effort, @cwd, @githubNumber,
                         @blockedByNumber, @blockedByNumbers, @resumeSessionId,
                         @originatingChatId, @chatUrl, @buildSet, @cli, @account, @status)
                    RETURNING id, title, prompt, model, effort, cwd,
                              github_number, blocked_by_number, blocked_by_numbers,
                              status, exit_code, session_id, resume_session_id,
                              originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at", conn);
                insertCmd.Parameters.AddWithValue("@title", titleTrimmed);
                insertCmd.Parameters.AddWithValue("@prompt", prompt);
                insertCmd.Parameters.AddWithValue("@model", (object?)modelTrimmed ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@effort", (object?)effortTrimmed ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@cwd", (object?)cwdTrimmed ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@buildSet", (object?)buildSetTrimmed ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@githubNumber", (object?)githubNumber ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@blockedByNumber", (object?)firstBlocker ?? DBNull.Value);
                insertCmd.Parameters.Add(new NpgsqlParameter("@blockedByNumbers", NpgsqlDbType.Array | NpgsqlDbType.Integer)
                { Value = (object?)blockerArray ?? DBNull.Value });
                insertCmd.Parameters.AddWithValue("@resumeSessionId", (object?)resumeSessionId ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@originatingChatId", (object?)originatingChatIdTrimmed ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@chatUrl", (object?)chatUrlTrimmed ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@cli", (object?)cliTrimmed ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@account", (object?)accountTrimmed ?? DBNull.Value);
                insertCmd.Parameters.AddWithValue("@status", finalStatus);
                await using var reader = await insertCmd.ExecuteReaderAsync();
                await reader.ReadAsync();
                row = MapRow(reader);
            }

            // Fire-and-forget, non-fatal — mirrors the server's own "queue action must
            // never be delayed or failed by a label sync" stance. Git #1638 — skipped for a
            // Park: a parked item isn't being worked yet, so it shouldn't flip the issue to
            // "in-flight" until it's actually un-parked into the real queue.
            if (githubNumber.HasValue && !park)
            {
                var num = githubNumber.Value;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await GitHubIssuesService.AddLabelAsync(num, "in-flight");
                        await GitHubIssuesService.RemoveLabelAsync(num, "complete");
                    }
                    catch { /* non-fatal, matches server behavior */ }
                });
            }

            if (row == null)
                throw new InvalidOperationException("QueueBuildAsync: INSERT ... RETURNING produced no row.");

            await PopulateAssociatedIssueNumbersAsync(new List<QueueItem> { row }, conn);

            return row;
        }

        // ── Git #2103 — build_dispatch_log ──────────────────────────────────────────
        /// <summary>
        /// Git #2103 — writes one real dispatch row the moment a queued item's process
        /// actually spawns (<c>QueueWatcherService.LaunchItem</c>, right before
        /// <c>RedirectedProcessLauncher.Launch</c>). Never called for a Reply/--resume
        /// continuation — that picks back up the SAME session rather than freshly
        /// dispatching the issue again, and logging it would inflate the re-dispatch
        /// count on every chat reply. <paramref name="queueItemId"/> links back to the
        /// exact bt_build_queue row this dispatch came from, so <see cref="MarkCompleteAsync"/>
        /// can fill in session_id/outcome on this same row later without a fragile
        /// in-memory map that wouldn't survive an app restart mid-build.
        /// </summary>
        public async Task LogDispatchAsync(int queueItemId, int issueNumber)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                INSERT INTO build_dispatch_log (issue_number, queue_item_id)
                VALUES (@issueNumber, @queueItemId)", conn);
            cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
            cmd.Parameters.AddWithValue("@queueItemId", queueItemId);
            await cmd.ExecuteNonQueryAsync();
        }

        /// <summary>
        /// Git #2103 — how many real dispatches this issue has already had since
        /// <paramref name="sinceUtc"/> (the last time it left the Batter-Up-family board
        /// columns — see <see cref="GitHubIssuesService.GetLastLeftBatterUpFamilyAtAsync"/>).
        /// A null <paramref name="sinceUtc"/> means it has never left the family (or GitHub
        /// couldn't be reached to determine that) — every real dispatch row on file for this
        /// issue counts toward the threshold.
        /// </summary>
        public async Task<int> CountDispatchesSinceAsync(int issueNumber, DateTime? sinceUtc)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                SELECT COUNT(*) FROM build_dispatch_log
                 WHERE issue_number = @issueNumber
                   AND (@since::timestamptz IS NULL OR dispatched_at > @since)", conn);
            cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
            cmd.Parameters.Add(new NpgsqlParameter("@since", NpgsqlDbType.TimestampTz)
            { Value = sinceUtc.HasValue ? (object)DateTime.SpecifyKind(sinceUtc.Value, DateTimeKind.Utc) : DBNull.Value });
            var result = await cmd.ExecuteScalarAsync();
            return result is long l ? (int)l : 0;
        }

        // ── MarkCompleteAsync ─────────────────────────────────────────────────────
        /// <summary>
        /// Marks a queue row done/verifying/failed and stores the session id so a
        /// Reply can resume it. Replicates POST /extension/queue/:id/complete, plus
        /// Git #1469's real-Verifying gate: a genuinely successful exit (0) on a row
        /// with a real github_number lands on <see cref="VerifyingStatus"/> instead
        /// of "done" — computed in-SQL from the row's own github_number so every
        /// caller (interactive stop, watcher reap, orphan retry, …) gets the same
        /// rule without having to know/pass the issue number itself. A row with no
        /// github_number has nothing to poll, so it falls straight through to "done"
        /// exactly as before.
        /// </summary>
        public async Task<(string Status, int? GithubNumber)> MarkCompleteAsync(int id, int exitCode, string? sessionId = null)
        {
            await using var conn = await OpenAsync();
            string? newStatus = null;
            int? githubNumber = null;
            await using (var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status        = CASE
                                          WHEN @exitCode = 0 AND github_number IS NOT NULL THEN @verifyingStatus
                                          WHEN @exitCode = 0 THEN 'done'
                                          ELSE 'failed'
                                        END,
                       exit_code     = @exitCode,
                       completed_at  = NOW(),
                       updated_at    = NOW()
                     , session_id    = COALESCE(@sessionId, session_id)
                       -- Git #1839 — clear the adoption pid so a stale pid never outlives its build.
                     , build_pid            = NULL
                     , build_pid_started_at = NULL
                 WHERE id = @id
                RETURNING status, github_number", conn))
            {
                cmd.Parameters.AddWithValue("@verifyingStatus", VerifyingStatus);
                cmd.Parameters.AddWithValue("@exitCode", exitCode);
                cmd.Parameters.AddWithValue("@sessionId",
                    sessionId != null ? (object)sessionId : DBNull.Value);
                cmd.Parameters.AddWithValue("@id", id);
                await using var reader = await cmd.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    newStatus = reader.IsDBNull(0) ? "" : reader.GetString(0);
                    // Git #2136 — always capture github_number (not only in the verifying branch)
                    // so the watcher can mirror the resulting durable state onto the real board:
                    // exit 0 + github# → Verifying column, non-zero exit → Crashed column.
                    githubNumber = reader.IsDBNull(1) ? (int?)null : reader.GetInt32(1);
                    if (newStatus == VerifyingStatus)
                    {
                        ActivityLog.Log("watcher",
                            $"Queue #{id} session exited successfully → Verifying (GH #{githubNumber}, exit {exitCode}) — held visible in the active queue until that issue actually closes.");
                    }
                }
            }

            // Git #2103 — mirror this same terminal status onto the dispatch row
            // LogDispatchAsync wrote at launch time (queue_item_id = this row's id), so
            // build_dispatch_log.outcome always reflects reality without a second
            // in-memory correlation map. A Reply/--resume completion never had a dispatch
            // row written for it (LogDispatchAsync is skipped for those), so this is a
            // harmless no-op then — the WHERE guard only ever touches a real, still-open
            // dispatch row.
            if (!string.IsNullOrEmpty(newStatus))
            {
                await using var dispatchCmd = new NpgsqlCommand(@"
                    UPDATE build_dispatch_log
                       SET session_id = COALESCE(@sessionId, session_id),
                           outcome    = @outcome
                     WHERE queue_item_id = @id
                       AND outcome IS NULL", conn);
                dispatchCmd.Parameters.AddWithValue("@sessionId",
                    sessionId != null ? (object)sessionId : DBNull.Value);
                dispatchCmd.Parameters.AddWithValue("@outcome", newStatus);
                dispatchCmd.Parameters.AddWithValue("@id", id);
                await dispatchCmd.ExecuteNonQueryAsync();
            }

            // Git #2136 — hand the resulting durable status + issue number back so the caller
            // (the watcher's completion reap) can mirror it onto the real board.
            return (newStatus ?? "", githubNumber);
        }

        // ── MarkSupersededByReplyAsync ────────────────────────────────────────────
        /// <summary>
        /// Git #2119 — resolves the ORIGINAL queue row when a Reply/resume has spawned a fresh
        /// <c>Reply → …</c> row (<paramref name="replacementId"/>) to take over its session. The
        /// original is transitioned to <see cref="SupersededStatus"/> and linked to the replacement
        /// via superseded_by_id, so the panel shows "↩ REPLIED → #N" and the card drops out of the
        /// active queue — instead of sitting there indefinitely showing stale active status while the
        /// real resumed work runs under a completely separate, disconnected entry.
        ///
        /// Deliberately scoped by the <c>status NOT IN (...)</c> guard: a row that is genuinely
        /// <c>running</c> is left to the watcher (it will reap to done/failed on its own — never stuck
        /// forever), and a row already in a terminal state (<c>done/failed/canceled</c>) already shows a
        /// correct final outcome, so it must not be rewritten to "superseded" (that would erase a real
        /// result). Only the genuinely-stuck active-but-not-running states (queued, parked, verifying,
        /// limit-paused, capped, external, held) are resolved. Returns the number of rows changed (0 if
        /// the guard skipped it) so the caller can log honestly.
        /// </summary>
        public async Task<int> MarkSupersededByReplyAsync(int originalId, int replacementId)
        {
            // Never let a row supersede itself (defensive — the replacement is always a fresh insert
            // with a new id, but a bad caller must not create a self-referential dead card).
            if (originalId == replacementId) return 0;

            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status           = @superseded,
                       superseded_by_id = @replacementId,
                       updated_at       = NOW()
                 WHERE id = @originalId
                   AND status NOT IN ('done', 'failed', 'canceled', 'running')", conn);
            cmd.Parameters.AddWithValue("@superseded", SupersededStatus);
            cmd.Parameters.AddWithValue("@replacementId", replacementId);
            cmd.Parameters.AddWithValue("@originalId", originalId);
            return await cmd.ExecuteNonQueryAsync();
        }

        // ── False-done reconciliation (Git #2685) ─────────────────────────────────
        /// <summary>
        /// Git #2685 — every issue-linked queue row currently sitting in a terminal <c>done</c>
        /// status, returned so the manual-refresh reconciliation pass
        /// (<see cref="Services.FalseDoneReconciler"/>) can check each one's real origin/main
        /// bookend. A self-blocked session that wrote a real 🛑 BLOCKED bookend and exited cleanly
        /// (process exit 0, nothing crashed) is marked <c>done</c> by the watcher's only completion
        /// signal (<see cref="MarkCompleteAsync"/>) — this is the set that must be reconciled against
        /// the authoritative bookend, since <c>done</c> is invisible to every dedup dead-check.
        /// </summary>
        public async Task<List<(int Id, int GithubNumber)>> GetDoneGithubRowsAsync()
        {
            var rows = new List<(int, int)>();
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                SELECT id, github_number
                  FROM bt_build_queue
                 WHERE status = 'done'
                   AND github_number IS NOT NULL", conn);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                rows.Add((reader.GetInt32(0), reader.GetInt32(1)));
            return rows;
        }

        /// <summary>
        /// Git #2685 — the deliberate, narrow exception to
        /// <see cref="MarkSupersededByReplyAsync"/>'s "never rewrite a terminal <c>done</c> row"
        /// guard: a NEW, dedicated method (the Reply-supersede guard exists for good reason and is
        /// NOT weakened here) that resets a confirmed false-<c>done</c> row — its origin/main bookend
        /// proves it is actually BLOCKED, not done — to <c>canceled</c>.
        ///
        /// <c>canceled</c> is chosen over <c>superseded</c> deliberately, and after live verification
        /// (see the issue): <c>canceled</c> is a real non-blocking terminal state
        /// (<see cref="IsTerminalStatus"/>) that already flows through EVERY dedup dead-check —
        /// <see cref="Services.BatterUpQueueService"/>.RefreshAsync (failed/canceled ⇒ reappear) and
        /// QueueRowAsync (IsTerminalStatus &amp;&amp; !done ⇒ re-queue via reuseRowId) — so the issue
        /// becomes re-dispatchable with zero changes to any gate and zero risk to the Reply flow. A
        /// <c>superseded</c> row, by contrast, is invisible to all three dead-checks and would stay
        /// dedup-locked. The <c>status = 'done'</c> guard makes this idempotent and race-safe: a row
        /// already moved on (by a concurrent watcher/refresh) is left untouched and returns 0.
        /// Returns the number of rows changed (0 or 1).
        /// </summary>
        public async Task<int> MarkFalseDoneReconciledAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = 'canceled',
                       updated_at = NOW()
                 WHERE id = @id
                   AND status = 'done'
                   AND github_number IS NOT NULL", conn);
            cmd.Parameters.AddWithValue("@id", id);
            return await cmd.ExecuteNonQueryAsync();
        }

        // ── StampBuildPidAsync ────────────────────────────────────────────────────
        /// <summary>
        /// Git #1839 — records the launched build process's pid and its process-creation time on
        /// the queue row, right after launch. A restarted BuildConsole reads these back
        /// (RecoverOrphanedRunningItemsAsync) to safely re-attach a build still running from the
        /// previous instance instead of falsely marking it failed -2. The creation time is the
        /// fingerprint that makes the pid match safe against Windows pid reuse. Cleared on
        /// completion (MarkCompleteAsync / MarkLimitPausedAsync).
        /// </summary>
        public async Task StampBuildPidAsync(int id, int pid, DateTimeOffset startedAtUtc)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET build_pid            = @pid,
                       build_pid_started_at = @startedAt,
                       updated_at           = NOW()
                 WHERE id = @id", conn);
            cmd.Parameters.AddWithValue("@pid", pid);
            cmd.Parameters.AddWithValue("@startedAt", startedAtUtc);
            cmd.Parameters.AddWithValue("@id", id);
            await cmd.ExecuteNonQueryAsync();
        }

        // ── PromoteVerifyingToDoneAsync ──────────────────────────────────────────
        /// <summary>
        /// Git #1469 — the other half of the Verifying gate: promotes every row
        /// currently sitting in <see cref="VerifyingStatus"/> to real "done" once its
        /// real GitHub issue has actually closed. Takes the caller's already-fetched
        /// open-issue-number set (see <see cref="GitHubIssuesService.GetOpenIssueNumbersAsync"/>)
        /// rather than making its own `gh` call, so this stays inside the existing
        /// manual-refresh-only GitHub discipline (#29/#35/#37) — no new background
        /// polling is introduced here. An empty/failed fetch is the caller's problem
        /// to guard (same "empty = couldn't determine" convention used elsewhere);
        /// this method trusts whatever set it's given.
        /// </summary>
        public async Task<List<(int Id, int GithubNumber)>> PromoteVerifyingToDoneAsync(IReadOnlySet<int> openIssueNumbers)
        {
            var promoted = new List<(int, int)>();
            await using var conn = await OpenAsync();
            await using var fetchCmd = new NpgsqlCommand(@"
                SELECT id, github_number FROM bt_build_queue
                WHERE status = @verifyingStatus AND github_number IS NOT NULL", conn);
            fetchCmd.Parameters.AddWithValue("@verifyingStatus", VerifyingStatus);
            var candidates = new List<(int Id, int GithubNumber)>();
            await using (var reader = await fetchCmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    candidates.Add((reader.GetInt32(0), reader.GetInt32(1)));
            }

            foreach (var (id, num) in candidates)
            {
                if (openIssueNumbers.Contains(num)) continue; // still open — stays Verifying

                await using var updateCmd = new NpgsqlCommand(@"
                    UPDATE bt_build_queue
                       SET status = 'done', updated_at = NOW()
                     WHERE id = @id AND status = @verifyingStatus", conn);
                updateCmd.Parameters.AddWithValue("@id", id);
                updateCmd.Parameters.AddWithValue("@verifyingStatus", VerifyingStatus);
                if (await updateCmd.ExecuteNonQueryAsync() > 0)
                {
                    promoted.Add((id, num));
                    ActivityLog.Log("github", $"Queue #{id}: GH #{num} confirmed closed → Verifying promoted to Done.");
                }
            }
            return promoted;
        }

        // ── ReconcileQueueAgainstBoardAsync (Git #2136, generalized by Git #2486) ─────
        /// <summary>
        /// Git #2136 — the real #1867 fix; Git #2486 generalizes it from Verifying-only to the
        /// whole PRE-DISPATCH surface (Verifying AND still-'queued' rows), so a Build Chain Map
        /// board move actually reaches live dispatch instead of only moving the GitHub label.
        ///
        /// <see cref="PromoteVerifyingToDoneAsync"/> only clears a Verifying row when its issue
        /// actually CLOSES; it never noticed Shane moving the issue elsewhere (a milestone
        /// deferral in #1867's case), so the stale local 'verifying' row re-surfaced across six
        /// dispatch cycles. And nothing at all noticed a Map <b>Batter Up → Backlog</b> move
        /// on a row that is merely 'queued' (never claimed): <see cref="GetNextAsync"/>'s claim
        /// gate checks blockers-closed + own-issue-open but NEVER the board Status column, so a
        /// Backlogged item kept dispatching (the #2486 concrete failure). Under the "Git IS the
        /// database, Kanban columns not labels" model the real board Status column is
        /// authoritative for the durable pre-dispatch decision, and this method reconciles each
        /// local pre-dispatch row against it:
        ///
        ///   VERIFYING row (a build already ran — unchanged from #2136):
        ///     board Park    → local 'parked'    board Crashed → local 'failed'
        ///     board Done    → local 'done'      board Backlog / Batter Up / AI Batter Up /
        ///                                       Verifying / Ask Shane / null / off-board → leave
        ///   QUEUED row (never claimed — the #2486 addition):
        ///     board Backlog → local 'canceled'  (Shane pulled it OUT of the launch queue — the
        ///                                        core fix; reversible: re-promoting to Batter Up
        ///                                        re-queues it via the #1870 free-flow pipeline)
        ///     board Park    → local 'parked'    board Crashed → local 'failed'
        ///     board Done    → local 'canceled'  (issue resolved without this build ever running)
        ///     board Batter Up / AI Batter Up / Verifying / Ask Shane / null / off-board → leave
        ///
        /// Under "Git IS the database" a queued row whose board is Backlog is by definition NOT
        /// dispatch-eligible regardless of how it got queued, so canceling it is the intended
        /// invariant, not a side effect. --notGit LOCAL rows (negative sentinel github_number,
        /// Git #1645) have no real board item and are excluded. Match is by the board Status
        /// OptionId against <see cref="GitHubApiClient"/>'s known option-id constants (robust to
        /// display-name drift). Fail-closed per row: an unreachable board read or an off-board
        /// issue leaves that row exactly as it was, so a transient GitHub hiccup can never
        /// wrongly clear a live row. Each write is CAS-guarded on the exact status we read for
        /// that row, so a concurrent claim (queued → running) between the read and the write is
        /// never clobbered. Runs on the same manual-refresh moments as PromoteVerifyingToDoneAsync
        /// (no new polling). The Verifying set is tiny, so its per-row board reads are cheap and
        /// always scanned; the still-'queued' set can be large (Shane stacks 10-20+ builds), so it
        /// is scanned ONLY for the specific issue numbers a caller passes in
        /// <paramref name="onlyQueuedGithubNumbers"/> — the Build Chain Map passes exactly the
        /// issues its edit just moved on the board (a handful), so a Map Backlog move cancels that
        /// row's dispatch without a blanket 60-issue board read on every unrelated refresh, and
        /// without ever second-guessing a row queued by hand for an issue this edit didn't touch.
        /// The blanket refresh sites (Home tab, Build Watch, Git Board) pass null → Verifying-only,
        /// exactly the original #2136 cost and behavior. Returns every row it actually reconciled.
        /// </summary>
        public async Task<List<(int Id, int GithubNumber, string NewStatus, string BoardStatus)>>
            ReconcileQueueAgainstBoardAsync(GitHubApiClient gh, IReadOnlyCollection<int>? onlyQueuedGithubNumbers = null)
        {
            var reconciled = new List<(int, int, string, string)>();
            await using var conn = await OpenAsync();

            // Pre-dispatch candidates: always the (tiny) Verifying set; the (potentially large)
            // still-'queued' set only for the explicitly-scoped issue numbers a Map edit moved.
            // Real GitHub issues only (github_number > 0 excludes the --notGit negative sentinel).
            var scopedQueued = onlyQueuedGithubNumbers != null && onlyQueuedGithubNumbers.Count > 0
                ? onlyQueuedGithubNumbers.Where(n => n > 0).Distinct().ToArray()
                : Array.Empty<int>();
            var candidates = new List<(int Id, int GithubNumber, string Status)>();
            await using (var fetchCmd = new NpgsqlCommand(@"
                SELECT id, github_number, status FROM bt_build_queue
                WHERE github_number IS NOT NULL AND github_number > 0
                  AND ( status = @verifyingStatus
                        OR (status = 'queued' AND github_number = ANY(@scopedQueued)) )", conn))
            {
                fetchCmd.Parameters.AddWithValue("@verifyingStatus", VerifyingStatus);
                fetchCmd.Parameters.AddWithValue("@scopedQueued", scopedQueued);
                await using var reader = await fetchCmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                    candidates.Add((reader.GetInt32(0), reader.GetInt32(1), reader.GetString(2)));
            }

            foreach (var (id, num, oldStatus) in candidates)
            {
                GitHubApiClient.IssueBoardStatus? board;
                try
                {
                    board = await gh.GetIssueBoardStatusAsync(num);
                }
                catch (Exception ex)
                {
                    // Fail closed — a board read error must never clear a live pre-dispatch row.
                    ActivityLog.Log("board-sync", $"Reconcile: couldn't read GH #{num}'s board status ({ex.Message}) — leaving queue #{id} '{oldStatus}'.");
                    continue;
                }

                string? newStatus = MapBoardToPreDispatchStatus(oldStatus, board?.OptionId);
                if (newStatus == null) continue;

                await using var updateCmd = new NpgsqlCommand(@"
                    UPDATE bt_build_queue
                       SET status = @newStatus, updated_at = NOW()
                     WHERE id = @id AND status = @oldStatus", conn);
                updateCmd.Parameters.AddWithValue("@newStatus", newStatus);
                updateCmd.Parameters.AddWithValue("@id", id);
                updateCmd.Parameters.AddWithValue("@oldStatus", oldStatus);
                if (await updateCmd.ExecuteNonQueryAsync() > 0)
                {
                    reconciled.Add((id, num, newStatus, board?.StatusName ?? "(off-board)"));
                    ActivityLog.Log("board-sync",
                        $"Queue #{id}: GH #{num} board Status is '{board?.StatusName ?? "(off-board)"}' → local row reconciled '{oldStatus}' → '{newStatus}'. Git is the database.");
                }
            }
            return reconciled;
        }

        /// <summary>
        /// Git #2486 — maps a live board Status OptionId to the local terminal status a
        /// pre-dispatch row (<paramref name="oldStatus"/> = 'verifying' or 'queued') should take,
        /// or null to leave the row untouched. Matched by OptionId against the known board
        /// option-id constants so a Status display-name rename never silently breaks the mapping.
        /// See <see cref="ReconcileQueueAgainstBoardAsync"/> for the full table and rationale.
        /// </summary>
        private static string? MapBoardToPreDispatchStatus(string oldStatus, string? boardOptionId)
        {
            if (string.IsNullOrEmpty(boardOptionId)) return null; // off-board / no Status → leave
            bool isQueued = string.Equals(oldStatus, "queued", StringComparison.OrdinalIgnoreCase);
            bool Is(string id) => string.Equals(boardOptionId, id, StringComparison.OrdinalIgnoreCase);

            if (Is(GitHubApiClient.ParkOptionId)) return "parked";
            if (Is(GitHubApiClient.CrashedOptionId)) return "failed";
            if (Is(GitHubApiClient.DoneOptionId)) return isQueued ? "canceled" : "done";
            // Backlog cancels a never-claimed queued row (the #2486 core fix); a Verifying row
            // (a build already ran) is left alone on Backlog, exactly as #2136 did.
            if (Is(GitHubApiClient.BacklogOptionId)) return isQueued ? "canceled" : null;
            // Batter Up / AI Batter Up / Verifying / Ask Shane / anything else → still eligible.
            return null;
        }

        // ── Stale-state cleanup / migration window (Git #2136) ───────────────────
        /// <summary>The local queue statuses this issue's cleanup window surfaces — every
        /// DURABLE workflow state that, under the new "Git IS the database" model, ought to be
        /// reflected by a real board Status column rather than living only as a local string
        /// that can silently drift from GitHub reality (the #1867 class). 'limit-paused' is
        /// included because it is surfaced/paired with Park in the same UI, even though it is a
        /// transient auto-restart state rather than a board column of its own.</summary>
        public static readonly string[] StaleWorkflowStatuses =
            { VerifyingStatus, "parked", "failed", Services.SessionLimitAutoRestartService.LimitPausedStatus };

        /// <summary>
        /// Git #2136 — every local row currently sitting in one of the durable workflow states
        /// (<see cref="StaleWorkflowStatuses"/>). Feeds the cleanup/migration window, which shows
        /// each row's local status alongside its REAL current GitHub board Status so Shane can
        /// migrate it to the matching board column or dismiss a genuinely-stale row. Read-only.
        /// </summary>
        public async Task<List<QueueItem>> GetStaleWorkflowStateRowsAsync()
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                SELECT id, title, prompt, model, effort, cwd,
                       github_number, blocked_by_number, blocked_by_numbers,
                       status, exit_code, session_id, resume_session_id,
                       originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at
                FROM bt_build_queue
                WHERE status = ANY(@statuses)
                ORDER BY updated_at DESC", conn);
            cmd.Parameters.AddWithValue("@statuses", StaleWorkflowStatuses);
            var items = new List<QueueItem>();
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    items.Add(MapRow(reader));
            }
            await PopulateAssociatedIssueNumbersAsync(items, conn);
            return items;
        }

        /// <summary>
        /// Git #2136 — the cleanup window's "Dismiss" action: a stale local row (like #1867 —
        /// the real decision already happened on GitHub) is set to 'canceled' so it drops out of
        /// every active view. Deliberately does NOT touch the GitHub board — whatever real
        /// decision Shane already made there stands; this only stops the LOCAL cache from
        /// re-surfacing a stale opinion. Guarded to the stale states so a live 'running'/'queued'
        /// row can never be dismissed out from under the watcher. Returns true when a row changed.
        /// </summary>
        public async Task<bool> DismissRowAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status = 'canceled', updated_at = NOW()
                 WHERE id = @id AND status = ANY(@statuses)", conn);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@statuses", StaleWorkflowStatuses);
            return await cmd.ExecuteNonQueryAsync() > 0;
        }

        /// <summary>
        /// Git #2136 — maps a local durable workflow status to the real board Status option id it
        /// should occupy (the "Migrate to board column" action). Returns null for a status with no
        /// distinct board column (e.g. limit-paused, a transient auto-restart state). Kept here,
        /// next to the statuses themselves, so the mapping has one home.
        /// </summary>
        public static string? BoardOptionIdForLocalStatus(string? status) => status switch
        {
            VerifyingStatus => GitHubApiClient.VerifyingOptionId,
            "failed" => GitHubApiClient.CrashedOptionId,
            "parked" => GitHubApiClient.ParkOptionId,
            _ => null,
        };

        // ── Build Sets ────────────────────────────────────────────────────────────
        /// <summary>Total number of queue rows in a build set (the wave size) — the
        /// count the dev-server coordinator uses as the set's "expected" member count,
        /// so it can defer the dev-server restart until every member has merged and
        /// then fire exactly ONE restart. Counts every non-canceled row with this
        /// build_set; use a UNIQUE set name per wave so a reused name never inflates
        /// the count. Returns 0 for a null/blank set (i.e. an ungrouped build).</summary>
        public async Task<int> CountBuildSetMembersAsync(string? buildSet)
        {
            if (string.IsNullOrWhiteSpace(buildSet)) return 0;
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "SELECT count(*) FROM bt_build_queue WHERE build_set = @s AND status <> 'canceled'", conn);
            cmd.Parameters.AddWithValue("@s", buildSet.Trim());
            var n = await cmd.ExecuteScalarAsync();
            return n == null || n == DBNull.Value ? 0 : Convert.ToInt32(n);
        }

        /// <summary>Number of build-set members still queued or running — used to detect
        /// when a set's wave has fully drained so the coordinator can be told to `close`
        /// it (the backstop that completes a set even if a member failed without
        /// reporting). Excludes the just-finished row's own id if given.</summary>
        public async Task<int> CountBuildSetPendingAsync(string? buildSet, int? excludeId = null)
        {
            if (string.IsNullOrWhiteSpace(buildSet)) return 0;
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "SELECT count(*) FROM bt_build_queue WHERE build_set = @s AND status IN ('queued','running') AND (@ex IS NULL OR id <> @ex)", conn);
            cmd.Parameters.AddWithValue("@s", buildSet.Trim());
            cmd.Parameters.AddWithValue("@ex", (object?)excludeId ?? DBNull.Value);
            var n = await cmd.ExecuteScalarAsync();
            return n == null || n == DBNull.Value ? 0 : Convert.ToInt32(n);
        }

        // ── UpdateSessionIdAsync ──────────────────────────────────────────────────
        /// <summary>
        /// Crash-recovery groundwork: persists the real Claude session id to a
        /// still-running row the MOMENT it's known (the CLI's own stream-json reveals
        /// it in its first line), instead of waiting for MarkCompleteAsync at the end
        /// of the run. Without this, a build killed by an app crash/hard reboot before
        /// it ever finished left session_id NULL forever — Retry could only restart
        /// the original prompt from scratch, discarding everything the run had
        /// actually done. WHERE session_id IS NULL makes this a write-once no-op once
        /// captured (matches MarkCompleteAsync's own COALESCE semantics), so calling
        /// it repeatedly as more stream-json lines arrive is harmless.
        /// </summary>
        public async Task UpdateSessionIdAsync(int id, string sessionId)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET session_id = @sessionId,
                       updated_at = NOW()
                 WHERE id = @id
                   AND session_id IS NULL", conn);
            cmd.Parameters.AddWithValue("@sessionId", sessionId);
            cmd.Parameters.AddWithValue("@id", id);
            await cmd.ExecuteNonQueryAsync();
        }

        // ── ForceClaimAsync ───────────────────────────────────────────────────────
        /// <summary>
        /// "Run Now" — atomically claims a specific still-queued row, bypassing the
        /// normal blocker/free-slot check. Throws if the row is no longer queued.
        /// Replicates POST /extension/queue/:id/force-claim.
        /// </summary>
        public async Task<QueueItem> ForceClaimAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = 'running',
                       claimed_at = NOW(),
                       updated_at = NOW()
                 WHERE id     = @id
                   AND status = 'queued'
                RETURNING id, title, prompt, model, effort, cwd,
                          github_number, blocked_by_number, blocked_by_numbers,
                          status, exit_code, session_id, resume_session_id,
                          originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at", conn);
            cmd.Parameters.AddWithValue("@id", id);

            QueueItem row;
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                if (!await reader.ReadAsync())
                    throw new InvalidOperationException($"Queue item {id} is not in 'queued' status — cannot force-claim.");
                // Git #1384 — this RETURNING must select the SAME columns (now through
                // account at ordinal 18, added #1416) that every other SELECT/RETURNING in
                // this file does, because MapRow reads the highest ordinal. It was once
                // missing build_set, so it returned only 16 columns (0–15) and MapRow threw
                // "Column must be between 0 and 15". That exception surfaced live as
                // "Couldn't force-launch continuation #NNN: Column must be between 0 and 15"
                // whenever a Build Watch chat nudge to a finished/exited build routed
                // through the #1327 resume path (SendSlotInput → ForceClaimAsync →
                // LaunchItemExplicit) — the real reason the text box "still didn't send".
                row = MapRow(reader);
            }

            await PopulateAssociatedIssueNumbersAsync(new List<QueueItem> { row }, conn);
            return row;
        }

        // ── CancelAsync ───────────────────────────────────────────────────────────
        /// <summary>
        /// Cancels a still-queued item so it never runs. Replicates
        /// DELETE /extension/queue/:id exactly — the WHERE status='queued' guard
        /// means a row that's already been claimed ('running') can't be canceled
        /// out from under the watcher; that'd be a lie the UI shouldn't tell.
        /// Returns false (no row updated) rather than throwing, so the caller can
        /// distinguish "already started running" from a real DB failure.
        /// </summary>
        public async Task<bool> CancelAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = 'canceled',
                       updated_at = NOW()
                 WHERE id     = @id
                   AND status IN ('queued', 'limit-paused', 'parked', @cappedStatus)", conn);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@cappedStatus", AccountCapPolicy.CappedStatus);
            var rowsAffected = await cmd.ExecuteNonQueryAsync();
            return rowsAffected > 0;
        }

        // ── UnparkAsync (Git #1638) ───────────────────────────────────────────────
        /// <summary>
        /// Flips ONE parked row back to 'queued', making it immediately eligible for
        /// the normal auto-run pipeline (GetNextAsync's claim query). Mirrors
        /// RequeueLimitPausedAsync's per-item "resume now" shape. Returns true only
        /// when the row was actually parked (a stale double-click on an already
        /// un-parked/canceled item is a safe no-op, not a silent success).
        /// </summary>
        public async Task<bool> UnparkAsync(int id)
        {
            await using var conn = await OpenAsync();
            int? num = null;
            await using (var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = 'queued',
                       updated_at = NOW()
                 WHERE id     = @id
                   AND status = 'parked'
                RETURNING github_number", conn))
            {
                cmd.Parameters.AddWithValue("@id", id);
                await using var reader = await cmd.ExecuteReaderAsync();
                if (!await reader.ReadAsync()) return false;
                if (!reader.IsDBNull(0)) num = reader.GetInt32(0);
            }

            // Same fire-and-forget label sync QueueBuildAsync does on a real queue —
            // un-parking is the moment this issue actually becomes in-flight work.
            if (num.HasValue)
            {
                var n = num.Value;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await GitHubIssuesService.AddLabelAsync(n, "in-flight");
                        await GitHubIssuesService.RemoveLabelAsync(n, "complete");
                    }
                    catch { /* non-fatal, matches QueueBuildAsync's own stance */ }
                });
            }
            return true;
        }

        // ── ParkAsync (Git #1832) ────────────────────────────────────────────────
        /// <summary>
        /// Flips ONE queued row to 'parked', pulling it out of the normal auto-run
        /// pipeline (GetNextAsync's claim query, WHERE status = 'queued', never sees
        /// it again until Un-park). Mirrors UnparkAsync's shape in reverse. Returns
        /// true only when the row was actually eligible (a stale double-click on an
        /// already-parked/canceled/running item is a safe no-op, not a silent
        /// success).
        ///
        /// Git #1832 — also allows 'limit-paused' -> 'parked': a build waiting out a
        /// session-limit reset is genuinely not running either, and parking it
        /// instead of waiting out the timer is a reasonable thing to want (same call
        /// CancelAsync already made by accepting 'limit-paused' alongside 'queued').
        /// Verifying items are deliberately NOT included — that work is already done
        /// and only waiting on GitHub to close; parking it would be a confusing
        /// state. Running items go through <see cref="ParkRunningAsync"/> instead,
        /// which also stops the process and preserves the session for resume — see
        /// that method's own doc for why it's a separate path, not folded in here.
        ///
        /// No label sync here, unlike UnparkAsync — this deliberately mirrors
        /// QueueBuildAsync's own stance (see its `!park` guard above): a parked item
        /// isn't in-flight work, but it also isn't "complete", so there's no label
        /// transition that correctly describes "actively queued -> staged, not
        /// forgotten." The in-flight label it already carries from being queued
        /// stays as-is; Un-park is what re-affirms in-flight when real work resumes.
        /// </summary>
        public async Task<bool> ParkAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = 'parked',
                       updated_at = NOW()
                 WHERE id     = @id
                   AND status IN ('queued', 'limit-paused')", conn);
            cmd.Parameters.AddWithValue("@id", id);
            var rowsAffected = await cmd.ExecuteNonQueryAsync();
            return rowsAffected > 0;
        }

        /// <summary>
        /// Park a RUNNING build — Shane: "sometimes a build agent decides it cannot
        /// continue until something is unblocked" (waiting on another issue/PR, a
        /// missing credential, a product decision, etc). Right-clicking a running
        /// build's "Park" pulls it straight out of the active queue into the same
        /// staging area <see cref="ParkAsync"/> uses for queued/limit-paused rows,
        /// so it stops competing for a Build Watch slot until the blocker clears —
        /// but unlike Stop/Cancel (which mark the row failed/canceled and abandon
        /// the conversation) this preserves resume_session_id, so Un-park later
        /// resumes the exact session (`claude --resume`) instead of starting the
        /// prompt over. The caller (BuildQueuePanel) stops the actual process
        /// first via QueueWatcherService.TryStop and passes along whatever session
        /// id it captured (item.SessionId, falling back to the watcher's live one);
        /// this just does the DB half. Only fires from 'running' — a stale
        /// double-click after the build already finished is a safe no-op.
        /// </summary>
        public async Task<bool> ParkRunningAsync(int id, string? sessionId)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status            = 'parked',
                       claimed_at        = NULL,
                       session_id        = COALESCE(@sessionId, session_id),
                       resume_session_id = COALESCE(resume_session_id, @sessionId, session_id),
                       updated_at        = NOW(),
                       build_pid            = NULL,
                       build_pid_started_at = NULL
                 WHERE id     = @id
                   AND status = 'running'", conn);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@sessionId", (object?)sessionId ?? DBNull.Value);
            var rowsAffected = await cmd.ExecuteNonQueryAsync();
            return rowsAffected > 0;
        }

        /// <summary>
        /// Shane: "All builds no matter their status should be able to be parked" —
        /// generalizes <see cref="ParkAsync"/>/<see cref="ParkRunningAsync"/> to every
        /// remaining status (verifying, done, failed, canceled, external — anything
        /// that isn't already 'queued'/'limit-paused'/'running', which keep their own
        /// dedicated methods above since queued/limit-paused rows need no session-id
        /// backfill and running needs the caller to stop the process first). Same
        /// shape as ParkRunningAsync otherwise: preserves/backfills resume_session_id
        /// so Un-park resumes rather than restarts, and is a no-op (false) on a row
        /// already parked — a stale double-click is safe.
        /// </summary>
        public async Task<bool> ParkAnyAsync(int id, string? sessionId = null)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status            = 'parked',
                       claimed_at        = NULL,
                       session_id        = COALESCE(@sessionId, session_id),
                       resume_session_id = COALESCE(resume_session_id, @sessionId, session_id),
                       updated_at        = NOW(),
                       build_pid            = NULL,
                       build_pid_started_at = NULL
                 WHERE id     = @id
                   AND status <> 'parked'", conn);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@sessionId", (object?)sessionId ?? DBNull.Value);
            var rowsAffected = await cmd.ExecuteNonQueryAsync();
            return rowsAffected > 0;
        }

        // ── Conservation Cap (Git #1989) ─────────────────────────────────────────
        /// <summary>
        /// Parks a claimed-but-never-launched row (already 'running' — GetNextAsync
        /// claims before QueueWatcherService.LaunchItem ever runs the cap check) as
        /// <see cref="AccountCapPolicy.CappedStatus"/> instead of letting it launch.
        /// No status guard, same as the original Git #1418 MarkHeldForOverflowAsync
        /// this mirrors — the caller already knows the row was mid-claim. Deliberately
        /// a DISTINCT status from the unrelated #1638 "parked" staging status (see
        /// AccountCapPolicy.CappedStatus's own doc comment for why reusing it would be
        /// wrong) and from the legacy "held" status (whose own one-shot startup reclaim,
        /// ReclaimLegacyHeldRowsAsync, must keep running untouched and can never collide
        /// with this — it only ever looks for literal 'held' rows).
        /// </summary>
        public async Task MarkCappedAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = @status,
                       claimed_at = NULL,
                       updated_at = NOW()
                 WHERE id = @id", conn);
            cmd.Parameters.AddWithValue("@status", AccountCapPolicy.CappedStatus);
            cmd.Parameters.AddWithValue("@id", id);
            await cmd.ExecuteNonQueryAsync();
        }

        /// <summary>All rows currently parked at <see cref="AccountCapPolicy.CappedStatus"/> —
        /// drives the BuildQueuePanel "Capped" filter/count and MainWindow's Drain-button count.</summary>
        public async Task<List<QueueItem>> GetCappedAsync()
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                SELECT id, title, prompt, model, effort, cwd,
                       github_number, blocked_by_number, blocked_by_numbers,
                       status, exit_code, session_id, resume_session_id,
                       originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at
                FROM bt_build_queue
                WHERE status = @status
                ORDER BY created_at ASC", conn);
            cmd.Parameters.AddWithValue("@status", AccountCapPolicy.CappedStatus);
            var items = new List<QueueItem>();
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    items.Add(MapRow(reader));
            }
            await PopulateAssociatedIssueNumbersAsync(items, conn);
            return items;
        }

        /// <summary>
        /// The per-item "Run at Full Model" override (Git #1989): flips ONE capped row
        /// back to 'queued', preserving its real model/effort untouched (nothing was ever
        /// substituted — the BUILD: header was never modified by parking). The caller then
        /// force-claims and force-launches it immediately (same two-step shape the removed
        /// Git #1418 Sonnet-downgrade "Run Now" used), which is what makes this a genuine
        /// one-shot: the Conservation toggle itself is never touched here. Returns false
        /// (no row updated) on a stale double-click for an item no longer capped.
        /// </summary>
        public async Task<bool> UncapAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = 'queued',
                       updated_at = NOW()
                 WHERE id     = @id
                   AND status = @status", conn);
            cmd.Parameters.AddWithValue("@status", AccountCapPolicy.CappedStatus);
            cmd.Parameters.AddWithValue("@id", id);
            var rowsAffected = await cmd.ExecuteNonQueryAsync();
            return rowsAffected > 0;
        }

        /// <summary>
        /// Drain (Git #1989) — Shane's own words: "a quick button to drain the parked
        /// queue with its full model... especially if it's 9pm+ ET on a Sunday." Releases
        /// EVERY currently-capped row back to 'queued' in one statement, at its real
        /// original model/effort (never substituted — see UncapAsync's own doc). Unlike
        /// UncapAsync this does NOT force-claim/launch each row — it just re-opens them to
        /// the normal auto-run pipeline (GetNextAsync picks them up on the very next tick,
        /// respecting the normal concurrency-slot limit rather than blasting every process
        /// at once). Returns the released rows so the caller can log/toast the real count
        /// and each item's model/effort.
        /// </summary>
        public async Task<List<QueueItem>> DrainCappedAsync()
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = 'queued',
                       updated_at = NOW()
                 WHERE status = @status
                RETURNING id, title, prompt, model, effort, cwd,
                          github_number, blocked_by_number, blocked_by_numbers,
                          status, exit_code, session_id, resume_session_id,
                          originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at", conn);
            cmd.Parameters.AddWithValue("@status", AccountCapPolicy.CappedStatus);
            var items = new List<QueueItem>();
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    items.Add(MapRow(reader));
            }
            await PopulateAssociatedIssueNumbersAsync(items, conn);
            return items;
        }

        // ── QueueExternalAsync (Git #1638) ────────────────────────────────────────
        /// <summary>
        /// "Send to Builder" tracking row — per #1638's locked decision, this is a
        /// plain insert-only record (never an upsert/reuse; every Send to Builder
        /// click is its own independent external launch), written with status
        /// 'external'. Confirmed invisible to both BuildQueuePostgresClient.GetNextAsync's
        /// claim query (WHERE status = 'queued') and BuildWatchWindow.AdmitNewRunning
        /// (only ever pulls status == "running") — so it can never be claimed for
        /// auto-run and never competes for one of the 8 Build Watch slots, structurally
        /// rather than by a special-case guard. The returned row's id is passed back
        /// through the mybuilder:// URI as queueId= so scripts/run-claude.ps1 can
        /// redirect its real stdout/stderr to this same id's BuildLogPaths.ForQueueItem
        /// log file and write the real exit code back to this exact row when it exits.
        /// </summary>
        public async Task<QueueItem> QueueExternalAsync(
            string title, string prompt, string? model, string? effort, string? cwd, string? chatUrl = null)
        {
            var titleTrimmed = title.Trim();
            var modelTrimmed = string.IsNullOrWhiteSpace(model) ? null : model.Trim();
            var effortTrimmed = string.IsNullOrWhiteSpace(effort) ? null : effort.Trim();
            var cwdTrimmed = string.IsNullOrWhiteSpace(cwd) ? null : cwd.Trim();
            var chatUrlTrimmed = string.IsNullOrWhiteSpace(chatUrl) ? null : chatUrl.Trim();

            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                INSERT INTO bt_build_queue (title, prompt, model, effort, cwd, chat_url, status)
                VALUES (@title, @prompt, @model, @effort, @cwd, @chatUrl, 'external')
                RETURNING id, title, prompt, model, effort, cwd,
                          github_number, blocked_by_number, blocked_by_numbers,
                          status, exit_code, session_id, resume_session_id,
                          originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at", conn);
            cmd.Parameters.AddWithValue("@title", titleTrimmed);
            cmd.Parameters.AddWithValue("@prompt", prompt);
            cmd.Parameters.AddWithValue("@model", (object?)modelTrimmed ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@effort", (object?)effortTrimmed ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@cwd", (object?)cwdTrimmed ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@chatUrl", (object?)chatUrlTrimmed ?? DBNull.Value);
            await using var reader = await cmd.ExecuteReaderAsync();
            await reader.ReadAsync();
            return MapRow(reader);
        }

        // ── MarkOrphanedFailedAsync ───────────────────────────────────────────────
        /// <summary>
        /// Used by RecoverOrphanedRunningItemsAsync: marks a row failed with the
        /// sentinel exit code -2 so it's visible in the panel with a clear "orphaned
        /// by app restart" explanation. Same as MarkCompleteAsync but always -2.
        /// </summary>
        public Task MarkOrphanedFailedAsync(int id) => MarkCompleteAsync(id, -2, null);

        /// <summary>
        /// Git #1479 — one-shot startup reclaim of any row left at the retired 'held'
        /// status. 'held' was the secondary-account Sonnet+ Overflow cap's park status;
        /// the cap and all machinery that could ever set it are now deleted, but a row
        /// parked before the removal would otherwise be stranded forever — GetNextAsync
        /// only ever reclaims WHERE status = 'queued'. This flips every leftover 'held'
        /// row straight back to 'queued', PRESERVING its real account/model/effort (it
        /// only touches status/claimed_at/updated_at — it does NOT null the account the
        /// way the removed bulk-resume did). Normally a no-op (nothing creates 'held'
        /// anymore); returns the reclaimed rows for logging. Run once at watcher startup.
        /// </summary>
        public async Task<List<QueueItem>> ReclaimLegacyHeldRowsAsync()
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = 'queued',
                       claimed_at = NULL,
                       updated_at = NOW()
                 WHERE status = 'held'
                RETURNING id, title, prompt, model, effort, cwd,
                          github_number, blocked_by_number, blocked_by_numbers,
                          status, exit_code, session_id, resume_session_id,
                          originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at", conn);
            var items = new List<QueueItem>();
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    items.Add(MapRow(reader));
            }
            await PopulateAssociatedIssueNumbersAsync(items, conn);
            return items;
        }

        // ── Session-limit auto-restart (SessionLimitAutoRestartService) ──────────

        /// <summary>
        /// Parks a build whose CLI output hit the session limit: status 'limit-paused'
        /// (never reclaimed by GetNextAsync's WHERE status = 'queued'), claim released,
        /// and resume_session_id backfilled from the captured session_id so the
        /// auto-restart RESUMES the conversation instead of starting from scratch.
        /// </summary>
        public async Task MarkLimitPausedAsync(int id, string? sessionId)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status            = @status,
                       claimed_at        = NULL,
                       session_id        = COALESCE(@sessionId, session_id),
                       resume_session_id = COALESCE(resume_session_id, @sessionId, session_id),
                       updated_at        = NOW(),
                       -- Git #1839 — the process exited; clear the adoption pid.
                       build_pid            = NULL,
                       build_pid_started_at = NULL
                 WHERE id = @id", conn);
            cmd.Parameters.AddWithValue("@status", SessionLimitAutoRestartService.LimitPausedStatus);
            cmd.Parameters.AddWithValue("@sessionId", (object?)sessionId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@id", id);
            await cmd.ExecuteNonQueryAsync();
        }

        /// <summary>All rows currently parked limit-paused — drives the Build Queue panel's countdown banner.</summary>
        public async Task<List<QueueItem>> GetLimitPausedAsync()
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                SELECT id, title, prompt, model, effort, cwd,
                       github_number, blocked_by_number, blocked_by_numbers,
                       status, exit_code, session_id, resume_session_id,
                       originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at
                FROM bt_build_queue
                WHERE status = @status
                ORDER BY created_at ASC", conn);
            cmd.Parameters.AddWithValue("@status", SessionLimitAutoRestartService.LimitPausedStatus);
            var items = new List<QueueItem>();
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    items.Add(MapRow(reader));
            }
            await PopulateAssociatedIssueNumbersAsync(items, conn);
            return items;
        }

        /// <summary>
        /// The auto-restart itself: every limit-paused row back to 'queued' in one
        /// statement (resume_session_id already set by MarkLimitPausedAsync), so the
        /// next tick's GetNextAsync picks them all up and resumes their sessions.
        /// Returns the resumed rows for logging/UI refresh.
        /// </summary>
        public async Task<List<QueueItem>> ResumeLimitPausedAsync()
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = 'queued',
                       updated_at = NOW()
                 WHERE status = @status
                RETURNING id, title, prompt, model, effort, cwd,
                          github_number, blocked_by_number, blocked_by_numbers,
                          status, exit_code, session_id, resume_session_id,
                          originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at", conn);
            cmd.Parameters.AddWithValue("@status", SessionLimitAutoRestartService.LimitPausedStatus);
            var items = new List<QueueItem>();
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    items.Add(MapRow(reader));
            }
            await PopulateAssociatedIssueNumbersAsync(items, conn);
            return items;
        }

        /// <summary>
        /// First-set bootstrap: parks the MOST RECENT row for this GitHub issue as
        /// limit-paused, but only when that row is sitting failed/canceled (a
        /// manually-stopped or errored attempt). A row already queued, running or
        /// genuinely done is left alone. Returns true when a row was parked.
        /// </summary>
        public async Task<bool> MarkLatestRowLimitPausedForIssueAsync(int githubNumber)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status            = @status,
                       claimed_at        = NULL,
                       resume_session_id = COALESCE(resume_session_id, session_id),
                       updated_at        = NOW()
                 WHERE id = (SELECT id FROM bt_build_queue
                              WHERE github_number = @num
                              ORDER BY created_at DESC
                              LIMIT 1)
                   AND status IN ('failed', 'canceled')", conn);
            cmd.Parameters.AddWithValue("@status", SessionLimitAutoRestartService.LimitPausedStatus);
            cmd.Parameters.AddWithValue("@num", githubNumber);
            return await cmd.ExecuteNonQueryAsync() > 0;
        }

        /// <summary>Per-item "Resume Now": flips ONE limit-paused row back to 'queued' ahead of the timer (resume_session_id already preserved). Returns true when the row was actually limit-paused.</summary>
        public async Task<bool> RequeueLimitPausedAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = 'queued',
                       updated_at = NOW()
                 WHERE id     = @id
                   AND status = @status", conn);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@status", SessionLimitAutoRestartService.LimitPausedStatus);
            return await cmd.ExecuteNonQueryAsync() > 0;
        }

        /// <summary>
        /// Manual "Recover Session-Limit Builds" — the BuildQueuePanel button that scans
        /// recent stdout logs for a session-limit hit (see
        /// <see cref="SessionLimitAutoRestartService.ManualRecoverFromLogsAsync"/>) and
        /// requeues whatever row it finds, no matter what status the row landed in
        /// (limit-paused via the normal live-detection path, or failed/canceled/held —
        /// e.g. the process died before that path could mark it). Only touches a row
        /// that is genuinely stalled: queued/running/verifying/done rows are left alone.
        /// resume_session_id is preserved/backfilled so the requeue resumes the
        /// conversation rather than starting over. Returns the updated row, or null if
        /// this id wasn't in an eligible status (already handled by something else).
        /// </summary>
        public async Task<QueueItem?> RecoverStalledSessionLimitRowAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status            = 'queued',
                       claimed_at        = NULL,
                       resume_session_id = COALESCE(resume_session_id, session_id),
                       updated_at        = NOW(),
                       build_pid            = NULL,
                       build_pid_started_at = NULL
                 WHERE id = @id
                   AND status IN ('failed', 'canceled', 'held', @limitPaused)
                RETURNING id, title, prompt, model, effort, cwd,
                          github_number, blocked_by_number, blocked_by_numbers,
                          status, exit_code, session_id, resume_session_id,
                          originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at", conn);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@limitPaused", SessionLimitAutoRestartService.LimitPausedStatus);
            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync()) return null;
            var item = MapRow(reader);
            return item;
        }

        // ── Helpers ───────────────────────────────────────────────────────────────

        private async Task<NpgsqlConnection> OpenAsync()
        {
            var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();
            return conn;
        }

        // Git #1600 — REMOVED here: AreBlockersClearedAsync/IsBlockerClearedAsync used
        // to decide a blocker was "cleared" from the most-recent local bt_build_queue
        // row's own status/exit_code (status='done' or 'verifying' AND exit_code=0),
        // with no GitHub call at all. That is precisely how #1483 started while #1482
        // was still open — a session exiting 0 is not the same as its real GitHub
        // issue closing, and local queue state is not authoritative. The live
        // replacement lives inline in GetNextAsync's Step 2 (one
        // `gh issue list --state open` snapshot per tick, fail-closed on an
        // unreachable GitHub) — see the class doc comment.

        /// <summary>
        /// Replicates the server's effectiveBlockedByNumbers: prefers blockedByNumbers
        /// (the plural column), falls back to blockedByNumber (singular legacy column).
        /// </summary>
        private static List<int> EffectiveBlockers(QueueItem item)
        {
            if (item.BlockedByNumbers != null && item.BlockedByNumbers.Count > 0)
                return item.BlockedByNumbers;
            if (item.BlockedByNumber.HasValue)
                return new List<int> { item.BlockedByNumber.Value };
            return new List<int>();
        }

        private static QueueItem MapRow(NpgsqlDataReader r)
        {
            // Column order matches every SELECT in this file:
            // id, title, prompt, model, effort, cwd,
            // github_number, blocked_by_number, blocked_by_numbers,
            // status, exit_code, session_id, resume_session_id,
            // originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at
            // Git #2119 — superseded_by_id is an OPTIONAL trailing ordinal (21): only GetQueueAsync's
            // display query selects it. Every other SELECT stops at build_pid_started_at (FieldCount==21),
            // so the FieldCount>21 guard below leaves SupersededById null for them rather than throwing —
            // no need to thread the new column through all ~13 SELECTs (the #1384 fixed-ordinal minefield).
            var blockedByNumbersRaw = r.IsDBNull(8) ? null : r.GetValue(8) as int[];
            return new QueueItem
            {
                Id                = r.GetInt32(0),
                Title             = r.IsDBNull(1) ? "" : r.GetString(1),
                Prompt            = r.IsDBNull(2) ? "" : r.GetString(2),
                Model             = r.IsDBNull(3) ? null : r.GetString(3),
                Effort            = r.IsDBNull(4) ? null : r.GetString(4),
                Cwd               = r.IsDBNull(5) ? null : r.GetString(5),
                GithubNumber      = r.IsDBNull(6) ? null : r.GetInt32(6),
                BlockedByNumber   = r.IsDBNull(7) ? null : r.GetInt32(7),
                BlockedByNumbers  = blockedByNumbersRaw != null
                                        ? new List<int>(blockedByNumbersRaw)
                                        : null,
                Status            = r.IsDBNull(9)  ? "queued" : r.GetString(9),
                ExitCode          = r.IsDBNull(10) ? null : r.GetInt32(10),
                SessionId         = r.IsDBNull(11) ? null : r.GetString(11),
                ResumeSessionId   = r.IsDBNull(12) ? null : r.GetString(12),
                OriginatingChatId = r.IsDBNull(13) ? null : r.GetString(13),
                ChatUrl           = r.IsDBNull(14) ? null : r.GetString(14),
                UpdatedAt         = r.IsDBNull(15) ? null : r.GetFieldValue<DateTimeOffset>(15),
                BuildSet          = r.IsDBNull(16) ? null : r.GetString(16),
                Cli               = r.IsDBNull(17) ? null : r.GetString(17),
                Account           = r.IsDBNull(18) ? null : r.GetString(18),
                BuildPid          = r.IsDBNull(19) ? null : r.GetInt32(19),
                BuildPidStartedAt = r.IsDBNull(20) ? null : r.GetFieldValue<DateTimeOffset>(20),
                // Git #2119 — optional trailing ordinal (see the note above): present only on
                // GetQueueAsync's display query.
                SupersededById    = r.FieldCount > 21 && !r.IsDBNull(21) ? r.GetInt32(21) : null,
            };
        }

        private static async Task PopulateAssociatedIssueNumbersAsync(List<QueueItem> items, NpgsqlConnection conn)
        {
            if (items == null || items.Count == 0) return;

            // Pre-seed with item's own GithubNumber — but ONLY when it's a real (positive)
            // GitHub issue number. Git #1645: a --notGit LOCAL build stores its letter-id
            // ordinal as a NEGATIVE github_number (see MainWindow.LocalBuildId.cs — that
            // negative is the intended storage sentinel, not corrupt data). That sentinel is
            // never a real GitHub issue, so it must not leak into AssociatedIssueNumbers, which
            // is downstream fed to `gh issue view <num>` — where a value like -26 makes gh's own
            // CLI parser choke ("unknown shorthand flag: '2' in -26") instead of hitting a
            // harmless 404. Filter it out at the source.
            foreach (var item in items)
            {
                if (item.GithubNumber is int gh && gh > 0)
                {
                    if (!item.AssociatedIssueNumbers.Contains(gh))
                        item.AssociatedIssueNumbers.Add(gh);
                }
            }

            var chatIds = items.Select(i => i.OriginatingChatId)
                               .Where(id => !string.IsNullOrWhiteSpace(id))
                               .Distinct()
                               .ToList();

            if (chatIds.Count == 0) return;

            // Fetch the chat IDs, issue/epic numbers, and bt_chat_issues for these chats
            var chatMap = new Dictionary<string, (int id, int? issueNum, int? epicNum, List<int> extraIssues)>();
            var dbIds = new List<int>();

            const string sqlChats = @"
                SELECT c.conversation_id, c.id, i.github_number, e.github_number
                FROM bt_chats c
                LEFT JOIN bt_issues i ON c.issue_id = i.id
                LEFT JOIN bt_epics e ON c.epic_id = e.id
                WHERE c.conversation_id = ANY(@chatIds)";

            await using (var cmd = new NpgsqlCommand(sqlChats, conn))
            {
                cmd.Parameters.AddWithValue("@chatIds", chatIds.ToArray());
                await using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        var convId = reader.GetString(0);
                        var id = reader.GetInt32(1);
                        int? issueNum = reader.IsDBNull(2) ? null : reader.GetInt32(2);
                        int? epicNum = reader.IsDBNull(3) ? null : reader.GetInt32(3);
                        chatMap[convId] = (id, issueNum, epicNum, new List<int>());
                        dbIds.Add(id);
                    }
                }
            }

            if (dbIds.Count > 0)
            {
                const string sqlIssues = @"
                    SELECT chat_id, issue_number
                    FROM bt_chat_issues
                    WHERE chat_id = ANY(@dbIds)";
                
                await using (var cmdIssues = new NpgsqlCommand(sqlIssues, conn))
                {
                    cmdIssues.Parameters.AddWithValue("@dbIds", dbIds.ToArray());
                    await using (var reader = await cmdIssues.ExecuteReaderAsync())
                    {
                        while (await reader.ReadAsync())
                        {
                            var chatId = reader.GetInt32(0);
                            var issueNum = reader.GetInt32(1);
                            foreach (var kvp in chatMap)
                            {
                                if (kvp.Value.id == chatId)
                                {
                                    kvp.Value.extraIssues.Add(issueNum);
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            foreach (var item in items)
            {
                if (!string.IsNullOrWhiteSpace(item.OriginatingChatId) && chatMap.TryGetValue(item.OriginatingChatId, out var chatData))
                {
                    if (chatData.issueNum.HasValue && !item.AssociatedIssueNumbers.Contains(chatData.issueNum.Value))
                    {
                        item.AssociatedIssueNumbers.Add(chatData.issueNum.Value);
                    }
                    if (chatData.epicNum.HasValue && !item.AssociatedIssueNumbers.Contains(chatData.epicNum.Value))
                    {
                        item.AssociatedIssueNumbers.Add(chatData.epicNum.Value);
                    }
                    foreach (var num in chatData.extraIssues)
                    {
                        if (!item.AssociatedIssueNumbers.Contains(num))
                        {
                            item.AssociatedIssueNumbers.Add(num);
                        }
                    }
                }
            }
        }

        // ── Static factory ────────────────────────────────────────────────────────
        public async Task<BoardResponse> GetBoardAsync()
        {
            var board = new BoardResponse();
            await using var conn = await OpenAsync();

            // 1. Fetch Epics
            const string sqlEpics = @"
                SELECT id, title, status, github_number
                FROM bt_epics
                ORDER BY title ASC";
            await using var cmdEpics = new NpgsqlCommand(sqlEpics, conn);
            await using (var reader = await cmdEpics.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    board.Epics.Add(new BoardEpic
                    {
                        Id = reader.GetInt32(0),
                        Title = reader.IsDBNull(1) ? "" : reader.GetString(1),
                        Status = reader.IsDBNull(2) ? "" : reader.GetString(2),
                        GithubNumber = reader.IsDBNull(3) ? null : reader.GetInt32(3)
                    });
                }
            }

            // 2. Fetch Chats and join issue/epic github numbers
            const string sqlChats = @"
                SELECT c.id, c.conversation_id, c.title, c.epic_id, c.updated_at,
                       i.github_number AS issue_github_number,
                       e.github_number AS epic_github_number,
                       c.archived, c.archived_at, c.account
                FROM bt_chats c
                LEFT JOIN bt_issues i ON c.issue_id = i.id
                LEFT JOIN bt_epics e ON c.epic_id = e.id
                ORDER BY c.updated_at DESC";

            var chatsTemp = new List<BoardChat>();
            var chatIdToChat = new Dictionary<int, BoardChat>();

            // Git #1480 — bt_chats.account doesn't exist until Shane runs the migration
            // (lib/db/migrations/manual/2026-08-28-bt-chats-account-1480.sql). Fail honest: the
            // Chats panel must show an explicit "database not ready" state rather than silently
            // dropping back to the pre-#1480 query and letting a filtered-looking UI imply
            // account scoping that isn't real (same rule as #1472). Only this block is guarded —
            // epics already loaded fine above.
            try
            {
                await using var cmdChats = new NpgsqlCommand(sqlChats, conn);
                await using (var reader = await cmdChats.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        var id = reader.GetInt32(0);
                        var convId = reader.IsDBNull(1) ? "" : reader.GetString(1);
                        var chat = new BoardChat
                        {
                            Id = id,
                            ConversationId = convId,
                            Title = reader.IsDBNull(2) ? "" : reader.GetString(2),
                            EpicId = reader.IsDBNull(3) ? null : reader.GetInt32(3),
                            UpdatedAt = reader.IsDBNull(4) ? null : (DateTime?)reader.GetDateTime(4),
                            ClaudeUrl = $"https://claude.ai/chat/{convId}",
                            Archived = !reader.IsDBNull(7) && reader.GetBoolean(7),
                            ArchivedAt = reader.IsDBNull(8) ? null : (DateTime?)reader.GetDateTime(8),
                            Account = reader.IsDBNull(9) ? "primary" : reader.GetString(9),
                        };

                        int? issueGithubNum = reader.IsDBNull(5) ? null : reader.GetInt32(5);
                        int? epicGithubNum = reader.IsDBNull(6) ? null : reader.GetInt32(6);

                        chat.IssueGithubNumber = issueGithubNum;

                        if (issueGithubNum.HasValue)
                            chat.AssociatedIssueNumbers.Add(issueGithubNum.Value);
                        if (epicGithubNum.HasValue)
                            chat.AssociatedIssueNumbers.Add(epicGithubNum.Value);

                        chatsTemp.Add(chat);
                        chatIdToChat[id] = chat;
                    }
                }
            }
            catch (PostgresException pex) when (pex.SqlState == PostgresErrorCodes.UndefinedColumn)
            {
                board.AccountColumnMissing = true;
                board.Chats = new List<BoardChat>();
                return board;
            }

            // 3. Fetch associated issue numbers from bt_chat_issues
            const string sqlChatIssues = @"
                SELECT chat_id, issue_number
                FROM bt_chat_issues";
            await using var cmdChatIssues = new NpgsqlCommand(sqlChatIssues, conn);
            await using (var reader = await cmdChatIssues.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    var chatId = reader.GetInt32(0);
                    var issueNum = reader.GetInt32(1);
                    if (chatIdToChat.TryGetValue(chatId, out var chat))
                    {
                        if (!chat.AssociatedIssueNumbers.Contains(issueNum))
                        {
                            chat.AssociatedIssueNumbers.Add(issueNum);
                        }
                    }
                }
            }

            // 4. Git #2066 — attach the noisy auto-detected mention registry, keyed by
            // each chat's own ClaudeUrl (already computed above at row-build time).
            try
            {
                var mentionsByUrl = await GetChatIssueMentionsAsync();
                foreach (var chat in chatsTemp)
                {
                    if (mentionsByUrl.TryGetValue(chat.ClaudeUrl, out var nums))
                        chat.MentionedIssueNumbers = nums;
                }
            }
            catch (PostgresException pex) when (pex.SqlState == PostgresErrorCodes.UndefinedTable)
            {
                // Migration not run yet — leave MentionedIssueNumbers empty rather than
                // failing the whole Chats panel load over an optional signal.
            }

            board.Chats = chatsTemp;
            return board;
        }

        // ── ArchiveChatAsync / UnarchiveChatAsync ────────────────────────────────────
        /// <summary>
        /// Soft-hides a chat from the default active Chats panel view by its
        /// conversation_id — the real bt_chats row and every association
        /// (bt_chat_issues, epic/issue links) are left fully intact. Replicates
        /// POST /admin/build-tracker/chats/archive's DB logic verbatim (direct
        /// Postgres, no HTTP round-trip — this is BuildConsole's own local data
        /// change, same reasoning as the rest of this file). Returns the real
        /// archived_at timestamp written by NOW(), or null if no row matched.
        /// </summary>
        public Task<DateTime?> ArchiveChatAsync(string conversationId) =>
            SetChatArchivedAsync(conversationId, archived: true);

        /// <summary>Reverses ArchiveChatAsync — restores a chat to the default active Chats panel view.</summary>
        public Task<DateTime?> UnarchiveChatAsync(string conversationId) =>
            SetChatArchivedAsync(conversationId, archived: false);

        /// <summary>Renames a chat's display title in bt_chats by its conversationId.</summary>
        public async Task RenameChatAsync(string conversationId, string newTitle)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_chats
                   SET title = @newTitle,
                       updated_at = NOW()
                 WHERE conversation_id = @conversationId", conn);
            cmd.Parameters.AddWithValue("@newTitle", newTitle);
            cmd.Parameters.AddWithValue("@conversationId", conversationId);
            int rows = await cmd.ExecuteNonQueryAsync();
            if (rows == 0)
                throw new InvalidOperationException($"Chat '{conversationId}' not found — cannot rename.");
        }

        private async Task<DateTime?> SetChatArchivedAsync(string conversationId, bool archived)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_chats
                   SET archived    = @archived,
                       archived_at = @archivedAt,
                       updated_at  = NOW()
                 WHERE conversation_id = @conversationId
                RETURNING archived_at", conn);
            cmd.Parameters.AddWithValue("@archived", archived);
            cmd.Parameters.Add(new NpgsqlParameter("@archivedAt", NpgsqlDbType.TimestampTz)
            { Value = archived ? (object)DateTime.UtcNow : DBNull.Value });
            cmd.Parameters.AddWithValue("@conversationId", conversationId);

            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
                throw new InvalidOperationException($"Chat '{conversationId}' not found — cannot {(archived ? "archive" : "unarchive")}.");
            return reader.IsDBNull(0) ? null : reader.GetFieldValue<DateTime>(0);
        }

        // ── LinkChatToIssueAsync ──────────────────────────────────────────────────
        /// <summary>
        /// Links a chat to a GitHub issue directly in the Postgres database,
        /// bypassing the API server. This matches the behavior of POST /chats/assign-issue.
        ///
        /// Git #2068 — Step 4's epic/issue resolution used to look ONLY at the local
        /// bt_epics/bt_issues tables. If the target hadn't been GitHub-synced into those
        /// tables yet, both lookups came back empty and the method fell through silently:
        /// bt_chat_issues still got its row (Step 3, unconditional), but bt_chats.epic_id/
        /// issue_id were never set, and the caller had no way to tell — no error surfaced,
        /// no false return value, just a link that never actually stuck. Same local-table-
        /// staleness class #1362 fixed on the READ side (LeftSidebar.GetEpicForChat /
        /// BackfillSyntheticEpicsFromBoard) but never applied to this write path.
        /// <paramref name="resolveLive"/> is that same live-board-aware fallback: the
        /// caller passes a lookup over its OWN already-fetched Git Board data
        /// (LeftSidebar._lastBoardIssues) so a not-yet-synced epic/issue can be upserted
        /// here (title + github_number only — real GitHub state gets picked up properly
        /// on the next full sync) instead of silently dropped. Returns whether epic_id/
        /// issue_id actually got resolved and persisted, so the caller can show a real
        /// warning instead of a false-success toast when it didn't.
        /// </summary>
        public async Task<bool> LinkChatToIssueAsync(string conversationId, int issueNumber, string? title = null, Func<int, LiveBoardIssueInfo?>? resolveLive = null)
        {
            await using var conn = await OpenAsync();

            // Step 1: Check if the chat exists in bt_chats
            const string selectSql = "SELECT id FROM bt_chats WHERE conversation_id = @convId LIMIT 1";
            int? chatId = null;

            await using (var cmd = new NpgsqlCommand(selectSql, conn))
            {
                cmd.Parameters.AddWithValue("@convId", conversationId);
                var val = await cmd.ExecuteScalarAsync();
                if (val != null && val != DBNull.Value)
                {
                    chatId = Convert.ToInt32(val);
                }
            }

            // Step 2: If it doesn't exist, insert it and get the new ID
            if (chatId == null)
            {
                // Git #1480 — stamp the title-bar toggle's CURRENT value on a genuinely new chat
                // row only; re-linking an existing chat (chatId already found above) never
                // touches its account. Falls back to "primary" if bt_chats.account doesn't exist
                // yet (pre-#1480 migration) — see the catch below.
                const string insertChatSql = @"
                    INSERT INTO bt_chats (conversation_id, title, account)
                    VALUES (@convId, @title, @account)
                    RETURNING id";

                try
                {
                    await using var cmd = new NpgsqlCommand(insertChatSql, conn);
                    cmd.Parameters.AddWithValue("@convId", conversationId);
                    cmd.Parameters.AddWithValue("@title", title?.Trim() ?? $"[#{issueNumber}] Chat");
                    cmd.Parameters.AddWithValue("@account", BuildConsoleSettings.CurrentAccountLabel());
                    var val = await cmd.ExecuteScalarAsync();
                    if (val != null && val != DBNull.Value)
                    {
                        chatId = Convert.ToInt32(val);
                    }
                }
                catch (PostgresException pex) when (pex.SqlState == PostgresErrorCodes.UndefinedColumn)
                {
                    // bt_chats.account doesn't exist yet — insert without it (schema default,
                    // once the migration runs, is 'primary' anyway) rather than failing the
                    // whole chat-link action over a column this specific write doesn't strictly need.
                    const string insertChatSqlLegacy = @"
                        INSERT INTO bt_chats (conversation_id, title)
                        VALUES (@convId, @title)
                        RETURNING id";
                    await using var cmd = new NpgsqlCommand(insertChatSqlLegacy, conn);
                    cmd.Parameters.AddWithValue("@convId", conversationId);
                    cmd.Parameters.AddWithValue("@title", title?.Trim() ?? $"[#{issueNumber}] Chat");
                    var val = await cmd.ExecuteScalarAsync();
                    if (val != null && val != DBNull.Value)
                    {
                        chatId = Convert.ToInt32(val);
                    }
                }
            }

            if (chatId == null)
                throw new Exception("Failed to insert or find chat in bt_chats");

            // Step 3: Insert link into bt_chat_issues with ON CONFLICT DO NOTHING
            const string insertLinkSql = @"
                INSERT INTO bt_chat_issues (chat_id, issue_number)
                VALUES (@chatId, @issueNumber)
                ON CONFLICT DO NOTHING";

            await using (var cmd = new NpgsqlCommand(insertLinkSql, conn))
            {
                cmd.Parameters.AddWithValue("@chatId", chatId.Value);
                cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                await cmd.ExecuteNonQueryAsync();
            }

            // Step 4: Look up if this issueNumber is an Epic or an Issue, and update bt_chats
            // (Git #2068 — resolveLive-backed fallback lives in ResolveAndPersistChatLinkAsync)
            var (epicId, issueId) = await ResolveAndPersistChatLinkAsync(conn, chatId.Value, issueNumber, resolveLive);
            return epicId.HasValue || issueId.HasValue;
        }

        // ── UnlinkChatFromIssueAsync ──────────────────────────────────────────────
        /// <summary>
        /// Unlinks a chat from a GitHub issue directly in the Postgres database,
        /// bypassing the API server. This matches the behavior of POST /chats/unassign-issue.
        ///
        /// Git #2068 — the remaining-link recalculation below had the identical local-
        /// table-only resolution bug as <see cref="LinkChatToIssueAsync"/>: when the
        /// chat's next remaining associated number wasn't in bt_epics/bt_issues, neither
        /// branch fired and bt_chats.epic_id/issue_id were left untouched — pointing at
        /// the epic/issue that was JUST unlinked, a real staleness bug of its own, not
        /// only a missed-opportunity one. Same <paramref name="resolveLive"/> fallback
        /// as the link path.
        /// </summary>
        public async Task UnlinkChatFromIssueAsync(string conversationId, int issueNumber, Func<int, LiveBoardIssueInfo?>? resolveLive = null)
        {
            await using var conn = await OpenAsync();

            // Step 1: Check if the chat exists in bt_chats
            const string selectSql = "SELECT id FROM bt_chats WHERE conversation_id = @convId LIMIT 1";
            int? chatId = null;

            await using (var cmd = new NpgsqlCommand(selectSql, conn))
            {
                cmd.Parameters.AddWithValue("@convId", conversationId);
                var val = await cmd.ExecuteScalarAsync();
                if (val != null && val != DBNull.Value)
                {
                    chatId = Convert.ToInt32(val);
                }
            }

            // Step 2: If it exists, delete the link from bt_chat_issues and clean up bt_chats
            if (chatId != null)
            {
                const string deleteLinkSql = @"
                    DELETE FROM bt_chat_issues
                    WHERE chat_id = @chatId AND issue_number = @issueNumber";

                await using (var cmd = new NpgsqlCommand(deleteLinkSql, conn))
                {
                    cmd.Parameters.AddWithValue("@chatId", chatId.Value);
                    cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                    await cmd.ExecuteNonQueryAsync();
                }

                // Recalculate remaining links
                const string selectRemainingSql = "SELECT issue_number FROM bt_chat_issues WHERE chat_id = @chatId LIMIT 1";
                int? remainingIssueNumber = null;
                await using (var cmd = new NpgsqlCommand(selectRemainingSql, conn))
                {
                    cmd.Parameters.AddWithValue("@chatId", chatId.Value);
                    var val = await cmd.ExecuteScalarAsync();
                    if (val != null && val != DBNull.Value)
                    {
                        remainingIssueNumber = Convert.ToInt32(val);
                    }
                }

                if (remainingIssueNumber == null)
                {
                    const string nullChatSql = "UPDATE bt_chats SET epic_id = NULL, issue_id = NULL, updated_at = NOW() WHERE id = @chatId";
                    await using (var cmd = new NpgsqlCommand(nullChatSql, conn))
                    {
                        cmd.Parameters.AddWithValue("@chatId", chatId.Value);
                        await cmd.ExecuteNonQueryAsync();
                    }
                }
                else
                {
                    // Git #2068 — same resolveLive-backed fallback as the link path, so a
                    // remaining associated number that isn't locally synced yet doesn't
                    // leave bt_chats.epic_id/issue_id stale (still pointing at what was
                    // just unlinked) instead of moving to the real remaining target.
                    await ResolveAndPersistChatLinkAsync(conn, chatId.Value, remainingIssueNumber.Value, resolveLive);
                }
            }
        }

        // ── ResolveAndPersistChatLinkAsync (Git #2068) ─────────────────────────────
        /// <summary>
        /// Shared epic/issue resolution + bt_chats persistence for both
        /// <see cref="LinkChatToIssueAsync"/> (Step 4) and <see cref="UnlinkChatFromIssueAsync"/>'s
        /// remaining-link recalculation. Tries the local bt_epics/bt_issues tables first
        /// (github_number match, exactly the original behavior); if both miss and
        /// <paramref name="resolveLive"/> can resolve <paramref name="issueNumber"/> from the
        /// caller's already-fetched live Git Board data, upserts a minimal bt_epics/bt_issues
        /// row (title + github_number, real state fills in on the next full GitHub sync) so
        /// the chat link doesn't strand — the same self-heal #1362 gave the read/grouping
        /// side, now applied to the write side. A plain issue's own parent epic is only
        /// resolved from the LOCAL table (bounded scope: this fixes the reported silent
        /// drop, not a full recursive parent-chain sync) — if the parent isn't local either,
        /// the issue is still linked, just without a parent epic grouping until a real sync
        /// catches up. Always writes bt_chats.epic_id/issue_id to whatever was resolved
        /// (including leaving both untouched when nothing resolved, matching prior
        /// fall-through behavior) and returns what it resolved so the caller can tell.
        /// </summary>
        private static async Task<(int? EpicId, int? IssueId)> ResolveAndPersistChatLinkAsync(
            NpgsqlConnection conn, int chatId, int issueNumber, Func<int, LiveBoardIssueInfo?>? resolveLive)
        {
            const string findEpicSql = "SELECT id FROM bt_epics WHERE github_number = @issueNumber LIMIT 1";
            int? epicId = null;
            await using (var cmd = new NpgsqlCommand(findEpicSql, conn))
            {
                cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                var val = await cmd.ExecuteScalarAsync();
                if (val != null && val != DBNull.Value) epicId = Convert.ToInt32(val);
            }

            int? issueId = null;
            int? issueEpicId = null;
            if (!epicId.HasValue)
            {
                const string findIssueSql = "SELECT id, epic_id FROM bt_issues WHERE github_number = @issueNumber LIMIT 1";
                await using (var cmd = new NpgsqlCommand(findIssueSql, conn))
                {
                    cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                    await using var reader = await cmd.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        issueId = reader.GetInt32(0);
                        issueEpicId = reader.IsDBNull(1) ? null : (int?)reader.GetInt32(1);
                    }
                }
            }

            // Git #2068 — local lookup missed both tables: fall back to the caller's live
            // Git Board data instead of silently leaving bt_chats untouched.
            if (!epicId.HasValue && !issueId.HasValue && resolveLive != null)
            {
                var live = resolveLive(issueNumber);
                if (live.HasValue)
                {
                    if (live.Value.IsEpic)
                    {
                        const string upsertEpicSql = @"
                            INSERT INTO bt_epics (title, status, github_number)
                            VALUES (@title, 'open', @issueNumber)
                            ON CONFLICT (github_number) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
                            RETURNING id";
                        await using var cmd = new NpgsqlCommand(upsertEpicSql, conn);
                        cmd.Parameters.AddWithValue("@title", live.Value.Title);
                        cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                        var val = await cmd.ExecuteScalarAsync();
                        if (val != null && val != DBNull.Value)
                        {
                            epicId = Convert.ToInt32(val);
                            ActivityLog.Log("git-board.chats",
                                $"live-board fallback: upserted bt_epics for not-yet-synced #{issueNumber} ('{live.Value.Title}') so its chat link could resolve (Git #2068)");
                        }
                    }
                    else
                    {
                        // Bounded scope: only checks the LOCAL table for the parent epic —
                        // see this method's doc comment.
                        int? parentEpicId = null;
                        if (live.Value.ParentEpicGithubNumber.HasValue)
                        {
                            const string findParentEpicSql = "SELECT id FROM bt_epics WHERE github_number = @parentNumber LIMIT 1";
                            await using var pcmd = new NpgsqlCommand(findParentEpicSql, conn);
                            pcmd.Parameters.AddWithValue("@parentNumber", live.Value.ParentEpicGithubNumber.Value);
                            var pval = await pcmd.ExecuteScalarAsync();
                            if (pval != null && pval != DBNull.Value) parentEpicId = Convert.ToInt32(pval);
                        }

                        const string upsertIssueSql = @"
                            INSERT INTO bt_issues (title, status, github_number, epic_id)
                            VALUES (@title, 'backlog', @issueNumber, @epicId)
                            ON CONFLICT (github_number) DO UPDATE SET title = EXCLUDED.title,
                                epic_id = COALESCE(bt_issues.epic_id, EXCLUDED.epic_id), updated_at = NOW()
                            RETURNING id, epic_id";
                        await using var icmd = new NpgsqlCommand(upsertIssueSql, conn);
                        icmd.Parameters.AddWithValue("@title", live.Value.Title);
                        icmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                        icmd.Parameters.Add(new NpgsqlParameter("@epicId", NpgsqlDbType.Integer)
                        { Value = parentEpicId.HasValue ? (object)parentEpicId.Value : DBNull.Value });
                        await using var reader = await icmd.ExecuteReaderAsync();
                        if (await reader.ReadAsync())
                        {
                            issueId = reader.GetInt32(0);
                            issueEpicId = reader.IsDBNull(1) ? null : (int?)reader.GetInt32(1);
                            ActivityLog.Log("git-board.chats",
                                $"live-board fallback: upserted bt_issues for not-yet-synced #{issueNumber} ('{live.Value.Title}') so its chat link could resolve (Git #2068)");
                        }
                    }
                }
                else
                {
                    ActivityLog.Log("git-board.chats",
                        $"chat link to #{issueNumber} persisted via bt_chat_issues only — couldn't resolve it to a local OR live-board epic/issue (Git #2068); grouping won't show it until a sync catches up");
                }
            }

            if (issueId.HasValue)
            {
                const string updateChatIssueSql = @"
                    UPDATE bt_chats
                    SET issue_id = @issueId, epic_id = @epicId, updated_at = NOW()
                    WHERE id = @chatId";
                await using var cmd = new NpgsqlCommand(updateChatIssueSql, conn);
                cmd.Parameters.AddWithValue("@issueId", issueId.Value);
                cmd.Parameters.Add(new NpgsqlParameter("@epicId", NpgsqlDbType.Integer)
                { Value = issueEpicId.HasValue ? (object)issueEpicId.Value : DBNull.Value });
                cmd.Parameters.AddWithValue("@chatId", chatId);
                await cmd.ExecuteNonQueryAsync();
            }
            else if (epicId.HasValue)
            {
                const string updateChatEpicSql = @"
                    UPDATE bt_chats
                    SET epic_id = @epicId, issue_id = NULL, updated_at = NOW()
                    WHERE id = @chatId";
                await using var cmd = new NpgsqlCommand(updateChatEpicSql, conn);
                cmd.Parameters.AddWithValue("@epicId", epicId.Value);
                cmd.Parameters.AddWithValue("@chatId", chatId);
                await cmd.ExecuteNonQueryAsync();
            }

            return (epicId, issueId);
        }

        // ── RecordChatIssueMentionsAsync / PruneClosedChatIssueMentionsAsync (Git #2066) ──
        /// <summary>
        /// Upserts the noisy, auto-detected "every #NNN this chat has mentioned" registry
        /// (bt_chat_mentioned_issues) — fed by IssueMentionInjector.cs's batch scan report,
        /// NOT the deliberate bt_chat_issues association table. Keyed on the chat's own URL
        /// text so a mention can be recorded even for a chat never explicitly linked to
        /// anything. Safe to call repeatedly with overlapping numbers (ON CONFLICT bumps
        /// last_seen_at only).
        /// </summary>
        public async Task RecordChatIssueMentionsAsync(string chatUrl, IReadOnlyCollection<int> issueNumbers)
        {
            if (string.IsNullOrWhiteSpace(chatUrl) || issueNumbers == null || issueNumbers.Count == 0) return;

            await using var conn = await OpenAsync();
            const string sql = @"
                INSERT INTO bt_chat_mentioned_issues (chat_url, issue_number, first_seen_at, last_seen_at)
                VALUES (@chatUrl, @issueNumber, NOW(), NOW())
                ON CONFLICT (chat_url, issue_number) DO UPDATE SET last_seen_at = NOW()";

            foreach (var issueNumber in issueNumbers)
            {
                await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("@chatUrl", chatUrl);
                cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                await cmd.ExecuteNonQueryAsync();
            }
        }

        /// <summary>
        /// Auto-removal on close (Git #2066) — deletes every tracked mention whose issue
        /// number is not in the real open-issue set GitHub just reported. Called off the
        /// SAME <c>LeftSidebar.GitBoardOpenIssuesRefreshed</c> event BuildWatch/BuildQueuePanel
        /// already consume for their own closed-issue eviction — no second poll invented.
        /// Returns the number of rows removed.
        /// </summary>
        public async Task<int> PruneClosedChatIssueMentionsAsync(IReadOnlyCollection<int> openIssueNumbers)
        {
            await using var conn = await OpenAsync();
            const string sql = @"
                DELETE FROM bt_chat_mentioned_issues
                WHERE NOT (issue_number = ANY(@openNumbers))";
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@openNumbers", (openIssueNumbers ?? Array.Empty<int>()).ToArray());
            return await cmd.ExecuteNonQueryAsync();
        }

        /// <summary>Chat-URL → tracked mention numbers, for GetBoardAsync to attach onto each BoardChat.</summary>
        public async Task<Dictionary<string, List<int>>> GetChatIssueMentionsAsync()
        {
            var result = new Dictionary<string, List<int>>(StringComparer.OrdinalIgnoreCase);
            await using var conn = await OpenAsync();
            const string sql = "SELECT chat_url, issue_number FROM bt_chat_mentioned_issues";
            await using var cmd = new NpgsqlCommand(sql, conn);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var url = reader.GetString(0);
                var num = reader.GetInt32(1);
                if (!result.TryGetValue(url, out var list))
                {
                    list = new List<int>();
                    result[url] = list;
                }
                list.Add(num);
            }
            return result;
        }

        /// <summary>Git #2195 — one row of a chat's mention registry: the issue number plus WHEN it
        /// was last mentioned, so the dock's staleness filter can act on real data instead of
        /// assuming everything the table has ever seen is still "pending right now".</summary>
        public readonly record struct ChatIssueMention(int Number, DateTimeOffset LastSeenAt);

        /// <summary>
        /// Git #2195 — the single-chat-scoped equivalent of <see cref="GetChatIssueMentionsAsync"/>
        /// (which reads every chat's mentions for the board's grouping). The Floating Chat Window's
        /// side dock needs just the one chat it's docked to, so this scopes the same table at the SQL
        /// layer instead of fetching every chat's rows and filtering in C#. Carries last_seen_at (not
        /// just the bare number) because a real live chat can rack up hundreds of mentions over its
        /// life (confirmed: one chat_url in production has 449) — the dock needs that timestamp to
        /// tell "still pending" apart from "mentioned once, months ago, never closed".
        /// </summary>
        public async Task<List<ChatIssueMention>> GetChatIssueMentionsForUrlAsync(string chatUrl)
        {
            var result = new List<ChatIssueMention>();
            if (string.IsNullOrWhiteSpace(chatUrl)) return result;

            await using var conn = await OpenAsync();
            const string sql = "SELECT issue_number, last_seen_at FROM bt_chat_mentioned_issues WHERE chat_url = @chatUrl ORDER BY last_seen_at DESC";
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@chatUrl", chatUrl);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                result.Add(new ChatIssueMention(reader.GetInt32(0), reader.GetFieldValue<DateTimeOffset>(1)));
            return result;
        }

        /// <summary>
        /// Git #2195 — the single-chat-scoped equivalent of <see cref="GetOpenPinnedQuestionsAsync"/>
        /// for the Floating Chat Window's side dock, which only ever needs the one chat it's docked
        /// to. Same purge-then-read shape as the unscoped version.
        /// </summary>
        public async Task<List<PinnedQuestion>> GetOpenPinnedQuestionsForChatAsync(int chatId)
        {
            var result = new List<PinnedQuestion>();
            if (chatId <= 0) return result;

            await using var conn = await OpenAsync();
            await PurgeResolvedPinnedQuestionsAsync(conn);

            const string sql = @"
                SELECT p.id, p.chat_id, p.question_text, p.created_at, c.conversation_id, c.title
                FROM chat_pinned_questions p
                JOIN bt_chats c ON c.id = p.chat_id
                WHERE p.resolved_at IS NULL AND p.chat_id = @chatId
                ORDER BY p.created_at ASC";
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@chatId", chatId);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                result.Add(new PinnedQuestion
                {
                    Id = reader.GetInt32(0),
                    ChatId = reader.GetInt32(1),
                    QuestionText = reader.IsDBNull(2) ? "" : reader.GetString(2),
                    CreatedAt = reader.GetDateTime(3),
                    ConversationId = reader.IsDBNull(4) ? "" : reader.GetString(4),
                    ChatTitle = reader.IsDBNull(5) ? "" : reader.GetString(5),
                });
            }
            return result;
        }

        public async Task UpdateModelAndEffortAsync(int id, string? model, string? effort, string? status = null)
        {
            await using var conn = await OpenAsync();
            string sql = @"
                UPDATE bt_build_queue
                   SET model = @model, effort = @effort" + (status != null ? ", status = @status" : "") + @", updated_at = NOW()
                 WHERE id = @id";
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@model", string.IsNullOrWhiteSpace(model) ? DBNull.Value : (object)model.Trim());
            cmd.Parameters.AddWithValue("@effort", string.IsNullOrWhiteSpace(effort) ? DBNull.Value : (object)effort.Trim());
            if (status != null)
            {
                cmd.Parameters.AddWithValue("@status", status);
            }
            await cmd.ExecuteNonQueryAsync();
        }

        // ── Pinned Questions (Git #2104, Phase 1 of #2036) ──────────────────────
        // A pin ties a question back to the chat it belongs to (chat_pinned_questions.chat_id
        // -> bt_chats.id, same FK shape as bt_chat_issues). Detection — asking chats for
        // outstanding questions — is explicitly OUT of scope (#2105); this build only needs
        // real CRUD so the UI/resolve mechanism can be proven end to end via a manual/debug
        // create path. "Persists until resolved, silent auto-purge on stale/redundant, no
        // archive list" (the issue's own words) is implemented as: reads only ever return
        // unresolved rows, resolving stamps resolved_at then a purge sweep deletes every
        // already-resolved row immediately — there is no history/archive table or view to
        // browse — and a partial unique index (chat_id, question_text) WHERE resolved_at IS
        // NULL rejects a redundant duplicate pin at the DB layer rather than in C#.

        public async Task<List<PinnedQuestion>> GetOpenPinnedQuestionsAsync()
        {
            await using var conn = await OpenAsync();
            await PurgeResolvedPinnedQuestionsAsync(conn);

            const string sql = @"
                SELECT p.id, p.chat_id, p.question_text, p.created_at, c.conversation_id, c.title
                FROM chat_pinned_questions p
                JOIN bt_chats c ON c.id = p.chat_id
                WHERE p.resolved_at IS NULL
                ORDER BY p.created_at ASC";
            var result = new List<PinnedQuestion>();
            await using var cmd = new NpgsqlCommand(sql, conn);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                result.Add(new PinnedQuestion
                {
                    Id = reader.GetInt32(0),
                    ChatId = reader.GetInt32(1),
                    QuestionText = reader.IsDBNull(2) ? "" : reader.GetString(2),
                    CreatedAt = reader.GetDateTime(3),
                    ConversationId = reader.IsDBNull(4) ? "" : reader.GetString(4),
                    ChatTitle = reader.IsDBNull(5) ? "" : reader.GetString(5),
                });
            }
            return result;
        }

        /// <summary>Manual/debug create path (#2104) — Phase 2 detection (#2105) will call the
        /// same method once it exists. Returns false (no-op, not an error) when an identical
        /// unresolved pin already exists for this chat — the partial unique index below rejects
        /// the redundant insert at the DB layer.</summary>
        public async Task<bool> CreatePinnedQuestionAsync(int chatId, string questionText)
        {
            await using var conn = await OpenAsync();
            const string sql = @"
                INSERT INTO chat_pinned_questions (chat_id, question_text)
                VALUES (@chatId, @questionText)
                ON CONFLICT (chat_id, question_text) WHERE resolved_at IS NULL DO NOTHING
                RETURNING id";
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@chatId", chatId);
            cmd.Parameters.AddWithValue("@questionText", questionText.Trim());
            var val = await cmd.ExecuteScalarAsync();
            return val != null && val != DBNull.Value;
        }

        /// <summary>Marks a pin resolved then immediately purges it — see the region header
        /// above for why there's no separate archive of resolved pins.</summary>
        public async Task ResolvePinnedQuestionAsync(int id)
        {
            await using var conn = await OpenAsync();
            const string sql = "UPDATE chat_pinned_questions SET resolved_at = NOW() WHERE id = @id";
            await using (var cmd = new NpgsqlCommand(sql, conn))
            {
                cmd.Parameters.AddWithValue("@id", id);
                await cmd.ExecuteNonQueryAsync();
            }
            await PurgeResolvedPinnedQuestionsAsync(conn);
        }

        private static async Task PurgeResolvedPinnedQuestionsAsync(NpgsqlConnection conn)
        {
            const string sql = "DELETE FROM chat_pinned_questions WHERE resolved_at IS NOT NULL";
            await using var cmd = new NpgsqlCommand(sql, conn);
            await cmd.ExecuteNonQueryAsync();
        }

        /// <summary>
        /// Creates a client from the DATABASE_URL found in:
        ///   1. The config's own databaseUrl field (if non-empty), OR
        ///   2. The DATABASE_URL= line in &lt;repoRoot&gt;/.env.local
        /// Returns null (and logs via <paramref name="onMissing"/>) if neither is found.
        /// </summary>
        public static BuildQueuePostgresClient? TryCreate(
            BuildTrackerConfig config,
            string? repoRoot,
            Action<string> onMissing)
        {
            // 1. Explicit override in the config JSON
            if (!string.IsNullOrWhiteSpace(config.DatabaseUrl))
                return new BuildQueuePostgresClient(config.DatabaseUrl);

            // Git #1985 — was `repoRoot` typed as non-nullable `string` at the call site with the
            // caller coalescing a null FindRepoRoot() to "". That resolves .env.local against the
            // PROCESS CWD instead of the repo root, silently — either missing the real file (falls
            // through to the generic "no DATABASE_URL" message below, which doesn't reveal the real
            // cause) or, worse, picking up an unrelated .env.local. Fail closed instead: a null repo
            // root here is treated the same as "no DATABASE_URL", but the message says why.
            if (string.IsNullOrWhiteSpace(repoRoot))
            {
                onMissing("Repo root could not be resolved — cannot look for .env.local. Direct-Postgres queue DB access is unavailable this run; falling back to HTTP (API server).");
                return null;
            }

            // 2. .env.local at the repo root
            var envLocal = System.IO.Path.Combine(repoRoot, ".env.local");
            if (System.IO.File.Exists(envLocal))
            {
                foreach (var line in System.IO.File.ReadAllLines(envLocal))
                {
                    var trimmed = line.Trim();
                    if (trimmed.StartsWith('#') || !trimmed.StartsWith("DATABASE_URL=", StringComparison.OrdinalIgnoreCase))
                        continue;
                    var url = trimmed.Substring("DATABASE_URL=".Length).Trim().Trim('"').Trim('\'');
                    if (!string.IsNullOrWhiteSpace(url))
                        return new BuildQueuePostgresClient(url);
                }
            }

            onMissing(
                "No DATABASE_URL found — set databaseUrl in scripts/build-queue-watcher.config.json " +
                "or add DATABASE_URL=<connection string> to .env.local at the repo root. " +
                "The queue watcher will fall back to HTTP (API server) for DB operations.");
            return null;
        }
    }
}
