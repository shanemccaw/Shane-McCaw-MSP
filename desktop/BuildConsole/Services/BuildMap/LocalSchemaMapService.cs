using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using BuildConsole.Services;
using Npgsql;

namespace BuildConsole.Services.BuildMap
{
    /// <summary>
    /// Git #2805 (Local Map, item #1 of #2804's structured index) — the real Postgres schema read
    /// layer. Produces a <see cref="LocalSchemaDoc"/> from a live query against the actual local
    /// Postgres database BuildConsole already connects to for the build queue
    /// (<see cref="BuildQueuePostgresClient"/>) — real tables via `information_schema.tables`, real
    /// foreign-key relationships via `information_schema.table_constraints`/`key_column_usage`, per
    /// #2805's own dispatch. No placeholder tables, no fabricated edges: an empty database produces a
    /// <see cref="LocalSchemaDoc"/> with empty lists, a true result rather than a fixture.
    ///
    /// See <see cref="LocalSchemaDoc"/>'s own class doc for the real audit that decided this needed a
    /// new parallel model rather than reusing <see cref="ChainDoc"/>.
    ///
    /// <b>Connection:</b> reuses the exact same `DATABASE_URL` resolution
    /// <see cref="BuildQueuePostgresClient.TryCreate"/> already uses (config override, else
    /// `&lt;repoRoot&gt;/.env.local`'s `DATABASE_URL=` line) and
    /// <see cref="BuildQueuePostgresClient.ParseConnectionString"/> to turn the `postgresql://` URI
    /// into Npgsql's keyword/value format — this is deliberately the SAME database the build queue
    /// and the platform's own app schema both live in post-Neon-migration (local PostgreSQL 18,
    /// `shanemccawmsp`), not a second connection to configure.
    ///
    /// <b>Composite foreign keys:</b> a live spot-check of this real database (2026-09-04, 387 base
    /// tables / 416 foreign-key constraints in `public`) found zero multi-column foreign keys, so the
    /// straightforward `key_column_usage` (referencing) ⋈ `constraint_column_usage` (referenced) join
    /// below is exact for every real edge that exists today. If a genuine composite FK is ever added,
    /// `constraint_column_usage`'s referenced-side ordinal alignment with the referencing side is not
    /// guaranteed by the SQL standard for composite keys — a future revision would need `pg_constraint`'s
    /// `conkey`/`confkey` arrays (which preserve position) instead of this information_schema join.
    /// </summary>
    public static class LocalSchemaMapService
    {
        // Real user-facing schemas only — pg_catalog/information_schema are Postgres's own internal
        // catalog tables, not part of the application's data model, and would swamp a real schema
        // graph with hundreds of irrelevant system nodes.
        private static readonly string[] ExcludedSchemas = { "pg_catalog", "information_schema" };

        /// <summary>
        /// Builds the real <see cref="LocalSchemaDoc"/> for the local Postgres database. Throws if no
        /// real `DATABASE_URL` can be resolved or the connection genuinely fails — fail loud, per the
        /// "when a needed server is genuinely unreachable" rule: this is a real, statable error, not
        /// something to paper over with an empty graph.
        /// </summary>
        public static async Task<LocalSchemaDoc> BuildAsync(BuildTrackerConfig? config = null, string? repoRoot = null)
        {
            var connectionString = ResolveConnectionString(config, repoRoot)
                ?? throw new InvalidOperationException(
                    "No DATABASE_URL found — set databaseUrl in scripts/build-queue-watcher.config.json " +
                    "or add DATABASE_URL=<connection string> to .env.local at the repo root. Cannot build the Local Map without a real Postgres connection.");

            await using var conn = new NpgsqlConnection(connectionString);
            await conn.OpenAsync();

            var doc = new LocalSchemaDoc
            {
                Database = conn.Database,
                GeneratedAtUtc = DateTime.UtcNow,
            };

            var tablesById = await ReadTablesAsync(conn);
            await ApplyColumnCountsAsync(conn, tablesById);
            await ApplyPrimaryKeysAsync(conn, tablesById);

            doc.Tables = tablesById.Values.OrderBy(t => t.Schema, StringComparer.Ordinal)
                .ThenBy(t => t.Name, StringComparer.Ordinal)
                .ToList();
            doc.Edges = await ReadForeignKeyEdgesAsync(conn, tablesById);

            return doc;
        }

        /// <summary>Same resolution order as <see cref="BuildQueuePostgresClient.TryCreate"/>: an
        /// explicit config override first, then `&lt;repoRoot&gt;/.env.local`'s `DATABASE_URL=` line.
        /// Returns null (never throws) when nothing is found — the caller decides what "no connection"
        /// means for its own use case.</summary>
        public static string? ResolveConnectionString(BuildTrackerConfig? config, string? repoRoot)
        {
            if (!string.IsNullOrWhiteSpace(config?.DatabaseUrl))
                return BuildQueuePostgresClient.ParseConnectionString(config!.DatabaseUrl);

            var root = repoRoot ?? BuildTrackerConfig.FindRepoRoot();
            if (string.IsNullOrWhiteSpace(root))
                return null;

            var envLocal = Path.Combine(root, ".env.local");
            if (!File.Exists(envLocal))
                return null;

            foreach (var line in File.ReadAllLines(envLocal))
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith('#') || !trimmed.StartsWith("DATABASE_URL=", StringComparison.OrdinalIgnoreCase))
                    continue;
                var url = trimmed.Substring("DATABASE_URL=".Length).Trim().Trim('"').Trim('\'');
                if (!string.IsNullOrWhiteSpace(url))
                    return BuildQueuePostgresClient.ParseConnectionString(url);
            }

            return null;
        }

        private static async Task<Dictionary<string, LocalSchemaTable>> ReadTablesAsync(NpgsqlConnection conn)
        {
            const string sql = @"
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_type = 'BASE TABLE'
                  AND table_schema <> ALL(@excluded)
                ORDER BY table_schema, table_name";

            var result = new Dictionary<string, LocalSchemaTable>(StringComparer.Ordinal);
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@excluded", ExcludedSchemas);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var table = new LocalSchemaTable
                {
                    Schema = reader.GetString(0),
                    Name = reader.GetString(1),
                };
                result[table.Id] = table;
            }
            return result;
        }

        private static async Task ApplyColumnCountsAsync(NpgsqlConnection conn, Dictionary<string, LocalSchemaTable> tablesById)
        {
            const string sql = @"
                SELECT table_schema, table_name, count(*)::int
                FROM information_schema.columns
                WHERE table_schema <> ALL(@excluded)
                GROUP BY table_schema, table_name";

            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@excluded", ExcludedSchemas);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var id = reader.GetString(0) + "." + reader.GetString(1);
                if (tablesById.TryGetValue(id, out var table))
                    table.ColumnCount = reader.GetInt32(2);
            }
        }

        private static async Task ApplyPrimaryKeysAsync(NpgsqlConnection conn, Dictionary<string, LocalSchemaTable> tablesById)
        {
            const string sql = @"
                SELECT tc.table_schema, tc.table_name, kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                   AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema <> ALL(@excluded)
                ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position";

            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@excluded", ExcludedSchemas);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var id = reader.GetString(0) + "." + reader.GetString(1);
                if (tablesById.TryGetValue(id, out var table))
                    table.PrimaryKeyColumns.Add(reader.GetString(2));
            }
        }

        /// <summary>Real foreign-key relationships per #2805's dispatch: `table_constraints` joined to
        /// `key_column_usage` (the referencing side) and `constraint_column_usage` (the referenced
        /// side). Grouped by constraint name so a (currently theoretical — see class doc) composite FK
        /// produces one edge with multiple columns rather than one edge per column.
        ///
        /// <b>Deliberately no `table_schema <> ALL(@excluded)` predicate here</b> (unlike the tables/
        /// columns/PK queries above): `information_schema.constraint_column_usage` is itself a view
        /// over several nested views, and a live timing check against this real database (2026-09-04)
        /// found adding that predicate on `tc.table_schema` defeats the planner — 3.5s → 39s for the
        /// same 416 real rows, an un-pushed-down full scan of the underlying catalog joins. No real
        /// foreign key is ever defined on a `pg_catalog`/`information_schema` system table, so the
        /// predicate has no correctness effect anyway; excluded-schema edges are filtered out below via
        /// the `tablesById` membership check instead, which is free (already-loaded in-memory data).</summary>
        private static async Task<List<LocalSchemaEdge>> ReadForeignKeyEdgesAsync(
            NpgsqlConnection conn, Dictionary<string, LocalSchemaTable> tablesById)
        {
            const string sql = @"
                SELECT
                    tc.constraint_name,
                    tc.table_schema  AS from_schema,
                    tc.table_name    AS from_table,
                    kcu.column_name  AS from_column,
                    ccu.table_schema AS to_schema,
                    ccu.table_name   AS to_table,
                    ccu.column_name  AS to_column
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                   AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu
                    ON tc.constraint_name = ccu.constraint_name
                   AND tc.table_schema = ccu.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY'
                ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position";

            var edgesByConstraint = new Dictionary<string, LocalSchemaEdge>(StringComparer.Ordinal);
            await using var cmd = new NpgsqlCommand(sql, conn);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var constraintName = reader.GetString(0);
                var fromId = reader.GetString(1) + "." + reader.GetString(2);
                var toId = reader.GetString(4) + "." + reader.GetString(5);
                // Real key used to disambiguate the (rare-in-practice, real-and-possible) case of two
                // distinct FK constraints happening to share a name across different tables.
                var key = fromId + "|" + constraintName;

                if (!edgesByConstraint.TryGetValue(key, out var edge))
                {
                    edge = new LocalSchemaEdge
                    {
                        ConstraintName = constraintName,
                        FromTableId = fromId,
                        ToTableId = toId,
                    };
                    edgesByConstraint[key] = edge;
                }

                edge.FromColumns.Add(reader.GetString(3));
                edge.ToColumns.Add(reader.GetString(6));
            }

            // Only real edges whose both endpoints are actual tables this graph renders (a foreign key
            // pointing at a view or an excluded system schema has no node here to draw against —
            // real but out of this graph's scope, same discipline as ChainDoc's knownNumbers filter).
            return edgesByConstraint.Values
                .Where(e => tablesById.ContainsKey(e.FromTableId) && tablesById.ContainsKey(e.ToTableId))
                .OrderBy(e => e.FromTableId, StringComparer.Ordinal)
                .ThenBy(e => e.ConstraintName, StringComparer.Ordinal)
                .ToList();
        }
    }
}
