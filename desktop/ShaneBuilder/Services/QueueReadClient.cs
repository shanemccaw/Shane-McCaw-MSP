using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Npgsql;

namespace ShaneBuilder.Services;

/// <summary>Git #2201 — one recent <c>bt_build_queue</c> row, the real shape the Alerts/Critters
/// build-runner watcher polls (AlertWatchers.cs). Field names/values match the table verbatim
/// (confirmed via `\d bt_build_queue` against the local Postgres instance).</summary>
public sealed record BuildQueueRow(
    int Id, string Title, string? Status, int? GithubNumber, int? BlockedByNumber,
    int? ExitCode, DateTimeOffset? CompletedAt, DateTimeOffset UpdatedAt);

/// <summary>Git #2203 — one real <c>bt_build_queue</c> row for the Command Center's
/// "Builds"/"Build IDs" category. A separate shape from <see cref="BuildQueueRow"/> above
/// (Git #2201's Alerts/Critters watcher row) — same table, different real field set, landed
/// concurrently; renamed on merge to avoid colliding on the same type name.</summary>
public sealed class PaletteBuildQueueRow
{
    public int Id { get; init; }
    public string Title { get; init; } = "";
    public int? GithubNumber { get; init; }
    public string Status { get; init; } = "";
    public string? BuildSet { get; init; }
    public string? Model { get; init; }
    public string? Effort { get; init; }
    public string? SessionId { get; init; }
    public int? BlockedByNumber { get; init; }
    public DateTimeOffset UpdatedAt { get; init; }

    /// <summary>Git #2410 — the real GitHub Project "Status" for this row's <see cref="GithubNumber"/>,
    /// as of the last reconciliation pass. Null means "not fetched yet" or "GitHub lookup failed" —
    /// never confused with a confirmed board value, so a network hiccup can't wrongly flag a row
    /// stale. Set (not init) so <c>QueueStatusReconciler</c> can fill it in after the row is
    /// already constructed from the real bt_build_queue read.</summary>
    public string? BoardStatus { get; set; }

    /// <summary>Git #2410 — true when this row's local <see cref="Status"/> is one BuildConsole
    /// considers active (queued/running/parked/verifying/limit-paused/external — see
    /// <see cref="QueueReadClient.IsLocalActiveStatus"/>) but the real GitHub board Status,
    /// confirmed via <see cref="BoardStatus"/>, is NOT a launch-eligible status (e.g. it was moved
    /// back to Backlog). A stale row is real drift — the local queue's own cached status has not
    /// caught up with GitHub — and callers should stop rendering it as active.</summary>
    public bool IsStale { get; set; }
}

/// <summary>
/// Git #2176 — ShaneBuilder's real, read-only client for BuildConsole's shared
/// <c>bt_build_queue</c> table, over the same local Postgres <see cref="ChatReadClient"/>
/// already resolves. Read-only by contract, same as <see cref="ChatReadClient"/> — every
/// write to <c>bt_build_queue</c> stays owned by BuildConsole's own
/// <c>BuildQueuePostgresClient</c>.
/// </summary>
public sealed class QueueReadClient
{
    private readonly string _connectionString;

    public QueueReadClient(string connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new ArgumentException("connectionString must not be empty", nameof(connectionString));
        _connectionString = connectionString;
    }

    /// <summary>Null means no real DATABASE_URL was resolvable — callers report that honestly
    /// rather than faking a count.</summary>
    public static QueueReadClient? CreateFromEnvironment()
    {
        var conn = ChatReadClient.ResolveConnectionStringForSqlRunner();
        return string.IsNullOrWhiteSpace(conn) ? null : new QueueReadClient(conn!);
    }

    /// <summary>Real total row count of <c>bt_build_queue</c> — unfiltered, same table/rows
    /// BuildConsole's own <c>BuildQueuePostgresClient.GetQueueAsync</c> reads.</summary>
    public async Task<int> GetQueueRowCountAsync()
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT count(*) FROM bt_build_queue", conn);
        var result = await cmd.ExecuteScalarAsync();
        return result switch
        {
            long l => (int)l,
            int i => i,
            _ => Convert.ToInt32(result)
        };
    }

    /// <summary>Git #2201 — the most recently updated <paramref name="limit"/> rows, for the Alerts/
    /// Critters build-runner watcher to diff against its own last-seen snapshot (a row that transitions
    /// to "failed" -> a BuildFailed alert; one that transitions to "done" -> a tier-1 celebration).</summary>
    public async Task<List<BuildQueueRow>> GetRecentAsync(int limit = 25)
    {
        var result = new List<BuildQueueRow>();
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync();
        const string sql = @"
            SELECT id, title, status, github_number, blocked_by_number, exit_code, completed_at, updated_at
            FROM bt_build_queue
            ORDER BY updated_at DESC
            LIMIT @limit";
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@limit", limit);
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(new BuildQueueRow(
                reader.GetInt32(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetInt32(3),
                reader.IsDBNull(4) ? null : reader.GetInt32(4),
                reader.IsDBNull(5) ? null : reader.GetInt32(5),
                reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6),
                reader.GetFieldValue<DateTimeOffset>(7)));
        }
        return result;
    }

    /// <summary>Git #2203 — real, recent <c>bt_build_queue</c> rows for the Command Center's
    /// Builds/Build IDs category. Fails closed (empty list, logged) on a connection or query
    /// error, same convention as this file's sibling read services (GitMapService,
    /// GitIssuesService, DevServicesReadClient), so a Postgres hiccup degrades the palette
    /// gracefully instead of throwing out of an unguarded call site.</summary>
    public async Task<List<PaletteBuildQueueRow>> GetRecentBuildsAsync(int limit = 40)
    {
        var result = new List<PaletteBuildQueueRow>();
        try
        {
            await using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand(
                @"SELECT id, title, github_number, status, build_set, model, effort, session_id,
                         blocked_by_number, updated_at
                  FROM bt_build_queue
                  ORDER BY updated_at DESC
                  LIMIT @limit", conn);
            cmd.Parameters.AddWithValue("limit", limit);

            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                result.Add(new PaletteBuildQueueRow
                {
                    Id = reader.GetInt32(0),
                    Title = reader.GetString(1),
                    GithubNumber = reader.IsDBNull(2) ? null : reader.GetInt32(2),
                    Status = reader.GetString(3),
                    BuildSet = reader.IsDBNull(4) ? null : reader.GetString(4),
                    Model = reader.IsDBNull(5) ? null : reader.GetString(5),
                    Effort = reader.IsDBNull(6) ? null : reader.GetString(6),
                    SessionId = reader.IsDBNull(7) ? null : reader.GetString(7),
                    BlockedByNumber = reader.IsDBNull(8) ? null : reader.GetInt32(8),
                    UpdatedAt = reader.GetFieldValue<DateTimeOffset>(9)
                });
            }
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[queue] GetRecentBuildsAsync failed: {ex.Message}");
        }
        return result;
    }

    /// <summary>Git #2309 — the latest real <c>bt_build_queue</c> row per GitHub issue number, for
    /// the Git Panel Feature detail's six real build-state chips and "last build" line. One row
    /// per number (its own most recently updated) — a number with no queue history simply isn't
    /// in the result, never backfilled with a fabricated status. Fails closed to an empty list on
    /// a connection/query error, same convention as <see cref="GetRecentBuildsAsync"/>.</summary>
    public async Task<List<PaletteBuildQueueRow>> GetLatestByGithubNumbersAsync(IEnumerable<int> githubNumbers)
    {
        var numbers = (githubNumbers ?? Array.Empty<int>()).Distinct().ToArray();
        var result = new List<PaletteBuildQueueRow>();
        if (numbers.Length == 0) return result;
        try
        {
            await using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand(
                @"SELECT DISTINCT ON (github_number) id, title, github_number, status, build_set, model, effort,
                         session_id, blocked_by_number, updated_at
                  FROM bt_build_queue
                  WHERE github_number = ANY(@nums)
                  ORDER BY github_number, updated_at DESC", conn);
            cmd.Parameters.AddWithValue("nums", numbers);

            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                result.Add(new PaletteBuildQueueRow
                {
                    Id = reader.GetInt32(0),
                    Title = reader.GetString(1),
                    GithubNumber = reader.IsDBNull(2) ? null : reader.GetInt32(2),
                    Status = reader.GetString(3),
                    BuildSet = reader.IsDBNull(4) ? null : reader.GetString(4),
                    Model = reader.IsDBNull(5) ? null : reader.GetString(5),
                    Effort = reader.IsDBNull(6) ? null : reader.GetString(6),
                    SessionId = reader.IsDBNull(7) ? null : reader.GetString(7),
                    BlockedByNumber = reader.IsDBNull(8) ? null : reader.GetInt32(8),
                    UpdatedAt = reader.GetFieldValue<DateTimeOffset>(9)
                });
            }
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[queue] GetLatestByGithubNumbersAsync failed: {ex.Message}");
        }
        return result;
    }

    /// <summary>Git #2410 — the same local-status vocabulary BuildConsole's own
    /// <c>BuildQueuePostgresClient.IsActiveStatus</c> treats as "still going/about to go"
    /// (queued/parked/running/verifying/limit-paused/external). A row in one of these statuses is
    /// exactly the class the real incident (#1734) hit: locally still "active" while GitHub had
    /// already moved it back to Backlog.</summary>
    public static bool IsLocalActiveStatus(string? status) => status is
        "queued" or "parked" or "running" or "verifying" or "limit-paused" or "external";

    /// <summary>Git #2410 — the real GitHub Project Status values that justify a locally-active row
    /// staying active. Anything else confirmed via <see cref="ChatGitHubFilter.GetBoardStatusesAsync"/>
    /// (Backlog, Park, Done, Crashed, or any other real column) means the board has moved on and the
    /// local cache is stale.</summary>
    public static bool IsLaunchEligibleBoardStatus(string? boardStatus) => boardStatus is
        "Batter Up" or "AI Batter Up" or "In Progress" or "Verifying";
}

/// <summary>Git #2410 — reconciles a set of real <see cref="PaletteBuildQueueRow"/>s (already read
/// from <c>bt_build_queue</c>) against the real GitHub Project board Status, so a row whose local
/// status thinks it's still active but whose board Status has since moved back to Backlog (or any
/// other non-launch column) is flagged <see cref="PaletteBuildQueueRow.IsStale"/> before it's
/// rendered. Fails open on any GitHub lookup failure — an unreachable board never causes a row to
/// be wrongly marked stale, mirroring every other fail-closed/open convention already used across
/// this file's sibling read services.</summary>
public static class QueueStatusReconciler
{
    public static async Task ReconcileAsync(IReadOnlyList<PaletteBuildQueueRow> rows, ChatGitHubFilter github)
    {
        var activeNumbers = rows
            .Where(r => QueueReadClient.IsLocalActiveStatus(r.Status) && r.GithubNumber.HasValue)
            .Select(r => r.GithubNumber!.Value)
            .Distinct()
            .ToList();
        if (activeNumbers.Count == 0) return;

        Dictionary<int, string?> boardStatuses;
        try
        {
            boardStatuses = await github.GetBoardStatusesAsync(activeNumbers);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[queue] status reconciliation failed: {ex.Message}");
            return;
        }

        foreach (var row in rows)
        {
            if (!row.GithubNumber.HasValue || !QueueReadClient.IsLocalActiveStatus(row.Status)) continue;
            if (!boardStatuses.TryGetValue(row.GithubNumber.Value, out var boardStatus) || boardStatus == null)
                continue; // unknown/unreachable — leave the row exactly as the local cache had it

            row.BoardStatus = boardStatus;
            row.IsStale = !QueueReadClient.IsLaunchEligibleBoardStatus(boardStatus);
        }
    }
}
