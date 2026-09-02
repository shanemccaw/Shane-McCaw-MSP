namespace ShaneBuilder.Services;

/// <summary>Git #2204 (readme-phase2.md Step 15) — the real contract, verbatim from the readme:
/// one variable a test manifest can interpolate via <c>{{NAME}}</c>, real usage extracted by
/// <see cref="ISettingsStore.ScanManifests"/> from the actual files on disk (never invented).</summary>
public sealed record EnvVar(string Name, string Domain, string Value, string[] UsedInManifests);

public enum SettingType { Toggle, Text, Number, Select }

/// <summary>One row in a "simple" settings category (General, Sound &amp; Audio, Replit Watcher, …).
/// <c>Value</c> is whatever <see cref="ISettingsStore.Get{T}"/> currently returns for <c>Id</c>,
/// boxed; <c>Options</c> is only populated for <see cref="SettingType.Select"/>.</summary>
public sealed record SettingRow(string Id, string Label, SettingType Type, object Value, string[] Options);

/// <summary>A gated test-login profile — the single source of truth the autofill lock (#2202)
/// reads from. Password lives in Windows Credential Manager via <see cref="SettingsStoreService"/>;
/// <c>Password</c> here is already resolved plaintext for display (reveal/copy), same as every
/// other secret this store hands back to its own Settings UI.</summary>
public sealed record AccountProfile(string Id, string User, string Password, string Description, string Tier);

/// <summary>One Claude Projects entry under a given account (Primary/Secondary), from the real
/// per-account project list <see cref="SettingsStoreService"/> persists as its own setting key.</summary>
public sealed record ClaudeProjectInfo(string Name, int ChatCount, string LastUsedLabel);

public sealed record ClaudeAccountInfo(string Id, string Label, string Email, string Plan);

/// <summary>Git #2204's own contract, verbatim:
/// <code>
/// interface ISettingsStore {                 // per-machine, credentials in Windows Credential Manager
///   T Get&lt;T&gt;(string key, T fallback); void Set&lt;T&gt;(string key, T value);
///   IReadOnlyList&lt;EnvVar&gt; ScanManifests();   // powers "used in N manifests" + Re-scan
/// }
/// </code></summary>
public interface ISettingsStore
{
    T Get<T>(string key, T fallback);
    void Set<T>(string key, T value);
    IReadOnlyList<EnvVar> ScanManifests();
}
