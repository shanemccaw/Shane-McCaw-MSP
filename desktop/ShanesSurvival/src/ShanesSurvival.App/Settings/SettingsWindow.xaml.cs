using System.Windows;
using ShanesSurvival.App.Data;
using ShanesSurvival.Core.Settings;

namespace ShanesSurvival.App.Settings;

/// <summary>
/// Interaction logic for SettingsWindow.xaml. Reads/writes AppSettings via SettingsService.
/// Never logs field values — including on the Test Connection path.
/// </summary>
public partial class SettingsWindow : Window
{
    private readonly SettingsService _settingsService;
    private readonly DatabaseConnectionTester _connectionTester;

    public SettingsWindow(SettingsService settingsService, DatabaseConnectionTester connectionTester)
    {
        InitializeComponent();
        _settingsService = settingsService;
        _connectionTester = connectionTester;

        var settings = _settingsService.Load();
        ConnectionStringTextBox.Text = settings.PostgresConnectionString ?? string.Empty;
        PlaidClientIdTextBox.Text = settings.PlaidClientId ?? string.Empty;
        PlaidSecretPasswordBox.Password = settings.PlaidSecret ?? string.Empty;

        var environment = string.IsNullOrWhiteSpace(settings.PlaidEnvironment) ? "sandbox" : settings.PlaidEnvironment;
        foreach (var item in PlaidEnvironmentComboBox.Items)
        {
            if (item is System.Windows.Controls.ComboBoxItem comboItem &&
                string.Equals((string)comboItem.Content, environment, StringComparison.OrdinalIgnoreCase))
            {
                PlaidEnvironmentComboBox.SelectedItem = comboItem;
                break;
            }
        }
        PlaidEnvironmentComboBox.SelectedItem ??= PlaidEnvironmentComboBox.Items[0];

        SettingsFilePathText.Text = $"Stored locally at: {_settingsService.SettingsFileDisplayPath}";
    }

    private async void TestConnectionButton_Click(object sender, RoutedEventArgs e)
    {
        TestConnectionButton.IsEnabled = false;
        TestResultText.Text = "Testing…";
        TestResultText.Foreground = System.Windows.Media.Brushes.Gray;
        try
        {
            var result = await _connectionTester.TestAsync(ConnectionStringTextBox.Text);
            TestResultText.Text = result.Message;
            TestResultText.Foreground = result.IsHealthy
                ? System.Windows.Media.Brushes.Green
                : System.Windows.Media.Brushes.DarkRed;
        }
        catch (Exception ex)
        {
            // Belt-and-suspenders: DatabaseConnectionTester.TestAsync should already turn every
            // failure into a DatabaseConnectionResult, but this is an async void event handler —
            // anything that still escapes here would otherwise crash the whole process.
            TestResultText.Text = $"Unexpected error testing connection: {ex.Message}";
            TestResultText.Foreground = System.Windows.Media.Brushes.DarkRed;
        }
        finally
        {
            TestConnectionButton.IsEnabled = true;
        }
    }

    private void SaveButton_Click(object sender, RoutedEventArgs e)
    {
        var settings = new AppSettings
        {
            PostgresConnectionString = string.IsNullOrWhiteSpace(ConnectionStringTextBox.Text)
                ? null
                : ConnectionStringTextBox.Text.Trim(),
            PlaidClientId = string.IsNullOrWhiteSpace(PlaidClientIdTextBox.Text)
                ? null
                : PlaidClientIdTextBox.Text.Trim(),
            PlaidSecret = string.IsNullOrWhiteSpace(PlaidSecretPasswordBox.Password)
                ? null
                : PlaidSecretPasswordBox.Password,
            PlaidEnvironment = (PlaidEnvironmentComboBox.SelectedItem as System.Windows.Controls.ComboBoxItem)?.Content as string
                ?? "sandbox",
        };

        try
        {
            _settingsService.Save(settings);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                this,
                $"Could not save settings: {ex.Message}",
                "Save failed",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            return;
        }

        DialogResult = true;
        Close();
    }

    private void CancelButton_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }
}
