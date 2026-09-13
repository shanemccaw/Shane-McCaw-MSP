using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Client for Visual Test Tracker & API Helper communicating with the backend API
    /// (admin-testbed and auth routes). Supports fetching tenants, creating test accounts
    /// bypassing payment and form walls, and authenticating sessions.
    /// </summary>
    public static class VisualTestTrackerApiClient
    {
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };
        private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

        public sealed class TenantItem
        {
            public int Id { get; set; }
            public string Name { get; set; } = "";
            public string? TenantId { get; set; }
            public string? Domain { get; set; }
            public int? MspId { get; set; }
            public string? Status { get; set; }
            public bool IsTestbed { get; set; }

            public override string ToString() => !string.IsNullOrWhiteSpace(Name) ? Name : $"Tenant #{Id}";
        }

        public sealed class CreateAccountRequest
        {
            public string Email { get; set; } = "";
            public string Password { get; set; } = "";
            public string Name { get; set; } = "";
            public string Role { get; set; } = "Customer";
            public int? TenantId { get; set; }
            public int? MspId { get; set; }
        }

        public sealed class CreateAccountResponse
        {
            public bool Ok { get; set; }
            public JsonElement User { get; set; }
            public JsonElement Credentials { get; set; }
            public string? AccessToken { get; set; }
            public string? ExchangeToken { get; set; }
            public string? Error { get; set; }
        }

        public sealed class CreateAccountResult
        {
            public bool Success { get; set; }
            public int UserId { get; set; }
            public string Email { get; set; } = "";
            public string Password { get; set; } = "";
            public string Role { get; set; } = "";
            public int? TenantId { get; set; }
            public int? MspId { get; set; }
            public string? AccessToken { get; set; }
            public string? ExchangeToken { get; set; }
            public string Error { get; set; } = "";
        }

        public sealed class LoginResult
        {
            public bool Success { get; set; }
            public string? AccessToken { get; set; }
            public string? RefreshToken { get; set; }
            public string Error { get; set; } = "";
        }

        public static string ResolveApiBaseUrl()
        {
            var config = BuildTrackerConfig.Load();
            var url = config.GetBaseUrl(TargetEnvironment.Dev);
            if (string.IsNullOrWhiteSpace(url)) url = "http://localhost:8080";
            return url.TrimEnd('/');
        }

        private static string ResolveIngestToken()
        {
            var config = BuildTrackerConfig.Load();
            return config.IngestToken ?? "";
        }

        /// <summary>Fetches the list of tenants from the dev testbed API, falling back to baseline-templates if needed.</summary>
        public static async Task<List<TenantItem>> GetTenantsAsync()
        {
            var baseUrl = ResolveApiBaseUrl();
            var ingestToken = ResolveIngestToken();
            var list = new List<TenantItem>();

            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/api/admin/testbed/tenants");
                if (!string.IsNullOrWhiteSpace(ingestToken))
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ingestToken);

                var res = await Http.SendAsync(req);
                if (res.IsSuccessStatusCode)
                {
                    var doc = await res.Content.ReadFromJsonAsync<JsonDocument>(JsonOpts);
                    if (doc != null && doc.RootElement.TryGetProperty("tenants", out var tenantsArr) && tenantsArr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in tenantsArr.EnumerateArray())
                        {
                            list.Add(new TenantItem
                            {
                                Id = item.TryGetProperty("id", out var idProp) ? idProp.GetInt32() : 0,
                                Name = item.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "",
                                TenantId = item.TryGetProperty("tenantId", out var tid) ? tid.GetString() : null,
                                Domain = item.TryGetProperty("domain", out var d) ? d.GetString() : null,
                                MspId = item.TryGetProperty("mspId", out var m) && m.ValueKind == JsonValueKind.Number ? m.GetInt32() : null,
                                Status = item.TryGetProperty("status", out var s) ? s.GetString() : null,
                                IsTestbed = item.TryGetProperty("isTestbed", out var tb) && tb.GetBoolean()
                            });
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("visual-test-tracker", $"GetTenantsAsync primary failed: {ex.Message}");
            }

            // Fallback: baseline-templates/testbed-customers
            if (list.Count == 0)
            {
                try
                {
                    using var req = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/api/admin/baseline-templates/testbed-customers");
                    if (!string.IsNullOrWhiteSpace(ingestToken))
                        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ingestToken);

                    var res = await Http.SendAsync(req);
                    if (res.IsSuccessStatusCode)
                    {
                        var doc = await res.Content.ReadFromJsonAsync<JsonDocument>(JsonOpts);
                        if (doc != null && doc.RootElement.TryGetProperty("customers", out var custArr) && custArr.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var item in custArr.EnumerateArray())
                            {
                                list.Add(new TenantItem
                                {
                                    Id = item.TryGetProperty("id", out var idProp) ? idProp.GetInt32() : 0,
                                    Name = item.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "",
                                    TenantId = item.TryGetProperty("tenantId", out var tid) ? tid.GetString() : null,
                                    IsTestbed = true
                                });
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("visual-test-tracker", $"GetTenantsAsync fallback failed: {ex.Message}");
                }
            }

            // Default seed fallback if API is not running
            if (list.Count == 0)
            {
                list.Add(new TenantItem { Id = 1, Name = "Shane McCaw Consulting", Domain = "shanemccaw.com", IsTestbed = true });
                list.Add(new TenantItem { Id = 2, Name = "Regression Testbed MSP", Domain = "regression-testbed.example.com", IsTestbed = true });
            }

            return list;
        }

        /// <summary>Creates or updates a test account via POST /api/admin/testbed/create-account.</summary>
        public static async Task<CreateAccountResult> CreateTestAccountAsync(CreateAccountRequest request)
        {
            var baseUrl = ResolveApiBaseUrl();
            var ingestToken = ResolveIngestToken();

            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/api/admin/testbed/create-account");
                if (!string.IsNullOrWhiteSpace(ingestToken))
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ingestToken);

                req.Content = JsonContent.Create(new
                {
                    email = request.Email,
                    password = request.Password,
                    name = request.Name,
                    role = request.Role,
                    tenantId = request.TenantId,
                    mspId = request.MspId
                });

                var res = await Http.SendAsync(req);
                var bodyStr = await res.Content.ReadAsStringAsync();

                if (!res.IsSuccessStatusCode)
                {
                    return new CreateAccountResult
                    {
                        Success = false,
                        Error = $"API returned {(int)res.StatusCode}: {bodyStr}"
                    };
                }

                var parsed = JsonSerializer.Deserialize<CreateAccountResponse>(bodyStr, JsonOpts);
                if (parsed == null || !parsed.Ok)
                {
                    return new CreateAccountResult
                    {
                        Success = false,
                        Error = parsed?.Error ?? "Unknown API response"
                    };
                }

                int userId = 0;
                if (parsed.User.ValueKind == JsonValueKind.Object && parsed.User.TryGetProperty("id", out var uid))
                    userId = uid.GetInt32();

                return new CreateAccountResult
                {
                    Success = true,
                    UserId = userId,
                    Email = request.Email,
                    Password = request.Password,
                    Role = request.Role,
                    TenantId = request.TenantId,
                    MspId = request.MspId,
                    AccessToken = parsed.AccessToken,
                    ExchangeToken = parsed.ExchangeToken
                };
            }
            catch (Exception ex)
            {
                return new CreateAccountResult
                {
                    Success = false,
                    Error = $"Connection failed: {ex.Message}"
                };
            }
        }

        /// <summary>Authenticates an existing or test user via POST /api/auth/login.</summary>
        public static async Task<LoginResult> LoginAsync(string email, string password)
        {
            var baseUrl = ResolveApiBaseUrl();
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/api/auth/login");
                req.Content = JsonContent.Create(new { email, password });

                var res = await Http.SendAsync(req);
                var bodyStr = await res.Content.ReadAsStringAsync();

                if (!res.IsSuccessStatusCode)
                {
                    return new LoginResult
                    {
                        Success = false,
                        Error = $"Login failed ({(int)res.StatusCode}): {bodyStr}"
                    };
                }

                using var doc = JsonDocument.Parse(bodyStr);
                string? accessToken = null;
                string? refreshToken = null;

                if (doc.RootElement.TryGetProperty("accessToken", out var at))
                    accessToken = at.GetString();
                if (doc.RootElement.TryGetProperty("refreshToken", out var rt))
                    refreshToken = rt.GetString();

                return new LoginResult
                {
                    Success = true,
                    AccessToken = accessToken,
                    RefreshToken = refreshToken
                };
            }
            catch (Exception ex)
            {
                return new LoginResult
                {
                    Success = false,
                    Error = ex.Message
                };
            }
        }
    }
}
