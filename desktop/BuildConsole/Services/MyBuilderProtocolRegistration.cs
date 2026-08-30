using System;
using System.IO;
using Microsoft.Win32;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1914 — self-healing counterpart to scripts/setup-extension-host.ps1.
    ///
    /// That script registers the <c>mybuilder://</c> protocol under
    /// <c>HKCU:\Software\Classes\mybuilder</c> with a command string built from
    /// <c>$PSScriptRoot</c> — resolved ONCE, at the moment a human manually runs the
    /// script, and baked as a literal absolute path into the registry. If the repo's
    /// location on disk ever changes (a re-clone, a moved folder, a new machine) and
    /// nobody thinks to re-run that one-time script, the registered command still
    /// points at the old, now-wrong path — Windows resolves it to a bare, uncaptured
    /// console instead of the redirect-aware, logged launch #1638 built, exactly the
    /// "black hole" problem #1638 existed to fix.
    ///
    /// Unlike a one-time manual script run, BuildConsole itself always knows its own
    /// real, CURRENT repo root at runtime (<see cref="BuildTrackerConfig.FindRepoRoot"/>,
    /// resolved and cached once at startup — Git #1978). So instead of relying on Shane
    /// to remember to re-run the ps1, BuildConsole re-runs the equivalent registry write
    /// itself, directly in C#, every time it starts. The ps1's own header already
    /// documents this key as "safe to re-run: the registry key is overwritten
    /// idempotently" — this just does that overwrite automatically instead of manually.
    ///
    /// Deliberately mirrors setup-extension-host.ps1's command string byte-for-byte
    /// (same cmd.exe /k + powershell.exe -NoProfile -ExecutionPolicy Bypass -File
    /// wrapper) so a fresh BuildConsole startup and a manual re-run of the ps1 produce
    /// the exact same registered command — the ps1 is kept as a standalone doc/manual
    /// fallback (e.g. for a machine with no BuildConsole install yet), not removed.
    /// </summary>
    internal static class MyBuilderProtocolRegistration
    {
        private const string ProtocolKeyPath = @"Software\Classes\mybuilder";
        private const string CommandKeyPath = ProtocolKeyPath + @"\shell\open\command";

        /// <summary>
        /// Re-registers <c>mybuilder://</c> against <paramref name="repoRoot"/>'s
        /// <c>scripts\run-claude.ps1</c>. Never throws — a registration failure (e.g.
        /// group policy blocking HKCU\Software\Classes writes) must not take down
        /// startup; logged instead.
        /// </summary>
        public static void EnsureRegistered(string? repoRoot)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(repoRoot) || !Directory.Exists(repoRoot))
                {
                    ActivityLog.Log("system.core",
                        "mybuilder:// registration skipped — no resolved repo root yet.");
                    return;
                }

                var runnerPath = Path.Combine(repoRoot, "scripts", "run-claude.ps1");
                if (!File.Exists(runnerPath))
                {
                    ActivityLog.Log("system.core",
                        $"mybuilder:// registration skipped — scripts\\run-claude.ps1 not found at {runnerPath}.");
                    return;
                }

                var command = $"cmd.exe /k powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"{runnerPath}\" \"%1\"";

                // Overwrite idempotently, matching setup-extension-host.ps1's own contract.
                using (var protocolKey = Registry.CurrentUser.CreateSubKey(ProtocolKeyPath))
                {
                    protocolKey?.SetValue("", "URL:MyBuilder Protocol", RegistryValueKind.String);
                    protocolKey?.SetValue("URL Protocol", "", RegistryValueKind.String);
                }

                using (var commandKey = Registry.CurrentUser.CreateSubKey(CommandKeyPath))
                {
                    var existing = commandKey?.GetValue("") as string;
                    if (!string.Equals(existing, command, StringComparison.Ordinal))
                    {
                        commandKey?.SetValue("", command, RegistryValueKind.String);
                        ActivityLog.Log("system.core",
                            $"mybuilder:// registry command refreshed to match current repo root: {command}");
                    }
                }
            }
            catch (Exception ex)
            {
                // Never let a registration failure interrupt startup — Send to Builder
                // simply stays whatever it was before this call.
                ActivityLog.Log("system.core", $"mybuilder:// registration failed (will retry next startup): {ex.Message}");
            }
        }
    }
}
