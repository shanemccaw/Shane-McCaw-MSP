using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Npgsql;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3854 (CC Index Phase 1c, Feature #3851) — one real, reusable unified-search
    /// service the Command Center (and anything else that wants ranked search over
    /// issues/epics/chats later) calls, instead of scattered ad-hoc in-memory matching
    /// per capability — the exact pattern #3850/#3831 each had to build individually
    /// against in-memory state.
    ///
    /// Queries the real full-text columns #3852 added (<c>bt_issue_mirror.search_vector</c>,
    /// <c>bt_chats.search_vector</c>) — both GIN-indexed, both kept current by a real
    /// Postgres trigger, no app-side recompute. #3853 landed the sync-side fill so
    /// <c>bt_issue_mirror.body</c> (and therefore its search_vector) actually carries real
    /// issue body text, not just titles/labels.
    ///
    /// ── Connection (reuses <see cref="BuildQueuePostgresClient"/>'s real resolution) ──────
    /// bt_issue_mirror and bt_chats live in BuildConsole's OWN database (BUILD_DATABASE_URL,
    /// Git #3651), not the product database. This deliberately does not open a second
    /// connection path: it resolves the same BUILD_DATABASE_URL=&lt;repoRoot&gt;/.env.local
    /// line via <see cref="BuildQueuePostgresClient.TryResolveConnectionString"/> +
    /// <see cref="BuildQueuePostgresClient.ParseConnectionString"/> — the identical static
    /// helpers <see cref="GitHubIssueMirror"/> and TestPadPersistence already route every
    /// bt_* read/write through, cached once per process the same way.
    ///
    /// ── Epic vs Issue ────────────────────────────────────────────────────────────────────
    /// bt_issue_mirror carries no separate "is epic" flag. Every other real consumer
    /// (<c>GitBoardIssue.IsEpic</c>, <c>MainWindow.GitDetailTabs.OpenGitIssueByNumberAsync</c>)
    /// defines "epic" as exactly "an issue with real sub-issues" — <c>SubIssueCount &gt; 0</c>
    /// (Git #2677/#922). This reuses that same definition via the mirror's own
    /// <c>sub_issue_count</c> column (Git #3358) rather than inventing a second heuristic.
    ///
    /// Returns an empty list (never throws) on any real failure — DB unreachable, a blank
    /// query, no BUILD_DATABASE_URL configured — logged via <see cref="ActivityLog"/> so a
    /// caller can render "no results" without needing to distinguish "genuinely nothing
    /// matched" from "the service couldn't run" at the call site. That distinction is only
    /// meaningful for diagnostics, which the log line already covers.
    /// </summary>
    public static class CommandCenterSearchService
    {
        private const string ActivityLogChannel = "command-center.search";

        public enum ResultCategory
        {
            Issue,
            Epic,
            Chat,
        }

        /// <summary>
        /// One ranked search hit. <see cref="Number"/> is the real GitHub issue/epic number
        /// for <see cref="ResultCategory.Issue"/>/<see cref="ResultCategory.Epic"/>, or the
        /// real <c>bt_chats.id</c> primary key for <see cref="ResultCategory.Chat"/> (chats
        /// have no GitHub issue number of their own — <c>bt_chats.id</c> is the real
        /// identifier a caller uses to look the chat back up, e.g. via
        /// <see cref="ChatDockService"/>).
        /// </summary>
        public sealed class SearchResult
        {
            public ResultCategory Category { get; init; }
            public int Number { get; init; }
            public string Title { get; init; } = "";
            /// <summary>Real <c>ts_headline</c> fragment showing why the row matched — not just
            /// the title. Ships with Postgres's default &lt;b&gt;/&lt;/b&gt; match markers; a UI
            /// consumer strips or renders those as it sees fit.</summary>
            public string Snippet { get; init; } = "";
            /// <summary>Real <c>ts_rank_cd</c> relevance score. Higher is more relevant; the
            /// combined result set is already ordered by this descending — exposed so a caller
            /// can group/display it without re-deriving anything.</summary>
            public float Rank { get; init; }
        }

        private static readonly object _connLock = new();
        private static string? _connString;

        private static string? ConnString()
        {
            lock (_connLock)
            {
                if (!string.IsNullOrEmpty(_connString)) return _connString;
                var raw = BuildQueuePostgresClient.TryResolveConnectionString(BuildTrackerConfig.FindRepoRoot());
                if (string.IsNullOrWhiteSpace(raw)) return null;
                _connString = BuildQueuePostgresClient.ParseConnectionString(raw!);
                return _connString;
            }
        }

        private static async Task<NpgsqlConnection?> TryOpenAsync()
        {
            var cs = ConnString();
            if (cs == null) return null;
            var conn = new NpgsqlConnection(cs);
            await conn.OpenAsync();
            return conn;
        }

        /// <summary>
        /// Real ranked, categorized full-text search over bt_issue_mirror (Issue/Epic) and
        /// bt_chats (Chat), combined and ordered by <c>ts_rank_cd</c> descending. Uses
        /// <c>websearch_to_tsquery</c> (not <c>to_tsquery</c>) so arbitrary user-typed search
        /// text — unbalanced quotes, stray operators — never throws a Postgres syntax error;
        /// it degrades to matching what it can parse instead.
        /// </summary>
        public static async Task<List<SearchResult>> SearchAsync(string query, int limit = 20)
        {
            var results = new List<SearchResult>();
            if (string.IsNullOrWhiteSpace(query)) return results;
            if (limit <= 0) limit = 20;

            try
            {
                await using var conn = await TryOpenAsync();
                if (conn == null)
                {
                    ActivityLog.Log(ActivityLogChannel, "SearchAsync: no BUILD_DATABASE_URL resolved — returning empty results.");
                    return results;
                }

                // Git #3579 — bt_issue_mirror is repo-scoped; bt_chats is not (Git #3579's own
                // column list doesn't include it), so only the mirror branch below is bound.
                const string sql = @"
                    WITH q AS (SELECT websearch_to_tsquery('english', @query) AS tsq)
                    SELECT * FROM (
                        SELECT
                            CASE WHEN m.sub_issue_count > 0 THEN 'Epic' ELSE 'Issue' END AS category,
                            m.issue_number AS number,
                            m.title AS title,
                            ts_headline('english', m.title || '. ' || coalesce(m.body, ''), q.tsq,
                                'MaxFragments=2, MaxWords=15, MinWords=4, ShortWord=3') AS snippet,
                            ts_rank_cd(m.search_vector, q.tsq) AS rank
                        FROM bt_issue_mirror m, q
                        WHERE m.repo_owner = @owner AND m.repo_name = @repo
                          AND m.search_vector @@ q.tsq

                        UNION ALL

                        SELECT
                            'Chat' AS category,
                            c.id AS number,
                            c.title AS title,
                            ts_headline('english',
                                c.title || '. ' || coalesce(c.category, '') || '. ' || coalesce(c.notes, ''), q.tsq,
                                'MaxFragments=2, MaxWords=15, MinWords=4, ShortWord=3') AS snippet,
                            ts_rank_cd(c.search_vector, q.tsq) AS rank
                        FROM bt_chats c, q
                        WHERE c.search_vector @@ q.tsq
                    ) results
                    ORDER BY rank DESC
                    LIMIT @limit;";

                await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("@query", query);
                cmd.Parameters.AddWithValue("@owner", RepoIdentity.DefaultOwner);
                cmd.Parameters.AddWithValue("@repo", RepoIdentity.DefaultName);
                cmd.Parameters.AddWithValue("@limit", limit);

                await using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    var categoryRaw = reader.IsDBNull(0) ? "Issue" : reader.GetString(0);
                    var category = categoryRaw switch
                    {
                        "Epic" => ResultCategory.Epic,
                        "Chat" => ResultCategory.Chat,
                        _ => ResultCategory.Issue,
                    };
                    results.Add(new SearchResult
                    {
                        Category = category,
                        Number = reader.IsDBNull(1) ? 0 : reader.GetInt32(1),
                        Title = reader.IsDBNull(2) ? "" : reader.GetString(2),
                        Snippet = reader.IsDBNull(3) ? "" : reader.GetString(3),
                        Rank = reader.IsDBNull(4) ? 0f : reader.GetFloat(4),
                    });
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(ActivityLogChannel, $"SearchAsync(\"{query}\") failed ({ex.Message}) — returning empty results.");
                results.Clear();
            }

            return results;
        }
    }
}
