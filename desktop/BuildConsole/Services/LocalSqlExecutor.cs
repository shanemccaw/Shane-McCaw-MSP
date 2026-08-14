using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Npgsql;

namespace BuildConsole.Services
{
    /// <summary>
    /// Runs SQL through BuildConsole's OWN direct local Postgres connection (Npgsql),
    /// with ZERO round-trip to the deployed Replit dev api-server.
    ///
    /// WHY THIS EXISTS (correcting a common assumption):
    ///   The manual SQL Runner (<see cref="Controls.SqlRunnerView"/>) does NOT hold a
    ///   local DB connection — its only SQL path is
    ///   <c>BuildTrackerApiClient.ExecuteSqlAsync</c> → <c>POST /api/simulator/sql/execute</c>
    ///   against the configured <c>apiBaseUrl</c> (a <c>*.replit.dev</c> dev server). Every
    ///   local agent that drives <c>shaneapp://executeSql</c> already runs on THIS machine,
    ///   so there's no reason to bounce SQL off a remote app that naps every ~15 min
    ///   (#931). This executor is the real local connection that path deserves.
    ///
    /// CONNECTION STRING:
    ///   Resolved by <see cref="TryResolveConnectionString"/> from, in order,
    ///   <c>databaseUrl</c> in <c>scripts/build-queue-watcher.config.json</c> or the
    ///   <c>DATABASE_URL</c> environment variable — the same connection string the
    ///   api-server itself uses. A <c>postgres://</c>/<c>postgresql://</c> URI (Neon/Replit
    ///   style) is converted to Npgsql key/value form; a key/value string is passed through.
    ///
    /// SEMANTICS:
    ///   Statements are split with the shared <see cref="SqlScriptSplitter"/> (server-parity)
    ///   and run one at a time on a single open connection — so session state (temp tables,
    ///   SET) carries across statements, and each statement is its own implicit transaction:
    ///   a mid-script failure is captured per-statement and later statements STILL run,
    ///   matching the SSMS-style per-statement result the SQL Runner + result envelope
    ///   already render (<see cref="SqlStatementResult"/>).
    ///
    /// SAFETY: no live DB access happens from a Claude Code session — this only runs at
    ///   app runtime on Shane's machine, against the dev DB he explicitly points it at.
    /// </summary>
    public static class LocalSqlExecutor
    {
        /// <summary>
        /// Resolves the local Postgres connection string. <paramref name="configuredDatabaseUrl"/>
        /// (the <c>databaseUrl</c> config field) wins if set; otherwise the <c>DATABASE_URL</c>
        /// environment variable is used. Returns false with a human-readable
        /// <paramref name="error"/> when nothing is configured or the value is unparseable.
        /// <paramref name="source"/> is a password-free descriptor safe to log
        /// (origin + host/port/db/user/ssl).
        /// </summary>
        public static bool TryResolveConnectionString(
            string? configuredDatabaseUrl, out string connectionString, out string source, out string error)
        {
            connectionString = "";
            source = "";
            error = "";

            string? raw = null;
            string origin = "";
            if (!string.IsNullOrWhiteSpace(configuredDatabaseUrl))
            {
                raw = configuredDatabaseUrl!.Trim();
                origin = "config databaseUrl";
            }
            else
            {
                var env = Environment.GetEnvironmentVariable("DATABASE_URL");
                if (!string.IsNullOrWhiteSpace(env))
                {
                    raw = env!.Trim();
                    origin = "DATABASE_URL env var";
                }
            }

            if (raw == null)
            {
                error = "no local Postgres connection string configured — set \"databaseUrl\" in " +
                        "scripts/build-queue-watcher.config.json or the DATABASE_URL environment variable";
                return false;
            }

            try
            {
                var csb = BuildBuilder(raw);
                if (string.IsNullOrWhiteSpace(csb.Host))
                {
                    error = $"connection string from {origin} has no host";
                    return false;
                }
                connectionString = csb.ConnectionString;
                source = $"{origin}: {SafeDescriptor(csb)}";
                return true;
            }
            catch (Exception ex)
            {
                error = $"invalid Postgres connection string from {origin}: {ex.Message}";
                return false;
            }
        }

        /// <summary>
        /// Executes <paramref name="sql"/> against the given connection string, one
        /// statement at a time, returning a <see cref="SqlStatementResult"/> per statement
        /// (the exact shape the SQL Runner and the shaneapp:// result envelope already use).
        /// A per-statement failure is captured (Success=false, Error set) and does not stop
        /// later statements. Throws only if the connection itself can't be opened.
        /// </summary>
        public static async Task<List<SqlStatementResult>> ExecuteAsync(
            string connectionString, string sql, CancellationToken ct = default)
        {
            var results = new List<SqlStatementResult>();
            var statements = SqlScriptSplitter.Split(sql);

            await using var conn = new NpgsqlConnection(connectionString);
            await conn.OpenAsync(ct);

            for (int idx = 0; idx < statements.Count; idx++)
            {
                var stmt = statements[idx];
                var sw = Stopwatch.StartNew();
                var r = new SqlStatementResult { StatementIndex = idx, StatementText = stmt };
                try
                {
                    await using var cmd = new NpgsqlCommand(stmt, conn);
                    await using var reader = await cmd.ExecuteReaderAsync(ct);

                    if (reader.FieldCount > 0)
                    {
                        var fields = BuildFieldNames(reader);
                        var rows = new List<Dictionary<string, JsonElement>>();
                        while (await reader.ReadAsync(ct))
                        {
                            var row = new Dictionary<string, JsonElement>(fields.Count);
                            for (int c = 0; c < fields.Count; c++)
                            {
                                object? val = reader.GetValue(c);
                                row[fields[c]] = (val is DBNull) ? NullElement : ToJsonElement(val);
                            }
                            rows.Add(row);
                        }
                        r.Fields = fields;
                        r.Rows = rows;
                        r.RowCount = rows.Count;
                    }
                    else
                    {
                        // Non-result statement (INSERT/UPDATE/DELETE without RETURNING, DDL).
                        // RecordsAffected is -1 for statements that affect no rows (e.g. DDL).
                        r.Fields = new List<string>();
                        r.Rows = new List<Dictionary<string, JsonElement>>();
                        r.RowCount = reader.RecordsAffected < 0 ? 0 : reader.RecordsAffected;
                    }
                    r.Success = true;
                }
                catch (Exception ex)
                {
                    r.Success = false;
                    r.Error = ex.Message;
                }
                sw.Stop();
                r.ExecutionMs = (int)sw.ElapsedMilliseconds;
                results.Add(r);
            }

            return results;
        }

        // ── Field names ─────────────────────────────────────────────────────────
        // Postgres can return duplicate column names (e.g. SELECT 1, 1, or a join with
        // same-named columns). The row is keyed by a Dictionary, so a bare duplicate would
        // clobber; de-dupe by suffixing _2/_3 so every column still surfaces.
        private static List<string> BuildFieldNames(NpgsqlDataReader reader)
        {
            var fields = new List<string>(reader.FieldCount);
            var seen = new Dictionary<string, int>(StringComparer.Ordinal);
            for (int c = 0; c < reader.FieldCount; c++)
            {
                var name = reader.GetName(c);
                if (string.IsNullOrEmpty(name)) name = $"column{c + 1}";
                if (seen.TryGetValue(name, out var count))
                {
                    seen[name] = count + 1;
                    name = $"{name}_{count + 1}";
                }
                else
                {
                    seen[name] = 1;
                }
                fields.Add(name);
            }
            return fields;
        }

        // ── Value → JsonElement ─────────────────────────────────────────────────
        private static readonly JsonSerializerOptions ElemOpts = new();
        private static readonly JsonElement NullElement = JsonSerializer.SerializeToElement<object?>(null);

        private static JsonElement ToJsonElement(object? value)
        {
            if (value is null || value is DBNull) return NullElement;
            try
            {
                return JsonSerializer.SerializeToElement(value, ElemOpts);
            }
            catch
            {
                // Provider-specific types System.Text.Json can't serialize (ranges, geometry,
                // etc.) fall back to their string form — the SQL Runner displays strings anyway.
                return JsonSerializer.SerializeToElement(value.ToString(), ElemOpts);
            }
        }

        // ── Connection-string building ──────────────────────────────────────────
        private static NpgsqlConnectionStringBuilder BuildBuilder(string raw)
        {
            if (raw.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) ||
                raw.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
            {
                return FromUri(raw);
            }
            // Already Npgsql key/value form (Host=...;Username=...;...) — validate by parsing.
            return new NpgsqlConnectionStringBuilder(raw);
        }

        /// <summary>Converts a <c>postgres://user:pass@host:port/db?sslmode=…</c> URI (Neon/Replit/Supabase style) into an Npgsql key/value connection string.</summary>
        private static NpgsqlConnectionStringBuilder FromUri(string url)
        {
            var u = new Uri(url);
            var csb = new NpgsqlConnectionStringBuilder
            {
                Host = u.Host,
                Port = u.Port <= 0 ? 5432 : u.Port,
            };

            var db = Uri.UnescapeDataString(u.AbsolutePath.TrimStart('/'));
            if (!string.IsNullOrEmpty(db)) csb.Database = db;

            var userInfo = u.UserInfo;
            if (!string.IsNullOrEmpty(userInfo))
            {
                var parts = userInfo.Split(new[] { ':' }, 2);
                csb.Username = Uri.UnescapeDataString(parts[0]);
                if (parts.Length > 1) csb.Password = Uri.UnescapeDataString(parts[1]);
            }

            bool sslSpecified = false;
            foreach (var (key, val) in ParseQuery(u.Query))
            {
                switch (key.ToLowerInvariant())
                {
                    case "sslmode":
                        csb.SslMode = MapSslMode(val);
                        sslSpecified = true;
                        break;
                    case "application_name":
                        csb.ApplicationName = val;
                        break;
                    case "connect_timeout":
                        if (int.TryParse(val, out var t)) csb.Timeout = t;
                        break;
                    // channel_binding, options, etc. — defaults are fine for a local dev tool.
                }
            }

            // Cloud Postgres (Neon/Replit/Supabase) requires SSL; negotiating it is harmless
            // against a local server too, so default to Prefer when the URL didn't say.
            if (!sslSpecified) csb.SslMode = SslMode.Prefer;

            // Accept the server cert without a locally-installed CA bundle for the
            // non-verifying modes (the dev-tool norm for managed PG); the Verify* modes
            // keep full chain validation.
            if (csb.SslMode is SslMode.Require or SslMode.Prefer or SslMode.Allow)
                csb.TrustServerCertificate = true;

            return csb;
        }

        private static SslMode MapSslMode(string value) => value.ToLowerInvariant() switch
        {
            "disable" => SslMode.Disable,
            "allow" => SslMode.Allow,
            "prefer" => SslMode.Prefer,
            "require" => SslMode.Require,
            "verify-ca" => SslMode.VerifyCA,
            "verify-full" => SslMode.VerifyFull,
            _ => SslMode.Prefer,
        };

        private static IEnumerable<(string Key, string Value)> ParseQuery(string query)
        {
            if (string.IsNullOrEmpty(query)) yield break;
            foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var idx = pair.IndexOf('=');
                if (idx < 0)
                    yield return (Uri.UnescapeDataString(pair), "");
                else
                    yield return (Uri.UnescapeDataString(pair.Substring(0, idx)),
                                  Uri.UnescapeDataString(pair.Substring(idx + 1)));
            }
        }

        /// <summary>A password-free, log-safe descriptor of a connection target.</summary>
        private static string SafeDescriptor(NpgsqlConnectionStringBuilder csb) =>
            $"{csb.Host}:{csb.Port}/{csb.Database} (user {csb.Username}, ssl {csb.SslMode})";
    }
}
