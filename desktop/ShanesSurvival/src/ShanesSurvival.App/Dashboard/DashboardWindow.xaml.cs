using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using ShanesSurvival.App.Plaid;
using ShanesSurvival.Core.Dashboard;
using ShanesSurvival.Core.Debts;
using ShanesSurvival.Core.PayPeriodPlans;
using ShanesSurvival.Core.Settings;

namespace ShanesSurvival.App.Dashboard;

/// <summary>
/// Real instrument-panel dashboard (#2919): one glance, no digging, no gamification. Top to
/// bottom — real GATE readout (gate_status), real critical debts strip (#2915's is_critical),
/// real This cycle/Next cycle forecast panels (#2918's pay_period_forecast) — then the
/// existing real spend-bleed/warnings/current-plan panels below. Every number here comes from
/// <see cref="DashboardService"/>, <see cref="DebtRepository"/>, and
/// <see cref="PayPeriodForecastService"/>, which compute live off real Plaid/Postgres data
/// already stored — nothing here is fixture/hardcoded data. Colors are only ever applied to
/// genuinely covered/short/critical real states, never decoratively.
/// </summary>
public partial class DashboardWindow : Window
{
    private readonly SettingsService _settingsService;
    private readonly PlaidSyncService _plaidSyncService;
    private readonly DashboardService _dashboardService;
    private readonly PayPeriodPlanRepository _planRepository;
    private readonly DebtRepository _debtRepository;
    private readonly PayPeriodForecastService _payPeriodForecastService;

    public DashboardWindow(
        SettingsService settingsService, PlaidSyncService plaidSyncService, DashboardService dashboardService,
        PayPeriodPlanRepository planRepository, DebtRepository debtRepository,
        PayPeriodForecastService payPeriodForecastService)
    {
        InitializeComponent();
        _settingsService = settingsService;
        _plaidSyncService = plaidSyncService;
        _dashboardService = dashboardService;
        _planRepository = planRepository;
        _debtRepository = debtRepository;
        _payPeriodForecastService = payPeriodForecastService;
        Loaded += async (_, _) => await RecomputeAsync();
    }

    private static Brush ThemeBrush(string key) => (Brush)Application.Current.Resources[key];

    private async void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        RefreshButton.IsEnabled = false;
        RefreshStatusText.Text = "Syncing accounts and transactions…";
        RefreshStatusText.Foreground = ThemeBrush("SecondaryTextBrush");

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
                    RefreshStatusText.Foreground = ThemeBrush("DangerAccentBrush");
                }
                else if (syncResult.Items.Any(i => !i.Success))
                {
                    RefreshStatusText.Text = "Sync completed with some errors. Showing latest available data.";
                    RefreshStatusText.Foreground = ThemeBrush("DangerAccentBrush");
                }
                else
                {
                    RefreshStatusText.Text = $"Synced. Last refreshed {DateTime.Now:t}.";
                    RefreshStatusText.Foreground = ThemeBrush("CoveredAccentBrush");
                }
            }
            else
            {
                RefreshStatusText.Text = "Plaid not configured — showing last-known data from Postgres.";
                RefreshStatusText.Foreground = ThemeBrush("SecondaryTextBrush");
            }

            await RecomputeAsync();
        }
        catch (Exception ex)
        {
            // This is an async void event handler — nothing above it can catch an escaped
            // exception, so letting one through here would take down the whole process.
            RefreshStatusText.Text = $"Unexpected error refreshing: {ex.Message}";
            RefreshStatusText.Foreground = ThemeBrush("DangerAccentBrush");
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

            var debtsResult = await _debtRepository.ListAsync(settings.PostgresConnectionString);
            RenderCriticalDebts(debtsResult);

            var forecastResult = await _payPeriodForecastService.ComputeAsync(
                settings.PostgresConnectionString, DateOnly.FromDateTime(DateTime.Today));
            RenderForecast(forecastResult);

            var planResult = await _planRepository.GetActiveAsync(settings.PostgresConnectionString);
            RenderCurrentPlan(planResult);
        }
        catch (Exception ex)
        {
            // Belt-and-suspenders: every service above already turns a real failure into a
            // Result, but Loaded is effectively async void — never let an escaped exception
            // crash the whole process.
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

        RenderGateReadout(result);
        RenderSpendBleed(result.SpendBleed);
        RenderWarnings(result.Warnings);
    }

    private void RenderError(string message)
    {
        GateReadoutBorder.BorderBrush = ThemeBrush("DangerAccentBrush");
        GateVerdictText.Text = "Could not load dashboard";
        GateVerdictText.Foreground = ThemeBrush("DangerAccentBrush");
        GateSupportingText.Text = message;
        CriticalDebtsPanel.Children.Clear();
        Cycle1Panel.Children.Clear();
        Cycle2Panel.Children.Clear();
        ForecastErrorText.Visibility = Visibility.Collapsed;
        SpendBleedPanel.Children.Clear();
        WarningsBorder.Visibility = Visibility.Collapsed;
    }

    /// <summary>
    /// The single biggest, most prominent element on screen — real covered/short verdict in
    /// large type, with the real Income Gate balance vs. total shortfall as supporting text,
    /// same as gate_status's real output.
    /// </summary>
    private void RenderGateReadout(DashboardResult result)
    {
        if (result.TopLineAmount is null)
        {
            GateVerdictText.Text = "Unknown";
            GateVerdictText.Foreground = ThemeBrush("SecondaryTextBrush");
            GateReadoutBorder.BorderBrush = ThemeBrush("DividerBrush");
            GateSupportingText.Text = "Assign an Income Gate account (and Sync Now) to compute this.";
            return;
        }

        var amount = result.TopLineAmount.Value;
        if (result.IsCovered)
        {
            GateVerdictText.Text = $"COVERED — {Money(amount)} to spare";
            GateVerdictText.Foreground = ThemeBrush("CoveredAccentBrush");
            GateReadoutBorder.BorderBrush = ThemeBrush("CoveredAccentBrush");
        }
        else
        {
            GateVerdictText.Text = $"SHORT by {Money(Math.Abs(amount))}";
            GateVerdictText.Foreground = ThemeBrush("DangerAccentBrush");
            GateReadoutBorder.BorderBrush = ThemeBrush("DangerAccentBrush");
        }

        var reserveSuffix = result.ReserveAccounts.Count > 0
            ? $"  +  Reserve ({string.Join(", ", result.ReserveAccounts.Select(r => r.Name))}): {Money(result.ReserveTotal)}"
            : string.Empty;

        GateSupportingText.Text =
            $"{result.IncomeGateAccountName} balance: {Money(result.IncomeGateBalance ?? 0m)}{reserveSuffix}  −  " +
            $"Total shortfall across bills: {Money(result.TotalShortfall)}";
    }

    /// <summary>
    /// Real is_critical debts (#2915) — always surfaced in their own strip, each its own
    /// distinctly bordered row with a left border accent in danger color. Never empty-state
    /// silently: an honest "no critical debts flagged" muted line when there are none.
    /// </summary>
    private void RenderCriticalDebts(DebtListResult result)
    {
        CriticalDebtsPanel.Children.Clear();

        if (!result.Success)
        {
            CriticalDebtsPanel.Children.Add(new TextBlock
            {
                Text = $"Could not load critical debts: {result.ErrorMessage}",
                Foreground = ThemeBrush("DangerAccentBrush"),
                TextWrapping = TextWrapping.Wrap,
            });
            return;
        }

        var criticalDebts = result.Debts.Where(d => d.IsCritical).ToList();
        if (criticalDebts.Count == 0)
        {
            CriticalDebtsPanel.Children.Add(new TextBlock
            {
                Text = "No debts flagged critical right now.",
                Style = (Style)Application.Current.Resources["MutedTextStyle"],
            });
            return;
        }

        foreach (var debt in criticalDebts)
        {
            CriticalDebtsPanel.Children.Add(BuildCriticalDebtRow(debt));
        }
    }

    private Border BuildCriticalDebtRow(DebtRow debt)
    {
        var nameBlock = new TextBlock { Text = debt.CreditorName, FontWeight = FontWeights.Bold, FontSize = 16 };
        var statusBlock = new TextBlock
        {
            Text = FormatDebtStatus(debt),
            Foreground = ThemeBrush("DangerAccentBrush"),
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 4, 0, 0),
        };
        var balanceBlock = new TextBlock
        {
            Text = $"Balance {Money(debt.Balance)}" + (debt.MinimumPayment is null ? "" : $" · min payment {Money(debt.MinimumPayment.Value)}"),
            Style = (Style)Application.Current.Resources["AmountTextStyle"],
            FontSize = 12,
            Margin = new Thickness(0, 4, 0, 0),
        };

        var stack = new StackPanel();
        stack.Children.Add(nameBlock);
        stack.Children.Add(statusBlock);
        stack.Children.Add(balanceBlock);
        if (!string.IsNullOrWhiteSpace(debt.Notes))
        {
            stack.Children.Add(new TextBlock
            {
                Text = debt.Notes,
                Style = (Style)Application.Current.Resources["MutedTextStyle"],
                FontSize = 12,
                Margin = new Thickness(0, 2, 0, 0),
                TextWrapping = TextWrapping.Wrap,
            });
        }

        return new Border
        {
            Background = ThemeBrush("PanelBackgroundBrush"),
            BorderBrush = ThemeBrush("DangerAccentBrush"),
            BorderThickness = new Thickness(4, 1, 1, 1),
            Padding = new Thickness(12),
            Margin = new Thickness(0, 0, 0, 8),
            Child = stack,
        };
    }

    /// <summary>Real, honest delinquency status — same convention as DebtTools.FormatDelinquency (Mcp).</summary>
    private static string FormatDebtStatus(DebtRow debt) =>
        debt.IsDelinquent
            ? $"Delinquent — {debt.DaysPastDue} day(s) past due"
            : debt.DaysPastDue > 0
                ? $"{debt.DaysPastDue} day(s) past due"
                : "Current";

    /// <summary>
    /// This cycle / Next cycle panels, side by side, from real pay_period_forecast (#2918).
    /// </summary>
    private void RenderForecast(PayPeriodForecastResult result)
    {
        Cycle1Panel.Children.Clear();
        Cycle2Panel.Children.Clear();

        if (!result.Success)
        {
            ForecastErrorText.Text = result.ErrorMessage ?? "Could not compute pay-period forecast.";
            ForecastErrorText.Visibility = Visibility.Visible;
            ForecastGrid.Visibility = Visibility.Collapsed;
            return;
        }

        ForecastErrorText.Visibility = Visibility.Collapsed;
        ForecastGrid.Visibility = Visibility.Visible;

        if (result.Cycle1 is not null)
        {
            BuildCyclePanel(Cycle1Panel, $"This Cycle — {result.PrimarySourceName}", result.Cycle1, isCycle1: true);
        }

        if (result.Cycle2 is not null)
        {
            BuildCyclePanel(Cycle2Panel, "Next Cycle", result.Cycle2, isCycle1: false);
        }
    }

    /// <summary>
    /// Cycle 1's short verdict names the real deadline ("must find this before [next pay
    /// date]"), matching Shane's own framing on #2918; Cycle 2's is forward-looking ("will be
    /// short") since its window hasn't started yet.
    /// </summary>
    private void BuildCyclePanel(StackPanel panel, string label, PayPeriodForecastCycle cycle, bool isCycle1)
    {
        panel.Children.Add(new TextBlock
        {
            Text = label,
            FontWeight = FontWeights.Bold,
            FontSize = 14,
            Margin = new Thickness(0, 0, 0, 2),
        });
        panel.Children.Add(new TextBlock
        {
            Text = $"{cycle.WindowStart:yyyy-MM-dd} → {cycle.WindowEnd:yyyy-MM-dd}",
            Style = (Style)Application.Current.Resources["MutedTextStyle"],
            FontSize = 12,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var verdictText = new TextBlock { FontSize = 24, FontWeight = FontWeights.Bold, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 12) };
        if (cycle.IsCovered is null)
        {
            verdictText.Text = "Unknown — " + (cycle.AvailableAmount is null
                ? "no expected income figure set for this cycle."
                : "cannot compute a verdict yet.");
            verdictText.Foreground = ThemeBrush("SecondaryTextBrush");
        }
        else if (cycle.IsCovered.Value)
        {
            verdictText.Text = $"Covered, {Money(cycle.Delta!.Value)} left over";
            verdictText.Foreground = ThemeBrush("CoveredAccentBrush");
        }
        else
        {
            var shortAmount = Math.Abs(cycle.Delta!.Value);
            verdictText.Text = isCycle1
                ? $"Short {Money(shortAmount)} — must find this before {cycle.WindowEnd:yyyy-MM-dd}"
                : $"Will be short {Money(shortAmount)}";
            verdictText.Foreground = ThemeBrush("DangerAccentBrush");
        }
        panel.Children.Add(verdictText);

        if (cycle.DueBills.Count == 0)
        {
            panel.Children.Add(new TextBlock
            {
                Text = "No bills due in this window.",
                Style = (Style)Application.Current.Resources["MutedTextStyle"],
                Margin = new Thickness(0, 0, 0, 4),
            });
        }
        else
        {
            foreach (var bill in cycle.DueBills.OrderBy(b => b.DueDate))
            {
                var row = new Grid { Margin = new Thickness(0, 1, 0, 1) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

                var nameBlock = new TextBlock { Text = bill.Name, TextWrapping = TextWrapping.Wrap };
                Grid.SetColumn(nameBlock, 0);

                var dueBlock = new TextBlock
                {
                    Text = bill.DueDate.ToString("MMM d"),
                    Style = (Style)Application.Current.Resources["MutedTextStyle"],
                };
                Grid.SetColumn(dueBlock, 1);

                var amountBlock = new TextBlock
                {
                    Text = bill.TargetAmount is not null ? Money(bill.TargetAmount.Value) : (bill.Warning ?? "—"),
                    Style = (Style)Application.Current.Resources["AmountTextStyle"],
                    HorizontalAlignment = HorizontalAlignment.Right,
                };
                Grid.SetColumn(amountBlock, 2);

                row.Children.Add(nameBlock);
                row.Children.Add(dueBlock);
                row.Children.Add(amountBlock);
                panel.Children.Add(row);
            }
        }

        panel.Children.Add(new Border { BorderThickness = new Thickness(0, 1, 0, 0), Margin = new Thickness(0, 8, 0, 8) });

        var totalRow = new Grid();
        totalRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        totalRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var totalLabel = new TextBlock { Text = "Total due", FontWeight = FontWeights.SemiBold };
        Grid.SetColumn(totalLabel, 0);
        var totalAmount = new TextBlock
        {
            Text = Money(cycle.TotalDue),
            Style = (Style)Application.Current.Resources["AmountTextStyle"],
            FontWeight = FontWeights.SemiBold,
        };
        Grid.SetColumn(totalAmount, 1);
        totalRow.Children.Add(totalLabel);
        totalRow.Children.Add(totalAmount);
        panel.Children.Add(totalRow);

        foreach (var warning in cycle.Warnings)
        {
            panel.Children.Add(new TextBlock
            {
                Text = $"• {warning}",
                Style = (Style)Application.Current.Resources["MutedTextStyle"],
                FontSize = 11,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 6, 0, 0),
            });
        }
    }

    private void RenderSpendBleed(IReadOnlyList<SpendAccountBleed> spendBleed)
    {
        SpendBleedPanel.Children.Clear();
        if (spendBleed.Count == 0)
        {
            SpendBleedPanel.Children.Add(new TextBlock
            {
                Text = "No spend accounts assigned yet.",
                Style = (Style)Application.Current.Resources["MutedTextStyle"],
            });
            return;
        }

        foreach (var account in spendBleed)
        {
            var header = new TextBlock
            {
                Text = $"{account.Name} — {Money(account.TotalSpent)} over last 30 days",
                FontWeight = FontWeights.Bold,
                Margin = new Thickness(0, 8, 0, 4),
            };
            SpendBleedPanel.Children.Add(header);

            if (account.Merchants.Count == 0)
            {
                SpendBleedPanel.Children.Add(new TextBlock
                {
                    Text = "No transactions in the last 30 days.",
                    Style = (Style)Application.Current.Resources["MutedTextStyle"],
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

                var countBlock = new TextBlock { Text = $"{merchant.TransactionCount} tx", Style = (Style)Application.Current.Resources["MutedTextStyle"] };
                Grid.SetColumn(countBlock, 1);

                var totalBlock = new TextBlock { Text = Money(merchant.TotalAmount), Style = (Style)Application.Current.Resources["AmountTextStyle"], FontWeight = FontWeights.SemiBold };
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
            CurrentPlanHeaderText.Foreground = ThemeBrush("DangerAccentBrush");
            CurrentPlanSubText.Text = result.ErrorMessage;
            return;
        }

        if (result.Plan is null)
        {
            CurrentPlanHeaderText.Text = "No active pay-period plan right now";
            CurrentPlanHeaderText.Foreground = ThemeBrush("PrimaryTextBrush");
            CurrentPlanSubText.Text = "Ask Claude Desktop to create one via create_pay_period_plan when you get paid.";
            return;
        }

        var plan = result.Plan;
        CurrentPlanHeaderText.Foreground = ThemeBrush("PrimaryTextBrush");
        CurrentPlanHeaderText.Text =
            $"Pay date {plan.PayDate:yyyy-MM-dd} — income {Money(plan.IncomeAmount)} ({plan.Status})";
        CurrentPlanSubText.Text = string.IsNullOrWhiteSpace(plan.Notes) ? "" : plan.Notes;

        foreach (var allocation in plan.Allocations)
        {
            var balanceText = allocation.CurrentBalance is null
                ? "balance unknown"
                : $"current balance {Money(allocation.CurrentBalance.Value)}";
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
                    Text = $"{allocation.AccountName}: {Money(allocation.Amount)}{reasonText} ({balanceText})",
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
                Style = (Style)Application.Current.Resources["MutedTextStyle"],
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

    private static string Money(decimal amount) => amount.ToString("C2", CultureInfo.CurrentCulture);
}
