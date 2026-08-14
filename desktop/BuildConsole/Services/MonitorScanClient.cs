using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Thin HTTP courier over Simulator Studio's OWN "M365 Endpoints" per-check run routes
    /// (artifacts/api-server/src/routes/admin-monitor-check-runs.ts), used by the
    /// shaneapp://executeScan local protocol to trigger exactly ONE monitor check by its
    /// monitor_checks key and settle that single run.
    ///
    /// It is a COURIER, not a second scanning implementation — the exact same three real
    /// endpoints the Simulator Studio canvas (SimulatorEndpointCanvas.tsx) itself calls:
    ///   POST /api/admin/monitor-checks/:key/run          → 202 { runId, status, run }
    ///   GET  /api/admin/monitor-check-runs/:runId         → { run, classification }  (poll to terminal)
    ///   GET  /api/admin/monitor-check-runs/:runId/items   → { items, itemCount }     (full observed detail)
    ///
    /// "Same defaults" is achieved by sending ONLY { customerId } and letting the server merge
    /// each field as `override ?? check.<field>` (startCheckRun in that route) — so the check runs
    /// with its own stored endpoint/method/$select/$filter/body, exactly as the UI's Run button does
    /// when the operator hasn't edited anything. All real work (Graph request, @odata.nextLink
    /// pagination, mapping/extraction, severity classification, and the tenant_monitor_profiles
    /// write) belongs to the server's executeMonitorCheck — never reimplemented here.
    ///
    /// Authenticated with the same apiBaseUrl + ingestToken BuildTrackerApiClient / TestbedGate use.
    /// Those three routes accept the bearer ingest token via requireAdminOrIngestToken, so this works
    /// from a headless build session with no admin session cookie (same pattern as
    /// /simulator/sql/execute, #702).
    /// </summary>
    public sealed class MonitorScanClient : IDisposable
    {
        private readonly HttpClient _http;

        public MonitorScanClient(BuildTrackerConfig config)
        {
            if (config == null) throw new ArgumentNullException(nameof(config));
            if (!config.IsConfigured)
                throw new InvalidOperationException(
                    "BuildConsole api config not set (scripts/build-queue-watcher.config.json apiBaseUrl/ingestToken) — cannot reach the monitor-check run routes.");

            var baseUrl = config.ApiBaseUrl.TrimEnd('/') + "/";
            _http = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(30) };
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.IngestToken);
        }

        /// <summary>One HTTP call's outcome: the status code plus the parsed JSON body (null when the
        /// body wasn't JSON — e.g. an HTML 502 from a napping server), with the raw text kept either way.</summary>
        public readonly struct ApiResult
        {
            public HttpStatusCode Status { get; }
            public JsonNode? Body { get; }
            public string RawBody { get; }

            public ApiResult(HttpStatusCode status, JsonNode? body, string rawBody)
            {
                Status = status;
                Body = body;
                RawBody = rawBody ?? "";
            }

            public bool IsSuccess => (int)Status >= 200 && (int)Status < 300;

            /// <summary>A short, log/envelope-safe description of a non-2xx response — the server's own
            /// `error` field when present, else the raw body trimmed, else just the status code.</summary>
            public string DescribeError()
            {
                var serverError = Body?["error"]?.ToString();
                if (!string.IsNullOrWhiteSpace(serverError)) return $"HTTP {(int)Status}: {serverError}";
                if (!string.IsNullOrWhiteSpace(RawBody))
                    return $"HTTP {(int)Status}: {RawBody.Substring(0, Math.Min(300, RawBody.Length))}";
                return $"HTTP {(int)Status}";
            }
        }

        /// <summary>POST /api/admin/monitor-checks/:key/run with { customerId } → 202 { runId, status, run }.</summary>
        public Task<ApiResult> StartRunAsync(string checkKey, int customerId)
        {
            var payload = new JsonObject { ["customerId"] = customerId };
            return PostJsonAsync($"api/admin/monitor-checks/{Uri.EscapeDataString(checkKey)}/run", payload);
        }

        /// <summary>GET /api/admin/monitor-check-runs/:runId → { run, classification }.</summary>
        public Task<ApiResult> GetRunAsync(string runId) =>
            GetAsync($"api/admin/monitor-check-runs/{Uri.EscapeDataString(runId)}");

        /// <summary>GET /api/admin/monitor-check-runs/:runId/items → { items, itemCount } (409 if unavailable).</summary>
        public Task<ApiResult> GetItemsAsync(string runId) =>
            GetAsync($"api/admin/monitor-check-runs/{Uri.EscapeDataString(runId)}/items");

        private async Task<ApiResult> PostJsonAsync(string path, JsonNode payload)
        {
            using var content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");
            using var res = await _http.PostAsync(path, content);
            return await ReadAsync(res);
        }

        private async Task<ApiResult> GetAsync(string path)
        {
            using var res = await _http.GetAsync(path);
            return await ReadAsync(res);
        }

        private static async Task<ApiResult> ReadAsync(HttpResponseMessage res)
        {
            string raw = await res.Content.ReadAsStringAsync();
            JsonNode? node = null;
            try { node = string.IsNullOrWhiteSpace(raw) ? null : JsonNode.Parse(raw); }
            catch { /* non-JSON error body — keep RawBody for the envelope/log */ }
            return new ApiResult(res.StatusCode, node, raw);
        }

        public void Dispose() => _http.Dispose();
    }
}
