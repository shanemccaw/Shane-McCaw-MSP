using System;
using System.Collections.Generic;
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
    /// The API server still handles:
    ///   • POST /extension/queue — ADDING a new item to the queue (from chat buttons
    ///     or the browser extension). That write path is owned by the extension and
    ///     the injected chat buttons; changing it would require touching the extension
    ///     too, and the "add item" path doesn't share the "server asleep" problem
    ///     (Shane is awake and present when he queues something).
    ///   • QueueBuildAsync / CancelQueueItemAsync / ToggleLabelAsync — all other
    ///     mutations that don't involve the watcher's own poll-and-claim loop.
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

            // Npgsql accepts the standard postgresql:// URL format directly,
            // but the Connection String Keywords format is also fine. Either works.
            _connectionString = connectionString;
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
                       originating_chat_id, chat_url, updated_at
                FROM bt_build_queue
                ORDER BY created_at ASC";

            var items = new List<QueueItem>();
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(sql, conn);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                items.Add(MapRow(reader));
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
                       originating_chat_id, chat_url, updated_at
                FROM bt_build_queue
                WHERE status = 'queued'
                ORDER BY created_at ASC";

            var candidates = new List<QueueItem>();
            await using var conn = await OpenAsync();
            await using var fetchCmd = new NpgsqlCommand(fetchSql, conn);
            await using (var reader = await fetchCmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    candidates.Add(MapRow(reader));
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
                          originating_chat_id, chat_url, updated_at";

            var claimed = new List<QueueItem>();
            await using (var reader = await claimCmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    claimed.Add(MapRow(reader));
            }
            return claimed;
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
                          originating_chat_id, chat_url, updated_at", conn);
            cmd.Parameters.AddWithValue("@id", id);
            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
                throw new InvalidOperationException($"Queue item {id} is not in 'queued' status — cannot force-claim.");
            return MapRow(reader);
        }

        // ── MarkOrphanedFailedAsync ───────────────────────────────────────────────
        /// <summary>
        /// Used by RecoverOrphanedRunningItemsAsync: marks a row failed with the
        /// sentinel exit code -2 so it's visible in the panel with a clear "orphaned
        /// by app restart" explanation. Same as MarkCompleteAsync but always -2.
        /// </summary>
        public Task MarkOrphanedFailedAsync(int id) => MarkCompleteAsync(id, -2, null);

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
            // originating_chat_id, chat_url, updated_at
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
            };
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
                       e.github_number AS epic_github_number
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
                        ClaudeUrl = $"https://claude.ai/chat/{convId}"
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
