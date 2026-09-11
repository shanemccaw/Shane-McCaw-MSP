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
    /// Mirrors <see cref="SessionLimitAutoRestartService"/>'s Git #3573 periodic-sweep shape
    /// exactly: a <see cref="Timer"/> armed unconditionally from <see cref="StartAsync"/>, an
    /// <see cref="Interlocked"/> overlap guard so a slow tick can't pile up concurrent scans, and
    /// honest <see cref="ActivityLog"/> logging of every real requeue (row id, issue number,
    /// which blocker(s) cleared) on its own dedicated channel. All the real decision logic
    /// (which rows qualify, what "closed" means — GitHub state OR a verified DONE bookend, Git
    /// #2225 — and fail-closed on an unreachable GitHub) lives in
    /// <see cref="BuildQueuePostgresClient.SweepAutoRequeueWaitingAsync"/>; this class is
    /// scheduling only, exactly like #3573's split between the log-sweep method and its timer.
    /// </summary>
    public class WaitingRowAutoRequeueService
    {
        /// <summary>
        /// Same cadence as #3573's fallback sweep — the established "every 5 minutes"
        /// background-poll convention already used elsewhere in this app (GitHubIssueMirror's
        /// live ALL walk, SessionLimitAutoRestartService's own periodic sweep) rather than
        /// inventing a new interval. One `gh issue list` call per tick, only when there's at
        /// least one real self-blocked WAITING row to check.
        /// </summary>
        private static readonly TimeSpan SweepInterval = TimeSpan.FromMinutes(5);

        private readonly BuildQueuePostgresClient? _db;
        private Timer? _timer;
        private int _sweepRunning; // 0/1 guard so a slow scan can't overlap the next tick

        /// <summary>Raised after a sweep actually auto-requeued row(s) (count) — lets the Build Queue panel refresh.</summary>
        public event Action<int>? AutoRequeued;

        public WaitingRowAutoRequeueService(BuildQueuePostgresClient? db)
        {
            _db = db;
        }

        /// <summary>Call once at app startup (after the DB client exists). Arms the periodic sweep unconditionally.</summary>
        public Task StartAsync()
        {
            _timer?.Dispose();
            _timer = new Timer(_ => { _ = RunSweepAsync(); }, null, SweepInterval, SweepInterval);
            ActivityLog.Log("auto-requeue", $"Git #3661: self-blocked WAITING auto-requeue sweep armed — checking every {SweepInterval.TotalMinutes:0} min.");
            return Task.CompletedTask;
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
                ActivityLog.Log("auto-requeue", $"Git #3661: automatic sweep failed: {ex.Message} — will retry on the next {SweepInterval.TotalMinutes:0}-minute tick.");
            }
            finally
            {
                Interlocked.Exchange(ref _sweepRunning, 0);
            }
        }

        public void Dispose()
        {
            _timer?.Dispose();
            _timer = null;
        }
    }
}
