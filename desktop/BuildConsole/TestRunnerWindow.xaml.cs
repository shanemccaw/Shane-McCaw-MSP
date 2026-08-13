using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Media.Imaging;

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
                OnPropertyChanged(nameof(Status));
                OnPropertyChanged(nameof(StatusGlyph));
                OnPropertyChanged(nameof(StatusBrush));
            }
        }

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

        // Git #966 — screenshot review gallery state: the last run's captured screenshots and the
        // currently-displayed index. Human review only — no automated diffing.
        private readonly List<Services.UiScreenshotCapture> _galleryShots = new();
        private int _galleryIndex;

        public TestRunnerWindow()
        {
            InitializeComponent();

            _stepsView = CollectionViewSource.GetDefaultView(_steps);
            _stepsView.GroupDescriptions.Add(new PropertyGroupDescription(nameof(StepListItem.Kind)));
            StepsList.ItemsSource = _stepsView;

            // Git #810's original reasoning: these executors' StepCompleted events are static
            // (module-lifetime), so a live card stream needs exactly one subscription per open
            // window instance, unsubscribed on Closed — otherwise a closed-then-reopened window
            // would leave a stale handler still firing into a disposed WebView2/collection.
            Services.HttpTestExecutor.StepCompleted += OnStepCompleted;
            Services.GraphTestExecutor.StepCompleted += OnStepCompleted;
            Services.ZohoTestExecutor.StepCompleted += OnStepCompleted;
            Services.PowerShellTestExecutor.StepCompleted += OnStepCompleted;
            Closed += (_, _) =>
            {
                Services.HttpTestExecutor.StepCompleted -= OnStepCompleted;
                Services.GraphTestExecutor.StepCompleted -= OnStepCompleted;
                Services.ZohoTestExecutor.StepCompleted -= OnStepCompleted;
                Services.PowerShellTestExecutor.StepCompleted -= OnStepCompleted;
            };
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
                _steps[_stepCursor].Status = StepStatus.Running;
        }

        /// <summary>Called at the start of a manifest run (RunManifestAsync) to reset the telemetry panel and label the current run.</summary>
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

        /// <summary>Runs a manifest's uiSteps directly through UiTestExecutor against this window's own WebView2 — used by both the Automation sidebar's manual Play button and RunManifestAsync.</summary>
        public async Task<Services.UiTestRunResult> RunUiTestAsync(string targetUrl, List<BuildConsole.Controls.AutomationAction> steps, Services.TestRunVariables? vars = null, Services.ViewportSpec? defaultViewport = null, string? screenshotDir = null)
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
                AddCard(e.Label, e.Detail, e.Level, e.ColorHex);

                var doneMatch = UiStepDonePattern.Match(e.Label);
                if (doneMatch.Success)
                    RunOnUi(() => AdvanceStep(e.Level == "PASS"));
            };
            executor.Telemetry += onTelemetry;
            try
            {
                // Git #877 — thread the per-run variable store so uiSteps can resolve {{name}}
                // placeholders and extract into the same dictionary the api/graph executors share.
                var result = await executor.RunAsync(targetUrl, steps, vars, defaultViewport, screenshotDir);
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
                // clearing here only affects the pre-run/idle state.
                GalleryOverlay.Visibility = Visibility.Collapsed;
                _galleryShots.Clear();
                _galleryIndex = 0;
                BtnScreenshots.IsEnabled = false;
                BtnScreenshots.Content = "📷 Screenshots";
            });
        }

        // ── Git #966: screenshot review gallery ──────────────────────────────────
        // A simple click-through of the last run's captured WebView2 screenshots (failures + explicit
        // "screenshot": true steps). Deliberately capture + human review only — no automated pixel-diffing,
        // which is fragile against font rendering / anti-aliasing / live dates & data.

        /// <summary>Replaces the gallery's contents with a completed run's captured screenshots and enables the
        /// "📷 Screenshots" button (showing the count) when there's at least one. Safe to call from any thread.</summary>
        public void SetGalleryScreenshots(IEnumerable<Services.UiScreenshotCapture> shots)
        {
            RunOnUi(() =>
            {
                _galleryShots.Clear();
                _galleryShots.AddRange(shots);
                _galleryIndex = 0;

                bool any = _galleryShots.Count > 0;
                BtnScreenshots.IsEnabled = any;
                BtnScreenshots.Content = any ? $"📷 Screenshots ({_galleryShots.Count})" : "📷 Screenshots";

                Services.ActivityLog.Log(Channel, $"Screenshot gallery ready: {_galleryShots.Count} screenshot(s) from the last run.");
            });
        }

        private void BtnScreenshots_Click(object sender, RoutedEventArgs e)
        {
            if (_galleryShots.Count == 0) return;
            _galleryIndex = 0;
            GalleryOverlay.Visibility = Visibility.Visible;
            ShowGalleryImage();
        }

        private void BtnGalleryClose_Click(object sender, RoutedEventArgs e) => GalleryOverlay.Visibility = Visibility.Collapsed;

        private void BtnGalleryPrev_Click(object sender, RoutedEventArgs e)
        {
            if (_galleryShots.Count == 0) return;
            _galleryIndex = (_galleryIndex - 1 + _galleryShots.Count) % _galleryShots.Count;
            ShowGalleryImage();
        }

        private void BtnGalleryNext_Click(object sender, RoutedEventArgs e)
        {
            if (_galleryShots.Count == 0) return;
            _galleryIndex = (_galleryIndex + 1) % _galleryShots.Count;
            ShowGalleryImage();
        }

        /// <summary>Loads the current screenshot into the gallery Image and updates the counter/caption/path.
        /// Reads the PNG with OnLoad caching so the file handle is released immediately (never locks the file
        /// the executor just wrote). A missing/unreadable file shows a message rather than throwing.</summary>
        private void ShowGalleryImage()
        {
            if (_galleryShots.Count == 0)
            {
                GalleryImage.Source = null;
                TxtGalleryEmpty.Visibility = Visibility.Visible;
                TxtGalleryCounter.Text = "0 / 0";
                TxtGalleryCaption.Text = "";
                TxtGalleryFile.Text = "";
                return;
            }

            if (_galleryIndex < 0 || _galleryIndex >= _galleryShots.Count) _galleryIndex = 0;
            var shot = _galleryShots[_galleryIndex];

            TxtGalleryCounter.Text = $"{_galleryIndex + 1} / {_galleryShots.Count}";
            TxtGalleryCaption.Text = $"Step {shot.StepIndex}: {shot.StepLabel}  —  {shot.Reason}";
            TxtGalleryFile.Text = shot.FilePath;

            try
            {
                if (!System.IO.File.Exists(shot.FilePath))
                {
                    GalleryImage.Source = null;
                    TxtGalleryEmpty.Text = $"Screenshot file not found:\n{shot.FilePath}";
                    TxtGalleryEmpty.Visibility = Visibility.Visible;
                    return;
                }

                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.CreateOptions = BitmapCreateOptions.IgnoreImageCache;
                bmp.UriSource = new Uri(shot.FilePath, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();

                GalleryImage.Source = bmp;
                TxtGalleryEmpty.Visibility = Visibility.Collapsed;
            }
            catch (Exception ex)
            {
                GalleryImage.Source = null;
                TxtGalleryEmpty.Text = $"Couldn't load screenshot:\n{ex.Message}";
                TxtGalleryEmpty.Visibility = Visibility.Visible;
            }
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

        /// <summary>HttpTestExecutor/GraphTestExecutor's StepCompleted normally resumes on the UI thread already (the RunManifestAsync await chain is kicked off from a UI-thread event handler), but this guards the same way ActivityLog.Log does in case any caller ever awaits with a captured background context.</summary>
        private void RunOnUi(Action action)
        {
            if (Dispatcher.CheckAccess()) action();
            else Dispatcher.BeginInvoke(action);
        }
    }
}
