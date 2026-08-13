using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Threading;

namespace BuildConsole.Services
{
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
    /// </summary>
    public class QueueWatcherService
    {
        private class RunningEntry
        {
            public Process Process = null!;
            public string Title = "";
            /// <summary>Git #826 — filled in as soon as the run's stream-json output reveals it (usually the very first line); reported at completion so a later Reply can resume this exact conversation.</summary>
            public string? SessionId;
        }

        private readonly BuildTrackerApiClient _api;
        private readonly int _maxConcurrent;
        private readonly string _repoRoot;
        private readonly string _claudeExe;
        private readonly Dictionary<int, RunningEntry> _running = new();
        private DispatcherTimer? _timer;
        private bool _ticking;

        public QueueWatcherService(BuildTrackerApiClient api, int maxConcurrent, string? repoRoot)
        {
            _api = api;
            _maxConcurrent = maxConcurrent;
            _repoRoot = repoRoot ?? AppDomain.CurrentDomain.BaseDirectory;
            _claudeExe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin", "claude.exe");
        }

        public int RunningCount => _running.Count;

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
            try { items = await _api.GetQueueAsync(); }
            catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't check for orphaned running items: {ex.Message}"); return; }

            var orphaned = items.Where(i => i.Status == "running").ToList();
            if (orphaned.Count == 0) return;

            ActivityLog.Log("watcher", $"Found {orphaned.Count} queue item(s) stuck 'running' from a previous app instance (nothing was tracking them) - marking failed so they're visible, use Retry to re-queue.");
            foreach (var item in orphaned)
            {
                try { await _api.MarkQueueItemCompleteAsync(item.Id, -2); }
                catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't mark orphaned queue item {item.Id} failed: {ex.Message}"); }
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
                foreach (var id in _running.Keys.ToList())
                {
                    var entry = _running[id];
                    if (!entry.Process.HasExited) continue;
                    int exitCode = entry.Process.ExitCode;
                    ActivityLog.Log("watcher", $"Finished: {entry.Title} (exit {exitCode})");
                    try { await _api.MarkQueueItemCompleteAsync(id, exitCode, entry.SessionId); }
                    catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't report completion for queue item {id}: {ex.Message}"); }
                    _running.Remove(id);
                }

                int freeSlots = _maxConcurrent - _running.Count;
                if (freeSlots <= 0) return;

                List<QueueItem> next;
                try { next = await _api.GetNextQueueItemsAsync(freeSlots); }
                catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't poll/claim next queue item(s): {ex.Message}"); return; }

                foreach (var item in next)
                {
                    try { LaunchItem(item); }
                    catch (Exception ex) { ActivityLog.Log("watcher", $"Couldn't launch queue item {item.Id} ({item.Title}): {ex.Message}"); }
                }
            }
            finally
            {
                _ticking = false;
            }
        }

        /// <summary>
        /// Git #800 — queued builds run with --print (non-interactive, real
        /// auto-exit with a real exit code) same as the standalone watcher.
        /// Output is redirected to the SAME per-item log file convention
        /// (BuildLogPaths) the chat-tab split pane (#802) already tails, so
        /// that feature works identically regardless of which watcher
        /// launched a given item.
        /// </summary>
        private void LaunchItem(QueueItem item)
        {
            var psi = new ProcessStartInfo
            {
                FileName = _claudeExe,
                WorkingDirectory = (!string.IsNullOrWhiteSpace(item.Cwd) && Directory.Exists(item.Cwd)) ? item.Cwd : _repoRoot,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
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
            psi.ArgumentList.Add("--permission-mode");
            psi.ArgumentList.Add("auto");
            psi.ArgumentList.Add("--print");
            // Git #825 — Shane: "the build log is NOT giving me any kind of
            // live feedback." Default --output-format text is fully
            // buffered when stdout isn't a real console (confirmed: a
            // trivial prompt sat at 0 bytes for the whole run, then the
            // full response landed in one shot right before exit) - there
            // was nothing actually incremental to tail no matter how often
            // the log file gets re-read. --output-format stream-json emits
            // one real JSON event per line AS work happens (confirmed via a
            // live test: system init, assistant text/tool_use, final
            // result, each its own line) - SummarizeStreamJsonLine below
            // turns those into readable text for the log instead of raw JSON.
            psi.ArgumentList.Add("--output-format");
            psi.ArgumentList.Add("stream-json");
            psi.ArgumentList.Add("--verbose");
            // Git #820 — defense in depth: claude.exe's commander.js-based
            // parser treats ANY positional argument starting with "--" as
            // an attempted (unrecognized) option, not plain text — a "806
            // failed... exit 1" happened exactly this way when an upstream
            // bug failed to strip a leading flags line off the prompt. A
            // literal "--" is commander's standard end-of-options marker:
            // everything after it is always positional, never re-parsed as
            // a flag, regardless of what the prompt text itself looks like.
            psi.ArgumentList.Add("--");
            psi.ArgumentList.Add(item.Prompt);

            var logPath = BuildLogPaths.ForQueueItem(item.Id);
            Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
            File.WriteAllText(logPath, "");

            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            // Git #826 — created (and about to be registered in _running)
            // BEFORE Start(), so the very first output line - which is
            // where the real session_id shows up - has somewhere to land.
            var runningEntry = new RunningEntry { Process = proc, Title = item.Title };
            var logLock = new object();
            proc.OutputDataReceived += (_, e) =>
            {
                if (e.Data == null) return;
                if (runningEntry.SessionId == null) runningEntry.SessionId = TryExtractSessionId(e.Data);
                var summary = SummarizeStreamJsonLine(e.Data);
                if (summary == null) return;
                lock (logLock) File.AppendAllText(logPath, summary + Environment.NewLine);
            };
            proc.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (logLock) File.AppendAllText(logPath, e.Data + Environment.NewLine); };
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            _running[item.Id] = runningEntry;
            ActivityLog.Log("watcher", $"Started: {item.Title} (queue #{item.Id}, {_running.Count}/{_maxConcurrent} running)");
        }

        /// <summary>Git #826 — every stream-json line carries the real session_id; grabbed from whichever line happens to reveal it first (normally the "system"/init line).</summary>
        private static string? TryExtractSessionId(string line)
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(line);
                return doc.RootElement.TryGetProperty("session_id", out var sid) ? sid.GetString() : null;
            }
            catch { return null; }
        }

        /// <summary>
        /// Git #825 — turns one --output-format stream-json line into a
        /// readable log line (real shape confirmed via a live test run):
        /// "assistant" messages carry text/tool_use content blocks (the
        /// actual incremental progress worth showing); "result" is the
        /// final summary; everything else (system init, rate_limit_event,
        /// user/tool-result echoes) is skipped as noise for a build log.
        /// Returns null to skip the line, or the line as-is if it somehow
        /// isn't valid JSON (shouldn't normally happen with this flag, but
        /// better than silently dropping real content).
        /// </summary>
        private static string? SummarizeStreamJsonLine(string line)
        {
            if (string.IsNullOrWhiteSpace(line)) return null;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(line);
                var root = doc.RootElement;
                var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
                switch (type)
                {
                    case "assistant":
                        if (!root.TryGetProperty("message", out var msg) || !msg.TryGetProperty("content", out var content) || content.ValueKind != System.Text.Json.JsonValueKind.Array)
                            return null;
                        var sb = new System.Text.StringBuilder();
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
    }
}
