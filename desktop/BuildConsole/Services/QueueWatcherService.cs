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
            public Process Process = null!;
            public string Title = "";
            /// <summary>Git #826 — filled in as soon as the run's stream-json output reveals it (usually the very first line); reported at completion so a later Reply can resume this exact conversation.</summary>
            public string? SessionId;
            /// <summary>Build Sets — the set name this build belongs to (null = ungrouped). When set, once this build's wave has fully drained the watcher tells the dev-server coordinator to `close` the set as a backstop.</summary>
            public string? BuildSet;
            /// <summary>Build Sets — this build's member key within its set (github number, else queue id) so a failed member can be dropped/accounted for.</summary>
            public string? BuildSetMember;
            /// <summary>Approximate current context-window usage — input_tokens + cache_creation_input_tokens + cache_read_input_tokens of the most recently seen "assistant"/"result" stream-json event's real `usage` object (the standard way to read "how full is the context window", since every API turn re-sends the whole conversation as input). Overwritten (not summed) on each new usage-bearing line. Null until the first such line lands.</summary>
            public long? ContextTokens;

            // ── Interactive (BuildConsole owns stdin/stdout) fields ──────────
            /// <summary>True when this build was launched in the interactive redirected-stdin mode (owned by this app instance). Legacy/foreign builds are false and behave exactly as before.</summary>
            public bool Interactive;
            public string LogPath = "";
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
        private readonly int _maxConcurrent;
        private readonly string _repoRoot;
        private readonly string _claudeExe;
        private readonly Dictionary<int, RunningEntry> _running = new();
        /// <summary>Interactive builds that have exited but whose slot may still be on screen — kept so the Build Watch window can drain the final output tail and hold the slot in interactive-render mode (never falling back to a double-rendering file-tail). Evicted when the window dismisses the slot (ReleaseInteractive) or capped defensively.</summary>
        private readonly Dictionary<int, RunningEntry> _retained = new();
        /// <summary>Guards the mutable interactive fields of a RunningEntry and its Events/_retained — the process output thread and the UI thread both touch these. (_running membership itself is only ever mutated on the UI thread, same as before.)</summary>
        private readonly object _gate = new();
        private DispatcherTimer? _timer;
        private bool _ticking;
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
            _repoRoot = repoRoot ?? AppDomain.CurrentDomain.BaseDirectory;
            _claudeExe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin", "claude.exe");
            _paused = BuildConsoleSettings.Load().QueuePaused;
        }

        public int RunningCount => _running.Count;

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
        /// (false); it's in-memory only, so a restart always comes up running.
        /// "Run Now" (ForceLaunch) is a deliberate manual per-item override and
        /// intentionally still works while paused.
        /// </summary>
        private bool _paused;

        /// <summary>Whether the automatic queue pickup loop is currently paused. See <see cref="SetPaused"/>.</summary>
        public bool IsPaused => _paused;

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
                _running.Remove(queueItemId);
            }
            ActivityLog.Log("watcher", $"Stopped: {entry.Title} (queue #{queueItemId})");
            return true;
        }

        /// <summary>Git #820 — "Run Now": launches an item this app just force-claimed (bypassing the blocker/free-slot check GetNextQueueItemsAsync would normally enforce). Same launch path as the normal poll loop, just triggered directly instead of discovered.</summary>
        public void ForceLaunch(QueueItem item) => LaunchItem(item);

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
            if (!File.Exists(_claudeExe))
            {
                ActivityLog.Log("watcher", $"claude.exe not found at {_claudeExe} - in-app watcher disabled.");
                return;
            }
            ActivityLog.Log("watcher", $"In-app build queue watcher starting - max {_maxConcurrent} concurrent, polling every 10s.");
            await RecoverOrphanedRunningItemsAsync();
            _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
            _timer.Tick += async (_, _) => await TickAsync();
            _timer.Start();
            _ = TickAsync();
        }

        /// <summary>
        /// Git #822 — Shane: "#805 seems to have ran but there was zero
        /// indication at all that it was going... The build log was
        /// empty... there are also 4 #805 entries." `_running` is a pure
        /// in-memory dictionary - it dies with the app. Every time
        /// BuildConsole restarts (routine during today's dev cycle for
        /// recompiles), any DB row still `running` from the OLD instance has
        /// nothing tracking it anymore: no log ever grows again, nothing
        /// reaps it, it just sits in silent limbo forever unless someone
        /// manually Stops/Marks Done it. That's the "zero indication" and
        /// "empty log" both explained by the same root cause. This sweep
        /// runs once at startup: anything already `running` when THIS
        /// instance starts is, by definition, orphaned from a previous one
        /// (a fresh `_running` is always empty at this point) - mark it
        /// failed with a distinct sentinel exit code so it's visibly
        /// explained rather than silent, and Retry is right there to
        /// re-queue it for real.
        ///
        /// Git #943 — Shane: "I'm losing builds... 939 is still running but
        /// it's not showing in the queue." #939's real claude.exe process was
        /// legitimately claimed and launched by one BuildConsole instance,
        /// but this sweep ran from a SECOND, concurrently-open instance whose
        /// own fresh `_running` dict was empty - from its perspective #939
        /// looked orphaned, so it force-marked it failed (exitCode -2) only
        /// ~2 minutes after being claimed, while the real process (confirmed
        /// still alive in Task Manager) kept running, completely unaware its
        /// own DB row had just been killed out from under it. #822's
        /// original assumption - "still 'running' when I start must be
        /// orphaned from a dead previous instance" - only holds for exactly
        /// one BuildConsole instance at a time; it breaks the moment a
        /// second is open, which happens routinely (Shane keeping an old
        /// window up while a new one launches, or - as happened here -
        /// Claude Code itself relaunching the app repeatedly mid-session to
        /// verify a rebuild). A false "still orphaned" is recoverable (Retry
        /// is right there); a false "failed" on a real running job silently
        /// discards live work instead. So: if any OTHER BuildConsole.exe
        /// process is already alive, this can't safely tell "orphaned" from
        /// "legitimately owned elsewhere" and skips the sweep entirely
        /// rather than guess wrong.
        /// </summary>
        private async Task RecoverOrphanedRunningItemsAsync()
        {
            if (Process.GetProcessesByName("BuildConsole").Length > 1)
            {
                ActivityLog.Log("watcher", "Skipping orphaned-running sweep - another BuildConsole instance is already open, can't safely tell orphaned from legitimately in-progress elsewhere.");
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

            var orphaned = items.Where(i => i.Status == "running").ToList();
            if (orphaned.Count == 0) return;

            ActivityLog.Log("watcher", $"Found {orphaned.Count} queue item(s) stuck 'running' from a previous app instance/crash (nothing was tracking them) - marking failed so they're visible. Resume Session (if a session id was captured) or Retry to re-queue - the Build Queue panel's 'Recover All' banner does this for every orphaned item at once.");
            foreach (var item in orphaned)
            {
                try
                {
                    if (_db != null)
                        await _db.MarkOrphanedFailedAsync(item.Id);
                    else
                        await _api.MarkQueueItemCompleteAsync(item.Id, -2);
                }
                catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't mark orphaned queue item {item.Id} failed: {ex.Message}"); }
            }
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

                    // Report completion — direct Postgres when available (always-on Neon,
                    // no nap/sleep issue), HTTP fallback otherwise. The fallback path is
                    // kept for environments where DATABASE_URL isn't configured.
                    // It MUST NOT gate the local BuildFinished fan-out below:
                    // that fan-out drives PostBuildDeployPipeline (Epic #803/#911).
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

                    // Build Sets — backstop: once this build's wave has fully drained (no
                    // more queued/running members), tell the dev-server coordinator to
                    // `close` the set so it completes — and fires its ONE deferred restart —
                    // even if a member failed without ever reporting to request-restart. On
                    // the happy path the set already auto-completed via the expected-count,
                    // so this close is a harmless single-shot no-op. Best-effort.
                    if (!string.IsNullOrWhiteSpace(entry.BuildSet))
                    {
                        try { await MaybeCloseDrainedBuildSetAsync(entry.BuildSet!, id); }
                        catch (Exception ex) { ActivityLog.Log("watcher", $"Build-set close backstop for '{entry.BuildSet}' failed: {ex.Message}"); }
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
                    try { LaunchItem(item, buildSetExpected); }
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
        private void LaunchItem(QueueItem item, int? buildSetExpected = null)
        {
            var settings = BuildConsoleSettings.Load();
            bool interactive = settings.InteractiveBuilds;

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

            var psi = new ProcessStartInfo
            {
                FileName = _claudeExe,
                WorkingDirectory = (!string.IsNullOrWhiteSpace(item.Cwd) && Directory.Exists(item.Cwd)) ? item.Cwd : _repoRoot,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            if (interactive)
            {
                psi.RedirectStandardInput = true;
                // stream-json is UTF-8; be explicit so non-ASCII prompt/@path
                // content round-trips exactly rather than via the console codepage.
                psi.StandardInputEncoding = new UTF8Encoding(false);
                psi.StandardOutputEncoding = new UTF8Encoding(false);
                psi.StandardErrorEncoding = new UTF8Encoding(false);
            }

            // Git #826 — a Reply resumes the ORIGINAL session instead of
            // starting a fresh one (that's the whole point - continuing a
            // conversation that already asked a question). --resume brings
            // its own model/effort/context, so skip the fresh-session flags
            // and let the resumed session's own settings apply.
            if (!string.IsNullOrWhiteSpace(item.ResumeSessionId))
            {
                psi.ArgumentList.Add("--resume");
                psi.ArgumentList.Add(item.ResumeSessionId);
            }
            else
            {
                if (!string.IsNullOrWhiteSpace(item.Title)) { psi.ArgumentList.Add("--name"); psi.ArgumentList.Add(item.Title); }
                if (!string.IsNullOrWhiteSpace(item.Model)) { psi.ArgumentList.Add("--model"); psi.ArgumentList.Add(item.Model); }
                if (!string.IsNullOrWhiteSpace(item.Effort)) { psi.ArgumentList.Add("--effort"); psi.ArgumentList.Add(item.Effort); }
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
                psi.Environment["DEV_BUILD_SET"] = item.BuildSet;
                psi.Environment["DEV_BUILD_SET_MEMBER"] = memberKey;
                if (buildSetExpected.HasValue && buildSetExpected.Value > 0)
                    psi.Environment["DEV_BUILD_SET_EXPECTED"] = buildSetExpected.Value.ToString();
                ActivityLog.Log("watcher", $"Build set '{item.BuildSet}': launching member {memberKey} (expected {(buildSetExpected?.ToString() ?? "?")}) — dev-server restart deferred until the whole set completes.");
            }

            psi.ArgumentList.Add("--permission-mode");
            psi.ArgumentList.Add("auto");
            psi.ArgumentList.Add("--print");
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
                psi.ArgumentList.Add("--input-format");
                psi.ArgumentList.Add("stream-json");
            }
            psi.ArgumentList.Add("--output-format");
            psi.ArgumentList.Add("stream-json");
            psi.ArgumentList.Add("--verbose");

            if (!interactive)
            {
                // Legacy path only. Git #820 — a literal "--" is commander's
                // end-of-options marker: everything after it is positional,
                // never re-parsed as a flag, no matter what the prompt looks
                // like. (Interactive builds don't pass the prompt positionally
                // at all — it goes over stdin as JSON — so this whole class of
                // arg-mangling bug can't apply to them.)
                psi.ArgumentList.Add("--");
                psi.ArgumentList.Add(launchPrompt);
            }

            var logPath = BuildLogPaths.ForQueueItem(item.Id);
            Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
            File.WriteAllText(logPath, "");

            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            // Git #826 — created (and about to be registered in _running)
            // BEFORE Start(), so the very first output line - which is
            // where the real session_id shows up - has somewhere to land.
            var entry = new RunningEntry
            {
                Process = proc,
                Title = item.Title,
                Interactive = interactive,
                LogPath = logPath,
                LastActivityUtc = DateTime.UtcNow,
                State = InteractiveInputState.Working,
                IdleFinalizeMs = Math.Max(0, settings.InteractiveIdleFinalizeSeconds) * 1000,
                BuildSet = string.IsNullOrWhiteSpace(item.BuildSet) ? null : item.BuildSet,
                BuildSetMember = string.IsNullOrWhiteSpace(item.BuildSet) ? null : (item.GithubNumber?.ToString() ?? item.Id.ToString()),
            };
            proc.OutputDataReceived += (_, e) => HandleOutput(entry, item.Id, e.Data);
            proc.ErrorDataReceived += (_, e) => { if (e.Data != null) HandleStderr(entry, e.Data); };
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            if (interactive)
            {
                entry.Stdin = proc.StandardInput;
                // Deliver the initial prompt as the first stream-json user
                // message. If this throws (rare), the process is still up and
                // the build will simply idle-finalize; log it either way.
                try { WriteUserMessage(entry, launchPrompt); }
                catch (Exception ex) { ActivityLog.Log("interactive-build", $"couldn't write initial prompt to queue #{item.Id}: {ex.Message}"); }
            }

            _running[item.Id] = entry;

            if (interactive)
                ActivityLog.Log("interactive-build", $"launched (BuildConsole-owned redirected stdin/stdout, --input-format stream-json): {item.Title} (queue #{item.Id}, {_running.Count}/{_maxConcurrent} running)");
            ActivityLog.Log("watcher", $"Started: {item.Title} (queue #{item.Id}, {_running.Count}/{_maxConcurrent} running)");
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

            // (1) Human-readable per-item log FILE — for BOTH interactive and legacy builds
            //     (#802 BuildLogView + the foreign/legacy file-tail render path). Unchanged:
            //     the same flattened "[tool: X]" summary as before.
            var summary = SummarizeStreamJsonLine(data, out bool isResult);
            if (summary != null) AppendToLogFile(entry, summary);

            // Real, durable usage/cost tracking (Shane: "I would love to track how much
            // AI tokens total, AI cost total... for fun and tracking purposes") — the
            // CLI's own `result` line carries its authoritative total_cost_usd + usage
            // for that completed turn, real numbers (not the $5/1M estimate the "active"
            // badge above uses for still-in-progress work). An interactive build sends one
            // of these per turn, each a distinct real turn, so each gets recorded.
            if (isResult && TryExtractResultUsageAndCost(data, out long resultTokens, out double resultCost))
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



        /// <summary>A raw stderr line (not stream-json): tee it to the log FILE and, for an interactive build, surface it in the Build Watch render as an error-tinted text event.</summary>
        private void HandleStderr(RunningEntry entry, string data)
        {
            AppendToLogFile(entry, data);
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

        /// <summary>Owns/knows this queue id as an interactive build (still running OR retained after exit for a Build Watch slot to keep rendering from its buffer).</summary>
        public bool OwnsInteractive(int id) =>
            (_running.TryGetValue(id, out var e) && e.Interactive) || _retained.ContainsKey(id);

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
        public void LaunchItemExplicit(QueueItem item) => LaunchItem(item);

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

        /// <summary>Types a real chat message into the running build's stdin (delivered as a stream-json user message, so an @path or any character passes through unmangled). Interruption is supported precisely because stdin stays open for the whole run — sending mid-task reaches the live process at once.</summary>
        public void SendInput(int id, string text)
        {
            if (!_running.TryGetValue(id, out var entry) || !entry.Interactive)
            {
                ActivityLog.Log("interactive-build", $"input ignored — no interactive process owns queue #{id}");
                return;
            }
            if (entry.Process.HasExited)
            {
                ActivityLog.Log("interactive-build", $"input ignored — process for queue #{id} already exited");
                return;
            }

            bool wasWorking = false;
            lock (_gate)
            {
                wasWorking = entry.State == InteractiveInputState.Working;
            }

            try { WriteUserMessage(entry, text); }
            catch (Exception ex) { ActivityLog.Log("interactive-build", $"input failed for queue #{id}: {ex.Message}"); return; }

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
                    ActivityLog.Log("interactive-build", $"mid-task interrupt failed for queue #{id}: {ex.Message}");
                }
            }

            var preview = text.Length > 80 ? text.Substring(0, 80) + "…" : text;
            ActivityLog.Log("interactive-build", $"input sent to {entry.Title} (queue #{id}): {preview.Replace("\r", " ").Replace("\n", " ")}");
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
        public void ReleaseInteractive(int id) => _retained.Remove(id);

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
