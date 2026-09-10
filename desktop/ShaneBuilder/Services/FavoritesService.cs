using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace ShaneBuilder.Services;

/// <summary>Git #2392 (Feature #2388 item 4/7) — one saved quick-access link. A real record of a
/// link the user explicitly added, not a fixture row.</summary>
public sealed class FavoriteLink
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public required string Url { get; init; }
    public required DateTime AddedAtUtc { get; init; }
}

/// <summary>
/// Git #2392 (Feature #2388 "Favorites — quick-access links") — the real favorites store, plus
/// the real URL→workspace classification the whole Favorites feature hinges on (items 3-6 of the
/// spec: generic links group into Web, a Dev-URL link groups into Dev, a Stage-URL link groups
/// into Stage, a Production-URL link groups into Production). Persisted the same way
/// <see cref="ChatArchiveStore"/> is — a plain JSON file under ShaneBuilder's own AppData folder,
/// loaded once and rewritten on every change. No database table: this is desktop-local state, not
/// product data.
/// </summary>
public static class FavoritesService
{
    private static readonly string StorePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ShaneBuilder",
        "favorites.json");

    private static readonly List<FavoriteLink> _items = new();
    private static readonly object _gate = new();
    private static bool _loaded;

    private static void EnsureLoaded()
    {
        lock (_gate)
        {
            if (_loaded) return;
            Load();
            _loaded = true;
        }
    }

    public static IReadOnlyList<FavoriteLink> GetAll()
    {
        EnsureLoaded();
        lock (_gate)
        {
            return _items.OrderBy(f => f.AddedAtUtc).ToList();
        }
    }

    public static FavoriteLink Add(string title, string url)
    {
        EnsureLoaded();
        var item = new FavoriteLink
        {
            Id = Guid.NewGuid().ToString("N"),
            Title = title,
            Url = url,
            AddedAtUtc = DateTime.UtcNow
        };
        lock (_gate)
        {
            _items.Add(item);
            Save();
        }
        return item;
    }

    public static void Remove(string id)
    {
        EnsureLoaded();
        lock (_gate)
        {
            _items.RemoveAll(f => f.Id == id);
            Save();
        }
    }

    private static void Load()
    {
        try
        {
            if (!File.Exists(StorePath)) return;
            var json = File.ReadAllText(StorePath);
            var parsed = JsonSerializer.Deserialize<List<FavoriteLink>>(json);
            if (parsed != null) _items.AddRange(parsed);
        }
        catch { /* corrupt/missing file — start with an empty list rather than crash */ }
    }

    private static void Save()
    {
        try
        {
            var dir = Path.GetDirectoryName(StorePath);
            if (dir != null) Directory.CreateDirectory(dir);
            File.WriteAllText(StorePath, JsonSerializer.Serialize(_items, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { /* best-effort persistence — a failed write doesn't lose the in-memory list */ }
    }

    /// <summary>
    /// Git #2392 — real Dev/Stage/Production/Web URL classification. Mirrors the SAME real
    /// environment conventions BuildConsole's own <c>BuildTrackerConfig.GetBaseUrl</c> already
    /// encodes for this app's Dev/Staging/Production tiers (localhost for Dev, the Replit
    /// *.picard.replit.dev deployment for Staging, shanemccaw.com for Production) rather than
    /// inventing a second, unrelated notion of "Dev" — see
    /// desktop/BuildConsole/Services/BuildTrackerConfig.cs:16-37. Anything that doesn't match one
    /// of those falls into the generic "web" bucket (item 3 of the spec).
    /// </summary>
    public static string ClassifyWorkspace(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return "web";

        var trimmed = url.Trim();
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) &&
            !Uri.TryCreate("https://" + trimmed, UriKind.Absolute, out uri))
        {
            return "web";
        }

        var host = uri.Host.ToLowerInvariant();

        // Dev — same rule BuildTrackerConfig's DevBaseUrl encodes: localhost, any port.
        if (host is "localhost" or "127.0.0.1" or "::1" || host.EndsWith(".localhost"))
            return "dev";

        // Stage — the real Replit staging deployment domain BuildTrackerConfig.StagingBaseUrl
        // points at, generalized to any *.replit.dev / *.replit.app host (Replit rotates the
        // specific subdomain per deployment; matching on the family, not one frozen hostname,
        // is what keeps this correct across redeploys).
        if (host.EndsWith(".replit.dev") || host.EndsWith(".replit.app"))
            return "stage";

        // Production — the real production domain BuildTrackerConfig.ProductionBaseUrl points at.
        if (host == "shanemccaw.com" || host.EndsWith(".shanemccaw.com"))
            return "production";

        return "web";
    }
}
