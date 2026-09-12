using System;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using MyArchitect.Services;
using UserControl = System.Windows.Controls.UserControl;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using MouseButtonEventArgs = System.Windows.Input.MouseButtonEventArgs;

namespace MyArchitect.Shell;

/// <summary>
/// Title-bar Log Viewer (UI_RULES.md §1, #3506) — lives in the title-bar command area, not the
/// Ribbon or either panel, same overlay convention as <see cref="CommandPaletteOverlay"/> (Esc /
/// backdrop click closes it).
///
/// Two modes:
/// - <b>Loaded (default):</b> a static render of <see cref="IConsoleHistoryService"/>'s local
///   history — nothing arrives on its own, re-rendered only when the operator opens the viewer or
///   switches back to this mode.
/// - <b>Live (explicit only):</b> the Play button starts a real subscription combining
///   <see cref="ILogStreamService"/>'s SSE stream (a real backend channel, scoped to the
///   operator's own mspId — see that service's own doc comment for why) and
///   <see cref="IPowerShellConsoleService.HostOutputReceived"/> (the same local hosted-console
///   stdout <see cref="ConsolePanelView"/> renders). Pressing Play again — or closing the
///   viewer — stops it. There is no auto-connect on open or on mode switch.
/// </summary>
public partial class LogViewerOverlay : UserControl
{
    private IConsoleHistoryService? _historyService;
    private IPowerShellConsoleService? _consoleService;
    private ILogStreamService? _logStreamService;
    private IAuthService? _authService;

    private readonly StringBuilder _liveLog = new();
    private CancellationTokenSource? _liveCts;
    private Action<string>? _consoleStdoutHandler;
    private bool _isLive;
    private bool _channelsLoaded;

    public LogViewerOverlay()
    {
        InitializeComponent();
    }

    public void Initialize(
        IConsoleHistoryService historyService,
        IPowerShellConsoleService consoleService,
        ILogStreamService logStreamService,
        IAuthService authService)
    {
        _historyService = historyService;
        _consoleService = consoleService;
        _logStreamService = logStreamService;
        _authService = authService;
    }

    public void Open()
    {
        Visibility = Visibility.Visible;
        if (LoadedModeButton.IsChecked == true) RenderLoaded();
        else RenderLive();
        Focus();
    }

    /// <summary>Closing the viewer also stops a running Live subscription — with the panel gone
    /// there is no Stop button left to press, and this app's own bounded-wait discipline
    /// (Git #2160) is that nothing holds a connection open with no way left to end it.</summary>
    public void Close()
    {
        if (_isLive) StopLive();
        Visibility = Visibility.Collapsed;
    }

    /// <summary>Called from MainWindow on window close — a real subscription must not outlive the
    /// process regardless of whether the operator remembered to press Stop.</summary>
    public void StopLiveOnShutdown()
    {
        if (_isLive) StopLive();
    }

    private void Root_MouseDown(object sender, MouseButtonEventArgs e) => Close();

    private void Panel_MouseDown(object sender, MouseButtonEventArgs e) => e.Handled = true;

    private void Root_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            Close();
            e.Handled = true;
        }
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();

    private void LoadedModeButton_Click(object sender, RoutedEventArgs e)
    {
        LoadedModeButton.IsChecked = true;
        LiveModeButton.IsChecked = false;
        ChannelComboBox.Visibility = Visibility.Collapsed;
        PlayButton.Visibility = Visibility.Collapsed;
        RenderLoaded();
    }

    private void LiveModeButton_Click(object sender, RoutedEventArgs e)
    {
        LiveModeButton.IsChecked = true;
        LoadedModeButton.IsChecked = false;
        ChannelComboBox.Visibility = Visibility.Visible;
        PlayButton.Visibility = Visibility.Visible;
        _ = EnsureChannelsLoadedAsync();
        RenderLive();
    }

    // ---- Loaded (static local history) -----------------------------------------------------

    private void RenderLoaded()
    {
        if (_historyService == null) return;

        var records = _historyService.GetAll(); // newest-first, per ConsoleHistoryService
        var sb = new StringBuilder();

        if (records.Count == 0)
        {
            sb.AppendLine("(no console history yet — run a command in the Console tab)");
        }

        foreach (var r in records)
        {
            var tenant = string.IsNullOrEmpty(r.TenantName) ? string.Empty : $"{r.TenantName} · ";
            sb.AppendLine($"[{r.StartedAtUtc:yyyy-MM-dd HH:mm:ss} UTC] {tenant}PS> {r.Command}");
            if (!string.IsNullOrEmpty(r.Output)) sb.AppendLine(Indent(r.Output.TrimEnd()));
            if (!string.IsNullOrEmpty(r.ErrorOutput)) sb.AppendLine(Indent($"[error] {r.ErrorOutput.TrimEnd()}"));
            var marked = r.MarkedForReport ? " · marked for report" : string.Empty;
            sb.AppendLine(Indent($"[{r.DurationMs}ms · {(r.Succeeded ? "ok" : "failed")}{marked}]"));
            sb.AppendLine();
        }

        OutputText.Text = sb.ToString();
        OutputScroll.ScrollToHome();
    }

    private static string Indent(string text) =>
        string.Join('\n', text.Split('\n').Select(l => "    " + l));

    // ---- Live (explicit-only SSE + local console stdout) ------------------------------------

    private async Task EnsureChannelsLoadedAsync()
    {
        if (_channelsLoaded || _logStreamService == null || _authService == null) return;

        try
        {
            _logStreamService.AuthToken = _authService.AccessToken;
            var channels = await _logStreamService.GetChannelsAsync();
            if (channels.Count == 0) return;

            ChannelComboBox.ItemsSource = channels;
            ChannelComboBox.SelectedIndex = 0;
            _channelsLoaded = true;
        }
        catch (Exception ex)
        {
            AppendLive($"[Log Viewer] Failed to load channel list: {ex.Message}");
        }
    }

    private void RenderLive()
    {
        OutputText.Text = _liveLog.Length == 0
            ? "(Live — press Play to start. Nothing arrives until you do.)"
            : _liveLog.ToString();
        OutputScroll.ScrollToEnd();
    }

    private void PlayButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isLive) StopLive();
        else StartLive();
    }

    private void StartLive()
    {
        if (_logStreamService == null || _consoleService == null || _authService == null) return;

        if (string.IsNullOrWhiteSpace(_authService.AccessToken))
        {
            AppendLive("[Log Viewer] Cannot start — not signed in.");
            return;
        }

        if (_authService.MspId is not { } mspId)
        {
            AppendLive("[Log Viewer] Cannot start — no MSP context on the current session.");
            return;
        }

        if (ChannelComboBox.SelectedItem is not string channel || string.IsNullOrWhiteSpace(channel))
        {
            AppendLive("[Log Viewer] Select a channel first.");
            return;
        }

        _logStreamService.AuthToken = _authService.AccessToken;

        _consoleStdoutHandler = line => Dispatcher.Invoke(() => AppendLive($"[console] {line}"));
        _consoleService.HostOutputReceived += _consoleStdoutHandler;

        var cts = new CancellationTokenSource();
        _liveCts = cts;
        _isLive = true;
        PlayButton.Content = "■ Stop";
        AppendLive($"[Log Viewer] Live — subscribed to channel \"{channel}\" (mspId {mspId}) + local console stdout.");

        _ = RunLiveStreamAsync(channel, mspId, cts.Token);
    }

    private async Task RunLiveStreamAsync(string channel, int mspId, CancellationToken cancellationToken)
    {
        try
        {
            await _logStreamService!.SubscribeAsync(
                channel,
                mspId,
                payload => Dispatcher.Invoke(() => AppendLive($"[{channel}] {payload}")),
                cancellationToken);

            if (!cancellationToken.IsCancellationRequested)
            {
                Dispatcher.Invoke(() => AppendLive("[Log Viewer] Stream ended (server closed the connection)."));
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on Stop / viewer close / window close — not a real failure.
        }
        catch (Exception ex)
        {
            Dispatcher.Invoke(() => AppendLive($"[Log Viewer] Stream ended: {ex.Message}"));
        }
    }

    private void StopLive()
    {
        _liveCts?.Cancel();
        _liveCts?.Dispose();
        _liveCts = null;

        if (_consoleStdoutHandler != null && _consoleService != null)
        {
            _consoleService.HostOutputReceived -= _consoleStdoutHandler;
            _consoleStdoutHandler = null;
        }

        _isLive = false;
        PlayButton.Content = "▶ Play";
        AppendLive("[Log Viewer] Stopped.");
    }

    private void AppendLive(string line)
    {
        _liveLog.AppendLine($"[{DateTimeOffset.Now:HH:mm:ss}] {line}");
        if (LiveModeButton.IsChecked == true)
        {
            OutputText.Text = _liveLog.ToString();
            OutputScroll.ScrollToEnd();
        }
    }
}
