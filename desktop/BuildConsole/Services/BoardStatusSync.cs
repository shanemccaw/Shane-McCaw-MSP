using System;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2136 — the single, shared "mirror a durable workflow decision onto the real
    /// GitHub project board" primitive. Shane's decision for this issue: every DURABLE
    /// decision about an issue's workflow state (Verifying, Crashed, Parked, …) is a real
    /// board Status column move, so "Git IS the database" and a local Postgres row can never
    /// be the sole authority on a decision that has silently drifted from reality (the #1867
    /// recurrence, same class as #1362/#2068/#2070).
    ///
    /// This is deliberately FIRE-AND-FORGET, exactly like the pre-existing Park mirror it
    /// generalizes (BuildQueuePanel.SyncGitHubParkStatus) and the in-flight/complete label
    /// syncs QueueBuildAsync/UnparkAsync already do: a slow or failed GitHub call must never
    /// block or crash the completion reap loop / a UI action it is paired with. The local
    /// operational cache (bt_build_queue) stays the immediate driver of live dispatch; this
    /// just makes the board reflect the same durable decision so it survives independently of
    /// the local DB and is visible/queryable from anywhere (including Shane's phone — the
    /// remote-queue use case in the issue body).
    ///
    /// Progress ticks and live OS process state are explicitly NOT mirrored here — Shane was
    /// explicit that transient telemetry ("step X of Y") and "which pid is alive right now"
    /// stay local by nature, not by preference. Only durable state transitions call this.
    /// </summary>
    public static class BoardStatusSync
    {
        /// <summary>
        /// Fire-and-forget: move <paramref name="githubNumber"/>'s Status field on the real
        /// project board to <paramref name="optionId"/>. No-op (silent) when the item has no
        /// linked GitHub issue, when no PAT is configured, or when the issue isn't on the
        /// board at all — none of those should ever surface as an error to the caller, matching
        /// the existing Park mirror's stance. Every outcome is logged on the given
        /// <paramref name="logChannel"/> for attributability.
        /// </summary>
        public static void Mirror(int? githubNumber, string optionId, string stateLabel,
            string logChannel = "board-sync")
        {
            if (!githubNumber.HasValue) return;
            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat) return;
            var num = githubNumber.Value;
            if (num <= 0) return;

            _ = Task.Run(async () =>
            {
                try
                {
                    var client = new GitHubApiClient(settings.GitHubPat);
                    bool moved = await client.SetIssueStatusByNumberAsync(num, optionId);
                    ActivityLog.Log(logChannel, moved
                        ? $"{stateLabel}: moved Git #{num}'s board Status column (Git IS the database)."
                        : $"{stateLabel}: Git #{num} isn't on the project board — nothing to move.");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(logChannel, $"{stateLabel}: couldn't move Git #{num}'s board Status: {ex.Message}");
                }
            });
        }

        /// <summary>
        /// Git #2136 — the read side of the same "Git IS the database" principle, and the real
        /// #1867 fix: reconcile every local Verifying row against its issue's REAL board Status
        /// column (see <see cref="BuildQueuePostgresClient.ReconcileVerifyingAgainstBoardAsync"/>
        /// for the exact mapping and its fail-closed guarantees). This is the single shared entry
        /// point the manual-refresh sites (Home tab, Build Watch, Git Board refresh) all call
        /// right after PromoteVerifyingToDoneAsync, so the PAT gate / client construction / logging
        /// lives in one place instead of three. Awaitable (unlike <see cref="Mirror"/>) because the
        /// caller is already on an async refresh path and wants the reconcile to finish before it
        /// re-reads the queue. No-op (returns 0) when there's no direct DB, no PAT, or nothing to
        /// reconcile; any failure is swallowed and logged (fail-closed — never throws into a
        /// refresh handler).
        /// </summary>
        public static async Task<int> ReconcileVerifyingAgainstBoardAsync(
            BuildQueuePostgresClient? db, string source)
        {
            if (db == null) return 0;
            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat) return 0;

            try
            {
                var gh = new GitHubApiClient(settings.GitHubPat);
                var reconciled = await db.ReconcileVerifyingAgainstBoardAsync(gh);
                if (reconciled.Count > 0)
                    ActivityLog.Log("board-sync",
                        $"Verifying board reconcile ({source}): {reconciled.Count} row(s) — " +
                        string.Join(", ", reconciled.Select(r => $"#{r.Id} (GH #{r.GithubNumber}) → {r.NewStatus} [board '{r.BoardStatus}']")));
                return reconciled.Count;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("board-sync", $"Verifying board reconcile ({source}) failed (non-fatal): {ex.Message}");
                return 0;
            }
        }
    }
}
