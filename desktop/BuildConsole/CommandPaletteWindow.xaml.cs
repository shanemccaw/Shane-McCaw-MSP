using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace BuildConsole
{
    /// <summary>
    /// Git #3622 — the new Ctrl+K command palette (dialog shell). A separate
    /// borderless top-level window rather than an in-window WPF overlay: as its
    /// own HWND it always paints above the embedded WebView2 views, so none of
    /// the old dropdown's airspace workarounds (hide the active webview while
    /// open) are needed.
    ///
    /// Scope, per the issue: the SHELL only. The category tab strip, counts,
    /// keyboard nav, tiles, and the two-pane body are all real; every category's
    /// DATA is honestly empty (count 0, an explicit "not wired yet" empty state)
    /// until that category's own source lands in its own future build. The only
    /// real rows today are the quick-action command entries the caller passes in
    /// (Git Pull / Paste Manual Build / Recover Builds), each firing a genuinely
    /// existing BuildConsole action — never a fake success.
    /// </summary>
    public partial class CommandPaletteWindow : Window
    {
        /// <summary>A real, runnable command entry (the "ACTION"-tagged rows and the
        /// quick-action tiles). <see cref="Run"/> invokes the real existing feature;
        /// the palette closes first so dialog-opening actions aren't fighting a
        /// still-focused palette window.</summary>
        public sealed class PaletteCommand
        {
            /// <summary>Segoe MDL2 Assets glyph for the row/tile icon.</summary>
            public string Glyph { get; init; } = "\uE945"; // "LightningBolt"
            public string Title { get; init; } = string.Empty;
            public string Subtitle { get; init; } = string.Empty;
            /// <summary>Right-pane description of what the action really does.</summary>
            public string DetailBody { get; init; } = string.Empty;
            /// <summary>Label on the right pane's primary button (and the tile).</summary>
            public string ActionLabel { get; init; } = string.Empty;
            public Action? Run { get; init; }

            /// <summary>
            /// Git #3826 — an alternative to <see cref="Run"/> for a command whose real
            /// result text (e.g. `git pull`'s Stdout/Stderr) should show inline in the
            /// palette's own right pane instead of the palette just closing and the result
            /// landing only in a toast or another panel. When set, this takes precedence
            /// over <see cref="Run"/>: the palette stays open, shows "Running…", awaits the
            /// real result, and displays it in place of <see cref="DetailBody"/>.
            /// </summary>
            public Func<System.Threading.Tasks.Task<string>>? RunWithResult { get; init; }
        }

        // The real category set from the issue/screenshot (Smart All + nine).
        // Each non-All category's data source is future, per-category work.
        private static readonly (string Key, string Label)[] Categories =
        {
            ("All", "Smart All"),
            ("GitEpics", "Git Epics"),
            ("Features", "Features"),
            ("GitIssues", "Git Issues"),
            ("Builds", "Builds"),
            ("ClaudeUrls", "Claude & URLs"),
            ("Services", "Services"),
            ("Terminal", "Terminal"),
            ("SQL", "SQL"),
            ("BuildIds", "Build IDs"),
        };

        private readonly List<PaletteCommand> _commands;
        private readonly BuildConsole.Services.BuildTrackerApiClient? _api;
        private string _categoryKey = "All";
        private List<PaletteCommand> _filtered = new();
        private int _selectedIndex = -1;
        private bool _closing;

        /// <summary>Git #3826 — real live result text (e.g. actual `git pull` Stdout/Stderr)
        /// for the currently-selected <see cref="PaletteCommand.RunWithResult"/> command,
        /// shown in place of its <see cref="PaletteCommand.DetailBody"/> once run. Reset
        /// whenever the selection/category/search changes so a stale result never lingers
        /// on a different command.</summary>
        private string? _liveResultText;

        // ── Git #3828 — SQL detection/execution state ──────────────────────────
        private bool _sqlMode;
        private bool _sqlRunning;
        private string? _sqlError;
        private List<BuildConsole.Services.SqlStatementResult>? _sqlResults;
        private bool _sqlShowJson;

        /// <summary>Raised when "Send to Chat" is clicked on the SQL results panel — MainWindow
        /// wires this to the same shared <c>SendTextToActiveClaudeChatAsync</c> path (#937/#940)
        /// the SQL Runner floaty already uses, never a second mechanism.</summary>
        public event EventHandler<string>? SqlSendToChatRequested;

        public CommandPaletteWindow(IEnumerable<PaletteCommand> commands, BuildConsole.Services.BuildTrackerApiClient? api = null)
        {
            InitializeComponent();
            _commands = commands.ToList();
            _api = api;
            RenderTiles();
            RenderTabs();
            RenderResults();
        }

        /// <summary>Rows a category would show right now. Every non-All category is
        /// genuinely 0 until its real data source is wired (its own future build) —
        /// never seeded with fixture rows. "All" counts the real command entries
        /// matching the current query.</summary>
        private int CategoryCount(string key)
            => key == "All" ? FilterCommands(PaletteInput.Text).Count : 0;

        private List<PaletteCommand> FilterCommands(string query)
        {
            string q = (query ?? string.Empty).Trim();
            if (q.Length == 0) return _commands.ToList();
            return _commands
                .Where(c => Has(c.Title, q) || Has(c.Subtitle, q))
                .ToList();
            static bool Has(string s, string q)
                => s.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        // ── Open/close & keyboard ───────────────────────────────────────────

        private void Window_ContentRendered(object? sender, EventArgs e)
        {
            PaletteInput.Focus();
            Keyboard.Focus(PaletteInput);
        }

        private void Window_Deactivated(object? sender, EventArgs e) => CloseOnce();

        private void EscChip_Click(object sender, MouseButtonEventArgs e) => CloseOnce();

        private void CloseOnce()
        {
            if (_closing) return;
            _closing = true;
            Close();
        }

        private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            bool ctrl = (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control;
            if (e.Key == Key.Escape || (ctrl && e.Key == Key.K))
            {
                e.Handled = true;
                CloseOnce();
            }
            else if (_sqlMode && e.Key == Key.Enter)
            {
                // Git #3828 — keyboard-only: Enter runs the query without a click, and
                // (unlike a quick-action row) does NOT close the palette — results render
                // right here so Shane can keep typing/re-running without reopening it.
                e.Handled = true;
                _ = RunSqlQueryAsync();
            }
            else if (_sqlMode && (e.Key == Key.Down || e.Key == Key.Up || e.Key == Key.Tab))
            {
                // No result list / category tabs to navigate while a SQL query fills the panel.
                e.Handled = true;
            }
            else if (e.Key == Key.Down)
            {
                e.Handled = true;
                MoveSelection(1);
            }
            else if (e.Key == Key.Up)
            {
                e.Handled = true;
                MoveSelection(-1);
            }
            else if (e.Key == Key.Enter)
            {
                e.Handled = true;
                RunSelected();
            }
            else if (e.Key == Key.Tab)
            {
                e.Handled = true;
                int idx = Array.FindIndex(Categories, c => c.Key == _categoryKey);
                int dir = (Keyboard.Modifiers & ModifierKeys.Shift) != 0 ? -1 : 1;
                SetCategory(Categories[(idx + dir + Categories.Length) % Categories.Length].Key);
            }
        }

        private void PaletteInput_TextChanged(object sender, TextChangedEventArgs e)
        {
            PalettePlaceholder.Visibility =
                PaletteInput.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
            _liveResultText = null;

            // Git #3828 — real SQL detection: switching in/out of SQL mode resets any
            // stale results from a previous query rather than showing them against new text.
            bool looksLikeSql = BuildConsole.Services.SqlDetection.LooksLikeSqlQuery(PaletteInput.Text);
            if (looksLikeSql != _sqlMode)
            {
                _sqlMode = looksLikeSql;
                _sqlResults = null;
                _sqlError = null;
                _sqlShowJson = false;
            }

            RenderTabs();
            RenderResults();
        }

        private void MoveSelection(int delta)
        {
            if (_filtered.Count == 0) return;
            _selectedIndex = Math.Clamp(_selectedIndex + delta, 0, _filtered.Count - 1);
            _liveResultText = null;
            RenderResults(preserveSelection: true);
        }

        private void RunSelected()
        {
            if (_selectedIndex < 0 || _selectedIndex >= _filtered.Count) return;
            var cmd = _filtered[_selectedIndex];

            if (cmd.RunWithResult != null)
            {
                _ = RunSelectedWithResultAsync(cmd);
                return;
            }

            CloseOnce();
            cmd.Run?.Invoke();
        }

        /// <summary>Git #3826 — runs a <see cref="PaletteCommand.RunWithResult"/> command
        /// without closing the palette: shows "Running…" in the right pane, awaits the real
        /// result, then shows it in place of the command's static <see cref="PaletteCommand.DetailBody"/>
        /// — the actual real output, same as the Git panel's own status readout gets.</summary>
        private async System.Threading.Tasks.Task RunSelectedWithResultAsync(PaletteCommand cmd)
        {
            _liveResultText = "Running…";
            RenderDetail();

            string result;
            try
            {
                result = await cmd.RunWithResult!();
            }
            catch (Exception ex)
            {
                result = $"✗ {ex.Message}";
            }

            // Only show the result if the same command is still selected — the user may have
            // moved on to a different row while this was running.
            if (_selectedIndex >= 0 && _selectedIndex < _filtered.Count && _filtered[_selectedIndex] == cmd)
            {
                _liveResultText = result;
                RenderDetail();
            }
        }

        private void DetailAction_Click(object sender, MouseButtonEventArgs e)
        {
            if (_sqlMode) { _ = RunSqlQueryAsync(); return; }
            RunSelected();
        }

        // ── Category tabs ───────────────────────────────────────────────────

        private void SetCategory(string key)
        {
            _categoryKey = key;
            _selectedIndex = -1;
            _liveResultText = null;
            RenderTabs();
            RenderResults();
        }

        private void RenderTabs()
        {
            PaletteTabs.Children.Clear();
            foreach (var (key, label) in Categories)
            {
                bool active = key == _categoryKey;
                var row = new StackPanel { Orientation = Orientation.Horizontal };
                row.Children.Add(new TextBlock
                {
                    Text = label,
                    FontSize = 11,
                    FontWeight = active ? FontWeights.SemiBold : FontWeights.Normal,
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)FindResource(active ? "TextPrimaryBrush" : "TextSecondaryBrush"),
                });
                row.Children.Add(new Border
                {
                    Margin = new Thickness(6, 0, 0, 0),
                    CornerRadius = new CornerRadius(99),
                    Background = (Brush)FindResource(active ? "AccentWashMediumBrush" : "CardBackgroundBrush"),
                    Padding = new Thickness(6, 1, 6, 1),
                    VerticalAlignment = VerticalAlignment.Center,
                    Child = new TextBlock
                    {
                        Text = CategoryCount(key).ToString(),
                        FontSize = 9,
                        Foreground = (Brush)FindResource(active ? "TextPrimaryBrush" : "TextDisabledBrush"),
                    },
                });

                var chip = new Border
                {
                    CornerRadius = new CornerRadius(6),
                    Padding = new Thickness(10, 5, 10, 5),
                    Margin = new Thickness(0, 0, 6, 0),
                    Cursor = Cursors.Hand,
                    Background = active
                        ? (Brush)FindResource("AccentWashLightBrush")
                        : Brushes.Transparent,
                    BorderThickness = new Thickness(1),
                    BorderBrush = active
                        ? (Brush)FindResource("AccentBrush")
                        : Brushes.Transparent,
                    Child = row,
                };
                string localKey = key;
                chip.MouseLeftButtonDown += (_, e) => { e.Handled = true; SetCategory(localKey); };
                PaletteTabs.Children.Add(chip);
            }
        }

        // ── Quick-action tiles ──────────────────────────────────────────────

        private void RenderTiles()
        {
            PaletteTiles.Children.Clear();
            foreach (var cmd in _commands)
            {
                var stack = new StackPanel { Width = 72, Margin = new Thickness(0, 0, 10, 8) };
                stack.Children.Add(new Border
                {
                    Width = 48,
                    Height = 48,
                    CornerRadius = new CornerRadius(8),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    Background = (Brush)FindResource("CardBackgroundBrush"),
                    BorderBrush = (Brush)FindResource("BorderDividerBrush"),
                    BorderThickness = new Thickness(1),
                    Child = new TextBlock
                    {
                        Text = cmd.Glyph,
                        FontFamily = new FontFamily("Segoe MDL2 Assets"),
                        FontSize = 16,
                        HorizontalAlignment = HorizontalAlignment.Center,
                        VerticalAlignment = VerticalAlignment.Center,
                        Foreground = (Brush)FindResource("TextPrimaryBrush"),
                    },
                });
                stack.Children.Add(new TextBlock
                {
                    Text = cmd.Title,
                    Margin = new Thickness(0, 5, 0, 0),
                    TextWrapping = TextWrapping.Wrap,
                    TextAlignment = TextAlignment.Center,
                    FontSize = 9,
                    Foreground = (Brush)FindResource("TextSecondaryBrush"),
                });

                var local = cmd;
                var tile = new Border { Cursor = Cursors.Hand, Background = Brushes.Transparent, Child = stack };
                tile.MouseLeftButtonDown += (_, e) =>
                {
                    e.Handled = true;

                    // Git #3826 — a RunWithResult tile stays open and shows its real result
                    // inline in the right pane, same as running it via the results list/Enter.
                    if (local.RunWithResult != null)
                    {
                        int idx = _filtered.IndexOf(local);
                        if (idx >= 0)
                        {
                            _selectedIndex = idx;
                            _liveResultText = null;
                            RenderResults(preserveSelection: true);
                        }
                        _ = RunSelectedWithResultAsync(local);
                        return;
                    }

                    CloseOnce();
                    local.Run?.Invoke();
                };
                PaletteTiles.Children.Add(tile);
            }
        }

        // ── Results list ────────────────────────────────────────────────────

        private void RenderResults(bool preserveSelection = false)
        {
            PaletteResults.Children.Clear();

            if (_sqlMode)
            {
                RenderSqlResultRow();
                RenderDetail();
                return;
            }

            if (_categoryKey != "All")
            {
                // Honest empty state — this category's real data source is not
                // wired yet (its own future build). Never placeholder rows.
                _filtered = new List<PaletteCommand>();
                _selectedIndex = -1;
                string label = Categories.First(c => c.Key == _categoryKey).Label;
                PaletteResults.Children.Add(EmptyState(
                    $"No {label} results yet",
                    "This category's real data source isn't wired up yet — it lands in its own build. Until then its honest count is 0."));
                RenderDetail();
                return;
            }

            _filtered = FilterCommands(PaletteInput.Text);
            if (!preserveSelection)
                _selectedIndex = _filtered.Count > 0 ? 0 : -1;

            if (_filtered.Count == 0)
            {
                string q = PaletteInput.Text.Trim();
                PaletteResults.Children.Add(EmptyState(
                    $"No matches for “{q}”",
                    "Category data sources (epics, issues, builds, services…) aren't wired yet — only the quick-action commands are searchable in this shell."));
                RenderDetail();
                return;
            }

            for (int i = 0; i < _filtered.Count; i++)
            {
                var cmd = _filtered[i];
                bool selected = i == _selectedIndex;

                var dock = new DockPanel();
                dock.Children.Add(new Border
                {
                    Width = 30,
                    Height = 30,
                    CornerRadius = new CornerRadius(7),
                    Margin = new Thickness(0, 0, 10, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Background = (Brush)FindResource("CardBackgroundBrush"),
                    Child = new TextBlock
                    {
                        Text = cmd.Glyph,
                        FontFamily = new FontFamily("Segoe MDL2 Assets"),
                        FontSize = 13,
                        HorizontalAlignment = HorizontalAlignment.Center,
                        VerticalAlignment = VerticalAlignment.Center,
                        Foreground = (Brush)FindResource("TextPrimaryBrush"),
                    },
                });
                DockPanel.SetDock(dock.Children[0], Dock.Left);

                var tag = new Border
                {
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 2, 6, 2),
                    VerticalAlignment = VerticalAlignment.Center,
                    Background = (Brush)FindResource("AccentWashLightBrush"),
                    BorderBrush = (Brush)FindResource("AccentBrush"),
                    BorderThickness = new Thickness(1),
                    Child = new TextBlock
                    {
                        Text = "ACTION",
                        FontSize = 8.5,
                        FontWeight = FontWeights.Bold,
                        Foreground = (Brush)FindResource("AccentBrush"),
                    },
                };
                DockPanel.SetDock(tag, Dock.Right);
                dock.Children.Add(tag);

                var textStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
                textStack.Children.Add(new TextBlock
                {
                    Text = cmd.Title,
                    FontSize = 13,
                    FontWeight = FontWeights.SemiBold,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    Foreground = (Brush)FindResource("TextPrimaryBrush"),
                });
                textStack.Children.Add(new TextBlock
                {
                    Text = cmd.Subtitle,
                    FontSize = 11,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    Foreground = (Brush)FindResource("TextSecondaryBrush"),
                });
                dock.Children.Add(textStack);

                var row = new Border
                {
                    CornerRadius = new CornerRadius(8),
                    Padding = new Thickness(10, 8, 10, 8),
                    Margin = new Thickness(0, 2, 0, 2),
                    Cursor = Cursors.Hand,
                    Background = selected
                        ? (Brush)FindResource("AccentWashLightBrush")
                        : Brushes.Transparent,
                    BorderThickness = new Thickness(1),
                    BorderBrush = selected
                        ? (Brush)FindResource("AccentBrush")
                        : Brushes.Transparent,
                    Child = dock,
                };
                int localIndex = i;
                row.MouseLeftButtonDown += (_, e) =>
                {
                    e.Handled = true;
                    if (e.ClickCount >= 2)
                    {
                        _selectedIndex = localIndex;
                        RunSelected();
                    }
                    else
                    {
                        _selectedIndex = localIndex;
                        _liveResultText = null;
                        RenderResults(preserveSelection: true);
                    }
                };
                PaletteResults.Children.Add(row);
            }

            RenderDetail();
        }

        private static StackPanel EmptyState(string title, string body)
        {
            var stack = new StackPanel { Margin = new Thickness(16, 28, 16, 16), HorizontalAlignment = HorizontalAlignment.Center };
            stack.Children.Add(new TextBlock
            {
                Text = "\uE721", // Segoe MDL2 "Search"
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 22,
                HorizontalAlignment = HorizontalAlignment.Center,
                Foreground = (Brush)Application.Current.FindResource("TextDisabledBrush"),
            });
            stack.Children.Add(new TextBlock
            {
                Text = title,
                Margin = new Thickness(0, 10, 0, 4),
                FontSize = 12.5,
                FontWeight = FontWeights.SemiBold,
                HorizontalAlignment = HorizontalAlignment.Center,
                Foreground = (Brush)Application.Current.FindResource("TextPrimaryBrush"),
            });
            stack.Children.Add(new TextBlock
            {
                Text = body,
                FontSize = 11,
                MaxWidth = 380,
                TextWrapping = TextWrapping.Wrap,
                TextAlignment = TextAlignment.Center,
                Foreground = (Brush)Application.Current.FindResource("TextSecondaryBrush"),
            });
            return stack;
        }

        // ── Detail / preview pane ───────────────────────────────────────────

        private void RenderDetail()
        {
            PaletteDetail.Children.Clear();

            if (_sqlMode)
            {
                RenderSqlDetail();
                return;
            }

            if (_selectedIndex < 0 || _selectedIndex >= _filtered.Count)
            {
                PaletteDetailActionHost.Visibility = Visibility.Collapsed;
                PaletteDetail.Children.Add(new TextBlock
                {
                    Text = "Select a result to preview it here.",
                    FontSize = 11,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = (Brush)FindResource("TextDisabledBrush"),
                });
                return;
            }

            var cmd = _filtered[_selectedIndex];

            PaletteDetail.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(6, 2, 6, 2),
                HorizontalAlignment = HorizontalAlignment.Left,
                Background = (Brush)FindResource("AccentWashLightBrush"),
                Child = new TextBlock
                {
                    Text = "QUICK ACTION",
                    FontSize = 8.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("AccentBrush"),
                },
            });
            PaletteDetail.Children.Add(new TextBlock
            {
                Text = cmd.Title,
                Margin = new Thickness(0, 10, 0, 6),
                FontSize = 15,
                FontWeight = FontWeights.Bold,
                TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("TextPrimaryBrush"),
            });
            // Git #3826 — a real, awaited RunWithResult result (or "Running…") wins over the
            // command's static DetailBody, so the actual outcome shows inline here instead of
            // the palette only ever pointing elsewhere (a toast, the Git panel).
            string bodyText = _liveResultText
                ?? (string.IsNullOrEmpty(cmd.DetailBody) ? cmd.Subtitle : cmd.DetailBody);
            PaletteDetail.Children.Add(new TextBlock
            {
                Text = bodyText,
                FontSize = 11.5,
                LineHeight = 17,
                TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("TextSecondaryBrush"),
            });

            if ((cmd.Run != null || cmd.RunWithResult != null) && !string.IsNullOrEmpty(cmd.ActionLabel))
            {
                PaletteDetailActionLabel.Text = $"{cmd.ActionLabel}  ↵";
                PaletteDetailActionHost.Visibility = Visibility.Visible;
            }
            else
            {
                PaletteDetailActionHost.Visibility = Visibility.Collapsed;
            }
        }

        // ── Git #3828 — SQL query detection, execution, CSV/JSON results ───────

        /// <summary>The single "row" the results list shows while SQL input is detected — not a
        /// PaletteCommand, since there's real async query state (running/error/results) behind it
        /// that the fixed quick-action model doesn't carry.</summary>
        private void RenderSqlResultRow()
        {
            string query = BuildConsole.Services.SqlDetection.ExtractQuery(PaletteInput.Text);
            string preview = query.Length > 90 ? query[..90] + "…" : query;
            string subtitle = _sqlRunning
                ? "Running…"
                : _sqlError != null
                    ? $"Error — {_sqlError}"
                    : _sqlResults != null
                        ? BuildConsole.Services.SqlResultFormatter.SummaryLine(_sqlResults)
                        : "Press Enter to run this query — no click required";

            var dock = new DockPanel();
            dock.Children.Add(new Border
            {
                Width = 30,
                Height = 30,
                CornerRadius = new CornerRadius(7),
                Margin = new Thickness(0, 0, 10, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Background = (Brush)FindResource("CardBackgroundBrush"),
                Child = new TextBlock
                {
                    Text = "", // Segoe MDL2 "Tag" — placeholder DB glyph, purely cosmetic
                    FontFamily = new FontFamily("Segoe MDL2 Assets"),
                    FontSize = 13,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)FindResource("TextPrimaryBrush"),
                },
            });
            DockPanel.SetDock(dock.Children[0], Dock.Left);

            var tag = new Border
            {
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(6, 2, 6, 2),
                VerticalAlignment = VerticalAlignment.Center,
                Background = (Brush)FindResource("AccentWashLightBrush"),
                BorderBrush = (Brush)FindResource("AccentBrush"),
                BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = "SQL",
                    FontSize = 8.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("AccentBrush"),
                },
            };
            DockPanel.SetDock(tag, Dock.Right);
            dock.Children.Add(tag);

            var textStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            textStack.Children.Add(new TextBlock
            {
                Text = preview.Length == 0 ? "SQL query" : preview,
                FontSize = 13,
                FontWeight = FontWeights.SemiBold,
                FontFamily = new FontFamily("Cascadia Code, Consolas, Courier New"),
                TextTrimming = TextTrimming.CharacterEllipsis,
                Foreground = (Brush)FindResource("TextPrimaryBrush"),
            });
            textStack.Children.Add(new TextBlock
            {
                Text = subtitle,
                FontSize = 11,
                TextTrimming = TextTrimming.CharacterEllipsis,
                Foreground = (Brush)FindResource("TextSecondaryBrush"),
            });
            dock.Children.Add(textStack);

            var row = new Border
            {
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(10, 8, 10, 8),
                Margin = new Thickness(0, 2, 0, 2),
                Background = (Brush)FindResource("AccentWashLightBrush"),
                BorderThickness = new Thickness(1),
                BorderBrush = (Brush)FindResource("AccentBrush"),
                Child = dock,
            };
            PaletteResults.Children.Add(row);
        }

        /// <summary>
        /// Runs the typed query through the exact same real execution path the SQL Runner floaty
        /// uses (<see cref="BuildConsole.Services.LocalSqlExecutor.ExecuteAsync"/> — Dev target
        /// environment runs directly against local Postgres, Staging/Production go through the
        /// existing api-server HTTP pipe) — never a second, parallel execution mechanism.
        /// </summary>
        private async Task RunSqlQueryAsync()
        {
            if (_sqlRunning) return;
            string query = BuildConsole.Services.SqlDetection.ExtractQuery(PaletteInput.Text);
            if (query.Length == 0) return;

            _sqlRunning = true;
            _sqlError = null;
            RenderResults(preserveSelection: true);

            try
            {
                var statements = await BuildConsole.Services.LocalSqlExecutor.ExecuteAsync(_api!, query);
                _sqlResults = statements;
            }
            catch (Exception ex)
            {
                _sqlError = ex.Message;
                _sqlResults = null;
            }
            finally
            {
                _sqlRunning = false;
                if (_sqlMode) RenderResults(preserveSelection: true);
            }
        }

        /// <summary>Right pane while SQL input is detected: query preview, real CSV/JSON results
        /// (toggle tabs), and real Copy + Send-to-Chat actions — Send-to-Chat reuses the exact
        /// shared <c>SendTextToActiveClaudeChatAsync</c> path via <see cref="SqlSendToChatRequested"/>,
        /// same as the SQL Runner floaty's own "Send to Chat" (Git #940).</summary>
        private void RenderSqlDetail()
        {
            PaletteDetailActionHost.Visibility = Visibility.Visible;
            PaletteDetailActionLabel.Text = _sqlRunning ? "Running…" : "Run Query  ↵";

            PaletteDetail.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(6, 2, 6, 2),
                HorizontalAlignment = HorizontalAlignment.Left,
                Background = (Brush)FindResource("AccentWashLightBrush"),
                Child = new TextBlock
                {
                    Text = "SQL QUERY",
                    FontSize = 8.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("AccentBrush"),
                },
            });

            if (_sqlResults == null)
            {
                PaletteDetail.Children.Add(new TextBlock
                {
                    Text = _sqlError != null ? $"Execute failed: {_sqlError}" : "Press Enter to run this query for real against the current target database.",
                    Margin = new Thickness(0, 10, 0, 0),
                    FontSize = 11.5,
                    LineHeight = 17,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = (Brush)FindResource(_sqlError != null ? "RedBrush" : "TextSecondaryBrush"),
                });
                return;
            }

            var statements = _sqlResults;
            bool hasRows = BuildConsole.Services.SqlResultFormatter.HasRows(statements);

            PaletteDetail.Children.Add(new TextBlock
            {
                Text = BuildConsole.Services.SqlResultFormatter.SummaryLine(statements),
                Margin = new Thickness(0, 10, 0, 8),
                FontSize = 11.5,
                TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("TextSecondaryBrush"),
            });

            if (hasRows)
            {
                // CSV / JSON toggle chips
                var toggle = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 8) };
                toggle.Children.Add(SqlViewChip("CSV", !_sqlShowJson, () => { _sqlShowJson = false; RenderResults(preserveSelection: true); }));
                toggle.Children.Add(SqlViewChip("JSON", _sqlShowJson, () => { _sqlShowJson = true; RenderResults(preserveSelection: true); }));
                PaletteDetail.Children.Add(toggle);

                string resultText = _sqlShowJson
                    ? BuildConsole.Services.SqlResultFormatter.ToJson(statements)
                    : BuildConsole.Services.SqlResultFormatter.ToCsv(statements);

                var resultBox = new TextBox
                {
                    Text = resultText,
                    IsReadOnly = true,
                    TextWrapping = TextWrapping.NoWrap,
                    AcceptsReturn = true,
                    FontFamily = new FontFamily("Cascadia Code, Consolas, Courier New"),
                    FontSize = 10.5,
                    Background = (Brush)FindResource("CardBackgroundBrush"),
                    BorderThickness = new Thickness(1),
                    BorderBrush = (Brush)FindResource("BorderDividerBrush"),
                    Foreground = (Brush)FindResource("TextPrimaryBrush"),
                    Padding = new Thickness(8),
                    MaxHeight = 260,
                    HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                    VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                };
                PaletteDetail.Children.Add(resultBox);

                var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 8, 0, 0) };
                actions.Children.Add(SqlActionButton("Copy", () =>
                {
                    Clipboard.SetText(resultText);
                    ToastEngine.Success("Command Center", $"Copied {(_sqlShowJson ? "JSON" : "CSV")} to clipboard.");
                }));
                actions.Children.Add(SqlActionButton("Send to Chat", () =>
                {
                    SqlSendToChatRequested?.Invoke(this, resultText);
                }));
                PaletteDetail.Children.Add(actions);
            }
        }

        private Border SqlViewChip(string label, bool active, Action onClick)
        {
            var chip = new Border
            {
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(10, 4, 10, 4),
                Margin = new Thickness(0, 0, 6, 0),
                Cursor = Cursors.Hand,
                Background = active ? (Brush)FindResource("AccentWashLightBrush") : Brushes.Transparent,
                BorderThickness = new Thickness(1),
                BorderBrush = active ? (Brush)FindResource("AccentBrush") : (Brush)FindResource("BorderDividerBrush"),
                Child = new TextBlock
                {
                    Text = label,
                    FontSize = 10.5,
                    FontWeight = active ? FontWeights.SemiBold : FontWeights.Normal,
                    Foreground = (Brush)FindResource(active ? "TextPrimaryBrush" : "TextSecondaryBrush"),
                },
            };
            chip.MouseLeftButtonDown += (_, e) => { e.Handled = true; onClick(); };
            return chip;
        }

        private Border SqlActionButton(string label, Action onClick)
        {
            var btn = new Border
            {
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(12, 6, 12, 6),
                Margin = new Thickness(0, 0, 8, 0),
                Cursor = Cursors.Hand,
                Background = (Brush)FindResource("CardBackgroundBrush"),
                BorderThickness = new Thickness(1),
                BorderBrush = (Brush)FindResource("BorderDividerBrush"),
                Child = new TextBlock
                {
                    Text = label,
                    FontSize = 11,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("TextPrimaryBrush"),
                },
            };
            btn.MouseLeftButtonDown += (_, e) => { e.Handled = true; onClick(); };
            return btn;
        }
    }
}
