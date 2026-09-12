using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3866 — persisted set of Epic numbers Shane has "locked" from the Build Queue
    /// rollup's Epic group header (🔒/🔓 toggle), so every build set currently under that
    /// Epic — and any that show up under it later — gets carried into
    /// <see cref="BuildSetPriorityStore"/> as Priority automatically, without re-clicking
    /// each one by hand. Mirrors <see cref="BuildSetPriorityStore"/>'s exact persistence
    /// pattern: a static, %APPDATA%/BuildConsole-rooted JSON file, loaded once in the
    /// static constructor, saved on every write — survives an app restart.
    ///
    /// Locking an Epic does not invent a second "priority" flag — it drives the existing
    /// <see cref="BuildSetPriorityStore.SetPriority"/> mechanism. What this store adds is
    /// remembering, per locked Epic, exactly which build-set names THIS lock caused to
    /// become Priority (as opposed to ones Shane had already marked Priority by hand,
    /// independent of any lock) — so unlocking can cleanly revert only what the lock
    /// itself caused, leaving anything marked manually untouched.
    /// </summary>
    public static class EpicPriorityStore
    {
        private static readonly string StorePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BuildConsole",
            "priority-locked-epics.json");

        // epicNumber -> the real build-set names THIS lock auto-marked Priority.
        private static readonly ConcurrentDictionary<int, HashSet<string>> _lockedEpics = new();
        private static readonly object _fileGate = new();

        static EpicPriorityStore()
        {
            Load();
        }

        public static bool IsLocked(int epicNumber) => _lockedEpics.ContainsKey(epicNumber);

        /// <summary>Locks <paramref name="epicNumber"/> and marks every name in
        /// <paramref name="buildSetNames"/> Priority via <see cref="BuildSetPriorityStore"/> —
        /// except a name that's already Priority (e.g. Shane marked it by hand independently),
        /// which is left alone and NOT recorded as auto-marked, so an eventual unlock never
        /// undoes a manual mark it didn't cause.</summary>
        public static void Lock(int epicNumber, IEnumerable<string> buildSetNames)
        {
            var autoMarked = _lockedEpics.GetOrAdd(epicNumber, _ => new HashSet<string>(StringComparer.OrdinalIgnoreCase));
            bool changed = false;
            lock (autoMarked)
            {
                foreach (var name in buildSetNames)
                {
                    if (string.IsNullOrWhiteSpace(name)) continue;
                    var trimmed = name.Trim();
                    if (BuildSetPriorityStore.IsPriority(trimmed)) continue;
                    BuildSetPriorityStore.SetPriority(trimmed, true);
                    autoMarked.Add(trimmed);
                    changed = true;
                }
            }
            // Locking with zero real build-set names still records the lock itself, so a
            // build set that shows up under this Epic moments later (before the next
            // ApplyLockedEpics pass) is still caught.
            Save();
            _ = changed; // kept for readability at call sites; Save() always runs — the lock state itself changed.
        }

        /// <summary>Unlocks <paramref name="epicNumber"/> and reverts (SetPriority false) only
        /// the build-set names THIS lock auto-marked — never a name Shane marked Priority by
        /// hand, matching <see cref="BuildSetPriorityStore"/>'s own "only Shane or auto-completion
        /// clears it" convention.</summary>
        public static void Unlock(int epicNumber)
        {
            if (!_lockedEpics.TryRemove(epicNumber, out var autoMarked)) return;
            List<string> toRevert;
            lock (autoMarked) toRevert = autoMarked.ToList();
            foreach (var name in toRevert)
                BuildSetPriorityStore.SetPriority(name, false);
            Save();
        }

        /// <summary>Git #3866 — called on the same real render/refresh cycle that recomputes
        /// build-set → Epic resolution (no new timer): for every currently-locked Epic, catches
        /// up any build-set name that now resolves to it and isn't already tracked as
        /// auto-marked by this lock, marking it Priority and recording it. A name that's already
        /// Priority for another reason (manually marked) is left alone and not recorded, same
        /// rule as <see cref="Lock"/>.</summary>
        public static void ApplyLockedEpics(IReadOnlyDictionary<string, List<EpicResolver.ResolvedEpic>> buildSetEpics)
        {
            if (_lockedEpics.IsEmpty) return;

            bool anyChanged = false;
            foreach (var kv in _lockedEpics)
            {
                int epicNumber = kv.Key;
                var autoMarked = kv.Value;
                var namesForEpic = buildSetEpics
                    .Where(be => be.Value.Any(e => e.Number == epicNumber))
                    .Select(be => be.Key);

                lock (autoMarked)
                {
                    foreach (var name in namesForEpic)
                    {
                        if (string.IsNullOrWhiteSpace(name)) continue;
                        var trimmed = name.Trim();
                        if (autoMarked.Contains(trimmed)) continue;
                        if (BuildSetPriorityStore.IsPriority(trimmed)) continue; // manual — not ours to track
                        BuildSetPriorityStore.SetPriority(trimmed, true);
                        autoMarked.Add(trimmed);
                        anyChanged = true;
                    }
                }
            }
            if (anyChanged) Save();
        }

        private class StoreEntry
        {
            public int EpicNumber { get; set; }
            public List<string> AutoMarkedBuildSets { get; set; } = new();
        }

        private class StoreData
        {
            public List<StoreEntry> LockedEpics { get; set; } = new();
        }

        private static void Load()
        {
            try
            {
                if (!File.Exists(StorePath)) return;
                var json = File.ReadAllText(StorePath);
                var data = JsonSerializer.Deserialize<StoreData>(json);
                if (data?.LockedEpics == null) return;
                foreach (var entry in data.LockedEpics)
                {
                    var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var name in entry.AutoMarkedBuildSets)
                        if (!string.IsNullOrWhiteSpace(name)) names.Add(name.Trim());
                    _lockedEpics[entry.EpicNumber] = names;
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
                        LockedEpics = _lockedEpics.Select(kv =>
                        {
                            List<string> names;
                            lock (kv.Value) names = kv.Value.ToList();
                            return new StoreEntry { EpicNumber = kv.Key, AutoMarkedBuildSets = names };
                        }).ToList()
                    };
                    File.WriteAllText(StorePath, JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true }));
                }
            }
            catch { }
        }
    }
}
