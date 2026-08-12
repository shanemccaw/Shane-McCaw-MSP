using System;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Shane: "Feel free to change anything to patch how I actually work based
    /// on the Add-In." Was honestly labeled "UI-only mock, backend wiring
    /// pending" before this — now a real persistent PowerShell process
    /// (RedirectStandard{Input,Output,Error}), same idea LeftSidebar's own
    /// RunGitCommand() already uses for one-shot git commands, just kept
    /// alive across multiple commands instead of started fresh each time.
    /// </summary>
    public partial class TerminalView : UserControl
    {
        private const string RootWorkspacePath = @"C:\Source\ShaneMcCawConsulting\Shane-McCaw-MSP";
        private Process? _shell;

        public TerminalView()
        {
            InitializeComponent();
            OutputBox.Text = $"BuildConsole Terminal — PowerShell in {RootWorkspacePath}\r\n";
            StartShell();
            Unloaded += (_, _) => { try { if (_shell != null && !_shell.HasExited) _shell.Kill(); } catch { } };
        }

        private void StartShell()
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoLogo -NoProfile",
                    WorkingDirectory = RootWorkspacePath,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                _shell = new Process { StartInfo = psi, EnableRaisingEvents = true };
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

        private void AppendLine(string text)
        {
            OutputBox.AppendText(text + "\r\n");
            OutputBox.ScrollToEnd();
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

        private void Send_Click(object sender, RoutedEventArgs e)
        {
            var cmd = InputBox.Text.Trim();
            if (string.IsNullOrEmpty(cmd)) return;

            AppendLine($"> {cmd}");
            if (_shell == null || _shell.HasExited)
            {
                AppendLine("[shell not running — restart BuildConsole]");
                InputBox.Clear();
                return;
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
