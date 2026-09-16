using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #4416 — the one typed-phrase confirm mechanism the Command Center uses for every
    /// destructive quick action, generalized out of #4415's reset-dev-database gate so a second
    /// destructive action reuses it instead of growing a differently-shaped confirm.
    ///
    /// The shape is always the same two steps:
    ///   1. The command row's <c>RunWithResult</c> is the gate's preview (a real dry run). That is all
    ///      Enter on the main list can ever reach. A successful preview arms <see cref="ConfirmPhrase"/>.
    ///   2. Typing text shaped like <see cref="ConfirmShape"/> switches the palette into confirm mode
    ///      for this gate; Enter there calls <see cref="ExecuteAsync"/>, which re-checks the phrase
    ///      itself and consumes it (one confirmation = one real run).
    /// One gate instance per palette window, so a confirmation never carries into a later open.
    /// Each gate's <see cref="ConfirmShape"/> must not overlap another gate's.
    /// </summary>
    public interface IPaletteConfirmGate
    {
        /// <summary>Input shape that switches the palette into this gate's confirm mode (armed or not).</summary>
        Regex ConfirmShape { get; }

        /// <summary>Exact text that reaches the real run. Null until a successful preview in this palette session.</summary>
        string? ConfirmPhrase { get; }

        /// <summary>True only when a successful preview exists and <paramref name="typed"/> is the confirm phrase.</summary>
        bool Matches(string? typed);

        /// <summary>The real, destructive run. Must re-check <paramref name="typedConfirmation"/> itself.</summary>
        Task<(bool Ok, string Text)> ExecuteAsync(string typedConfirmation);

        // ── Copy the palette's confirm row / detail pane render for this gate ──────────────────
        string ToastTitle { get; }
        string ConfirmRowTitle { get; }
        string RunningSubtitle { get; }
        string ArmedSubtitle { get; }
        string LockedSubtitle { get; }
        string CompletedSubtitle(bool ok);
        string DetailTag { get; }
        /// <summary>Detail heading; <paramref name="armed"/> is false when locked.</summary>
        string DetailTitle(bool armed);
        string RunningBody { get; }
        string ArmedBody { get; }
        /// <summary>Shown when locked: either no preview yet, or the typed text isn't the armed phrase.</summary>
        string LockedBody { get; }
        string ActionLabelArmed { get; }
        string ActionLabelRunning { get; }
    }

    /// <summary>
    /// Git #4415/#4416 — a single, never-retried <c>node &lt;script&gt; [flag]</c> launch shared by the
    /// confirm gates. <see cref="SubprocessRunner"/> is deliberately not used: it re-launches a child
    /// that exits with a crash-class NTSTATUS (e.g. 0xC000013A), which is right for git/gh probes and
    /// wrong for a destructive run, and it reads output in the console code page, which mangles the
    /// scripts' UTF-8 ("§" → "┬º"). Stdin is redirected and closed so no interactive prompt can block.
    /// </summary>
    public static class PaletteScriptProcess
    {
        public static bool TryResolveScript(string scriptFileName, out string repoRoot, out string scriptPath, out string error)
        {
            repoRoot = BuildTrackerConfig.FindRepoRoot() ?? "";
            scriptPath = repoRoot.Length > 0 ? Path.Combine(repoRoot, "scripts", "db", scriptFileName) : "";
            error = "";
            if (repoRoot.Length == 0)
            {
                error = $"Repo root not found — could not locate scripts/db/{scriptFileName}.";
                return false;
            }
            if (!File.Exists(scriptPath))
            {
                error = $"Script not found at {scriptPath}.";
                return false;
            }
            return true;
        }

        /// <param name="flag">Null runs the script with no argument (the RBAC script's real run has no flag).</param>
        public static async Task<(int ExitCode, string StdOut, string StdErr, string? LaunchError)> RunOnceAsync(
            string repoRoot, string scriptPath, string? flag, TimeSpan timeout)
        {
            var psi = new ProcessStartInfo
            {
                FileName = "node",
                WorkingDirectory = repoRoot,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                StandardOutputEncoding = System.Text.Encoding.UTF8,
                StandardErrorEncoding = System.Text.Encoding.UTF8,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add(scriptPath);
            if (flag != null) psi.ArgumentList.Add(flag);

            using var proc = new Process { StartInfo = psi };
            try
            {
                if (!proc.Start()) return (-1, "", "", "node failed to start");
            }
            catch (Exception ex)
            {
                return (-1, "", "", ex.Message);
            }
            try { proc.StandardInput.Close(); } catch { }

            var outTask = proc.StandardOutput.ReadToEndAsync();
            var errTask = proc.StandardError.ReadToEndAsync();
            using var cts = new CancellationTokenSource(timeout);
            try
            {
                await proc.WaitForExitAsync(cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                try { proc.Kill(true); } catch { }
                string partialOut = await SafeRead(outTask);
                string partialErr = await SafeRead(errTask);
                return (-2, partialOut, partialErr, $"timed out after {timeout.TotalMinutes:F0} min — killed (an uncommitted transaction rolls back)");
            }
            return (proc.ExitCode, await outTask.ConfigureAwait(false), await errTask.ConfigureAwait(false), null);

            static async Task<string> SafeRead(Task<string> t)
            {
                try { return await t.ConfigureAwait(false); } catch { return ""; }
            }
        }

        public static string Combine(string? stdout, string? stderr) => $"{stdout}\n{stderr}".Trim();
    }
}
