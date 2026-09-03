using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2685 — reconciles false-<c>done</c> queue rows against their real origin/main bookend on
    /// every manual board refresh.
    ///
    /// The problem: <see cref="QueueWatcherService"/> → <c>MarkCompleteAsync</c> is the ONLY
    /// completion signal <c>bt_build_queue</c> gets. A self-blocking session that does real
    /// investigation, writes a real <c>🛑 BLOCKED</c> bookend, wires a real GitHub <c>blocked_by</c>
    /// edge, and exits cleanly (process exit 0 — nothing crashed) is marked <c>done</c>, a terminal
    /// status. But <c>done</c> is in NONE of the dedup dead-checks (RefreshAsync treats only
    /// failed/canceled as "let it reappear"; QueueRowAsync keys on IsTerminalStatus &amp;&amp; !done),
    /// so a false-<c>done</c> row silently, permanently dedup-locks every future dispatch for that
    /// issue — with no path back except Shane manually finding and Parking it.
    ///
    /// The fix: on the manual refresh cascade (wired off <c>BoardRefreshCompleted</c> in MainWindow,
    /// the same event #1813/#2557 ride), read every <c>done</c> row's authoritative bookend via
    /// <see cref="DoneBookendVerifier.GetBlockedAsync"/> (the trusted origin/main
    /// <c>build-journal/{N}.md</c> reader). Any row whose bookend's effective <c>**Status:**</c> says
    /// BLOCKED is a false-<c>done</c>: reset it to <c>canceled</c> (a real non-blocking terminal
    /// state that flows through every dedup dead-check, so the issue is re-dispatchable) via the
    /// dedicated <see cref="BuildQueuePostgresClient.MarkFalseDoneReconciledAsync"/>, and move its
    /// GitHub board Status to <c>Backlog</c> — Shane's explicit resting place, because an unblocked
    /// self-blocked build needs a conscious re-dispatch decision, not an auto-relaunch the moment its
    /// blocker closes. Every correction is logged (never silent).
    /// </summary>
    public static class FalseDoneReconciler
    {
        /// <summary>
        /// Runs one reconciliation pass. Returns the number of rows actually reset this pass.
        /// Never throws into the caller — a reconciliation failure is logged, not propagated, so it
        /// can never break the board-refresh cascade it rides on.
        /// </summary>
        public static async Task<int> ReconcileAsync(BuildQueuePostgresClient db, GitHubApiClient gh, Action<string> log)
        {
            if (db == null) return 0;

            List<(int Id, int GithubNumber)> doneRows;
            try
            {
                doneRows = await db.GetDoneGithubRowsAsync();
            }
            catch (Exception ex)
            {
                log($"Git #2685 false-done reconcile: could not read done rows: {ex.Message}");
                return 0;
            }
            if (doneRows.Count == 0) return 0;

            HashSet<int> blocked;
            try
            {
                blocked = await DoneBookendVerifier.GetBlockedAsync(doneRows.Select(r => r.GithubNumber).Distinct());
            }
            catch (Exception ex)
            {
                log($"Git #2685 false-done reconcile: bookend check failed: {ex.Message}");
                return 0;
            }
            if (blocked.Count == 0) return 0;

            int reconciled = 0;
            foreach (var row in doneRows.Where(r => blocked.Contains(r.GithubNumber)))
            {
                try
                {
                    int changed = await db.MarkFalseDoneReconciledAsync(row.Id);
                    if (changed == 0)
                        continue; // already moved on (concurrent watcher/refresh) — nothing to do

                    reconciled++;

                    bool moved = false;
                    try
                    {
                        moved = await gh.SetIssueStatusByNumberAsync(row.GithubNumber, GitHubApiClient.BacklogOptionId);
                    }
                    catch (Exception ex)
                    {
                        log($"Git #2685 false-done reconcile: #{row.GithubNumber} DB reset to 'canceled', but board move to Backlog FAILED: {ex.Message}");
                    }

                    log($"Git #2685 false-done reconcile: queue row {row.Id} (#{row.GithubNumber}) was 'done' " +
                        $"but its origin/main bookend says BLOCKED — reset to 'canceled' (re-dispatchable) " +
                        (moved ? "and board Status moved to Backlog." : "(board move to Backlog did not confirm — see above)."));
                }
                catch (Exception ex)
                {
                    log($"Git #2685 false-done reconcile: FAILED for row {row.Id} (#{row.GithubNumber}): {ex.Message}");
                }
            }

            return reconciled;
        }
    }
}
