using System;
using System.Threading;

namespace BuildConsole.Services
{
    /// <summary>
    /// Ambient marker that is set for the entire duration of a <c>shaneapp://</c> protocol
    /// invocation — i.e. any agent/automation-originated execution reaching this app over the
    /// named-pipe courier (see <see cref="ShaneAppProtocol"/> / <c>MainWindow.HandleShaneAppUriAsync</c>).
    ///
    /// It exists to STRUCTURALLY sever agent code paths from privileged remote access. Per
    /// <see cref="TargetEnvironment"/>'s own class comment — "Agent/protocol executions (shaneapp://)
    /// are hard-locked to Dev" — an agent must never be able to reach Staging/Production SSH under any
    /// UI state. <see cref="ReplitSshService"/> checks <see cref="IsAgentOrigin"/> FIRST and refuses,
    /// so no Target Environment selector value can ever unlock SSH for an agent-originated call
    /// (Git #1828).
    ///
    /// Uses <see cref="AsyncLocal{T}"/> so the flag flows across <c>await</c> boundaries and onto any
    /// continuation thread — it covers everything a handler awaits (and any work it spawns while the
    /// scope is open), not just the synchronous prologue.
    /// </summary>
    public static class ShaneAppExecutionContext
    {
        private static readonly AsyncLocal<bool> _isAgentOrigin = new();

        /// <summary>True while executing inside (or awaited from) a <c>shaneapp://</c> protocol handler.</summary>
        public static bool IsAgentOrigin => _isAgentOrigin.Value;

        /// <summary>
        /// Enter the agent-origin scope for the current async flow. Dispose to leave it (restoring the
        /// previous value so nested/re-entrant enters are safe). Set at the single <c>shaneapp://</c>
        /// dispatch choke point so every action handler runs inside it.
        /// </summary>
        public static IDisposable Enter()
        {
            var prev = _isAgentOrigin.Value;
            _isAgentOrigin.Value = true;
            return new Scope(prev);
        }

        private sealed class Scope : IDisposable
        {
            private readonly bool _prev;
            private bool _disposed;
            public Scope(bool prev) => _prev = prev;
            public void Dispose()
            {
                if (_disposed) return;
                _disposed = true;
                _isAgentOrigin.Value = _prev;
            }
        }
    }
}
