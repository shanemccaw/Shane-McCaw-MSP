using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2149 — a real Windows pseudo-console (ConPTY) session.
    ///
    /// The existing <see cref="BuildConsole.Controls.TerminalView"/> is a
    /// line-based redirected-stdio shell (one <c>ReadLine</c> per command) — it
    /// cannot host Claude Code's interactive TUI, which is a full-screen ANSI
    /// program (cursor addressing, colour, live redraw, the alternate screen
    /// buffer) that only runs when it believes it is attached to a real TTY.
    ///
    /// ConPTY (<c>CreatePseudoConsole</c>, Windows 10 1809+) is the supported way
    /// to give a child process a genuine pseudo-terminal from a GUI app. The
    /// child (here PowerShell, from which Shane launches <c>claude</c>) runs
    /// exactly as it would in Windows Terminal / conhost, emitting its full VT
    /// stream, which we forward verbatim to an xterm.js surface for rendering.
    ///
    /// Pure P/Invoke against kernel32 — no third-party dependency. Pattern
    /// follows Microsoft's own MiniTerm ConPTY sample.
    /// </summary>
    public sealed class PtySession : IDisposable
    {
        // ── ConPTY / process-creation constants ──
        private const int PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016;
        private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
        private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        private const uint INFINITE = 0xFFFFFFFF;

        private IntPtr _hPC = IntPtr.Zero;                 // HPCON
        private SafeFileHandle? _ptyInputWrite;            // we WRITE here → child stdin
        private SafeFileHandle? _ptyOutputRead;            // we READ here  ← child stdout/stderr
        private SafeFileHandle? _ptyInputRead;             // child-facing ends — kept alive
        private SafeFileHandle? _ptyOutputWrite;           // for the pseudo-console's lifetime
        private PROCESS_INFORMATION _procInfo;
        private IntPtr _attrList = IntPtr.Zero;
        private FileStream? _writeStream;
        private FileStream? _readStream;
        private Thread? _readThread;
        private Thread? _exitThread;
        private volatile bool _disposed;

        /// <summary>Raw VT bytes emitted by the child. Forward verbatim to the renderer.</summary>
        public event Action<byte[]>? OutputReceived;

        /// <summary>Fired once when the child process exits.</summary>
        public event Action? Exited;

        public bool IsRunning => !_disposed && _procInfo.hProcess != IntPtr.Zero;

        /// <summary>
        /// Start <paramref name="commandLine"/> attached to a fresh pseudo-console
        /// sized <paramref name="cols"/>×<paramref name="rows"/> characters.
        /// </summary>
        public void Start(string commandLine, string workingDirectory, short cols, short rows)
        {
            if (cols < 1) cols = 80;
            if (rows < 1) rows = 24;

            // 1. Two pipes. ConPTY reads the child's stdin from ptyInputRead and
            //    writes the child's stdout to ptyOutputWrite; we own the opposite ends.
            if (!CreatePipe(out SafeFileHandle ptyInputRead, out SafeFileHandle inputWrite, IntPtr.Zero, 0))
                throw new InvalidOperationException($"CreatePipe(input) failed: {Marshal.GetLastWin32Error()}");
            if (!CreatePipe(out SafeFileHandle outputRead, out SafeFileHandle ptyOutputWrite, IntPtr.Zero, 0))
                throw new InvalidOperationException($"CreatePipe(output) failed: {Marshal.GetLastWin32Error()}");

            _ptyInputWrite = inputWrite;
            _ptyOutputRead = outputRead;
            _ptyInputRead = ptyInputRead;
            _ptyOutputWrite = ptyOutputWrite;

            // 2. Create the pseudo-console over the child-facing pipe ends. We keep
            //    our copies of the child-facing ends open for the pseudo-console's
            //    whole lifetime (released in Dispose), matching Microsoft's ConPTY
            //    sample — releasing them here before CreateProcess is what breaks
            //    the child's attachment to the console on some hosts.
            var size = new COORD { X = cols, Y = rows };
            int hr = CreatePseudoConsole(size, ptyInputRead, ptyOutputWrite, 0, out _hPC);
            if (hr != 0)
                throw new InvalidOperationException($"CreatePseudoConsole failed: HRESULT 0x{hr:X8}");

            // 3. Build a STARTUPINFOEX carrying the PSEUDOCONSOLE attribute.
            var startupInfo = BuildStartupInfoWithPseudoConsole(_hPC, out _attrList);

            var cmd = new StringBuilder(commandLine);
            uint flags = EXTENDED_STARTUPINFO_PRESENT;
            bool ok = CreateProcess(
                lpApplicationName: null,
                lpCommandLine: cmd,
                lpProcessAttributes: IntPtr.Zero,
                lpThreadAttributes: IntPtr.Zero,
                bInheritHandles: false,
                dwCreationFlags: flags,
                lpEnvironment: IntPtr.Zero,
                lpCurrentDirectory: string.IsNullOrWhiteSpace(workingDirectory) ? null : workingDirectory,
                lpStartupInfo: ref startupInfo,
                lpProcessInformation: out _procInfo);
            if (!ok)
                throw new InvalidOperationException($"CreateProcess failed: {Marshal.GetLastWin32Error()}");

            // 4. Streams over our ends of the pipes.
            _writeStream = new FileStream(_ptyInputWrite, FileAccess.Write);
            _readStream = new FileStream(_ptyOutputRead, FileAccess.Read);

            _readThread = new Thread(ReadLoop) { IsBackground = true, Name = "PtySession.Read" };
            _readThread.Start();

            _exitThread = new Thread(WaitForExit) { IsBackground = true, Name = "PtySession.Exit" };
            _exitThread.Start();
        }

        private void ReadLoop()
        {
            var buffer = new byte[8192];
            try
            {
                int read;
                while (!_disposed && _readStream != null && (read = _readStream.Read(buffer, 0, buffer.Length)) > 0)
                {
                    var chunk = new byte[read];
                    Buffer.BlockCopy(buffer, 0, chunk, 0, read);
                    OutputReceived?.Invoke(chunk);
                }
            }
            catch (Exception)
            {
                // Pipe closed (child exited / disposed) — nothing to recover; the
                // exit watcher below fires Exited.
            }
        }

        private void WaitForExit()
        {
            try
            {
                if (_procInfo.hProcess != IntPtr.Zero)
                    WaitForSingleObject(_procInfo.hProcess, INFINITE);
            }
            catch { /* ignore */ }
            if (!_disposed)
                Exited?.Invoke();
        }

        /// <summary>Send UTF-8 text (keystrokes / pasted text) to the child's stdin.</summary>
        public void Write(string data)
        {
            if (_disposed || _writeStream == null || string.IsNullOrEmpty(data)) return;
            try
            {
                byte[] bytes = Encoding.UTF8.GetBytes(data);
                _writeStream.Write(bytes, 0, bytes.Length);
                _writeStream.Flush();
            }
            catch (Exception) { /* pipe closed */ }
        }

        /// <summary>Resize the pseudo-console (character grid) as the panel resizes.</summary>
        public void Resize(short cols, short rows)
        {
            if (_disposed || _hPC == IntPtr.Zero) return;
            if (cols < 1) cols = 1;
            if (rows < 1) rows = 1;
            try { ResizePseudoConsole(_hPC, new COORD { X = cols, Y = rows }); }
            catch (Exception) { /* transient */ }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            // Closing the pseudo-console terminates the attached child and unblocks
            // the read loop.
            try { if (_hPC != IntPtr.Zero) ClosePseudoConsole(_hPC); } catch { }
            _hPC = IntPtr.Zero;

            try { _writeStream?.Dispose(); } catch { }
            try { _readStream?.Dispose(); } catch { }
            try { _ptyInputRead?.Dispose(); } catch { }
            try { _ptyOutputWrite?.Dispose(); } catch { }

            try
            {
                if (_procInfo.hProcess != IntPtr.Zero)
                {
                    // Ensure the tree is gone even if it ignored console close.
                    try { TerminateProcess(_procInfo.hProcess, 0); } catch { }
                    CloseHandle(_procInfo.hProcess);
                }
                if (_procInfo.hThread != IntPtr.Zero) CloseHandle(_procInfo.hThread);
            }
            catch { }
            _procInfo = default;

            try
            {
                if (_attrList != IntPtr.Zero)
                {
                    DeleteProcThreadAttributeList(_attrList);
                    Marshal.FreeHGlobal(_attrList);
                }
            }
            catch { }
            _attrList = IntPtr.Zero;
        }

        private static STARTUPINFOEX BuildStartupInfoWithPseudoConsole(IntPtr hPC, out IntPtr attrList)
        {
            var si = new STARTUPINFOEX();
            si.StartupInfo.cb = Marshal.SizeOf<STARTUPINFOEX>();

            // Query required size, allocate, initialize.
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            attrList = Marshal.AllocHGlobal(size);
            si.lpAttributeList = attrList;

            if (!InitializeProcThreadAttributeList(attrList, 1, 0, ref size))
                throw new InvalidOperationException($"InitializeProcThreadAttributeList failed: {Marshal.GetLastWin32Error()}");

            if (!UpdateProcThreadAttribute(
                    attrList,
                    0,
                    (IntPtr)PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                    hPC,
                    (IntPtr)IntPtr.Size,
                    IntPtr.Zero,
                    IntPtr.Zero))
                throw new InvalidOperationException($"UpdateProcThreadAttribute failed: {Marshal.GetLastWin32Error()}");

            return si;
        }

        // ────────────────────────────── native interop ──────────────────────────────

        [StructLayout(LayoutKind.Sequential)]
        private struct COORD { public short X; public short Y; }

        [StructLayout(LayoutKind.Sequential)]
        private struct STARTUPINFO
        {
            public int cb;
            public IntPtr lpReserved;
            public IntPtr lpDesktop;
            public IntPtr lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
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
            public int dwProcessId;
            public int dwThreadId;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CreatePipe(out SafeFileHandle hReadPipe, out SafeFileHandle hWritePipe, IntPtr lpPipeAttributes, int nSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern int CreatePseudoConsole(COORD size, SafeFileHandle hInput, SafeFileHandle hOutput, uint dwFlags, out IntPtr phPC);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern int ResizePseudoConsole(IntPtr hPC, COORD size);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern void ClosePseudoConsole(IntPtr hPC);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CreateProcess(
            string? lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string? lpCurrentDirectory,
            ref STARTUPINFOEX lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);
    }
}
