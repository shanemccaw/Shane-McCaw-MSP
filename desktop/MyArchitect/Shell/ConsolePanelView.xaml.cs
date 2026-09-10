using System;
using System.Text;
using System.Windows;
using System.Windows.Input;
using MyArchitect.Models;
using MyArchitect.Services;
using UserControl = System.Windows.Controls.UserControl;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;

namespace MyArchitect.Shell;

/// <summary>
/// The Console tab's real content — a document hosted in the shell's center area, consuming the
/// real hosted-runspace PowerShell console service built in #3459. That service existed with "No
/// Console UI panel wired up" pending #3493 (see MainWindow's own comment); this is that panel.
/// Real stdout/stderr per command, real device-code prompt text surfaced as it's detected — no
/// simulated output.
/// </summary>
public partial class ConsolePanelView : UserControl
{
    private IPowerShellConsoleService? _consoleService;
    private ITenantModuleConnectionService? _tenantModuleConnectionService;
    private ITenantService? _tenantService;
    private readonly StringBuilder _log = new();

    public ConsolePanelView()
    {
        InitializeComponent();
    }

    public void Initialize(
        IPowerShellConsoleService consoleService,
        ITenantModuleConnectionService tenantModuleConnectionService,
        ITenantService tenantService)
    {
        _consoleService = consoleService;
        _tenantModuleConnectionService = tenantModuleConnectionService;
        _tenantService = tenantService;

        _consoleService.HostOutputReceived += line => Dispatcher.Invoke(() => Append(line));
        _tenantModuleConnectionService.DeviceCodePromptDetected += code =>
            Dispatcher.Invoke(() => Append($"[device-code sign-in] {code}"));

        Append("MyArchitect hosted PowerShell console — real System.Management.Automation runspace (#3459).");
        Append("Variables and imported modules persist between commands, same as a real console session.");
    }

    private async void InputBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter || _consoleService == null) return;

        var command = InputBox.Text?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(command)) return;

        InputBox.Text = string.Empty;
        Append($"PS> {command}");
        InputBox.IsEnabled = false;

        try
        {
            var record = await _consoleService.ExecuteAsync(command, _tenantService?.CurrentTenant);
            if (!string.IsNullOrEmpty(record.Output)) Append(record.Output.TrimEnd());
            if (!string.IsNullOrEmpty(record.ErrorOutput)) Append($"[error] {record.ErrorOutput.TrimEnd()}");
            Append($"[{record.DurationMs}ms · {(record.Succeeded ? "ok" : "failed")}]");
        }
        catch (Exception ex)
        {
            Append($"[exception] {ex.Message}");
        }
        finally
        {
            InputBox.IsEnabled = true;
            InputBox.Focus();
        }
    }

    private void Append(string line)
    {
        _log.AppendLine(line);
        OutputText.Text = _log.ToString();
        OutputScroll.ScrollToEnd();
    }
}
