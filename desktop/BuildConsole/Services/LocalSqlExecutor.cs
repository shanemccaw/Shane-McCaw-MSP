using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Runs SQL for the <c>shaneapp://executeSql</c> local protocol through the EXACT
    /// same execution path the manual SQL Runner (<see cref="Controls.SqlRunnerView"/>)
    /// already uses: <see cref="BuildTrackerApiClient.ExecuteSqlAsync"/> →
    /// <c>POST /api/simulator/sql/execute</c> against the configured dev api-server
    /// (<c>apiBaseUrl</c>). There is NO direct/local Postgres connection and NO separate
    /// connection string — the SQL rides "through the pipe like the SQL Runner," which is
    /// Shane's stated design intent for this action.
    ///
    /// WHY THIS SHAPE (correcting an earlier deviation):
    ///   A previous version of this class opened its OWN Npgsql connection and required a
    ///   <c>databaseUrl</c> config field / <c>DATABASE_URL</c> environment variable that was
    ///   never configured — so every <c>shaneapp://executeSql</c> call failed with
    ///   "no local Postgres connection string configured." That was a real deviation from
    ///   the design: the SQL Runner never held a local DB connection either; its only SQL
    ///   path is <see cref="BuildTrackerApiClient.ExecuteSqlAsync"/> over HTTP, the same
    ///   already-approved dev-server path the old browser-extension floaty runner used.
    ///   This routes <c>executeSql</c> through that identical, already-working pipe, so it
    ///   succeeds the moment the app is configured — nothing new to set up.
    ///
    /// SEMANTICS:
    ///   Identical to the SQL Runner. The api-server splits the script (server-parity split)
    ///   and returns one <see cref="SqlStatementResult"/> per statement — the exact shape the
    ///   SQL Runner grid and the <c>shaneapp://</c> result envelope already render. A
    ///   mid-script per-statement failure is captured in that statement's result and does not
    ///   stop later statements, matching the SSMS-style behaviour already in place.
    ///
    /// SAFETY: no direct database access happens from a Claude Code session — this only runs
    ///   at app runtime on Shane's machine, hitting the same dev api-server the SQL Runner does.
    /// </summary>
    public static class LocalSqlExecutor
    {
        /// <summary>
        /// Executes <paramref name="sql"/> by handing it to the manual SQL Runner's own
        /// execution pipe (<paramref name="api"/>'s <see cref="BuildTrackerApiClient.ExecuteSqlAsync"/>
        /// → <c>POST /api/simulator/sql/execute</c>), returning one
        /// <see cref="SqlStatementResult"/> per statement exactly as the SQL Runner does.
        /// Throws <see cref="InvalidOperationException"/> if the api-server isn't configured
        /// (so the caller can write a clear "not configured" result envelope rather than a
        /// silent no-op), and propagates the underlying HTTP error if the request itself fails.
        /// </summary>
        public static Task<List<SqlStatementResult>> ExecuteAsync(BuildTrackerApiClient api, string sql)
        {
            if (api == null) throw new ArgumentNullException(nameof(api));
            if (!api.IsConfigured)
            {
                throw new InvalidOperationException(
                    "api-server is not configured — set apiBaseUrl + ingestToken in " +
                    "scripts/build-queue-watcher.config.json. executeSql routes SQL through the " +
                    "same POST /api/simulator/sql/execute path the manual SQL Runner uses; no " +
                    "local Postgres connection is involved.");
            }

            // The one pipe the SQL Runner already uses, verbatim.
            return api.ExecuteSqlAsync(sql);
        }
    }
}
