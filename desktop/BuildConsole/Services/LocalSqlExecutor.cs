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

        private static string? GetConnectionString(string databaseKey)
        {
            // Git #3705 — the "product" key keeps the exact pre-#3705 resolution order
            // (config override first, then .env.local's DATABASE_URL=) so existing callers
            // that don't pass a key see byte-identical behavior. Any other registry key
            // (BuildConsole, shanes-life, a future repo's DB) resolves straight through
            // DatabaseRegistry against its own real env file — never falls back to "product"
            // on failure, since that would silently run a query against the wrong database.
            if (string.Equals(databaseKey, DatabaseRegistry.DefaultKey, StringComparison.OrdinalIgnoreCase))
            {
                var config = BuildTrackerConfig.Load();
                if (!string.IsNullOrWhiteSpace(config.DatabaseUrl))
                    return BuildQueuePostgresClient.ParseConnectionString(config.DatabaseUrl);
            }

            var entry = DatabaseRegistry.FindByKey(databaseKey) ?? DatabaseRegistry.FindByKey(DatabaseRegistry.DefaultKey);
            if (entry == null) return null;

            // Git #1985 — a null repo root means "we don't know the connection string" here,
            // never resolved against the process cwd (could pick up an unrelated env file).
            var repoRoot = BuildTrackerConfig.FindRepoRoot();
            var resolved = DatabaseRegistry.Resolve(entry, repoRoot);
            if (!resolved.IsReachable || string.IsNullOrWhiteSpace(resolved.ConnectionString))
                return null;

            return BuildQueuePostgresClient.ParseConnectionString(resolved.ConnectionString);
        }

        /// <summary>
        /// Git #3705 — honest, pre-execution reachability check for <paramref name="databaseKey"/>
        /// (a <see cref="DatabaseRegistry"/> key), for the SQL Runner dropdown to show BEFORE a
        /// query is run. Only meaningful for the Dev target environment — Staging/Production
        /// always go through the existing HTTP api-server path regardless of database key.
        /// </summary>
        public static DatabaseRegistry.ResolveResult CheckReachable(string databaseKey)
        {
            var entry = DatabaseRegistry.FindByKey(databaseKey);
            if (entry == null)
            {
                return new DatabaseRegistry.ResolveResult
                {
                    IsReachable = false,
                    Error = $"Unknown database key \"{databaseKey}\"."
                };
            }

            if (string.Equals(databaseKey, DatabaseRegistry.DefaultKey, StringComparison.OrdinalIgnoreCase))
            {
                var config = BuildTrackerConfig.Load();
                if (!string.IsNullOrWhiteSpace(config.DatabaseUrl))
                    return new DatabaseRegistry.ResolveResult { IsReachable = true, ConnectionString = config.DatabaseUrl };
            }

            var repoRoot = BuildTrackerConfig.FindRepoRoot();
            return DatabaseRegistry.Resolve(entry, repoRoot);
        }

        public static async Task<List<SqlStatementResult>> ExecuteAsync(BuildTrackerApiClient api, string sql)
            => await ExecuteAsync(api, sql, DatabaseRegistry.DefaultKey);

        /// <summary>
        /// Git #3705 — <paramref name="databaseKey"/> selects which real, named database
        /// (see <see cref="DatabaseRegistry"/>) a Dev-environment query runs against. Only
        /// applies to the Dev target environment: Staging/Production still always go through
        /// the existing HTTP api-server path (<see cref="BuildTrackerApiClient.ExecuteSqlAsync"/>),
        /// which only ever serves the product database — there is no Staging/Production
        /// equivalent of BuildConsole's or shanes-life's own database to switch to there.
        /// </summary>
        public static async Task<List<SqlStatementResult>> ExecuteAsync(BuildTrackerApiClient api, string sql, string databaseKey)
        {
            var env = GetCurrentTargetEnvironment();
            if (env == TargetEnvironment.Dev)
            {
                var connStr = GetConnectionString(databaseKey);
                if (string.IsNullOrWhiteSpace(connStr))
                {
                    var entry = DatabaseRegistry.FindByKey(databaseKey);
                    var reachability = entry != null ? DatabaseRegistry.Resolve(entry, BuildTrackerConfig.FindRepoRoot()) : null;
                    var detail = reachability?.Error ?? "No connection string found for the selected database.";
                    throw new InvalidOperationException(
                        $"{entry?.DisplayName ?? databaseKey} is unavailable — {detail}");
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
