using System;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #4415 — the Command Center's "Reset dev database" gate around the real, destructive
    /// <c>scripts/db/reset-dev-database.mjs</c> (#4393). One instance per open palette window, so a
    /// confirmation earned in one palette session never carries over into the next.
    ///
    /// The gate has exactly two real steps, and nothing else can reach the second:
    ///   1. <see cref="PreviewAsync"/> — runs the script with <c>--dry-run</c> (its own
    ///      BEGIN...ROLLBACK; changes nothing, takes no backup). This is all a single Enter on the
    ///      main command list can ever do.
    ///   2. <see cref="ExecuteAsync"/> — runs the script with <c>--yes</c> (backup, then the real
    ///      reset). Refuses unless a preview in THIS palette session exited 0 and the person has
    ///      typed <see cref="ConfirmPhrase"/> exactly — a phrase that carries the real,
    ///      live-derived target MSP id the preview just printed, so it can't be typed without
    ///      reading the preview first. Each real run consumes the confirmation; a second reset
    ///      needs a fresh preview.
    ///
    /// No MessageBox confirm is reused here even though that is the app's usual destructive-action
    /// pattern (e.g. BuildQueuePanel "Remove Entire Set", DispatchPanel force re-dispatch): a WPF
    /// YesNo MessageBox focuses Yes by default, so a stray Enter confirms it, and opening it
    /// deactivates the palette window, which closes itself on deactivation — the result could
    /// never render in the palette's own pane. The typed phrase is the script's own confirmation
    /// model (it prompts "Type yes to proceed") moved into the palette's input box.
    /// </summary>
    public sealed class DevDatabaseResetGate : IPaletteConfirmGate
    {
        /// <summary>The script prints exactly this for the live-derived target MSP (reset-dev-database.mjs main()).</summary>
        private static readonly Regex TargetMspLine =
            new(@"^Target MSP \(live-derived, is_direct_business=true\): #(?<id>\d+) ""(?<name>.*)""\s*$", RegexOptions.Multiline);

        /// <summary>The script's own final line for a successful --dry-run.</summary>
        private const string DryRunOkMarker = "--dry-run requested: stopping here. No data was changed.";

        /// <summary>The script prints <c>Backup: &lt;file&gt;</c> at the end of a real run, and
        /// <c>Taking backup: &lt;file&gt;</c> before it touches any data.</summary>
        private static readonly Regex BackupLine = new(@"^(?:Taking backup|Backup): (?<path>.+?)\s*$", RegexOptions.Multiline);
        private static readonly Regex BackupVerifiedLine = new(@"^Backup verified: .+$", RegexOptions.Multiline);

        private static readonly TimeSpan PreviewTimeout = TimeSpan.FromMinutes(5);
        /// <summary>pg_dump of the whole dev database plus the reset transaction — generous on purpose;
        /// killing it mid-run only rolls back the uncommitted transaction, but there is no reason to risk it.</summary>
        private static readonly TimeSpan ExecuteTimeout = TimeSpan.FromMinutes(20);

        private int _running; // 0/1, Interlocked

        /// <summary>Set only by a preview that exited 0 and printed the script's own dry-run success line.</summary>
        public int? PreviewedMspId { get; private set; }
        public string? PreviewedMspName { get; private set; }

        /// <summary>The exact text that must be typed into the palette input to reach the real reset.
        /// Null until a successful preview in this palette session.</summary>
        public string? ConfirmPhrase => PreviewedMspId is int id ? $"reset msp #{id}" : null;

        public bool IsRunning => Volatile.Read(ref _running) == 1;

        /// <summary>Typed text of this shape switches the palette into this gate's confirm mode.</summary>
        public Regex ConfirmShape { get; } = new(@"^\s*reset\s+msp\s+#\d+\s*$", RegexOptions.IgnoreCase);

        // ── Palette confirm-mode copy (IPaletteConfirmGate, Git #4416 — moved here verbatim from the window) ──
        public string ToastTitle => "Reset dev database";
        public string ConfirmRowTitle => "Confirm & Reset Dev Database For Real";
        public string RunningSubtitle => "Backing up, then resetting for real…";
        public string ArmedSubtitle => "Confirmed phrase — Enter runs the REAL reset (backup first)";
        public string LockedSubtitle => "Locked — no matching successful preview in this palette session";
        public string CompletedSubtitle(bool ok) =>
            ok ? "Real reset completed — backup location in the right pane" : "Real reset failed — see the right pane";
        public string DetailTag => "DESTRUCTIVE — REAL RESET";
        public string DetailTitle(bool armed) =>
            PreviewedMspId is int id && armed ? $"Reset msp #{id} \"{PreviewedMspName}\"" : "Reset dev database";
        public string RunningBody =>
            "Running node scripts/db/reset-dev-database.mjs --yes — it re-runs its own dry run, takes a "
            + "pg_dump backup, then commits the reset. The real output (including the backup file) shows here when it finishes.";
        public string ArmedBody =>
            "Enter (or the button below) runs node scripts/db/reset-dev-database.mjs --yes for real: its "
            + "tenants/customers and their downstream data are deleted after a fresh pg_dump backup. "
            + "MSP-staff logins, MSP config and every other MSP are left alone. This confirmation is used up "
            + "by one run — another reset needs a new preview.";
        public string LockedBody => ConfirmPhrase is string phrase
            ? $"That isn't the confirm phrase for the preview you ran. The phrase is: {phrase}"
            : "The real reset is locked. Clear the input, select \"Reset dev database\" and press Enter to run "
              + "the dry-run preview first — it prints the exact phrase to type here.";
        public string ActionLabelArmed => "Confirm & Reset For Real  ↵";
        public string ActionLabelRunning => "Resetting…";

        /// <summary>True only when a successful preview exists and <paramref name="typed"/> is exactly
        /// the confirm phrase (surrounding whitespace ignored, case-insensitive).</summary>
        public bool Matches(string? typed)
        {
            string? phrase = ConfirmPhrase;
            return phrase != null
                && string.Equals((typed ?? "").Trim(), phrase, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Step 1 — real <c>--dry-run</c>. Returns the real script output for the palette's
        /// right pane, headed by what (if anything) the person can do next.</summary>
        public async Task<string> PreviewAsync()
        {
            if (Interlocked.Exchange(ref _running, 1) == 1)
                return "A reset preview or real reset is already running in this palette — wait for it to finish.";
            try
            {
                PreviewedMspId = null;
                PreviewedMspName = null;

                if (!PaletteScriptProcess.TryResolveScript("reset-dev-database.mjs", out var repoRoot, out var scriptPath, out var error))
                    return error;

                var (exitCode, stdout, stderr, launchError) =
                    await PaletteScriptProcess.RunOnceAsync(repoRoot, scriptPath, "--dry-run", PreviewTimeout);
                bool ok = launchError == null && exitCode == 0;

                string output = PaletteScriptProcess.Combine(stdout, stderr);
                var target = TargetMspLine.Match(stdout);

                if (ok && target.Success && output.Contains(DryRunOkMarker))
                {
                    PreviewedMspId = int.Parse(target.Groups["id"].Value);
                    PreviewedMspName = target.Groups["name"].Value;
                    ActivityLog.Log("command-palette.dev-reset", $"Preview (dry run) succeeded for msp #{PreviewedMspId} — confirm phrase armed for this palette session.");
                    return $"DRY RUN ONLY — nothing was changed and no backup was taken.\n\n"
                         + $"To run the REAL reset of msp #{PreviewedMspId} \"{PreviewedMspName}\", type\n\n"
                         + $"    {ConfirmPhrase}\n\n"
                         + "into the search box and press Enter. Pressing Enter on this row again only re-runs the preview.\n\n"
                         + "──── real script output (node scripts/db/reset-dev-database.mjs --dry-run) ────\n"
                         + output;
                }

                string why = launchError != null
                    ? $"could not run node: {launchError}"
                    : !ok
                        ? $"script exited {exitCode}"
                        : "script output did not include the target MSP / dry-run success lines";
                ActivityLog.Log("command-palette.dev-reset", $"Preview (dry run) did not succeed — {why}. Real reset stays locked.");
                return $"✗ Preview failed ({why}). The real reset stays locked until a preview succeeds.\n\n"
                     + (output.Length > 0 ? output : "(no output)");
            }
            finally
            {
                Volatile.Write(ref _running, 0);
            }
        }

        /// <summary>Step 2 — the real reset (<c>--yes</c>). <paramref name="typedConfirmation"/> is
        /// re-checked here, not just by the caller, so no code path reaches the script without it.</summary>
        public async Task<(bool Ok, string Text)> ExecuteAsync(string typedConfirmation)
        {
            if (!Matches(typedConfirmation))
                return (false, "Real reset refused: no successful preview in this palette session, or the confirmation phrase doesn't match.");
            if (Interlocked.Exchange(ref _running, 1) == 1)
                return (false, "A reset preview or real reset is already running in this palette — wait for it to finish.");

            int mspId = PreviewedMspId!.Value;
            // Consume the confirmation before the process starts: one typed phrase = one real run.
            PreviewedMspId = null;
            PreviewedMspName = null;
            try
            {
                if (!PaletteScriptProcess.TryResolveScript("reset-dev-database.mjs", out var repoRoot, out var scriptPath, out var error))
                    return (false, error);

                ActivityLog.Log("command-palette.dev-reset", $"REAL reset confirmed by typed phrase for msp #{mspId} — running reset-dev-database.mjs --yes.");
                var (exitCode, stdout, stderr, launchError) =
                    await PaletteScriptProcess.RunOnceAsync(repoRoot, scriptPath, "--yes", ExecuteTimeout);

                string output = PaletteScriptProcess.Combine(stdout, stderr);
                string? backupPath = BackupLine.Matches(output).Select(m => m.Groups["path"].Value).LastOrDefault();
                string? backupVerified = BackupVerifiedLine.Match(output) is { Success: true } v ? v.Value.Trim() : null;
                bool ok = launchError == null && exitCode == 0;

                ActivityLog.Log("command-palette.dev-reset",
                    $"REAL reset for msp #{mspId} finished — {(ok ? "exit 0" : launchError ?? $"exit {exitCode}")}; backup: {backupPath ?? "(none reported)"}.");

                string header = ok ? "✓ REAL RESET COMPLETED" : $"✗ REAL RESET FAILED ({launchError ?? $"exit {exitCode}"})";
                string backupText = backupPath != null
                    ? $"Backup: {backupPath}" + (backupVerified != null ? $"\n{backupVerified}" : "")
                    : "Backup: none reported — the script did not reach its backup step, so it changed nothing after it.";

                return (ok, $"{header}\n\n{backupText}\n\n"
                          + "──── real script output (node scripts/db/reset-dev-database.mjs --yes) ────\n"
                          + (output.Length > 0 ? output : "(no output)"));
            }
            finally
            {
                Volatile.Write(ref _running, 0);
            }
        }
    }
}
