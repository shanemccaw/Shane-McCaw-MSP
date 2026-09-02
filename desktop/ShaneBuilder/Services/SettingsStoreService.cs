using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ShaneBuilder.Services;

/// <summary>Git #2204 — the real, single Settings backing store for ShaneBuilder. Plain values
/// (toggles, text, the account-profile roster minus passwords, the Claude Projects lists) live in
/// one JSON file at <c>%AppData%\ShaneBuilder\settings.json</c>. Anything secret-shaped — API
/// tokens, gated-profile passwords, env var values whose name matches
/// <c>SECRET|PASSWORD|TOKEN|KEY</c> — is written through <see cref="WindowsCredentialManager"/>
/// instead, per the contract's own "credentials in Windows Credential Manager" line. No fixture
/// data anywhere: every value starts unset until Shane (or the UI) writes one, and
/// <see cref="ScanManifests"/> is a real regex scan of the actual <c>test-manifests/</c> tree on
/// disk, not a seeded list.</summary>
public sealed class SettingsStoreService : ISettingsStore
{
    private static readonly Regex TokenPattern = new(@"\{\{([A-Z_][A-Z0-9_]*)\}\}", RegexOptions.Compiled);
    private static readonly Regex SecretNamePattern = new(@"SECRET|PASSWORD|TOKEN|KEY", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private readonly string _settingsPath;
    private readonly string? _repoRoot;
    private Dictionary<string, JsonElement> _cache;

    public SettingsStoreService(string? repoRoot)
    {
        _repoRoot = repoRoot;
        _settingsPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "ShaneBuilder", "settings.json");
        _cache = Load();
    }

    private Dictionary<string, JsonElement> Load()
    {
        try
        {
            if (File.Exists(_settingsPath))
            {
                var json = File.ReadAllText(_settingsPath);
                var parsed = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json);
                if (parsed != null) return parsed;
            }
        }
        catch { /* corrupt/missing file — start clean rather than crash the Settings page */ }
        return new Dictionary<string, JsonElement>();
    }

    private void Save()
    {
        try
        {
            var dir = Path.GetDirectoryName(_settingsPath);
            if (dir != null) Directory.CreateDirectory(dir);
            var json = JsonSerializer.Serialize(_cache, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(_settingsPath, json);
        }
        catch { /* best-effort — a failed persist doesn't crash the settings row that triggered it */ }
    }

    private const string SecretPrefix = "secret:";

    public T Get<T>(string key, T fallback)
    {
        if (key.StartsWith(SecretPrefix, StringComparison.Ordinal))
        {
            var raw = WindowsCredentialManager.Read(key.Substring(SecretPrefix.Length));
            if (raw == null) return fallback;
            if (typeof(T) == typeof(string)) return (T)(object)raw;
            return fallback;
        }

        if (!_cache.TryGetValue(key, out var el)) return fallback;
        try
        {
            var value = el.Deserialize<T>();
            return value == null ? fallback : value;
        }
        catch { return fallback; }
    }

    public void Set<T>(string key, T value)
    {
        if (key.StartsWith(SecretPrefix, StringComparison.Ordinal))
        {
            WindowsCredentialManager.Write(key.Substring(SecretPrefix.Length), value?.ToString() ?? "");
            return;
        }

        _cache[key] = JsonSerializer.SerializeToElement(value);
        Save();
    }

    /// <summary>Real domain classification off the variable's own name — no per-name table to
    /// keep in sync, no fabricated mapping. Order matters: a Graph-scoped secret (e.g.
    /// <c>GRAPH_TEST_CLIENT_SECRET</c>) reads as Graph, not generic Auth.</summary>
    public static string ClassifyDomain(string name)
    {
        var n = name.ToUpperInvariant();
        if (n.Contains("GRAPH") || n.Contains("MT_APP") || n.Contains("TENANT_ID") || n.Contains("CLIENT_ID") || n.Contains("CLIENT_SECRET"))
            return "graph";
        // SMTP/MAILER only — a bare "MAIL" substring false-positives on real names like
        // TEST_ADMIN_EMAIL, TEST_PORTAL_EMAIL and TEST_MAILBOX_ID (login/session identifiers,
        // not mail-server config).
        if (n.Contains("SMTP") || n.Contains("MAILER"))
            return "mailer";
        if (n.Contains("ADMIN"))
            return "admin";
        if (n.Contains("COPILOT") || n.Contains("_AI_") || n.StartsWith("AI_") || n.EndsWith("_AI"))
            return "ai";
        if (n.Contains("SMOKE"))
            return "smoke";
        if (SecretNamePattern.IsMatch(n) || n.Contains("WEBHOOK"))
            return "auth";
        return "general";
    }

    public static bool IsSecretShaped(string name) => SecretNamePattern.IsMatch(name);

    /// <summary>Real scan of every <c>test-manifests/**/*.json</c> file for <c>{{NAME}}</c>
    /// interpolation tokens (test-manifests' own real convention — see e.g.
    /// <c>test-manifests/auth/verification-code-flow.json</c>). Values come from this same store
    /// (unset until filled in the UI); usage counts and file lists are the real, live filesystem
    /// state at scan time.</summary>
    public IReadOnlyList<EnvVar> ScanManifests()
    {
        if (string.IsNullOrEmpty(_repoRoot)) return Array.Empty<EnvVar>();
        var manifestsDir = Path.Combine(_repoRoot, "test-manifests");
        if (!Directory.Exists(manifestsDir)) return Array.Empty<EnvVar>();

        var usage = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var file in Directory.EnumerateFiles(manifestsDir, "*.json", SearchOption.AllDirectories))
        {
            string text;
            try { text = File.ReadAllText(file); }
            catch { continue; }

            var rel = Path.GetRelativePath(manifestsDir, file).Replace('\\', '/');
            foreach (var name in TokenPattern.Matches(text).Select(m => m.Groups[1].Value).Distinct())
            {
                if (!usage.TryGetValue(name, out var list)) usage[name] = list = new List<string>();
                list.Add(rel);
            }
        }

        var result = new List<EnvVar>();
        foreach (var name in usage.Keys.OrderBy(n => n, StringComparer.Ordinal))
        {
            var domain = ClassifyDomain(name);
            var value = IsSecretShaped(name)
                ? Get($"{SecretPrefix}envval:{name}", "")
                : Get($"envval:{name}", "");
            result.Add(new EnvVar(name, domain, value, usage[name].OrderBy(f => f, StringComparer.Ordinal).ToArray()));
        }
        return result;
    }

    /// <summary>Sets (or clears, on empty) the real value backing one scanned env var, routing
    /// through the credential store for secret-shaped names the same way <see cref="ScanManifests"/>
    /// reads them back.</summary>
    public void SetEnvVarValue(string name, string value)
    {
        if (IsSecretShaped(name)) Set($"{SecretPrefix}envval:{name}", value);
        else Set($"envval:{name}", value);
    }

    // ── Accounts & Tiers — the single source of truth #2202's autofill lock reads from ─────────
    public IReadOnlyList<AccountProfile> GetProfiles()
    {
        var ids = Get("profiles:ids", Array.Empty<string>());
        var list = new List<AccountProfile>();
        foreach (var id in ids)
        {
            var user = Get($"profiles:{id}:user", "");
            if (string.IsNullOrEmpty(user)) continue; // deleted/corrupt row — skip rather than show a blank card
            var desc = Get($"profiles:{id}:desc", "");
            var tier = Get($"profiles:{id}:tier", "Standard");
            var pw = Get($"{SecretPrefix}profiles:{id}:pw", "");
            list.Add(new AccountProfile(id, user, pw, desc, tier));
        }
        return list;
    }

    public AccountProfile AddProfile(string user, string password, string description, string tier)
    {
        var id = Guid.NewGuid().ToString("N").Substring(0, 8);
        var ids = Get("profiles:ids", Array.Empty<string>()).ToList();
        ids.Add(id);
        Set("profiles:ids", ids.ToArray());
        Set($"profiles:{id}:user", user);
        Set($"profiles:{id}:desc", description);
        Set($"profiles:{id}:tier", tier);
        Set($"{SecretPrefix}profiles:{id}:pw", password);
        return new AccountProfile(id, user, password, description, tier);
    }

    public void RemoveProfile(string id)
    {
        var ids = Get("profiles:ids", Array.Empty<string>()).Where(x => x != id).ToArray();
        Set("profiles:ids", ids);
        _cache.Remove($"profiles:{id}:user");
        _cache.Remove($"profiles:{id}:desc");
        _cache.Remove($"profiles:{id}:tier");
        Save();
        WindowsCredentialManager.Delete($"profiles:{id}:pw");
    }

    // ── Claude Projects — per account (primary/secondary), real user-managed list ───────────────
    public IReadOnlyList<ClaudeProjectInfo> GetClaudeProjects(string accountId)
    {
        var raw = Get($"claude:{accountId}:projects", "");
        if (string.IsNullOrEmpty(raw)) return Array.Empty<ClaudeProjectInfo>();
        try
        {
            return JsonSerializer.Deserialize<List<ClaudeProjectInfo>>(raw) ?? new List<ClaudeProjectInfo>();
        }
        catch { return Array.Empty<ClaudeProjectInfo>(); }
    }

    public void AddClaudeProject(string accountId, string name)
    {
        var list = GetClaudeProjects(accountId).ToList();
        if (list.Any(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))) return;
        list.Add(new ClaudeProjectInfo(name, 0, "just linked"));
        Set($"claude:{accountId}:projects", JsonSerializer.Serialize(list));
    }
}
