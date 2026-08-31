using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Threading;

namespace BuildConsole.Services
{
    /// <summary>
    /// The three interactive sub-states a BuildConsole-owned queue build can be
    /// in while its DB row is still "running" (see <see cref="QueueWatcherService"/>).
    /// Surfaced by the Build Watch window as a clear three-state indicator
    /// (working / stopped-paused / waiting-for-input).
    /// </summary>
    public enum InteractiveInputState
    {
        /// <summary>The agent is actively producing output for the current turn.</summary>
        Working,
        /// <summary>A turn finished (or a soft interrupt was honored) and the process is alive, idle, awaiting the next stdin message.</summary>
        WaitingForInput,
        /// <summary>A soft interrupt (Stop) was issued; the process is paused pending corrective guidance (or escalation to a hard kill).</summary>
        Stopped,
    }

    /// <summary>
    /// Git #817 — Shane: "Ohh I thought you build that into the WPF app...
    /// So I queued them but I am not seing anything running." He'd been
    /// assuming BuildConsole itself claimed and launched queued builds; it
    /// never did — scripts/build-queue-watcher.ps1 was a SEPARATE required
    /// process this whole time, which defeats the "everything in one
    /// window" goal the app exists for in the first place. This is that
    /// same watcher's logic (poll GET .../queue/next, launch claude.exe
    /// --print, report completion via POST .../queue/:id/complete) ported
    /// in-process, so the app can do this itself with no extra window.
    ///
    /// Uses ProcessStartInfo.ArgumentList instead of a hand-built escaped
    /// command-line string — .NET already does correct Win32 argv escaping
    /// per-argument when you use ArgumentList, so this doesn't need
    /// run-claude.ps1/build-queue-watcher.ps1's own hard-won
    /// ConvertTo-Win32EscapedArgument implementation at all.
    ///
    /// CAVEAT: if the standalone PowerShell watcher is ALSO left running at
    /// the same time as this, they poll/claim independently and neither
    /// knows about the other's running count — real concurrency could
    /// exceed the configured max. Run one or the other, not both.
    ///
    /// ── Interactive queue-managed builds ────────────────────────────────
    /// When <see cref="BuildConsoleSettings.InteractiveBuilds"/> is on (the
    /// default), a queue build is launched with BuildConsole owning its
    /// redirected stdin/stdout: claude.exe runs in `--print
    /// --input-format stream-json --output-format stream-json --verbose`
    /// mode (all confirmed-real flags via `claude --help`). The initial
    /// prompt and every later message the Build Watch chat box types are
    /// delivered as stream-json user-message lines over stdin — which also
    /// means an `@path` (or any character) passes through byte-for-byte:
    /// it's a JSON string value, never a shell/commander argument, so the
    /// whole class of #767/#820 arg-mangling bugs simply can't apply. The
    /// live output is kept in an in-memory per-build buffer the Build Watch
    /// window pulls directly (replacing its per-item log-tail for these),
    /// while STILL being written to the same BuildLogPaths file so the
    /// chat-tab BuildLogView (#802) is unaffected.
    ///
    /// Git #800 still holds: an interactive build must still auto-complete
    /// so its slot frees and completion fires. Interactive mode never exits
    /// on its own (it waits for more stdin), so after a turn's stream-json
    /// "result" this service starts an idle timer and, if no further input
    /// arrives within InteractiveIdleFinalizeSeconds, closes stdin so the
    /// CLI hits EOF and exits with a real exit code — the exact same
    /// completion path (HasExited → MarkQueueItemCompleteAsync) as the old
    /// one-shot --print launch. Each sent message resets that window, so an
    /// active back-and-forth stays alive.
    ///
    /// Send-to-Builder sessions (#1001, ClaudeAgentsService) are a
    /// completely separate launch path and are never touched by any of this.
    /// </summary>

    /// <summary>Describes one active background subagent or workflow in flight for an interactive build. Surfaced in Build Watch's status line so the user can see the build is not idle.</summary>
    public sealed class SubagentActivityInfo
    {
        public string ToolUseId { get; init; } = "";
        public string Description { get; init; } = "";
        public string ToolName { get; init; } = "";
        public DateTime StartedAtUtc { get; init; } = DateTime.UtcNow;
        public TimeSpan Elapsed => DateTime.UtcNow - StartedAtUtc;
    }

    public class QueueWatcherService
    {
        private class RunningEntry
        {
            /// <summary>Git #1804 — a raw-handle stand-in for System.Diagnostics.Process (same member
            /// surface: HasExited/ExitCode/Id/Kill). The build is launched via CreateProcess with its
            /// stdout/stderr redirected to durable FILES it owns, not a BuildConsole-owned pipe, so it
            /// survives this app closing. See <see cref="RedirectedProcessLauncher"/>.</summary>
            public BuildProcessHandle Process = null!;
            public string Title = "";
            /// <summary>Git #826 — filled in as soon as the run's stream-json output reveals it (usually the very first line); reported at completion so a later Reply can resume this exact conversation.</summary>
            public string? SessionId;
            /// <summary>Session-limit auto-restart — set the moment any output line matches the CLI's "hit your session limit · resets …" message. Read at reap time: a flagged build is parked limit-paused (not failed) and the auto-restart timer is armed. Guarded by _gate.</summary>
            public bool SessionLimitHit;
            /// <summary>The captured reset label ("2:40am (America/New_York)") from the limit message, when present. Guarded by _gate.</summary>
            public string? SessionLimitResetLabel;
            /// <summary>Build Sets — the set name this build belongs to (null = ungrouped). When set, once this build's wave has fully drained the watcher tells the dev-server coordinator to `close` the set as a backstop.</summary>
            public string? BuildSet;
            /// <summary>Build Sets — this build's member key within its set (github number, else queue id) so a failed member can be dropped/accounted for.</summary>
            public string? BuildSetMember;
            /// <summary>Approximate current context-window usage — input_tokens + cache_creation_input_tokens + cache_read_input_tokens of the most recently seen "assistant"/"result" stream-json event's real `usage` object (the standard way to read "how full is the context window", since every API turn re-sends the whole conversation as input). Overwritten (not summed) on each new usage-bearing line. Null until the first such line lands.</summary>
            public long? ContextTokens;

            /// <summary>Git #1371 — absolute path of the isolated git worktree this build runs in
            /// (null when worktree isolation is off, or an explicit --cwd overrode it). On completion
            /// this is where merge-back runs from; the sweep reclaims it once the build process exits.</summary>
            public string? WorktreePath;
            /// <summary>Git #1371 — the worktree's provisioning name/id (agent/&lt;name&gt; branch,
            /// C:\wt\&lt;name&gt; path) used to merge-back / mark-stale / clean it up.</summary>
            public string? WorktreeName;

            // ── Interactive (BuildConsole owns stdin/stdout) fields ──────────
            /// <summary>True when this build was launched in the interactive redirected-stdin mode (owned by this app instance). Legacy/foreign builds are false and behave exactly as before.</summary>
            public bool Interactive;
            /// <summary>Git #1839 — true when this entry was ADOPTED (re-attached by pid) after a BuildConsole
            /// restart rather than launched by this instance. It still renders/streams/context-meters like any
            /// interactive build (<see cref="Interactive"/> stays true), but its stdin pipe died with the old
            /// app and cannot be re-attached (<see cref="Stdin"/> is null) — so OwnsInteractive is false and the
            /// chat box is read-only. Stop/Kill still work off the process handle.</summary>
            public bool Adopted;
            /// <summary>Git #1839 — set true for an adopted build while its raw files are being REPLAYED from
            /// offset 0 to rebuild the in-memory transcript/session-id/context state. During this window the
            /// non-idempotent, escaping side-effects (durable usage-cost accounting + session-limit parking) are
            /// suppressed so the replay doesn't double-count what the previous instance already recorded. Cleared
            /// by the tailer once it catches up to the pre-adoption end of the files. Always false for a normally
            /// launched build. Only read/cleared on the tailer thread (set on the UI thread before the tailer
            /// starts, establishing a happens-before).</summary>
            public bool Replaying;
            public string LogPath = "";
            /// <summary>Git #1804 — the DURABLE file claude.exe's raw stdout is redirected into (child-owned
            /// handle → survives app close). The internal tailer reads this and feeds <see cref="HandleOutput"/>,
            /// which in turn writes the human-readable summary to <see cref="LogPath"/> exactly as before.</summary>
            public string RawStdoutPath = "";
            /// <summary>Git #1804 — the durable file claude.exe's raw stderr is redirected into; tailed into <see cref="HandleStderr"/>.</summary>
            public string RawStderrPath = "";
            /// <summary>Git #1804 — cancels the background raw-file tailers when this build is stopped/finalized.</summary>
            public CancellationTokenSource? TailCts;
            /// <summary>The owned stdin writer — null for legacy builds. Guarded by <see cref="InputLock"/> for writes.</summary>
            public StreamWriter? Stdin;
            public readonly object InputLock = new();
            public readonly object LogLock = new();

            /// <summary>Current interactive sub-state. Read/written under the service's _gate (touched from both the process's output thread and the UI thread).</summary>
            public InteractiveInputState State = InteractiveInputState.Working;
            /// <summary>Last time any output line landed — drives the soft-interrupt "did it go quiet?" escalation check.</summary>
            public DateTime LastActivityUtc;
            /// <summary>Set when a turn's "result" lands (or a soft interrupt is honored) and the process is idle awaiting input; null while actively working. Drives the idle auto-finalize.</summary>
            public DateTime? AwaitingInputSince;
            /// <summary>Set when a soft interrupt (Stop) is in flight; cleared when a Send resumes it.</summary>
            public DateTime? StopRequestedUtc;
            /// <summary>Per-build copy of the idle-finalize grace in ms (0 = never auto-finalize).</summary>
            public int IdleFinalizeMs;
            public CancellationTokenSource? AutoFinalizeCts;

            /// <summary>Active background subagents / workflows in flight for this build (tool_call registered, tool_result not yet landed). Guarded by the service _gate.</summary>
            public readonly Dictionary<string, SubagentActivityInfo> ActiveSubagents = new();

            /// <summary>
            /// The BuildConsole-owned live STRUCTURED event stream the Build Watch window pulls
            /// directly (via <see cref="CopyEventsSince"/>) instead of tailing the log file.
            /// Full-fidelity — carries each tool call's real command/arguments and each tool
            /// result's real output (see <see cref="InteractiveEvent"/>), the detail the old
            /// flattened "[tool: X]" string buffer threw away. Guarded by _gate. The
            /// human-readable per-item log FILE (#802 / foreign file-tail) is fed separately by
            /// <see cref="AppendToLogFile"/> and is unaffected.
            /// </summary>
            public readonly List<InteractiveEvent> Events = new();
            /// <summary>Total events ever appended (including ones trimmed off the front of <see cref="Events"/>) — lets a cursor-based pull survive buffer trimming.</summary>
            public int TotalEmitted;
        }

        private readonly BuildTrackerApiClient _api;
        /// <summary>Direct Postgres client for all queue DB mutations (claim, complete, orphan-sweep). Non-null when DATABASE_URL was resolved at startup; falls back to _api HTTP calls when null (e.g. .env.local not found).</summary>
        private readonly BuildQueuePostgresClient? _db;
        /// <summary>Git #2122 — no longer readonly: <see cref="UpdateMaxConcurrent"/> is the live-apply
        /// path for the Settings UI's max concurrent build slots control.</summary>
        private int _maxConcurrent;
        /// <summary>
        /// Git #1985 — nullable on purpose. The constructor used to coalesce a null
        /// FindRepoRoot() to AppDomain.CurrentDomain.BaseDirectory (the app's own install/exe
        /// folder), which would have launched a build's shared-checkout process against the
        /// wrong directory entirely, silently. Kept nullable so the one place that reads it
        /// (the legacy shared-checkout launch path below) can fail loud instead, matching the
        /// FAIL-LOUD contract already established for worktree-provisioning failure just above it.
        /// </summary>
        private readonly string? _repoRoot;
        private readonly string _claudeExe;
        private readonly string _geminiExe;
        private readonly Dictionary<int, RunningEntry> _running = new();
        /// <summary>Session-limit auto-restart coordinator (wired by MainWindow right after construction; null in tests). Receives RegisterLimitHit when a limit-flagged build is reaped.</summary>
        public SessionLimitAutoRestartService? SessionLimitAutoRestart { get; set; }
        /// <summary>Interactive builds that have exited but whose slot may still be on screen — kept so the Build Watch window can drain the final output tail and hold the slot in interactive-render mode (never falling back to a double-rendering file-tail). Evicted when the window dismisses the slot (ReleaseInteractive) or capped defensively.</summary>
        private readonly Dictionary<int, RunningEntry> _retained = new();
        /// <summary>Guards the mutable interactive fields of a RunningEntry and its Events/_retained — the process output thread and the UI thread both touch these. (_running membership itself is only ever mutated on the UI thread, same as before.)</summary>
        private readonly object _gate = new();
        private DispatcherTimer? _timer;
        private bool _ticking;
        /// <summary>Git #1371 — throttles the background worktree cleanup sweep run from TickAsync.</summary>
        private DateTime _lastWorktreeSweepUtc = DateTime.MinValue;
        private readonly List<(int Id, int ExitCode, string? SessionId)> _pendingCompletions = new();

        private const int MaxBufferedEvents = 4000;
        private const int MaxRetained = 32;
        /// <summary>How long a soft interrupt gets to take effect before the escalation check.</summary>
        private const int StopSoftGraceMs = 4000;
        /// <summary>If the process is still emitting output within this window at the escalation check, the soft interrupt is deemed unresponsive → hard kill.</summary>
        private const int StopQuietMs = 2000;
        /// <summary>Resume: how long to let the soft interrupt abort the hung in-flight request and unwind the aborted turn before writing the follow-up continue message.</summary>
        private const int ResumeInterruptSettleMs = 900;
        /// <summary>Resume: how long to watch for the fresh turn to produce real output before deciding "resumed" vs "still stuck". A reconnect + first streamed token can take a few seconds.</summary>
        private const int ResumeObserveMs = 8000;
        /// <summary>Resume: the short follow-up user message that kicks a fresh turn after the interrupt. Kept concise and honest about the real trigger (network came back) so it doesn't pollute the conversation.</summary>
        private const string ResumeContinueMessage = "Network connection was restored. Please continue where you left off.";

        private static int _interruptSeq;
        /// <summary>One-shot guards so exactly one real raw sample of each stream-json shape is logged per app run (diagnostics — see <see cref="LogRawSampleOnce"/>).</summary>
        private static int _loggedToolUseSample;
        private static int _loggedToolResultSample;
        private static readonly JsonSerializerOptions _msgJson = new()
        {
            // @paths, +, /, & etc. stay literal in the wire JSON (still valid
            // JSON that decodes byte-for-byte) — nicer in the log, same result.
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        };

        public QueueWatcherService(BuildTrackerApiClient api, BuildQueuePostgresClient? db, int maxConcurrent, string? repoRoot)
        {
            _api = api;
            _db = db;
            _maxConcurrent = maxConcurrent;
            _repoRoot = repoRoot;
            _claudeExe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin", "claude.exe");
            _geminiExe = ResolveGeminiExe();
            _paused = BuildConsoleSettings.Load().QueuePaused;
        }

        /// <summary>
        /// Git #1403 — Shane: "--cli gemini flag ignored, builds still spawn claude.exe."
        /// The real, confirmed cause of one half of that bug: this used to hardcode
        /// `~\.local\bin\gemini.exe`, mirroring exactly where Claude Code's own native
        /// installer places claude.exe. But `npm install -g @google/gemini-cli` — the
        /// real, documented way Gemini CLI installs on Windows — never produces a
        /// `.exe` there at all; it drops `gemini`/`gemini.cmd`/`gemini.ps1` shims under
        /// npm's own global bin dir (`%APPDATA%\npm` by default), confirmed live on
        /// this machine via `where gemini`. So `File.Exists(_geminiExe)` was FALSE for
        /// every real gemini-cli install, and LaunchItem's own not-found guard (a few
        /// lines below) refused to launch at all — a build that failed outright, not
        /// one that silently ran claude (that half of the symptom came from the
        /// separate cli-dropped-on-retry bug fixed alongside this one). Confirmed live
        /// that `Process.Start` with `UseShellExecute = false` CAN launch a `.cmd`
        /// shim directly (.NET's Process class falls back to a `cmd.exe /c` wrapper on
        /// ERROR_BAD_EXE_FORMAT), so no extra shell-wrapping is needed here — just the
        /// real path. Checked in priority order; whichever exists first wins:
        ///   1. `%APPDATA%\npm\gemini.cmd` — real, documented `npm install -g` layout.
        ///   2. `~\.local\bin\gemini.exe` — kept as a fallback for a future native/pkg
        ///      binary distribution that mirrors Claude Code's own installer layout.
        /// Neither existing leaves this at the legacy path (option 2) so the existing
        /// "not found" ActivityLog message still names a real, sensible location.
        /// </summary>
        private static string ResolveGeminiExe()
        {
            string npmGlobalCmd = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", "gemini.cmd");
            if (File.Exists(npmGlobalCmd)) return npmGlobalCmd;

            string legacyExe = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin", "gemini.exe");
            return legacyExe;
        }

        public int RunningCount => _running.Count;

        /// <summary>Git #1805 — the real, configured concurrency cap (see <see cref="_maxConcurrent"/>,
        /// sourced from scripts/build-queue-watcher.config.json's maxConcurrent, default 8). Exposed
        /// so a manual per-item override (Start Now) can check it and refuse to launch a genuinely-full
        /// queue instead of guessing or silently exceeding it.</summary>
        public int MaxConcurrent => _maxConcurrent;

        /// <summary>
        /// Git #2122 — live-apply path for the Settings UI's max concurrent build slots control.
        /// TickAsync re-reads <see cref="_maxConcurrent"/> fresh on every ~10s poll
        /// (<c>freeSlots = _maxConcurrent - _running.Count</c>), and Start Now's capacity check
        /// reads it fresh too — neither holds a stale copy across a cycle, so a change here takes
        /// effect on the very next check with no restart required. A plain int field swap is safe
        /// here: this is a single capacity comparison, not an invariant that spans multiple steps,
        /// so no additional locking is needed even if a tick is concurrently mid-check. Clamped to a
        /// minimum of 1 so a bad value from the UI can never park the whole queue.
        /// </summary>
        public void UpdateMaxConcurrent(int newValue)
        {
            int clamped = Math.Max(1, newValue);
            int old = _maxConcurrent;
            _maxConcurrent = clamped;
            ActivityLog.Log("watcher", $"Max concurrent build slots changed live: {old} -> {clamped} (no restart required).");
        }

        /// <summary>
        /// Git #1600 — the real, current reason each held-on-a-blocker queue item is
        /// being held, as of the most recent live GitHub check (see
        /// BuildQueuePostgresClient.GetNextAsync's Step 2). Empty/stale under the
        /// HTTP-fallback path (no <see cref="_db"/>) — that path holds via its own
        /// server-side re-check (see admin-build-tracker.ts's /queue/next) but doesn't
        /// surface a reason back to this client. BuildQueuePanel reads this to render
        /// a real "waiting on #NNNN (open)" instead of guessing from stale columns.
        /// </summary>
        public IReadOnlyDictionary<int, string> HeldBlockerReasons => _db?.LastHeldReasons ?? _emptyHeldReasons;
        private static readonly Dictionary<int, string> _emptyHeldReasons = new();

        /// <summary>
        /// Git #1600 — "Re-evaluate on the existing Git Board refresh so a build
        /// releases automatically once its blocker actually closes." Wired by
        /// MainWindow to LeftSidebar.BoardRefreshCompleted (fired after
        /// PopulateGitTrackerBoard's own fresh GitHub fetch — the Build Queue panel's
        /// own refresh button, or the Git Board's own Refresh, both land here). Kicks
        /// an immediate tick instead of making Shane wait up to 10s for the next timer
        /// — TickAsync's own live blocker re-check (not this board fetch's issue list,
        /// which can be scoped/filtered differently — see GetNextAsync) does the real
        /// work. A no-op if a tick is already in flight (TickAsync's own _ticking
        /// guard).
        /// </summary>
        public void RequestImmediateReevaluation() => _ = TickAsync();

        /// <summary>
        /// Global "Queue Paused / Running" toggle — a per-instance, in-memory
        /// switch, separate from any individual build's own Stop. While paused,
        /// TickAsync still REAPS builds that finish (so completions/slot-frees
        /// still fire) but never CLAIMS or LAUNCHES a new queued item — the
        /// server-side claim (GetNextQueueItemsAsync) is skipped entirely, so a
        /// queued item stays queued (not silently claimed-but-not-run) until
        /// Shane resumes. Queuing new items is unaffected: this only gates the
        /// automatic pickup loop, not the queue itself. Builds already running
        /// when Pause is pressed keep running to completion. Defaults to running
        /// (false), but persists across restarts via BuildConsoleSettings.QueuePaused
        /// (loaded in the constructor, saved on every SetPaused call) — a restart
        /// comes up in whatever pause state it was last left in, not always running.
        /// "Run Now" (ForceLaunch) is a deliberate manual per-item override and
        /// intentionally still works while paused.
        /// </summary>
        private bool _paused;

        /// <summary>Whether the automatic queue pickup loop is currently paused. See <see cref="SetPaused"/>.</summary>
        public bool IsPaused => _paused;

        /// <summary>
        /// Git #1883 — true once the app itself has signaled genuine full readiness (#1882's
        /// real <c>StartupConnectivityService.AllSettled</c> signal — every launch connection
        /// AND the "Application shell" row settled, not just the loading overlay visually
        /// dismissing). False from construction until <see cref="MarkAppReady"/> is called.
        /// This is a HARD gate on the pickup loop's very first claim attempt, independent of
        /// <see cref="IsPaused"/>: Shane's report was explicit that heavy queued build
        /// processes competing with the app's own startup work for resources is what's
        /// killing his machine, "no matter whether the queue is running or paused". See
        /// <see cref="TickAsync"/>.
        /// </summary>
        public bool IsAppReady => _appReady;
        private volatile bool _appReady;

        /// <summary>
        /// Git #1883 — called exactly once by MainWindow when <c>StartupConnectivityService.AllSettled</c>
        /// fires (may be on a background thread — this is a single volatile bool flip, safe from
        /// any thread and idempotent). Lifts the hard readiness gate in <see cref="TickAsync"/> so
        /// the pickup loop's first claim attempt can proceed. Until this is called, TickAsync still
        /// reaps already-running/adopted builds (nothing to gate there — a fresh cold start has
        /// none) but will never claim or launch a new queued item, regardless of <see cref="IsPaused"/>.
        /// </summary>
        public void MarkAppReady()
        {
            if (_appReady) return;
            _appReady = true;
            ActivityLog.Log("watcher", "App signaled genuine full readiness (#1882) — the queue pickup loop's launch gate is now lifted.");
        }

        /// <summary>Raised whenever the pause state actually changes (deduped) — lets any UI reflecting the toggle stay in sync. Argument: the new paused value.</summary>
        public event Action<bool>? PausedStateChanged;

        /// <summary>Flips the global pause state. No-op (and no log) when already in the requested state. Logs the transition on the "watcher" channel.</summary>
        public void SetPaused(bool paused)
        {
            if (_paused == paused) return;
            _paused = paused;
            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.QueuePaused = paused;
                settings.Save();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("watcher", $"Failed to save queue pause state to settings: {ex.Message}");
            }
            ActivityLog.Log("watcher", paused
                ? "Queue PAUSED — already-running builds continue; no new queued items will be claimed/started until resumed."
                : "Queue RESUMED — the pickup loop will claim and start queued items again on the next tick.");
            PausedStateChanged?.Invoke(paused);
        }

        /// <summary>Raised right after a queued build's completion is reported (MarkQueueItemCompleteAsync succeeds) in TickAsync — the genuine "this build is done" moment, success or failure alike (exitCode 0 = success). Wired by MainWindow to trigger BuildCompletionSoundService.Play.</summary>
        public event Action<int, string, int>? BuildFinished;

        /// <summary>Git #820 — "Stop": kills the real process IF this app instance is the one that launched it (in-memory Process handle, so a different watcher's own launches can't be reached this way). Caller still has to mark the DB row done/failed regardless of the return value, same as the existing "Mark Done" escape hatch already does for a watcher-restart-orphaned item.</summary>
        public bool TryStop(int queueItemId)
        {
            if (!_running.TryGetValue(queueItemId, out var entry)) return false;
            try
            {
                if (!entry.Process.HasExited) entry.Process.Kill(entireProcessTree: true);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("watcher", $"Couldn't kill queue item {queueItemId}: {ex.Message}");
                return false;
            }
            finally
            {
                entry.TailCts?.Cancel(); // Git #1804 — stop the durable-file tailer for this build.
                _running.Remove(queueItemId);
            }
            ActivityLog.Log("watcher", $"Stopped: {entry.Title} (queue #{queueItemId})");
            return true;
        }

        /// <summary>Git #820 — "Run Now": launches an item this app just force-claimed (bypassing the blocker/free-slot check GetNextQueueItemsAsync would normally enforce). Same launch path as the normal poll loop, just triggered directly instead of discovered.</summary>
        public void ForceLaunch(QueueItem item) => _ = SafeLaunch(item, isForced: true);

        /// <summary>Git #1805 — the three things <see cref="StartNowAsync"/> can report back to the
        /// caller so the UI's toast is honest about what actually happened, never a generic
        /// "done"/"failed".</summary>
        public enum StartNowOutcome { Launched, AtCapacity, Failed }

        /// <summary>Git #1805 — <see cref="StartNowAsync"/>'s result: the outcome plus a
        /// human-readable message safe to show directly in a toast.</summary>
        public sealed record StartNowResult(StartNowOutcome Outcome, string Message);

        /// <summary>
        /// Git #1805 — "Start Now": Shane's explicit, one-at-a-time right-click override for a
        /// queued row that's sitting there with no obvious reason (prompted by #1803: "QUEUED"
        /// with visible free capacity, 5/8 building). Distinct from "Run Now" (#820,
        /// <see cref="ForceLaunch"/>) in exactly the one way that matters: Run Now bypasses the
        /// free-slot check unconditionally (it's a deliberate "spend headroom on this one build"
        /// override), whereas Start Now overrides *waiting* — a real blocked_by dependency, or
        /// just the poll not having reached this row yet — but never the actual concurrency cap.
        /// Launching a 9th build when 8 are genuinely running would defeat the whole point of the
        /// cap, so that case is refused, not silently honored.
        ///
        /// Every branch logs on the existing "watcher" channel exactly what was overridden
        /// (blocker bypassed / poll timing skipped / genuinely at capacity) — the diagnostic
        /// information #1805 asks for, not just a way to unstick something blindly.
        /// </summary>
        public async Task<StartNowResult> StartNowAsync(int queueItemId, string title)
        {
            // 1. The one thing this action must NEVER override: a genuinely full concurrency cap.
            //    Checked first, before any claim, so a full queue is never even attempted.
            if (_running.Count >= _maxConcurrent)
            {
                string msg = $"Not launched — genuinely at capacity ({_running.Count}/{_maxConcurrent} running). Start Now overrides waiting, never the concurrency cap itself.";
                ActivityLog.Log("watcher", $"Start Now: queue #{queueItemId} ({title}) — {msg}");
                return new StartNowResult(StartNowOutcome.AtCapacity, msg);
            }

            // 2. A per-item manual Pause (BuildConsoleSettings.PausedBuildIds) is also a "wait",
            //    same as Run Now already treats it — clear it so this row isn't re-parked on the
            //    very next tick right after we launch it.
            var settings = BuildConsoleSettings.Load();
            bool wasPaused = settings.PausedBuildIds.Remove(queueItemId);
            if (wasPaused)
            {
                settings.Save();
                ActivityLog.Log("watcher", $"Start Now: queue #{queueItemId} ({title}) — cleared its manual per-item Pause.");
            }

            // 3. Whatever real hold GetNextAsync's own live blocker re-check most recently recorded
            //    for this row (Git #1600) — captured BEFORE the force-claim below removes it from
            //    the candidate set entirely, so we can log the real reason it was actually held on.
            string? heldReason = HeldBlockerReasons.TryGetValue(queueItemId, out var reason) ? reason : null;

            QueueItem claimed;
            try
            {
                claimed = _db != null
                    ? await _db.ForceClaimAsync(queueItemId)
                    : await _api.ForceClaimQueueItemAsync(queueItemId);
            }
            catch (Exception ex)
            {
                string msg = $"Couldn't claim: {ex.Message}";
                ActivityLog.Log("watcher", $"Start Now: queue #{queueItemId} ({title}) — {msg}");
                return new StartNowResult(StartNowOutcome.Failed, msg);
            }

            if (!string.IsNullOrWhiteSpace(heldReason))
                ActivityLog.Log("watcher", $"Start Now: queue #{queueItemId} ({title}) — bypassed a real hold: {heldReason}.");
            else
                ActivityLog.Log("watcher", $"Start Now: queue #{queueItemId} ({title}) — no real blocker was holding it; it was only waiting on the next poll tick. Launching immediately.");

            ForceLaunch(claimed);
            return new StartNowResult(StartNowOutcome.Launched, $"Launched: {title}");
        }

        /// <summary>Fire-and-forget wrapper for the now-async <see cref="LaunchItem"/> — used by the
        /// non-awaiting entry points (Run Now, Build Watch resume). Observes any exception so an
        /// unawaited launch (e.g. a worktree-provisioning hiccup, Git #1371) can't crash the app.
        ///
        /// Git #1881 — both callers (<see cref="ForceLaunch"/>, <see cref="LaunchItemExplicit"/>) are
        /// invoked directly from UI-thread event handlers (a context-menu Click, or a DispatcherTimer
        /// tick) via `_ = SafeLaunch(...)`. Any C# async method's body runs SYNCHRONOUSLY on the
        /// calling thread up to its first genuinely-suspending await — and <see cref="LaunchItem"/>'s
        /// own tail, <see cref="RedirectedProcessLauncher.Launch"/>, is a plain synchronous method (a
        /// direct Win32 CreateProcess call with no async overload), so it — along with everything
        /// before LaunchItem's first await when worktree isolation is off or an explicit --cwd is set
        /// — genuinely blocked the UI thread. A live repro (real CreateProcess calls against the real
        /// claude.exe on this machine) measured this synchronous cost at ~50-200ms per launch, worse
        /// under real-world antivirus/IO contention — a real, reproducible UI stutter on every Run Now
        /// click. Task.Run hands the entire LaunchItem body to a thread-pool thread immediately, so
        /// SafeLaunch (and therefore ForceLaunch/LaunchItemExplicit) returns control to the caller
        /// right away, exactly like the required fix describes: the actual process-start work happens
        /// in the background, same as the normal queue-pickup path is meant to.</summary>
        private async Task SafeLaunch(QueueItem item, int? buildSetExpected = null, bool isForced = false)
        {
            try { await Task.Run(() => LaunchItem(item, buildSetExpected, isForced)); }
            catch (Exception ex) { ActivityLog.Log("watcher", $"LaunchItem threw for queue #{item.Id} ({item.Title}): {ex.Message}"); }
        }

        /// <summary>Git #1416 — expand a leading <c>~</c> (or <c>~/</c>, <c>~\</c>) in a configured
        /// path to the current user's profile directory, so a secondary config dir stored as
        /// <c>~/.claude-secondary</c> resolves to a real absolute path for CLAUDE_CONFIG_DIR. A path
        /// with no leading tilde is returned trimmed but otherwise unchanged.</summary>
        private static string ExpandUserPath(string? path)
        {
            if (string.IsNullOrWhiteSpace(path)) return "";
            path = path.Trim();
            if (path == "~" || path.StartsWith("~/") || path.StartsWith("~\\"))
            {
                string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string rest = path.Length <= 1 ? "" : path.Substring(2);
                return string.IsNullOrEmpty(rest) ? home : Path.Combine(home, rest);
            }
            return path;
        }

        /// <summary>Git #1986 — true when a build's prompt carries a leading `--network metered`
        /// header flag. This can only TIGHTEN the launch to metered (see LaunchItem); a build can
        /// never self-declare `--network unmetered` to escape a Rental gate. Parsing is limited to
        /// the first line, the same header-flag convention EditBuildPromptDialog uses. A missing/
        /// blank/`unmetered` flag returns false so the live global toggle is authoritative.</summary>
        private static bool HeaderFlagSaysMetered(string? prompt)
        {
            if (string.IsNullOrWhiteSpace(prompt)) return false;
            int nl = prompt.IndexOf('\n');
            string firstLine = nl == -1 ? prompt : prompt.Substring(0, nl);
            var m = System.Text.RegularExpressions.Regex.Match(
                firstLine, @"--network\s+(\S+)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            return m.Success && string.Equals(m.Groups[1].Value, "metered", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Git #1371 — the provisioning name/id for a build's isolated worktree. Uses the
        /// queue row id (globally unique, stable across a Reply/resume of the same row) plus the
        /// GitHub number when known, giving a readable branch/path (agent/&lt;name&gt;, C:\wt\&lt;name&gt;).</summary>
        private static string ComposeWorktreeName(QueueItem item)
        {
            string gh = item.GithubNumber.HasValue ? $"{item.GithubNumber.Value}-" : "";
            return $"{gh}q{item.Id}";
        }

        /// <summary>Git #1371 — the DEV_BUILD_SET* env a build-set member's merge-back needs so its
        /// commit merges into the dev-server checkout but the restart stays deferred until the whole
        /// set completes. Null for ungrouped builds (ordinary immediate coalesced restart).</summary>
        private static IReadOnlyDictionary<string, string>? BuildSetEnvFor(RunningEntry entry)
        {
            if (string.IsNullOrWhiteSpace(entry.BuildSet)) return null;
            var env = new Dictionary<string, string> { ["DEV_BUILD_SET"] = entry.BuildSet! };
            if (!string.IsNullOrWhiteSpace(entry.BuildSetMember)) env["DEV_BUILD_SET_MEMBER"] = entry.BuildSetMember!;
            return env;
        }

        /// <summary>Git #1371 — mark a queue item as failed-to-launch (e.g. worktree provisioning
        /// failed while isolation is enforced) so it surfaces as a failed build instead of silently
        /// vanishing. Same completion path as a real non-zero exit. Best-effort.</summary>
        private async Task MarkLaunchFailedAsync(int id, string reason)
        {
            ActivityLog.Log("watcher", $"Queue #{id} launch failed: {reason}");
            try
            {
                if (_db != null) await _db.MarkCompleteAsync(id, 1, null);
                else await _api.MarkQueueItemCompleteAsync(id, 1, null);
            }
            catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't mark launch-failed queue #{id}: {ex.Message}"); }
            try { BuildFinished?.Invoke(id, $"queue #{id}", 1); } catch { }
        }

        /// <summary>
        /// Git #1989 — Conservation Cap park. Called from LaunchItem when the toggle is on
        /// and the item's model/effort exceeds Sonnet High: marks the DB row
        /// AccountCapPolicy.CappedStatus (never re-claimed by GetNextAsync's
        /// WHERE status='queued'; still visible in the Build Queue panel's "Capped"
        /// filter) instead of launching it. Direct-DB only, same constraint as the
        /// removed #1418 hold path — HTTP-fallback mode has no way to write a status
        /// other than what the API server's own endpoints support, so a capped build in
        /// that mode is marked launch-failed instead of silently vanishing (never picked
        /// up again, never explained).
        /// </summary>
        private async Task ParkForConservationAsync(QueueItem item)
        {
            ActivityLog.Log("build-queue", $"Conservation Cap: queue #{item.Id} ({item.Title}) requests {item.Model ?? "default"}/{item.Effort ?? "default"} — above Sonnet High, parked instead of launched.");
            if (_db == null)
            {
                ActivityLog.Log("build-queue", $"No direct DB connection — cannot park queue #{item.Id} for Conservation Cap (HTTP-fallback mode doesn't support the capped status). Marking launch-failed instead so it's not silently skipped forever.");
                await MarkLaunchFailedAsync(item.Id, "Conservation Cap is on but there is no direct DB connection to park it");
                return;
            }
            try
            {
                await _db.MarkCappedAsync(item.Id);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("build-queue", $"Couldn't mark queue #{item.Id} capped for Conservation: {ex.Message}");
            }
        }

        /// <summary>
        /// Git #1479 — one-shot startup reclaim of any row still parked at the retired
        /// 'held' status (the secondary-account Sonnet+ Overflow cap's park). The cap and
        /// every code path that could set 'held' are deleted; a row parked before the
        /// removal would otherwise be stranded forever, since GetNextAsync only reclaims
        /// WHERE status = 'queued'. Flips leftover 'held' rows back to 'queued', preserving
        /// their real account/model/effort. Normally a no-op. Only the direct-DB path can
        /// do this; HTTP-fallback mode never created 'held' rows in the first place.
        /// </summary>
        private async Task ReclaimLegacyHeldRowsAsync()
        {
            if (_db == null) return;
            try
            {
                var reclaimed = await _db.ReclaimLegacyHeldRowsAsync();
                foreach (var item in reclaimed)
                    ActivityLog.Log("watcher", $"Reclaimed queue #{item.Id} ({item.Title}) from the retired 'held' status back to 'queued' — account/model/effort preserved ({item.Account ?? "primary"}/{item.Model ?? "default"}/{item.Effort ?? "default"}).");
            }
            catch (Exception ex)
            {
                ActivityLog.Log("watcher", $"Couldn't reclaim legacy 'held' rows: {ex.Message}");
            }
        }

        /// <summary>Git #1371 — throttled background worktree sweep (at most once every few minutes).
        /// Non-force + ownership-gated in the dev-server script, so it never removes a live build's
        /// worktree, an unrelated/harness worktree, or one still within its grace window; it only
        /// reclaims agent/* worktrees whose build process is gone.</summary>
        private void MaybeSweepWorktrees()
        {
            if (!BuildConsoleSettings.Load().EnforceWorktreeIsolation) return;
            if ((DateTime.UtcNow - _lastWorktreeSweepUtc).TotalMinutes < 5) return;
            _lastWorktreeSweepUtc = DateTime.UtcNow;
            _ = WorktreeCleanupService.SweepWorktreesAsync(force: false, dryRun: false);
        }

        private bool _starting;

        /// <summary>
        /// Git #847 — Shane: "834 is currently in progress on the Queue...
        /// running, streaming fine. But the right panel has an X and says
        /// 'orphaned by app restart'... I just opened the app, I just pushed
        /// this build to the queue." Real bug: RecoverOrphanedRunningItemsAsync
        /// used to be fire-and-forget (`_ = RecoverOrphanedRunningItemsAsync()`)
        /// racing against the very first TickAsync() started a line later. If
        /// Shane queued something right at launch, TickAsync could claim and
        /// launch it (a real, legitimate 'running' row) BEFORE the recovery
        /// sweep's own fetch resolved — the sweep would then see that
        /// brand-new legitimate row as 'running' and, since it never checked
        /// `_running` at all, wrongly mark it orphaned/failed out from under
        /// the real process that was actively streaming. Now `async void
        /// Start()` AWAITS the sweep to fully complete before the timer (and
        /// therefore the first real claim) ever starts, so there is no window
        /// where the two can race over the same row.
        /// </summary>
        public async void Start()
        {
            if (_timer != null || _starting) return;
            _starting = true;
            if (!File.Exists(_claudeExe) && !File.Exists(_geminiExe))
            {
                ActivityLog.Log("watcher", $"Neither claude.exe nor gemini.exe was found - in-app watcher disabled.");
                return;
            }
            ActivityLog.Log("watcher", $"In-app build queue watcher starting - max {_maxConcurrent} concurrent, polling every 10s.");
            await RecoverOrphanedRunningItemsAsync();
            await ReclaimLegacyHeldRowsAsync();
            // Git #1371 — reclaim agent worktrees orphaned by a prior BuildConsole session (their
            // build processes are, by definition, gone once this fresh instance starts). Ownership-
            // gated + non-force, so a live build from a concurrently-open instance (its worktree's
            // creator pid still alive) is retained.
            MaybeSweepWorktrees();
            _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
            _timer.Tick += async (_, _) => await TickAsync();
            _timer.Start();
            _ = TickAsync();
        }

        /// <summary>
        /// Git #822 — Shane: "#805 seems to have ran but there was zero
        /// indication at all that it was going... The build log was
        /// empty... there are also 4 #805 entries." `_running` is a pure
        /// in-memory dictionary - it dies with the app. When BuildConsole
        /// restarts, any DB row still `running` from the OLD instance has
        /// nothing in THIS instance tracking it anymore. #822's original fix
        /// assumed that meant the process itself was gone too — "anything
        /// already `running` when this instance starts is, by definition,
        /// orphaned from a previous one" — and marked every such row failed
        /// -2 so it was visibly explained rather than sitting in silent limbo.
        ///
        /// Git #1804 / #1839 — that assumption is NO LONGER TRUE. #1804 moved
        /// launched builds off the in-process stdout pipe onto durable files
        /// the CHILD owns, so a build now KEEPS RUNNING after BuildConsole
        /// closes (its claude.exe keeps writing `queue-{id}.log.raw`). Marking
        /// it failed -2 throws away live work and, worse, the "Recover All"
        /// banner then re-queues a SECOND agent onto the same still-live
        /// worktree/branch. So this sweep no longer guesses from status alone:
        /// for each `running` row it checks whether the real process is still
        /// alive (#1839 — stored `build_pid` + its process-creation-time
        /// fingerprint, so a reused pid is never mistaken for our build) and,
        /// if so, ADOPTS it — rebuilds the RunningEntry, re-arms the raw-file
        /// tailers replaying the transcript, and leaves the row `running` so
        /// Build Watch remounts the slot on its own next poll. Only a row whose
        /// process is genuinely gone (no pid stored, pid not openable, or the
        /// creation time doesn't match) still gets marked failed -2 exactly as
        /// #822 did — real crash recovery is unchanged.
        ///
        /// Git #943 — Shane: "I'm losing builds... 939 is still running but
        /// it's not showing in the queue." #939's real claude.exe process was
        /// legitimately claimed and launched by one BuildConsole instance,
        /// but this sweep ran from a SECOND, concurrently-open instance whose
        /// own fresh `_running` dict was empty - from its perspective #939
        /// looked orphaned, so it force-marked it failed. The multi-instance
        /// guard below stays even now that liveness is real: with a second
        /// console open, adoption would let BOTH consoles re-attach the same
        /// live process and RACE to write its completion. Adoption is only safe
        /// when this is the ONLY console running, so if any OTHER
        /// BuildConsole.exe is alive this skips the sweep entirely — neither
        /// adopting nor failing anything — rather than guess wrong.
        /// </summary>
        private async Task RecoverOrphanedRunningItemsAsync()
        {
            if (Process.GetProcessesByName("BuildConsole").Length > 1)
            {
                ActivityLog.Log("watcher", "Skipping orphaned-running sweep - another BuildConsole instance is already open, can't safely tell orphaned from legitimately in-progress elsewhere (and adoption would race two consoles over the same live process).");
                return;
            }

            List<QueueItem> items;
            try
            {
                items = _db != null
                    ? await _db.GetQueueAsync()
                    : await _api.GetQueueAsync();
            }
            catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't check for orphaned running items: {ex.Message}"); return; }

            var running = items.Where(i => i.Status == "running").ToList();
            if (running.Count == 0) return;

            int adopted = 0, orphaned = 0;
            foreach (var item in running)
            {
                // Git #1839 — liveness check first. If the real process is still alive and
                // matches its stored pid+creation-time fingerprint, ADOPT it (leaves the row
                // `running`, remounts its Build Watch slot). Otherwise it's a genuine #822 orphan.
                if (TryAdoptRunningItem(item))
                {
                    adopted++;
                    continue;
                }

                try
                {
                    if (_db != null)
                        await _db.MarkOrphanedFailedAsync(item.Id);
                    else
                        await _api.MarkQueueItemCompleteAsync(item.Id, -2);
                    orphaned++;
                    ActivityLog.Log("watcher", $"Orphaned queue #{item.Id} ({item.Title}) marked failed -2 — its process is gone (pid {(item.BuildPid?.ToString() ?? "none stored")}). Resume Session (if a session id was captured) or Retry to re-queue; the Build Queue panel's 'Recover All' banner does every orphan at once.");
                }
                catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't mark orphaned queue item {item.Id} failed: {ex.Message}"); }
            }

            if (adopted > 0)
                ActivityLog.Log("watcher", $"Adopted {adopted} still-running build(s) after restart — remounting into Build Watch, streaming continues.");
            if (orphaned > 0)
                ActivityLog.Log("watcher", $"Marked {orphaned} genuinely-orphaned running row(s) failed -2 (process gone).");
        }

        /// <summary>
        /// Git #1839 — attempts to ADOPT a `running` row whose real build process survived a
        /// BuildConsole restart, so it stays `running` and remounts into Build Watch instead of
        /// being falsely marked failed -2. Returns true only when the process was verified alive
        /// AND matched its stored pid+creation-time fingerprint and the entry is now registered in
        /// <see cref="_running"/>; false means "not ours / gone" and the caller orphans the row.
        ///
        /// Safety gates, in order (any failure → false, treat as orphan):
        ///   1. No <c>build_pid</c> stored (a row from before this change, or HTTP-fallback) — don't guess.
        ///   2. <c>OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION)</c> fails → process is gone.
        ///   3. The opened handle reports already-exited → gone.
        ///   4. Its <c>GetProcessTimes</c> creation time doesn't match the stored one → the pid was
        ///      REUSED by an unrelated process; close the handle, do NOT adopt (never Stop a stranger).
        /// </summary>
        private bool TryAdoptRunningItem(QueueItem item)
        {
            if (_db == null || !item.BuildPid.HasValue) return false; // (1)

            var handle = BuildProcessHandle.TryOpenExisting(item.BuildPid.Value); // (2)
            if (handle == null) return false;

            bool keep = false;
            try
            {
                if (handle.HasExited) return false; // (3)

                // (4) — pid-reuse fingerprint. Compare the live process's creation time against the
                // one stamped at launch. The stored and live values come from GetProcessTimes on the
                // SAME underlying process, so on a genuine match they are FILETIME-identical apart
                // from timestamptz's microsecond truncation on the DB round-trip (< 1µs); a verified
                // 0.000000s same-process delta in the #1839 harness confirms this. A REUSED pid, in
                // contrast, belongs to a process that started at a genuinely different wall-clock time
                // — the original had to exit before its pid could be reused, so the gap is at least
                // the original build's runtime (realistically minutes, and here at least the app-down
                // duration). A 1-second tolerance sits comfortably above the truncation error and far
                // below any real reuse gap. Erring tight is deliberate: a false reject just orphans a
                // recoverable row (Retry is right there), while a false accept could adopt — and on
                // Stop, KILL — an unrelated process.
                var liveCreation = handle.CreationTimeUtc;
                if (!liveCreation.HasValue || !item.BuildPidStartedAt.HasValue) return false;
                double deltaSec = Math.Abs((item.BuildPidStartedAt.Value.UtcDateTime - liveCreation.Value).TotalSeconds);
                if (deltaSec > 1.0)
                {
                    ActivityLog.Log("watcher", $"NOT adopting queue #{item.Id}: pid {item.BuildPid} is alive but its creation time differs by {deltaSec:F1}s from the stored fingerprint — the pid was reused by another process. Marking orphaned instead.");
                    return false;
                }

                AdoptRunningItem(item, handle);
                keep = true;
                return true;
            }
            finally
            {
                if (!keep) handle.Close(); // release the handle we opened but won't keep
            }
        }

        /// <summary>
        /// Git #1839 — reconstructs the in-memory state of an adopted build so the existing reap
        /// loop + Build Watch treat it exactly like a build THIS instance launched: a
        /// <see cref="RunningEntry"/> pointing at the surviving <c>.raw</c>/<c>.err</c> files, the raw
        /// tailers re-armed to REPLAY the transcript from offset 0 (which is also how the session id
        /// is recovered — it's parsed out of the replayed stream-json), and the entry registered in
        /// <see cref="_running"/> so TickAsync completes it normally (real exit code, session id,
        /// completion write, BuildFinished → post-build deploy pipeline).
        ///
        /// The interactive stdin pipe died with the old app and cannot be re-attached, so
        /// <see cref="RunningEntry.Stdin"/> stays null (→ OwnsInteractive false → the chat box is
        /// read-only) and <see cref="RunningEntry.Adopted"/> is set. Live output, progress, context
        /// meter, Stop and Kill all still work (the latter two off the process handle).
        /// </summary>
        private void AdoptRunningItem(QueueItem item, BuildProcessHandle handle)
        {
            var logPath = BuildLogPaths.ForQueueItem(item.Id);
            var rawStdoutPath = logPath + ".raw";
            var rawStderrPath = logPath + ".err";

            // Truncate the human-readable SUMMARY log so the replay rebuilds it from the raw file
            // cleanly instead of duplicating what the previous instance already wrote to it. The
            // raw .raw/.err files (the child owns and keeps appending to) are NOT touched.
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
                File.WriteAllText(logPath, "");
            }
            catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't reset summary log for adopted queue #{item.Id}: {ex.Message}"); }

            // Reconstruct the worktree identity (deterministic) so the reap loop's completion
            // merge-back / stale-marking still runs for an adopted build. The path is guarded by
            // Directory.Exists so a non-standard layout (or an already-cleaned worktree) simply
            // leaves it null (merge-back skipped) rather than passing a bad path.
            string? worktreeName = null, worktreePath = null;
            if (string.IsNullOrWhiteSpace(item.Cwd) && BuildConsoleSettings.Load().EnforceWorktreeIsolation)
            {
                worktreeName = ComposeWorktreeName(item);
                var candidate = Path.Combine("C:\\wt", worktreeName);
                if (Directory.Exists(candidate)) worktreePath = candidate;
            }

            var entry = new RunningEntry
            {
                Process = handle,
                Title = item.Title,
                // Adopted builds render/stream/context-meter like an interactive build (structured
                // event stream + context tokens), but have no owned stdin.
                Interactive = true,
                Adopted = true,
                Replaying = true,
                LogPath = logPath,
                RawStdoutPath = rawStdoutPath,
                RawStderrPath = rawStderrPath,
                TailCts = new CancellationTokenSource(),
                LastActivityUtc = DateTime.UtcNow,
                State = InteractiveInputState.Working,
                // No stdin to close → never idle-auto-finalize; an adopted build completes when its
                // own process exits or when the user Stops it.
                IdleFinalizeMs = 0,
                BuildSet = string.IsNullOrWhiteSpace(item.BuildSet) ? null : item.BuildSet,
                BuildSetMember = string.IsNullOrWhiteSpace(item.BuildSet) ? null : (item.GithubNumber?.ToString() ?? item.Id.ToString()),
                WorktreePath = worktreePath,
                WorktreeName = worktreeName,
                // Seed from the DB's already-persisted early session id (#826); the replay confirms
                // or overwrites it from the real stream-json.
                SessionId = string.IsNullOrWhiteSpace(item.SessionId) ? null : item.SessionId,
                // Stdin deliberately left null — the interactive pipe died with the old app.
            };

            // Replay from offset 0: the LineTailer opens each file at position 0 and reads to end,
            // so simply starting the tailers re-feeds the ENTIRE accumulated transcript through
            // HandleOutput/HandleStderr (rebuilding Events, context tokens, session id, state) and
            // then continues live. Replaying is bounded by the files' current lengths so the
            // non-idempotent escaping side-effects (durable usage-cost accounting + session-limit
            // parking) are suppressed for the already-processed region — see StartRawTailers.
            StartRawTailers(entry, item.Id, adopt: true);
            _running[item.Id] = entry;

            ActivityLog.Log("watcher", $"ADOPTED queue #{item.Id} ({item.Title}) — pid {item.BuildPid} still alive after restart; remounting into Build Watch and replaying its transcript. Interactive stdin is gone (read-only chat; use Resume Session to talk to it).");
        }

        /// <summary>Retries reporting completion for any build whose DB write failed (only relevant in HTTP-fallback mode since Postgres never sleeps). No-op when direct DB is active since MarkCompleteAsync is synchronous and reliable.</summary>
        private async Task RetryPendingCompletionsAsync()
        {
            if (_pendingCompletions.Count == 0) return;
            var toRetry = _pendingCompletions.ToList();
            foreach (var item in toRetry)
            {
                try
                {
                    if (_db != null)
                        await _db.MarkCompleteAsync(item.Id, item.ExitCode, item.SessionId);
                    else
                        await _api.MarkQueueItemCompleteAsync(item.Id, item.ExitCode, item.SessionId);
                    _pendingCompletions.Remove(item);
                    ActivityLog.Log("watcher", $"Delivered deferred completion for queue item {item.Id}.");
                }
                catch
                {
                    // Still unreachable — will retry on next tick
                    break;
                }
            }
        }

        // ── Build Sets backstop ─────────────────────────────────────────────────
        /// <summary>
        /// If a just-finished build was part of a build set and no more members of that
        /// set are still queued or running (the wave has fully drained), signal the
        /// dev-server coordinator to <c>close</c> the set. Closing completes the set on
        /// exactly the members that merged, so its single deferred restart fires even
        /// when a member failed without ever calling request-restart. On the happy path
        /// the set already auto-completed via the expected member count, so this close is
        /// a single-shot no-op. Direct-Postgres only (the count needs the queue table).
        /// </summary>
        private async Task MaybeCloseDrainedBuildSetAsync(string buildSet, int justFinishedId)
        {
            if (_db == null) return; // HTTP-fallback mode: can't count set members
            int remaining = await _db.CountBuildSetPendingAsync(buildSet, justFinishedId);
            if (remaining > 0) return; // more members still queued/running — not drained yet
            ActivityLog.Log("watcher", $"Build set '{buildSet}' fully drained — telling the dev-server coordinator to close it (fires the ONE deferred restart if it hasn't already).");
            SpawnBuildSetClose(buildSet);
        }

        /// <summary>Fire-and-forget <c>node scripts/dev-server/buildset.mjs close &lt;name&gt;</c>
        /// from the main repo root (same shared coordinator state every agent worktree
        /// resolves). Best-effort: logs the outcome, never throws into the reap loop.</summary>
        private void SpawnBuildSetClose(string buildSet)
        {
            try
            {
                // Git #1985 — fail closed rather than Path.Combine(null, ...) throwing an
                // unhelpful ArgumentNullException, or worse, resolving relative to cwd.
                if (string.IsNullOrWhiteSpace(_repoRoot))
                {
                    ActivityLog.Log("watcher", $"Repo root unresolved — cannot close build set '{buildSet}' (buildset.mjs needs a real repo root to run from).");
                    return;
                }
                string script = Path.Combine(_repoRoot, "scripts", "dev-server", "buildset.mjs");
                if (!File.Exists(script))
                {
                    ActivityLog.Log("watcher", $"buildset.mjs not found at {script} — cannot close set '{buildSet}'.");
                    return;
                }
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    WorkingDirectory = _repoRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                psi.ArgumentList.Add(script);
                psi.ArgumentList.Add("close");
                psi.ArgumentList.Add(buildSet);
                var p = Process.Start(psi);
                if (p == null) return;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        string o = (await p.StandardOutput.ReadToEndAsync()).Trim();
                        string e = (await p.StandardError.ReadToEndAsync()).Trim();
                        p.WaitForExit(120000);
                        ActivityLog.Log("watcher", $"buildset close '{buildSet}' -> exit {p.ExitCode}. {o} {e}".Trim());
                    }
                    catch (Exception ex) { ActivityLog.Log("watcher", $"buildset close '{buildSet}' output read failed: {ex.Message}"); }
                });
            }
            catch (Exception ex)
            {
                ActivityLog.Log("watcher", $"Couldn't spawn buildset close for '{buildSet}': {ex.Message}");
            }
        }

        private async Task TickAsync()
        {
            // A tick can take longer than 10s (network latency, a slow
            // claim); skip overlapping runs rather than letting them stack.
            if (_ticking) return;
            _ticking = true;
            try
            {
                await RetryPendingCompletionsAsync();

                // ── 1. Reap processes that have exited ────────────────────────
                foreach (var id in _running.Keys.ToList())
                {
                    var entry = _running[id];
                    if (!entry.Process.HasExited) continue;
                    int exitCode = entry.Process.ExitCode;
                    ActivityLog.Log("watcher", $"Finished: {entry.Title} (exit {exitCode})");

                    // Session-limit auto-restart: a build whose output hit the CLI's
                    // session/usage-limit message is parked limit-paused (resume
                    // session preserved) instead of marked failed, and the restart
                    // timer is armed for its parsed reset + delay. Everything a
                    // normal completion fires (BuildFinished → post-build deploy,
                    // build-set close, worktree merge-back) is skipped — the build
                    // isn't done, it's coming back.
                    bool limitParked = false;
                    bool limitHit;
                    string? limitResetLabel;
                    lock (_gate)
                    {
                        limitHit = entry.SessionLimitHit;
                        limitResetLabel = entry.SessionLimitResetLabel;
                    }
                    if (limitHit)
                    {
                        if (_db != null)
                        {
                            try
                            {
                                await _db.MarkLimitPausedAsync(id, entry.SessionId);
                                limitParked = true;
                                ActivityLog.Log("session-limit", $"Parked queue #{id} ({entry.Title}) limit-paused (exit {exitCode}); it will be re-queued automatically after the session-limit reset.");
                                SessionLimitAutoRestart?.RegisterLimitHit(id, limitResetLabel);
                            }
                            catch (Exception ex)
                            {
                                ActivityLog.Log("session-limit", $"Couldn't park queue #{id} limit-paused: {ex.Message} — falling back to the normal failed path.");
                            }
                        }
                        else
                        {
                            ActivityLog.Log("session-limit", $"Queue #{id} hit the session limit but there is no direct DB connection (HTTP-fallback mode doesn't support limit-paused) — marking it via the normal completion path instead.");
                        }
                    }

                    // Report completion — direct Postgres when available (always-on Neon,
                    // no nap/sleep issue), HTTP fallback otherwise. The fallback path is
                    // kept for environments where DATABASE_URL isn't configured.
                    // It MUST NOT gate the local BuildFinished fan-out below:
                    // that fan-out drives PostBuildDeployPipeline (Epic #803/#911).
                    if (!limitParked)
                    {
                        try
                        {
                            if (_db != null)
                            {
                                await _db.MarkCompleteAsync(id, exitCode, entry.SessionId);
                                ActivityLog.Log("watcher", $"Reported completion of queue item {id} to Postgres.");
                            }
                            else
                            {
                                await _api.MarkQueueItemCompleteAsync(id, exitCode, entry.SessionId);
                                ActivityLog.Log("watcher", $"Reported completion of queue item {id} to the dev server.");
                            }
                        }
                        catch (Exception ex)
                        {
                            _pendingCompletions.Add((id, exitCode, entry.SessionId));
                            ActivityLog.Log("watcher", $"Couldn't report completion for queue item {id}: {ex.Message} — queued for retry.");
                        }

                        // Fire the local completion listeners REGARDLESS of the remote report
                        // outcome above. Wrapped separately so a subscriber throwing can't take
                        // down the reap loop, and so it always runs.
                        try
                        {
                            BuildFinished?.Invoke(id, entry.Title, exitCode);
                        }
                        catch (Exception ex)
                        {
                            ActivityLog.Log("watcher", $"A BuildFinished handler threw for queue item {id}: {ex.Message}");
                        }
                    }

                    // Build Sets — backstop: once this build's wave has fully drained (no
                    // more queued/running members), tell the dev-server coordinator to
                    // `close` the set so it completes — and fires its ONE deferred restart —
                    // even if a member failed without ever reporting to request-restart. On
                    // the happy path the set already auto-completed via the expected-count,
                    // so this close is a harmless single-shot no-op. Best-effort.
                    if (!limitParked && !string.IsNullOrWhiteSpace(entry.BuildSet))
                    {
                        try { await MaybeCloseDrainedBuildSetAsync(entry.BuildSet!, id); }
                        catch (Exception ex) { ActivityLog.Log("watcher", $"Build-set close backstop for '{entry.BuildSet}' failed: {ex.Message}"); }
                    }

                    // Git #1371 — worktree completion. On success, merge the build's committed
                    // changes into the local dev-server checkout (best-effort + idempotent — a no-op
                    // if the session already published its commit or committed nothing). On failure,
                    // mark the worktree stale so it's kept for debugging rather than reclaimed. The
                    // cleanup sweep (MaybeSweepWorktrees, below) reclaims a successful build's worktree
                    // once its process is gone and a short grace window has passed (so a quick Reply
                    // /resume can still reuse it). Merge-back is left to the session for ungrouped
                    // non-BuildConsole runs; here it is automatic.
                    if (!string.IsNullOrWhiteSpace(entry.WorktreeName))
                    {
                        var wtName = entry.WorktreeName!;
                        var wtPath = entry.WorktreePath;
                        if (limitParked)
                        {
                            // Git #1965/#1971 — a session-limit-parked build's process has just exited,
                            // but its worktree STILL holds uncommitted work and its session will be
                            // RESUMED in place (--resume) after the limit reset. Previously this whole
                            // block was skipped for a limit-parked build (`!limitParked && ...`), which
                            // left the worktree record `active` with a now-dead owner pid and NO
                            // keep-for-debug flag — so the 5-minute cleanup sweep reclaimed it (and
                            // force-deleted its `agent/*` branch) in the gap before auto-restart,
                            // wiping in-flight work and orphaning committed bookends (build-journal/
                            // 1882.md, 1548.md). Retain it explicitly so the sweep leaves it alone
                            // until the resume re-activates it (provision-worktree's reuse path clears
                            // this keep-for-debug flag when it re-owns the worktree).
                            _ = WorktreeCleanupService.MarkWorktreeStaleAsync(wtName, "session-limit paused — resume pending");
                        }
                        else if (exitCode == 0 && !string.IsNullOrWhiteSpace(wtPath))
                        {
                            var setEnv = BuildSetEnvFor(entry);
                            _ = WorktreeProvisionService.MergeBackAsync(wtPath!, wtName, setEnv);
                        }
                        else if (exitCode != 0)
                        {
                            _ = WorktreeCleanupService.MarkWorktreeStaleAsync(wtName, $"build failed (exit {exitCode})");
                        }
                    }

                    // Keep an interactive build's output around for the Build
                    // Watch window to finish draining and to hold its slot in
                    // interactive-render mode (never double-rendering via a
                    // file-tail). The window evicts it via ReleaseInteractive.
                    if (entry.Interactive)
                    {
                        lock (_gate)
                        {
                            CancelAutoFinalize(entry);
                            _retained[id] = entry;
                            TrimRetained();
                        }
                    }
                    _running.Remove(id);
                }

                // Git #1371 — periodically reclaim orphaned/finished agent worktrees in the
                // background (throttled). Non-force + ownership-gated, so it never touches a live
                // build's worktree, an unrelated/harness worktree, or one still inside its grace
                // window; it only sweeps up agent/* worktrees whose build process is gone.
                MaybeSweepWorktrees();

                // Git #1883 — hard gate: never claim/launch a NEW queued item until the app
                // itself has signaled genuine full readiness (see MarkAppReady). Checked
                // BEFORE and independent of the pause toggle below — this must hold "no
                // matter whether the queue is running or paused" (Shane's own words), since
                // it's heavy build processes competing with the app's own startup work for
                // resources that's the actual problem, not the pause state. Reaping (above)
                // still runs regardless — a fresh cold start has nothing to reap anyway.
                if (!_appReady) return;

                // Global pause: reaping (above) still runs so already-running
                // builds complete and free their slots, but the claim/launch of
                // any NEW queued item is skipped entirely while paused — no
                // server-side claim happens, so items stay queued until resumed.
                if (_paused) return;

                int freeSlots = _maxConcurrent - _running.Count;
                if (freeSlots <= 0) return;

                List<QueueItem> next;
                try
                {
                    next = _db != null
                        ? await _db.GetNextAsync(freeSlots)
                        : await _api.GetNextQueueItemsAsync(freeSlots, BuildConsoleSettings.Load().PausedBuildIds);
                }
                catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't poll/claim next queue item(s): {ex.Message}"); return; }

                foreach (var item in next)
                {
                    // Build Sets — resolve the set's expected member count (the wave size)
                    // so the dev-server coordinator knows how many members to wait for
                    // before firing the ONE deferred restart. Best-effort; a null just
                    // means the set relies on the drain-close backstop instead.
                    int? buildSetExpected = null;
                    if (!string.IsNullOrWhiteSpace(item.BuildSet) && _db != null)
                    {
                        try { buildSetExpected = await _db.CountBuildSetMembersAsync(item.BuildSet); }
                        catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't count build-set members for '{item.BuildSet}': {ex.Message}"); }
                    }
                    try { await LaunchItem(item, buildSetExpected); }
                    catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't launch queue item {item.Id} ({item.Title}): {ex.Message}"); }
                }
            }
            finally
            {
                _ticking = false;
            }
        }

        /// <summary>
        /// <summary>
        /// Git #1203 — build the prompt actually delivered to a launched session,
        /// prepending a short, explicit progress-reporting preamble that carries the
        /// one id the agent must use for shaneapp://reportProgress / report-progress.mjs.
        ///
        /// That id is the queue row id (<paramref name="item"/>.Id): Build Watch's live
        /// per-build progress panel keys on it (BuildWatchWindow.OccupySlot →
        /// SetChecklistBuild(item.Id)), so a report under any other value (e.g. the
        /// GitHub number) would be tracked but never shown on this build's slot. The
        /// stripped `--title`/GitHub number is included only as human-readable context.
        ///
        /// item.Prompt is not mutated — this composed string is used solely for the
        /// launch (positional arg / first stream-json user message); the Build Watch
        /// "Original instructions" reveal still shows the real prompt.
        /// </summary>
        internal static string ComposeLaunchPrompt(QueueItem item)
        {
            string body = item.Prompt ?? string.Empty;
            string ghContext = item.GithubNumber.HasValue
                ? $" (this build also tracks GitHub issue #{item.GithubNumber.Value}, but that is NOT the progress id — use {item.Id}.)"
                : string.Empty;

            string preamble =
                "[BuildConsole — progress reporting for THIS build]\n" +
                $"Your buildId for progress reporting is {item.Id}. Whenever you report a milestone — " +
                $"`node scripts/report-progress.mjs {item.Id} <step> <total> \"<phase>\"` or " +
                $"`shaneapp://reportProgress?buildId={item.Id}&step=<N>&total=<M>&label=<phase>` — " +
                $"pass buildId={item.Id} exactly." + ghContext + " This id is ALWAYS available for a queued " +
                "build; never skip progress reporting for lack of a GitHub issue number. BuildConsole's " +
                "Build Watch progress panel listens on precisely this id.\n" +
                "\n" +
                "Git #1206 — CALL IT AGAIN AT EVERY CHECKPOINT, NOT JUST ONCE. Reporting a single early " +
                "step (e.g. step 1 \"Investigation\") and then going quiet leaves the Build Watch panel " +
                "FROZEN on that first phase while you keep working — it looks stalled even though you " +
                "aren't. Re-report every time you move to a new phase: bump `step` and update `label` at " +
                "each real transition (Investigation → Implementation → Verification → …), matching the " +
                "same milestones you're already tracking in your own checklist. A good rhythm is one call " +
                "per meaningful checkpoint (not per-line spam, but definitely more than once). Send the " +
                $"FINAL call with step == total (e.g. `node scripts/report-progress.mjs {item.Id} <total> <total> \"Done\"`) " +
                "so the panel reads 100% instead of freezing mid-way.\n" +
                "\n----------------------------------------------------------------------\n\n";

            return preamble + body;
        }

        /// Git #800 — queued builds run with --print (non-interactive, real
        /// auto-exit with a real exit code) same as the standalone watcher.
        /// Output is redirected to the SAME per-item log file convention
        /// (BuildLogPaths) the chat-tab split pane (#802) already tails, so
        /// that feature works identically regardless of which watcher
        /// launched a given item.
        ///
        /// Interactive builds (BuildConsoleSettings.InteractiveBuilds, on by
        /// default) additionally redirect stdin, add --input-format
        /// stream-json, and deliver the prompt as the first stdin message
        /// instead of a positional arg — see the class doc comment.
        /// </summary>
        private async Task LaunchItem(QueueItem item, int? buildSetExpected = null, bool isForced = false)
        {
            var settings = BuildConsoleSettings.Load();
            bool interactive = settings.InteractiveBuilds;

            // Git #1989 — Conservation Cap: Shane's manual toggle for a tight usage window.
            // Checked FIRST, before any worktree provisioning or process spawn, so a capped
            // build never eats a worktree/slot it isn't going to use — it's simply parked
            // 'capped' instead of launched. isForced (Run Now / the per-item "Run at Full
            // Model" override) always bypasses this — a forced launch is a deliberate
            // one-shot decision to spend headroom on this one build, same as every other
            // manual override in this queue.
            if (!isForced && settings.ConservationModeEnabled &&
                AccountCapPolicy.ExceedsSonnetHigh(item.Model, item.Effort))
            {
                await ParkForConservationAsync(item);
                return;
            }

            // Git #1203 — the launched session must be TOLD its own buildId. The
            // `--title N` header a build was queued with (and any GitHub number it
            // resolved to) is parsed off and stripped before the prompt body is stored
            // (EditBuildPromptDialog.PrepareFinalPayload → FinalPrompt = rest), so the
            // agent's own prompt contains no id at all — it would reason "no Git #" and
            // silently skip reportProgress entirely. Worse, Build Watch's live progress
            // panel correlates on the queue row id (BuildWatchWindow.OccupySlot →
            // SetChecklistBuild(item.Id)), NOT the GitHub number, so item.Id is the
            // exact value the agent must report for progress to actually show. Prepend a
            // short, explicit preamble carrying that id so every session always knows
            // what to pass and never skips. (item.Prompt itself is left untouched so the
            // "Original instructions" reveal and slot.Prompt stay clean.)
            string launchPrompt = ComposeLaunchPrompt(item);

            // Git #1371 — resolve the working directory for this build.
            //   1. An explicit --cwd header always wins (manual override; isolation skipped).
            //   2. Otherwise, when worktree isolation is enforced (default ON), provision a fresh
            //      isolated worktree off origin/main (node_modules junctioned/shared per #1372) and
            //      run the build THERE, so it can never collide with the shared checkout or another
            //      concurrent build over the working tree/index.
            //   3. If isolation is off, fall back to the shared repo checkout (legacy behavior).
            // Provisioning failure is FAIL-LOUD: the build is not launched (never silently run in
            // the shared checkout, which would reinstate the exact collision this prevents).
            string workDir;
            string? worktreePath = null, worktreeName = null;
            if (!string.IsNullOrWhiteSpace(item.Cwd) && Directory.Exists(item.Cwd))
            {
                workDir = item.Cwd;
            }
            else if (settings.EnforceWorktreeIsolation)
            {
                worktreeName = ComposeWorktreeName(item);
                int launcherPid = Process.GetCurrentProcess().Id;
                var prov = await WorktreeProvisionService.ProvisionWorktreeAsync(worktreeName, launcherPid, link: true);
                if (!prov.Ok || string.IsNullOrWhiteSpace(prov.Path))
                {
                    ActivityLog.Log("watcher", $"Worktree provisioning FAILED for queue #{item.Id} ({item.Title}): {prov.Error}. Build NOT launched — worktree isolation is enforced. (Set EnforceWorktreeIsolation=false in %AppData%\\BuildConsole\\settings.json to run in the shared checkout instead.)");
                    await MarkLaunchFailedAsync(item.Id, $"worktree provisioning failed: {prov.Error}");
                    return;
                }
                workDir = prov.Path!;
                worktreePath = prov.Path;
            }
            else
            {
                // Git #1985 — was `workDir = _repoRoot` where _repoRoot silently defaulted to
                // AppDomain.CurrentDomain.BaseDirectory when unresolved, i.e. this would have
                // launched the build against the app's own exe folder instead of the shared
                // checkout. Fail loud instead, same contract as worktree-provisioning failure above.
                if (string.IsNullOrWhiteSpace(_repoRoot))
                {
                    ActivityLog.Log("watcher", $"Repo root unresolved — build NOT launched for queue #{item.Id} ({item.Title}). Worktree isolation is off (EnforceWorktreeIsolation=false), so this build needs the shared checkout root and there isn't one to use. Check the repo-root-resolution toast/log.");
                    await MarkLaunchFailedAsync(item.Id, "repo root unresolved — cannot launch in shared checkout");
                    return;
                }
                workDir = _repoRoot;
            }

            string exeToRun = _claudeExe;
            if (string.Equals(item.Cli, "gemini", StringComparison.OrdinalIgnoreCase))
            {
                exeToRun = _geminiExe;
            }

            if (!File.Exists(exeToRun))
            {
                string name = Path.GetFileName(exeToRun);
                ActivityLog.Log("watcher", $"{name} not found at {exeToRun} - launch failed for queue #{item.Id}.");
                await MarkLaunchFailedAsync(item.Id, $"{name} not found at {exeToRun}");
                return;
            }

            // Git #1804 — build the launch args + env overrides here, then hand them to
            // RedirectedProcessLauncher, which launches via CreateProcess with stdout/stderr
            // redirected to DURABLE FILES the child owns (not a BuildConsole-owned pipe). That is
            // the whole fix: a file handle doesn't die when this app exits, so the build survives a
            // close instead of crashing on a broken-pipe EPIPE. BuildConsole gets live output by
            // TAILING those files below (StartRawTailers), feeding the exact same HandleOutput/
            // HandleStderr pipeline the old OutputDataReceived wiring did.
            var args = new List<string>();
            // value null => REMOVE the key from the child's environment (see the secondary-account
            // token stripping below); non-null => set/override it.
            var envOverrides = new Dictionary<string, string?>();

            // Git #1416 — multi-account routing. A build queued against the "secondary"
            // account launches claude.exe with CLAUDE_CONFIG_DIR pointed at the configured
            // secondary config dir (Shane's overflow Pro account), so the whole session
            // authenticates as that account instead of the default (~/.claude). Any other
            // Account value (null/blank/"primary") leaves CLAUDE_CONFIG_DIR unset, so the
            // build uses the default config dir exactly as before. This is a sequential,
            // per-job manual choice — no concurrency change, no automatic failover.
            //
            // Git #1420 — Shane: secondary selection wasn't actually switching auth; the
            // spawned window still showed him logged in as primary. Root cause: `psi.Environment`
            // is pre-populated with a COPY of this process's own environment (ProcessStartInfo's
            // documented behavior for UseShellExecute=false), so setting CLAUDE_CONFIG_DIR alone
            // does not remove a real, persistent CLAUDE_CODE_OAUTH_TOKEN Shane has set as a
            // user-level env var (via `claude setup-token`, for spawned agents' headless auth).
            // The Claude Code CLI authenticates directly off that token when present — it isn't
            // just a fallback consulted when CLAUDE_CONFIG_DIR has no session — so the inherited
            // token silently overrode the secondary config dir every time. Explicitly strip it
            // (and ANTHROPIC_API_KEY, which docs confirm also outranks subscription/config-dir
            // auth) from the spawned process's environment when secondary is selected, so it's
            // genuinely forced back onto the secondary CLAUDE_CONFIG_DIR's own logged-in session.
            if (string.Equals(item.Account, "secondary", StringComparison.OrdinalIgnoreCase))
            {
                string secondaryDir = ExpandUserPath(settings.SecondaryClaudeConfigDir);
                if (string.IsNullOrWhiteSpace(secondaryDir))
                {
                    ActivityLog.Log("watcher", $"Queue #{item.Id} requested the secondary account but SecondaryClaudeConfigDir is unset in settings — launching against the DEFAULT account instead.");
                }
                else
                {
                    envOverrides["CLAUDE_CONFIG_DIR"] = secondaryDir;
                    // null value => RedirectedProcessLauncher removes the key from the child's env.
                    bool hadOAuthToken = Environment.GetEnvironmentVariable("CLAUDE_CODE_OAUTH_TOKEN") != null;
                    bool hadApiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY") != null;
                    envOverrides["CLAUDE_CODE_OAUTH_TOKEN"] = null;
                    envOverrides["ANTHROPIC_API_KEY"] = null;
                    ActivityLog.Log("watcher", $"Queue #{item.Id} ({item.Title}) routed to the SECONDARY Claude account — CLAUDE_CONFIG_DIR={secondaryDir}" +
                        (hadOAuthToken || hadApiKey ? $" (stripped inherited {(hadOAuthToken ? "CLAUDE_CODE_OAUTH_TOKEN" : "")}{(hadOAuthToken && hadApiKey ? " + " : "")}{(hadApiKey ? "ANTHROPIC_API_KEY" : "")} so the secondary config dir's own session is actually used)" : "") + ".");
                }
            }

            // Git #1986 — Home/Rental network gate. Inject BUILD_NETWORK into EVERY launched
            // build so the session can read whether it's on Shane's capped Verizon connection.
            // The value is taken from the LIVE global location toggle at launch time
            // (BuildConsoleSettings.CurrentNetworkIsMetered), so it always reflects where the
            // machine actually is NOW — never a stale queued-time value. A build's own
            // `--network metered` header flag can TIGHTEN this to metered even when the global
            // toggle is Home, but can NEVER loosen it: a build cannot self-declare "unmetered"
            // to escape a Rental gate — that would be exactly the agent self-override the gate
            // forbids. This is a signal an agent READS, never one it can flip to grant itself an
            // exception. The .pnpmfile.cjs metered-install refusal at the repo root reads the same
            // BUILD_NETWORK, catching a `pnpm install` an agent shell runs that this UI can't see.
            {
                bool globalMetered = BuildConsoleSettings.CurrentNetworkIsMetered();
                bool flagMetered = HeaderFlagSaysMetered(item.Prompt);
                bool metered = globalMetered || flagMetered;
                envOverrides["BUILD_NETWORK"] = metered ? "metered" : "unmetered";
                ActivityLog.Log("watcher",
                    $"Queue #{item.Id} launched with BUILD_NETWORK={(metered ? "metered" : "unmetered")} (location {(globalMetered ? "Rental" : "Home")}" +
                    (flagMetered && !globalMetered ? ", forced metered by --network flag" : "") + ").");
            }

            // Git #826 — a Reply resumes the ORIGINAL session instead of
            // starting a fresh one (that's the whole point - continuing a
            // conversation that already asked a question). --resume brings
            // its own model/effort/context, so skip the fresh-session flags
            // and let the resumed session's own settings apply.
            if (!string.IsNullOrWhiteSpace(item.ResumeSessionId))
            {
                args.Add("--resume");
                args.Add(item.ResumeSessionId);
            }
            else
            {
                if (!string.IsNullOrWhiteSpace(item.Title)) { args.Add("--name"); args.Add(item.Title); }
                if (!string.IsNullOrWhiteSpace(item.Model)) { args.Add("--model"); args.Add(item.Model); }
                if (!string.IsNullOrWhiteSpace(item.Effort)) { args.Add("--effort"); args.Add(item.Effort); }
            }

            // Build Sets — hand the dev-server coordinator everything it needs (via env)
            // to DEFER the dev-server restart until every member of this set has merged,
            // then fire exactly ONE restart for the combined changes. The agent's
            // `request-restart.mjs` reads these (DEV_BUILD_SET / _MEMBER / _EXPECTED) with
            // no extra work on its part. Unset for ungrouped builds — those keep the
            // existing per-build coalescing untouched. See scripts/dev-server/.
            if (!string.IsNullOrWhiteSpace(item.BuildSet))
            {
                string memberKey = item.GithubNumber?.ToString() ?? item.Id.ToString();
                envOverrides["DEV_BUILD_SET"] = item.BuildSet;
                envOverrides["DEV_BUILD_SET_MEMBER"] = memberKey;
                if (buildSetExpected.HasValue && buildSetExpected.Value > 0)
                    envOverrides["DEV_BUILD_SET_EXPECTED"] = buildSetExpected.Value.ToString();
                ActivityLog.Log("watcher", $"Build set '{item.BuildSet}': launching member {memberKey} (expected {(buildSetExpected?.ToString() ?? "?")}) — dev-server restart deferred until the whole set completes.");
            }

            args.Add("--permission-mode");
            args.Add("auto");
            args.Add("--print");
            // Git #825 — --output-format stream-json emits one real JSON event
            // per line AS work happens (system init, assistant text/tool_use,
            // final result). SummarizeStreamJsonLine turns those into readable
            // text for the log/buffer instead of raw JSON.
            if (interactive)
            {
                // Confirmed real via `claude --help`: "--input-format <format>
                // ... 'stream-json' (realtime streaming input) (only works with
                // --print)". The prompt (and every later chat message) is fed as
                // a stream-json user message on stdin below.
                args.Add("--input-format");
                args.Add("stream-json");
            }
            args.Add("--output-format");
            args.Add("stream-json");
            args.Add("--verbose");

            if (!interactive)
            {
                // Legacy path only. Git #820 — a literal "--" is commander's
                // end-of-options marker: everything after it is positional,
                // never re-parsed as a flag, no matter what the prompt looks
                // like. (Interactive builds don't pass the prompt positionally
                // at all — it goes over stdin as JSON — so this whole class of
                // arg-mangling bug can't apply to them.)
                args.Add("--");
                args.Add(launchPrompt);
            }

            // Human-readable per-item SUMMARY log (#802 BuildLogView / MainWindow.TailBuildLog tail
            // THIS file). It stays the flattened "[tool: X]" summary AppendToLogFile writes — NOT the
            // raw stream-json — so those views render unchanged. Clear any stale content up front.
            var logPath = BuildLogPaths.ForQueueItem(item.Id);
            Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
            File.WriteAllText(logPath, "");

            // Git #1804 — the durable raw redirect targets the child owns. Kept separate from the
            // summary logPath above so claude's raw stream-json never clobbers the human-readable
            // view; the internal tailer reads these and feeds HandleOutput/HandleStderr.
            var rawStdoutPath = logPath + ".raw";
            var rawStderrPath = logPath + ".err";

            // Git #826 — created (and registered in _running) BEFORE the tailers start, so the very
            // first output line — where the real session_id shows up — has somewhere to land.
            var entry = new RunningEntry
            {
                Title = item.Title,
                Interactive = interactive,
                LogPath = logPath,
                RawStdoutPath = rawStdoutPath,
                RawStderrPath = rawStderrPath,
                TailCts = new CancellationTokenSource(),
                LastActivityUtc = DateTime.UtcNow,
                State = InteractiveInputState.Working,
                IdleFinalizeMs = Math.Max(0, settings.InteractiveIdleFinalizeSeconds) * 1000,
                BuildSet = string.IsNullOrWhiteSpace(item.BuildSet) ? null : item.BuildSet,
                BuildSetMember = string.IsNullOrWhiteSpace(item.BuildSet) ? null : (item.GithubNumber?.ToString() ?? item.Id.ToString()),
                WorktreePath = worktreePath,
                WorktreeName = worktreeName,
            };

            RedirectedProcessLauncher.LaunchedProcess launched;
            try
            {
                launched = RedirectedProcessLauncher.Launch(
                    exeToRun, args, workDir, envOverrides, rawStdoutPath, rawStderrPath, redirectStdin: interactive);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("watcher", $"Launch failed for queue #{item.Id} ({item.Title}): {ex.Message}");
                entry.TailCts.Dispose();
                await MarkLaunchFailedAsync(item.Id, $"process launch failed: {ex.Message}");
                return;
            }
            entry.Process = launched.Process;
            entry.Stdin = launched.StdIn;

            // Tail the durable raw files into the same output pipeline the old in-process pipe fed.
            StartRawTailers(entry, item.Id);

            // Git #1371 — re-point the worktree's owner pid from the launcher (BuildConsole) to
            // the freshly-started build process, so the cleanup sweep retains the worktree exactly
            // while THIS build runs and can reclaim it (after a grace period) once the build exits.
            int launchedPid = launched.Process.Id;
            if (worktreeName != null)
            {
                _ = WorktreeProvisionService.StampOwnerAsync(worktreeName, launchedPid);
            }

            // Git #1839 — stamp the build's pid + its process-creation time on the queue row so a
            // restarted BuildConsole can find this still-running process and ADOPT it (remount its
            // Build Watch slot) instead of falsely marking the row failed -2. The creation time is
            // the pid-reuse fingerprint that makes the later match safe. Direct-DB only (the pid
            // columns are a local-DB adoption mechanism; HTTP-fallback mode can't adopt anyway).
            if (_db != null)
            {
                var startedAt = launched.Process.CreationTimeUtc;
                if (startedAt.HasValue)
                {
                    var startedAtUtc = new DateTimeOffset(DateTime.SpecifyKind(startedAt.Value, DateTimeKind.Utc));
                    _ = Task.Run(async () =>
                    {
                        try { await _db.StampBuildPidAsync(item.Id, launchedPid, startedAtUtc); }
                        catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't stamp build pid {launchedPid} for queue #{item.Id}: {ex.Message}"); }
                    });
                }
                else
                {
                    ActivityLog.Log("watcher", $"Couldn't read creation time for build pid {launchedPid} (queue #{item.Id}) — adoption after restart won't be possible for this build.");
                }
            }

            if (interactive)
            {
                // entry.Stdin was set from launched.StdIn above (the owned pipe write end).
                // Deliver the initial prompt as the first stream-json user
                // message. If this throws (rare), the process is still up and
                // the build will simply idle-finalize; log it either way.
                try { WriteUserMessage(entry, launchPrompt); }
                catch (Exception ex) { ActivityLog.Log("interactive-build", $"couldn't write initial prompt to queue #{item.Id}: {ex.Message}"); }
            }

            _running[item.Id] = entry;

            if (interactive)
                ActivityLog.Log("interactive-build", $"launched (durable-file stdout/stderr redirect + owned stdin, --input-format stream-json): {item.Title} (queue #{item.Id}, {_running.Count}/{_maxConcurrent} running)");
            ActivityLog.Log("watcher", $"Started: {item.Title} (queue #{item.Id}, {_running.Count}/{_maxConcurrent} running)");
        }

        // ── Durable-file raw tailers (Git #1804) ────────────────────────────

        /// <summary>
        /// Git #1804 — starts a background task that tails the build's durable raw stdout/stderr
        /// files (which the child process itself owns) and feeds each complete line into the exact
        /// same <see cref="HandleOutput"/>/<see cref="HandleStderr"/> pipeline the retired in-process
        /// <c>OutputDataReceived</c> pipe used to. This is what keeps Build Watch live-streaming while
        /// BuildConsole is open — WITHOUT the build's survival depending on it: if the app closes, the
        /// tailer thread simply dies, but claude.exe keeps writing to its own file handle and runs on.
        /// The loop drains once more after the process exits so the final <c>result</c> line (session
        /// id / usage / cost) is never missed.
        /// </summary>
        private void StartRawTailers(RunningEntry entry, int id, bool adopt = false)
        {
            var ct = entry.TailCts?.Token ?? CancellationToken.None;

            // Git #1839 — for an ADOPTED build the tailers replay the pre-restart transcript from
            // offset 0 (the LineTailer always opens at position 0). Bound that replay by each file's
            // CURRENT length so HandleOutput/HandleStderr can suppress the non-idempotent escaping
            // side-effects (durable usage-cost accounting + session-limit parking) for the
            // already-processed region, then re-enable them once the tailer catches up to live.
            // entry.Replaying was set true by AdoptRunningItem; it's cleared here once BOTH streams
            // (that actually exist) have caught up.
            long soBoundary = 0, seBoundary = 0;
            Action? onStdoutReplayDone = null, onStderrReplayDone = null;
            if (adopt)
            {
                bool soExists = TryFileLength(entry.RawStdoutPath, out soBoundary);
                bool seExists = TryFileLength(entry.RawStderrPath, out seBoundary);
                int pending = (soExists ? 1 : 0) + (seExists ? 1 : 0);
                if (pending == 0)
                {
                    entry.Replaying = false; // nothing on disk to replay — go live immediately
                }
                else
                {
                    Action done = () =>
                    {
                        if (Interlocked.Decrement(ref pending) == 0)
                        {
                            entry.Replaying = false;
                            ActivityLog.Log("watcher", $"Adopted queue #{id}: transcript replay complete — live tailing resumed, usage/limit accounting re-enabled.");
                        }
                    };
                    if (soExists) onStdoutReplayDone = done;
                    if (seExists) onStderrReplayDone = done;
                }
            }

            var stdoutTail = new LineTailer(entry.RawStdoutPath, line => HandleOutput(entry, id, line), adopt ? soBoundary : -1, onStdoutReplayDone);
            var stderrTail = new LineTailer(entry.RawStderrPath, line => HandleStderr(entry, id, line), adopt ? seBoundary : -1, onStderrReplayDone);
            _ = Task.Run(async () =>
            {
                try
                {
                    while (!ct.IsCancellationRequested)
                    {
                        stdoutTail.Pump();
                        stderrTail.Pump();

                        bool exited;
                        try { exited = entry.Process.HasExited; } catch { exited = true; }
                        if (exited)
                        {
                            // Final drain — catch lines that landed between the last pump and exit.
                            stdoutTail.Pump(); stdoutTail.FlushRemainder();
                            stderrTail.Pump(); stderrTail.FlushRemainder();
                            break;
                        }
                        try { await Task.Delay(200, ct); }
                        catch (OperationCanceledException) { break; }
                    }
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("watcher", $"Raw log tailer for queue #{id} stopped: {ex.Message}");
                }
                finally
                {
                    stdoutTail.Dispose();
                    stderrTail.Dispose();
                }
            });
        }

        /// <summary>Git #1839 — the current byte length of a file, or false when it doesn't exist /
        /// can't be stat'd. Used to bound an adopted build's transcript replay window.</summary>
        private static bool TryFileLength(string path, out long len)
        {
            len = 0;
            try { if (File.Exists(path)) { len = new FileInfo(path).Length; return true; } }
            catch { /* transient stat failure — treat as absent */ }
            return false;
        }

        /// <summary>Incrementally tails one durable log file, emitting each complete '\n'-terminated
        /// line (trailing '\r' trimmed) via the callback. UTF-8 decoding is stateful across reads so a
        /// multi-byte char split across a write boundary is never corrupted. Opens the file lazily
        /// (the child may not have created it yet) with FileShare.ReadWrite so it reads while the child
        /// writes — the same tolerant tail ExternalLogWindow uses.</summary>
        private sealed class LineTailer : IDisposable
        {
            private readonly string _path;
            private readonly Action<string> _onLine;
            private FileStream? _fs;
            private readonly Decoder _decoder = new UTF8Encoding(false).GetDecoder();
            private readonly StringBuilder _line = new();
            private readonly byte[] _buf = new byte[8192];
            private char[] _chars = new char[8192];

            // Git #1839 — replay-window bound for an adopted build. _replayBoundary is the file's
            // byte length captured at adoption; once the read position reaches it, _onReplayComplete
            // fires once (flipping the entry out of its side-effect-suppressed replay window). A
            // boundary of -1 (the normal-launch case) means "no replay concept" — never signals.
            private readonly long _replayBoundary;
            private readonly Action? _onReplayComplete;
            private bool _replaySignaled;

            public LineTailer(string path, Action<string> onLine, long replayBoundary = -1, Action? onReplayComplete = null)
            {
                _path = path;
                _onLine = onLine;
                _replayBoundary = replayBoundary;
                _onReplayComplete = onReplayComplete;
            }

            public void Pump()
            {
                try
                {
                    if (_fs == null)
                    {
                        if (!File.Exists(_path)) return;
                        _fs = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                    }
                    int read;
                    while ((read = _fs.Read(_buf, 0, _buf.Length)) > 0)
                    {
                        int n = _decoder.GetChars(_buf, 0, read, _chars, 0);
                        for (int i = 0; i < n; i++)
                        {
                            char c = _chars[i];
                            if (c == '\n') { EmitLine(); }
                            else _line.Append(c);
                        }
                    }

                    // Git #1839 — we've drained to the current end of file. If that reaches the
                    // captured replay boundary, the pre-restart transcript has been fully re-fed;
                    // signal so live side-effects resume for anything appended after this point.
                    if (!_replaySignaled && _onReplayComplete != null && _fs.Position >= _replayBoundary)
                    {
                        _replaySignaled = true;
                        _onReplayComplete();
                    }
                }
                catch (IOException) { /* file locked mid-write — retry next pump */ }
            }

            /// <summary>Emit any buffered trailing content that never got a closing newline (defensive — stream-json lines are newline-terminated).</summary>
            public void FlushRemainder()
            {
                if (_line.Length > 0) EmitLine();
            }

            private void EmitLine()
            {
                var s = _line.ToString();
                _line.Clear();
                if (s.EndsWith("\r", StringComparison.Ordinal)) s = s.Substring(0, s.Length - 1);
                _onLine(s);
            }

            public void Dispose() { try { _fs?.Dispose(); } catch { } }
        }

        // ── Output handling ─────────────────────────────────────────────────

        private void HandleOutput(RunningEntry entry, int id, string? data)
        {
            if (data == null) return;
            if (entry.SessionId == null)
            {
                var sid = TryExtractSessionId(data);
                if (sid != null)
                {
                    bool justCaptured = false;
                    lock (_gate)
                    {
                        if (entry.SessionId == null) { entry.SessionId = sid; justCaptured = true; }
                    }
                    // Crash-recovery groundwork (see BuildQueuePostgresClient.UpdateSessionIdAsync):
                    // persist the session id NOW, not just at completion, so a build killed by an
                    // app crash/hard reboot mid-run still leaves a resumable session behind instead
                    // of forcing Retry to discard everything and restart from scratch.
                    if (justCaptured && _db != null)
                    {
                        _ = Task.Run(async () =>
                        {
                            try { await _db.UpdateSessionIdAsync(id, sid); }
                            catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't persist early session id for queue #{id}: {ex.Message}"); }
                        });
                    }
                }
            }

            var ctxTokens = TryExtractContextTokens(data);
            if (ctxTokens.HasValue) lock (_gate) entry.ContextTokens = ctxTokens;

            // Session-limit auto-restart: the CLI's limit message can land on stdout
            // (inside a stream-json string) or stderr — match the raw line either way.
            // Git #1839 — suppressed during an adopted build's replay window: parking a still-live
            // build limit-paused off a HISTORICAL limit line would be wrong (a real, current limit
            // message is caught by the live tailer after replay completes).
            if (!entry.Replaying) DetectSessionLimit(entry, id, data, fromStderr: false);

            // (1) Human-readable per-item log FILE — for BOTH interactive and legacy builds
            //     (#802 BuildLogView + the foreign/legacy file-tail render path). Unchanged:
            //     the same flattened "[tool: X]" summary as before. (During an adopted build's
            //     replay this rebuilds the summary file the app truncated on adoption — desired.)
            var summary = SummarizeStreamJsonLine(data, out bool isResult);
            if (summary != null) AppendToLogFile(entry, summary);

            // Real, durable usage/cost tracking (Shane: "I would love to track how much
            // AI tokens total, AI cost total... for fun and tracking purposes") — the
            // CLI's own `result` line carries its authoritative total_cost_usd + usage
            // for that completed turn, real numbers (not the $5/1M estimate the "active"
            // badge above uses for still-in-progress work). An interactive build sends one
            // of these per turn, each a distinct real turn, so each gets recorded.
            // Git #1839 — suppressed during an adopted build's replay window: this accumulator is
            // DURABLE and INCREMENTAL (persists to disk, adds each turn), so re-feeding the
            // pre-restart transcript would DOUBLE-COUNT every turn the previous instance already
            // recorded. Turns completed AFTER adoption (live) still count.
            if (!entry.Replaying && isResult && TryExtractResultUsageAndCost(data, out long resultTokens, out double resultCost))
            {
                UsageTrackingService.RecordCompletion(resultTokens, resultCost);
            }

            if (!entry.Interactive) return;

            // (2) Structured event stream — interactive builds only. Full fidelity: the real
            //     command/arguments (ToolCall) and real tool output (ToolResult) the Build
            //     Watch chip renders on expand, plus file-edit diffs. This is exactly where the
            //     old bug lived: SummarizeStreamJsonLine kept only the tool NAME and dropped
            //     `input` + every tool_result event, so the chip had nothing to show inside.
            var events = ParseInteractiveEvents(data);
            LogRawSampleOnce(events, data);
            bool hadRenderable = false;
            foreach (var ev in events) { AppendEvent(entry, ev); hadRenderable = true; }

            string? waitingLog = null;
            lock (_gate)
            {
                entry.LastActivityUtc = DateTime.UtcNow;
                if (isResult)
                {
                    // A turn finished. Unless a Stop is mid-flight, the process
                    // is now idle awaiting the next stdin message.
                    if (entry.StopRequestedUtc == null)
                    {
                        if (entry.State != InteractiveInputState.WaitingForInput)
                        {
                            entry.State = InteractiveInputState.WaitingForInput;
                            waitingLog = $"waiting for input detected: {entry.Title} (queue #{id})";
                        }
                        entry.AwaitingInputSince = DateTime.UtcNow;
                        ScheduleAutoFinalize(entry, id);
                    }
                }
                else if (hadRenderable)
                {
                    // Fresh assistant / tool / tool-result output → actively working (unless a
                    // Stop is in flight, in which case the escalation check owns the state and
                    // reads LastActivityUtc to decide).
                    if (entry.StopRequestedUtc == null && entry.State != InteractiveInputState.Working)
                    {
                        entry.State = InteractiveInputState.Working;
                        entry.AwaitingInputSince = null;
                        CancelAutoFinalize(entry);
                    }
                }
            }
            if (waitingLog != null) ActivityLog.Log("interactive-build", waitingLog);
        }

        /// <summary>Writes one already-summarized line to the per-item log FILE (BuildLogView/#802 and the foreign/legacy file-tail render path). File only — the interactive Build Watch render pulls the structured <see cref="RunningEntry.Events"/> stream instead (see <see cref="AppendEvent"/>).</summary>
        private static void AppendToLogFile(RunningEntry entry, string text)
        {
            try { lock (entry.LogLock) File.AppendAllText(entry.LogPath, text + Environment.NewLine); }
            catch { /* file locked mid-write elsewhere — the structured buffer still carries it for Build Watch */ }
        }

        /// <summary>Appends one structured event to the interactive build's live buffer the Build Watch window pulls (via <see cref="CopyEventsSince"/>), trimming the front once over <see cref="MaxBufferedEvents"/>. Also maintains <see cref="RunningEntry.ActiveSubagents"/> so Build Watch can surface in-progress background agents. Guarded by _gate.</summary>
        private void AppendEvent(RunningEntry entry, InteractiveEvent ev)
        {
            lock (_gate)
            {
                entry.Events.Add(ev);
                entry.TotalEmitted++;
                int overflow = entry.Events.Count - MaxBufferedEvents;
                if (overflow > 0) entry.Events.RemoveRange(0, overflow);

                // Track background subagents: add on tool_call, remove when its tool_result lands.
                if (ev.Kind == InteractiveEventKind.ToolCall && IsSubagentOrBackgroundTool(ev.ToolName))
                {
                    var key = ev.ToolUseId ?? Guid.NewGuid().ToString();
                    entry.ActiveSubagents[key] = new SubagentActivityInfo
                    {
                        ToolUseId = key,
                        Description = ev.CommandPreview ?? ev.ToolName ?? "subagent",
                        ToolName = ev.ToolName ?? "Task",
                        StartedAtUtc = DateTime.UtcNow
                    };
                }
                else if (ev.Kind == InteractiveEventKind.ToolResult && !string.IsNullOrEmpty(ev.ResultForToolUseId))
                {
                    entry.ActiveSubagents.Remove(ev.ResultForToolUseId);
                }
            }
        }

        /// <summary>Returns true for tool names that represent a long-running background subagent or workflow the user should be aware of (e.g. Task, workflow).</summary>
        public static bool IsSubagentOrBackgroundTool(string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return false;
            return name.Equals("Task", StringComparison.OrdinalIgnoreCase)
                || name.IndexOf("subagent", StringComparison.OrdinalIgnoreCase) >= 0
                || name.Equals("workflow", StringComparison.OrdinalIgnoreCase)
                || name.Equals("background_task", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Returns the currently active background subagents / workflows for this queue item (those whose tool_result hasn't landed yet), or an empty list. UI-thread safe.</summary>
        public List<SubagentActivityInfo> GetActiveSubagents(int id)
        {
            lock (_gate)
            {
                if (_running.TryGetValue(id, out var entry) && entry.ActiveSubagents.Count > 0)
                    return new List<SubagentActivityInfo>(entry.ActiveSubagents.Values);
                return new List<SubagentActivityInfo>();
            }
        }



        /// <summary>Session-limit auto-restart: flags this build the first time a raw output line matches the CLI's session/usage-limit message (see <see cref="SessionLimitAutoRestartService.TryDetectLimitMessage"/>). The reap loop reads the flag to park the row limit-paused instead of failed.</summary>
        private void DetectSessionLimit(RunningEntry entry, int id, string data, bool fromStderr)
        {
            // Guard against false positives: a build that merely READS code or docs
            // mentioning the limit message (e.g. this feature's own source) streams
            // that text back as "type":"user" tool_result lines. The CLI's REAL limit
            // notice arrives as a "result"/"system" stream-json event or on stderr —
            // only those are eligible.
            if (!fromStderr
                && data.IndexOf("\"type\":\"result\"", StringComparison.Ordinal) < 0
                && data.IndexOf("\"type\":\"system\"", StringComparison.Ordinal) < 0) return;
            if (!SessionLimitAutoRestartService.TryDetectLimitMessage(data, out var resetLabel)) return;
            bool first;
            lock (_gate)
            {
                first = !entry.SessionLimitHit;
                entry.SessionLimitHit = true;
                if (resetLabel != null) entry.SessionLimitResetLabel = resetLabel;
            }
            if (first)
                ActivityLog.Log("session-limit", $"Queue #{id} ({entry.Title}) hit the Claude session limit (resets {resetLabel ?? "label not captured"}) — will park limit-paused when its process exits and auto-restart after the reset.");
        }

        /// <summary>A raw stderr line (not stream-json): tee it to the log FILE and, for an interactive build, surface it in the Build Watch render as an error-tinted text event.</summary>
        private void HandleStderr(RunningEntry entry, int id, string data)
        {
            AppendToLogFile(entry, data);
            // Git #1839 — suppressed during an adopted build's replay window (see HandleOutput).
            if (!entry.Replaying) DetectSessionLimit(entry, id, data, fromStderr: true);
            if (entry.Interactive) AppendEvent(entry, new InteractiveEvent { Kind = InteractiveEventKind.AssistantText, Text = data, IsError = true });
        }

        /// <summary>
        /// Logs exactly one real raw sample of a tool_use event and one of a tool_result event
        /// per app run (on the "stream-json" ActivityLog channel), so the real event structure
        /// this parser depends on is verifiable/diagnosable from the log alone if a related issue
        /// ever recurs — without having to redo the live-capture investigation. Truncated so a
        /// large tool result can't flood the log.
        /// </summary>
        private static void LogRawSampleOnce(List<InteractiveEvent> events, string rawLine)
        {
            bool hasToolUse = false, hasToolResult = false;
            foreach (var ev in events)
            {
                if (ev.Kind == InteractiveEventKind.ToolCall) hasToolUse = true;
                else if (ev.Kind == InteractiveEventKind.ToolResult) hasToolResult = true;
            }
            if (hasToolUse && Interlocked.Exchange(ref _loggedToolUseSample, 1) == 0)
                ActivityLog.Log("stream-json", "sample tool_use event (raw, once/run): " + Truncate(rawLine, 2000));
            if (hasToolResult && Interlocked.Exchange(ref _loggedToolResultSample, 1) == 0)
                ActivityLog.Log("stream-json", "sample tool_result event (raw, once/run): " + Truncate(rawLine, 2000));
        }

        private static string Truncate(string s, int max) => s.Length <= max ? s : s.Substring(0, max) + $"… (+{s.Length - max} chars)";

        // ── Interactive input / stop / finalize (public: called by BuildWatchWindow) ──

        /// <summary>
        /// Git #1839 — whether this app instance owns a LIVE, WRITABLE stdin for this build. This is
        /// the true meaning of "owns interactive": it drives the chat box / stdin-send path only.
        /// FALSE for an ADOPTED build (its stdin pipe died with the previous app and cannot be
        /// re-attached — <see cref="RunningEntry.Stdin"/> is null) and FALSE for a retained (exited)
        /// build. For "should this slot RENDER the interactive transcript / context meter / state"
        /// use <see cref="IsInteractiveRenderable"/> instead — that stays true for adopted and
        /// retained builds so their output keeps streaming.
        /// </summary>
        public bool OwnsInteractive(int id) =>
            _running.TryGetValue(id, out var e) && e.Interactive && e.Stdin != null;

        /// <summary>
        /// Git #1839 — whether this queue id can render from the interactive structured stream
        /// (live output, context meter, working/waiting state): true for any interactive build we
        /// track — launched OR adopted — still running, and for a retained (exited) build whose
        /// Build Watch slot is still draining its buffer. This is the OLD <see cref="OwnsInteractive"/>
        /// semantics, split out so adoption can keep rendering while its stdin is honestly gone.
        /// </summary>
        public bool IsInteractiveRenderable(int id) =>
            (_running.TryGetValue(id, out var e) && e.Interactive) || _retained.ContainsKey(id);

        /// <summary>Git #1839 — true while this is a LIVE build that was ADOPTED by pid after a
        /// BuildConsole restart: it renders/streams like an interactive build but has no owned stdin,
        /// so the Build Watch composer is read-only (Stop/Kill still work). False once it exits.</summary>
        public bool IsAdopted(int id) =>
            _running.TryGetValue(id, out var e) && e.Adopted && !e.Process.HasExited;

        /// <summary>Checks whether this queue id's process has exited locally (either currently retained or completed in _running).</summary>
        public bool HasExited(int id, out int exitCode)
        {
            exitCode = 0;
            if (_retained.TryGetValue(id, out var r))
            {
                exitCode = r.Process.ExitCode;
                return true;
            }
            if (_running.TryGetValue(id, out var rn) && rn.Process.HasExited)
            {
                exitCode = rn.Process.ExitCode;
                return true;
            }
            return false;
        }

        /// <summary>Checks whether a running or retained build has hit the session limit.</summary>
        public bool IsSessionLimitHit(int id)
        {
            if (_retained.TryGetValue(id, out var r))
            {
                lock (_gate) return r.SessionLimitHit;
            }
            if (_running.TryGetValue(id, out var rn))
            {
                lock (_gate) return rn.SessionLimitHit;
            }
            return false;
        }

        /// <summary>The current three-state indicator value for a LIVE interactive build, or null if it isn't one we own and is still running (terminal/retained/legacy/foreign → the caller uses the queue-derived state instead).</summary>
        public InteractiveInputState? GetInteractiveState(int id)
        {
            if (_running.TryGetValue(id, out var e) && e.Interactive && !e.Process.HasExited)
            {
                lock (_gate) return e.State;
            }
            return null;
        }

        /// <summary>Returns the captured Claude session ID for a live or recently finished interactive build.</summary>
        public string? GetSessionId(int id)
        {
            if (_running.TryGetValue(id, out var e) && !string.IsNullOrWhiteSpace(e.SessionId)) return e.SessionId;
            if (_retained.TryGetValue(id, out var r) && !string.IsNullOrWhiteSpace(r.SessionId)) return r.SessionId;
            return null;
        }

        /// <summary>Immediately launches a claimed queue item (e.g. when resuming or continuing an interactive session from Build Watch).</summary>
        public void LaunchItemExplicit(QueueItem item) => _ = SafeLaunch(item, isForced: true);

        /// <summary>Approximate current context-window token usage for a live or just-exited (retained) interactive build — real numbers read from the CLI's own stream-json `usage` field, or null if unknown/not an interactive build/nothing seen yet.</summary>
        public long? GetContextTokens(int id)
        {
            if (_running.TryGetValue(id, out var e) && e.Interactive) { lock (_gate) return e.ContextTokens; }
            if (_retained.TryGetValue(id, out var r) && r.Interactive) { lock (_gate) return r.ContextTokens; }
            return null;
        }

        /// <summary>Gets aggregate active token count and estimated cost across all running interactive builds.</summary>
        public (long TotalTokens, double EstimatedCost, int ActiveBuildCount) GetActiveUsageSummary()
        {
            long totalTokens = 0;
            int count = 0;
            lock (_gate)
            {
                foreach (var kvp in _running)
                {
                    if (kvp.Value.Interactive && !kvp.Value.Process.HasExited)
                    {
                        count++;
                        totalTokens += kvp.Value.ContextTokens ?? 0;
                    }
                }
            }
            // Estimated blended cost: ~$5.00 per 1M context tokens ($0.000005 per token)
            double cost = (totalTokens / 1_000_000.0) * 5.0;
            return (totalTokens, cost, count);
        }

        /// <summary>Pulls every structured event appended since <paramref name="cursor"/> (an absolute event index; survives buffer trimming) and advances it. Reads a live entry or, if already reaped, its retained copy — so the final tail is never lost in the exit→remove race.</summary>
        public List<InteractiveEvent> CopyEventsSince(int id, ref int cursor)
        {
            if (!_running.TryGetValue(id, out var e)) _retained.TryGetValue(id, out e);
            if (e == null || !e.Interactive) return new List<InteractiveEvent>();
            lock (_gate)
            {
                int first = e.TotalEmitted - e.Events.Count;
                if (cursor < first) cursor = first;
                int startIdx = cursor - first;
                if (startIdx < 0) startIdx = 0;
                if (startIdx >= e.Events.Count) { cursor = e.TotalEmitted; return new List<InteractiveEvent>(); }
                var slice = e.Events.GetRange(startIdx, e.Events.Count - startIdx);
                cursor = e.TotalEmitted;
                return slice;
            }
        }

        /// <summary>
        /// Types a real chat message into the running build's stdin (delivered as a
        /// stream-json user message, so an @path or any character passes through
        /// unmangled). Interruption is supported precisely because stdin stays open for
        /// the whole run — sending mid-task reaches the live process at once.
        ///
        /// Git #1327 — returns <c>true</c> only when the message was genuinely written to
        /// a live owned stdin. It returns <c>false</c> (rather than silently swallowing the
        /// message, the old behavior) whenever it CANNOT deliver: no interactive process
        /// owns this id, the process already exited, or the write itself throws (the pipe
        /// was closed out from under it — most commonly by the 15s idle auto-finalize
        /// closing stdin just as the user types a nudge into a "stuck"/waiting build).
        /// The Build Watch caller uses that false to fall back to a --resume continuation
        /// so the typed guidance still reaches the real session instead of vanishing while
        /// the UI optimistically shows it as sent.
        /// </summary>
        public bool SendInput(int id, string text)
        {
            if (!_running.TryGetValue(id, out var entry) || !entry.Interactive)
            {
                ActivityLog.Log("interactive-build", $"live stdin unavailable — no interactive process owns queue #{id} (caller will resume the session instead)");
                return false;
            }
            if (entry.Process.HasExited)
            {
                ActivityLog.Log("interactive-build", $"live stdin unavailable — process for queue #{id} already exited (caller will resume the session instead)");
                return false;
            }

            // Cancel any pending idle auto-finalize FIRST, before touching stdin: a nudge
            // arriving inside the 15s idle window must keep the pipe open rather than race
            // the timer that closes it. (The write below can still fail if the timer had
            // already fired — that path returns false and the caller resumes.)
            bool wasWorking;
            lock (_gate)
            {
                wasWorking = entry.State == InteractiveInputState.Working;
                CancelAutoFinalize(entry);
            }

            try { WriteUserMessage(entry, text); }
            catch (Exception ex)
            {
                // Pipe closed/broken (auto-finalize already closed stdin, or the process
                // is mid-exit). Do NOT drop the message — signal the caller to resume.
                ActivityLog.Log("interactive-build", $"live stdin write failed for queue #{id}: {ex.Message} (caller will resume the session instead)");
                return false;
            }

            lock (_gate)
            {
                entry.State = InteractiveInputState.Working;
                entry.AwaitingInputSince = null;
                entry.StopRequestedUtc = null; // a Send after a Stop resumes it with corrective guidance
                entry.LastActivityUtc = DateTime.UtcNow;
                CancelAutoFinalize(entry);
            }

            if (wasWorking)
            {
                try
                {
                    WriteInterrupt(entry);
                    ActivityLog.Log("interactive-build", $"sent mid-task interrupt to queue #{id} to deliver guidance");
                }
                catch (Exception ex)
                {
                    // The user message already landed; a failed interrupt only means it
                    // waits for the current turn to end. Non-fatal — still a real delivery.
                    ActivityLog.Log("interactive-build", $"mid-task interrupt failed for queue #{id}: {ex.Message}");
                }
            }

            var preview = text.Length > 80 ? text.Substring(0, 80) + "…" : text;
            ActivityLog.Log("interactive-build", $"input sent to {entry.Title} (queue #{id}): {preview.Replace("\r", " ").Replace("\n", " ")}");
            return true;
        }

        /// <summary>
        /// Real "Stop" for an interactive build: a soft interrupt (stream-json
        /// control_request) first, escalating to a hard kill (the same
        /// Kill(entireProcessTree) as #1001's Close) if the process doesn't go
        /// quiet within the grace window, or if this is a second Stop / a
        /// non-interactive process. A honored soft interrupt leaves the process
        /// alive and paused, so a follow-up Send can redirect the agent.
        /// </summary>
        public async Task RequestStopAsync(int id)
        {
            if (!_running.TryGetValue(id, out var entry))
            {
                ActivityLog.Log("interactive-build", $"stop ignored — no process owns queue #{id}");
                return;
            }
            ActivityLog.Log("interactive-build", $"stop requested: {entry.Title} (queue #{id})");
            if (entry.Process.HasExited) return;

            bool alreadyStopping;
            lock (_gate) alreadyStopping = entry.StopRequestedUtc != null;

            if (!entry.Interactive || entry.Stdin == null || alreadyStopping)
            {
                HardKill(entry, id, "stop (hard kill)");
                return;
            }

            lock (_gate)
            {
                entry.StopRequestedUtc = DateTime.UtcNow;
                entry.State = InteractiveInputState.Stopped;
                CancelAutoFinalize(entry);
            }

            try { WriteInterrupt(entry); }
            catch (Exception ex)
            {
                ActivityLog.Log("interactive-build", $"soft interrupt write failed for queue #{id}: {ex.Message} — hard-killing");
                HardKill(entry, id, "stop (hard kill, interrupt write failed)");
                return;
            }

            await Task.Delay(StopSoftGraceMs);

            if (!_running.TryGetValue(id, out entry)) return;   // reaped in the meantime
            if (entry.Process.HasExited) return;                // honored and exited

            DateTime lastOut; DateTime? stopAt;
            lock (_gate) { lastOut = entry.LastActivityUtc; stopAt = entry.StopRequestedUtc; }
            if (stopAt == null) return; // a Send resumed it during the grace window

            if (DateTime.UtcNow - lastOut < TimeSpan.FromMilliseconds(StopQuietMs))
            {
                ActivityLog.Log("interactive-build", $"soft interrupt unresponsive (still emitting output) — escalating to hard kill: {entry.Title} (queue #{id})");
                HardKill(entry, id, "stop (escalated hard kill)");
            }
            else
            {
                ActivityLog.Log("interactive-build", $"soft interrupt honored — {entry.Title} paused; Send guidance to resume (queue #{id})");
                // Bound a walked-away pause: let it idle-finalize like a finished turn.
                lock (_gate) { entry.AwaitingInputSince = DateTime.UtcNow; ScheduleAutoFinalize(entry, id); }
            }
        }

        /// <summary>
        /// Real "Resume" for an interactive build that stalled on a dropped
        /// network connection. Shane lost WiFi and every active build paused:
        /// the claude.exe process was blocked mid-turn on an in-flight API
        /// request whose socket went half-open (WiFi dropped → no RST/FIN ever
        /// arrives, so the socket read hangs until the OS TCP retransmit
        /// timeout, minutes later). Crucially, while blocked mid-turn the CLI is
        /// NOT reading stdin for a new turn — which is exactly why the plain
        /// Send box couldn't reach it (a queued user message can't interrupt an
        /// in-flight request; it's only consumed when the current turn ends).
        ///
        /// So Resume is deliberately DIFFERENT from both Send and Stop:
        ///   1. First it sends a soft stream-json interrupt
        ///      (control_request/interrupt — the same primitive Stop uses) to
        ///      ABORT the hung in-flight request. That's the actual unstick: an
        ///      aborted fetch lets the SDK's turn logic proceed at once instead
        ///      of waiting out the TCP timeout.
        ///   2. Then, once the aborted turn has unwound, it writes a short
        ///      "continue" user message so a FRESH turn re-attempts the work —
        ///      which now reconnects successfully because the network is back.
        /// Unlike Stop it NEVER escalates to a kill: the whole point is to keep
        /// the process alive and get it moving again.
        ///
        /// It then observes and logs the real outcome — resumed (new output
        /// after the continue message), still stuck (no output within the
        /// window, e.g. the network isn't actually back yet), or exited.
        /// </summary>
        public async Task RequestResumeAsync(int id)
        {
            if (!_running.TryGetValue(id, out var entry) || !entry.Interactive)
            {
                ActivityLog.Log("interactive-build", $"resume ignored — no interactive process owns queue #{id}");
                return;
            }
            if (entry.Process.HasExited)
            {
                ActivityLog.Log("interactive-build", $"resume ignored — process for queue #{id} already exited");
                return;
            }
            if (entry.Stdin == null)
            {
                ActivityLog.Log("interactive-build", $"resume ignored — no owned stdin for queue #{id}");
                return;
            }

            ActivityLog.Log("interactive-build", $"resume requested (interrupt hung call, then continue): {entry.Title} (queue #{id})");

            // 1) Abort whatever in-flight request is hung on the dead socket.
            try { WriteInterrupt(entry); }
            catch (Exception ex)
            {
                ActivityLog.Log("interactive-build", $"resume interrupt write failed for queue #{id}: {ex.Message}");
                return;
            }

            // Let the CLI process the interrupt (abort the fetch, end the aborted
            // turn) before the follow-up message opens a fresh one.
            await Task.Delay(ResumeInterruptSettleMs);

            if (!_running.TryGetValue(id, out entry)) return; // reaped meanwhile
            if (entry.Process.HasExited)
            {
                ActivityLog.Log("interactive-build", $"resume outcome: EXITED — process for queue #{id} exited right after the interrupt (exit {SafeExitCode(entry)}): {entry.Title}");
                return;
            }

            // Baseline is captured AFTER the interrupt settles — so the aborted
            // turn's own "result" line (which lands during the settle window)
            // isn't mistaken for the fresh turn making real progress.
            int baselineEmitted;
            lock (_gate) baselineEmitted = entry.TotalEmitted;

            // 2) Kick a fresh turn so it re-attempts now the network is back.
            try { WriteUserMessage(entry, ResumeContinueMessage); }
            catch (Exception ex)
            {
                ActivityLog.Log("interactive-build", $"resume continue-message write failed for queue #{id}: {ex.Message}");
                return;
            }
            lock (_gate)
            {
                entry.State = InteractiveInputState.Working;
                entry.AwaitingInputSince = null;
                entry.StopRequestedUtc = null;
                entry.LastActivityUtc = DateTime.UtcNow;
                CancelAutoFinalize(entry);
            }

            // 3) Observe & log the real outcome.
            await Task.Delay(ResumeObserveMs);

            if (!_running.TryGetValue(id, out entry))
            {
                ActivityLog.Log("interactive-build", $"resume outcome: completed/reaped during observation — queue #{id}");
                return;
            }
            if (entry.Process.HasExited)
            {
                ActivityLog.Log("interactive-build", $"resume outcome: EXITED — process for queue #{id} exited during observation (exit {SafeExitCode(entry)}): {entry.Title}");
                return;
            }
            int afterEmitted;
            lock (_gate) afterEmitted = entry.TotalEmitted;
            if (afterEmitted > baselineEmitted)
            {
                ActivityLog.Log("interactive-build", $"resume outcome: RESUMED — {afterEmitted - baselineEmitted} new output event(s) after the continue message: {entry.Title} (queue #{id})");
            }
            else
            {
                ActivityLog.Log("interactive-build", $"resume outcome: STILL STUCK — no new output within {ResumeObserveMs}ms (network may still be down, or the call is re-hanging); Resume again, or Stop to hard-kill: {entry.Title} (queue #{id})");
            }
        }

        /// <summary>ExitCode is only valid once HasExited — read it defensively for logging.</summary>
        private static string SafeExitCode(RunningEntry entry)
        {
            try { return entry.Process.HasExited ? entry.Process.ExitCode.ToString() : "?"; }
            catch { return "?"; }
        }

        /// <summary>Gracefully ends a still-running interactive build by closing its stdin (EOF → the CLI exits with a real code). Used when a Build Watch slot is dismissed while its build is alive, so the queue row still completes instead of hanging.</summary>
        public void FinalizeInteractive(int id)
        {
            if (!_running.TryGetValue(id, out var entry) || !entry.Interactive) return;
            if (entry.Process.HasExited) return;
            try { lock (entry.InputLock) entry.Stdin?.Close(); }
            catch { /* best effort */ }
            ActivityLog.Log("interactive-build", $"finalize requested (closing stdin so it exits): {entry.Title} (queue #{id})");
        }

        /// <summary>The Build Watch window is done with a retained (exited) interactive build's buffer — drop it.</summary>
        public void ReleaseInteractive(int id)
        {
            if (_retained.TryGetValue(id, out var entry)) entry.TailCts?.Cancel(); // Git #1804 — its process has exited; stop the tailer.
            _retained.Remove(id);
        }

        private void HardKill(RunningEntry entry, int id, string reason)
        {
            try { if (!entry.Process.HasExited) entry.Process.Kill(entireProcessTree: true); }
            catch (Exception ex) { ActivityLog.Log("interactive-build", $"hard kill failed for queue #{id}: {ex.Message}"); return; }
            // Deliberately left in _running so TickAsync observes HasExited and
            // reports the real (kill) exit code exactly like any other exit —
            // completion + BuildFinished stay intact.
            ActivityLog.Log("interactive-build", $"{reason}: {entry.Title} (queue #{id})");
        }

        // ── stdin writers ───────────────────────────────────────────────────

        private static void WriteUserMessage(RunningEntry entry, string text)
        {
            if (entry.Stdin == null) return;
            var json = JsonSerializer.Serialize(
                new { type = "user", message = new { role = "user", content = text } }, _msgJson);
            lock (entry.InputLock)
            {
                // Explicit '\n' (not WriteLine's "\r\n") — NDJSON lines are
                // split on '\n', and a bare newline avoids any trailing-'\r'
                // ambiguity in a stream-json parser.
                entry.Stdin.Write(json);
                entry.Stdin.Write('\n');
                entry.Stdin.Flush();
            }
        }

        private static void WriteInterrupt(RunningEntry entry)
        {
            if (entry.Stdin == null) return;
            var reqId = "interrupt-" + Interlocked.Increment(ref _interruptSeq);
            var json = JsonSerializer.Serialize(
                new { type = "control_request", request_id = reqId, request = new { subtype = "interrupt" } }, _msgJson);
            lock (entry.InputLock)
            {
                entry.Stdin.Write(json);
                entry.Stdin.Write('\n');
                entry.Stdin.Flush();
            }
        }

        // ── idle auto-finalize (Git #800: builds must still auto-complete) ───

        /// <summary>Caller must hold _gate. (Re)arms the idle timer that closes stdin so an interactive build that's been left waiting eventually exits and frees its slot.</summary>
        private void ScheduleAutoFinalize(RunningEntry entry, int id)
        {
            if (entry.IdleFinalizeMs <= 0) return; // 0 = keep alive until Dismiss/Stop
            entry.AutoFinalizeCts?.Cancel();
            var cts = new CancellationTokenSource();
            entry.AutoFinalizeCts = cts;
            var token = cts.Token;
            int delay = entry.IdleFinalizeMs;
            _ = Task.Delay(delay, token).ContinueWith(t =>
            {
                if (t.IsCanceled) return;
                bool close;
                lock (_gate) close = entry.AwaitingInputSince != null && !entry.Process.HasExited;
                if (!close) return;
                try { lock (entry.InputLock) entry.Stdin?.Close(); } catch { }
                ActivityLog.Log("interactive-build", $"auto-finalizing idle interactive build (closing stdin so it exits): {entry.Title} (queue #{id})");
            }, TaskScheduler.Default);
        }

        /// <summary>Caller must hold _gate.</summary>
        private static void CancelAutoFinalize(RunningEntry entry)
        {
            entry.AutoFinalizeCts?.Cancel();
            entry.AutoFinalizeCts = null;
        }

        /// <summary>Caller must hold _gate.</summary>
        private void TrimRetained()
        {
            while (_retained.Count > MaxRetained)
            {
                var oldest = _retained.Keys.First();
                _retained.Remove(oldest);
            }
        }

        /// <summary>Git #826 — every stream-json line carries the real session_id; grabbed from whichever line happens to reveal it first (normally the "system"/init line).</summary>
        private static string? TryExtractSessionId(string line)
        {
            try
            {
                using var doc = JsonDocument.Parse(line);
                return doc.RootElement.TryGetProperty("session_id", out var sid) ? sid.GetString() : null;
            }
            catch { return null; }
        }

        /// <summary>
        /// Real Claude Code SDK `usage` object (the same shape as `claude --output-format
        /// stream-json` emits on every "assistant" message's `message.usage` and on the
        /// turn-ending "result" event's own `usage`): input_tokens + cache_creation_input_tokens
        /// + cache_read_input_tokens approximates the total conversation context size sent on
        /// that API call (the Messages API re-sends full history every turn, no server-side
        /// memory) — the same metric Claude Code's own UI uses for "context window used".
        /// Returns null for any line/type that doesn't carry a usage object.
        /// </summary>
        private static long? TryExtractContextTokens(string line)
        {
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;

                JsonElement usage;
                if (type == "assistant")
                {
                    if (!root.TryGetProperty("message", out var msg) || !msg.TryGetProperty("usage", out usage))
                        return null;
                }
                else if (type == "result")
                {
                    if (!root.TryGetProperty("usage", out usage)) return null;
                }
                else return null;

                long Get(string name) => usage.TryGetProperty(name, out var v) && v.TryGetInt64(out var n) ? n : 0;
                return Get("input_tokens") + Get("cache_creation_input_tokens") + Get("cache_read_input_tokens");
            }
            catch { return null; }
        }

        /// <summary>
        /// The turn-ending "result" stream-json line's REAL, authoritative usage for that
        /// turn — `total_cost_usd` (Anthropic's own computed cost for the API calls that
        /// turn made) and the full token breakdown (input + output + both cache fields,
        /// unlike TryExtractContextTokens above which deliberately omits output_tokens
        /// since it's answering a different question — "how full is the context window",
        /// not "how much was spent"). Used for durable usage/cost tracking
        /// (UsageTrackingService), never for the live "active" estimate.
        /// </summary>
        private static bool TryExtractResultUsageAndCost(string line, out long tokens, out double costUsd)
        {
            tokens = 0;
            costUsd = 0;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                if ((root.TryGetProperty("type", out var t) ? t.GetString() : null) != "result") return false;

                if (root.TryGetProperty("total_cost_usd", out var c1) && c1.TryGetDouble(out var cv1)) costUsd = cv1;
                else if (root.TryGetProperty("cost_usd", out var c2) && c2.TryGetDouble(out var cv2)) costUsd = cv2;

                if (root.TryGetProperty("usage", out var usage))
                {
                    long Get(string name) => usage.TryGetProperty(name, out var v) && v.TryGetInt64(out var n) ? n : 0;
                    tokens = Get("input_tokens") + Get("output_tokens") + Get("cache_creation_input_tokens") + Get("cache_read_input_tokens");
                }

                return tokens > 0 || costUsd > 0;
            }
            catch { return false; }
        }

        /// <summary>
        /// Git #825 — turns one --output-format stream-json line into a readable log line for
        /// the per-item log FILE (BuildLogView/#802 and the foreign/legacy file-tail render
        /// path). Deliberately LOSSY: "assistant" text/tool_use blocks collapse to prose +
        /// "[tool: X]" name markers, "result" becomes the turn summary (<paramref name="isResult"/>
        /// set true so the caller can detect "turn finished"), everything else is skipped.
        ///
        /// This name-only "[tool: X]" flattening is exactly what made the tool-call bubbles
        /// show nothing but a bare name — so the interactive Build Watch render no longer uses
        /// this; it pulls the full-fidelity <see cref="ParseInteractiveEvents"/> stream instead.
        /// This method stays as the human-readable FILE summary only (unchanged on purpose so
        /// #802 / foreign builds are unaffected). Returns null to skip, or the raw line if it
        /// somehow isn't valid JSON.
        /// </summary>
        private static string? SummarizeStreamJsonLine(string line, out bool isResult)
        {
            isResult = false;
            if (string.IsNullOrWhiteSpace(line)) return null;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
                switch (type)
                {
                    case "assistant":
                        if (!root.TryGetProperty("message", out var msg) || !msg.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Array)
                            return null;
                        var sb = new StringBuilder();
                        foreach (var block in content.EnumerateArray())
                        {
                            var blockType = block.TryGetProperty("type", out var bt) ? bt.GetString() : null;
                            if (blockType == "text" && block.TryGetProperty("text", out var txt))
                            {
                                sb.Append(txt.GetString());
                            }
                            else if (blockType == "tool_use" && block.TryGetProperty("name", out var toolName))
                            {
                                if (sb.Length > 0) sb.Append(' ');
                                sb.Append($"[tool: {toolName.GetString()}]");
                            }
                        }
                        var text = sb.ToString();
                        return string.IsNullOrWhiteSpace(text) ? null : text;

                    case "result":
                        isResult = true;
                        var resultText = root.TryGetProperty("result", out var res) ? res.GetString() : null;
                        var durationMs = root.TryGetProperty("duration_ms", out var dur) ? dur.GetInt32() : (int?)null;
                        return $"--- done{(durationMs.HasValue ? $" ({durationMs}ms)" : "")} ---" + (string.IsNullOrWhiteSpace(resultText) ? "" : $"\n{resultText}");

                    default:
                        return null; // system init / rate_limit_event / user tool-result echoes - noise for a build log
                }
            }
            catch
            {
                return line;
            }
        }

        /// <summary>
        /// Parses one --output-format stream-json line into zero or more full-fidelity
        /// <see cref="InteractiveEvent"/>s for the interactive Build Watch render — the fix for
        /// the "tool bubble shows only a bare name" bug. Unlike <see cref="SummarizeStreamJsonLine"/>
        /// this keeps everything the display needs:
        ///   • "assistant" → one AssistantText per real "text" block, one ToolCall per "tool_use"
        ///     block (with its id, name, a one-line command preview, and the raw `input` JSON);
        ///   • "user"      → one ToolResult per "tool_result" block (matched back by tool_use_id,
        ///     carrying the real output text + is_error) — the whole event the old code dropped;
        ///   • "result"    → one TurnResult (duration + final text).
        /// Other event types (system init, rate_limit_event, thinking_tokens, empty "thinking"
        /// blocks) are genuine noise and produce no events. A non-JSON line becomes one raw
        /// AssistantText so nothing is silently lost.
        /// </summary>
        private static List<InteractiveEvent> ParseInteractiveEvents(string line)
        {
            var events = new List<InteractiveEvent>();
            if (string.IsNullOrWhiteSpace(line)) return events;

            JsonDocument doc;
            try { doc = JsonDocument.Parse(line); }
            catch { events.Add(new InteractiveEvent { Kind = InteractiveEventKind.AssistantText, Text = line }); return events; }

            using (doc)
            {
                var root = doc.RootElement;
                var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
                switch (type)
                {
                    case "assistant":
                        if (root.TryGetProperty("message", out var amsg) && amsg.TryGetProperty("content", out var acontent) && acontent.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var block in acontent.EnumerateArray())
                            {
                                if (block.ValueKind != JsonValueKind.Object) continue;
                                var bt = block.TryGetProperty("type", out var btv) ? btv.GetString() : null;
                                if (bt == "text" && block.TryGetProperty("text", out var txt))
                                {
                                    var s = txt.GetString();
                                    if (!string.IsNullOrEmpty(s))
                                        events.Add(new InteractiveEvent { Kind = InteractiveEventKind.AssistantText, Text = s });
                                }
                                else if (bt == "tool_use")
                                {
                                    var name = block.TryGetProperty("name", out var nm) ? nm.GetString() : null;
                                    var id = block.TryGetProperty("id", out var idv) ? idv.GetString() : null;
                                    string? inputJson = null, preview = null;
                                    if (block.TryGetProperty("input", out var input))
                                    {
                                        inputJson = input.GetRawText();
                                        preview = BuildCommandPreview(name, input);
                                    }
                                    events.Add(new InteractiveEvent
                                    {
                                        Kind = InteractiveEventKind.ToolCall,
                                        ToolName = string.IsNullOrWhiteSpace(name) ? "tool" : name,
                                        ToolUseId = id,
                                        CommandPreview = preview,
                                        InputJson = inputJson,
                                    });
                                }
                                // "thinking" blocks: no user-facing content (signature only) — skipped.
                            }
                        }
                        break;

                    case "user":
                        // tool_result blocks are carried on the message.content array of a type:"user" event.
                        if (root.TryGetProperty("message", out var umsg) && umsg.TryGetProperty("content", out var ucontent) && ucontent.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var block in ucontent.EnumerateArray())
                            {
                                if (block.ValueKind != JsonValueKind.Object) continue;
                                var bt = block.TryGetProperty("type", out var btv) ? btv.GetString() : null;
                                if (bt != "tool_result") continue;
                                var forId = block.TryGetProperty("tool_use_id", out var tid) ? tid.GetString() : null;
                                bool isErr = block.TryGetProperty("is_error", out var ie) && ie.ValueKind == JsonValueKind.True;
                                events.Add(new InteractiveEvent
                                {
                                    Kind = InteractiveEventKind.ToolResult,
                                    ResultForToolUseId = forId,
                                    Text = ExtractToolResultText(block),
                                    IsError = isErr,
                                });
                            }
                        }
                        break;

                    case "result":
                        {
                            var resultText = root.TryGetProperty("result", out var res) ? res.GetString() : null;
                            int? durationMs = root.TryGetProperty("duration_ms", out var dur) && dur.TryGetInt32(out var dm) ? dm : (int?)null;
                            events.Add(new InteractiveEvent { Kind = InteractiveEventKind.TurnResult, Text = resultText, DurationMs = durationMs });
                        }
                        break;

                    default:
                        break; // system init / rate_limit_event / thinking_tokens — noise
                }
            }
            return events;
        }

        /// <summary>A tool_result block's <c>content</c> is either a plain string (Bash, Read, …) or an array of content parts (text/image blocks). Flatten both to one readable output string.</summary>
        private static string ExtractToolResultText(JsonElement block)
        {
            if (!block.TryGetProperty("content", out var c)) return "";
            if (c.ValueKind == JsonValueKind.String) return c.GetString() ?? "";
            if (c.ValueKind == JsonValueKind.Array)
            {
                var sb = new StringBuilder();
                foreach (var part in c.EnumerateArray())
                {
                    if (part.ValueKind == JsonValueKind.String) { if (sb.Length > 0) sb.Append('\n'); sb.Append(part.GetString()); continue; }
                    if (part.ValueKind != JsonValueKind.Object) continue;
                    var pt = part.TryGetProperty("type", out var ptv) ? ptv.GetString() : null;
                    if (pt == "text" && part.TryGetProperty("text", out var tx)) { if (sb.Length > 0) sb.Append('\n'); sb.Append(tx.GetString()); }
                    else if (pt == "image") { if (sb.Length > 0) sb.Append('\n'); sb.Append("[image]"); }
                }
                return sb.ToString();
            }
            return "";
        }

        /// <summary>
        /// A one-line, human-readable summary of a tool call's key argument(s) — the real command
        /// for Bash, the file_path for Read/Edit/Write, the pattern for Glob/Grep, etc. Falls back
        /// to a compact single-line of the whole `input` object for tools without a special case,
        /// so an unfamiliar tool still shows its real arguments rather than nothing.
        /// </summary>
        private static string? BuildCommandPreview(string? toolName, JsonElement input)
        {
            if (input.ValueKind != JsonValueKind.Object) return null;
            string? S(string k) => input.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

            switch (toolName)
            {
                case "Bash": return S("command");
                case "Read": return S("file_path");
                case "Edit":
                case "Write":
                case "MultiEdit": return S("file_path");
                case "NotebookEdit": return S("notebook_path") ?? S("file_path");
                case "Glob": { var p = S("pattern"); var path = S("path"); return path == null ? p : $"{p}  in {path}"; }
                case "Grep":
                    {
                        var p = S("pattern"); var path = S("path"); var g = S("glob");
                        return p + (g != null ? $"  glob:{g}" : "") + (path != null ? $"  in {path}" : "");
                    }
                case "WebFetch": return S("url");
                case "WebSearch": return S("query");
                case "Task": { var d = S("description"); var st = S("subagent_type"); return d + (st != null ? $"  ({st})" : ""); }
                default:
                    var raw = input.GetRawText().Replace("\r", " ").Replace("\n", " ");
                    return raw.Length > 200 ? raw.Substring(0, 200) + "…" : raw;
            }
        }
    }
}
