using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using BuildConsole.Services;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole
{
    /// <summary>
    /// Upgraded Visual Test Tracker:
    /// - True Bug List &amp; Issue Entries (notes + screenshots binding, status management, markdown export).
    /// - Crash-safe keystroke auto-save (persisted to drafts.json across navigations, app restarts, and crashes).
    /// - Live Session Indicator showing active tab, route, and test duration.
    /// - Collapsible/minimize mode for a compact floating HUD.
    /// - Screenshot &amp; Annotation features: WebView2 full/region captures, full WPF window (HUD/overlays) capture,
    ///   and interactive InkCanvas studio (pen, highlighter, shapes, arrows, text, blackout redaction).
    /// - Title-bar API Helper integration for creating test accounts and executing page actions.
    /// - Phase 3 Composition: Auto-collected metadata (URL, timestamp, browser/WebView2 runtime, OS, viewport/window size,
    ///   user agent, page title), structured user fields (notes, steps, expected vs actual, severity, tags), and
    ///   automated attachments (screenshots, console logs, network failures, reproduction event breadcrumbs).
    /// </summary>
    public partial class VisualTestTrackerWindow : Window
    {
        private readonly DispatcherTimer _autoSaveDebounce;
        private readonly DispatcherTimer _sessionTimer;
        private readonly DispatcherTimer _telemetryPollTimer;
        private DateTime _sessionStartTime = DateTime.Now;

        private bool _loaded;
        private bool _suppressEvents;
        private bool _isCollapsed;
        private double _expandedHeight = 720;

        private VisualTestTrackerStore? _store;
        private string? _storeUnavailableReason;

        private WebView2? _activeWebView;
        private string _activeBaseUrl = "";
        private string _activePagePath = "";
        private VisualTestTrackerPage? _activePage;

        private string _selectedSeverity = "Bug";
        private readonly List<string> _stagedScreenshots = new();
        private List<VisualTestTrackerEntry> _currentEntries = new();
        private string _activeFilter = "All"; // "All", "Open", "Resolved"

        // Phase 6: Notes & Documentation Tools state
        private string _notesMode = "page"; // "page" or "global"
        private string _globalNotes = "";
        private bool _isPreviewActive;

        // Phase 8: Session Management state
        private VisualTestTrackerSession? _activeSession;

        // Phase 9: Developer Tools Integration (CDP) & DOM Inspector state
        private DomElementInfo? _inspectedDomElement;
        private bool _isDomInspectorActive;

        private ApiHelperWindow? _apiHelperWindow;

        public VisualTestTrackerWindow()
        {
            InitializeComponent();

            VisualTestTrackerTelemetry.OnDomElementInspected += info =>
            {
                Dispatcher.Invoke(() => HandleDomElementInspected(info));
            };

            _globalNotes = VisualTestTrackerDraftStore.LoadGlobalNotes();

            _autoSaveDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
            _autoSaveDebounce.Tick += (s, e) =>
            {
                _autoSaveDebounce.Stop();
                PerformAutoSave();
            };

            _sessionTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _sessionTimer.Tick += (s, e) =>
            {
                if (_activeSession != null)
                {
                    var elapsed = _activeSession.TotalElapsed;
                    SessionTimerText.Text = $"⏱ {elapsed:mm\\:ss}";
                }
                else
                {
                    var elapsed = DateTime.Now - _sessionStartTime;
                    SessionTimerText.Text = $"⏱ {elapsed:mm\\:ss}";
                }
            };
            _sessionTimer.Start();

            // Poll live telemetry diagnostics (errors, network failures, events) every 2 seconds
            _telemetryPollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            _telemetryPollTimer.Tick += async (s, e) =>
            {
                await RefreshLiveTelemetryBadgesAsync();
            };
            _telemetryPollTimer.Start();

            var settings = BuildConsoleSettings.Load();
            if (settings.VisualTestTrackerWidth > 0) Width = settings.VisualTestTrackerWidth;
            if (settings.VisualTestTrackerHeight > 0)
            {
                Height = settings.VisualTestTrackerHeight;
                _expandedHeight = Height;
            }
            if (settings.VisualTestTrackerLeft >= 0 && settings.VisualTestTrackerTop >= 0)
            {
                WindowStartupLocation = WindowStartupLocation.Manual;
                Left = settings.VisualTestTrackerLeft;
                Top = settings.VisualTestTrackerTop;
            }
            else
            {
                WindowStartupLocation = WindowStartupLocation.CenterScreen;
            }

            Loaded += (s, e) => _loaded = true;
            LocationChanged += (s, e) => PersistBounds();
            SizeChanged += (s, e) =>
            {
                if (!_isCollapsed) _expandedHeight = Height;
                PersistBounds();
            };

            InitStore();
        }

        private void InitStore()
        {
            try
            {
                var connStr = VisualTestTrackerStore.ResolveConnectionString();
                if (!string.IsNullOrWhiteSpace(connStr))
                {
                    _store = new VisualTestTrackerStore(connStr);
                }
                else
                {
                    // Fall back cleanly to local storage without disabling tracker
                    _store = new VisualTestTrackerStore("Host=localhost;Database=local_fallback;Username=postgres;Password=postgres");
                }
            }
            catch (Exception ex)
            {
                _storeUnavailableReason = ex.Message;
                // Store will still use local JSON file persistence
                try
                {
                    _store = new VisualTestTrackerStore("Host=localhost;Database=local_fallback;Username=postgres;Password=postgres");
                }
                catch { }
            }
        }

        /// <summary>Called on navigation to a watched base URL.</summary>
        public async void OnTrackedNavigation(WebView2 webView, string baseUrl, string pagePath)
        {
            // Auto-save any previous page's draft before switching
            if (!string.IsNullOrWhiteSpace(_activeBaseUrl))
            {
                if (_notesMode == "global")
                {
                    _globalNotes = NotesBox.Text;
                    VisualTestTrackerDraftStore.SaveGlobalNotes(_globalNotes);
                }
                else if (!string.IsNullOrWhiteSpace(NotesBox.Text) || !string.IsNullOrWhiteSpace(StepsBox.Text) || _stagedScreenshots.Count > 0)
                {
                    VisualTestTrackerDraftStore.SaveDraft(
                        _activeBaseUrl, _activePagePath,
                        NotesBox.Text, StepsBox.Text, ExpectedBox.Text, ActualBox.Text, TagsBox.Text,
                        _selectedSeverity, _stagedScreenshots);
                }

                // Phase 8: Pause previous page session
                VisualTestTrackerSessionStore.PauseSession(_activeSession);
            }

            _activeWebView = webView;
            _activeBaseUrl = baseUrl;
            _activePagePath = pagePath;
            _sessionStartTime = DateTime.Now;

            // Phase 8: Activate or resume target page session
            _activeSession = VisualTestTrackerSessionStore.GetOrCreateActiveSession(baseUrl, pagePath);

            // Update Session Indicator
            UpdateSessionIndicator(true);

            // Notify API Helper if open
            _apiHelperWindow?.UpdateActivePage(webView, baseUrl, pagePath);

            SetControlsEnabled(true);

            // Phase 9: Attach CDP and wire WebMessageReceived for DOM inspection & telemetry
            if (webView?.CoreWebView2 != null)
            {
                webView.CoreWebView2.WebMessageReceived -= OnActiveWebView_WebMessageReceived;
                webView.CoreWebView2.WebMessageReceived += OnActiveWebView_WebMessageReceived;
            }
            await VisualTestTrackerTelemetry.InjectObserverAsync(webView);

            try
            {
                _suppressEvents = true;

                if (_store != null)
                {
                    try
                    {
                        var page = await _store.GetOrCreatePageAsync(baseUrl, pagePath);
                        _activePage = page;
                        GoodCheckBox.IsChecked = page.IsGood;
                    }
                    catch
                    {
                        // Offline or DB not ready — keep UI enabled using local tracking
                        _activePage = new VisualTestTrackerPage { BaseUrl = baseUrl, PagePath = pagePath };
                    }
                }

                // Phase 8: Auto-clear or draft restore
                bool autoClear = ChkAutoClear.IsChecked == true;
                if (autoClear)
                {
                    VisualTestTrackerDraftStore.ClearDraft(baseUrl, pagePath);
                    if (_notesMode == "page")
                    {
                        NotesBox.Text = "";
                    }
                    StepsBox.Text = "";
                    ExpectedBox.Text = "";
                    ActualBox.Text = "";
                    TagsBox.Text = "";
                    DetailsExpander.IsExpanded = false;
                    SetSeveritySelection("Bug");
                    _stagedScreenshots.Clear();
                    RenderStagedThumbnails();
                    AutoSaveIndicator.Text = "✓ Ready";
                }
                else
                {
                    // Restore draft from crash-safe store if present
                    var draft = VisualTestTrackerDraftStore.GetDraft(baseUrl, pagePath);
                    if (draft != null)
                    {
                        if (_notesMode == "page")
                        {
                            NotesBox.Text = draft.Notes;
                        }
                        StepsBox.Text = draft.StepsToReproduce;
                        ExpectedBox.Text = draft.ExpectedBehavior;
                        ActualBox.Text = draft.ActualBehavior;
                        TagsBox.Text = draft.Tags;
                        SetSeveritySelection(draft.Severity);
                        if (!string.IsNullOrWhiteSpace(draft.StepsToReproduce) ||
                            !string.IsNullOrWhiteSpace(draft.ExpectedBehavior) ||
                            !string.IsNullOrWhiteSpace(draft.ActualBehavior))
                        {
                            DetailsExpander.IsExpanded = true;
                        }

                        _stagedScreenshots.Clear();
                        _stagedScreenshots.AddRange(draft.StagedScreenshots);
                        RenderStagedThumbnails();
                        AutoSaveIndicator.Text = _notesMode == "global" ? "✓ Global Notes" : "✓ Draft Restored";
                    }
                    else
                    {
                        if (_notesMode == "page")
                        {
                            NotesBox.Text = _activePage?.Notes ?? "";
                        }
                        StepsBox.Text = "";
                        ExpectedBox.Text = "";
                        ActualBox.Text = "";
                        TagsBox.Text = "";
                        DetailsExpander.IsExpanded = false;
                        SetSeveritySelection("Bug");
                        _stagedScreenshots.Clear();
                        RenderStagedThumbnails();
                        AutoSaveIndicator.Text = _notesMode == "global" ? "✓ Global Notes" : "✓ Ready";
                    }
                }

                if (_activeSession != null)
                {
                    GoodCheckBox.IsChecked = _activeSession.IsCleanConfirmed;
                }

                if (_isPreviewActive)
                {
                    UpdateNotesPreview();
                }

                ShowMessage("", isError: false);
                await RefreshBugListAsync();
                await RefreshLiveTelemetryBadgesAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"Failed on navigation: {ex.Message}");
                ShowMessage($"Tracker running locally: {ex.Message}", isError: false);
            }
            finally
            {
                _suppressEvents = false;
            }
        }

        /// <summary>Called when the active tab is no longer on a watched URL.</summary>
        public void ClearActiveTab()
        {
            if (!string.IsNullOrWhiteSpace(_activeBaseUrl))
            {
                if (_notesMode == "global")
                {
                    _globalNotes = NotesBox.Text;
                    VisualTestTrackerDraftStore.SaveGlobalNotes(_globalNotes);
                }
                else if (!string.IsNullOrWhiteSpace(NotesBox.Text) || !string.IsNullOrWhiteSpace(StepsBox.Text) || _stagedScreenshots.Count > 0)
                {
                    VisualTestTrackerDraftStore.SaveDraft(
                        _activeBaseUrl, _activePagePath,
                        NotesBox.Text, StepsBox.Text, ExpectedBox.Text, ActualBox.Text, TagsBox.Text,
                        _selectedSeverity, _stagedScreenshots);
                }

                VisualTestTrackerSessionStore.PauseSession(_activeSession);
            }

            if (_activeWebView?.CoreWebView2 != null)
            {
                _activeWebView.CoreWebView2.WebMessageReceived -= OnActiveWebView_WebMessageReceived;
            }
            _activeWebView = null;
            _activePage = null;
            _activeSession = null;
            _isDomInspectorActive = false;
            DomInspectorDrawer.Visibility = Visibility.Collapsed;
            BtnInspectDom.Content = "🔍 Inspect";
            UpdateSessionIndicator(false);
            SetControlsEnabled(false);
            _apiHelperWindow?.UpdateActivePage(null, "", "");
        }

        private void UpdateSessionIndicator(bool isConnected)
        {
            if (isConnected && !string.IsNullOrWhiteSpace(_activeBaseUrl))
            {
                SessionPulseDot.Fill = (Brush)FindResource("StatusSuccessBrush");
                SessionPulseDot.ToolTip = "Active testing session";

                string routeDisplay = _activePagePath;
                if (string.IsNullOrEmpty(routeDisplay)) routeDisplay = "/";
                SessionIndicatorText.Text = $"{routeDisplay} ({_activeBaseUrl})";
                SessionIndicatorText.ToolTip = $"{_activeBaseUrl}{_activePagePath}";
            }
            else
            {
                SessionPulseDot.Fill = (Brush)FindResource("StatusWarningBrush");
                SessionPulseDot.ToolTip = "Idle — no watched tab active";
                SessionIndicatorText.Text = "No tracked tab active — navigate a watched URL";
                SessionIndicatorText.ToolTip = null;
            }
        }

        private void SetControlsEnabled(bool enabled)
        {
            GoodCheckBox.IsEnabled = enabled;
            NotesBox.IsEnabled = enabled || _notesMode == "global";
            TagsBox.IsEnabled = enabled;
            StepsBox.IsEnabled = enabled;
            ExpectedBox.IsEnabled = enabled;
            ActualBox.IsEnabled = enabled;
            CmbSeverity.IsEnabled = enabled;
            BtnCaptureFull.IsEnabled = enabled;
            BtnCaptureRegion.IsEnabled = enabled;
            BtnCaptureWpfWindow.IsEnabled = enabled;
            BtnInspectDom.IsEnabled = enabled;
            BtnSaveEntry.IsEnabled = enabled;
            BtnClearDraft.IsEnabled = enabled;
            BtnNewSession.IsEnabled = enabled;
            BtnClearSession.IsEnabled = enabled;
        }

        // ── Auto-Save & Keystroke Persistence ────────────────────────────────────

        private void Field_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (_suppressEvents) return;
            AutoSaveIndicator.Text = "Saving...";
            _autoSaveDebounce.Stop();
            _autoSaveDebounce.Start();
        }

        private void QuickTag_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string tag) return;
            var current = TagsBox.Text.Trim();
            var tagFormatted = $"#{tag}";
            if (current.IndexOf(tag, StringComparison.OrdinalIgnoreCase) < 0)
            {
                TagsBox.Text = string.IsNullOrWhiteSpace(current) ? tagFormatted : $"{current}, {tagFormatted}";
            }
        }

        private void CmbSeverity_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (CmbSeverity.SelectedItem is ComboBoxItem item && item.Content is string s)
            {
                _selectedSeverity = s;
                if (!_suppressEvents) PerformAutoSave();
            }
        }

        private void SetSeveritySelection(string severity)
        {
            _selectedSeverity = severity;
            for (int i = 0; i < CmbSeverity.Items.Count; i++)
            {
                if (CmbSeverity.Items[i] is ComboBoxItem cbi && string.Equals(cbi.Content as string, severity, StringComparison.OrdinalIgnoreCase))
                {
                    CmbSeverity.SelectedIndex = i;
                    break;
                }
            }
        }

        private void PerformAutoSave()
        {
            try
            {
                if (_notesMode == "global")
                {
                    _globalNotes = NotesBox.Text;
                    VisualTestTrackerDraftStore.SaveGlobalNotes(_globalNotes);
                    AutoSaveIndicator.Text = "✓ Global Saved";
                }
                else
                {
                    if (string.IsNullOrWhiteSpace(_activeBaseUrl)) return;
                    VisualTestTrackerDraftStore.SaveDraft(
                        _activeBaseUrl, _activePagePath,
                        NotesBox.Text, StepsBox.Text, ExpectedBox.Text, ActualBox.Text, TagsBox.Text,
                        _selectedSeverity, _stagedScreenshots);
                    AutoSaveIndicator.Text = "✓ Auto-Saved";
                }

                if (_isPreviewActive)
                {
                    UpdateNotesPreview();
                }
            }
            catch
            {
                AutoSaveIndicator.Text = "Save error";
            }
        }

        // ── Phase 6: Notes & Documentation Tools ─────────────────────────────────

        private void BtnTabNotes_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string mode) return;
            if (string.Equals(_notesMode, mode, StringComparison.OrdinalIgnoreCase)) return;

            // Save active notes before switching
            if (_notesMode == "global")
            {
                _globalNotes = NotesBox.Text;
                VisualTestTrackerDraftStore.SaveGlobalNotes(_globalNotes);
            }
            else
            {
                PerformAutoSave();
            }

            _notesMode = mode.ToLowerInvariant();

            _suppressEvents = true;
            try
            {
                if (_notesMode == "global")
                {
                    BtnTabNotesPage.Foreground = (Brush)FindResource("Subtext1Brush");
                    BtnTabNotesPage.FontWeight = FontWeights.Normal;
                    BtnTabNotesGlobal.Foreground = (Brush)FindResource("AccentBrush");
                    BtnTabNotesGlobal.FontWeight = FontWeights.SemiBold;

                    _globalNotes = VisualTestTrackerDraftStore.LoadGlobalNotes();
                    NotesBox.Text = _globalNotes;
                    NotesBox.IsEnabled = true;
                    AutoSaveIndicator.Text = "✓ Global Notes";
                }
                else
                {
                    BtnTabNotesPage.Foreground = (Brush)FindResource("AccentBrush");
                    BtnTabNotesPage.FontWeight = FontWeights.SemiBold;
                    BtnTabNotesGlobal.Foreground = (Brush)FindResource("Subtext1Brush");
                    BtnTabNotesGlobal.FontWeight = FontWeights.Normal;

                    var draft = VisualTestTrackerDraftStore.GetDraft(_activeBaseUrl, _activePagePath);
                    NotesBox.Text = draft != null ? draft.Notes : (_activePage?.Notes ?? "");
                    NotesBox.IsEnabled = _activeWebView != null;
                    AutoSaveIndicator.Text = "✓ Page Notes";
                }

                if (_isPreviewActive)
                {
                    UpdateNotesPreview();
                }
            }
            finally
            {
                _suppressEvents = false;
            }
        }

        private void BtnMdFormat_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string tag) return;
            if (_isPreviewActive)
            {
                ToggleNotesPreview(false);
            }

            string selectedText = NotesBox.SelectedText;
            int selectionStart = NotesBox.SelectionStart;
            int selectionLength = NotesBox.SelectionLength;
            string replacement = "";
            int newCaretPos = selectionStart;

            switch (tag.ToLowerInvariant())
            {
                case "bold":
                    if (string.IsNullOrEmpty(selectedText))
                    {
                        replacement = "**bold text**";
                        newCaretPos = selectionStart + 2;
                        selectionLength = 9;
                    }
                    else
                    {
                        replacement = $"**{selectedText}**";
                        newCaretPos = selectionStart + replacement.Length;
                        selectionLength = 0;
                    }
                    break;

                case "italic":
                    if (string.IsNullOrEmpty(selectedText))
                    {
                        replacement = "*italic text*";
                        newCaretPos = selectionStart + 1;
                        selectionLength = 11;
                    }
                    else
                    {
                        replacement = $"*{selectedText}*";
                        newCaretPos = selectionStart + replacement.Length;
                        selectionLength = 0;
                    }
                    break;

                case "code":
                    if (string.IsNullOrEmpty(selectedText))
                    {
                        replacement = "`code`";
                        newCaretPos = selectionStart + 1;
                        selectionLength = 4;
                    }
                    else
                    {
                        replacement = $"`{selectedText}`";
                        newCaretPos = selectionStart + replacement.Length;
                        selectionLength = 0;
                    }
                    break;

                case "list":
                    if (string.IsNullOrEmpty(selectedText))
                    {
                        replacement = (selectionStart == 0 || NotesBox.Text.EndsWith("\n") || NotesBox.Text.Length <= selectionStart || NotesBox.Text[Math.Max(0, selectionStart - 1)] == '\n')
                            ? "- List item\n"
                            : "\n- List item\n";
                        newCaretPos = selectionStart + replacement.Length;
                        selectionLength = 0;
                    }
                    else
                    {
                        var lines = selectedText.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.None);
                        var sbList = new StringBuilder();
                        for (int i = 0; i < lines.Length; i++)
                        {
                            if (i > 0) sbList.Append("\n");
                            sbList.Append("- ").Append(lines[i]);
                        }
                        replacement = sbList.ToString();
                        newCaretPos = selectionStart + replacement.Length;
                        selectionLength = 0;
                    }
                    break;

                case "link":
                    if (string.IsNullOrEmpty(selectedText))
                    {
                        replacement = "[link text](https://example.com)";
                        newCaretPos = selectionStart + 1;
                        selectionLength = 9;
                    }
                    else
                    {
                        replacement = $"[{selectedText}](https://example.com)";
                        newCaretPos = selectionStart + selectedText.Length + 3;
                        selectionLength = 19;
                    }
                    break;
            }

            if (!string.IsNullOrEmpty(replacement))
            {
                var text = NotesBox.Text;
                NotesBox.Text = text.Substring(0, selectionStart) + replacement + text.Substring(selectionStart + NotesBox.SelectionLength);
                NotesBox.Focus();
                NotesBox.Select(newCaretPos, selectionLength);
                PerformAutoSave();
            }
        }

        private void BtnTogglePreview_Click(object sender, RoutedEventArgs e)
        {
            ToggleNotesPreview(!_isPreviewActive);
        }

        private void ToggleNotesPreview(bool showPreview)
        {
            _isPreviewActive = showPreview;
            if (_isPreviewActive)
            {
                UpdateNotesPreview();
                NotesBox.Visibility = Visibility.Collapsed;
                NotesPreviewContainer.Visibility = Visibility.Visible;
                BtnTogglePreview.Content = "✏";
                BtnTogglePreview.ToolTip = "Switch to Editor mode";
            }
            else
            {
                NotesPreviewContainer.Visibility = Visibility.Collapsed;
                NotesBox.Visibility = Visibility.Visible;
                BtnTogglePreview.Content = "👁";
                BtnTogglePreview.ToolTip = "Switch to Markdown Preview";
                NotesBox.Focus();
            }
        }

        private void UpdateNotesPreview()
        {
            NotesPreviewText.Inlines.Clear();
            var raw = NotesBox.Text;
            if (string.IsNullOrWhiteSpace(raw))
            {
                NotesPreviewText.Inlines.Add(new Run("(Empty notes)")
                {
                    FontStyle = FontStyles.Italic,
                    Foreground = (Brush)FindResource("Subtext1Brush")
                });
                return;
            }

            var lines = raw.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.None);
            for (int i = 0; i < lines.Length; i++)
            {
                var line = lines[i];
                if (i > 0)
                {
                    NotesPreviewText.Inlines.Add(new LineBreak());
                }

                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                if (line.StartsWith("### "))
                {
                    var r = new Run(line.Substring(4)) { FontWeight = FontWeights.Bold, FontSize = 12, Foreground = (Brush)FindResource("AccentBrush") };
                    NotesPreviewText.Inlines.Add(r);
                }
                else if (line.StartsWith("## "))
                {
                    var r = new Run(line.Substring(3)) { FontWeight = FontWeights.Bold, FontSize = 13, Foreground = (Brush)FindResource("AccentBrush") };
                    NotesPreviewText.Inlines.Add(r);
                }
                else if (line.StartsWith("# "))
                {
                    var r = new Run(line.Substring(2)) { FontWeight = FontWeights.Bold, FontSize = 14, Foreground = (Brush)FindResource("AccentBrush") };
                    NotesPreviewText.Inlines.Add(r);
                }
                else if (line.StartsWith("- ") || line.StartsWith("* "))
                {
                    NotesPreviewText.Inlines.Add(new Run("  • ") { FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("AccentBrush") });
                    AppendFormattedMarkdownInlines(NotesPreviewText.Inlines, line.Substring(2));
                }
                else if (Regex.IsMatch(line, @"^\d+\.\s"))
                {
                    var match = Regex.Match(line, @"^(\d+\.\s)(.*)$");
                    NotesPreviewText.Inlines.Add(new Run(match.Groups[1].Value) { FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("AccentBrush") });
                    AppendFormattedMarkdownInlines(NotesPreviewText.Inlines, match.Groups[2].Value);
                }
                else if (line.StartsWith("![") && line.Contains("](") && line.EndsWith(")"))
                {
                    int altEnd = line.IndexOf("](");
                    string alt = line.Substring(2, altEnd - 2);
                    string url = line.Substring(altEnd + 2, line.Length - altEnd - 3);
                    var span = new Span();
                    span.Inlines.Add(new Run("🖼 ") { FontSize = 12 });
                    span.Inlines.Add(new Run(alt) { FontWeight = FontWeights.SemiBold, Foreground = (Brush)FindResource("AccentBrush") });
                    span.Inlines.Add(new Run($" ({Path.GetFileName(url)})") { FontStyle = FontStyles.Italic, FontSize = 10, Foreground = (Brush)FindResource("Subtext1Brush") });
                    NotesPreviewText.Inlines.Add(span);
                }
                else
                {
                    AppendFormattedMarkdownInlines(NotesPreviewText.Inlines, line);
                }
            }
        }

        private void AppendFormattedMarkdownInlines(InlineCollection inlines, string text)
        {
            int idx = 0;
            while (idx < text.Length)
            {
                if (idx + 1 < text.Length && text[idx] == '*' && text[idx + 1] == '*')
                {
                    int end = text.IndexOf("**", idx + 2);
                    if (end > idx + 1)
                    {
                        var boldText = text.Substring(idx + 2, end - idx - 2);
                        inlines.Add(new Bold(new Run(boldText)));
                        idx = end + 2;
                        continue;
                    }
                }

                if (text[idx] == '`')
                {
                    int end = text.IndexOf('`', idx + 1);
                    if (end > idx)
                    {
                        var codeText = text.Substring(idx + 1, end - idx - 1);
                        var codeRun = new Run(codeText)
                        {
                            FontFamily = new FontFamily("Consolas"),
                            Background = (Brush)FindResource("Surface1Brush"),
                            Foreground = (Brush)FindResource("TextBrush")
                        };
                        inlines.Add(codeRun);
                        idx = end + 1;
                        continue;
                    }
                }

                if (text[idx] == '[')
                {
                    int closeBracket = text.IndexOf("](", idx + 1);
                    if (closeBracket > idx)
                    {
                        int closeParen = text.IndexOf(')', closeBracket + 2);
                        if (closeParen > closeBracket)
                        {
                            var linkText = text.Substring(idx + 1, closeBracket - idx - 1);
                            var linkUrl = text.Substring(closeBracket + 2, closeParen - closeBracket - 2);
                            var linkRun = new Run(linkText)
                            {
                                Foreground = (Brush)FindResource("AccentBrush"),
                                TextDecorations = TextDecorations.Underline
                            };
                            inlines.Add(linkRun);
                            idx = closeParen + 1;
                            continue;
                        }
                    }
                }

                if (text[idx] == '*')
                {
                    int end = text.IndexOf('*', idx + 1);
                    if (end > idx)
                    {
                        var italicText = text.Substring(idx + 1, end - idx - 1);
                        inlines.Add(new Italic(new Run(italicText)));
                        idx = end + 1;
                        continue;
                    }
                }

                int nextSpecial = text.IndexOfAny(new[] { '*', '`', '[' }, idx);
                if (nextSpecial == -1)
                {
                    inlines.Add(new Run(text.Substring(idx)));
                    break;
                }
                else if (nextSpecial > idx)
                {
                    inlines.Add(new Run(text.Substring(idx, nextSpecial - idx)));
                    idx = nextSpecial;
                }
                else
                {
                    inlines.Add(new Run(text[idx].ToString()));
                    idx++;
                }
            }
        }

        private void AutoLinkScreenshot(string filePath)
        {
            if (AutoLinkShotsCheckBox.IsChecked != true) return;
            int shotNumber = _stagedScreenshots.Count;
            string linkText = $"\n![Screenshot {shotNumber}]({filePath})\n";

            int caret = NotesBox.CaretIndex;
            if (caret >= 0 && caret <= NotesBox.Text.Length)
            {
                NotesBox.Text = NotesBox.Text.Insert(caret, linkText);
                NotesBox.CaretIndex = caret + linkText.Length;
            }
            else
            {
                NotesBox.Text += linkText;
                NotesBox.CaretIndex = NotesBox.Text.Length;
            }

            if (_isPreviewActive)
            {
                UpdateNotesPreview();
            }
        }

        private void BtnAddStep_Click(object sender, RoutedEventArgs e)
        {
            DetailsExpander.IsExpanded = true;
            var currentText = StepsBox.Text.Trim();
            int nextStepNum = 1;

            if (!string.IsNullOrWhiteSpace(currentText))
            {
                var lines = currentText.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
                foreach (var line in lines)
                {
                    var match = Regex.Match(line.Trim(), @"^(\d+)\.");
                    if (match.Success && int.TryParse(match.Groups[1].Value, out int n))
                    {
                        if (n >= nextStepNum) nextStepNum = n + 1;
                    }
                }
                if (nextStepNum == 1)
                {
                    nextStepNum = lines.Length + 1;
                }
            }

            string stepPrefix = string.IsNullOrWhiteSpace(currentText) ? $"{nextStepNum}. " : $"\n{nextStepNum}. ";
            StepsBox.Text += stepPrefix;
            StepsBox.Focus();
            StepsBox.CaretIndex = StepsBox.Text.Length;
            PerformAutoSave();
        }

        private async void BtnImportAutoSteps_Click(object sender, RoutedEventArgs e)
        {
            DetailsExpander.IsExpanded = true;
            if (_activeWebView == null)
            {
                ShowMessage("No active WebView2 session to import steps from.", isError: true);
                return;
            }

            try
            {
                var snapshot = await VisualTestTrackerTelemetry.CollectSnapshotAsync(_activeWebView);
                var events = snapshot.ReproductionEvents;
                if (events == null || events.Count == 0)
                {
                    ShowMessage("No user interactions captured yet on this page.", isError: false);
                    return;
                }

                var sb = new StringBuilder();
                int stepIndex = 1;

                var currentText = StepsBox.Text.Trim();
                if (!string.IsNullOrWhiteSpace(currentText))
                {
                    var lines = currentText.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (var line in lines)
                    {
                        var match = Regex.Match(line.Trim(), @"^(\d+)\.");
                        if (match.Success && int.TryParse(match.Groups[1].Value, out int n))
                        {
                            if (n >= stepIndex) stepIndex = n + 1;
                        }
                    }
                    sb.Append(currentText).Append("\n");
                }

                int addedCount = 0;
                foreach (var ev in events)
                {
                    string target = !string.IsNullOrWhiteSpace(ev.Details) ? $"\"{ev.Details}\"" : (!string.IsNullOrWhiteSpace(ev.Selector) ? ev.Selector : "element");
                    string desc = (ev.ActionType ?? "").ToLowerInvariant() switch
                    {
                        "navigate" => $"Navigate to {ev.Details}",
                        "click" => $"Click on {target}",
                        "button" => $"Click button {target}",
                        "input" => $"Enter value into {target}",
                        "submit" => $"Submit form {target}",
                        "dom_mutation" => $"Inspect alert/modal {target}",
                        _ => $"{ev.ActionType}: {ev.Details}"
                    };

                    sb.AppendLine($"{stepIndex}. {desc}");
                    stepIndex++;
                    addedCount++;
                }

                StepsBox.Text = sb.ToString().TrimEnd();
                StepsBox.Focus();
                StepsBox.CaretIndex = StepsBox.Text.Length;
                PerformAutoSave();
                ShowMessage($"Imported {addedCount} user actions into reproduction steps.", isError: false);
            }
            catch (Exception ex)
            {
                ShowMessage($"Failed to import auto steps: {ex.Message}", isError: true);
            }
        }

        private async System.Threading.Tasks.Task RefreshLiveTelemetryBadgesAsync()
        {
            if (_activeWebView == null) return;
            try
            {
                var counts = await VisualTestTrackerTelemetry.GetCountsAsync(_activeWebView);

                string errStr = counts.Warnings > 0
                    ? $"🔴 {counts.Errors} err / {counts.Warnings} warn"
                    : $"🔴 {counts.Errors} errors";
                TelemetryConsoleBadge.Text = errStr;
                TelemetryConsoleBadge.Foreground = (Brush)FindResource(counts.Errors > 0 ? "StatusErrorBrush" : (counts.Warnings > 0 ? "StatusWarningBrush" : "Subtext1Brush"));

                TelemetryNetworkBadge.Text = $"⚡ {counts.NetworkFailures} net fail";
                TelemetryNetworkBadge.Foreground = (Brush)FindResource(counts.NetworkFailures > 0 ? "StatusErrorBrush" : "Subtext1Brush");

                string perfStr = counts.PageLoadMs > 0 ? $"⏱ {counts.PageLoadMs:F0}ms" : "⏱ -";
                if (counts.LcpMs > 0) perfStr += $" (LCP {counts.LcpMs:F0}ms)";
                TelemetryPerfBadge.Text = perfStr;
                TelemetryPerfBadge.Foreground = (Brush)FindResource(counts.PageLoadMs > 3000 ? "StatusWarningBrush" : "Subtext1Brush");

                TelemetryEventsBadge.Text = $"👣 {counts.Events} events";
                TelemetryEventsBadge.Foreground = (Brush)FindResource(counts.Events > 0 ? "TextBrush" : "Subtext1Brush");

                if (_activeSession != null)
                {
                    _activeSession.TelemetryEventsCount = counts.Events;
                    VisualTestTrackerSessionStore.UpdateSession(_activeSession);
                }
            }
            catch { }
        }

        private void GoodCheckBox_Changed(object sender, RoutedEventArgs e)
        {
            if (_activeSession != null)
            {
                _activeSession.IsCleanConfirmed = GoodCheckBox.IsChecked == true;
                VisualTestTrackerSessionStore.UpdateSession(_activeSession);
            }
            if (_suppressEvents || _store == null || _activePage == null) return;
            _ = SaveCurrentPageCleanStatusAsync();
        }

        private async System.Threading.Tasks.Task SaveCurrentPageCleanStatusAsync()
        {
            if (_store == null || _activePage == null) return;
            try
            {
                bool isGood = GoodCheckBox.IsChecked == true;
                await _store.SavePageAsync(_activePage.Id, isGood, NotesBox.Text);
                _activePage.IsGood = isGood;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"Clean status save failed: {ex.Message}");
            }
        }

        // ── Capture Actions ──────────────────────────────────────────────────────

        private async void BtnCaptureFull_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView == null) return;
            BtnCaptureFull.IsEnabled = false;
            try
            {
                var result = await VisualTestTrackerCapture.CaptureFullPageAsync(_activeWebView, _activeBaseUrl, _activePagePath);
                if (!result.Success)
                {
                    ShowMessage($"Full-page capture failed: {result.Error}", isError: true);
                    return;
                }

                _stagedScreenshots.Add(result.FilePath);
                RenderStagedThumbnails();
                AutoLinkScreenshot(result.FilePath);
                PerformAutoSave();
                ShowMessage("Full page captured & attached to draft.", isError: false);
            }
            catch (Exception ex)
            {
                ShowMessage($"Capture failed: {ex.Message}", isError: true);
            }
            finally
            {
                BtnCaptureFull.IsEnabled = true;
            }
        }

        private async void BtnCaptureRegion_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView == null) return;

            Point topLeft;
            try
            {
                topLeft = _activeWebView.PointToScreen(new Point(0, 0));
            }
            catch (Exception ex)
            {
                ShowMessage($"Could not locate WebView2 on screen: {ex.Message}", isError: true);
                return;
            }

            var source = PresentationSource.FromVisual(_activeWebView);
            double dpiX = source?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
            double dpiY = source?.CompositionTarget?.TransformToDevice.M22 ?? 1.0;

            var overlay = new RegionSelectOverlayWindow
            {
                Left = topLeft.X / dpiX,
                Top = topLeft.Y / dpiY,
                Width = _activeWebView.ActualWidth,
                Height = _activeWebView.ActualHeight
            };

            bool? drawn = overlay.ShowDialog();
            if (drawn != true) return;

            var rect = overlay.SelectedRect;
            var deviceRect = new Int32Rect(
                (int)Math.Round(rect.X * dpiX),
                (int)Math.Round(rect.Y * dpiY),
                (int)Math.Round(rect.Width * dpiX),
                (int)Math.Round(rect.Height * dpiY));

            BtnCaptureRegion.IsEnabled = false;
            try
            {
                var result = await VisualTestTrackerCapture.CaptureRegionAsync(_activeWebView, _activeBaseUrl, _activePagePath, deviceRect);
                if (!result.Success)
                {
                    ShowMessage($"Region capture failed: {result.Error}", isError: true);
                    return;
                }

                _stagedScreenshots.Add(result.FilePath);
                RenderStagedThumbnails();
                AutoLinkScreenshot(result.FilePath);
                PerformAutoSave();
                ShowMessage("Region captured & attached to draft.", isError: false);
            }
            catch (Exception ex)
            {
                ShowMessage($"Region capture failed: {ex.Message}", isError: true);
            }
            finally
            {
                BtnCaptureRegion.IsEnabled = true;
            }
        }

        private async void BtnCaptureWpfWindow_Click(object sender, RoutedEventArgs e)
        {
            BtnCaptureWpfWindow.IsEnabled = false;
            try
            {
                var targetWin = Application.Current.MainWindow ?? this;
                var result = await VisualTestTrackerCapture.CaptureWpfWindowAsync(targetWin, _activeBaseUrl, _activePagePath);
                if (!result.Success)
                {
                    ShowMessage($"Window capture failed: {result.Error}", isError: true);
                    return;
                }

                _stagedScreenshots.Add(result.FilePath);
                RenderStagedThumbnails();
                AutoLinkScreenshot(result.FilePath);
                PerformAutoSave();
                ShowMessage("Full WPF window HUD captured & attached to draft.", isError: false);
            }
            catch (Exception ex)
            {
                ShowMessage($"Window capture failed: {ex.Message}", isError: true);
            }
            finally
            {
                BtnCaptureWpfWindow.IsEnabled = true;
            }
        }

        // ── Phase 9: DOM Inspector & Developer Tools Integration ─────────────────

        private void OnActiveWebView_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string message = e.TryGetWebMessageAsString();
                var domInfo = VisualTestTrackerTelemetry.TryParseDomInspectMessage(message);
                if (domInfo != null)
                {
                    Dispatcher.Invoke(() => HandleDomElementInspected(domInfo));
                }
            }
            catch { }
        }

        private async void BtnInspectDom_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView == null) return;

            if (_isDomInspectorActive)
            {
                await VisualTestTrackerTelemetry.DisableDomInspectorAsync(_activeWebView);
                _isDomInspectorActive = false;
                BtnInspectDom.Content = "🔍 Inspect";
                ShowMessage("DOM Inspector canceled.", isError: false);
            }
            else
            {
                await VisualTestTrackerTelemetry.EnableDomInspectorAsync(_activeWebView);
                _isDomInspectorActive = true;
                BtnInspectDom.Content = "🛑 Stop";
                ShowMessage("Hover and click any element in the web view to inspect its DOM properties...", isError: false);
            }
        }

        private void HandleDomElementInspected(DomElementInfo info)
        {
            _inspectedDomElement = info;
            _isDomInspectorActive = false;
            BtnInspectDom.Content = "🔍 Inspect";

            TxtDomElementTag.Text = $"<{info.Tag}>";
            TxtDomDimensions.Text = $"{info.Width:F0} × {info.Height:F0} px";
            TxtDomSelector.Text = info.Selector;
            TxtDomOuterHtml.Text = info.OuterHtml;

            DomInspectorDrawer.Visibility = Visibility.Visible;
            ShowMessage($"Inspected: {info.Selector} ({info.Tag})", isError: false);
        }

        private async void BtnDomReinspect_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView == null) return;
            await VisualTestTrackerTelemetry.EnableDomInspectorAsync(_activeWebView);
            _isDomInspectorActive = true;
            BtnInspectDom.Content = "🛑 Stop";
            ShowMessage("Hover and click any element in the web view to inspect its DOM properties...", isError: false);
        }

        private async void BtnDomClose_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView != null)
            {
                await VisualTestTrackerTelemetry.DisableDomInspectorAsync(_activeWebView);
            }
            _isDomInspectorActive = false;
            BtnInspectDom.Content = "🔍 Inspect";
            DomInspectorDrawer.Visibility = Visibility.Collapsed;
        }

        private void BtnCopyDomSelector_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(TxtDomSelector.Text)) return;
            try
            {
                Clipboard.SetText(TxtDomSelector.Text);
                ShowMessage("Copied selector to clipboard.", isError: false);
            }
            catch (Exception ex)
            {
                ShowMessage($"Clipboard copy failed: {ex.Message}", isError: true);
            }
        }

        private void BtnCopyDomHtml_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(TxtDomOuterHtml.Text)) return;
            try
            {
                Clipboard.SetText(TxtDomOuterHtml.Text);
                ShowMessage("Copied outer HTML to clipboard.", isError: false);
            }
            catch (Exception ex)
            {
                ShowMessage($"Clipboard copy failed: {ex.Message}", isError: true);
            }
        }

        private void BtnInsertDomToSteps_Click(object sender, RoutedEventArgs e)
        {
            if (_inspectedDomElement == null) return;

            string tag = (_inspectedDomElement.Tag ?? "").ToUpperInvariant();
            string sel = !string.IsNullOrWhiteSpace(_inspectedDomElement.Selector) ? _inspectedDomElement.Selector : "element";
            string text = !string.IsNullOrWhiteSpace(_inspectedDomElement.InnerText) ? $"\"{_inspectedDomElement.InnerText}\"" : "";

            string actionDesc = tag switch
            {
                "BUTTON" => text != "" ? $"Click button {text} (`{sel}`)" : $"Click button `{sel}`",
                "INPUT" => $"Enter value into `{sel}`",
                "A" => text != "" ? $"Click link {text} (`{sel}`)" : $"Click link `{sel}`",
                "SELECT" => $"Select option in dropdown `{sel}`",
                "TEXTAREA" => $"Enter text into `{sel}`",
                "FORM" => $"Submit form `{sel}`",
                _ => $"Interact with {tag.ToLowerInvariant()} `{sel}`"
            };

            int stepIndex = 1;
            var currentText = StepsBox.Text.Trim();
            var sb = new StringBuilder();
            if (!string.IsNullOrWhiteSpace(currentText))
            {
                var lines = currentText.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
                foreach (var line in lines)
                {
                    var match = Regex.Match(line.Trim(), @"^(\d+)\.");
                    if (match.Success && int.TryParse(match.Groups[1].Value, out int n))
                    {
                        if (n >= stepIndex) stepIndex = n + 1;
                    }
                }
                sb.Append(currentText).Append("\n");
            }

            sb.AppendLine($"{stepIndex}. {actionDesc}");
            StepsBox.Text = sb.ToString().TrimEnd();
            DetailsExpander.IsExpanded = true;
            StepsBox.Focus();
            StepsBox.CaretIndex = StepsBox.Text.Length;
            PerformAutoSave();
            ShowMessage($"Appended step {stepIndex} for {sel}.", isError: false);
        }

        private void BtnInsertDomToNotes_Click(object sender, RoutedEventArgs e)
        {
            if (_inspectedDomElement == null) return;
            string sel = _inspectedDomElement.Selector;
            string tag = _inspectedDomElement.Tag;
            string size = $"{_inspectedDomElement.Width:F0}x{_inspectedDomElement.Height:F0}px";
            string noteSnippet = $"\n- Inspected `<{tag}>` `{sel}` ({size})";

            var current = NotesBox.Text;
            NotesBox.Text = (current + noteSnippet).TrimStart('\n');
            NotesBox.Focus();
            NotesBox.CaretIndex = NotesBox.Text.Length;
            PerformAutoSave();
            ShowMessage("Added element info to notes.", isError: false);
        }

        private void RenderStagedThumbnails()
        {
            StagedThumbnailsPanel.Children.Clear();
            StagedScreenshotsContainer.Visibility = _stagedScreenshots.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

            foreach (var path in _stagedScreenshots)
            {
                var thumb = BuildStagedThumbnail(path);
                StagedThumbnailsPanel.Children.Add(thumb);
            }
        }

        private UIElement BuildStagedThumbnail(string filePath)
        {
            var border = new Border
            {
                Background = (Brush)FindResource("Surface1Brush"),
                CornerRadius = new CornerRadius(4),
                Margin = new Thickness(0, 0, 6, 0),
                Padding = new Thickness(4)
            };

            var stack = new StackPanel();

            try
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.DecodePixelWidth = 140;
                bmp.UriSource = new Uri(filePath, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();

                var img = new Image
                {
                    Source = bmp,
                    Height = 60,
                    Stretch = Stretch.Uniform,
                    Margin = new Thickness(0, 0, 0, 4)
                };
                stack.Children.Add(img);
            }
            catch
            {
                stack.Children.Add(new TextBlock { Text = "(image)", FontSize = 9, Foreground = (Brush)FindResource("Subtext1Brush") });
            }

            var btnRow = new Grid();
            btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var annotateBtn = new Button
            {
                Content = "✏ Annotate",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                Tag = filePath
            };
            annotateBtn.Click += StagedAnnotate_Click;
            Grid.SetColumn(annotateBtn, 0);

            var removeBtn = new Button
            {
                Content = "✕",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(2, 0, 0, 0),
                Tag = filePath
            };
            removeBtn.Click += StagedRemove_Click;
            Grid.SetColumn(removeBtn, 1);

            btnRow.Children.Add(annotateBtn);
            btnRow.Children.Add(removeBtn);
            stack.Children.Add(btnRow);

            border.Child = stack;
            return border;
        }

        private void StagedAnnotate_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string path) return;

            var annotWin = new ScreenshotAnnotationWindow(path) { Owner = this };
            if (annotWin.ShowDialog() == true && !string.IsNullOrEmpty(annotWin.ResultFilePath))
            {
                int idx = _stagedScreenshots.IndexOf(path);
                if (idx >= 0)
                {
                    var oldPath = path;
                    _stagedScreenshots[idx] = annotWin.ResultFilePath;
                    if (NotesBox.Text.Contains(oldPath))
                    {
                        NotesBox.Text = NotesBox.Text.Replace(oldPath, annotWin.ResultFilePath);
                    }
                    RenderStagedThumbnails();
                    PerformAutoSave();
                    ShowMessage("Annotated screenshot updated in draft.", isError: false);
                }
            }
        }

        private void StagedRemove_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string path) return;
            _stagedScreenshots.Remove(path);
            RenderStagedThumbnails();
            PerformAutoSave();
        }

        // ── Bug Entry Save & Management (Phase 3 Upgraded) ──────────────────────

        private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            // Ctrl+Enter commits the bug entry
            if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control)
            {
                if (BtnSaveEntry.IsEnabled)
                {
                    e.Handled = true;
                    BtnSaveEntry_Click(this, new RoutedEventArgs());
                }
            }
        }

        private async void BtnSaveEntry_Click(object sender, RoutedEventArgs e)
        {
            var notes = NotesBox.Text.Trim();
            var steps = StepsBox.Text.Trim();
            var expected = ExpectedBox.Text.Trim();
            var actual = ActualBox.Text.Trim();
            var rawTags = TagsBox.Text.Trim();

            if (string.IsNullOrWhiteSpace(notes) && string.IsNullOrWhiteSpace(steps) && _stagedScreenshots.Count == 0)
            {
                ShowMessage("Please enter notes or capture a screenshot before saving.", isError: true);
                return;
            }

            BtnSaveEntry.IsEnabled = false;

            try
            {
                // 1. Collect live diagnostics & browser metadata from WebView2
                var snapshot = await VisualTestTrackerTelemetry.CollectSnapshotAsync(_activeWebView);

                // 2. Parse tags
                var tagsList = new List<string>();
                if (!string.IsNullOrWhiteSpace(rawTags))
                {
                    var split = rawTags.Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (var s in split)
                    {
                        var clean = s.Trim().TrimStart('#');
                        if (!string.IsNullOrWhiteSpace(clean) && !tagsList.Contains(clean))
                            tagsList.Add(clean);
                    }
                }

                // 3. Assemble complete metadata & dimensions
                var mainWin = Application.Current.MainWindow ?? this;
                string winSize = $"{(int)mainWin.ActualWidth}x{(int)mainWin.ActualHeight}";
                string viewSize = snapshot.InnerWidth > 0 ? $"{snapshot.InnerWidth}x{snapshot.InnerHeight}" : "";

                string effectiveUrl = !string.IsNullOrWhiteSpace(snapshot.Url) ? snapshot.Url : $"{_activeBaseUrl}{_activePagePath}";
                string effectiveTitle = !string.IsNullOrWhiteSpace(snapshot.Title)
                    ? snapshot.Title
                    : (_activeWebView?.CoreWebView2?.DocumentTitle ?? "");

                string browserVer = _activeWebView?.CoreWebView2?.Environment?.BrowserVersionString ?? "WebView2";
                string osVer = RuntimeInformation.OSDescription;

                // 4. Create comprehensive bug report entry
                var entry = new VisualTestTrackerEntry
                {
                    PageId = _activePage?.Id ?? 0,
                    BaseUrl = _activeBaseUrl,
                    PagePath = _activePagePath,
                    Title = ExtractTitle(notes, steps),
                    Notes = notes,
                    StepsToReproduce = steps,
                    ExpectedBehavior = expected,
                    ActualBehavior = actual,
                    Severity = _selectedSeverity,
                    Status = "Open",
                    Tags = tagsList,

                    // Auto-collected metadata
                    CurrentUrl = effectiveUrl,
                    PageTitle = effectiveTitle,
                    BrowserVersion = browserVer,
                    OsVersion = osVer,
                    WindowSize = winSize,
                    ViewportSize = viewSize,
                    UserAgent = snapshot.UserAgent,

                    // Performance Signals
                    Performance = snapshot.Performance,

                    // Attachments & Diagnostics
                    ScreenshotPaths = new List<string>(_stagedScreenshots),
                    ConsoleLogs = snapshot.ConsoleLogs ?? new List<ConsoleLogItem>(),
                    NetworkFailures = snapshot.NetworkLogs ?? new List<NetworkFailureItem>(),
                    ReproductionEvents = snapshot.ReproductionEvents ?? new List<ReproductionEventItem>(),

                    CreatedAt = DateTime.Now,
                    UpdatedAt = DateTime.Now
                };

                if (_store != null)
                {
                    await _store.SaveEntryAsync(entry);
                }

                if (_activeSession != null)
                {
                    _activeSession.BugsLoggedCount++;
                    VisualTestTrackerSessionStore.UpdateSession(_activeSession);
                }

                // Clear draft from disk & reset fields
                VisualTestTrackerDraftStore.ClearDraft(_activeBaseUrl, _activePagePath);
                if (_notesMode == "page")
                {
                    NotesBox.Text = "";
                }
                StepsBox.Text = "";
                ExpectedBox.Text = "";
                ActualBox.Text = "";
                TagsBox.Text = "";
                DetailsExpander.IsExpanded = false;
                _stagedScreenshots.Clear();
                RenderStagedThumbnails();
                AutoSaveIndicator.Text = "✓ Saved";

                ShowMessage($"Saved {entry.Severity} entry with metadata & diagnostics.", isError: false);
                await RefreshBugListAsync();
                await RefreshLiveTelemetryBadgesAsync();
            }
            catch (Exception ex)
            {
                ShowMessage($"Failed to save entry: {ex.Message}", isError: true);
            }
            finally
            {
                BtnSaveEntry.IsEnabled = true;
            }
        }

        private void BtnClearDraft_Click(object sender, RoutedEventArgs e)
        {
            if (_notesMode == "global")
            {
                NotesBox.Text = "";
                _globalNotes = "";
                VisualTestTrackerDraftStore.SaveGlobalNotes("");
            }
            else
            {
                NotesBox.Text = "";
                VisualTestTrackerDraftStore.ClearDraft(_activeBaseUrl, _activePagePath);
            }
            StepsBox.Text = "";
            ExpectedBox.Text = "";
            ActualBox.Text = "";
            TagsBox.Text = "";
            DetailsExpander.IsExpanded = false;
            _stagedScreenshots.Clear();
            RenderStagedThumbnails();
            AutoSaveIndicator.Text = "Cleared";
            ShowMessage("Draft cleared.", isError: false);
        }

        private static string ExtractTitle(string notes, string steps)
        {
            string source = !string.IsNullOrWhiteSpace(notes) ? notes : steps;
            if (string.IsNullOrWhiteSpace(source)) return "Visual Observation";
            var lines = source.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length > 0)
            {
                var first = lines[0].Trim();
                if (first.Length > 60) return first.Substring(0, 57) + "...";
                return first;
            }
            return "Visual Observation";
        }

        // ── Bug List Refresh & Card Rendering ───────────────────────────────────

        private async System.Threading.Tasks.Task RefreshBugListAsync()
        {
            BugListPanel.Children.Clear();
            if (_store == null) return;

            try
            {
                var entries = await _store.ListEntriesAsync(_activePage?.Id ?? 0, _activeBaseUrl, _activePagePath);
                _currentEntries = entries;

                var filtered = _currentEntries.FindAll(e =>
                {
                    if (string.Equals(_activeFilter, "Open", StringComparison.OrdinalIgnoreCase))
                        return string.Equals(e.Status, "Open", StringComparison.OrdinalIgnoreCase);
                    if (string.Equals(_activeFilter, "Resolved", StringComparison.OrdinalIgnoreCase))
                        return string.Equals(e.Status, "Resolved", StringComparison.OrdinalIgnoreCase);
                    return true;
                });

                int openCount = _currentEntries.FindAll(e => string.Equals(e.Status, "Open", StringComparison.OrdinalIgnoreCase)).Count;
                BugCountHeader.Text = $"BUG LIST ({openCount} open / {_currentEntries.Count} total)";
                BugListEmptyText.Visibility = filtered.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

                foreach (var entry in filtered)
                {
                    BugListPanel.Children.Add(BuildBugEntryCard(entry));
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"RefreshBugListAsync error: {ex.Message}");
            }
        }

        private UIElement BuildBugEntryCard(VisualTestTrackerEntry entry)
        {
            var card = new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                BorderBrush = (Brush)FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(5),
                Margin = new Thickness(0, 0, 0, 6),
                Padding = new Thickness(8)
            };

            var stack = new StackPanel();

            // Header row: Status toggle button + Severity + Tags + Timestamp + Actions
            var header = new Grid { Margin = new Thickness(0, 0, 0, 4) };
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            // Status Toggle Button (Clickable pill)
            bool isOpen = string.Equals(entry.Status, "Open", StringComparison.OrdinalIgnoreCase);
            var statusBtn = new Button
            {
                Content = isOpen ? "● Open" : "✓ Resolved",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(6, 1, 6, 1),
                Foreground = (Brush)FindResource(isOpen ? "StatusErrorBrush" : "StatusSuccessBrush"),
                ToolTip = "Click to toggle Open / Resolved status",
                Tag = entry
            };
            statusBtn.Click += async (s, e) =>
            {
                string nextStatus = isOpen ? "Resolved" : "Open";
                entry.Status = nextStatus;
                if (_store != null) await _store.UpdateEntryStatusAsync(entry.EntryUuid, nextStatus);
                await RefreshBugListAsync();
            };
            Grid.SetColumn(statusBtn, 0);

            // Severity Badge
            var sevColor = entry.Severity switch
            {
                "Blocker" => "#F38BA8",
                "Critical" => "#EBA0AC",
                "UI Glitch" => "#FAB387",
                "Functional" => "#F9E2AF",
                "Low" => "#A6ADC8",
                _ => "#EBA0AC"
            };
            var sevBadge = new Border
            {
                Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(sevColor)),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(4, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock
                {
                    Text = entry.Severity.ToUpperInvariant(),
                    FontSize = 8,
                    FontWeight = FontWeights.Bold,
                    Foreground = Brushes.Black
                }
            };
            Grid.SetColumn(sevBadge, 1);

            // Tags & Timestamp Header area
            var midHeader = new WrapPanel
            {
                Margin = new Thickness(6, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center
            };

            if (entry.Tags != null)
            {
                foreach (var tag in entry.Tags)
                {
                    var tagPill = new Border
                    {
                        Background = (Brush)FindResource("Surface1Brush"),
                        CornerRadius = new CornerRadius(3),
                        Padding = new Thickness(3, 0, 3, 0),
                        Margin = new Thickness(0, 0, 3, 0),
                        Child = new TextBlock
                        {
                            Text = $"#{tag}",
                            FontSize = 8,
                            Foreground = (Brush)FindResource("AccentBrush")
                        }
                    };
                    midHeader.Children.Add(tagPill);
                }
            }

            if (entry.Performance != null && entry.Performance.PageLoadTimeMs > 0)
            {
                var perfPill = new Border
                {
                    Background = (Brush)FindResource("Surface1Brush"),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(3, 0, 3, 0),
                    Margin = new Thickness(0, 0, 3, 0),
                    ToolTip = $"Page Load: {entry.Performance.PageLoadTimeMs:F0}ms, TTFB: {entry.Performance.TtfbMs:F0}ms, LCP: {entry.Performance.LargestContentfulPaintMs:F0}ms",
                    Child = new TextBlock
                    {
                        Text = $"⏱ {entry.Performance.PageLoadTimeMs:F0}ms",
                        FontSize = 8,
                        Foreground = (Brush)FindResource("AccentBrush")
                    }
                };
                midHeader.Children.Add(perfPill);
            }

            var timeText = new TextBlock
            {
                Text = $"{entry.CreatedAt:HH:mm:ss}",
                FontSize = 9,
                Foreground = (Brush)FindResource("Subtext1Brush"),
                VerticalAlignment = VerticalAlignment.Center
            };
            midHeader.Children.Add(timeText);
            Grid.SetColumn(midHeader, 2);

            // Export JSON Button
            var exportBtn = new Button
            {
                Content = "📦",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(2, 0, 2, 0),
                ToolTip = "Export this bug report as JSON to local repo /Bugs/<Area>/",
                Tag = entry
            };
            exportBtn.Click += (s, e) =>
            {
                OpenExportDialog(new List<VisualTestTrackerEntry> { entry });
            };
            Grid.SetColumn(exportBtn, 3);

            // Copy Markdown Button
            var copyMdBtn = new Button
            {
                Content = "📋",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(2, 0, 2, 0),
                ToolTip = "Copy this bug as Markdown (including environment metadata & attachments)",
                Tag = entry
            };
            copyMdBtn.Click += (s, e) =>
            {
                Clipboard.SetText(entry.ToMarkdown());
                ShowMessage("Full bug report markdown copied to clipboard.", isError: false);
            };
            Grid.SetColumn(copyMdBtn, 4);

            // Delete Button
            var delBtn = new Button
            {
                Content = "🗑",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                ToolTip = "Delete this bug entry",
                Tag = entry.EntryUuid
            };
            delBtn.Click += async (s, e) =>
            {
                if (MessageBox.Show("Delete this bug entry?", "Confirm Delete", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
                {
                    if (_store != null) await _store.DeleteEntryAsync(entry.EntryUuid);
                    await RefreshBugListAsync();
                }
            };
            Grid.SetColumn(delBtn, 5);

            header.Children.Add(statusBtn);
            header.Children.Add(sevBadge);
            header.Children.Add(midHeader);
            header.Children.Add(exportBtn);
            header.Children.Add(copyMdBtn);
            header.Children.Add(delBtn);
            stack.Children.Add(header);

            // Notes Body
            if (!string.IsNullOrWhiteSpace(entry.Notes))
            {
                var notesText = new TextBox
                {
                    Text = entry.Notes,
                    FontSize = 11,
                    Foreground = (Brush)FindResource("TextBrush"),
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    IsReadOnly = true,
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 2, 0, 4)
                };
                stack.Children.Add(notesText);
            }

            // Structured Details Drawer (Steps + Expected/Actual)
            bool hasSteps = !string.IsNullOrWhiteSpace(entry.StepsToReproduce);
            bool hasExpAct = !string.IsNullOrWhiteSpace(entry.ExpectedBehavior) || !string.IsNullOrWhiteSpace(entry.ActualBehavior);
            if (hasSteps || hasExpAct)
            {
                var detailsExpander = new Expander
                {
                    Header = "Steps & Expected/Actual",
                    FontSize = 9,
                    Foreground = (Brush)FindResource("Subtext1Brush"),
                    Margin = new Thickness(0, 1, 0, 4)
                };
                var detStack = new StackPanel { Margin = new Thickness(4, 2, 4, 2) };

                if (hasSteps)
                {
                    detStack.Children.Add(new TextBlock
                    {
                        Text = "Steps to Reproduce:",
                        FontSize = 9,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = (Brush)FindResource("Subtext1Brush")
                    });
                    detStack.Children.Add(new TextBlock
                    {
                        Text = entry.StepsToReproduce,
                        FontSize = 10,
                        TextWrapping = TextWrapping.Wrap,
                        Foreground = (Brush)FindResource("TextBrush"),
                        Margin = new Thickness(0, 1, 0, 4)
                    });
                }

                if (!string.IsNullOrWhiteSpace(entry.ExpectedBehavior))
                {
                    detStack.Children.Add(new TextBlock
                    {
                        Text = $"Expected: {entry.ExpectedBehavior}",
                        FontSize = 10,
                        TextWrapping = TextWrapping.Wrap,
                        Foreground = (Brush)FindResource("StatusSuccessBrush"),
                        Margin = new Thickness(0, 0, 0, 2)
                    });
                }

                if (!string.IsNullOrWhiteSpace(entry.ActualBehavior))
                {
                    detStack.Children.Add(new TextBlock
                    {
                        Text = $"Actual: {entry.ActualBehavior}",
                        FontSize = 10,
                        TextWrapping = TextWrapping.Wrap,
                        Foreground = (Brush)FindResource("StatusErrorBrush"),
                        Margin = new Thickness(0, 0, 0, 2)
                    });
                }

                detailsExpander.Content = detStack;
                stack.Children.Add(detailsExpander);
            }

            // Diagnostic Badges & Drawer (Console Logs with Stack Traces, Network Logs, Performance, Events)
            int logCount = entry.ConsoleLogs?.Count ?? 0;
            int netCount = entry.NetworkFailures?.Count ?? 0;
            int eventCount = entry.ReproductionEvents?.Count ?? 0;
            bool hasPerf = entry.Performance != null && (entry.Performance.PageLoadTimeMs > 0 || (entry.Performance.LargestContentfulPaintMs.HasValue && entry.Performance.LargestContentfulPaintMs.Value > 0));

            if (logCount > 0 || netCount > 0 || eventCount > 0 || hasPerf)
            {
                string perfHeader = hasPerf ? $", {entry.Performance!.PageLoadTimeMs:F0}ms" : "";
                var diagExpander = new Expander
                {
                    Header = $"Diagnostics ({logCount} logs, {netCount} net, {eventCount} evts{perfHeader})",
                    FontSize = 9,
                    Foreground = (Brush)FindResource("AccentBrush"),
                    Margin = new Thickness(0, 1, 0, 4)
                };

                var diagStack = new StackPanel { Margin = new Thickness(4, 2, 4, 2) };

                // 1. Performance Signals
                if (hasPerf)
                {
                    var p = entry.Performance!;
                    string perfSummary = $"Load: {p.PageLoadTimeMs:F0}ms";
                    if (p.LargestContentfulPaintMs.HasValue && p.LargestContentfulPaintMs.Value > 0)
                        perfSummary += $" · LCP: {p.LargestContentfulPaintMs.Value:F0}ms";
                    if (p.FirstContentfulPaintMs.HasValue && p.FirstContentfulPaintMs.Value > 0)
                        perfSummary += $" · FCP: {p.FirstContentfulPaintMs.Value:F0}ms";
                    if (p.TtfbMs > 0)
                        perfSummary += $" · TTFB: {p.TtfbMs:F0}ms";
                    if (p.DomContentLoadedMs > 0)
                        perfSummary += $" · DOM: {p.DomContentLoadedMs:F0}ms";
                    if (p.ScriptErrorCount > 0)
                        perfSummary += $" · Errors: {p.ScriptErrorCount}";

                    diagStack.Children.Add(new TextBlock
                    {
                        Text = $"Performance Signals ({perfSummary}):",
                        FontSize = 9,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = (Brush)FindResource("AccentBrush"),
                        Margin = new Thickness(0, 0, 0, 4)
                    });
                }

                // 2. Console Logs & JavaScript Errors (with Stack Traces)
                if (logCount > 0)
                {
                    diagStack.Children.Add(new TextBlock
                    {
                        Text = $"Console Logs & Script Errors ({logCount}):",
                        FontSize = 9,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = (Brush)FindResource("StatusErrorBrush"),
                        Margin = new Thickness(0, hasPerf ? 4 : 0, 0, 2)
                    });
                    foreach (var l in entry.ConsoleLogs!)
                    {
                        var logText = new TextBlock
                        {
                            Text = $"[{l.Level.ToUpperInvariant()}] {l.Message}",
                            FontSize = 9,
                            FontFamily = new FontFamily("Consolas"),
                            TextWrapping = TextWrapping.Wrap,
                            Foreground = (Brush)FindResource(string.Equals(l.Level, "warn", StringComparison.OrdinalIgnoreCase) ? "StatusWarningBrush" : (string.Equals(l.Level, "error", StringComparison.OrdinalIgnoreCase) || string.Equals(l.Level, "exception", StringComparison.OrdinalIgnoreCase) ? "StatusErrorBrush" : "Subtext1Brush")),
                            Margin = new Thickness(2, 0, 0, 1)
                        };
                        diagStack.Children.Add(logText);

                        if (!string.IsNullOrWhiteSpace(l.StackTrace))
                        {
                            var stackText = new TextBlock
                            {
                                Text = l.StackTrace,
                                FontSize = 8,
                                FontFamily = new FontFamily("Consolas"),
                                TextWrapping = TextWrapping.Wrap,
                                Foreground = (Brush)FindResource("Overlay1Brush"),
                                Margin = new Thickness(8, 0, 0, 3)
                            };
                            diagStack.Children.Add(stackText);
                        }
                    }
                }

                // 3. Network Logs & Failures (Timing, Payload, Status)
                if (netCount > 0)
                {
                    diagStack.Children.Add(new TextBlock
                    {
                        Text = $"Network Logs & Failures ({netCount}):",
                        FontSize = 9,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = (Brush)FindResource("StatusWarningBrush"),
                        Margin = new Thickness(0, 4, 0, 2)
                    });
                    foreach (var n in entry.NetworkFailures!)
                    {
                        string dur = n.DurationMs > 0 ? $" ({n.DurationMs:F0}ms" : "";
                        string sz = !string.IsNullOrEmpty(n.PayloadSize) ? $", {n.PayloadSize}" : "";
                        string meta = !string.IsNullOrEmpty(dur) ? $"{dur}{sz})" : "";

                        diagStack.Children.Add(new TextBlock
                        {
                            Text = $"{n.Method} {n.Status} {n.StatusText}{meta} — {n.Url}",
                            FontSize = 9,
                            FontFamily = new FontFamily("Consolas"),
                            TextWrapping = TextWrapping.Wrap,
                            Foreground = (Brush)FindResource(n.Failed ? "StatusErrorBrush" : "Subtext1Brush"),
                            Margin = new Thickness(2, 0, 0, 2)
                        });
                    }
                }

                // 4. Automated Reproduction Steps
                if (eventCount > 0)
                {
                    diagStack.Children.Add(new TextBlock
                    {
                        Text = $"Automated Reproduction Steps ({eventCount}):",
                        FontSize = 9,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = (Brush)FindResource("AccentBrush"),
                        Margin = new Thickness(0, 4, 0, 2)
                    });
                    int stepNum = 1;
                    foreach (var ev in entry.ReproductionEvents!)
                    {
                        string action = !string.IsNullOrWhiteSpace(ev.ActionType) ? ev.ActionType.ToUpperInvariant() : "ACTION";
                        string target = !string.IsNullOrWhiteSpace(ev.Selector) ? ev.Selector : ev.Target;
                        string details = !string.IsNullOrWhiteSpace(ev.Details) ? $" — {ev.Details}" : "";
                        string stamp = !string.IsNullOrWhiteSpace(ev.Timestamp) ? $"[{ev.Timestamp}] " : "";

                        var stepRow = new StackPanel { Margin = new Thickness(2, 0, 0, 3) };
                        stepRow.Children.Add(new TextBlock
                        {
                            Text = $"{stepNum++}. {stamp}[{action}] {target}{details}",
                            FontSize = 9,
                            FontFamily = new FontFamily("Consolas"),
                            TextWrapping = TextWrapping.Wrap,
                            Foreground = (Brush)FindResource("TextBrush")
                        });

                        if (!string.IsNullOrWhiteSpace(ev.OuterHtml))
                        {
                            stepRow.Children.Add(new TextBlock
                            {
                                Text = ev.OuterHtml,
                                FontSize = 8,
                                FontFamily = new FontFamily("Consolas"),
                                TextWrapping = TextWrapping.Wrap,
                                Foreground = (Brush)FindResource("Overlay1Brush"),
                                Margin = new Thickness(12, 0, 0, 0)
                            });
                        }
                        diagStack.Children.Add(stepRow);
                    }
                }

                diagExpander.Content = diagStack;
                stack.Children.Add(diagExpander);
            }

            // Attached Screenshots
            if (entry.ScreenshotPaths != null && entry.ScreenshotPaths.Count > 0)
            {
                var shotRow = new WrapPanel { Margin = new Thickness(0, 2, 0, 0) };
                foreach (var shotPath in entry.ScreenshotPaths)
                {
                    if (File.Exists(shotPath))
                    {
                        var shotThumb = BuildSavedScreenshotThumbnail(shotPath, entry);
                        shotRow.Children.Add(shotThumb);
                    }
                }
                stack.Children.Add(shotRow);
            }

            card.Child = stack;
            return card;
        }

        private UIElement BuildSavedScreenshotThumbnail(string filePath, VisualTestTrackerEntry entry)
        {
            var border = new Border
            {
                Background = (Brush)FindResource("Surface1Brush"),
                CornerRadius = new CornerRadius(4),
                Margin = new Thickness(0, 0, 6, 4),
                Padding = new Thickness(3)
            };

            var stack = new StackPanel();

            try
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.DecodePixelWidth = 160;
                bmp.UriSource = new Uri(filePath, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();

                var img = new Image
                {
                    Source = bmp,
                    MaxHeight = 80,
                    Stretch = Stretch.Uniform,
                    Margin = new Thickness(0, 0, 0, 2),
                    Cursor = Cursors.Hand,
                    ToolTip = "Click to open in Annotation Studio"
                };
                img.MouseLeftButtonDown += (s, e) =>
                {
                    var win = new ScreenshotAnnotationWindow(filePath) { Owner = this };
                    if (win.ShowDialog() == true && !string.IsNullOrEmpty(win.ResultFilePath))
                    {
                        int idx = entry.ScreenshotPaths.IndexOf(filePath);
                        if (idx >= 0) entry.ScreenshotPaths[idx] = win.ResultFilePath;
                        if (_store != null) _ = _store.SaveEntryAsync(entry);
                        _ = RefreshBugListAsync();
                    }
                };
                stack.Children.Add(img);
            }
            catch
            {
                stack.Children.Add(new TextBlock { Text = "(image)", FontSize = 9, Foreground = (Brush)FindResource("Subtext1Brush") });
            }

            var btnRow = new Grid();
            btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var copyBtn = new Button
            {
                Content = "Copy",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                Tag = filePath
            };
            copyBtn.Click += (s, e) =>
            {
                try
                {
                    var bmp = new BitmapImage();
                    bmp.BeginInit();
                    bmp.CacheOption = BitmapCacheOption.OnLoad;
                    bmp.UriSource = new Uri(filePath, UriKind.Absolute);
                    bmp.EndInit();
                    Clipboard.SetImage(bmp);
                    ShowMessage("Screenshot copied to clipboard.", isError: false);
                }
                catch (Exception ex)
                {
                    ShowMessage($"Copy error: {ex.Message}", isError: true);
                }
            };
            Grid.SetColumn(copyBtn, 0);

            var annotBtn = new Button
            {
                Content = "✏",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(2, 0, 0, 0),
                ToolTip = "Annotate this screenshot",
                Tag = filePath
            };
            annotBtn.Click += (s, e) =>
            {
                var win = new ScreenshotAnnotationWindow(filePath) { Owner = this };
                if (win.ShowDialog() == true && !string.IsNullOrEmpty(win.ResultFilePath))
                {
                    int idx = entry.ScreenshotPaths.IndexOf(filePath);
                    if (idx >= 0) entry.ScreenshotPaths[idx] = win.ResultFilePath;
                    if (_store != null) _ = _store.SaveEntryAsync(entry);
                    _ = RefreshBugListAsync();
                }
            };
            Grid.SetColumn(annotBtn, 1);

            btnRow.Children.Add(copyBtn);
            btnRow.Children.Add(annotBtn);
            stack.Children.Add(btnRow);

            border.Child = stack;
            return border;
        }

        private void BtnFilter_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string tag)
            {
                _activeFilter = tag;
                _ = RefreshBugListAsync();
            }
        }

        private void BtnCopyAllMarkdown_Click(object sender, RoutedEventArgs e)
        {
            if (_currentEntries.Count == 0)
            {
                ShowMessage("No bug entries to copy.", isError: true);
                return;
            }

            var sb = new StringBuilder();
            sb.AppendLine($"# Visual Test Report — {_activeBaseUrl}{_activePagePath}");
            sb.AppendLine($"**Generated**: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
            sb.AppendLine($"**Total Issues**: {_currentEntries.Count}");
            sb.AppendLine();

            foreach (var entry in _currentEntries)
            {
                sb.AppendLine(entry.ToMarkdown());
                sb.AppendLine("---");
                sb.AppendLine();
            }

            Clipboard.SetText(sb.ToString());
            ShowMessage("Full page bug report copied as Markdown.", isError: false);
        }

        private void BtnExportJson_Click(object sender, RoutedEventArgs e)
        {
            if (_currentEntries.Count == 0)
            {
                ShowMessage("No bug entries on this page to export.", isError: true);
                return;
            }

            OpenExportDialog(new List<VisualTestTrackerEntry>(_currentEntries));
        }

        private void OpenExportDialog(List<VisualTestTrackerEntry> entries)
        {
            var dlg = new ExportBugDialog(entries, _activeBaseUrl, _activePagePath)
            {
                Owner = this
            };
            dlg.ShowDialog();
        }

        // ── Phase 8: Session Management Handlers ─────────────────────────────────

        private void BtnNewSession_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(_activeBaseUrl))
            {
                ShowMessage("Navigate to a watched tab to start a session.", isError: true);
                return;
            }

            _activeSession = VisualTestTrackerSessionStore.StartNewSession(_activeBaseUrl, _activePagePath, _activeSession);
            _sessionStartTime = DateTime.Now;
            VisualTestTrackerTelemetry.ClearCdpData();
            _inspectedDomElement = null;
            DomInspectorDrawer.Visibility = Visibility.Collapsed;
            _isDomInspectorActive = false;
            BtnInspectDom.Content = "🔍 Inspect";

            if (ChkAutoClear.IsChecked == true)
            {
                VisualTestTrackerDraftStore.ClearDraft(_activeBaseUrl, _activePagePath);
                if (_notesMode == "page")
                {
                    NotesBox.Text = "";
                }
                StepsBox.Text = "";
                ExpectedBox.Text = "";
                ActualBox.Text = "";
                TagsBox.Text = "";
                DetailsExpander.IsExpanded = false;
                _stagedScreenshots.Clear();
                RenderStagedThumbnails();
            }

            AutoSaveIndicator.Text = "✓ New Session";
            ShowMessage("Started fresh test session for this page.", isError: false);
        }

        private void BtnSessionHistory_Click(object sender, RoutedEventArgs e)
        {
            var dlg = new SessionHistoryDialog
            {
                Owner = this
            };
            dlg.ShowDialog();
        }

        private void BtnClearSession_Click(object sender, RoutedEventArgs e)
        {
            if (_activeSession != null)
            {
                _activeSession = VisualTestTrackerSessionStore.StartNewSession(_activeBaseUrl, _activePagePath, _activeSession);
                _sessionStartTime = DateTime.Now;
            }

            VisualTestTrackerTelemetry.ClearCdpData();
            _inspectedDomElement = null;
            DomInspectorDrawer.Visibility = Visibility.Collapsed;
            _isDomInspectorActive = false;
            BtnInspectDom.Content = "🔍 Inspect";

            VisualTestTrackerDraftStore.ClearDraft(_activeBaseUrl, _activePagePath);
            if (_notesMode == "page")
            {
                NotesBox.Text = "";
            }
            StepsBox.Text = "";
            ExpectedBox.Text = "";
            ActualBox.Text = "";
            TagsBox.Text = "";
            DetailsExpander.IsExpanded = false;
            _stagedScreenshots.Clear();
            RenderStagedThumbnails();

            AutoSaveIndicator.Text = "Cleared";
            ShowMessage("Session drafts, attachments, and timer cleared.", isError: false);
        }

        // ── Collapsible / Mini Mode ──────────────────────────────────────────────

        private void BtnToggleCollapse_Click(object sender, RoutedEventArgs e)
        {
            if (!_isCollapsed)
            {
                _expandedHeight = Height;
                MainWorkspaceGrid.Visibility = Visibility.Collapsed;
                Height = 110;
                BtnToggleCollapse.Content = "▼ Full";
                BtnToggleCollapse.ToolTip = "Expand full workspace";
                _isCollapsed = true;
            }
            else
            {
                MainWorkspaceGrid.Visibility = Visibility.Visible;
                Height = _expandedHeight > 200 ? _expandedHeight : 720;
                BtnToggleCollapse.Content = "▲ Mini";
                BtnToggleCollapse.ToolTip = "Collapse to mini HUD bar";
                _isCollapsed = false;
            }
        }

        // ── Title Bar API Helper ─────────────────────────────────────────────────

        private void BtnApiHelper_Click(object sender, RoutedEventArgs e)
        {
            if (_apiHelperWindow != null && _apiHelperWindow.IsLoaded)
            {
                _apiHelperWindow.Activate();
                return;
            }

            _apiHelperWindow = new ApiHelperWindow(_activeWebView, _activeBaseUrl, _activePagePath)
            {
                Owner = this
            };
            _apiHelperWindow.Closed += (s, e) => _apiHelperWindow = null;
            _apiHelperWindow.Show();
        }

        // ── Standard Window Plumbing ────────────────────────────────────────────

        private void ShowMessage(string message, bool isError)
        {
            InlineMessage.Text = message;
            InlineMessage.Visibility = string.IsNullOrEmpty(message) ? Visibility.Collapsed : Visibility.Visible;
            InlineMessage.Foreground = (Brush)FindResource(isError ? "StatusErrorBrush" : "StatusSuccessBrush");
        }

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try { DragMove(); } catch { }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e)
        {
            VisualTestTrackerSessionStore.PauseSession(_activeSession);
            _apiHelperWindow?.Close();
            Close();
        }

        protected override void OnClosed(EventArgs e)
        {
            VisualTestTrackerSessionStore.PauseSession(_activeSession);
            base.OnClosed(e);
        }

        private void PersistBounds()
        {
            if (!_loaded) return;
            if (WindowState != WindowState.Normal) return;
            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.VisualTestTrackerLeft = Left;
                settings.VisualTestTrackerTop = Top;
                settings.VisualTestTrackerWidth = Width;
                if (!_isCollapsed) settings.VisualTestTrackerHeight = Height;
                settings.Save();
            }
            catch { }
        }
    }
}
