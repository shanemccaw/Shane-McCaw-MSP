using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Npgsql;

namespace ShaneBuilder.Services;

/// <summary>One real row from <c>bt_epics</c> or <c>bt_issues</c> — just enough for the Alerts/
/// Critters board watcher (AlertWatchers.cs) to diff status transitions across polls.</summary>
public sealed record BoardRow(int Id, string Title, string Status, int? GithubNumber);

/// <summary>One real row from <c>deployed_version_stamp</c> — a real deploy landing.</summary>
public sealed record DeployRow(int Id, string CommitHash, string CommitMessage, DateTimeOffset DeployedAt);

/// <summary>
/// Git #2201 — read-only client for the board tables (<c>bt_epics</c>, <c>bt_issues</c>,
/// <c>deployed_version_stamp</c>) the Alerts/Critters watchers poll for real epic-closed/issue-closed/
/// issue-opened/deploy-succeeded celebrations. Same connection-resolution convention as
/// <see cref="QueueReadClient"/>/<see cref="ChatReadClient"/> (shared local Postgres, read-only by
/// contract — every write to these tables stays owned by BuildConsole).
/// </summary>
public sealed class BoardReadClient
{
    private readonly string _connectionString;

    public BoardReadClient(string connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new ArgumentException("connectionString must not be empty", nameof(connectionString));
        _connectionString = connectionString;
    }

    public static BoardReadClient? CreateFromEnvironment()
    {
        var conn = ChatReadClient.ResolveConnectionStringForSqlRunner();
        return string.IsNullOrWhiteSpace(conn) ? null : new BoardReadClient(conn!);
    }

    private async Task<NpgsqlConnection> OpenAsync()
    {
        var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync();
        return conn;
    }

    public async Task<List<BoardRow>> GetEpicsAsync()
    {
        var result = new List<BoardRow>();
        await using var conn = await OpenAsync();
        const string sql = "SELECT id, title, status, github_number FROM bt_epics ORDER BY updated_at DESC LIMIT 200";
        await using var cmd = new NpgsqlCommand(sql, conn);
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(new BoardRow(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetInt32(3)));
        return result;
    }

    public async Task<List<BoardRow>> GetIssuesAsync()
    {
        var result = new List<BoardRow>();
        await using var conn = await OpenAsync();
        const string sql = "SELECT id, title, status, github_number FROM bt_issues ORDER BY updated_at DESC LIMIT 300";
        await using var cmd = new NpgsqlCommand(sql, conn);
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(new BoardRow(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetInt32(3)));
        return result;
    }

    public async Task<List<DeployRow>> GetRecentDeploysAsync(int limit = 5)
    {
        var result = new List<DeployRow>();
        await using var conn = await OpenAsync();
        const string sql = "SELECT id, commit_hash, commit_message, deployed_at FROM deployed_version_stamp ORDER BY deployed_at DESC LIMIT @limit";
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@limit", limit);
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(new DeployRow(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetFieldValue<DateTimeOffset>(3)));
        return result;
    }
}
