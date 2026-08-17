using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Shane: "that terminal is supposed to send the commands to the Replit
    /// server." Was previously wired to a LOCAL PowerShell process on
    /// Shane's own machine (RedirectStandard{Input,Output,Error}) — real
    /// output, but the wrong machine. Now a real POST to the SAME free-text
    /// deploy-console endpoint the admin panel's own floating console
    /// already uses (`POST /admin/simulator/deploy/console`,
    /// `admin-deploy-console.ts`): the command runs via child_process.exec
    /// ON the Replit dev server itself (cwd = repo root), and the real
    /// stdout/stderr comes back over HTTP. One command per round-trip (no
    /// persistent shell/session state server-side — each Send is its own
    /// exec), same as that endpoint's own contract.
    /// </summary>
    public partial class TerminalView : UserControl
    {
        private Services.BuildTrackerApiClient? _api;
        private Services.PausableTextBoxLog? _pausableLog;
        private bool _busy;

        public TerminalView()
        {
            InitializeComponent();
            OutputBox.Text = "BuildConsole Terminal — not connected yet.\r\n";
            _pausableLog = new Services.PausableTextBoxLog(OutputBox);
        }

        /// <summary>Called once from MainWindow alongside every other panel's Initialize(_buildTrackerApi).</summary>
        public void Initialize(Services.BuildTrackerApiClient api)
        {
            _api = api;
            AppendLine(api.IsConfigured
                ? "Connected — commands run on the Replit dev server (POST /admin/simulator/deploy/console)."
                : "Build Tracker API isn't configured — set apiBaseUrl/ingestToken in Settings before sending commands.");
        }

        private void AppendLine(string text)
        {
            _pausableLog?.Append(text + "\r\n");
        }

        private void PauseToggle_Click(object sender, RoutedEventArgs e)
        {
            _pausableLog?.Toggle();
            PauseButton.Content = _pausableLog is { IsPaused: true } ? "▶ Resume" : "⏸ Pause";
        }

        /// <summary>Set the command input text (called from MainWindow menu actions).</summary>
        public void SetCommand(string command)
        {
            InputBox.Text = command;
            InputBox.CaretIndex = InputBox.Text.Length;
            InputBox.Focus();
        }

        // Quick-command chip → paste command into input field (same as before — doesn't auto-run, Shane presses Enter/Send himself)
        private void Chip_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn)
            {
                InputBox.Text = btn.Tag?.ToString() ?? string.Empty;
                InputBox.CaretIndex = InputBox.Text.Length;
                InputBox.Focus();
            }
        }

        private void InputBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Return)
            {
                Send_Click(sender, e);
                e.Handled = true;
            }
        }

        // ── Git #945 — right-click menu (Copy, Copy All, Clear, Scroll to Bottom) ──
        private void CopyOutput_Click(object sender, RoutedEventArgs e)
        {
            if (!string.IsNullOrEmpty(OutputBox.SelectedText)) Clipboard.SetText(OutputBox.SelectedText);
        }

        private void CopyAllOutput_Click(object sender, RoutedEventArgs e)
        {
            if (OutputBox.Text.Length > 0) Clipboard.SetText(OutputBox.Text);
        }

        private void ClearOutput_Click(object sender, RoutedEventArgs e)
        {
            OutputBox.Clear();
        }

        private void ScrollToBottom_Click(object sender, RoutedEventArgs e)
        {
            OutputBox.ScrollToEnd();
        }

        private async void Send_Click(object sender, RoutedEventArgs e)
        {
            var cmd = InputBox.Text.Trim();
            if (string.IsNullOrEmpty(cmd)) return;
            if (_busy) return;

            AppendLine($"> {cmd}");
            InputBox.Clear();

            if (_api == null || !_api.IsConfigured)
            {
                AppendLine("[Build Tracker API isn't configured — set apiBaseUrl/ingestToken in Settings]");
                return;
            }

            _busy = true;
            SendButton.IsEnabled = false;
            try
            {
                var result = await _api.RunDeployConsoleCommandAsync(cmd);
                if (!string.IsNullOrEmpty(result.Output)) AppendLine(result.Output);
                if (!result.Ok) AppendLine($"[exit non-zero]");
            }
            catch (Exception ex)
            {
                AppendLine($"[failed to reach the Replit server: {ex.Message}]");
            }
            finally
            {
                _busy = false;
                SendButton.IsEnabled = true;
            }
        }
    }
}
