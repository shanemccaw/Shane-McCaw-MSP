using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
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
    ///    (America/New_York)" et al) and arms a timer at reset +
    ///    <see cref="BuildConsoleSettings.SessionLimitAutoRestartDelayMinutes"/>
    ///    (default 10). On fire it flips every limit-paused row back to 'queued' and,
    ///    if the global queue toggle is paused, resumes it — so the very next watcher
    ///    tick relaunches them. The armed time is persisted in settings so an app
    ///    restart re-arms (or fires immediately when the moment already passed).
    ///
    /// If a build relaunches while the cap is genuinely still active, the CLI prints
    /// the limit line again immediately, the build re-parks itself and re-arms with
    /// the freshly-parsed reset — the loop is self-healing, never hot-spinning.
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

        private readonly BuildQueuePostgresClient? _db;
        /// <summary>Unpauses the global queue toggle when the restart fires (a capped wave usually left it paused).</summary>
        private readonly Action _resumeQueue;
        /// <summary>Raised after a restart actually re-queued rows (count) — lets the Build Queue panel refresh.</summary>
        public event Action<int>? LimitPausedResumed;

        private readonly object _gate = new();
        private Timer? _timer;
        /// <summary>The LOCAL time the armed restart fires at, or null when nothing is armed.</summary>
        private DateTime? _restartAtLocal;
        /// <summary>The LOCAL time the session limit resets at, or null when nothing is armed.</summary>
        private DateTime? _resetAtLocal;

        public SessionLimitAutoRestartService(BuildQueuePostgresClient? db, Action resumeQueue)
        {
            _db = db;
            _resumeQueue = resumeQueue;
        }

        public DateTime? RestartAtLocal { get { lock (_gate) return _restartAtLocal; } }
        public DateTime? ResetAtLocal { get { lock (_gate) return _resetAtLocal; } }

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
        /// arms (or re-arms) the restart timer. Multiple builds dying off the same cap
        /// all funnel here; the FURTHEST-out parsed reset wins so the whole wave
        /// restarts together, after the cap has genuinely lifted.
        /// </summary>
        public void RegisterLimitHit(int queueId, string? resetLabel)
        {
            var settings = BuildConsoleSettings.Load();
            if (!settings.SessionLimitAutoRestartEnabled)
            {
                ActivityLog.Log("session-limit", $"Queue #{queueId} hit the session limit (resets {resetLabel ?? "unknown"}) — auto-restart is disabled in settings, leaving it limit-paused for a manual resume.");
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

            Arm(fireAt, resetLocal, $"queue #{queueId} hit the session limit (resets {resetLabel ?? "unparsed"})");
        }

        /// <summary>Arms the restart timer, keeping the furthest-out target when one is already armed. Persists the target so an app restart re-arms it.</summary>
        private void Arm(DateTime fireAtLocal, DateTime? resetAtLocal, string reason)
        {
            lock (_gate)
            {
                if (_restartAtLocal.HasValue && _restartAtLocal.Value >= fireAtLocal)
                {
                    ActivityLog.Log("session-limit", $"{reason} — auto-restart already armed for {_restartAtLocal:ddd h:mm tt} (later than this one's {fireAtLocal:ddd h:mm tt}), keeping it.");
                    return;
                }
                _restartAtLocal = fireAtLocal;
                _resetAtLocal = resetAtLocal ?? fireAtLocal.AddMinutes(-BuildConsoleSettings.Load().SessionLimitAutoRestartDelayMinutes);
                _timer?.Dispose();
                var due = fireAtLocal - DateTime.Now;
                if (due < TimeSpan.FromSeconds(5)) due = TimeSpan.FromSeconds(5);
                _timer = new Timer(_ => { _ = FireAsync(); }, null, due, Timeout.InfiniteTimeSpan);
            }

            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.SessionLimitRestartAtIso = fireAtLocal.ToString("o", CultureInfo.InvariantCulture);
                settings.SessionLimitResetAtIso = _resetAtLocal.HasValue ? _resetAtLocal.Value.ToString("o", CultureInfo.InvariantCulture) : "";
                settings.Save();
            }
            catch (Exception ex) { ActivityLog.Log("session-limit", $"Couldn't persist the armed restart time: {ex.Message}"); }

            ActivityLog.Log("session-limit", $"{reason} — auto-restart armed for {fireAtLocal:ddd MMM d, h:mm tt} (reset + delay).");
        }

        /// <summary>The restart itself: every limit-paused row back to 'queued', global queue toggle resumed, armed state cleared.</summary>
        private async Task FireAsync()
        {
            lock (_gate)
            {
                _restartAtLocal = null;
                _resetAtLocal = null;
                _timer?.Dispose();
                _timer = null;
            }
            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.SessionLimitRestartAtIso = "";
                settings.SessionLimitResetAtIso = "";
                settings.Save();
            }
            catch { }

            int count = 0;
            try
            {
                if (_db != null)
                {
                    var resumed = await _db.ResumeLimitPausedAsync();
                    count = resumed.Count;
                    foreach (var item in resumed)
                        ActivityLog.Log("session-limit", $"Auto-restart: re-queued #{item.Id} ({item.Title}){(string.IsNullOrWhiteSpace(item.ResumeSessionId) ? "" : " — will resume its session")}.");
                }
                else
                {
                    ActivityLog.Log("session-limit", "Auto-restart fired but there is no direct DB connection — cannot re-queue limit-paused rows (HTTP-fallback mode). Resume them manually from the Build Queue panel.");
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("session-limit", $"Auto-restart couldn't re-queue limit-paused rows: {ex.Message} — retrying in 5 minutes.");
                Arm(DateTime.Now.AddMinutes(5), null, "re-queue failed");
                return;
            }

            // A capped wave usually left the global queue toggle paused — resume it so
            // the freshly-queued rows actually launch on the next tick.
            try { _resumeQueue(); }
            catch (Exception ex) { ActivityLog.Log("session-limit", $"Auto-restart couldn't resume the queue toggle: {ex.Message}"); }

            ActivityLog.Log("session-limit", count > 0
                ? $"Session-limit auto-restart fired — {count} build{(count == 1 ? "" : "s")} back in the queue."
                : "Session-limit auto-restart fired — no limit-paused builds found to re-queue (already resumed manually?). Queue toggle resumed.");
            if (count > 0) { try { LimitPausedResumed?.Invoke(count); } catch { } }
        }

        // ── Manual recovery (Build Queue panel button) ──────────────────────────

        /// <summary>
        /// "Recover Session-Limit Builds" — manual counterpart to the live detection in
        /// QueueWatcherService. That live path only flags a build while its process is
        /// still attached to the watcher; if a build died some other way (app restart,
        /// a manual kill, a variant of the limit message the live regex saw but the
        /// reap loop didn't get to before exit) the row can be left sitting
        /// failed/canceled/held with the limit message as the last thing it ever
        /// printed, and nothing ever resumes it. This sweeps every build's raw stdout
        /// log file touched in the last <paramref name="window"/>, re-detects the same
        /// "hit your session limit · resets …" shape via <see cref="TryDetectLimitMessage"/>,
        /// and requeues (resume, not restart-from-scratch) whatever it finds — same
        /// resume_session_id preservation as the automatic path, just triggered by hand
        /// instead of waiting on the reset timer.
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
        /// Call once at app startup (after the watcher exists). Re-arms a persisted
        /// pending restart (firing shortly if its moment already passed while the app
        /// was closed), and runs the one-shot first-set bootstrap.
        /// </summary>
        public async Task StartAsync()
        {
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
                    Arm(fireAt, reset, $"first-set bootstrap ({parked} build(s), resets {FirstSetResetLabel})");
                    return; // Arm persisted the time; no further re-arm needed below.
                }
                ActivityLog.Log("session-limit", "First-set bootstrap: no matching failed/canceled/held rows found to park (already resumed or re-queued?).");
            }

            // Re-arm a restart persisted by a previous app run.
            if (!string.IsNullOrWhiteSpace(settings.SessionLimitRestartAtIso)
                && DateTime.TryParse(settings.SessionLimitRestartAtIso, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var persisted))
            {
                DateTime? persistedReset = null;
                if (!string.IsNullOrWhiteSpace(settings.SessionLimitResetAtIso)
                    && DateTime.TryParse(settings.SessionLimitResetAtIso, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var pr))
                {
                    persistedReset = pr;
                }
                Arm(persisted <= DateTime.Now ? DateTime.Now.AddMinutes(1) : persisted, persistedReset, "re-armed persisted restart from a previous app run");
            }
            else if (_db != null)
            {
                // No armed time but rows are sitting limit-paused (e.g. the app died
                // between park and arm) — don't leave them stranded forever.
                try
                {
                    var stranded = await _db.GetLimitPausedAsync();
                    if (stranded.Count > 0)
                        Arm(DateTime.Now.AddMinutes(Math.Max(1, settings.SessionLimitAutoRestartDelayMinutes)),
                            null,
                            $"found {stranded.Count} limit-paused build(s) with no armed restart");
                }
                catch (Exception ex) { ActivityLog.Log("session-limit", $"Startup limit-paused sweep failed: {ex.Message}"); }
            }
        }

        public void Dispose()
        {
            lock (_gate) { _timer?.Dispose(); _timer = null; }
        }
    }
}
