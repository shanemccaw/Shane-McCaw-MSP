using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json;
using System.Threading.Tasks;
using Npgsql;

namespace ShaneBuilder.Services;

/// <summary>Git #2215 — one statement's real execution outcome. Shape matches BuildConsole's
/// <c>SqlStatementResult</c> (<c>BuildTrackerApiClient.cs</c>) so the two apps stay
/// interchangeable if a shared client ever gets pulled out.</summary>
public sealed class SqlStatementResult
{
    public int StatementIndex { get; set; }
    public string StatementText { get; set; } = "";
    public bool Success { get; set; }
    public List<Dictionary<string, JsonElement>> Rows { get; set; } = new();
    public int RowCount { get; set; }
    public List<string> Fields { get; set; } = new();
    public int ExecutionMs { get; set; }
    public string? Error { get; set; }
}

/// <summary>
/// Git #2215 — real execution against ShaneBuilder's own local Postgres connection (the same
/// <c>DATABASE_URL</c> <see cref="ChatReadClient"/> already resolves), for the SQL Runner mini
/// panel. Statement splitting is a direct port of BuildConsole's
/// <c>Services/SqlScriptSplitter.cs</c> (itself a C# port of the api-server's
/// <c>sql-statement-splitter.ts</c>) — kept behavior-identical rather than reimplemented, per
/// #2215's "real-audit first, don't reimplement" instruction.
/// </summary>
public static class SqlRunnerService
{
    /// <summary>Resolves the same local Postgres connection string <see cref="ChatReadClient"/>
    /// uses (worktree-aware <c>.env.local</c> lookup). Null means no real DB is configured —
    /// callers report that honestly rather than faking a result.</summary>
    public static string? ResolveConnectionString() => ChatReadClient.ResolveConnectionStringForSqlRunner();

    public static async Task<List<SqlStatementResult>> ExecuteAsync(string connectionString, string sql)
    {
        var statements = SqlScriptSplitter.Split(sql);
        var results = new List<SqlStatementResult>();

        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();

        for (int i = 0; i < statements.Count; i++)
        {
            var stmtText = statements[i];
            var result = new SqlStatementResult
            {
                StatementIndex = i,
                StatementText = stmtText,
                Success = true
            };

            var sw = Stopwatch.StartNew();
            try
            {
                await using var cmd = new NpgsqlCommand(stmtText, conn);
                await using var reader = await cmd.ExecuteReaderAsync();

                for (int col = 0; col < reader.FieldCount; col++)
                    result.Fields.Add(reader.GetName(col));

                while (await reader.ReadAsync())
                {
                    var rowDict = new Dictionary<string, JsonElement>();
                    for (int col = 0; col < reader.FieldCount; col++)
                    {
                        var name = reader.GetName(col);
                        var val = reader.GetValue(col);
                        JsonElement elem;
                        if (val == null || val == DBNull.Value)
                        {
                            elem = JsonSerializer.Deserialize<JsonElement>("null");
                        }
                        else
                        {
                            try
                            {
                                var jsonStr = JsonSerializer.Serialize(val);
                                elem = JsonSerializer.Deserialize<JsonElement>(jsonStr);
                            }
                            catch
                            {
                                var escaped = (val?.ToString() ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
                                elem = JsonSerializer.Deserialize<JsonElement>($"\"{escaped}\"");
                            }
                        }
                        rowDict[name] = elem;
                    }
                    result.Rows.Add(rowDict);
                }
                result.RowCount = result.Rows.Count;
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.Error = ex.Message;
            }
            sw.Stop();
            result.ExecutionMs = (int)sw.ElapsedMilliseconds;
            results.Add(result);
        }

        return results;
    }

    internal static string JsonElementToDisplayString(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.Null => "NULL",
        JsonValueKind.String => el.GetString() ?? "",
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => el.GetRawText(),
    };
}
