using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Session-limit auto-restart — Shane: "detect 'You've hit your session limit ·
    /// resets 2:40am (America/New_York)', then 10 minutes after the reset, auto
    /// restart the builds that are paused."
    ///
    /// Three pieces, all in this one service:
    ///
    /// 1. DETECTION — <see cref="TryDetectLimitMessage"/> matches the CLI's real
    ///    session/usage-limit lines in a build's raw stdout/stderr (the text arrives
    ///    inside stream-json string values, so matching runs against the raw line;
    ///    the "·" separator is often escaped as · there, which is why the reset
    ///    label is captured off the word "resets", never the dot). QueueWatcherService
    ///    calls this on every output line and flags the RunningEntry.
    ///
    /// 2. PARKING — when a limit-flagged build's process exits, QueueWatcherService
    ///    marks the row <see cref="LimitPausedStatus"/> instead of failed (with
    ///    resume_session_id preserved, so the restart RESUMES the conversation rather
    ///    than starting over), and calls <see cref="RegisterLimitHit"/> here.
    ///
    /// 3. RESTART — RegisterLimitHit parses the reset label via the meter's existing
    ///    <see cref="ClaudeUsageMeterService.ParseResetTarget"/> ("2:40am
    ///    (America/New_York)" et al) and arms a timer, PER ACCOUNT (Git #1641 — see
    ///    below), at reset + <see cref="BuildConsoleSettings.SessionLimitAutoRestartDelayMinutes"/>
    ///    (default 10). On fire it flips every limit-paused row FOR THAT ACCOUNT back to
    ///    'queued' and, if the global queue toggle is paused, resumes it — so the very next
    ///    watcher tick relaunches them. The armed time is persisted in settings so an app
    ///    restart re-arms (or fires immediately when the moment already passed).
    ///
    /// If a build relaunches while the cap is genuinely still active, the CLI prints
    /// the limit line again immediately, the build re-parks itself and re-arms with
    /// the freshly-parsed reset — the loop is self-healing, never hot-spinning.
    ///
    /// Git #1641 — account scoping + "Build Now" override awareness:
    /// Primary and Secondary (Git #1416) have INDEPENDENT session limits, so a build hitting
    /// its limit on one account says nothing about the other. Before this, the whole arm/fire
    /// pipeline was a single global timer and a single blanket "every limit-paused row" resume
    /// with no account filter at all — a Secondary-armed timer could resume Primary's
    /// limit-paused rows (and vice versa) purely because they happened to be the furthest-out
    /// target. <see cref="_armed"/> now holds one independent timer per account, and
    /// <see cref="BuildQueuePostgresClient.ResumeLimitPausedAsync"/> is scoped to the firing
    /// account's own rows only.
    ///
    /// Separately, BuildQueuePanel's right-click "Build Now" (<see cref="RegisterManualOverride"/>)
    /// lets Shane manually force ONE limit-paused row back into the queue ahead of its account's
    /// timer. If that row is still running (or queued/verifying — not yet terminal) when the
    /// timer for the REST of its batch fires, blanket-resuming the rest risks immediately
    /// re-hitting the very limit the pause exists to avoid, since every build on one account
    /// shares that one session. <see cref="FireAsync"/> checks this before resuming and, if a
    /// manually-started sibling from the same batch is still in flight, defers — re-arming a
    /// short retry (<see cref="DeferRetryInterval"/>) instead of firing — until it reaches a
    /// terminal state.
    /// </summary>
    public class SessionLimitAutoRestartService
    {
        /// <summary>
        /// bt_build_queue.status for a build parked by a session-limit hit. Distinct
        /// from 'queued' (GetNextAsync's WHERE status = 'queued' never reclaims it)
        /// and from 'failed' (this isn't an error — it's waiting for the session
        /// limit to reset; this one resumes itself on a timer).
        /// </summary>
        public const string LimitPausedStatus = "limit-paused";

        /// <summary>
        /// The first set this feature applies to (Shane, 2026-08-28): six builds all
        /// capped off the 5-hour session limit until 2:40am America/New_York. A
        /// one-shot startup bootstrap (see <see cref="StartAsync"/>) parks their
        /// latest failed/canceled rows as limit-paused and arms the restart for
        /// that reset — after which the flag
        /// <see cref="BuildConsoleSettings.SessionLimitFirstSetBootstrapDone"/> keeps
        /// it from ever running again.
        /// </summary>
        public static readonly int[] FirstSetIssueNumbers = { 1446, 1439, 1441, 1442, 1452, 1444 };
        public const string FirstSetResetLabel = "2:40am (America/New_York)";

        /// <summary>Git #1641 — the two real account labels this service ever arms/fires for.
        /// bt_build_queue.account itself stores NULL for "primary" and the literal "secondary"
        /// string (Git #1416's own convention) — <see cref="NormalizeAccount"/> is the one place
        /// that translates between the two.</summary>
        private const string PrimaryAccount = "primary";
        private const string SecondaryAccount = "secondary";

        /// <summary>Git #1641 — how often a deferred FireAsync re-checks whether a manually
        /// force-started ("Build Now") sibling from the same batch has finished, before resuming
        /// the rest of that account's paused batch. Shane's own wording: "retrying on a short
        /// interval, e.g. every couple minutes".</summary>
        private static readonly TimeSpan DeferRetryInterval = TimeSpan.FromMinutes(2);

        private readonly BuildQueuePostgresClient? _db;
        /// <summary>Unpauses the global queue toggle when a restart fires (a capped wave usually left it paused).</summary>
        private readonly Action _resumeQueue;
        /// <summary>Raised after a restart actually re-queued rows (count) — lets the Build Queue panel refresh.</summary>
        public event Action<int>? LimitPausedResumed;

        private sealed class ArmedState
        {
            public Timer? Timer;
            public DateTime? RestartAtLocal;
            public DateTime? ResetAtLocal;
        }

        private readonly object _gate = new();
        /// <summary>Git #1641 — one independent armed timer per account ("primary"/"secondary"),
        /// replacing the single global timer this service used to have. Guarded by <see cref="_gate"/>.</summary>
        private readonly Dictionary<string, ArmedState> _armed = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>Git #1641 — ids manually force-started via "Build Now" (<see cref="RegisterManualOverride"/>),
        /// keyed by account, that FireAsync must confirm have reached a terminal state before
        /// blanket-resuming the rest of that account's batch. In-memory only — same discipline as
        /// QueueWatcherService's own _reservedSlots (Git #2106), which is also unpersisted and
        /// reconciled against DB truth rather than trusted blindly across a restart. Losing this on
        /// an app restart just means a manual override in flight is treated like any other batch
        /// member again on the next fire — a narrow, acceptable edge case, not silent data loss,
        /// since the DB status column is always the real source of truth this gets checked against.</summary>
        private readonly Dictionary<string, HashSet<int>> _manualOverrideIds = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// Git #3573 — the periodic fallback sweep's cadence. Matches the established
        /// "every 5 minutes" background-poll convention already used elsewhere in this
        /// app (e.g. <see cref="GitHubIssueMirror"/>'s live ALL walk) rather than
        /// inventing a new interval; a log-tail scan is cheap enough to run this often
        /// without being the 5-10s UI-refresh cadence a log sweep doesn't need.
        /// </summary>
        private static readonly TimeSpan PeriodicSweepInterval = TimeSpan.FromMinutes(5);
        /// <summary>Same window the old manual "Recover Session-Limit Builds" button used — how far back the sweep looks at build logs.</summary>
        private static readonly TimeSpan PeriodicSweepWindow = TimeSpan.FromHours(1);
        private Timer? _periodicSweepTimer;
        private int _periodicSweepRunning; // 0/1 guard so a slow scan can't overlap the next tick

        public SessionLimitAutoRestartService(BuildQueuePostgresClient? db, Action resumeQueue)
        {
            _db = db;
            _resumeQueue = resumeQueue;
        }

        /// <summary>Git #1641 — normalizes any account label to exactly "primary" or "secondary",
        /// mirroring UsageAutomationService.NormalizeAccount's own convention (only an explicit,
        /// case-insensitive "secondary" counts; null/empty/anything else is "primary").</summary>
        private static string NormalizeAccount(string? account) =>
            string.Equals(account?.Trim(), SecondaryAccount, StringComparison.OrdinalIgnoreCase)
                ? SecondaryAccount : PrimaryAccount;

        /// <summary>The soonest upcoming restart across BOTH accounts (null if nothing armed). The
        /// Build Queue panel's countdown banner is a single display, not one per account, so this
        /// deliberately collapses to whichever account's timer is closer — see <see cref="ResetAtLocal"/>
        /// for its matching reset moment.</summary>
        public DateTime? RestartAtLocal
        {
            get
            {
                lock (_gate)
                {
                    return _armed.Values
                        .Where(a => a.RestartAtLocal.HasValue)
                        .Select(a => a.RestartAtLocal!.Value)
                        .Cast<DateTime?>()
                        .OrderBy(d => d)
                        .FirstOrDefault();
                }
            }
        }

        /// <summary>The reset moment belonging to whichever account's restart is soonest (see <see cref="RestartAtLocal"/>).</summary>
        public DateTime? ResetAtLocal
        {
            get
            {
                lock (_gate)
                {
                    return _armed.Values
                        .Where(a => a.RestartAtLocal.HasValue)
                        .OrderBy(a => a.RestartAtLocal!.Value)
                        .FirstOrDefault()
                        ?.ResetAtLocal;
                }
            }
        }

        private DateTime? PeekResetAtLocal(string account)
        {
            lock (_gate) return _armed.TryGetValue(account, out var s) ? s.ResetAtLocal : null;
        }

        // ── 1. Detection ─────────────────────────────────────────────────────

        /// <summary>
        /// Matches the real limit lines the Claude CLI emits, e.g.
        ///   "You've hit your session limit · resets 2:40am (America/New_York)"
        ///   "Session limit reached ∙ resets 3am"
        ///   "Claude usage limit reached. Your limit will reset at ..."
        /// Deliberately does NOT match the apostrophe (it arrives as ’ in
        /// stream-json) or the middle dot (·); both are skipped over by matching
        /// the stable words around them.
        /// </summary>
        private static readonly Regex LimitRegex = new(
            @"(?:hit\s+your\s+(?:session|usage|weekly)\s+limit|(?:session|usage|5-?hour)\s+limit\s+reached)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /// <summary>Captures the human reset label after "resets"/"will reset at". Stops at a quote or backslash so a stream-json string boundary (or the next \uXXXX escape) never bleeds into the label.</summary>
        private static readonly Regex ResetLabelRegex = new(
            @"(?:resets?|will\s+reset\s+at)\s*:?\s+([^""\\\r\n]+)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /// <summary>
        /// True when this raw output line is a session/usage-limit message;
        /// <paramref name="resetLabel"/> gets the reset text ("2:40am
        /// (America/New_York)"). BOTH halves must be present — the limit phrase AND
        /// a "resets …" — matching the canonical message shape, so prose that merely
        /// mentions a limit (an agent summarizing this very feature, say) can't trip it.
        /// </summary>
        public static bool TryDetectLimitMessage(string line, out string? resetLabel)
        {
            resetLabel = null;
            if (string.IsNullOrEmpty(line) || !LimitRegex.IsMatch(line)) return false;
            var m = ResetLabelRegex.Match(line);
            if (!m.Success) return false;
            var label = m.Groups[1].Value.Trim().TrimEnd('.', ',', ';');
            if (label.Length == 0) return false;
            resetLabel = label;
            return true;
        }

        // ── 2/3. Arm + fire ──────────────────────────────────────────────────

        /// <summary>
        /// Called when a limit-hit build has been parked. Parses the reset label and
        /// arms (or re-arms) THAT ACCOUNT's restart timer. Multiple builds on the same
        /// account dying off the same cap all funnel here; the FURTHEST-out parsed reset
        /// for that account wins so the whole wave restarts together, after the cap has
        /// genuinely lifted — a different account's own armed timer is untouched (Git #1641).
        /// </summary>
        public void RegisterLimitHit(int queueId, string? resetLabel, string? account = null)
        {
            var acct = NormalizeAccount(account);
            var settings = BuildConsoleSettings.Load();
            if (!settings.SessionLimitAutoRestartEnabled)
            {
                ActivityLog.Log("session-limit", $"Queue #{queueId} ({acct}) hit the session limit (resets {resetLabel ?? "unknown"}) — auto-restart is disabled in settings, leaving it limit-paused for a manual resume.");
                return;
            }

            DateTime? resetLocal = null;
            if (!string.IsNullOrWhiteSpace(resetLabel))
            {
                try { resetLocal = ClaudeUsageMeterService.ParseResetTarget(resetLabel); }
                catch { }
            }

            // Unparseable label → retry in an hour; a premature relaunch just re-parks
            // itself with (hopefully) a parseable label next time. Never hot-spins.
            var fireAt = resetLocal.HasValue
                ? resetLocal.Value.AddMinutes(Math.Max(0, settings.SessionLimitAutoRestartDelayMinutes))
                : DateTime.Now.AddHours(1);
            if (fireAt <= DateTime.Now) fireAt = DateTime.Now.AddMinutes(1);

            Arm(acct, fireAt, resetLocal, $"queue #{queueId} ({acct}) hit the session limit (resets {resetLabel ?? "unparsed"})");
        }

        /// <summary>Arms <paramref name="account"/>'s restart timer, keeping the furthest-out target
        /// when that account already has one armed. Persists the target (per account — see
        /// <see cref="BuildConsoleSettings.SessionLimitRestartAtIsoSecondary"/>) so an app restart
        /// re-arms it. A different account's own armed state is never touched.</summary>
        private void Arm(string account, DateTime fireAtLocal, DateTime? resetAtLocal, string reason)
        {
            account = NormalizeAccount(account);
            DateTime? persistReset;
            lock (_gate)
            {
                if (!_armed.TryGetValue(account, out var state))
                {
                    state = new ArmedState();
                    _armed[account] = state;
                }
                if (state.RestartAtLocal.HasValue && state.RestartAtLocal.Value >= fireAtLocal)
                {
                    ActivityLog.Log("session-limit", $"{reason} — auto-restart already armed for {account} at {state.RestartAtLocal:ddd h:mm tt} (later than this one's {fireAtLocal:ddd h:mm tt}), keeping it.");
                    return;
                }
                state.RestartAtLocal = fireAtLocal;
                state.ResetAtLocal = resetAtLocal ?? fireAtLocal.AddMinutes(-BuildConsoleSettings.Load().SessionLimitAutoRestartDelayMinutes);
                persistReset = state.ResetAtLocal;
                state.Timer?.Dispose();
                var due = fireAtLocal - DateTime.Now;
                if (due < TimeSpan.FromSeconds(5)) due = TimeSpan.FromSeconds(5);
                state.Timer = new Timer(_ => { _ = FireAsync(account); }, null, due, Timeout.InfiniteTimeSpan);
            }

            try
            {
                var settings = BuildConsoleSettings.Load();
                var restartIso = fireAtLocal.ToString("o", CultureInfo.InvariantCulture);
                var resetIso = persistReset.HasValue ? persistReset.Value.ToString("o", CultureInfo.InvariantCulture) : "";
                if (account == SecondaryAccount)
                {
                    settings.SessionLimitRestartAtIsoSecondary = restartIso;
                    settings.SessionLimitResetAtIsoSecondary = resetIso;
                }
                else
                {
                    settings.SessionLimitRestartAtIso = restartIso;
                    settings.SessionLimitResetAtIso = resetIso;
                }
                settings.Save();
            }
            catch (Exception ex) { ActivityLog.Log("session-limit", $"Couldn't persist the armed restart time for {account}: {ex.Message}"); }

            ActivityLog.Log("session-limit", $"{reason} — auto-restart armed for {account} at {fireAtLocal:ddd MMM d, h:mm tt} (reset + delay).");
        }

        /// <summary>
        /// Git #1641 — "Build Now": called right after BuildQueuePanel's right-click override flips
        /// ONE limit-paused row back to 'queued' ahead of its account's timer (via
        /// <see cref="BuildQueuePostgresClient.RequeueLimitPausedAsync"/>). Records the id/account so
        /// that when this account's auto-restart timer eventually fires for the REST of the batch,
        /// <see cref="FireAsync"/> can check whether this manually-started sibling is still in flight
        /// and defer resuming the rest until it reaches a terminal state — see the class doc comment
        /// for why (re-hitting the exact limit the pause exists to avoid).
        /// </summary>
        public void RegisterManualOverride(int id, string? account)
        {
            var acct = NormalizeAccount(account);
            lock (_gate)
            {
                if (!_manualOverrideIds.TryGetValue(acct, out var set))
                {
                    set = new HashSet<int>();
                    _manualOverrideIds[acct] = set;
                }
                set.Add(id);
            }
            ActivityLog.Log("session-limit", $"Build Now: queue #{id} ({acct}) manually force-started ahead of the auto-restart — the rest of {acct}'s limit-paused batch will wait for it to reach a terminal state before resuming.");
        }

        /// <summary>The restart itself, for ONE account: checks for a still-in-flight manually
        /// force-started sibling first (deferring if found), then every limit-paused row FOR THIS
        /// ACCOUNT ONLY back to 'queued', global queue toggle resumed, this account's armed state
        /// cleared. A different account's own armed state/timer is untouched (Git #1641).</summary>
        private async Task FireAsync(string account)
        {
            account = NormalizeAccount(account);

            // The timer that invoked us has already fired — stop holding a handle to it, but don't
            // clear RestartAtLocal/ResetAtLocal yet: a defer below re-arms using the same reset
            // moment so the countdown display doesn't jump around.
            lock (_gate)
            {
                if (_armed.TryGetValue(account, out var state))
                {
                    state.Timer?.Dispose();
                    state.Timer = null;
                }
            }

            // Git #1641 — a manually force-started sibling from THIS SAME paused batch (via "Build
            // Now") may still be in flight. Blanket-resuming the rest while it's running risks
            // immediately re-hitting the exact limit that caused the pause, since every build on one
            // account shares that one session.
            List<int> overrideIds;
            lock (_gate)
            {
                overrideIds = _manualOverrideIds.TryGetValue(account, out var set) ? set.ToList() : new List<int>();
            }
            if (overrideIds.Count > 0 && _db != null)
            {
                List<int> stillNonTerminal;
                try { stillNonTerminal = await _db.GetNonTerminalIdsAsync(overrideIds); }
                catch (Exception ex)
                {
                    ActivityLog.Log("session-limit", $"Auto-restart for {account}: couldn't check manual-override sibling status ({ex.Message}) — deferring to be safe, retrying in {DeferRetryInterval.TotalMinutes:0} min.");
                    Arm(account, DateTime.Now.Add(DeferRetryInterval), PeekResetAtLocal(account), $"{account} auto-restart deferred (sibling status check failed)");
                    return;
                }

                // Hygiene: drop ids that have reached a terminal state so this set doesn't grow
                // unbounded across a long-running app session.
                lock (_gate)
                {
                    if (_manualOverrideIds.TryGetValue(account, out var set))
                    {
                        set.IntersectWith(stillNonTerminal);
                        if (set.Count == 0) _manualOverrideIds.Remove(account);
                    }
                }

                if (stillNonTerminal.Count > 0)
                {
                    ActivityLog.Log("session-limit", $"Auto-restart for {account} deferred — manually force-started build(s) #{string.Join(", #", stillNonTerminal)} from this batch (Build Now override) still in flight. Retrying in {DeferRetryInterval.TotalMinutes:0} min rather than resuming the rest into the same limit.");
                    Arm(account, DateTime.Now.Add(DeferRetryInterval), PeekResetAtLocal(account), $"{account} auto-restart deferred (sibling still running)");
                    return;
                }
            }

            // Really firing now — clear this account's armed state for real.
            lock (_gate) { _armed.Remove(account); }
            try
            {
                var settings = BuildConsoleSettings.Load();
                if (account == SecondaryAccount)
                {
                    settings.SessionLimitRestartAtIsoSecondary = "";
                    settings.SessionLimitResetAtIsoSecondary = "";
                }
                else
                {
                    settings.SessionLimitRestartAtIso = "";
                    settings.SessionLimitResetAtIso = "";
                }
                settings.Save();
            }
            catch { }

            int count = 0;
            try
            {
                if (_db != null)
                {
                    var resumed = await _db.ResumeLimitPausedAsync(account);
                    count = resumed.Count;
                    foreach (var item in resumed)
                        ActivityLog.Log("session-limit", $"Auto-restart ({account}): re-queued #{item.Id} ({item.Title}){(string.IsNullOrWhiteSpace(item.ResumeSessionId) ? "" : " — will resume its session")}.");
                }
                else
                {
                    ActivityLog.Log("session-limit", $"Auto-restart ({account}) fired but there is no direct DB connection — cannot re-queue limit-paused rows (HTTP-fallback mode). Resume them manually from the Build Queue panel.");
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("session-limit", $"Auto-restart ({account}) couldn't re-queue limit-paused rows: {ex.Message} — retrying in 5 minutes.");
                Arm(account, DateTime.Now.AddMinutes(5), null, $"{account} re-queue failed");
                return;
            }

            // A capped wave usually left the global queue toggle paused — resume it so
            // the freshly-queued rows actually launch on the next tick. The toggle itself
            // is app-global, not per-account, same as before Git #1641.
            try { _resumeQueue(); }
            catch (Exception ex) { ActivityLog.Log("session-limit", $"Auto-restart ({account}) couldn't resume the queue toggle: {ex.Message}"); }

            ActivityLog.Log("session-limit", count > 0
                ? $"Session-limit auto-restart fired for {account} — {count} build{(count == 1 ? "" : "s")} back in the queue."
                : $"Session-limit auto-restart fired for {account} — no limit-paused builds found to re-queue (already resumed manually?). Queue toggle resumed.");
            if (count > 0) { try { LimitPausedResumed?.Invoke(count); } catch { } }
        }

        // ── Log-sweep fallback recovery (was a manual button; now periodic — Git #3573) ──

        /// <summary>
        /// Log-sweep fallback counterpart to the live detection in QueueWatcherService.
        /// That live path only flags a build while its process is still attached to the
        /// watcher; if a build died some other way (app restart, a manual kill, a
        /// variant of the limit message the live regex saw but the reap loop didn't get
        /// to before exit) the row can be left sitting failed/canceled/held with the
        /// limit message as the last thing it ever printed, and nothing ever resumes
        /// it. This sweeps every build's raw stdout log file touched in the last
        /// <paramref name="window"/>, re-detects the same "hit your session limit ·
        /// resets …" shape via <see cref="TryDetectLimitMessage"/>, and requeues
        /// (resume, not restart-from-scratch) whatever it finds — same
        /// resume_session_id preservation as the automatic path.
        ///
        /// Unchanged by Git #1641: this already resumes ONE row at a time via
        /// <see cref="BuildQueuePostgresClient.RecoverStalledSessionLimitRowAsync"/> (never a
        /// blanket unscoped resume), so it was never the account-scoping gap FireAsync/
        /// ResumeLimitPausedAsync had.
        ///
        /// Originally triggered only by a "Recover Session-Limit Builds" button in the
        /// Build Queue panel; as of Git #3573 <see cref="StartPeriodicSweep"/> calls this
        /// same method on its own timer instead, so it now also runs with zero manual
        /// action. The button and its click handler are gone — this method itself is
        /// unchanged, just scheduled differently.
        /// </summary>
        public async Task<(List<QueueItem> Resumed, int Scanned)> ManualRecoverFromLogsAsync(TimeSpan window)
        {
            var resumed = new List<QueueItem>();
            int scanned = 0;

            if (_db == null)
            {
                ActivityLog.Log("session-limit", "Manual recover: no direct DB connection available — can't scan/requeue.");
                return (resumed, scanned);
            }

            string dir = BuildLogPaths.LogDirectory;
            if (!Directory.Exists(dir)) return (resumed, scanned);

            var cutoffUtc = DateTime.UtcNow - window;
            string[] files;
            try { files = Directory.GetFiles(dir, "queue-*.log"); }
            catch (Exception ex)
            {
                ActivityLog.Log("session-limit", $"Manual recover: couldn't list {dir}: {ex.Message}");
                return (resumed, scanned);
            }

            foreach (var file in files)
            {
                DateTime lastWriteUtc;
                try { lastWriteUtc = File.GetLastWriteTimeUtc(file); }
                catch { continue; }
                if (lastWriteUtc < cutoffUtc) continue;

                var m = Regex.Match(Path.GetFileNameWithoutExtension(file), @"^queue-(\d+)$");
                if (!m.Success) continue;
                int id = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
                scanned++;

                string tail;
                try { tail = ReadTail(file, 32 * 1024); }
                catch (Exception ex)
                {
                    ActivityLog.Log("session-limit", $"Manual recover: couldn't read log for #{id}: {ex.Message}");
                    continue;
                }

                // Walk from the end — the limit line, when present, is the last
                // meaningful thing the CLI printed before the process exited.
                string? resetLabel = null;
                bool hit = false;
                var lines = tail.Split('\n');
                for (int i = lines.Length - 1; i >= 0; i--)
                {
                    if (TryDetectLimitMessage(lines[i], out resetLabel)) { hit = true; break; }
                }
                if (!hit) continue;

                try
                {
                    var item = await _db.RecoverStalledSessionLimitRowAsync(id);
                    if (item != null)
                    {
                        resumed.Add(item);
                        ActivityLog.Log("session-limit", $"Manual recover: #{id} ({item.Title}) hit the session limit (resets {resetLabel ?? "unknown"}) — re-queued for resume.");
                    }
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("session-limit", $"Manual recover: couldn't requeue #{id}: {ex.Message}");
                }
            }

            if (resumed.Count > 0)
            {
                try { _resumeQueue(); }
                catch (Exception ex) { ActivityLog.Log("session-limit", $"Manual recover: couldn't resume the queue toggle: {ex.Message}"); }
            }

            return (resumed, scanned);
        }

        // ── Git #3573 — automatic periodic sweep (replaces the manual button) ───

        /// <summary>
        /// Starts the periodic fallback sweep: re-runs <see cref="ManualRecoverFromLogsAsync"/>
        /// on its own, every <see cref="PeriodicSweepInterval"/>, exactly as the old manual
        /// "Recover Session-Limit Builds" button did on click. This is scheduling only — the
        /// detection/scan/requeue logic itself is untouched and unduplicated; it catches
        /// whatever the live DetectSessionLimit path (still fully intact, elsewhere in this
        /// file) misses, without Shane ever having to click anything. Called once from
        /// <see cref="StartAsync"/>; idempotent (disposes any previous timer first) so it's
        /// safe even if StartAsync is ever invoked more than once.
        /// </summary>
        private void StartPeriodicSweep()
        {
            lock (_gate)
            {
                _periodicSweepTimer?.Dispose();
                _periodicSweepTimer = new Timer(_ => { _ = RunPeriodicSweepAsync(); }, null, PeriodicSweepInterval, PeriodicSweepInterval);
            }
            ActivityLog.Log("session-limit", $"Automatic session-limit recovery sweep armed — scanning the last {PeriodicSweepWindow.TotalMinutes:0} min of build logs every {PeriodicSweepInterval.TotalMinutes:0} min.");
        }

        private async Task RunPeriodicSweepAsync()
        {
            // Guard against overlap if a scan ever runs long on a slow disk — skip this
            // tick rather than pile up concurrent scans of the same log directory.
            if (Interlocked.Exchange(ref _periodicSweepRunning, 1) == 1) return;
            try
            {
                var (resumed, scanned) = await ManualRecoverFromLogsAsync(PeriodicSweepWindow);
                if (resumed.Count > 0)
                {
                    var titles = string.Join(", ", resumed.Take(4).Select(i => $"#{i.Id} {i.Title}"));
                    if (resumed.Count > 4) titles += $", +{resumed.Count - 4} more";
                    ActivityLog.Log("session-limit", $"Automatic sweep: re-queued {resumed.Count} of {scanned} scanned build log(s) for resume — {titles}.");
                    try { LimitPausedResumed?.Invoke(resumed.Count); } catch { }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("session-limit", $"Automatic sweep failed: {ex.Message} — will retry on the next {PeriodicSweepInterval.TotalMinutes:0}-minute tick.");
            }
            finally
            {
                Interlocked.Exchange(ref _periodicSweepRunning, 0);
            }
        }

        /// <summary>Reads at most the last <paramref name="maxBytes"/> bytes of a file that's still being actively written to (shared read/write access, same as the log tailer).</summary>
        private static string ReadTail(string path, int maxBytes)
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var reader = new StreamReader(fs);
            if (fs.Length > maxBytes) fs.Seek(-maxBytes, SeekOrigin.End);
            return reader.ReadToEnd();
        }

        // ── Startup ──────────────────────────────────────────────────────────

        /// <summary>
        /// Call once at app startup (after the watcher exists). Re-arms any persisted
        /// pending restart for EACH account (firing shortly if its moment already passed
        /// while the app was closed), and runs the one-shot first-set bootstrap.
        /// </summary>
        public async Task StartAsync()
        {
            // Git #3573 — arm the automatic fallback sweep unconditionally, before any of
            // the bootstrap/re-arm branches below (some of which return early) so it's
            // never skipped regardless of which path this run takes.
            StartPeriodicSweep();

            var settings = BuildConsoleSettings.Load();

            // One-shot bootstrap for the first set (see FirstSetIssueNumbers): their
            // rows predate this feature, so they're sitting failed/canceled/held —
            // park them as limit-paused and arm the 2:40am ET reset + delay.
            if (!settings.SessionLimitFirstSetBootstrapDone && _db != null)
            {
                int parked = 0;
                var parkedNums = new List<int>();
                foreach (var num in FirstSetIssueNumbers)
                {
                    try
                    {
                        if (await _db.MarkLatestRowLimitPausedForIssueAsync(num)) { parked++; parkedNums.Add(num); }
                    }
                    catch (Exception ex) { ActivityLog.Log("session-limit", $"First-set bootstrap: couldn't park Git #{num}: {ex.Message}"); }
                }
                try
                {
                    settings = BuildConsoleSettings.Load();
                    settings.SessionLimitFirstSetBootstrapDone = true;
                    settings.Save();
                }
                catch (Exception ex) { ActivityLog.Log("session-limit", $"Couldn't persist the first-set bootstrap flag: {ex.Message}"); }

                if (parked > 0)
                {
                    ActivityLog.Log("session-limit", $"First-set bootstrap: parked {parked} build(s) limit-paused (Git #{string.Join(", #", parkedNums)}) pending the {FirstSetResetLabel} reset.");
                    DateTime? reset = null;
                    try { reset = ClaudeUsageMeterService.ParseResetTarget(FirstSetResetLabel); } catch { }
                    // ParseResetTarget always returns the NEXT occurrence of a bare
                    // time-of-day — if the labeled reset already passed before this
                    // app launch, "next" is ~24h out, which is wrong: the cap has
                    // already lifted, so restart now. A 5-hour session cap can never
                    // legitimately need to wait more than ~5-6h; use 12h as the line.
                    if (reset.HasValue && reset.Value - DateTime.Now > TimeSpan.FromHours(12)) reset = DateTime.Now;
                    var fireAt = (reset ?? DateTime.Now).AddMinutes(Math.Max(0, settings.SessionLimitAutoRestartDelayMinutes));
                    if (fireAt <= DateTime.Now) fireAt = DateTime.Now.AddMinutes(1);

                    // Git #1641 — arm per the ACTUAL account of each just-parked row rather than
                    // assuming primary: this bootstrap predates account scoping, but reading the
                    // real account column keeps it correct if it's ever re-run against secondary rows.
                    var accountsInvolved = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { PrimaryAccount };
                    try
                    {
                        var stillPaused = await _db.GetLimitPausedAsync();
                        var found = stillPaused
                            .Where(i => i.GithubNumber.HasValue && FirstSetIssueNumbers.Contains(i.GithubNumber.Value))
                            .Select(i => NormalizeAccount(i.Account))
                            .ToHashSet(StringComparer.OrdinalIgnoreCase);
                        if (found.Count > 0) accountsInvolved = found;
                    }
                    catch { /* fall back to the primary-only seed above */ }

                    foreach (var acct in accountsInvolved)
                        Arm(acct, fireAt, reset, $"first-set bootstrap ({parked} build(s), resets {FirstSetResetLabel})");
                    return; // Arm persisted the time(s); no further re-arm needed below.
                }
                ActivityLog.Log("session-limit", "First-set bootstrap: no matching failed/canceled/held rows found to park (already resumed or re-queued?).");
            }

            // Re-arm any restart(s) persisted by a previous app run — one check per account.
            bool rearmedAny = false;
            if (!string.IsNullOrWhiteSpace(settings.SessionLimitRestartAtIso)
                && DateTime.TryParse(settings.SessionLimitRestartAtIso, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var persistedPrimary))
            {
                DateTime? persistedResetPrimary = null;
                if (!string.IsNullOrWhiteSpace(settings.SessionLimitResetAtIso)
                    && DateTime.TryParse(settings.SessionLimitResetAtIso, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var prp))
                {
                    persistedResetPrimary = prp;
                }
                Arm(PrimaryAccount, persistedPrimary <= DateTime.Now ? DateTime.Now.AddMinutes(1) : persistedPrimary, persistedResetPrimary, "re-armed persisted restart (primary) from a previous app run");
                rearmedAny = true;
            }
            if (!string.IsNullOrWhiteSpace(settings.SessionLimitRestartAtIsoSecondary)
                && DateTime.TryParse(settings.SessionLimitRestartAtIsoSecondary, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var persistedSecondary))
            {
                DateTime? persistedResetSecondary = null;
                if (!string.IsNullOrWhiteSpace(settings.SessionLimitResetAtIsoSecondary)
                    && DateTime.TryParse(settings.SessionLimitResetAtIsoSecondary, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var prs))
                {
                    persistedResetSecondary = prs;
                }
                Arm(SecondaryAccount, persistedSecondary <= DateTime.Now ? DateTime.Now.AddMinutes(1) : persistedSecondary, persistedResetSecondary, "re-armed persisted restart (secondary) from a previous app run");
                rearmedAny = true;
            }

            if (!rearmedAny && _db != null)
            {
                // No armed time but rows are sitting limit-paused (e.g. the app died
                // between park and arm) — don't leave them stranded forever. Group by
                // each row's real account so a mixed-account stranded set arms correctly.
                try
                {
                    var stranded = await _db.GetLimitPausedAsync();
                    if (stranded.Count > 0)
                    {
                        foreach (var grp in stranded.GroupBy(i => NormalizeAccount(i.Account)))
                            Arm(grp.Key, DateTime.Now.AddMinutes(Math.Max(1, settings.SessionLimitAutoRestartDelayMinutes)),
                                null, $"found {grp.Count()} limit-paused build(s) on {grp.Key} with no armed restart");
                    }
                }
                catch (Exception ex) { ActivityLog.Log("session-limit", $"Startup limit-paused sweep failed: {ex.Message}"); }
            }
        }

        public void Dispose()
        {
            lock (_gate)
            {
                foreach (var state in _armed.Values) state.Timer?.Dispose();
                _armed.Clear();
                _periodicSweepTimer?.Dispose();
                _periodicSweepTimer = null;
            }
        }
    }
}
