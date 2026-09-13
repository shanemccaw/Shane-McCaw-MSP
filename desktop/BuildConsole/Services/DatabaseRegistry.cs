using System;
using System.Collections.Generic;
using System.IO;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3705 — the real, extensible list of named Postgres connections the SQL Runner
    /// can target. Confirmed real, genuinely separate databases today: the shared product
    /// database (<c>DATABASE_URL</c> in repo-root <c>.env.local</c>), BuildConsole's own
    /// database (<c>BUILD_DATABASE_URL</c>, same file, Git #3651), and Shane's Life's own
    /// database (<c>DATABASE_URL</c> in <c>web/shanes-life/.env</c>).
    ///
    /// Checked before building this: #3581's Settings repo registry
    /// (<see cref="BuildConsoleSettings.RepoRegistryEntry"/>) is keyed one entry per real
    /// GitHub <c>owner/repo</c> with a Main/Tinker tier — it does NOT extend naturally to
    /// databases, because the product database and BuildConsole's own database are two
    /// genuinely separate real databases that both live under the SAME single repo entry
    /// (<c>shanemccaw/Shane-McCaw-MSP</c>). A "one row per repo" registry has no second row
    /// to give BuildConsole's own database. This is therefore a small, dedicated registry —
    /// not a second, parallel copy of #3581's concept, just a different real axis (databases,
    /// not repos).
    ///
    /// Extensible the same way #3581 intends for repos: adding a new real database later is
    /// exactly one new <see cref="DatabaseRegistryEntry"/> below — no SQL Runner UI code
    /// change required, it just shows up in the dropdown.
    /// </summary>
    public static class DatabaseRegistry
    {
        public sealed class DatabaseRegistryEntry
        {
            /// <summary>Stable key used for persistence/selection (e.g. "product").</summary>
            public string Key { get; }

            /// <summary>What the SQL Runner dropdown shows.</summary>
            public string DisplayName { get; }

            /// <summary>
            /// Path to the real env file this database's connection string lives in,
            /// relative to the repo root resolved via <see cref="BuildTrackerConfig.FindRepoRoot"/>.
            /// </summary>
            public string EnvFileRelativePath { get; }

            /// <summary>The real env var name inside that file (e.g. "DATABASE_URL").</summary>
            public string EnvVarName { get; }

            public DatabaseRegistryEntry(string key, string displayName, string envFileRelativePath, string envVarName)
            {
                Key = key;
                DisplayName = displayName;
                EnvFileRelativePath = envFileRelativePath;
                EnvVarName = envVarName;
            }
        }

        /// <summary>The real, known list of named databases. Add a new repo's database here.</summary>
        public static readonly List<DatabaseRegistryEntry> Entries = new()
        {
            new DatabaseRegistryEntry(
                key: "product",
                displayName: "Product (Shane-McCaw-MSP)",
                envFileRelativePath: ".env.local",
                envVarName: "DATABASE_URL"),
            new DatabaseRegistryEntry(
                key: "buildconsole",
                displayName: "BuildConsole (bt_*)",
                envFileRelativePath: ".env.local",
                envVarName: "BUILD_DATABASE_URL"),
            new DatabaseRegistryEntry(
                key: "shanes-life",
                displayName: "Shane's Life (finances)",
                envFileRelativePath: Path.Combine("web", "shanes-life", ".env"),
                envVarName: "DATABASE_URL"),
        };

        /// <summary>Default selection — matches the SQL Runner's existing pre-#3705 behavior.</summary>
        public const string DefaultKey = "product";

        /// <summary>
        /// Git #3884 — named constant for the "buildconsole" key so real bt_* callers (e.g.
        /// ChatMappingsDocumentView) can't accidentally fall through to <see cref="DefaultKey"/>
        /// ("product") by omitting the databaseKey argument. bt_epics/bt_chats/bt_chat_issues
        /// live in BuildConsole's own database, not the product database.
        /// </summary>
        public const string BuildConsoleKey = "buildconsole";

        public static DatabaseRegistryEntry? FindByKey(string? key)
        {
            if (string.IsNullOrWhiteSpace(key)) return null;
            foreach (var e in Entries)
                if (string.Equals(e.Key, key, StringComparison.OrdinalIgnoreCase))
                    return e;
            return null;
        }

        /// <summary>
        /// Result of resolving one <see cref="DatabaseRegistryEntry"/> against the real repo
        /// checkout. <see cref="IsReachable"/> tracks whether a real connection string was
        /// found — NOT whether the database actually answers a connection (that's proven by
        /// actually running the query; this is the honest pre-check the dropdown/UI can show
        /// without opening a real connection first).
        /// </summary>
        public sealed class ResolveResult
        {
            public bool IsReachable { get; init; }
            public string? ConnectionString { get; init; }
            public string? Error { get; init; }
        }

        /// <summary>
        /// Reads <paramref name="entry"/>'s real env var out of its real env file under
        /// <paramref name="repoRoot"/>. Never silently falls back to a different database —
        /// a missing file, missing var, or unresolved repo root is reported honestly via
        /// <see cref="ResolveResult.Error"/> rather than defaulting to another entry.
        /// </summary>
        public static ResolveResult Resolve(DatabaseRegistryEntry entry, string? repoRoot)
        {
            if (string.IsNullOrWhiteSpace(repoRoot))
            {
                return new ResolveResult
                {
                    IsReachable = false,
                    Error = "Repo root could not be resolved — cannot look for the connection string."
                };
            }

            var envFile = Path.Combine(repoRoot, entry.EnvFileRelativePath);
            if (!File.Exists(envFile))
            {
                return new ResolveResult
                {
                    IsReachable = false,
                    Error = $"{entry.EnvFileRelativePath} not found — {entry.DisplayName} is unavailable from this checkout."
                };
            }

            var key = entry.EnvVarName + "=";
            foreach (var line in File.ReadAllLines(envFile))
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith('#') || !trimmed.StartsWith(key, StringComparison.OrdinalIgnoreCase))
                    continue;
                var url = trimmed.Substring(key.Length).Trim().Trim('"').Trim('\'');
                if (!string.IsNullOrWhiteSpace(url))
                {
                    return new ResolveResult { IsReachable = true, ConnectionString = url };
                }
                break;
            }

            return new ResolveResult
            {
                IsReachable = false,
                Error = $"{entry.EnvVarName} not set in {entry.EnvFileRelativePath} — {entry.DisplayName} is unavailable."
            };
        }
    }
}
