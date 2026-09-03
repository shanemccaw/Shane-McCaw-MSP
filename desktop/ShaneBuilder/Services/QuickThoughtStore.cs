using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace ShaneBuilder.Services;

/// <summary>Git #2383 (Feature #2382 "I have a thought", item 1) — one captured thought: a real
/// record of a one-liner typed from the topbar quick-capture pill, not a fixture row.</summary>
public sealed class QuickThought
{
    public required string Id { get; init; }
    public required string Text { get; init; }
    public required DateTime CapturedAtUtc { get; init; }
}

/// <summary>
/// Git #2383 — the real store behind the topbar "I have a thought" quick capture. The whole point
/// of item 1 ("saves without breaking flow") is that hitting Enter in the pill's composer must not
/// switch tabs, open a dialog, or touch whatever chat/panel is currently active — it just files the
/// thought and clears the box, same interaction shape as Test Pad's composer
/// (<see cref="TestPadService.AddNote"/>). Persisted the same way <see cref="ChatArchiveStore"/>
/// and <see cref="ChatContextMeterStore"/> are: a plain JSON file under ShaneBuilder's own AppData
/// folder, loaded once and rewritten on every change — desktop-local state, not product data, so a
/// captured thought survives an app restart instead of being an in-memory-only scratch pad. No
/// fixture rows: the list starts empty until Shane actually captures something.
///
/// Later Feature #2382 items (2: copy, 3: send to chat, 4: promote to a Test Pad note or Batter Up
/// item, 5: decide whether this merges into Test Pad) read from and act on this same store — this
/// pass only builds the capture + persistence + the read-only recent list the popup shows as proof
/// a thought actually saved.
/// </summary>
public static class QuickThoughtStore
{
    private static readonly string StorePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ShaneBuilder",
        "quick-thoughts.json");

    private static readonly List<QuickThought> _items = new();
    private static readonly object _gate = new();
    private static bool _loaded;

    public static event Action? ThoughtsChanged;

    private static void EnsureLoaded()
    {
        lock (_gate)
        {
            if (_loaded) return;
            Load();
            _loaded = true;
        }
    }

    public static IReadOnlyList<QuickThought> GetAll()
    {
        EnsureLoaded();
        lock (_gate)
        {
            return _items.OrderByDescending(t => t.CapturedAtUtc).ToList();
        }
    }

    /// <summary>Files a new thought. Never throws back into the caller — a failed save must not
    /// take down whatever the caller was doing when the thought struck.</summary>
    public static QuickThought? Add(string text)
    {
        var trimmed = text?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;

        EnsureLoaded();
        var item = new QuickThought
        {
            Id = Guid.NewGuid().ToString("N"),
            Text = trimmed,
            CapturedAtUtc = DateTime.UtcNow
        };
        try
        {
            lock (_gate)
            {
                _items.Add(item);
                Save();
            }
            ThoughtsChanged?.Invoke();
        }
        catch { /* best-effort — an in-memory add already happened even if the disk write failed */ }
        return item;
    }

    private static void Load()
    {
        try
        {
            if (!File.Exists(StorePath)) return;
            var json = File.ReadAllText(StorePath);
            var parsed = JsonSerializer.Deserialize<List<QuickThought>>(json);
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
        catch { /* best-effort persistence — a failed write doesn't lose the in-memory capture */ }
    }
}
