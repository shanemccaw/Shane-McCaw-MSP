using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>Git #831 — matches `claude agents --json`'s real row shape (confirmed via a live run).</summary>
    public class ClaudeAgentSession
    {
        public int Pid { get; set; }
        public string Cwd { get; set; } = "";
        /// <summary>"interactive" | "background"</summary>
        public string Kind { get; set; } = "";
        /// <summary>Unix epoch milliseconds.</summary>
        [JsonPropertyName("startedAt")]
        public long StartedAtMs { get; set; }
        public string SessionId { get; set; } = "";
        public string Name { get; set; } = "";

        /// <summary>Git #1001 — Shane: "if I clicked on them they brought that window into focus." claude.exe itself owns no window (see FindAncestorWindow's own doc comment), so this is the ANCESTOR window handle resolved for every session (CLI-tracked or fallback) - IntPtr.Zero if none could be found. Never comes from the CLI's own JSON, so [JsonIgnore] like StartedAt above.</summary>
        [JsonIgnore]
        public IntPtr WindowHandle { get; set; } = IntPtr.Zero;

        // Git #984 — Shane: "But I have like 2 active" (Sessions kept showing
        // (0) even after #971's deadlock fix, on a genuinely fresh rebuild).
        // The REAL bug, found via this class's own DebugLog mirror below:
        // this computed property has no explicit [JsonPropertyName], so its
        // default serialized name "StartedAt" collides with StartedAtMs's
        // explicit [JsonPropertyName("startedAt")] the moment
        // PropertyNameCaseInsensitive=true folds the two together —
        // Deserialize<List<ClaudeAgentSession>> threw on this type
        // 100% of the time, unconditionally, regardless of the actual JSON
        // content, the environment, or the Debug/Release rebuild. #971's fix
        // was real (a genuine hang-risk bug) but was never actually the
        // cause of "Sessions is always empty" - this was. [JsonIgnore]
        // excludes it from the property map entirely, since it was never
        // meant to be (de)serialized in the first place - it's a pure C#-
        // side convenience derived from StartedAtMs.
        [JsonIgnore]
        public DateTime StartedAt => DateTimeOffset.FromUnixTimeMilliseconds(StartedAtMs).LocalDateTime;
    }

    /// <summary>
    /// Git #831 — Shane: "the right panel needs to have an All In session...
    /// like you are not in the queue, but you are running, and I should see
    /// the things you are working on but I cannot." A live interactive
    /// Claude Code session (like the one Shane is talking to right now) is
    /// NOT a queue row - it never goes through bt_build_queue at all, so
    /// nothing in the Build Queue panel could ever show it. `claude agents
    /// --json` is a real, documented, scriptable command (confirmed via a
    /// live run) that lists every active session on this machine -
    /// interactive and background both - with no TTY required. This shells
    /// out to it directly; there's no server round-trip since this is
    /// purely local machine state, not anything bt_build_queue tracks.
    /// </summary>
    public static class ClaudeAgentsService
    {
        private static readonly string ClaudeExe = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin", "claude.exe");

        /// <summary>Git #984 — small rolling mirror of this method's own outcome (overwritten every poll, not appended), so a future failure is inspectable directly from disk without needing the Activity Log panel open.</summary>
        private static void DebugLog(string message)
        {
            try
            {
                var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "buildconsole_sessions_debug.log");
                File.WriteAllText(path, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}\n");
            }
            catch { }
        }

        /// <summary>
        /// Git #971 — Shane: "I think this is what Session is for? But it's
        /// always empty. So maybe a bug is there?" Found a real one: this
        /// redirected BOTH stdout and stderr but only ever read stdout, and
        /// only AFTER starting the process — a textbook .NET Process
        /// deadlock. If `claude agents --json` ever writes enough to stderr
        /// to fill the OS pipe buffer (a few KB — an update-check notice, a
        /// deprecation warning, anything), the child process blocks trying
        /// to write more while this call sits blocked in `ReadToEndAsync()`
        /// on stdout, waiting for a process that's waiting right back on it
        /// — neither side ever finishes, so this call just hangs forever on
        /// whichever poll tick hit it. That reads as "Sessions is always
        /// empty," not as an error, since nothing ever throws either. Now
        /// reads both streams concurrently (never sequentially) so neither
        /// pipe can ever fill up and block the other, and logs the exit
        /// code/stderr/parse failure on every non-empty failure path
        /// instead of swallowing it silently, so a future failure is
        /// actually diagnosable from the Activity Log instead of just
        /// looking like "nothing running."
        ///
        /// Git #984 — that fix was real but wasn't the actual cause of
        /// "always empty" - see ClaudeAgentSession.StartedAt's own doc
        /// comment for the real one (a deserialization property-name
        /// collision that threw unconditionally, on every single call).
        /// </summary>
        public static async Task<List<ClaudeAgentSession>> ListActiveSessionsAsync()
        {
            if (!File.Exists(ClaudeExe))
            {
                ActivityLog.Log("sessions", $"claude.exe not found at {ClaudeExe}");
                DebugLog($"claude.exe not found at {ClaudeExe}");
                return new List<ClaudeAgentSession>();
            }

            var psi = new ProcessStartInfo
            {
                FileName = ClaudeExe,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("agents");
            psi.ArgumentList.Add("--json");

            using var proc = new Process { StartInfo = psi };
            proc.Start();
            var stdoutTask = proc.StandardOutput.ReadToEndAsync();
            var stderrTask = proc.StandardError.ReadToEndAsync();
            await Task.WhenAll(stdoutTask, stderrTask);
            await proc.WaitForExitAsync();
            string stdout = stdoutTask.Result;
            string stderr = stderrTask.Result;

            if (proc.ExitCode != 0 || string.IsNullOrWhiteSpace(stdout))
            {
                var msg = $"claude agents --json exit {proc.ExitCode}"
                    + (string.IsNullOrWhiteSpace(stderr) ? "" : $": {stderr.Trim()}")
                    + (string.IsNullOrWhiteSpace(stdout) ? " (empty stdout)" : "");
                ActivityLog.Log("sessions", msg);
                DebugLog(msg);
                return new List<ClaudeAgentSession>();
            }

            try
            {
                var sessions = System.Text.Json.JsonSerializer.Deserialize<List<ClaudeAgentSession>>(
                    stdout, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                DebugLog($"ok, {sessions?.Count ?? 0} session(s). Raw stdout: {stdout}");
                return sessions ?? new List<ClaudeAgentSession>();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("sessions", $"claude agents --json parse failed: {ex.Message}");
                DebugLog($"parse failed: {ex.Message}. Raw stdout: {stdout}");
                return new List<ClaudeAgentSession>();
            }
        }

        /// <summary>
        /// Git #991 — Shane: "I have like 4 goins now" against a Sessions
        /// panel that (after #984's real fix) correctly reflected `claude
        /// agents --json` — but proved, via a direct side-by-side check
        /// (`Get-Process -Name claude` vs this same command run at the same
        /// moment), that the CLI's own "agents" registry doesn't discover
        /// every real running claude.exe process. Specifically: sessions
        /// launched via the Send-to-Builder path (`run-claude.ps1` ->
        /// `Start-Process -NoNewWindow -Wait`, non-interactive
        /// `--permission-mode auto`) were real, running, and completely
        /// invisible to `claude agents --json`, while a plain interactive
        /// session (this one) showed up fine. Shane: "fall back using
        /// Get-Process." This merges the CLI's own (richly-labeled: Name,
        /// Cwd, SessionId) list with a raw OS process scan, adding one
        /// fallback entry (Kind="untracked") for every real claude.exe PID
        /// the CLI's own list doesn't already account for - so a session the
        /// CLI can't see for whatever reason still shows up as SOMETHING
        /// (PID + elapsed time) instead of silently vanishing again.
        ///
        /// Shane, follow-up: "Can you not get the window title and use those?
        /// instead of claude.exe." Confirmed via Get-Process that claude.exe
        /// itself owns no window (MainWindowHandle is always 0 - it's
        /// attached to its parent's console, per run-claude.ps1's
        /// `-NoNewWindow`), but the real, LIVE title (run-claude.ps1's own
        /// `$Host.UI.RawUI.WindowTitle = $title`, further updated by
        /// claude.exe itself with status glyphs like "✳ 989") lives on an
        /// ANCESTOR process - confirmed live as a `cmd.exe` window titled
        /// "✳ 989". Process has no parent-PID API, so this walks the chain
        /// via WMI's Win32_Process.
        ///
        /// Git #1001 — Shane: "if I clicked on them they brought that window
        /// into focus," follow-up bug hunt: the merge step never seemed to
        /// finish (its own DebugLog line never appeared, poll after poll,
        /// even after ruling out overlapping calls with a re-entrancy guard).
        /// Root cause: `ManagementObjectSearcher.Get()` is a synchronous,
        /// blocking COM call, and everything after `await
        /// ListActiveSessionsAsync()` resumes on the ORIGINAL synchronization
        /// context by default - this app's WPF UI (STA) thread. A blocking
        /// COM/DCOM call made synchronously on an STA thread that's also
        /// mid-await is a classic deadlock shape (the WMI provider can need
        /// to pump messages back through that same thread's queue while the
        /// thread sits blocked waiting on it) - it doesn't error, it just
        /// never returns, which is indistinguishable from "still running"
        /// forever. Wrapped the whole WMI-touching merge phase in `Task.Run`
        /// so it executes on a real thread-pool thread, off the UI thread
        /// entirely, then awaited normally.
        /// </summary>
        public static async Task<List<ClaudeAgentSession>> ListActiveSessionsWithFallbackAsync()
        {
            var known = await ListActiveSessionsAsync();

            try
            {
                known = await Task.Run(() => MergeWithFallback(known));
            }
            catch (Exception ex)
            {
                ActivityLog.Log("sessions", $"ListActiveSessionsWithFallbackAsync failed: {ex}");
                DebugLog($"ListActiveSessionsWithFallbackAsync failed: {ex}");
            }
            return known;
        }

        /// <summary>Git #1001 — the synchronous (WMI-touching) half of ListActiveSessionsWithFallbackAsync, run via Task.Run so none of it executes on the UI thread. See that method's own doc comment for why.</summary>
        private static List<ClaudeAgentSession> MergeWithFallback(List<ClaudeAgentSession> known)
        {
            var knownPids = new HashSet<int>(known.Select(s => s.Pid));

            try
            {
                foreach (var proc in Process.GetProcessesByName("claude"))
                {
                    using (proc)
                    {
                        if (knownPids.Contains(proc.Id)) continue;
                        DateTime startTime;
                        try { startTime = proc.StartTime; }
                        catch { continue; } // no permission / already exited between enumeration and this read
                        var (title, handle) = FindAncestorWindow(proc.Id);
                        known.Add(new ClaudeAgentSession
                        {
                            Pid = proc.Id,
                            Kind = "untracked",
                            Name = title ?? "",
                            WindowHandle = handle,
                            StartedAtMs = new DateTimeOffset(startTime).ToUnixTimeMilliseconds(),
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("sessions", $"Get-Process fallback scan failed: {ex.Message}");
                DebugLog($"Get-Process fallback scan failed: {ex}");
            }

            // Git #1001 — Shane: "if I clicked on them they brought that
            // window into focus." Every session here (CLI-tracked or
            // fallback) needs its own ancestor window resolved for that to
            // work, not just the fallback ones - a plain interactive
            // claude.exe session (like this very conversation) is JUST as
            // windowless as a Send-to-Builder one; its real window lives 1-2
            // levels up too (confirmed live: this session's own ancestor
            // chain resolves to its actual VSCode window). Fallback entries
            // already got theirs above (also needed for their Name); this
            // fills in the rest.
            foreach (var s in known)
            {
                if (s.WindowHandle != IntPtr.Zero) continue;
                var (_, handle) = FindAncestorWindow(s.Pid);
                s.WindowHandle = handle;
            }

            DebugLog("merged: " + string.Join(" | ", known.Select(s => $"pid={s.Pid} kind={s.Kind} name='{s.Name}' hwnd={s.WindowHandle}")));
            return known;
        }

        /// <summary>
        /// Git #1001 — the WMI (System.Management/ManagementObjectSearcher,
        /// DCOM-based) version of this method appeared to simply hang
        /// forever on every single call on this machine — no exception, no
        /// timeout, confirmed even after moving the whole call off the UI
        /// thread via Task.Run (ruling out the STA-COM-reentrancy theory
        /// too). Direct PowerShell testing earlier used `Get-CimInstance`,
        /// which is a genuinely DIFFERENT code path (CIM/WinRM, not classic
        /// WMI/DCOM) — the two can behave completely differently on a given
        /// machine (locked-down DCOM via firewall/policy/AV is a known
        /// cause). Replaced with CreateToolhelp32Snapshot (kernel32, pure
        /// Win32, no COM/DCOM/WMI involved at all) — the standard, reliable
        /// way to walk process parent-child relationships without WMI.
        /// </summary>
        private static (string? Title, IntPtr Handle) FindAncestorWindow(int pid)
        {
            try
            {
                int currentPid = pid;
                for (int depth = 0; depth < 4; depth++)
                {
                    int? parentPid = GetParentProcessId(currentPid);
                    if (parentPid is not int p || p <= 0 || p == currentPid) return (null, IntPtr.Zero);

                    try
                    {
                        using var parent = Process.GetProcessById(p);
                        if (!string.IsNullOrWhiteSpace(parent.MainWindowTitle) && parent.MainWindowHandle != IntPtr.Zero)
                            return (parent.MainWindowTitle, parent.MainWindowHandle);
                    }
                    catch { /* parent already exited between the snapshot and this lookup */ }

                    currentPid = p;
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("sessions", $"ancestor-window lookup failed for pid {pid}: {ex.Message}");
            }
            return (null, IntPtr.Zero);
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESSENTRY32
        {
            public uint dwSize;
            public uint cntUsage;
            public uint th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID;
            public uint cntThreads;
            public uint th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string szExeFile;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

        [DllImport("kernel32.dll")]
        private static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll")]
        private static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        private const uint TH32CS_SNAPPROCESS = 0x00000002;

        /// <summary>Git #1001 — one snapshot scan for the given PID's parent, pure kernel32/Toolhelp32, no WMI/COM.</summary>
        private static int? GetParentProcessId(int pid)
        {
            IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snapshot == IntPtr.Zero || snapshot.ToInt64() == -1) return null;
            try
            {
                var entry = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32>() };
                if (!Process32First(snapshot, ref entry)) return null;
                do
                {
                    if (entry.th32ProcessID == (uint)pid) return (int)entry.th32ParentProcessID;
                } while (Process32Next(snapshot, ref entry));
            }
            finally
            {
                CloseHandle(snapshot);
            }
            return null;
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        private const int SW_RESTORE = 9;

        /// <summary>Git #1001 — Shane: "if I clicked on them they brought that window into focus." Un-minimizes first if needed (SetForegroundWindow alone doesn't restore a minimized window), then brings it to the front. Called directly from a click-driven UI event, which is exactly the case Windows' foreground-lock exception allows - the process that currently has focus (BuildConsole, mid-handling a real user click) is always allowed to hand focus to another window as a direct result of that input.</summary>
        public static bool BringToForeground(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero) return false;
            try
            {
                if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE);
                return SetForegroundWindow(hWnd);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("sessions", $"BringToForeground failed for hwnd {hWnd}: {ex.Message}");
                return false;
            }
        }
    }
}
