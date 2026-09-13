using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3661 — a real, periodic sweep that live-checks every self-blocked "⏳ WAITING" row
    /// (<c>status='canceled' AND exit_code=0</c>, a real GitHub <c>blocked_by</c> edge wired up —
    /// see <c>BuildQueuePanel.IsWaitingSelfBlocked</c>) against its declared blockers, and
    /// auto-requeues it the moment every one of them is confirmed closed.
    ///
    /// Real, confirmed gap this closes: nothing in this app ever automatically re-queued a
    /// self-blocked WAITING item once its real declared blockers closed — a WAITING row was a
    /// dead end unless someone happened to notice and manually re-dispatched it. Confirmed live
    /// on #3420: it self-blocked on #3419 (Git #1987 pattern), #3419 genuinely closed, and
    /// #3420 sat WAITING with zero automatic recovery.
    ///
    /// All the real decision logic (which rows qualify, what "closed" means — GitHub state OR a
    /// verified DONE bookend, Git #2225 — and fail-closed on an unreachable GitHub) lives in
    /// <see cref="BuildQueuePostgresClient.SweepAutoRequeueWaitingAsync"/>; this class is
    /// triggering only.
    ///
    /// Git #3777 — this used to arm an unconditional 5-minute <see cref="Timer"/> from
    /// <see cref="StartAsync"/>, making a real `gh issue list` call on a clock for the app's
    /// entire runtime whenever at least one row was self-blocked. Found by #3774's own requested
    /// audit for remaining automatic GitHub-touching timers ("no automatic timers, period —
    /// everything waits for a real completion event or manual refresh") and fixed the same way
    /// #3774 fixed <see cref="QueueWatcherService"/>'s claim-check timer: the timer is gone, and
    /// <see cref="RunSweepAsync"/> now fires only off two real triggers, wired by the caller (see
    /// <c>MainWindow</c>):
    /// 1. <see cref="QueueWatcherService.BuildFinished"/> — a build actually completing is a
    ///    plausible moment for some other row's declared blocker to have just closed.
    /// 2. The manual refresh path (<c>LeftSidebar.BoardRefreshCompleted</c>, the same #3767
    ///    trigger <see cref="QueueWatcherService.RequestImmediateReevaluation"/> uses).
    /// <see cref="Interlocked"/> overlap guard retained so a slow scan (real `gh` call) can't
    /// pile up concurrent runs if both triggers land close together; honest
    /// <see cref="ActivityLog"/> logging of every real requeue is unchanged.
    /// </summary>
    public class WaitingRowAutoRequeueService
    {
        private readonly BuildQueuePostgresClient? _db;
        private int _sweepRunning; // 0/1 guard so a slow scan can't overlap a concurrent trigger

        /// <summary>Raised after a sweep actually auto-requeued row(s) (count) — lets the Build Queue panel refresh.</summary>
        public event Action<int>? AutoRequeued;

        public WaitingRowAutoRequeueService(BuildQueuePostgresClient? db)
        {
            _db = db;
        }

        /// <summary>
        /// Git #3777 — no more periodic timer to arm. Call once at app startup (after the DB
        /// client exists) to run the one-shot initial sweep (catches whatever's already
        /// unblocked at app open); everything after that is event-driven via
        /// <see cref="TriggerSweep"/>.
        /// </summary>
        public Task StartAsync()
        {
            ActivityLog.Log("auto-requeue", "Git #3777: self-blocked WAITING auto-requeue sweep armed — event-driven only (a tracked build finishing, or a manual board refresh), no automatic timer.");
            TriggerSweep();
            return Task.CompletedTask;
        }

        /// <summary>
        /// Git #3777 — the one real entry point into <see cref="RunSweepAsync"/> now that there's
        /// no timer. Fire-and-forget, safe to call from either of the two real triggers described
        /// on the class doc comment (or the one-shot startup call above).
        /// </summary>
        public void TriggerSweep()
        {
            _ = RunSweepAsync();
        }

        private async Task RunSweepAsync()
        {
            if (_db == null) return;
            // Guard against overlap if a scan ever runs long (slow `gh` call) — skip this tick
            // rather than pile up concurrent live-GitHub checks.
            if (Interlocked.Exchange(ref _sweepRunning, 1) == 1) return;
            try
            {
                var (requeued, scanned, reachable) = await _db.SweepAutoRequeueWaitingAsync();
                if (!reachable || scanned == 0) return;

                if (requeued.Count > 0)
                {
                    foreach (var r in requeued)
                    {
                        var issueRef = r.Item.GithubNumber is int g && g > 0 ? $"#{g}" : $"queue #{r.Item.Id}";
                        ActivityLog.Log("auto-requeue",
                            $"Git #3661: auto-requeued {issueRef} ({r.Item.Title}) — declared blocker(s) {string.Join(", ", r.ClearedBlockers.Select(b => $"#{b}"))} confirmed closed.");
                    }
                    try { AutoRequeued?.Invoke(requeued.Count); } catch { }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("auto-requeue", $"Git #3777: sweep failed: {ex.Message} — will retry on the next real trigger (a tracked build finishing, or a manual board refresh).");
            }
            finally
            {
                Interlocked.Exchange(ref _sweepRunning, 0);
            }
        }

        /// <summary>Git #3777 — no timer to dispose anymore; kept as a no-op so existing callers don't need changing.</summary>
        public void Dispose()
        {
        }
    }
}
