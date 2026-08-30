using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// The deliberate, manual confirmation for a "Deploy to Staging" action. It is intentionally a
    /// modal, click-through gate (Staging is a real, human-only deploy target, not something an agent
    /// or a timer ever triggers) and doubles as the one place Shane can hand pending schema migration
    /// SQL into the deploy — that SQL goes through #911's existing hard-filtered, transactional
    /// apply mechanism, never a raw ad-hoc query. Shows the real SSH host and Staging URL it will act
    /// against so there's no ambiguity about the target.
    ///
    /// Git #1199: on open it also queries Staging's own simulator_migration_runs table over SSH
    /// (via ReplitSshService.GetPendingManualMigrationsAsync, which runs
    /// scripts/src/manual-migration-status.ts against whatever DATABASE_URL that remote process's
    /// own env points at) and shows which lib/db/migrations/manual/*.sql files have landed on Dev
    /// but not yet run on Staging — live DB truth, not a hand-maintained list that goes stale.
    /// "Load into SQL box" concatenates their real file contents, in filename (chronological) order,
    /// into SchemaSqlBox so nothing has to be remembered or retyped.
    /// </summary>
    public partial class StagingDeployDialog : Window
    {
        /// <summary>The pending migration SQL Shane entered, trimmed; null when blank (a code-only deploy).</summary>
        public string? SchemaSql { get; private set; }

        private string[] _pendingMigrationFiles = System.Array.Empty<string>();

        public StagingDeployDialog()
        {
            InitializeComponent();

            var settings = BuildConsoleSettings.Load();
            var stagingUrl = BuildTrackerConfig.Load().GetBaseUrl(TargetEnvironment.Staging);

            SshHostText.Text = string.IsNullOrWhiteSpace(settings.SshHost)
                ? "(SSH not configured — the server-side git pull will be used)"
                : (string.IsNullOrWhiteSpace(settings.SshUser) ? settings.SshHost : $"{settings.SshUser}@{settings.SshHost}");
            StagingUrlText.Text = string.IsNullOrWhiteSpace(stagingUrl) ? "(not configured)" : stagingUrl;

            SchemaSqlBox.Focus();

            _ = LoadPendingMigrationsAsync();
        }

        private async System.Threading.Tasks.Task LoadPendingMigrationsAsync()
        {
            if (!ReplitSshService.Instance.IsConfigured)
            {
                PendingMigrationsText.Text = "SSH not configured — can't check Staging's migration state. Confirm manually before deploying.";
                return;
            }

            try
            {
                // Git #1828 — the pending-migration read is part of the deliberate, Shane-only "Deploy to
                // Staging" flow (this modal only opens from that button). Authorize the SSH read explicitly
                // so the Dev-only lock doesn't fail-close it regardless of the Target Environment selector.
                using var _stagingAuth = ReplitSshService.AuthorizeManualStagingOperation();
                var result = await ReplitSshService.Instance.GetPendingManualMigrationsAsync();
                if (!result.Success || string.IsNullOrWhiteSpace(result.Output))
                {
                    PendingMigrationsText.Text = $"Couldn't check Staging's migration state ({(string.IsNullOrWhiteSpace(result.Error) ? "no output" : result.Error)}). Confirm manually before deploying.";
                    return;
                }

                using var doc = JsonDocument.Parse(result.Output.Trim());
                var root = doc.RootElement;
                if (!root.TryGetProperty("ok", out var okProp) || !okProp.GetBoolean())
                {
                    var err = root.TryGetProperty("error", out var errProp) ? errProp.GetString() : "unknown error";
                    PendingMigrationsText.Text = $"Couldn't check Staging's migration state ({err}). Confirm manually before deploying.";
                    return;
                }

                var pending = new System.Collections.Generic.List<string>();
                if (root.TryGetProperty("pending", out var pendingArr) && pendingArr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in pendingArr.EnumerateArray())
                    {
                        var name = item.GetString();
                        if (!string.IsNullOrWhiteSpace(name)) pending.Add(name);
                    }
                }
                _pendingMigrationFiles = pending.ToArray();

                if (_pendingMigrationFiles.Length == 0)
                {
                    PendingMigrationsText.Text = "None — Staging is caught up with every manual migration on Dev.";
                    BtnLoadPending.IsEnabled = false;
                }
                else
                {
                    PendingMigrationsText.Text = $"{_pendingMigrationFiles.Length} file(s), in order: {string.Join(", ", _pendingMigrationFiles)}";
                    BtnLoadPending.IsEnabled = true;
                }
            }
            catch (Exception ex)
            {
                PendingMigrationsText.Text = $"Couldn't check Staging's migration state ({ex.Message}). Confirm manually before deploying.";
            }
        }

        private void LoadPending_Click(object sender, RoutedEventArgs e)
        {
            if (_pendingMigrationFiles.Length == 0) return;

            var repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                MessageBox.Show(this, "Couldn't locate the repo root to read migration files from.", "Load pending migrations",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var manualDir = Path.Combine(repoRoot, "lib", "db", "migrations", "manual");
            var sb = new StringBuilder();
            foreach (var file in _pendingMigrationFiles)
            {
                var path = Path.Combine(manualDir, file);
                if (!File.Exists(path))
                {
                    sb.AppendLine($"-- MISSING LOCALLY: {file} (pull latest main first)");
                    continue;
                }
                sb.AppendLine($"-- {file}");
                sb.AppendLine(File.ReadAllText(path).Trim());
                sb.AppendLine();
            }

            SchemaSqlBox.Text = sb.ToString().TrimEnd();
        }

        private void BtnDeploy_Click(object sender, RoutedEventArgs e)
        {
            var sql = SchemaSqlBox.Text?.Trim();
            SchemaSql = string.IsNullOrWhiteSpace(sql) ? null : sql;
            DialogResult = true;
            Close();
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
            Close();
        }
    }
}
