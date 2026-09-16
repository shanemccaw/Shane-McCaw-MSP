using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #4416 — the Command Center's "Reset RBAC test accounts" gate around the real, destructive
    /// <c>scripts/db/reset-rbac-test-accounts.mjs</c> (#4396). Same two-step typed-phrase confirm as
    /// #4415's <see cref="DevDatabaseResetGate"/> (shared through <see cref="IPaletteConfirmGate"/>):
    ///   1. <see cref="PreviewAsync"/> — <c>--dry-run</c> (BEGIN...ROLLBACK). The only thing Enter on
    ///      the command row reaches. Arms <c>reset rbac #&lt;live msp id&gt;</c> on success.
    ///   2. <see cref="ExecuteAsync"/> — the script with no flag (its real run has no prompt and no
    ///      <c>--yes</c>): wipes and recreates the <c>shanemccaw+&lt;tag&gt;@outlook.com</c> accounts. The
    ///      gate then writes the new pairs into settings.json <c>TestEnvironmentVariables</c> and
    ///      re-reads the file from disk to prove every value landed.
    ///
    /// The script itself never writes settings.json (its README: plaintext is printed once "for you to
    /// paste"); that write is this gate's job. Plaintext passwords go only to settings.json and the
    /// palette's own result pane — never to ActivityLog or a toast.
    /// </summary>
    public sealed class RbacTestAccountsResetGate : IPaletteConfirmGate
    {
        private const string ScriptFileName = "reset-rbac-test-accounts.mjs";

        /// <summary>The script prints exactly this for the live-derived direct MSP.</summary>
        private static readonly Regex DirectMspLine = new(@"^\[resolve\] real direct MSP id=(?<id>\d+)\s*$", RegexOptions.Multiline);
        private const string DryRunRollbackMarker = "[dry-run] rolling back — no changes committed.";
        private const string CommitMarker = "[commit] transaction committed.";
        private const string ResultJsonMarker = "=== RESULT (JSON) ===";
        /// <summary>The script's own <c>[resolve]</c> lines for the live mccawsoft2 tenants row (Git #4417 reads them to
        /// tell whether tenant admin consent — #4318 — has produced that row yet).</summary>
        private static readonly Regex TenantRowLine = new(@"^\[resolve\] mccawsoft2 -> tenants\.id=(?<id>\d+), msp_id=(?<msp>\d+)", RegexOptions.Multiline);
        private const string NoTenantRowMarker = "[resolve] mccawsoft2 -> NO live tenants row right now";
        private static readonly Regex PasswordJsonField = new(@"(""password""\s*:\s*)""(?:[^""\\]|\\.)*""");

        private static readonly TimeSpan PreviewTimeout = TimeSpan.FromMinutes(5);
        /// <summary>17 bcrypt(cost 12) hashes + an FK sweep — seconds in practice; generous on purpose.</summary>
        private static readonly TimeSpan ExecuteTimeout = TimeSpan.FromMinutes(10);

        private int _running; // 0/1, Interlocked

        /// <summary>Set only by a preview that exited 0, printed its rollback line and a parseable result.</summary>
        public int? PreviewedMspId { get; private set; }

        /// <summary>Git #4417 — from the most recent preview's own output: true when the script resolved a live
        /// mccawsoft2 tenants row, false when it printed that none exists (tenant-scoped rungs get skipped), null when
        /// the output said neither (the preview failed before resolving).</summary>
        public bool? PreviewedTenantRowPresent { get; private set; }
        /// <summary>Git #4417 — the <c>msp_id</c> of that tenants row, when one was resolved.</summary>
        public int? PreviewedTenantMspId { get; private set; }

        public string? ConfirmPhrase => PreviewedMspId is int id ? $"reset rbac #{id}" : null;

        public bool IsRunning => Volatile.Read(ref _running) == 1;

        public Regex ConfirmShape { get; } = new(@"^\s*reset\s+rbac\s+#\d+\s*$", RegexOptions.IgnoreCase);

        public bool Matches(string? typed)
        {
            string? phrase = ConfirmPhrase;
            return phrase != null
                && string.Equals((typed ?? "").Trim(), phrase, StringComparison.OrdinalIgnoreCase);
        }

        // ── Palette confirm-mode copy ───────────────────────────────────────────────────────────
        public string ToastTitle => "Reset RBAC test accounts";
        public string ConfirmRowTitle => "Confirm & Reset RBAC Test Accounts For Real";
        public string RunningSubtitle => "Wiping and recreating accounts, then writing settings.json…";
        public string ArmedSubtitle => "Confirmed phrase — Enter wipes/recreates the accounts and rewrites their settings.json credentials";
        public string LockedSubtitle => "Locked — no matching successful preview in this palette session";
        public string CompletedSubtitle(bool ok) =>
            ok ? "Accounts recreated and settings.json verified — credentials in the right pane"
               : "Reset or settings.json write failed — see the right pane";
        public string DetailTag => "DESTRUCTIVE — REAL CREDENTIAL RESET";
        public string DetailTitle(bool armed) =>
            PreviewedMspId is int id && armed ? $"Reset RBAC test accounts for msp #{id}" : "Reset RBAC test accounts";
        public string RunningBody =>
            "Running node scripts/db/reset-rbac-test-accounts.mjs for real — it deletes the shanemccaw+<role>@outlook.com "
            + "accounts it owns and recreates them with new passwords. BuildConsole then writes the new pairs into "
            + "settings.json and re-reads the file to confirm them. The real result shows here when it finishes.";
        public string ArmedBody =>
            "Enter (or the button below) runs node scripts/db/reset-rbac-test-accounts.mjs for real: every "
            + "shanemccaw+<role>@outlook.com test account it owns is deleted and recreated with a new password, so "
            + "saved browser logins for them stop working. The new TEST_RBAC_<ROLE>_EMAIL / _PASSWORD pairs are "
            + "written into settings.json (TestEnvironmentVariables). shane@shanemccaw.com is never touched. This "
            + "confirmation is used up by one run — another reset needs a new preview.";
        public string LockedBody => ConfirmPhrase is string phrase
            ? $"That isn't the confirm phrase for the preview you ran. The phrase is: {phrase}"
            : "The real RBAC account reset is locked. Clear the input, select \"Reset RBAC test accounts\" and press "
              + "Enter to run the dry-run preview first — it prints the exact phrase to type here.";
        public string ActionLabelArmed => "Confirm & Reset Accounts For Real  ↵";
        public string ActionLabelRunning => "Resetting accounts…";

        /// <summary>Step 1 — real <c>--dry-run</c>.</summary>
        public async Task<string> PreviewAsync()
        {
            if (Interlocked.Exchange(ref _running, 1) == 1)
                return "An RBAC account preview or real reset is already running in this palette — wait for it to finish.";
            try
            {
                PreviewedMspId = null;
                PreviewedTenantRowPresent = null;
                PreviewedTenantMspId = null;

                if (!PaletteScriptProcess.TryResolveScript(ScriptFileName, out var repoRoot, out var scriptPath, out var error))
                    return error;

                var (exitCode, stdout, stderr, launchError) =
                    await PaletteScriptProcess.RunOnceAsync(repoRoot, scriptPath, "--dry-run", PreviewTimeout);
                bool ok = launchError == null && exitCode == 0;

                // The dry run's JSON carries passwords for accounts that were rolled back and never
                // existed — never show them as if they were credentials.
                string output = PasswordJsonField.Replace(PaletteScriptProcess.Combine(stdout, stderr),
                    "$1\"(dry run — rolled back, not a real credential)\"");
                var msp = DirectMspLine.Match(stdout);
                var result = TryParseResult(stdout);
                if (TenantRowLine.Match(stdout) is { Success: true } tenantRow)
                {
                    PreviewedTenantRowPresent = true;
                    PreviewedTenantMspId = int.Parse(tenantRow.Groups["msp"].Value);
                }
                else if (stdout.Contains(NoTenantRowMarker))
                {
                    PreviewedTenantRowPresent = false;
                }

                if (ok && msp.Success && stdout.Contains(DryRunRollbackMarker) && result != null)
                {
                    PreviewedMspId = int.Parse(msp.Groups["id"].Value);
                    ActivityLog.Log("command-palette.rbac-reset",
                        $"Preview (dry run) succeeded for msp #{PreviewedMspId}: {result.Deleted.Count} to delete, {result.Created.Count} to create, {result.Skipped.Count} skipped — confirm phrase armed for this palette session.");

                    var sb = new StringBuilder();
                    sb.Append("DRY RUN ONLY — no account was changed and settings.json was not touched.\n\n");
                    sb.Append($"To run the REAL reset, type\n\n    {ConfirmPhrase}\n\n");
                    sb.Append("into the search box and press Enter. Pressing Enter on this row again only re-runs the preview.\n\n");
                    sb.Append(DescribeSettingsPlan(result));
                    sb.Append("\n──── real script output (node scripts/db/reset-rbac-test-accounts.mjs --dry-run) ────\n");
                    sb.Append(output);
                    return sb.ToString();
                }

                string why = launchError != null
                    ? $"could not run node: {launchError}"
                    : !ok
                        ? $"script exited {exitCode}"
                        : "script output did not include the direct-MSP / dry-run rollback lines or a parseable result";
                ActivityLog.Log("command-palette.rbac-reset", $"Preview (dry run) did not succeed — {why}. Real reset stays locked.");
                return $"✗ Preview failed ({why}). The real RBAC account reset stays locked until a preview succeeds.\n\n"
                     + (output.Length > 0 ? output : "(no output)");
            }
            finally
            {
                Volatile.Write(ref _running, 0);
            }
        }

        /// <summary>Step 2 — the real run, then the settings.json write + on-disk verification.</summary>
        public async Task<(bool Ok, string Text)> ExecuteAsync(string typedConfirmation)
        {
            if (!Matches(typedConfirmation))
                return (false, "Real RBAC account reset refused: no successful preview in this palette session, or the confirmation phrase doesn't match.");
            if (Interlocked.Exchange(ref _running, 1) == 1)
                return (false, "An RBAC account preview or real reset is already running in this palette — wait for it to finish.");

            int mspId = PreviewedMspId!.Value;
            // Consume the confirmation before the process starts: one typed phrase = one real run.
            PreviewedMspId = null;
            try
            {
                if (!PaletteScriptProcess.TryResolveScript(ScriptFileName, out var repoRoot, out var scriptPath, out var error))
                    return (false, error);

                ActivityLog.Log("command-palette.rbac-reset", $"REAL RBAC account reset confirmed by typed phrase for msp #{mspId} — running reset-rbac-test-accounts.mjs.");
                var (exitCode, stdout, stderr, launchError) =
                    await PaletteScriptProcess.RunOnceAsync(repoRoot, scriptPath, null, ExecuteTimeout);

                string output = PaletteScriptProcess.Combine(stdout, stderr);
                bool committed = launchError == null && exitCode == 0 && stdout.Contains(CommitMarker);
                var result = TryParseResult(stdout);

                if (!committed || result == null)
                {
                    string why = launchError ?? (exitCode != 0 ? $"exit {exitCode}" : committed ? "result JSON not parseable" : "no commit line");
                    ActivityLog.Log("command-palette.rbac-reset", $"REAL RBAC account reset for msp #{mspId} did not complete cleanly — {why}. settings.json not written.");
                    string note = committed
                        ? "The script committed, but its result could not be parsed, so settings.json was NOT updated. "
                          + "The new credentials are in the output below — paste them into Settings → Test Environment by hand."
                        : "The script rolls back its whole transaction on failure, so no account should have changed. settings.json was NOT touched.";
                    return (false, $"✗ REAL RBAC ACCOUNT RESET FAILED ({why})\n\n{note}\n\n"
                                 + "──── real script output (node scripts/db/reset-rbac-test-accounts.mjs) ────\n"
                                 + (output.Length > 0 ? output : "(no output)"));
                }

                var write = WriteCredentialsToSettings(result);
                ActivityLog.Log("command-palette.rbac-reset",
                    $"REAL RBAC account reset for msp #{mspId} committed: {result.Deleted.Count} deleted, {result.Created.Count} created, {result.Skipped.Count} skipped. "
                    + $"settings.json: {write.Summary}");

                var sb = new StringBuilder();
                sb.Append(write.AllVerified
                    ? "✓ REAL RBAC ACCOUNT RESET COMPLETED — settings.json updated and verified\n\n"
                    : "✗ ACCOUNTS WERE RESET, BUT settings.json COULD NOT BE VERIFIED — the new credentials below are the only copy\n\n");
                sb.Append($"settings.json: {write.Summary}\n");
                sb.Append($"File: {BuildConsoleSettings.SettingsFilePath}\n\n");
                sb.Append("New credentials (the old passwords no longer work):\n");
                foreach (var line in write.Lines) sb.Append(line).Append('\n');
                if (write.StaleNames.Count > 0)
                {
                    sb.Append("\nLeft untouched in settings.json — their accounts were deleted and not recreated this run:\n");
                    foreach (var s in result.Skipped)
                        sb.Append($"  {s.Email} — {s.Reason}\n");
                    sb.Append($"  vars: {string.Join(", ", write.StaleNames)}\n");
                }
                sb.Append("\n──── real script output (node scripts/db/reset-rbac-test-accounts.mjs) ────\n");
                sb.Append(output);
                return (write.AllVerified, sb.ToString());
            }
            finally
            {
                Volatile.Write(ref _running, 0);
            }
        }

        // ── settings.json ──────────────────────────────────────────────────────────────────────

        /// <summary>
        /// The #3911 naming convention for these pairs: <c>TEST_RBAC_&lt;ROLE&gt;_EMAIL/_PASSWORD</c>. A ladder
        /// rung's tag is just its msp_role lower-cased, so its segment is the msp_role split on PascalCase
        /// (<c>MSPOperator</c> → <c>MSP_OPERATOR</c>); every other account (customer-admin, billing, cap.*)
        /// is named by its tag (<c>cap.team.manage</c> → <c>CAP_TEAM_MANAGE</c>).
        /// </summary>
        public static string EnvVarRoleSegment(string tag, string mspRole)
        {
            if (string.Equals(tag, mspRole, StringComparison.OrdinalIgnoreCase))
                return Regex.Replace(mspRole, @"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", "_").ToUpperInvariant();
            return Regex.Replace(tag, @"[^A-Za-z0-9]+", "_").Trim('_').ToUpperInvariant();
        }

        private static (string EmailVar, string PasswordVar) VarNames(string tag, string mspRole)
        {
            string seg = EnvVarRoleSegment(tag, mspRole);
            return ($"TEST_RBAC_{seg}_EMAIL", $"TEST_RBAC_{seg}_PASSWORD");
        }

        /// <summary>Tags the script owns but skipped this run keep their old (now dead) vars; their msp_role
        /// isn't in the skipped entry, so recover the ladder rung name from the tag for known rungs.</summary>
        private static readonly Dictionary<string, string> LadderRoleByTag = new(StringComparer.OrdinalIgnoreCase)
        {
            ["free"] = "Free", ["monitoringpending"] = "MonitoringPending", ["monitoringconsented"] = "MonitoringConsented",
            ["packpending"] = "PackPending", ["packconsented"] = "PackConsented", ["retainerpending"] = "RetainerPending",
            ["retainerconsented"] = "RetainerConsented", ["customer"] = "Customer", ["serviceaccount"] = "ServiceAccount",
            ["mspoperator"] = "MSPOperator", ["mspadmin"] = "MSPAdmin", ["platformadmin"] = "PlatformAdmin",
        };

        private static string DescribeSettingsPlan(RbacResult result)
        {
            HashSet<string> existing;
            try
            {
                existing = new HashSet<string>(BuildConsoleSettings.Load().TestEnvironmentVariables.Select(v => v.Name), StringComparer.OrdinalIgnoreCase);
            }
            catch (Exception ex)
            {
                return $"A real run would write {result.Created.Count * 2} settings.json vars (could not read settings.json to compare: {ex.Message}).\n";
            }

            var sb = new StringBuilder();
            sb.Append($"A real run would delete {result.Deleted.Count} existing test account(s), create {result.Created.Count}, and write these settings.json vars:\n");
            foreach (var c in result.Created)
            {
                var (ev, pv) = VarNames(c.Tag, c.MspRole);
                string state = existing.Contains(ev) && existing.Contains(pv) ? "update" : "add";
                sb.Append($"  {state,-6} {ev} / {pv}  ({c.Email})\n");
            }
            foreach (var s in result.Skipped)
                sb.Append($"  skip   {s.Email} — {s.Reason}\n");
            return sb.ToString();
        }

        private sealed record WriteReport(bool AllVerified, string Summary, List<string> Lines, List<string> StaleNames);

        /// <summary>Upserts every created account's pair through the sanctioned
        /// <see cref="BuildConsoleSettings.Load"/>/<see cref="BuildConsoleSettings.Save"/> round trip, then
        /// loads settings.json again from disk and compares every value — the write is only reported as done
        /// when the file genuinely holds the new credentials.</summary>
        private static WriteReport WriteCredentialsToSettings(RbacResult result)
        {
            var wanted = new List<(string Name, string Value)>();
            foreach (var c in result.Created)
            {
                var (ev, pv) = VarNames(c.Tag, c.MspRole);
                wanted.Add((ev, c.Email));
                wanted.Add((pv, c.Password));
            }

            var stale = new List<string>();
            foreach (var s in result.Skipped)
            {
                string role = LadderRoleByTag.TryGetValue(s.Tag, out var r) ? r : "";
                var (ev, pv) = VarNames(s.Tag, role);
                stale.Add(ev);
                stale.Add(pv);
            }

            int added = 0, updated = 0;
            string? saveError = null;
            try
            {
                var settings = BuildConsoleSettings.Load();
                foreach (var (name, value) in wanted)
                {
                    var existing = settings.TestEnvironmentVariables.Find(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
                    if (existing == null)
                    {
                        settings.TestEnvironmentVariables.Add(new TestEnvVar { Name = name, Value = value, NeedsReview = false });
                        added++;
                    }
                    else
                    {
                        existing.Value = value;
                        existing.NeedsReview = false;
                        updated++;
                    }
                }
                settings.Save();
            }
            catch (Exception ex)
            {
                saveError = ex.Message;
            }

            // Verify against a fresh read of the file, not the instance we just saved.
            Dictionary<string, string> onDisk;
            string? readError = null;
            try
            {
                onDisk = BuildConsoleSettings.Load().TestEnvironmentVariables
                    .GroupBy(v => v.Name, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.Last().Value, StringComparer.OrdinalIgnoreCase);
            }
            catch (Exception ex)
            {
                onDisk = new(StringComparer.OrdinalIgnoreCase);
                readError = ex.Message;
            }

            var verified = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (name, value) in wanted)
                if (onDisk.TryGetValue(name, out var v) && string.Equals(v, value, StringComparison.Ordinal))
                    verified.Add(name);

            var lines = new List<string>();
            foreach (var c in result.Created)
            {
                var (ev, pv) = VarNames(c.Tag, c.MspRole);
                bool ok = verified.Contains(ev) && verified.Contains(pv);
                lines.Add($"  {(ok ? "✓" : "✗")} {c.Email}  password: {c.Password}  → {ev} / {pv}{(ok ? "" : "  (NOT confirmed in settings.json)")}");
            }

            bool all = saveError == null && readError == null && verified.Count == wanted.Count;
            string summary = $"{verified.Count}/{wanted.Count} vars confirmed by re-reading the file ({added} added, {updated} updated)"
                           + (saveError != null ? $"; save threw: {saveError}" : "")
                           + (readError != null ? $"; re-read threw: {readError}" : "");
            var staleStillPresent = stale.Where(onDisk.ContainsKey).ToList();
            return new WriteReport(all, summary, lines, staleStillPresent);
        }

        // ── script result JSON ────────────────────────────────────────────────────────────────

        private sealed record CreatedAccount(string Tag, string Email, string Password, string MspRole);
        private sealed record SkippedAccount(string Tag, string Email, string Reason);
        private sealed record RbacResult(List<string> Deleted, List<CreatedAccount> Created, List<SkippedAccount> Skipped);

        /// <summary>Parses the object the script prints after <c>=== RESULT (JSON) ===</c>. Null when absent or malformed.</summary>
        private static RbacResult? TryParseResult(string stdout)
        {
            int at = stdout.LastIndexOf(ResultJsonMarker, StringComparison.Ordinal);
            if (at < 0) return null;
            try
            {
                using var doc = JsonDocument.Parse(stdout.Substring(at + ResultJsonMarker.Length).Trim());
                var root = doc.RootElement;
                var deleted = root.GetProperty("deleted").EnumerateArray()
                    .Select(e => e.GetProperty("email").GetString() ?? "").ToList();
                var created = root.GetProperty("created").EnumerateArray()
                    .Select(e => new CreatedAccount(
                        e.GetProperty("tag").GetString() ?? "",
                        e.GetProperty("email").GetString() ?? "",
                        e.GetProperty("password").GetString() ?? "",
                        e.GetProperty("mspRole").GetString() ?? ""))
                    .ToList();
                var skipped = root.GetProperty("skipped").EnumerateArray()
                    .Select(e => new SkippedAccount(
                        e.GetProperty("tag").GetString() ?? "",
                        e.GetProperty("email").GetString() ?? "",
                        e.GetProperty("reason").GetString() ?? ""))
                    .ToList();
                if (created.Any(c => c.Tag.Length == 0 || c.Email.Length == 0 || c.Password.Length == 0 || c.MspRole.Length == 0))
                    return null;
                return new RbacResult(deleted, created, skipped);
            }
            catch (Exception ex) when (ex is JsonException || ex is KeyNotFoundException || ex is InvalidOperationException)
            {
                return null;
            }
        }
    }
}
