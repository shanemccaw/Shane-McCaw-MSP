const { execFileSync } = require('child_process');
const fs = require('fs');

const path = 'desktop/BuildConsole/MainWindow.xaml.cs';
let content = execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' });

function replaceOnce(hay, oldStr, newStr, label) {
  const idx = hay.indexOf(oldStr);
  if (idx === -1) throw new Error('anchor not found: ' + label);
  if (hay.indexOf(oldStr, idx + 1) !== -1) throw new Error('anchor not unique: ' + label);
  return hay.slice(0, idx) + newStr + hay.slice(idx + oldStr.length);
}

// Edit 1: add field + helper method
content = replaceOnce(content,
`        // ── Git #806: test manifest runner (Epic #803 Phase 2) ───────────────────
        private BuildConsole.Services.TestManifest? _loadedManifest;

        public MainWindow()`,
`        // ── Git #806: test manifest runner (Epic #803 Phase 2) ───────────────────
        private BuildConsole.Services.TestManifest? _loadedManifest;

        // ── Git #857: dedicated Test Runner window, replacing the retired bottom
        // "Test Results" tab entirely — reused across runs for the app's lifetime
        // (a new one is only created if none exists yet or Shane closed the last one).
        private TestRunnerWindow? _testRunnerWindow;

        private TestRunnerWindow EnsureTestRunnerWindow()
        {
            if (_testRunnerWindow == null)
            {
                _testRunnerWindow = new TestRunnerWindow();
                _testRunnerWindow.Closed += (_, _) => _testRunnerWindow = null;
                _testRunnerWindow.Show();
            }
            _testRunnerWindow.Activate();
            return _testRunnerWindow;
        }

        public MainWindow()`,
  'field+helper');

// Edit 2: IssueSelected comment + index
content = replaceOnce(content,
`            // Git #840 (Git Board Phase 2) — Shane: "I need to be able to...
            // read their descriptions, comments, etc..." Clicking an issue in
            // the Git Board tree opens the bottom panel's Issue Detail tab
            // (index 5 — Build Log, Terminal, SQL Runner, Output, Test
            // Results, Issue Detail) and loads its real body/comment thread.
            LeftSidebar.IssueSelected += (s, issue) =>
            {
                SetBottomPanel(true, 5);
                IssueDetailView.LoadIssue(issue.IssueNumber);
            };`,
`            // Git #840 (Git Board Phase 2) — Shane: "I need to be able to...
            // read their descriptions, comments, etc..." Clicking an issue in
            // the Git Board tree opens the bottom panel's Issue Detail tab
            // (index 4 — Build Log, Terminal, SQL Runner, Output, Issue
            // Detail; the "Test Results" tab that used to sit at index 4 was
            // retired by Git #857's dedicated TestRunnerWindow) and loads its
            // real body/comment thread.
            LeftSidebar.IssueSelected += (s, issue) =>
            {
                SetBottomPanel(true, 4);
                IssueDetailView.LoadIssue(issue.IssueNumber);
            };`,
  'issue-selected');

// Edit 3: LeftSidebar_PlayTestRequested
content = replaceOnce(content,
`        // Git #810 — the manual "Play" button (Automation sidebar) used to open the standalone
        // AutomationRunnerWindow popup; it now drives the same UiTestExecutor directly through
        // the Test Results tab's own WebView2, so both manual and manifest-driven UI runs share
        // one telemetry stream and the popup is retired entirely.
        private void LeftSidebar_PlayTestRequested(object? sender, (string url, List<Controls.AutomationAction> steps) e)
        {
            SetBottomPanel(true, 4);
            TestResultsView.Clear();
            _ = TestResultsView.RunUiTestAsync(e.url, e.steps);
        }`,
`        // Git #810 — the manual "Play" button (Automation sidebar) used to open the standalone
        // AutomationRunnerWindow popup; it drives the same UiTestExecutor directly through a
        // shared WebView2 instead, so both manual and manifest-driven UI runs share one
        // telemetry stream and the popup is retired entirely. Git #857 moved that shared
        // WebView2 from the (now also retired) Test Results tab into the dedicated
        // TestRunnerWindow.
        private void LeftSidebar_PlayTestRequested(object? sender, (string url, List<Controls.AutomationAction> steps) e)
        {
            var runner = EnsureTestRunnerWindow();
            runner.Clear();
            runner.SetStepsFromActions(e.steps);
            runner.BeginRun(0, "Manual Play Test", "manual");
            _ = runner.RunUiTestAsync(e.url, e.steps);
        }`,
  'play-test');

// Edit 4: RunManifestAsync top section
content = replaceOnce(content,
`            // Git #810 (Epic #803 Phase 6) — surface this run in the bottom "Test Results" tab.
            // apiTests/graphTests cards stream in live via HttpTestExecutor/GraphTestExecutor's
            // own StepCompleted events (subscribed once in TestResultsView itself), not pushed
            // from here.
            SetBottomPanel(true, 4);
            TestResultsView.Clear();
            TestResultsView.BeginRun(manifest.Issue, manifest.Feature, mode);`,
`            // Git #810 (Epic #803 Phase 6), relocated by Git #857 into a dedicated window —
            // apiTests/graphTests cards stream in live via HttpTestExecutor/GraphTestExecutor's
            // own StepCompleted events (subscribed once per TestRunnerWindow instance), not
            // pushed from here.
            var runner = EnsureTestRunnerWindow();
            runner.Clear();
            runner.SetSteps(manifest);
            runner.BeginRun(manifest.Issue, manifest.Feature, mode);`,
  'runmanifest-top');

// Edit 5: uiSteps block + CompleteRun
content = replaceOnce(content,
`            // Git #810 — uiSteps now run directly through TestResultsView.RunUiTestAsync (the
            // same UiTestExecutor #809 built), driving that tab's own WebView2 instead of opening
            // the standalone AutomationRunnerWindow popup — retired entirely, per #810's own
            // instruction. Telemetry cards stream live via UiTestExecutor.Telemetry, subscribed
            // for the duration of this call inside RunUiTestAsync itself.
            if (manifest.UiSteps.Count > 0)
            {
                var uiActions = manifest.UiSteps.Select((step, i) => new Controls.AutomationAction
                {
                    Index = i + 1,
                    ActionType = step.Action,
                    Selector = step.Selector ?? step.Target ?? string.Empty,
                    TagName = "div",
                    Value = step.Value ?? step.State ?? string.Empty,
                    CaptureResponse = step.CaptureResponseJson,
                }).ToList();

                var uiResult = await TestResultsView.RunUiTestAsync(manifest.BaseUrl, uiActions);
                var uiStepResults = uiResult.ToTestStepResults();
                runResult.AddRange(uiStepResults);

                BuildConsole.Services.ActivityLog.Log("testing.ui-executor",
                    $"[{mode}] Issue #{manifest.Issue} uiSteps: {uiResult.PassedSteps}/{uiResult.TotalSteps} passed.");
            }

            TestResultsView.CompleteRun(runResult);`,
`            // Git #810 — uiSteps run directly through TestRunnerWindow.RunUiTestAsync (the
            // same UiTestExecutor #809 built), driving its own WebView2 instead of opening
            // the standalone AutomationRunnerWindow popup — retired entirely, per #810's own
            // instruction. Telemetry cards stream live via UiTestExecutor.Telemetry, subscribed
            // for the duration of this call inside RunUiTestAsync itself.
            if (manifest.UiSteps.Count > 0)
            {
                var uiActions = manifest.UiSteps.Select((step, i) => new Controls.AutomationAction
                {
                    Index = i + 1,
                    ActionType = step.Action,
                    Selector = step.Selector ?? step.Target ?? string.Empty,
                    TagName = "div",
                    Value = step.Value ?? step.State ?? string.Empty,
                    CaptureResponse = step.CaptureResponseJson,
                }).ToList();

                var uiResult = await runner.RunUiTestAsync(manifest.BaseUrl, uiActions);
                var uiStepResults = uiResult.ToTestStepResults();
                runResult.AddRange(uiStepResults);

                BuildConsole.Services.ActivityLog.Log("testing.ui-executor",
                    $"[{mode}] Issue #{manifest.Issue} uiSteps: {uiResult.PassedSteps}/{uiResult.TotalSteps} passed.");
            }

            runner.CompleteRun(runResult);`,
  'runmanifest-uisteps');

const tmpFile = '.tmp-mainwindow-xamlcs-857.txt';
fs.writeFileSync(tmpFile, content, 'utf8');

const sha = execFileSync('git', ['hash-object', '-w', '--path', path, tmpFile], { encoding: 'utf8' }).trim();
execFileSync('git', ['update-index', '--cacheinfo', `100644,${sha},${path}`]);
console.log('staged', path, 'as', sha);
fs.unlinkSync(tmpFile);
