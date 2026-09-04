using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using ShanesSurvival.App.Plaid;
using ShanesSurvival.Core.Dashboard;
using ShanesSurvival.Core.PayPeriodPlans;
using ShanesSurvival.Core.Settings;

namespace ShanesSurvival.App.Dashboard;

/// <summary>
/// Real BuildConsole-style-clarity dashboard: one glance, no digging. Every number here comes
/// from <see cref="DashboardService"/>, which computes live off real Plaid balances/transactions
/// already in Postgres — nothing here is fixture/hardcoded data.
/// </summary>
public partial class DashboardWindow : Window
{
    private static readonly Brush CoveredBrush = new SolidColorBrush(Color.FromRgb(0x1E, 0x7E, 0x34));
    private static readonly Brush ShortBrush = new SolidColorBrush(Color.FromRgb(0xC0, 0x39, 0x2B));
    private static readonly Brush UnknownBrush = Brushes.Gray;
    private static readonly Brush CoveredBackground = new SolidColorBrush(Color.FromRgb(0xE8, 0xF5, 0xE9));
    private static readonly Brush ShortBackground = new SolidColorBrush(Color.FromRgb(0xFD, 0xEC, 0xEA));
    private static readonly Brush UnknownBackground = new SolidColorBrush(Color.FromRgb(0xF2, 0xF2, 0xF2));

    private readonly SettingsService _settingsService;
    private readonly PlaidSyncService _plaidSyncService;
    private readonly DashboardService _dashboardService;
    private readonly PayPeriodPlanRepository _planRepository;

    public DashboardWindow(
        SettingsService settingsService, PlaidSyncService plaidSyncService, DashboardService dashboardService,
        PayPeriodPlanRepository planRepository)
    {
        InitializeComponent();
        _settingsService = settingsService;
        _plaidSyncService = plaidSyncService;
        _dashboardService = dashboardService;
        _planRepository = planRepository;
        Loaded += async (_, _) => await RecomputeAsync();
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        RefreshButton.IsEnabled = false;
        RefreshStatusText.Text = "Syncing accounts and transactions…";
        RefreshStatusText.Foreground = Brushes.Gray;

        try
        {
            var settings = _settingsService.Load();
            var credentials = new PlaidCredentials(settings.PlaidClientId, settings.PlaidSecret, settings.PlaidEnvironment);

            if (credentials.IsConfigured && !string.IsNullOrWhiteSpace(settings.PostgresConnectionString))
            {
                var syncResult = await _plaidSyncService.SyncAllAsync(credentials, settings.PostgresConnectionString);
                if (!syncResult.Success)
                {
                    RefreshStatusText.Text = $"Sync failed: {syncResult.ErrorMessage}. Showing last-known data.";
                    RefreshStatusText.Foreground = Brushes.DarkRed;
                }
                else if (syncResult.Items.Any(i => !i.Success))
                {
                    RefreshStatusText.Text = "Sync completed with some errors. Showing latest available data.";
                    RefreshStatusText.Foreground = Brushes.DarkRed;
                }
                else
                {
                    RefreshStatusText.Text = $"Synced. Last refreshed {DateTime.Now:t}.";
                    RefreshStatusText.Foreground = Brushes.Green;
                }
            }
            else
            {
                RefreshStatusText.Text = "Plaid not configured — showing last-known data from Postgres.";
                RefreshStatusText.Foreground = Brushes.Gray;
            }

            await RecomputeAsync();
        }
        catch (Exception ex)
        {
            // This is an async void event handler — nothing above it can catch an escaped
            // exception, so letting one through here would take down the whole process.
            RefreshStatusText.Text = $"Unexpected error refreshing: {ex.Message}";
            RefreshStatusText.Foreground = Brushes.DarkRed;
        }
        finally
        {
            RefreshButton.IsEnabled = true;
        }
    }

    private async Task RecomputeAsync()
    {
        try
        {
            var settings = _settingsService.Load();
            var result = await _dashboardService.ComputeAsync(settings.PostgresConnectionString);
            Render(result);

            var planResult = await _planRepository.GetActiveAsync(settings.PostgresConnectionString);
            RenderCurrentPlan(planResult);
        }
        catch (Exception ex)
        {
            // Belt-and-suspenders: DashboardService.ComputeAsync already turns every real
            // failure into a Result, but Loaded is effectively async void — never let an
            // escaped exception crash the whole process.
            RenderError($"Unexpected error computing dashboard: {ex.Message}");
        }
    }

    private void Render(DashboardResult result)
    {
        if (!result.Success)
        {
            RenderError(result.ErrorMessage ?? "Unknown error computing dashboard.");
            return;
        }

        RenderTopLine(result);
        RenderGateCards(result.GateBills);
        RenderOtherBills(result.OtherBills);
        RenderSpendBleed(result.SpendBleed);
        RenderWarnings(result.Warnings);
    }

    private void RenderError(string message)
    {
        TopLineBorder.BorderBrush = ShortBrush;
        TopLineBorder.Background = UnknownBackground;
        TopLineText.Text = "Could not load dashboard";
        TopLineText.Foreground = ShortBrush;
        TopLineSubText.Text = message;
        GateCardsPanel.Children.Clear();
        OtherBillsPanel.Children.Clear();
        SpendBleedPanel.Children.Clear();
        WarningsBorder.Visibility = Visibility.Collapsed;
    }

    private void RenderTopLine(DashboardResult result)
    {
        if (result.TopLineAmount is null)
        {
            TopLineText.Text = "Unknown";
            TopLineText.Foreground = UnknownBrush;
            TopLineBorder.BorderBrush = UnknownBrush;
            TopLineBorder.Background = UnknownBackground;
            TopLineSubText.Text = "Assign an Income Gate account (and Sync Now) to compute this.";
            return;
        }

        var amount = result.TopLineAmount.Value;
        if (result.IsCovered)
        {
            TopLineText.Text = $"Covered — {amount:C2} to spare";
            TopLineText.Foreground = CoveredBrush;
            TopLineBorder.BorderBrush = CoveredBrush;
            TopLineBorder.Background = CoveredBackground;
        }
        else
        {
            TopLineText.Text = $"Short by {Math.Abs(amount):C2}";
            TopLineText.Foreground = ShortBrush;
            TopLineBorder.BorderBrush = ShortBrush;
            TopLineBorder.Background = ShortBackground;
        }

        var reserveSuffix = result.ReserveAccounts.Count > 0
            ? $"  +  Reserve ({string.Join(", ", result.ReserveAccounts.Select(r => r.Name))}): {result.ReserveTotal:C2}"
            : string.Empty;

        TopLineSubText.Text =
            $"{result.IncomeGateAccountName} balance: {result.IncomeGateBalance:C2}{reserveSuffix}  −  " +
            $"Total shortfall across bills: {result.TotalShortfall:C2}";
    }

    private void RenderGateCards(IReadOnlyList<BillStatus> gateBills)
    {
        GateCardsPanel.Children.Clear();
        if (gateBills.Count == 0)
        {
            GateCardsPanel.Children.Add(new TextBlock
            {
                Text = "No bill accounts are marked GATE yet — check the GATE box for mortgage/Tesla in \"Assign Account Roles…\".",
                Foreground = Brushes.Gray,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 8),
            });
            return;
        }

        foreach (var bill in gateBills)
        {
            GateCardsPanel.Children.Add(BuildBillCard(bill, isCard: true));
        }
    }

    private void RenderOtherBills(IReadOnlyList<BillStatus> otherBills)
    {
        OtherBillsPanel.Children.Clear();
        if (otherBills.Count == 0)
        {
            OtherBillsPanel.Children.Add(new TextBlock
            {
                Text = "No non-GATE bill accounts assigned yet.",
                Foreground = Brushes.Gray,
            });
            return;
        }

        foreach (var bill in otherBills)
        {
            OtherBillsPanel.Children.Add(BuildBillCard(bill, isCard: false));
        }
    }

    private Border BuildBillCard(BillStatus bill, bool isCard)
    {
        var (brush, background, statusText) = ClassifyBill(bill);

        var nameBlock = new TextBlock { Text = bill.Name, FontWeight = FontWeights.Bold, TextWrapping = TextWrapping.Wrap };
        var detailBlock = new TextBlock
        {
            Foreground = Brushes.Gray,
            FontSize = 12,
            Margin = new Thickness(0, 2, 0, 0),
            Text = $"Target {(bill.TargetAmount.HasValue ? bill.TargetAmount.Value.ToString("C2", CultureInfo.CurrentCulture) : "—")} · " +
                   $"Balance {(bill.CurrentBalance.HasValue ? bill.CurrentBalance.Value.ToString("C2", CultureInfo.CurrentCulture) : "—")}",
        };
        var statusBlock = new TextBlock
        {
            Text = statusText,
            Foreground = brush,
            FontWeight = FontWeights.Bold,
            FontSize = isCard ? 18 : 14,
            Margin = new Thickness(0, 4, 0, 0),
        };

        var stack = new StackPanel();
        stack.Children.Add(nameBlock);
        stack.Children.Add(detailBlock);
        stack.Children.Add(statusBlock);

        return new Border
        {
            BorderBrush = brush,
            BorderThickness = new Thickness(1),
            Background = background,
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(12),
            Margin = isCard ? new Thickness(0, 0, 12, 12) : new Thickness(0, 0, 0, 8),
            Width = isCard ? 240 : double.NaN,
            Child = stack,
        };
    }

    private static (Brush Brush, Brush Background, string StatusText) ClassifyBill(BillStatus bill)
    {
        if (bill.Warning is not null)
        {
            return (UnknownBrush, UnknownBackground, bill.Warning);
        }
        if (bill.Shortfall is > 0)
        {
            return (ShortBrush, ShortBackground, $"Short {bill.Shortfall.Value:C2}");
        }
        return (CoveredBrush, CoveredBackground, "Covered");
    }

    private void RenderSpendBleed(IReadOnlyList<SpendAccountBleed> spendBleed)
    {
        SpendBleedPanel.Children.Clear();
        if (spendBleed.Count == 0)
        {
            SpendBleedPanel.Children.Add(new TextBlock
            {
                Text = "No spend accounts assigned yet.",
                Foreground = Brushes.Gray,
            });
            return;
        }

        foreach (var account in spendBleed)
        {
            var header = new TextBlock
            {
                Text = $"{account.Name} — {account.TotalSpent:C2} over last 30 days",
                FontWeight = FontWeights.Bold,
                Margin = new Thickness(0, 8, 0, 4),
            };
            SpendBleedPanel.Children.Add(header);

            if (account.Merchants.Count == 0)
            {
                SpendBleedPanel.Children.Add(new TextBlock
                {
                    Text = "No transactions in the last 30 days.",
                    Foreground = Brushes.Gray,
                    Margin = new Thickness(8, 0, 0, 4),
                });
                continue;
            }

            foreach (var merchant in account.Merchants)
            {
                var row = new Grid { Margin = new Thickness(8, 1, 0, 1) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

                var nameBlock = new TextBlock { Text = merchant.Merchant };
                Grid.SetColumn(nameBlock, 0);

                var countBlock = new TextBlock { Text = $"{merchant.TransactionCount} tx", Foreground = Brushes.Gray };
                Grid.SetColumn(countBlock, 1);

                var totalBlock = new TextBlock { Text = merchant.TotalAmount.ToString("C2", CultureInfo.CurrentCulture), FontWeight = FontWeights.SemiBold };
                Grid.SetColumn(totalBlock, 2);

                row.Children.Add(nameBlock);
                row.Children.Add(countBlock);
                row.Children.Add(totalBlock);
                SpendBleedPanel.Children.Add(row);
            }
        }
    }

    private void RenderWarnings(IReadOnlyList<string> warnings)
    {
        WarningsPanel.Children.Clear();
        if (warnings.Count == 0)
        {
            WarningsBorder.Visibility = Visibility.Collapsed;
            return;
        }

        foreach (var warning in warnings)
        {
            WarningsPanel.Children.Add(new TextBlock { Text = $"• {warning}", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 1, 0, 1) });
        }
        WarningsBorder.Visibility = Visibility.Visible;
    }

    /// <summary>
    /// Real "Current Plan" checklist — one real GFM-style checkbox row per allocation on the
    /// real active pay-period plan (see #2892). Checking a box calls
    /// <see cref="PayPeriodPlanRepository.MarkAllocationExecutedAsync"/>, recording that Shane
    /// made the real transfer himself in his own bank app; nothing here moves any money.
    /// </summary>
    private void RenderCurrentPlan(PlanResult result)
    {
        CurrentPlanAllocationsPanel.Children.Clear();

        if (!result.Success)
        {
            CurrentPlanHeaderText.Text = "Could not load the current plan";
            CurrentPlanHeaderText.Foreground = ShortBrush;
            CurrentPlanSubText.Text = result.ErrorMessage;
            return;
        }

        if (result.Plan is null)
        {
            CurrentPlanHeaderText.Text = "No active pay-period plan right now";
            CurrentPlanHeaderText.Foreground = Brushes.Black;
            CurrentPlanSubText.Text = "Ask Claude Desktop to create one via create_pay_period_plan when you get paid.";
            return;
        }

        var plan = result.Plan;
        CurrentPlanHeaderText.Foreground = Brushes.Black;
        CurrentPlanHeaderText.Text =
            $"Pay date {plan.PayDate:yyyy-MM-dd} — income {plan.IncomeAmount:C2} ({plan.Status})";
        CurrentPlanSubText.Text = string.IsNullOrWhiteSpace(plan.Notes) ? "" : plan.Notes;

        foreach (var allocation in plan.Allocations)
        {
            var balanceText = allocation.CurrentBalance is null
                ? "balance unknown"
                : $"current balance {allocation.CurrentBalance.Value.ToString("C2", CultureInfo.CurrentCulture)}";
            var reasonText = string.IsNullOrWhiteSpace(allocation.Reason) ? "" : $" — {allocation.Reason}";

            var checkBox = new CheckBox
            {
                IsChecked = allocation.Executed,
                IsEnabled = !allocation.Executed,
                Margin = new Thickness(0, 2, 0, 2),
                Tag = allocation.Id,
                Content = new TextBlock
                {
                    TextWrapping = TextWrapping.Wrap,
                    Text = $"{allocation.AccountName}: {allocation.Amount:C2}{reasonText} ({balanceText})",
                },
            };
            checkBox.Checked += CurrentPlanAllocationCheckBox_Checked;
            CurrentPlanAllocationsPanel.Children.Add(checkBox);
        }

        if (plan.Allocations.Count == 0)
        {
            CurrentPlanAllocationsPanel.Children.Add(new TextBlock
            {
                Text = "This plan has no allocations.",
                Foreground = Brushes.Gray,
            });
        }
    }

    private async void CurrentPlanAllocationCheckBox_Checked(object sender, RoutedEventArgs e)
    {
        if (sender is not CheckBox { Tag: Guid allocationId } checkBox)
        {
            return;
        }

        checkBox.IsEnabled = false;
        try
        {
            var settings = _settingsService.Load();
            var result = await _planRepository.MarkAllocationExecutedAsync(settings.PostgresConnectionString, allocationId);
            if (!result.Success)
            {
                MessageBox.Show(this, $"Could not mark this allocation executed: {result.ErrorMessage}", "Error",
                    MessageBoxButton.OK, MessageBoxImage.Error);
                checkBox.IsChecked = false;
                checkBox.IsEnabled = true;
                return;
            }

            // Re-render from the real database so a plan that just completed (every allocation
            // now executed) shows its real new status instead of a stale "active" checklist.
            var planResult = await _planRepository.GetActiveAsync(settings.PostgresConnectionString);
            RenderCurrentPlan(planResult);
        }
        catch (Exception ex)
        {
            // async void event handler — nothing above it can catch an escaped exception.
            MessageBox.Show(this, $"Unexpected error marking allocation executed: {ex.Message}", "Error",
                MessageBoxButton.OK, MessageBoxImage.Error);
            checkBox.IsChecked = false;
            checkBox.IsEnabled = true;
        }
    }
}
