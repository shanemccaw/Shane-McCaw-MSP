using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Npgsql;

namespace ShaneBuilder.Services;

/// <summary>Git #2203 — one real <c>bt_build_queue</c> row for the Command Center's
/// "Builds"/"Build IDs" category.</summary>
public sealed class BuildQueueRow
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

    /// <summary>Real, recent <c>bt_build_queue</c> rows, most recently updated first — the same
    /// table BuildConsole's own Build Queue panel and Board read, over this same real
    /// connection. No status filter: a "done" or "failed" row is exactly as real as a "running"
    /// one for the palette's Builds/Build IDs category.</summary>
    /// <summary>Real, recent rows — fails closed (empty list, logged) on a connection or query
    /// error, same convention as this file's sibling read services (GitMapService,
    /// GitIssuesService, DevServicesReadClient), so a Postgres hiccup degrades the palette's
    /// Builds/Build IDs category gracefully instead of throwing out of an unguarded call site.</summary>
    public async Task<List<BuildQueueRow>> GetRecentBuildsAsync(int limit = 40)
    {
        var result = new List<BuildQueueRow>();
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
                result.Add(new BuildQueueRow
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
}
