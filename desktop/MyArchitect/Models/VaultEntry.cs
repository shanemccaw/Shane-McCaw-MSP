using System;

namespace MyArchitect.Models;

/// <summary>
/// One credential in the local, per-tenant Credential Vault (#3461).
///
/// The <see cref="TenantGuid"/> FK scopes an entry to a single tenant; <see cref="Label"/> and
/// <see cref="Username"/> are metadata. The password itself is never held here in clear — it lives
/// only as the AES-GCM ciphertext triple (<see cref="SecretCipher"/>/<see cref="SecretNonce"/>/
/// <see cref="SecretTag"/>), decryptable only with the session master key. The whole vault file is
/// additionally DPAPI-wrapped (CurrentUser) at rest, so labels/usernames are protected too and the
/// file is bound to the Windows login — it cannot be read on another machine or by another user.
/// This model is local-only and never syncs to any backend (spec: "Never syncs to any backend").
/// </summary>
public sealed class VaultEntry
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    /// <summary>FK to the owning tenant (<see cref="Tenant.TenantGuid"/>).</summary>
    public string TenantGuid { get; set; } = string.Empty;

    public string Label { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;

    // AES-GCM ciphertext of the password, keyed by the session master key (PBKDF2 of the master
    // password). Base64. Never contains, and is never derivable to, plaintext without that key.
    public string SecretCipher { get; set; } = string.Empty;
    public string SecretNonce { get; set; } = string.Empty;
    public string SecretTag { get; set; } = string.Empty;

    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedUtc { get; set; } = DateTime.UtcNow;
}
