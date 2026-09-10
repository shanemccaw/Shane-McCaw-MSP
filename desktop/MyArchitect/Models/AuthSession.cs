using System;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// The real, verified operator claims MyArchitect holds after a successful login
/// (#3501). Deserialized directly from the <c>user</c> object the api-server's
/// <c>POST /api/auth/login</c> / <c>/api/auth/refresh</c> / <c>/api/auth/mfa/verify</c>
/// responses return — which is the exact decoded JWT payload the server signed
/// (<c>artifacts/api-server/src/routes/auth.ts</c> <c>buildUserPayload</c>). We do NOT
/// decode the JWT ourselves; the server hands us the same claims alongside the token,
/// so the numeric <see cref="MspId"/> and <see cref="CustomerId"/> every auth-gated
/// route needs come straight off this object.
/// </summary>
public sealed class AuthUserClaims
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>Coarse legacy role: "admin" | "client".</summary>
    [JsonPropertyName("role")]
    public string? Role { get; set; }

    /// <summary>Ladder role: PlatformAdmin | MSPAdmin | MSPOperator | ServiceAccount | CustomerUser | Free | Assessment.</summary>
    [JsonPropertyName("mspRole")]
    public string? MspRole { get; set; }

    /// <summary>The MSP this staff user belongs to (users.msp_id). Required for every
    /// <c>/api/msp/:mspId/...</c> route; requireMspScope verifies it matches the JWT claim.</summary>
    [JsonPropertyName("mspId")]
    public int? MspId { get; set; }

    /// <summary>Frozen claim name carrying users.tenant_id (a tenants.id) — the tenant the
    /// logged-in user themselves belong to. Not the target customer of an MSP operation.</summary>
    [JsonPropertyName("customerId")]
    public int? CustomerId { get; set; }

    [JsonPropertyName("mspSlug")]
    public string? MspSlug { get; set; }

    /// <summary>Set only when MFA is enforced for this account but nothing is enrolled yet
    /// (Git #439). A session with this flag can reach only the MFA-enrollment routes.</summary>
    [JsonPropertyName("mfaSetupPending")]
    public bool MfaSetupPending { get; set; }
}

/// <summary>
/// A live authenticated MyArchitect session (#3501). Holds the short-lived bearer
/// <see cref="AccessToken"/> (15-minute TTL, memory-only) and the sliding
/// <see cref="RefreshToken"/> (7-day TTL) used to mint a fresh access token. The refresh
/// token is the only credential ever persisted, and only DPAPI-wrapped
/// (see <see cref="Services.SessionStore"/>) — never the access token, never in plaintext.
/// </summary>
public sealed class AuthSession
{
    public string AccessToken { get; set; } = string.Empty;
    public string RefreshToken { get; set; } = string.Empty;
    public DateTimeOffset RefreshExpiresAt { get; set; }

    /// <summary>When the access token itself expires. The server's TTL is 15m; we record
    /// the local issue time + 15m so the refresh loop can renew proactively before a call
    /// would 401.</summary>
    public DateTimeOffset AccessTokenExpiresAt { get; set; }

    public AuthUserClaims User { get; set; } = new();

    public bool RefreshTokenExpired => DateTimeOffset.UtcNow >= RefreshExpiresAt;
}

/// <summary>Shape of the api-server session response body (login / refresh / mfa verify).</summary>
public sealed class AuthTokenResponse
{
    [JsonPropertyName("accessToken")]
    public string? AccessToken { get; set; }

    [JsonPropertyName("refreshToken")]
    public string? RefreshToken { get; set; }

    [JsonPropertyName("refreshExpiresAt")]
    public DateTimeOffset? RefreshExpiresAt { get; set; }

    [JsonPropertyName("user")]
    public AuthUserClaims? User { get; set; }

    // MFA challenge branch (POST /api/auth/login when the account has enrolled methods).
    [JsonPropertyName("mfaRequired")]
    public bool MfaRequired { get; set; }

    [JsonPropertyName("mfaToken")]
    public string? MfaToken { get; set; }

    [JsonPropertyName("methods")]
    public string[]? Methods { get; set; }

    // Error / lockout fields.
    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("accountLocked")]
    public bool AccountLocked { get; set; }
}

/// <summary>Outcome of a login/MFA attempt, surfaced to the login UI.</summary>
public enum LoginOutcome
{
    Success,
    MfaRequired,
    Failed,
}

/// <summary>Result of <see cref="Services.IAuthService.LoginAsync"/> / VerifyMfaAsync.</summary>
public sealed class LoginResult
{
    public LoginOutcome Outcome { get; init; }

    /// <summary>Present when <see cref="Outcome"/> is <see cref="LoginOutcome.MfaRequired"/> —
    /// carry it back into VerifyMfaAsync along with the operator's code.</summary>
    public string? MfaToken { get; init; }

    public string[]? Methods { get; init; }

    /// <summary>Present when <see cref="Outcome"/> is <see cref="LoginOutcome.Failed"/> — the
    /// real, honest server message (bad credentials, account locked, etc.).</summary>
    public string? ErrorMessage { get; init; }

    public static LoginResult Success() => new() { Outcome = LoginOutcome.Success };
    public static LoginResult Mfa(string? token, string[]? methods) =>
        new() { Outcome = LoginOutcome.MfaRequired, MfaToken = token, Methods = methods };
    public static LoginResult Fail(string? message) =>
        new() { Outcome = LoginOutcome.Failed, ErrorMessage = message };
}
