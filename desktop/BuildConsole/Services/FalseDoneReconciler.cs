using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2685, widened by #2775, widened again by #3513 — reconciles false-<c>done</c>/false-<c>verifying</c>
    /// queue rows against reality on every manual board refresh. There are now TWO distinct false-positive
    /// shapes this catches, both produced by the same root truth: a local queue-row status is NOT the same
    /// thing as the real GitHub issue's state, and has repeatedly been trusted as if it were.
    ///
    /// ── Shape A (Git #2685/#2775) — the BLOCKED bookend ────────────────────────────────────────────────
    /// <see cref="QueueWatcherService"/> → <c>MarkCompleteAsync</c> is the ONLY completion signal
    /// <c>bt_build_queue</c> gets. A self-blocking session that does real investigation, writes a real
    /// <c>🛑 BLOCKED</c> bookend, wires a real GitHub <c>blocked_by</c> edge, and exits cleanly (process
    /// exit 0 — nothing crashed) is marked <c>done</c> (no <c>github_number</c>) or, per Git #1469,
    /// <c>verifying</c> (a real <c>github_number</c> is present). Neither is in the dedup dead-checks, so the
    /// row silently, permanently dedup-locks that issue. Fix: any row whose origin/main bookend's effective
    /// <c>**Status:**</c> says BLOCKED is reset to <c>canceled</c> (re-dispatchable) + board Status → Backlog.
    ///
    /// ── Shape B (Git #3513) — the false PROMOTION (done, but the issue is still OPEN) ────────────────────
    /// A row with a real <c>github_number</c> should only ever reach terminal <c>done</c> AFTER
    /// <see cref="BuildQueuePostgresClient.PromoteVerifyingToDoneAsync"/> confirmed its GitHub issue actually
    /// closed (#1469). That confirmation is "the issue number is ABSENT from the open-issue snapshot" — which
    /// is only sound if the snapshot is trustworthy. During the #3512 rate-limit storm the snapshot came back
    /// EMPTY, and MainWindow's Home reconcile fetched it with the old default 500-cap while &gt;600 issues were
    /// open, so genuinely-open issues went missing from the set and every verifying row for them was promoted
    /// to <c>done</c> against an issue that never closed. Result (measured live for #3513): 69 rows sitting at
    /// <c>done</c> with the real GitHub issue still open — invisible in Batter Up (hidden as "tracked"), past
    /// Verifying/Running locally, with the real work in many cases never landed. Shape A never caught these:
    /// their bookend does not say BLOCKED (most say DONE, or have no bookend at all), and nothing else looked
    /// at a <c>done</c> row's real issue state.
    ///
    /// The unambiguous Shape-B signal is <c>status='done'</c> + a real <c>github_number</c> + that issue
    /// CURRENTLY OPEN (a <c>verifying</c> row whose issue is open is the CORRECT waiting state and is left
    /// alone). Each such row is then split by whether real work actually landed, using the exact git-verified
    /// DONE-bookend check the dispatch gate already trusts (<see cref="DoneBookendVerifier.GetSatisfiedAsync"/>
    /// — a real <c>build-journal/{N}.md</c> whose Status is DONE and whose cited commit is a real ancestor of
    /// origin/main):
    ///   • Verified DONE bookend (work genuinely landed, the issue just was not really closed) → revert to
    ///     <c>verifying</c> (<see cref="BuildQueuePostgresClient.RevertFalseDoneToVerifyingAsync"/>). It becomes
    ///     visible in the active queue again and, crucially, is NOT re-dispatched — re-running completed work is
    ///     waste; the next promote pass moves it to real done once the issue actually closes.
    ///   • No verified DONE bookend (no bookend at all, or a DONE claim whose commit is not on main, or an
    ///     IN FLIGHT/other non-DONE effective status) → the work never landed → reset to <c>canceled</c> +
    ///     board Status → Backlog, exactly like Shape A, so it genuinely resurfaces as re-dispatchable work
    ///     instead of vanishing into a done-but-not-done black hole.
    ///
    /// Fail-closed throughout: an unreachable GitHub (open-issue fetch fails) SKIPS Shape-B entirely this pass
    /// rather than guessing — never releases or cancels on bad data. Every correction is logged (never silent).
    /// This does not fix the root generator on its own; #3513 also added the empty-set guard inside
    /// PromoteVerifyingToDoneAsync and raised MainWindow's fetch cap — this reconciler is the backstop that
    /// heals rows already poisoned and any that slip past a partial (non-empty) snapshot.
    /// </summary>
    public static class FalseDoneReconciler
    {
        // Git #3513 — the open-issue snapshot cap for Shape-B detection. Must sit comfortably above the real
        // open-issue count (>600 for this repo) so a genuinely-open issue is never truncated out of the set
        // and thereby misread as closed. `gh issue list` pages in 100s and stops when exhausted, so a high
        // cap costs no extra pages in practice — it only removes the truncation cliff the old 500 default hit.
        private const int OpenIssueSnapshotLimit = 5000;

        /// <summary>
        /// Runs one reconciliation pass. Returns a <see cref="ReconciliationResult"/> carrying both the
        /// count of rows actually corrected this pass (Shape A cancels + Shape B reverts/cancels) AND a
        /// structured, per-row list of every real action taken (Git #3518 — so the caller can surface a
        /// visible, click-through notification, not just the ActivityLog lines this still writes exactly as
        /// before). Never throws into the caller — a reconciliation failure is logged, not propagated, so
        /// it can never break the board-refresh cascade it rides on.
        /// </summary>
        public static async Task<ReconciliationResult> ReconcileAsync(BuildQueuePostgresClient db, GitHubApiClient gh, Action<string> log)
        {
            var actions = new List<ReconciliationNotice>();
            if (db == null) return new ReconciliationResult(0, actions);

            List<(int Id, int GithubNumber, string Status)> candidateRows;
            try
            {
                candidateRows = await db.GetDoneOrVerifyingGithubRowsAsync();
            }
            catch (Exception ex)
            {
                log($"Git #2685/#2775/#3513 false-done reconcile: could not read done/verifying rows: {ex.Message}");
                return new ReconciliationResult(0, actions);
            }
            if (candidateRows.Count == 0) return new ReconciliationResult(0, actions);

            int reconciled = 0;

            // ── Shape A (Git #2685/#2775): rows whose origin/main bookend says BLOCKED ──────────────────
            HashSet<int> blocked;
            try
            {
                blocked = await DoneBookendVerifier.GetBlockedAsync(candidateRows.Select(r => r.GithubNumber).Distinct());
            }
            catch (Exception ex)
            {
                log($"Git #2685/#2775 false-done reconcile: bookend check failed: {ex.Message}");
                blocked = new HashSet<int>();
            }

            foreach (var row in candidateRows.Where(r => blocked.Contains(r.GithubNumber)))
            {
                try
                {
                    int changed = await db.MarkFalseDoneReconciledAsync(row.Id);
                    if (changed == 0)
                        continue; // already moved on (concurrent watcher/refresh) — nothing to do

                    reconciled++;
                    bool moved = await TryMoveToBacklogAsync(gh, row.GithubNumber, log);
                    string reason = $"Queue row {row.Id} (#{row.GithubNumber}) was '{row.Status}' but its origin/main " +
                        "bookend says BLOCKED — reset to 'canceled' (re-dispatchable) " +
                        (moved ? "and board Status moved to Backlog." : "(board move to Backlog did NOT confirm).");
                    log("Git #2685/#2775 false-done reconcile: " + reason);
                    actions.Add(new ReconciliationNotice
                    {
                        IssueNumber = row.GithubNumber,
                        QueueRowId = row.Id,
                        PreviousStatus = row.Status,
                        Kind = ReconciliationActionKind.BlockedReset,
                        BoardMovedToBacklog = moved,
                        Reason = reason,
                    });
                }
                catch (Exception ex)
                {
                    log($"Git #2685/#2775 false-done reconcile: FAILED for row {row.Id} (#{row.GithubNumber}): {ex.Message}");
                }
            }

            // ── Shape B (Git #3513): rows at 'done' whose real GitHub issue is still OPEN ───────────────
            // A verifying row whose issue is open is the CORRECT waiting state, so this considers 'done'
            // rows only. Skip a row already handled by Shape A above (its bookend said BLOCKED).
            LiveOpenIssuesResult openResult;
            try
            {
                openResult = await GitHubIssuesService.TryGetOpenIssueNumbersAsync(OpenIssueSnapshotLimit);
            }
            catch (Exception ex)
            {
                log($"Git #3513 false-done reconcile: open-issue fetch threw ({ex.Message}) — skipping done+open detection this pass (fail closed).");
                return new ReconciliationResult(reconciled, actions);
            }
            if (!openResult.Success)
            {
                log($"Git #3513 false-done reconcile: couldn't fetch the open-issue set ({openResult.Error}) — skipping done+open detection this pass (fail closed; no row cancelled or reverted on unverified data).");
                return new ReconciliationResult(reconciled, actions);
            }
            var open = openResult.OpenNumbers;
            if (open.Count == 0)
            {
                // A successful fetch that is genuinely empty is implausible for this repo and matches the
                // failure shape the source guard already rejects — treat it as untrustworthy and skip.
                log("Git #3513 false-done reconcile: open-issue set came back empty on a 'successful' fetch — treating as untrustworthy, skipping done+open detection this pass (fail closed).");
                return new ReconciliationResult(reconciled, actions);
            }

            var doneOpenRows = candidateRows
                .Where(r => string.Equals(r.Status, "done", StringComparison.OrdinalIgnoreCase)
                            && !blocked.Contains(r.GithubNumber)
                            && open.Contains(r.GithubNumber))
                .ToList();
            if (doneOpenRows.Count == 0)
                return new ReconciliationResult(reconciled, actions);

            // The subset whose real work genuinely landed (git-verified DONE bookend). Everything else in
            // doneOpenRows had no proof of landed work and is re-dispatched.
            HashSet<int> verifiedDone;
            try
            {
                verifiedDone = await DoneBookendVerifier.GetSatisfiedAsync(doneOpenRows.Select(r => r.GithubNumber).Distinct());
            }
            catch (Exception ex)
            {
                log($"Git #3513 false-done reconcile: DONE-bookend verification failed ({ex.Message}) — skipping done+open remediation this pass (fail closed).");
                return new ReconciliationResult(reconciled, actions);
            }

            foreach (var row in doneOpenRows)
            {
                try
                {
                    if (verifiedDone.Contains(row.GithubNumber))
                    {
                        // Work really landed; the issue simply was not actually closed. Honest state is
                        // verifying (visible, awaiting Shane's close) — NOT re-dispatch of completed work.
                        int changed = await db.RevertFalseDoneToVerifyingAsync(row.Id);
                        if (changed == 0) continue; // concurrently moved on
                        reconciled++;
                        string reason = $"Queue row {row.Id} (#{row.GithubNumber}) was 'done' but GH #{row.GithubNumber} is STILL OPEN " +
                            "while its origin/main bookend is a git-verified DONE — the issue was never really closed (false promotion). " +
                            "Reverted 'done' → 'verifying' so it is visible and awaiting the real close, not silently hidden or re-run.";
                        log("Git #3513 false-done reconcile: " + reason);
                        actions.Add(new ReconciliationNotice
                        {
                            IssueNumber = row.GithubNumber,
                            QueueRowId = row.Id,
                            PreviousStatus = row.Status,
                            Kind = ReconciliationActionKind.FalseDoneReverted,
                            BoardMovedToBacklog = false,
                            Reason = reason,
                        });
                    }
                    else
                    {
                        // No proof the work ever landed (no bookend, DONE claim not on main, or non-DONE
                        // effective status). Re-dispatchable, exactly like the BLOCKED shape.
                        int changed = await db.MarkFalseDoneReconciledAsync(row.Id);
                        if (changed == 0) continue; // concurrently moved on
                        reconciled++;
                        bool moved = await TryMoveToBacklogAsync(gh, row.GithubNumber, log);
                        string reason = $"Queue row {row.Id} (#{row.GithubNumber}) was 'done' but GH #{row.GithubNumber} is STILL OPEN " +
                            "and has NO git-verified DONE bookend (no bookend, or a DONE claim whose commit is not on origin/main) — " +
                            "the work never landed (false promotion). Reset 'done' → 'canceled' (re-dispatchable) " +
                            (moved ? "and board Status moved to Backlog." : "(board move to Backlog did NOT confirm).");
                        log("Git #3513 false-done reconcile: " + reason);
                        actions.Add(new ReconciliationNotice
                        {
                            IssueNumber = row.GithubNumber,
                            QueueRowId = row.Id,
                            PreviousStatus = row.Status,
                            Kind = ReconciliationActionKind.FalseDoneReset,
                            BoardMovedToBacklog = moved,
                            Reason = reason,
                        });
                    }
                }
                catch (Exception ex)
                {
                    log($"Git #3513 false-done reconcile: FAILED for row {row.Id} (#{row.GithubNumber}): {ex.Message}");
                }
            }

            return new ReconciliationResult(reconciled, actions);
        }

        /// <summary>
        /// Moves an issue's board Status to Backlog (Shane's conscious re-dispatch resting place — never an
        /// auto-relaunch). Returns whether the move confirmed; logs and returns false on failure without
        /// throwing, so a board-move hiccup never undoes the DB reset that already succeeded.
        /// </summary>
        private static async Task<bool> TryMoveToBacklogAsync(GitHubApiClient gh, int githubNumber, Action<string> log)
        {
            if (gh == null) return false;
            try
            {
                return await gh.SetIssueStatusByNumberAsync(githubNumber, GitHubApiClient.BacklogOptionId);
            }
            catch (Exception ex)
            {
                log($"false-done reconcile: #{githubNumber} DB reset succeeded, but board move to Backlog FAILED: {ex.Message}");
                return false;
            }
        }
    }

    /// <summary>
    /// Git #3518 — the outcome of one <see cref="FalseDoneReconciler.ReconcileAsync"/> pass: the count of
    /// rows corrected (unchanged semantics from the old <c>int</c> return) plus the structured, per-row
    /// list of every real action taken, so the caller can persist and surface a visible, click-through
    /// notification instead of the action only ever existing as an ActivityLog line.
    /// </summary>
    public sealed class ReconciliationResult
    {
        public int Count { get; }
        public IReadOnlyList<ReconciliationNotice> Actions { get; }

        public ReconciliationResult(int count, IReadOnlyList<ReconciliationNotice> actions)
        {
            Count = count;
            Actions = actions ?? new List<ReconciliationNotice>();
        }
    }
}
