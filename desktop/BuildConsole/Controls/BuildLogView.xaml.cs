using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
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

        /// <summary>Git #944 — a real running build's own local per-item record, matched to a live claude.exe process by launch --name (see LaunchItem), not by queue status.</summary>
        private class RunningBuildPill
        {
            public int Id;
            public string Epic = "";
            public string Task = "";
            public string PillLabel = "";
        }

        private BuildConsole.Services.BuildTrackerApiClient? _api;
        private DispatcherTimer? _pillsTimer;
        private string? _lastPillsSignature;

        /// <summary>Called once from MainWindow alongside its other panel Initialize calls - needs the shared API client purely to look up id/epic/title for a live session's matching queue row, never to trust its status.</summary>
        public void Initialize(BuildConsole.Services.BuildTrackerApiClient api)
        {
            _api = api;
            _pillsTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(8) };
            _pillsTimer.Tick += async (_, _) => await RefreshRunningBuildPillsAsync();
            _pillsTimer.Start();
            _ = RefreshRunningBuildPillsAsync();
        }

        /// <summary>
        /// Git #944 — Shane: "In the open space can you add pills for every
        /// running build so I can easily switch between them... check actual
        /// running claude instances, not what the queue says." Ground truth
        /// is `claude agents --json` (real OS processes via the claude CLI
        /// itself), never the queue's own `status` field - #943 just proved
        /// that field can say "failed" while the real process keeps going.
        /// The queue IS still fetched here, but only as a lookup table for
        /// id/epic/title metadata to label a pill and to feed LoadQueueItem -
        /// never as the source of truth for whether something's running.
        /// Matched by session Name == queue item Title, since LaunchItem
        /// passes `--name &lt;item.Title&gt;` for every non-resumed launch -
        /// a session with no matching title (this very Claude Code session
        /// included) simply gets no pill, which is correct: it isn't a
        /// queue-launched build.
        /// </summary>
        private async Task RefreshRunningBuildPillsAsync()
        {
            if (_api == null) return;

            List<Services.ClaudeAgentSession> sessions;
            try { sessions = await Services.ClaudeAgentsService.ListActiveSessionsAsync(); }
            catch { return; } // best-effort - a shell-out hiccup shouldn't blank out what's already shown

            List<Services.QueueItem> queueItems;
            try { queueItems = await _api.GetQueueAsync(); }
            catch { return; }

            var byTitle = queueItems.Where(i => !string.IsNullOrWhiteSpace(i.Title))
                                     .GroupBy(i => i.Title)
                                     .ToDictionary(g => g.Key, g => g.OrderByDescending(i => i.UpdatedAt).First());

            var pills = new List<RunningBuildPill>();
            foreach (var session in sessions)
            {
                if (string.IsNullOrWhiteSpace(session.Name)) continue;
                if (!byTitle.TryGetValue(session.Name, out var item)) continue;

                pills.Add(new RunningBuildPill
                {
                    Id = item.Id,
                    Epic = item.GithubNumber.HasValue ? $"#{item.GithubNumber}" : "",
                    Task = item.Title,
                    PillLabel = item.GithubNumber.HasValue ? $"#{item.GithubNumber}" : item.Title,
                });
            }

            var signature = string.Join("|", pills.Select(p => p.Id)) + $"@{_currentId}";
            if (signature == _lastPillsSignature) return;
            _lastPillsSignature = signature;

            RunningPillsPanel.Items.Clear();
            foreach (var pill in pills)
            {
                var btn = new Button
                {
                    Content = pill.PillLabel,
                    Tag = pill,
                    Margin = new Thickness(0, 0, 6, 0),
                    Padding = new Thickness(8, 2, 8, 2),
                    FontSize = 11,
                    Cursor = System.Windows.Input.Cursors.Hand,
                    Background = pill.Id == _currentId
                        ? (Brush)Application.Current.FindResource("BlueBrush")
                        : (Brush)Application.Current.FindResource("Surface1Brush"),
                    Foreground = pill.Id == _currentId
                        ? (Brush)Application.Current.FindResource("CrustBrush")
                        : (Brush)Application.Current.FindResource("TextBrush"),
                    BorderThickness = new Thickness(0),
                };
                btn.Click += (s, e) =>
                {
                    var p = (RunningBuildPill)((Button)s!).Tag;
                    LoadQueueItem(p.Id, p.Epic, p.Task, "running", null);
                };
                RunningPillsPanel.Items.Add(btn);
            }
        }

        /// <summary>Git #944 — cheap in-place highlight refresh (no re-fetch) so clicking a pill visibly marks it active immediately, instead of waiting up to 8s for the next full poll.</summary>
        private void UpdatePillHighlight()
        {
            foreach (var obj in RunningPillsPanel.Items)
            {
                if (obj is not Button { Tag: RunningBuildPill pill } btn) continue;
                btn.Background = pill.Id == _currentId
                    ? (Brush)Application.Current.FindResource("BlueBrush")
                    : (Brush)Application.Current.FindResource("Surface1Brush");
                btn.Foreground = pill.Id == _currentId
                    ? (Brush)Application.Current.FindResource("CrustBrush")
                    : (Brush)Application.Current.FindResource("TextBrush");
            }
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
            UpdatePillHighlight();

            _tailTimer?.Stop();
            if (status.Equals("running", StringComparison.OrdinalIgnoreCase))
            {
                _tailTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1.5) };
                _tailTimer.Tick += (_, _) => LoadNow();
                _tailTimer.Start();
            }
        }

        // ── Git #945 — right-click menu (Copy, Copy All, Clear Log) ─────────
        private void CopyLog_Click(object sender, RoutedEventArgs e)
        {
            if (!string.IsNullOrEmpty(RawLogBox.SelectedText)) Clipboard.SetText(RawLogBox.SelectedText);
        }

        private void CopyAllLog_Click(object sender, RoutedEventArgs e)
        {
            if (RawLogBox.Text.Length > 0) Clipboard.SetText(RawLogBox.Text);
        }

        private void ClearLog_Click(object sender, RoutedEventArgs e)
        {
            RawLogBox.Clear();
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
