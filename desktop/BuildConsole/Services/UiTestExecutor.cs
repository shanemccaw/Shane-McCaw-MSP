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
        /// <summary>True when the run was HALTED early because a step marked `"critical": true` failed — as
        /// opposed to a run that simply finished with some non-critical failures (⚠ INCOMPLETE). When set, the
        /// steps AFTER the failing critical step were never executed (they are deliberately absent from
        /// <see cref="Steps"/>), and <see cref="AbortReason"/> / <see cref="StatusText"/> name which step failed
        /// and why. Distinct from Success so a consumer can tell "aborted at a prerequisite" apart from "ran to
        /// the end, some steps failed".</summary>
        public bool Aborted { get; set; }
        /// <summary>Human-readable reason the run aborted (the critical step's number/action/selector and its
        /// failure detail), empty when the run was not aborted. Also folded into <see cref="StatusText"/>.</summary>
        public string AbortReason { get; set; } = string.Empty;
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
        private const int CaptureResponseTimeoutMs = 20000;
        private const int PostNavigationSettleMs = 2000;
        private const int PostStepSettleMs = 1200;
        private const int NavigationTimeoutMs = 90000;
        /// <summary>Post-capture hang fix (Epic #803) — a hard ceiling on the best-effort #966/#977 WebView2
        /// screenshot capture. CoreWebView2.CapturePreviewAsync never completes when the control isn't in a
        /// renderable/composited state (a run triggered while BuildConsole is minimized/occluded/on a locked
        /// session), and it is the only await left in a step's post-capture path once the captureResponse wait
        /// has already timed out — so without this guard one un-renderable screenshot deadlocks the entire run
        /// forever (the try/catch around it cannot rescue a Task that never faults). Same
        /// Task.WhenAny(work, Task.Delay(timeout)) shape navigation (90s) and captureResponse (20s) already use.</summary>
        private const int ScreenshotTimeoutMs = 15000;
        /// <summary>Full-page screenshot support — bounds the JS scrollHeight query CaptureScreenshotAsync
        /// runs before every capture. Same hang class as ScreenshotTimeoutMs (ExecuteScriptAsync can stall
        /// when the control isn't in a renderable state) — guarded so a stuck height query degrades to a
        /// current-size capture instead of stalling the run.</summary>
        private const int FullPageHeightQueryTimeoutMs = 8000;
        /// <summary>Full-page screenshot support — how long to let the page settle (reflow/repaint) after
        /// resizing the WebView2 control to the full scrollHeight and before CapturePreviewAsync runs, so
        /// the capture doesn't land mid-reflow and show a partially-laid-out page.</summary>
        private const int FullPageResizeSettleMs = 250;
        /// <summary>Content-stream read hang guard (Epic #803) — a hard ceiling on EACH of the two awaits in
        /// <see cref="ReadResponseBodyAsync"/> (GetContentAsync, then ReadToEndAsync). A WebView2 content stream
        /// can stall indefinitely on either await (same hang class as the #803 screenshot/captureResponse cases),
        /// and once the captureResponse wait has resolved the body read is the last unguarded await that could
        /// deadlock a run — a never-completing Task never faults, so the method's try/catch cannot rescue it.
        /// Same Task.WhenAny(work, Task.Delay(timeout)) shape captureResponse (20s)/navigation (90s)/screenshot (15s)
        /// use; scaled to captureResponse's 20s since it reads that same captured response.</summary>
        private const int ResponseBodyReadTimeoutMs = 20000;
        /// <summary>Default bounded window an `expect` step polls the DOM for its condition (state and/or #1016
        /// textContains) before failing, when the step declares no `timeoutMs` of its own. Long enough to absorb
        /// Replit compilation/cold-starts, slow Wi-Fi latency, and async render/hydration that follows the prior action. Overridable per
        /// step via the manifest's uiSteps[].timeoutMs.</summary>
        private const int ExpectPollTimeoutMs = 30000;
        /// <summary>Interval between DOM re-checks inside the `expect` poll loop (see <see cref="ExpectPollTimeoutMs"/>).
        /// ~250ms keeps the loop responsive — it succeeds within a poll of the condition genuinely becoming true —
        /// without hammering ExecuteScriptAsync.</summary>
        private const int ExpectPollIntervalMs = 250;

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

        /// <summary>The base target URL passed to RunAsync, used to resolve relative goto steps.</summary>
        private string _targetUrl = string.Empty;

        /// <summary>Git #966 — absolute directory this run's screenshots are written into
        /// (test-results/{issue}-{timestamp}/screenshots), or null when the caller supplied none (capture
        /// disabled). Created lazily on the first capture so a passing, non-explicit run leaves no empty folder.</summary>
        private string? _screenshotDir;

        /// <summary>Git #966 — the in-flight run, so per-step capture can append to its Screenshots list
        /// (fed to TestRunnerWindow's gallery) from inside ExecuteStepAsync without threading it through.</summary>
        private UiTestRunResult? _run;

        public event EventHandler<UiTelemetryEvent>? Telemetry;

        /// <summary>Epic #803 — raised after each uiStep (goto/click/input/expect, …) completes, mirroring the
        /// static <c>StepCompleted</c> the api/graph/zoho/powershell executors already fire (HttpTestExecutor,
        /// GraphTestExecutor, ZohoTestExecutor, PowerShellTestExecutor). Before this, uiSteps were the one
        /// executor kind NOT on this spine — their live per-step signal came only from the UI-specific
        /// <see cref="Telemetry"/> "STEP N PASS/WARN" pattern, so a consumer that watches StepCompleted (e.g. a
        /// headless run reading nothing but this stream) never saw uiSteps at all, and a captureResponse that
        /// timed out to a null capture (an EXPECTED WARN/fail) was invisible in the stream. Now every uiStep the
        /// run executes raises exactly one combined <see cref="TestStepResult"/> here — including that
        /// null-capture case — carrying the step's real label/passed/detail/duration.</summary>
        public static event Action<TestStepResult>? StepCompleted;

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
            _targetUrl = targetUrl;
            _vars = vars ?? new TestRunVariables();
            _screenshotDir = string.IsNullOrWhiteSpace(screenshotDir) ? null : screenshotDir;

            // If the manifest starts with a goto step, start directly at that destination
            string initialUrl = targetUrl;
            if (steps.Count > 0 && steps[0].ActionType.Equals("goto", StringComparison.OrdinalIgnoreCase))
            {
                initialUrl = ResolveGotoTarget(steps[0].Selector);
            }

            var result = new UiTestRunResult { TargetUrl = initialUrl, TotalSteps = steps.Count };
            _run = result;

            Emit("START", $"Navigating to {initialUrl}", "INFO", "#89B4FA");
            ActivityLog.Log(Channel, $"Navigating to {initialUrl} ({steps.Count} step(s)).");

            try
            {
                await MainWindow.EnsureWebViewInitializedAsync(_webView);
                _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;

                // Target-scoped session isolation: ensure clean logged-out baseline for the app origin being tested,
                // NEVER touching replit.com, claude.ai, or other tabs in the shared profile.
                await EnsureLoggedOutForOriginAsync(initialUrl);

                if (!await NavigateAsync(initialUrl))
                {
                    Emit("NAV FAIL", "Page failed to load or encountered HTTP error.", "ERROR", "#F38BA8");
                    ActivityLog.Log(Channel, $"Navigation failed: {initialUrl}");
                    // Git #966 — a failed navigation is still worth a screenshot (the error page WebView2 rendered
                    // is exactly what a human reviewer would want to see); captured as step 0.
                    await CaptureScreenshotAsync(0, "navigation-failed", $"navigate {initialUrl}");
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

                    // Epic #803 — fire the static StepCompleted once per uiStep, matching the api/graph/zoho/
                    // powershell executors, so this step streams into the SAME live per-step TestStepResult spine
                    // (TestRunnerWindow.OnStepCompleted → AddStepResult + AdvanceStep) rather than only the UI's
                    // Telemetry pattern-match. Fires for EVERY executed step, including ExecuteStepAsync's
                    // early-return paths (an unresolved {{variable}} still returns a failed UiStepResult) and the
                    // captureResponse timeout/null-capture WARN — the case previously invisible in this stream.
                    // Uses the COMBINED verdict (stepResult.Passed), so the shared step cursor advances exactly as
                    // the retired "STEP N PASS/WARN" telemetry level did.
                    StepCompleted?.Invoke(BuildStepCompletedResult(stepResult));

                    // Critical-step abort: a step the manifest marks `"critical": true` is a prerequisite whose
                    // failure makes every subsequent step meaningless (e.g. a login that never succeeded — the
                    // real motivating case: #email/#password not found, then nine downstream `expect` steps each
                    // burned their full poll timeout, ~45s of pure waste, producing nine failures that are all
                    // really one root cause). Halt the whole run the instant such a step fails, naming which step
                    // and why, rather than continuing. Non-critical failures fall through and keep today's
                    // log-the-WARN-and-continue behaviour (steps[i].Critical is false), since seeing multiple
                    // independent failures in one pass is sometimes genuinely useful — this is opt-in per step,
                    // not a global behaviour change. The `finally` below still restores the viewport.
                    if (steps[i].Critical && !stepResult.Passed)
                    {
                        int skipped = steps.Count - (i + 1);
                        string reason = $"critical step {i + 1} ({stepResult.ActionType} {stepResult.Selector}) failed: {stepResult.Detail}";
                        result.PassedSteps = passed;
                        result.Success = false;
                        result.Aborted = true;
                        result.AbortReason = reason;
                        result.StatusText = $"❌ TEST ABORTED — {reason} ({passed}/{steps.Count} steps ran, {skipped} skipped)";
                        // Distinct from a normal per-step WARN: an ABORT level names the halt so it can't be mistaken
                        // for one more ordinary failing step in the live telemetry stream.
                        Emit("RUN ABORTED", $"Halting run — {reason}. {skipped} subsequent step(s) skipped (they could only pass if this step had).", "ERROR", "#F38BA8");
                        ActivityLog.Log(Channel, $"RUN ABORTED for {targetUrl} — {reason}. Halting immediately; {skipped} of {steps.Count} subsequent step(s) skipped rather than cascading downstream failures from this one root cause.");
                        return result;
                    }

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
            List<string> textPhrases;
            List<string> prefixCandidates;
            try
            {
                // Pause-on-unset (Epic #803, extends #953/#961) — before resolving this step, prompt for any
                // {{NAME}} it references (selector/value/textContains/textPrefixOfAny) whose Test Environment
                // Variable is still <unset>/needsReview, so the DOM action never operates on a bad "<unset>".
                // No-op when nothing is unset; a dismissal falls through to the VariableNotResolvedException
                // path below as a clear step failure.
                await _vars.PrepareAsync(step.Selector, step.Value, step.TextContains, step.TextPrefixOfAny);

                // #877 — resolve {{name}} placeholders in the step's target/selector and value
                // against earlier steps' extracted values BEFORE executing, so the DOM action
                // operates on the real value and never the literal "{{name}}" text.
                selector = _vars.Resolve(step.Selector);
                val = _vars.Resolve(step.Value);
                // Git #1016 — an `expect` step's textContains phrases can themselves reference a
                // {{name}} extracted by an earlier step (e.g. assert the DOM shows the exact value the
                // API returned), so resolve each phrase here in the same guarded block — an unresolved
                // one fails the step cleanly rather than asserting against the literal "{{name}}" text.
                textPhrases = ParseTextContains(step.TextContains);
                for (int ti = 0; ti < textPhrases.Count; ti++)
                    textPhrases[ti] = _vars.Resolve(textPhrases[ti]);
                // #1025 — textPrefixOfAny: resolve each phrase the same way, then expand it into candidate
                // entries. A `[*]`-wildcard extract (e.g. "$[*].leadText" → the whole real hero-headline set)
                // stores a SetDelimiter-joined blob under one {{name}}, so a single "{{heroLeads}}" phrase
                // fans out into every member here via SplitSet. A plain phrase with no delimiter is just a
                // one-element candidate. Unlike textContains (rendered text CONTAINS a phrase), these are
                // matched by a two-way prefix relationship in EvaluateExpectOnceAsync — see there.
                var prefixPhrases = ParseTextContains(step.TextPrefixOfAny);
                prefixCandidates = new List<string>();
                foreach (var raw in prefixPhrases)
                    prefixCandidates.AddRange(TestRunVariables.SplitSet(_vars.Resolve(raw)));
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
                armedNote += $" — also capturing response matching '{captureSpec.UrlPattern}' on {_webView.Source} (timeout {CaptureResponseTimeoutMs}ms)";
            if (hasExtract)
                armedNote += captureSpec != null ? "; extracting a value from that response on match" : " — extract declared but no captureResponse to extract from";

            Emit($"STEP {stepNumber}", $"{step.ActionTypeUpper}: {selector} {(string.IsNullOrEmpty(val) ? "" : "=> " + val)}{armedNote}", "RUNNING", "#89DCEB");
            ActivityLog.Log(Channel, $"Step {stepNumber} ({actionType} {selector}): starting{armedNote}.");

            TaskCompletionSource<CapturedResponse>? captureTcs = null;
            EventHandler<CoreWebView2WebResourceResponseReceivedEventArgs>? captureHandler = null;

            if (captureSpec != null)
            {
                // Armed before the step's own JS/navigation runs, per #809 — the UI action is what
                // actually triggers the network call this is meant to observe.
                captureTcs = new TaskCompletionSource<CapturedResponse>();
                captureHandler = (s, args) =>
                {
                    // Only the FIRST matching response is captured; ignore any later matches so we never
                    // kick off a second, never-consumed read for them.
                    if (captureTcs.Task.IsCompleted) return;
                    if (!args.Request.Uri.Contains(captureSpec.UrlPattern, StringComparison.OrdinalIgnoreCase)) return;

                    // #803 follow-on to #1011 — kick off the response body read IMMEDIATELY, here inside the
                    // WebResourceResponseReceived handler the instant the matching response arrives, instead of
                    // deferring it until after the outer capture Task.WhenAny resolves. `args.Response.GetContentAsync()`
                    // is therefore invoked synchronously within the event (ReadResponseBodyAsync runs to its first
                    // await before returning), and the resulting in-flight read Task is stored on the captured payload
                    // for the awaiting code to simply consume — not the raw event args.
                    //   HONEST SCOPE (verified against real Microsoft WebView2 docs before committing to this shape):
                    //   this is a DEFENSIVE (narrow the window in which the WebView2 content stream can go stale —
                    //   see WebView2Feedback #3283/#4298 where GetContentAsync errors on stale/redirected responses)
                    //   + DIAGNOSTIC change, NOT a documented-constraint fix. MS Learn's GetContentAsync Remarks
                    //   explicitly PERMIT deferred calls ("if this method is being called after a first call has
                    //   completed, it will return immediately"), and the real hang class is a *blocking stream read
                    //   awaiting data that never arrives* — already guarded by #1011's ResponseBodyReadTimeoutMs races.
                    var firedSw = System.Diagnostics.Stopwatch.StartNew();
                    Task<(string? body, string? error)>? readTask = null;
                    if (CaptureNeedsBody(captureSpec) || hasExtract)
                    {
                        ActivityLog.Log(Channel, $"Step {stepNumber}: matching response for [{captureSpec.UrlPattern}] received on {args.Request.Uri} — starting content read immediately in-handler (deferral eliminated).");
                        readTask = ReadResponseBodyAsync(args, firedSw, stepNumber);
                    }
                    captureTcs.TrySetResult(new CapturedResponse(args, readTask, firedSw));
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
                // If navigating to a login page, ensure we are logged out first so we don't get auto-redirected away
                if (target.IndexOf("/login", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    await EnsureLoggedOutForOriginAsync(target);
                }

                actionPassed = await NavigateAsync(target);
                actionDetail = actionPassed ? $"Navigated to {target}" : $"Navigation to {target} failed";
                actionExpected = $"navigation to {target} succeeds";
                actionActual = actionPassed ? "succeeded" : "failed (no NavigationCompleted success)";
            }
            else if (actionType == "logout" || actionType == "ensureloggedout")
            {
                string target = ResolveGotoTarget(selector);
                await EnsureLoggedOutForOriginAsync(target);
                actionPassed = true;
                actionDetail = "Logged out / cleared session tokens";
                actionExpected = "session tokens cleared";
                actionActual = "cleared";
            }
            else if (actionType == "expect")
            {
                string expectedState = string.IsNullOrWhiteSpace(val) ? "visible" : val;
                // Retry/polling — an `expect` re-checks the live DOM every ExpectPollIntervalMs across a bounded
                // window (the step's own timeoutMs override, else ExpectPollTimeoutMs) and passes the instant the
                // condition is genuinely observed, instead of #1016's single one-shot check that lost async
                // render/hydration timing races. A non-positive override falls back to the default window.
                int expectTimeoutMs = step.TimeoutMs is > 0 ? (int)step.TimeoutMs.Value : ExpectPollTimeoutMs;
                (actionPassed, actionDetail, actionActual) = await EvaluateExpectAsync(selector, expectedState, textPhrases, prefixCandidates, expectTimeoutMs, stepNumber);
                actionExpected = $"{selector} state == '{expectedState}'";
                // Git #1016 — when the step also asserts rendered text, record that in Expected too so the
                // results JSON shows the full contract that was checked, not just the state half.
                if (textPhrases.Count > 0)
                    actionExpected += $"; textContains any of [{string.Join(", ", textPhrases.ConvertAll(p => $"\"{p}\""))}]";
                // #1025 — likewise record the textPrefixOfAny contract (count only; the real set can be 50+
                // entries — the full list lives in the extract log, not every step's Expected string).
                if (prefixCandidates.Count > 0)
                    actionExpected += $"; textPrefixOfAny one of {prefixCandidates.Count} real entrie(s)";
            }
            else
            {
                int clickInputTimeoutMs = step.TimeoutMs is > 0 ? (int)step.TimeoutMs.Value : ExpectPollTimeoutMs;
                (actionPassed, actionDetail) = await ExecuteClickOrInputAsync(actionType, selector, step.TagName, val, clickInputTimeoutMs, stepNumber);
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
                var captured = completed == captureTcs.Task ? captureTcs.Task.Result : null;
                var capturedArgs = captured?.Args;
                bool captureMatched = capturedArgs != null;
                ActivityLog.Log(Channel, captureMatched
                    ? $"Step {stepNumber} captureResponse [{captureSpec.UrlPattern}] on {_webView.Source}: matched after {captureSw.ElapsedMilliseconds}ms."
                    : $"Step {stepNumber} captureResponse [{captureSpec.UrlPattern}] on {_webView.Source}: TIMED OUT after {captureSw.ElapsedMilliseconds}ms — no response matching '{captureSpec.UrlPattern}' was observed within the {CaptureResponseTimeoutMs}ms ceiling.");

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
                if (captured != null && capturedArgs != null && (CaptureNeedsBody(captureSpec) || hasExtract))
                {
                    // The read was already kicked off inside the WebResourceResponseReceived handler the instant the
                    // matching response arrived (captured.ReadTask). Here we simply await its result — logging how long
                    // elapsed between the event firing and the main flow reaching this consume point, so a future
                    // recurrence has real timing data instead of needing to be reasoned about from scratch. The
                    // ReadTask == null branch is a defensive fallback only (the handler always starts the read under the
                    // same CaptureNeedsBody||hasExtract condition, so it is not expected to be taken).
                    ActivityLog.Log(Channel, $"Step {stepNumber}: consuming in-flight response body read for [{captureSpec.UrlPattern}] — read was started in-handler; main flow resumed {captured.EventFiredElapsedMs}ms after the event fired.");
                    if (captured.ReadTask != null)
                        (capturedBody, bodyReadError) = await captured.ReadTask;
                    else
                        (capturedBody, bodyReadError) = await ReadResponseBodyAsync(capturedArgs, null, stepNumber);
                    ActivityLog.Log(Channel, $"Step {stepNumber}: response body read {(bodyReadError == null ? $"OK ({capturedBody?.Length ?? 0} chars)" : $"FAILED — {bodyReadError}")}.");
                }

                captureResult = BuildCaptureResult(captureSpec, capturedArgs, capturedBody, bodyReadError);
                Emit($"STEP {stepNumber} CAPTURE", captureResult.Detail, captureResult.Passed ? "PASS" : "WARN", captureResult.Passed ? "#A6E3A1" : "#FAB387");
                ActivityLog.Log(Channel, $"Step {stepNumber} captureResponse [{captureSpec.UrlPattern}] on {_webView.Source}: {(captureResult.Passed ? "PASS" : "WARN")} — {captureResult.Detail}");

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
        /// Returns the absolute PNG path, or empty string when capture was disabled (no directory) or failed.
        /// Full-page capture — CapturePreviewAsync only rasterizes the control's CURRENT on-screen size, i.e.
        /// the viewport, not the whole scrollable page. Before capturing, this grows the control's height to the
        /// page's real scrollHeight (same technique Playwright/Puppeteer use for full-page screenshots) so the
        /// entire page renders in one shot with nothing below the fold, then restores the original height
        /// immediately after — see GetFullPageHeightAsync/the resize block below. The whole resize→settle→capture→
        /// restore sequence runs as one unbroken `await` chain inside this single method call with no yield back
        /// to the caller in between, so it can't interleave with anything else touching this same WebView2 (e.g.
        /// a step's own selector-visibility check) — ExecuteStepAsync always awaits this call to completion before
        /// its own logic continues.</summary>
        private async Task<string> CaptureScreenshotAsync(int stepIndex, string reason, string stepLabel)
        {
            if (_screenshotDir == null) return string.Empty;
            // Git #995 — timed so a slow/hanging CapturePreviewAsync (this step feature runs invisibly
            // AFTER the step's own Stopwatch already stopped, per the #977 comment above this method's
            // caller) shows up in the log with its own real duration instead of being invisible time.
            var shotSw = System.Diagnostics.Stopwatch.StartNew();
            FileStream? stream = null;
            double? originalHeight = null;
            try
            {
                Directory.CreateDirectory(_screenshotDir);
                string path = Path.Combine(_screenshotDir, $"{stepIndex}.png");
                stream = new FileStream(path, FileMode.Create, FileAccess.Write);
                var localStream = stream;

                // Full-page resize — best-effort: a failed/timed-out height query just falls back to
                // capturing the control at whatever size it already is (the pre-existing viewport-only
                // behavior), same as a capture failure never fails the run.
                int? fullHeight = await GetFullPageHeightAsync(stepIndex);
                if (fullHeight.HasValue)
                {
                    originalHeight = _webView.Height;
                    _webView.Height = fullHeight.Value;
                    ActivityLog.Log(ScreenshotChannel, $"Step {stepIndex}: resized WebView2 to full page height {fullHeight.Value}px for capture (was {(double.IsNaN(originalHeight.Value) ? "auto" : originalHeight.Value.ToString())}).");
                    // Let the resize's reflow/repaint settle before capturing, so CapturePreviewAsync
                    // doesn't rasterize the page mid-layout.
                    await Task.Delay(FullPageResizeSettleMs);
                }

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
                // Restore the control's original height immediately, no matter how capture ended (success,
                // timeout, or exception) — a later step or the manual "Play" path sharing this same WebView2
                // must never inherit a stale full-page resize the same way #970's ApplyViewport(null) guards
                // against a stale viewport resize.
                if (originalHeight.HasValue)
                {
                    _webView.Height = originalHeight.Value;
                    ActivityLog.Log(ScreenshotChannel, $"Step {stepIndex}: restored WebView2 height after full-page capture.");
                }
                // Normal + exception paths dispose here (flushes the PNG to disk before the caller reads the path);
                // the timeout path already nulled `stream` and handed disposal to the continuation.
                stream?.Dispose();
            }
        }

        /// <summary>Full-page screenshot support — queries the live DOM's real scrollable height via JS
        /// injection, checking both document.body.scrollHeight and document.documentElement.scrollHeight (they
        /// can disagree depending on the page's box model / which element the overflowing content actually
        /// sits in) and taking whichever is larger — same check Playwright/Puppeteer's full-page capture uses.
        /// Bounded by FullPageHeightQueryTimeoutMs, same Task.WhenAny(work, Task.Delay(timeout)) shape every
        /// other WebView2 await in this class uses, so a hung ExecuteScriptAsync degrades to a current-size
        /// capture instead of stalling the run. Returns null (no resize should happen) on timeout, script
        /// error, or an unparsable/non-positive result.</summary>
        private async Task<int?> GetFullPageHeightAsync(int stepIndex)
        {
            const string script = @"
(function() {
    try {
        var body = document.body ? document.body.scrollHeight : 0;
        var html = document.documentElement ? document.documentElement.scrollHeight : 0;
        return Math.max(body, html);
    } catch (ex) {
        return 0;
    }
})();";

            try
            {
                var scriptTask = _webView.ExecuteScriptAsync(script);
                var completed = await Task.WhenAny(scriptTask, Task.Delay(FullPageHeightQueryTimeoutMs));
                if (completed != scriptTask)
                {
                    ActivityLog.Log(ScreenshotChannel, $"Step {stepIndex}: full-page height query timed out after {FullPageHeightQueryTimeoutMs}ms — capturing at current size instead.");
                    return null;
                }

                string resJson = await scriptTask ?? string.Empty;
                return int.TryParse(resJson, out int height) && height > 0 ? height : null;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(ScreenshotChannel, $"Step {stepIndex}: full-page height query failed — {ex.Message}. Capturing at current size instead.");
                return null;
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
        /// <summary>Git #832 — must call CoreWebView2.Navigate(url), NOT set _webView.Source. Source is a WPF
        /// DependencyProperty, and WPF skips the property-changed callback (so never triggers navigation) when
        /// the new value equals the current one — a goto step resolving to the already-loaded URL (e.g. a
        /// manifest's opening "goto /" right after this method's own initial navigation to that same URL) left
        /// NavigationCompleted never firing and the whole run deadlocked forever with no error. Navigate() is a
        /// direct native call that always performs a real navigation regardless of URL equality.</summary>
        private async Task<bool> NavigateAsync(string url)
        {
            const int maxAttempts = 3;
            for (int attempt = 1; attempt <= maxAttempts; attempt++)
            {
                if (attempt > 1)
                {
                    ActivityLog.Log(Channel, $"NavigateAsync: retrying navigation to {url} (attempt {attempt}/{maxAttempts}) after Wi-Fi / compile pause…");
                    await Task.Delay(2500);
                }

                bool ok = await NavigateInternalAsync(url);
                if (ok) return true;

                if (attempt < maxAttempts)
                {
                    ActivityLog.Log(Channel, $"NavigateAsync({url}) attempt {attempt} failed; retrying in 2.5s…");
                }
            }
            return false;
        }

        private async Task<bool> NavigateInternalAsync(string url)
        {
            if (_webView.CoreWebView2 == null)
            {
                await _webView.EnsureCoreWebView2Async();
            }

            var tcs = new TaskCompletionSource<bool>();
            void CoreNavHandler(object? s, CoreWebView2NavigationCompletedEventArgs args)
            {
                Detach();
                if (!args.IsSuccess)
                {
                    ActivityLog.Log(Channel, $"NavigateAsync({url}) completed with error status: {args.WebErrorStatus} (http status {args.HttpStatusCode})");
                }
                else
                {
                    ActivityLog.Log(Channel, $"NavigateAsync({url}) completed successfully (http status {args.HttpStatusCode})");
                }
                tcs.TrySetResult(args.IsSuccess);
            }

            void WpfNavHandler(object? s, CoreWebView2NavigationCompletedEventArgs args)
            {
                Detach();
                if (!args.IsSuccess)
                {
                    ActivityLog.Log(Channel, $"NavigateAsync({url}) [WPF] completed with error status: {args.WebErrorStatus} (http status {args.HttpStatusCode})");
                }
                tcs.TrySetResult(args.IsSuccess);
            }

            void Detach()
            {
                try
                {
                    if (_webView.CoreWebView2 != null)
                        _webView.CoreWebView2.NavigationCompleted -= CoreNavHandler;
                }
                catch { }
                try
                {
                    _webView.NavigationCompleted -= WpfNavHandler;
                }
                catch { }
            }

            if (_webView.CoreWebView2 != null)
                _webView.CoreWebView2.NavigationCompleted += CoreNavHandler;
            _webView.NavigationCompleted += WpfNavHandler;

            try
            {
                ActivityLog.Log(Channel, $"NavigateAsync: calling CoreWebView2.Navigate({url})");
                _webView.CoreWebView2.Navigate(url);
            }
            catch (Exception ex)
            {
                Detach();
                ActivityLog.Log(Channel, $"NavigateAsync({url}) exception: {ex.Message}");
                return false;
            }

            var completed = await Task.WhenAny(tcs.Task, Task.Delay(NavigationTimeoutMs));
            if (completed != tcs.Task)
            {
                Detach();
                string currentSource = _webView.CoreWebView2?.Source ?? "unknown";
                ActivityLog.Log(Channel, $"Navigation to {url} timed out after {NavigationTimeoutMs}ms (NavigationCompleted never fired). Current Source: '{currentSource}'");
                return false;
            }

            return await tcs.Task;
        }

        private string ResolveGotoTarget(string target)
        {
            if (Uri.TryCreate(target, UriKind.Absolute, out var abs)) return abs.ToString();

            // Try resolving against the base targetUrl first, then CoreWebView2's current location, then Source
            string? baseStr = !string.IsNullOrWhiteSpace(_targetUrl) ? _targetUrl : _webView.CoreWebView2?.Source;
            if (string.IsNullOrWhiteSpace(baseStr) || baseStr == "about:blank")
                baseStr = _webView.Source?.ToString();

            if (!string.IsNullOrWhiteSpace(baseStr) && Uri.TryCreate(baseStr, UriKind.Absolute, out var baseUri))
            {
                if (Uri.TryCreate(baseUri, target, out var combined))
                    return combined.ToString();
            }

            return target;
        }

        /// <summary>Ensures any existing authenticated session on the target app origin is cleanly logged out (clearing app cookies, storage, and firing server logout) without affecting other domains in the shared WebView2 profile.</summary>
        private async Task EnsureLoggedOutForOriginAsync(string url)
        {
            if (_webView.CoreWebView2 == null) return;
            try
            {
                if (Uri.TryCreate(url, UriKind.Absolute, out var targetUri))
                {
                    var originUrl = $"{targetUri.Scheme}://{targetUri.Authority}";
                    var appCookies = await _webView.CoreWebView2.CookieManager.GetCookiesAsync(originUrl);
                    foreach (var cookie in appCookies)
                    {
                        _webView.CoreWebView2.CookieManager.DeleteCookie(cookie);
                    }

                    try
                    {
                        await _webView.CoreWebView2.ExecuteScriptAsync(@$"
(function() {{
    try {{
        if (window.location.origin === '{originUrl}') {{
            localStorage.clear();
            sessionStorage.clear();
            fetch('/api/auth/logout', {{ method: 'POST' }}).catch(function(){{}});
        }}
    }} catch (_) {{}}
}})();");
                    }
                    catch { }

                    ActivityLog.Log(Channel, $"EnsureLoggedOut: cleared {appCookies.Count} cookie(s) and storage for '{originUrl}'.");
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"EnsureLoggedOut warning: {ex.Message}");
            }
        }

        /// <summary>Same JS find/highlight/click/input pattern AutomationRunnerWindow always used — unchanged behavior for manually-recorded steps.</summary>
        /// <summary>Same JS find/highlight/click/input pattern AutomationRunnerWindow always used — runs a single attempt against the live DOM.</summary>
        private async Task<(bool passed, string detail)> ExecuteClickOrInputOnceAsync(string actionType, string selector, string tagName, string val)
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

        /// <summary>Polls the DOM for the target element to become available and execute the click or input action,
        /// absorbing in-flight client-side redirects (e.g. /login -> /portal/login) or async route rendering.</summary>
        private async Task<(bool passed, string detail)> ExecuteClickOrInputAsync(
            string actionType, string selector, string tagName, string val, int timeoutMs, int stepNumber)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            int attempts = 0;
            (bool passed, string detail) last = (false, string.Empty);
            while (true)
            {
                attempts++;
                last = await ExecuteClickOrInputOnceAsync(actionType, selector, tagName, val);
                if (last.passed)
                {
                    sw.Stop();
                    if (attempts > 1)
                    {
                        ActivityLog.Log(Channel, $"Step {stepNumber} {actionType} [{selector}]: element became available and executed after {sw.ElapsedMilliseconds}ms ({attempts} attempts)");
                    }
                    return last;
                }

                long remaining = timeoutMs - sw.ElapsedMilliseconds;
                if (remaining <= 0)
                {
                    sw.Stop();
                    ActivityLog.Log(Channel, $"Step {stepNumber} {actionType} [{selector}]: EXHAUSTED {timeoutMs}ms waiting for element ({attempts} attempts) — {last.detail}");
                    return last;
                }
                await Task.Delay((int)Math.Min(ExpectPollIntervalMs, remaining));
            }
        }

        /// <summary>Retry/polling wrapper around <see cref="EvaluateExpectOnceAsync"/>. Re-checks the live DOM
        /// every <see cref="ExpectPollIntervalMs"/> for up to <paramref name="timeoutMs"/> and returns the moment
        /// the condition is genuinely observed (both the state half AND, when declared, #1016's textContains half),
        /// rather than checking exactly once. This is what lets an `expect` survive the async render/hydration that
        /// commonly follows the prior action — the DOM the previous step touched is often not settled the instant
        /// that step returns, so a single one-shot check raced it and failed spuriously. On the passing path it logs
        /// how long the poll actually took (and how many attempts); on exhaustion it logs that the whole window
        /// elapsed without the condition ever being observed, and returns the last (failing) evaluation, annotated
        /// with the poll duration/attempt count so the results JSON says plainly it was polled, not glanced at once.</summary>
        private async Task<(bool passed, string detail, string actual)> EvaluateExpectAsync(
            string selector, string expectedState, IReadOnlyList<string>? textContains, IReadOnlyList<string>? prefixOfAny, int timeoutMs, int stepNumber)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            int attempts = 0;
            (bool passed, string detail, string actual) last = (false, string.Empty, string.Empty);
            while (true)
            {
                attempts++;
                last = await EvaluateExpectOnceAsync(selector, expectedState, textContains, prefixOfAny);
                if (last.passed)
                {
                    sw.Stop();
                    ActivityLog.Log(Channel, $"Step {stepNumber} expect [{selector}]: condition met after {sw.ElapsedMilliseconds}ms " +
                        $"({attempts} attempt{(attempts == 1 ? "" : "s")}, polling every {ExpectPollIntervalMs}ms, {timeoutMs}ms budget) — {last.detail}");
                    return last;
                }

                long remaining = timeoutMs - sw.ElapsedMilliseconds;
                if (remaining <= 0)
                {
                    sw.Stop();
                    ActivityLog.Log(Channel, $"Step {stepNumber} expect [{selector}]: EXHAUSTED {timeoutMs}ms window after {sw.ElapsedMilliseconds}ms " +
                        $"({attempts} attempt{(attempts == 1 ? "" : "s")}) — condition never observed. Last: {last.detail}");
                    string polledNote = $" [polled {sw.ElapsedMilliseconds}ms / {attempts} attempt{(attempts == 1 ? "" : "s")}, {timeoutMs}ms budget exhausted]";
                    return (false, last.detail + polledNote, last.actual);
                }
                await Task.Delay((int)Math.Min(ExpectPollIntervalMs, remaining));
            }
        }

        /// <summary>Evaluates an `expect` uiStep ONCE against the current DOM (the poll loop in
        /// <see cref="EvaluateExpectAsync"/> calls this repeatedly). Asserts the element's <paramref name="expectedState"/>
        /// (visible/hidden/present/absent), and — Git #1016 — when <paramref name="textContains"/> is
        /// non-empty, ALSO asserts the element's REAL rendered text (el.innerText ?? el.textContent) contains
        /// at least one of the phrases (case-insensitive substring, any-of). Both halves must pass. Before
        /// this, `expect` was presence-only: a `textContains` in a manifest was silently ignored (see the note
        /// in test-manifests/copilot-readiness/remediation-tracker-e2e.json), so a manifest could never assert
        /// that the DOM genuinely DISPLAYS a value — only that some element exists. The text is pulled straight
        /// out of the live DOM via the same JS-injection path the state check already uses.
        ///
        /// Git #1025 — <paramref name="prefixOfAny"/> adds a THIRD, orthogonal assertion for content that is
        /// randomized and/or rendered progressively (the hero headline: shuffled from a 50-entry set and typed
        /// out one character at a time, so at any instant the element shows a PARTIAL slice of a RANDOM entry).
        /// containsAny can't express that — "rendered CONTAINS entry" only holds once a whole entry has finished
        /// typing, and a fixed phrase list can't enumerate a shuffled runtime set. Instead this passes when the
        /// element's rendered text shares a PREFIX relationship with at least one candidate entry: the shorter of
        /// (rendered, entry) is a prefix of the longer (case-insensitive), which is true both while an entry is
        /// mid-type (rendered ⊑ entry) and once typing has run past the entry into its gradient tail (entry ⊑
        /// rendered). Empty rendered text never matches (an empty headline element isn't a genuine headline). All three
        /// assertions (state, textContains, prefixOfAny) must pass; each is independently optional.</summary>
        private async Task<(bool passed, string detail, string actual)> EvaluateExpectOnceAsync(string selector, string expectedState, IReadOnlyList<string>? textContains, IReadOnlyList<string>? prefixOfAny)
        {
            string script = $@"
(function() {{
    try {{
        let el = document.querySelector('{Escape(selector)}');
        let visible = !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        let text = el ? (el.innerText || el.textContent || '') : '';
        return JSON.stringify({{ found: !!el, visible: visible, text: text }});
    }} catch(ex) {{
        return JSON.stringify({{ found: false, visible: false, text: '', error: ex.message }});
    }}
}})();";

            string resJson = await _webView.ExecuteScriptAsync(script) ?? string.Empty;
            bool found = false;
            bool visible = false;
            string text = string.Empty;
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
                if (root.TryGetProperty("text", out var t) && t.ValueKind == JsonValueKind.String)
                    text = t.GetString() ?? string.Empty;
            }
            catch (JsonException)
            {
                // found/visible/text stay at their defaults — surfaced via the detail/actual strings below.
            }

            bool stateOk = expectedState.ToLowerInvariant() switch
            {
                "hidden" => !found || !visible,
                "absent" or "removed" => !found,
                "present" or "exists" => found,
                _ => found && visible, // default expected state: "visible"
            };

            // Git #1016 — real DOM-text assertion. Any-of, case-insensitive substring against the element's
            // rendered text, matching the substring semantics HttpTestExecutor.EvaluateContentAssertions'
            // containsAny already uses for response bodies. Empty list => no text assertion (state-only).
            bool textOk = true;
            string? textHit = null;
            bool hasTextAssertion = textContains != null && textContains.Count > 0;
            if (hasTextAssertion)
            {
                foreach (var phrase in textContains!)
                {
                    if (!string.IsNullOrEmpty(phrase) && text.IndexOf(phrase, StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        textHit = phrase;
                        break;
                    }
                }
                textOk = textHit != null;
            }

            // #1025 — prefix-relationship assertion (see the method summary). Passes when the non-empty
            // rendered text and some candidate entry are prefix-related (shorter is a prefix of the longer,
            // case-insensitive) — the match that survives the hero headline's shuffle + per-character typing.
            bool prefixOk = true;
            string? prefixHit = null;
            bool hasPrefixAssertion = prefixOfAny != null && prefixOfAny.Count > 0;
            if (hasPrefixAssertion)
            {
                string rendered = text.Trim();
                if (rendered.Length > 0)
                {
                    foreach (var entry in prefixOfAny!)
                    {
                        string e = (entry ?? string.Empty).Trim();
                        if (e.Length == 0) continue;
                        string shorter = rendered.Length <= e.Length ? rendered : e;
                        string longer = rendered.Length <= e.Length ? e : rendered;
                        if (longer.StartsWith(shorter, StringComparison.OrdinalIgnoreCase))
                        {
                            prefixHit = entry;
                            break;
                        }
                    }
                }
                prefixOk = prefixHit != null;
            }

            bool passed = stateOk && textOk && prefixOk;

            var parts = new List<string>();
            parts.Add(stateOk
                ? $"state '{expectedState}' matched (found={found}, visible={visible})"
                : $"state '{expectedState}' NOT matched (found={found}, visible={visible})");
            if (hasTextAssertion)
                parts.Add(textOk
                    ? $"text contained \"{textHit}\""
                    : $"text contained none of [{string.Join(", ", ToQuoted(textContains!))}]");
            if (hasPrefixAssertion)
                parts.Add(prefixOk
                    ? $"text is a prefix-match of real entry \"{CollapsePreview(prefixHit ?? string.Empty, 80)}\""
                    : $"text is a prefix-match of none of the {prefixOfAny!.Count} real entrie(s)");

            string preview = CollapsePreview(text, 200);
            string detail = $"{selector} — {string.Join("; ", parts)}";
            string actual = $"found={found}, visible={visible}" + (hasTextAssertion || hasPrefixAssertion ? $"; text=\"{preview}\"" : string.Empty);
            return (passed, detail, actual);
        }

        /// <summary>Git #1016 — parse a uiStep's raw `textContains` JSON into the list of phrases to assert.
        /// Accepts either a single string ("ready") or an array of strings (["a","b"]); any other shape (or
        /// malformed JSON) yields an empty list, i.e. no text assertion. Blank entries are dropped.</summary>
        private static List<string> ParseTextContains(string? json)
        {
            var list = new List<string>();
            if (string.IsNullOrWhiteSpace(json)) return list;
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.String)
                {
                    string? s = root.GetString();
                    if (!string.IsNullOrEmpty(s)) list.Add(s);
                }
                else if (root.ValueKind == JsonValueKind.Array)
                {
                    foreach (var el in root.EnumerateArray())
                        if (el.ValueKind == JsonValueKind.String)
                        {
                            string? s = el.GetString();
                            if (!string.IsNullOrEmpty(s)) list.Add(s);
                        }
                }
            }
            catch (JsonException)
            {
                // Malformed textContains JSON — treated the same as "no text assertion declared".
            }
            return list;
        }

        private static List<string> ToQuoted(IReadOnlyList<string> items)
        {
            var quoted = new List<string>(items.Count);
            foreach (var s in items) quoted.Add($"\"{s}\"");
            return quoted;
        }

        /// <summary>Whitespace-collapsed, length-capped preview of an element's rendered text, for the
        /// failure detail/actual strings (the typewritten hero headline, for instance, is multi-line and
        /// noisy — collapse it so a miss is diagnosable from one log line).</summary>
        private static string CollapsePreview(string s, int max)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            var collapsed = System.Text.RegularExpressions.Regex.Replace(s, @"\s+", " ").Trim();
            return collapsed.Length > max ? collapsed.Substring(0, max) + "..." : collapsed;
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

        /// <summary>#803 follow-on — the payload the captureResponse <see cref="TaskCompletionSource{TResult}"/> now
        /// carries instead of the raw event args: the matched <see cref="CoreWebView2WebResourceResponseReceivedEventArgs"/>,
        /// the in-flight body-read <see cref="Task"/> kicked off immediately inside the WebResourceResponseReceived
        /// handler (null when the step needs no body), and a stopwatch started the instant that event fired so the
        /// awaiting code can log how long elapsed before it resumed to consume the result.</summary>
        private sealed class CapturedResponse
        {
            public CoreWebView2WebResourceResponseReceivedEventArgs Args { get; }
            public Task<(string? body, string? error)>? ReadTask { get; }
            private readonly System.Diagnostics.Stopwatch _eventFiredSw;

            public CapturedResponse(CoreWebView2WebResourceResponseReceivedEventArgs args, Task<(string? body, string? error)>? readTask, System.Diagnostics.Stopwatch eventFiredSw)
            {
                Args = args;
                ReadTask = readTask;
                _eventFiredSw = eventFiredSw;
            }

            /// <summary>Milliseconds elapsed since the WebResourceResponseReceived event fired (the stopwatch keeps
            /// running; read it at consume time to see how long the main flow took to pick the result up).</summary>
            public long EventFiredElapsedMs => _eventFiredSw.ElapsedMilliseconds;
        }

        /// <summary>Read a matched response's body exactly once — the WebView2 content stream can't be
        /// re-read, so the caller reads it here and hands the string to both the captureResponse
        /// assertions and #877's extract. Returns (body, null) on success or (null, error) on failure.
        /// #803 follow-on — now started IMMEDIATELY from inside the WebResourceResponseReceived handler
        /// (so GetContentAsync runs synchronously within the event); <paramref name="eventFiredSw"/> is the
        /// stopwatch started when that event fired (null when called on the deferred fallback path) and
        /// <paramref name="stepNumber"/> is used only for log correlation.</summary>
        private static async Task<(string? body, string? error)> ReadResponseBodyAsync(CoreWebView2WebResourceResponseReceivedEventArgs args, System.Diagnostics.Stopwatch? eventFiredSw, int stepNumber)
        {
            // Epic #803 — GetContentAsync() and ReadToEndAsync() are the two awaits on the WebView2 content
            // stream, and EITHER can stall indefinitely if the underlying stream never delivers (same hang
            // class as the #803 screenshot/captureResponse cases). Guard BOTH with the same
            // Task.WhenAny(work, Task.Delay(timeout)) shape the rest of this file uses so a stuck read can
            // never hang the whole run — on timeout, return a clear (null, "…timed out after Xms") result and
            // let the caller continue instead of awaiting forever. A never-completing Task never faults, so the
            // try/catch below alone cannot rescue this — the timeout race is what makes it recoverable.
            var sw = System.Diagnostics.Stopwatch.StartNew();
            // #803 follow-on — record how long elapsed between the WebResourceResponseReceived event firing and this
            // read actually being ATTEMPTED. On the new in-handler path this is ~0ms, which is the whole point; the
            // number is logged regardless so a future investigation can SEE whether the read was prompt (and, if this
            // method is ever called on the deferred fallback path again, exactly how long it was delayed) rather than
            // having to reason about the deferral from scratch.
            if (eventFiredSw != null)
                ActivityLog.Log(Channel, $"Step {stepNumber}: ReadResponseBodyAsync entered {eventFiredSw.ElapsedMilliseconds}ms after the WebResourceResponseReceived event fired — invoking GetContentAsync now.");
            try
            {
                // Stage 1 — obtain the content stream.
                var getContentTask = args.Response.GetContentAsync();
                var stage1 = await Task.WhenAny(getContentTask, Task.Delay(ResponseBodyReadTimeoutMs));
                if (stage1 != getContentTask)
                {
                    sw.Stop();
                    // Task.Delay won. A late (or never) GetContentAsync still owns a stream we'll never read —
                    // dispose it (and observe any fault) in a continuation so it neither leaks nor surfaces as
                    // an unobserved-task exception. Then return a timeout result; the step completes.
                    _ = getContentTask.ContinueWith(t =>
                    {
                        if (t.Status == TaskStatus.RanToCompletion) t.Result?.Dispose();
                        else _ = t.Exception; // observe
                    }, TaskScheduler.Default);
                    var msg = $"GetContentAsync timed out after {ResponseBodyReadTimeoutMs}ms";
                    ActivityLog.Log(Channel, $"ReadResponseBodyAsync: {msg} — Task.Delay won the race at {sw.ElapsedMilliseconds}ms; WebView2 content stream never delivered. Returning a timeout result so the step can complete instead of hanging.");
                    return (null, msg);
                }

                var stream = getContentTask.Result;
                if (stream == null)
                {
                    sw.Stop();
                    ActivityLog.Log(Channel, $"ReadResponseBodyAsync: GetContentAsync resolved to a null stream after {sw.ElapsedMilliseconds}ms (empty body).");
                    return (string.Empty, null);
                }
                ActivityLog.Log(Channel, $"ReadResponseBodyAsync: GetContentAsync resolved in {sw.ElapsedMilliseconds}ms — reading body.");

                // Stage 2 — read the stream to the end. (No `using`: on the timeout path a still-in-flight read
                // must own disposal via a continuation, otherwise disposing the stream out from under it here
                // throws — so disposal is handled explicitly on every path below instead.)
                var reader = new StreamReader(stream);
                var readTask = reader.ReadToEndAsync();
                var stage2 = await Task.WhenAny(readTask, Task.Delay(ResponseBodyReadTimeoutMs));
                if (stage2 != readTask)
                {
                    sw.Stop();
                    // Task.Delay won. The read is still in flight against reader/stream — hand disposal to a
                    // continuation (and observe the eventual result/fault) rather than disposing here, so we
                    // never tear the stream out from under a pending read.
                    _ = readTask.ContinueWith(t =>
                    {
                        _ = t.Exception; // observe
                        reader.Dispose();
                        stream.Dispose();
                    }, TaskScheduler.Default);
                    var msg = $"ReadToEndAsync timed out after {ResponseBodyReadTimeoutMs}ms";
                    ActivityLog.Log(Channel, $"ReadResponseBodyAsync: {msg} — Task.Delay won the race at {sw.ElapsedMilliseconds}ms; content stream opened but never finished delivering. Returning a timeout result so the step can complete instead of hanging.");
                    return (null, msg);
                }

                var body = readTask.Result;
                sw.Stop();
                reader.Dispose(); // disposes the underlying stream too
                ActivityLog.Log(Channel, $"ReadResponseBodyAsync: body read complete in {sw.ElapsedMilliseconds}ms ({body?.Length ?? 0} chars).");
                return (body, null);
            }
            catch (Exception ex)
            {
                sw.Stop();
                ActivityLog.Log(Channel, $"ReadResponseBodyAsync: FAILED after {sw.ElapsedMilliseconds}ms — {ex.Message}");
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

        /// <summary>Epic #803 — builds the single combined <see cref="TestStepResult"/> raised on
        /// <see cref="StepCompleted"/> for one finished uiStep. Deliberately ONE entry per step (the step list
        /// has one row per uiStep, and OnStepCompleted advances the shared cursor once per firing), unlike
        /// <see cref="UiTestRunResult.ToTestStepResults"/> which splits the file record into a separate
        /// captureResponse entry plus the action entry. <see cref="TestStepResult.Passed"/> is the step's
        /// COMBINED verdict (<see cref="UiStepResult.Passed"/> = action AND captureResponse AND extract/duration),
        /// so the row is marked exactly as the retired "STEP N PASS/WARN" telemetry level did; and the capture's
        /// own outcome is folded into Detail so a consumer that sees nothing but this stream (a headless run)
        /// still gets the full story on the null-capture WARN.</summary>
        private static TestStepResult BuildStepCompletedResult(UiStepResult step)
        {
            string detail = step.CaptureResponse != null
                ? $"{step.Detail} | captureResponse: {step.CaptureResponse.Detail}"
                : step.Detail;

            return new TestStepResult
            {
                Kind = "ui",
                Label = $"{step.ActionType} {step.Selector}",
                Passed = step.Passed,
                Detail = detail,
                DurationMs = step.DurationMs,
                Expected = step.Expected,
                Actual = step.Actual,
                Context = $"step {step.Index}: {step.ActionType} on selector '{step.Selector}'"
                    + (step.CaptureResponse != null
                        ? $"; captureResponse [{step.CaptureResponse.UrlPattern}] status={step.CaptureResponse.Status?.ToString() ?? "none"}"
                        : string.Empty),
                ScreenshotPath = step.ScreenshotPath,
            };
        }
    }
}
