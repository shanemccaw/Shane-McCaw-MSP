using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1628 — persists the per-conversation monotonic HIGH-WATER of the claude.ai
    /// chat context meter (`{conversationId -> estTokens, turnCount, heavyTurnCount}`) to
    /// disk, so reopening a chat restores its meter at the level it reached instead of
    /// starting green at zero, and so a transient low reading from a mid-render poll can
    /// never drag the bar down. Same pattern as <see cref="ChatUrlStore"/>: a static store
    /// backed by `%APPDATA%/BuildConsole/context-meter-highwater.json`, loaded in the
    /// static constructor, saved on every write.
    /// </summary>
    public static class ChatContextMeterStore
    {
        private static readonly string StorePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BuildConsole",
            "context-meter-highwater.json");

        public class Entry
        {
            public double EstTokens { get; set; }
            public int TurnCount { get; set; }
            public int HeavyTurnCount { get; set; }
            /// <summary>Git #3724 — word-aware estimate input; 0 on entries persisted before this
            /// field existed (System.Text.Json defaults a missing property, so old
            /// context-meter-highwater.json files deserialize fine).</summary>
            public double WordCount { get; set; }
            /// <summary>Git #3724 — chars belonging to code/JSON-flagged (heavy) turns only, tracked
            /// separately because that content tokenizes denser per character than prose. Same
            /// backward-compat default-to-0 as <see cref="WordCount"/>.</summary>
            public double HeavyCharCount { get; set; }
        }

        private static readonly ConcurrentDictionary<string, Entry> _byConversation = new();
        private static readonly object _fileGate = new();

        static ChatContextMeterStore()
        {
            Load();
        }

        /// <summary>The persisted high-water for a conversation, or null if none recorded yet.</summary>
        public static Entry? Get(string? conversationId)
        {
            if (string.IsNullOrWhiteSpace(conversationId)) return null;
            return _byConversation.TryGetValue(conversationId, out var e) ? e : null;
        }

        /// <summary>
        /// Clamps the incoming reading to the stored high-water for this conversation, records a
        /// new maximum when one arrives (per field, independently — a transcript only grows), and
        /// returns the resulting high-water values. Nothing here ever lets a value decrease.
        /// </summary>
        public static Entry Merge(string conversationId, double estTokens, int turnCount, int heavyTurnCount,
            double wordCount = 0, double heavyCharCount = 0)
        {
            var updated = _byConversation.AddOrUpdate(
                conversationId,
                _ => new Entry
                {
                    EstTokens = estTokens, TurnCount = turnCount, HeavyTurnCount = heavyTurnCount,
                    WordCount = wordCount, HeavyCharCount = heavyCharCount
                },
                (_, existing) => new Entry
                {
                    EstTokens = Math.Max(existing.EstTokens, estTokens),
                    TurnCount = Math.Max(existing.TurnCount, turnCount),
                    HeavyTurnCount = Math.Max(existing.HeavyTurnCount, heavyTurnCount),
                    WordCount = Math.Max(existing.WordCount, wordCount),
                    HeavyCharCount = Math.Max(existing.HeavyCharCount, heavyCharCount)
                });
            Save();
            return updated;
        }

        private class StoreData
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
            catch { }
        }

        private static void Save()
        {
            try
            {
                lock (_fileGate)
                {
                    var dir = Path.GetDirectoryName(StorePath);
                    if (dir != null) Directory.CreateDirectory(dir);
                    var data = new StoreData
                    {
                        Conversations = new Dictionary<string, Entry>(_byConversation)
                    };
                    File.WriteAllText(StorePath, JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true }));
                }
            }
            catch { }
        }
    }
}
