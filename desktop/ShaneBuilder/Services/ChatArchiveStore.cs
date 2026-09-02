using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace ShaneBuilder.Services;

/// <summary>Git #2325 (Feature #2318 item 9) — one archived chat: a real record of a chat the user
/// explicitly archived, not a fixture row. <see cref="ConversationUrl"/> is what "Reopen" navigates
/// the shared ClaudeWebView back to.</summary>
public sealed class ArchivedChat
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public int? EpicNumber { get; init; }
    public required string ConversationUrl { get; init; }
    public required DateTime ArchivedAtUtc { get; init; }
    public double? LastEstCharCount { get; init; }
    public int? LastTurnCount { get; init; }
}

/// <summary>
/// Git #2325 (Feature #2318 item 9) — the real chat archive. ShaneBuilder has exactly one live
/// chat tab today (no multi-tab creation exists yet — items #2321-#2324 build that); "archive"
/// here means: record this chat's identity and last-known size, then reset to a fresh chat, so
/// nothing is silently lost and the conversation can be found and reopened later. Persisted the
/// same way <see cref="ChatContextMeterStore"/> is — a plain JSON file under ShaneBuilder's own
/// AppData folder, loaded once and rewritten on every change. No database table: this is
/// session/desktop-local state, not product data.
/// </summary>
public static class ChatArchiveStore
{
    private static readonly string StorePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ShaneBuilder",
        "chat-archive.json");

    private static readonly List<ArchivedChat> _items = new();
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

    public static IReadOnlyList<ArchivedChat> GetAll()
    {
        EnsureLoaded();
        lock (_gate)
        {
            return _items.OrderByDescending(a => a.ArchivedAtUtc).ToList();
        }
    }

    public static ArchivedChat Add(string title, int? epicNumber, string conversationUrl, double? lastEstCharCount, int? lastTurnCount)
    {
        EnsureLoaded();
        var item = new ArchivedChat
        {
            Id = Guid.NewGuid().ToString("N"),
            Title = title,
            EpicNumber = epicNumber,
            ConversationUrl = conversationUrl,
            ArchivedAtUtc = DateTime.UtcNow,
            LastEstCharCount = lastEstCharCount,
            LastTurnCount = lastTurnCount
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
            _items.RemoveAll(a => a.Id == id);
            Save();
        }
    }

    private static void Load()
    {
        try
        {
            if (!File.Exists(StorePath)) return;
            var json = File.ReadAllText(StorePath);
            var parsed = JsonSerializer.Deserialize<List<ArchivedChat>>(json);
            if (parsed != null) _items.AddRange(parsed);
        }
        catch { /* corrupt/missing file — start with an empty archive rather than crash */ }
    }

    private static void Save()
    {
        try
        {
            var dir = Path.GetDirectoryName(StorePath);
            if (dir != null) Directory.CreateDirectory(dir);
            File.WriteAllText(StorePath, JsonSerializer.Serialize(_items, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { /* best-effort persistence — a failed write doesn't lose the in-memory archive */ }
    }
}
