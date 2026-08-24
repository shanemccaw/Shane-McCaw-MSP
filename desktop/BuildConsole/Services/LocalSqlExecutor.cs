using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Npgsql;

namespace BuildConsole.Services
{
    /// <summary>
    /// Runs SQL for the <c>shaneapp://executeSql</c> local protocol and the manual SQL Runner.
    /// Following the target environment:
    ///   - Dev: Executes SQL directly against the local Neon Postgres database.
    ///   - Staging/Production: Executes SQL through the api-server HTTP pipe (api.ExecuteSqlAsync).
    /// </summary>
    public static class LocalSqlExecutor
    {
        private static TargetEnvironment GetCurrentTargetEnvironment()
        {
            TargetEnvironment env = TargetEnvironment.Dev;
            if (System.Windows.Application.Current != null)
            {
                try
                {
                    System.Windows.Application.Current.Dispatcher.Invoke(() =>
                    {
                        if (System.Windows.Application.Current.MainWindow is MainWindow mw && mw.LeftSidebar != null)
                        {
                            env = mw.LeftSidebar.GetSelectedTargetEnvironment();
                        }
                    });
                }
                catch
                {
                    // Fall back to Dev if UI thread dispatch fails
                }
            }
            return env;
        }

        private static string? GetConnectionString()
        {
            var config = BuildTrackerConfig.Load();
            string? raw = null;
            if (!string.IsNullOrWhiteSpace(config.DatabaseUrl))
                raw = config.DatabaseUrl;
            else
            {
                var repoRoot = BuildTrackerConfig.FindRepoRoot() ?? "";
                var envLocal = Path.Combine(repoRoot, ".env.local");
                if (File.Exists(envLocal))
                {
                    foreach (var line in File.ReadAllLines(envLocal))
                    {
                        var trimmed = line.Trim();
                        if (trimmed.StartsWith('#') || !trimmed.StartsWith("DATABASE_URL=", StringComparison.OrdinalIgnoreCase))
                            continue;
                        var url = trimmed.Substring("DATABASE_URL=".Length).Trim().Trim('"').Trim('\'');
                        if (!string.IsNullOrWhiteSpace(url))
                        {
                            raw = url;
                            break;
                        }
                    }
                }
            }

            if (raw != null)
            {
                return BuildQueuePostgresClient.ParseConnectionString(raw);
            }
            return null;
        }

        public static async Task<List<SqlStatementResult>> ExecuteAsync(BuildTrackerApiClient api, string sql)
        {
            var env = GetCurrentTargetEnvironment();
            if (env == TargetEnvironment.Dev)
            {
                var connStr = GetConnectionString();
                if (string.IsNullOrWhiteSpace(connStr))
                {
                    throw new InvalidOperationException(
                        "No DATABASE_URL found for Dev environment — set databaseUrl in scripts/build-queue-watcher.config.json " +
                        "or add DATABASE_URL=<connection string> to .env.local at the repo root.");
                }
                return await ExecuteSqlDirectlyAsync(connStr, sql);
            }
            else
            {
                if (api == null) throw new ArgumentNullException(nameof(api));
                if (!api.IsConfigured)
                {
                    throw new InvalidOperationException(
                        "api-server is not configured — set apiBaseUrl + ingestToken in " +
                        "scripts/build-queue-watcher.config.json.");
                }
                return await api.ExecuteSqlAsync(sql);
            }
        }

        private static async Task<List<SqlStatementResult>> ExecuteSqlDirectlyAsync(string connectionString, string sql)
        {
            var statements = SqlScriptSplitter.Split(sql);
            var results = new List<SqlStatementResult>();

            using (var conn = new NpgsqlConnection(connectionString))
            {
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

                    var sw = System.Diagnostics.Stopwatch.StartNew();
                    try
                    {
                        using (var cmd = new NpgsqlCommand(stmtText, conn))
                        {
                            using (var reader = await cmd.ExecuteReaderAsync())
                            {
                                for (int col = 0; col < reader.FieldCount; col++)
                                {
                                    result.Fields.Add(reader.GetName(col));
                                }

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
                        }
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
            }

            return results;
        }
    }
}
