using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #4417 — the Command Center's "Clean Dev Database" chain: the three real <c>scripts/db</c> scripts
    /// #4414/#4415/#4416 each wired separately, run in order behind ONE typed-phrase confirmation.
    ///   1. <c>find-tenant-scoped-tables.mjs</c> — informational; always runs, output shown, never blocks.
    ///   2. <c>reset-dev-database.mjs --yes</c> — the real reset. FAIL-STOP: if it fails, step 3 never runs.
    ///   3. <c>reset-rbac-test-accounts.mjs</c> — recreate the test-account ladder (and its settings.json pairs).
    ///
    /// Not a second implementation of anything: steps 2 and 3 run through this gate's OWN private
    /// <see cref="DevDatabaseResetGate"/> and <see cref="RbacTestAccountsResetGate"/> instances (their previews,
    /// their real runs, their output parsing, the RBAC settings.json write + re-read), and step 1 through the same
    /// <see cref="PaletteScriptProcess"/> runner. Private instances, so a chain preview never arms the palette's
    /// standalone <c>reset msp #N</c> / <c>reset rbac #N</c> phrases.
    ///
    /// Same two-step discipline as #4415/#4416: Enter on the row only ever previews (step 1 for real, steps 2 and 3
    /// as dry runs); the real chain needs the separately typed <c>clean dev db #&lt;live msp id&gt;</c>, consumed by
    /// one run.
    ///
    /// Tenant admin consent (Shane, on #4416/#4417): step 3's tenant-scoped rungs need the live mccawsoft2 tenants
    /// row that only a manual, browser-based admin consent creates (#4318). Before step 3 the chain re-runs step 3's
    /// dry run against the just-reset database; when the script reports no such row, the chain stops there and says
    /// so, instead of recreating a half ladder.
    /// </summary>
    public sealed class CleanDevDatabaseChainGate : IPaletteProgressGate
    {
        private const string TenantScanScript = "find-tenant-scoped-tables.mjs";
        private static readonly TimeSpan TenantScanTimeout = TimeSpan.FromMinutes(5);

        /// <summary>Both sub-gate previews end their "how to confirm" header with exactly this sentence. Inside the
        /// chain those standalone phrases don't apply, so everything up to it is dropped from the chain's pane.</summary>
        private const string StandaloneConfirmHeaderEnd = "Pressing Enter on this row again only re-runs the preview.";

        private readonly DevDatabaseResetGate _devGate = new();
        private readonly RbacTestAccountsResetGate _rbacGate = new();
        private int _running; // 0/1, Interlocked

        /// <summary>Set only by a preview in which BOTH dry runs succeeded for the same live MSP.</summary>
        public int? PreviewedMspId { get; private set; }
        public string? PreviewedMspName { get; private set; }

        public string? ConfirmPhrase => PreviewedMspId is int id ? $"clean dev db #{id}" : null;

        public bool IsRunning => Volatile.Read(ref _running) == 1;

        public Regex ConfirmShape { get; } = new(@"^\s*clean\s+dev\s+db\s+#\d+\s*$", RegexOptions.IgnoreCase);

        public bool Matches(string? typed)
        {
            string? phrase = ConfirmPhrase;
            return phrase != null
                && string.Equals((typed ?? "").Trim(), phrase, StringComparison.OrdinalIgnoreCase);
        }

        // ── Palette confirm-mode copy ───────────────────────────────────────────────────────────
        public string ToastTitle => "Clean Dev Database";
        public string ConfirmRowTitle => "Confirm & Run Clean Dev Database Chain For Real";
        public string RunningSubtitle => "Running the chain — live step progress in the right pane…";
        public string ArmedSubtitle => "Confirmed phrase — Enter runs the REAL chain: scan, reset (backup first), recreate test accounts";
        public string LockedSubtitle => "Locked — no matching successful chain preview in this palette session";
        public string CompletedSubtitle(bool ok) =>
            ok ? "Chain completed — all three steps in the right pane" : "Chain stopped or failed — the right pane says which step and why";
        public string DetailTag => "DESTRUCTIVE — REAL 3-STEP CHAIN";
        public string DetailTitle(bool armed) =>
            PreviewedMspId is int id && armed ? $"Clean Dev Database — msp #{id} \"{PreviewedMspName}\"" : "Clean Dev Database";
        public string RunningBody => "Running the Clean Dev Database chain…";
        public string ArmedBody =>
            "Enter (or the button below) runs the real chain, in order: (1) node scripts/db/find-tenant-scoped-tables.mjs "
            + "(informational, never blocks); (2) node scripts/db/reset-dev-database.mjs --yes — pg_dump backup, then the "
            + "real reset; if it fails the chain stops and step 3 never runs; (3) node scripts/db/reset-rbac-test-accounts.mjs "
            + "— wipes/recreates the shanemccaw+<role>@outlook.com accounts and writes their new passwords into settings.json. "
            + "Before step 3 the chain checks, against the just-reset database, for the live mccawsoft2 tenants row that only "
            + "a manual tenant admin consent creates (#4318); without it the chain stops before step 3. This confirmation is "
            + "used up by one run — another chain needs a new preview.";
        public string LockedBody => ConfirmPhrase is string phrase
            ? $"That isn't the confirm phrase for the chain preview you ran. The phrase is: {phrase}"
            : "The real Clean Dev Database chain is locked. Clear the input, select \"Clean Dev Database\" and press Enter "
              + "to run the preview first — it prints the exact phrase to type here.";
        public string ActionLabelArmed => "Confirm & Run Chain For Real  ↵";
        public string ActionLabelRunning => "Running chain…";

        // ── Step transcript ─────────────────────────────────────────────────────────────────────

        private enum StepState { Waiting, Running, Done, Failed, NotRun }

        private sealed class Step
        {
            public required string Command { get; init; }
            public StepState State { get; set; } = StepState.Waiting;
            public string Note { get; set; } = "";
            public string Output { get; set; } = "";
        }

        private sealed class Transcript
        {
            private readonly string _title;
            private readonly IProgress<string>? _progress;
            public readonly Step[] Steps;
            public string Header { get; set; } = "";
            public string Footer { get; set; } = "";

            public Transcript(string title, IProgress<string>? progress, params string[] commands)
            {
                _title = title;
                _progress = progress;
                Steps = Array.ConvertAll(commands, c => new Step { Command = c });
            }

            public void Set(int index, StepState state, string note = "", string? output = null)
            {
                Steps[index].State = state;
                Steps[index].Note = note;
                if (output != null) Steps[index].Output = output;
                _progress?.Report(Render());
            }

            public string Render()
            {
                var sb = new StringBuilder();
                if (Header.Length > 0) sb.Append(Header).Append("\n\n");
                sb.Append(_title).Append('\n');
                for (int i = 0; i < Steps.Length; i++)
                {
                    var s = Steps[i];
                    string mark = s.State switch
                    {
                        StepState.Running => "▶ RUNNING ",
                        StepState.Done => "✓ DONE    ",
                        StepState.Failed => "✗ FAILED  ",
                        StepState.NotRun => "■ NOT RUN ",
                        _ => "· waiting ",
                    };
                    sb.Append($"  Step {i + 1} of {Steps.Length}  {mark} {s.Command}");
                    if (s.Note.Length > 0) sb.Append(" — ").Append(s.Note);
                    sb.Append('\n');
                }
                if (Footer.Length > 0) sb.Append('\n').Append(Footer).Append('\n');
                for (int i = 0; i < Steps.Length; i++)
                {
                    if (Steps[i].Output.Length == 0) continue;
                    sb.Append($"\n════ Step {i + 1} of {Steps.Length}: {Steps[i].Command} ════\n");
                    sb.Append(Steps[i].Output.TrimEnd()).Append('\n');
                }
                // Git #4436 — the chain pane embeds the reset gate's own text; redact the whole render too.
                return PaletteScriptProcess.RedactConnectionSecrets(sb.ToString().TrimEnd());
            }
        }

        private static string WithoutStandaloneConfirmHeader(string subGatePreview)
        {
            int at = subGatePreview.IndexOf(StandaloneConfirmHeaderEnd, StringComparison.Ordinal);
            return at < 0 ? subGatePreview : subGatePreview.Substring(at + StandaloneConfirmHeaderEnd.Length).TrimStart();
        }

        /// <summary>Step 1 — the read-only FK scan. Its outcome is reported, never gated on.</summary>
        private static async Task<(bool Ok, string Note, string Output)> RunTenantScanAsync()
        {
            if (!PaletteScriptProcess.TryResolveScript(TenantScanScript, out var repoRoot, out var scriptPath, out var error))
                return (false, "could not start (informational — the chain continues)", error);
            var (exitCode, stdout, stderr, launchError) =
                await PaletteScriptProcess.RunOnceAsync(repoRoot, scriptPath, null, TenantScanTimeout);
            string output = PaletteScriptProcess.Combine(stdout, stderr);
            bool ok = launchError == null && exitCode == 0;
            string note = ok
                ? "exit 0 (informational)"
                : $"{launchError ?? $"exit {exitCode}"} (informational — the chain continues)";
            return (ok, note, output.Length > 0 ? output : "(no output)");
        }

        private string ConsentNote(int mspId)
        {
            return _rbacGate.PreviewedTenantRowPresent switch
            {
                true when _rbacGate.PreviewedTenantMspId == mspId =>
                    $"Tenant admin consent: a live mccawsoft2 tenants row exists right now, but it belongs to msp #{mspId} — "
                    + "step 2 deletes it. After the real reset, step 3 will find no consented tenant, so the real chain will "
                    + "STOP before step 3. Then grant tenant admin consent manually (#4318) and run \"Reset RBAC test accounts\" "
                    + "on its own — not this chain again, which would delete the consented tenant row a second time.",
                true =>
                    $"Tenant admin consent: a live mccawsoft2 tenants row exists and belongs to msp #{_rbacGate.PreviewedTenantMspId}, "
                    + $"not msp #{mspId}, so step 2 leaves it alone. The chain still re-checks for it after the reset, before step 3.",
                false =>
                    "Tenant admin consent: there is NO live mccawsoft2 tenants row right now (#4318), so the real chain will "
                    + "STOP before step 3. Grant tenant admin consent manually first, then run \"Reset RBAC test accounts\" on "
                    + "its own afterwards.",
                _ =>
                    "Tenant admin consent: the step 3 dry run didn't report whether a live mccawsoft2 tenants row exists. The "
                    + "real chain re-checks for it after the reset, before step 3, and stops if it's missing.",
            };
        }

        /// <summary>The row's Enter: step 1 for real, steps 2 and 3 as dry runs, each shown as it finishes.</summary>
        public Task<string> PreviewAsync() => PreviewAsync(null);

        public async Task<string> PreviewAsync(IProgress<string>? progress)
        {
            if (Interlocked.Exchange(ref _running, 1) == 1)
                return "A Clean Dev Database preview or real chain is already running in this palette — wait for it to finish.";
            try
            {
                PreviewedMspId = null;
                PreviewedMspName = null;

                var t = new Transcript("CHAIN PREVIEW — DRY RUN (nothing is changed, no backup is taken):", progress,
                    "node scripts/db/find-tenant-scoped-tables.mjs",
                    "node scripts/db/reset-dev-database.mjs --dry-run",
                    "node scripts/db/reset-rbac-test-accounts.mjs --dry-run");
                t.Header = "Running the Clean Dev Database preview…";

                t.Set(0, StepState.Running);
                var scan = await RunTenantScanAsync();
                t.Set(0, scan.Ok ? StepState.Done : StepState.Failed, scan.Note, scan.Output);

                t.Set(1, StepState.Running);
                string devPreview = await _devGate.PreviewAsync();
                bool devArmed = _devGate.PreviewedMspId != null;
                t.Set(1, devArmed ? StepState.Done : StepState.Failed,
                    devArmed ? $"dry run OK for msp #{_devGate.PreviewedMspId}" : "dry run did not succeed",
                    WithoutStandaloneConfirmHeader(devPreview));

                t.Set(2, StepState.Running);
                string rbacPreview = await _rbacGate.PreviewAsync();
                bool rbacArmed = _rbacGate.PreviewedMspId != null;
                t.Set(2, rbacArmed ? StepState.Done : StepState.Failed,
                    rbacArmed ? $"dry run OK for msp #{_rbacGate.PreviewedMspId} (against the database as it is NOW, before any reset)" : "dry run did not succeed",
                    WithoutStandaloneConfirmHeader(rbacPreview));

                if (devArmed && rbacArmed && _devGate.PreviewedMspId is int armedId && armedId == _rbacGate.PreviewedMspId)
                {
                    PreviewedMspId = armedId;
                    PreviewedMspName = _devGate.PreviewedMspName;
                    ActivityLog.Log("command-palette.clean-dev-db", $"Chain preview succeeded for msp #{armedId} — confirm phrase armed for this palette session.");
                    t.Header = "DRY RUN ONLY — nothing was changed, no backup was taken, settings.json was not touched.\n\n"
                             + $"To run the REAL chain against msp #{armedId} \"{PreviewedMspName}\", type\n\n"
                             + $"    {ConfirmPhrase}\n\n"
                             + "into the search box and press Enter. Pressing Enter on this row again only re-runs the preview.";
                    t.Footer = ConsentNote(armedId) + "\n\n"
                             + "Real chain order: step 1 → step 2 (--yes; if it fails, the chain stops and step 3 never runs) → "
                             + "consent re-check → step 3 (real run, new passwords written to settings.json).";
                    return t.Render();
                }

                string why = !devArmed
                    ? "the reset-dev-database dry run did not succeed"
                    : !rbacArmed
                        ? "the reset-rbac-test-accounts dry run did not succeed"
                        : $"the two dry runs resolved different MSPs (#{_devGate.PreviewedMspId} vs #{_rbacGate.PreviewedMspId})";
                ActivityLog.Log("command-palette.clean-dev-db", $"Chain preview did not succeed — {why}. Real chain stays locked.");
                t.Header = $"✗ Chain preview failed ({why}). The real chain stays locked until a preview succeeds.";
                return t.Render();
            }
            finally
            {
                Volatile.Write(ref _running, 0);
            }
        }

        public Task<(bool Ok, string Text)> ExecuteAsync(string typedConfirmation) =>
            ExecuteAsync(typedConfirmation, new Progress<string>(_ => { }));

        /// <summary>The real chain. <paramref name="typedConfirmation"/> is re-checked here, not just by the caller.</summary>
        public async Task<(bool Ok, string Text)> ExecuteAsync(string typedConfirmation, IProgress<string> progress)
        {
            if (!Matches(typedConfirmation))
                return (false, "Real Clean Dev Database chain refused: no successful chain preview in this palette session, or the confirmation phrase doesn't match.");
            if (Interlocked.Exchange(ref _running, 1) == 1)
                return (false, "A Clean Dev Database preview or real chain is already running in this palette — wait for it to finish.");

            int mspId = PreviewedMspId!.Value;
            string devPhrase = _devGate.ConfirmPhrase!;
            // Consume the confirmation before anything starts: one typed phrase = one real chain.
            PreviewedMspId = null;
            PreviewedMspName = null;
            try
            {
                ActivityLog.Log("command-palette.clean-dev-db", $"REAL chain confirmed by typed phrase for msp #{mspId}.");
                var t = new Transcript($"REAL CHAIN — msp #{mspId}:", progress,
                    "node scripts/db/find-tenant-scoped-tables.mjs",
                    "node scripts/db/reset-dev-database.mjs --yes",
                    "node scripts/db/reset-rbac-test-accounts.mjs");
                t.Header = "Running the Clean Dev Database chain for real…";

                // Step 1 — informational only.
                t.Set(0, StepState.Running);
                var scan = await RunTenantScanAsync();
                t.Set(0, scan.Ok ? StepState.Done : StepState.Failed, scan.Note, scan.Output);

                // Step 2 — the real reset, through the #4415 gate. Fail-stop.
                t.Set(1, StepState.Running, "pg_dump backup, then the real reset");
                var reset = await _devGate.ExecuteAsync(devPhrase);
                if (!reset.Ok)
                {
                    t.Set(1, StepState.Failed, "see its output below", reset.Text);
                    t.Header = "✗ CHAIN STOPPED AT STEP 2 — reset-dev-database.mjs --yes failed, so step 3 did not run";
                    t.Set(2, StepState.NotRun, "skipped: step 2 failed — never recreate test accounts on a database that didn't reset cleanly");
                    ActivityLog.Log("command-palette.clean-dev-db", $"REAL chain for msp #{mspId} stopped at step 2 (reset failed); step 3 not run.");
                    return (false, t.Render());
                }
                t.Set(1, StepState.Done, "real reset completed", reset.Text);

                // Consent check — a fresh step 3 dry run against the just-reset database.
                t.Set(2, StepState.Running, "checking for a consented tenant (step 3 dry run against the reset database)");
                string recheck = await _rbacGate.PreviewAsync();
                string? rbacPhrase = _rbacGate.ConfirmPhrase;
                if (rbacPhrase == null || _rbacGate.PreviewedMspId != mspId)
                {
                    t.Set(2, StepState.NotRun,
                        rbacPhrase == null ? "skipped: its dry run did not succeed after the reset" : $"skipped: its dry run resolved msp #{_rbacGate.PreviewedMspId}, not #{mspId}",
                        WithoutStandaloneConfirmHeader(recheck));
                    t.Header = "✗ CHAIN STOPPED BEFORE STEP 3 — the database WAS reset (step 2 completed); test accounts were not recreated";
                    ActivityLog.Log("command-palette.clean-dev-db", $"REAL chain for msp #{mspId}: reset done; step 3 not run — its post-reset dry run did not succeed.");
                    return (false, t.Render());
                }
                if (_rbacGate.PreviewedTenantRowPresent != true)
                {
                    t.Set(2, StepState.NotRun,
                        "skipped: no live mccawsoft2 tenants row — tenant admin consent has not been granted (#4318)",
                        WithoutStandaloneConfirmHeader(recheck));
                    t.Header = "■ CHAIN STOPPED BEFORE STEP 3 — tenant admin consent needed. The database WAS reset (step 2 completed).";
                    t.Footer = "Step 3 (reset-rbac-test-accounts.mjs) did not run: after the reset there is no live mccawsoft2 tenants "
                             + "row, which only a manual, browser-based tenant admin consent creates (#4318). Grant that consent "
                             + "first, then run \"Reset RBAC test accounts\" from this palette on its own (preview, then its typed "
                             + "phrase). Don't re-run this chain for it — step 2 would delete the consented tenant row again. "
                             + "The test-account passwords in settings.json were not touched.";
                    ActivityLog.Log("command-palette.clean-dev-db", $"REAL chain for msp #{mspId}: reset done; stopped before step 3 — no live mccawsoft2 tenants row (consent needed).");
                    return (false, t.Render());
                }

                // Step 3 — the real account wipe/recreate + settings.json write, through the #4416 gate.
                t.Set(2, StepState.Running, "consented tenant present — wiping/recreating accounts, then writing settings.json");
                var accounts = await _rbacGate.ExecuteAsync(rbacPhrase);
                t.Set(2, accounts.Ok ? StepState.Done : StepState.Failed,
                    accounts.Ok ? "accounts recreated, settings.json verified" : "see its output below", accounts.Text);
                t.Header = accounts.Ok
                    ? "✓ CLEAN DEV DATABASE CHAIN COMPLETED — all three steps"
                    : "✗ CHAIN FAILED AT STEP 3 — the database WAS reset (step 2 completed); see step 3 below";
                ActivityLog.Log("command-palette.clean-dev-db", $"REAL chain for msp #{mspId} finished — step 3 {(accounts.Ok ? "completed" : "failed")}.");
                return (accounts.Ok, t.Render());
            }
            finally
            {
                Volatile.Write(ref _running, 0);
            }
        }
    }
}
