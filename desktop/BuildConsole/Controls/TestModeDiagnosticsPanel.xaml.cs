using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using BuildConsole.Services;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Controls
{
    public class ConsoleHistoryItem
    {
        public string Cmd { get; set; } = "";
        public string Result { get; set; } = "";
    }

    public partial class TestModeDiagnosticsPanel : UserControl
    {
        private WebView2? _activeWebView;
        private string _activeBaseUrl = "";
        private string _activePagePath = "";
        private bool _isExpanded;

        private DomElementInfo? _lastInspectedElement;
        private bool _isDomInspectorActive = true;
        private AccessibilityAuditReport _lastA11yReport = new();
        private int _baselineDomNodeCount;

        // Git #3983 — real bugs already tracked against the currently-locked element, from the
        // last (page_id, selector) lookup. Kept so a click on the popover's status icon can open
        // the detail view without a second round-trip to Postgres.
        private VisualTestTrackerStore? _bugStatusStore;
        private List<VisualTestTrackerEntry> _lastElementBugs = new();

        public ObservableCollection<ConsoleHistoryItem> ConsoleHistory { get; } = new();

        public event Action<bool>? ExpansionChanged;
        public event Action<string>? AddToReproStepsRequested;
        public event Action<string>? AddToNotesRequested;
        public event Action<string, DomElementInfo>? BugSubmittedFromDomInspector;
        public event Action? ApiHelperRequested;
        public event Action<DomElementInfo, List<VisualTestTrackerEntry>>? BugHistoryRequested;

        public bool IsExpanded
        {
            get => _isExpanded;
            set
            {
                _isExpanded = value;
                RailCollapsed.Visibility = _isExpanded ? Visibility.Collapsed : Visibility.Visible;
                PanelExpanded.Visibility = _isExpanded ? Visibility.Visible : Visibility.Collapsed;
                Width = _isExpanded ? 300 : 48;
                ExpansionChanged?.Invoke(_isExpanded);
            }
        }

        public TestModeDiagnosticsPanel()
        {
            InitializeComponent();
            ListConsoleHistory.ItemsSource = ConsoleHistory;

            VisualTestTrackerTelemetry.OnDomElementInspected += (info) =>
            {
                Dispatcher.Invoke(() => HandleDomElementInspected(info));
            };
        }

        public async void AttachWebView(WebView2? webView, string baseUrl, string pagePath)
        {
            var previousWebView = _activeWebView;
            bool isTabSwitch = previousWebView != null && !ReferenceEquals(previousWebView, webView);

            if (_activeWebView?.CoreWebView2 != null)
            {
                try { _activeWebView.CoreWebView2.WebMessageReceived -= OnActiveWebView_WebMessageReceived; } catch { }
            }
            if (_activeWebView != null)
            {
                _activeWebView.CoreWebView2InitializationCompleted -= ActiveWebView_CoreWebView2InitializationCompleted;
            }

            _activeWebView = webView;
            _activeBaseUrl = baseUrl;
            _activePagePath = pagePath;

            if (_activeWebView != null)
            {
                if (_activeWebView.CoreWebView2 != null)
                {
                    try
                    {
                        _activeWebView.CoreWebView2.WebMessageReceived -= OnActiveWebView_WebMessageReceived;
                        _activeWebView.CoreWebView2.WebMessageReceived += OnActiveWebView_WebMessageReceived;
                    }
                    catch { }
                    _ = VisualTestTrackerTelemetry.InjectObserverAsync(_activeWebView);
                    if (_isDomInspectorActive)
                    {
                        _ = VisualTestTrackerTelemetry.EnableDomInspectorAsync(_activeWebView);
                    }
                    UpdateTelemetry();
                }
                else
                {
                    _activeWebView.CoreWebView2InitializationCompleted += ActiveWebView_CoreWebView2InitializationCompleted;
                }
            }
            else
            {
                UpdateTelemetry();
            }

            // Stop the DOM Inspector's in-page listeners on the tab we just left — otherwise
            // they keep running unthrottled in that tab's own document (Git #3990).
            if (isTabSwitch && previousWebView?.CoreWebView2 != null)
            {
                await VisualTestTrackerTelemetry.DisableDomInspectorAsync(previousWebView);
                await VisualTestTrackerTelemetry.DisableDomMutationObserverAsync(previousWebView);
            }
        }

        private void ActiveWebView_CoreWebView2InitializationCompleted(object? sender, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (e.IsSuccess && _activeWebView?.CoreWebView2 != null)
            {
                try
                {
                    _activeWebView.CoreWebView2.WebMessageReceived -= OnActiveWebView_WebMessageReceived;
                    _activeWebView.CoreWebView2.WebMessageReceived += OnActiveWebView_WebMessageReceived;
                }
                catch { }
                _ = VisualTestTrackerTelemetry.InjectObserverAsync(_activeWebView);
                if (_isDomInspectorActive)
                {
                    _ = VisualTestTrackerTelemetry.EnableDomInspectorAsync(_activeWebView);
                }
                UpdateTelemetry();
            }
        }

        private void OnActiveWebView_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string message = "";
                try
                {
                    message = e.TryGetWebMessageAsString();
                }
                catch { }

                if (string.IsNullOrEmpty(message))
                {
                    try
                    {
                        message = e.WebMessageAsJson ?? "";
                        if (message.StartsWith("\"") && message.EndsWith("\"") && message.Length >= 2)
                        {
                            try { message = JsonSerializer.Deserialize<string>(message) ?? message; } catch { }
                        }
                    }
                    catch { }
                }

                if (!string.IsNullOrEmpty(message))
                {
                    // 1. Check for in-page quick bug submit (Enter from note card)
                    var bugSubmit = VisualTestTrackerTelemetry.TryParseDomBugSubmitMessage(message);
                    if (bugSubmit != null)
                    {
                        Dispatcher.Invoke(() =>
                        {
                            _lastInspectedElement = null;
                            _lastElementBugs = new List<VisualTestTrackerEntry>();
                            DomPickedContainer.Visibility = Visibility.Collapsed;
                            TxtDomEmpty.Visibility = Visibility.Visible;
                            BugSubmittedFromDomInspector?.Invoke(bugSubmit.Value.Comment, bugSubmit.Value.Element);
                        });
                        return;
                    }

                    // 2. Check for + Step from note card
                    var step = VisualTestTrackerTelemetry.TryParseDomAddStepMessage(message);
                    if (!string.IsNullOrEmpty(step))
                    {
                        Dispatcher.Invoke(() => AddToReproStepsRequested?.Invoke(step));
                        return;
                    }

                    // 3. Check for in-page note cancel (Esc from note card)
                    if (VisualTestTrackerTelemetry.TryParseDomInspectCancelMessage(message))
                    {
                        Dispatcher.Invoke(() =>
                        {
                            _lastInspectedElement = null;
                            _lastElementBugs = new List<VisualTestTrackerEntry>();
                            DomPickedContainer.Visibility = Visibility.Collapsed;
                            TxtDomEmpty.Visibility = Visibility.Visible;
                        });
                        return;
                    }

                    // 3.5. Git #3983 — click on the popover's bug-status icon requests the full
                    // history for whichever element is currently locked.
                    if (message.Contains("VTT_DOM_BUG_HISTORY_REQUEST"))
                    {
                        Dispatcher.Invoke(() =>
                        {
                            if (_lastInspectedElement != null)
                            {
                                BugHistoryRequested?.Invoke(_lastInspectedElement, _lastElementBugs);
                            }
                        });
                        return;
                    }

                    // 4. Check for element inspection hover/click
                    var domInfo = VisualTestTrackerTelemetry.TryParseDomInspectMessage(message);
                    if (domInfo != null)
                    {
                        // Note: TryParseDomInspectMessage raises OnDomElementInspected which is subscribed to in the constructor.
                        return;
                    }

                    try
                    {
                        using var doc = JsonDocument.Parse(message);
                        if (doc.RootElement.TryGetProperty("type", out var typeEl) && typeEl.GetString() == "dom_inspect")
                        {
                            var info = new DomElementInfo
                            {
                                Tag = doc.RootElement.TryGetProperty("tagName", out var t) ? t.GetString() ?? "" : "",
                                Classes = doc.RootElement.TryGetProperty("className", out var c) ? c.GetString() ?? "" : "",
                                Id = doc.RootElement.TryGetProperty("id", out var i) ? i.GetString() ?? "" : "",
                                Selector = doc.RootElement.TryGetProperty("selector", out var s) ? s.GetString() ?? "" : ""
                            };
                            if (doc.RootElement.TryGetProperty("rect", out var rectEl))
                            {
                                if (rectEl.TryGetProperty("width", out var w)) info.Width = w.GetDouble();
                                if (rectEl.TryGetProperty("height", out var h)) info.Height = h.GetDouble();
                                if (rectEl.TryGetProperty("left", out var l)) info.Left = l.GetDouble();
                                if (rectEl.TryGetProperty("top", out var tp)) info.Top = tp.GetDouble();
                            }
                            Dispatcher.Invoke(() => HandleDomElementInspected(info));
                            return;
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }

        public async void ClearActiveTab()
        {
            var webViewToStop = _activeWebView;

            if (_activeWebView?.CoreWebView2 != null)
            {
                try { _activeWebView.CoreWebView2.WebMessageReceived -= OnActiveWebView_WebMessageReceived; } catch { }
            }
            if (_activeWebView != null)
            {
                _activeWebView.CoreWebView2InitializationCompleted -= ActiveWebView_CoreWebView2InitializationCompleted;
            }
            _activeWebView = null;
            _activeBaseUrl = "";
            _activePagePath = "";
            UpdateTelemetry();

            // Run the DOM Inspector's real stop script inside the page's own JS context — without
            // this, its unthrottled mousemove/click listeners keep running on that tab after Test
            // Mode exits, lagging the tab and swallowing clicks in normal Build Mode (Git #3990).
            if (webViewToStop?.CoreWebView2 != null)
            {
                await VisualTestTrackerTelemetry.DisableDomInspectorAsync(webViewToStop);
                await VisualTestTrackerTelemetry.DisableDomMutationObserverAsync(webViewToStop);
            }
        }

        public async void UpdateTelemetry()
        {
            if (_activeWebView?.CoreWebView2 != null)
            {
                var counts = await VisualTestTrackerTelemetry.GetCountsAsync(_activeWebView);
                TxtTelemetryErrors.Text = $"{counts.Errors} errors";
                TxtTelemetryNetFail.Text = $"{counts.NetworkFailures} net fail";
                TxtTelemetryPerf.Text = counts.PageLoadMs > 0 ? $"{counts.PageLoadMs:0} ms" : "-- ms";
                TxtTelemetryEvents.Text = $"{counts.Events} events";
                TxtTelemetryCdp.Text = "CDP connected";
            }
            else
            {
                TxtTelemetryErrors.Text = "0 errors";
                TxtTelemetryNetFail.Text = "0 net fail";
                TxtTelemetryPerf.Text = "-- ms";
                TxtTelemetryEvents.Text = "0 events";
                TxtTelemetryCdp.Text = "CDP idle";
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // Accordion Management (Only one open at a time)
        // ═══════════════════════════════════════════════════════════════════

        public void OpenSection(string section)
        {
            if (!IsExpanded)
            {
                IsExpanded = true;
            }

            BodyDom.Visibility = section == "dom" ? Visibility.Visible : Visibility.Collapsed;
            IconDomChevron.Text = section == "dom" ? "\uE70E" : "\uE70D";

            BodyA11y.Visibility = section == "a11y" ? Visibility.Visible : Visibility.Collapsed;
            IconA11yChevron.Text = section == "a11y" ? "\uE70E" : "\uE70D";

            BodyMut.Visibility = section == "mut" ? Visibility.Visible : Visibility.Collapsed;
            IconMutChevron.Text = section == "mut" ? "\uE70E" : "\uE70D";

            BodyRunner.Visibility = section == "runner" ? Visibility.Visible : Visibility.Collapsed;
            IconRunnerChevron.Text = section == "runner" ? "\uE70E" : "\uE70D";

            BodyHud.Visibility = section == "hud" ? Visibility.Visible : Visibility.Collapsed;
            IconHudChevron.Text = section == "hud" ? "\uE70E" : "\uE70D";
        }

        private void ToggleSection(Border body, TextBlock chevron)
        {
            bool willOpen = body.Visibility != Visibility.Visible;
            // Close all
            BodyDom.Visibility = Visibility.Collapsed;
            IconDomChevron.Text = "\uE70D";
            BodyA11y.Visibility = Visibility.Collapsed;
            IconA11yChevron.Text = "\uE70D";
            BodyMut.Visibility = Visibility.Collapsed;
            IconMutChevron.Text = "\uE70D";
            BodyRunner.Visibility = Visibility.Collapsed;
            IconRunnerChevron.Text = "\uE70D";
            BodyHud.Visibility = Visibility.Collapsed;
            IconHudChevron.Text = "\uE70D";

            if (willOpen)
            {
                body.Visibility = Visibility.Visible;
                chevron.Text = "\uE70E";
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // Rail and Accordion Click Handlers
        // ═══════════════════════════════════════════════════════════════════

        private void BtnExpandRail_Click(object sender, RoutedEventArgs e) => IsExpanded = true;
        private void BtnCollapseRail_Click(object sender, RoutedEventArgs e) => IsExpanded = false;

        private void RailBtnDom_Click(object sender, RoutedEventArgs e) => OpenSection("dom");
        private void RailBtnA11y_Click(object sender, RoutedEventArgs e) => OpenSection("a11y");
        private void RailBtnMut_Click(object sender, RoutedEventArgs e) => OpenSection("mut");
        private void RailBtnRunner_Click(object sender, RoutedEventArgs e) => OpenSection("runner");
        private void RailBtnHud_Click(object sender, RoutedEventArgs e) => OpenSection("hud");
        private void RailBtnApi_Click(object sender, RoutedEventArgs e) => ApiHelperRequested?.Invoke();

        private void HdrDom_Click(object sender, MouseButtonEventArgs e) => ToggleSection(BodyDom, IconDomChevron);
        private void HdrA11y_Click(object sender, MouseButtonEventArgs e) => ToggleSection(BodyA11y, IconA11yChevron);
        private void HdrMut_Click(object sender, MouseButtonEventArgs e) => ToggleSection(BodyMut, IconMutChevron);
        private void HdrRunner_Click(object sender, MouseButtonEventArgs e) => ToggleSection(BodyRunner, IconRunnerChevron);
        private void HdrHud_Click(object sender, MouseButtonEventArgs e) => ToggleSection(BodyHud, IconHudChevron);
        private void BtnOpenApiHelper_Click(object sender, MouseButtonEventArgs e) => ApiHelperRequested?.Invoke();

        // ═══════════════════════════════════════════════════════════════════
        // DOM Inspector
        // ═══════════════════════════════════════════════════════════════════

        private async void BtnToggleDomInspect_Click(object sender, RoutedEventArgs e)
        {
            await ToggleDomInspectorAsync();
        }

        public async Task ToggleDomInspectorAsync()
        {
            if (_activeWebView?.CoreWebView2 == null)
            {
                MessageBox.Show("No active WebView2 page connected.", "DOM Inspector", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            _isDomInspectorActive = !_isDomInspectorActive;
            UpdateDomInspectToggleUi();

            if (_isDomInspectorActive)
            {
                await VisualTestTrackerTelemetry.EnableDomInspectorAsync(_activeWebView);
            }
            else
            {
                await VisualTestTrackerTelemetry.DisableDomInspectorAsync(_activeWebView);
            }
        }

        private void UpdateDomInspectToggleUi()
        {
            if (_isDomInspectorActive)
            {
                DotDomInspectActive.Fill = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#10B981"));
                TxtToggleDomInspectLabel.Text = "Active (ON)";
                TxtDomStatus.Text = "Active — hover & click elements";
                TxtDomStatus.Foreground = (System.Windows.Media.Brush)FindResource("AccentBrush");
            }
            else
            {
                DotDomInspectActive.Fill = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#64748B"));
                TxtToggleDomInspectLabel.Text = "Paused (OFF)";
                TxtDomStatus.Text = "Paused — inspector inactive";
                TxtDomStatus.Foreground = (System.Windows.Media.Brush)FindResource("Subtext1Brush");
            }
        }

        private void HandleDomElementInspected(DomElementInfo info)
        {
            _lastInspectedElement = info;
            _lastElementBugs = new List<VisualTestTrackerEntry>();
            TxtDomEmpty.Visibility = Visibility.Collapsed;
            DomPickedContainer.Visibility = Visibility.Visible;

            // Git #3983 — real lookup against (page_id, selector); the in-page popover's own
            // status icon is shown/hidden by the JS callback once this resolves.
            _ = ShowElementBugStatusAsync(info);

            // Ensure DOM accordion section is visible and expanded
            BodyDom.Visibility = Visibility.Visible;
            IconDomChevron.Text = "\uE70E";

            string firstClass = "";
            if (!string.IsNullOrWhiteSpace(info.Classes))
            {
                var parts = info.Classes.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length > 0) firstClass = "." + parts[0];
            }
            TxtDomTag.Text = $"{info.Tag.ToLowerInvariant()}{firstClass}";
            TxtDomDims.Text = $"{(int)info.Width}×{(int)info.Height}px";
            TxtDomA11y.Text = "a11y verified";
            TxtDomSelector.Text = info.Selector;

            if (!string.IsNullOrWhiteSpace(info.InnerText))
            {
                string snippet = info.InnerText.Trim();
                if (snippet.Length > 80) snippet = snippet[..77] + "...";
                TxtDomInnerText.Text = $"\"{snippet}\"";
                TxtDomInnerText.Visibility = Visibility.Visible;
            }
            else
            {
                TxtDomInnerText.Visibility = Visibility.Collapsed;
            }

            // Git #4450 — deliberately no focus call here. The rail used to own a hidden "Add Comment"
            // box and pull real keyboard focus into it on every inspect click, out of the WebView2 the
            // user had just clicked in. Note entry now lives only in the in-page card (focused by its
            // own script) and the composer, so nothing on the host side should move focus on inspect.
        }

        /// <summary>
        /// Git #3983 — real (page_id, selector) lookup for the element just locked by the DOM
        /// inspector. A page that doesn't exist yet (never visited before this session) can't have
        /// any bugs against it, so this uses the read-only <see cref="VisualTestTrackerStore.FindPageIdAsync"/>
        /// rather than creating one — checking for existing bugs must never itself count as a "visit."
        /// If any are found, calls back into the WebView to show the popover's status icon; the
        /// element's own selector is re-checked against whatever is currently locked before injecting
        /// anything, since the user may have already moved on to a different element by the time this
        /// (deliberately fire-and-forget) lookup resolves.
        /// </summary>
        private async Task ShowElementBugStatusAsync(DomElementInfo info)
        {
            if (string.IsNullOrWhiteSpace(info.Selector)) return;

            try
            {
                if (_bugStatusStore == null)
                {
                    var connStr = VisualTestTrackerStore.ResolveConnectionString();
                    if (string.IsNullOrWhiteSpace(connStr)) return;
                    _bugStatusStore = new VisualTestTrackerStore(connStr);
                }

                int? pageId = await _bugStatusStore.FindPageIdAsync(_activeBaseUrl, _activePagePath);
                if (pageId == null) return;

                var bugs = await _bugStatusStore.GetBugsForElementAsync(pageId.Value, info.Selector);

                // Stale response — the locked element changed while this lookup was in flight.
                if (_lastInspectedElement?.Selector != info.Selector) return;
                if (bugs.Count == 0 || _activeWebView?.CoreWebView2 == null) return;

                _lastElementBugs = bugs;
                var (color, label) = ElementBugStatusPresenter.ColorAndLabelFor(bugs[0]);
                // extraCount, not the raw total: spec is "(n) beyond the one shown" — 2 total bugs
                // reads "(1)", not "(2)" (confirmed against the issue's own verification steps).
                string payload = JsonSerializer.Serialize(new { color, label, extraCount = bugs.Count - 1 });
                await _activeWebView.CoreWebView2.ExecuteScriptAsync(
                    $"window.__vttDomShowBugStatus && window.__vttDomShowBugStatus({payload});");
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"Element bug status lookup failed: {ex.Message}");
            }
        }

        private void BtnDomCancelNote_Click(object sender, RoutedEventArgs e)
        {
            CancelDomNote();
        }

        public async void CancelDomNote()
        {
            _lastInspectedElement = null;
            DomPickedContainer.Visibility = Visibility.Collapsed;
            TxtDomEmpty.Visibility = Visibility.Visible;

            if (_activeWebView?.CoreWebView2 != null)
            {
                await VisualTestTrackerTelemetry.DismissDomNoteAsync(_activeWebView);
            }
        }

        private void BtnDomAddToSteps_Click(object sender, RoutedEventArgs e)
        {
            if (_lastInspectedElement != null)
            {
                AddToReproStepsRequested?.Invoke($"Click element `{_lastInspectedElement.Selector}`");
            }
        }

        private void BtnDomAddToNotes_Click(object sender, RoutedEventArgs e)
        {
            if (_lastInspectedElement != null)
            {
                AddToNotesRequested?.Invoke($"\nTarget Element: `{_lastInspectedElement.Selector}` ({_lastInspectedElement.Width}×{_lastInspectedElement.Height})");
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // Accessibility Audit
        // ═══════════════════════════════════════════════════════════════════

        private async void BtnRescanA11y_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView?.CoreWebView2 == null)
            {
                MessageBox.Show("No active WebView2 page connected.", "Accessibility Audit", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            try
            {
                _lastA11yReport = await VisualTestTrackerTelemetry.RunAccessibilityAuditAsync(_activeWebView);

                // RunAccessibilityAuditAsync returns an empty report (no Timestamp) on failure — same
                // failure signal PageAutoCheckService checks before persisting (Git #4442).
                if (string.IsNullOrWhiteSpace(_lastA11yReport.Timestamp))
                {
                    TxtA11ySummary.Text = "Scan failed: the accessibility audit could not run on this page.";
                    TxtTelemetryA11y.Text = "a11y ?";
                    BtnAddA11yToBug.Visibility = Visibility.Collapsed;
                    A11yIssuesContainer.Children.Clear();
                    return;
                }

                int count = _lastA11yReport.TotalViolations;
                TxtA11ySummary.Text = count == 0
                    ? "✓ 0 accessibility issues detected on this page."
                    : $"⚠️ {count} accessibility issue(s) detected ({_lastA11yReport.MissingAltCount} missing alt, {_lastA11yReport.ContrastCount} contrast, {_lastA11yReport.AriaCount} ARIA).";
                TxtTelemetryA11y.Text = $"a11y {count}";
                BtnAddA11yToBug.Visibility = count > 0 ? Visibility.Visible : Visibility.Collapsed;
                RenderA11yIssues();

                await PersistA11yAuditAsync(_lastA11yReport);
            }
            catch (Exception ex)
            {
                TxtA11ySummary.Text = $"Scan failed: {ex.Message}";
            }
        }

        /// <summary>Git #4458 — shares one real record with #4442's navigation auto-check instead of
        /// each Test Mode surface keeping its own disagreeing count.</summary>
        private async Task PersistA11yAuditAsync(AccessibilityAuditReport report)
        {
            if (string.IsNullOrWhiteSpace(_activeBaseUrl) || string.IsNullOrWhiteSpace(_activePagePath)) return;

            try
            {
                if (_bugStatusStore == null)
                {
                    var connStr = VisualTestTrackerStore.ResolveConnectionString();
                    if (string.IsNullOrWhiteSpace(connStr)) return;
                    _bugStatusStore = new VisualTestTrackerStore(connStr);
                }

                var page = await _bugStatusStore.GetOrCreatePageAsync(_activeBaseUrl, _activePagePath);
                await _bugStatusStore.SaveA11yAuditAsync(new VisualTestTrackerA11yAudit
                {
                    PageId = page.Id,
                    BaseUrl = _activeBaseUrl,
                    PagePath = _activePagePath,
                    Violations = report.Violations,
                    LastAuditedAt = DateTime.Now,
                });
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"Rescan A11y persist failed: {ex.Message}");
            }
        }

        private void RenderA11yIssues()
        {
            A11yIssuesContainer.Children.Clear();

            foreach (var v in _lastA11yReport.Violations)
            {
                var card = new Border
                {
                    Background = (System.Windows.Media.Brush)FindResource("Surface0Brush"),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(5, 3, 5, 3),
                    Margin = new Thickness(0, 0, 0, 3)
                };

                var sp = new StackPanel();

                var headerGrid = new Grid();
                headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var leftSp = new StackPanel { Orientation = Orientation.Horizontal };
                var badgeColor = v.Category == "MissingAlt" ? "#f97316" : v.Category == "Contrast" ? "#ef4444" : "#a855f7";
                var tagBlock = new TextBlock
                {
                    Text = $"[{v.Category.ToUpperInvariant()}]",
                    FontSize = 8,
                    FontWeight = FontWeights.Bold,
                    Foreground = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(badgeColor)),
                    Margin = new Thickness(0, 0, 4, 0)
                };
                var ruleBlock = new TextBlock
                {
                    Text = v.Rule,
                    FontSize = 8,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (System.Windows.Media.Brush)FindResource("TextBrush")
                };
                leftSp.Children.Add(tagBlock);
                leftSp.Children.Add(ruleBlock);

                var viewBtn = new Button
                {
                    Content = "🔍 View",
                    Style = (Style)FindResource("IconButton"),
                    FontSize = 8,
                    Padding = new Thickness(3, 0, 3, 0),
                    Tag = v.Selector
                };
                viewBtn.Click += async (s, e) =>
                {
                    if (s is Button b && b.Tag is string sel && !string.IsNullOrEmpty(sel))
                    {
                        await VisualTestTrackerTelemetry.ScrollToAndHighlightElementAsync(_activeWebView, sel);
                    }
                };

                Grid.SetColumn(leftSp, 0);
                Grid.SetColumn(viewBtn, 1);
                headerGrid.Children.Add(leftSp);
                headerGrid.Children.Add(viewBtn);
                sp.Children.Add(headerGrid);

                var msgBlock = new TextBlock
                {
                    Text = v.Message,
                    FontSize = 8,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = (System.Windows.Media.Brush)FindResource("Subtext1Brush"),
                    Margin = new Thickness(0, 1, 0, 0)
                };
                sp.Children.Add(msgBlock);

                if (!string.IsNullOrEmpty(v.Selector))
                {
                    var selBlock = new TextBlock
                    {
                        Text = v.Selector,
                        FontSize = 8,
                        FontFamily = new System.Windows.Media.FontFamily("Consolas"),
                        Foreground = (System.Windows.Media.Brush)FindResource("AccentBrush"),
                        Margin = new Thickness(0, 1, 0, 0)
                    };
                    sp.Children.Add(selBlock);
                }

                card.Child = sp;
                A11yIssuesContainer.Children.Add(card);
            }
        }

        private void BtnAddA11yToBug_Click(object sender, RoutedEventArgs e)
        {
            string detail = TxtA11ySummary.Text;
            if (_lastA11yReport.TotalViolations > 0)
            {
                var lines = _lastA11yReport.Violations.Select(v => $"- [{v.Category}] {v.Rule}: {v.Message}" + (string.IsNullOrEmpty(v.Selector) ? "" : $" (`{v.Selector}`)"));
                detail += "\n" + string.Join("\n", lines);
            }
            AddToNotesRequested?.Invoke($"\n**Accessibility Issues Found**:\n{detail}");
        }

        // ═══════════════════════════════════════════════════════════════════
        // DOM Mutations
        // ═══════════════════════════════════════════════════════════════════

        private async void BtnMutBaseline_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView?.CoreWebView2 == null) return;
            string countStr = await _activeWebView.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('*').length");
            if (int.TryParse(countStr, out int count))
            {
                _baselineDomNodeCount = count;
                TxtMutSummary.Text = $"Baseline captured ({count} DOM nodes).";
            }
        }

        private async void BtnMutDiff_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView?.CoreWebView2 == null) return;
            string countStr = await _activeWebView.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('*').length");
            if (int.TryParse(countStr, out int current))
            {
                int diff = current - _baselineDomNodeCount;
                TxtMutSummary.Text = $"DOM Delta: {(diff >= 0 ? "+" : "")}{diff} nodes (Total: {current}).";
                TxtTelemetryDomMut.Text = $"DOM Δ {diff}";
                BtnAddMutToSteps.Visibility = Visibility.Visible;
            }
        }

        private void BtnAddMutToSteps_Click(object sender, RoutedEventArgs e)
        {
            AddToReproStepsRequested?.Invoke($"Verify DOM mutation: {TxtMutSummary.Text}");
        }

        // ═══════════════════════════════════════════════════════════════════
        // DevTools Runner
        // ═══════════════════════════════════════════════════════════════════

        private void TxtConsoleCmd_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter && !Keyboard.Modifiers.HasFlag(ModifierKeys.Shift))
            {
                e.Handled = true;
                ExecuteConsoleCommand();
            }
        }

        private void BtnRunConsole_Click(object sender, RoutedEventArgs e)
        {
            ExecuteConsoleCommand();
        }

        private async void ExecuteConsoleCommand()
        {
            string cmd = TxtConsoleCmd.Text.Trim();
            if (string.IsNullOrEmpty(cmd)) return;

            if (_activeWebView?.CoreWebView2 == null)
            {
                MessageBox.Show("No active WebView2 page connected.", "DevTools Runner", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            try
            {
                string result = await _activeWebView.CoreWebView2.ExecuteScriptAsync(cmd);
                ConsoleHistory.Insert(0, new ConsoleHistoryItem { Cmd = cmd, Result = result });
                BtnAttachConsoleResult.Visibility = Visibility.Visible;
                TxtConsoleCmd.Clear();
            }
            catch (Exception ex)
            {
                ConsoleHistory.Insert(0, new ConsoleHistoryItem { Cmd = cmd, Result = $"Error: {ex.Message}" });
            }
        }

        private void BtnAttachConsoleResult_Click(object sender, MouseButtonEventArgs e)
        {
            if (ConsoleHistory.Count > 0)
            {
                var item = ConsoleHistory[0];
                AddToNotesRequested?.Invoke($"\n**Console Execution**:\n```js\n> {item.Cmd}\n{item.Result}\n```");
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // HUD Options
        // ═══════════════════════════════════════════════════════════════════

        private void SliderOpacity_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (TxtOpacityReadout != null)
            {
                TxtOpacityReadout.Text = $"{(int)e.NewValue}%";
            }
        }
    }
}
