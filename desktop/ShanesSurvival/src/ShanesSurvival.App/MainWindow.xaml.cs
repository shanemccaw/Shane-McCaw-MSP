using System.Windows;
using System.Windows.Media;
using ShanesSurvival.App.Data;
using ShanesSurvival.App.Groceries;
using ShanesSurvival.App.Settings;
using ShanesSurvival.Core.Groceries;
using ShanesSurvival.Core.Settings;

namespace ShanesSurvival.App;

/// <summary>
/// Interaction logic for MainWindow.xaml. Narrowed in #3296 (Phase 3 of #3293's financial-core
/// unification) — the real financial core (accounts, bills, debts, GATE/shortfall math,
/// pay-period plans, Plaid Link/Sync) migrated fully into shanes-life (#3295, real data
/// migration confirmed complete by Shane 2026-09-09). This app's own remaining real role is the
/// Weekly Ad scraper (#3288) plus whatever future genuinely-browser-automation-only work lands
/// here (e.g. deferred #3245) — connection/migration status stays since the app still owns its
/// own local Postgres database, even though nothing currently reads or writes financial data
/// into it.
/// </summary>
public partial class MainWindow : Window
{
    private readonly SettingsService _settingsService = new();
    private readonly DatabaseConnectionTester _connectionTester = new();
    private readonly MigrationRunner _migrationRunner = new();

    public MainWindow()
    {
        InitializeComponent();
        Loaded += async (_, _) => await CheckConnectionAsync();
    }

    private async void SettingsButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var settingsWindow = new SettingsWindow(_settingsService, _connectionTester) { Owner = this };
            var saved = settingsWindow.ShowDialog();
            if (saved == true)
            {
                await CheckConnectionAsync();
            }
        }
        catch (Exception ex)
        {
            // This is an async void event handler: nothing above it can catch an escaped
            // exception, so letting one through here would take down the whole process.
            MessageBox.Show(this, $"Could not open Settings: {ex.Message}", "Error",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        await CheckConnectionAsync();
    }

    private async void ApplyMigrationsButton_Click(object sender, RoutedEventArgs e)
    {
        await ApplyMigrationsAsync(refreshConnectionAfter: true);
    }

    /// <param name="autoApplyMigrations">
    /// When true (the default — used on startup and by "Recheck Connection"), a successful
    /// connection automatically runs any not-yet-applied migrations, so schema setup never
    /// needs a manual click (or psql) at all. Pass false when re-checking connection status
    /// from inside <see cref="ApplyMigrationsAsync"/> itself, to avoid recursing.
    /// </param>
    private async Task CheckConnectionAsync(bool autoApplyMigrations = true)
    {
        StatusDot.Fill = Brushes.Gray;
        StatusText.Text = "Checking database connection…";
        RefreshButton.IsEnabled = false;

        var status = DatabaseConnectionStatus.NotConfigured;
        try
        {
            var settings = _settingsService.Load();
            var result = await _connectionTester.TestAsync(settings.PostgresConnectionString);
            status = result.Status;

            StatusText.Text = result.Message;
            StatusDot.Fill = status switch
            {
                DatabaseConnectionStatus.Connected => Brushes.Green,
                DatabaseConnectionStatus.SchemaMissing => Brushes.Orange,
                DatabaseConnectionStatus.NotConfigured => Brushes.Gray,
                DatabaseConnectionStatus.Unreachable => Brushes.Red,
                _ => Brushes.Gray,
            };
        }
        catch (Exception ex)
        {
            // DatabaseConnectionTester.TestAsync already turns every real failure into a
            // DatabaseConnectionResult, but this method is called from async void handlers
            // (Loaded, RefreshButton_Click) where an escaped exception has no caller left to
            // catch it and crashes the whole process. Never let that happen.
            StatusText.Text = $"Unexpected error checking connection: {ex.Message}";
            StatusDot.Fill = Brushes.Red;
        }
        finally
        {
            RefreshButton.IsEnabled = true;
        }

        // Only attempt migrations once we actually reached Postgres — NotConfigured/
        // Unreachable have no connection to run them against.
        var reachedPostgres = status is DatabaseConnectionStatus.Connected or DatabaseConnectionStatus.SchemaMissing;
        if (autoApplyMigrations && reachedPostgres)
        {
            await ApplyMigrationsAsync(refreshConnectionAfter: false);
        }
    }

    private async Task ApplyMigrationsAsync(bool refreshConnectionAfter)
    {
        ApplyMigrationsButton.IsEnabled = false;
        MigrationStatusText.Text = "Applying migrations…";
        MigrationStatusText.Foreground = Brushes.Gray;

        try
        {
            var settings = _settingsService.Load();
            var result = await _migrationRunner.RunAsync(settings.PostgresConnectionString);

            if (result.Success)
            {
                var applied = result.Steps
                    .Where(s => s.Outcome == MigrationOutcome.Applied)
                    .Select(s => s.FileName)
                    .ToList();
                var alreadyApplied = result.Steps
                    .Where(s => s.Outcome == MigrationOutcome.AlreadyApplied)
                    .Select(s => s.FileName)
                    .ToList();

                if (result.Steps.Count == 0)
                {
                    MigrationStatusText.Text = "No migration files found in migrations/.";
                    MigrationStatusText.Foreground = Brushes.Gray;
                }
                else if (applied.Count == 0)
                {
                    MigrationStatusText.Text =
                        $"Schema up to date — all {alreadyApplied.Count} migration(s) already applied.";
                    MigrationStatusText.Foreground = Brushes.Green;
                }
                else
                {
                    var alreadySuffix = alreadyApplied.Count > 0
                        ? $" ({alreadyApplied.Count} already applied, skipped.)"
                        : string.Empty;
                    MigrationStatusText.Text =
                        $"Applied {applied.Count} migration(s): {string.Join(", ", applied)}.{alreadySuffix}";
                    MigrationStatusText.Foreground = Brushes.Green;
                }
            }
            else
            {
                MigrationStatusText.Text = result.FailedFileName is not null
                    ? $"Migration failed on {result.FailedFileName}: {result.ErrorMessage}"
                    : result.ErrorMessage ?? "Unknown error applying migrations.";
                MigrationStatusText.Foreground = Brushes.Red;
            }
        }
        catch (Exception ex)
        {
            // MigrationRunner.RunAsync already turns every real failure into a MigrationRunResult,
            // but this can be reached from an async void event handler (ApplyMigrationsButton_Click)
            // where an escaped exception has no caller left to catch it. Never let that happen.
            MigrationStatusText.Text = $"Unexpected error applying migrations: {ex.Message}";
            MigrationStatusText.Foreground = Brushes.Red;
        }
        finally
        {
            ApplyMigrationsButton.IsEnabled = true;
        }

        if (refreshConnectionAfter)
        {
            // Migrations may have just created the tables the connection check depends on —
            // refresh the dot/message so they reflect reality. autoApplyMigrations: false to
            // avoid immediately re-running migrations we just finished running.
            await CheckConnectionAsync(autoApplyMigrations: false);
        }
    }

    private void WeeklyAdButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var settings = _settingsService.Load();
            var credentials = new WeeklyAdCredentials(settings.ShanesLifeApiBaseUrl, settings.ShanesLifeMcpToken);
            if (!credentials.IsConfigured)
            {
                MessageBox.Show(
                    this,
                    "No Shane's Life API URL / MCP token configured yet. Open Settings to add them first — " +
                    "mint a token with `npm run issue-mcp-token` against the real deployment.",
                    "Weekly Ad",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
                return;
            }

            var window = new WeeklyAdScraperWindow(credentials) { Owner = this };
            window.Show();
        }
        catch (Exception ex)
        {
            // Same reasoning as SettingsButton_Click: this handler has no caller left to catch
            // an escaped exception, so it would otherwise crash the whole process.
            MessageBox.Show(this, $"Could not open Weekly Ad: {ex.Message}", "Error",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }
}
