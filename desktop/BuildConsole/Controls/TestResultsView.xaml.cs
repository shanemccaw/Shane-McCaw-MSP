using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #810 (Epic #803 Phase 6) — bottom panel "Test Results" tab, sibling to Build Log/
    /// Terminal/SQL Runner/Output in MainWindow.xaml's BottomTabs. Streams live telemetry cards
    /// (PASS/WARN/CRASH/status badge) consolidated across the UI (#809 UiTestExecutor), API
    /// (#807 HttpTestExecutor) and Graph (#808 GraphTestExecutor) executors during a run, reusing
    /// the existing telemetry card visual pattern from AutomationRunnerWindow.xaml.cs's
    /// AddTelemetryCard. Retires that standalone popup entirely — RunnerWebView here is the one
    /// WebView2 instance driving UiTestExecutor for uiSteps now (both the Automation sidebar's
    /// manual Play button and RunManifestAsync's manifest-driven runs go through this control),
    /// same layout the popup used (telemetry list + WebView2) but embedded in-tab instead of a
    /// separate window.
    ///
    /// Logging channel: "testing.results-panel" via ActivityLog.Log — this WPF app's established
    /// equivalent of a module-level logger.child({ channel }) binding (no Node logger exists in
    /// this process; see the sibling "testing.api-executor"/"testing.graph-executor"/
    /// "testing.ui-executor" channels the #807/#808/#809 executors already use).
    /// </summary>
    public partial class TestResultsView : UserControl
    {
        private const string Channel = "testing.results-panel";

        private int _passCount;
        private int _warnCount;
        private int _crashCount;

        public TestResultsView()
        {
            InitializeComponent();

            // Git #810 — API/Graph steps stream live, one card per completed test, instead of
            // only appearing after the whole manifest finishes. Subscribed once for the app's
            // lifetime since HttpTestExecutor/GraphTestExecutor are static classes with static
            // events, and only one TestResultsView instance is ever declared (MainWindow.xaml).
            Services.HttpTestExecutor.StepCompleted += OnStepCompleted;
            Services.GraphTestExecutor.StepCompleted += OnStepCompleted;
        }

        private void OnStepCompleted(Services.TestStepResult result) => AddStepResult(result);

        /// <summary>Called at the start of a manifest run (RunManifestAsync) to reset the panel and label the current run.</summary>
        public void BeginRun(int issue, string feature, string mode)
        {
            RunOnUi(() =>
            {
                TxtRunLabel.Text = $"#{issue} — {feature} ({mode})";
                SetStatus("● RUNNING...", "PeachBrush");
                Services.ActivityLog.Log(Channel, $"Run started: issue #{issue} ({feature}), mode={mode}.");
            });
        }

        /// <summary>Called once RunManifestAsync's whole manifest (apiTests + graphTests + uiSteps) has finished.</summary>
        public void CompleteRun(Services.ManifestRunResult result)
        {
            RunOnUi(() =>
            {
                int total = result.Steps.Count;
                int passed = result.Steps.Count(s => s.Passed);
                SetStatus(result.AllPassed ? $"✔ ALL PASSED ({passed}/{total})" : $"⚠ {passed}/{total} PASSED",
                    result.AllPassed ? "GreenBrush" : "RedBrush");
                Services.ActivityLog.Log(Channel, $"Run complete for issue #{result.Issue}: {passed}/{total} steps passed.");
            });
        }

        /// <summary>Runs a manifest's uiSteps directly through UiTestExecutor against this panel's own WebView2 — the replacement for AutomationRunnerWindow's popup + independent WebView2, used by both the Automation sidebar's manual Play button and RunManifestAsync.</summary>
        public async Task<Services.UiTestRunResult> RunUiTestAsync(string targetUrl, List<AutomationAction> steps)
        {
            var executor = new Services.UiTestExecutor(RunnerWebView);
            EventHandler<Services.UiTelemetryEvent> onTelemetry = (s, e) => AddCard(e.Label, e.Detail, e.Level, e.ColorHex);
            executor.Telemetry += onTelemetry;
            try
            {
                var result = await executor.RunAsync(targetUrl, steps);
                return result;
            }
            finally
            {
                executor.Telemetry -= onTelemetry;
            }
        }

        /// <summary>Folds a completed apiTest/graphTest TestStepResult into the same card stream uiSteps' Telemetry events feed — the "consolidated across UI/API/Graph" view #810 asks for.</summary>
        public void AddStepResult(Services.TestStepResult result)
        {
            string kindTag = result.Kind.ToUpperInvariant();
            string level = result.Passed ? "PASS" : "WARN";
            string colorHex = result.Passed ? "#A6E3A1" : "#FAB387";
            AddCard($"[{kindTag}] {level}", $"{result.Label} ({result.DurationMs}ms) — {result.Detail}", level, colorHex);
        }

        public void AddCard(string label, string detail, string level, string colorHex)
        {
            RunOnUi(() =>
            {
                switch (level)
                {
                    case "PASS": _passCount++; break;
                    case "WARN": _warnCount++; break;
                    case "CRASH":
                    case "ERROR": _crashCount++; break;
                }
                TxtSummary.Text = $"{_passCount} pass / {_warnCount} warn / {_crashCount} crash";

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
                TelemetryScroller.ScrollToEnd();
            });
        }

        public void Clear()
        {
            RunOnUi(() =>
            {
                TelemetryLogContainer.Children.Clear();
                _passCount = 0;
                _warnCount = 0;
                _crashCount = 0;
                TxtSummary.Text = "0 pass / 0 warn / 0 crash";
                SetStatus("● IDLE", "Subtext0Brush");
                TxtRunLabel.Text = "No run yet — Load Manifest, then Menu > Run, in the Automation sidebar.";
            });
        }

        private void SetStatus(string text, string brushKey)
        {
            TxtStatusBadge.Text = text;
            TxtStatusBadge.Foreground = (Brush)FindResource(brushKey);
        }

        private void BtnClear_Click(object sender, RoutedEventArgs e) => Clear();

        /// <summary>HttpTestExecutor/GraphTestExecutor's StepCompleted normally resumes on the UI thread already (the RunManifestAsync await chain is kicked off from a UI-thread event handler), but this guards the same way ActivityLog.Log does in case any caller ever awaits with a captured background context.</summary>
        private void RunOnUi(Action action)
        {
            if (Dispatcher.CheckAccess()) action();
            else Dispatcher.BeginInvoke(action);
        }
    }
}
