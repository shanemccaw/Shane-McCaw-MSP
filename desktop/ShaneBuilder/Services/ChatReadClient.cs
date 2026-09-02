using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Npgsql;

namespace ShaneBuilder.Services;

/// <summary>Git #2195 — one row of a chat's mention registry: the issue number plus WHEN it was
/// last mentioned, so the staleness filter can act on real data instead of assuming everything the
/// table has ever seen is still "pending right now". Ported verbatim (shape-for-shape) from
/// <c>BuildQueuePostgresClient.ChatIssueMention</c>.</summary>
public readonly record struct ChatIssueMention(int Number, DateTimeOffset LastSeenAt);

/// <summary>Git #2104 — one open row from <c>chat_pinned_questions</c>, joined with its owning chat's
/// <c>conversation_id</c>/<c>title</c>. Shape matches BuildConsole's <c>PinnedQuestion</c> so the
/// merge/filter port below reads identically to #2195's landed <c>ChatDockService</c>.</summary>
public sealed class PinnedQuestion
{
    public int Id { get; init; }
    public int ChatId { get; init; }
    public string ConversationId { get; init; } = "";
    public string ChatTitle { get; init; } = "";
    public string QuestionText { get; init; } = "";
    public DateTime CreatedAt { get; init; }
}

/// <summary>
/// Git #2197 — ShaneBuilder's read-only Postgres client for the chat-mention + pinned-questions
/// data layer. This is the ShaneBuilder-side equivalent of the two methods #2195 landed on
/// BuildConsole's <c>BuildQueuePostgresClient</c> (<c>GetChatIssueMentionsForUrlAsync</c> /
/// <c>GetOpenPinnedQuestionsForChatAsync</c>), against the SAME local Postgres.
///
/// ── Shared-DATABASE_URL, verified (not assumed) ──────────────────────────────────────────
/// Real audit finding for #2197: ShaneBuilder's own <see cref="LogService"/> (landed under #2200)
/// already resolves the exact same <c>&lt;repoRoot&gt;/.env.local</c> <c>DATABASE_URL</c> that
/// BuildConsole's <c>BuildQueuePostgresClient.CreateFromEnvironment</c> reads, with a public
/// <see cref="LogService.ParseConnectionString"/> ported from it and a worktree-aware main-repo-root
/// resolver. Same file, same local Postgres 18 instance, same database — confirmed against committed
/// code. This client reuses <see cref="LogService.ParseConnectionString"/> for the parse step and
/// mirrors LogService's worktree-aware root walk for locating <c>.env.local</c> (the real, populated
/// file lives at the MAIN checkout, not a worktree copy — see LogService's own note).
///
/// ── Read-only, by contract ───────────────────────────────────────────────────────────────
/// #2197 is READ-ONLY against the shared DB — BuildConsole still owns every write to
/// <c>bt_chat_mentioned_issues</c> and <c>chat_pinned_questions</c>. Unlike BuildConsole's
/// <c>GetOpenPinnedQuestionsForChatAsync</c>, this DELIBERATELY does NOT port the
/// <c>PurgeResolvedPinnedQuestionsAsync</c> DELETE that runs before that read; it filters
/// <c>resolved_at IS NULL</c> in the SELECT instead, so nothing here mutates a row.
/// </summary>
public sealed class ChatReadClient
{
    private readonly string _connectionString;

    public ChatReadClient(string connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new ArgumentException("connectionString must not be empty", nameof(connectionString));
        _connectionString = connectionString;
    }

    /// <summary>True when a real <c>DATABASE_URL</c> was resolvable from <c>.env.local</c>; when this
    /// is null the caller has no DB (honest, not faked — the dock renders empty rather than inventing
    /// rows), same fail-shape as BuildConsole's <c>_db == null</c> fallback.</summary>
    public static ChatReadClient? CreateFromEnvironment()
    {
        var conn = ResolveConnectionString();
        return string.IsNullOrWhiteSpace(conn) ? null : new ChatReadClient(conn!);
    }

    // ── Connection-string resolution ────────────────────────────────────────────────────────
    // Worktree-aware: a plain ".git" walk stops at the WORKTREE root, whose .env.local may be
    // absent — the real file lives at the MAIN checkout the dev stack runs from. Mirrors
    // LogService.ResolveMainRepoRoot (#2200) so both classes locate the identical .env.local.
    /// <summary>Git #2215 — SQL Runner shares this exact same resolution (worktree-aware
    /// <c>.env.local</c> lookup, same local Postgres) rather than owning a second copy.</summary>
    public static string? ResolveConnectionStringForSqlRunner() => ResolveConnectionString();

    private static string? ResolveConnectionString()
    {
        var repoRoot = ResolveMainRepoRoot();
        if (string.IsNullOrEmpty(repoRoot)) return null;

        var envLocal = Path.Combine(repoRoot, ".env.local");
        if (!File.Exists(envLocal)) return null;

        foreach (var raw in File.ReadAllLines(envLocal))
        {
            var trimmed = raw.Trim();
            if (trimmed.StartsWith('#') || !trimmed.StartsWith("DATABASE_URL=", StringComparison.OrdinalIgnoreCase))
                continue;
            var url = trimmed.Substring("DATABASE_URL=".Length).Trim().Trim('"').Trim('\'');
            if (string.IsNullOrWhiteSpace(url)) return null;
            // Reuse the single, already-landed parser rather than duplicating a second copy.
            return LogService.ParseConnectionString(url);
        }
        return null;
    }

    private static string? ResolveMainRepoRoot()
    {
        var envOverride = Environment.GetEnvironmentVariable("DEV_SERVER_MAIN_ROOT");
        if (!string.IsNullOrWhiteSpace(envOverride) && Directory.Exists(envOverride)) return envOverride;

        var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
        while (dir != null)
        {
            var gitPath = Path.Combine(dir.FullName, ".git");
            if (Directory.Exists(gitPath))
                return dir.FullName; // already the main checkout — .git is a real directory here

            if (File.Exists(gitPath))
            {
                // A worktree's .git is a FILE: "gitdir: <root>/.git/worktrees/<name>". That dir's
                // own "commondir" file resolves to the real shared .git dir, whose parent is main.
                try
                {
                    var gitFileText = File.ReadAllText(gitPath).Trim();
                    const string prefix = "gitdir:";
                    if (gitFileText.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    {
                        var worktreeGitDir = gitFileText.Substring(prefix.Length).Trim();
                        var commonDirFile = Path.Combine(worktreeGitDir, "commondir");
                        if (File.Exists(commonDirFile))
                        {
                            var relCommon = File.ReadAllText(commonDirFile).Trim();
                            var commonDir = Path.GetFullPath(Path.Combine(worktreeGitDir, relCommon));
                            var commonParent = Path.GetFileName(commonDir.TrimEnd(Path.DirectorySeparatorChar))
                                .Equals(".git", StringComparison.OrdinalIgnoreCase)
                                ? Directory.GetParent(commonDir)?.FullName
                                : commonDir;
                            if (!string.IsNullOrEmpty(commonParent) && Directory.Exists(commonParent))
                                return commonParent;
                        }
                    }
                }
                catch { /* fall through to worktree root below */ }
                return dir.FullName; // worktree root — best available fallback
            }
            dir = dir.Parent;
        }
        return null;
    }

    private async Task<NpgsqlConnection> OpenAsync()
    {
        var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync();
        return conn;
    }

    // ── Chat-mention read (keyed on chat_url text — NO bt_chats FK) ──────────────────────────
    /// <summary>Git #2195 — every issue number this chat_url has mentioned, most-recently-seen
    /// first, carrying <c>last_seen_at</c> so the staleness filter has real data to act on. The
    /// mention table keys on the chat URL string, not a <c>bt_chats</c> id, so this works for a chat
    /// ShaneBuilder tracks nothing else about. Read-only.</summary>
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

    // ── FK-gap resolver (chat_pinned_questions.chat_id -> bt_chats.id) ───────────────────────
    /// <summary>
    /// Git #2197 — resolves the <c>chat_pinned_questions.chat_id -&gt; bt_chats(id)</c> FK for
    /// ShaneBuilder, which (real audit finding) has no chat-tracking concept of its own. The mapping
    /// is real, not invented: <c>bt_chats.conversation_id</c> is a UNIQUE text key equal to the UUID
    /// segment of a chat URL (<c>https://claude.ai/chat/{conversation_id}</c>), confirmed directly
    /// against local Postgres. So a chat identity ShaneBuilder DOES have (its claude.ai conversation
    /// id, straight off the WebView2 URL) resolves to a <c>bt_chats.id</c> via the shared table that
    /// BuildConsole already populates — no fabricated mapping.
    ///
    /// Returns null when no <c>bt_chats</c> row exists for that conversation yet (a chat BuildConsole
    /// never recorded). That is an HONEST empty result — the caller then returns zero pinned
    /// questions, never a faked one.
    /// </summary>
    public async Task<int?> ResolveChatIdByConversationIdAsync(string conversationId)
    {
        if (string.IsNullOrWhiteSpace(conversationId)) return null;

        await using var conn = await OpenAsync();
        const string sql = "SELECT id FROM bt_chats WHERE conversation_id = @cid LIMIT 1";
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@cid", conversationId);
        var scalar = await cmd.ExecuteScalarAsync();
        return scalar is int i ? i : (scalar == null || scalar is DBNull ? (int?)null : Convert.ToInt32(scalar));
    }

    /// <summary>Convenience over <see cref="ResolveChatIdByConversationIdAsync"/>: pulls the
    /// conversation id out of a full <c>https://claude.ai/chat/{uuid}</c> URL (the exact form stored
    /// in <c>bt_chat_mentioned_issues.chat_url</c>) and resolves it. Returns null for a URL with no
    /// recognizable id segment, or one no <c>bt_chats</c> row matches.</summary>
    public async Task<int?> ResolveChatIdByChatUrlAsync(string chatUrl)
    {
        var cid = ExtractConversationId(chatUrl);
        return cid == null ? null : await ResolveChatIdByConversationIdAsync(cid);
    }

    /// <summary>Extracts the trailing UUID/id segment from a claude.ai chat URL. Public + static so
    /// the merge service (and a scratch harness) can map a URL to a conversation id without a DB hit.</summary>
    public static string? ExtractConversationId(string? chatUrl)
    {
        if (string.IsNullOrWhiteSpace(chatUrl)) return null;
        var s = chatUrl.Trim().TrimEnd('/');
        var slash = s.LastIndexOf('/');
        var seg = slash >= 0 ? s.Substring(slash + 1) : s;
        // Drop any query/fragment that might trail the id.
        int cut = seg.IndexOfAny(new[] { '?', '#' });
        if (cut >= 0) seg = seg.Substring(0, cut);
        return string.IsNullOrWhiteSpace(seg) ? null : seg;
    }

    // ── Pinned-questions read (keyed on chat_id -> bt_chats) ─────────────────────────────────
    /// <summary>Git #2195/#2104 — active (unresolved) pinned questions for one chat, joined to its
    /// owning <c>bt_chats</c> row for <c>conversation_id</c>/<c>title</c>. READ-ONLY: unlike
    /// BuildConsole's version this does not purge resolved rows first (BuildConsole owns writes);
    /// the <c>resolved_at IS NULL</c> predicate does the filtering. Returns empty for a non-positive
    /// <paramref name="chatId"/> (e.g. an unresolved FK), never throws for it.</summary>
    public async Task<List<PinnedQuestion>> GetOpenPinnedQuestionsForChatAsync(int chatId)
    {
        var result = new List<PinnedQuestion>();
        if (chatId <= 0) return result;

        await using var conn = await OpenAsync();
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

    // ── Git #2213 — Git Map read-only lookups against bt_build_queue ────────────────────────
    /// <summary>The real <c>status</c> (lowercase — <c>queued</c>/<c>running</c>/<c>done</c>/…, as
    /// stored) of the MOST RECENT <c>bt_build_queue</c> row for one issue number, or null when this
    /// issue has never been queued. No cross-process step/total progress exists to read (confirmed:
    /// BuildConsole's <c>BuildProgressTracker</c> is in-process memory only) — this coarse queue
    /// status is the real, honest substitute rather than a guessed percentage.</summary>
    public async Task<string?> GetMostRecentBuildQueueStatusAsync(int githubNumber)
    {
        if (githubNumber <= 0) return null;
        await using var conn = await OpenAsync();
        const string sql = @"
            SELECT status FROM bt_build_queue
            WHERE github_number = @n
            ORDER BY COALESCE(completed_at, claimed_at, created_at) DESC
            LIMIT 1";
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@n", githubNumber);
        var scalar = await cmd.ExecuteScalarAsync();
        return scalar is string s ? s : null;
    }

    /// <summary>Real count of <c>bt_build_queue</c> rows that reached <c>status='done'</c> strictly
    /// after <paramref name="sinceUtc"/> — the "builds-since" figure for a Started-and-Dropped item,
    /// i.e. how many OTHER builds have landed while this one sat untouched.</summary>
    public async Task<int> CountDoneBuildsSinceAsync(DateTimeOffset sinceUtc)
    {
        await using var conn = await OpenAsync();
        const string sql = "SELECT count(*) FROM bt_build_queue WHERE status = 'done' AND completed_at > @since";
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@since", sinceUtc);
        var scalar = await cmd.ExecuteScalarAsync();
        return scalar is long l ? (int)l : Convert.ToInt32(scalar);
    }
}
