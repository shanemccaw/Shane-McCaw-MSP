using System;
using System.IO;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// "Build Only This Set" — a build-set group header context-menu action that puts the
    /// queue dispatcher into an exclusive mode: while a set is marked exclusive here,
    /// <c>BuildQueuePostgresClient.SelectClaimCandidatesAsync</c> holds every queued row that
    /// doesn't belong to that build set, so the ONLY thing the watcher's next tick can claim
    /// is a member of the exclusive set. Unlike <see cref="BuildSetPriorityStore"/> (Git
    /// #1636, notification-only, no dispatch effect, and supports many marked sets at once),
    /// this is a real dispatch gate and — because "the only set the queue pulls from" is
    /// inherently a single top-of-queue concept — only ONE build set can be exclusive at a
    /// time; marking a new one silently replaces whatever was previously exclusive.
    ///
    /// Mirrors BuildSetPriorityStore's persistence shape exactly: a static, %APPDATA%/
    /// BuildConsole-rooted JSON file, loaded once in the static constructor, saved on every
    /// write — survives an app restart, so an exclusive hold Shane set before closing
    /// BuildConsole is still honored when it comes back up.
    ///
    /// Auto-clears the same way Priority does (see
    /// BuildQueuePanel.CheckExclusiveBuildSetCompletion): the moment every item currently
    /// belonging to the exclusive set reaches a terminal state, the hold lifts on its own —
    /// a finished wait doesn't need to keep blocking everything else.
    /// </summary>
    public static class BuildSetExclusiveStore
    {
        private static readonly string StorePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BuildConsole",
            "exclusive-build-set.json");

        private static readonly object _gate = new();
        private static readonly object _fileGate = new();
        private static string? _exclusiveSet;

        static BuildSetExclusiveStore()
        {
            Load();
        }

        /// <summary>The one build-set name currently exclusive, or null when no exclusive
        /// hold is active. Case is preserved as last set; comparisons elsewhere are
        /// case-insensitive (build-set names are free text typed into a --buildSet flag).</summary>
        public static string? ActiveSet
        {
            get { lock (_gate) return _exclusiveSet; }
        }

        public static bool IsExclusive(string? buildSetName)
        {
            if (string.IsNullOrWhiteSpace(buildSetName)) return false;
            lock (_gate)
                return _exclusiveSet != null && string.Equals(_exclusiveSet, buildSetName.Trim(), StringComparison.OrdinalIgnoreCase);
        }

        public static bool IsAnyActive
        {
            get { lock (_gate) return _exclusiveSet != null; }
        }

        /// <summary>Marks <paramref name="buildSetName"/> as the (single) exclusive set,
        /// replacing whatever was previously exclusive.</summary>
        public static void SetExclusive(string buildSetName)
        {
            if (string.IsNullOrWhiteSpace(buildSetName)) return;
            lock (_gate) _exclusiveSet = buildSetName.Trim();
            Save();
        }

        /// <summary>Clears exclusive mode entirely, whichever set currently holds it.</summary>
        public static void Clear()
        {
            lock (_gate) _exclusiveSet = null;
            Save();
        }

        private class StoreData
        {
            public string? ExclusiveSet { get; set; }
        }

        private static void Load()
        {
            try
            {
                if (!File.Exists(StorePath)) return;
                var json = File.ReadAllText(StorePath);
                var data = JsonSerializer.Deserialize<StoreData>(json);
                if (!string.IsNullOrWhiteSpace(data?.ExclusiveSet))
                    _exclusiveSet = data!.ExclusiveSet!.Trim();
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
                    var data = new StoreData { ExclusiveSet = _exclusiveSet };
                    File.WriteAllText(StorePath, JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true }));
                }
            }
            catch { }
        }
    }
}
