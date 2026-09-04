using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Log Peek — the chat document tool rail's 280px flyout (Git #2787, sub-issue of
    /// #2784, Feature: Log Viewer). Port of ShaneBuilder's LogPeekPanel code-behind
    /// (desktop/ShaneBuilder/MainWindow.xaml.cs:8425-8520) onto BuildConsole's real,
    /// already-ported <see cref="LogService"/> contract (Git #2785). See LogPeekView.xaml's
    /// header comment for why this is its own real UserControl instance rather than
    /// sharing live state with <see cref="LogViewerDocumentView"/> (#2786) the way
    /// ShaneBuilder's single-window original did.
    ///
    /// Implements <see cref="IChatSendableTool"/> (Git #2783) — checking a line here is
    /// this tool's real "pin for send" gesture (same UX as ShaneBuilder's own checkbox
    /// list; that original had no separate star/pin affordance in the peek panel, only
    /// the full document did). <see cref="GetSendableContent"/> hands the rail header's
    /// generic Send-to-Chat icon a fenced ```log block of whatever is currently checked.
    /// </summary>
    public partial class LogPeekView : UserControl, IChatSendableTool
    {
        private static readonly FontFamily MonoFont = new("Cascadia Code, Consolas, Courier New");

        private readonly LogService _logService = new();
        private bool _loaded;

        private LogStreamMode _streamMode = LogStreamMode.Cold;
        private CancellationTokenSource? _streamCts;
        private DispatcherTimer? _burstTimer;
        private DispatcherTimer? _renderPumpTimer;
        private volatile bool _bufferDirty;
        private int _burstSecondsLeft;
        private const int LogBurstDefaultSeconds = 30;

        private readonly List<LogLine> _liveBuffer = new();
        private readonly object _bufferLock = new();
        private List<LogLine> _displayed = new();

        private readonly HashSet<string> _enabledSourceIds = new(LogService.Sources.Select(s => s.Id));
        private string _searchText = "";

        /// <summary>The real "pin for send" set — checked lines, sent as one fenced block
        /// via the rail header's generic Send-to-Chat icon (#2783). Deliberately NOT
        /// cleared after a send: <see cref="IChatSendableTool"/> has no post-send
        /// callback, so clearing here would silently drop the selection out from under a
        /// user who is mid-review of what they just sent — leaving it checked lets them
        /// send the same block again or add more before unchecking themselves.</summary>
        private readonly HashSet<LogLine> _checked = new();

        public LogPeekView()
        {
            InitializeComponent();
            Loaded += (s, e) => EnsureLoaded();
            Unloaded += (s, e) => StopStream(); // rail closed/tab torn down — never leave a poll loop running
        }

        private void EnsureLoaded()
        {
            if (!_loaded)
            {
                _loaded = true;
                RefreshQuery();
            }
            RenderSourceChips();
            RenderStreamSwitch();
            RenderStatusPill();
            RenderLines();
        }

        private Brush SourceBrush(string sourceId)
        {
            var src = LogService.Sources.FirstOrDefault(s => s.Id == sourceId);
            return new SolidColorBrush(src?.Colour ?? ((SolidColorBrush)FindResource("Subtext0Brush")).Color);
        }

        private Brush LevelBrush(LogLevel level) => (Brush)FindResource(level switch
        {
            LogLevel.Trace => "OverlayBrush",
            LogLevel.Debug => "Subtext1Brush",
            LogLevel.Info => "BlueBrush",
            LogLevel.Warn => "YellowBrush",
            LogLevel.Error => "RedBrush",
            LogLevel.Fatal => "MaroonBrush",
            _ => "BlueBrush"
        });

        private List<LogLine> SnapshotLiveBuffer() { lock (_bufferLock) { return _liveBuffer.ToList(); } }

        private List<LogLine> CurrentLoadedLines() => _streamMode == LogStreamMode.Cold ? _displayed : SnapshotLiveBuffer();

        // ── Source chips ─────────────────────────────────────────────────────
        private void RenderSourceChips()
        {
            LogPeekSourceChips.Children.Clear();
            foreach (var src in LogService.Sources)
            {
                bool enabled = _enabledSourceIds.Contains(src.Id);
                var chip = new Border
                {
                    Margin = new Thickness(0, 0, 4, 4),
                    Padding = new Thickness(6, 2, 6, 2),
                    CornerRadius = new CornerRadius(8),
                    Cursor = Cursors.Hand,
                    Background = enabled ? new SolidColorBrush(src.Colour) { Opacity = 0.22 } : (Brush)FindResource("Surface0Brush"),
                    BorderBrush = new SolidColorBrush(src.Colour),
                    BorderThickness = new Thickness(1),
                    Child = new TextBlock
                    {
                        Text = src.Label,
                        FontSize = 8.5,
                        Foreground = enabled ? new SolidColorBrush(src.Colour) : (Brush)FindResource("Subtext0Brush")
                    }
                };
                chip.MouseLeftButtonDown += (s, e) => ToggleSource(src.Id);
                LogPeekSourceChips.Children.Add(chip);
            }
        }

        private void ToggleSource(string sourceId)
        {
            if (!_enabledSourceIds.Remove(sourceId)) _enabledSourceIds.Add(sourceId);
            RenderSourceChips();
            if (_streamMode == LogStreamMode.Cold) RefreshQuery();
            else RestartStreamIfActive();
        }

        // ── COLD/BURST/LIVE ──────────────────────────────────────────────────
        private void RenderStreamSwitch()
        {
            LogPeekStreamSwitch.Children.Clear();
            foreach (var mode in new[] { LogStreamMode.Cold, LogStreamMode.Burst, LogStreamMode.Live })
            {
                bool active = _streamMode == mode;
                var btn = new Border
                {
                    Padding = new Thickness(8, 3, 8, 3),
                    Margin = new Thickness(0, 0, 2, 0),
                    CornerRadius = new CornerRadius(4),
                    Cursor = Cursors.Hand,
                    Background = active ? (Brush)FindResource("BlueBrush") : (Brush)FindResource("Surface0Brush"),
                    Child = new TextBlock
                    {
                        Text = mode.ToString().ToUpperInvariant(),
                        FontSize = 9,
                        FontWeight = FontWeights.ExtraBold,
                        Foreground = active ? Brushes.Black : (Brush)FindResource("Subtext0Brush")
                    }
                };
                btn.MouseLeftButtonDown += (s, e) => SetStreamMode(mode);
                LogPeekStreamSwitch.Children.Add(btn);
            }
        }

        private void RenderStatusPill()
        {
            LogPeekStatusPill.Text = _streamMode switch
            {
                LogStreamMode.Cold => "COLD",
                LogStreamMode.Burst => $"{_burstSecondsLeft}s",
                LogStreamMode.Live => "LIVE",
                _ => ""
            };
            LogPeekStatusPill.Foreground = _streamMode switch
            {
                LogStreamMode.Live => (Brush)FindResource("GreenBrush"),
                LogStreamMode.Burst => (Brush)FindResource("PeachBrush"),
                _ => (Brush)FindResource("Subtext0Brush")
            };
        }

        private void SetStreamMode(LogStreamMode mode)
        {
            StopStream();
            _streamMode = mode;

            if (mode != LogStreamMode.Cold)
            {
                lock (_bufferLock) { _liveBuffer.Clear(); _liveBuffer.AddRange(_displayed); }

                _streamCts = new CancellationTokenSource();
                var ct = _streamCts.Token;
                _ = Task.Run(() => ConsumeTailAsync(ct));

                _renderPumpTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
                _renderPumpTimer.Tick += (s, e) =>
                {
                    if (!_bufferDirty) return;
                    _bufferDirty = false;
                    RenderLines();
                };
                _renderPumpTimer.Start();

                if (mode == LogStreamMode.Burst)
                {
                    _burstSecondsLeft = LogBurstDefaultSeconds;
                    _burstTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
                    _burstTimer.Tick += (s, e) =>
                    {
                        _burstSecondsLeft--;
                        RenderStatusPill();
                        // BURST self-cancels back to COLD when the countdown hits zero — same
                        // "done-when" criterion the full Log Viewer (#2786) already honors.
                        if (_burstSecondsLeft <= 0) SetStreamMode(LogStreamMode.Cold);
                    };
                    _burstTimer.Start();
                }
            }

            RenderStatusPill();
            RenderStreamSwitch();
            if (mode == LogStreamMode.Cold) RenderLines();
        }

        private void StopStream()
        {
            _burstTimer?.Stop(); _burstTimer = null;
            _renderPumpTimer?.Stop(); _renderPumpTimer = null;
            _streamCts?.Cancel(); _streamCts = null;
        }

        private void RestartStreamIfActive()
        {
            if (_streamMode == LogStreamMode.Cold) return;
            var mode = _streamMode;
            SetStreamMode(mode);
        }

        private async Task ConsumeTailAsync(CancellationToken ct)
        {
            try
            {
                await foreach (var line in _logService.Tail(_enabledSourceIds, ct))
                {
                    if (ct.IsCancellationRequested) break;
                    lock (_bufferLock)
                    {
                        _liveBuffer.Add(line);
                        if (_liveBuffer.Count > 2000) _liveBuffer.RemoveAt(0);
                    }
                    _bufferDirty = true;
                }
            }
            catch (OperationCanceledException) { /* expected on stop/mode-switch */ }
            catch { /* a streaming hiccup must never crash the app */ }
        }

        // ── COLD query ────────────────────────────────────────────────────────
        private void RefreshQuery()
        {
            var sourceIds = _enabledSourceIds.Count == LogService.Sources.Count ? null : _enabledSourceIds.ToArray();
            var q = new LogQuery(null, false, null, null, sourceIds, null, null, null);
            _displayed = _logService.Query(q).ToList();
            if (_streamMode == LogStreamMode.Cold) RenderLines();
        }

        // ── Lines ─────────────────────────────────────────────────────────────
        private void RenderLines()
        {
            LogPeekLinesPanel.Children.Clear();

            var lines = CurrentLoadedLines()
                .Where(l => string.IsNullOrWhiteSpace(_searchText) || l.Message.Contains(_searchText, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(l => l.Ts)
                .Take(100)
                .ToList();

            if (lines.Count == 0)
            {
                LogPeekLinesPanel.Children.Add(new TextBlock
                {
                    Text = "No lines match the current filter.",
                    FontStyle = FontStyles.Italic,
                    Margin = new Thickness(4, 6, 4, 6),
                    FontSize = 10.5,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = (Brush)FindResource("Subtext0Brush")
                });
            }

            foreach (var line in lines)
                LogPeekLinesPanel.Children.Add(BuildLineRow(line));

            UpdateSelectionStatus();
        }

        private Border BuildLevelPill(LogLine line)
        {
            var levelBrush = LevelBrush(line.Level);
            return new Border
            {
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(5, 1, 5, 1),
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Top,
                BorderThickness = new Thickness(line.LevelIsInferred ? 1 : 0),
                BorderBrush = levelBrush,
                Background = line.LevelIsInferred
                    ? Brushes.Transparent
                    : new SolidColorBrush(((SolidColorBrush)levelBrush).Color) { Opacity = 0.22 },
                ToolTip = line.LevelIsInferred
                    ? "Inferred from message text — no structured level exists for this source"
                    : "Real level from platform_log_stream",
                Child = new TextBlock
                {
                    Text = (line.LevelIsInferred ? "~" : "") + line.Level.ToString().ToUpperInvariant(),
                    Foreground = levelBrush,
                    FontFamily = MonoFont,
                    FontSize = 8,
                    FontWeight = line.LevelIsInferred ? FontWeights.Regular : FontWeights.Bold
                }
            };
        }

        private DockPanel BuildLineRow(LogLine line)
        {
            var row = new DockPanel { Margin = new Thickness(0, 0, 0, 4) };

            var cb = new CheckBox
            {
                IsChecked = _checked.Contains(line),
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 2, 4, 0)
            };
            cb.Checked += (s, e) => { _checked.Add(line); UpdateSelectionStatus(); };
            cb.Unchecked += (s, e) => { _checked.Remove(line); UpdateSelectionStatus(); };
            DockPanel.SetDock(cb, Dock.Left);
            row.Children.Add(cb);

            var dot = new Ellipse
            {
                Width = 6,
                Height = 6,
                Fill = SourceBrush(line.SourceId),
                Margin = new Thickness(0, 4, 5, 0),
                VerticalAlignment = VerticalAlignment.Top
            };
            DockPanel.SetDock(dot, Dock.Left);
            row.Children.Add(dot);

            var pill = BuildLevelPill(line);
            DockPanel.SetDock(pill, Dock.Left);
            row.Children.Add(pill);

            row.Children.Add(new TextBlock
            {
                Text = $"[{line.Ts:HH:mm:ss}] {line.Message}",
                TextWrapping = TextWrapping.Wrap,
                FontFamily = MonoFont,
                FontSize = 9.5,
                Foreground = (Brush)FindResource("TextBrush")
            });
            return row;
        }

        private void UpdateSelectionStatus()
        {
            LogPeekSelectionStatus.Text = _checked.Count == 0
                ? "Check lines below to send them to chat."
                : $"{_checked.Count} line{(_checked.Count == 1 ? "" : "s")} selected — use the rail's Send to Chat icon above.";
        }

        private void LogPeekSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            _searchText = LogPeekSearchBox.Text;
            LogPeekSearchPlaceholder.Visibility = _searchText.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
            RenderLines();
        }

        private static string FormatLine(LogLine l) =>
            $"[{l.Ts:HH:mm:ss.fff}] {(l.LevelIsInferred ? "~" : "")}{l.Level.ToString().ToUpperInvariant()} {l.SourceId}/{l.Logger}: {l.Message}";

        /// <summary>Git #2783 — the rail header calls this fresh, both to decide whether to show
        /// the Send-to-Chat icon and again immediately before the actual send. Returns null (no
        /// icon) when nothing is checked — the real "genuinely nothing to send right now" case the
        /// contract calls out, not an empty string.</summary>
        public string? GetSendableContent()
        {
            if (_checked.Count == 0) return null;
            var body = string.Join(Environment.NewLine, _checked.OrderBy(l => l.Ts).Select(FormatLine));
            return "```log\n" + body + "\n```";
        }
    }
}
