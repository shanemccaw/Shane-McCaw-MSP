using System;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #819 — Shane: "How do I see the status of one running? And then
    /// one fail exit 1 #806" — this was 100% Shane's own hardcoded demo
    /// data (fabricated "18:04:01" timestamps, fake tool calls) that never
    /// reflected anything real, so there was genuinely no way to answer
    /// that question from here before. Now reads the SAME per-item log file
    /// scripts/build-queue-watcher.ps1 and Services/QueueWatcherService.cs
    /// both write to (Services/BuildLogPaths), tailing it live while the
    /// item is running.
    /// </summary>
    public partial class BuildLogView : UserControl
    {
        private static readonly SolidColorBrush BlueBrush  = Frozen(0x89, 0xB4, 0xFA);
        private static readonly SolidColorBrush GreenBrush = Frozen(0xA6, 0xE3, 0xA1);
        private static readonly SolidColorBrush RedBrush   = Frozen(0xF3, 0x8B, 0xA8);
        private static readonly SolidColorBrush Subtext    = Frozen(0xBA, 0xC2, 0xDE);

        private static SolidColorBrush Frozen(byte r, byte g, byte b)
        {
            var b2 = new SolidColorBrush(Color.FromRgb(r, g, b));
            b2.Freeze();
            return b2;
        }

        private DispatcherTimer? _tailTimer;
        private int _currentId;
        private long _tailedLength;

        public BuildLogView()
        {
            InitializeComponent();
        }

        public void LoadQueueItem(int id, string epic, string task, string status, int? exitCode)
        {
            EmptyState.Visibility = Visibility.Collapsed;
            EpicLabel.Text = epic;
            TaskLabel.Text = task;
            StatusBadgeText.Text = exitCode == -2 ? $"{status} (orphaned by app restart)" : exitCode.HasValue ? $"{status} (exit {exitCode})" : status;
            ElapsedLabel.Text = "";

            var (dot, verb, badgeColor) = status.ToLowerInvariant() switch
            {
                "running" => (BlueBrush, "BUILDING", BlueBrush),
                "queued"  => (Subtext, "QUEUED", Subtext),
                "done"    => (GreenBrush, "DONE", GreenBrush),
                "failed"  => (RedBrush, "FAILED", RedBrush),
                _         => (Subtext, status.ToUpperInvariant(), Subtext),
            };
            HeaderDot.Fill = dot;
            HeaderVerb.Text = verb;
            StatusBadgeText.Foreground = badgeColor;

            _currentId = id;
            _tailedLength = 0;
            RawLogBox.Clear();
            LoadNow();

            _tailTimer?.Stop();
            if (status.Equals("running", StringComparison.OrdinalIgnoreCase))
            {
                _tailTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1.5) };
                _tailTimer.Tick += (_, _) => LoadNow();
                _tailTimer.Start();
            }
        }

        private void LoadNow()
        {
            var path = Services.BuildLogPaths.ForQueueItem(_currentId);
            try
            {
                if (!File.Exists(path))
                {
                    if (RawLogBox.Text.Length == 0) RawLogBox.Text = "(no log file yet — the watcher hasn't claimed this item, or it predates the log-file convention)";
                    return;
                }
                using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                if (fs.Length < _tailedLength) { RawLogBox.Clear(); _tailedLength = 0; } // file got truncated/reused
                if (fs.Length <= _tailedLength) return;
                fs.Seek(_tailedLength, SeekOrigin.Begin);
                using var reader = new StreamReader(fs);
                RawLogBox.AppendText(reader.ReadToEnd());
                _tailedLength = fs.Length;
                RawLogBox.ScrollToEnd();
            }
            catch (Exception ex)
            {
                if (RawLogBox.Text.Length == 0) RawLogBox.Text = $"(couldn't read log: {ex.Message})";
            }
        }
    }
}
