using System;
using System.IO;
using System.Threading.Tasks;
using System.Web;
using BuildConsole.Services;

namespace BuildConsole
{
    public partial class MainWindow
    {
        /// <summary>
        /// Handles one shaneapp://reportProgress invocation on the UI thread:
        /// extracts buildId, step, total, and label, records it in BuildProgressTracker,
        /// and emits structured logging.
        /// </summary>
        private Task HandleShaneAppReportProgressAsync(ShaneAppRequest req, string src, string ch)
        {
            try
            {
                int buildId = 0;
                int step = 0;
                int total = 0;
                string label = string.Empty;

                // Read from query string params
                string uri = req.Raw ?? string.Empty;
                int qIdx = uri.IndexOf('?');
                if (qIdx >= 0)
                {
                    string qs = uri[(qIdx + 1)..];
                    var query = HttpUtility.ParseQueryString(qs);

                    if (int.TryParse(query["buildId"] ?? query["queueId"] ?? query["build"], out int b))
                        buildId = b;
                    if (int.TryParse(query["step"], out int s))
                        step = s;
                    if (int.TryParse(query["total"], out int t))
                        total = t;
                    label = query["label"] ?? string.Empty;
                }

                // If not found in query, check if a ref JSON payload file was provided
                if (buildId == 0 && !string.IsNullOrWhiteSpace(req.Ref) && File.Exists(req.Ref))
                {
                    try
                    {
                        string json = File.ReadAllText(req.Ref);
                        using var doc = System.Text.Json.JsonDocument.Parse(json);
                        var root = doc.RootElement;
                        if (root.TryGetProperty("buildId", out var bp)) buildId = bp.GetInt32();
                        if (root.TryGetProperty("step", out var sp)) step = sp.GetInt32();
                        if (root.TryGetProperty("total", out var tp)) total = tp.GetInt32();
                        if (root.TryGetProperty("label", out var lp)) label = lp.GetString() ?? string.Empty;
                    }
                    catch { }
                }

                if (buildId <= 0)
                {
                    ActivityLog.Log(ch, $"[reportProgress] Missing or invalid buildId in '{uri}'");
                    WriteShaneAppResult(req, ok: false, error: "Missing or invalid buildId", statements: null);
                    return Task.CompletedTask;
                }

                if (total <= 0) total = Math.Max(step, 1);
                if (string.IsNullOrWhiteSpace(label)) label = $"Step {step} of {total}";

                var report = BuildProgressTracker.Report(buildId, step, total, label);
                WriteShaneAppResult(req, ok: true, error: null, statements: null);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(ch, $"[reportProgress] Error handling reportProgress: {ex.Message}");
                WriteShaneAppResult(req, ok: false, error: ex.Message, statements: null);
            }

            return Task.CompletedTask;
        }
    }
}
