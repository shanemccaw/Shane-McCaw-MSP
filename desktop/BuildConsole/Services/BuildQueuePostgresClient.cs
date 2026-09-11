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
    /// Direct Npgsql connection to BuildConsole's own local Postgres database for all
    /// build-queue operations previously routed through the Replit API server (HTTP).
    ///
    /// ── Why direct Postgres instead of the API server? ──────────────────────────
    /// The API server was the original transport for queue state mutations
    /// (GET /extension/queue/next → claim rows, POST /extension/queue/:id/complete
    /// → mark done/failed). That server lives on Replit, which shuts down after
    /// ~15 min of inactivity — so a build finishing while the server was napping
    /// would silently fail to report completion, leading to stuck "running" rows.
    /// The local Postgres 18 server is always on; a direct connection from BuildConsole
    /// is faster, more reliable, and removes the "server asleep" class of failure
    /// entirely. Npgsql 7.0.7 is already a project dependency (see BuildConsole.csproj).
    ///
    /// ── Connection string (Git #3651) ────────────────────────────────────────────
    /// Reads ONLY the BUILD_DATABASE_URL= line in &lt;repoRoot&gt;/.env.local — the
    /// dedicated local `BuildConsole` database holding the bt_* tables plus
    /// build_dispatch_log and chat_pinned_questions. It deliberately never falls back
    /// to DATABASE_URL (the shared product database, which BuildConsole used until
    /// #3651 and which still holds a stale pre-migration copy of those tables) or to
    /// the config's databaseUrl field, so it can never silently read or write the
    /// wrong database. Neon is long retired (Git #1209); this is local Postgres 18.
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
            // Git #2119/#3583/#3607 — optional trailing ordinals, strictly append-only per the
            // #1384 fixed-ordinal contract (MapRow reads each by a fixed absolute ordinal, so a
            // later one can only be added by also selecting every earlier one, in the SAME order,
            // even where this specific query has no other use for it): superseded_by_id (21),
            // repo_owner (22), repo_name (23), then Git #3607's new archived (24) / archived_at (25)
            // — needed here so the board's Canceled filter can read QueueItem.Archived.
            const string sql = @"
                SELECT id, title, prompt, model, effort, cwd,
                       github_number, blocked_by_number, blocked_by_numbers,
                       status, exit_code, session_id, resume_session_id,
                       originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at,
                       superseded_by_id, repo_owner, repo_name, archived, archived_at
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
                       originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at,
                       superseded_by_id, repo_owner, repo_name
                FROM bt_build_queue
                WHERE status = 'queued'
                ORDER BY created_at ASC";

        /// <summary>Result of <see cref="SelectClaimCandidatesAsync"/>: the ordered ready
        /// rows (capped to the requested limit) plus the per-id held-reason map. Git #3623 —
        /// <see cref="MissingLiveBlockers"/> holds, per queue row id, the live GitHub blocked_by edges
        /// the row's stored columns were missing (only filled by the claim path's live edge re-check),
        /// for GetNextAsync to record on the row.</summary>
        public sealed record CandidateSelection(
            List<QueueItem> Ready, Dictionary<int, string> HeldReasons, Dictionary<int, List<int>> MissingLiveBlockers);

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
        /// This method issues NO UPDATE and claims nothing — the only writes in the claim path
        /// are GetNextAsync's Step 2b (recording live blocked_by edges a row was missing, Git
        /// #3623) and Step 3 (the claim), both AFTER this returns.
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
            Func<Task<LiveOpenIssuesResult>>? liveOpenIssuesFetcher,
            Func<IReadOnlyList<int>, Task<Dictionary<int, List<int>>>>? liveBlockedByFetcher = null)
        {
            // Step 1 — fetch all queued rows (cheapest scan; the queue is tiny),
            // minus manually-paused ids.
            var settingsSnapshot = BuildConsoleSettings.Load();
            var pausedIds = settingsSnapshot.PausedBuildIds;
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

            // Git #3342 — self-heal a STALE exclusive hold, right here in the always-running dispatch
            // path. The only other place the hold auto-clears is the UI panel's
            // CheckExclusiveBuildSetCompletion, which runs solely while the Build Queue panel is
            // refreshing AND (until this same fix) counted only done/failed/canceled as terminal — so an
            // exclusive set whose last live member finished 'superseded' never cleared and silently
            // starved the entire queue (every non-member held below, forever, across restarts because the
            // hold is persisted). Confirmed live on 2026-09-09: build set "ShanesLife", all 189 members
            // terminal (incl. 2 'superseded'), held #3338/#3340/#3342 with 0 active builds. The dispatch
            // path runs on every watcher tick with a free slot, so it is the robust place to notice the
            // set has no active rows left and lift the hold itself — no dependency on the panel being open.
            if (exclusiveSet != null && !await BuildSetHasActiveRowsAsync(exclusiveSet, conn))
            {
                ActivityLog.Log("watcher",
                    $"Git #3342: exclusive build set \"{exclusiveSet}\" has no active (non-terminal) rows left — " +
                    "auto-clearing the stale \"Build Only This Set\" hold so the queue resumes normal dispatch.");
                BuildSetExclusiveStore.Clear();
                exclusiveSet = null;
            }

            await using (var fetchCmd = new NpgsqlCommand(QueuedCandidateSql, conn))
            await using (var reader = await fetchCmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    var item = MapRow(reader);
                    if (pausedIds.Contains(item.Id)) continue;

                    // Git #3583 — per-repo pause (Feature #3578), independent of the existing global
                    // Active/Pause toggle (BuildConsoleSettings.QueuePaused / QueueWatcherService.SetPaused):
                    // a repo tagged paused in the #3581 Settings repo registry never has its queued items
                    // claimed, while every other repo's queue continues exactly as before. Real, honest
                    // interaction with global pause: global pause is checked/enforced entirely separately
                    // (TickAsync never even calls GetNextAsync while IsPaused), so this never "double
                    // negates" — a repo-paused item held here is simply never reached by the global check
                    // at all, and an item NOT repo-paused is still held by global pause exactly as before.
                    if (settingsSnapshot.IsRepoPaused(item.OwnerRepo))
                    {
                        heldReasons[item.Id] = $"holding — repo \"{item.OwnerRepo}\" is paused (Settings > Repos)";
                        continue;
                    }

                    if (exclusiveSet != null &&
                        !string.Equals((item.BuildSet ?? "").Trim(), exclusiveSet, StringComparison.OrdinalIgnoreCase))
                    {
                        heldReasons[item.Id] = $"holding — build set \"{exclusiveSet}\" is marked exclusive (\"Build Only This Set\")";
                        continue;
                    }

                    candidates.Add(item);
                }
            }

            return await EvaluateCandidatesAsync(
                candidates, heldReasons, limit, presuppliedOpen, liveOpenIssuesFetcher, liveBlockedByFetcher);
        }

        /// <summary>
        /// Git #3623 — Step 2 of the claim selection (every blocker/own-issue decision), split out of
        /// <see cref="SelectClaimCandidatesAsync"/> with no database access of its own so the exact
        /// decision the watcher makes can be exercised against real rows and real GitHub state
        /// without claiming anything. <paramref name="heldReasons"/> is extended in place.
        ///
        /// <paramref name="liveBlockedByFetcher"/> (issue numbers → each issue's real GitHub
        /// <c>blocked_by</c> edge numbers) turns on the Git #3623 claim-time edge re-check; null
        /// skips it (PeekNextAsync, which must fire no GitHub call).
        /// </summary>
        public static async Task<CandidateSelection> EvaluateCandidatesAsync(
            List<QueueItem> candidates,
            Dictionary<int, string> heldReasons,
            int limit,
            LiveOpenIssuesResult? presuppliedOpen,
            Func<Task<LiveOpenIssuesResult>>? liveOpenIssuesFetcher,
            Func<IReadOnlyList<int>, Task<Dictionary<int, List<int>>>>? liveBlockedByFetcher)
        {
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

            // Git #3582 (Feature #3578, Multi-Repo Support) — resolve a live open-issue snapshot PER
            // REAL REPO represented among today's candidates, not one single snapshot silently assumed
            // to be this instance's own primary repo. The primary repo's resolution below is BYTE-FOR-
            // BYTE the pre-#3582 path (presuppliedOpen / liveOpenIssuesFetcher / GitHubIssuesService
            // default) — zero behavior change for every candidate that existed before this issue, since
            // every one of them carries the primary repo (bt_build_queue's own column default). A
            // candidate from a second configured repo (#3581) additionally resolves ITS OWN repo's live
            // snapshot, so its blockers/own-issue are checked against the repo they actually live in —
            // this issue's own "confirm dispatch/dedup/blocked_by behave correctly for an item from the
            // non-Main repo" verification requirement.
            var primaryOwnerRepo = $"{RepoIdentity.DefaultOwner}/{RepoIdentity.DefaultName}";
            var liveByRepo = new Dictionary<string, LiveOpenIssuesResult>(StringComparer.OrdinalIgnoreCase);
            if (distinctBlockerNums.Count > 0 || anyOwnIssueToCheck)
            {
                foreach (var group in candidates.GroupBy(c => c.OwnerRepo, StringComparer.OrdinalIgnoreCase))
                {
                    bool repoNeedsLive = group.SelectMany(EffectiveBlockers).Any() || group.Any(c => c.GithubNumber is int g2 && g2 > 0);
                    if (!repoNeedsLive) continue;

                    bool isPrimary = string.Equals(group.Key, primaryOwnerRepo, StringComparison.OrdinalIgnoreCase);
                    LiveOpenIssuesResult result = isPrimary && presuppliedOpen != null
                        ? presuppliedOpen
                        : isPrimary
                            ? await (liveOpenIssuesFetcher != null ? liveOpenIssuesFetcher() : GitHubIssuesService.TryGetOpenIssueNumbersAsync())
                            // Git #3582 — a secondary repo always resolves via a real `gh` call here; the
                            // test seam (presuppliedOpen/liveOpenIssuesFetcher) only ever covers the
                            // primary repo, exactly as it did before this issue.
                            : await GitHubIssuesService.TryGetOpenIssueNumbersAsync(ownerRepo: group.Key);

                    if (!result.Success)
                        ActivityLog.Log("watcher", $"Git #1600/#1904: couldn't reach GitHub (repo \"{group.Key}\") to re-check blocker(s)/own-issue state ({result.Error}) — holding every candidate from that repo that needs a live check this tick (fail closed).");
                    liveByRepo[group.Key] = result;
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
            //
            // Git #3582 — scoped to the PRIMARY repo's own candidates/blockers only:
            // DoneBookendVerifier checks THIS instance's own local git clone's origin/main +
            // build-journal/ exclusively, so it can only ever be meaningful there. A second configured
            // repo's own bookends (if any) live entirely in that repo's own clone and are never checked
            // here — a real, documented limitation, not a silent bypass: an open blocker on a secondary
            // repo simply stays "still blocking" until GitHub itself reports it closed.
            HashSet<int> satisfiedByDoneBookend = new();
            if (liveByRepo.TryGetValue(primaryOwnerRepo, out var primaryLive) && primaryLive.Success)
            {
                var stillOpenAcrossAll = candidates
                    .Where(c => string.Equals(c.OwnerRepo, primaryOwnerRepo, StringComparison.OrdinalIgnoreCase))
                    .SelectMany(EffectiveBlockers)
                    .Where(b => primaryLive.OpenNumbers.Contains(b))
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

            // Git #3623 — when the claim-time live edge re-check below will run, evaluate EVERY
            // candidate here (no early cap) so a row that re-check holds can be backfilled from the
            // next ready candidate; the real limit is applied after the re-check. It only runs when
            // the live open-issue set was actually reached, so the #2815 unreachable branch below is
            // never reached uncapped.
            // Git #3582 — ApplyLiveBlockerEdgesAsync below is itself scoped to just the PRIMARY repo
            // (its own doc comment: "a row from another repo ... keeps its stored set"), so the gate
            // here uses primaryLive (not a removed single-repo `live`) — exactly the snapshot it needs.
            bool liveEdgeCheck = liveBlockedByFetcher != null && primaryLive != null && primaryLive.Success;
            int passLimit = liveEdgeCheck ? int.MaxValue : limit;

            foreach (var item in candidates)
            {
                if (ready.Count >= passLimit) break;
                var blockers = EffectiveBlockers(item);
                bool hasOwnIssue = item.GithubNumber is int gh && gh > 0;
                bool itemIsPrimaryRepo = string.Equals(item.OwnerRepo, primaryOwnerRepo, StringComparison.OrdinalIgnoreCase);

                // Nothing to verify against GitHub — no blockers and no real own-issue.
                // (--notGit sentinel or null github_number, and unblocked.) Ready as before.
                if (blockers.Count == 0 && !hasOwnIssue) { ready.Add(item); continue; }

                // Git #3582 — this candidate's OWN repo's live snapshot (the primary repo's entry is
                // identical to the pre-#3582 single `live` variable).
                LiveOpenIssuesResult? live = liveByRepo.TryGetValue(item.OwnerRepo, out var l) ? l : null;

                // Git #2815 — a blocker-FREE build must NOT be gated on general GitHub health.
                // The only reason a blocker-free candidate reaches this live check at all is the
                // Git #1904 own-issue self-check (is this row's own github_number still open?),
                // which Shane explicitly designated best-effort: "the agent will catch itself"
                // once it's running, so the LAUNCH decision must not depend on GitHub being
                // reachable for a build that has no real declared blocker. When GitHub is
                // unreachable we therefore FAIL OPEN on the self-check and launch a blocker-free
                // build anyway.
                //
                // A build WITH real declared blockers stays FAIL-CLOSED (Git #1600 / §4 —
                // safety-critical, deliberately unchanged): an undischarged blocker must keep
                // holding when GitHub can't be reached to verify it's actually closed.
                if (live == null || !live.Success)
                {
                    if (blockers.Count == 0)
                    {
                        ActivityLog.Log("watcher",
                            $"Git #2815: launching blocker-free queue #{item.Id} despite GitHub being unreachable " +
                            $"({(live == null ? "open-issue set not evaluated" : live.Error)}) — the #1904 own-issue " +
                            "self-check is best-effort; only a real declared blocker holds on GitHub-unreachable (§4 unchanged).");
                        ready.Add(item);
                        continue;
                    }
                    heldReasons[item.Id] = live == null
                        ? "internal error — GitHub open-issue set not evaluated"
                        : $"GitHub unreachable ({live.Error}) — holding: has real declared blocker(s) to verify (§4 fail-closed)";
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
                // Git #3582 — satisfiedByDoneBookend only ever applies to the primary repo (see above).
                var stillOpen = blockers.Where(b => live.OpenNumbers.Contains(b) && !(itemIsPrimaryRepo && satisfiedByDoneBookend.Contains(b))).ToList();
                if (stillOpen.Count == 0) { ready.Add(item); continue; }
                heldReasons[item.Id] = $"waiting on {string.Join(", ", stillOpen.Select(b => $"#{b}"))} (open)";
            }
            // Git #3623 — claim-time live blocked_by edge re-check (see ApplyLiveBlockerEdgesAsync).
            var missingLive = new Dictionary<int, List<int>>();
            if (liveEdgeCheck && ready.Count > 0)
                ready = await ApplyLiveBlockerEdgesAsync(
                    ready, heldReasons, missingLive, primaryLive!, satisfiedByDoneBookend, liveBlockedByFetcher!);
            if (ready.Count > limit) ready = ready.Take(limit).ToList();
            return new CandidateSelection(ready, heldReasons, missingLive);
        }

        /// <summary>
        /// Git #3623 — the claim-time half of the fix. Everything above decides from the row's STORED
        /// blocker columns, and #3585's row had none: Batter Up inserted it with blocked_by_numbers
        /// NULL while GitHub carried real edges to #3582/#3584, so the gate had nothing to hold on and
        /// claimed it. BUILD_QUEUE_BLOCKING_AND_GATING.md §1 promises the claim checks GitHub directly;
        /// this makes that true for the edges themselves, not only for the blockers' open/closed state.
        ///
        /// For every row that would otherwise claim (and belongs to the configured repo), one batched
        /// GraphQL read fetches its real GitHub <c>blocked_by</c> edges. An edge missing from the row
        /// whose issue is still open — and not satisfied by a verified DONE bookend (#2225) — HOLDS
        /// the row. Every missing edge (open or closed) is returned in <paramref name="missingLive"/>
        /// so GetNextAsync records it on the row, after which the normal stored-set check holds it
        /// with no further live call. Cost is one GraphQL read per tick that actually has claimable
        /// rows — and those rows are claimed on that same tick.
        ///
        /// If the edge read itself fails, the rows are claimed on their stored sets (logged) — the
        /// same stance as the recorded #2815 decision for an unreachable GitHub. Those stored sets are
        /// now populated at queue time from the header --blocked-by (QueueBuildAsync) and, for Batter
        /// Up, from a live read that must succeed before the row is inserted at all.
        /// </summary>
        private static async Task<List<QueueItem>> ApplyLiveBlockerEdgesAsync(
            List<QueueItem> ready,
            Dictionary<int, string> heldReasons,
            Dictionary<int, List<int>> missingLive,
            LiveOpenIssuesResult live,
            HashSet<int> satisfiedByDoneBookend,
            Func<IReadOnlyList<int>, Task<Dictionary<int, List<int>>>> liveBlockedByFetcher)
        {
            // The live read (like the open-issue set) is scoped to the configured repo; a row from
            // another repo can't be checked against it and keeps its stored set.
            string configuredRepo = BuildConsoleSettings.Load().GitHubOwnerRepo;
            var checkable = ready
                .Where(i => i.GithubNumber is int g && g > 0
                            && string.Equals(i.OwnerRepo, configuredRepo, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (checkable.Count == 0) return ready;

            Dictionary<int, List<int>> edges;
            try
            {
                edges = await liveBlockedByFetcher(checkable.Select(i => i.GithubNumber!.Value).Distinct().ToList());
            }
            catch (Exception ex)
            {
                ActivityLog.Log("watcher",
                    $"Git #3623: live blocked_by edge re-check failed ({ex.Message}) — claiming {checkable.Count} row(s) on their " +
                    "stored blocker sets this tick (captured at queue time), the same stance as #2815's unreachable-GitHub rule.");
                return ready;
            }

            var perItemMissing = new Dictionary<int, List<int>>();
            foreach (var item in checkable)
            {
                int num = item.GithubNumber!.Value;
                if (!edges.TryGetValue(num, out var liveEdges))
                {
                    ActivityLog.Log("watcher",
                        $"Git #3623: GitHub returned no blocked_by data for #{num} (queue #{item.Id}) — claiming on its stored blocker set this tick.");
                    continue;
                }
                var stored = EffectiveBlockers(item);
                var missing = liveEdges.Where(b => b > 0 && !stored.Contains(b)).Distinct().ToList();
                if (missing.Count > 0) perItemMissing[item.Id] = missing;
            }
            if (perItemMissing.Count == 0) return ready;

            // A blocker only the live edges revealed was never part of the #2225 DONE-bookend pass
            // above — check the still-open ones now, failing closed on any error.
            var satisfied = new HashSet<int>(satisfiedByDoneBookend);
            var openMissing = perItemMissing.Values.SelectMany(v => v)
                .Where(b => live.OpenNumbers.Contains(b) && !satisfied.Contains(b))
                .Distinct()
                .ToList();
            if (openMissing.Count > 0)
            {
                try
                {
                    satisfied.UnionWith(await DoneBookendVerifier.GetSatisfiedAsync(openMissing));
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("watcher",
                        $"Git #3623: DONE-bookend check for newly-found blocker(s) threw ({ex.Message}) — treating them as unsatisfied (fail closed).");
                }
            }

            var held = new HashSet<int>();
            foreach (var item in checkable)
            {
                if (!perItemMissing.TryGetValue(item.Id, out var missing)) continue;
                missingLive[item.Id] = missing;
                var stillOpen = missing.Where(b => live.OpenNumbers.Contains(b) && !satisfied.Contains(b)).ToList();
                if (stillOpen.Count == 0) continue;

                held.Add(item.Id);
                string list = string.Join(", ", stillOpen.Select(b => $"#{b}"));
                heldReasons[item.Id] = $"waiting on {list} (open) — live GitHub blocked_by edge(s) this queue row was missing (Git #3623)";
                ActivityLog.Log("watcher",
                    $"Git #3623: HELD queue #{item.Id} (GH #{item.GithubNumber}) — its stored blocker set " +
                    $"[{string.Join(",", EffectiveBlockers(item))}] was missing live GitHub blocked_by edge(s) {list}, still open. " +
                    "Not claimed; recording the edge(s) on the row.");
            }
            return held.Count == 0 ? ready : ready.Where(i => !held.Contains(i.Id)).ToList();
        }

        /// <summary>Git #3623 — GetNextAsync's real default live blocked_by fetcher: batched GraphQL reads
        /// (<see cref="GitHubApiClient.BatchGetBlockedByAsync"/>) through a plain, circuit-gated client, so
        /// an open #2815 circuit short-circuits it instead of adding pressure. Throws when no PAT is
        /// configured, which the caller treats as "couldn't check".</summary>
        private static Task<Dictionary<int, List<int>>> FetchLiveBlockedByEdgesAsync(IReadOnlyList<int> issueNumbers)
        {
            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
                throw new InvalidOperationException("no GitHub PAT configured");
            return new GitHubApiClient(settings.GitHubPat).BatchGetBlockedByAsync(issueNumbers);
        }

        /// <summary>Git #3623 — records the live GitHub blocked_by edges a still-queued row was missing
        /// (merged into its existing set, never replacing it), so the next tick's stored-set check holds
        /// it with no live call. Per-row and best-effort: this tick's hold has already been applied in
        /// memory, and a failed write only means the next tick re-discovers the edge live.</summary>
        private static async Task RecordMissingLiveBlockersAsync(NpgsqlConnection conn, Dictionary<int, List<int>> missingByRowId)
        {
            foreach (var (id, missing) in missingByRowId)
            {
                try
                {
                    await using var cmd = new NpgsqlCommand(@"
                        UPDATE bt_build_queue
                           SET blocked_by_numbers = ARRAY(
                                   SELECT DISTINCT b FROM unnest(
                                       COALESCE(blocked_by_numbers,
                                                CASE WHEN blocked_by_number IS NULL THEN ARRAY[]::int[] ELSE ARRAY[blocked_by_number] END)
                                       || @add) AS b),
                               blocked_by_number = COALESCE(blocked_by_number, @first),
                               updated_at = NOW()
                         WHERE id = @id
                           AND status NOT IN ('done', 'failed', 'superseded')", conn);
                    cmd.Parameters.Add(new NpgsqlParameter("@add", NpgsqlDbType.Array | NpgsqlDbType.Integer) { Value = missing.ToArray() });
                    cmd.Parameters.AddWithValue("@first", missing[0]);
                    cmd.Parameters.AddWithValue("@id", id);
                    int n = await cmd.ExecuteNonQueryAsync();
                    if (n > 0)
                        ActivityLog.Log("watcher", $"Git #3623: recorded live blocked_by edge(s) {string.Join(",", missing)} on queue #{id}.");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("watcher",
                        $"Git #3623: couldn't record live blocked_by edge(s) on queue #{id} ({ex.Message}) — any hold already applied stands; the next pass re-checks live.");
                }
            }
        }

        /// <summary>Git #3623 — one row <see cref="ResyncLiveBlockedByAsync"/> found missing live GitHub
        /// blocked_by edge(s): its queue id, real issue number, status, and the edge numbers added.</summary>
        public sealed record BlockerResyncChange(int Id, int GithubNumber, string Status, List<int> Added);

        /// <summary>
        /// Git #3623 — the periodic re-sync of <c>blocked_by_numbers</c> from GitHub's real dependency
        /// graph. Before this, the column was written once, at queue time, and never again: an edge
        /// wired afterwards never reached the row. The confirmed case is #3610 — claimed 23:12:45
        /// local, its session filed #3625 and wired #3610 blocked-by #3625 at 03:17:09Z, and the row's
        /// columns stayed empty through every refresh, so neither the gate nor the 🔒 BLOCKED display
        /// (#3624) had anything to act on.
        ///
        /// Covers every row whose blocker columns are still acted on or shown — queued, parked,
        /// running, verifying, limit-paused, capped, external — plus un-archived supervisory cancels
        /// (canceled with exit 0), which #3521 can re-queue. Rows outside the configured repo are
        /// skipped (the live read is scoped to it). One batched GraphQL read per 25 rows.
        ///
        /// Edges are only ever ADDED, never removed: dropping a stored blocker is a release decision,
        /// and this path fails closed. A failed live read changes nothing (logged) — the claim path's
        /// own live edge re-check (<see cref="ApplyLiveBlockerEdgesAsync"/>) is still the gate.
        /// <paramref name="dryRun"/> computes and returns the changes without writing them.
        /// </summary>
        public async Task<List<BlockerResyncChange>> ResyncLiveBlockedByAsync(
            Func<IReadOnlyList<int>, Task<Dictionary<int, List<int>>>>? liveBlockedByFetcher = null, bool dryRun = false)
        {
            string configuredRepo = BuildConsoleSettings.Load().GitHubOwnerRepo;
            var rows = new List<(int Id, int Num, string Status, List<int> Stored)>();

            await using var conn = await OpenAsync();
            await using (var cmd = new NpgsqlCommand(@"
                SELECT id, github_number, status, blocked_by_number, blocked_by_numbers, repo_owner, repo_name
                  FROM bt_build_queue
                 WHERE github_number > 0
                   AND (status IN ('queued', 'parked', 'running', 'external', @verifying, @limitPaused, @capped)
                        OR (status = 'canceled' AND archived IS NOT TRUE AND exit_code = 0))", conn))
            {
                cmd.Parameters.AddWithValue("@verifying", VerifyingStatus);
                cmd.Parameters.AddWithValue("@limitPaused", Services.SessionLimitAutoRestartService.LimitPausedStatus);
                cmd.Parameters.AddWithValue("@capped", AccountCapPolicy.CappedStatus);
                await using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    string owner = reader.IsDBNull(5) ? RepoIdentity.DefaultOwner : reader.GetString(5);
                    string name = reader.IsDBNull(6) ? RepoIdentity.DefaultName : reader.GetString(6);
                    if (!string.Equals($"{owner}/{name}", configuredRepo, StringComparison.OrdinalIgnoreCase)) continue;

                    var stored = reader.IsDBNull(4) ? new List<int>() : reader.GetFieldValue<int[]>(4).ToList();
                    if (stored.Count == 0 && !reader.IsDBNull(3)) stored.Add(reader.GetInt32(3));
                    rows.Add((reader.GetInt32(0), reader.GetInt32(1), reader.GetString(2), stored));
                }
            }

            var changes = new List<BlockerResyncChange>();
            if (rows.Count == 0) return changes;

            Dictionary<int, List<int>> edges;
            try
            {
                edges = await (liveBlockedByFetcher ?? FetchLiveBlockedByEdgesAsync)(rows.Select(r => r.Num).Distinct().ToList());
            }
            catch (Exception ex)
            {
                ActivityLog.Log("watcher",
                    $"Git #3623: blocked_by re-sync couldn't read live edges for {rows.Count} row(s) ({ex.Message}) — nothing changed; retried next interval.");
                return changes;
            }

            foreach (var r in rows)
            {
                if (!edges.TryGetValue(r.Num, out var live)) continue;
                var added = live.Where(b => b > 0 && !r.Stored.Contains(b)).Distinct().ToList();
                if (added.Count > 0) changes.Add(new BlockerResyncChange(r.Id, r.Num, r.Status, added));
            }

            if (changes.Count > 0)
            {
                ActivityLog.Log("watcher",
                    $"Git #3623: blocked_by re-sync{(dryRun ? " (dry run)" : "")} — {changes.Count} of {rows.Count} row(s) were missing live GitHub edge(s): " +
                    string.Join("; ", changes.Select(c => $"queue #{c.Id} (GH #{c.GithubNumber}, {c.Status}) +{string.Join(",", c.Added.Select(a => $"#{a}"))}")) + ".");
                if (!dryRun)
                    await RecordMissingLiveBlockersAsync(conn, changes.ToDictionary(c => c.Id, c => c.Added));
            }
            return changes;
        }

        /// <summary>
        /// Git #3342 — true when <paramref name="buildSet"/> still has at least one row in a non-terminal
        /// state, i.e. real work an exclusive ("Build Only This Set") hold could ever actually let run.
        /// "Terminal" is exactly <see cref="IsTerminalStatus"/> (done/failed/canceled/superseded); every
        /// other status (queued/running/parked/verifying/limit-paused/capped/external) counts as active.
        /// Runs on the caller's already-open connection — one cheap EXISTS, only ever evaluated when an
        /// exclusive hold is actually active. Returns true (the safe, keep-holding direction) on any
        /// unexpected shape, so a transient error never clears a legitimate hold.
        /// </summary>
        private static async Task<bool> BuildSetHasActiveRowsAsync(string buildSet, NpgsqlConnection conn)
        {
            await using var cmd = new NpgsqlCommand(
                @"SELECT EXISTS(
                      SELECT 1 FROM bt_build_queue
                      WHERE build_set = @s
                        AND status NOT IN ('done','failed','canceled','superseded'))", conn);
            cmd.Parameters.AddWithValue("@s", buildSet);
            var result = await cmd.ExecuteScalarAsync();
            return result is not bool b || b;
        }

        public async Task<List<QueueItem>> GetNextAsync(
            int limit, Func<Task<LiveOpenIssuesResult>>? liveOpenIssuesFetcher = null,
            Func<IReadOnlyList<int>, Task<Dictionary<int, List<int>>>>? liveBlockedByFetcher = null)
        {
            if (limit <= 0) return new List<QueueItem>();
            limit = Math.Min(limit, 20); // same cap as the server

            await using var conn = await OpenAsync();

            // Steps 1 & 2 — the shared, read-only selection (identical to what the
            // dropdown's PeekNextAsync sees), plus — on this claim path only — Git #3623's
            // live re-read of each would-be-claimed row's real GitHub blocked_by edges.
            var selection = await SelectClaimCandidatesAsync(
                conn, limit, presuppliedOpen: null, liveOpenIssuesFetcher,
                liveBlockedByFetcher ?? FetchLiveBlockedByEdgesAsync);
            LastHeldReasons = selection.HeldReasons;

            // Step 2b (Git #3623) — record any live edge a queued row was missing, so the next
            // tick's stored-set check holds it with no live call. The hold itself was already
            // applied in the selection above; this write only makes it durable.
            if (selection.MissingLiveBlockers.Count > 0)
                await RecordMissingLiveBlockersAsync(conn, selection.MissingLiveBlockers);

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
                          originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at,
                          superseded_by_id, repo_owner, repo_name";

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
        /// only then re-queues via <paramref name="reuseRowId"/> on <see cref="QueueBuildAsync"/>.
        ///
        /// Git #3342 — <see cref="SupersededStatus"/> ("superseded") belongs here: a row that was
        /// replaced by a continuation/reply (see <see cref="MarkSupersededByReplyAsync"/>) has reached a
        /// real, permanent conclusion and will never run again, exactly like done/failed/canceled. It was
        /// missing, so every consumer that asks "is this row finished?" (dedup re-queue, the Batter Up
        /// dead-row check, and — the live bug this fixes — the "Build Only This Set" auto-clear that
        /// requires ALL members terminal) treated a superseded row as still-active. A stale exclusive
        /// hold on a set with a superseded member therefore never cleared and silently starved the whole
        /// queue (every non-member held forever). It is deliberately NOT in <see cref="IsActiveStatus"/>
        /// above for the same reason: superseded is finished, not pending.</summary>
        public static bool IsTerminalStatus(string? status) => status is "done" or "failed" or "canceled" or SupersededStatus;

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
        /// <param name="repoOwner">Git #3582 (Feature #3578, Multi-Repo Support) — the real repo
        /// <paramref name="githubNumber"/> belongs to. Defaults to this instance's own configured
        /// repo, so every pre-#3582 caller (single-repo, implicitly the only repo bt_build_queue ever
        /// held an issue number for) is completely unaffected. Ignored for a local (--notGit) lookup,
        /// which already keys on the prompt text alone. Threaded through so a same-numbered issue in
        /// a second configured repo is never mistaken for a dedup match against this repo's row.</param>
        public async Task<QueueItem?> FindDedupCandidateAsync(int? githubNumber, string prompt, string? repoOwner = null, string? repoName = null)
        {
            await using var conn = await OpenAsync();
            QueueItem? row = null;
            var owner = string.IsNullOrEmpty(repoOwner) ? RepoIdentity.DefaultOwner : repoOwner;
            var repo = string.IsNullOrEmpty(repoName) ? RepoIdentity.DefaultName : repoName;

            if (githubNumber.HasValue)
            {
                await using var cmd = new NpgsqlCommand(@"
                    SELECT id, title, prompt, model, effort, cwd,
                           github_number, blocked_by_number, blocked_by_numbers,
                           status, exit_code, session_id, resume_session_id,
                           originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at
                    FROM bt_build_queue
                    WHERE github_number = @num
                      AND repo_owner = @repoOwner AND repo_name = @repoName
                    ORDER BY created_at DESC
                    LIMIT 1", conn);
                cmd.Parameters.AddWithValue("@num", githubNumber.Value);
                cmd.Parameters.AddWithValue("@repoOwner", owner);
                cmd.Parameters.AddWithValue("@repoName", repo);
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

        /// <summary>Git #3509 — the real result of a <see cref="TryClaimDispatchAsync"/> attempt,
        /// carrying the existing holder's info on a lost claim so the caller can show WHO already
        /// has it and WHEN it expires, rather than a bare "no".</summary>
        public sealed class DispatchClaimResult
        {
            public bool Claimed { get; init; }
            public string? ExistingClaimedBy { get; init; }
            public DateTime? ExistingClaimedAtUtc { get; init; }
            public DateTime? ExistingExpiresAtUtc { get; init; }
        }

        /// <summary>
        /// Git #3509 — the one real source of truth closing the duplicate-BUILD:-dispatch race:
        /// two independent flows (DispatchPanel's Dispatch box, the Git Board hover popover, or a
        /// chat following CLAUDE.md's Build Queue Method directly) each check an issue for a
        /// `BUILD:` comment and, finding none, ask their own active chat to write and post one —
        /// with nothing previously stopping two flows from asking about the SAME issue at once
        /// (confirmed live on #3493: two asks landed six minutes apart). This claims
        /// <paramref name="githubNumber"/> atomically via `INSERT ... ON CONFLICT DO NOTHING`
        /// against <c>bt_dispatch_claims</c> — a second caller's claim attempt on the same issue
        /// fails while the first is still live, and gets the existing holder's info back instead of
        /// silently duplicating the ask. Claims expire on their own after <paramref name="ttlMinutes"/>
        /// (a stale/abandoned claim is purged before the attempt) so a forgotten ask can never hold
        /// an issue's dispatch hostage forever.
        /// </summary>
        public async Task<DispatchClaimResult> TryClaimDispatchAsync(int githubNumber, string claimedBy, int ttlMinutes = 20)
        {
            await using var conn = await OpenAsync();

            // Git #3579 — bt_dispatch_claims' PK is now (repo_owner, repo_name, github_number);
            // every statement below threads the real repo dimension explicitly (defaulted to
            // this repo, the only one BuildConsole talks to today) so a second repo's claim on
            // the same issue number can never collide with this one.
            await using (var purge = new NpgsqlCommand(
                "DELETE FROM bt_dispatch_claims WHERE repo_owner = @owner AND repo_name = @repo AND github_number = @num AND expires_at <= now()", conn))
            {
                purge.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
                purge.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
                purge.Parameters.AddWithValue("@num", githubNumber);
                await purge.ExecuteNonQueryAsync();
            }

            await using (var insert = new NpgsqlCommand(@"
                INSERT INTO bt_dispatch_claims (repo_owner, repo_name, github_number, claimed_by, expires_at)
                VALUES (@owner, @repo, @num, @by, now() + (@ttl || ' minutes')::interval)
                ON CONFLICT (repo_owner, repo_name, github_number) DO NOTHING", conn))
            {
                insert.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
                insert.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
                insert.Parameters.AddWithValue("@num", githubNumber);
                insert.Parameters.AddWithValue("@by", claimedBy);
                insert.Parameters.AddWithValue("@ttl", ttlMinutes);
                var rows = await insert.ExecuteNonQueryAsync();
                if (rows > 0) return new DispatchClaimResult { Claimed = true };
            }

            // Lost the race — report the real current holder so the caller can show WHO and WHEN.
            await using (var select = new NpgsqlCommand(
                "SELECT claimed_by, claimed_at, expires_at FROM bt_dispatch_claims WHERE repo_owner = @owner AND repo_name = @repo AND github_number = @num", conn))
            {
                select.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
                select.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
                select.Parameters.AddWithValue("@num", githubNumber);
                await using var reader = await select.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    return new DispatchClaimResult
                    {
                        Claimed = false,
                        ExistingClaimedBy = reader.GetString(0),
                        ExistingClaimedAtUtc = reader.GetDateTime(1),
                        ExistingExpiresAtUtc = reader.GetDateTime(2),
                    };
                }
            }
            // Vanishingly rare TOCTOU (purged/expired between the failed insert and this select) —
            // fail closed once here rather than looping; the caller's next real attempt resolves it.
            return new DispatchClaimResult { Claimed = false };
        }

        /// <summary>Git #3509 — releases a dispatch claim once it's no longer needed: the real
        /// `BUILD:` comment was found (whoever posted it), so nothing further should be blocked by
        /// this issue's claim. Idempotent — deleting a claim that's already gone/expired is a no-op.</summary>
        public async Task ReleaseDispatchClaimAsync(int githubNumber)
        {
            await using var conn = await OpenAsync();
            // Git #3579 — repo-scoped, see TryClaimDispatchAsync's note above.
            await using var cmd = new NpgsqlCommand(
                "DELETE FROM bt_dispatch_claims WHERE repo_owner = @owner AND repo_name = @repo AND github_number = @num", conn);
            cmd.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
            cmd.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
            cmd.Parameters.AddWithValue("@num", githubNumber);
            await cmd.ExecuteNonQueryAsync();
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
        /// <param name="repoOwner">Git #3582 (Feature #3578, Multi-Repo Support) — the real repo
        /// <paramref name="githubNumber"/> belongs to. Defaults to this instance's own configured
        /// repo (identical to every pre-#3582 call), written into `bt_build_queue`'s real
        /// `repo_owner`/`repo_name` columns (#3579's schema) so a same-numbered issue in a second
        /// configured repo is never confused with this repo's own row (see the re-queue lookup and
        /// <see cref="FindDedupCandidateAsync"/>, both now repo-scoped).</param>
        public async Task<QueueItem> QueueBuildAsync(
            string title, string prompt, string? model, string? effort, string? cwd,
            int? githubNumber, List<int>? blockedByNumbers, string? resumeSessionId = null,
            string? chatUrl = null, string? originatingChatId = null, string? buildSet = null, string? cli = null,
            string? account = null, bool park = false, int? reuseRowId = null,
            string? repoOwner = null, string? repoName = null)
        {
            var repoOwnerResolved = string.IsNullOrEmpty(repoOwner) ? RepoIdentity.DefaultOwner : repoOwner;
            var repoNameResolved = string.IsNullOrEmpty(repoName) ? RepoIdentity.DefaultName : repoName;
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

            // Git #3012 — dispatch-time validation: fail loud and early on a header the queue
            // cannot actually launch (a --cwd that doesn't exist, or a --model/--effort value that
            // is itself a stray/malformed flag token), rather than claiming a 'queued' slot and
            // letting the launched session discover the problem itself seconds in. Reuses the
            // existing 'parked' status (the #1638 staging spot the watcher's claim query,
            // WHERE status = 'queued', never picks up) — this is genuinely the same kind of "not
            // ready to run yet" row that status already models, just with a different reason.
            var headerInvalidReason = BuildHeaderValidation.Validate(modelTrimmed, effortTrimmed, cwdTrimmed);
            var finalStatus = (park || headerInvalidReason != null) ? "parked" : "queued";
            if (headerInvalidReason != null)
            {
                ActivityLog.Log("watcher",
                    $"Queue header validation failed for \"{titleTrimmed}\"" +
                    (githubNumber.HasValue ? $" (#{githubNumber.Value})" : "") +
                    $" — parked instead of queued: {headerInvalidReason} (Git #3012).");
            }

            // Git #3623 — the prompt's own `--blocked-by` header is always enforced, whichever caller
            // queued it. #3585 (and #3582/#3584/#3624) were inserted by Batter Up with a prompt whose
            // first line declared `--blocked-by …`, but the caller passed an empty list, so the row
            // landed with no blockers and was claimed while those blockers were still open. The header
            // is the dispatch's declared bridge to this column (BUILD_QUEUE_BLOCKING_AND_GATING.md §3);
            // reading it here means no queue path can drop it again.
            var headerBlockers = BuildPromptHeader.ParseGitHubBlockers(prompt);
            var callerBlockers = blockedByNumbers ?? new List<int>();
            var addedFromHeader = headerBlockers.Except(callerBlockers).ToList();
            if (addedFromHeader.Count > 0)
            {
                ActivityLog.Log("watcher",
                    $"Git #3623: queue header for \"{titleTrimmed}\"" +
                    (githubNumber.HasValue ? $" (#{githubNumber.Value})" : "") +
                    $" declares --blocked-by {string.Join(",", addedFromHeader)} that the queuing caller didn't pass — enforcing them on the row.");
            }
            var allBlockers = callerBlockers.Concat(headerBlockers).Where(n => n != 0).Distinct().ToList();
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
                       AND repo_owner = @repoOwner AND repo_name = @repoName
                       AND status <> 'running'
                     ORDER BY created_at DESC
                     LIMIT 1", conn);
                findCmd.Parameters.AddWithValue("@num", githubNumber.Value);
                findCmd.Parameters.AddWithValue("@repoOwner", repoOwnerResolved);
                findCmd.Parameters.AddWithValue("@repoName", repoNameResolved);
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
                           exit_code = NULL, updated_at = NOW(),
                           repo_owner = @repoOwner, repo_name = @repoName
                      WHERE id = @id
                    RETURNING id, title, prompt, model, effort, cwd,
                              github_number, blocked_by_number, blocked_by_numbers,
                              status, exit_code, session_id, resume_session_id,
                              originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at,
                              superseded_by_id, repo_owner, repo_name", conn);
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
                updateCmd.Parameters.AddWithValue("@repoOwner", repoOwnerResolved);
                updateCmd.Parameters.AddWithValue("@repoName", repoNameResolved);
                await using var reader = await updateCmd.ExecuteReaderAsync();
                if (await reader.ReadAsync()) row = MapRow(reader);
            }

            if (row == null)
            {
                await using var insertCmd = new NpgsqlCommand(@"
                    INSERT INTO bt_build_queue
                        (title, prompt, model, effort, cwd, github_number,
                         blocked_by_number, blocked_by_numbers, resume_session_id,
                         originating_chat_id, chat_url, build_set, cli, account, status,
                         repo_owner, repo_name)
                    VALUES
                        (@title, @prompt, @model, @effort, @cwd, @githubNumber,
                         @blockedByNumber, @blockedByNumbers, @resumeSessionId,
                         @originatingChatId, @chatUrl, @buildSet, @cli, @account, @status,
                         @repoOwner, @repoName)
                    RETURNING id, title, prompt, model, effort, cwd,
                              github_number, blocked_by_number, blocked_by_numbers,
                              status, exit_code, session_id, resume_session_id,
                              originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at,
                              superseded_by_id, repo_owner, repo_name", conn);
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
                insertCmd.Parameters.AddWithValue("@repoOwner", repoOwnerResolved);
                insertCmd.Parameters.AddWithValue("@repoName", repoNameResolved);
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

        // ── MarkOrphanSupersededByResumeAsync ──────────────────────────────────────
        /// <summary>
        /// Git #2120 — the crash-recovery counterpart to <see cref="MarkSupersededByReplyAsync"/>.
        /// That method's guard deliberately leaves a genuinely-<c>failed</c> row untouched (a real
        /// final outcome must not be silently overwritten), which is correct for the Reply flow but
        /// makes it a no-op for the one case that DOES need resolving: an orphan row (<c>failed</c>
        /// with the crash sentinel <c>exit_code = -2</c>, written by
        /// <c>RecoverOrphanedRunningItemsAsync</c>) that "▶ Resume Session (crash recovery)" or
        /// "Recover All" has just re-queued into a fresh row. Left at <c>failed</c>, the recovered
        /// original keeps satisfying <c>status == "failed" &amp;&amp; ExitCode == -2</c> forever —
        /// which is exactly what <c>UpdateOrphanRecoveryBanner</c> and the Crashed filter test, so the
        /// banner/filter never clear even though the build has genuinely been picked back up.
        ///
        /// Narrowly scoped to that one sentinel (<c>status = 'failed' AND exit_code = -2</c>) rather
        /// than widening the general guard — a plain non-orphan failure (a real bug, a bad exit) must
        /// still show as failed, never get silently relabeled superseded. Returns the number of rows
        /// changed (0 if the row wasn't actually an orphan, e.g. already recovered concurrently).
        /// </summary>
        public async Task<int> MarkOrphanSupersededByResumeAsync(int originalId, int replacementId)
        {
            if (originalId == replacementId) return 0;

            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status           = @superseded,
                       superseded_by_id = @replacementId,
                       updated_at       = NOW()
                 WHERE id = @originalId
                   AND status = 'failed'
                   AND exit_code = -2", conn);
            cmd.Parameters.AddWithValue("@superseded", SupersededStatus);
            cmd.Parameters.AddWithValue("@replacementId", replacementId);
            cmd.Parameters.AddWithValue("@originalId", originalId);
            return await cmd.ExecuteNonQueryAsync();
        }

        // ── False-done reconciliation (Git #2685 / #2775) ─────────────────────────
        /// <summary>
        /// Git #2685, widened by #2775 — every issue-linked queue row currently sitting in a
        /// terminal <c>done</c> status OR in <see cref="VerifyingStatus"/>, returned so the
        /// manual-refresh reconciliation pass (<see cref="Services.FalseDoneReconciler"/>) can check
        /// each one's real origin/main bookend. A self-blocked session that wrote a real 🛑 BLOCKED
        /// bookend and exited cleanly (process exit 0, nothing crashed) is marked <c>done</c> by
        /// <see cref="MarkCompleteAsync"/> when the row has no <c>github_number</c> — but per Git
        /// #1469, a row that DOES carry a real <c>github_number</c> lands on <c>verifying</c>
        /// instead (held there until the issue actually closes). #1676's real repro was exactly this:
        /// a genuine self-block landed on <c>verifying</c>, not <c>done</c>, and the original
        /// <c>WHERE status = 'done'</c> query left it structurally invisible to reconciliation. Both
        /// statuses are the same false-positive shape via the same completion signal, so both are
        /// returned here — <c>verifying</c> is NOT in <see cref="IsTerminalStatus"/>, so a false
        /// <c>verifying</c> row blocks every dedup dead-check even more silently than a false
        /// <c>done</c> row did.
        /// </summary>
        public async Task<List<(int Id, int GithubNumber, string Status)>> GetDoneOrVerifyingGithubRowsAsync()
        {
            var rows = new List<(int, int, string)>();
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                SELECT id, github_number, status
                  FROM bt_build_queue
                 WHERE status IN ('done', @verifyingStatus)
                   AND github_number IS NOT NULL", conn);
            cmd.Parameters.AddWithValue("@verifyingStatus", VerifyingStatus);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                rows.Add((reader.GetInt32(0), reader.GetInt32(1), reader.GetString(2)));
            return rows;
        }

        // ── Supervisory-cancel auto-re-queue bound (Git #3521) ────────────────────
        /// <summary>
        /// Git #3521 — reads a row's <c>supervisory_requeue_count</c>: how many times the free-flow
        /// path has already AUTO-re-queued it as a supervisory cancel. <see cref="Services.BatterUpQueueService"/>
        /// .QueueRowAsync consults this to keep the auto-re-queue loop-safe (the #1997 no-auto-loop
        /// guard): a supervisory cancel is re-queued only while this is below <see cref="Services.BatterUpQueueService.MaxSupervisoryAutoRequeues"/>.
        /// A missing row returns 0 (nothing to bound).
        /// </summary>
        public async Task<int> GetSupervisoryRequeueCountAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "SELECT supervisory_requeue_count FROM bt_build_queue WHERE id = @id", conn);
            cmd.Parameters.AddWithValue("@id", id);
            var val = await cmd.ExecuteScalarAsync();
            return val == null || val == DBNull.Value ? 0 : Convert.ToInt32(val);
        }

        /// <summary>
        /// Git #3521 — increments a row's <c>supervisory_requeue_count</c> by one, called right after a
        /// successful free-flow supervisory re-queue so the NEXT time this same row reappears as a
        /// supervisory cancel (it launched and false-done-ed again) it is no longer auto-re-queued —
        /// it stays visible for a manual Queue click instead of looping. Deliberately independent of
        /// the QueueBuildAsync reuse UPDATE (which does not touch this column), so the count survives
        /// the row being reset to 'queued'/exit_code=NULL. Returns rows changed (0 or 1).
        /// </summary>
        public async Task<int> IncrementSupervisoryRequeueCountAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "UPDATE bt_build_queue SET supervisory_requeue_count = supervisory_requeue_count + 1 WHERE id = @id", conn);
            cmd.Parameters.AddWithValue("@id", id);
            return await cmd.ExecuteNonQueryAsync();
        }

        // ── Stale-canceled cleanup for closed issues (Git #3521, finding 2) ───────
        /// <summary>
        /// Git #3521 (second finding) — every issue-linked row currently sitting in terminal
        /// <c>canceled</c>, returned so <see cref="Services.FalseDoneReconciler"/> can check each one's
        /// real GitHub issue state on a manual refresh. A canceled row whose issue was CLOSED (resolved
        /// on GitHub, often weeks ago) is stale local state — the work is genuinely done/decided, yet it
        /// still shows in the Canceled list as if it were current, actionable canceled work. Nothing
        /// reconciled these once their issue closed; this is the read half of the pass that does.
        /// </summary>
        public async Task<List<(int Id, int GithubNumber, int? ExitCode)>> GetCanceledGithubRowsAsync()
        {
            var rows = new List<(int, int, int?)>();
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                SELECT id, github_number, exit_code
                  FROM bt_build_queue
                 WHERE status = 'canceled'
                   AND github_number IS NOT NULL
                   AND github_number > 0", conn);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                rows.Add((reader.GetInt32(0), reader.GetInt32(1), reader.IsDBNull(2) ? (int?)null : reader.GetInt32(2)));
            return rows;
        }

        /// <summary>
        /// Git #3521 (second finding) — moves a stale <c>canceled</c> row whose GitHub issue is now
        /// CLOSED to <see cref="SupersededStatus"/>, so it drops out of the active "Canceled" list (which
        /// keys strictly off <c>status = 'canceled'</c>) instead of lingering as if it were current work.
        /// <c>superseded</c> is the honest terminal resting state: like a Reply-superseded row it is
        /// resolved-elsewhere and invisible to every dedup dead-check, which is correct — a closed issue
        /// is not re-dispatch material. Guarded <c>status = 'canceled'</c> so it is idempotent and can
        /// never rewrite a row a concurrent pass already moved on. Returns rows changed (0 or 1).
        /// </summary>
        public async Task<int> MarkCanceledResolvedClosedAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status = @superseded, updated_at = NOW()
                 WHERE id = @id AND status = 'canceled'", conn);
            cmd.Parameters.AddWithValue("@superseded", SupersededStatus);
            cmd.Parameters.AddWithValue("@id", id);
            return await cmd.ExecuteNonQueryAsync();
        }

        // ── Canceled auto-archive (Git #3607) ──────────────────────────────────────
        /// <summary>
        /// Git #3607, Rule A — every terminal <c>canceled</c>, not-yet-archived row that DOES carry a
        /// real GitHub issue number, for <see cref="Services.FalseDoneReconciler"/> to check each one's
        /// real issue state against. "Real" excludes the Git #1645 negative sentinel a <c>--notGit</c>
        /// local build stores in this same column (confirmed live: rows 186-225 in this repo's own
        /// queue carry <c>github_number</c> -6 through -13 for "local #6".."local #13" — Rule B below
        /// covers those, not this). Deliberately does NOT filter on <c>exit_code</c>: the issue's own
        /// rule 7 is explicit that a genuine 🚫 CANCELED failure and a self-blocked ⏳ WAITING row
        /// (exit_code=0, see <c>IsWaitingSelfBlocked</c>) are archived identically once their real
        /// issue is confirmed closed — no carve-out.
        /// </summary>
        public async Task<List<(int Id, int GithubNumber)>> GetCanceledUnarchivedWithIssueRowsAsync()
        {
            var rows = new List<(int, int)>();
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                SELECT id, github_number
                  FROM bt_build_queue
                 WHERE status = 'canceled'
                   AND archived = FALSE
                   AND github_number IS NOT NULL
                   AND github_number > 0", conn);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                rows.Add((reader.GetInt32(0), reader.GetInt32(1)));
            return rows;
        }

        /// <summary>
        /// Git #3607, Rule B — every terminal <c>canceled</c>, not-yet-archived row that has NO real
        /// GitHub issue to check at all: either <c>github_number IS NULL</c>, or the Git #1645 negative
        /// sentinel a <c>--notGit</c> local build stores there (confirmed live: "local #6".."local
        /// #13" carry -6..-13 — the exact rows Shane's own screenshot showed sitting indefinitely).
        /// Archived directly by the reconciler, no GitHub-side check needed or possible.
        /// </summary>
        public async Task<List<int>> GetCanceledUnarchivedNoIssueRowIdsAsync()
        {
            var ids = new List<int>();
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                SELECT id
                  FROM bt_build_queue
                 WHERE status = 'canceled'
                   AND archived = FALSE
                   AND (github_number IS NULL OR github_number <= 0)", conn);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                ids.Add(reader.GetInt32(0));
            return ids;
        }

        /// <summary>
        /// Git #3607 — the soft-archive write for either rule above: sets <c>archived = TRUE</c>,
        /// <c>archived_at = NOW()</c>. Never a delete — the row and its full history stay real and
        /// queryable; this only flags it out of the default Canceled board view. Guarded
        /// <c>status = 'canceled' AND archived = FALSE</c> so it is idempotent and can never re-archive
        /// (or silently no-op an archive of) a row a concurrent pass already moved on. Returns rows
        /// changed (0 or 1) so the caller only logs/counts a real action.
        /// </summary>
        public async Task<int> ArchiveCanceledQueueRowAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET archived = TRUE, archived_at = NOW(), updated_at = NOW()
                 WHERE id = @id AND status = 'canceled' AND archived = FALSE", conn);
            cmd.Parameters.AddWithValue("@id", id);
            return await cmd.ExecuteNonQueryAsync();
        }

        /// <summary>
        /// Git #2685, widened by #2775 — the deliberate, narrow exception to
        /// <see cref="MarkSupersededByReplyAsync"/>'s "never rewrite a terminal row" guard: a NEW,
        /// dedicated method (the Reply-supersede guard exists for good reason and is NOT weakened
        /// here) that resets a confirmed false-<c>done</c>/false-<c>verifying</c> row — its origin/main
        /// bookend proves it is actually BLOCKED, not done and not genuinely awaiting verification —
        /// to <c>canceled</c>.
        ///
        /// <c>canceled</c> is chosen over <c>superseded</c> deliberately, and after live verification
        /// (see the issue): <c>canceled</c> is a real non-blocking terminal state
        /// (<see cref="IsTerminalStatus"/>) that already flows through EVERY dedup dead-check —
        /// <see cref="Services.BatterUpQueueService"/>.RefreshAsync (failed/canceled ⇒ reappear) and
        /// QueueRowAsync (IsTerminalStatus &amp;&amp; !done ⇒ re-queue via reuseRowId) — so the issue
        /// becomes re-dispatchable with zero changes to any gate and zero risk to the Reply flow. This
        /// holds identically starting from <c>verifying</c>: the target state and every dead-check only
        /// look at the row's CURRENT status, never at what it transitioned from. A <c>superseded</c>
        /// row, by contrast, is invisible to all three dead-checks and would stay dedup-locked. The
        /// <c>status IN ('done', 'verifying')</c> guard makes this idempotent and race-safe: a row
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
                   AND status IN ('done', @verifyingStatus)
                   AND github_number IS NOT NULL", conn);
            cmd.Parameters.AddWithValue("@verifyingStatus", VerifyingStatus);
            cmd.Parameters.AddWithValue("@id", id);
            return await cmd.ExecuteNonQueryAsync();
        }

        // ── RevertFalseDoneToVerifyingAsync (Git #3513) ───────────────────────────
        /// <summary>
        /// Git #3513 — the counterpart to <see cref="MarkFalseDoneReconciledAsync"/> for the OTHER
        /// false-done shape: a row marked terminal <c>done</c> (with a real github_number) whose
        /// GitHub issue is in fact STILL OPEN, but whose origin/main bookend is a genuine, git-verified
        /// DONE (its cited commit is a real ancestor of origin/main — the work really landed). That row
        /// was wrongly promoted <c>verifying → done</c> by <see cref="PromoteVerifyingToDoneAsync"/>
        /// off an empty/partial open-issue snapshot (the #3512 rate-limit storm; and MainWindow's Home
        /// reconcile fetched with the old default 500-limit while &gt;500 issues were open) — the issue
        /// never actually closed. Because the work DID land, the honest state is <see cref="VerifyingStatus"/>
        /// (visible in the active queue, correctly waiting for Shane to close the real issue), NOT
        /// <c>canceled</c>/re-dispatchable — re-dispatching genuinely-completed work is waste. The very
        /// next <see cref="PromoteVerifyingToDoneAsync"/> pass leaves it in verifying while the issue
        /// stays open and promotes it to real done only once the issue actually closes, exactly as
        /// #1469 intended. Guarded <c>status='done' AND github_number IS NOT NULL</c> so it is
        /// idempotent and never touches a genuinely-closed/no-github row. Returns rows changed (0 or 1).
        /// </summary>
        public async Task<int> RevertFalseDoneToVerifyingAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = @verifyingStatus,
                       updated_at = NOW()
                 WHERE id = @id
                   AND status = 'done'
                   AND github_number IS NOT NULL", conn);
            cmd.Parameters.AddWithValue("@verifyingStatus", VerifyingStatus);
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

            // Git #3513 — fail CLOSED on an empty open-issue set. A row is promoted to done only on
            // POSITIVE evidence its issue closed: its number being ABSENT from the open set. That logic
            // is only sound when the set is a TRUSTWORTHY snapshot. An EMPTY set never is here — this
            // repo always has hundreds of open issues, so Count==0 means the `gh` fetch failed or was
            // rate-limited (the #3512 storm), NOT "every issue is closed." Promoting off an empty set
            // marks EVERY verifying row done in one pass against issues that are all still open — the
            // exact mechanism that produced #3513's 69 false-done rows (MainWindow's Home reconcile
            // called this with GetOpenIssueNumbersAsync(), which collapses a failed fetch to an empty
            // set, with no caller-side guard). Guarding here protects every caller centrally; a skipped
            // promotion is self-healing — the next refresh with a real set promotes any genuinely-closed
            // row then. (Partial-but-non-empty snapshots are the FalseDoneReconciler's backstop: a row
            // wrongly promoted off a truncated set is caught next board refresh as done+issue-still-open
            // and reverted to verifying / re-dispatched.)
            if (openIssueNumbers == null || openIssueNumbers.Count == 0)
            {
                ActivityLog.Log("github",
                    "Git #3513: PromoteVerifyingToDoneAsync received an EMPTY open-issue set — promoting nothing (fail closed). " +
                    "An empty set here means the open-issue fetch failed, never that all issues are closed.");
                return promoted;
            }

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
                bool isVerifying = string.Equals(oldStatus, VerifyingStatus, StringComparison.OrdinalIgnoreCase);
                GitHubApiClient.IssueBoardStatus? board;
                try
                {
                    if (isVerifying)
                    {
                        // Git #3113 — the BACKGROUND Verifying reconcile is a routine status lookup that
                        // fires on every Home/Build Watch/Git Board refresh; read it from the local
                        // mirror first (zero GitHub calls), falling back to a live read only on a mirror
                        // miss. A stale-but-present reading is safe HERE specifically: this reconcile
                        // only ever moves a row to a TERMINAL state, and not moving it (or moving it a
                        // tick later) is self-healing on the next sync — it can never wrongly RELEASE
                        // work the way the fail-closed launch gate could, which is why that gate stays
                        // live and this does not.
                        var mirrored = await GitHubIssueMirror.TryGetAsync(num);
                        board = mirrored != null
                            ? new GitHubApiClient.IssueBoardStatus
                            {
                                OptionId = mirrored.BoardStatusOptionId,
                                StatusName = mirrored.BoardStatusName,
                            }
                            : await gh.GetIssueBoardStatusAsync(num);
                    }
                    else
                    {
                        // Git #3113 — a SCOPED queued row is exactly an issue a Build Chain Map edit JUST
                        // moved on the board; this is the authoritative "did my move take?" check, so it
                        // stays LIVE. A stale mirror reading here could wrongly cancel a row Shane just
                        // re-queued (Batter Up → Backlog → back), the genuinely-unsafe case the #3113
                        // audit keeps on GitHub.
                        board = await gh.GetIssueBoardStatusAsync(num);
                    }
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
        /// drives MainWindow's Drain-button count. Git #3611 — BuildQueuePanel no longer has a
        /// dedicated "Capped" filter tab; a capped row now shows directly in Queued/
        /// RunningAndQueued (ApplyFilter, client-side over the already-loaded queue), which
        /// doesn't call this DB method.</summary>
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
        /// Log-sweep session-limit recovery — used by
        /// <see cref="SessionLimitAutoRestartService"/>'s automatic periodic sweep
        /// (Git #3573; previously a manual BuildQueuePanel button) that scans
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

        // ── Git #3661 — self-blocked "⏳ WAITING" auto-requeue sweep ────────────────

        /// <summary>
        /// Every row currently sitting self-blocked "⏳ WAITING" (Git #3599/#3620's own
        /// definition — see <c>BuildQueuePanel.IsWaitingSelfBlocked</c>: <c>status='canceled'
        /// AND exit_code=0</c>, a supervisory self-cancel, not a genuine abort) that also
        /// declares at least one real blocker. A canceled/exit-0 row with NO declared
        /// blocker isn't this sweep's concern — nothing here would ever release it.
        /// </summary>
        public async Task<List<QueueItem>> GetWaitingSelfBlockedAsync()
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                SELECT id, title, prompt, model, effort, cwd,
                       github_number, blocked_by_number, blocked_by_numbers,
                       status, exit_code, session_id, resume_session_id,
                       originating_chat_id, chat_url, updated_at, build_set, cli, account, build_pid, build_pid_started_at
                FROM bt_build_queue
                WHERE status = 'canceled' AND exit_code = 0
                  AND (blocked_by_number IS NOT NULL
                       OR (blocked_by_numbers IS NOT NULL AND array_length(blocked_by_numbers, 1) > 0))
                ORDER BY created_at ASC", conn);
            var items = new List<QueueItem>();
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    items.Add(MapRow(reader));
            }
            await PopulateAssociatedIssueNumbersAsync(items, conn);
            return items.Where(i => EffectiveBlockers(i).Count > 0).ToList();
        }

        /// <summary>
        /// Flips ONE self-blocked "⏳ WAITING" row back to 'queued' so the very next
        /// <see cref="GetNextAsync"/> tick picks it up as a normal claim candidate —
        /// resume_session_id is preserved (this is a resume, not a fresh restart, same
        /// discipline as <see cref="RequeueLimitPausedAsync"/>/<see cref="RecoverStalledSessionLimitRowAsync"/>).
        /// Re-checks the row is still genuinely in the self-blocked-WAITING shape at
        /// update time (defensive against a concurrent manual action in between the sweep's
        /// read and this write); returns false if it no longer matches.
        /// </summary>
        public async Task<bool> RequeueWaitingRowAsync(int id)
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
                 WHERE id = @id AND status = 'canceled' AND exit_code = 0", conn);
            cmd.Parameters.AddWithValue("@id", id);
            return await cmd.ExecuteNonQueryAsync() > 0;
        }

        /// <summary>Git #3661 — one self-blocked "⏳ WAITING" row the sweep auto-requeued, plus
        /// exactly which of its declared blockers it confirmed closed.</summary>
        public sealed record WaitingRequeueResult(QueueItem Item, List<int> ClearedBlockers);

        /// <summary>
        /// Git #3661 — the periodic auto-requeue sweep's real decision logic: for every row
        /// currently self-blocked "⏳ WAITING" (<see cref="GetWaitingSelfBlockedAsync"/>), live-check
        /// whether EVERY declared blocker is now genuinely closed — the exact same "closed" definition
        /// <see cref="EvaluateCandidatesAsync"/> (GetNextAsync's own claim check) already uses: GitHub
        /// reports it closed, OR it's still open on GitHub but a verified DONE bookend on origin/main
        /// proves the work actually landed (Git #2225). A row with ANY blocker that's neither is left
        /// alone untouched.
        ///
        /// Fails closed exactly like the claim path (Git #1600): if the live open-issue snapshot can't
        /// be fetched at all, nothing is requeued this tick and every row is reported unrequeued —
        /// never guess a blocker is closed from stale/missing data.
        /// </summary>
        /// <param name="liveOpenIssuesFetcher">Test seam — defaults to a real live `gh issue list
        /// --state open` snapshot (GitHubIssuesService), identical to GetNextAsync's own default.</param>
        public async Task<(List<WaitingRequeueResult> Requeued, int Scanned, bool GitHubReachable)> SweepAutoRequeueWaitingAsync(
            Func<Task<LiveOpenIssuesResult>>? liveOpenIssuesFetcher = null)
        {
            var waiting = await GetWaitingSelfBlockedAsync();
            if (waiting.Count == 0) return (new List<WaitingRequeueResult>(), 0, true);

            var live = await (liveOpenIssuesFetcher != null
                ? liveOpenIssuesFetcher()
                : GitHubIssuesService.TryGetOpenIssueNumbersAsync());
            if (!live.Success)
            {
                ActivityLog.Log("auto-requeue",
                    $"Git #3661: couldn't reach GitHub to re-check {waiting.Count} self-blocked WAITING row(s) ({live.Error}) — leaving all of them alone this tick (fail closed, same stance as the claim path).");
                return (new List<WaitingRequeueResult>(), waiting.Count, false);
            }

            // Git #2225 — a blocker still open on GitHub can still be satisfied by a verified DONE
            // bookend; compute this ONCE for every still-open blocker across all waiting rows, exactly
            // as EvaluateCandidatesAsync does for the claim path.
            var stillOpenAcrossAll = waiting.SelectMany(EffectiveBlockers)
                .Where(b => live.OpenNumbers.Contains(b)).Distinct().ToList();
            var satisfiedByDoneBookend = new HashSet<int>();
            if (stillOpenAcrossAll.Count > 0)
            {
                try { satisfiedByDoneBookend = await DoneBookendVerifier.GetSatisfiedAsync(stillOpenAcrossAll); }
                catch (Exception ex)
                {
                    ActivityLog.Log("auto-requeue", $"Git #3661: DONE-bookend blocker check threw ({ex.Message}) — treating all still-open blockers as unsatisfied this tick (fail closed).");
                }
            }

            var requeued = new List<WaitingRequeueResult>();
            foreach (var item in waiting)
            {
                var blockers = EffectiveBlockers(item);
                var stillOpen = blockers.Where(b => live.OpenNumbers.Contains(b) && !satisfiedByDoneBookend.Contains(b)).ToList();
                if (stillOpen.Count > 0) continue; // real blocker(s) not yet confirmed closed — leave alone

                bool ok = await RequeueWaitingRowAsync(item.Id);
                if (ok) requeued.Add(new WaitingRequeueResult(item, blockers));
            }
            return (requeued, waiting.Count, true);
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
            // Git #2119 — superseded_by_id is an OPTIONAL trailing ordinal (21): GetQueueAsync's
            // display query and (as of #3583) the claim-candidate queries select it. Every other
            // SELECT stops at build_pid_started_at (FieldCount==21), so the FieldCount>21 guard below
            // leaves SupersededById null for them rather than throwing — no need to thread the new
            // column through all ~13 SELECTs (the #1384 fixed-ordinal minefield).
            // Git #3583 — repo_owner/repo_name are OPTIONAL trailing ordinals (22/23), selected only
            // by SelectClaimCandidatesAsync's fetch + GetNextAsync's claim RETURNING (the per-repo
            // pause control needs each candidate's real repo). Same discipline: a brand-new ordinal,
            // never a reused one.
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
                // Git #2119 — optional trailing ordinal (see the note above): present on
                // GetQueueAsync's display query AND (as of #3583) the claim-candidate queries.
                SupersededById    = r.FieldCount > 21 && !r.IsDBNull(21) ? r.GetInt32(21) : null,
                // Git #3583 — optional trailing ordinals 22/23, present only on the queries that
                // select them (SelectClaimCandidatesAsync's fetch + GetNextAsync's claim RETURNING —
                // see #3579's own comment above re: bt_build_queue's real columns-only repo dimension).
                // Same #1384 fixed-ordinal discipline as SupersededById just above: a NEW ordinal,
                // never a reused one, so a reader without these columns just leaves them null.
                RepoOwner         = r.FieldCount > 22 && !r.IsDBNull(22) ? r.GetString(22) : null,
                RepoName          = r.FieldCount > 23 && !r.IsDBNull(23) ? r.GetString(23) : null,
                // Git #3607 — optional trailing ordinals 24/25, present only on GetQueueAsync's
                // display query (which also selects repo_owner/repo_name at 22/23 so the ordinal
                // sequence stays unambiguous — see that query's own comment).
                Archived          = r.FieldCount > 24 && !r.IsDBNull(24) && r.GetBoolean(24),
                ArchivedAt        = r.FieldCount > 25 && !r.IsDBNull(25) ? r.GetFieldValue<DateTimeOffset>(25) : (DateTimeOffset?)null,
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
            // Git #3579 — bt_epics is now repo-scoped; the Chats panel's epic list stays
            // scoped to this repo (defaulted) so a second repo's epics can't silently mix in.
            const string sqlEpics = @"
                SELECT id, title, status, github_number, design_url
                FROM bt_epics
                WHERE repo_owner = @owner AND repo_name = @repo
                ORDER BY title ASC";
            await using var cmdEpics = new NpgsqlCommand(sqlEpics, conn);
            cmdEpics.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
            cmdEpics.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
            await using (var reader = await cmdEpics.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    board.Epics.Add(new BoardEpic
                    {
                        Id = reader.GetInt32(0),
                        Title = reader.IsDBNull(1) ? "" : reader.GetString(1),
                        Status = reader.IsDBNull(2) ? "" : reader.GetString(2),
                        GithubNumber = reader.IsDBNull(3) ? null : reader.GetInt32(3),
                        DesignUrl = reader.IsDBNull(4) ? null : reader.GetString(4)
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

        /// <summary>
        /// Git #3692 — sets (or clears, when <paramref name="url"/> is null/blank) the real
        /// "Claude Design URL" pill value for an epic, keyed by its real github_number (the
        /// table's existing natural key, same as every other per-epic fact). Repo-scoped the
        /// same way the rest of bt_epics lookups are post-#3579.
        /// </summary>
        public async Task SetEpicDesignUrlAsync(int githubNumber, string? url)
        {
            var normalized = string.IsNullOrWhiteSpace(url) ? null : url.Trim();
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_epics
                   SET design_url = @url,
                       updated_at = NOW()
                 WHERE repo_owner = @owner AND repo_name = @repo AND github_number = @githubNumber", conn);
            cmd.Parameters.Add(new NpgsqlParameter("@url", NpgsqlDbType.Text)
                { Value = normalized is null ? (object)DBNull.Value : normalized });
            cmd.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
            cmd.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
            cmd.Parameters.AddWithValue("@githubNumber", githubNumber);
            int rows = await cmd.ExecuteNonQueryAsync();
            if (rows == 0)
                throw new InvalidOperationException($"Epic #{githubNumber} not found in bt_epics — cannot set design URL.");
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
            // Git #3579 — bt_chat_issues' uniqueness is now (chat_id, repo_owner, repo_name,
            // issue_number); repo columns written explicitly (defaulted to this repo).
            const string insertLinkSql = @"
                INSERT INTO bt_chat_issues (chat_id, issue_number, repo_owner, repo_name)
                VALUES (@chatId, @issueNumber, @owner, @repo)
                ON CONFLICT DO NOTHING";

            await using (var cmd = new NpgsqlCommand(insertLinkSql, conn))
            {
                cmd.Parameters.AddWithValue("@chatId", chatId.Value);
                cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                cmd.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
                cmd.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
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
                // Git #3579 — repo-scoped (see LinkChatToIssueAsync's insert above).
                const string deleteLinkSql = @"
                    DELETE FROM bt_chat_issues
                    WHERE chat_id = @chatId AND repo_owner = @owner AND repo_name = @repo AND issue_number = @issueNumber";

                await using (var cmd = new NpgsqlCommand(deleteLinkSql, conn))
                {
                    cmd.Parameters.AddWithValue("@chatId", chatId.Value);
                    cmd.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
                    cmd.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
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
            // Git #3579 — bt_epics/bt_issues' github_number uniqueness is now (repo_owner,
            // repo_name, github_number); every lookup/upsert below threads the real repo
            // dimension explicitly (defaulted to this repo, the only one BuildConsole talks
            // to today) so a second repo's issue #N can never resolve to this repo's row.
            const string findEpicSql = "SELECT id FROM bt_epics WHERE repo_owner = @owner AND repo_name = @repo AND github_number = @issueNumber LIMIT 1";
            int? epicId = null;
            await using (var cmd = new NpgsqlCommand(findEpicSql, conn))
            {
                cmd.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
                cmd.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
                cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                var val = await cmd.ExecuteScalarAsync();
                if (val != null && val != DBNull.Value) epicId = Convert.ToInt32(val);
            }

            int? issueId = null;
            int? issueEpicId = null;
            if (!epicId.HasValue)
            {
                const string findIssueSql = "SELECT id, epic_id FROM bt_issues WHERE repo_owner = @owner AND repo_name = @repo AND github_number = @issueNumber LIMIT 1";
                await using (var cmd = new NpgsqlCommand(findIssueSql, conn))
                {
                    cmd.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
                    cmd.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
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
                            INSERT INTO bt_epics (title, status, github_number, repo_owner, repo_name)
                            VALUES (@title, 'open', @issueNumber, @owner, @repo)
                            ON CONFLICT (repo_owner, repo_name, github_number) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
                            RETURNING id";
                        await using var cmd = new NpgsqlCommand(upsertEpicSql, conn);
                        cmd.Parameters.AddWithValue("@title", live.Value.Title);
                        cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                        cmd.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
                        cmd.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
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
                            const string findParentEpicSql = "SELECT id FROM bt_epics WHERE repo_owner = @owner AND repo_name = @repo AND github_number = @parentNumber LIMIT 1";
                            await using var pcmd = new NpgsqlCommand(findParentEpicSql, conn);
                            pcmd.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
                            pcmd.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
                            pcmd.Parameters.AddWithValue("@parentNumber", live.Value.ParentEpicGithubNumber.Value);
                            var pval = await pcmd.ExecuteScalarAsync();
                            if (pval != null && pval != DBNull.Value) parentEpicId = Convert.ToInt32(pval);
                        }

                        const string upsertIssueSql = @"
                            INSERT INTO bt_issues (title, status, github_number, epic_id, repo_owner, repo_name)
                            VALUES (@title, 'backlog', @issueNumber, @epicId, @owner, @repo)
                            ON CONFLICT (repo_owner, repo_name, github_number) DO UPDATE SET title = EXCLUDED.title,
                                epic_id = COALESCE(bt_issues.epic_id, EXCLUDED.epic_id), updated_at = NOW()
                            RETURNING id, epic_id";
                        await using var icmd = new NpgsqlCommand(upsertIssueSql, conn);
                        icmd.Parameters.AddWithValue("@title", live.Value.Title);
                        icmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                        icmd.Parameters.Add(new NpgsqlParameter("@epicId", NpgsqlDbType.Integer)
                        { Value = parentEpicId.HasValue ? (object)parentEpicId.Value : DBNull.Value });
                        icmd.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
                        icmd.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
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
            // Git #3579 — bt_chat_mentioned_issues' uniqueness is now (chat_url, repo_owner,
            // repo_name, issue_number); repo columns written explicitly (defaulted to this repo).
            const string sql = @"
                INSERT INTO bt_chat_mentioned_issues (chat_url, issue_number, repo_owner, repo_name, first_seen_at, last_seen_at)
                VALUES (@chatUrl, @issueNumber, @owner, @repo, NOW(), NOW())
                ON CONFLICT (chat_url, repo_owner, repo_name, issue_number) DO UPDATE SET last_seen_at = NOW()";

            foreach (var issueNumber in issueNumbers)
            {
                await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("@chatUrl", chatUrl);
                cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                cmd.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
                cmd.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
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
            // Git #3579 — openIssueNumbers is this repo's own live open-issue set; bound the
            // sweep to this repo's rows so a same-numbered issue in a second repo is never
            // evicted based on THIS repo's open/closed state.
            const string sql = @"
                DELETE FROM bt_chat_mentioned_issues
                WHERE repo_owner = @owner AND repo_name = @repo
                  AND NOT (issue_number = ANY(@openNumbers))";
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
            cmd.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
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
        /// Creates a client from the BUILD_DATABASE_URL= line in &lt;repoRoot&gt;/.env.local
        /// (see <see cref="TryResolveConnectionString"/>). Returns null (and logs via
        /// <paramref name="onMissing"/>) if it isn't found.
        /// </summary>
        public static BuildQueuePostgresClient? TryCreate(
            string? repoRoot,
            Action<string> onMissing)
        {
            // Git #1985 — was `repoRoot` typed as non-nullable `string` at the call site with the
            // caller coalescing a null FindRepoRoot() to "". That resolves .env.local against the
            // PROCESS CWD instead of the repo root, silently — either missing the real file (falls
            // through to the generic "no BUILD_DATABASE_URL" message below, which doesn't reveal the
            // real cause) or, worse, picking up an unrelated .env.local. Fail closed instead: a null
            // repo root here is treated the same as "no BUILD_DATABASE_URL", but the message says why.
            if (string.IsNullOrWhiteSpace(repoRoot))
            {
                onMissing("Repo root could not be resolved — cannot look for .env.local. Direct-Postgres queue DB access is unavailable this run; falling back to HTTP (API server).");
                return null;
            }

            var url = TryResolveConnectionString(repoRoot);
            if (!string.IsNullOrWhiteSpace(url))
                return new BuildQueuePostgresClient(url!);

            onMissing(
                "No BUILD_DATABASE_URL found — add BUILD_DATABASE_URL=<connection string> (BuildConsole's own " +
                "database) to .env.local at the repo root. The queue watcher will fall back to HTTP (API server), " +
                "which still reads the product database's stale pre-#3651 copy of the bt_ tables.");
            return null;
        }

        /// <summary>
        /// Git #3113 / #3651 — resolves BuildConsole's own database connection string from the
        /// <c>BUILD_DATABASE_URL=</c> line in &lt;repoRoot&gt;/.env.local, WITHOUT constructing a
        /// client. The single point of truth every bt_ consumer routes through (<see cref="TryCreate"/>,
        /// <see cref="GitHubIssueMirror"/>, <c>TestPadPersistence</c>). Deliberately no fallback to
        /// <c>DATABASE_URL</c> (the shared product database) or the config's <c>databaseUrl</c>
        /// override — a missing BUILD_DATABASE_URL returns null rather than silently landing in the
        /// wrong database. A null/blank <paramref name="repoRoot"/> is treated the same as "no
        /// .env.local" (the #1985 fail-closed rule), so .env.local is never resolved against the
        /// process cwd.
        /// </summary>
        public static string? TryResolveConnectionString(string? repoRoot)
        {
            const string key = "BUILD_DATABASE_URL=";
            if (string.IsNullOrWhiteSpace(repoRoot)) return null;

            var envLocal = System.IO.Path.Combine(repoRoot, ".env.local");
            if (!System.IO.File.Exists(envLocal)) return null;
            foreach (var line in System.IO.File.ReadAllLines(envLocal))
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith('#') || !trimmed.StartsWith(key, StringComparison.OrdinalIgnoreCase))
                    continue;
                var url = trimmed.Substring(key.Length).Trim().Trim('"').Trim('\'');
                if (!string.IsNullOrWhiteSpace(url)) return url;
            }
            return null;
        }
    }
}
