using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Text.Json;
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
        private bool _isPickingElement;
        private AccessibilityAuditReport _lastA11yReport = new();
        private int _baselineDomNodeCount;

        public ObservableCollection<ConsoleHistoryItem> ConsoleHistory { get; } = new();

        public event Action<bool>? ExpansionChanged;
        public event Action<string>? AddToReproStepsRequested;
        public event Action<string>? AddToNotesRequested;
        public event Action<string, DomElementInfo>? BugSubmittedFromDomInspector;
        public event Action? ApiHelperRequested;

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

        public void AttachWebView(WebView2? webView, string baseUrl, string pagePath)
        {
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
        }

        private void ActiveWebView_CoreWebView2InitializationCompleted(object? sender, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (_activeWebView?.CoreWebView2 != null)
            {
                try
                {
                    _activeWebView.CoreWebView2.WebMessageReceived -= OnActiveWebView_WebMessageReceived;
                    _activeWebView.CoreWebView2.WebMessageReceived += OnActiveWebView_WebMessageReceived;
                }
                catch { }
                _ = VisualTestTrackerTelemetry.InjectObserverAsync(_activeWebView);
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

        public void ClearActiveTab()
        {
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

        private async void BtnPickElement_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView?.CoreWebView2 == null)
            {
                MessageBox.Show("No active WebView2 page connected.", "DOM Inspector", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            if (_isPickingElement)
            {
                _isPickingElement = false;
                TxtPickElementLabel.Text = _lastInspectedElement != null ? "Pick Another" : "Pick Element";
                await VisualTestTrackerTelemetry.DisableDomInspectorAsync(_activeWebView);
                return;
            }

            _isPickingElement = true;
            TxtPickElementLabel.Text = "Cancel Pick";
            await VisualTestTrackerTelemetry.EnableDomInspectorAsync(_activeWebView);
        }

        private void HandleDomElementInspected(DomElementInfo info)
        {
            _lastInspectedElement = info;
            _isPickingElement = false;
            TxtPickElementLabel.Text = "Pick Another";
            TxtDomEmpty.Visibility = Visibility.Collapsed;
            DomPickedContainer.Visibility = Visibility.Visible;

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

            // Reset comment box and give it instant focus for typing
            TxtDomComment.Clear();
            TxtDomBugSuccess.Visibility = Visibility.Collapsed;
            Dispatcher.BeginInvoke(new Action(() =>
            {
                TxtDomComment.Focus();
                Keyboard.Focus(TxtDomComment);
            }), DispatcherPriority.Input);
        }

        private void TxtDomComment_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape)
            {
                e.Handled = true;
                CancelDomNote();
                return;
            }

            if (e.Key == Key.Enter)
            {
                if (Keyboard.Modifiers.HasFlag(ModifierKeys.Shift))
                {
                    // Shift+Enter: Insert a newline
                    e.Handled = true;
                    int caret = TxtDomComment.CaretIndex;
                    TxtDomComment.Text = TxtDomComment.Text.Insert(caret, Environment.NewLine);
                    TxtDomComment.CaretIndex = caret + Environment.NewLine.Length;
                }
                else
                {
                    // Enter: Submit to bug list
                    e.Handled = true;
                    SubmitDomBug();
                }
            }
        }

        private void TxtDomComment_TextChanged(object sender, TextChangedEventArgs e)
        {
            TxtDomCommentWatermark.Visibility = string.IsNullOrEmpty(TxtDomComment.Text)
                ? Visibility.Visible
                : Visibility.Collapsed;
        }

        private void BtnDomSendBug_Click(object sender, RoutedEventArgs e)
        {
            SubmitDomBug();
        }

        private void BtnDomCancelNote_Click(object sender, RoutedEventArgs e)
        {
            CancelDomNote();
        }

        public async void CancelDomNote()
        {
            TxtDomComment.Clear();
            _lastInspectedElement = null;
            DomPickedContainer.Visibility = Visibility.Collapsed;
            TxtDomEmpty.Visibility = Visibility.Visible;
            TxtPickElementLabel.Text = "Pick Element";

            if (_isPickingElement)
            {
                _isPickingElement = false;
                if (_activeWebView?.CoreWebView2 != null)
                {
                    await VisualTestTrackerTelemetry.DisableDomInspectorAsync(_activeWebView);
                }
            }
        }

        private void SubmitDomBug()
        {
            if (_lastInspectedElement == null) return;

            string comment = TxtDomComment.Text.Trim();
            BugSubmittedFromDomInspector?.Invoke(comment, _lastInspectedElement);

            TxtDomComment.Clear();

            // Show confirmation badge briefly
            TxtDomBugSuccess.Visibility = Visibility.Visible;
            var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2.5) };
            timer.Tick += (s, e) =>
            {
                timer.Stop();
                TxtDomBugSuccess.Visibility = Visibility.Collapsed;
            };
            timer.Start();
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
                // Run a lightweight accessibility script
                string script = @"(function() {
                    var issues = [];
                    var images = document.querySelectorAll('img:not([alt])');
                    images.forEach(function(img) { issues.push('Image missing alt attribute: ' + (img.src || '').substring(0, 50)); });
                    var emptyBtns = document.querySelectorAll('button:empty');
                    emptyBtns.forEach(function(b) { issues.push('Button has no label or text'); });
                    var inputs = document.querySelectorAll('input:not([aria-label]):not([id])');
                    inputs.forEach(function(inp) { issues.push('Input missing accessible label or ID: ' + (inp.name || inp.type)); });
                    return JSON.stringify({ issueCount: issues.length, items: issues });
                })();";
                string json = await _activeWebView.CoreWebView2.ExecuteScriptAsync(script);
                using var doc = JsonDocument.Parse(json);
                int count = 0;
                if (doc.RootElement.ValueKind == JsonValueKind.String)
                {
                    using var innerDoc = JsonDocument.Parse(doc.RootElement.GetString() ?? "{}");
                    if (innerDoc.RootElement.TryGetProperty("issueCount", out var countProp))
                        count = countProp.GetInt32();
                }
                else if (doc.RootElement.TryGetProperty("issueCount", out var countProp))
                {
                    count = countProp.GetInt32();
                }

                TxtA11ySummary.Text = count == 0 ? "✓ 0 accessibility issues detected on this page." : $"⚠️ {count} accessibility issue(s) detected.";
                TxtTelemetryA11y.Text = $"a11y {count}";
                BtnAddA11yToBug.Visibility = count > 0 ? Visibility.Visible : Visibility.Collapsed;
            }
            catch (Exception ex)
            {
                TxtA11ySummary.Text = $"Scan failed: {ex.Message}";
            }
        }

        private void BtnAddA11yToBug_Click(object sender, RoutedEventArgs e)
        {
            AddToNotesRequested?.Invoke($"\n**Accessibility Issues Found**:\n{TxtA11ySummary.Text}");
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
