using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1034 -- local registry for --notGit pseudo-issue numbers.
    /// Ensures every build that arrives with a --notGit N parameter gets a
    /// UNIQUE negative GithubNumber (stored as -N in the queue).  If the
    /// requested N is already in use the registry allocates the next free
    /// slot starting from BaselineStart (2000).  The used-set is persisted
    /// to %AppData%\BuildConsole\notgit-registry.json so it survives app
    /// restarts and stays coherent with the live build-tracker queue.
    ///
    /// Thread-safety: all mutations hold _lock; reads that don't need a
    /// consistent view of the full set are also locked for simplicity.
    /// </summary>
    public static class NotGitNumberRegistry
    {
        // First number we hand out when a requested slot is already taken.
        public const int BaselineStart = 2000;

        private static readonly string _registryPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BuildConsole", "notgit-registry.json");

        private static readonly object _lock = new();
        private static HashSet<int> _usedNumbers = new();
        private static bool _loaded = false;

        // ---- Public API ----

        /// <summary>
        /// Allocates a notGit number for a build request.
        /// <paramref name="requested"/> is the POSITIVE notGit value from the
        /// --notGit flag (e.g. 2000 for --notGit 2000).
        /// Returns the POSITIVE notGit number to actually use -- either the
        /// requested one (if free) or the next available >= BaselineStart.
        /// The caller negates it before storing as GithubNumber.
        /// </summary>
        public static int Allocate(int requested)
        {
            EnsureLoaded();
            lock (_lock)
            {
                if (!_usedNumbers.Contains(requested))
                {
                    _usedNumbers.Add(requested);
                    Persist();
                    return requested;
                }

                // Find next free slot
                int candidate = Math.Max(BaselineStart, _usedNumbers.Count > 0 ? _usedNumbers.Max() + 1 : BaselineStart);
                while (_usedNumbers.Contains(candidate))
                    candidate++;

                _usedNumbers.Add(candidate);
                Persist();
                ActivityLog.Log("build-queue.notgit",
                    $"--notGit {requested} was already used; remapped to {candidate}");
                return candidate;
            }
        }

        /// <summary>
        /// Marks notGit numbers already present in the live queue as used
        /// without allocating replacements.  Call after each successful queue
        /// fetch so the registry stays coherent with the DB.
        /// </summary>
        public static void SyncFromQueue(IEnumerable<QueueItem> items)
        {
            EnsureLoaded();
            bool changed = false;
            lock (_lock)
            {
                foreach (var item in items)
                {
                    if (item.GithubNumber.HasValue && item.GithubNumber.Value < 0)
                    {
                        if (_usedNumbers.Add(-item.GithubNumber.Value))
                            changed = true;
                    }
                    if (item.BlockedByNumbers != null)
                    {
                        foreach (var n in item.BlockedByNumbers)
                        {
                            if (n < 0 && _usedNumbers.Add(-n))
                                changed = true;
                        }
                    }
                }
                if (changed) Persist();
            }
        }

        /// <summary>Read-only snapshot of registered numbers (positive), for diagnostics.</summary>
        public static IReadOnlyCollection<int> UsedNumbers
        {
            get
            {
                EnsureLoaded();
                lock (_lock) return _usedNumbers.OrderBy(n => n).ToList();
            }
        }

        // ---- Persistence ----

        private static void EnsureLoaded()
        {
            if (_loaded) return;
            lock (_lock)
            {
                if (_loaded) return;
                Load();
                _loaded = true;
            }
        }

        private static void Load()
        {
            try
            {
                if (!File.Exists(_registryPath)) return;
                var json = File.ReadAllText(_registryPath);
                var nums = JsonSerializer.Deserialize<List<int>>(json);
                if (nums != null) _usedNumbers = new HashSet<int>(nums);
                ActivityLog.Log("build-queue.notgit",
                    $"Registry loaded: {_usedNumbers.Count} used notGit number(s)");
            }
            catch (Exception ex)
            {
                ActivityLog.Log("build-queue.notgit",
                    $"Registry load failed ({ex.Message}); starting fresh");
            }
        }

        private static void Persist()
        {
            // Caller holds _lock
            try
            {
                var dir = Path.GetDirectoryName(_registryPath)!;
                Directory.CreateDirectory(dir);
                var json = JsonSerializer.Serialize(_usedNumbers.OrderBy(n => n).ToList());
                File.WriteAllText(_registryPath, json);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("build-queue.notgit",
                    $"Registry persist failed: {ex.Message}");
            }
        }
    }
}
