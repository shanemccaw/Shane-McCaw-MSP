using System;
using System.Collections.Generic;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// The local, per-tenant Credential Vault (#3461). Local-only, DPAPI-encrypted (tied to the
/// Windows login), gated by a master unlock each session. Never syncs to any backend and is never
/// exposed to Claude Chat or any other module — only <see cref="VaultService"/> and the Vault UI
/// hold a reference, and plaintext secrets never leave this service except via an explicit user
/// reveal/copy action.
/// </summary>
public interface IVaultService
{
    /// <summary>True once a master password has been set (the vault file exists).</summary>
    bool IsInitialized { get; }

    /// <summary>True while the session holds the derived master key in memory. Cleared by
    /// <see cref="Lock"/>.</summary>
    bool IsUnlocked { get; }

    /// <summary>Fires when <see cref="IsInitialized"/> or <see cref="IsUnlocked"/> changes.</summary>
    event Action? StateChanged;

    /// <summary>First-run setup: sets the master password, writes a fresh empty (DPAPI-wrapped)
    /// vault, and leaves the session unlocked. Throws if a vault already exists.</summary>
    void CreateVault(string masterPassword);

    /// <summary>Unlocks the session by validating <paramref name="masterPassword"/> against the
    /// stored verifier. Returns false on a wrong password (no exception, no lockout side effect).</summary>
    bool Unlock(string masterPassword);

    /// <summary>Zeroes the in-memory master key and drops decrypted state. Idempotent.</summary>
    void Lock();

    /// <summary>Entries for one tenant (metadata only — the secret stays encrypted). Requires
    /// unlocked.</summary>
    IReadOnlyList<VaultEntry> GetEntries(string tenantGuid);

    /// <summary>Decrypts and returns the plaintext password for one entry. Requires unlocked.</summary>
    string RevealSecret(VaultEntry entry);

    /// <summary>Adds a new credential, encrypting <paramref name="password"/> with the session
    /// master key, and persists. Requires unlocked.</summary>
    VaultEntry AddEntry(string tenantGuid, string label, string username, string password);

    /// <summary>Updates an entry's label/username, and its password when
    /// <paramref name="newPassword"/> is non-null (null leaves the secret untouched). Persists.
    /// Requires unlocked.</summary>
    void UpdateEntry(string id, string label, string username, string? newPassword);

    /// <summary>Deletes an entry and persists. Requires unlocked.</summary>
    void DeleteEntry(string id);
}
