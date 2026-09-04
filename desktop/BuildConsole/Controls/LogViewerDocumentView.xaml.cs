using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
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
    /// Log Viewer — full document tab. Port of ShaneBuilder's LogViewerDock
    /// code-behind (desktop/ShaneBuilder/MainWindow.xaml.cs:7488-8424) onto
    /// BuildConsole's real, already-ported <see cref="LogService"/> contract
    /// (Git #2785). See LogViewerDocumentView.xaml's header comment for the
    /// real scope note (LogPeekPanel is a separate sibling issue, not this one).
    ///
    /// Two structural differences from the ShaneBuilder original, both purely
    /// mechanical (same behavior, different host):
    ///   - This is a real UserControl hosted as a TabItem.Content (BuildConsole's
    ///     document model), not a Visibility-toggled Grid inside one giant
    ///     MainWindow.xaml — so there is no shared "two surfaces, one state"
    ///     LogPeek wiring here; RenderLogPeek* calls are simply absent.
    ///   - Resource lookups use BuildConsole's real Catppuccin brush palette
    ///     (Themes/DarkTheme.xaml) instead of ShaneBuilder's "Brush.*" keys,
    ///     which don't exist in this app.
    /// </summary>
    public partial class LogViewerDocumentView : UserControl
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
        private List<LogLine> _lastRenderedLines = new();

        private readonly HashSet<string> _enabledSourceIds = new(LogService.Sources.Select(s => s.Id));
        private string _searchText = "";
        private bool _regex;
        private string _excludeText = "";
        private bool _highlight;
        private string? _loggerFilter;
        private readonly HashSet<LogLevel> _selectedLevels = new(Enum.GetValues<LogLevel>());
        private int _scrubberMinutesBack;

        private LogLine? _selectedLine;
        private readonly List<LogLine> _pinned = new();

        private string _railTab = "Sources";
        private readonly Dictionary<string, bool> _railGroupOpen = new() { ["Websites"] = true, ["Services"] = true, ["Local"] = true };
        private readonly HashSet<string> _archiveOpenDays = new();
        private IReadOnlyList<ArchiveNode>? _archiveCache;
        private bool _viewingArchive;

        private readonly List<(string Name, LogQuery Query)> _savedFilters = new();

        /// <summary>
        /// Git #2786 — routed through the same real active-chat composer
        /// injection MainWindow already built for the SQL Runner (#937/#940,
        /// see MainWindow.WireLogViewerSendToChat/SendTextToActiveClaudeChatAsync)
        /// rather than ShaneBuilder's clipboard-only workaround: that workaround
        /// existed there because ShaneBuilder's ClaudeChatDock had no owned
        /// composer to inject into — BuildConsole already solved that problem
        /// for a different document, so Log Viewer's "send to chat" uses the
        /// real path instead of reproducing a limitation this app doesn't have.
        /// </summary>
        public event EventHandler<string>? SendToChatRequested;

        public LogViewerDocumentView()
        {
            InitializeComponent();
            Loaded += (s, e) => EnsureLoaded();
            Unloaded += (s, e) => StopStream(); // tab closed/torn down — never leave a poll loop running
        }

        private void EnsureLoaded()
        {
            if (!_loaded)
            {
                _loaded = true;
                SeedSavedFilters();
                RefreshQuery();
            }
            RenderAll();
        }

        private void SeedSavedFilters()
        {
            _savedFilters.Add(("Graph 401s", new LogQuery("401", false, null, null, null, null, null, null)));
            _savedFilters.Add(("Drift aborts", new LogQuery("drift", false, new[] { "success" }, new[] { LogLevel.Error, LogLevel.Warn }, null, null, null, null)));
            _savedFilters.Add(("Build failures", new LogQuery("failed", false, null, new[] { LogLevel.Error, LogLevel.Fatal }, new[] { "build" }, null, null, null)));
        }

        // ── Level / source color mapping — BuildConsole's real Catppuccin
        // palette (Themes/DarkTheme.xaml), not invented resource keys. Source
        // color comes straight off LogService.Sources[].Colour (single-sourced
        // with the #2785 port) rather than a second, duplicate lookup table.
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

        private Brush SourceBrush(string sourceId)
        {
            var src = LogService.Sources.FirstOrDefault(s => s.Id == sourceId);
            return new SolidColorBrush(src?.Colour ?? ((SolidColorBrush)FindResource("Subtext0Brush")).Color);
        }

        private List<LogLine> SnapshotLiveBuffer() { lock (_bufferLock) { return _liveBuffer.ToList(); } }

        private List<LogLine> CurrentLoadedLines() => _streamMode == LogStreamMode.Cold ? _displayed : SnapshotLiveBuffer();

        // ── Top-level render ────────────────────────────────────────────────
        private void RenderAll()
        {
            RenderStreamSwitch();
            RenderStatusPill();
            RenderRail();
            RenderLevelPills();
            RenderSavedFilterChips();
            if (!_viewingArchive) RenderLines();
            RenderLineDetail();
            RenderScratchPad();
            RenderFilterChips();
        }

        private void RenderStreamSwitch()
        {
            LogViewerStreamSwitch.Children.Clear();
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
                LogViewerStreamSwitch.Children.Add(btn);
            }
        }

        private void RenderStatusPill()
        {
            bool narrow = ActualWidth > 0 && ActualWidth < 1250;
            string text = _streamMode switch
            {
                LogStreamMode.Cold => narrow ? "COLD" : "COLD · NOT STREAMING",
                LogStreamMode.Burst => narrow ? $"{_burstSecondsLeft}s" : $"BURST · {_burstSecondsLeft}s LEFT",
                LogStreamMode.Live => narrow ? "LIVE" : "LIVE · TAILING",
                _ => ""
            };
            LogViewerStatusPill.Text = text;
            LogViewerStatusPill.Foreground = _streamMode switch
            {
                LogStreamMode.Live => (Brush)FindResource("GreenBrush"),
                LogStreamMode.Burst => (Brush)FindResource("PeachBrush"),
                _ => (Brush)FindResource("Subtext0Brush")
            };
        }

        // ── Streaming — COLD/BURST/LIVE ─────────────────────────────────────
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
                    if (!_viewingArchive) RenderLines();
                    RenderRail();
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
                        // BURST self-cancels back to COLD when the countdown hits zero —
                        // the "BURST counts down and self-cancels" done-when criterion.
                        if (_burstSecondsLeft <= 0) SetStreamMode(LogStreamMode.Cold);
                    };
                    _burstTimer.Start();
                }
            }

            RenderStatusPill();
            RenderStreamSwitch();
            if (mode == LogStreamMode.Cold && !_viewingArchive) RenderLines();
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
            var secondsLeft = _burstSecondsLeft;
            SetStreamMode(mode);
            if (mode == LogStreamMode.Burst) _burstSecondsLeft = secondsLeft; // source set changed — keep the same countdown
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
                        if (_liveBuffer.Count > 5000) _liveBuffer.RemoveAt(0);
                    }
                    _bufferDirty = true;
                }
            }
            catch (OperationCanceledException) { /* expected on stop/mode-switch */ }
            catch { /* a streaming hiccup must never crash the app */ }
        }

        // ── COLD query (works regardless of streaming state) ────────────────
        private void RefreshQuery()
        {
            if (_viewingArchive) return; // archive view owns the lines panel while open
            var q = BuildCurrentQuery();
            _displayed = _logService.Query(q).ToList();
            if (_streamMode == LogStreamMode.Cold) RenderLines();
            RenderFilterChips();
        }

        private LogQuery BuildCurrentQuery()
        {
            DateTime? from = _scrubberMinutesBack > 0 ? DateTime.Now.AddMinutes(-_scrubberMinutesBack) : null;
            var excludes = string.IsNullOrWhiteSpace(_excludeText)
                ? null
                : _excludeText.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var levels = _selectedLevels.Count == Enum.GetValues<LogLevel>().Length ? null : _selectedLevels.ToArray();
            var sourceIds = _enabledSourceIds.Count == LogService.Sources.Count ? null : _enabledSourceIds.ToArray();
            // HIGHLIGHT mode dims non-matches instead of hiding them, so the search
            // text is deliberately withheld from the query itself when active —
            // RenderLines applies it client-side as a dim, not a filter.
            var text = _highlight ? null : (string.IsNullOrWhiteSpace(_searchText) ? null : _searchText);
            return new LogQuery(text, _regex, excludes, levels, sourceIds, from, null, _loggerFilter);
        }

        private bool LineMatchesSearchText(LogLine line)
        {
            if (string.IsNullOrWhiteSpace(_searchText)) return true;
            if (_regex)
            {
                try { return Regex.IsMatch(line.Message, _searchText, RegexOptions.IgnoreCase); }
                catch { return false; }
            }
            return line.Message.Contains(_searchText, StringComparison.OrdinalIgnoreCase);
        }

        // ── Center stream ─────────────────────────────────────────────────────
        private void RenderLines()
        {
            LogViewerLinesPanel.Children.Clear();

            var ordered = CurrentLoadedLines().OrderBy(l => l.Ts).TakeLast(600).ToList();
            _lastRenderedLines = ordered;

            if (ordered.Count == 0)
            {
                LogViewerLinesPanel.Children.Add(new TextBlock
                {
                    Text = "No lines match the current filter.",
                    FontStyle = FontStyles.Italic,
                    Margin = new Thickness(6),
                    FontSize = 11,
                    Foreground = (Brush)FindResource("Subtext0Brush")
                });
                return;
            }

            foreach (var line in ordered)
            {
                bool dim = _highlight && !string.IsNullOrWhiteSpace(_searchText) && !LineMatchesSearchText(line);
                LogViewerLinesPanel.Children.Add(BuildLineRow(line, dim));
            }
        }

        // An inferred level renders outline-only, never filled — a real
        // platform_log_stream level is the only one that gets the solid
        // tinted background. See InferLevel's own doc comment for why this
        // distinction is mandatory, not cosmetic.
        private Border BuildLevelPill(LogLine line, double fontSize = 9)
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
                    FontSize = fontSize,
                    FontWeight = line.LevelIsInferred ? FontWeights.Regular : FontWeights.Bold
                }
            };
        }

        private Border BuildLineRow(LogLine line, bool dim)
        {
            var sourceBrush = SourceBrush(line.SourceId);
            bool isPinned = _pinned.Contains(line);
            bool isSelected = _selectedLine != null && _selectedLine.Equals(line);
            var levelPill = BuildLevelPill(line);

            var row = new DockPanel
            {
                Margin = new Thickness(0, 1, 0, 1),
                Background = isSelected ? (Brush)FindResource("Surface0Brush") : Brushes.Transparent,
                Opacity = dim ? 0.35 : 1.0
            };

            var pin = new TextBlock
            {
                Text = isPinned ? "★" : "☆",
                Margin = new Thickness(6, 0, 6, 0),
                Cursor = Cursors.Hand,
                VerticalAlignment = VerticalAlignment.Center,
                FontSize = 11,
                Foreground = isPinned ? (Brush)FindResource("YellowBrush") : (Brush)FindResource("Subtext0Brush")
            };
            pin.MouseLeftButtonDown += (s, e) => { e.Handled = true; TogglePin(line); };
            DockPanel.SetDock(pin, Dock.Right);

            var dot = new Ellipse { Width = 6, Height = 6, Fill = sourceBrush, Margin = new Thickness(6, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center };
            var ts = new TextBlock
            {
                Text = line.Ts.ToString("HH:mm:ss.fff"), Foreground = (Brush)FindResource("Subtext0Brush"),
                FontFamily = MonoFont, FontSize = 10, Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            var msg = new TextBlock
            {
                Text = line.Message, Foreground = (Brush)FindResource("TextBrush"),
                FontFamily = MonoFont, FontSize = 13,
                TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center
            };

            DockPanel.SetDock(dot, Dock.Left);
            DockPanel.SetDock(ts, Dock.Left);
            DockPanel.SetDock(levelPill, Dock.Left);
            row.Children.Add(pin);
            row.Children.Add(dot);
            row.Children.Add(ts);
            row.Children.Add(levelPill);
            row.Children.Add(msg);

            var outer = new Border { Child = row, Padding = new Thickness(0, 2, 4, 2), Cursor = Cursors.Hand };
            outer.MouseLeftButtonDown += (s, e) => SelectLine(line);
            outer.ContextMenu = BuildLineContextMenu(line);
            return outer;
        }

        private ContextMenu BuildLineContextMenu(LogLine line)
        {
            var menu = new ContextMenu();

            void Item(string header, Action action, bool enabled)
            {
                var mi = new MenuItem { Header = header, IsEnabled = enabled };
                mi.Click += (s, e) => action();
                menu.Items.Add(mi);
            }

            Item("Copy", () => Clipboard.SetText(FormatLine(line)), true);
            Item("Copy ±3 context", () => CopyLineContext(line), true);
            Item(_pinned.Contains(line) ? "Unpin" : "Pin", () => TogglePin(line), true);
            Item("Send to chat", () => SendLinesToChat(new[] { line }), true);
            Item(string.IsNullOrEmpty(line.Logger) ? "Follow this logger" : $"Follow logger: {line.Logger}",
                () => { _loggerFilter = line.Logger; RefreshQuery(); RenderFilterChips(); }, !string.IsNullOrEmpty(line.Logger));

            return menu;
        }

        private static string FormatLine(LogLine l) =>
            $"[{l.Ts:HH:mm:ss.fff}] {(l.LevelIsInferred ? "~" : "")}{l.Level.ToString().ToUpperInvariant()} {l.SourceId}/{l.Logger}: {l.Message}";

        private void CopyLineContext(LogLine line)
        {
            int idx = _lastRenderedLines.FindIndex(l => l.Equals(line));
            if (idx < 0) { Clipboard.SetText(FormatLine(line)); return; }
            int from = Math.Max(0, idx - 3), to = Math.Min(_lastRenderedLines.Count - 1, idx + 3);
            var text = string.Join(Environment.NewLine, _lastRenderedLines.Skip(from).Take(to - from + 1).Select(FormatLine));
            Clipboard.SetText(text);
            ToastEngine.Show("Log Viewer", "Copied line with ±3 context.", ToastKind.Info);
        }

        private void SendLinesToChat(IEnumerable<LogLine> lines)
        {
            var list = lines.ToList();
            if (list.Count == 0) { ToastEngine.Show("Log Viewer", "Nothing selected.", ToastKind.Warning); return; }
            var body = string.Join(Environment.NewLine, list.Select(FormatLine));
            SendToChatRequested?.Invoke(this, "```log\n" + body + "\n```");
        }

        private void TogglePin(LogLine line)
        {
            if (_pinned.Contains(line)) _pinned.Remove(line); else _pinned.Add(line);
            RenderLines();
            RenderScratchPad();
        }

        private void SelectLine(LogLine line)
        {
            _selectedLine = line;
            RenderLines();
            RenderLineDetail();
        }

        // ── Right inspector ───────────────────────────────────────────────────
        private void RenderLineDetail()
        {
            LogViewerLineDetail.Children.Clear();
            if (_selectedLine == null)
            {
                LogViewerLineDetail.Children.Add(new TextBlock
                {
                    Text = "Select a line to see its detail.",
                    FontStyle = FontStyles.Italic, TextWrapping = TextWrapping.Wrap,
                    FontSize = 11, Foreground = (Brush)FindResource("Subtext0Brush")
                });
                return;
            }

            var l = _selectedLine;
            void Row(string label, string value)
            {
                var dock = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
                dock.Children.Add(new TextBlock
                {
                    Text = label, Width = 92, Foreground = (Brush)FindResource("Subtext0Brush"),
                    FontSize = 9.5, FontWeight = FontWeights.Bold
                });
                dock.Children.Add(new TextBlock
                {
                    Text = value, TextWrapping = TextWrapping.Wrap, Foreground = (Brush)FindResource("TextBrush"),
                    FontFamily = MonoFont, FontSize = 13
                });
                LogViewerLineDetail.Children.Add(dock);
            }

            Row("LEVEL", l.Level.ToString().ToUpperInvariant() + (l.LevelIsInferred ? " (inferred — no structured level for this source)" : " (real)"));
            Row("TIMESTAMP", l.Ts.ToString("yyyy-MM-dd HH:mm:ss.fff"));
            var src = LogService.Sources.FirstOrDefault(s => s.Id == l.SourceId);
            Row("SOURCE", src?.Label ?? l.SourceId);
            Row("LOGGER", string.IsNullOrEmpty(l.Logger) ? "—" : l.Logger);
            Row("CORRELATION ID", string.IsNullOrEmpty(l.CorrelationId) ? "—" : l.CorrelationId);

            LogViewerLineDetail.Children.Add(new TextBlock
            {
                Text = "MESSAGE", Margin = new Thickness(0, 4, 0, 4), Foreground = (Brush)FindResource("Subtext0Brush"),
                FontSize = 9.5, FontWeight = FontWeights.Bold
            });
            LogViewerLineDetail.Children.Add(new TextBox
            {
                Text = l.Message, IsReadOnly = true, TextWrapping = TextWrapping.Wrap, BorderThickness = new Thickness(0),
                Background = Brushes.Transparent, Foreground = (Brush)FindResource("TextBrush"),
                FontFamily = MonoFont, FontSize = 13
            });
        }

        private void RenderFilterChips()
        {
            LogViewerFilterChips.Children.Clear();
            void Chip(string text, Action clear)
            {
                var chip = new Border
                {
                    Margin = new Thickness(0, 0, 6, 6), Padding = new Thickness(8, 3, 6, 3), CornerRadius = new CornerRadius(10),
                    Background = (Brush)FindResource("Surface0Brush")
                };
                var row = new StackPanel { Orientation = Orientation.Horizontal };
                row.Children.Add(new TextBlock
                {
                    Text = text, FontSize = 9.5, Foreground = (Brush)FindResource("TextBrush"), VerticalAlignment = VerticalAlignment.Center
                });
                var x = new TextBlock
                {
                    Text = " ×", Cursor = Cursors.Hand, FontSize = 9.5,
                    Foreground = (Brush)FindResource("Subtext0Brush"), VerticalAlignment = VerticalAlignment.Center
                };
                x.MouseLeftButtonDown += (s, e) => clear();
                row.Children.Add(x);
                chip.Child = row;
                LogViewerFilterChips.Children.Add(chip);
            }

            if (!string.IsNullOrWhiteSpace(_searchText))
                Chip($"search: {_searchText}", () => { _searchText = ""; LogViewerSearchBox.Text = ""; RefreshQuery(); });
            if (_regex)
                Chip("regex", () => { _regex = false; RefreshQuery(); });
            if (!string.IsNullOrWhiteSpace(_excludeText))
                Chip($"exclude: {_excludeText}", () => { _excludeText = ""; LogViewerExcludeBox.Text = ""; RefreshQuery(); });
            if (!string.IsNullOrEmpty(_loggerFilter))
                Chip($"logger: {_loggerFilter}", () => { _loggerFilter = null; RefreshQuery(); });
            if (_selectedLevels.Count < Enum.GetValues<LogLevel>().Length)
                Chip($"levels: {string.Join(",", _selectedLevels)}", () =>
                {
                    _selectedLevels.Clear();
                    foreach (LogLevel lv in Enum.GetValues<LogLevel>()) _selectedLevels.Add(lv);
                    RefreshQuery(); RenderLevelPills();
                });
            if (_enabledSourceIds.Count < LogService.Sources.Count)
                Chip($"sources: {_enabledSourceIds.Count}/{LogService.Sources.Count}", () =>
                {
                    _enabledSourceIds.Clear();
                    foreach (var s in LogService.Sources) _enabledSourceIds.Add(s.Id);
                    RefreshQuery(); RenderRail();
                });

            if (LogViewerFilterChips.Children.Count == 0)
                LogViewerFilterChips.Children.Add(new TextBlock
                {
                    Text = "None", FontStyle = FontStyles.Italic, FontSize = 10, Foreground = (Brush)FindResource("Subtext0Brush")
                });
        }

        // ── Scratch pad — pinned lines survive a filter change, per the
        // "pinned lines survive a filter change and paste as one block"
        // done-when criterion: they live in _pinned, a set entirely separate
        // from _displayed/_liveBuffer, so re-filtering never touches it.
        private void RenderScratchPad()
        {
            LogViewerScratchPad.Children.Clear();
            if (_pinned.Count == 0)
            {
                LogViewerScratchPad.Children.Add(new TextBlock
                {
                    Text = "Pin a line to build a set here — it survives filter changes.",
                    TextWrapping = TextWrapping.Wrap, FontStyle = FontStyles.Italic,
                    FontSize = 10.5, Foreground = (Brush)FindResource("Subtext0Brush")
                });
                return;
            }
            foreach (var line in _pinned)
            {
                var row = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
                var unpin = new TextBlock
                {
                    Text = "✕", FontSize = 10, Cursor = Cursors.Hand, Foreground = (Brush)FindResource("Subtext0Brush"),
                    Margin = new Thickness(6, 0, 0, 0)
                };
                unpin.MouseLeftButtonDown += (s, e) => TogglePin(line);
                DockPanel.SetDock(unpin, Dock.Right);
                row.Children.Add(unpin);
                row.Children.Add(new TextBlock
                {
                    Text = FormatLine(line), TextWrapping = TextWrapping.Wrap,
                    FontFamily = MonoFont, FontSize = 10,
                    Foreground = (Brush)FindResource("TextBrush")
                });
                LogViewerScratchPad.Children.Add(row);
            }
        }

        private void LogViewerScratchCopy_Click(object sender, MouseButtonEventArgs e)
        {
            if (_pinned.Count == 0) { ToastEngine.Show("Log Viewer", "Nothing pinned.", ToastKind.Warning); return; }
            Clipboard.SetText(string.Join(Environment.NewLine, _pinned.Select(FormatLine)));
            ToastEngine.Show("Log Viewer", $"Copied {_pinned.Count} pinned line(s) as one block.", ToastKind.Success);
        }

        private void LogViewerScratchSendToChat_Click(object sender, MouseButtonEventArgs e) => SendLinesToChat(_pinned);

        // ── Filter bar ───────────────────────────────────────────────────────
        private void LogViewerSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            _searchText = LogViewerSearchBox.Text;
            LogViewerSearchPlaceholder.Visibility = _searchText.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
            if (_streamMode == LogStreamMode.Cold) RefreshQuery();
            else { RenderLines(); RenderFilterChips(); }
        }

        private void BtnLogViewerRegex_Click(object sender, RoutedEventArgs e)
        {
            _regex = !_regex;
            BtnLogViewerRegex.Background = _regex ? (Brush)FindResource("BlueBrush") : (Brush)FindResource("Surface0Brush");
            if (_streamMode == LogStreamMode.Cold) RefreshQuery();
            else { RenderLines(); RenderFilterChips(); }
        }

        private void LogViewerExcludeBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            _excludeText = LogViewerExcludeBox.Text;
            LogViewerExcludePlaceholder.Visibility = _excludeText.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
            RefreshQuery();
        }

        private void BtnLogViewerHighlight_Click(object sender, RoutedEventArgs e)
        {
            _highlight = !_highlight;
            BtnLogViewerHighlight.Background = _highlight ? (Brush)FindResource("BlueBrush") : (Brush)FindResource("Surface0Brush");
            RefreshQuery();
            RenderLines();
        }

        private void LogViewerScrubber_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            _scrubberMinutesBack = (int)e.NewValue;
            if (LogViewerScrubberReadout != null)
                LogViewerScrubberReadout.Text = _scrubberMinutesBack == 0 ? "now" : $"{_scrubberMinutesBack}m back";
            if (_streamMode == LogStreamMode.Cold) RefreshQuery();
        }

        private void LogViewerSaveCurrentFilter_Click(object sender, MouseButtonEventArgs e)
        {
            var name = $"Filter {_savedFilters.Count + 1}";
            _savedFilters.Add((name, BuildCurrentQuery()));
            RenderSavedFilterChips();
            ToastEngine.Show("Log Viewer", $"Saved as \"{name}\".", ToastKind.Success);
        }

        private void RenderSavedFilterChips()
        {
            LogViewerSavedFilters.Children.Clear();
            foreach (var (name, query) in _savedFilters)
            {
                var chip = new Border
                {
                    Margin = new Thickness(0, 0, 6, 0), Padding = new Thickness(8, 3, 8, 3), CornerRadius = new CornerRadius(10), Cursor = Cursors.Hand,
                    Background = (Brush)FindResource("Surface0Brush"),
                    Child = new TextBlock { Text = name, FontSize = 9.5, Foreground = (Brush)FindResource("TextBrush") }
                };
                chip.MouseLeftButtonDown += (s, e) => ApplySavedFilter(query);
                LogViewerSavedFilters.Children.Add(chip);
            }
        }

        private void ApplySavedFilter(LogQuery q)
        {
            _searchText = q.Text ?? ""; LogViewerSearchBox.Text = _searchText;
            _regex = q.Regex;
            _excludeText = q.Exclude != null ? string.Join(", ", q.Exclude) : ""; LogViewerExcludeBox.Text = _excludeText;
            _selectedLevels.Clear();
            foreach (var lv in q.Levels ?? Enum.GetValues<LogLevel>()) _selectedLevels.Add(lv);
            _enabledSourceIds.Clear();
            foreach (var id in q.SourceIds ?? LogService.Sources.Select(s => s.Id).ToArray()) _enabledSourceIds.Add(id);
            _loggerFilter = q.Logger;
            RenderLevelPills();
            RenderRail();
            RefreshQuery();
        }

        private void RenderLevelPills()
        {
            LogViewerLevelPills.Children.Clear();
            foreach (LogLevel level in Enum.GetValues<LogLevel>())
            {
                bool active = _selectedLevels.Contains(level);
                var brush = LevelBrush(level);
                var pill = new Border
                {
                    Padding = new Thickness(8, 3, 8, 3), Margin = new Thickness(0, 0, 4, 0), CornerRadius = new CornerRadius(4), Cursor = Cursors.Hand,
                    BorderThickness = new Thickness(1), BorderBrush = brush,
                    Background = active ? new SolidColorBrush(((SolidColorBrush)brush).Color) { Opacity = 0.22 } : Brushes.Transparent,
                    Child = new TextBlock
                    {
                        Text = level.ToString().ToUpperInvariant(), FontFamily = MonoFont, FontSize = 9,
                        Foreground = active ? brush : (Brush)FindResource("Subtext0Brush")
                    }
                };
                pill.MouseLeftButtonDown += (s, e) =>
                {
                    if (_selectedLevels.Contains(level)) _selectedLevels.Remove(level); else _selectedLevels.Add(level);
                    RefreshQuery();
                    RenderLevelPills();
                };
                LogViewerLevelPills.Children.Add(pill);
            }
        }

        // ── Left rail — Sources / Archive ───────────────────────────────────
        private void BtnLogViewerRailSources_Click(object sender, RoutedEventArgs e) { _railTab = "Sources"; RenderRail(); }
        private void BtnLogViewerRailArchive_Click(object sender, RoutedEventArgs e) { _railTab = "Archive"; RenderRail(); }

        private void RenderRail()
        {
            LogViewerRailContent.Children.Clear();
            BtnLogViewerRailSources.Background = _railTab == "Sources" ? (Brush)FindResource("Surface0Brush") : Brushes.Transparent;
            BtnLogViewerRailArchive.Background = _railTab == "Archive" ? (Brush)FindResource("Surface0Brush") : Brushes.Transparent;

            if (_railTab == "Sources") RenderSourcesRail();
            else RenderArchiveRail();
        }

        private void RenderSourcesRail()
        {
            var counts = ErrorCountsBySource();
            foreach (var group in LogService.Sources.Select(s => s.Group).Distinct())
            {
                bool open = _railGroupOpen.TryGetValue(group, out var o) && o;
                LogViewerRailContent.Children.Add(CollapsibleSection(group, open, () =>
                {
                    _railGroupOpen[group] = !open;
                    RenderRail();
                }, () =>
                {
                    var stack = new StackPanel();
                    foreach (var src in LogService.Sources.Where(s => s.Group == group))
                        stack.Children.Add(BuildSourceRow(src, counts.GetValueOrDefault(src.Id, 0)));
                    return stack;
                }));
            }
        }

        private Dictionary<string, int> ErrorCountsBySource() =>
            CurrentLoadedLines()
                .Where(l => l.Level == LogLevel.Error || l.Level == LogLevel.Fatal)
                .GroupBy(l => l.SourceId)
                .ToDictionary(g => g.Key, g => g.Count());

        private Border BuildSourceRow(LogSource src, int errorCount)
        {
            bool enabled = _enabledSourceIds.Contains(src.Id);
            var brush = new SolidColorBrush(src.Colour);
            bool streamingNow = enabled && _streamMode != LogStreamMode.Cold;

            var row = new DockPanel { Margin = new Thickness(4, 5, 4, 5) };

            var toggle = new Border
            {
                Width = 30, Height = 16, CornerRadius = new CornerRadius(8), Cursor = Cursors.Hand,
                Background = enabled ? (Brush)FindResource("GreenBrush") : (Brush)FindResource("Surface0Brush"),
                Child = new Ellipse
                {
                    Width = 12, Height = 12, Fill = Brushes.White,
                    HorizontalAlignment = enabled ? HorizontalAlignment.Right : HorizontalAlignment.Left, Margin = new Thickness(2)
                }
            };
            toggle.MouseLeftButtonDown += (s, e) => { e.Handled = true; ToggleSourceEnabled(src.Id); };
            DockPanel.SetDock(toggle, Dock.Right);
            row.Children.Add(toggle);

            if (errorCount > 0)
            {
                var badge = new TextBlock
                {
                    Text = errorCount.ToString(), Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)FindResource("RedBrush"), FontFamily = MonoFont,
                    FontSize = 9.5, FontWeight = FontWeights.Bold
                };
                DockPanel.SetDock(badge, Dock.Right);
                row.Children.Add(badge);
            }

            var dotBorder = new Border
            {
                Width = 8, Height = 8, CornerRadius = new CornerRadius(4), Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center,
                Background = brush,
                Effect = streamingNow ? new System.Windows.Media.Effects.DropShadowEffect { Color = src.Colour, BlurRadius = 8, ShadowDepth = 0, Opacity = 0.9 } : null
            };
            row.Children.Add(dotBorder);

            row.Children.Add(new TextBlock
            {
                Text = src.Label, VerticalAlignment = VerticalAlignment.Center, FontSize = 11,
                Foreground = (Brush)FindResource("TextBrush")
            });

            return new Border { Child = row };
        }

        private void ToggleSourceEnabled(string sourceId)
        {
            if (_enabledSourceIds.Contains(sourceId)) _enabledSourceIds.Remove(sourceId); else _enabledSourceIds.Add(sourceId);
            RenderRail();
            RenderFilterChips();
            RefreshQuery();
            RestartStreamIfActive();
        }

        // ── Archive tab — real day → build → bookend tree, see LogService.Archive()'s
        // own header comment for why there is no fabricated stdout.log leaf.
        private void RenderArchiveRail()
        {
            var openBox = new TextBox
            {
                Height = 26, Margin = new Thickness(0, 0, 0, 8),
                FontFamily = MonoFont, FontSize = 10.5,
                ToolTip = "Open bookend by Git ID — type the issue number and press Enter"
            };
            openBox.KeyDown += (s, e) =>
            {
                if (e.Key != Key.Enter || string.IsNullOrWhiteSpace(openBox.Text)) return;
                var id = openBox.Text.Trim();
                var content = _logService.OpenBookendByGitId(id);
                if (content == null) { ToastEngine.Show("Log Viewer", $"No bookend found for #{id}.", ToastKind.Warning); return; }
                var leaf = new ArchiveNode(id + "-bookend", $"{id}.md (bookend)", "bookend", Array.Empty<ArchiveNode>(),
                    FilePath: System.IO.Path.Combine(_logService.MainRepoRoot ?? "", "build-journal", id + ".md"), GitIssueId: id);
                OpenArchiveLeaf(leaf);
            };
            LogViewerRailContent.Children.Add(openBox);

            _archiveCache ??= _logService.Archive();
            if (_archiveCache.Count == 0)
            {
                LogViewerRailContent.Children.Add(new TextBlock
                {
                    Text = "No build-journal bookends found.", TextWrapping = TextWrapping.Wrap, FontStyle = FontStyles.Italic,
                    FontSize = 10.5, Foreground = (Brush)FindResource("Subtext0Brush")
                });
                return;
            }
            foreach (var day in _archiveCache.Take(30))
                LogViewerRailContent.Children.Add(BuildArchiveDayNode(day));
        }

        private Border BuildArchiveDayNode(ArchiveNode day)
        {
            bool open = _archiveOpenDays.Contains(day.Id);
            return CollapsibleSection($"{day.Label} ({day.Children.Count})", open, () =>
            {
                if (open) _archiveOpenDays.Remove(day.Id); else _archiveOpenDays.Add(day.Id);
                RenderRail();
            }, () =>
            {
                var stack = new StackPanel();
                foreach (var build in day.Children) stack.Children.Add(BuildArchiveBuildNode(build));
                return stack;
            });
        }

        private FrameworkElement BuildArchiveBuildNode(ArchiveNode build)
        {
            var stack = new StackPanel { Margin = new Thickness(10, 2, 4, 6) };
            stack.Children.Add(new TextBlock
            {
                Text = build.Label, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 2),
                FontSize = 10, FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("TextBrush")
            });
            foreach (var leaf in build.Children)
            {
                var leafRow = new TextBlock
                {
                    Text = leaf.Label, Cursor = Cursors.Hand, Margin = new Thickness(0, 0, 0, 2),
                    FontFamily = MonoFont, FontSize = 9.5, Foreground = (Brush)FindResource("BlueBrush")
                };
                leafRow.MouseLeftButtonDown += (s, e) => OpenArchiveLeaf(leaf);
                stack.Children.Add(leafRow);
            }
            return stack;
        }

        private void OpenArchiveLeaf(ArchiveNode leaf)
        {
            if (leaf.FilePath == null) return;
            var content = _logService.ReadArchiveFile(leaf.FilePath);
            if (content == null) { ToastEngine.Show("Log Viewer", "Could not read that archive file.", ToastKind.Error); return; }

            StopStream();
            _streamMode = LogStreamMode.Cold;
            _viewingArchive = true;
            LogViewerArchiveBanner.Visibility = Visibility.Visible;
            LogViewerArchiveBannerText.Text = $"ARCHIVE — READ-ONLY — {leaf.GitIssueId} ({leaf.Label})";

            LogViewerLinesPanel.Children.Clear();
            LogViewerLinesPanel.Children.Add(new TextBox
            {
                Text = content, IsReadOnly = true, TextWrapping = TextWrapping.NoWrap, AcceptsReturn = true,
                Background = Brushes.Transparent, BorderThickness = new Thickness(0),
                Foreground = (Brush)FindResource("TextBrush"),
                FontFamily = MonoFont, FontSize = 13
            });

            RenderStatusPill();
            RenderStreamSwitch();
        }

        private void LogViewerCloseArchiveBanner_Click(object sender, MouseButtonEventArgs e)
        {
            _viewingArchive = false;
            LogViewerArchiveBanner.Visibility = Visibility.Collapsed;
            RefreshQuery();
        }

        // ── Small generic collapsible-section builder (ShaneBuilder's
        // CollapsibleSection had no BuildConsole equivalent to reuse). ──────
        private Border CollapsibleSection(string header, bool open, Action toggle, Func<UIElement> buildContent)
        {
            var stack = new StackPanel();
            var headerRow = new DockPanel { Margin = new Thickness(2, 4, 2, 4), Cursor = Cursors.Hand };
            headerRow.Children.Add(new TextBlock
            {
                Text = open ? "▾" : "▸", Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center,
                FontSize = 9, Foreground = (Brush)FindResource("Subtext0Brush")
            });
            headerRow.Children.Add(new TextBlock
            {
                Text = header, VerticalAlignment = VerticalAlignment.Center, FontSize = 10.5,
                FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("Subtext1Brush")
            });
            headerRow.MouseLeftButtonDown += (s, e) => toggle();
            stack.Children.Add(headerRow);
            if (open) stack.Children.Add(buildContent());
            return new Border { Child = stack };
        }
    }
}
