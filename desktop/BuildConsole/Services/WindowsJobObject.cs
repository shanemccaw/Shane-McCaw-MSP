using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1792 — a per-build Windows Job Object that owns every process a launched build ever
    /// spawns (claude.exe and, crucially, the <c>node.exe</c> grandchildren it fans out for its own
    /// tool execution), so the WHOLE tree can be reaped together at that build's completion —
    /// regardless of whether the immediate parent-child chain was still intact.
    ///
    /// Why .NET's <c>Process.Kill(entireProcessTree: true)</c> isn't enough on its own: a tree-walk
    /// can only reap children reachable from a still-alive parent. A node.exe grandchild that
    /// detaches from its immediate parent before that parent exits (a real npm/node wrapper-chain
    /// quirk on Windows) is already orphaned by the time the parent is gone — there is nothing left
    /// to walk the tree FROM. A Job Object catches it because membership is assigned at spawn and is
    /// inherited by every descendant no matter how the parent-child links later break.
    ///
    /// Lifetime scoping (Git #1792 correction — locked in before build): the job's kill is scoped to
    /// each build's OWN completion, never to BuildConsole's process lifetime. It is torn down
    /// (<see cref="TerminateAndClose"/>) the moment that specific build entry is reaped/cancelled.
    /// Closing BuildConsole while a build is still running must NOT kill that build (BuildConsole's
    /// #1804 durable-file design deliberately lets builds survive the app closing). To keep that
    /// true, the app-shutdown path calls <see cref="DetachWithoutKill"/> on every still-live build's
    /// job, which strips the kill-on-close limit BEFORE the handle is released so the members live on.
    ///
    /// <see cref="JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE"/> is set (as the issue specifies) so that even
    /// a plain handle-close reaps the tree; the explicit <see cref="TerminateJobObject"/> in
    /// <see cref="TerminateAndClose"/> makes the reap immediate and deterministic (not dependent on
    /// this being the last open handle), and is the real backstop that catches detached grandchildren
    /// the tree-walk missed.
    /// </summary>
    internal sealed class WindowsJobObject
    {
        private IntPtr _handle;
        private bool _closed;
        private readonly object _lock = new();

        private WindowsJobObject(IntPtr handle) => _handle = handle;

        /// <summary>
        /// Creates a job with <see cref="JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE"/> set. Returns null (never
        /// throws) if the OS refuses — the caller then simply runs without a job, degrading to the
        /// pre-#1792 behavior rather than failing the launch.
        /// </summary>
        public static WindowsJobObject? CreateWithKillOnClose()
        {
            IntPtr h = CreateJobObject(IntPtr.Zero, null);
            if (h == IntPtr.Zero)
            {
                ActivityLog.Log("watcher", $"CreateJobObject failed (win32 {Marshal.GetLastWin32Error()}) — build will run without Job Object cleanup.");
                return null;
            }
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            int len = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
            if (!SetInformationJobObject(h, JobObjectExtendedLimitInformation, ref info, (uint)len))
            {
                ActivityLog.Log("watcher", $"SetInformationJobObject(KILL_ON_JOB_CLOSE) failed (win32 {Marshal.GetLastWin32Error()}) — build will run without Job Object cleanup.");
                CloseHandle(h);
                return null;
            }
            return new WindowsJobObject(h);
        }

        /// <summary>Assigns <paramref name="processHandle"/> (a raw process HANDLE) to this job. Every
        /// descendant it later spawns is a job member too. Best-effort: logs and returns false on
        /// failure (e.g. a restrictive ambient job without nested-job support).</summary>
        public bool Assign(IntPtr processHandle)
        {
            lock (_lock)
            {
                if (_closed || _handle == IntPtr.Zero) return false;
                if (!AssignProcessToJobObject(_handle, processHandle))
                {
                    ActivityLog.Log("watcher", $"AssignProcessToJobObject failed (win32 {Marshal.GetLastWin32Error()}) — build's spawned processes won't be Job-Object-reaped.");
                    return false;
                }
                return true;
            }
        }

        /// <summary>
        /// Deterministically terminates every process in the job (claude.exe + all descendants,
        /// including detached grandchildren) and closes the handle. Idempotent — safe to call from
        /// both the immediate cancel/hard-kill path and the later reap-loop path for the same build.
        /// </summary>
        public void TerminateAndClose()
        {
            lock (_lock)
            {
                if (_closed) return;
                _closed = true;
                if (_handle == IntPtr.Zero) return;
                try { TerminateJobObject(_handle, 1); } catch { /* best-effort — CloseHandle below still reaps via KILL_ON_JOB_CLOSE */ }
                CloseHandle(_handle);
                _handle = IntPtr.Zero;
            }
        }

        /// <summary>
        /// Strips the kill-on-close limit and releases the handle WITHOUT terminating the members —
        /// the build keeps running. Called on BuildConsole's graceful shutdown for every still-live
        /// build so closing the app never kills in-progress work (Git #1792 correction). Idempotent.
        /// </summary>
        public void DetachWithoutKill()
        {
            lock (_lock)
            {
                if (_closed) return;
                _closed = true;
                if (_handle == IntPtr.Zero) return;
                try
                {
                    var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION(); // LimitFlags = 0 → kill-on-close cleared
                    int len = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
                    SetInformationJobObject(_handle, JobObjectExtendedLimitInformation, ref info, (uint)len);
                }
                catch { /* best-effort; if it fails the members may be reaped on handle close, but graceful shutdown normally succeeds */ }
                CloseHandle(_handle);
                _handle = IntPtr.Zero;
            }
        }

        // ── P/Invoke ────────────────────────────────────────────────────────
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const int JobObjectExtendedLimitInformation = 9;

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string? lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr hObject);
    }
}
