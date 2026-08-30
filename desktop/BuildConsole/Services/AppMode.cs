using System;
using System.Linq;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1838 — launch mode. Set ONCE from <c>App.OnStartup</c> (before anything can
    /// construct <c>MainWindow</c>) and read everywhere a background service is armed.
    ///
    /// <para><b>Agent mode</b> makes BuildConsole a passive shell: the window opens and every
    /// read-only status panel renders, but nothing polls for work and nothing claims, launches,
    /// deploys, tests, drives Shane's authenticated browser sessions, or listens on the
    /// single-instance <c>shaneapp://</c> pipe. An agent can build it, run it, screenshot it,
    /// click a menu, and close it without ever touching Shane's real Postgres queue.</para>
    ///
    /// <para>Selection (case-insensitive; a leading <c>/</c>, single <c>-</c> or <c>--</c> all count):
    /// <list type="bullet">
    ///   <item><c>--agent</c> — the canonical flag agents always launch with.</item>
    ///   <item><c>--dev</c> — accepted synonym (Shane named both).</item>
    ///   <item><c>BUILDCONSOLE_AGENT=1</c> in the environment — a belt-and-braces fallback for
    ///   the shells/wrappers agents launch through, where an argument can be eaten. A lost flag
    ///   must never silently mean full autonomy.</item>
    /// </list>
    /// With none of these present, <see cref="IsAgent"/> stays <c>false</c> and today's behaviour
    /// is unchanged byte for byte — Shane's own no-argument launch must not shift at all.</para>
    /// </summary>
    public static class AppMode
    {
        /// <summary>True when this process was launched as a passive agent shell. Private setter —
        /// only <see cref="Initialize"/> writes it, once, at startup.</summary>
        public static bool IsAgent { get; private set; }

        /// <summary>How agent mode was selected, for the visible startup ActivityLog line
        /// (e.g. "--agent", "--dev", "BUILDCONSOLE_AGENT=1"). Empty when not in agent mode.</summary>
        public static string SelectedBy { get; private set; } = "";

        /// <summary>
        /// Decide the mode from the process args + environment. Called from
        /// <c>App.OnStartup</c> before <c>base.OnStartup</c> and before any window exists.
        /// </summary>
        public static void Initialize(string[]? args)
        {
            // Env-var fallback first: an agent's argument can be eaten by a wrapping shell,
            // so this alone must still select agent mode.
            if (string.Equals(
                    Environment.GetEnvironmentVariable("BUILDCONSOLE_AGENT")?.Trim(),
                    "1", StringComparison.Ordinal))
            {
                IsAgent = true;
                SelectedBy = "BUILDCONSOLE_AGENT=1";
                return;
            }

            if (args != null)
            {
                foreach (var raw in args)
                {
                    // Normalize any of  /agent  -agent  --agent  (and --dev variants),
                    // case-insensitively, to the bare flag name.
                    var flag = raw?.TrimStart('/', '-').Trim();
                    if (string.IsNullOrEmpty(flag)) continue;
                    if (flag.Equals("agent", StringComparison.OrdinalIgnoreCase))
                    {
                        IsAgent = true;
                        SelectedBy = "--agent";
                        return;
                    }
                    if (flag.Equals("dev", StringComparison.OrdinalIgnoreCase))
                    {
                        IsAgent = true;
                        SelectedBy = "--dev";
                        return;
                    }
                }
            }

            IsAgent = false;
            SelectedBy = "";
        }
    }
}
