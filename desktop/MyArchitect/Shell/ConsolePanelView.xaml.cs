using System;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
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
///
/// Also carries the three remaining real, non-catalog-backed pieces of #3459's own checklist:
/// a tenant context indicator (which tenant this runspace's Graph/Az modules are actually
/// connected to — distinct from the title bar's global Tenant Switcher), a local command
/// history surface (delegates to <see cref="HistoryRequested"/> so the shell can render it in
/// the real full-panel record workspace, UI_RULES.md §3, rather than inventing a second list
/// control here), and a "mark for report" toggle/hotkey on the most recently executed command.
/// "Replay last run" (catalog-backed) stays unwired — it needs a real catalogItemId, which is
/// the same MSP/customer-identity gap already tracked at #3501 that blocks Script Library's own
/// gallery (see MainWindow.BuildScriptLibraryRows); wiring a button with nothing real to call
/// would be fabricating availability, not building the feature.
/// </summary>
public partial class ConsolePanelView : UserControl
{
    private IPowerShellConsoleService? _consoleService;
    private ITenantModuleConnectionService? _tenantModuleConnectionService;
    private ITenantService? _tenantService;
    private IConsoleHistoryService? _historyService;
    private readonly StringBuilder _log = new();
    private Guid? _lastExecutionId;

    private static readonly SolidColorBrush ConnectedBrush = (SolidColorBrush)new BrushConverter().ConvertFromString("#4CAF50")!;
    private static readonly SolidColorBrush FailedBrush = (SolidColorBrush)new BrushConverter().ConvertFromString("#F44336")!;
    private static readonly SolidColorBrush NeutralBrush = (SolidColorBrush)new BrushConverter().ConvertFromString("#858585")!;

    /// <summary>Raised when the operator asks to see console run history — handled by the shell
    /// (MainWindow), which renders it via the real full-panel record workspace mechanism.</summary>
    public event Action? HistoryRequested;

    public ConsolePanelView()
    {
        InitializeComponent();
    }

    public void Initialize(
        IPowerShellConsoleService consoleService,
        ITenantModuleConnectionService tenantModuleConnectionService,
        ITenantService tenantService,
        IConsoleHistoryService historyService)
    {
        _consoleService = consoleService;
        _tenantModuleConnectionService = tenantModuleConnectionService;
        _tenantService = tenantService;
        _historyService = historyService;

        _consoleService.HostOutputReceived += line => Dispatcher.Invoke(() => Append(line));
        _consoleService.CommandExecuted += (_, record) => Dispatcher.Invoke(() =>
        {
            _lastExecutionId = record.ExecutionId;
            MarkForReportButton.IsEnabled = true;
        });
        _tenantModuleConnectionService.DeviceCodePromptDetected += code =>
            Dispatcher.Invoke(() => Append($"[device-code sign-in] {code}"));
        _tenantModuleConnectionService.ConnectionCompleted += result =>
            Dispatcher.Invoke(() => RenderTenantStatus(result));
        _tenantService.CurrentTenantChanged += (_, tenant) =>
            Dispatcher.Invoke(() => RenderTenantSelected(tenant));

        RenderTenantSelected(_tenantService.CurrentTenant);

        Append("MyArchitect hosted PowerShell console — real System.Management.Automation runspace (#3459).");
        Append("Variables and imported modules persist between commands, same as a real console session.");
    }

    private void RenderTenantSelected(Tenant? tenant)
    {
        TenantNameText.Text = tenant?.Name ?? "(none selected)";
        // A fresh tenant selection means the connect attempt hasn't resolved yet — show
        // "connecting" rather than stale state from whatever tenant was previously active.
        GraphStatusDot.Fill = NeutralBrush;
        GraphStatusText.Text = tenant == null ? "Graph: not connected" : "Graph: connecting…";
        AzStatusDot.Fill = NeutralBrush;
        AzStatusText.Text = "Az: n/a";
    }

    private void RenderTenantStatus(TenantModuleConnectionResult result)
    {
        if (_tenantService?.CurrentTenant?.Id != result.Tenant.Id) return; // stale result from a since-abandoned switch

        GraphStatusDot.Fill = result.GraphConnected ? ConnectedBrush : FailedBrush;
        GraphStatusText.Text = result.GraphConnected ? "Graph: connected" : "Graph: failed";

        if (!result.AzModuleAvailable)
        {
            AzStatusDot.Fill = NeutralBrush;
            AzStatusText.Text = "Az: not installed";
        }
        else
        {
            AzStatusDot.Fill = result.AzConnected ? ConnectedBrush : FailedBrush;
            AzStatusText.Text = result.AzConnected ? "Az: connected" : "Az: failed";
        }
    }

    /// <summary>Appends a line from outside the typed-command loop — used by Script Library's
    /// "run entries straight into the embedded Console" wiring (#3460) to surface a real
    /// POST /launch-control/execute result in the same output pane a typed command's output
    /// lands in, since that execute route runs server-side (not through this hosted runspace).</summary>
    public void AppendExternal(string line) => Dispatcher.Invoke(() => Append(line));

    private async void InputBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.M && Keyboard.Modifiers == ModifierKeys.Control)
        {
            e.Handled = true;
            ToggleMarkLastForReport();
            return;
        }

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

    private void MarkForReportButton_Click(object sender, RoutedEventArgs e) => ToggleMarkLastForReport();

    private void ToggleMarkLastForReport()
    {
        if (_historyService == null || _lastExecutionId is not { } id) return;

        var found = _historyService.ToggleMarkedForReport(id);
        if (!found)
        {
            Append("[mark for report failed — command no longer in history]");
            return;
        }

        var nowMarked = _historyService.GetAll().FirstOrDefault(r => r.ExecutionId == id)?.MarkedForReport ?? false;
        Append(nowMarked
            ? "[marked for report — will appear in Status Reports]"
            : "[unmarked]");
    }

    private void HistoryButton_Click(object sender, RoutedEventArgs e) => HistoryRequested?.Invoke();

    private void Append(string line)
    {
        _log.AppendLine(line);
        OutputText.Text = _log.ToString();
        OutputScroll.ScrollToEnd();
    }
}
