using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #2136 — the cleanup/migration window. Shane's transition requirement: he has real
    /// issues sitting in stale local <c>verifying</c>/<c>parked</c>/<c>limit-paused</c>/<c>failed</c>
    /// rows RIGHT NOW (the #1867 pattern — a local status that no longer reflects reality). Moving
    /// to the "Git IS the database, Kanban columns not labels" model doesn't automatically
    /// reconcile what's already stuck, so this window surfaces every such local row alongside its
    /// REAL current GitHub board Status column, and lets Shane, per row, either:
    ///   • Migrate → board column: move the issue's real board Status to match the local state
    ///     (verifying → Verifying, parked → Park, failed → Crashed), adopting the new model; or
    ///   • Dismiss: mark the stale local row canceled so it stops re-surfacing, leaving whatever
    ///     real decision already exists on GitHub untouched (the #1867 resolution).
    ///
    /// Reusable beyond the one-time migration: any future local/board drift shows up here too.
    /// Code-behind-only (no XAML/BAML) so it stays self-contained and compile-verifiable.
    /// </summary>
    public class StaleStateReconcileWindow : Window
    {
        private readonly BuildQueuePostgresClient _db;
        private readonly GitHubApiClient? _gh;

        private readonly StackPanel _rowsPanel;
        private readonly TextBlock _statusLine;
        private readonly Button _refreshBtn;

        // ── Catppuccin Mocha palette (resolved from DarkTheme.xaml at runtime, hardcoded
        // fallbacks so the window renders even if a resource key is ever missing). ──
        private static Brush Res(string key, string fallbackHex)
        {
            if (Application.Current?.TryFindResource(key) is Brush b) return b;
            return (Brush)new BrushConverter().ConvertFromString(fallbackHex)!;
        }
        private static Brush Crust    => Res("CrustBrush",    "#CC0D1117");
        private static Brush Mantle   => Res("MantleBrush",   "#CC161B22");
        private static Brush Base_    => Res("BaseBrush",     "#661C2128");
        private static Brush Surface0 => Res("Surface0Brush", "#313244");
        private static Brush Text     => Res("TextBrush",     "#CDD6F4");
        private static Brush Subtext  => Res("Subtext0Brush", "#BAC2DE");
        private static Brush Mauve    => Res("MauveBrush",    "#CBA6F7");
        private static Brush Green    => Res("GreenBrush",    "#A6E3A1");
        private static Brush Red      => Res("RedBrush",      "#F38BA8");
        private static Brush Peach    => Res("PeachBrush",    "#FAB387");
        private static Brush Yellow   => Res("YellowBrush",   "#F9E2AF");
        private static Brush Blue     => Res("BlueBrush",     "#89B4FA");

        public StaleStateReconcileWindow(BuildQueuePostgresClient db)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));

            // Construct a GitHub client from the configured PAT if one exists — needed to read
            // the live board Status and to perform the "Migrate → board column" move. Without a
            // PAT the window still lists local rows and offers Dismiss; the board column shows a
            // clear "(no GitHub PAT)" and Migrate is disabled.
            var settings = BuildConsoleSettings.Load();
            _gh = settings.HasGitHubPat ? new GitHubApiClient(settings.GitHubPat) : null;

            Title = "Board Reconcile — Stale Local Workflow States (Git #2136)";
            Width = 760;
            Height = 580;
            MinWidth = 560;
            MinHeight = 360;
            Background = Crust;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;

            var root = new DockPanel { LastChildFill = true };

            // ── Header ──
            var header = new Border
            {
                Background = Mantle,
                BorderBrush = Surface0,
                BorderThickness = new Thickness(0, 0, 0, 1),
                Padding = new Thickness(16, 12, 16, 12),
            };
            var headerStack = new StackPanel();
            headerStack.Children.Add(new TextBlock
            {
                Text = "Reconcile local workflow state against the real GitHub board",
                Foreground = Text,
                FontSize = 15,
                FontWeight = FontWeights.SemiBold,
            });
            headerStack.Children.Add(new TextBlock
            {
                Text = "Git is the database. Each local row below is a durable workflow decision (Verifying / Parked / Crashed / limit-paused). " +
                       "Compare it to the issue's REAL current board Status column, then either move the board to match (Migrate) " +
                       "or dismiss a genuinely-stale local row (like #1867, where the real decision already happened on GitHub).",
                Foreground = Subtext,
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 6, 0, 0),
            });
            header.Child = headerStack;
            DockPanel.SetDock(header, Dock.Top);
            root.Children.Add(header);

            // ── Footer ──
            var footer = new Border
            {
                Background = Mantle,
                BorderBrush = Surface0,
                BorderThickness = new Thickness(0, 1, 0, 0),
                Padding = new Thickness(16, 10, 16, 10),
            };
            var footerDock = new DockPanel { LastChildFill = true };
            var footerButtons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            _refreshBtn = MakeButton("Refresh", Blue);
            _refreshBtn.Click += (_, _) => { _ = LoadAsync(); };
            var closeBtn = MakeButton("Close", Subtext);
            closeBtn.Click += (_, _) => Close();
            footerButtons.Children.Add(_refreshBtn);
            footerButtons.Children.Add(closeBtn);
            DockPanel.SetDock(footerButtons, Dock.Right);
            footerDock.Children.Add(footerButtons);
            _statusLine = new TextBlock
            {
                Text = "Loading…",
                Foreground = Subtext,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };
            footerDock.Children.Add(_statusLine);
            footer.Child = footerDock;
            DockPanel.SetDock(footer, Dock.Bottom);
            root.Children.Add(footer);

            // ── Rows ──
            _rowsPanel = new StackPanel { Margin = new Thickness(12) };
            var scroll = new ScrollViewer
            {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                Content = _rowsPanel,
            };
            root.Children.Add(scroll);

            Content = root;

            Loaded += (_, _) => { _ = LoadAsync(); };
        }

        private async Task LoadAsync()
        {
            _refreshBtn.IsEnabled = false;
            _rowsPanel.Children.Clear();
            _statusLine.Text = "Loading local rows…";
            _statusLine.Foreground = Subtext;

            List<QueueItem> rows;
            try
            {
                rows = await _db.GetStaleWorkflowStateRowsAsync();
            }
            catch (Exception ex)
            {
                _statusLine.Text = $"Couldn't load local rows: {ex.Message}";
                _statusLine.Foreground = Red;
                _refreshBtn.IsEnabled = true;
                return;
            }

            if (rows.Count == 0)
            {
                _rowsPanel.Children.Add(new TextBlock
                {
                    Text = "No stale local workflow rows — nothing to reconcile. Every durable decision already lives on the board.",
                    Foreground = Subtext,
                    FontSize = 13,
                    Margin = new Thickness(6, 12, 6, 6),
                    TextWrapping = TextWrapping.Wrap,
                });
                _statusLine.Text = "0 rows.";
                _refreshBtn.IsEnabled = true;
                return;
            }

            // Build each card up-front with a "board: loading…" placeholder, then fill the live
            // board status in a second pass (sequential — the set is small and manual-triggered).
            var boardTargets = new List<(QueueItem Item, TextBlock BoardText, Button MigrateBtn)>();
            foreach (var item in rows)
                boardTargets.Add(AddCard(item));

            _statusLine.Text = $"{rows.Count} local row(s). Reading live board status…";

            if (_gh == null)
            {
                foreach (var (_, boardText, migrateBtn) in boardTargets)
                {
                    boardText.Text = "board: (no GitHub PAT configured)";
                    boardText.Foreground = Peach;
                    migrateBtn.IsEnabled = false;
                }
                _statusLine.Text = $"{rows.Count} local row(s). No GitHub PAT — Dismiss available, Migrate needs a PAT (Settings).";
                _refreshBtn.IsEnabled = true;
                return;
            }

            int drift = 0;
            foreach (var (item, boardText, migrateBtn) in boardTargets)
            {
                if (!item.GithubNumber.HasValue)
                {
                    boardText.Text = "board: (local-only build, no GitHub issue)";
                    boardText.Foreground = Subtext;
                    migrateBtn.IsEnabled = false;
                    continue;
                }

                string? boardName;
                try
                {
                    var board = await _gh.GetIssueBoardStatusAsync(item.GithubNumber.Value);
                    boardName = board?.StatusName;
                }
                catch (Exception ex)
                {
                    boardText.Text = $"board: (couldn't read — {ex.Message})";
                    boardText.Foreground = Peach;
                    continue;
                }

                string expected = ExpectedBoardColumn(item.Status);
                if (string.IsNullOrEmpty(boardName))
                {
                    boardText.Text = "board: (none set)";
                    boardText.Foreground = Yellow;
                }
                else if (expected.Length > 0 && string.Equals(boardName, expected, StringComparison.OrdinalIgnoreCase))
                {
                    boardText.Text = $"board: {boardName}  ✓ in sync";
                    boardText.Foreground = Green;
                }
                else
                {
                    boardText.Text = $"board: {boardName}  ⚠ drift (local says {LocalLabel(item.Status)})";
                    boardText.Foreground = Red;
                    drift++;
                }
            }

            _statusLine.Text = $"{rows.Count} local row(s), {drift} drifting from the board. " +
                               "Migrate to move the board to match, or Dismiss a stale row.";
            _statusLine.Foreground = drift > 0 ? Peach : Subtext;
            _refreshBtn.IsEnabled = true;
        }

        /// <summary>Builds one row card and appends it; returns the pieces the board pass updates.</summary>
        private (QueueItem, TextBlock, Button) AddCard(QueueItem item)
        {
            var card = new Border
            {
                Background = Base_,
                BorderBrush = Surface0,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(12, 10, 12, 10),
                Margin = new Thickness(0, 0, 0, 8),
            };

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            // ── Left: info ──
            var info = new StackPanel();
            var titleLine = new StackPanel { Orientation = Orientation.Horizontal };
            titleLine.Children.Add(new TextBlock
            {
                Text = item.GithubNumber.HasValue ? $"#{item.GithubNumber.Value}" : $"(local #{item.Id})",
                Foreground = Blue,
                FontWeight = FontWeights.Bold,
                FontSize = 13,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 8, 0),
            });
            titleLine.Children.Add(MakeStatusBadge(item.Status));
            info.Children.Add(titleLine);

            info.Children.Add(new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(item.Title) ? "(untitled build)" : item.Title,
                Foreground = Text,
                FontSize = 13,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 4, 8, 0),
            });

            var boardText = new TextBlock
            {
                Text = "board: loading…",
                Foreground = Subtext,
                FontSize = 12,
                Margin = new Thickness(0, 5, 8, 0),
                TextWrapping = TextWrapping.Wrap,
            };
            info.Children.Add(boardText);

            Grid.SetColumn(info, 0);
            grid.Children.Add(info);

            // ── Right: actions ──
            var actions = new StackPanel { Orientation = Orientation.Vertical, VerticalAlignment = VerticalAlignment.Center };
            string? targetOption = BuildQueuePostgresClient.BoardOptionIdForLocalStatus(item.Status);
            var migrateBtn = MakeButton($"Migrate → {ExpectedBoardColumn(item.Status)}", Mauve);
            migrateBtn.Margin = new Thickness(0, 0, 0, 6);
            migrateBtn.IsEnabled = item.GithubNumber.HasValue && targetOption != null;
            migrateBtn.ToolTip = targetOption == null
                ? "This local state has no distinct board column to migrate to."
                : "Move this issue's real board Status column to match the local state.";
            migrateBtn.Click += async (_, _) => await MigrateAsync(item, targetOption, boardText, migrateBtn);

            var dismissBtn = MakeButton("Dismiss", Subtext);
            dismissBtn.ToolTip = "Mark this stale local row canceled so it stops re-surfacing. Leaves the GitHub board untouched.";
            dismissBtn.Click += async (_, _) => await DismissAsync(item, card, dismissBtn);

            actions.Children.Add(migrateBtn);
            actions.Children.Add(dismissBtn);
            Grid.SetColumn(actions, 1);
            grid.Children.Add(actions);

            card.Child = grid;
            _rowsPanel.Children.Add(card);
            return (item, boardText, migrateBtn);
        }

        private async Task MigrateAsync(QueueItem item, string? optionId, TextBlock boardText, Button migrateBtn)
        {
            if (_gh == null || optionId == null || !item.GithubNumber.HasValue) return;
            migrateBtn.IsEnabled = false;
            try
            {
                bool moved = await _gh.SetIssueStatusByNumberAsync(item.GithubNumber.Value, optionId);
                if (moved)
                {
                    boardText.Text = $"board: {ExpectedBoardColumn(item.Status)}  ✓ migrated";
                    boardText.Foreground = Green;
                    ActivityLog.Log("board-sync",
                        $"Reconcile window: migrated GH #{item.GithubNumber} to board '{ExpectedBoardColumn(item.Status)}' to match local '{item.Status}'.");
                    _statusLine.Text = $"Migrated #{item.GithubNumber} → {ExpectedBoardColumn(item.Status)}.";
                    _statusLine.Foreground = Green;
                }
                else
                {
                    boardText.Text = "board: (issue not on the project board — nothing to move)";
                    boardText.Foreground = Peach;
                    migrateBtn.IsEnabled = true;
                }
            }
            catch (Exception ex)
            {
                _statusLine.Text = $"Migrate failed for #{item.GithubNumber}: {ex.Message}";
                _statusLine.Foreground = Red;
                migrateBtn.IsEnabled = true;
            }
        }

        private async Task DismissAsync(QueueItem item, Border card, Button dismissBtn)
        {
            dismissBtn.IsEnabled = false;
            try
            {
                bool changed = await _db.DismissRowAsync(item.Id);
                if (changed)
                {
                    _rowsPanel.Children.Remove(card);
                    ActivityLog.Log("board-sync",
                        $"Reconcile window: dismissed stale local row #{item.Id} (GH #{item.GithubNumber?.ToString() ?? "none"}, was '{item.Status}') → canceled. Board untouched.");
                    _statusLine.Text = $"Dismissed local row #{item.Id}.";
                    _statusLine.Foreground = Subtext;
                }
                else
                {
                    _statusLine.Text = $"Row #{item.Id} was no longer in a dismissable state (already changed).";
                    _statusLine.Foreground = Peach;
                    dismissBtn.IsEnabled = true;
                }
            }
            catch (Exception ex)
            {
                _statusLine.Text = $"Dismiss failed for #{item.Id}: {ex.Message}";
                _statusLine.Foreground = Red;
                dismissBtn.IsEnabled = true;
            }
        }

        // ── Small UI helpers ──
        private static string ExpectedBoardColumn(string? localStatus) => localStatus switch
        {
            BuildQueuePostgresClient.VerifyingStatus => "Verifying",
            "parked" => "Park",
            "failed" => "Crashed",
            _ => "", // limit-paused (transient) has no distinct column
        };

        private static string LocalLabel(string? status) => status switch
        {
            BuildQueuePostgresClient.VerifyingStatus => "Verifying",
            "parked" => "Parked",
            "failed" => "Crashed/failed",
            _ when status == SessionLimitAutoRestartService.LimitPausedStatus => "limit-paused",
            _ => status ?? "?",
        };

        private Border MakeStatusBadge(string? status)
        {
            Brush fg = status switch
            {
                BuildQueuePostgresClient.VerifyingStatus => Mauve,
                "parked" => Yellow,
                "failed" => Red,
                _ when status == SessionLimitAutoRestartService.LimitPausedStatus => Blue,
                _ => Subtext,
            };
            return new Border
            {
                Background = Surface0,
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(6, 1, 6, 1),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock
                {
                    Text = LocalLabel(status),
                    Foreground = fg,
                    FontSize = 11,
                    FontWeight = FontWeights.SemiBold,
                },
            };
        }

        private Button MakeButton(string text, Brush accent)
        {
            var btn = new Button
            {
                Content = text,
                Foreground = accent,
                Background = Surface0,
                BorderBrush = Surface0,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(12, 5, 12, 5),
                Margin = new Thickness(0, 0, 8, 0),
                Cursor = System.Windows.Input.Cursors.Hand,
                FontSize = 12,
                MinWidth = 90,
            };
            return btn;
        }
    }
}
