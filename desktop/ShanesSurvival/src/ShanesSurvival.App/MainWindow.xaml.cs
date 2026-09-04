using System.Windows;
using System.Windows.Media;
using ShanesSurvival.App.Accounts;
using ShanesSurvival.App.Dashboard;
using ShanesSurvival.App.Data;
using ShanesSurvival.App.Plaid;
using ShanesSurvival.App.Settings;
using ShanesSurvival.Core.Accounts;
using ShanesSurvival.Core.Dashboard;
using ShanesSurvival.Core.PayPeriodPlans;
using ShanesSurvival.Core.Settings;

namespace ShanesSurvival.App;

/// <summary>
/// Interaction logic for MainWindow.xaml
/// </summary>
public partial class MainWindow : Window
{
    private readonly SettingsService _settingsService = new();
    private readonly DatabaseConnectionTester _connectionTester = new();
    private readonly MigrationRunner _migrationRunner = new();
    private readonly PlaidLinkService _plaidLinkService = new();
    private readonly PlaidSyncService _plaidSyncService = new();
    private readonly AccountRepository _accountRepository = new();
    private readonly DashboardService _dashboardService = new();
    private readonly PayPeriodPlanRepository _planRepository = new();

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

    private async void LinkBankAccountButton_Click(object sender, RoutedEventArgs e)
    {
        await LinkBankAccountAsync();
    }

    private async void SyncNowButton_Click(object sender, RoutedEventArgs e)
    {
        await SyncNowAsync();
    }

    private async Task LinkBankAccountAsync()
    {
        LinkBankAccountButton.IsEnabled = false;
        PlaidStatusText.Text = "Creating secure Link session…";
        PlaidStatusText.Foreground = Brushes.Gray;

        try
        {
            var settings = _settingsService.Load();
            var credentials = new PlaidCredentials(settings.PlaidClientId, settings.PlaidSecret, settings.PlaidEnvironment);

            if (!credentials.IsConfigured)
            {
                PlaidStatusText.Text = "No Plaid credentials configured. Open Settings to add your Client ID and Secret.";
                PlaidStatusText.Foreground = Brushes.Gray;
                return;
            }
            if (string.IsNullOrWhiteSpace(settings.PostgresConnectionString))
            {
                PlaidStatusText.Text = "No Postgres connection string configured. Open Settings first.";
                PlaidStatusText.Foreground = Brushes.Gray;
                return;
            }

            // Plaid requires a stable client_user_id across relinks — generate and persist it
            // once, the first time Shane actually links something.
            if (string.IsNullOrWhiteSpace(settings.PlaidClientUserId))
            {
                settings.PlaidClientUserId = Guid.NewGuid().ToString();
                _settingsService.Save(settings);
            }

            var tokenResult = await _plaidLinkService.CreateLinkTokenAsync(credentials, settings.PlaidClientUserId);
            if (!tokenResult.Success)
            {
                PlaidStatusText.Text = $"Could not start Link: {tokenResult.ErrorMessage}";
                PlaidStatusText.Foreground = Brushes.Red;
                return;
            }

            var linkWindow = new PlaidLinkWindow(tokenResult.LinkToken!) { Owner = this };
            linkWindow.ShowDialog();
            var outcome = linkWindow.Outcome;

            if (outcome is null)
            {
                PlaidStatusText.Text = "Link window closed before it finished starting up.";
                PlaidStatusText.Foreground = Brushes.Gray;
                return;
            }
            if (!outcome.Success)
            {
                PlaidStatusText.Text = $"Bank link not completed: {outcome.ErrorMessage ?? "cancelled."}";
                PlaidStatusText.Foreground = Brushes.Gray;
                return;
            }

            PlaidStatusText.Text = $"Connected to {outcome.InstitutionName}. Saving…";
            var exchangeResult = await _plaidLinkService.ExchangeAndStoreAsync(
                credentials, settings.PostgresConnectionString, outcome.PublicToken!, outcome.InstitutionName ?? "Bank");

            if (exchangeResult.Success)
            {
                PlaidStatusText.Text = $"Linked {exchangeResult.InstitutionName}. Click \"Sync Now\" to pull accounts and transactions.";
                PlaidStatusText.Foreground = Brushes.Green;
            }
            else
            {
                PlaidStatusText.Text = $"Linked to Plaid, but could not save it to the database: {exchangeResult.ErrorMessage}";
                PlaidStatusText.Foreground = Brushes.Red;
            }
        }
        catch (Exception ex)
        {
            // PlaidLinkService already turns every real failure into a Result, but this is an
            // async void event handler — anything that still escapes here (including a WPF
            // dialog/window failure) would otherwise crash the whole process. Never let that happen.
            PlaidStatusText.Text = $"Unexpected error linking bank account: {ex.Message}";
            PlaidStatusText.Foreground = Brushes.Red;
        }
        finally
        {
            LinkBankAccountButton.IsEnabled = true;
        }
    }

    private async Task SyncNowAsync()
    {
        SyncNowButton.IsEnabled = false;
        PlaidStatusText.Text = "Syncing accounts and transactions…";
        PlaidStatusText.Foreground = Brushes.Gray;

        try
        {
            var settings = _settingsService.Load();
            var credentials = new PlaidCredentials(settings.PlaidClientId, settings.PlaidSecret, settings.PlaidEnvironment);

            if (!credentials.IsConfigured)
            {
                PlaidStatusText.Text = "No Plaid credentials configured. Open Settings to add your Client ID and Secret.";
                PlaidStatusText.Foreground = Brushes.Gray;
                return;
            }
            if (string.IsNullOrWhiteSpace(settings.PostgresConnectionString))
            {
                PlaidStatusText.Text = "No Postgres connection string configured. Open Settings first.";
                PlaidStatusText.Foreground = Brushes.Gray;
                return;
            }

            var result = await _plaidSyncService.SyncAllAsync(credentials, settings.PostgresConnectionString);
            if (!result.Success)
            {
                PlaidStatusText.Text = $"Sync failed: {result.ErrorMessage}";
                PlaidStatusText.Foreground = Brushes.Red;
                return;
            }
            if (result.Items.Count == 0)
            {
                PlaidStatusText.Text = "No linked bank accounts yet. Click \"Link Bank Account\" first.";
                PlaidStatusText.Foreground = Brushes.Gray;
                return;
            }

            var lines = result.Items.Select(item => item.Success
                ? $"{item.InstitutionName}: {item.AccountsUpserted} account(s), " +
                  $"+{item.TransactionsAdded} / ~{item.TransactionsModified} / -{item.TransactionsRemoved} transaction(s)."
                : $"{item.InstitutionName}: sync FAILED — {item.ErrorMessage}");
            PlaidStatusText.Text = string.Join("\n", lines);
            PlaidStatusText.Foreground = result.Items.All(item => item.Success) ? Brushes.Green : Brushes.Red;
        }
        catch (Exception ex)
        {
            // PlaidSyncService already turns every real failure into a Result, but this is an
            // async void event handler — anything that still escapes here has no caller left
            // to catch it and would crash the whole process. Never let that happen.
            PlaidStatusText.Text = $"Unexpected error syncing: {ex.Message}";
            PlaidStatusText.Foreground = Brushes.Red;
        }
        finally
        {
            SyncNowButton.IsEnabled = true;
        }
    }

    private void AssignRolesButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var settings = _settingsService.Load();
            var window = new AccountRoleWindow(settings.PostgresConnectionString, _accountRepository) { Owner = this };
            window.ShowDialog();
        }
        catch (Exception ex)
        {
            // Same reasoning as SettingsButton_Click: this handler has no caller left to catch
            // an escaped exception, so it would otherwise crash the whole process.
            MessageBox.Show(this, $"Could not open Assign Account Roles: {ex.Message}", "Error",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void OpenDashboardButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var window = new DashboardWindow(_settingsService, _plaidSyncService, _dashboardService, _planRepository) { Owner = this };
            window.Show();
        }
        catch (Exception ex)
        {
            // Same reasoning as SettingsButton_Click: this handler has no caller left to catch
            // an escaped exception, so it would otherwise crash the whole process.
            MessageBox.Show(this, $"Could not open Dashboard: {ex.Message}", "Error",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }
}
