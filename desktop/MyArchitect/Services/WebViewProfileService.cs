using System;
using System.Collections.Concurrent;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Provisions and caches per-tenant CoreWebView2Environment instances with isolated User Data Folders.
/// </summary>
public sealed class WebViewProfileService : IWebViewProfileService
{
    private readonly ConcurrentDictionary<string, CoreWebView2Environment> _environments = new();
    private readonly string _baseProfilesDirectory;

    public WebViewProfileService()
    {
        _baseProfilesDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MyArchitect",
            "Profiles");

        Directory.CreateDirectory(_baseProfilesDirectory);
    }

    public string GetProfilePathForTenant(Tenant tenant)
    {
        var sanitizedId = string.Concat(tenant.Id.Split(Path.GetInvalidFileNameChars()));
        return Path.Combine(_baseProfilesDirectory, sanitizedId);
    }

    public async Task<CoreWebView2Environment> GetEnvironmentForTenantAsync(Tenant tenant)
    {
        if (_environments.TryGetValue(tenant.Id, out var cachedEnv))
        {
            return cachedEnv;
        }

        var profilePath = GetProfilePathForTenant(tenant);
        Directory.CreateDirectory(profilePath);

        var env = await CoreWebView2Environment.CreateAsync(userDataFolder: profilePath);
        _environments[tenant.Id] = env;
        return env;
    }

    public string GetGlobalProfilePath(string profileName = "Claude")
    {
        var sanitizedName = string.Concat(profileName.Split(Path.GetInvalidFileNameChars()));
        return Path.Combine(_baseProfilesDirectory, "Global", sanitizedName);
    }

    public async Task<CoreWebView2Environment> GetGlobalEnvironmentAsync(string profileName = "Claude")
    {
        var cacheKey = $"_global_{profileName.ToLowerInvariant()}";
        if (_environments.TryGetValue(cacheKey, out var cachedEnv))
        {
            return cachedEnv;
        }

        var profilePath = GetGlobalProfilePath(profileName);
        Directory.CreateDirectory(profilePath);

        var env = await CoreWebView2Environment.CreateAsync(userDataFolder: profilePath);
        _environments[cacheKey] = env;
        return env;
    }
}
