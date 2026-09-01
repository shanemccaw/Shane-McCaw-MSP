using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace BuildConsole.Controls
{
    /// <summary>
    /// A real, persistent local <c>powershell.exe</c> process on Shane's own machine
    /// (RedirectStandard{Input,Output,Error}), started once per view and kept alive
    /// across commands — not a remote/Replit shell and not a per-command HTTP round-trip.
    /// Each Send writes a line to the process's redirected stdin and its real stdout/stderr
    /// streams back into the output pane, so shell state (cwd, env vars) persists between
    /// commands the same way an interactive terminal would.
    /// </summary>
    public partial class TerminalView : UserControl
    {
        private Services.BuildTrackerApiClient? _api;
        private Services.PausableTextBoxLog? _pausableLog;
        private System.Diagnostics.Process? _shell;

        public TerminalView()
        {
            InitializeComponent();
            // Git #1985 — was `?? @"C:\Source\ShaneMcCawConsulting\Shane-McCaw-MSP"`, a
            // hardcoded machine path that breaks on any other checkout. This is an
            // interactive shell the operator watches directly and can `cd` out of, and the
            // resolved directory is printed to the output pane below on every (re)start, so
            // a wrong-root fallback here is visible and recoverable rather than silent —
            // genuinely tolerable, unlike the DB/queue-op call sites. Fall back to the
            // process's own cwd instead of a path that only exists on one machine.
            string repoRoot = Services.BuildTrackerConfig.FindRepoRoot() ?? Environment.CurrentDirectory;
            OutputBox.Text = $"BuildConsole Terminal — PowerShell in {repoRoot}\r\n";
            _pausableLog = new Services.PausableTextBoxLog(OutputBox);
            StartShell(repoRoot);
            Unloaded += (_, _) => { try { if (_shell != null && !_shell.HasExited) _shell.Kill(); } catch { } };
        }

        private void StartShell(string repoRoot)
        {
            try
            {
                var psi = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoLogo -NoProfile",
                    WorkingDirectory = repoRoot,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                _shell = new System.Diagnostics.Process { StartInfo = psi, EnableRaisingEvents = true };
                _shell.OutputDataReceived += (_, e) => AppendOutputAsync(e.Data);
                _shell.ErrorDataReceived += (_, e) => AppendOutputAsync(e.Data);
                _shell.Exited += (_, _) => AppendOutputAsync("[shell exited]");
                _shell.Start();
                _shell.BeginOutputReadLine();
                _shell.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                AppendLine($"[couldn't start PowerShell: {ex.Message}]");
            }
        }

        private void AppendOutputAsync(string? line)
        {
            if (line == null) return;
            Dispatcher.Invoke(() => AppendLine(line));
        }

        /// <summary>Called once from MainWindow alongside every other panel's Initialize(_buildTrackerApi).</summary>
        public void Initialize(Services.BuildTrackerApiClient api)
        {
            _api = api;
            AppendLine("Connected to local machine shell.");
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

        private void Send_Click(object sender, RoutedEventArgs e)
        {
            var cmd = InputBox.Text.Trim();
            if (string.IsNullOrEmpty(cmd)) return;

            AppendLine($"> {cmd}");
            if (_shell == null || _shell.HasExited)
            {
                AppendLine("[shell not running — restarting shell]");
                // Git #1985 — same reasoning as the constructor: tolerable fallback, printed to
                // the visible output pane, no hardcoded machine path.
                string repoRoot = Services.BuildTrackerConfig.FindRepoRoot() ?? Environment.CurrentDirectory;
                AppendLine($"[restarting in {repoRoot}]");
                StartShell(repoRoot);
                if (_shell == null || _shell.HasExited)
                {
                    AppendLine("[failed to restart shell]");
                    InputBox.Clear();
                    return;
                }
            }
            try
            {
                _shell.StandardInput.WriteLine(cmd);
                _shell.StandardInput.Flush();
            }
            catch (Exception ex)
            {
                AppendLine($"[failed to send: {ex.Message}]");
            }
            InputBox.Clear();
        }
    }
}
