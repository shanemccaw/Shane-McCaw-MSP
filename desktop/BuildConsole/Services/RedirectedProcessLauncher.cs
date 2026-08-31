using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1804 — launches a build process (claude.exe/gemini.exe) with its stdout/stderr
    /// redirected to DURABLE FILES the child itself owns, rather than to a .NET anonymous pipe
    /// whose read end lives in BuildConsole's own process.
    ///
    /// Why this exists at all: <c>ProcessStartInfo.RedirectStandardOutput = true</c> gives the
    /// child an anonymous pipe whose READ handle is owned by this app. When BuildConsole exits,
    /// that read handle is torn down; the next stdout write from claude.exe (or a node.exe it
    /// spawned) hits a broken pipe and — Node crashes hard on an unhandled EPIPE — the whole
    /// in-progress build dies with the app. .NET's Process has no way to redirect a child's std
    /// handles to a FILE instead of a pipe, so this drops to Win32 CreateProcess and hands the
    /// child inheritable file handles directly. A file handle doesn't care whether BuildConsole
    /// is still alive, so the build keeps running (and completing) after the app closes.
    ///
    /// BuildConsole still gets live output by TAILING those files (see the tailer in
    /// QueueWatcherService), the same file-tail pattern ExternalLogWindow/#1638 already use — so
    /// live Build Watch streaming keeps working while the app is open, without the build's
    /// survival depending on it.
    ///
    /// Inheritance is restricted to exactly the three std handles via a
    /// PROC_THREAD_ATTRIBUTE_HANDLE_LIST (STARTUPINFOEX) so that, with up to ~8 concurrent
    /// builds launching, one child can never accidentally inherit another build's stdin-pipe
    /// read end (which would keep that other build from ever seeing stdin EOF).
    /// </summary>
    internal static class RedirectedProcessLauncher
    {
        /// <summary>A launched build process plus (for interactive builds) the owned stdin writer.</summary>
        internal sealed class LaunchedProcess
        {
            public BuildProcessHandle Process = null!;
            /// <summary>The owned stdin writer over the pipe's write end — null when <c>redirectStdin</c> was false.</summary>
            public StreamWriter? StdIn;
            /// <summary>Git #1792 — the per-build Windows Job Object this process (and every descendant it
            /// spawns) is assigned to, so the whole tree can be reaped together at the build's completion.
            /// Null if the OS refused to create/assign the job — the build still runs, just without the
            /// Job-Object cleanup backstop (degrades to the pre-#1792 tree-walk-only behavior).</summary>
            public WindowsJobObject? Job;
        }

        /// <summary>
        /// Launches <paramref name="exePath"/> with stdout→<paramref name="stdoutFilePath"/> and
        /// stderr→<paramref name="stderrFilePath"/> (both truncated/created), stdin either a real
        /// owned pipe (<paramref name="redirectStdin"/> = true) or the NUL device.
        /// <paramref name="envOverrides"/> entries with a null value are REMOVED from the child's
        /// environment; non-null values are set/overwritten. Throws on any Win32 failure.
        /// </summary>
        public static LaunchedProcess Launch(
            string exePath,
            IReadOnlyList<string> args,
            string workingDirectory,
            IReadOnlyDictionary<string, string?> envOverrides,
            string stdoutFilePath,
            string stderrFilePath,
            bool redirectStdin)
        {
            IntPtr hStdOut = INVALID_HANDLE_VALUE, hStdErr = INVALID_HANDLE_VALUE;
            IntPtr hStdInRead = INVALID_HANDLE_VALUE, hStdInWrite = INVALID_HANDLE_VALUE;
            IntPtr attrList = IntPtr.Zero;
            IntPtr envBlock = IntPtr.Zero;
            GCHandle pinnedHandles = default;
            bool pinned = false;

            try
            {
                var sa = new SECURITY_ATTRIBUTES
                {
                    nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(),
                    lpSecurityDescriptor = IntPtr.Zero,
                    bInheritHandle = true, // the file/pipe-read handles must be inheritable
                };

                // Output files — inheritable, truncate-or-create, shared read/write so the tailer
                // (and BuildLogView, if ever pointed here) can read while the child writes.
                hStdOut = OpenInheritableFile(stdoutFilePath, forWrite: true, ref sa);
                hStdErr = OpenInheritableFile(stderrFilePath, forWrite: true, ref sa);

                if (redirectStdin)
                {
                    if (!CreatePipe(out hStdInRead, out hStdInWrite, ref sa, 0))
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "CreatePipe (stdin) failed");
                    // The WRITE end stays with us and must NOT leak into the child, or the child
                    // would never see EOF when we close our copy.
                    if (!SetHandleInformation(hStdInWrite, HANDLE_FLAG_INHERIT, 0))
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "SetHandleInformation (stdin write) failed");
                }
                else
                {
                    // No stdin needed (legacy positional-prompt build): give the child NUL so any
                    // stray read returns EOF immediately instead of blocking.
                    hStdInRead = OpenInheritableFile("NUL", forWrite: false, ref sa);
                }

                // Restrict inheritance to EXACTLY these three handles.
                var inheritList = new[] { hStdInRead, hStdOut, hStdErr };
                attrList = BuildHandleListAttribute(inheritList, out pinnedHandles);
                pinned = true;

                var siEx = new STARTUPINFOEX();
                siEx.StartupInfo.cb = Marshal.SizeOf<STARTUPINFOEX>();
                siEx.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
                siEx.StartupInfo.hStdInput = hStdInRead;
                siEx.StartupInfo.hStdOutput = hStdOut;
                siEx.StartupInfo.hStdError = hStdErr;
                siEx.lpAttributeList = attrList;

                string commandLine = BuildCommandLine(exePath, args);
                envBlock = BuildEnvironmentBlock(envOverrides);

                // Git #1792 — CREATE_SUSPENDED so we can assign the process to its Job Object BEFORE
                // it runs a single instruction. Assigning after an unsuspended start leaves a race
                // window in which the child could spawn a grandchild that escapes the job — exactly
                // the detached-grandchild class this fix exists to close. CREATE_NO_WINDOW is kept
                // untouched: this is about cleanup, not window visibility.
                uint flags = CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED;

                var ok = CreateProcess(
                    lpApplicationName: exePath,
                    lpCommandLine: new StringBuilder(commandLine),
                    lpProcessAttributes: IntPtr.Zero,
                    lpThreadAttributes: IntPtr.Zero,
                    bInheritHandles: true,
                    dwCreationFlags: flags,
                    lpEnvironment: envBlock,
                    lpCurrentDirectory: workingDirectory,
                    lpStartupInfo: ref siEx,
                    lpProcessInformation: out var pi);
                if (!ok)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), $"CreateProcess failed for {exePath}");

                // Git #1792 — while the process is still suspended, assign it to a per-build Job
                // Object so every process it ever spawns (its node.exe tool-execution grandchildren
                // included) is a job member from the very first instruction. Then resume the primary
                // thread. Job creation/assignment is best-effort: on failure the build still runs
                // (just without the cleanup backstop), but the thread MUST be resumed regardless or
                // the build would hang forever suspended — so ResumeThread is unconditional.
                WindowsJobObject? job = WindowsJobObject.CreateWithKillOnClose();
                if (job != null && !job.Assign(pi.hProcess))
                {
                    job.DetachWithoutKill(); // couldn't assign — drop the empty job, don't leak the handle
                    job = null;
                }
                if (ResumeThread(pi.hThread) == unchecked((uint)-1))
                    ActivityLog.Log("watcher", $"ResumeThread failed (win32 {Marshal.GetLastWin32Error()}) for {exePath} — the launched build may be stuck suspended.");

                // The child now owns its own copies of the inherited handles; drop ours.
                CloseHandle(pi.hThread);

                var procHandle = new SafeProcessHandle(pi.hProcess, ownsHandle: true);
                var result = new LaunchedProcess
                {
                    Process = new BuildProcessHandle(procHandle, (int)pi.dwProcessId),
                    Job = job,
                };

                if (redirectStdin)
                {
                    // Hand ownership of the pipe's write end to a StreamWriter; closing it later
                    // (ReleaseInteractive / finalize) closes the pipe and gives the child stdin EOF.
                    var writeSafe = new SafeFileHandle(hStdInWrite, ownsHandle: true);
                    hStdInWrite = INVALID_HANDLE_VALUE; // ownership transferred; don't double-close below
                    var fs = new FileStream(writeSafe, FileAccess.Write);
                    result.StdIn = new StreamWriter(fs, new UTF8Encoding(false)) { AutoFlush = false };
                }

                return result;
            }
            finally
            {
                // Our copies of the inherited handles are no longer needed once the child has them.
                if (hStdOut != INVALID_HANDLE_VALUE) CloseHandle(hStdOut);
                if (hStdErr != INVALID_HANDLE_VALUE) CloseHandle(hStdErr);
                if (hStdInRead != INVALID_HANDLE_VALUE) CloseHandle(hStdInRead);
                if (hStdInWrite != INVALID_HANDLE_VALUE) CloseHandle(hStdInWrite); // only if not transferred to StdIn
                if (attrList != IntPtr.Zero) { DeleteProcThreadAttributeList(attrList); Marshal.FreeHGlobal(attrList); }
                if (pinned && pinnedHandles.IsAllocated) pinnedHandles.Free();
                if (envBlock != IntPtr.Zero) Marshal.FreeHGlobal(envBlock);
            }
        }

        private static IntPtr OpenInheritableFile(string path, bool forWrite, ref SECURITY_ATTRIBUTES sa)
        {
            uint access = forWrite ? GENERIC_WRITE : GENERIC_READ;
            // CREATE_ALWAYS truncates an existing file (mirrors the File.WriteAllText(path,"") the
            // in-app path used to do to clear a stale log); NUL ignores it. Share read+write so the
            // tailer can open the same file concurrently.
            uint disposition = forWrite ? CREATE_ALWAYS : OPEN_EXISTING;
            IntPtr h = CreateFile(path, access, FILE_SHARE_READ | FILE_SHARE_WRITE, ref sa, disposition,
                FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
            if (h == INVALID_HANDLE_VALUE)
                throw new Win32Exception(Marshal.GetLastWin32Error(), $"CreateFile failed for {path}");
            return h;
        }

        private static IntPtr BuildHandleListAttribute(IntPtr[] handles, out GCHandle pinned)
        {
            IntPtr size = IntPtr.Zero;
            // First call: query required size (returns false + ERROR_INSUFFICIENT_BUFFER by design).
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            IntPtr list = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(list, 1, 0, ref size))
            {
                Marshal.FreeHGlobal(list);
                throw new Win32Exception(Marshal.GetLastWin32Error(), "InitializeProcThreadAttributeList failed");
            }
            pinned = GCHandle.Alloc(handles, GCHandleType.Pinned);
            if (!UpdateProcThreadAttribute(list, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                    pinned.AddrOfPinnedObject(), (IntPtr)(handles.Length * IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
            {
                int err = Marshal.GetLastWin32Error();
                pinned.Free();
                DeleteProcThreadAttributeList(list);
                Marshal.FreeHGlobal(list);
                throw new Win32Exception(err, "UpdateProcThreadAttribute failed");
            }
            return list;
        }

        /// <summary>Standard Win32 (CommandLineToArgvW-compatible) argv quoting, argv[0] first.</summary>
        internal static string BuildCommandLine(string exePath, IReadOnlyList<string> args)
        {
            var sb = new StringBuilder();
            AppendArg(sb, exePath);
            foreach (var a in args)
            {
                sb.Append(' ');
                AppendArg(sb, a);
            }
            return sb.ToString();
        }

        private static void AppendArg(StringBuilder sb, string arg)
        {
            if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            {
                sb.Append(arg);
                return;
            }
            sb.Append('"');
            for (int i = 0; ; i++)
            {
                int backslashes = 0;
                while (i < arg.Length && arg[i] == '\\') { i++; backslashes++; }
                if (i == arg.Length)
                {
                    sb.Append('\\', backslashes * 2);
                    break;
                }
                else if (arg[i] == '"')
                {
                    sb.Append('\\', backslashes * 2 + 1);
                    sb.Append('"');
                }
                else
                {
                    sb.Append('\\', backslashes);
                    sb.Append(arg[i]);
                }
            }
            sb.Append('"');
        }

        /// <summary>
        /// Builds a CREATE_UNICODE_ENVIRONMENT block from this process's current environment with
        /// <paramref name="overrides"/> applied (null value = remove the key). The block is a
        /// case-insensitively sorted run of <c>KEY=VALUE\0</c> entries terminated by an extra \0.
        /// </summary>
        private static IntPtr BuildEnvironmentBlock(IReadOnlyDictionary<string, string?> overrides)
        {
            var map = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (System.Collections.DictionaryEntry e in Environment.GetEnvironmentVariables())
            {
                var key = e.Key?.ToString();
                if (string.IsNullOrEmpty(key)) continue;
                map[key] = e.Value?.ToString() ?? string.Empty;
            }
            foreach (var kv in overrides)
            {
                if (kv.Value == null) map.Remove(kv.Key);
                else map[kv.Key] = kv.Value;
            }

            var sb = new StringBuilder();
            foreach (var kv in map)
            {
                sb.Append(kv.Key).Append('=').Append(kv.Value).Append('\0');
            }
            sb.Append('\0'); // final terminator (an empty environment still needs the double-null)
            return Marshal.StringToHGlobalUni(sb.ToString());
        }

        // ── P/Invoke ────────────────────────────────────────────────────────

        private const uint GENERIC_WRITE = 0x40000000;
        private const uint GENERIC_READ = 0x80000000;
        private const uint FILE_SHARE_READ = 0x00000001;
        private const uint FILE_SHARE_WRITE = 0x00000002;
        private const uint CREATE_ALWAYS = 2;
        private const uint OPEN_EXISTING = 3;
        private const uint FILE_ATTRIBUTE_NORMAL = 0x80;
        private static readonly IntPtr INVALID_HANDLE_VALUE = new(-1);

        private const uint STARTF_USESTDHANDLES = 0x00000100;
        private const uint CREATE_NO_WINDOW = 0x08000000;
        private const uint CREATE_SUSPENDED = 0x00000004;
        private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
        private const uint HANDLE_FLAG_INHERIT = 0x00000001;
        private static readonly IntPtr PROC_THREAD_ATTRIBUTE_HANDLE_LIST = (IntPtr)0x00020002;

        [StructLayout(LayoutKind.Sequential)]
        private struct SECURITY_ATTRIBUTES
        {
            public int nLength;
            public IntPtr lpSecurityDescriptor;
            [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public int cb;
            public string? lpReserved;
            public string? lpDesktop;
            public string? lpTitle;
            public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute;
            public uint dwFlags;
            public ushort wShowWindow;
            public ushort cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct STARTUPINFOEX
        {
            public STARTUPINFO StartupInfo;
            public IntPtr lpAttributeList;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public uint dwProcessId;
            public uint dwThreadId;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "CreateProcessW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcess(
            string? lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            [MarshalAs(UnmanagedType.Bool)] bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string? lpCurrentDirectory,
            ref STARTUPINFOEX lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "CreateFileW")]
        private static extern IntPtr CreateFile(
            string lpFileName, uint dwDesiredAccess, uint dwShareMode, ref SECURITY_ATTRIBUTES lpSecurityAttributes,
            uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreatePipe(out IntPtr hReadPipe, out IntPtr hWritePipe, ref SECURITY_ATTRIBUTES lpPipeAttributes, uint nSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetHandleInformation(IntPtr hObject, uint dwMask, uint dwFlags);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr hObject);

        // Git #1792 — resumes the primary thread of a CREATE_SUSPENDED process after Job Object
        // assignment. Returns the thread's previous suspend count, or (DWORD)-1 on failure.
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr hThread);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);

        [DllImport("kernel32.dll")]
        private static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);
    }

    /// <summary>
    /// Git #1804 — a thin stand-in for the members of <see cref="System.Diagnostics.Process"/> that
    /// QueueWatcherService uses on a launched build (<c>HasExited</c>, <c>ExitCode</c>, <c>Id</c>,
    /// <c>Kill</c>), backed by the raw process handle from <see cref="RedirectedProcessLauncher"/>.
    /// Deliberately same member names/shapes so the reap loop and stop/kill sites read unchanged.
    /// </summary>
    internal sealed class BuildProcessHandle
    {
        private readonly SafeProcessHandle _handle;
        public int Id { get; }

        public BuildProcessHandle(SafeProcessHandle handle, int id)
        {
            _handle = handle;
            Id = id;
        }

        /// <summary>
        /// Git #1839 — re-opens an EXISTING process by pid for adoption after a BuildConsole restart.
        /// Opens with SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION — exactly the rights this class's
        /// <see cref="HasExited"/> (WaitForSingleObject), <see cref="ExitCode"/> (GetExitCodeProcess) and
        /// <see cref="CreationTimeUtc"/> (GetProcessTimes) need. Returns null when the process is already
        /// gone (OpenProcess fails). The caller MUST verify <see cref="CreationTimeUtc"/> against the
        /// stored creation time before trusting the match — Windows reuses pids.
        /// </summary>
        public static BuildProcessHandle? TryOpenExisting(int pid)
        {
            IntPtr h = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (h == IntPtr.Zero) return null;
            return new BuildProcessHandle(new SafeProcessHandle(h, ownsHandle: true), pid);
        }

        /// <summary>The process's creation time in UTC (from GetProcessTimes), or null if it can't be
        /// read. This is the pid-reuse fingerprint used to make adoption safe (Git #1839).</summary>
        public DateTime? CreationTimeUtc
        {
            get
            {
                if (GetProcessTimes(_handle, out long creation, out _, out _, out _))
                    return DateTime.FromFileTimeUtc(creation);
                return null;
            }
        }

        /// <summary>Git #1839 — releases the underlying process handle. Used on the adoption REJECT
        /// path (pid was reused, or the process already exited) to promptly close a handle we opened
        /// via <see cref="TryOpenExisting"/> but decided not to keep.</summary>
        public void Close() => _handle.Dispose();

        /// <summary>True once the process has terminated (authoritative — waits on the handle, 0 timeout).</summary>
        public bool HasExited => WaitForSingleObject(_handle, 0) == WAIT_OBJECT_0;

        /// <summary>The process exit code (only meaningful once <see cref="HasExited"/> is true).</summary>
        public int ExitCode
        {
            get
            {
                if (GetExitCodeProcess(_handle, out uint code)) return unchecked((int)code);
                return -1;
            }
        }

        /// <summary>
        /// Kills the process — preserving the pre-#1804 behavior of tree-killing via .NET's own
        /// <c>Process.Kill(entireProcessTree)</c> when possible (callers guard with a HasExited
        /// check first). Falls back to terminating just this process off the raw handle if the
        /// process object can't be reopened (already gone / access), so a Stop never silently no-ops.
        /// </summary>
        public void Kill(bool entireProcessTree)
        {
            try
            {
                using var p = Process.GetProcessById(Id);
                p.Kill(entireProcessTree);
                return;
            }
            catch { /* fall through to the raw-handle terminate below */ }
            try { TerminateProcess(_handle, 1); } catch { }
        }

        private const uint WAIT_OBJECT_0 = 0x00000000;
        private const uint SYNCHRONIZE = 0x00100000;
        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x00001000;

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(SafeProcessHandle hHandle, uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint dwDesiredAccess, [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle, int dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetProcessTimes(SafeProcessHandle hProcess, out long lpCreationTime, out long lpExitTime, out long lpKernelTime, out long lpUserTime);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetExitCodeProcess(SafeProcessHandle hProcess, out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateProcess(SafeProcessHandle hProcess, uint uExitCode);
    }
}
