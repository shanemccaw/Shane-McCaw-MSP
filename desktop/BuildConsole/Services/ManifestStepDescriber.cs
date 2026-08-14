using System.Collections.Generic;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Manifest viewer — the single source of truth for turning one manifest step into a short,
    /// human-readable one-liner. Lifted verbatim out of LeftSidebar's #952 steps-flyout code-behind
    /// (DescribeHttpEntry / DescribePowerShellEntry / DescribeUiStep / DescribeCaptureResponse) so the
    /// new ManifestViewerWindow's workflow-chart boxes label themselves EXACTLY the way the flyout
    /// already does, rather than reinventing step-summarization. LeftSidebar now delegates here too, so
    /// there is only one implementation to keep correct.
    /// </summary>
    public static class ManifestStepDescriber
    {
        /// <summary>An apiTests / graphTests / postGraphApiTests / zohoTests entry: "N. METHOD /path  → status".</summary>
        public static string DescribeHttpEntry(JsonElement el, int i)
        {
            string method = (GetJsonStr(el, "method") ?? "GET").ToUpperInvariant();
            string path = GetJsonStr(el, "path") ?? GetJsonStr(el, "url") ?? "(no path)";
            string s = $"{i + 1}. {method} {path}";
            if (el.ValueKind == JsonValueKind.Object
                && el.TryGetProperty("expect", out var expect)
                && expect.ValueKind == JsonValueKind.Object
                && expect.TryGetProperty("status", out var status))
            {
                s += $"  → {status}";
            }
            return s;
        }

        /// <summary>A powerShellVerify entry: "N. cmdlet  (after: afterStep)".</summary>
        public static string DescribePowerShellEntry(JsonElement el, int i)
        {
            string cmdlet = GetJsonStr(el, "cmdlet") ?? "(cmdlet)";
            string s = $"{i + 1}. {cmdlet}";
            string? after = GetJsonStr(el, "afterStep");
            if (!string.IsNullOrEmpty(after)) s += $"  (after: {after})";
            return s;
        }

        /// <summary>A uiSteps entry: "N. ACTION  selector  = value  [state]  ⟳capture…".</summary>
        public static string DescribeUiStep(ManifestUiStep step, int i)
        {
            string target = step.Selector ?? step.Target ?? "";
            string s = $"{i + 1}. {step.Action.ToUpperInvariant()}";
            if (!string.IsNullOrEmpty(target)) s += $"  {target}";
            if (!string.IsNullOrEmpty(step.Value)) s += $"  = {step.Value}";
            if (!string.IsNullOrEmpty(step.State)) s += $"  [{step.State}]";
            if (!string.IsNullOrEmpty(step.CaptureResponseJson)) s += "  " + DescribeCaptureResponse(step.CaptureResponseJson);
            return s;
        }

        /// <summary>Git #997 — expand a captureResponse block to show the real urlPattern being watched, plus a
        /// short summary of the expect block's assertions when it fits.</summary>
        public static string DescribeCaptureResponse(string captureResponseJson)
        {
            try
            {
                using var doc = JsonDocument.Parse(captureResponseJson);
                var root = doc.RootElement;
                string urlPattern = GetJsonStr(root, "urlPattern") ?? "(no urlPattern)";
                string s = $"⟳capture: {urlPattern}";

                if (root.TryGetProperty("expect", out var expect) && expect.ValueKind == JsonValueKind.Object)
                {
                    var parts = new List<string>();
                    if (expect.TryGetProperty("status", out var status))
                        parts.Add($"status {status}");
                    if (expect.TryGetProperty("jsonPath", out var jsonPath) && jsonPath.ValueKind == JsonValueKind.String)
                        parts.Add(jsonPath.GetString() ?? "");
                    if (expect.TryGetProperty("containsAny", out var containsAny) && containsAny.ValueKind == JsonValueKind.Array)
                        parts.Add($"containsAny×{containsAny.GetArrayLength()}");
                    if (expect.TryGetProperty("containsNone", out var containsNone) && containsNone.ValueKind == JsonValueKind.Array)
                        parts.Add($"containsNone×{containsNone.GetArrayLength()}");
                    if (parts.Count > 0) s += $"  ({string.Join(", ", parts)})";
                }

                return s;
            }
            catch
            {
                return "⟳capture";
            }
        }

        public static string? GetJsonStr(JsonElement el, string prop)
        {
            if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty(prop, out var v))
                return null;
            return v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString();
        }
    }
}
