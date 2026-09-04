using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

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
    public partial class TerminalView : UserControl, IChatSendableTool
    {
        private Services.BuildTrackerApiClient? _api;
        private Services.PausableTextBoxLog? _pausableLog;
        private System.Diagnostics.Process? _shell;

        // ── Git #2774 — reusable multi-line queued execution ──────────────────────────────
        // A sent command block runs as a real sequence: each line executes, and the NEXT line only
        // starts once the current command genuinely completes. Completion is detected with a per-step
        // sentinel: after writing a command to the shell's stdin, we write a second stdin line that
        // echoes a unique token to stdout — because PowerShell reads and runs stdin lines strictly in
        // order, that echo can only appear AFTER the command has returned, so its arrival is a genuine
        // "this command finished" signal (and it carries $?/$LASTEXITCODE for pass/fail). This is a
        // general TerminalView capability (RunQueue), not tied to any one caller.
        private const string SentinelPrefix = "__BT_STEP_DONE__";
        private readonly ObservableCollection<TerminalQueueStep> _queueSteps = new();
        private string? _runningToken;
        private TerminalQueueStep? _runningStep;

        public TerminalView()
        {
            InitializeComponent();
            QueueList.ItemsSource = _queueSteps;
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
            Dispatcher.Invoke(() =>
            {
                // Git #2774 — a queued-step completion sentinel is consumed here (advance the queue) and
                // NOT echoed to the output pane; every other line renders normally.
                if (line.Contains(SentinelPrefix, StringComparison.Ordinal))
                {
                    HandleStepSentinel(line);
                    return;
                }
                AppendLine(line);
            });
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

        /// <summary>
        /// Git #2783 — <see cref="IChatSendableTool"/>. Real judgement call on which content to
        /// send: a real, non-empty selection in the output pane wins (Shane deliberately selected
        /// that text), otherwise falls back to the pane's full real output history so far. Never
        /// fabricated — both paths read straight out of <see cref="OutputBox"/>'s actual text.
        /// </summary>
        public string? GetSendableContent()
        {
            string selected = OutputBox.SelectedText;
            if (!string.IsNullOrWhiteSpace(selected)) return selected;
            string all = OutputBox.Text;
            return string.IsNullOrWhiteSpace(all) ? null : all;
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
                Send_Click(sender, e);
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

        // ── Git #2774 — reusable multi-line queued execution ──────────────────────────────

        /// <summary>Run a (possibly multi-line) command block as a real queued sequence: each command
        /// line executes and the NEXT only starts once the current one genuinely completes. This is the
        /// single public entry for the capability — a caller hands it the block's raw text and the view
        /// handles splitting, sequencing, completion detection and per-step status. Safe to call again
        /// while a queue is running: the new lines are appended to the tail and run in turn.</summary>
        public void RunQueue(string rawText)
        {
            var commands = SplitCommands(rawText);
            if (commands.Count == 0)
            {
                AppendLine("[send to Terminal: no runnable command lines found]");
                return;
            }

            EnsureShell();
            if (_shell == null || _shell.HasExited)
            {
                AppendLine("[failed to start shell — cannot run queued commands]");
                return;
            }

            // A fresh queue (nothing running, nothing pending) clears the finished history so the panel
            // shows only this batch; otherwise the new steps are appended to the live queue's tail.
            bool active = _runningToken != null || _queueSteps.Any(s => s.Status == "queued");
            if (!active) _queueSteps.Clear();

            foreach (var c in commands)
                _queueSteps.Add(new TerminalQueueStep(c));

            QueuePanel.Visibility = Visibility.Visible;
            UpdateQueueHeader();
            TryStartNext();
        }

        private void EnsureShell()
        {
            if (_shell != null && !_shell.HasExited) return;
            string repoRoot = Services.BuildTrackerConfig.FindRepoRoot() ?? Environment.CurrentDirectory;
            AppendLine("[shell not running — restarting shell]");
            AppendLine($"[restarting in {repoRoot}]");
            StartShell(repoRoot);
        }

        /// <summary>Starts the next queued step if none is currently in flight. Writes the command to the
        /// shell, then a sentinel-echo line whose stdout arrival (see <see cref="HandleStepSentinel"/>)
        /// signals genuine completion and drives the advance to the following step.</summary>
        private void TryStartNext()
        {
            if (_runningToken != null) return; // a step is already running

            var next = _queueSteps.FirstOrDefault(s => s.Status == "queued");
            if (next == null) { UpdateQueueHeader(); return; }

            if (_shell == null || _shell.HasExited)
            {
                EnsureShell();
                if (_shell == null || _shell.HasExited)
                {
                    next.SetStatus("failed", "shell unavailable");
                    UpdateQueueHeader();
                    return;
                }
            }

            string token = "S" + Guid.NewGuid().ToString("N");
            _runningToken = token;
            _runningStep = next;
            next.SetStatus("running", "");
            UpdateQueueHeader();

            AppendLine($"> {next.Command}");
            try
            {
                _shell.StandardInput.WriteLine(next.Command);
                // Captured on the line AFTER the command, so $?/$LASTEXITCODE reflect that command, and
                // the echo can only reach stdout once it has returned — a real per-step completion tick.
                _shell.StandardInput.WriteLine(
                    $"$__bt_ok=$?; $__bt_ec=$LASTEXITCODE; Write-Output \"{SentinelPrefix}:{token}:$__bt_ok:$__bt_ec\"");
                _shell.StandardInput.Flush();
            }
            catch (Exception ex)
            {
                next.SetStatus("failed", ex.Message);
                _runningToken = null;
                _runningStep = null;
                UpdateQueueHeader();
                TryStartNext();
            }
        }

        private void HandleStepSentinel(string line)
        {
            int idx = line.IndexOf(SentinelPrefix, StringComparison.Ordinal);
            string payload = line.Substring(idx + SentinelPrefix.Length).TrimStart(':');
            var parts = payload.Split(':');
            string token = parts.Length > 0 ? parts[0].Trim() : "";
            if (token != _runningToken) return; // stale/foreign sentinel — ignore

            bool ok = parts.Length > 1 && parts[1].Trim().Equals("True", StringComparison.OrdinalIgnoreCase);
            string ecRaw = parts.Length > 2 ? parts[2].Trim() : "";
            bool hasEc = int.TryParse(ecRaw, out int ec);

            var step = _runningStep;
            _runningToken = null;
            _runningStep = null;

            if (step != null)
            {
                bool failed = !ok || (hasEc && ec != 0);
                if (failed) step.SetStatus("failed", hasEc && ec != 0 ? $"exit {ec}" : "failed");
                else step.SetStatus("done", "");
            }

            UpdateQueueHeader();
            TryStartNext();
        }

        private void UpdateQueueHeader()
        {
            int running = _queueSteps.Count(s => s.Status == "running");
            int queued = _queueSteps.Count(s => s.Status == "queued");
            int done = _queueSteps.Count(s => s.Status == "done");
            int failed = _queueSteps.Count(s => s.Status == "failed");
            var parts = new List<string>();
            if (running > 0) parts.Add($"{running} running");
            if (queued > 0) parts.Add($"{queued} queued");
            if (done > 0) parts.Add($"{done} done");
            if (failed > 0) parts.Add($"{failed} failed");
            QueueHeader.Text = parts.Count > 0 ? "Command queue — " + string.Join(", ", parts) : "Command queue";
        }

        private void QueueClear_Click(object sender, RoutedEventArgs e)
        {
            // Stops advancing the queue and hides the panel. A command already running stays alive in the
            // shell (its output keeps streaming), but its sentinel is now ignored since _runningToken is
            // cleared — the queue simply won't advance past it. Still-queued steps are dropped.
            _queueSteps.Clear();
            _runningToken = null;
            _runningStep = null;
            QueuePanel.Visibility = Visibility.Collapsed;
        }

        /// <summary>Splits a raw command block into individual command lines: blank lines and #-comment
        /// lines are dropped, and a trailing PowerShell backtick or POSIX backslash joins a line with the
        /// next (a real line continuation) rather than being run as two commands.</summary>
        private static List<string> SplitCommands(string rawText)
        {
            var result = new List<string>();
            if (string.IsNullOrWhiteSpace(rawText)) return result;

            var lines = rawText.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n');
            string pending = "";
            foreach (var raw in lines)
            {
                string line = raw.TrimEnd();
                string head = line.TrimStart();
                if (pending.Length == 0 && (head.Length == 0 || head.StartsWith("#")))
                    continue; // skip blanks / comment lines between commands
                if (line.EndsWith("`") || line.EndsWith("\\"))
                {
                    pending += line.Substring(0, line.Length - 1) + " ";
                    continue;
                }
                string full = (pending + line).Trim();
                pending = "";
                if (full.Length > 0) result.Add(full);
            }
            if (pending.Trim().Length > 0) result.Add(pending.Trim());
            return result;
        }
    }

    /// <summary>Git #2774 — one row in the Terminal's command queue panel. Status drives the glyph/colour
    /// via <see cref="INotifyPropertyChanged"/> so a step re-renders in place as it moves
    /// queued → running → done/failed.</summary>
    public sealed class TerminalQueueStep : INotifyPropertyChanged
    {
        private static readonly Brush QueuedBrush = Frozen(0x6C, 0x70, 0x86); // gray
        private static readonly Brush RunningBrush = Frozen(0x89, 0xB4, 0xFA); // blue
        private static readonly Brush DoneBrush = Frozen(0xA6, 0xE3, 0xA1); // green
        private static readonly Brush FailedBrush = Frozen(0xF3, 0x8B, 0xA8); // red

        private static Brush Frozen(byte r, byte g, byte b)
        {
            var br = new SolidColorBrush(Color.FromRgb(r, g, b));
            br.Freeze();
            return br;
        }

        private string _status = "queued";
        private string _detail = "";

        public TerminalQueueStep(string command) { Command = command; }

        public string Command { get; }
        public string Status => _status;
        public string Detail => _detail;

        public void SetStatus(string status, string detail)
        {
            _status = status;
            _detail = detail ?? "";
            OnChanged(nameof(StatusGlyph));
            OnChanged(nameof(StatusBrush));
            OnChanged(nameof(Detail));
        }

        public string StatusGlyph => _status switch
        {
            "running" => "▶",
            "done" => "✓",
            "failed" => "✗",
            _ => "○",
        };

        public Brush StatusBrush => _status switch
        {
            "running" => RunningBrush,
            "done" => DoneBrush,
            "failed" => FailedBrush,
            _ => QueuedBrush,
        };

        public event PropertyChangedEventHandler? PropertyChanged;
        private void OnChanged(string name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
