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

            // ── Shape D (Git #3607): terminal 'canceled' rows with no real pruning mechanism ─────────────
            // Two independent rules, both a SOFT ARCHIVE (bt_build_queue.archived/archived_at, matching
            // bt_chats' existing exact pattern) rather than a delete — the row and its full history stay
            // real and queryable; this only drops it out of the default Canceled board view. Deliberately
            // run here, BEFORE the open-issue snapshot fetch below (and its several fail-closed early
            // returns for Shape B/C) — neither rule below depends on that fetch, so a snapshot hiccup must
            // never also suppress this independent pass.
            //   • Rule B (no real GitHub issue at all — null, or the Git #1645 negative "local #N"
            //     sentinel): archived directly, nothing to check.
            //   • Rule A (a real GitHub issue, confirmed CLOSED): prefers bt_issue_mirror; falls back to a
            //     live single-issue check when the mirror has no record or looks stale, per the issue's
            //     own explicit rule. Never archives on ambiguous/missing state data.
            // Overlaps in scope, not in effect, with Shape C below (Git #3521, which already flips a
            // canceled+github-linked+closed-issue row to status='superseded' off the open-issue snapshot):
            // Shape C runs later in this same pass and will usually already have claimed anything Rule A
            // would also catch (its row no longer matches status='canceled' by the time Rule A's own query
            // below runs) — Rule A is not dead code, it is the mirror-preferred, snapshot-independent net
            // for whatever Shape C's approach misses, and both write through the same idempotent
            // status='canceled' guard so there is no double-processing risk either way.
            try
            {
                reconciled += await ArchiveCanceledNoIssueRowsAsync(db, log, actions);
            }
            catch (Exception ex)
            {
                log($"Git #3607 canceled-archive (Rule B, no issue): FAILED reading candidate rows: {ex.Message}");
            }

            try
            {
                reconciled += await ArchiveCanceledClosedIssueRowsAsync(db, gh, log, actions);
            }
            catch (Exception ex)
            {
                log($"Git #3607 canceled-archive (Rule A, closed issue): FAILED reading candidate rows: {ex.Message}");
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

            // ── Shape C (Git #3521): stale 'canceled' rows whose GitHub issue is now CLOSED ─────────────
            // A second, distinct finding on #3521: rows sit in 'canceled' for GitHub issues that were
            // fully resolved on GitHub (often weeks ago) — nothing ever reconciled them once their issue
            // closed, so they linger in the Canceled list as if they were current, actionable canceled
            // work (measured live: 21 such rows). Distinct from the #3459 case (a RECENT supervisory
            // cancel whose blocker just cleared and should auto-requeue — that is QueueRowAsync's job, not
            // this pass): here the issue is already CLOSED, so the work is done/decided and the honest move
            // is to drop the row out of the active Canceled list. Reuses the SAME trustworthy open-issue
            // snapshot fetched above (a canceled row whose real, positive github_number is absent from it
            // is closed); fail-closed by construction — this only runs after the Success + non-empty guards
            // above. Moves the row 'canceled' → 'superseded' (resolved-elsewhere, invisible to every dedup
            // dead-check — correct for a closed issue), never touching the GitHub board, exactly like the
            // #2136 Dismiss path.
            try
            {
                var canceledRows = await db.GetCanceledGithubRowsAsync();
                foreach (var row in canceledRows.Where(r => !open.Contains(r.GithubNumber)))
                {
                    try
                    {
                        int changed = await db.MarkCanceledResolvedClosedAsync(row.Id);
                        if (changed == 0) continue; // concurrently moved on
                        reconciled++;
                        string reason = $"Queue row {row.Id} (#{row.GithubNumber}) was 'canceled' but GH " +
                            $"#{row.GithubNumber} is CLOSED (resolved on GitHub) — stale local state that was still " +
                            "showing as current canceled work. Moved 'canceled' → 'superseded' so it drops out of the " +
                            "active Canceled list. Git #3521.";
                        log("Git #3521 stale-canceled reconcile: " + reason);
                        actions.Add(new ReconciliationNotice
                        {
                            IssueNumber = row.GithubNumber,
                            QueueRowId = row.Id,
                            PreviousStatus = "canceled",
                            Kind = ReconciliationActionKind.StaleCanceledResolved,
                            BoardMovedToBacklog = false,
                            Reason = reason,
                        });
                    }
                    catch (Exception ex)
                    {
                        log($"Git #3521 stale-canceled reconcile: FAILED for row {row.Id} (#{row.GithubNumber}): {ex.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                log($"Git #3521 stale-canceled reconcile: could not read canceled rows ({ex.Message}) — skipping this pass (fail soft).");
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

        /// <summary>Git #3607, Rule B — how long a bt_issue_mirror record is trusted before Rule A falls
        /// back to a live check instead. Matches the existing 30-minute staleness convention this
        /// codebase already uses elsewhere (<see cref="UsageAutomationService.StaleAfter"/>) — the
        /// mirror's own incremental sync runs on a 5-minute persisted interval when healthy, so 30
        /// minutes comfortably covers a normal cycle or two before treating a record as untrustworthy.</summary>
        private static readonly TimeSpan MirrorStaleAfter = TimeSpan.FromMinutes(30);

        /// <summary>
        /// Git #3607, Rule B — every terminal 'canceled' row with NO real GitHub issue at all is
        /// soft-archived directly; there is nothing to check on GitHub. Idempotent via
        /// <see cref="BuildQueuePostgresClient.ArchiveCanceledQueueRowAsync"/>'s own guard.
        /// </summary>
        private static async Task<int> ArchiveCanceledNoIssueRowsAsync(BuildQueuePostgresClient db, Action<string> log, List<ReconciliationNotice> actions)
        {
            var ids = await db.GetCanceledUnarchivedNoIssueRowIdsAsync();
            int count = 0;
            foreach (var id in ids)
            {
                try
                {
                    int changed = await db.ArchiveCanceledQueueRowAsync(id);
                    if (changed == 0) continue; // already moved on (concurrent watcher/refresh) — nothing to do
                    count++;
                    string reason = $"Queue row {id} was 'canceled' with no real GitHub issue at all (null, or the " +
                        "Git #1645 negative \"local #N\" sentinel) — nothing to check on GitHub, archived directly " +
                        "(soft, not deleted; row stays queryable).";
                    log("Git #3607 canceled-archive (Rule B, no issue): " + reason);
                    actions.Add(new ReconciliationNotice
                    {
                        IssueNumber = 0,
                        QueueRowId = id,
                        PreviousStatus = "canceled",
                        Kind = ReconciliationActionKind.CanceledArchivedNoIssue,
                        BoardMovedToBacklog = false,
                        Reason = reason,
                    });
                }
                catch (Exception ex)
                {
                    log($"Git #3607 canceled-archive (Rule B, no issue): FAILED for row {id}: {ex.Message}");
                }
            }
            return count;
        }

        /// <summary>
        /// Git #3607, Rule A — every terminal 'canceled' row with a real GitHub issue number is checked
        /// against that issue's real state and soft-archived only on a CONFIRMED close. Prefers
        /// <see cref="GitHubIssueMirror"/> when it has a fresh-enough record; falls back to a real live
        /// single-issue check (<see cref="GitHubApiClient.GetIssueAsync"/>) when the mirror has no record
        /// or is older than <see cref="MirrorStaleAfter"/>. Never archives on ambiguous or missing state
        /// data — a mirror miss AND a failed/not-found live check simply leaves the row alone, logged.
        /// </summary>
        private static async Task<int> ArchiveCanceledClosedIssueRowsAsync(BuildQueuePostgresClient db, GitHubApiClient gh, Action<string> log, List<ReconciliationNotice> actions)
        {
            var rows = await db.GetCanceledUnarchivedWithIssueRowsAsync();
            if (rows.Count == 0) return 0;

            var mirrored = await GitHubIssueMirror.GetManyAsync(rows.Select(r => r.GithubNumber).Distinct().ToList());
            var nowUtc = DateTime.UtcNow;
            int count = 0;

            foreach (var row in rows)
            {
                try
                {
                    bool closed;
                    string source;

                    if (mirrored.TryGetValue(row.GithubNumber, out var mirror) && (nowUtc - mirror.LastSyncedAt) <= MirrorStaleAfter)
                    {
                        closed = mirror.IsClosed;
                        source = $"bt_issue_mirror (synced {mirror.LastSyncedAt:u})";
                    }
                    else if (gh != null)
                    {
                        // Mirror missing or stale (the mirror's own real, known coverage/freshness gaps) —
                        // fall back to a live check rather than guessing or skipping silently.
                        var live = await gh.GetIssueAsync(row.GithubNumber);
                        if (live == null)
                        {
                            log($"Git #3607 canceled-archive (Rule A): #{row.GithubNumber} — mirror missing/stale AND live check failed/not-found; leaving row {row.Id} alone (never archive on ambiguous data).");
                            continue;
                        }
                        closed = string.Equals(live.State, "closed", StringComparison.OrdinalIgnoreCase);
                        source = "live GitHub check (mirror missing/stale)";
                    }
                    else
                    {
                        log($"Git #3607 canceled-archive (Rule A): #{row.GithubNumber} — mirror missing/stale and no GitHub client available; leaving row {row.Id} alone (never archive on ambiguous data).");
                        continue;
                    }

                    if (!closed)
                        continue; // confirmed open, or genuinely undetermined — never archived

                    int changed = await db.ArchiveCanceledQueueRowAsync(row.Id);
                    if (changed == 0) continue; // already moved on — e.g. Shape C already superseded this exact row
                    count++;
                    string archiveReason = $"Queue row {row.Id} (#{row.GithubNumber}) was 'canceled' and GH #{row.GithubNumber} " +
                        $"is confirmed CLOSED via {source} — archived (soft, not deleted; row stays queryable).";
                    log("Git #3607 canceled-archive (Rule A, closed issue): " + archiveReason);
                    actions.Add(new ReconciliationNotice
                    {
                        IssueNumber = row.GithubNumber,
                        QueueRowId = row.Id,
                        PreviousStatus = "canceled",
                        Kind = ReconciliationActionKind.CanceledArchivedClosedIssue,
                        BoardMovedToBacklog = false,
                        Reason = archiveReason,
                    });
                }
                catch (Exception ex)
                {
                    log($"Git #3607 canceled-archive (Rule A, closed issue): FAILED for row {row.Id} (#{row.GithubNumber}): {ex.Message}");
                }
            }
            return count;
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
