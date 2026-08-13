using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #806 (Epic #803 Phase 2) — parsed shape of /test-manifests/{issue}-{feature-slug}.json,
    /// per the schema in #803's issue body. apiTests/graphTests are kept as raw JSON (only their
    /// counts matter to this phase — #807/#808 own actually executing them); uiSteps map onto the
    /// existing AutomationAction shape in LeftSidebar.xaml.cs.
    /// </summary>
    public class TestManifest
    {
        public int Issue { get; set; }
        public string Feature { get; set; } = string.Empty;
        public string BaseUrl { get; set; } = string.Empty;
        public List<JsonElement> ApiTests { get; set; } = new();
        public List<JsonElement> GraphTests { get; set; } = new();
        // Git #879 (Epic #803) — apiTests-shaped entries that must run AFTER graphTests
        // instead of before, for flows where an api call needs a value graphTests'
        // mail-poll `extract` (#877/#878) hasn't captured yet at the time the normal
        // apiTests phase runs (e.g. #437's verify-code call needing the 6-digit code
        // the mail-poll step pulled out of the delivered email). Same raw-JSON
        // { method, path, headers, body, expect, extract } shape as apiTests; executed
        // by HttpTestExecutor.RunPostGraphAsync, called from RunManifestAsync right
        // after graphTests and before zohoTests.
        public List<JsonElement> PostGraphApiTests { get; set; } = new();
        // Git #881 (Epic #803) — zohoTests: same raw-JSON { method, path, expect } shape as
        // apiTests/graphTests, executed by ZohoTestExecutor against the api-server's Zoho admin
        // read routes, authenticated with the #880 Zoho API Token.
        public List<JsonElement> ZohoTests { get; set; } = new();
        // Git #900 (Epic #803) — powerShellVerify: independent tenant verification via a real
        // delegated-identity PowerShell (pwsh 7) cmdlet, run as Shane himself (NOT the app's
        // app-only identity), diffing the Get-* ground truth against a value an earlier
        // apiTests/graphTests step captured (#877). Same raw-JSON shape as graphTests/zohoTests
        // ({ afterStep, cmdlet, compareField:{matchType}, timeoutMs? }), executed LAST by
        // PowerShellTestExecutor.RunAsync so every captured value is available to diff against.
        public List<JsonElement> PowerShellVerify { get; set; } = new();
        public List<ManifestUiStep> UiSteps { get; set; } = new();
        /// <summary>Git #970 — raw JSON of the manifest's optional top-level `viewport` field (either
        /// a preset name string like "mobile"/"tablet", or a `{ width, height }` object), applied as
        /// the default viewport for every uiStep that doesn't declare its own. Parsed by
        /// UiTestExecutor.ViewportSpec. Null when the manifest declares no viewport.</summary>
        public string? ViewportJson { get; set; }
        public string SourcePath { get; set; } = string.Empty;

        public static TestManifest? LoadFromFile(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                using var doc = JsonDocument.Parse(File.ReadAllText(path));
                var root = doc.RootElement;

                var manifest = new TestManifest
                {
                    Issue = root.TryGetProperty("issue", out var issueEl) ? issueEl.GetInt32() : 0,
                    Feature = root.TryGetProperty("feature", out var featureEl) ? featureEl.GetString() ?? "" : "",
                    BaseUrl = root.TryGetProperty("baseUrl", out var baseUrlEl) ? baseUrlEl.GetString() ?? "" : "",
                    SourcePath = path,
                };

                if (root.TryGetProperty("viewport", out var viewportEl) &&
                    (viewportEl.ValueKind == JsonValueKind.Object || viewportEl.ValueKind == JsonValueKind.String))
                    manifest.ViewportJson = viewportEl.GetRawText();

                if (root.TryGetProperty("apiTests", out var apiTestsEl) && apiTestsEl.ValueKind == JsonValueKind.Array)
                    manifest.ApiTests = apiTestsEl.EnumerateArray().Select(e => e.Clone()).ToList();

                if (root.TryGetProperty("graphTests", out var graphTestsEl) && graphTestsEl.ValueKind == JsonValueKind.Array)
                    manifest.GraphTests = graphTestsEl.EnumerateArray().Select(e => e.Clone()).ToList();

                if (root.TryGetProperty("postGraphApiTests", out var postGraphEl) && postGraphEl.ValueKind == JsonValueKind.Array)
                    manifest.PostGraphApiTests = postGraphEl.EnumerateArray().Select(e => e.Clone()).ToList();

                if (root.TryGetProperty("zohoTests", out var zohoTestsEl) && zohoTestsEl.ValueKind == JsonValueKind.Array)
                    manifest.ZohoTests = zohoTestsEl.EnumerateArray().Select(e => e.Clone()).ToList();

                if (root.TryGetProperty("powerShellVerify", out var psVerifyEl) && psVerifyEl.ValueKind == JsonValueKind.Array)
                    manifest.PowerShellVerify = psVerifyEl.EnumerateArray().Select(e => e.Clone()).ToList();

                if (root.TryGetProperty("uiSteps", out var uiStepsEl) && uiStepsEl.ValueKind == JsonValueKind.Array)
                {
                    manifest.UiSteps = uiStepsEl.EnumerateArray().Select(step => new ManifestUiStep
                    {
                        Action = step.TryGetProperty("action", out var a) ? a.GetString() ?? "click" : "click",
                        Target = step.TryGetProperty("target", out var t) ? t.GetString() : null,
                        Selector = step.TryGetProperty("selector", out var s) ? s.GetString() : null,
                        Value = step.TryGetProperty("value", out var v) ? v.GetString() : null,
                        State = step.TryGetProperty("state", out var st) ? st.GetString() : null,
                        CaptureResponseJson = step.TryGetProperty("captureResponse", out var cr) ? cr.GetRawText() : null,
                        ExtractJson = step.TryGetProperty("extract", out var ex) && ex.ValueKind == JsonValueKind.Object ? ex.GetRawText() : null,
                        // Git #1016 — the uiStep's optional `textContains` (a single string or an array of
                        // strings), carried through as raw JSON for UiTestExecutor's `expect` action to assert
                        // against the element's real rendered text. Only string/array shapes are carried; any
                        // other JSON kind is ignored (null).
                        TextContainsJson = step.TryGetProperty("textContains", out var tc)
                            && (tc.ValueKind == JsonValueKind.String || tc.ValueKind == JsonValueKind.Array) ? tc.GetRawText() : null,
                        ViewportJson = step.TryGetProperty("viewport", out var vp) &&
                            (vp.ValueKind == JsonValueKind.Object || vp.ValueKind == JsonValueKind.String) ? vp.GetRawText() : null,
                        MaxDurationMs = step.TryGetProperty("maxDurationMs", out var md) && md.ValueKind == JsonValueKind.Number && md.TryGetInt64(out var mdn) ? mdn : (long?)null,
                        TimeoutMs = step.TryGetProperty("timeoutMs", out var tm) && tm.ValueKind == JsonValueKind.Number && tm.TryGetInt64(out var tmn) ? tmn : (long?)null,
                        Screenshot = step.TryGetProperty("screenshot", out var sc) && sc.ValueKind == JsonValueKind.True,
                    }).ToList();
                }

                return manifest;
            }
            catch
            {
                return null;
            }
        }
    }

    /// <summary>One entry of a manifest's uiSteps array — maps onto AutomationAction (Index/ActionType/Selector/TagName/Value) plus CaptureResponse, which AutomationAction also carries as raw JSON for the UI executor (#809) to parse.</summary>
    public class ManifestUiStep
    {
        public string Action { get; set; } = "click";
        public string? Target { get; set; }
        public string? Selector { get; set; }
        public string? Value { get; set; }
        public string? State { get; set; }
        public string? CaptureResponseJson { get; set; }
        /// <summary>Git #877 — raw JSON of this uiStep's optional `extract` block ({ as, regex } / { as, jsonPath }), carried through untouched for UiTestExecutor to apply against the step's captured response body. Null when the step declares no extraction.</summary>
        public string? ExtractJson { get; set; }
        /// <summary>Git #1016 — raw JSON of this uiStep's optional `textContains` field (a single string
        /// or an array of strings), asserted by UiTestExecutor's `expect` action against the target
        /// element's REAL rendered text (el.innerText/textContent), any-of / case-insensitive substring.
        /// Null when the step declares no text assertion. Complements `state` (visible/hidden/…), which is
        /// element-presence only — the two are asserted together when both are declared.</summary>
        public string? TextContainsJson { get; set; }
        /// <summary>Git #970 — raw JSON of this uiStep's optional `viewport` field (preset name string or
        /// `{ width, height }` object), overriding the manifest-level default for just this step. Null when
        /// the step declares no viewport of its own.</summary>
        public string? ViewportJson { get; set; }
        /// <summary>Git #969 — this uiStep's optional `maxDurationMs` threshold, asserted against UiTestExecutor's already-tracked per-step Stopwatch elapsed time. Null when the step declares no threshold.</summary>
        public long? MaxDurationMs { get; set; }
        /// <summary>This uiStep's optional `timeoutMs` — the bounded window (ms) an `expect` step polls the DOM
        /// for its state/textContains condition before failing, overriding UiTestExecutor's default poll window.
        /// Null when the step declares no override (accepts the default). Applies to `expect` steps.</summary>
        public long? TimeoutMs { get; set; }
        /// <summary>Git #966 — the uiStep's optional `"screenshot": true` flag for explicit always-capture (independent of the automatic on-failure capture). Defaults false.</summary>
        public bool Screenshot { get; set; }
    }
}
