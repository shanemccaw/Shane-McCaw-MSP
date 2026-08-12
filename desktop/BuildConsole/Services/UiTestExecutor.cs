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
        private const int CaptureResponseTimeoutMs = 5000;
        private const int PostNavigationSettleMs = 1200;
        private const int PostStepSettleMs = 1000;

        private readonly WebView2 _webView;

        public event EventHandler<UiTelemetryEvent>? Telemetry;

        public UiTestExecutor(WebView2 webView)
        {
            _webView = webView;
        }

        public async Task<UiTestRunResult> RunAsync(string targetUrl, IReadOnlyList<Controls.AutomationAction> steps)
        {
            var result = new UiTestRunResult { TargetUrl = targetUrl, TotalSteps = steps.Count };

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
                    result.Success = false;
                    result.StatusText = "❌ TEST FAILED (Navigation Error)";
                    return result;
                }

                Emit("NAV OK", "Page loaded successfully.", "SUCCESS", "#A6E3A1");
                await Task.Delay(PostNavigationSettleMs);

                int passed = 0;
                for (int i = 0; i < steps.Count; i++)
                {
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
        }

        private async Task<UiStepResult> ExecuteStepAsync(int stepNumber, Controls.AutomationAction step)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            string actionType = step.ActionType.ToLowerInvariant();
            string selector = step.Selector;
            string val = step.Value;

            Emit($"STEP {stepNumber}", $"{step.ActionTypeUpper}: {selector} {(string.IsNullOrEmpty(val) ? "" : "=> " + val)}", "RUNNING", "#89DCEB");

            var captureSpec = ParseCaptureResponse(step.CaptureResponse);
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
            if (captureSpec != null && captureTcs != null && captureHandler != null)
            {
                var completed = await Task.WhenAny(captureTcs.Task, Task.Delay(CaptureResponseTimeoutMs));
                _webView.CoreWebView2.WebResourceResponseReceived -= captureHandler;

                captureResult = await BuildCaptureResultAsync(captureSpec, completed == captureTcs.Task ? captureTcs.Task.Result : null);
                Emit($"STEP {stepNumber} CAPTURE", captureResult.Detail, captureResult.Passed ? "PASS" : "WARN", captureResult.Passed ? "#A6E3A1" : "#FAB387");
                ActivityLog.Log(Channel, $"Step {stepNumber} captureResponse [{captureSpec.UrlPattern}]: {(captureResult.Passed ? "PASS" : "WARN")} — {captureResult.Detail}");
            }

            // captureResponse is asserted separately (above) from the step's own UI assertion (below), per #809.
            bool overallPassed = actionPassed && (captureResult == null || captureResult.Passed);
            Emit(overallPassed ? $"STEP {stepNumber} PASS" : $"STEP {stepNumber} WARN", actionDetail, overallPassed ? "PASS" : "WARN", overallPassed ? "#A6E3A1" : "#FAB387");
            ActivityLog.Log(Channel, $"Step {stepNumber} ({actionType} {selector}): {(overallPassed ? "PASS" : "WARN")} — {actionDetail}");

            sw.Stop();
            return new UiStepResult
            {
                Index = stepNumber,
                ActionType = actionType,
                Selector = selector,
                ActionPassed = actionPassed,
                Passed = overallPassed,
                Detail = actionDetail,
                DurationMs = sw.ElapsedMilliseconds,
                CaptureResponse = captureResult,
                Expected = actionExpected,
                Actual = actionActual,
            };
        }

        private async Task<bool> NavigateAsync(string url)
        {
            var tcs = new TaskCompletionSource<bool>();
            void NavHandler(object? s, CoreWebView2NavigationCompletedEventArgs args)
            {
                _webView.NavigationCompleted -= NavHandler;
                tcs.TrySetResult(args.IsSuccess);
            }

            _webView.NavigationCompleted += NavHandler;
            _webView.Source = new Uri(url);
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
            el.value = '{Escape(val)}';
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
        }}
        return JSON.stringify({{ success: true }});
    }} catch(ex) {{
        return JSON.stringify({{ success: false, error: ex.message }});
    }}
}})();";

            string resJson = await _webView.ExecuteScriptAsync(script) ?? string.Empty;
            bool passed = resJson.Contains("\"success\":true");
            string detail = passed ? $"Executed {actionType} on {selector}" : $"Element execution warning: {resJson}";
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
            bool found = resJson.Contains("\"found\":true");
            bool visible = resJson.Contains("\"visible\":true");

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
                }

                return string.IsNullOrEmpty(spec.UrlPattern) ? null : spec;
            }
            catch
            {
                return null;
            }
        }

        private static async Task<UiCaptureResponseResult> BuildCaptureResultAsync(CaptureResponseSpec spec, CoreWebView2WebResourceResponseReceivedEventArgs? args)
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

            bool needsBody = !string.IsNullOrEmpty(spec.ExpectJsonPath) && (spec.ExpectExists.HasValue || spec.ExpectIsArray.HasValue);
            if (needsBody)
            {
                string body = string.Empty;
                try
                {
                    using var stream = await args.Response.GetContentAsync();
                    using var reader = new StreamReader(stream);
                    body = await reader.ReadToEndAsync();
                }
                catch (Exception ex)
                {
                    passed = false;
                    details.Add($"couldn't read response body: {ex.Message}");
                }

                if (!string.IsNullOrEmpty(body))
                {
                    try
                    {
                        using var bodyDoc = JsonDocument.Parse(body);
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
            }

            result.Passed = passed;
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

        private void Emit(string label, string detail, string level, string colorHex)
        {
            Telemetry?.Invoke(this, new UiTelemetryEvent { Label = label, Detail = detail, Level = level, ColorHex = colorHex });
        }
    }
}
