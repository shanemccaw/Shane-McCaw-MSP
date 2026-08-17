using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace BuildConsole.Services
{
    public static class ChatUrlStore
    {
        private static readonly string StorePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BuildConsole",
            "queue-chat-urls.json");

        private static readonly ConcurrentDictionary<int, string> _queueItemChatUrls = new();
        private static readonly ConcurrentDictionary<int, string> _issueChatUrls = new();
        private static readonly object _fileGate = new();

        static ChatUrlStore()
        {
            Load();
        }

        public static void SetChatUrl(int? queueId, int? githubNumber, string? url)
        {
            if (string.IsNullOrWhiteSpace(url)) return;
            url = url.Trim();
            if (queueId.HasValue && queueId.Value > 0)
            {
                _queueItemChatUrls[queueId.Value] = url;
            }
            if (githubNumber.HasValue)
            {
                _issueChatUrls[githubNumber.Value] = url;
            }
            Save();
        }

        public static string? GetChatUrl(int? queueId, int? githubNumber)
        {
            if (queueId.HasValue && _queueItemChatUrls.TryGetValue(queueId.Value, out var url) && !string.IsNullOrWhiteSpace(url))
            {
                return url;
            }
            if (githubNumber.HasValue && _issueChatUrls.TryGetValue(githubNumber.Value, out var issueUrl) && !string.IsNullOrWhiteSpace(issueUrl))
            {
                return issueUrl;
            }
            return null;
        }

        private class StoreData
        {
            public Dictionary<int, string> QueueItemChatUrls { get; set; } = new();
            public Dictionary<int, string> IssueChatUrls { get; set; } = new();
        }

        private static void Load()
        {
            try
            {
                if (!File.Exists(StorePath)) return;
                var json = File.ReadAllText(StorePath);
                var data = JsonSerializer.Deserialize<StoreData>(json);
                if (data != null)
                {
                    if (data.QueueItemChatUrls != null)
                    {
                        foreach (var kvp in data.QueueItemChatUrls) _queueItemChatUrls[kvp.Key] = kvp.Value;
                    }
                    if (data.IssueChatUrls != null)
                    {
                        foreach (var kvp in data.IssueChatUrls) _issueChatUrls[kvp.Key] = kvp.Value;
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
                        QueueItemChatUrls = new Dictionary<int, string>(_queueItemChatUrls),
                        IssueChatUrls = new Dictionary<int, string>(_issueChatUrls)
                    };
                    File.WriteAllText(StorePath, JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true }));
                }
            }
            catch { }
        }
    }
}
