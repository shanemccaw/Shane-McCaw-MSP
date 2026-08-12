using System;
using System.Windows.Threading;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #815 — Shane: "put the startup SSE and api calls in there... so
    /// we can just look and see whats happening as its happening in the
    /// background. This should be multi-threaded so my app doesnt hang."
    /// Any thread (a background HTTP call, the poll timers, startup) can
    /// call Log() directly — it never touches WPF objects itself, just
    /// raises an event; MainWindow's own subscriber is the one that marshals
    /// onto the UI thread via Dispatcher.BeginInvoke (fire-and-forget, so
    /// the calling thread never blocks on the UI). Nothing here is a real
    /// Server-Sent-Events connection (no SSE endpoint exists on the
    /// build-tracker API today, just polling) — this just makes the polling
    /// and every request/response actually visible instead of silent.
    /// </summary>
    public static class ActivityLog
    {
        public static event Action<string>? LineLogged;
        private static Dispatcher? _uiDispatcher;

        public static void Attach(Dispatcher uiDispatcher) => _uiDispatcher = uiDispatcher;

        public static void Log(string channel, string message)
        {
            var line = $"[{DateTime.Now:HH:mm:ss.fff}] [{channel}] {message}";
            var handler = LineLogged;
            if (handler == null) return;
            if (_uiDispatcher != null && !_uiDispatcher.CheckAccess())
            {
                _uiDispatcher.BeginInvoke(handler, line);
            }
            else
            {
                handler(line);
            }
        }
    }
}
