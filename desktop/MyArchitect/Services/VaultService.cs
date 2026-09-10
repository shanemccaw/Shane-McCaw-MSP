using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real implementation of the local Credential Vault (#3461).
///
/// Two independent encryption layers, both real:
///   1. <b>DPAPI (Windows-login binding)</b> — the entire serialized vault file is
///      <see cref="DpapiProtector"/>-wrapped (CurrentUser scope) at rest, so it is decryptable
///      only by this Windows user on this machine. This protects labels/usernames too and is what
///      "DPAPI-encrypted, tied to Windows login" means.
///   2. <b>Master password (session gate)</b> — each entry's password is AES-256-GCM encrypted
///      with a key derived (PBKDF2-SHA256) from the master password the operator types to unlock
///      the session. The key lives in memory only while unlocked; <see cref="Lock"/> zeroes it.
///
/// The two layers are complementary: DPAPI stops the file leaving the machine; the master password
/// stops a walk-up read of a vault left unlocked-on-disk (the file is never written unlocked — it
/// is always DPAPI-wrapped, and secrets inside are always master-key encrypted).
/// </summary>
public sealed class VaultService : IVaultService
{
    private const int FormatVersion = 1;
    private const int KdfIterations = 210_000;
    private const int KdfSaltBytes = 16;
    private const int KeyBytes = 32;    // AES-256
    private const int NonceBytes = 12;  // AES-GCM standard nonce
    private const int TagBytes = 16;    // AES-GCM tag
    private static readonly byte[] VerifierToken =
        Encoding.UTF8.GetBytes("MYARCHITECT_VAULT_VERIFIER_V1");

    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = false };

    private readonly string _vaultPath;

    // Present only while unlocked.
    private byte[]? _masterKey;
    private VaultFile? _vault;

    public VaultService(string? vaultPathOverride = null)
    {
        if (vaultPathOverride != null)
        {
            _vaultPath = vaultPathOverride;
        }
        else
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "MyArchitect");
            Directory.CreateDirectory(dir);
            _vaultPath = Path.Combine(dir, "vault.dat");
        }
    }

    public bool IsInitialized => File.Exists(_vaultPath);
    public bool IsUnlocked => _masterKey != null && _vault != null;

    public event Action? StateChanged;

    public void CreateVault(string masterPassword)
    {
        if (IsInitialized)
        {
            throw new InvalidOperationException("A vault already exists — unlock it instead.");
        }
        RequireNonEmpty(masterPassword, nameof(masterPassword));

        var salt = RandomNumberGenerator.GetBytes(KdfSaltBytes);
        var key = DeriveKey(masterPassword, salt, KdfIterations);
        var (vNonce, vCipher, vTag) = Encrypt(key, VerifierToken);

        var vault = new VaultFile
        {
            Version = FormatVersion,
            KdfSalt = Convert.ToBase64String(salt),
            KdfIterations = KdfIterations,
            VerifierNonce = Convert.ToBase64String(vNonce),
            VerifierCipher = Convert.ToBase64String(vCipher),
            VerifierTag = Convert.ToBase64String(vTag),
            Entries = new List<VaultEntry>(),
        };

        _masterKey = key;
        _vault = vault;
        Persist();
        StateChanged?.Invoke();
    }

    public bool Unlock(string masterPassword)
    {
        if (!IsInitialized) throw new InvalidOperationException("No vault exists yet — create one first.");
        if (string.IsNullOrEmpty(masterPassword)) return false;

        var vault = LoadFromDisk();
        var salt = Convert.FromBase64String(vault.KdfSalt);
        var key = DeriveKey(masterPassword, salt, vault.KdfIterations);

        // Validate against the verifier: AES-GCM authenticates, so a wrong key fails the tag
        // check and returns false rather than silently producing garbage.
        try
        {
            var plain = Decrypt(
                key,
                Convert.FromBase64String(vault.VerifierNonce),
                Convert.FromBase64String(vault.VerifierCipher),
                Convert.FromBase64String(vault.VerifierTag));

            if (!CryptographicOperations.FixedTimeEquals(plain, VerifierToken))
            {
                CryptographicOperations.ZeroMemory(key);
                return false;
            }
        }
        catch (AuthenticationTagMismatchException)
        {
            CryptographicOperations.ZeroMemory(key);
            return false;
        }

        _masterKey = key;
        _vault = vault;
        StateChanged?.Invoke();
        return true;
    }

    public void Lock()
    {
        if (_masterKey != null)
        {
            CryptographicOperations.ZeroMemory(_masterKey);
            _masterKey = null;
        }
        _vault = null;
        StateChanged?.Invoke();
    }

    public IReadOnlyList<VaultEntry> GetEntries(string tenantGuid)
    {
        RequireUnlocked();
        return _vault!.Entries
            .Where(e => string.Equals(e.TenantGuid, tenantGuid, StringComparison.OrdinalIgnoreCase))
            .OrderBy(e => e.Label, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public string RevealSecret(VaultEntry entry)
    {
        RequireUnlocked();
        var plain = Decrypt(
            _masterKey!,
            Convert.FromBase64String(entry.SecretNonce),
            Convert.FromBase64String(entry.SecretCipher),
            Convert.FromBase64String(entry.SecretTag));
        return Encoding.UTF8.GetString(plain);
    }

    public VaultEntry AddEntry(string tenantGuid, string label, string username, string password)
    {
        RequireUnlocked();
        RequireNonEmpty(tenantGuid, nameof(tenantGuid));
        RequireNonEmpty(label, nameof(label));

        var (nonce, cipher, tag) = Encrypt(_masterKey!, Encoding.UTF8.GetBytes(password ?? string.Empty));
        var entry = new VaultEntry
        {
            TenantGuid = tenantGuid,
            Label = label.Trim(),
            Username = (username ?? string.Empty).Trim(),
            SecretNonce = Convert.ToBase64String(nonce),
            SecretCipher = Convert.ToBase64String(cipher),
            SecretTag = Convert.ToBase64String(tag),
            CreatedUtc = DateTime.UtcNow,
            UpdatedUtc = DateTime.UtcNow,
        };
        _vault!.Entries.Add(entry);
        Persist();
        return entry;
    }

    public void UpdateEntry(string id, string label, string username, string? newPassword)
    {
        RequireUnlocked();
        var entry = _vault!.Entries.FirstOrDefault(e => e.Id == id)
            ?? throw new InvalidOperationException($"No vault entry with id '{id}'.");
        RequireNonEmpty(label, nameof(label));

        entry.Label = label.Trim();
        entry.Username = (username ?? string.Empty).Trim();
        if (newPassword != null)
        {
            var (nonce, cipher, tag) = Encrypt(_masterKey!, Encoding.UTF8.GetBytes(newPassword));
            entry.SecretNonce = Convert.ToBase64String(nonce);
            entry.SecretCipher = Convert.ToBase64String(cipher);
            entry.SecretTag = Convert.ToBase64String(tag);
        }
        entry.UpdatedUtc = DateTime.UtcNow;
        Persist();
    }

    public void DeleteEntry(string id)
    {
        RequireUnlocked();
        var removed = _vault!.Entries.RemoveAll(e => e.Id == id);
        if (removed > 0) Persist();
    }

    // ---- crypto primitives -----------------------------------------------------------------

    private static byte[] DeriveKey(string password, byte[] salt, int iterations) =>
        Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, KeyBytes);

    private static (byte[] Nonce, byte[] Cipher, byte[] Tag) Encrypt(byte[] key, byte[] plaintext)
    {
        var nonce = RandomNumberGenerator.GetBytes(NonceBytes);
        var cipher = new byte[plaintext.Length];
        var tag = new byte[TagBytes];
        using var gcm = new AesGcm(key, TagBytes);
        gcm.Encrypt(nonce, plaintext, cipher, tag);
        return (nonce, cipher, tag);
    }

    private static byte[] Decrypt(byte[] key, byte[] nonce, byte[] cipher, byte[] tag)
    {
        var plain = new byte[cipher.Length];
        using var gcm = new AesGcm(key, TagBytes);
        gcm.Decrypt(nonce, cipher, tag, plain);
        return plain;
    }

    // ---- persistence (DPAPI-wrapped, atomic write) -----------------------------------------

    private void Persist()
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(_vault!, JsonOpts);
        var wrapped = DpapiProtector.Protect(json);
        CryptographicOperations.ZeroMemory(json); // don't leave the clear JSON in a heap buffer

        var tmp = _vaultPath + ".tmp";
        File.WriteAllBytes(tmp, wrapped);
        File.Move(tmp, _vaultPath, overwrite: true);
    }

    private VaultFile LoadFromDisk()
    {
        var wrapped = File.ReadAllBytes(_vaultPath);
        var json = DpapiProtector.Unprotect(wrapped);
        try
        {
            return JsonSerializer.Deserialize<VaultFile>(json)
                ?? throw new InvalidDataException("Vault file is empty or corrupt.");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(json);
        }
    }

    private void RequireUnlocked()
    {
        if (!IsUnlocked)
        {
            throw new InvalidOperationException("Vault is locked — unlock it with the master password first.");
        }
    }

    private static void RequireNonEmpty(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException($"{name} is required.", name);
        }
    }

    /// <summary>On-disk shape. Serialized to JSON, then DPAPI-wrapped as a whole before it ever
    /// touches the filesystem.</summary>
    private sealed class VaultFile
    {
        public int Version { get; set; } = FormatVersion;
        public string KdfSalt { get; set; } = string.Empty;
        public int KdfIterations { get; set; } = VaultService.KdfIterations;
        public string VerifierNonce { get; set; } = string.Empty;
        public string VerifierCipher { get; set; } = string.Empty;
        public string VerifierTag { get; set; } = string.Empty;
        public List<VaultEntry> Entries { get; set; } = new();
    }
}
