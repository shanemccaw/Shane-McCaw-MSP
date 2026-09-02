using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace ShaneBuilder.Services;

/// <summary>
/// Git #2325 (Feature #2318 item 9) — persists the per-conversation monotonic HIGH-WATER of the
/// real DOM-scraped chat context reading (<see cref="ChatContextMeterScript"/>) to disk, so a chat
/// that's already been read this session (or a previous one) shows its last-known size on the
/// Chats panel row rather than a blank "not yet read" state, and a transient low reading from a
/// mid-render poll can never drag a row's badge back down. Ported 1:1 from
/// <c>desktop/BuildConsole/Services/ChatContextMeterStore.cs</c> (Git #1628), retargeted at
/// ShaneBuilder's own AppData folder.
/// </summary>
public static class ChatContextMeterStore
{
    private static readonly string StorePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ShaneBuilder",
        "context-meter-highwater.json");

    public sealed class Entry
    {
        public double EstCharCount { get; set; }
        public int TurnCount { get; set; }
    }

    private static readonly ConcurrentDictionary<string, Entry> _byConversation = new();
    private static readonly object _fileGate = new();
    private static bool _loaded;

    private static void EnsureLoaded()
    {
        if (_loaded) return;
        Load();
        _loaded = true;
    }

    /// <summary>The persisted high-water for a conversation, or null if none recorded yet.</summary>
    public static Entry? Get(string? conversationId)
    {
        if (string.IsNullOrWhiteSpace(conversationId)) return null;
        EnsureLoaded();
        return _byConversation.TryGetValue(conversationId, out var e) ? e : null;
    }

    /// <summary>Clamps the incoming reading to the stored high-water for this conversation and
    /// records a new maximum when one arrives, per field, independently. Nothing here ever lets a
    /// value decrease — a real transcript only grows.</summary>
    public static Entry Merge(string conversationId, double estCharCount, int turnCount)
    {
        EnsureLoaded();
        var updated = _byConversation.AddOrUpdate(
            conversationId,
            _ => new Entry { EstCharCount = estCharCount, TurnCount = turnCount },
            (_, existing) => new Entry
            {
                EstCharCount = Math.Max(existing.EstCharCount, estCharCount),
                TurnCount = Math.Max(existing.TurnCount, turnCount)
            });
        Save();
        return updated;
    }

    private sealed class StoreData
    {
        public Dictionary<string, Entry> Conversations { get; set; } = new();
    }

    private static void Load()
    {
        try
        {
            if (!File.Exists(StorePath)) return;
            var json = File.ReadAllText(StorePath);
            var data = JsonSerializer.Deserialize<StoreData>(json);
            if (data?.Conversations != null)
            {
                foreach (var kvp in data.Conversations)
                {
                    if (!string.IsNullOrWhiteSpace(kvp.Key) && kvp.Value != null)
                        _byConversation[kvp.Key] = kvp.Value;
                }
            }
        }
        catch { /* corrupt/missing file — start clean rather than crash chat wiring */ }
    }

    private static void Save()
    {
        try
        {
            lock (_fileGate)
            {
                var dir = Path.GetDirectoryName(StorePath);
                if (dir != null) Directory.CreateDirectory(dir);
                var data = new StoreData { Conversations = new Dictionary<string, Entry>(_byConversation) };
                File.WriteAllText(StorePath, JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true }));
            }
        }
        catch { /* best-effort persistence, never crashes the chat that triggered it */ }
    }
}
