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
        // Git #881 (Epic #803) — zohoTests: same raw-JSON { method, path, expect } shape as
        // apiTests/graphTests, executed by ZohoTestExecutor against the api-server's Zoho admin
        // read routes, authenticated with the #880 Zoho API Token.
        public List<JsonElement> ZohoTests { get; set; } = new();
        public List<ManifestUiStep> UiSteps { get; set; } = new();
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

                if (root.TryGetProperty("apiTests", out var apiTestsEl) && apiTestsEl.ValueKind == JsonValueKind.Array)
                    manifest.ApiTests = apiTestsEl.EnumerateArray().Select(e => e.Clone()).ToList();

                if (root.TryGetProperty("graphTests", out var graphTestsEl) && graphTestsEl.ValueKind == JsonValueKind.Array)
                    manifest.GraphTests = graphTestsEl.EnumerateArray().Select(e => e.Clone()).ToList();

                if (root.TryGetProperty("zohoTests", out var zohoTestsEl) && zohoTestsEl.ValueKind == JsonValueKind.Array)
                    manifest.ZohoTests = zohoTestsEl.EnumerateArray().Select(e => e.Clone()).ToList();

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
    }
}
