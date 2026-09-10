using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real implementation of the MyArchitect login/session mechanism (#3501), talking to the
/// api-server's existing MSP-staff auth contract — the same one the web Portal and Admin
/// Panel use, not a parallel one:
///
///   POST /api/auth/login        { email, password } -> { accessToken, refreshToken, refreshExpiresAt, user }
///                                                    or { mfaRequired, mfaToken, methods }
///   POST /api/auth/mfa/verify   { mfaToken, method, code } -> session
///   POST /api/auth/refresh      { refreshToken } -> session   (the body-based "native client" path)
///   POST /api/auth/logout       { refreshToken }
///
/// The access token (15m TTL) lives in memory only; the refresh token (7d TTL) is
/// DPAPI-persisted by <see cref="SessionStore"/>. A background timer refreshes the access
/// token a couple of minutes before it would expire so an open cockpit never 401s mid-use,
/// and <see cref="EnsureValidTokenAsync"/> covers a wake-from-sleep gap on demand.
/// </summary>
public sealed class AuthService : IAuthService, IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    // Server access-token TTL is 15m; renew with a safety margin so a call never rides an
    // almost-dead token. Matches the portal's ~13-minute silent-refresh cadence.
    private static readonly TimeSpan AccessTokenTtl = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan RefreshSkew = TimeSpan.FromMinutes(2);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private readonly SessionStore _store;
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private readonly System.Timers.Timer _refreshTimer;

    private AuthSession? _session;

    public AuthService(HttpClient? httpClient = null, string? baseUrl = null, SessionStore? store = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        _store = store ?? new SessionStore();

        // Periodic proactive refresh. Cheap no-op while signed out.
        _refreshTimer = new System.Timers.Timer(TimeSpan.FromMinutes(3).TotalMilliseconds) { AutoReset = true };
        _refreshTimer.Elapsed += async (_, _) =>
        {
            try { await EnsureValidTokenAsync().ConfigureAwait(false); }
            catch { /* transient — next tick retries; EnsureValidTokenAsync signs out on hard failure */ }
        };
        _refreshTimer.Start();
    }

    public AuthSession? CurrentSession => _session;
    public bool IsAuthenticated => _session != null && !string.IsNullOrEmpty(_session.AccessToken);
    public string? AccessToken => _session?.AccessToken;
    public int? MspId => _session?.User.MspId;

    public event Action? SessionChanged;

    public async Task<LoginResult> LoginAsync(string email, string password, CancellationToken cancellationToken = default)
    {
        AuthTokenResponse resp;
        try
        {
            resp = await PostAsync("/api/auth/login", new { email, password }, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            return LoginResult.Fail($"Could not reach the server: {ex.Message}");
        }

        if (resp.MfaRequired)
        {
            return LoginResult.Mfa(resp.MfaToken, resp.Methods);
        }

        if (!string.IsNullOrEmpty(resp.AccessToken))
        {
            AdoptSession(resp);
            return LoginResult.Success();
        }

        return LoginResult.Fail(resp.Error ?? "Sign-in failed.");
    }

    public async Task<LoginResult> VerifyMfaAsync(string mfaToken, string method, string code, CancellationToken cancellationToken = default)
    {
        AuthTokenResponse resp;
        try
        {
            resp = await PostAsync("/api/auth/mfa/verify", new { mfaToken, method, code }, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            return LoginResult.Fail($"Could not reach the server: {ex.Message}");
        }

        if (!string.IsNullOrEmpty(resp.AccessToken))
        {
            AdoptSession(resp);
            return LoginResult.Success();
        }

        return LoginResult.Fail(resp.Error ?? "MFA verification failed.");
    }

    public async Task<bool> TryRestoreSessionAsync(CancellationToken cancellationToken = default)
    {
        var stored = _store.TryLoad();
        if (stored == null) return false;

        try
        {
            var resp = await PostAsync("/api/auth/refresh", new { refreshToken = stored.Value.RefreshToken }, cancellationToken)
                .ConfigureAwait(false);
            if (!string.IsNullOrEmpty(resp.AccessToken))
            {
                AdoptSession(resp);
                return true;
            }
        }
        catch
        {
            // Server unreachable at startup — leave the stored token in place (it may still be
            // valid later); the operator just signs in manually now.
            return false;
        }

        // Server answered but rejected the refresh token (expired/revoked) — drop it.
        _store.Clear();
        return false;
    }

    public async Task<bool> EnsureValidTokenAsync(CancellationToken cancellationToken = default)
    {
        var session = _session;
        if (session == null) return false;

        if (DateTimeOffset.UtcNow < session.AccessTokenExpiresAt - RefreshSkew)
        {
            return true; // still comfortably valid
        }

        await _refreshGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            // Re-check under the gate — another caller may have just refreshed.
            session = _session;
            if (session == null) return false;
            if (DateTimeOffset.UtcNow < session.AccessTokenExpiresAt - RefreshSkew) return true;

            if (session.RefreshTokenExpired)
            {
                await SignOutLocalAsync().ConfigureAwait(false);
                return false;
            }

            AuthTokenResponse resp;
            try
            {
                resp = await PostAsync("/api/auth/refresh", new { refreshToken = session.RefreshToken }, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch
            {
                // Transient network failure — keep the current session; a later tick/call retries.
                return false;
            }

            if (!string.IsNullOrEmpty(resp.AccessToken))
            {
                AdoptSession(resp);
                return true;
            }

            // Server rejected the refresh token — the session is genuinely dead.
            await SignOutLocalAsync().ConfigureAwait(false);
            return false;
        }
        finally
        {
            _refreshGate.Release();
        }
    }

    public async Task SignOutAsync(CancellationToken cancellationToken = default)
    {
        var refreshToken = _session?.RefreshToken;
        if (!string.IsNullOrEmpty(refreshToken))
        {
            try
            {
                await PostAsync("/api/auth/logout", new { refreshToken }, cancellationToken).ConfigureAwait(false);
            }
            catch
            {
                // Best-effort server-side revoke; local sign-out proceeds regardless.
            }
        }

        await SignOutLocalAsync().ConfigureAwait(false);
    }

    private Task SignOutLocalAsync()
    {
        _session = null;
        _store.Clear();
        SessionChanged?.Invoke();
        return Task.CompletedTask;
    }

    private void AdoptSession(AuthTokenResponse resp)
    {
        _session = new AuthSession
        {
            AccessToken = resp.AccessToken ?? string.Empty,
            RefreshToken = resp.RefreshToken ?? string.Empty,
            RefreshExpiresAt = resp.RefreshExpiresAt ?? DateTimeOffset.UtcNow.AddDays(7),
            AccessTokenExpiresAt = DateTimeOffset.UtcNow.Add(AccessTokenTtl),
            User = resp.User ?? new AuthUserClaims(),
        };

        // Persist only the refresh token, DPAPI-wrapped — never the access token.
        if (!string.IsNullOrEmpty(_session.RefreshToken))
        {
            _store.Save(_session.RefreshToken, _session.RefreshExpiresAt, _session.User.Email);
        }

        SessionChanged?.Invoke();
    }

    private async Task<AuthTokenResponse> PostAsync(string path, object body, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}{path}")
        {
            Content = new StringContent(JsonSerializer.Serialize(body, JsonOptions), Encoding.UTF8, "application/json"),
        };

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        AuthTokenResponse? parsed = null;
        if (!string.IsNullOrWhiteSpace(text))
        {
            try { parsed = JsonSerializer.Deserialize<AuthTokenResponse>(text, JsonOptions); }
            catch { /* non-JSON body (proxy error page, etc.) — fall through to a status-based message */ }
        }

        parsed ??= new AuthTokenResponse();

        // On a non-2xx with no server-supplied message, synthesize an honest one from the status.
        if (!response.IsSuccessStatusCode && string.IsNullOrEmpty(parsed.Error))
        {
            parsed.Error = response.StatusCode == HttpStatusCode.Unauthorized
                ? "Invalid email or password."
                : $"Server returned {(int)response.StatusCode} {response.ReasonPhrase}.";
        }

        return parsed;
    }

    public void Dispose()
    {
        _refreshTimer.Stop();
        _refreshTimer.Dispose();
        _refreshGate.Dispose();
    }
}
