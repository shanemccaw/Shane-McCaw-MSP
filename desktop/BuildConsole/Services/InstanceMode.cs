using System;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3069 (Feature #1789) — multi-instance BuildConsole. Shane wants a SECOND,
    /// separately-compiled BuildConsole instance pointed at a genuinely different GitHub
    /// repo (a personal/vanity app) running in real parallel alongside the MSP instance.
    ///
    /// This class owns parsing the real <c>--instance &lt;name&gt;</c> launch argument, ONCE,
    /// at the very top of <c>App.OnStartup</c> — before the single-instance mutex is created
    /// and before <see cref="BuildConsoleSettings"/> ever touches disk. Every consumer that
    /// needs per-instance identity (the mutex name in App.xaml.cs, the %AppData% settings
    /// folder in BuildConsoleSettings.cs) reads <see cref="InstanceName"/> through here
    /// rather than re-parsing argv itself.
    ///
    /// Accepted forms (case-insensitive; a leading <c>/</c>, single <c>-</c> or <c>--</c> all
    /// count, matching the existing <see cref="AppMode"/> convention):
    /// <list type="bullet">
    ///   <item><c>--instance vanity</c> — the name is the next argument.</item>
    ///   <item><c>--instance=vanity</c> — the name is inline after <c>=</c>.</item>
    /// </list>
    ///
    /// Omitting <c>--instance</c> entirely leaves <see cref="InstanceName"/> empty, and every
    /// consumer treats empty as "no suffix at all" — today's exact default mutex name and
    /// %AppData%\BuildConsole\ path, byte-for-byte unchanged. This is purely additive.
    /// </summary>
    public static class InstanceMode
    {
        /// <summary>The real --instance name, or "" when none was passed (today's default single instance).</summary>
        public static string InstanceName { get; private set; } = "";

        /// <summary>Decide the instance name from the process args. Called from <c>App.OnStartup</c>
        /// before anything else touches the single-instance mutex or BuildConsoleSettings.</summary>
        public static void Initialize(string[]? args)
        {
            InstanceName = "";
            if (args == null) return;

            for (int i = 0; i < args.Length; i++)
            {
                var raw = args[i]?.Trim();
                if (string.IsNullOrEmpty(raw)) continue;
                var flag = raw.TrimStart('/', '-');

                if (flag.StartsWith("instance=", StringComparison.OrdinalIgnoreCase))
                {
                    InstanceName = flag.Substring("instance=".Length).Trim();
                    return;
                }

                if (flag.Equals("instance", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    InstanceName = args[i + 1]?.Trim() ?? "";
                    return;
                }
            }
        }
    }
}
