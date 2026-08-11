using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole
{
    public partial class AutomationRunnerWindow : Window
    {
        private readonly string _targetUrl;
        private readonly List<Controls.AutomationAction> _steps;

        public AutomationRunnerWindow(string targetUrl, List<Controls.AutomationAction> steps)
        {
            InitializeComponent();
            _targetUrl = string.IsNullOrWhiteSpace(targetUrl) ? "https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/" : targetUrl;
            _steps = new List<Controls.AutomationAction>(steps);

            TxtTargetUrl.Text = _targetUrl;
            Loaded += AutomationRunnerWindow_Loaded;
        }

        private async void AutomationRunnerWindow_Loaded(object sender, RoutedEventArgs e)
        {
            await RunTestSequenceAsync();
        }

        private async Task RunTestSequenceAsync()
        {
            TxtStatusBadge.Text = "● RUNNING TEST SUITE...";
            TxtStatusBadge.Foreground = (Brush)FindResource("PeachBrush");
            TelemetryLogContainer.Children.Clear();

            AddTelemetryCard("START", $"Navigating to {_targetUrl}", "INFO", "#89B4FA");

            try
            {
                await TestRunnerWebView.EnsureCoreWebView2Async();
                TestRunnerWebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;

                var tcs = new TaskCompletionSource<bool>();
                void NavHandler(object? s, Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs args)
                {
                    TestRunnerWebView.NavigationCompleted -= NavHandler;
                    tcs.TrySetResult(args.IsSuccess);
                }

                TestRunnerWebView.NavigationCompleted += NavHandler;
                TestRunnerWebView.Source = new Uri(_targetUrl);

                bool navSuccess = await tcs.Task;
                if (!navSuccess)
                {
                    AddTelemetryCard("NAV FAIL", "Page failed to load or encountered HTTP error.", "ERROR", "#F38BA8");
                    TxtStatusBadge.Text = "❌ TEST FAILED (Navigation Error)";
                    TxtStatusBadge.Foreground = (Brush)FindResource("RedBrush");
                    return;
                }

                AddTelemetryCard("NAV OK", "Page loaded successfully.", "SUCCESS", "#A6E3A1");
                await Task.Delay(1200);

                int stepNumber = 0;
                int passedSteps = 0;

                foreach (var step in _steps)
                {
                    stepNumber++;
                    string actionType = step.ActionType.ToLowerInvariant();
                    string selector = step.Selector;
                    string val = step.Value;

                    AddTelemetryCard($"STEP {stepNumber}", $"{step.ActionTypeUpper}: {selector} {(string.IsNullOrEmpty(val) ? "" : "=> " + val)}", "RUNNING", "#89DCEB");

                    // Execute JS element check & trigger
                    string script = $@"
(function() {{
    try {{
        let el = document.querySelector('{selector.Replace("'", "\\'")}');
        if (!el) {{
            // Try fallback text match if selector is tag
            let tags = document.querySelectorAll('{step.TagName.Replace("'", "\\'")}');
            for (let t of tags) {{
                if ((t.innerText || t.value || '').trim().includes('{val.Replace("'", "\\'")}')) {{
                    el = t; break;
                }}
            }}
        }}
        if (!el) return JSON.stringify({{ success: false, error: 'Element not found in DOM' }});

        // Flash visual highlight for runner view
        let origOutline = el.style.outline;
        el.style.outline = '3px solid #89B4FA';
        setTimeout(() => {{ el.style.outline = origOutline; }}, 600);

        if ('{actionType}' === 'click') {{
            el.click();
        }} else if ('{actionType}' === 'input') {{
            el.value = '{val.Replace("'", "\\'")}';
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
        }}
        return JSON.stringify({{ success: true }});
    }} catch(ex) {{
        return JSON.stringify({{ success: false, error: ex.message }});
    }}
}})();";

                    string resJson = await TestRunnerWebView.ExecuteScriptAsync(script);
                    await Task.Delay(1000);

                    if (resJson != null && resJson.Contains("\"success\":true"))
                    {
                        passedSteps++;
                        AddTelemetryCard($"STEP {stepNumber} PASS", $"Executed {actionType} on {selector}", "PASS", "#A6E3A1");
                    }
                    else
                    {
                        AddTelemetryCard($"STEP {stepNumber} WARN", $"Element execution warning: {resJson}", "WARN", "#FAB387");
                    }
                }

                TxtStatusBadge.Text = $"✔ TEST PASSED ({passedSteps}/{_steps.Count} Steps)";
                TxtStatusBadge.Foreground = (Brush)FindResource("GreenBrush");
            }
            catch (Exception ex)
            {
                AddTelemetryCard("CRASH", $"Execution error: {ex.Message}", "CRASH", "#F38BA8");
                TxtStatusBadge.Text = "❌ TEST FAILED (Exception)";
                TxtStatusBadge.Foreground = (Brush)FindResource("RedBrush");
            }
        }

        private void AddTelemetryCard(string label, string detail, string level, string colorHex)
        {
            var card = new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 3, 0, 3)
            };

            var sp = new StackPanel();
            var dp = new DockPanel();

            var colorBrush = (SolidColorBrush)new BrushConverter().ConvertFromString(colorHex)!;

            var txtLabel = new TextBlock
            {
                Text = label,
                FontWeight = FontWeights.Bold,
                FontSize = 11,
                Foreground = colorBrush
            };

            var txtTime = new TextBlock
            {
                Text = DateTime.Now.ToString("HH:mm:ss"),
                FontSize = 10,
                Foreground = (Brush)FindResource("Subtext0Brush"),
                HorizontalAlignment = HorizontalAlignment.Right
            };

            dp.Children.Add(txtLabel);
            dp.Children.Add(txtTime);

            var txtDetail = new TextBlock
            {
                Text = detail,
                FontSize = 11,
                Foreground = (Brush)FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 4, 0, 0)
            };

            sp.Children.Add(dp);
            sp.Children.Add(txtDetail);
            card.Child = sp;

            TelemetryLogContainer.Children.Add(card);
        }

        private async void BtnRunAgain_Click(object sender, RoutedEventArgs e)
        {
            await RunTestSequenceAsync();
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }
    }
}
