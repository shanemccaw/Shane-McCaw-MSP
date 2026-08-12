using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    public partial class AutomationRunnerWindow : Window
    {
        private readonly string _targetUrl;
        private readonly List<Controls.AutomationAction> _steps;
        private readonly UiTestExecutor _executor;

        /// <summary>Git #809 — the popup is now a thin UI shell over UiTestExecutor. #810's Test Results
        /// tab drives the same executor directly once it lands and retires this window; until then,
        /// this event lets manifest-driven runs (MainWindow.RunManifestAsync) observe the structured
        /// result without the output being hard-wired to the popup.</summary>
        public event EventHandler<UiTestRunResult>? RunCompleted;

        public AutomationRunnerWindow(string targetUrl, List<Controls.AutomationAction> steps)
        {
            InitializeComponent();
            _targetUrl = string.IsNullOrWhiteSpace(targetUrl) ? "https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/" : targetUrl;
            _steps = new List<Controls.AutomationAction>(steps);

            _executor = new UiTestExecutor(TestRunnerWebView);
            _executor.Telemetry += (s, e) => AddTelemetryCard(e.Label, e.Detail, e.Level, e.ColorHex);

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

            var result = await _executor.RunAsync(_targetUrl, _steps);

            TxtStatusBadge.Text = result.StatusText;
            TxtStatusBadge.Foreground = (Brush)FindResource(result.Success ? "GreenBrush" : "RedBrush");
            RunCompleted?.Invoke(this, result);
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
