using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    public class StagedScreenshotItem
    {
        public string FilePath { get; set; } = "";
        public string FileName => Path.GetFileName(FilePath);
    }

    public class BugCardViewModel
    {
        public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
        public string Severity { get; set; } = "Bug";
        public string Notes { get; set; } = "";
        public string Route { get; set; } = "";
        public string Steps { get; set; } = "";
        public string Expected { get; set; } = "";
        public string Actual { get; set; } = "";
        public List<string> Tags { get; set; } = new();
        public List<string> Screenshots { get; set; } = new();
        public DateTime CreatedAt { get; set; } = DateTime.Now;
        public bool IsResolved { get; set; }

        // Sync tracking – set to true after a successful End & Sync
        public bool IsSynced { get; set; }
        public string SyncedSessionId { get; set; } = "";

        public string TimestampDisplay => CreatedAt.ToString("HH:mm:ss");
        public string StatusButtonLabel => IsResolved ? "✓ Resolved" : "● Open";
        public bool HasScreenshot => Screenshots != null && Screenshots.Count > 0;
        public Visibility HasScreenshotVisibility => HasScreenshot ? Visibility.Visible : Visibility.Collapsed;
        public string? FirstScreenshot => Screenshots?.FirstOrDefault();

        public Brush SeverityBackground
        {
            get
            {
                return Severity switch
                {
                    "Blocker" => new SolidColorBrush(Color.FromArgb(0x33, 0xDC, 0x8A, 0x8A)),
                    "Critical" => new SolidColorBrush(Color.FromArgb(0x33, 0xDC, 0x8A, 0x8A)),
                    "Bug" => new SolidColorBrush(Color.FromArgb(0x33, 0xD4, 0xA5, 0x6C)),
                    "UI Glitch" => new SolidColorBrush(Color.FromArgb(0x33, 0x79, 0xB3, 0xC8)),
                    _ => new SolidColorBrush(Color.FromArgb(0x22, 0x8B, 0x94, 0x9E))
                };
            }
        }

        public Brush SeverityForeground
        {
            get
            {
                return Severity switch
                {
                    "Blocker" or "Critical" => new SolidColorBrush(Color.FromRgb(0xDC, 0x8A, 0x8A)),
                    "Bug" => new SolidColorBrush(Color.FromRgb(0xD4, 0xA5, 0x6C)),
                    "UI Glitch" => new SolidColorBrush(Color.FromRgb(0x79, 0xB3, 0xC8)),
                    _ => new SolidColorBrush(Color.FromRgb(0x8B, 0x94, 0x9E))
                };
            }
        }
    }

    public partial class TestModeComposerPanel : UserControl
    {
        private string _activeRoute = "about:blank";
        public string ActiveRoute => _activeRoute;
        private string _fullUrl = "";
        private bool _isWide;

        // Timers
        private readonly DispatcherTimer _clockTimer;
        private readonly DispatcherTimer _autoSaveTimer;
        private readonly DispatcherTimer _toastTimer;
        private DateTime _sessionStartTime = DateTime.Now;
        private DateTime _pageStartTime = DateTime.Now;
        private bool _showingSessionTotalTime;

        // Collections
        public ObservableCollection<StagedScreenshotItem> StagedScreenshots { get; } = new();
        public ObservableCollection<BugCardViewModel> AllBugs { get; } = new();
        private string _activeFilter = "all";
        private bool _isGlobalNotesMode;
        private string _pageNotes = "";
        private string _globalNotes = "";

        // Events
        public event Action<bool>? ToggleWidthRequested;
        public event Action? InspectRequested;
        public event Action? DiffRequested;
        public event Action? CaptureFullRequested;
        public event Action? CaptureRegionRequested;
        public event Action? CaptureHudRequested;
        public event Action<string, bool>? PageTestedCleanChanged;
        public event Action? ExitTestModeRequested;
        public event Action? HistoryRequested;
        public event Action? EndSessionSyncRequested;

        // Session inspection & controls
        public DateTime SessionStartTime => _sessionStartTime;
        public string CurrentNotes => TxtNotesBox.Text.Trim();
        public string GlobalNotes => _globalNotes;
        public string StepsText => TxtStepsBox.Text.Trim();
        public string ExpectedText => TxtExpectedBox.Text.Trim();
        public string ActualText => TxtActualBox.Text.Trim();
        public List<string> TagsList => TxtTagsBox.Text.Split(new[] { ' ', ',', ';' }, StringSplitOptions.RemoveEmptyEntries).ToList();
        public string SelectedSeverity => (CmbSeverity.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "Bug";
        public bool IsGoodChecked => ChkGood.IsChecked == true;
        public bool IsAutoClearChecked => ChkAutoClear.IsChecked == true;
        public List<string> GetStagedScreenshotPaths() => StagedScreenshots.Select(s => s.FilePath).Where(p => !string.IsNullOrEmpty(p)).ToList();

        public void ResetSession(bool clearBugs = true)
        {
            _sessionStartTime = DateTime.Now;
            _pageStartTime = DateTime.Now;
            ClearComposer();
            if (clearBugs)
            {
                AllBugs.Clear();
                RefreshBugDrawer();
            }
        }

        public TestModeComposerPanel()
        {
            InitializeComponent();
            ListStagedScreenshots.ItemsSource = StagedScreenshots;

            // Timer setup
            _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _clockTimer.Tick += ClockTimer_Tick;
            _clockTimer.Start();

            _autoSaveTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(800) };
            _autoSaveTimer.Tick += (s, e) =>
            {
                _autoSaveTimer.Stop();
                TxtSavedStatus.Text = "✓ Saved";
            };

            _toastTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            _toastTimer.Tick += (s, e) =>
            {
                _toastTimer.Stop();
                BorderToast.Visibility = Visibility.Collapsed;
            };

            // Global Ctrl+Enter shortcut in composer
            PreviewKeyDown += TestModeComposerPanel_PreviewKeyDown;
        }

        private void TestModeComposerPanel_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter && Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
            {
                e.Handled = true;
                BtnSaveBug_Click(this, new RoutedEventArgs());
            }
        }

        public void SetActiveRoute(string route, string fullUrl = "")
        {
            if (string.IsNullOrWhiteSpace(route)) route = "No tracked tab active — navigate a watched tab";
            _fullUrl = string.IsNullOrWhiteSpace(fullUrl) ? route : fullUrl;

            bool isTracked = !route.StartsWith("No tracked tab", StringComparison.OrdinalIgnoreCase) && route != "about:blank";
            DotSessionPulse.Fill = isTracked
                ? new SolidColorBrush(Color.FromRgb(0x8F, 0xC4, 0x96))
                : new SolidColorBrush(Color.FromRgb(0xD4, 0xA5, 0x6C));

            if (route != _activeRoute)
            {
                if (ChkAutoClear.IsChecked == true)
                {
                    ClearComposer();
                }
                _activeRoute = route;
                TxtRouteReadout.Text = route;
                TxtRouteReadout.ToolTip = _fullUrl;
                _pageStartTime = DateTime.Now;
                ChkGood.IsChecked = false;
                RefreshBugDrawer();
            }
        }

        public void AddReproStep(string step)
        {
            if (string.IsNullOrWhiteSpace(step)) return;
            BodyStepsExpander.Visibility = Visibility.Visible;
            IconStepsChevron.Text = "\uE70E";

            string existing = TxtStepsBox.Text.Trim();
            if (string.IsNullOrEmpty(existing))
            {
                TxtStepsBox.Text = $"1. {step}";
            }
            else
            {
                int count = existing.Split('\n').Length + 1;
                TxtStepsBox.Text = $"{existing}\n{count}. {step}";
            }
        }

        public void AppendNote(string note)
        {
            if (string.IsNullOrWhiteSpace(note)) return;
            string existing = TxtNotesBox.Text;
            TxtNotesBox.Text = string.IsNullOrWhiteSpace(existing) ? note.TrimStart('\n') : $"{existing.TrimEnd()}\n\n{note.Trim()}";
            TxtNotesBox.CaretIndex = TxtNotesBox.Text.Length;
        }

        public void StageScreenshot(string filePath)
        {
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) return;

            StagedScreenshots.Add(new StagedScreenshotItem { FilePath = filePath });
            BorderStagedShots.Visibility = Visibility.Visible;

            if (ChkAutoLinkShots.IsChecked == true)
            {
                AppendNote($"![screenshot]({filePath})");
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // Top Session Bar Actions
        // ═══════════════════════════════════════════════════════════════════

        private void ClockTimer_Tick(object? sender, EventArgs e)
        {
            var elapsed = _showingSessionTotalTime ? (DateTime.Now - _sessionStartTime) : (DateTime.Now - _pageStartTime);
            TxtTimerDisplay.Text = $"{(int)elapsed.TotalMinutes:D2}:{elapsed.Seconds:D2}";
        }

        private void BtnTimerToggle_Click(object sender, RoutedEventArgs e)
        {
            _showingSessionTotalTime = !_showingSessionTotalTime;
            ClockTimer_Tick(null, EventArgs.Empty);
            ShowToast(_showingSessionTotalTime ? "Showing Total Session Duration" : "Showing Page Duration");
        }

        private void BtnCopyUrl_Click(object sender, RoutedEventArgs e)
        {
            string toCopy = !string.IsNullOrEmpty(_fullUrl) ? _fullUrl : _activeRoute;
            if (!string.IsNullOrEmpty(toCopy) && !toCopy.StartsWith("No tracked tab", StringComparison.OrdinalIgnoreCase))
            {
                Clipboard.SetText(toCopy);
                ShowToast("URL copied to clipboard!");
            }
        }

        private void BtnExitTestMode_Click(object sender, RoutedEventArgs e)
        {
            ExitTestModeRequested?.Invoke();
        }

        private void BtnToggleWidth_Click(object sender, RoutedEventArgs e)
        {
            _isWide = !_isWide;
            IconToggleWidth.Text = _isWide ? "\uE76C" : "\uE76B";
            ToggleWidthRequested?.Invoke(_isWide);
        }

        private void BtnEndSessionSync_Click(object sender, RoutedEventArgs e)
        {
            EndSessionSyncRequested?.Invoke();
        }

        private void BtnNewSession_Click(object sender, RoutedEventArgs e)
        {
            if (MessageBox.Show("Start a new testing session? Unsaved notes will be cleared.", "New Session",
                MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
            {
                ResetSession(clearBugs: true);
                ShowToast("Fresh testing session started.");
            }
        }

        private void BtnHistory_Click(object sender, RoutedEventArgs e)
        {
            HistoryRequested?.Invoke();
        }

        private void BtnClearSession_Click(object sender, RoutedEventArgs e)
        {
            ClearComposer();
            ShowToast("Composer cleared.");
        }

        private void ChkGood_Checked(object sender, RoutedEventArgs e)
        {
            DotSessionPulse.Fill = new SolidColorBrush(Color.FromRgb(0x8F, 0xC4, 0x96)); // Light green
            PageTestedCleanChanged?.Invoke(_activeRoute, true);
            ShowToast("Marked route as clean.");
        }

        private void ChkGood_Unchecked(object sender, RoutedEventArgs e)
        {
            DotSessionPulse.Fill = new SolidColorBrush(Color.FromRgb(0xD4, 0xA5, 0x6C)); // Light amber
            PageTestedCleanChanged?.Invoke(_activeRoute, false);
        }

        public void ShowToast(string message)
        {
            TxtToast.Text = message;
            BorderToast.Visibility = Visibility.Visible;
            _toastTimer.Stop();
            _toastTimer.Start();
        }

        // ═══════════════════════════════════════════════════════════════════
        // Notes Mode & Markdown Tools
        // ═══════════════════════════════════════════════════════════════════

        private void BtnNotesPage_Click(object sender, RoutedEventArgs e)
        {
            if (_isGlobalNotesMode)
            {
                _globalNotes = TxtNotesBox.Text;
                _isGlobalNotesMode = false;
                TxtNotesBox.Text = _pageNotes;
                var accent = (Brush)(TryFindResource("AccentBrush") ?? Application.Current?.TryFindResource("AccentBrush") ?? Brushes.DodgerBlue);
                var subtext = (Brush)(TryFindResource("Subtext0Brush") ?? Application.Current?.TryFindResource("Subtext0Brush") ?? Brushes.Gray);
                BtnNotesPage.Foreground = accent;
                BtnNotesGlobal.Foreground = subtext;
            }
        }

        private void BtnNotesGlobal_Click(object sender, RoutedEventArgs e)
        {
            if (!_isGlobalNotesMode)
            {
                _pageNotes = TxtNotesBox.Text;
                _isGlobalNotesMode = true;
                TxtNotesBox.Text = _globalNotes;
                var accent = (Brush)(TryFindResource("AccentBrush") ?? Application.Current?.TryFindResource("AccentBrush") ?? Brushes.DodgerBlue);
                var subtext = (Brush)(TryFindResource("Subtext0Brush") ?? Application.Current?.TryFindResource("Subtext0Brush") ?? Brushes.Gray);
                BtnNotesGlobal.Foreground = accent;
                BtnNotesPage.Foreground = subtext;
            }
        }

        private void BtnMdBold_Click(object sender, RoutedEventArgs e) => WrapSelection("**", "**");
        private void BtnMdItalic_Click(object sender, RoutedEventArgs e) => WrapSelection("*", "*");
        private void BtnMdCode_Click(object sender, RoutedEventArgs e) => WrapSelection("`", "`");
        private void BtnMdLink_Click(object sender, RoutedEventArgs e) => WrapSelection("[", "](https://)");

        private void BtnMdList_Click(object sender, RoutedEventArgs e)
        {
            int caret = TxtNotesBox.CaretIndex;
            TxtNotesBox.Text = TxtNotesBox.Text.Insert(caret, "\n- ");
            TxtNotesBox.CaretIndex = caret + 3;
        }

        private void WrapSelection(string prefix, string suffix)
        {
            int start = TxtNotesBox.SelectionStart;
            int length = TxtNotesBox.SelectionLength;
            string selected = TxtNotesBox.SelectedText;
            if (length == 0)
            {
                TxtNotesBox.Text = TxtNotesBox.Text.Insert(start, prefix + suffix);
                TxtNotesBox.CaretIndex = start + prefix.Length;
            }
            else
            {
                TxtNotesBox.Text = TxtNotesBox.Text.Remove(start, length).Insert(start, prefix + selected + suffix);
                TxtNotesBox.SelectionStart = start + prefix.Length;
                TxtNotesBox.SelectionLength = length;
            }
        }

        private void BtnTogglePreview_Click(object sender, RoutedEventArgs e)
        {
            bool isShown = BorderMarkdownPreview.Visibility == Visibility.Visible;
            BorderMarkdownPreview.Visibility = isShown ? Visibility.Collapsed : Visibility.Visible;
            if (!isShown)
            {
                TxtMarkdownPreview.Text = TxtNotesBox.Text;
            }
        }

        private void TxtNotesBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (TxtSavedStatus != null)
            {
                TxtSavedStatus.Text = "Saving...";
                _autoSaveTimer.Stop();
                _autoSaveTimer.Start();
            }
            if (BorderMarkdownPreview?.Visibility == Visibility.Visible)
            {
                TxtMarkdownPreview.Text = TxtNotesBox.Text;
            }
        }

        private void TxtNotesBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                // If current line starts with "- ", auto continue list
                int caret = TxtNotesBox.CaretIndex;
                int lineIndex = TxtNotesBox.GetLineIndexFromCharacterIndex(caret);
                string lineText = TxtNotesBox.GetLineText(lineIndex);

                if (lineText.TrimStart().StartsWith("- ") && lineText.Trim() != "- ")
                {
                    e.Handled = true;
                    TxtNotesBox.Text = TxtNotesBox.Text.Insert(caret, "\n- ");
                    TxtNotesBox.CaretIndex = caret + 3;
                }
            }
        }

        private void TxtTagsBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            TxtSavedStatus.Text = "Saving...";
            _autoSaveTimer.Stop();
            _autoSaveTimer.Start();
        }

        private void BtnTagChip_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string tag)
            {
                string cur = TxtTagsBox.Text.Trim();
                if (!cur.Contains(tag))
                {
                    TxtTagsBox.Text = string.IsNullOrEmpty(cur) ? tag : $"{cur} {tag}";
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // Steps to Reproduce Expander
        // ═══════════════════════════════════════════════════════════════════

        private void HdrStepsExpander_Click(object sender, MouseButtonEventArgs e)
        {
            bool willOpen = BodyStepsExpander.Visibility != Visibility.Visible;
            BodyStepsExpander.Visibility = willOpen ? Visibility.Visible : Visibility.Collapsed;
            IconStepsChevron.Text = willOpen ? "\uE70E" : "\uE70D";
        }

        private void BtnAddStep_Click(object sender, RoutedEventArgs e)
        {
            string cur = TxtStepsBox.Text.Trim();
            int count = string.IsNullOrEmpty(cur) ? 1 : cur.Split('\n').Length + 1;
            TxtStepsBox.Text = string.IsNullOrEmpty(cur) ? "1. " : $"{cur}\n{count}. ";
            TxtStepsBox.CaretIndex = TxtStepsBox.Text.Length;
        }

        // ═══════════════════════════════════════════════════════════════════
        // Screenshot & Capture Actions
        // ═══════════════════════════════════════════════════════════════════

        private void BtnFullShot_Click(object sender, RoutedEventArgs e) => CaptureFullRequested?.Invoke();
        private void BtnRegionShot_Click(object sender, RoutedEventArgs e) => CaptureRegionRequested?.Invoke();
        private void BtnHudShot_Click(object sender, RoutedEventArgs e) => CaptureHudRequested?.Invoke();
        private void BtnDiffShot_Click(object sender, RoutedEventArgs e) => DiffRequested?.Invoke();
        private void BtnInspectShot_Click(object sender, RoutedEventArgs e) => InspectRequested?.Invoke();

        private void BtnRemoveStagedShot_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is StagedScreenshotItem item)
            {
                StagedScreenshots.Remove(item);
                if (StagedScreenshots.Count == 0)
                {
                    BorderStagedShots.Visibility = Visibility.Collapsed;
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // Save Bug Entry
        // ═══════════════════════════════════════════════════════════════════

        private void BtnSaveBug_Click(object sender, RoutedEventArgs e)
        {
            string notes = TxtNotesBox.Text.Trim();
            if (string.IsNullOrEmpty(notes))
            {
                MessageBox.Show("Please enter notes or bug description before saving.", "Save Bug", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            string severity = (CmbSeverity.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "Bug";
            var bug = new BugCardViewModel
            {
                Severity = severity,
                Notes = notes,
                Route = _activeRoute,
                Steps = TxtStepsBox.Text.Trim(),
                Expected = TxtExpectedBox.Text.Trim(),
                Actual = TxtActualBox.Text.Trim(),
                Screenshots = StagedScreenshots.Select(s => s.FilePath).ToList(),
                Tags = TxtTagsBox.Text.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList()
            };

            AllBugs.Insert(0, bug);
            ClearComposer();
            RefreshBugDrawer();
            ShowToast($"Bug entry #{bug.Id} saved!");

            // Mark session dot amber
            DotSessionPulse.Fill = new SolidColorBrush(Color.FromRgb(0xD4, 0xA5, 0x6C));
            ChkGood.IsChecked = false;
        }

        /// <summary>
        /// Stamps all bug entries whose IDs are in <paramref name="ids"/> as synced.
        /// Call this after a successful End &amp; Sync so the history panel can show the correct pill.
        /// </summary>
        public void MarkBugsSynced(string sessionId, IEnumerable<string> ids)
        {
            if (string.IsNullOrEmpty(sessionId)) return;
            var idSet = new HashSet<string>(ids ?? Enumerable.Empty<string>(), StringComparer.OrdinalIgnoreCase);
            foreach (var bug in AllBugs)
            {
                if (!bug.IsSynced && idSet.Contains(bug.Id))
                {
                    bug.IsSynced = true;
                    bug.SyncedSessionId = sessionId;
                }
            }
        }

        /// <summary>
        /// Directly inserts a bug entry into the bug list (e.g. from DOM Inspector) and opens the drawer.
        /// </summary>
        public void AddBug(BugCardViewModel bug)
        {
            AllBugs.Insert(0, bug);
            RefreshBugDrawer();
            ShowToast($"Bug entry #{bug.Id} logged!");

            DotSessionPulse.Fill = new SolidColorBrush(Color.FromRgb(0xD4, 0xA5, 0x6C));
            ChkGood.IsChecked = false;

            // Automatically reveal the bug drawer
            BodyBugDrawer.Visibility = Visibility.Visible;
            IconBugDrawerChevron.Text = "\uE70D";
        }

        private void BtnClearBug_Click(object sender, RoutedEventArgs e)
        {
            ClearComposer();
        }

        public void ClearComposer()
        {
            TxtNotesBox.Clear();
            TxtTagsBox.Clear();
            TxtStepsBox.Clear();
            TxtExpectedBox.Clear();
            TxtActualBox.Clear();
            StagedScreenshots.Clear();
            BorderStagedShots.Visibility = Visibility.Collapsed;
            BorderMarkdownPreview.Visibility = Visibility.Collapsed;
            CmbSeverity.SelectedIndex = 2; // "Bug"
        }

        // ═══════════════════════════════════════════════════════════════════
        // Bug List Drawer
        // ═══════════════════════════════════════════════════════════════════

        private void HdrBugDrawer_Click(object sender, MouseButtonEventArgs e)
        {
            bool willOpen = BodyBugDrawer.Visibility != Visibility.Visible;
            BodyBugDrawer.Visibility = willOpen ? Visibility.Visible : Visibility.Collapsed;
            IconBugDrawerChevron.Text = willOpen ? "\uE70D" : "\uE70E";
        }

        private void BtnFilter_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string tag)
            {
                _activeFilter = tag;
                var accent = (Brush)(TryFindResource("AccentBrush") ?? Application.Current?.TryFindResource("AccentBrush") ?? Brushes.DodgerBlue);
                var subtext = (Brush)(TryFindResource("Subtext0Brush") ?? Application.Current?.TryFindResource("Subtext0Brush") ?? Brushes.Gray);
                BtnFilterAll.Foreground = tag == "all" ? accent : subtext;
                BtnFilterOpen.Foreground = tag == "open" ? accent : subtext;
                BtnFilterResolved.Foreground = tag == "resolved" ? accent : subtext;
                RefreshBugDrawer();
            }
        }

        public void RefreshBugDrawer()
        {
            var filtered = AllBugs.Where(b =>
            {
                if (_activeFilter == "open") return !b.IsResolved;
                if (_activeFilter == "resolved") return b.IsResolved;
                return true;
            }).ToList();

            ListBugCards.ItemsSource = filtered;
            int onPageCount = AllBugs.Count(b => b.Route == _activeRoute);
            TxtBugDrawerTitle.Text = $"Bugs on this page ({onPageCount}) · Total ({AllBugs.Count})";
        }

        private void BtnToggleBugStatus_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is BugCardViewModel bug)
            {
                bug.IsResolved = !bug.IsResolved;
                RefreshBugDrawer();
            }
        }

        private void BtnCopyBugMd_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is BugCardViewModel bug)
            {
                var sb = new StringBuilder();
                sb.AppendLine($"### [{bug.Severity}] {bug.Route}");
                sb.AppendLine($"- **Status**: {(bug.IsResolved ? "Resolved" : "Open")}");
                sb.AppendLine($"- **Notes**: {bug.Notes}");
                if (!string.IsNullOrEmpty(bug.Steps)) sb.AppendLine($"- **Steps**: {bug.Steps}");
                if (!string.IsNullOrEmpty(bug.Expected)) sb.AppendLine($"- **Expected**: {bug.Expected}");
                if (!string.IsNullOrEmpty(bug.Actual)) sb.AppendLine($"- **Actual**: {bug.Actual}");
                Clipboard.SetText(sb.ToString());
                ShowToast("Bug markdown copied!");
            }
        }

        private void BtnDeleteBug_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is BugCardViewModel bug)
            {
                AllBugs.Remove(bug);
                RefreshBugDrawer();
                ShowToast("Bug entry deleted.");
            }
        }

        private void CmbSeverity_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            // Optional telemetry or styling hook
        }
    }
}
