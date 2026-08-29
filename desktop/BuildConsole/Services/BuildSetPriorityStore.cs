using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1636 — persisted set of build-set NAMES Shane has marked "Priority" from the
    /// Build Queue panel's group header context menu, so he can tinker with another build
    /// set (e.g. BuildConsole) while waiting on the one he actually cares about (e.g. Portal)
    /// and still get flagged the moment it finishes. Mirrors <see cref="ChatUrlStore"/>'s
    /// pattern exactly: a static, %APPDATA%/BuildConsole-rooted JSON file, loaded once in the
    /// static constructor, saved on every write — survives an app restart.
    ///
    /// Priority is per build-set NAME, not per individual queue item — marking "Portal"
    /// applies to whatever is currently in that group and anything added to it later, until
    /// either Shane un-marks it or BuildQueuePanel's own completion detection auto-clears it
    /// once every item in the set has reached a terminal state (see
    /// BuildQueuePanel.CheckPriorityBuildSetCompletion) — a finished wait doesn't need to
    /// keep waiting.
    /// </summary>
    public static class BuildSetPriorityStore
    {
        private static readonly string StorePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BuildConsole",
            "priority-build-sets.json");

        // Case-insensitive — build-set names are free text typed into a build-prompt header's
        // --buildSet flag, so "Portal" and "portal" must be treated as the same set.
        private static readonly ConcurrentDictionary<string, byte> _prioritySets =
            new(StringComparer.OrdinalIgnoreCase);
        private static readonly object _fileGate = new();

        static BuildSetPriorityStore()
        {
            Load();
        }

        public static bool IsPriority(string? buildSetName) =>
            !string.IsNullOrWhiteSpace(buildSetName) && _prioritySets.ContainsKey(buildSetName.Trim());

        /// <summary>Every build-set name currently marked Priority — a live snapshot, safe to
        /// enumerate while another thread mutates the underlying set concurrently.</summary>
        public static IReadOnlyList<string> AllPrioritySets => _prioritySets.Keys.ToList();

        public static void SetPriority(string buildSetName, bool isPriority)
        {
            if (string.IsNullOrWhiteSpace(buildSetName)) return;
            buildSetName = buildSetName.Trim();

            bool changed = isPriority
                ? _prioritySets.TryAdd(buildSetName, 0)
                : _prioritySets.TryRemove(buildSetName, out _);

            if (changed) Save();
        }

        private class StoreData
        {
            public List<string> PrioritySets { get; set; } = new();
        }

        private static void Load()
        {
            try
            {
                if (!File.Exists(StorePath)) return;
                var json = File.ReadAllText(StorePath);
                var data = JsonSerializer.Deserialize<StoreData>(json);
                if (data?.PrioritySets != null)
                {
                    foreach (var name in data.PrioritySets)
                        if (!string.IsNullOrWhiteSpace(name)) _prioritySets[name.Trim()] = 0;
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
                    var data = new StoreData { PrioritySets = _prioritySets.Keys.ToList() };
                    File.WriteAllText(StorePath, JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true }));
                }
            }
            catch { }
        }
    }
}
