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
    /// Thin HTTP courier over the api-server's POST /api/simulator/ps-execution/cmdlet
    /// route (artifacts/api-server/src/routes/admin-engines.ts, #1404), used by the
    /// shaneapp://executeCmdlet local protocol to run ONE allowlisted ps-execution
    /// cmdlet through the SAME real server code path a genuine scan uses
    /// (lib/ps-execution-client.callPsExecution → the ca-ps-execution[-dev] container,
    /// the same call monitor-executor.runPowerShellCheck makes).
    ///
    /// It is a COURIER, not a second ps-execution client: the raw ps-execution bearer
    /// secret, the Dev-vs-Production container selection (#1385: a dev api-server hits
    /// the isolated ca-ps-execution-dev, never production), and the container's fixed
    /// cmdlet allowlist all live server-side — this only hands the server the
    /// cmdletKey / tenant / organization / params and reads back the structured result.
    /// The calling agent NEVER touches the bearer secret (the exact safety pattern that
    /// blocked #1400's manual verification and that executeSql already uses for DB creds).
    ///
    /// Authenticated with the SAME apiBaseUrl + ingestToken BuildTrackerApiClient /
    /// MonitorScanClient / TestbedGate use (the route is requireAdminOrIngestToken, so no
    /// admin session cookie is needed from a headless build session).
    /// </summary>
    public sealed class CmdletExecutionClient : IDisposable
    {
        private readonly HttpClient _http;

        public CmdletExecutionClient(BuildTrackerConfig config)
        {
            if (config == null) throw new ArgumentNullException(nameof(config));
            if (!config.IsConfigured)
                throw new InvalidOperationException(
                    "BuildConsole api config not set (scripts/build-queue-watcher.config.json apiBaseUrl/ingestToken) — cannot reach the ps-execution cmdlet route.");

            var baseUrl = config.ApiBaseUrl.TrimEnd('/') + "/";
            // A real Connect-IPPSSession/Exchange/Teams sign-in plus the per-request
            // child pwsh cold-start (#1400, ~0.5–3s) can take real seconds; give the
            // synchronous call generous headroom so a legitimately slow connect doesn't
            // surface as a client timeout.
            _http = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(180) };
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.IngestToken);
        }

        /// <summary>One HTTP call's outcome: the status code plus the parsed JSON body (null when the
        /// body wasn't JSON — e.g. an HTML 502 from a napping server), with the raw text kept either way.
        /// Mirrors MonitorScanClient.ApiResult so both couriers read the same way.</summary>
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

        /// <summary>
        /// POST /api/simulator/ps-execution/cmdlet with { cmdletKey, tenantId, organization?, params? }.
        /// The server enforces the #965 testbed gate, derives the real Connect-* Organization from the
        /// gated testbed tenant, and calls callPsExecution() — returning { ok, items, rawResponse, … }
        /// or { ok:false, error, kind, containerErrorKind }.
        /// </summary>
        public Task<ApiResult> ExecuteCmdletAsync(string cmdletKey, string tenantId, string? organization, JsonObject? cmdletParams)
        {
            var payload = new JsonObject
            {
                ["cmdletKey"] = cmdletKey,
                ["tenantId"] = tenantId,
            };
            if (!string.IsNullOrWhiteSpace(organization)) payload["organization"] = organization;
            if (cmdletParams != null) payload["params"] = cmdletParams;
            return PostJsonAsync("api/simulator/ps-execution/cmdlet", payload);
        }

        private async Task<ApiResult> PostJsonAsync(string path, JsonNode payload)
        {
            using var content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");
            using var res = await _http.PostAsync(path, content);
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
