using System;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// The real MyArchitect login/session mechanism (#3501). Owns the operator's live
/// <see cref="AuthSession"/> — the bearer access token every auth-gated api-server call
/// needs and the numeric mspId requireMspScope enforces — and keeps it fresh via the
/// server's sliding refresh flow. Every service that attaches an <c>Authorization</c>
/// header sources its token from here (pushed on <see cref="SessionChanged"/>), rather
/// than each inventing its own credential.
/// </summary>
public interface IAuthService
{
    /// <summary>The current live session, or <c>null</c> when signed out.</summary>
    AuthSession? CurrentSession { get; }

    bool IsAuthenticated { get; }

    /// <summary>Current bearer access token, or <c>null</c> when signed out. This is what
    /// every service's <c>AuthToken</c> property is set to.</summary>
    string? AccessToken { get; }

    /// <summary>The signed-in operator's MSP id (users.msp_id claim), or <c>null</c>.</summary>
    int? MspId { get; }

    /// <summary>Raised whenever the session changes — sign-in, sign-out, or a token refresh.
    /// Consumers re-read <see cref="AccessToken"/>/<see cref="MspId"/> and re-push the token
    /// into their services.</summary>
    event Action? SessionChanged;

    /// <summary>Email + password → session. Returns <see cref="LoginOutcome.MfaRequired"/>
    /// (call <see cref="VerifyMfaAsync"/> next), <see cref="LoginOutcome.Success"/>, or
    /// <see cref="LoginOutcome.Failed"/> carrying the real server error.</summary>
    Task<LoginResult> LoginAsync(string email, string password, CancellationToken cancellationToken = default);

    /// <summary>Complete an MFA challenge started by <see cref="LoginAsync"/>.</summary>
    Task<LoginResult> VerifyMfaAsync(string mfaToken, string method, string code, CancellationToken cancellationToken = default);

    /// <summary>Attempt to restore a session on startup from the DPAPI-stored refresh token.
    /// Returns <c>true</c> if a live session was re-established.</summary>
    Task<bool> TryRestoreSessionAsync(CancellationToken cancellationToken = default);

    /// <summary>Ensure the access token is valid, refreshing it if it is at/near expiry.
    /// Returns <c>false</c> if the session could not be kept alive (refresh expired/revoked),
    /// which means the operator must sign in again.</summary>
    Task<bool> EnsureValidTokenAsync(CancellationToken cancellationToken = default);

    /// <summary>Revoke the refresh token server-side, clear the stored session and memory.</summary>
    Task SignOutAsync(CancellationToken cancellationToken = default);
}
