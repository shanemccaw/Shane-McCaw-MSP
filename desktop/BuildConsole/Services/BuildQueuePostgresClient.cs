using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Npgsql;
using NpgsqlTypes;

namespace BuildConsole.Services
{
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
    /// ── Blocker check ────────────────────────────────────────────────────────────
    /// The claim logic (GetNextAsync) replicates the server's own isBlockerCleared /
    /// areBlockersCleared logic entirely in-DB:
    ///   "A blocker is cleared if the most recent bt_build_queue row for that
    ///    githubNumber has status='done' AND exit_code=0."
    /// No GitHub API calls are made from here (matching the server's own 2026-08-14
    /// stance: "no local row = keep waiting"; a closed-on-GitHub-but-never-queued
    /// blocker still requires a manual force-claim to bypass).
    /// </summary>
    public class BuildQueuePostgresClient
    {
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
            const string sql = @"
                SELECT id, title, prompt, model, effort, cwd,
                       github_number, blocked_by_number, blocked_by_numbers,
                       status, exit_code, session_id, resume_session_id,
                       originating_chat_id, chat_url, updated_at, build_set, cli, account
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

        // ── GetNextAsync ──────────────────────────────────────────────────────────
        /// <summary>
        /// Atomically claims up to <paramref name="limit"/> ready rows:
        ///   • status = 'queued'
        ///   • all blockers are cleared (most-recent bt_build_queue row for each
        ///     blocked_by number has status='done' AND exit_code=0)
        /// Marks claimed rows status='running', claimed_at=NOW(), updated_at=NOW()
        /// in the same transaction so a double-poll can never double-claim.
        ///
        /// Replicates the server's GET /extension/queue/next logic verbatim,
        /// minus the GitHub API fallback (see class doc comment).
        /// </summary>
        public async Task<List<QueueItem>> GetNextAsync(int limit)
        {
            if (limit <= 0) return new List<QueueItem>();
            limit = Math.Min(limit, 20); // same cap as the server

            // Step 1 — fetch all queued rows (cheapest scan; the queue is tiny).
            const string fetchSql = @"
                SELECT id, title, prompt, model, effort, cwd,
                       github_number, blocked_by_number, blocked_by_numbers,
                       status, exit_code, session_id, resume_session_id,
                       originating_chat_id, chat_url, updated_at, build_set, cli, account
                FROM bt_build_queue
                WHERE status = 'queued'
                ORDER BY created_at ASC";

            var pausedIds = BuildConsoleSettings.Load().PausedBuildIds;
            var candidates = new List<QueueItem>();
            await using var conn = await OpenAsync();
            await using var fetchCmd = new NpgsqlCommand(fetchSql, conn);
            await using (var reader = await fetchCmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    var item = MapRow(reader);
                    if (!pausedIds.Contains(item.Id))
                        candidates.Add(item);
                }
            }

            // Step 2 — filter to items whose blockers are all cleared.
            var ready = new List<int>(); // ids to claim
            foreach (var item in candidates)
            {
                if (ready.Count >= limit) break;
                var blockers = EffectiveBlockers(item);
                if (blockers.Count == 0 || await AreBlockersClearedAsync(conn, blockers))
                    ready.Add(item.Id);
            }

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
                          originating_chat_id, chat_url, updated_at, build_set, cli, account";

            var claimed = new List<QueueItem>();
            await using (var reader = await claimCmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    claimed.Add(MapRow(reader));
            }
            await PopulateAssociatedIssueNumbersAsync(claimed, conn);
            return claimed;
        }

        // ── QueueBuildAsync ───────────────────────────────────────────────────────
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
        /// </summary>
        public async Task<QueueItem> QueueBuildAsync(
            string title, string prompt, string? model, string? effort, string? cwd,
            int? githubNumber, List<int>? blockedByNumbers, string? resumeSessionId = null,
            string? chatUrl = null, string? originatingChatId = null, string? buildSet = null, string? cli = null,
            string? account = null)
        {
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
            if (githubNumber.HasValue)
            {
                int? existingId = null;
                await using (var findCmd = new NpgsqlCommand(@"
                    SELECT id FROM bt_build_queue
                     WHERE github_number = @num
                       AND status <> 'running'
                     ORDER BY created_at DESC
                     LIMIT 1", conn))
                {
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
                               chat_url = @chatUrl, status = 'queued', claimed_at = NULL, completed_at = NULL,
                               exit_code = NULL, updated_at = NOW()
                          WHERE id = @id
                        RETURNING id, title, prompt, model, effort, cwd,
                                  github_number, blocked_by_number, blocked_by_numbers,
                                  status, exit_code, session_id, resume_session_id,
                                  originating_chat_id, chat_url, updated_at, build_set, cli, account", conn);
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
                    updateCmd.Parameters.AddWithValue("@id", existingId.Value);
                    await using var reader = await updateCmd.ExecuteReaderAsync();
                    if (await reader.ReadAsync()) row = MapRow(reader);
                }
            }

            if (row == null)
            {
                await using var insertCmd = new NpgsqlCommand(@"
                    INSERT INTO bt_build_queue
                        (title, prompt, model, effort, cwd, github_number,
                         blocked_by_number, blocked_by_numbers, resume_session_id,
                         originating_chat_id, chat_url, build_set, cli, account)
                    VALUES
                        (@title, @prompt, @model, @effort, @cwd, @githubNumber,
                         @blockedByNumber, @blockedByNumbers, @resumeSessionId,
                         @originatingChatId, @chatUrl, @buildSet, @cli, @account)
                    RETURNING id, title, prompt, model, effort, cwd,
                              github_number, blocked_by_number, blocked_by_numbers,
                              status, exit_code, session_id, resume_session_id,
                              originating_chat_id, chat_url, updated_at, build_set, cli, account", conn);
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
                await using var reader = await insertCmd.ExecuteReaderAsync();
                await reader.ReadAsync();
                row = MapRow(reader);
            }

            // Fire-and-forget, non-fatal — mirrors the server's own "queue action must
            // never be delayed or failed by a label sync" stance.
            if (githubNumber.HasValue)
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

            if (row != null)
            {
                await PopulateAssociatedIssueNumbersAsync(new List<QueueItem> { row }, conn);
            }

            return row;
        }

        // ── MarkCompleteAsync ─────────────────────────────────────────────────────
        /// <summary>
        /// Marks a queue row done or failed and stores the session id so a Reply can
        /// resume it. Replicates POST /extension/queue/:id/complete exactly.
        /// </summary>
        public async Task MarkCompleteAsync(int id, int exitCode, string? sessionId = null)
        {
            var status = exitCode == 0 ? "done" : "failed";
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status        = @status,
                       exit_code     = @exitCode,
                       completed_at  = NOW(),
                       updated_at    = NOW()
                     , session_id    = COALESCE(@sessionId, session_id)
                 WHERE id = @id", conn);
            cmd.Parameters.AddWithValue("@status", status);
            cmd.Parameters.AddWithValue("@exitCode", exitCode);
            cmd.Parameters.AddWithValue("@sessionId",
                sessionId != null ? (object)sessionId : DBNull.Value);
            cmd.Parameters.AddWithValue("@id", id);
            await cmd.ExecuteNonQueryAsync();
        }

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
                   AND (status = 'queued' OR status = @heldStatus)
                RETURNING id, title, prompt, model, effort, cwd,
                          github_number, blocked_by_number, blocked_by_numbers,
                          status, exit_code, session_id, resume_session_id,
                          originating_chat_id, chat_url, updated_at, build_set, cli, account", conn);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@heldStatus", AccountCapPolicy.HeldStatus);

            QueueItem row;
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                if (!await reader.ReadAsync())
                    throw new InvalidOperationException($"Queue item {id} is not in 'queued' or 'held' status — cannot force-claim.");
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
                   AND status IN ('queued', 'held', 'limit-paused')", conn);
            cmd.Parameters.AddWithValue("@id", id);
            var rowsAffected = await cmd.ExecuteNonQueryAsync();
            return rowsAffected > 0;
        }

        // ── MarkOrphanedFailedAsync ───────────────────────────────────────────────
        /// <summary>
        /// Used by RecoverOrphanedRunningItemsAsync: marks a row failed with the
        /// sentinel exit code -2 so it's visible in the panel with a clear "orphaned
        /// by app restart" explanation. Same as MarkCompleteAsync but always -2.
        /// </summary>
        public Task MarkOrphanedFailedAsync(int id) => MarkCompleteAsync(id, -2, null);

        // ── Sonnet+ Overflow (Git #1418) ─────────────────────────────────────────────
        /// <summary>
        /// Parks a claimed-but-never-launched row as <see cref="AccountCapPolicy.HeldStatus"/> —
        /// used when a queued item requested the secondary account but its real
        /// model/effort exceeds Sonnet High (AccountCapPolicy.ExceedsSonnetHigh).
        /// The row stays visible in the Build Queue (BuildQueuePanel's "Active" filter
        /// includes "held") but WHERE status = 'queued' means GetNextAsync can never
        /// reclaim/relaunch it — only an explicit bulk resume (<see cref="ResumeHeldOverflowAsync"/>)
        /// or a manual per-item action moves it forward again.
        /// </summary>
        public async Task MarkHeldForOverflowAsync(int id)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = @status,
                       claimed_at = NULL,
                       updated_at = NOW()
                 WHERE id = @id", conn);
            cmd.Parameters.AddWithValue("@status", AccountCapPolicy.HeldStatus);
            cmd.Parameters.AddWithValue("@id", id);
            await cmd.ExecuteNonQueryAsync();
        }

        /// <summary>All rows currently parked at <see cref="AccountCapPolicy.HeldStatus"/> — the
        /// real contents of the Sonnet+ Overflow milestone, used to drive the Build Queue
        /// panel's bulk-resume banner/count.</summary>
        public async Task<List<QueueItem>> GetHeldOverflowAsync()
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                SELECT id, title, prompt, model, effort, cwd,
                       github_number, blocked_by_number, blocked_by_numbers,
                       status, exit_code, session_id, resume_session_id,
                       originating_chat_id, chat_url, updated_at, build_set, cli, account
                FROM bt_build_queue
                WHERE status = @status
                ORDER BY created_at ASC", conn);
            cmd.Parameters.AddWithValue("@status", AccountCapPolicy.HeldStatus);
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
        /// The bulk-resume action Shane asked for: "a single action that switches them
        /// back to the primary account and pushes them all into the live queue at
        /// once... so I can kick them off quick" the moment his primary account resets.
        /// Flips every held row back to account = NULL (primary) and status = 'queued'
        /// in one statement, so the very next tick's GetNextAsync picks them all up
        /// normally. Returns the resumed rows (their github_number, if any, is what the
        /// caller uses to clear the Sonnet+ Overflow milestone back off the real issue).
        /// </summary>
        public async Task<List<QueueItem>> ResumeHeldOverflowAsync()
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(@"
                UPDATE bt_build_queue
                   SET status     = 'queued',
                       account    = NULL,
                       updated_at = NOW()
                 WHERE status = @status
                RETURNING id, title, prompt, model, effort, cwd,
                          github_number, blocked_by_number, blocked_by_numbers,
                          status, exit_code, session_id, resume_session_id,
                          originating_chat_id, chat_url, updated_at, build_set, cli, account", conn);
            cmd.Parameters.AddWithValue("@status", AccountCapPolicy.HeldStatus);
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
                       updated_at        = NOW()
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
                       originating_chat_id, chat_url, updated_at, build_set, cli, account
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
                          originating_chat_id, chat_url, updated_at, build_set, cli, account", conn);
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
        /// limit-paused, but only when that row is sitting failed/canceled/held (a
        /// cap-killed or manually-stopped attempt). A row already queued, running or
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
                   AND status IN ('failed', 'canceled', 'held')", conn);
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

        // ── Helpers ───────────────────────────────────────────────────────────────

        private async Task<NpgsqlConnection> OpenAsync()
        {
            var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();
            return conn;
        }

        /// <summary>
        /// Returns true if every number in <paramref name="blockerNums"/> is cleared:
        /// most-recent bt_build_queue row for that githubNumber has status='done'
        /// AND exit_code=0.  No GitHub calls — matches the server's 2026-08-14 stance.
        /// </summary>
        private static async Task<bool> AreBlockersClearedAsync(NpgsqlConnection conn, List<int> blockerNums)
        {
            foreach (var num in blockerNums)
            {
                if (!await IsBlockerClearedAsync(conn, num)) return false;
            }
            return true;
        }

        private static async Task<bool> IsBlockerClearedAsync(NpgsqlConnection conn, int blockerNum)
        {
            // Most-recent row for this githubNumber — "is its current attempt done?"
            await using var cmd = new NpgsqlCommand(@"
                SELECT status, exit_code
                FROM bt_build_queue
                WHERE github_number = @num
                ORDER BY created_at DESC
                LIMIT 1", conn);
            cmd.Parameters.AddWithValue("@num", blockerNum);
            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync()) return false; // no local row = keep waiting
            var status   = reader.IsDBNull(0) ? "" : reader.GetString(0);
            var exitCode = reader.IsDBNull(1) ? (int?)null : reader.GetInt32(1);
            return status == "done" && exitCode == 0;
        }

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
            // originating_chat_id, chat_url, updated_at, build_set, cli, account
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
            };
        }

        private static async Task PopulateAssociatedIssueNumbersAsync(List<QueueItem> items, NpgsqlConnection conn)
        {
            if (items == null || items.Count == 0) return;

            // Pre-seed with item's own GithubNumber
            foreach (var item in items)
            {
                if (item.GithubNumber.HasValue)
                {
                    if (!item.AssociatedIssueNumbers.Contains(item.GithubNumber.Value))
                        item.AssociatedIssueNumbers.Add(item.GithubNumber.Value);
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
                       c.archived, c.archived_at
                FROM bt_chats c
                LEFT JOIN bt_issues i ON c.issue_id = i.id
                LEFT JOIN bt_epics e ON c.epic_id = e.id
                ORDER BY c.updated_at DESC";
            
            var chatsTemp = new List<BoardChat>();
            var chatIdToChat = new Dictionary<int, BoardChat>();

            await using var cmdChats = new NpgsqlCommand(sqlChats, conn);
            await using (var reader = await cmdChats.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    var id = reader.GetInt32(0);
                    var convId = reader.IsDBNull(1) ? "" : reader.GetString(1);
                    var chat = new BoardChat
                    {
                        ConversationId = convId,
                        Title = reader.IsDBNull(2) ? "" : reader.GetString(2),
                        EpicId = reader.IsDBNull(3) ? null : reader.GetInt32(3),
                        UpdatedAt = reader.IsDBNull(4) ? null : (DateTime?)reader.GetDateTime(4),
                        ClaudeUrl = $"https://claude.ai/chat/{convId}",
                        Archived = !reader.IsDBNull(7) && reader.GetBoolean(7),
                        ArchivedAt = reader.IsDBNull(8) ? null : (DateTime?)reader.GetDateTime(8),
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
        /// </summary>
        public async Task LinkChatToIssueAsync(string conversationId, int issueNumber, string? title = null)
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
                const string insertChatSql = @"
                    INSERT INTO bt_chats (conversation_id, title)
                    VALUES (@convId, @title)
                    RETURNING id";
                
                await using (var cmd = new NpgsqlCommand(insertChatSql, conn))
                {
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
            const string findEpicSql = "SELECT id FROM bt_epics WHERE github_number = @issueNumber LIMIT 1";
            int? epicId = null;
            await using (var cmd = new NpgsqlCommand(findEpicSql, conn))
            {
                cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                var val = await cmd.ExecuteScalarAsync();
                if (val != null && val != DBNull.Value)
                {
                    epicId = Convert.ToInt32(val);
                }
            }

            if (epicId.HasValue)
            {
                const string updateChatEpicSql = @"
                    UPDATE bt_chats
                    SET epic_id = @epicId, issue_id = NULL, updated_at = NOW()
                    WHERE id = @chatId";
                await using (var cmd = new NpgsqlCommand(updateChatEpicSql, conn))
                {
                    cmd.Parameters.AddWithValue("@epicId", epicId.Value);
                    cmd.Parameters.AddWithValue("@chatId", chatId.Value);
                    await cmd.ExecuteNonQueryAsync();
                }
            }
            else
            {
                const string findIssueSql = "SELECT id, epic_id FROM bt_issues WHERE github_number = @issueNumber LIMIT 1";
                int? issueId = null;
                int? issueEpicId = null;
                await using (var cmd = new NpgsqlCommand(findIssueSql, conn))
                {
                    cmd.Parameters.AddWithValue("@issueNumber", issueNumber);
                    await using (var reader = await cmd.ExecuteReaderAsync())
                    {
                        if (await reader.ReadAsync())
                        {
                            issueId = reader.GetInt32(0);
                            issueEpicId = reader.IsDBNull(1) ? null : (int?)reader.GetInt32(1);
                        }
                    }
                }

                if (issueId.HasValue)
                {
                    const string updateChatIssueSql = @"
                        UPDATE bt_chats
                        SET issue_id = @issueId, epic_id = @epicId, updated_at = NOW()
                        WHERE id = @chatId";
                    await using (var cmd = new NpgsqlCommand(updateChatIssueSql, conn))
                    {
                        cmd.Parameters.AddWithValue("@issueId", issueId.Value);
                        cmd.Parameters.Add(new NpgsqlParameter("@epicId", NpgsqlTypes.NpgsqlDbType.Integer)
                        { Value = issueEpicId.HasValue ? (object)issueEpicId.Value : DBNull.Value });
                        cmd.Parameters.AddWithValue("@chatId", chatId.Value);
                        await cmd.ExecuteNonQueryAsync();
                    }
                }
            }
        }

        // ── UnlinkChatFromIssueAsync ──────────────────────────────────────────────
        /// <summary>
        /// Unlinks a chat from a GitHub issue directly in the Postgres database,
        /// bypassing the API server. This matches the behavior of POST /chats/unassign-issue.
        /// </summary>
        public async Task UnlinkChatFromIssueAsync(string conversationId, int issueNumber)
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
                    int nextIssueNum = remainingIssueNumber.Value;
                    const string findEpicSql = "SELECT id FROM bt_epics WHERE github_number = @issueNumber LIMIT 1";
                    int? epicId = null;
                    await using (var cmd = new NpgsqlCommand(findEpicSql, conn))
                    {
                        cmd.Parameters.AddWithValue("@issueNumber", nextIssueNum);
                        var val = await cmd.ExecuteScalarAsync();
                        if (val != null && val != DBNull.Value)
                        {
                            epicId = Convert.ToInt32(val);
                        }
                    }

                    if (epicId.HasValue)
                    {
                        const string updateChatEpicSql = @"
                            UPDATE bt_chats
                            SET epic_id = @epicId, issue_id = NULL, updated_at = NOW()
                            WHERE id = @chatId";
                        await using (var cmd = new NpgsqlCommand(updateChatEpicSql, conn))
                        {
                            cmd.Parameters.AddWithValue("@epicId", epicId.Value);
                            cmd.Parameters.AddWithValue("@chatId", chatId.Value);
                            await cmd.ExecuteNonQueryAsync();
                        }
                    }
                    else
                    {
                        const string findIssueSql = "SELECT id, epic_id FROM bt_issues WHERE github_number = @issueNumber LIMIT 1";
                        int? issueId = null;
                        int? issueEpicId = null;
                        await using (var cmd = new NpgsqlCommand(findIssueSql, conn))
                        {
                            cmd.Parameters.AddWithValue("@issueNumber", nextIssueNum);
                            await using (var reader = await cmd.ExecuteReaderAsync())
                            {
                                if (await reader.ReadAsync())
                                {
                                    issueId = reader.GetInt32(0);
                                    issueEpicId = reader.IsDBNull(1) ? null : (int?)reader.GetInt32(1);
                                }
                            }
                        }

                        if (issueId.HasValue)
                        {
                            const string updateChatIssueSql = @"
                                UPDATE bt_chats
                                SET issue_id = @issueId, epic_id = @epicId, updated_at = NOW()
                                WHERE id = @chatId";
                            await using (var cmd = new NpgsqlCommand(updateChatIssueSql, conn))
                            {
                                cmd.Parameters.AddWithValue("@issueId", issueId.Value);
                                cmd.Parameters.Add(new NpgsqlParameter("@epicId", NpgsqlTypes.NpgsqlDbType.Integer)
                                { Value = issueEpicId.HasValue ? (object)issueEpicId.Value : DBNull.Value });
                                cmd.Parameters.AddWithValue("@chatId", chatId.Value);
                                await cmd.ExecuteNonQueryAsync();
                            }
                        }
                    }
                }
            }
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

        /// <summary>
        /// Creates a client from the DATABASE_URL found in:
        ///   1. The config's own databaseUrl field (if non-empty), OR
        ///   2. The DATABASE_URL= line in &lt;repoRoot&gt;/.env.local
        /// Returns null (and logs via <paramref name="onMissing"/>) if neither is found.
        /// </summary>
        public static BuildQueuePostgresClient? TryCreate(
            BuildTrackerConfig config,
            string repoRoot,
            Action<string> onMissing)
        {
            // 1. Explicit override in the config JSON
            if (!string.IsNullOrWhiteSpace(config.DatabaseUrl))
                return new BuildQueuePostgresClient(config.DatabaseUrl);

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
