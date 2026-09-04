using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using ShanesSurvival.Core.Accounts;

namespace ShanesSurvival.App.Accounts;

/// <summary>
/// Real per-account role assignment dialog: lists every synced account (from accounts joined
/// to plaid_items) and lets Shane assign role/target_amount/is_gate explicitly, once per
/// account. Rows are built programmatically rather than via a DataGrid/data-binding template —
/// same directness the rest of this codebase already uses (MainWindow, SettingsWindow) — since
/// the row set only changes on open (a fresh Sync while this dialog is open isn't reflected
/// until it's reopened).
/// </summary>
public partial class AccountRoleWindow : Window
{
    private sealed record RoleOption(AccountRole Role, string Label)
    {
        public override string ToString() => Label;
    }

    private static readonly RoleOption[] RoleOptions =
    [
        new(AccountRole.Unassigned, "Unassigned"),
        new(AccountRole.IncomeGate, "Income Gate (Direct Deposit)"),
        new(AccountRole.Bill, "Bill"),
        new(AccountRole.Spend, "Spend"),
    ];

    private sealed record RowControls(Guid AccountId, ComboBox RoleCombo, TextBox TargetBox, CheckBox GateCheck);

    private readonly string? _connectionString;
    private readonly AccountRepository _repository;
    private readonly List<RowControls> _rows = [];

    public AccountRoleWindow(string? connectionString, AccountRepository repository)
    {
        InitializeComponent();
        _connectionString = connectionString;
        _repository = repository;
        Loaded += async (_, _) => await LoadAsync();
    }

    private async Task LoadAsync()
    {
        StatusText.Text = "Loading accounts…";
        StatusText.Foreground = Brushes.Gray;
        SaveButton.IsEnabled = false;
        RowsPanel.Children.Clear();
        _rows.Clear();

        var result = await _repository.ListAsync(_connectionString);
        if (!result.Success)
        {
            StatusText.Text = result.ErrorMessage;
            StatusText.Foreground = Brushes.DarkRed;
            return;
        }
        if (result.Accounts.Count == 0)
        {
            StatusText.Text = "No synced accounts yet. Link a bank account and click \"Sync Now\" first.";
            StatusText.Foreground = Brushes.Gray;
            return;
        }

        AddHeaderRow();
        foreach (var account in result.Accounts)
        {
            AddAccountRow(account);
        }

        StatusText.Text = string.Empty;
        SaveButton.IsEnabled = true;
    }

    private void AddHeaderRow()
    {
        var grid = MakeRowGrid();
        AddHeaderCell(grid, 0, "Account");
        AddHeaderCell(grid, 1, "Institution");
        AddHeaderCell(grid, 2, "Balance");
        AddHeaderCell(grid, 3, "Role");
        AddHeaderCell(grid, 4, "Monthly target ($)");
        AddHeaderCell(grid, 5, "GATE");
        RowsPanel.Children.Add(grid);
        RowsPanel.Children.Add(new Separator { Margin = new Thickness(0, 2, 0, 6) });
    }

    private static void AddHeaderCell(Grid grid, int column, string text)
    {
        var block = new TextBlock { Text = text, FontWeight = FontWeights.Bold };
        Grid.SetColumn(block, column);
        grid.Children.Add(block);
    }

    private void AddAccountRow(AccountRow account)
    {
        var grid = MakeRowGrid();

        var nameBlock = new TextBlock { Text = account.Name, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap };
        Grid.SetColumn(nameBlock, 0);
        grid.Children.Add(nameBlock);

        var instBlock = new TextBlock
        {
            Text = account.InstitutionName ?? "—",
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = Brushes.Gray,
            TextWrapping = TextWrapping.Wrap,
        };
        Grid.SetColumn(instBlock, 1);
        grid.Children.Add(instBlock);

        var balanceBlock = new TextBlock
        {
            Text = account.CurrentBalance.HasValue ? account.CurrentBalance.Value.ToString("C2", CultureInfo.CurrentCulture) : "—",
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(balanceBlock, 2);
        grid.Children.Add(balanceBlock);

        var roleCombo = new ComboBox { ItemsSource = RoleOptions, Margin = new Thickness(0, 2, 4, 2) };
        roleCombo.SelectedItem = RoleOptions.First(o => o.Role == account.Role);
        Grid.SetColumn(roleCombo, 3);
        grid.Children.Add(roleCombo);

        var targetBox = new TextBox
        {
            Text = account.TargetAmount?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            Margin = new Thickness(0, 2, 4, 2),
            IsEnabled = account.Role == AccountRole.Bill,
        };
        Grid.SetColumn(targetBox, 4);
        grid.Children.Add(targetBox);

        var gateCheck = new CheckBox
        {
            IsChecked = account.IsGate,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            IsEnabled = account.Role == AccountRole.Bill,
        };
        Grid.SetColumn(gateCheck, 5);
        grid.Children.Add(gateCheck);

        // Target/GATE only make sense for a Bill account — keep them disabled (not hidden, so
        // Shane can see the values a role change is about to discard) for any other role.
        roleCombo.SelectionChanged += (_, _) =>
        {
            var isBill = (roleCombo.SelectedItem as RoleOption)?.Role == AccountRole.Bill;
            targetBox.IsEnabled = isBill;
            gateCheck.IsEnabled = isBill;
        };

        RowsPanel.Children.Add(grid);
        _rows.Add(new RowControls(account.Id, roleCombo, targetBox, gateCheck));
    }

    private static Grid MakeRowGrid()
    {
        var grid = new Grid { Margin = new Thickness(0, 4, 0, 4) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.5, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0.6, GridUnitType.Star) });
        return grid;
    }

    private async void SaveButton_Click(object sender, RoutedEventArgs e)
    {
        SaveButton.IsEnabled = false;
        StatusText.Text = "Saving…";
        StatusText.Foreground = Brushes.Gray;

        try
        {
            var failures = new List<string>();
            foreach (var row in _rows)
            {
                var role = (row.RoleCombo.SelectedItem as RoleOption)?.Role ?? AccountRole.Unassigned;

                decimal? target = null;
                if (role == AccountRole.Bill && !string.IsNullOrWhiteSpace(row.TargetBox.Text))
                {
                    if (!decimal.TryParse(row.TargetBox.Text, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
                    {
                        failures.Add($"Invalid target amount \"{row.TargetBox.Text}\" — not saved for that row.");
                        continue;
                    }
                    target = parsed;
                }

                var isGate = role == AccountRole.Bill && row.GateCheck.IsChecked == true;

                var result = await _repository.UpdateRoleAsync(_connectionString, row.AccountId, role, target, isGate);
                if (!result.Success)
                {
                    failures.Add(result.ErrorMessage ?? "Unknown error.");
                }
            }

            if (failures.Count == 0)
            {
                StatusText.Text = "Saved.";
                StatusText.Foreground = Brushes.Green;
                DialogResult = true;
            }
            else
            {
                StatusText.Text = string.Join(" ", failures);
                StatusText.Foreground = Brushes.DarkRed;
            }
        }
        catch (Exception ex)
        {
            // This is an async void event handler — nothing above it can catch an escaped
            // exception, so letting one through here would take down the whole process.
            StatusText.Text = $"Unexpected error saving account roles: {ex.Message}";
            StatusText.Foreground = Brushes.DarkRed;
        }
        finally
        {
            SaveButton.IsEnabled = true;
        }
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }
}
