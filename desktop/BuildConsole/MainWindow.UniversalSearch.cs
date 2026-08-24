using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Universal title-bar search (Ctrl+K). Replaces the old fake-data command
    /// palette: the search box in the title bar drives a grouped-by-source
    /// dropdown (the repurposed <c>CommandPaletteOverlay</c>) that live-filters
    /// the app's REAL in-memory data — Explorer files, Git Board issues/epics/
    /// milestones, test manifests, the Build Queue, and Chats — and navigates by
    /// reusing each source's existing open mechanism (OpenFileTab /
    /// OpenGitDetailByNumberAsync / OpenMilestoneDetailTab / OpenChatTab / the
    /// queue reveal), never a duplicate per-source implementation.
    ///
    /// Split into its own partial-class file to stay clear of the concurrently
    /// edited MainWindow.xaml.cs.
    /// </summary>
    public partial class MainWindow
    {
        private const string RepoRoot = @"C:\Source\ShaneMcCawConsulting\Shane-McCaw-MSP";

        // Source-type group headers (also the grouping key). One header per real source.
        private const string CatFiles = "Files";
        private const string CatGit = "Git Board";
        private const string CatQueue = "Build Queue";
        private const string CatManifests = "Test Manifests";
        private const string CatChats = "Chats";

        // A transient snapshot of the repo's file paths — the same filesystem the
        // Explorer tree lazily renders. Rebuilt in the background whenever the
        // dropdown opens and the last build is stale (see RefreshFileIndexIfStaleAsync)
        // so a file created/landed by another concurrent session (a build, a git pull)
        // after this app launched still turns up without a full app restart.
        private List<(string Name, string Path)>? _fileIndex;
        private bool _fileIndexBuilding;
        private DateTime _fileIndexBuiltAtUtc = DateTime.MinValue;
        private static readonly TimeSpan FileIndexMaxAge = TimeSpan.FromSeconds(60);

        // Re-runs the query a few times after the dropdown opens so async Git-board /
        // chat loads warmed on open stream into the results without a keystroke.
        private DispatcherTimer? _searchRefreshTimer;
        private int _searchRefreshTicks;

        // ── Open / close ────────────────────────────────────────────────────

        /// <summary>Ctrl+K — focus the title-bar search box and open the dropdown.</summary>
        private void ToggleCommandPalette()
        {
            if (CommandPaletteOverlay.Visibility == Visibility.Visible)
            {
                HideCommandPalette();
                Keyboard.ClearFocus();
                return;
            }

            RefreshFileIndexIfStaleAsync();
            LeftSidebar.WarmSearchSources();
            TitleSearchBox.Focus();
            Keyboard.Focus(TitleSearchBox);
            TitleSearchBox.SelectAll();
            ShowSearchDropdown();
            RunUniversalSearch(TitleSearchBox.Text ?? string.Empty);
        }

        private void ShowSearchDropdown()
        {
            if (CommandPaletteOverlay.Visibility == Visibility.Visible) return;

            // WebView2 is a native HwndHost that renders over WPF regardless of
            // z-order, so a WPF overlay is invisible where it overlaps one. Hide
            // the active WebView2 while the dropdown is up (restored on close) —
            // the same proven airspace fix the old palette used.
            var wv = GetActiveWebView();
            if (wv != null) wv.Visibility = Visibility.Hidden;

            Services.UiFadeHelper.FadeIn(CommandPaletteOverlay);
            ScheduleSearchRefresh();
        }

        private void HideCommandPalette()
        {
            if (CommandPaletteOverlay.Visibility != Visibility.Visible) return;
            Services.UiFadeHelper.FadeOut(CommandPaletteOverlay);

            var wv = GetActiveWebView();
            if (wv != null) wv.Visibility = Visibility.Visible;

            // Slide back to compact if the search box is now empty.
            if (string.IsNullOrEmpty(TitleSearchBox.Text))
                CollapseSearchBar();
        }

        private void CommandPaletteOverlay_MouseDown(object sender, MouseButtonEventArgs e)
        {
            // Only a click on the scrim itself (outside the results Border) dismisses.
            if (ReferenceEquals(e.OriginalSource, CommandPaletteOverlay))
                HideCommandPalette();
        }

        // ── Compact search bar animation ──────────────────────────────────
        private const double SearchCompactWidth = 240;
        private const double SearchExpandedWidth = 820;
        private bool _searchExpanded;

        /// <summary>Animate the title-bar search border from compact to expanded width.</summary>
        private void ExpandSearchBar()
        {
            if (_searchExpanded) return;
            _searchExpanded = true;

            var anim = new DoubleAnimation
            {
                To = SearchExpandedWidth,
                Duration = TimeSpan.FromMilliseconds(200),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            };
            SearchBorder.BeginAnimation(FrameworkElement.WidthProperty, anim);

            // Hide the Ctrl+K hint — it crowds the expanded input.
            SearchCtrlKHint.Visibility = Visibility.Collapsed;
            // Show full placeholder text.
            if (SearchPlaceholder != null)
                SearchPlaceholder.Text = "Search files, issues, chats, tests, builds\u2026";
        }

        /// <summary>Animate the title-bar search border back to compact width.</summary>
        private void CollapseSearchBar()
        {
            if (!_searchExpanded) return;
            _searchExpanded = false;

            var anim = new DoubleAnimation
            {
                To = SearchCompactWidth,
                Duration = TimeSpan.FromMilliseconds(200),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            };
            SearchBorder.BeginAnimation(FrameworkElement.WidthProperty, anim);

            // Restore the Ctrl+K hint and short placeholder.
            SearchCtrlKHint.Visibility = Visibility.Visible;
            if (SearchPlaceholder != null)
                SearchPlaceholder.Text = "Search files, issues, chats\u2026";
        }

        // ── Title-bar search box handlers ───────────────────────────────────

        /// <summary>Clicking anywhere on the border pill focuses the TextBox.</summary>
        private void SearchBorder_MouseDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            TitleSearchBox.Focus();
            Keyboard.Focus(TitleSearchBox);
        }

        private void TitleSearchBox_GotKeyboardFocus(object sender, KeyboardFocusChangedEventArgs e)
        {
            ExpandSearchBar();

            // Warm the sources the search reads (cheap disk scan for manifests +
            // fire the real Git/chat populate when empty) — no visible change here;
            // the dropdown opens on the first keystroke (or Ctrl+K).
            RefreshFileIndexIfStaleAsync();
            LeftSidebar.WarmSearchSources();
        }

        private void TitleSearchBox_LostKeyboardFocus(object sender, KeyboardFocusChangedEventArgs e)
        {
            // Stay expanded if the palette is still open or there is text in the box;
            // otherwise slide back to compact.
            bool paletteOpen = CommandPaletteOverlay?.Visibility == Visibility.Visible;
            bool hasText = !string.IsNullOrEmpty(TitleSearchBox.Text);
            if (!paletteOpen && !hasText)
                CollapseSearchBar();
        }

        private void TitleSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            bool empty = string.IsNullOrEmpty(TitleSearchBox.Text);
            if (SearchPlaceholder != null)
                SearchPlaceholder.Visibility = empty ? Visibility.Visible : Visibility.Collapsed;

            if (!empty)
            {
                if (CommandPaletteOverlay.Visibility != Visibility.Visible)
                    ShowSearchDropdown();
                RunUniversalSearch(TitleSearchBox.Text!);
            }
            else if (CommandPaletteOverlay.Visibility == Visibility.Visible)
            {
                RunUniversalSearch(string.Empty); // keep the dropdown open, show the hint
            }
        }

        private void TitleSearchBox_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (PaletteResultsList == null) return;
            switch (e.Key)
            {
                case Key.Down:
                    e.Handled = true;
                    if (PaletteResultsList.Items.Count > 0)
                    {
                        PaletteResultsList.SelectedIndex =
                            Math.Min(PaletteResultsList.SelectedIndex + 1, PaletteResultsList.Items.Count - 1);
                        if (PaletteResultsList.SelectedItem != null)
                            PaletteResultsList.ScrollIntoView(PaletteResultsList.SelectedItem);
                    }
                    break;
                case Key.Up:
                    e.Handled = true;
                    if (PaletteResultsList.Items.Count > 0)
                    {
                        PaletteResultsList.SelectedIndex =
                            Math.Max(PaletteResultsList.SelectedIndex - 1, 0);
                        if (PaletteResultsList.SelectedItem != null)
                            PaletteResultsList.ScrollIntoView(PaletteResultsList.SelectedItem);
                    }
                    break;
                case Key.Enter:
                    e.Handled = true;
                    ExecuteSelectedPaletteItem();
                    break;
                case Key.Escape:
                    e.Handled = true;
                    HideCommandPalette();
                    Keyboard.ClearFocus();
                    break;
            }
        }

        // ── Results list activation ─────────────────────────────────────────

        private void PaletteResultsList_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        {
            if (FindPaletteItem(e.OriginalSource as DependencyObject) is PaletteItem item)
            {
                e.Handled = true;
                HideCommandPalette();
                item.ExecuteAction?.Invoke();
            }
        }

        private void PaletteResultsList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
            => ExecuteSelectedPaletteItem();

        private void ExecuteSelectedPaletteItem()
        {
            if (PaletteResultsList.SelectedItem is PaletteItem item)
            {
                HideCommandPalette();
                item.ExecuteAction?.Invoke();
            }
        }

        private static PaletteItem? FindPaletteItem(DependencyObject? src)
        {
            while (src != null && src is not ListBoxItem)
                src = VisualTreeHelper.GetParent(src);
            return (src as ListBoxItem)?.DataContext as PaletteItem;
        }

        // ── The search itself ───────────────────────────────────────────────

        private void RunUniversalSearch(string rawQuery)
        {
            if (PaletteResultsList == null || SearchEmptyHint == null) return;

            string q = (rawQuery ?? string.Empty).Trim();
            if (q.Length == 0)
            {
                PaletteResultsList.ItemsSource = null;
                SearchEmptyHint.Text = "Type to search files, issues, chats, tests & builds…";
                SearchEmptyHint.Visibility = Visibility.Visible;
                return;
            }

            // A pasted repo-relative path ("lib/db/migrations/manual/foo.sql") uses
            // forward slashes; the indexed file paths on disk are Windows-native
            // backslash paths, so a plain substring search silently never matched one
            // against the other. Used only for the FILE/MANIFEST path checks below —
            // title/issue-number matches elsewhere are unaffected.
            string qPath = q.Replace('/', '\\');

            var items = new List<PaletteItem>();
            var counts = new Dictionary<string, int>();
            var caps = new Dictionary<string, int>
            {
                [CatFiles] = 40,
                [CatGit] = 30,
                [CatQueue] = 30,
                [CatManifests] = 30,
                [CatChats] = 30,
            };

            bool CanAdd(string cat) => !counts.TryGetValue(cat, out var n) || n < caps[cat];
            void Add(string cat, string icon, string title, string desc, string rankOn, Action act)
            {
                items.Add(new PaletteItem
                {
                    Category = cat,
                    Icon = icon,
                    Title = title,
                    Description = desc,
                    MatchRank = rankOn.StartsWith(q, StringComparison.OrdinalIgnoreCase) ? 0 : 1,
                    ExecuteAction = act,
                });
                counts[cat] = (counts.TryGetValue(cat, out var c) ? c : 0) + 1;
            }
            static bool Has(string? s, string query)
                => !string.IsNullOrEmpty(s) && s.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0;

            // FILES — the same filesystem the Explorer tree renders.
            var fileIndex = _fileIndex;
            if (fileIndex != null)
            {
                foreach (var (name, path) in fileIndex)
                {
                    if (!CanAdd(CatFiles)) break;
                    if (Has(name, q) || Has(path, qPath))
                    {
                        string local = path;
                        Add(CatFiles, FileIcon(name), name, RepoRelative(path), name,
                            () => OpenFileTab(local));
                    }
                }
            }

            // GIT BOARD — issues + epics from the board's own last fetch.
            foreach (var it in LeftSidebar.CurrentBoardIssues)
            {
                if (!CanAdd(CatGit)) break;
                if (Has(it.Title, q) || it.Number.ToString().Contains(q) || ("#" + it.Number).Contains(q))
                {
                    int number = it.Number;
                    string desc = it.IsEpic
                        ? $"Epic · {it.SubIssueCount} sub-issue{(it.SubIssueCount == 1 ? "" : "s")}{(it.IsClosed ? " · closed" : "")}"
                        : $"{(it.IsTodo ? "Shane To-Do" : "Issue")}{(it.IsClosed ? " · closed" : "")}";
                    Add(CatGit, it.IsEpic ? "⚡" : "📄", $"#{it.Number}  {it.Title}", desc, it.Title,
                        () => { _ = OpenGitDetailByNumberAsync(number); });
                }
            }

            // GIT BOARD — milestones (same source; distinct icon).
            foreach (var m in LeftSidebar.CurrentMilestones)
            {
                if (!CanAdd(CatGit)) break;
                if (Has(m.Title, q) || (m.GithubNumber?.ToString().Contains(q) ?? false))
                {
                    var milestone = m;
                    Add(CatGit, "🎯", m.Title, $"Milestone · {m.ProgressStr}", m.Title,
                        () => OpenMilestoneDetailTab(milestone));
                }
            }

            // BUILD QUEUE — the last polled queue snapshot.
            foreach (var qi in BuildQueuePanel.CurrentQueueItems)
            {
                if (!CanAdd(CatQueue)) break;
                bool match = Has(qi.Title, q) || Has(qi.Prompt, q)
                             || (qi.GithubNumber?.ToString().Contains(q) ?? false)
                             || qi.Id.ToString() == q;
                if (!match) continue;

                int id = qi.Id;
                string title = string.IsNullOrWhiteSpace(qi.Title)
                    ? (qi.GithubNumber.HasValue ? $"#{qi.GithubNumber}" : $"Queue item {qi.Id}")
                    : qi.Title;
                string desc = $"{qi.Status}"
                              + (qi.GithubNumber.HasValue ? $" · #{qi.GithubNumber}" : "")
                              + (string.IsNullOrEmpty(qi.Model) ? "" : $" · {qi.Model}");
                Add(CatQueue, QueueIcon(qi.Status), title, desc, title,
                    () => { RevealBuildQueue(); BuildQueuePanel.RevealQueueItem(id); });
            }

            // TEST MANIFESTS — the enumerated set backing ManifestFilesTree.
            foreach (var mf in LeftSidebar.CurrentManifests)
            {
                if (!CanAdd(CatManifests)) break;
                if (Has(mf.FileName, q) || Has(mf.Area, q) || Has(mf.FullPath, qPath))
                {
                    string full = mf.FullPath;
                    Add(CatManifests, "🧪", mf.FileName, $"{mf.Area} · test manifest", mf.FileName,
                        () => OpenFileTab(full));
                }
            }

            // CHATS — the last chat-board fetch (polled every 20s regardless of view).
            foreach (var c in LeftSidebar.CurrentBoardChats)
            {
                if (!CanAdd(CatChats)) break;
                if (Has(c.Title, q) || (c.IssueGithubNumber?.ToString().Contains(q) ?? false))
                {
                    var chat = c;
                    string desc = c.IssueGithubNumber.HasValue ? $"Chat · #{c.IssueGithubNumber}"
                                : c.EpicId.HasValue ? $"Chat · epic {c.EpicId}"
                                : "Chat";
                    Add(CatChats, "💬", string.IsNullOrWhiteSpace(c.Title) ? "(untitled chat)" : c.Title,
                        desc, c.Title, () => OpenChatTab(chat, chat.IssueGithubNumber));
                }
            }

            var ordered = items
                .OrderBy(i => CategoryOrder(i.Category))
                .ThenBy(i => i.MatchRank)
                .ToList();

            if (ordered.Count == 0)
            {
                PaletteResultsList.ItemsSource = null;
                SearchEmptyHint.Text = $"No matches for \u201C{q}\u201D.";
                SearchEmptyHint.Visibility = Visibility.Visible;
                return;
            }

            SearchEmptyHint.Visibility = Visibility.Collapsed;
            var view = new ListCollectionView(ordered);
            view.GroupDescriptions.Add(new PropertyGroupDescription(nameof(PaletteItem.Category)));
            PaletteResultsList.ItemsSource = view;
            PaletteResultsList.SelectedIndex = 0;
        }

        // ── Helpers ─────────────────────────────────────────────────────────

        private void RevealBuildQueue()
        {
            if (ColQueue.Width.Value <= 0)
                ColQueue.Width = new GridLength(DefaultQueueWidth);
            BuildQueuePanel.Visibility = Visibility.Visible;
        }

        private void ScheduleSearchRefresh()
        {
            _searchRefreshTicks = 0;
            if (_searchRefreshTimer == null)
            {
                _searchRefreshTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(700) };
                _searchRefreshTimer.Tick += (_, _) =>
                {
                    _searchRefreshTicks++;
                    if (CommandPaletteOverlay.Visibility == Visibility.Visible &&
                        !string.IsNullOrWhiteSpace(TitleSearchBox.Text))
                    {
                        RunUniversalSearch(TitleSearchBox.Text);
                    }
                    if (_searchRefreshTicks >= 4 || CommandPaletteOverlay.Visibility != Visibility.Visible)
                        _searchRefreshTimer!.Stop();
                };
            }
            _searchRefreshTimer.Start();
        }

        /// <summary>
        /// Rebuilds the file index if it's never been built, or if the last build is
        /// older than <see cref="FileIndexMaxAge"/> — the fix for "I pasted a path to a
        /// file another session had just landed and search couldn't find it": the index
        /// used to be built exactly once per app launch and never touched again, so a
        /// file created after BuildConsole started (a concurrent session's build, a git
        /// pull) stayed invisible to search until a full app restart. Cheap no-op when
        /// still fresh; the existing (possibly stale) index keeps serving results while
        /// a fresh one builds in the background, so this never blocks or blanks the
        /// dropdown — it only swaps in once ready.
        /// </summary>
        private async void RefreshFileIndexIfStaleAsync()
        {
            if (_fileIndexBuilding) return;
            if (_fileIndex != null && DateTime.UtcNow - _fileIndexBuiltAtUtc < FileIndexMaxAge) return;
            _fileIndexBuilding = true;
            try
            {
                var built = await Task.Run(() =>
                {
                    var acc = new List<(string, string)>();
                    if (!Directory.Exists(RepoRoot)) return acc;
                    var opt = new EnumerationOptions
                    {
                        IgnoreInaccessible = true,
                        RecurseSubdirectories = true,
                        MaxRecursionDepth = 12,
                    };
                    try
                    {
                        foreach (var f in Directory.EnumerateFiles(RepoRoot, "*.*", opt))
                        {
                            if (f.IndexOf("\\bin\\", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                f.IndexOf("\\obj\\", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                f.IndexOf("\\node_modules\\", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                f.IndexOf("\\.git\\", StringComparison.OrdinalIgnoreCase) >= 0)
                                continue;
                            string name = Path.GetFileName(f);
                            if (name.StartsWith(".")) continue;
                            acc.Add((name, f));
                            if (acc.Count >= 25000) break;
                        }
                    }
                    catch { /* best-effort; partial index is fine */ }
                    return acc;
                });

                _fileIndex = built;
                _fileIndexBuiltAtUtc = DateTime.UtcNow;
                if (CommandPaletteOverlay.Visibility == Visibility.Visible)
                    RunUniversalSearch(TitleSearchBox.Text ?? string.Empty);
            }
            catch { /* ignore — files just won't appear this session */ }
            finally { _fileIndexBuilding = false; }
        }

        private static int CategoryOrder(string cat) => cat switch
        {
            CatFiles => 0,
            CatGit => 1,
            CatQueue => 2,
            CatManifests => 3,
            CatChats => 4,
            _ => 9,
        };

        private static string FileIcon(string name)
        {
            string ext = Path.GetExtension(name).ToLowerInvariant();
            return ext switch
            {
                ".cs" => "⚡",
                ".xaml" => "🎨",
                ".ts" or ".tsx" or ".js" or ".jsx" => "⚛",
                ".json" => "⚙",
                ".sql" => "🗄",
                ".md" => "📝",
                _ => "📄",
            };
        }

        private static string QueueIcon(string status) => status switch
        {
            "queued" => "⏳",
            "running" => "▶",
            "done" => "✅",
            "failed" => "✕",
            "canceled" => "—",
            _ => "📦",
        };

        private static string RepoRelative(string full)
            => full.StartsWith(RepoRoot, StringComparison.OrdinalIgnoreCase)
                ? full.Substring(RepoRoot.Length).TrimStart('\\', '/')
                : full;
    }

    /// <summary>One row in the universal-search dropdown. <see cref="Category"/> is
    /// the grouping key (source-type header); <see cref="ExecuteAction"/> runs the
    /// real navigation for that source.</summary>
    public class PaletteItem
    {
        public string Category { get; set; } = "Files";
        public string CategoryUpper => Category.ToUpper();
        public string Icon { get; set; } = "📄";
        public string Title { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public Action? ExecuteAction { get; set; }
        /// <summary>Lower sorts first within a category: 0 = title starts with the query.</summary>
        public int MatchRank { get; set; }
    }
}
