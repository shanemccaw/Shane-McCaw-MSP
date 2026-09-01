using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace BuildConsole
{
    public enum StepStatus { Pending, Running, Pass, Fail }

    /// <summary>One row in TestRunnerWindow's left step-list panel — one per manifest apiTests/graphTests/uiSteps entry, in execution order, live-updated as the run progresses.</summary>
    public class StepListItem : INotifyPropertyChanged
    {
        private static readonly SolidColorBrush PendingBrush = Frozen(0xBA, 0xC2, 0xDE);
        private static readonly SolidColorBrush RunningBrush = Frozen(0xFA, 0xB3, 0x87);
        private static readonly SolidColorBrush PassBrush = Frozen(0xA6, 0xE3, 0xA1);
        private static readonly SolidColorBrush FailBrush = Frozen(0xF3, 0x8B, 0xA8);

        private static SolidColorBrush Frozen(byte r, byte g, byte b)
        {
            var brush = new SolidColorBrush(Color.FromRgb(r, g, b));
            brush.Freeze();
            return brush;
        }

        public string Kind { get; set; } = string.Empty;
        public string Label { get; set; } = string.Empty;

        private StepStatus _status = StepStatus.Pending;
        public StepStatus Status
        {
            get => _status;
            set
            {
                if (_status == value) return;
                _status = value;
                if (_status == StepStatus.Running)
                    _sw.Restart();
                else
                    _sw.Stop();
                OnPropertyChanged(nameof(Status));
                OnPropertyChanged(nameof(StatusGlyph));
                OnPropertyChanged(nameof(StatusBrush));
                OnPropertyChanged(nameof(ElapsedText));
            }
        }

        private readonly Stopwatch _sw = new();

        /// <summary>Elapsed wall-clock seconds for the current step while Running; empty once done.</summary>
        public string ElapsedText
        {
            get
            {
                if (Status != StepStatus.Running || !_sw.IsRunning) return string.Empty;
                long s = _sw.ElapsedMilliseconds / 1000;
                return s == 0 ? string.Empty : $" ({s}s)";
            }
        }

        /// <summary>Refreshes the ElapsedText binding — called by the window's 1-second DispatcherTimer.</summary>
        public void TickElapsed() => OnPropertyChanged(nameof(ElapsedText));

        public string StatusGlyph => Status switch
        {
            StepStatus.Running => "◐",
            StepStatus.Pass => "✔",
            StepStatus.Fail => "✖",
            _ => "○",
        };

        public Brush StatusBrush => Status switch
        {
            StepStatus.Running => RunningBrush,
            StepStatus.Pass => PassBrush,
            StepStatus.Fail => FailBrush,
            _ => PendingBrush,
        };

        public event PropertyChangedEventHandler? PropertyChanged;
        private void OnPropertyChanged(string name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }

    /// <summary>
    /// Git #857 (Epic #803): dedicated large window replacing the bottom "Test Results" tab
    /// (#810) entirely. Left panel is a dynamic step list built from whatever the loaded
    /// manifest actually contains (apiTests/graphTests/uiSteps, in execution order); center
    /// is the live UI run WebView2 (RunnerWebView, relocated here unchanged); right is the
    /// same telemetry/results card stream TestResultsView used, also relocated unchanged.
    /// Reuses HttpTestExecutor/GraphTestExecutor/UiTestExecutor/MainWindow.RunManifestAsync
    /// as-is — this is a layout relocation, not new test-running logic.
    ///
    /// Logging channel: "testing.results-panel" via ActivityLog.Log, same channel
    /// TestResultsView used before being retired by this window.
    /// </summary>
    public partial class TestRunnerWindow : Window
    {
        private const string Channel = "testing.results-panel";
        private static readonly Regex UiStepDonePattern = new(@"^STEP (\d+) (PASS|WARN)$", RegexOptions.Compiled);

        private int _passCount;
        private int _warnCount;
        private int _crashCount;

        private readonly ObservableCollection<StepListItem> _steps = new();
        private readonly ICollectionView _stepsView;
        private int _stepCursor;

        // Live elapsed-time ticker — 1s DispatcherTimer refreshes the Running step's ElapsedText
        // and the "Waiting on..." line in the header, so Shane sees live seconds during long steps.
        private readonly DispatcherTimer _elapsedTimer;
        private readonly Stopwatch _stepSw = new();

        // Git #966 — the last run's captured screenshots, handed to the on-demand review gallery
        // (ScreenshotGalleryWindow) when Shane clicks "📷 Screenshots". Kept here only to enable/disable
        // the button and show the count; the click-through UI lives in that separate real Window now (so
        // it renders above the Live UI Test View WebView2, not behind it — the WPF airspace problem).
        private readonly List<Services.UiScreenshotCapture> _galleryShots = new();

        // Retry button — the last manifest SetSteps was called with, so "🔄 Retry" can re-run it without
        // Shane re-selecting anything. TestRunnerWindow doesn't otherwise hold a manifest reference (that
        // lives in MainWindow's RunManifestAsync orchestration, per #989); retained here rather than
        // threaded through as a param since SetSteps is already the one call every manifest run makes into
        // this window before BeginRun.
        private Services.TestManifest? _lastManifest;
        private Services.TargetEnvironment _lastRunTargetEnv = Services.TargetEnvironment.Dev;

        /// <summary>Fired when Shane clicks "🔄 Retry" — mirrors LeftSidebar's PlayTestRequested pattern.
        /// MainWindow subscribes in EnsureTestRunnerWindow and re-enters RunManifestAsync with the same
        /// manifest and target environment.</summary>
        public event EventHandler<(Services.TestManifest Manifest, Services.TargetEnvironment TargetEnv)>? RetryRequested;

        public TestRunnerWindow()
        {
            InitializeComponent();

            RunnerWebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37);

            _stepsView = CollectionViewSource.GetDefaultView(_steps);
            _stepsView.GroupDescriptions.Add(new PropertyGroupDescription(nameof(StepListItem.Kind)));
            StepsList.ItemsSource = _stepsView;

            // 1-second ticker — refreshes the Running step's elapsed text and the live
            // "Waiting on..." header line so Shane sees how long a step has been in flight.
            _elapsedTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _elapsedTimer.Tick += (_, _) =>
            {
                foreach (var s in _steps)
                    if (s.Status == StepStatus.Running)
                        s.TickElapsed();

                // Update the header "Waiting on..." line
                var running = _steps.FirstOrDefault(s => s.Status == StepStatus.Running);
                if (running != null && TxtCurrentStep != null)
                {
                    long secs = _stepSw.ElapsedMilliseconds / 1000;
                    TxtCurrentStep.Text = $"⏱ {running.Label}  ({secs}s)";
                    TxtCurrentStep.Visibility = Visibility.Visible;
                }
                else if (TxtCurrentStep != null)
                {
                    TxtCurrentStep.Visibility = Visibility.Collapsed;
                }
            };

            // Git #810's original reasoning: these executors' StepCompleted events are static
            // (module-lifetime), so a live card stream needs exactly one subscription per open
            // window instance, unsubscribed on Closed — otherwise a closed-then-reopened window
            // would leave a stale handler still firing into a disposed WebView2/collection.
            Services.HttpTestExecutor.StepCompleted += OnStepCompleted;
            Services.GraphTestExecutor.StepCompleted += OnStepCompleted;
            Services.ZohoTestExecutor.StepCompleted += OnStepCompleted;
            Services.PowerShellTestExecutor.StepCompleted += OnStepCompleted;
            // Epic #803 — uiSteps now fire the same static StepCompleted as the other four (previously they
            // advanced only via the UiStepDonePattern telemetry match in RunUiTestAsync, which is now removed
            // so the shared cursor isn't double-advanced — OnStepCompleted is the single advance path).
            Services.UiTestExecutor.StepCompleted += OnStepCompleted;
            Closed += (_, _) =>
            {
                _elapsedTimer.Stop();
                Services.HttpTestExecutor.StepCompleted -= OnStepCompleted;
                Services.GraphTestExecutor.StepCompleted -= OnStepCompleted;
                Services.ZohoTestExecutor.StepCompleted -= OnStepCompleted;
                Services.PowerShellTestExecutor.StepCompleted -= OnStepCompleted;
                Services.UiTestExecutor.StepCompleted -= OnStepCompleted;
            };
        }

        // ── Git #1006: custom title bar caption buttons (same pattern as MainWindow, Git #894) ──
        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            Services.WindowChromeHelper.Setup(this);
        }

        private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

        private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e) =>
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        private void Window_StateChanged(object sender, EventArgs e)
        {
            bool maximized = WindowState == WindowState.Maximized;
            BtnMaximizeRestoreIcon.Text = maximized ? "" : "";
            BtnMaximizeRestore.ToolTip = maximized ? "Restore Down" : "Maximize";
        }

        // ── Non-intrusive run lifecycle ─────────────────────────────────────────────
        // Shane: "Unless there is an error or drift I need to see, the test window should auto close when
        // done. Also tests should never interrupt me — run minimized and only give me a toast when they
        // need my attention." The window used to open maximized (WindowState="Maximized") and MainWindow
        // Activate()'d it on every run, so a routine test grabbed his main screen. Now every run (Play
        // Test, double-click, shaneapp://runTest, #898 remote — they all funnel through RunManifestAsync)
        // starts the window HIDDEN via PrepareForBackgroundRun, then RunManifestAsync either
        // AutoCloseAfterCleanRun()s it (clean) or leaves it and toasts (needs attention).

        // "Hidden" here is parked-off-screen, NOT minimized: a minimized (or occluded) WebView2 can't be
        // screenshotted — CoreWebView2.CapturePreviewAsync never completes in that state, so uiStep captures
        // (#966/#977) would all hit UiTestExecutor's 8s ScreenshotTimeoutMs and produce nothing. An off-screen
        // Normal window is still composited by DWM, so the hosted WebView2 renders and captures work, while
        // Shane never sees it. (Opacity/Visibility hiding also breaks WebView2 — #902 — hence off-screen.)

        /// <summary>Puts the window into its hidden background-run state: off-screen, Normal, never
        /// activated. Called by MainWindow.EnsureTestRunnerWindow before every run. If Shane is actively
        /// looking at the window (it's focused — e.g. he just clicked 🔄 Retry inside it), it's left where
        /// it is so he can watch, rather than being yanked off-screen out from under him.</summary>
        public void PrepareForBackgroundRun()
        {
            RunOnUi(() =>
            {
                if (IsActive)
                {
                    Services.ActivityLog.Log(Channel, "Run starting while the Test Runner is focused — keeping it visible so Shane can watch (not backgrounding it).");
                    return;
                }
                if (WindowState != WindowState.Normal) WindowState = WindowState.Normal;
                ParkOffScreen();
            });
        }

        /// <summary>Positions the window just past the right edge of the whole virtual desktop (all
        /// monitors) — guaranteed off every screen, positive coords (no negative-clamp surprises). DWM
        /// still composites it, so WebView2 renders; discoverable via the taskbar / Alt-Tab if needed.</summary>
        private void ParkOffScreen()
        {
            Left = SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth + 200;
            Top = Math.Max(SystemParameters.VirtualScreenTop, 0);
        }

        /// <summary>Auto-closes the window after a genuinely clean run (no failures, no screenshot review
        /// needed). Skipped if Shane is actively viewing it (focused) — don't yank a window closed while
        /// he's reading it. Logged either way on the window's own channel.</summary>
        public void AutoCloseAfterCleanRun()
        {
            RunOnUi(() =>
            {
                if (IsActive)
                {
                    Services.ActivityLog.Log(Channel, "Clean run finished, but the Test Runner is focused (Shane is viewing it) — leaving it open instead of auto-closing.");
                    return;
                }
                Services.ActivityLog.Log(Channel, "Clean run finished (no failures, no screenshot review needed) — auto-closing the Test Runner window.");
                Close();
            });
        }

        /// <summary>Makes the window visible on-screen but WITHOUT stealing focus — used for a regression
        /// SWEEP (isRegression), which drives this one shared window across many manifests in a loop and
        /// has no per-run toast/auto-close, so it must stay watchable and never get orphaned off-screen.
        /// Only re-centres a window that is currently parked off-screen (e.g. left over from a prior
        /// single run); if it's already on-screen it's left exactly where Shane put it, and it is never
        /// activated — so the per-manifest calls in the sweep loop can't cause a focus-steal storm.</summary>
        public void EnsureOnScreenBackground()
        {
            RunOnUi(() =>
            {
                if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;

                var wa = SystemParameters.WorkArea;
                // NaN Left/Top = a brand-new window not yet positioned → treat as off-screen so it centres.
                bool offScreen = double.IsNaN(Left) || double.IsNaN(Top)
                    || Left >= wa.Right || Top >= wa.Bottom
                    || Left + Width <= wa.Left || Top + Height <= wa.Top;
                if (offScreen)
                {
                    if (Width > wa.Width) Width = wa.Width;
                    if (Height > wa.Height) Height = wa.Height;
                    Left = wa.Left + (wa.Width - Width) / 2;
                    Top = wa.Top + (wa.Height - Height) / 2;
                }
                // Deliberately NO Activate() — visible/watchable, but not focus-stealing.
            });
        }

        /// <summary>Brings the (off-screen / minimized) window back on-screen, centred and focused — the
        /// click-through target for the "run needs attention" toast.</summary>
        public void RestoreToForeground()
        {
            RunOnUi(() =>
            {
                if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;

                var wa = SystemParameters.WorkArea;
                if (Width > wa.Width) Width = wa.Width;
                if (Height > wa.Height) Height = wa.Height;
                Left = wa.Left + (wa.Width - Width) / 2;
                Top = wa.Top + (wa.Height - Height) / 2;

                Show();
                Activate();
                // Pop above other windows without staying pinned there.
                Topmost = true;
                Topmost = false;
            });
        }

        private void OnStepCompleted(Services.TestStepResult result)
        {
            AddStepResult(result);
            RunOnUi(() => AdvanceStep(result.Passed));
        }

        /// <summary>Builds the left step list from a loaded manifest — apiTests, then graphTests, then postGraphApiTests (#879), then zohoTests (#881), then uiSteps, matching RunManifestAsync's real execution order. Only kinds actually present in the manifest appear.</summary>
        public void SetSteps(Services.TestManifest manifest)
        {
            RunOnUi(() =>
            {
                _lastManifest = manifest;

                _steps.Clear();
                _stepCursor = 0;

                foreach (var test in manifest.ApiTests)
                    _steps.Add(new StepListItem { Kind = "API TESTS", Label = DescribeHttpTest(test) });

                foreach (var test in manifest.GraphTests)
                    _steps.Add(new StepListItem { Kind = "GRAPH TESTS", Label = DescribeHttpTest(test) });

                // Git #879 — postGraphApiTests render between graphTests and zohoTests, matching
                // RunManifestAsync's real execution order (they run after the mail-poll extract).
                foreach (var test in manifest.PostGraphApiTests)
                    _steps.Add(new StepListItem { Kind = "API TESTS", Label = DescribeHttpTest(test) });

                foreach (var test in manifest.ZohoTests)
                    _steps.Add(new StepListItem { Kind = "ZOHO TESTS", Label = DescribeHttpTest(test) });

                foreach (var step in manifest.UiSteps)
                    _steps.Add(new StepListItem { Kind = "UI STEPS", Label = $"{step.Action} {step.Selector ?? step.Target ?? string.Empty}" });

                // Git #900 — powerShellVerify rows render LAST, matching RunManifestAsync's real
                // execution order (they run after every other step has captured its values).
                foreach (var step in manifest.PowerShellVerify)
                    _steps.Add(new StepListItem { Kind = "POWERSHELL VERIFY", Label = DescribePowerShellVerify(step) });

                TxtNoSteps.Visibility = _steps.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
                SetUiStepsPresence(manifest.UiSteps.Count > 0);

                if (_steps.Count > 0)
                    _steps[0].Status = StepStatus.Running;
            });
        }

        /// <summary>Manual "Play" button path (Automation sidebar) — a single ad-hoc uiSteps-only run with no apiTests/graphTests, so the step list is built straight from the recorded/loaded actions instead of a manifest.</summary>
        public void SetStepsFromActions(List<BuildConsole.Controls.AutomationAction> actions)
        {
            RunOnUi(() =>
            {
                _steps.Clear();
                _stepCursor = 0;

                foreach (var action in actions)
                    _steps.Add(new StepListItem { Kind = "UI STEPS", Label = $"{action.ActionTypeUpper} {action.Selector}" });

                TxtNoSteps.Visibility = _steps.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
                SetUiStepsPresence(true);

                if (_steps.Count > 0)
                    _steps[0].Status = StepStatus.Running;
            });
        }

        private void SetUiStepsPresence(bool hasUiSteps)
        {
            TxtNoUiSteps.Visibility = hasUiSteps ? Visibility.Collapsed : Visibility.Visible;
            RunnerWebView.Visibility = hasUiSteps ? Visibility.Visible : Visibility.Collapsed;
        }

        private static string DescribeHttpTest(JsonElement test)
        {
            string method = test.TryGetProperty("method", out var m) ? (m.GetString() ?? "GET") : "GET";
            string path = test.TryGetProperty("path", out var p) ? (p.GetString() ?? "") : "";
            return $"{method} {path}";
        }

        /// <summary>Git #900 — one powerShellVerify row's label: the captured variable it verifies plus a short cmdlet preview.</summary>
        private static string DescribePowerShellVerify(JsonElement step)
        {
            string afterStep = step.TryGetProperty("afterStep", out var a) ? (a.GetString() ?? "?") : "?";
            string cmdlet = step.TryGetProperty("cmdlet", out var c) ? (c.GetString() ?? "") : "";
            if (cmdlet.Length > 48) cmdlet = cmdlet.Substring(0, 48) + "...";
            return $"verify {afterStep} <- {cmdlet}";
        }

        /// <summary>Marks the step at the current cursor pass/fail, then advances to the next pending step (if any) and marks it running — one shared cursor across api/graph/zoho/ui since they execute strictly in that order.</summary>
        private void AdvanceStep(bool passed)
        {
            if (_stepCursor >= _steps.Count) return;
            _steps[_stepCursor].Status = passed ? StepStatus.Pass : StepStatus.Fail;
            _stepCursor++;
            if (_stepCursor < _steps.Count)
            {
                _steps[_stepCursor].Status = StepStatus.Running;
                _stepSw.Restart(); // reset per-step clock so header shows elapsed for the new step
            }
        }

        /// <summary>Called at the start of a manifest run (RunManifestAsync) to reset the telemetry panel and label the current run.</summary>
        public void BeginRun(int issue, string feature, string mode, Services.TargetEnvironment targetEnv = Services.TargetEnvironment.Dev, int? buildNumber = null)
        {
            _lastRunTargetEnv = targetEnv;
            RunOnUi(() =>
            {
                var titleText = buildNumber.HasValue ? $"Test Runner — Build #{buildNumber.Value}" : "Test Runner";
                Title = titleText;
                if (TxtTitleBar != null) TxtTitleBar.Text = titleText;

                TxtRunLabel.Text = $"#{issue} — {feature} ({mode})";
                if (targetEnv == Services.TargetEnvironment.Dev)
                {
                    TargetEnvBadge.Background = (System.Windows.Media.Brush)FindResource("GreenBrush");
                    TxtTargetEnvBadge.Text = "DEV (LOCAL)";
                    TxtTargetEnvBadge.Foreground = (System.Windows.Media.Brush)FindResource("CrustBrush");
                }
                else if (targetEnv == Services.TargetEnvironment.Staging)
                {
                    TargetEnvBadge.Background = (System.Windows.Media.Brush)FindResource("PeachBrush");
                    TxtTargetEnvBadge.Text = "⚠️ STAGING";
                    TxtTargetEnvBadge.Foreground = (System.Windows.Media.Brush)FindResource("CrustBrush");
                }
                else
                {
                    TargetEnvBadge.Background = (System.Windows.Media.Brush)FindResource("RedBrush");
                    TxtTargetEnvBadge.Text = "🚨 PRODUCTION";
                    TxtTargetEnvBadge.Foreground = (System.Windows.Media.Brush)FindResource("CrustBrush");
                }
                SetStatus("● RUNNING...", "PeachBrush");
                BtnRetry.IsEnabled = false;
                BtnCancel.Visibility = Visibility.Visible;
                _stepSw.Restart();
                _elapsedTimer.Start();
                Services.ActivityLog.Log(Channel, $"Run started: issue #{issue} ({feature}), mode={mode}, targetEnv={targetEnv}.");
            });
        }

        /// <summary>Called once RunManifestAsync's whole manifest (apiTests + graphTests + uiSteps) has finished.</summary>
        public void CompleteRun(Services.ManifestRunResult result)
        {
            RunOnUi(() =>
            {
                int total = result.Steps.Count;
                int passed = result.Steps.Count(s => s.Passed);
                if (result.Cancelled)
                {
                    SetStatus("❌ CANCELLED", "RedBrush");
                }
                else
                {
                    SetStatus(result.AllPassed ? $"✔ ALL PASSED ({passed}/{total})" : $"⚠ {passed}/{total} PASSED",
                        result.AllPassed ? "GreenBrush" : "RedBrush");
                }
                BtnRetry.IsEnabled = _lastManifest != null;
                BtnCancel.Visibility = Visibility.Collapsed;
                _elapsedTimer.Stop();
                _stepSw.Stop();
                if (TxtCurrentStep != null) TxtCurrentStep.Visibility = Visibility.Collapsed;
                Services.ActivityLog.Log(Channel, $"Run complete for issue #{result.Issue}: {passed}/{total} steps passed.");
            });
        }

        /// <summary>Runs a manifest's uiSteps directly through UiTestExecutor against this window's own WebView2 — used by both the Automation sidebar's manual Play button and RunManifestAsync.</summary>
        public async Task<Services.UiTestRunResult> RunUiTestAsync(string targetUrl, List<BuildConsole.Controls.AutomationAction> steps, Services.TestRunVariables? vars = null, Services.ViewportSpec? defaultViewport = null, string? screenshotDir = null, Func<string, string>? originResolver = null)
        {
            // Git #966 — the manifest path (RunManifestAsync) passes a screenshotDir named for the run
            // (test-results/{issue}-{ts}/screenshots); the manual Play path passes none, so fall back to a
            // per-invocation manual-{timestamp} folder so ad-hoc runs still capture and fill the gallery.
            if (string.IsNullOrWhiteSpace(screenshotDir))
            {
                string? repoRoot = Services.BuildTrackerConfig.FindRepoRoot();
                if (repoRoot != null)
                    screenshotDir = System.IO.Path.Combine(repoRoot, "test-results", $"manual-{DateTime.Now:yyyyMMddHHmmss}", "screenshots");
            }

            var executor = new Services.UiTestExecutor(RunnerWebView);
            EventHandler<Services.UiTelemetryEvent> onTelemetry = (s, e) =>
            {
                // Epic #803 — the per-step PASS/WARN summary and the step-cursor advance now arrive as a
                // structured TestStepResult via UiTestExecutor.StepCompleted (OnStepCompleted → AddStepResult +
                // AdvanceStep), exactly like the other four executors. So skip re-carding the raw
                // "STEP N PASS/WARN" telemetry line (StepCompleted's card supersedes it) and do NOT advance the
                // cursor here — advancing in both places would double-step the shared cursor. Every other
                // telemetry line (START/NAV/RUNNING/CAPTURE/VIEWPORT/SHOT) still streams as a live card.
                if (UiStepDonePattern.IsMatch(e.Label)) return;
                AddCard(e.Label, e.Detail, e.Level, e.ColorHex);
            };
            executor.Telemetry += onTelemetry;
            try
            {
                // Git #877 — thread the per-run variable store so uiSteps can resolve {{name}}
                // placeholders and extract into the same dictionary the api/graph executors share.
                var result = await executor.RunAsync(targetUrl, steps, vars, defaultViewport, screenshotDir, originResolver);
                // Git #966 — hand this run's captured screenshots to the review gallery.
                SetGalleryScreenshots(result.Screenshots);
                return result;
            }
            finally
            {
                executor.Telemetry -= onTelemetry;
            }
        }

        /// <summary>Folds a completed apiTest/graphTest TestStepResult into the same card stream uiSteps' Telemetry events feed — the "consolidated across UI/API/Graph" view #810 built and this window keeps.</summary>
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

                // Git #869 — same card stream, appended as flat text into the bottom console
                // panel instead of building a second telemetry pipeline.
                ConsoleOutputBox.AppendText($"[{txtTime.Text}] {label} — {detail}{Environment.NewLine}");
                ConsoleOutputBox.ScrollToEnd();
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
                TxtRunLabel.Text = "No run yet.";

                _steps.Clear();
                _stepCursor = 0;
                TxtNoSteps.Visibility = Visibility.Visible;
                SetUiStepsPresence(false);

                ConsoleOutputBox.Clear();

                // Git #966 — a fresh run resets the review gallery (screenshots get re-populated once the
                // run captures any). Note SetGalleryScreenshots is called at run END with the new set, so
                // clearing here only affects the pre-run/idle state. Any open ScreenshotGalleryWindow is a
                // separate Window and stays as-is — this only disables the button until the next run.
                _galleryShots.Clear();
                BtnScreenshots.IsEnabled = false;
                BtnScreenshots.Content = "📷 Screenshots";
                BtnCancel.Visibility = Visibility.Collapsed;
                _elapsedTimer.Stop();
                _stepSw.Stop();
                if (TxtCurrentStep != null) TxtCurrentStep.Visibility = Visibility.Collapsed;
            });
        }

        // ── Git #966: screenshot review gallery ──────────────────────────────────
        // A simple on-demand click-through of the last run's captured WebView2 screenshots (with #977
        // always-on capture, one per uiStep). Deliberately capture + human review only — no automated
        // pixel-diffing (fragile against font rendering / anti-aliasing / live dates & data). That is a
        // separate concern owned by #975's ScreenshotReviewWindow, a CONDITIONAL baseline-diff approval
        // gate (auto-shown only on a missing baseline / real diff, with Approve→set-baseline+close-issue).
        // This gallery is the always-available browse for ANY run, incl. a clean one that matches baseline
        // (which the review gate deliberately shows nothing for) — so the two are kept distinct, not fused.
        // The click-through UI is now a real top-level Window (ScreenshotGalleryWindow) rather than an
        // in-window overlay Grid, so it renders ABOVE the Live UI Test View's hosted WebView2 instead of
        // behind it (the WPF+WebView2 airspace problem, which no Z-order on a hosted control can beat).

        /// <summary>Replaces the gallery's contents with a completed run's captured screenshots and enables the
        /// "📷 Screenshots" button (showing the count) when there's at least one. Safe to call from any thread.</summary>
        public void SetGalleryScreenshots(IEnumerable<Services.UiScreenshotCapture> shots)
        {
            RunOnUi(() =>
            {
                _galleryShots.Clear();
                _galleryShots.AddRange(shots);

                bool any = _galleryShots.Count > 0;
                BtnScreenshots.IsEnabled = any;
                BtnScreenshots.Content = any ? $"📷 Screenshots ({_galleryShots.Count})" : "📷 Screenshots";

                Services.ActivityLog.Log(Channel, $"Screenshot gallery ready: {_galleryShots.Count} screenshot(s) from the last run.");
            });
        }

        private void BtnScreenshots_Click(object sender, RoutedEventArgs e)
        {
            if (_galleryShots.Count == 0) return;
            // A separate real Window (not ShowDialog) so Shane can keep clicking through the last run's
            // screenshots while the Test Runner stays live behind it — and, being its own HWND, it renders
            // above the center WebView2 that the old overlay Grid was stuck behind.
            var gallery = new ScreenshotGalleryWindow(_galleryShots) { Owner = this };
            gallery.Show();
        }

        /// <summary>Git #869 — copies the full accumulated console text in one click, for pasting into a Claude Code prompt to diagnose a failure.</summary>
        private void BtnCopyConsole_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrEmpty(ConsoleOutputBox.Text)) return;
            Clipboard.SetText(ConsoleOutputBox.Text);
        }

        private void SetStatus(string text, string brushKey)
        {
            TxtStatusBadge.Text = text;
            TxtStatusBadge.Foreground = (Brush)FindResource(brushKey);
        }

        private void BtnClear_Click(object sender, RoutedEventArgs e) => Clear();

        private void BtnEditTest_Click(object sender, RoutedEventArgs e)
        {
            if (_lastManifest != null)
            {
                var viewer = new ManifestViewerWindow(_lastManifest, showChartFirst: false) { Owner = this };
                viewer.Show();
                return;
            }

            // Fallback: if no manifest is currently loaded, allow picking one to view/edit
            var repoRoot = AppDomain.CurrentDomain.BaseDirectory;
            var testManifestsDir = System.IO.Path.Combine(repoRoot, "test-manifests");
            if (!System.IO.Directory.Exists(testManifestsDir))
            {
                var parent = System.IO.Directory.GetParent(repoRoot)?.Parent?.Parent?.Parent?.FullName;
                if (parent != null && System.IO.Directory.Exists(System.IO.Path.Combine(parent, "test-manifests")))
                    testManifestsDir = System.IO.Path.Combine(parent, "test-manifests");
            }

            var ofd = new Microsoft.Win32.OpenFileDialog
            {
                Title = "Select Test Manifest to Edit",
                Filter = "Test Manifests (*.json)|*.json|All Files (*.*)|*.*",
                InitialDirectory = System.IO.Directory.Exists(testManifestsDir) ? testManifestsDir : repoRoot
            };

            if (ofd.ShowDialog() == true)
            {
                try
                {
                    var manifest = Services.TestManifest.LoadFromFile(ofd.FileName);
                    if (manifest == null)
                    {
                        AppDialog.Alert(this, "Failed to load manifest: file did not deserialize to a valid manifest.", "Error", AppDialogIcon.Error);
                        return;
                    }
                    var viewer = new ManifestViewerWindow(manifest, showChartFirst: false) { Owner = this };
                    viewer.Show();
                }
                catch (Exception ex)
                {
                    AppDialog.Alert(this, $"Failed to load manifest: {ex.Message}", "Error", AppDialogIcon.Error);
                }
            }
        }

        private void StepsList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
        {
            if (_lastManifest != null)
            {
                var viewer = new ManifestViewerWindow(_lastManifest, showChartFirst: false) { Owner = this };
                viewer.Show();
            }
        }

        private void BtnRetry_Click(object sender, RoutedEventArgs e)
        {
            if (_lastManifest == null) return;
            Services.ActivityLog.Log(Channel, $"Retry triggered for issue #{_lastManifest.Issue} ({_lastManifest.Feature}) against {_lastRunTargetEnv}.");
            RetryRequested?.Invoke(this, (_lastManifest, _lastRunTargetEnv));
        }

        private void BtnCancel_Click(object sender, RoutedEventArgs e)
        {
            Services.TestQueueService.Instance.CancelActiveRun();
        }

        /// <summary>HttpTestExecutor/GraphTestExecutor's StepCompleted normally resumes on the UI thread already (the RunManifestAsync await chain is kicked off from a UI-thread event handler), but this guards the same way ActivityLog.Log does in case any caller ever awaits with a captured background context.</summary>
        private void RunOnUi(Action action)
        {
            if (Dispatcher.CheckAccess()) action();
            else Dispatcher.BeginInvoke(action);
        }
    }
}
