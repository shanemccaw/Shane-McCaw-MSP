using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace MyArchitect.Services;

/// <summary>
/// Persists the one credential a MyArchitect session may keep across restarts — the
/// sliding refresh token (#3501) — and nothing else. The 15-minute access token is
/// deliberately NEVER written to disk: on startup the refresh token is exchanged for a
/// fresh access token via <c>POST /api/auth/refresh</c>, which also re-resolves the
/// operator's current mspId/role from live DB state.
///
/// Stored exactly like the Credential Vault (#3461): the serialized blob is
/// <see cref="DpapiProtector"/>-wrapped (CurrentUser scope) before it touches the
/// filesystem, so the file is decryptable only by this Windows user on this machine and
/// the refresh token never sits on disk in plaintext.
/// </summary>
public sealed class SessionStore
{
    private readonly string _path;

    public SessionStore(string? pathOverride = null)
    {
        if (pathOverride != null)
        {
            _path = pathOverride;
        }
        else
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "MyArchitect");
            Directory.CreateDirectory(dir);
            _path = Path.Combine(dir, "session.dat");
        }
    }

    /// <summary>On-disk shape. Only the refresh token + its expiry + the operator's email
    /// (for a friendlier "resume as X" prompt) — never the access token.</summary>
    private sealed class PersistedSession
    {
        public string RefreshToken { get; set; } = string.Empty;
        public DateTimeOffset RefreshExpiresAt { get; set; }
        public string? Email { get; set; }
    }

    public bool Exists => File.Exists(_path);

    public void Save(string refreshToken, DateTimeOffset refreshExpiresAt, string? email)
    {
        if (string.IsNullOrWhiteSpace(refreshToken))
        {
            Clear();
            return;
        }

        var json = JsonSerializer.SerializeToUtf8Bytes(new PersistedSession
        {
            RefreshToken = refreshToken,
            RefreshExpiresAt = refreshExpiresAt,
            Email = email,
        });

        var wrapped = DpapiProtector.Protect(json);
        CryptographicOperations.ZeroMemory(json);

        var tmp = _path + ".tmp";
        File.WriteAllBytes(tmp, wrapped);
        File.Move(tmp, _path, overwrite: true);
    }

    /// <summary>Returns the stored refresh token + expiry, or <c>null</c> if none is stored,
    /// it has expired, or the file cannot be DPAPI-unwrapped (wrong user/machine, corrupt).</summary>
    public (string RefreshToken, DateTimeOffset RefreshExpiresAt, string? Email)? TryLoad()
    {
        if (!File.Exists(_path)) return null;

        byte[] json;
        try
        {
            var wrapped = File.ReadAllBytes(_path);
            json = DpapiProtector.Unprotect(wrapped);
        }
        catch
        {
            // Unreadable/corrupt/wrong-user — treat as no stored session rather than crash.
            return null;
        }

        try
        {
            var persisted = JsonSerializer.Deserialize<PersistedSession>(json);
            if (persisted == null || string.IsNullOrWhiteSpace(persisted.RefreshToken)) return null;
            if (DateTimeOffset.UtcNow >= persisted.RefreshExpiresAt) return null;
            return (persisted.RefreshToken, persisted.RefreshExpiresAt, persisted.Email);
        }
        catch
        {
            return null;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(json);
        }
    }

    public void Clear()
    {
        try
        {
            if (File.Exists(_path)) File.Delete(_path);
        }
        catch
        {
            // Best-effort — a locked/removed file is not worth crashing sign-out over.
        }
    }
}
