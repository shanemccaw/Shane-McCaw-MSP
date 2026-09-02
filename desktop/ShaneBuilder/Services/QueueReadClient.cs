using System;
using System.Threading.Tasks;
using Npgsql;

namespace ShaneBuilder.Services;

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
}
