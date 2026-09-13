using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Test Mode state management for MainWindow.
    /// Converts the application into docked Test Mode:
    ///   - Left side: Diagnostics rail (48px collapsed / 300px expanded accordion)
    ///   - Center: Live active WebView2
    ///   - Right side: Composer panel (540px / 420px) with session strip, markdown notes, captures, and bug drawer
    /// </summary>
    public partial class MainWindow
    {
        private bool _isTestMode;
        public bool IsTestMode => _isTestMode;

        private GridLength _savedColActivityBarWidth = new(48);
        private GridLength _savedColSidebarWidth = new(260);
        private GridLength _savedColQueueWidth = new(300);
        private bool _savedQueuePinned = true;
        private Visibility _savedSidebarSplitterVisibility = Visibility.Visible;
        private bool _testModeInitialized;

        /// <summary>Toggle Test Mode on or off.</summary>
        public void ToggleTestMode()
        {
            if (_isTestMode)
                ExitTestMode();
            else
                EnterTestMode();
        }

        private void InitializeTestModePanels()
        {
            if (_testModeInitialized) return;
            _testModeInitialized = true;

            // Diagnostics events
            TestModeDiagnosticsPanel.ExpansionChanged += (expanded) =>
            {
                ColActivityBar.Width = new GridLength(expanded ? 300 : 48);
            };

            TestModeDiagnosticsPanel.AddToReproStepsRequested += (step) =>
            {
                TestModeComposerPanel.AddReproStep(step);
            };

            TestModeDiagnosticsPanel.AddToNotesRequested += (note) =>
            {
                TestModeComposerPanel.AppendNote(note);
            };

            TestModeDiagnosticsPanel.BugSubmittedFromDomInspector += async (comment, element) =>
            {
                string notes = string.IsNullOrWhiteSpace(comment)
                    ? $"DOM Element issue: `{element.Selector}`"
                    : comment;

                var actualSb = new StringBuilder();
                actualSb.AppendLine($"Selector: {element.Selector}");
                actualSb.AppendLine($"Tag: <{element.Tag.ToLowerInvariant()}>");
                actualSb.AppendLine($"Dimensions: {(int)element.Width}×{(int)element.Height} px");
                if (!string.IsNullOrWhiteSpace(element.Classes))
                {
                    actualSb.AppendLine($"Classes: {element.Classes}");
                }
                if (!string.IsNullOrWhiteSpace(element.InnerText))
                {
                    string text = element.InnerText.Trim();
                    if (text.Length > 120) text = text[..117] + "...";
                    actualSb.AppendLine($"Text: \"{text}\"");
                }

                var bug = new BugCardViewModel
                {
                    Severity = "Bug",
                    Notes = notes,
                    Route = TestModeComposerPanel.ActiveRoute,
                    Steps = $"1. Locate and inspect `{element.Selector}`",
                    Actual = actualSb.ToString().TrimEnd(),
                    Tags = new List<string> { "dom-inspector", element.Tag.ToLowerInvariant() }
                };

                // Automatically capture cropped element screenshot and attach to bug report
                var (activeWv, _) = GetActiveEditorTabWebView();
                if (activeWv?.CoreWebView2 != null && element.Width > 0 && element.Height > 0)
                {
                    try
                    {
                        var source = PresentationSource.FromVisual(activeWv);
                        double dpiX = source?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
                        double dpr = element.DevicePixelRatio > 0 ? element.DevicePixelRatio : dpiX;

                        int pad = (int)Math.Round(8 * dpr);
                        int x = (int)Math.Max(0, Math.Round(element.Left * dpr) - pad);
                        int y = (int)Math.Max(0, Math.Round(element.Top * dpr) - pad);
                        int w = (int)Math.Round(element.Width * dpr) + pad * 2;
                        int h = (int)Math.Round(element.Height * dpr) + pad * 2;
                        var cropRect = new Int32Rect(x, y, w, h);

                        string url = activeWv.Source?.ToString() ?? "";
                        string matchedBase = MatchesWatchedVisualTestBaseUrl(url) ?? "localhost:5175";
                        int baseIdx = url.IndexOf(matchedBase, StringComparison.OrdinalIgnoreCase);
                        string pagePath = baseIdx >= 0 ? url.Substring(baseIdx + matchedBase.Length) : activeWv.Source?.PathAndQuery ?? "/";
                        if (string.IsNullOrEmpty(pagePath)) pagePath = "/";

                        var shotResult = await VisualTestTrackerCapture.CaptureRegionAsync(activeWv, matchedBase, pagePath, cropRect);
                        if (shotResult.Success && !string.IsNullOrEmpty(shotResult.FilePath))
                        {
                            bug.Screenshots.Add(shotResult.FilePath);
                            TestModeComposerPanel.StageScreenshot(shotResult.FilePath);
                        }
                    }
                    catch (Exception ex)
                    {
                        BuildConsole.Services.ActivityLog.Log("visual-tracker", $"Auto element screenshot failed: {ex.Message}");
                    }
                }

                TestModeComposerPanel.AddBug(bug);
                ToastEngine.Success("Bug Logged", $"Added bug for <{element.Tag.ToLowerInvariant()}> with element screenshot.");
            };

            TestModeDiagnosticsPanel.ApiHelperRequested += OpenApiHelperForTestMode;

            // Composer events
            TestModeComposerPanel.ToggleWidthRequested += (isWide) =>
            {
                ColQueue.Width = new GridLength(isWide ? 540 : 420);
            };

            TestModeComposerPanel.InspectRequested += () =>
            {
                TestModeDiagnosticsPanel.OpenSection("dom");
            };

            TestModeComposerPanel.DiffRequested += OpenVisualDiffForTestMode;
            TestModeComposerPanel.HistoryRequested += OpenSessionHistoryForTestMode;
            TestModeComposerPanel.ExitTestModeRequested += ExitTestMode;

            TestModeComposerPanel.CaptureFullRequested += async () =>
            {
                await CaptureFullForTestModeAsync();
            };

            TestModeComposerPanel.CaptureRegionRequested += async () =>
            {
                await CaptureRegionForTestModeAsync();
            };

            TestModeComposerPanel.CaptureHudRequested += async () =>
            {
                await CaptureHudForTestModeAsync();
            };

            TestModeComposerPanel.EndSessionSyncRequested += async () =>
            {
                await ExecuteEndSessionSyncAsync();
            };
        }

        /// <summary>
        /// Converts the app into Test Mode:
        /// Left icons replaced with Diagnostics Rail; right panel replaced with 540px Composer Panel.
        /// </summary>
        public void EnterTestMode()
        {
            if (_isTestMode)
            {
                ToastEngine.Warning("Test Mode", "Already in Test Mode. Type \"I'm done\" or press Ctrl+Shift+T to exit.");
                return;
            }

            InitializeTestModePanels();
            _isTestMode = true;

            // 1. Save current workspace layout state
            _savedColActivityBarWidth = ColActivityBar.Width;
            _savedColSidebarWidth = ColSidebar.Width;
            _savedColQueueWidth = ColQueue.Width;
            _savedQueuePinned = _queuePinned;
            _savedSidebarSplitterVisibility = SidebarSplitter.Visibility;

            // 2. Left side: hide normal activity bar and sidebar, show Diagnostics Rail
            ActivityBar.Visibility = Visibility.Collapsed;
            TestModeDiagnosticsPanel.Visibility = Visibility.Visible;
            TestModeDiagnosticsPanel.IsExpanded = false;
            ColActivityBar.Width = new GridLength(48);

            if (ColSidebar.Width.Value > 0)
            {
                ColSidebar.Width = new GridLength(0);
                SidebarSplitter.Visibility = Visibility.Collapsed;
                LeftSidebar.SyncPinState(false);
            }

            // 3. Right side: replace Build Queue with TestModeComposerPanel (540px)
            BuildQueuePanel.Visibility = Visibility.Collapsed;
            TestModeComposerPanel.Visibility = Visibility.Visible;
            ColQueue.Width = new GridLength(540);

            // 4. Update route & attach active WebView2
            UpdateTestModeActiveTab();

            ToastEngine.Success("Test Mode", "Entered Test Mode — Left diagnostics rail, 540px test composer active. (Press Ctrl+Shift+T or click ✕ to exit)");
        }

        /// <summary>
        /// Exits Test Mode and restores workspace layout back to what it was right before entering.
        /// </summary>
        public void ExitTestMode()
        {
            if (!_isTestMode)
            {
                ToastEngine.Warning("Test Mode", "Already in normal mode.");
                return;
            }

            _isTestMode = false;

            // 1. Hide Test Mode panels
            TestModeDiagnosticsPanel.Visibility = Visibility.Collapsed;
            TestModeDiagnosticsPanel.ClearActiveTab();
            TestModeComposerPanel.Visibility = Visibility.Collapsed;

            // 2. Restore left panel icons & sidebar
            ActivityBar.Visibility = Visibility.Visible;
            ColActivityBar.Width = _savedColActivityBarWidth.Value > 0 ? _savedColActivityBarWidth : new GridLength(48);
            ColSidebar.Width = _savedColSidebarWidth.Value > 0 ? _savedColSidebarWidth : new GridLength(0);
            SidebarSplitter.Visibility = _savedSidebarSplitterVisibility;
            LeftSidebar.SyncPinState(ColSidebar.Width.Value > 0);

            // 3. Restore right panel (Build Queue restored)
            BuildQueuePanel.Visibility = Visibility.Visible;
            _queuePinned = _savedQueuePinned;
            ColQueue.Width = _savedColQueueWidth.Value > 0 ? _savedColQueueWidth : new GridLength(DefaultQueueWidth);
            UpdateColQueueWidth();

            ToastEngine.Success("Test Mode", "Exited Test Mode — Workspace restored to previous layout.");
        }

        /// <summary>
        /// Inspects the active editor tab's WebView2 and synchronizes route and telemetry with Test Mode panels.
        /// </summary>
        public void UpdateTestModeActiveTab()
        {
            if (!_isTestMode) return;

            var (activeWv, _) = GetActiveEditorTabWebView();
            if (activeWv?.Source != null)
            {
                string url = activeWv.Source.ToString();
                var matchedBase = MatchesWatchedVisualTestBaseUrl(url);
                string baseUrl = matchedBase ?? (activeWv.Source.Host + (activeWv.Source.Port > 0 ? $":{activeWv.Source.Port}" : ""));
                string pagePath = "";

                if (matchedBase != null)
                {
                    int baseIdx = url.IndexOf(matchedBase, StringComparison.OrdinalIgnoreCase);
                    pagePath = url.Substring(baseIdx + matchedBase.Length);
                }
                else
                {
                    pagePath = activeWv.Source.PathAndQuery;
                }

                if (string.IsNullOrEmpty(pagePath)) pagePath = "/";

                TestModeComposerPanel.SetActiveRoute(pagePath, url);
                TestModeDiagnosticsPanel.AttachWebView(activeWv, baseUrl, pagePath);
            }
            else
            {
                TestModeComposerPanel.SetActiveRoute("No tracked tab active — navigate a watched tab");
                TestModeDiagnosticsPanel.ClearActiveTab();
            }
        }

        private async Task CaptureFullForTestModeAsync()
        {
            var (activeWv, _) = GetActiveEditorTabWebView();
            if (activeWv == null) return;
            string url = activeWv.Source?.ToString() ?? "";
            string matchedBase = MatchesWatchedVisualTestBaseUrl(url) ?? "localhost:5175";
            int baseIdx = url.IndexOf(matchedBase, StringComparison.OrdinalIgnoreCase);
            string pagePath = baseIdx >= 0 ? url.Substring(baseIdx + matchedBase.Length) : activeWv.Source?.PathAndQuery ?? "/";
            if (string.IsNullOrEmpty(pagePath)) pagePath = "/";

            var result = await VisualTestTrackerCapture.CaptureFullPageAsync(activeWv, matchedBase, pagePath);
            if (result.Success && !string.IsNullOrEmpty(result.FilePath))
            {
                TestModeComposerPanel.StageScreenshot(result.FilePath);
                ToastEngine.Success("Screenshot", "Full page captured & staged.");
            }
            else
            {
                ToastEngine.Error("Screenshot", result.Error ?? "Full-page capture failed.");
            }
        }

        private async Task CaptureRegionForTestModeAsync()
        {
            var (activeWv, _) = GetActiveEditorTabWebView();
            if (activeWv == null) return;

            Point topLeft;
            try
            {
                topLeft = activeWv.PointToScreen(new Point(0, 0));
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Capture", $"Could not locate browser: {ex.Message}");
                return;
            }

            var source = PresentationSource.FromVisual(activeWv);
            double dpiX = source?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
            double dpiY = source?.CompositionTarget?.TransformToDevice.M22 ?? 1.0;

            var overlay = new RegionSelectOverlayWindow
            {
                Left = topLeft.X / dpiX,
                Top = topLeft.Y / dpiY,
                Width = activeWv.ActualWidth,
                Height = activeWv.ActualHeight
            };

            bool? drawn = overlay.ShowDialog();
            if (drawn != true) return;

            var rect = overlay.SelectedRect;
            var deviceRect = new Int32Rect(
                (int)Math.Round(rect.X * dpiX),
                (int)Math.Round(rect.Y * dpiY),
                (int)Math.Round(rect.Width * dpiX),
                (int)Math.Round(rect.Height * dpiY));

            string url = activeWv.Source?.ToString() ?? "";
            string matchedBase = MatchesWatchedVisualTestBaseUrl(url) ?? "localhost:5175";
            int baseIdx = url.IndexOf(matchedBase, StringComparison.OrdinalIgnoreCase);
            string pagePath = baseIdx >= 0 ? url.Substring(baseIdx + matchedBase.Length) : activeWv.Source?.PathAndQuery ?? "/";
            if (string.IsNullOrEmpty(pagePath)) pagePath = "/";

            var result = await VisualTestTrackerCapture.CaptureRegionAsync(activeWv, matchedBase, pagePath, deviceRect);
            if (result.Success && !string.IsNullOrEmpty(result.FilePath))
            {
                TestModeComposerPanel.StageScreenshot(result.FilePath);
                ToastEngine.Success("Screenshot", "Region captured & staged.");
            }
            else
            {
                ToastEngine.Error("Screenshot", result.Error ?? "Region capture failed.");
            }
        }

        private async Task CaptureHudForTestModeAsync()
        {
            var (activeWv, _) = GetActiveEditorTabWebView();
            string url = activeWv?.Source?.ToString() ?? "";
            string matchedBase = MatchesWatchedVisualTestBaseUrl(url) ?? "localhost:5175";
            string pagePath = activeWv?.Source?.PathAndQuery ?? "/";

            var result = await VisualTestTrackerCapture.CaptureWpfWindowAsync(this, matchedBase, pagePath);
            if (result.Success && !string.IsNullOrEmpty(result.FilePath))
            {
                TestModeComposerPanel.StageScreenshot(result.FilePath);
                ToastEngine.Success("Screenshot", "Window captured & staged.");
            }
            else
            {
                ToastEngine.Error("Screenshot", result.Error ?? "Window capture failed.");
            }
        }

        private void OpenVisualDiffForTestMode()
        {
            var (activeWv, _) = GetActiveEditorTabWebView();
            string fullUrl = activeWv?.Source?.ToString() ?? "http://localhost:5175";
            string? latestShot = TestModeComposerPanel.StagedScreenshots.LastOrDefault()?.FilePath;
            var diffWin = new VisualDiffWindow(fullUrl, latestShot, (diffResult) =>
            {
                if (diffResult != null)
                {
                    if (!string.IsNullOrEmpty(diffResult.DiffMapSavedPath) && File.Exists(diffResult.DiffMapSavedPath))
                    {
                        TestModeComposerPanel.StageScreenshot(diffResult.DiffMapSavedPath);
                    }
                    if (!string.IsNullOrEmpty(diffResult.Summary))
                    {
                        TestModeComposerPanel.AppendNote(diffResult.Summary);
                    }
                    else
                    {
                        TestModeComposerPanel.AppendNote($"\n**Visual Diff**: {diffResult.DiffPercentage:F1}% difference ({diffResult.MismatchedPixels:N0} px changed).");
                    }
                }
            })
            {
                Owner = this
            };
            diffWin.Show();
        }

        private void OpenApiHelperForTestMode()
        {
            var (activeWv, _) = GetActiveEditorTabWebView();
            string url = activeWv?.Source?.ToString() ?? "";
            string matchedBase = MatchesWatchedVisualTestBaseUrl(url) ?? "localhost:5175";
            int baseIdx = url.IndexOf(matchedBase, StringComparison.OrdinalIgnoreCase);
            string pagePath = baseIdx >= 0 ? url.Substring(baseIdx + matchedBase.Length) : activeWv?.Source?.PathAndQuery ?? "/";

            var apiHelper = new ApiHelperWindow(activeWv, matchedBase, pagePath) { Owner = this };
            apiHelper.Show();
        }

        private void OpenSessionHistoryForTestMode()
        {
            var dlg = new SessionHistoryDialog(LoadBugsFromHistory) { Owner = this };
            dlg.ShowDialog();
        }

        private void LoadBugsFromHistory(List<BugCardViewModel> bugs)
        {
            if (bugs == null || bugs.Count == 0) return;
            foreach (var bug in bugs)
                TestModeComposerPanel.AllBugs.Add(bug);
            TestModeComposerPanel.RefreshBugDrawer();
            TestModeComposerPanel.ShowToast($"Loaded {bugs.Count} bug(s) from history.");
        }

        private async Task ExecuteEndSessionSyncAsync()
        {
            try
            {
                var (activeWv, _) = GetActiveEditorTabWebView();
                string url = activeWv?.Source?.ToString() ?? "";
                var matchedBase = MatchesWatchedVisualTestBaseUrl(url);
                string baseUrl = matchedBase ?? (activeWv?.Source?.Host != null ? (activeWv.Source.Host + (activeWv.Source.Port > 0 ? $":{activeWv.Source.Port}" : "")) : "");
                string pagePath = "";

                if (matchedBase != null && !string.IsNullOrEmpty(url))
                {
                    int baseIdx = url.IndexOf(matchedBase, StringComparison.OrdinalIgnoreCase);
                    pagePath = url.Substring(baseIdx + matchedBase.Length);
                }
                else
                {
                    pagePath = activeWv?.Source?.PathAndQuery ?? (!string.IsNullOrEmpty(TestModeComposerPanel.ActiveRoute) ? TestModeComposerPanel.ActiveRoute : "/");
                }
                if (string.IsNullOrEmpty(pagePath)) pagePath = "/";

                // Collect telemetry snapshot from active webview
                VisualTestTrackerTelemetry.TelemetrySnapshot? telemetry = null;
                if (activeWv != null)
                {
                    try
                    {
                        telemetry = await VisualTestTrackerTelemetry.CollectSnapshotAsync(activeWv);
                    }
                    catch (Exception ex)
                    {
                        ActivityLog.Log("visual-test-tracker", $"Telemetry snapshot warning: {ex.Message}");
                    }
                }

                string productName = VisualTestTrackerExportService.DetectArea(url, pagePath);

                // Convert AllBugs to VisualTestTrackerEntry list
                var entries = new List<VisualTestTrackerEntry>();
                foreach (var bug in TestModeComposerPanel.AllBugs)
                {
                    entries.Add(new VisualTestTrackerEntry
                    {
                        EntryUuid = bug.Id,
                        Severity = bug.Severity,
                        Status = bug.IsResolved ? "Resolved" : "Open",
                        Notes = bug.Notes,
                        PagePath = !string.IsNullOrWhiteSpace(bug.Route) ? bug.Route : pagePath,
                        CurrentUrl = !string.IsNullOrWhiteSpace(url) ? url : bug.Route,
                        StepsToReproduce = bug.Steps,
                        ExpectedBehavior = bug.Expected,
                        ActualBehavior = bug.Actual,
                        Tags = bug.Tags != null ? new List<string>(bug.Tags) : new(),
                        ScreenshotPaths = bug.Screenshots != null ? new List<string>(bug.Screenshots) : new(),
                        CreatedAt = bug.CreatedAt,
                        UpdatedAt = bug.CreatedAt
                    });
                }

                // If composer has unsaved notes, also include as an entry
                string currentNotes = TestModeComposerPanel.CurrentNotes;
                if (!string.IsNullOrWhiteSpace(currentNotes))
                {
                    if (!entries.Any(e => string.Equals(e.Notes, currentNotes, StringComparison.OrdinalIgnoreCase)))
                    {
                        entries.Add(new VisualTestTrackerEntry
                        {
                            Severity = TestModeComposerPanel.SelectedSeverity,
                            Status = "Open",
                            Notes = currentNotes,
                            PagePath = pagePath,
                            CurrentUrl = url,
                            StepsToReproduce = TestModeComposerPanel.StepsText,
                            ExpectedBehavior = TestModeComposerPanel.ExpectedText,
                            ActualBehavior = TestModeComposerPanel.ActualText,
                            Tags = TestModeComposerPanel.TagsList,
                            ScreenshotPaths = TestModeComposerPanel.GetStagedScreenshotPaths(),
                            CreatedAt = DateTime.Now,
                            UpdatedAt = DateTime.Now
                        });
                    }
                }

                var stagedShots = TestModeComposerPanel.GetStagedScreenshotPaths();

                var context = new SessionSyncContext
                {
                    ProductName = productName,
                    BaseUrl = baseUrl,
                    PagePath = pagePath,
                    StartedAt = TestModeComposerPanel.SessionStartTime,
                    EndedAt = DateTime.Now,
                    Duration = DateTime.Now - TestModeComposerPanel.SessionStartTime,
                    Entries = entries,
                    CurrentNotes = currentNotes,
                    GlobalNotes = TestModeComposerPanel.GlobalNotes,
                    StepsToReproduce = TestModeComposerPanel.StepsText,
                    ExpectedBehavior = TestModeComposerPanel.ExpectedText,
                    ActualBehavior = TestModeComposerPanel.ActualText,
                    ScreenshotPaths = stagedShots,
                    ConsoleLogs = telemetry != null ? new List<ConsoleLogItem>(telemetry.ConsoleLogs) : new(),
                    NetworkFailures = telemetry != null ? new List<NetworkFailureItem>(telemetry.NetworkLogs.Where(n => n.Failed)) : new(),
                    ReproEvents = telemetry != null ? new List<ReproductionEventItem>(telemetry.ReproductionEvents) : new(),
                    IsCleanConfirmed = TestModeComposerPanel.IsGoodChecked,
                    UrlsTested = !string.IsNullOrEmpty(url) ? new List<string> { url } : new List<string>()
                };

                // Check for direct sync (e.g. if Shift is held)
                bool isDirectSync = System.Windows.Input.Keyboard.Modifiers.HasFlag(System.Windows.Input.ModifierKeys.Shift);
                if (isDirectSync)
                {
                    string repoRoot = VisualTestTrackerExportService.ResolveRepoRoot();
                    context.SessionId = VisualTestTrackerSessionSyncService.GenerateSessionId(context.StartedAt);
                    ToastEngine.Info("Session Sync", $"Writing artifacts to /Bugs/{context.ProductName}/{context.SessionId}/ and committing to Git...");

                    var syncRes = await VisualTestTrackerSessionSyncService.ExecuteGitSyncAsync(context, repoRoot, pushToRemote: true);
                    if (syncRes.Success)
                    {
                        string commitPart = !string.IsNullOrEmpty(syncRes.CommitHash) ? $" ({syncRes.CommitHash})" : "";
                        string pushPart = syncRes.PushedToRemote ? " • Pushed to remote" : "";
                        ToastEngine.Success("Session Synced", $"✓ Saved to /Bugs/{syncRes.ProductName}/{syncRes.SessionId}/ and synced to Git{commitPart}{pushPart}.");
                        TestModeComposerPanel.ShowToast($"Synced to /Bugs/{syncRes.ProductName}/{syncRes.SessionId}/");

                        // Stamp bugs and session record as synced
                        StampSessionSynced(context, syncRes.SessionId);

                        if (TestModeComposerPanel.IsAutoClearChecked)
                        {
                            TestModeComposerPanel.ClearComposer();
                            TestModeComposerPanel.AllBugs.Clear();
                            TestModeComposerPanel.RefreshBugDrawer();
                        }
                    }
                    else
                    {
                        ToastEngine.Error("Sync Failed", syncRes.Error ?? "Could not sync session to Git.");
                    }
                    return;
                }

                // Standard flow: Open SessionSyncDialog
                var dialog = new SessionSyncDialog(context)
                {
                    Owner = this
                };

                bool? result = dialog.ShowDialog();
                if (result == true && dialog.IsSynced && dialog.Result != null)
                {
                    var syncRes = dialog.Result;
                    string commitPart = !string.IsNullOrEmpty(syncRes.CommitHash) ? $" ({syncRes.CommitHash})" : "";
                    string pushPart = syncRes.PushedToRemote ? " • Pushed to remote" : "";
                    ToastEngine.Success("Session Synced", $"✓ Saved to /Bugs/{syncRes.ProductName}/{syncRes.SessionId}/ and synced to Git{commitPart}{pushPart}.");
                    TestModeComposerPanel.ShowToast($"Synced to /Bugs/{syncRes.ProductName}/{syncRes.SessionId}/");

                    // Stamp bugs and session record as synced
                    StampSessionSynced(context, syncRes.SessionId);

                    if (TestModeComposerPanel.IsAutoClearChecked)
                    {
                        TestModeComposerPanel.ClearComposer();
                        TestModeComposerPanel.AllBugs.Clear();
                        TestModeComposerPanel.RefreshBugDrawer();
                    }
                }
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Session Sync Error", ex.Message);
            }
        }

        /// <summary>
        /// After a successful sync: stamps every bug that was in the sync payload as IsSynced=true,
        /// and writes SyncedSessionId back onto the matching VisualTestTrackerSession record so the
        /// History dialog can display the correct ✓ Synced pill.
        /// </summary>
        private void StampSessionSynced(SessionSyncContext context, string syncedSessionId)
        {
            if (string.IsNullOrEmpty(syncedSessionId)) return;

            // Stamp the live bug cards
            var syncedIds = context.Entries.Select(e => e.EntryUuid).ToList();
            TestModeComposerPanel.MarkBugsSynced(syncedSessionId, syncedIds);

            // Stamp the session record in sessions.json so the pill shows next time History opens
            try
            {
                var sessions = VisualTestTrackerSessionStore.LoadAll();
                // Match by StartedAt proximity (within 10 minutes) and page path
                var match = sessions.FirstOrDefault(s =>
                    string.Equals(s.PagePath, context.PagePath, StringComparison.OrdinalIgnoreCase) &&
                    Math.Abs((s.StartedAt - context.StartedAt).TotalMinutes) < 10 &&
                    string.IsNullOrEmpty(s.SyncedSessionId));

                if (match != null)
                {
                    match.SyncedSessionId = syncedSessionId;
                    VisualTestTrackerSessionStore.SaveAll(sessions);
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("visual-test-tracker", $"StampSessionSynced save error: {ex.Message}");
            }
        }

        private void BtnExitTestMode_Click(object sender, RoutedEventArgs e)
        {
            ExitTestMode();
        }

        private void MenuToggleTestMode_Click(object sender, RoutedEventArgs e)
        {
            ToggleTestMode();
        }
    }
}
