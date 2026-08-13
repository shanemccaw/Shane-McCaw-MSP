using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #965 (Epic #803) — the hard, enforced isTestbed=true gate shared by BOTH real-Graph
    /// executors: GraphTestExecutor (graphTests, #808) and PowerShellTestExecutor (powerShellVerify,
    /// #900). The write-action path (admin-baseline-templates.ts :templateId/test) already refuses
    /// any target that isn't a real isTestbed=true customer; the two dev/regression executors did
    /// NOT — they relied purely on convention (whoever set GRAPH_TEST_TENANT_ID picked correctly),
    /// with zero runtime proof the configured tenant is genuinely a testbed row. Reading a live
    /// customer's real user list, mailbox content, or security posture is a real confidentiality
    /// boundary even without a write, so this closes that gap with the SAME enforcement strength as
    /// the server-side write gate.
    ///
    /// Source of truth is the server's own authoritative list, NOT a second copy of the rule baked
    /// into this app: GET /admin/baseline-templates/testbed-customers already returns exactly the
    /// set of `isTestbed = true AND status = 'active'` customers with a connected tenant (per
    /// admin-baseline-templates.ts). We check the configured/connected tenant ID against that live
    /// list. Authenticated with the same apiBaseUrl + ingestToken BuildTrackerApiClient uses (the
    /// route accepts BUILD_TRACKER_INGEST_TOKEN via requireAdminOrIngestToken, so this works from a
    /// headless / #898-remote-triggered run with no admin session cookie).
    ///
    /// FAIL-CLOSED: any inability to positively confirm a tenant is testbed — server unreachable,
    /// config missing, tenant absent from the list, empty tenant — REFUSES. A refusal is never a
    /// silent skip: every check (pass or refuse) is logged loudly on the "testing.testbed-gate"
    /// channel via ActivityLog, this app's logging spine.
    ///
    /// A short in-memory cache (30s) keeps a manifest full of graphTests from re-fetching the list
    /// per step; a positive list is safe to cache briefly and a fresh live fetch always refreshes it.
    /// </summary>
    public static class TestbedGate
    {
        public const string Channel = "testing.testbed-gate";
        private const string Endpoint = "api/admin/baseline-templates/testbed-customers";
        private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);

        // Tenant IDs are Entra tenant GUIDs; keep only GUID-safe characters so a value from the DB
        // can never inject anything when embedded into the generated pwsh allowlist literal (#965 pt 3).
        private static readonly Regex TenantIdSafe = new(@"^[A-Za-z0-9\-\.]{1,100}$", RegexOptions.Compiled);

        private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

        private static readonly object CacheLock = new();
        private static List<TestbedCustomer>? _cached;
        private static DateTime _cachedAtUtc;

        public sealed class TestbedCustomer
        {
            public int Id { get; set; }
            public string? Name { get; set; }
            public string? TenantId { get; set; }
        }

        private sealed class TestbedCustomersResponse
        {
            public List<TestbedCustomer> Customers { get; set; } = new();
        }

        /// <summary>Outcome of a gate check. <see cref="Allowed"/> is only ever true when the tenant
        /// was positively found in the server's live isTestbed list.</summary>
        public readonly struct GateResult
        {
            public bool Allowed { get; }
            public string Reason { get; }
            public string? MatchedCustomerName { get; }

            public GateResult(bool allowed, string reason, string? matchedCustomerName)
            {
                Allowed = allowed;
                Reason = reason;
                MatchedCustomerName = matchedCustomerName;
            }
        }

        /// <summary>
        /// Verify <paramref name="tenantId"/> is a real isTestbed=true customer per the server's live
        /// list. Fail-closed on any inability to confirm. Logs the result (pass or refuse) on the
        /// "testing.testbed-gate" channel. <paramref name="context"/> is a short human label (e.g. the
        /// step's method/path) so the log line says WHAT was being gated.
        /// </summary>
        public static async Task<GateResult> VerifyTenantIsTestbedAsync(string tenantId, string context)
        {
            if (string.IsNullOrWhiteSpace(tenantId))
            {
                var r = new GateResult(false, "no tenant ID supplied to the testbed gate.", null);
                LogResult(r, "(none)", context);
                return r;
            }

            List<TestbedCustomer> customers;
            try
            {
                customers = await GetTestbedCustomersAsync();
            }
            catch (Exception ex)
            {
                var r = new GateResult(false,
                    $"could not verify the tenant against the server's testbed list ({ex.Message}) — refusing (fail-closed).",
                    null);
                LogResult(r, tenantId, context);
                return r;
            }

            var match = customers.FirstOrDefault(c =>
                !string.IsNullOrWhiteSpace(c.TenantId)
                && string.Equals(c.TenantId!.Trim(), tenantId.Trim(), StringComparison.OrdinalIgnoreCase));

            if (match != null)
            {
                var r = new GateResult(true,
                    $"tenant is a confirmed isTestbed=true customer ('{match.Name}').", match.Name);
                LogResult(r, tenantId, context);
                return r;
            }

            var refuse = new GateResult(false,
                $"tenant '{tenantId}' is NOT in the server's isTestbed=true customer list — refusing to run a real Graph/PowerShell call against a non-testbed tenant.",
                null);
            LogResult(refuse, tenantId, context);
            return refuse;
        }

        /// <summary>
        /// The set of GUID-safe tenant IDs that are real isTestbed=true customers, for callers that
        /// need to enforce the gate themselves (PowerShellTestExecutor injects this allowlist into its
        /// pwsh script so the connected Get-MgContext TenantId is checked in-process before the
        /// verification cmdlet ever runs). THROWS on any failure to fetch — the caller must treat that
        /// as fail-closed, never as "no restrictions".
        /// </summary>
        public static async Task<List<string>> GetTestbedTenantIdsAsync()
        {
            var customers = await GetTestbedCustomersAsync();
            return customers
                .Select(c => c.TenantId?.Trim() ?? "")
                .Where(id => id.Length > 0 && TenantIdSafe.IsMatch(id))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private static async Task<List<TestbedCustomer>> GetTestbedCustomersAsync()
        {
            lock (CacheLock)
            {
                if (_cached != null && DateTime.UtcNow - _cachedAtUtc < CacheTtl)
                    return _cached;
            }

            var config = BuildTrackerConfig.Load();
            if (!config.IsConfigured)
                throw new InvalidOperationException(
                    "BuildConsole api config not set (scripts/build-queue-watcher.config.json apiBaseUrl/ingestToken) — cannot reach the testbed-customers list.");

            var baseUrl = config.ApiBaseUrl.TrimEnd('/') + "/";
            using var http = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(20) };
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.IngestToken);

            var res = await http.GetFromJsonAsync<TestbedCustomersResponse>(Endpoint, JsonOpts);
            var list = res?.Customers ?? new List<TestbedCustomer>();

            lock (CacheLock)
            {
                _cached = list;
                _cachedAtUtc = DateTime.UtcNow;
            }
            return list;
        }

        private static void LogResult(GateResult result, string tenantId, string context)
        {
            ActivityLog.Log(Channel,
                (result.Allowed ? "PASS " : "REFUSED ")
                + $"tenant={tenantId}"
                + (string.IsNullOrWhiteSpace(context) ? "" : $" [{context}]")
                + $" — {result.Reason}");
        }
    }
}
