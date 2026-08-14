using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// The dedicated, immersive full-screen Focus view. Reads <see cref="FocusModeService"/> for the
    /// focused "Epic" (the active milestone) and lays out exactly four things about it: the Epic + its
    /// progress/game layer (header), its child issues (left), the live Claude build driving it (centre),
    /// and the game/achievements rail (right). MainWindow supplies the shell-only bits via <see cref="Init"/>:
    /// the <see cref="QueueWatcherService"/> (for the centre build's live transcript + Send), a queue-items
    /// probe (to find on-epic builds), and callbacks to open an issue / milestone / Build Watch / take a
    /// quick-task suggestion. Every timer/subscription is torn down in <see cref="Deactivate"/> so the view
    /// costs nothing while hidden.
    /// </summary>
    public partial class FocusImmersiveView : UserControl
    {
        private QueueWatcherService? _watcher;
        private Func<IReadOnlyList<QueueItem>>? _queueItemsProbe;
        private Action<int>? _openIssue;
        private Action<int>? _openMilestone;
        private Action? _openBuildWatch;
        private Action<FocusSuggestion>? _takeSuggestion;

        private bool _active;
        private DispatcherTimerLike? _refreshTimer;
        private DispatcherTimerLike? _pumpTimer;

        private int? _selectedBuildId;
        private int _transcriptCursor;
        private string _buildChipSig = "";

        public FocusImmersiveView()
        {
            InitializeComponent();
        }

        /// <summary>One-time wiring from MainWindow (the only place that can reach the queue watcher +
        /// the shell's tab/window actions). Safe to call before the view is ever shown.</summary>
        public void Init(
            QueueWatcherService? watcher,
            Func<IReadOnlyList<QueueItem>> queueItemsProbe,
            Action<int> openIssue,
            Action<int> openMilestone,
            Action openBuildWatch,
            Action<FocusSuggestion> takeSuggestion)
        {
            _watcher = watcher;
            _queueItemsProbe = queueItemsProbe;
            _openIssue = openIssue;
            _openMilestone = openMilestone;
            _openBuildWatch = openBuildWatch;
            _takeSuggestion = takeSuggestion;
        }

        // ================================================================
        // Show / hide lifecycle
        // ================================================================
        public void Activate()
        {
            if (_active) return;
            _active = true;
            FocusModeService.Instance.StateChanged += OnStateChanged;

            _refreshTimer = new DispatcherTimerLike(Dispatcher, TimeSpan.FromSeconds(3), RefreshLive);
            _pumpTimer = new DispatcherTimerLike(Dispatcher, TimeSpan.FromSeconds(1), PumpTranscript);
            _refreshTimer.Start();
            _pumpTimer.Start();

            RefreshAll();
            CharacterLayer.Start();
            // let Esc/Ctrl+Shift+F reach us even before a child is clicked
            Dispatcher.BeginInvoke(new Action(() => { Focusable = true; Keyboard.Focus(this); }));
        }

        public void Deactivate()
        {
            if (!_active) return;
            _active = false;
            FocusModeService.Instance.StateChanged -= OnStateChanged;
            _refreshTimer?.Stop(); _refreshTimer = null;
            _pumpTimer?.Stop(); _pumpTimer = null;
            CharacterLayer.Stop();
            _selectedBuildId = null;
            _transcriptCursor = 0;
            _buildChipSig = "";
            TranscriptPanel.Children.Clear();
        }

        private void OnStateChanged() => Dispatcher.Invoke(() => { RefreshHeader(); RefreshChildren(); RefreshRail(); });

        /// <summary>The 3s "something changed" tick: builds/progress/rail (transcript has its own faster pump).</summary>
        private void RefreshLive()
        {
            RefreshHeader();
            RefreshBuilds();
            RefreshRail();
        }

        private void RefreshAll()
        {
            RefreshHeader();
            RefreshChildren();
            RefreshBuilds();
            RefreshRail();
        }

        // ================================================================
        // Header (Epic + game layer)
        // ================================================================
        private void RefreshHeader()
        {
            var svc = FocusModeService.Instance;
            var p = svc.Progress;
            EpicTitleText.Text = string.IsNullOrWhiteSpace(p.MilestoneTitle) ? svc.ActiveMilestoneTitle : p.MilestoneTitle;

            if (p.Total > 0)
            {
                EpicProgressBar.Value = Math.Max(0, Math.Min(100, p.Percent));
                EpicProgressText.Text = $"{p.Closed}/{p.Total} issues · {p.Percent}%";
            }
            else
            {
                EpicProgressBar.Value = 0;
                EpicProgressText.Text = "no issues yet";
            }

            if (p.HasEta && p.Eta.HasValue)
                EpicEtaText.Text = $"~{FormatEta(p.Eta.Value)} left · {p.IssuesPerDay:0.#}/day";
            else if (p.Percent >= 100 && p.Total > 0)
                EpicEtaText.Text = "cleared 🎉";
            else
                EpicEtaText.Text = "";
            EpicEtaText.ToolTip = p.HasEta ? "Estimated at the current close rate" : p.EtaReason;

            PointsText.Text = $"⭐ {svc.Points} pts";

            var latest = svc.Achievements.OrderByDescending(a => a.UnlockedAt).FirstOrDefault();
            if (latest != null)
            {
                AchievementChip.Visibility = Visibility.Visible;
                AchievementChipText.Text = $"{latest.Emoji} {latest.Title}"
                    + (svc.Achievements.Count > 1 ? $"  (+{svc.Achievements.Count - 1})" : "");
            }
            else AchievementChip.Visibility = Visibility.Collapsed;
        }

        // ================================================================
        // Left — the Epic's children
        // ================================================================
        private void RefreshChildren()
        {
            var svc = FocusModeService.Instance;
            var kids = svc.ActiveChildIssues;
            ChildrenList.Children.Clear();
            int open = kids.Count(k => !k.IsClosed);
            ChildrenCountText.Text = kids.Count == 0 ? "" : $"{open} open · {kids.Count} total";
            foreach (var k in kids) ChildrenList.Children.Add(BuildChildRow(k));
        }

        private UIElement BuildChildRow(GitBoardIssue k)
        {
            string glyph; Brush glyphColor;
            if (k.IsClosed) { glyph = "✓"; glyphColor = Res("GreenBrush"); }
            else if (k.IsEpic) { glyph = "⚡"; glyphColor = Res("BlueBrush"); }
            else if (k.IsTodo) { glyph = "🔴"; glyphColor = Res("RedBrush"); }
            else { glyph = "▸"; glyphColor = Res("Subtext1Brush"); }

            var grid = new Grid { Margin = new Thickness(0, 1, 0, 1) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var g = new TextBlock
            {
                Text = glyph,
                FontSize = 12.5,
                Foreground = glyphColor,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Top
            };
            Grid.SetColumn(g, 0);
            grid.Children.Add(g);

            string title = $"#{k.Number}  {Clean(k.Title)}";
            if (k.IsEpic && k.SubIssueCount > 0) title += $"  ({k.SubIssueCount} sub)";
            var t = new TextBlock
            {
                Text = title,
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = k.IsClosed ? Res("Subtext0Brush") : Res("TextBrush"),
                TextDecorations = k.IsClosed ? TextDecorations.Strikethrough : null
            };
            Grid.SetColumn(t, 1);
            grid.Children.Add(t);

            var border = new Border
            {
                Background = Res("Surface0Brush"),
                CornerRadius = new CornerRadius(5),
                Padding = new Thickness(9, 6, 9, 6),
                Margin = new Thickness(0, 0, 0, 4),
                Cursor = Cursors.Hand,
                Child = grid,
                Tag = k,
                ToolTip = k.IsClosed ? "Closed" : "Click to focus its live build, or open its chat"
            };
            border.MouseLeftButtonUp += (_, _) => OnChildClicked(k);
            return border;
        }

        private void OnChildClicked(GitBoardIssue k)
        {
            // If a build is running/queued for this child, focus its live transcript; else go open its chat.
            var items = _queueItemsProbe?.Invoke() ?? Array.Empty<QueueItem>();
            var build = items.FirstOrDefault(i => i.GithubNumber == k.Number && (i.Status == "running" || i.Status == "queued"));
            if (build != null && build.Status == "running")
            {
                ShowEmptyState(false);
                SelectBuild(build);
                ActivityLog.Log("focus-mode", $"immersive: focused live build for child #{k.Number}");
            }
            else
            {
                ActivityLog.Log("focus-mode", $"immersive: opening child #{k.Number} from the epic children list");
                _openIssue?.Invoke(k.Number);
            }
        }

        // ================================================================
        // Centre — the live Claude build ("chat") on the epic
        // ================================================================
        private void RefreshBuilds()
        {
            var svc = FocusModeService.Instance;
            var items = _queueItemsProbe?.Invoke() ?? Array.Empty<QueueItem>();
            var epicBuilds = items.Where(i => svc.IsIssueInActiveMilestone(i.GithubNumber)).ToList();
            var running = epicBuilds.Where(i => i.Status == "running").ToList();
            var queued = epicBuilds.Where(i => i.Status == "queued").ToList();

            CentreStatusText.Text = running.Count > 0
                ? $"· {running.Count} running{(queued.Count > 0 ? $", {queued.Count} queued" : "")}"
                : (queued.Count > 0 ? $"· {queued.Count} queued (waiting for a slot)" : "· nothing running");

            var sig = string.Join("|", epicBuilds.Select(i => i.Id + ":" + i.Status));
            if (sig != _buildChipSig)
            {
                _buildChipSig = sig;
                RebuildBuildChips(running, queued);
            }

            if (running.Count == 0)
            {
                _selectedBuildId = null;
                _transcriptCursor = 0;
                ShowEmptyState(true);
                UpdateSendEnabled();
            }
            else
            {
                ShowEmptyState(false);
                if (_selectedBuildId == null || running.All(r => r.Id != _selectedBuildId.Value))
                    SelectBuild(running[0]);
                else
                    UpdateSendEnabled();
            }
            UpdateBuildChipSelection();
        }

        private void RebuildBuildChips(List<QueueItem> running, List<QueueItem> queued)
        {
            BuildChips.Children.Clear();
            foreach (var b in running) BuildChips.Children.Add(BuildBuildChip(b, true));
            foreach (var b in queued) BuildChips.Children.Add(BuildBuildChip(b, false));
        }

        private UIElement BuildBuildChip(QueueItem b, bool isRunning)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal };
            sp.Children.Add(new TextBlock
            {
                Text = isRunning ? "● " : "⏳ ",
                FontSize = 11,
                Foreground = isRunning ? Res("GreenBrush") : Res("PeachBrush"),
                VerticalAlignment = VerticalAlignment.Center
            });
            sp.Children.Add(new TextBlock
            {
                Text = (b.GithubNumber.HasValue ? $"#{b.GithubNumber} " : "") + Clean(b.Title, 34),
                FontSize = 11.5,
                Foreground = Res("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                MaxWidth = 260,
                TextTrimming = TextTrimming.CharacterEllipsis
            });

            var btn = new Button
            {
                Content = sp,
                Margin = new Thickness(0, 0, 8, 6),
                Padding = new Thickness(10, 5, 10, 5),
                Cursor = Cursors.Hand,
                Background = Res("Surface0Brush"),
                BorderBrush = Res("Surface1Brush"),
                BorderThickness = new Thickness(1),
                Tag = b.Id,
                IsEnabled = isRunning,
                ToolTip = isRunning ? "Show this build's live transcript" : "Queued — waiting for a free slot"
            };
            if (isRunning) btn.Click += (_, _) => { ShowEmptyState(false); SelectBuild(b); };
            return btn;
        }

        private void UpdateBuildChipSelection()
        {
            foreach (var child in BuildChips.Children)
            {
                if (child is Button btn && btn.Tag is int id)
                    btn.BorderBrush = (_selectedBuildId.HasValue && id == _selectedBuildId.Value)
                        ? Res("BlueBrush") : Res("Surface1Brush");
            }
        }

        private void SelectBuild(QueueItem? b)
        {
            int? newId = b?.Id;
            if (newId == _selectedBuildId) { UpdateSendEnabled(); return; }
            _selectedBuildId = newId;
            _transcriptCursor = 0;
            TranscriptPanel.Children.Clear();
            UpdateSendEnabled();
            UpdateBuildChipSelection();
            PumpTranscript(); // paint immediately, don't wait a whole tick
        }

        private void ShowEmptyState(bool empty)
        {
            EmptyStatePanel.Visibility = empty ? Visibility.Visible : Visibility.Collapsed;
            TranscriptScroller.Visibility = empty ? Visibility.Collapsed : Visibility.Visible;
            if (empty)
            {
                SuggestionsPanel.Children.Clear();
                var sugg = FocusModeService.Instance.Suggestions;
                if (sugg.Count == 0)
                {
                    EmptyStateHint.Text = "Pick a child on the left to open it and get going.";
                }
                else
                {
                    EmptyStateHint.Text = "Pick a child on the left to start one — or grab a quick win while you wait:";
                    foreach (var s in sugg) SuggestionsPanel.Children.Add(BuildSuggestionChip(s));
                }
            }
        }

        private UIElement BuildSuggestionChip(FocusSuggestion s)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal };
            sp.Children.Add(new TextBlock { Text = s.Emoji + " ", FontSize = 11.5, VerticalAlignment = VerticalAlignment.Center });
            sp.Children.Add(new TextBlock
            {
                Text = $"{s.NumberStr}  {s.Title}",
                FontSize = 11.5,
                Foreground = Res("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                MaxWidth = 300,
                TextTrimming = TextTrimming.CharacterEllipsis
            });
            var btn = new Button
            {
                Content = sp,
                Margin = new Thickness(0, 6, 8, 0),
                Padding = new Thickness(10, 5, 10, 5),
                Cursor = Cursors.Hand,
                Background = Res("Surface1Brush"),
                BorderThickness = new Thickness(0),
                Tag = s,
                ToolTip = $"{s.Kind} — open it now; you'll snap back when the build's done"
            };
            btn.Click += (_, _) => _takeSuggestion?.Invoke(s);
            return btn;
        }

        // ---- live transcript pump (reuses the interactive build event stream) ----
        private void PumpTranscript()
        {
            if (!_active || _selectedBuildId == null || _watcher == null) return;

            if (!_watcher.OwnsInteractive(_selectedBuildId.Value))
            {
                if (TranscriptPanel.Children.Count == 0)
                    AppendForeignNote();
                return;
            }

            int cursor = _transcriptCursor;
            List<InteractiveEvent> evts;
            try { evts = _watcher.CopyEventsSince(_selectedBuildId.Value, ref cursor); }
            catch { return; }
            _transcriptCursor = cursor;
            if (evts.Count == 0) return;

            foreach (var ev in evts)
            {
                var el = BuildEventElement(ev);
                if (el != null) TranscriptPanel.Children.Add(el);
            }
            TrimTranscript();
            TranscriptScroller.ScrollToEnd();
        }

        private UIElement? BuildEventElement(InteractiveEvent ev)
        {
            switch (ev.Kind)
            {
                case InteractiveEventKind.AssistantText:
                    if (string.IsNullOrWhiteSpace(ev.Text)) return null;
                    return new TextBlock
                    {
                        Text = ev.Text!.Trim(),
                        FontSize = 12.5,
                        TextWrapping = TextWrapping.Wrap,
                        Foreground = ev.IsError ? Res("RedBrush") : Res("TextBrush"),
                        Margin = new Thickness(0, 3, 0, 3)
                    };

                case InteractiveEventKind.ToolCall:
                {
                    var sp = new StackPanel { Orientation = Orientation.Horizontal };
                    sp.Children.Add(new TextBlock { Text = "⚙ ", FontSize = 11.5, Foreground = Res("MauveBrush"), VerticalAlignment = VerticalAlignment.Center });
                    sp.Children.Add(new TextBlock { Text = ev.ToolName ?? "tool", FontSize = 11.5, FontWeight = FontWeights.SemiBold, Foreground = Res("MauveBrush"), VerticalAlignment = VerticalAlignment.Center });
                    if (!string.IsNullOrWhiteSpace(ev.CommandPreview))
                        sp.Children.Add(new TextBlock
                        {
                            Text = "  " + Clean(ev.CommandPreview!, 90),
                            FontSize = 11,
                            Foreground = Res("Subtext1Brush"),
                            VerticalAlignment = VerticalAlignment.Center,
                            TextTrimming = TextTrimming.CharacterEllipsis
                        });
                    return new Border
                    {
                        Background = Res("Surface0Brush"),
                        CornerRadius = new CornerRadius(4),
                        Padding = new Thickness(8, 4, 8, 4),
                        Margin = new Thickness(0, 3, 0, 3),
                        Child = sp
                    };
                }

                case InteractiveEventKind.ToolResult:
                {
                    if (string.IsNullOrWhiteSpace(ev.Text)) return null;
                    string first = ev.Text!.Replace("\r", " ").Replace("\n", " ").Trim();
                    return new TextBlock
                    {
                        Text = "→ " + Clean(first, 140),
                        FontSize = 11,
                        FontFamily = new FontFamily("Consolas"),
                        Foreground = ev.IsError ? Res("RedBrush") : Res("Subtext0Brush"),
                        TextTrimming = TextTrimming.CharacterEllipsis,
                        Margin = new Thickness(14, 1, 0, 3)
                    };
                }

                case InteractiveEventKind.TurnResult:
                    return new TextBlock
                    {
                        Text = "— turn complete —",
                        FontSize = 10.5,
                        Foreground = Res("Subtext0Brush"),
                        HorizontalAlignment = HorizontalAlignment.Center,
                        Margin = new Thickness(0, 6, 0, 6)
                    };
            }
            return null;
        }

        private void AppendForeignNote()
        {
            var sp = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 30, 0, 0) };
            sp.Children.Add(new TextBlock
            {
                Text = "This build is running outside this app, so its live transcript isn't captured here.",
                FontSize = 12.5,
                TextWrapping = TextWrapping.Wrap,
                TextAlignment = TextAlignment.Center,
                Foreground = Res("Subtext1Brush"),
                MaxWidth = 420
            });
            var btn = new Button
            {
                Content = "Open Build Watch ▸",
                Margin = new Thickness(0, 12, 0, 0),
                Padding = new Thickness(12, 5, 12, 5),
                HorizontalAlignment = HorizontalAlignment.Center,
                Cursor = Cursors.Hand,
                Background = Res("Surface1Brush"),
                Foreground = Res("TextBrush"),
                BorderThickness = new Thickness(0)
            };
            btn.Click += (_, _) => _openBuildWatch?.Invoke();
            sp.Children.Add(btn);
            TranscriptPanel.Children.Add(sp);
        }

        private void TrimTranscript()
        {
            const int max = 240;
            while (TranscriptPanel.Children.Count > max) TranscriptPanel.Children.RemoveAt(0);
        }

        // ---- send box ----
        private void UpdateSendEnabled()
        {
            bool owned = _selectedBuildId.HasValue && _watcher != null && _watcher.OwnsInteractive(_selectedBuildId.Value);
            ChatInput.IsEnabled = owned;
            SendButton.IsEnabled = owned;
            ChatInput.ToolTip = owned
                ? "Send a message into the running build (Enter to send)"
                : "Live chat is available for interactive builds this app is running";
        }

        private void SendButton_Click(object sender, RoutedEventArgs e) => SendChat();

        private void ChatInput_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Shift) == 0)
            {
                SendChat();
                e.Handled = true;
            }
        }

        private void SendChat()
        {
            if (_selectedBuildId == null || _watcher == null) return;
            var text = ChatInput.Text?.Trim();
            if (string.IsNullOrEmpty(text)) return;
            if (!_watcher.OwnsInteractive(_selectedBuildId.Value)) return;
            try
            {
                _watcher.SendInput(_selectedBuildId.Value, text!);
                ChatInput.Clear();
                ActivityLog.Log("focus-mode", $"immersive: sent chat into build #{_selectedBuildId} ({text!.Length} chars)");
            }
            catch (Exception ex)
            {
                ActivityLog.Log("focus-mode", $"immersive: send failed: {ex.Message}");
            }
        }

        // ================================================================
        // Right — game / achievements rail
        // ================================================================
        private void RefreshRail()
        {
            var svc = FocusModeService.Instance;
            RailPointsText.Text = $"⭐ {svc.Points} pts";

            var p = svc.Progress;
            if (p.HasEta && p.Eta.HasValue)
                RailPaceText.Text = $"At ~{p.IssuesPerDay:0.#} issues/day, about {FormatEta(p.Eta.Value)} to clear this epic.";
            else
                RailPaceText.Text = string.IsNullOrWhiteSpace(p.EtaReason) ? "Pace shows once a few issues close." : p.EtaReason;

            // live checklist steps under the epic (reuses #46's shared tracker; no second parser)
            var checklist = TaskChecklistViewModel.Shared.Items
                .Where(it => svc.IsIssueInActiveMilestone(it.GithubNumber)).ToList();
            if (checklist.Count > 0)
            {
                int done = checklist.Count(i => i.Done);
                RailChecklistText.Text = $"☑ {done}/{checklist.Count} live build steps done";
                RailChecklistText.Visibility = Visibility.Visible;
            }
            else RailChecklistText.Visibility = Visibility.Collapsed;

            var items = _queueItemsProbe?.Invoke() ?? Array.Empty<QueueItem>();
            int queued = items.Count(i => svc.IsIssueInActiveMilestone(i.GithubNumber) && i.Status == "queued");
            if (queued > 0)
            {
                RailQueuedText.Text = $"⏳ {queued} build{(queued == 1 ? "" : "s")} queued on this epic";
                RailQueuedText.Visibility = Visibility.Visible;
            }
            else RailQueuedText.Visibility = Visibility.Collapsed;

            AchievementsList.Children.Clear();
            var achs = svc.Achievements.OrderByDescending(a => a.UnlockedAt).ToList();
            NoAchievementsText.Visibility = achs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            foreach (var a in achs.Take(14)) AchievementsList.Children.Add(BuildAchievementRow(a));
        }

        private UIElement BuildAchievementRow(FocusAchievement a)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 6) };
            sp.Children.Add(new TextBlock { Text = a.Emoji, FontSize = 14, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Top });
            var col = new StackPanel();
            col.Children.Add(new TextBlock { Text = a.Title, FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = Res("TextBrush"), TextWrapping = TextWrapping.Wrap });
            col.Children.Add(new TextBlock { Text = a.Detail, FontSize = 10.5, Foreground = Res("Subtext0Brush"), TextWrapping = TextWrapping.Wrap });
            sp.Children.Add(col);
            return sp;
        }

        // ================================================================
        // Celebrations (called by MainWindow on real signals)
        // ================================================================
        public void CelebrateBuildFinished(string title, bool success)
        {
            CharacterLayer.CelebrateBuildFinished(title, success);
            RefreshBuilds();
            RefreshRail();
        }

        public void CelebrateIssuesClosed(int count) => CharacterLayer.CelebrateIssuesClosed(count);

        public void CheerAchievement(FocusAchievement a) => CharacterLayer.Cheer(a.Emoji, a.Title);

        // ================================================================
        // Interactions
        // ================================================================
        private void Root_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape)
            {
                if (ChatInput.IsKeyboardFocusWithin && !string.IsNullOrEmpty(ChatInput.Text))
                    ChatInput.Clear();
                else
                    FocusModeService.Instance.ExitImmersive();
                e.Handled = true;
            }
        }

        private void ExitButton_Click(object sender, RoutedEventArgs e) => FocusModeService.Instance.ExitImmersive();

        private void EpicTitle_Click(object sender, MouseButtonEventArgs e)
        {
            var n = FocusModeService.Instance.ActiveMilestoneNumber;
            if (n.HasValue) _openMilestone?.Invoke(n.Value);
        }

        private void AchievementChip_Click(object sender, MouseButtonEventArgs e)
        {
            var a = FocusModeService.Instance.Achievements.OrderByDescending(x => x.UnlockedAt).FirstOrDefault();
            if (a != null) CharacterLayer.Cheer(a.Emoji, a.Title);
        }

        // ================================================================
        // Helpers
        // ================================================================
        private static string FormatEta(TimeSpan t)
        {
            if (t.TotalDays >= 1) return $"{t.TotalDays:0.#}d";
            if (t.TotalHours >= 1) return $"{t.TotalHours:0.#}h";
            return $"{Math.Max(1, t.TotalMinutes):0}m";
        }

        private static string Clean(string? s, int max = 70)
        {
            s = (s ?? "").Trim();
            return s.Length > max ? s.Substring(0, max - 1) + "…" : s;
        }

        private Brush Res(string key)
            => (TryFindResource(key) as Brush)
               ?? (Application.Current?.TryFindResource(key) as Brush)
               ?? Brushes.Gray;
    }

    /// <summary>Tiny DispatcherTimer wrapper so the view can start/stop named timers cleanly without four
    /// fields of boilerplate each. Ticks on the WPF UI thread at Background priority.</summary>
    internal sealed class DispatcherTimerLike
    {
        private readonly System.Windows.Threading.DispatcherTimer _t;
        public DispatcherTimerLike(System.Windows.Threading.Dispatcher ui, TimeSpan interval, Action onTick)
        {
            _t = new System.Windows.Threading.DispatcherTimer(System.Windows.Threading.DispatcherPriority.Background, ui) { Interval = interval };
            _t.Tick += (_, _) => onTick();
        }
        public void Start() => _t.Start();
        public void Stop() => _t.Stop();
    }
}
