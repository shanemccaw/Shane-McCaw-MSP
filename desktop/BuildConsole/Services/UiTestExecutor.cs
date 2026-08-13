using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Services
{
    /// <summary>One line of step-by-step progress the executor raises as it runs — AutomationRunnerWindow renders these as its existing telemetry cards; #810's Test Results tab (Epic #803 Phase 6) can subscribe the same way without touching the popup.</summary>
    public class UiTelemetryEvent
    {
        public string Label { get; set; } = string.Empty;
        public string Detail { get; set; } = string.Empty;
        public string Level { get; set; } = "INFO";
        public string ColorHex { get; set; } = "#89B4FA";
    }

    /// <summary>Git #970 — a resolved `{ width, height }` viewport, parsed from either a manifest/uiStep's
    /// raw `viewport` JSON (an object) or a named preset string ("mobile"/"tablet"). Infrastructure only —
    /// no existing manifest declares one yet.</summary>
    public class ViewportSpec
    {
        public int Width { get; set; }
        public int Height { get; set; }

        private static readonly Dictionary<string, (int Width, int Height)> Presets = new(StringComparer.OrdinalIgnoreCase)
        {
            ["mobile"] = (375, 667),
            ["tablet"] = (768, 1024),
        };

        public static ViewportSpec? Parse(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                if (root.ValueKind == JsonValueKind.String)
                {
                    return Presets.TryGetValue(root.GetString() ?? string.Empty, out var preset)
                        ? new ViewportSpec { Width = preset.Width, Height = preset.Height }
                        : null;
                }

                if (root.ValueKind == JsonValueKind.Object)
                {
                    int width = root.TryGetProperty("width", out var w) && w.ValueKind == JsonValueKind.Number ? w.GetInt32() : 0;
                    int height = root.TryGetProperty("height", out var h) && h.ValueKind == JsonValueKind.Number ? h.GetInt32() : 0;

                    if ((width <= 0 || height <= 0) && root.TryGetProperty("preset", out var p) && p.ValueKind == JsonValueKind.String
                        && Presets.TryGetValue(p.GetString() ?? string.Empty, out var preset))
                    {
                        if (width <= 0) width = preset.Width;
                        if (height <= 0) height = preset.Height;
                    }

                    return (width > 0 && height > 0) ? new ViewportSpec { Width = width, Height = height } : null;
                }
            }
            catch (JsonException)
            {
                // Malformed viewport JSON — treated the same as "no viewport declared".
            }
            return null;
        }

        public bool Matches(ViewportSpec? other) => other != null && Width == other.Width && Height == other.Height;
        public override string ToString() => $"{Width}x{Height}";
    }

    public class UiCaptureResponseResult
    {
        public string UrlPattern { get; set; } = string.Empty;
        public bool Captured { get; set; }
        public int? Status { get; set; }
        public bool Passed { get; set; }
        public string Detail { get; set; } = string.Empty;
        /// <summary>Git #812 — the captureResponse `expect` block, rendered human-readable (e.g. "status=200; $.ticketId exists=true").</summary>
        public string Expected { get; set; } = string.Empty;
        /// <summary>Git #812 — what was actually observed (status + resolved jsonPath values), same shape as Expected.</summary>
        public string Actual { get; set; } = string.Empty;
    }

    public class UiStepResult
    {
        public int Index { get; set; }
        public string ActionType { get; set; } = string.Empty;
        public string Selector { get; set; } = string.Empty;
        /// <summary>The DOM action/assertion's own pass/fail, before folding in CaptureResponse — kept distinct so ToTestStepResults() can report the two as separate entries, per #809's "assert captureResponse separately from the UI assertion that follows."</summary>
        public bool ActionPassed { get; set; }
        /// <summary>ActionPassed AND (CaptureResponse?.Passed ?? true) — the combined verdict used for the popup's per-step PASS/WARN card and the run's overall pass count.</summary>
        public bool Passed { get; set; }
        public string Detail { get; set; } = string.Empty;
        public long DurationMs { get; set; }
        public UiCaptureResponseResult? CaptureResponse { get; set; }
        /// <summary>Git #812 — expected DOM/action outcome (e.g. an `expect` step's target state), threaded into TestStepResult.Expected via ToTestStepResults().</summary>
        public string Expected { get; set; } = string.Empty;
        /// <summary>Git #812 — what the DOM/action actually produced (found/visible booleans, or the raw JS execution result on failure).</summary>
        public string Actual { get; set; } = string.Empty;
        /// <summary>Git #966 — absolute path of the PNG WebView2 screenshot captured for this step (on failure, or when the uiStep declares `"screenshot": true`), or empty when none was captured. Copied onto TestStepResult.ScreenshotPath (rewritten repo-relative by the caller) via ToTestStepResults() so the results JSON references it.</summary>
        public string ScreenshotPath { get; set; } = string.Empty;
    }

    /// <summary>Git #966 — one WebView2 screenshot captured during a run, surfaced to TestRunnerWindow's review gallery. FilePath is absolute (loaded straight into the gallery's Image); Reason is why it was taken ("step-failed" / "explicit" / "navigation-failed").</summary>
    public class UiScreenshotCapture
    {
        public int StepIndex { get; set; }
        public string FilePath { get; set; } = string.Empty;
        public string Reason { get; set; } = string.Empty;
        public string StepLabel { get; set; } = string.Empty;
    }

    /// <summary>The structured outcome of a run — this, not the popup, is the reusable artifact #810 will consume once it exists.</summary>
    public class UiTestRunResult
    {
        public string TargetUrl { get; set; } = string.Empty;
        public int TotalSteps { get; set; }
        public int PassedSteps { get; set; }
        public bool Success { get; set; }
        public string StatusText { get; set; } = string.Empty;
        public List<UiStepResult> Steps { get; } = new();

        /// <summary>Git #966 — every WebView2 screenshot captured during this run, in capture order — fed straight into TestRunnerWindow's click-through review gallery. Git #977 — one per uiStep by default now (always-on, not failure-only/opt-in), so #975's baseline/diff can catch UI drift on passing runs too. Empty only when no screenshot directory was provided (capture disabled).</summary>
        public List<UiScreenshotCapture> Screenshots { get; } = new();

        /// <summary>Git #807's shared ManifestRunResult/TestStepResult pipeline is what #808 and #810 plug into — not a separate output path per executor kind. Folds this run's steps (and captureResponse assertions, as their own distinct entries) into that shape; if the run never got past navigation, a single synthetic "navigate" entry keeps the failure visible instead of silently vanishing as zero UI steps.</summary>
        public List<TestStepResult> ToTestStepResults()
        {
            var results = new List<TestStepResult>();

            if (Steps.Count == 0)
            {
                if (!Success)
                    results.Add(new TestStepResult { Kind = "ui", Label = $"navigate {TargetUrl}", Passed = false, Detail = StatusText });
                return results;
            }

            foreach (var step in Steps)
            {
                if (step.CaptureResponse != null)
                {
                    results.Add(new TestStepResult
                    {
                        Kind = "ui",
                        Label = $"capture {step.CaptureResponse.UrlPattern}",
                        Passed = step.CaptureResponse.Passed,
                        Detail = step.CaptureResponse.Detail,
                        Expected = step.CaptureResponse.Expected,
                        Actual = step.CaptureResponse.Actual,
                        Context = $"triggered by step {step.Index} ({step.ActionType} {step.Selector}); status={(step.CaptureResponse.Status?.ToString() ?? "none")}",
                    });
                }

                results.Add(new TestStepResult
                {
                    Kind = "ui",
                    Label = $"{step.ActionType} {step.Selector}",
                    Passed = step.ActionPassed,
                    Detail = step.Detail,
                    DurationMs = step.DurationMs,
                    Expected = step.Expected,
                    Actual = step.Actual,
                    Context = $"step {step.Index}: {step.ActionType} on selector '{step.Selector}'",
                    // Git #966 — absolute here; the caller (RunManifestAsync) rewrites it repo-relative before the JSON is written.
                    ScreenshotPath = step.ScreenshotPath,
                });
            }

            return results;
        }
    }

    /// <summary>
    /// Git #809 (Epic #803 Phase 5) — the WebView2 + JS-injection UI test engine, factored
    /// out of AutomationRunnerWindow.xaml.cs so it can be driven by manifest-loaded
    /// AutomationAction steps (goto/click/input/expect, from #806's manifest loader) as
    /// well as the pre-existing manually-recorded ones, and so its structured
    /// UiTestRunResult output isn't hard-wired to the standalone popup — #810's bottom
    /// "Test Results" tab drives the same engine directly once it lands, retiring the
    /// popup this class is currently embedded in.
    ///
    /// Logging channel: "testing.ui-executor" via ActivityLog.Log (this app's equivalent
    /// of a module-level logger.child({ channel }) binding — there is no Node logger in
    /// this WPF process).
    /// </summary>
    public class UiTestExecutor
    {
        private const string Channel = "testing.ui-executor";
        /// <summary>Git #966 — dedicated channel for screenshot capture, per the task's `ActivityLog.Log("testing.screenshot", ...)` instruction (this app's logger.child({channel}) equivalent).</summary>
        private const string ScreenshotChannel = "testing.screenshot";
        private const int CaptureResponseTimeoutMs = 5000;
        private const int PostNavigationSettleMs = 1200;
        private const int PostStepSettleMs = 1000;
        private const int NavigationTimeoutMs = 15000;
        /// <summary>Post-capture hang fix (Epic #803) — a hard ceiling on the best-effort #966/#977 WebView2
        /// screenshot capture. CoreWebView2.CapturePreviewAsync never completes when the control isn't in a
        /// renderable/composited state (a run triggered while BuildConsole is minimized/occluded/on a locked
        /// session), and it is the only await left in a step's post-capture path once the captureResponse wait
        /// has already timed out — so without this guard one un-renderable screenshot deadlocks the entire run
        /// forever (the try/catch around it cannot rescue a Task that never faults). Same
        /// Task.WhenAny(work, Task.Delay(timeout)) shape navigation (15s) and captureResponse (5s) already use.</summary>
        private const int ScreenshotTimeoutMs = 8000;

        private readonly WebView2 _webView;

        /// <summary>Git #877 — the per-run cross-step variable store, shared with the api/graph
        /// executors for this manifest run. Steps resolve {{name}} placeholders in their
        /// selector/value against it before executing, and extract new values from their captured
        /// response body into it. Defaults to an empty store for the manual "Play" path, which has
        /// no manifest run to share.</summary>
        private TestRunVariables _vars = new();

        /// <summary>Git #970 — the viewport currently applied to _webView (an explicit WPF Width/Height
        /// override), or null when the control is at its default desktop size (auto-stretch). Tracked so
        /// consecutive steps at the same viewport don't redundantly resize, and so the run can restore
        /// the default afterward only when it actually left it.</summary>
        private ViewportSpec? _appliedViewport;

        /// <summary>Git #966 — absolute directory this run's screenshots are written into
        /// (test-results/{issue}-{timestamp}/screenshots), or null when the caller supplied none (capture
        /// disabled). Created lazily on the first capture so a passing, non-explicit run leaves no empty folder.</summary>
        private string? _screenshotDir;

        /// <summary>Git #966 — the in-flight run, so per-step capture can append to its Screenshots list
        /// (fed to TestRunnerWindow's gallery) from inside ExecuteStepAsync without threading it through.</summary>
        private UiTestRunResult? _run;

        public event EventHandler<UiTelemetryEvent>? Telemetry;

        public UiTestExecutor(WebView2 webView)
        {
            _webView = webView;
        }

        /// <param name="screenshotDir">Git #966 — absolute directory to write PNG screenshots into (created lazily
        /// on first capture). Null disables capture. Git #977 — a screenshot is now taken at EVERY step by default
        /// (always-on for UI drift detection), superseding #966's failure-only + <see cref="Controls.AutomationAction.Screenshot"/>
        /// opt-in; the flag now only affects the capture reason label.</param>
        public async Task<UiTestRunResult> RunAsync(string targetUrl, IReadOnlyList<Controls.AutomationAction> steps, TestRunVariables? vars = null, ViewportSpec? defaultViewport = null, string? screenshotDir = null)
        {
            _vars = vars ?? new TestRunVariables();
            _screenshotDir = string.IsNullOrWhiteSpace(screenshotDir) ? null : screenshotDir;
            var result = new UiTestRunResult { TargetUrl = targetUrl, TotalSteps = steps.Count };
            _run = result;

            Emit("START", $"Navigating to {targetUrl}", "INFO", "#89B4FA");
            ActivityLog.Log(Channel, $"Navigating to {targetUrl} ({steps.Count} step(s)).");

            try
            {
                await _webView.EnsureCoreWebView2Async();
                _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;

                if (!await NavigateAsync(targetUrl))
                {
                    Emit("NAV FAIL", "Page failed to load or encountered HTTP error.", "ERROR", "#F38BA8");
                    ActivityLog.Log(Channel, $"Navigation failed: {targetUrl}");
                    // Git #966 — a failed navigation is still worth a screenshot (the error page WebView2 rendered
                    // is exactly what a human reviewer would want to see); captured as step 0.
                    await CaptureScreenshotAsync(0, "navigation-failed", $"navigate {targetUrl}");
                    result.Success = false;
                    result.StatusText = "❌ TEST FAILED (Navigation Error)";
                    return result;
                }

                Emit("NAV OK", "Page loaded successfully.", "SUCCESS", "#A6E3A1");
                await Task.Delay(PostNavigationSettleMs);

                int passed = 0;
                for (int i = 0; i < steps.Count; i++)
                {
                    // Git #970 — resize before the step, not after: a step's viewport override falls back
                    // to the manifest-wide default, and either way the resize must land before the step's
                    // own action runs so it observes the target layout.
                    ApplyViewport(ViewportSpec.Parse(steps[i].Viewport) ?? defaultViewport);
                    var stepResult = await ExecuteStepAsync(i + 1, steps[i]);
                    result.Steps.Add(stepResult);
                    if (stepResult.Passed) passed++;
                    await Task.Delay(PostStepSettleMs);
                }

                result.PassedSteps = passed;
                result.Success = passed == steps.Count;
                result.StatusText = result.Success
                    ? $"✔ TEST PASSED ({passed}/{steps.Count} Steps)"
                    : $"⚠ TEST INCOMPLETE ({passed}/{steps.Count} Steps)";
                ActivityLog.Log(Channel, $"Run complete for {targetUrl}: {passed}/{steps.Count} steps passed.");
                return result;
            }
            catch (Exception ex)
            {
                Emit("CRASH", $"Execution error: {ex.Message}", "CRASH", "#F38BA8");
                ActivityLog.Log(Channel, $"CRASH running {targetUrl}: {ex.Message}");
                result.Success = false;
                result.StatusText = "❌ TEST FAILED (Exception)";
                return result;
            }
            finally
            {
                // Git #970 — leave the control back at its default desktop size no matter how the run
                // ended (pass, incomplete, nav failure, or crash), so a later run or the manual "Play"
                // path sharing this same WebView2 never inherits a stale resize.
                ApplyViewport(null);
            }
        }

        private async Task<UiStepResult> ExecuteStepAsync(int stepNumber, Controls.AutomationAction step)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            string actionType = step.ActionType.ToLowerInvariant();
            string selector;
            string val;
            try
            {
                // #877 — resolve {{name}} placeholders in the step's target/selector and value
                // against earlier steps' extracted values BEFORE executing, so the DOM action
                // operates on the real value and never the literal "{{name}}" text.
                selector = _vars.Resolve(step.Selector);
                val = _vars.Resolve(step.Value);
            }
            catch (VariableNotResolvedException ex)
            {
                sw.Stop();
                Emit($"STEP {stepNumber} WARN", ex.Message, "WARN", "#FAB387");
                ActivityLog.Log(Channel, $"Step {stepNumber} ({actionType}): unresolved variable — {ex.Message}");
                // Git #966 — an unresolved-variable failure is still a step failure: capture whatever's on screen.
                string varFailShot = await CaptureScreenshotAsync(stepNumber, "step-failed", $"{actionType} {step.Selector}");
                return new UiStepResult
                {
                    Index = stepNumber,
                    ActionType = actionType,
                    Selector = step.Selector,
                    ActionPassed = false,
                    Passed = false,
                    Detail = ex.Message,
                    DurationMs = sw.ElapsedMilliseconds,
                    Expected = "all {{variable}} placeholders resolve to an earlier step's extracted value",
                    Actual = ex.Message,
                    ScreenshotPath = varFailShot,
                };
            }

            // Git #995 — parsed and logged BEFORE the step's own action runs, alongside it, so the
            // log makes visible (not just the eventual capture-response log line, which only appears
            // once the wait resolves) that this step has other work armed in parallel with its primary
            // action — the exact context a future #995-shaped hang needs to be diagnosable from the
            // log alone, without a manual trace.
            var captureSpec = ParseCaptureResponse(step.CaptureResponse);
            bool hasExtract = !string.IsNullOrWhiteSpace(step.Extract);

            string armedNote = "";
            if (captureSpec != null)
                armedNote += $" — also capturing response matching '{captureSpec.UrlPattern}' (timeout {CaptureResponseTimeoutMs}ms)";
            if (hasExtract)
                armedNote += captureSpec != null ? "; extracting a value from that response on match" : " — extract declared but no captureResponse to extract from";

            Emit($"STEP {stepNumber}", $"{step.ActionTypeUpper}: {selector} {(string.IsNullOrEmpty(val) ? "" : "=> " + val)}{armedNote}", "RUNNING", "#89DCEB");
            ActivityLog.Log(Channel, $"Step {stepNumber} ({actionType} {selector}): starting{armedNote}.");

            TaskCompletionSource<CoreWebView2WebResourceResponseReceivedEventArgs>? captureTcs = null;
            EventHandler<CoreWebView2WebResourceResponseReceivedEventArgs>? captureHandler = null;

            if (captureSpec != null)
            {
                // Armed before the step's own JS/navigation runs, per #809 — the UI action is what
                // actually triggers the network call this is meant to observe.
                captureTcs = new TaskCompletionSource<CoreWebView2WebResourceResponseReceivedEventArgs>();
                captureHandler = (s, args) =>
                {
                    if (args.Request.Uri.Contains(captureSpec.UrlPattern, StringComparison.OrdinalIgnoreCase))
                        captureTcs.TrySetResult(args);
                };
                _webView.CoreWebView2.WebResourceResponseReceived += captureHandler;
            }

            bool actionPassed;
            string actionDetail;
            string actionExpected = "";
            string actionActual = "";

            if (actionType == "goto")
            {
                string target = ResolveGotoTarget(selector);
                actionPassed = await NavigateAsync(target);
                actionDetail = actionPassed ? $"Navigated to {target}" : $"Navigation to {target} failed";
                actionExpected = $"navigation to {target} succeeds";
                actionActual = actionPassed ? "succeeded" : "failed (no NavigationCompleted success)";
            }
            else if (actionType == "expect")
            {
                string expectedState = string.IsNullOrWhiteSpace(val) ? "visible" : val;
                (actionPassed, actionDetail, actionActual) = await EvaluateExpectAsync(selector, expectedState);
                actionExpected = $"{selector} state == '{expectedState}'";
            }
            else
            {
                (actionPassed, actionDetail) = await ExecuteClickOrInputAsync(actionType, selector, step.TagName, val);
                actionExpected = $"{actionType} on '{selector}' executes without a DOM error";
                actionActual = actionPassed ? "executed" : actionDetail;
            }

            UiCaptureResponseResult? captureResult = null;
            string? extractError = null;
            if (captureSpec != null && captureTcs != null && captureHandler != null)
            {
                // Git #995 — timed separately from the step's own Stopwatch so the log states exactly
                // which of the two race outcomes happened (a genuine match vs. the CaptureResponseTimeoutMs
                // ceiling winning) and how long the wait actually took, instead of leaving that implicit.
                var captureSw = System.Diagnostics.Stopwatch.StartNew();
                var completed = await Task.WhenAny(captureTcs.Task, Task.Delay(CaptureResponseTimeoutMs));
                captureSw.Stop();
                _webView.CoreWebView2.WebResourceResponseReceived -= captureHandler;
                var capturedArgs = completed == captureTcs.Task ? captureTcs.Task.Result : null;
                bool captureMatched = capturedArgs != null;
                ActivityLog.Log(Channel, captureMatched
                    ? $"Step {stepNumber} captureResponse [{captureSpec.UrlPattern}]: matched after {captureSw.ElapsedMilliseconds}ms."
                    : $"Step {stepNumber} captureResponse [{captureSpec.UrlPattern}]: TIMED OUT after {captureSw.ElapsedMilliseconds}ms — no response matching '{captureSpec.UrlPattern}' was observed within the {CaptureResponseTimeoutMs}ms ceiling.");

                // Post-capture hang fix (Epic #803) — trace every stage AFTER the captureResponse wait resolves,
                // so a stall anywhere in this stretch (the null-capture path, the body read, or the screenshot
                // below) is pinpointable from the log alone instead of presenting as a silent multi-minute freeze.
                // capturedArgs == null (the 5s timeout won) is an EXPECTED valid outcome, not a crash — the step
                // still completes and reports the captureResponse as a WARN.
                ActivityLog.Log(Channel, $"Step {stepNumber} capture wait resolved: " +
                    (capturedArgs != null
                        ? $"matching response for [{captureSpec.UrlPattern}] observed — processing."
                        : $"no matching response for [{captureSpec.UrlPattern}] within {CaptureResponseTimeoutMs}ms (timeout) — continuing with null capture."));

                // Read the matched response body at most once — reused for both the captureResponse
                // assertions and #877's extract, so the WebView2 content stream is never consumed twice.
                string? capturedBody = null;
                string? bodyReadError = null;
                if (capturedArgs != null && (CaptureNeedsBody(captureSpec) || hasExtract))
                {
                    ActivityLog.Log(Channel, $"Step {stepNumber}: reading captured response body for [{captureSpec.UrlPattern}]…");
                    (capturedBody, bodyReadError) = await ReadResponseBodyAsync(capturedArgs);
                    ActivityLog.Log(Channel, $"Step {stepNumber}: response body read {(bodyReadError == null ? $"OK ({capturedBody?.Length ?? 0} chars)" : $"FAILED — {bodyReadError}")}.");
                }

                captureResult = BuildCaptureResult(captureSpec, capturedArgs, capturedBody, bodyReadError);
                Emit($"STEP {stepNumber} CAPTURE", captureResult.Detail, captureResult.Passed ? "PASS" : "WARN", captureResult.Passed ? "#A6E3A1" : "#FAB387");
                ActivityLog.Log(Channel, $"Step {stepNumber} captureResponse [{captureSpec.UrlPattern}]: {(captureResult.Passed ? "PASS" : "WARN")} — {captureResult.Detail}");

                // #877 — extract a value out of the captured response body for later steps to use.
                if (hasExtract)
                {
                    var extractSw = System.Diagnostics.Stopwatch.StartNew();
                    if (capturedArgs == null)
                        extractError = "extract: no response matching the captureResponse urlPattern was observed — nothing to extract from.";
                    else if (bodyReadError != null)
                        extractError = $"extract: couldn't read the captured response body — {bodyReadError}";
                    else
                        extractError = ApplyUiExtract(step.Extract!, capturedBody ?? string.Empty);
                    extractSw.Stop();
                    if (extractError != null)
                        ActivityLog.Log(TestRunVariables.Channel, $"Step {stepNumber} {extractError} ({extractSw.ElapsedMilliseconds}ms).");
                    else
                        ActivityLog.Log(TestRunVariables.Channel, $"Step {stepNumber}: extract resolved successfully from the captured '{captureSpec.UrlPattern}' response ({extractSw.ElapsedMilliseconds}ms).");
                }
            }
            else if (hasExtract)
            {
                // A pure DOM step has no response body — a {{name}} declared against it can't resolve.
                extractError = "extract declared but this uiStep has no captureResponse — there is no response body to extract from.";
                ActivityLog.Log(TestRunVariables.Channel, $"Step {stepNumber}: {extractError}");
            }

            sw.Stop();
            // Git #969 — this uiStep's optional maxDurationMs, asserted against the same
            // Stopwatch elapsed time already recorded into DurationMs below.
            string? durationError = HttpTestExecutor.CheckMaxDuration(step.MaxDurationMs, sw.ElapsedMilliseconds);

            // captureResponse is asserted separately (above) from the step's own UI assertion (below), per #809.
            // #877 — a declared-but-failed extract also fails the step, so a downstream {{name}} reference
            // surfaces the real problem at its source rather than mysteriously later.
            bool overallPassed = actionPassed && (captureResult == null || captureResult.Passed) && extractError == null && durationError == null;
            string stepDetail = extractError == null ? actionDetail : $"{actionDetail} | {extractError}";
            if (durationError != null) stepDetail = $"{stepDetail} | {durationError}";
            Emit(overallPassed ? $"STEP {stepNumber} PASS" : $"STEP {stepNumber} WARN", stepDetail, overallPassed ? "PASS" : "WARN", overallPassed ? "#A6E3A1" : "#FAB387");
            ActivityLog.Log(Channel, $"Step {stepNumber} ({actionType} {selector}): {(overallPassed ? "PASS" : "WARN")} — {stepDetail}");

            // Git #977 — capture a screenshot at EVERY uiStep by default, not just #966's failure-only + explicit
            // `"screenshot": true` opt-in. A step can pass every DOM/text assertion while the page has drifted
            // visually, and #975's baseline/diff/approval workflow has nothing to compare on a passing run unless
            // capture is unconditional — so drift is only catchable suite-wide with always-on capture. The
            // per-step `screenshot` flag is now redundant for uiSteps (always-on supersedes it) and kept only to
            // colour the capture reason. Runs after the #969 sw.Stop() above on purpose: the capture time must
            // not inflate the step's DurationMs. Capture is still best-effort (never throws, no-ops when the
            // caller supplied no screenshot directory), so making it unconditional can't fail a run.
            string reason = !overallPassed ? "step-failed" : (step.Screenshot ? "explicit" : "step");
            // Post-capture hang fix (Epic #803) — bracket the screenshot with logs: this is the last await in a
            // step and (see ScreenshotTimeoutMs / CaptureScreenshotAsync) was the actual freeze site, so an entry
            // log here plus the "returning" log after it makes a screenshot stall obvious instead of invisible.
            ActivityLog.Log(Channel, $"Step {stepNumber}: capturing post-step screenshot (reason={reason})…");
            string screenshotPath = await CaptureScreenshotAsync(stepNumber, reason, $"{actionType} {selector}");
            ActivityLog.Log(Channel, $"Step {stepNumber}: complete — returning result (passed={overallPassed}, screenshot={(string.IsNullOrEmpty(screenshotPath) ? "none" : "captured")}).");

            return new UiStepResult
            {
                Index = stepNumber,
                ActionType = actionType,
                Selector = selector,
                ActionPassed = actionPassed,
                Passed = overallPassed,
                Detail = stepDetail,
                DurationMs = sw.ElapsedMilliseconds,
                CaptureResponse = captureResult,
                Expected = actionExpected,
                Actual = actionActual,
                ScreenshotPath = screenshotPath,
            };
        }

        /// <summary>Git #966 — capture the WebView2's current visual state to a PNG via CoreWebView2.CapturePreviewAsync
        /// (its native screenshot capability), save it under this run's screenshots directory as {stepIndex}.png,
        /// register it on the run's Screenshots list for the review gallery, and log to "testing.screenshot".
        /// Never throws — capture is best-effort telemetry, and a capture failure must not fail the run itself.
        /// Returns the absolute PNG path, or empty string when capture was disabled (no directory) or failed.</summary>
        private async Task<string> CaptureScreenshotAsync(int stepIndex, string reason, string stepLabel)
        {
            if (_screenshotDir == null) return string.Empty;
            // Git #995 — timed so a slow/hanging CapturePreviewAsync (this step feature runs invisibly
            // AFTER the step's own Stopwatch already stopped, per the #977 comment above this method's
            // caller) shows up in the log with its own real duration instead of being invisible time.
            var shotSw = System.Diagnostics.Stopwatch.StartNew();
            FileStream? stream = null;
            try
            {
                Directory.CreateDirectory(_screenshotDir);
                string path = Path.Combine(_screenshotDir, $"{stepIndex}.png");
                stream = new FileStream(path, FileMode.Create, FileAccess.Write);
                var localStream = stream;

                // Post-capture hang fix (Epic #803) — CapturePreviewAsync can never return when the WebView2 is
                // not in a renderable/composited state (a minimized/occluded/locked-session run), and it is the
                // only await left in a step's post-capture path once the captureResponse wait has timed out. Guard
                // it with the same Task.WhenAny(work, Task.Delay(timeout)) shape navigation/captureResponse use:
                // best-effort telemetry must NEVER be able to hang a run, and the surrounding try/catch only
                // rescues exceptions — a stuck Task never faults, so without this guard the whole run deadlocks.
                ActivityLog.Log(ScreenshotChannel, $"Step {stepIndex}: invoking CapturePreviewAsync ({reason})…");
                var captureTask = _webView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                var completed = await Task.WhenAny(captureTask, Task.Delay(ScreenshotTimeoutMs));
                if (completed != captureTask)
                {
                    // Timed out. Hand stream ownership to a continuation so a late (or never) CapturePreviewAsync
                    // can't write to a stream we've already disposed, and so its eventual exception is always
                    // observed (never surfaces as an unobserved-task-exception). Then skip — the run continues.
                    stream = null; // the continuation owns disposal now; keep finally from double-disposing
                    _ = captureTask.ContinueWith(t => { _ = t.Exception; localStream.Dispose(); }, TaskScheduler.Default);
                    Emit($"STEP {stepIndex} SHOT", $"Screenshot skipped — capture timed out after {ScreenshotTimeoutMs}ms.", "WARN", "#FAB387");
                    ActivityLog.Log(ScreenshotChannel, $"Screenshot capture for step {stepIndex} ({reason}) timed out after {ScreenshotTimeoutMs}ms — CapturePreviewAsync never returned (WebView2 likely not in a renderable/visible state). Skipping so the run can complete instead of hanging.");
                    return string.Empty;
                }
                await captureTask; // observe success / surface any capture exception into the catch below
                shotSw.Stop();

                _run?.Screenshots.Add(new UiScreenshotCapture
                {
                    StepIndex = stepIndex,
                    FilePath = path,
                    Reason = reason,
                    StepLabel = stepLabel,
                });

                Emit($"STEP {stepIndex} SHOT", $"Screenshot captured ({reason}) in {shotSw.ElapsedMilliseconds}ms.", "INFO", "#89DCEB");
                ActivityLog.Log(ScreenshotChannel, $"Captured screenshot for step {stepIndex} ({reason}) in {shotSw.ElapsedMilliseconds}ms — {stepLabel} -> {path}");
                return path;
            }
            catch (Exception ex)
            {
                shotSw.Stop();
                ActivityLog.Log(ScreenshotChannel, $"Screenshot capture failed for step {stepIndex} ({reason}) after {shotSw.ElapsedMilliseconds}ms: {ex.Message}");
                return string.Empty;
            }
            finally
            {
                // Normal + exception paths dispose here (flushes the PNG to disk before the caller reads the path);
                // the timeout path already nulled `stream` and handed disposal to the continuation.
                stream?.Dispose();
            }
        }

        /// <summary>Git #877 — parse a uiStep's raw `extract` block JSON and apply it against the
        /// captured response body via the shared run store. Returns null on success, or an error
        /// string (malformed JSON, non-matching regex, unresolved jsonPath, …) that fails the step.</summary>
        private string? ApplyUiExtract(string extractJson, string responseBody)
        {
            try
            {
                using var doc = JsonDocument.Parse(extractJson);
                return _vars.Extract(doc.RootElement, responseBody);
            }
            catch (JsonException ex)
            {
                return $"extract: malformed extract block JSON — {ex.Message}";
            }
        }

        /// <summary>Git #832 — must call CoreWebView2.Navigate(url), NOT set _webView.Source. Source is a WPF
        /// DependencyProperty, and WPF skips the property-changed callback (so never triggers navigation) when
        /// the new value equals the current one — a goto step resolving to the already-loaded URL (e.g. a
        /// manifest's opening "goto /" right after this method's own initial navigation to that same URL) left
        /// NavigationCompleted never firing and the whole run deadlocked forever with no error. Navigate() is a
        /// direct native call that always performs a real navigation regardless of URL equality.</summary>
        private async Task<bool> NavigateAsync(string url)
        {
            var tcs = new TaskCompletionSource<bool>();
            void NavHandler(object? s, CoreWebView2NavigationCompletedEventArgs args)
            {
                _webView.NavigationCompleted -= NavHandler;
                tcs.TrySetResult(args.IsSuccess);
            }

            _webView.NavigationCompleted += NavHandler;
            _webView.CoreWebView2.Navigate(url);

            var completed = await Task.WhenAny(tcs.Task, Task.Delay(NavigationTimeoutMs));
            if (completed != tcs.Task)
            {
                _webView.NavigationCompleted -= NavHandler;
                ActivityLog.Log(Channel, $"Navigation to {url} timed out after {NavigationTimeoutMs}ms (NavigationCompleted never fired).");
                return false;
            }

            return await tcs.Task;
        }

        private string ResolveGotoTarget(string target)
        {
            if (Uri.TryCreate(target, UriKind.Absolute, out var abs)) return abs.ToString();
            if (_webView.Source != null && Uri.TryCreate(_webView.Source, target, out var combined)) return combined.ToString();
            return target;
        }

        /// <summary>Same JS find/highlight/click/input pattern AutomationRunnerWindow always used — unchanged behavior for manually-recorded steps.</summary>
        private async Task<(bool passed, string detail)> ExecuteClickOrInputAsync(string actionType, string selector, string tagName, string val)
        {
            string script = $@"
(function() {{
    try {{
        let el = document.querySelector('{Escape(selector)}');
        if (!el) {{
            let tags = document.querySelectorAll('{Escape(tagName)}');
            for (let t of tags) {{
                if ((t.innerText || t.value || '').trim().includes('{Escape(val)}')) {{
                    el = t; break;
                }}
            }}
        }}
        if (!el) return JSON.stringify({{ success: false, error: 'Element not found in DOM' }});

        let origOutline = el.style.outline;
        el.style.outline = '3px solid #89B4FA';
        setTimeout(() => {{ el.style.outline = origOutline; }}, 600);

        if ('{actionType}' === 'click') {{
            el.click();
        }} else if ('{actionType}' === 'input') {{
            let proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            let nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            nativeSetter.call(el, '{Escape(val)}');
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
        }}
        return JSON.stringify({{ success: true }});
    }} catch(ex) {{
        return JSON.stringify({{ success: false, error: ex.message }});
    }}
}})();";

            string resJson = await _webView.ExecuteScriptAsync(script) ?? string.Empty;
            bool passed = false;
            string? error = null;
            try
            {
                // ExecuteScriptAsync JSON-encodes whatever the script returns; since the script itself
                // returns a JSON.stringify'd string, the raw result is a JSON string LITERAL whose
                // deserialized value is the actual { success, error } object as text.
                using var outerDoc = JsonDocument.Parse(resJson);
                using var innerDoc = JsonDocument.Parse(outerDoc.RootElement.GetString() ?? "{}");
                var root = innerDoc.RootElement;
                if (root.TryGetProperty("success", out var s) && (s.ValueKind == JsonValueKind.True || s.ValueKind == JsonValueKind.False))
                    passed = s.GetBoolean();
                if (root.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String)
                    error = e.GetString();
            }
            catch (JsonException)
            {
                error = $"unparseable script result: {resJson}";
            }
            string detail = passed ? $"Executed {actionType} on {selector}" : $"Element execution warning: {error ?? resJson}";
            return (passed, detail);
        }

        private async Task<(bool passed, string detail, string actual)> EvaluateExpectAsync(string selector, string expectedState)
        {
            string script = $@"
(function() {{
    try {{
        let el = document.querySelector('{Escape(selector)}');
        let visible = !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        return JSON.stringify({{ found: !!el, visible: visible }});
    }} catch(ex) {{
        return JSON.stringify({{ found: false, visible: false, error: ex.message }});
    }}
}})();";

            string resJson = await _webView.ExecuteScriptAsync(script) ?? string.Empty;
            bool found = false;
            bool visible = false;
            try
            {
                // Same double-encoding as ExecuteClickOrInputAsync: outer layer is ExecuteScriptAsync's
                // own JSON encoding of the JS's JSON.stringify string return value.
                using var outerDoc = JsonDocument.Parse(resJson);
                using var innerDoc = JsonDocument.Parse(outerDoc.RootElement.GetString() ?? "{}");
                var root = innerDoc.RootElement;
                if (root.TryGetProperty("found", out var f) && (f.ValueKind == JsonValueKind.True || f.ValueKind == JsonValueKind.False))
                    found = f.GetBoolean();
                if (root.TryGetProperty("visible", out var v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False))
                    visible = v.GetBoolean();
            }
            catch (JsonException)
            {
                // found/visible stay false — surfaced via the detail/actual strings below.
            }

            bool passed = expectedState.ToLowerInvariant() switch
            {
                "hidden" => !found || !visible,
                "absent" or "removed" => !found,
                "present" or "exists" => found,
                _ => found && visible, // default expected state: "visible"
            };

            string detail = passed
                ? $"{selector} matched expected state '{expectedState}'"
                : $"{selector} did not match expected state '{expectedState}' (found={found}, visible={visible})";
            string actual = $"found={found}, visible={visible}";
            return (passed, detail, actual);
        }

        private static string Escape(string s) => (s ?? string.Empty).Replace("'", "\\'");

        private class CaptureResponseSpec
        {
            public string UrlPattern = string.Empty;
            public int? ExpectStatus;
            public string? ExpectJsonPath;
            public bool? ExpectExists;
            public bool? ExpectIsArray;
            /// <summary>Git #892 — the raw `expect` block (cloned so it outlives the parse's JsonDocument),
            /// handed to the shared HttpTestExecutor.EvaluateContentAssertions for containsAny/containsNone.</summary>
            public JsonElement? Expect;
            /// <summary>Git #892 — true when the expect block declares containsAny and/or containsNone, so the
            /// captured response body is read (CaptureNeedsBody) even when there's no jsonPath exists/isArray check.</summary>
            public bool HasContentAssertions;
        }

        private static CaptureResponseSpec? ParseCaptureResponse(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                var spec = new CaptureResponseSpec
                {
                    UrlPattern = root.TryGetProperty("urlPattern", out var u) ? u.GetString() ?? string.Empty : string.Empty
                };

                if (root.TryGetProperty("expect", out var expect))
                {
                    if (expect.TryGetProperty("status", out var st) && st.ValueKind == JsonValueKind.Number)
                        spec.ExpectStatus = st.GetInt32();
                    if (expect.TryGetProperty("jsonPath", out var jp))
                        spec.ExpectJsonPath = jp.GetString();
                    if (expect.TryGetProperty("exists", out var ex) && (ex.ValueKind == JsonValueKind.True || ex.ValueKind == JsonValueKind.False))
                        spec.ExpectExists = ex.GetBoolean();
                    if (expect.TryGetProperty("isArray", out var ia) && (ia.ValueKind == JsonValueKind.True || ia.ValueKind == JsonValueKind.False))
                        spec.ExpectIsArray = ia.GetBoolean();

                    // Git #892 — carry the raw expect block (cloned, so it survives this JsonDocument's
                    // disposal) for the shared content-assertion evaluator, and note whether either
                    // containsAny/containsNone is present so the body gets read below.
                    spec.Expect = expect.Clone();
                    spec.HasContentAssertions =
                        (expect.TryGetProperty("containsAny", out var ca) && ca.ValueKind == JsonValueKind.Array)
                        || (expect.TryGetProperty("containsNone", out var cn) && cn.ValueKind == JsonValueKind.Array);
                }

                return string.IsNullOrEmpty(spec.UrlPattern) ? null : spec;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>True when the captureResponse spec's assertions require reading the response body
        /// (a jsonPath exists/isArray check, or a #892 containsAny/containsNone content assertion) rather
        /// than just the status line.</summary>
        private static bool CaptureNeedsBody(CaptureResponseSpec spec) =>
            (!string.IsNullOrEmpty(spec.ExpectJsonPath) && (spec.ExpectExists.HasValue || spec.ExpectIsArray.HasValue))
            || spec.HasContentAssertions;

        /// <summary>Read a matched response's body exactly once — the WebView2 content stream can't be
        /// re-read, so the caller reads it here and hands the string to both the captureResponse
        /// assertions and #877's extract. Returns (body, null) on success or (null, error) on failure.</summary>
        private static async Task<(string? body, string? error)> ReadResponseBodyAsync(CoreWebView2WebResourceResponseReceivedEventArgs args)
        {
            try
            {
                using var stream = await args.Response.GetContentAsync();
                if (stream == null) return (string.Empty, null);
                using var reader = new StreamReader(stream);
                return (await reader.ReadToEndAsync(), null);
            }
            catch (Exception ex)
            {
                return (null, ex.Message);
            }
        }

        /// <summary>Git #877 — now takes an already-read response body (see <see cref="ReadResponseBodyAsync"/>)
        /// instead of reading the stream itself, so the same body can feed both these assertions and the
        /// step's extract without consuming the WebView2 content stream twice.</summary>
        private static UiCaptureResponseResult BuildCaptureResult(CaptureResponseSpec spec, CoreWebView2WebResourceResponseReceivedEventArgs? args, string? preReadBody, string? bodyReadError)
        {
            var result = new UiCaptureResponseResult { UrlPattern = spec.UrlPattern };
            var expectedParts = new List<string>();
            var actualParts = new List<string>();
            if (spec.ExpectStatus.HasValue) expectedParts.Add($"status={spec.ExpectStatus.Value}");
            if (spec.ExpectExists.HasValue) expectedParts.Add($"{spec.ExpectJsonPath} exists={spec.ExpectExists.Value}");
            if (spec.ExpectIsArray.HasValue) expectedParts.Add($"{spec.ExpectJsonPath} isArray={spec.ExpectIsArray.Value}");
            result.Expected = string.Join("; ", expectedParts);

            if (args == null)
            {
                result.Captured = false;
                result.Passed = false;
                result.Detail = $"No response matching '{spec.UrlPattern}' observed within {CaptureResponseTimeoutMs}ms.";
                result.Actual = "no matching response observed";
                return result;
            }

            result.Captured = true;
            result.Status = (int)args.Response.StatusCode;
            actualParts.Add($"status={result.Status}");

            bool passed = true;
            var details = new List<string>();

            if (spec.ExpectStatus.HasValue)
            {
                bool statusOk = result.Status == spec.ExpectStatus.Value;
                passed &= statusOk;
                details.Add(statusOk ? $"status={result.Status}" : $"status={result.Status} (expected {spec.ExpectStatus.Value})");
            }

            if (CaptureNeedsBody(spec))
            {
                if (bodyReadError != null)
                {
                    passed = false;
                    details.Add($"couldn't read response body: {bodyReadError}");
                }
                else
                {
                    // jsonPath exists/isArray — only meaningful against a non-empty JSON body and only when a
                    // jsonPath is actually declared (a #892 content-only assertion has no jsonPath to resolve).
                    if (!string.IsNullOrEmpty(preReadBody) && !string.IsNullOrEmpty(spec.ExpectJsonPath)
                        && (spec.ExpectExists.HasValue || spec.ExpectIsArray.HasValue))
                    {
                        try
                        {
                            using var bodyDoc = JsonDocument.Parse(preReadBody);
                            bool found = TryResolveJsonPath(bodyDoc.RootElement, spec.ExpectJsonPath!, out var resolved);

                            if (spec.ExpectExists.HasValue)
                            {
                                bool existsOk = found == spec.ExpectExists.Value;
                                passed &= existsOk;
                                details.Add(existsOk ? $"{spec.ExpectJsonPath} exists={found}" : $"{spec.ExpectJsonPath} exists={found} (expected {spec.ExpectExists.Value})");
                                actualParts.Add($"{spec.ExpectJsonPath} exists={found}");
                            }

                            if (spec.ExpectIsArray.HasValue)
                            {
                                bool isArray = found && resolved.ValueKind == JsonValueKind.Array;
                                bool arrayOk = isArray == spec.ExpectIsArray.Value;
                                passed &= arrayOk;
                                details.Add(arrayOk ? $"{spec.ExpectJsonPath} isArray={isArray}" : $"{spec.ExpectJsonPath} isArray={isArray} (expected {spec.ExpectIsArray.Value})");
                                actualParts.Add($"{spec.ExpectJsonPath} isArray={isArray}");
                            }
                        }
                        catch (Exception ex)
                        {
                            passed = false;
                            details.Add($"couldn't parse response body as JSON: {ex.Message}");
                        }
                    }

                    // Git #892 — containsAny/containsNone via the SAME shared evaluator apiTests/graphTests use,
                    // so the substring-matching semantics aren't a third copy living in the UI executor. Runs
                    // even on an empty body (an empty field correctly fails containsAny, passes containsNone).
                    if (spec.HasContentAssertions && spec.Expect.HasValue)
                    {
                        var contentProblems = new List<string>();
                        HttpTestExecutor.EvaluateContentAssertions(spec.Expect.Value, preReadBody ?? string.Empty, contentProblems, expectedParts, actualParts);
                        if (contentProblems.Count > 0)
                        {
                            passed = false;
                            details.AddRange(contentProblems);
                        }
                    }
                }
            }

            result.Passed = passed;
            // #892 — re-join Expected now that content assertions may have appended containsAny/containsNone.
            result.Expected = string.Join("; ", expectedParts);
            result.Detail = details.Count > 0
                ? $"{spec.UrlPattern} — {string.Join(", ", details)}"
                : $"{spec.UrlPattern} — captured (status {result.Status})";
            result.Actual = string.Join("; ", actualParts);
            return result;
        }

        /// <summary>Minimal dot-path resolver for the manifest schema's jsonPath examples ($.ticketId, $.value) — not a full JSONPath implementation, supports simple property.property[index] chains only.</summary>
        private static bool TryResolveJsonPath(JsonElement root, string jsonPath, out JsonElement value)
        {
            string path = jsonPath.TrimStart('$').TrimStart('.');
            var current = root;
            if (path.Length == 0)
            {
                value = current;
                return true;
            }

            foreach (var rawSegment in path.Split('.'))
            {
                string segment = rawSegment;
                int? index = null;
                int bracket = segment.IndexOf('[');
                if (bracket >= 0)
                {
                    string idxStr = segment.Substring(bracket + 1).TrimEnd(']');
                    if (int.TryParse(idxStr, out var idx)) index = idx;
                    segment = segment.Substring(0, bracket);
                }

                if (segment.Length > 0)
                {
                    if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                    {
                        value = default;
                        return false;
                    }
                }

                if (index.HasValue)
                {
                    if (current.ValueKind != JsonValueKind.Array || index.Value >= current.GetArrayLength())
                    {
                        value = default;
                        return false;
                    }
                    current = current[index.Value];
                }
            }

            value = current;
            return true;
        }

        /// <summary>Git #970 — resizes _webView's WPF Width/Height to simulate a mobile/tablet viewport
        /// (null restores the control to its default auto-stretch desktop size). No-ops when already at
        /// the requested size. Runs synchronously on the calling thread, which is always the UI thread
        /// here — RunAsync's whole await chain is kicked off from a UI-thread event handler, same as
        /// every other WebView2 call in this class.</summary>
        private void ApplyViewport(ViewportSpec? spec)
        {
            if (spec == null)
            {
                if (_appliedViewport == null) return;
                _webView.Width = double.NaN;
                _webView.Height = double.NaN;
                Emit("VIEWPORT", $"Restored default desktop viewport (was {_appliedViewport}).", "INFO", "#89B4FA");
                ActivityLog.Log("testing.viewport", $"Restored default desktop viewport (was {_appliedViewport}).");
                _appliedViewport = null;
                return;
            }

            if (spec.Matches(_appliedViewport)) return;

            _webView.Width = spec.Width;
            _webView.Height = spec.Height;
            Emit("VIEWPORT", $"Resized WebView2 to {spec}.", "INFO", "#89B4FA");
            ActivityLog.Log("testing.viewport", $"Resized WebView2 to {spec}.");
            _appliedViewport = spec;
        }

        private void Emit(string label, string detail, string level, string colorHex)
        {
            Telemetry?.Invoke(this, new UiTelemetryEvent { Label = label, Detail = detail, Level = level, ColorHex = colorHex });
        }
    }
}
