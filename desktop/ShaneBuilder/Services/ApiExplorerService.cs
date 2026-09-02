using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace ShaneBuilder.Services;

/// <summary>Git #2220 — one endpoint in the mini panel's catalog. Real routes only, extracted from
/// <c>artifacts/api-server/src/routes/*.ts</c> (local mode) or the documented Microsoft Graph
/// surface this platform already exercises in its write-pack layer (Graph modes) — never invented,
/// same "extracted, not authored" contract CLAUDE.md holds every other catalog to.</summary>
public sealed record ApiEndpoint(string Group, string Method, string Path, string Name, string? Permission, string Risk, string? ExampleBody);

public enum ApiExplorerMode { Local, GraphRead, GraphWrite }

/// <summary>One real HTTP outcome (or, for a Graph-write DRY RUN, the request that WOULD have been
/// sent). <see cref="Tone"/> distinguishes "denied" (401/403 — the real Graph/local 403 shape) and
/// "dry" (never sent) from an ordinary success/error, per README-ClaudeChat.md §6.3.</summary>
public sealed class ApiExplorerResponse
{
    public bool Success { get; init; }
    public int? StatusCode { get; init; }
    public string StatusText { get; init; } = "";
    public string Tone { get; init; } = "neutral"; // success | denied | dry | error
    public int ElapsedMs { get; init; }
    public int SizeBytes { get; init; }
    /// <summary>Pretty-printed (indented) body — the "JSON Output" view.</summary>
    public string Body { get; init; } = "";
    /// <summary>The full "Raw Response" view per readme Step 12: real status line, the diagnostic
    /// headers (content-type, request-id, client-request-id, Graph diagnostic), duration, then the
    /// body exactly as it came off the wire (unindented) — genuinely different text from
    /// <see cref="Body"/>, so the two response tabs never show the same thing.</summary>
    public string RawBody { get; init; } = "";
}

/// <summary>Git #2202 (readme-phase2.md Step 12) — a real Graph tenant the token broker acquires
/// against. Carries its App Registration (client id) and its <c>GrantedScopes</c>. The scopes are
/// NOT a hardcoded list — after a token is acquired they are parsed live from that token's own
/// <c>roles</c>/<c>scp</c> claim (see <see cref="ApiExplorerService.ParseGrantedScopes"/>), which is
/// the honest source for "what this App Reg was actually granted." The client secret is deliberately
/// NOT on this record — it never travels with a value shown in the UI; the broker holds it.</summary>
public sealed record GraphTenant(string Id, string Label, string Env, string TenantId, string AppRegistration, string[] GrantedScopes);

/// <summary>Git #2202 (readme Step 12) contract — a gated login profile. This is the SAME shape
/// #2204's <see cref="AccountProfile"/> carries; the autofill lock reads <c>AccountProfile</c>
/// straight from <c>SettingsStoreService.GetProfiles()</c> and does NOT stand up a parallel store
/// (per #2202's own build dispatch). Provided so the readme's named contract exists; build one from
/// an <c>AccountProfile</c> via <see cref="FromAccount"/>.</summary>
public sealed record GatedProfile(string Id, string User, string Password, string Description, string Tier)
{
    public static GatedProfile FromAccount(AccountProfile a) => new(a.Id, a.User, a.Password, a.Description, a.Tier);
}

/// <summary>Git #2202 (readme Step 12) contract — one acquired bearer token, plus everything the
/// token panel shows (who it is for, when acquired, TTL, flow) and the permissions parsed out of the
/// token's own JWT. Never persisted — lives only for the session, same as the panel's other state.</summary>
public sealed record Token(string AccessToken, DateTimeOffset AcquiredAt, DateTimeOffset ExpiresAt, string Flow, string For, IReadOnlyList<string> GrantedScopes, string Error)
{
    public bool Ok => !string.IsNullOrEmpty(AccessToken);
    public static Token Fail(string error) => new("", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, "", "", Array.Empty<string>(), error);
}

/// <summary>Git #2202 (readme Step 12) contract, verbatim (<c>Task&lt;Token&gt; ClientCredentials</c>
/// / <c>PasswordLogin</c>). Real implementation is <see cref="TokenBroker"/> — no MSAL dependency,
/// each grant is a single <see cref="HttpClient"/> POST, so no new NuGet download per CLAUDE.md's
/// bandwidth rule.</summary>
public interface ITokenBroker
{
    Task<Token> ClientCredentials(GraphTenant t);        // Graph — client_credentials
    Task<Token> PasswordLogin(string baseUrl, string user, string pw); // local API — password
}

/// <summary>Git #2202 — the one real <see cref="ITokenBroker"/>. Reuses the vetted single-POST grant
/// helpers on <see cref="ApiExplorerService"/> (kept in one place) and layers on the token-panel
/// metadata + live scope parsing the readme's <c>Token</c> shape needs. The DEV Graph client secret
/// is held here (constructed from <see cref="ApiExplorerService.GraphCredentials"/>), never on
/// <see cref="GraphTenant"/>.</summary>
public sealed class TokenBroker : ITokenBroker
{
    private readonly ApiExplorerService.GraphCredentials? _graph;
    public TokenBroker(ApiExplorerService.GraphCredentials? graph) => _graph = graph;

    public async Task<Token> ClientCredentials(GraphTenant t)
    {
        if (_graph == null) return Token.Fail("No Graph credentials configured in .env.local.");
        var (tok, exp, err) = await ApiExplorerService.AcquireGraphTokenAsync(_graph);
        if (tok == null) return Token.Fail(err);
        return new Token(tok, DateTimeOffset.UtcNow, exp ?? DateTimeOffset.UtcNow.AddHours(1),
            "client_credentials", t.Label, ApiExplorerService.ParseGrantedScopes(tok), "");
    }

    public async Task<Token> PasswordLogin(string baseUrl, string user, string pw)
    {
        var (tok, err) = await ApiExplorerService.LocalPasswordLoginAsync(baseUrl, user, pw);
        if (tok == null) return Token.Fail(err);
        // Real api-server access-token TTL band (~15m). Local login tokens aren't Graph-role gated,
        // so GrantedScopes stays whatever the JWT carries (usually empty) — the permission gate is a
        // Graph-mode concept only.
        return new Token(tok, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(15),
            "password", user, ApiExplorerService.ParseGrantedScopes(tok), "");
    }
}

/// <summary>
/// Git #2220 / #2202 — real execution backing the API Explorer panel (README-ClaudeChat.md §6.3 +
/// readme-phase2.md Step 12). #2220 stood up the shared three-mode panel; #2202 completed it once
/// #2204 (Settings / Accounts &amp; Tiers store) landed on main — the formal <see cref="ITokenBroker"/>
/// contract above, the permission/scope gate (<see cref="ParseGrantedScopes"/>/<see cref="HasPermission"/>),
/// the Raw-vs-JSON response views, and the autofill lock wired to the real
/// <c>SettingsStoreService.GetProfiles()</c> (NOT a parallel profile store). What is real here:
///  - Local mode: a plain POST to the local dev api-server's own <c>/api/auth/login</c>
///    (confirmed real at <c>artifacts/api-server/src/routes/auth.ts:321</c>, returns a bearer
///    <c>accessToken</c> in the JSON body) plus a curated set of real GET routes.
///  - Graph Read/Write modes: a real OAuth2 client_credentials POST straight to
///    <c>login.microsoftonline.com</c> (no MSAL.NET package needed — one HttpClient POST, avoids
///    a new NuGet download per CLAUDE.md's bandwidth-is-real-constraint rule) against the DEV app
///    registration (<c>GRAPH_TENANT_ID</c>/<c>GRAPH_CLIENT_ID</c>/<c>GRAPH_CLIENT_SECRET</c>,
///    already real in <c>.env.local</c>), reading the testbed tenant — squarely inside CLAUDE.md's
///    "DEV app registration ... is agent-modifiable, no gate" boundary.
///
/// Write-safety: Graph WRITE calls only ever actually reach the network when the caller passes
/// <paramref name="dryRun"/>=false explicitly (wired to the panel's DRY RUN/LIVE segmented control,
/// which defaults to DRY RUN on every panel open per §6.3 — see MainWindow's _apiExplorerDryRun).
/// </summary>
public static class ApiExplorerService
{
    private static readonly HttpClient Http = new();

    public static IReadOnlyList<ApiEndpoint> GetEndpoints(ApiExplorerMode mode) => mode switch
    {
        ApiExplorerMode.Local => LocalEndpoints,
        ApiExplorerMode.GraphRead => GraphReadEndpoints,
        ApiExplorerMode.GraphWrite => GraphWriteEndpoints,
        _ => Array.Empty<ApiEndpoint>(),
    };

    // Real routes, grep-verified against artifacts/api-server/src/routes/{auth,health,version,
    // public-status,admin-db-status}.ts — a representative slice, not the full 385-route catalog.
    private static readonly ApiEndpoint[] LocalEndpoints =
    {
        new("Auth", "POST", "/api/auth/login", "Login", null, "write", "{\n  \"email\": \"\",\n  \"password\": \"\"\n}"),
        new("Health", "GET", "/api/healthz", "Health check", null, "read", null),
        new("Health", "GET", "/api/version", "Version", null, "read", null),
        new("Health", "GET", "/api/status", "Public status", null, "read", null),
        new("Health", "GET", "/api/version/remote-check", "Remote version check", null, "read", null),
        new("Health", "GET", "/api/internal/deploy-status", "Deploy status", null, "read", null),
        new("Admin", "GET", "/api/admin/db-status", "DB status", "admin", "read", null),
    };

    // Real, well-known Microsoft Graph v1.0 GET surface (documented Microsoft endpoints, the same
    // ones this platform's own read paths already call).
    private static readonly ApiEndpoint[] GraphReadEndpoints =
    {
        new("Directory", "GET", "/v1.0/organization", "Organization", "Organization.Read.All", "low", null),
        new("Directory", "GET", "/v1.0/users", "List users", "User.Read.All", "low", null),
        new("Directory", "GET", "/v1.0/groups", "List groups", "Group.Read.All", "low", null),
        new("Security", "GET", "/v1.0/security/secureScores", "Secure scores", "SecurityEvents.Read.All", "low", null),
        new("Policies", "GET", "/v1.0/policies/conditionalAccessPolicies", "Conditional access policies", "Policy.Read.All", "low", null),
        new("Reports", "GET", "/v1.0/reports/getOffice365ActiveUserCounts(period='D7')", "Active user counts", "Reports.Read.All", "low", null),
    };

    // Real write shapes — matches what this platform's own write-pack layer already sends (Groups
    // Governance write pack, Git #1925/#1953), not invented endpoints.
    private static readonly ApiEndpoint[] GraphWriteEndpoints =
    {
        new("Groups", "PATCH", "/v1.0/groups/{id}", "Update group", "Group.ReadWrite.All", "high", "{\n  \"displayName\": \"\"\n}"),
        new("Groups", "POST", "/v1.0/groups/{id}/members/$ref", "Add group member", "GroupMember.ReadWrite.All", "high", "{\n  \"@odata.id\": \"https://graph.microsoft.com/v1.0/directoryObjects/{userId}\"\n}"),
        new("Users", "PATCH", "/v1.0/users/{id}", "Update user", "User.ReadWrite.All", "high", "{\n  \"accountEnabled\": false\n}"),
        new("Policies", "PATCH", "/v1.0/policies/conditionalAccessPolicies/{id}", "Update conditional access policy", "Policy.ReadWrite.ConditionalAccess", "critical", "{\n  \"state\": \"enabled\"\n}"),
    };

    // ── Graph credentials — DEV app registration, testbed tenant ────────────────────────────────
    public sealed record GraphCredentials(string TenantId, string ClientId, string ClientSecret, string TenantLabel);

    // ── Settings-store keys for a Graph App Registration added inline from the gear on the tenant
    // picker (Git #2205) — same store Settings' own screen reads/writes, per the "Settings-in-place"
    // cross-cutting rule (readme-phase2.md Step 16). Not env-var-scanned (ScanManifests only sees
    // {{TOKEN}} usages inside test-manifests/), so these are dedicated keys.
    public const string GraphTenantIdKey = "graph:tenantId";
    public const string GraphClientIdKey = "graph:clientId";
    public const string GraphClientSecretKey = "secret:graph:clientSecret";
    public const string GraphTenantLabelKey = "graph:tenantLabel";

    /// <summary>Resolves the real Graph App Registration to use: a Settings-store override added
    /// inline via the tenant picker's gear takes priority (it is the more recently and deliberately
    /// set value); otherwise falls back to GRAPH_TENANT_ID/GRAPH_CLIENT_ID/GRAPH_CLIENT_SECRET in
    /// the given repo root's <c>.env.local</c> (caller supplies <c>repoRoot</c> — MainWindow already
    /// resolves the worktree-aware main-checkout root once, via <c>LogService.MainRepoRoot</c>; this
    /// does not duplicate that walk). Null means neither is configured — callers report that
    /// honestly.</summary>
    public static GraphCredentials? ResolveGraphCredentials(string? repoRoot, ISettingsStore? settingsStore = null)
    {
        if (settingsStore != null)
        {
            var storeTenantId = settingsStore.Get(GraphTenantIdKey, "");
            var storeClientId = settingsStore.Get(GraphClientIdKey, "");
            var storeClientSecret = settingsStore.Get(GraphClientSecretKey, "");
            if (!string.IsNullOrWhiteSpace(storeTenantId) && !string.IsNullOrWhiteSpace(storeClientId) && !string.IsNullOrWhiteSpace(storeClientSecret))
            {
                var storeLabel = settingsStore.Get(GraphTenantLabelKey, "");
                return new GraphCredentials(storeTenantId, storeClientId, storeClientSecret,
                    string.IsNullOrWhiteSpace(storeLabel) ? $"{storeTenantId} (added in Settings)" : storeLabel);
            }
        }

        if (string.IsNullOrEmpty(repoRoot)) return null;
        var envLocal = Path.Combine(repoRoot, ".env.local");
        if (!File.Exists(envLocal)) return null;

        string? tenantId = null, clientId = null, clientSecret = null;
        foreach (var raw in File.ReadAllLines(envLocal))
        {
            var trimmed = raw.Trim();
            if (trimmed.StartsWith('#') || !trimmed.Contains('=')) continue;
            var eq = trimmed.IndexOf('=');
            var key = trimmed[..eq].Trim();
            var val = trimmed[(eq + 1)..].Trim().Trim('"').Trim('\'');
            if (key.Equals("GRAPH_TENANT_ID", StringComparison.OrdinalIgnoreCase)) tenantId = val;
            else if (key.Equals("GRAPH_CLIENT_ID", StringComparison.OrdinalIgnoreCase)) clientId = val;
            else if (key.Equals("GRAPH_CLIENT_SECRET", StringComparison.OrdinalIgnoreCase)) clientSecret = val;
        }
        if (string.IsNullOrWhiteSpace(tenantId) || string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
            return null;
        return new GraphCredentials(tenantId, clientId, clientSecret, "mccawsoft2 (testbed)");
    }

    /// <summary>Real OAuth2 client_credentials POST straight to login.microsoftonline.com — no
    /// MSAL.NET dependency (avoids a new NuGet download for one grant type CLAUDE.md's bandwidth
    /// rule would otherwise flag). Scope is always graph.microsoft.com/.default.</summary>
    public static async Task<(string? Token, DateTimeOffset? ExpiresAt, string Error)> AcquireGraphTokenAsync(GraphCredentials creds)
    {
        try
        {
            var form = new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials",
                ["client_id"] = creds.ClientId,
                ["client_secret"] = creds.ClientSecret,
                ["scope"] = "https://graph.microsoft.com/.default",
            };
            using var content = new FormUrlEncodedContent(form);
            using var resp = await Http.PostAsync($"https://login.microsoftonline.com/{creds.TenantId}/oauth2/v2.0/token", content);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode) return (null, null, $"{(int)resp.StatusCode} {resp.ReasonPhrase}: {SummarizeError(body)}");

            using var doc = JsonDocument.Parse(body);
            var token = doc.RootElement.GetProperty("access_token").GetString();
            var expiresIn = doc.RootElement.TryGetProperty("expires_in", out var e) && e.TryGetInt32(out var secs) ? secs : 3600;
            return (token, DateTimeOffset.UtcNow.AddSeconds(expiresIn), "");
        }
        catch (Exception ex)
        {
            return (null, null, ex.Message);
        }
    }

    /// <summary>Real POST to the local dev api-server's own <c>/api/auth/login</c>. Returns the
    /// bearer <c>accessToken</c> from the real JSON response shape (auth.ts:317
    /// <c>res.json({ accessToken, ... })</c>) — this IS the local-mode ITokenBroker.PasswordLogin
    /// shape #2202 specifies, just without a GatedProfile store wrapped around it.</summary>
    public static async Task<(string? Token, string Error)> LocalPasswordLoginAsync(string baseUrl, string email, string password)
    {
        try
        {
            var payload = JsonSerializer.Serialize(new { email, password });
            using var content = new StringContent(payload, Encoding.UTF8, "application/json");
            using var resp = await Http.PostAsync(baseUrl.TrimEnd('/') + "/api/auth/login", content);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode) return (null, $"{(int)resp.StatusCode} {resp.ReasonPhrase}: {SummarizeError(body)}");

            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("accessToken", out var tok) && tok.ValueKind == JsonValueKind.String)
                return (tok.GetString(), "");
            if (doc.RootElement.TryGetProperty("mfaRequired", out _))
                return (null, "MFA required — this account needs a second factor; password login alone can't complete it here.");
            return (null, "Login succeeded but the response carried no accessToken.");
        }
        catch (Exception ex)
        {
            return (null, ex.Message);
        }
    }

    /// <summary>Real HTTP execution — used for every local call, every Graph READ call, and a Graph
    /// WRITE call only once the caller has confirmed LIVE (see MainWindow's send handler; this
    /// method itself has no DRY RUN concept — that branch never calls it).</summary>
    public static async Task<ApiExplorerResponse> ExecuteAsync(string url, HttpMethod method, string? bearerToken, string? body)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            using var req = new HttpRequestMessage(method, url);
            if (!string.IsNullOrEmpty(bearerToken))
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
            if (!string.IsNullOrEmpty(body) && method != HttpMethod.Get)
                req.Content = new StringContent(body, Encoding.UTF8, "application/json");

            using var resp = await Http.SendAsync(req);
            var text = await resp.Content.ReadAsStringAsync();
            sw.Stop();

            var tone = resp.IsSuccessStatusCode
                ? "success"
                : ((int)resp.StatusCode == 401 || (int)resp.StatusCode == 403) ? "denied" : "error";

            return new ApiExplorerResponse
            {
                Success = resp.IsSuccessStatusCode,
                StatusCode = (int)resp.StatusCode,
                StatusText = resp.ReasonPhrase ?? "",
                Tone = tone,
                ElapsedMs = (int)sw.ElapsedMilliseconds,
                SizeBytes = Encoding.UTF8.GetByteCount(text),
                Body = PrettyPrintIfJson(text),
                RawBody = BuildRawView(resp, text, (int)sw.ElapsedMilliseconds),
            };
        }
        catch (Exception ex)
        {
            sw.Stop();
            return new ApiExplorerResponse
            {
                Success = false,
                Tone = "error",
                ElapsedMs = (int)sw.ElapsedMilliseconds,
                Body = ex.Message,
            };
        }
    }

    /// <summary>Never touches the network — builds the exact request the LIVE path would send, so
    /// DRY RUN (the default on every panel open, per §6.3) shows a real preview instead of a fake
    /// canned response.</summary>
    public static ApiExplorerResponse BuildDryRunPreview(HttpMethod method, string url, bool hasToken, string? body, string? permission = null, string? tenantLabel = null)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"{method.Method} {url}");
        if (!string.IsNullOrEmpty(tenantLabel)) sb.AppendLine($"Tenant: {tenantLabel}");
        if (!string.IsNullOrEmpty(permission)) sb.AppendLine($"Permission required: {permission}");
        sb.AppendLine(hasToken ? "Authorization: Bearer <token acquired, not shown>" : "Authorization: <no token acquired yet>");
        sb.AppendLine("Content-Type: application/json");
        if (!string.IsNullOrEmpty(body))
        {
            sb.AppendLine();
            sb.Append(body);
        }
        var text = sb.ToString();
        return new ApiExplorerResponse
        {
            Success = true,
            Tone = "dry",
            StatusText = "DRY RUN — not sent",
            ElapsedMs = 0,
            SizeBytes = Encoding.UTF8.GetByteCount(text),
            Body = text,
            RawBody = text,
        };
    }

    /// <summary>Builds the "Raw Response" view — the real status line, the diagnostic headers the
    /// readme names (content-type, request-id, client-request-id, the Graph <c>x-ms-ags-diagnostic</c>
    /// header), the duration, then the body exactly as it arrived (unindented). Distinct from the
    /// indented JSON Output view so the two tabs genuinely differ.</summary>
    private static string BuildRawView(HttpResponseMessage resp, string rawText, int elapsedMs)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"HTTP {(int)resp.StatusCode} {resp.ReasonPhrase}");
        var ct = resp.Content.Headers.ContentType?.ToString();
        if (!string.IsNullOrEmpty(ct)) sb.AppendLine($"content-type: {ct}");
        AppendHeader(sb, resp, "request-id");
        AppendHeader(sb, resp, "client-request-id");
        AppendHeader(sb, resp, "x-ms-ags-diagnostic");
        if (resp.Headers.Date.HasValue) sb.AppendLine($"date: {resp.Headers.Date.Value:R}");
        sb.AppendLine($"duration: {elapsedMs}ms");
        sb.AppendLine();
        sb.Append(rawText);
        return sb.ToString();
    }

    private static void AppendHeader(StringBuilder sb, HttpResponseMessage resp, string name)
    {
        if (resp.Headers.TryGetValues(name, out var vals))
            sb.AppendLine($"{name}: {string.Join(", ", vals)}");
    }

    // ── Permission / scope gate (Graph modes) ────────────────────────────────────────────────────

    /// <summary>Parses the granted app permissions (<c>roles</c>) and delegated scopes (<c>scp</c>)
    /// out of a JWT's payload — the honest, live source for "what this token can actually do." No
    /// signature validation (we are only reading the App Reg's own granted-scope list to drive the UI
    /// gate, not trusting the token for authorization ourselves).</summary>
    public static IReadOnlyList<string> ParseGrantedScopes(string jwt)
    {
        try
        {
            var parts = jwt.Split('.');
            if (parts.Length < 2) return Array.Empty<string>();
            using var doc = JsonDocument.Parse(Base64UrlDecode(parts[1]));
            var scopes = new List<string>();
            if (doc.RootElement.TryGetProperty("roles", out var roles) && roles.ValueKind == JsonValueKind.Array)
                foreach (var r in roles.EnumerateArray()) { var s = r.GetString(); if (!string.IsNullOrEmpty(s)) scopes.Add(s); }
            if (doc.RootElement.TryGetProperty("scp", out var scp) && scp.ValueKind == JsonValueKind.String)
                scopes.AddRange((scp.GetString() ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));
            return scopes;
        }
        catch { return Array.Empty<string>(); }
    }

    /// <summary>True when the granted scopes cover the endpoint's required permission. An empty
    /// requirement (unauthenticated local routes) is always satisfied. Matching is case-insensitive.</summary>
    public static bool HasPermission(IReadOnlyList<string> grantedScopes, string? required)
    {
        if (string.IsNullOrEmpty(required)) return true;
        return grantedScopes.Any(g => string.Equals(g, required, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Real Microsoft admin-consent URL for the App Registration — the link the amber
    /// permission banner offers when a scope is missing.</summary>
    public static string BuildAdminConsentUrl(string tenantId, string clientId) =>
        $"https://login.microsoftonline.com/{tenantId}/adminconsent?client_id={clientId}";

    private static string Base64UrlDecode(string input)
    {
        var s = input.Replace('-', '+').Replace('_', '/');
        switch (s.Length % 4) { case 2: s += "=="; break; case 3: s += "="; break; }
        return Encoding.UTF8.GetString(Convert.FromBase64String(s));
    }

    private static string PrettyPrintIfJson(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return text;
        try
        {
            using var doc = JsonDocument.Parse(text);
            return JsonSerializer.Serialize(doc.RootElement, new JsonSerializerOptions { WriteIndented = true });
        }
        catch
        {
            return text;
        }
    }

    private static string SummarizeError(string body)
    {
        var trimmed = body.Trim();
        return trimmed.Length > 300 ? trimmed[..300] + "…" : trimmed;
    }
}
