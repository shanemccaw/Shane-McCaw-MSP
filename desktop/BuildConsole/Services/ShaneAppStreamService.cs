using System;
using System.Collections.Concurrent;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Windows.Threading;

namespace BuildConsole.Services
{
    public enum ShaneAppLogLevel
    {
        Info,
        Success,
        Warning,
        Error,
        Sql,
        PowerShell,
        Test
    }

    public sealed class ShaneAppLogEntry
    {
        public DateTime Timestamp { get; set; } = DateTime.Now;
        public string Channel { get; set; } = "shaneapp";
        public ShaneAppLogLevel Level { get; set; } = ShaneAppLogLevel.Info;
        public string Message { get; set; } = "";
        public string DisplayText => $"[{Timestamp:HH:mm:ss.fff}] [{Level.ToString().ToUpperInvariant()}] {Message}";
    }

    /// <summary>
    /// Singleton tracking real-time status and output stream of all actions executed
    /// through the shaneapp:// local protocol (Web tests, SQL queries, PowerShell scripts, scans).
    /// </summary>
    public sealed class ShaneAppStreamService
    {
        private static readonly Lazy<ShaneAppStreamService> _instance = new(() => new ShaneAppStreamService());
        public static ShaneAppStreamService Instance => _instance.Value;

        private readonly object _sync = new();
        private readonly ObservableCollection<ShaneAppLogEntry> _logEntries = new();
        private Dispatcher? _dispatcher;
        private Stopwatch? _stopwatch;

        public bool IsRunning { get; private set; }
        public string CurrentAction { get; private set; } = "Idle";
        public string CurrentDetails { get; private set; } = "";
        public DateTime? StartedAt { get; private set; }
        public TimeSpan Elapsed => _stopwatch?.Elapsed ?? TimeSpan.Zero;
        public ReadOnlyObservableCollection<ShaneAppLogEntry> LogEntries { get; }

        public event Action? StatusChanged;
        public event Action<ShaneAppLogEntry>? LineAppended;

        private ShaneAppStreamService()
        {
            LogEntries = new ReadOnlyObservableCollection<ShaneAppLogEntry>(_logEntries);

            // Wire static step completions from test executors to stream real-time results
            UiTestExecutor.StepCompleted += OnTestStepCompleted;
            PowerShellTestExecutor.StepCompleted += OnTestStepCompleted;
            HttpTestExecutor.StepCompleted += OnTestStepCompleted;
            GraphTestExecutor.StepCompleted += OnTestStepCompleted;
            ZohoTestExecutor.StepCompleted += OnTestStepCompleted;

            // Wire ActivityLog
            ActivityLog.LineLogged += OnActivityLogLine;
        }

        public void Attach(Dispatcher dispatcher)
        {
            _dispatcher = dispatcher;
        }

        public void BeginRun(string action, string details = "")
        {
            lock (_sync)
            {
                IsRunning = true;
                CurrentAction = string.IsNullOrWhiteSpace(action) ? "shaneapp execution" : action;
                CurrentDetails = details;
                StartedAt = DateTime.Now;
                _stopwatch = Stopwatch.StartNew();
            }

            PostToUi(() =>
            {
                _logEntries.Add(new ShaneAppLogEntry
                {
                    Level = ShaneAppLogLevel.Info,
                    Message = $"══════ STARTED: {CurrentAction} ({DateTime.Now:yyyy-MM-dd HH:mm:ss}) ══════"
                });
                StatusChanged?.Invoke();
            });
        }

        public void AppendLine(string message, ShaneAppLogLevel level = ShaneAppLogLevel.Info, string channel = "shaneapp")
        {
            var entry = new ShaneAppLogEntry
            {
                Timestamp = DateTime.Now,
                Channel = channel,
                Level = level,
                Message = message
            };

            PostToUi(() =>
            {
                _logEntries.Add(entry);
                LineAppended?.Invoke(entry);
            });
        }

        public void UpdateDetails(string details)
        {
            lock (_sync)
            {
                CurrentDetails = details;
            }
            PostToUi(() => StatusChanged?.Invoke());
        }

        public void EndRun(bool success, string summary = "")
        {
            TimeSpan elapsed;
            lock (_sync)
            {
                IsRunning = false;
                _stopwatch?.Stop();
                elapsed = _stopwatch?.Elapsed ?? TimeSpan.Zero;
            }

            PostToUi(() =>
            {
                var level = success ? ShaneAppLogLevel.Success : ShaneAppLogLevel.Error;
                var banner = success ? "✓ COMPLETED SUCCESSFULLY" : "✗ FAILED";
                var text = $"══════ {banner}: {CurrentAction} in {elapsed.TotalSeconds:0.##}s ══════" +
                           (!string.IsNullOrWhiteSpace(summary) ? $" ({summary})" : "");
                var entry = new ShaneAppLogEntry
                {
                    Level = level,
                    Message = text
                };
                _logEntries.Add(entry);
                LineAppended?.Invoke(entry);
                StatusChanged?.Invoke();
            });
        }

        public void ClearLog()
        {
            PostToUi(() =>
            {
                _logEntries.Clear();
                _logEntries.Add(new ShaneAppLogEntry
                {
                    Level = ShaneAppLogLevel.Info,
                    Message = "Console cleared."
                });
            });
        }

        private void OnTestStepCompleted(TestStepResult step)
        {
            if (!IsRunning) return;

            var level = step.Passed ? ShaneAppLogLevel.Success : ShaneAppLogLevel.Error;
            var tag = step.Passed ? "PASS" : "FAIL";
            var msg = $"[{step.Kind.ToUpperInvariant()}] {step.Label} -> {tag} ({step.DurationMs}ms)" +
                      (!string.IsNullOrWhiteSpace(step.Detail) ? $" :: {step.Detail}" : "");
            AppendLine(msg, level, "test-runner");
        }

        private void OnActivityLogLine(string line)
        {
            if (!IsRunning) return;

            // Only stream lines from relevant channels during active run
            if (line.Contains("[sql-runner") || line.Contains("[testing.") || line.Contains("[powershell") || line.Contains("[shaneapp"))
            {
                var level = ShaneAppLogLevel.Info;
                if (line.Contains("fail") || line.Contains("error") || line.Contains("exception"))
                    level = ShaneAppLogLevel.Error;
                else if (line.Contains("pass") || line.Contains("success") || line.Contains("OK"))
                    level = ShaneAppLogLevel.Success;
                else if (line.Contains("sql"))
                    level = ShaneAppLogLevel.Sql;
                else if (line.Contains("powershell"))
                    level = ShaneAppLogLevel.PowerShell;

                AppendLine(line, level, "activity-log");
            }
        }

        private void PostToUi(Action action)
        {
            if (_dispatcher != null && !_dispatcher.CheckAccess())
            {
                _dispatcher.BeginInvoke(action);
            }
            else
            {
                action();
            }
        }
    }
}
