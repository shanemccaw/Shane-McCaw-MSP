using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Npgsql;

namespace ShaneBuilder.Services;

/// <summary>Git #2201 — one recent <c>bt_build_queue</c> row, the real shape the Alerts/Critters
/// build-runner watcher polls (AlertWatchers.cs). Field names/values match the table verbatim
/// (confirmed via `\d bt_build_queue` against the local Postgres instance).</summary>
public sealed record BuildQueueRow(
    int Id, string Title, string? Status, int? GithubNumber, int? BlockedByNumber,
    int? ExitCode, DateTimeOffset? CompletedAt, DateTimeOffset UpdatedAt);

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
}
