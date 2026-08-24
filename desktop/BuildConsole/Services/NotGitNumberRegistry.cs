using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// One entry in the local-build-id registry: a single --notGit identifier that has
    /// ever existed, past or present.
    /// </summary>
    public sealed class LocalBuildIdEntry
    {
        /// <summary>1-based ordinal. Stored in the queue as github_number = -Ordinal.</summary>
        public int Ordinal { get; set; }
        /// <summary>The letter form shown to / typed by humans (A, B … Z, AA …).</summary>
        public string Letters { get; set; } = "";
        /// <summary>When this ordinal was first recorded (UTC, ISO-8601).</summary>
        public string FirstSeenUtc { get; set; } = "";
        /// <summary>Free-text provenance ("allocated", "synced from queue", "referenced", "migrated"…).</summary>
        public string? Note { get; set; }
    }

    /// <summary>
    /// Persistent registry of every LOCAL (--notGit) build identifier ever used.
    ///
    /// ── What changed (letter sequence) ───────────────────────────────────────────
    /// Local builds used to carry a plain positive number the user typed after
    /// <c>--notGit N</c> (deduped to ≥2000 on collision). That number space overlapped
    /// GitHub's — a bare "#109" could be either. Local ids are now a distinct LETTER
    /// sequence (A, B, C … AA, AB …) via <see cref="LocalBuildId"/>, so a local id can
    /// never be mistaken for a GitHub issue number. The user no longer picks the letter:
    /// a new --notGit build is handed the next genuinely-unused letter automatically
    /// (<see cref="AllocateNext"/>) — no manual guessing, no collisions.
    ///
    /// ── Storage is unchanged ─────────────────────────────────────────────────────
    /// A letter is just the bijective base-26 render of an ordinal, and the ordinal is
    /// |github_number| for the negative-numbered local row. So nothing in the DB, the
    /// watcher, blocker-clearing or dedupe changes: this registry only owns allocation
    /// (which ordinal is free), resolution (letter → ordinal for --block-by), and the
    /// authoritative list of every id ever handed out.
    ///
    /// ── Persistence + migration ──────────────────────────────────────────────────
    /// Persisted to %AppData%\BuildConsole\notgit-registry.json. The OLD file was a bare
    /// JSON array of the used positive numbers (which are exactly ordinals); on first
    /// load we migrate it to the richer entry list, giving each old number its letter
    /// form. Live rows already in the queue are folded in by <see cref="SyncFromQueue"/>
    /// (no DB writes — an existing local row simply re-labels to its letters).
    ///
    /// Thread-safety: all state is guarded by <c>_lock</c>.
    /// </summary>
    public static class NotGitNumberRegistry
    {
        private const int FormatVersion = 2;

        private static readonly string _registryPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BuildConsole", "notgit-registry.json");

        private static readonly object _lock = new();
        // ordinal -> entry. The key set IS the used-ordinal set.
        private static readonly Dictionary<int, LocalBuildIdEntry> _entries = new();
        private static bool _loaded;

        // ── Allocation ──────────────────────────────────────────────────────────────

        /// <summary>
        /// Allocates the next genuinely-unused local identifier and records it. Picks the
        /// LOWEST free ordinal ≥ 1 so fresh builds get clean, short letters (A, B, C…),
        /// reusing gaps left by nothing that is still tracked. The caller stores
        /// github_number = -<see cref="LocalBuildIdEntry.Ordinal"/>.
        /// </summary>
        public static LocalBuildIdEntry AllocateNext(string? note = null)
        {
            EnsureLoaded();
            lock (_lock)
            {
                int ordinal = 1;
                while (_entries.ContainsKey(ordinal)) ordinal++;

                var entry = Record(ordinal, note ?? "allocated");
                Persist();
                ActivityLog.Log("build-queue.notgit",
                    $"Allocated local build id {entry.Letters} (ordinal {ordinal}, github_number {-ordinal}). " +
                    $"{_entries.Count} local id(s) now tracked.");
                return entry;
            }
        }

        // ── Resolution (for --block-by references) ──────────────────────────────────

        /// <summary>
        /// Resolves a LOCAL reference token (from <c>--block-by</c>) to its ordinal so a
        /// later build can declare it as a blocker. Accepts letters ("A", "AB") and — for
        /// backward compatibility with builds queued before the letter switch — a bare
        /// number, which is treated as the ordinal itself. Records the ordinal (so a
        /// forward reference still shows up in the registry / view) and logs the
        /// resolution. Returns false for a token that is neither letters nor digits.
        /// </summary>
        public static bool TryResolveLocalRef(string? token, out int ordinal)
        {
            ordinal = 0;
            if (string.IsNullOrWhiteSpace(token)) return false;
            var t = token.Trim();

            bool known;
            if (LocalBuildId.TryFromLetters(t, out ordinal))
            {
                // canonical letter reference
            }
            else if (int.TryParse(t, out var legacy) && legacy > 0)
            {
                ordinal = legacy; // legacy numeric --block-by reference
            }
            else
            {
                return false;
            }

            EnsureLoaded();
            lock (_lock)
            {
                known = _entries.ContainsKey(ordinal);
                if (!known)
                {
                    Record(ordinal, "referenced (not yet allocated)");
                    Persist();
                }
            }

            var letters = LocalBuildId.ToLetters(ordinal);
            ActivityLog.Log("build-queue.notgit",
                $"Resolved --block-by '{t}' -> local #{letters} (ordinal {ordinal}, github_number {-ordinal})" +
                (known ? "." : " — NOTE: that local id has not been allocated yet (forward reference)."));
            return true;
        }

        // ── Coherence with the live queue ───────────────────────────────────────────

        /// <summary>
        /// Folds every local id already present in the live queue into the registry —
        /// both a row's own negative github_number and any negative blocker references.
        /// This is the migration path for local ids that only exist in the DB: it never
        /// writes to the DB, it just makes sure the registry (and therefore allocation,
        /// which skips used ordinals) stays coherent with reality. Call after each queue
        /// fetch.
        /// </summary>
        public static void SyncFromQueue(IEnumerable<QueueItem> items)
        {
            EnsureLoaded();
            bool changed = false;
            lock (_lock)
            {
                foreach (var item in items)
                {
                    if (item.GithubNumber is < 0 && RecordIfNew(-item.GithubNumber.Value, "synced from queue"))
                        changed = true;

                    if (item.BlockedByNumbers != null)
                    {
                        foreach (var n in item.BlockedByNumbers)
                            if (n < 0 && RecordIfNew(-n, "synced from queue (blocker)"))
                                changed = true;
                    }
                    if (item.BlockedByNumber is < 0 && RecordIfNew(-item.BlockedByNumber.Value, "synced from queue (blocker)"))
                        changed = true;
                }
                if (changed) Persist();
            }
        }

        // ── Queryable snapshot (for the registry view / diagnostics) ────────────────

        /// <summary>
        /// A read-only, ordinal-ordered snapshot of every local id ever tracked. Backs the
        /// "Local Build IDs" view and any diagnostic query.
        /// </summary>
        public static IReadOnlyList<LocalBuildIdEntry> Snapshot()
        {
            EnsureLoaded();
            lock (_lock)
            {
                return _entries.Values
                    .OrderBy(e => e.Ordinal)
                    .Select(e => new LocalBuildIdEntry
                    {
                        Ordinal = e.Ordinal,
                        Letters = e.Letters,
                        FirstSeenUtc = e.FirstSeenUtc,
                        Note = e.Note
                    })
                    .ToList();
            }
        }

        /// <summary>Human-readable one-line summary of the registry (for logs / toasts).</summary>
        public static string Describe()
        {
            EnsureLoaded();
            lock (_lock)
            {
                if (_entries.Count == 0) return "No local (--notGit) build ids allocated yet.";
                var letters = _entries.Values.OrderBy(e => e.Ordinal).Select(e => e.Letters);
                return $"{_entries.Count} local build id(s): {string.Join(", ", letters)}";
            }
        }

        // ── Internals ───────────────────────────────────────────────────────────────

        /// <summary>
        /// Ensures an ordinal is recorded (caller holds _lock). Returns the entry —
        /// existing if already known (backfilling an empty note), otherwise a new one.
        /// </summary>
        private static LocalBuildIdEntry Record(int ordinal, string note)
        {
            if (_entries.TryGetValue(ordinal, out var existing))
            {
                if (string.IsNullOrEmpty(existing.Note)) existing.Note = note;
                return existing;
            }
            var entry = new LocalBuildIdEntry
            {
                Ordinal = ordinal,
                Letters = LocalBuildId.ToLetters(ordinal),
                FirstSeenUtc = DateTimeOffset.UtcNow.ToString("o"),
                Note = note
            };
            _entries[ordinal] = entry;
            return entry;
        }

        /// <summary>Records an ordinal if not already present (caller holds _lock). Returns true if newly added.</summary>
        private static bool RecordIfNew(int ordinal, string note)
        {
            if (_entries.ContainsKey(ordinal)) return false;
            Record(ordinal, note);
            return true;
        }

        // ── Persistence ─────────────────────────────────────────────────────────────

        private sealed class RegistryFile
        {
            public int Version { get; set; } = FormatVersion;
            public List<LocalBuildIdEntry> Entries { get; set; } = new();
        }

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
                if (!File.Exists(_registryPath))
                {
                    ActivityLog.Log("build-queue.notgit", "Local build id registry: none yet (starting empty).");
                    return;
                }

                var json = File.ReadAllText(_registryPath);
                using var doc = JsonDocument.Parse(json);

                if (doc.RootElement.ValueKind == JsonValueKind.Array)
                {
                    // ── OLD FORMAT: bare array of used positive numbers (== ordinals) ──
                    int migrated = 0;
                    foreach (var el in doc.RootElement.EnumerateArray())
                    {
                        if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var n) && n > 0)
                        {
                            if (!_entries.ContainsKey(n))
                            {
                                _entries[n] = new LocalBuildIdEntry
                                {
                                    Ordinal = n,
                                    Letters = LocalBuildId.ToLetters(n),
                                    FirstSeenUtc = DateTimeOffset.UtcNow.ToString("o"),
                                    Note = "migrated from numeric registry"
                                };
                                migrated++;
                            }
                        }
                    }
                    Persist(); // rewrite in the new format immediately
                    ActivityLog.Log("build-queue.notgit",
                        $"Migrated numeric local-id registry -> letter scheme: {migrated} id(s) " +
                        $"({string.Join(", ", _entries.Values.OrderBy(e => e.Ordinal).Select(e => e.Letters))}).");
                    return;
                }

                // ── NEW FORMAT: { version, entries: [...] } ──
                var file = JsonSerializer.Deserialize<RegistryFile>(json);
                if (file?.Entries != null)
                {
                    foreach (var e in file.Entries)
                    {
                        if (e.Ordinal <= 0) continue;
                        // Trust the ordinal; re-derive letters so a hand-edited file can't drift.
                        e.Letters = LocalBuildId.ToLetters(e.Ordinal);
                        _entries[e.Ordinal] = e;
                    }
                }
                ActivityLog.Log("build-queue.notgit",
                    $"Local build id registry loaded: {_entries.Count} id(s) tracked.");
            }
            catch (Exception ex)
            {
                ActivityLog.Log("build-queue.notgit",
                    $"Local build id registry load failed ({ex.Message}); starting empty.");
            }
        }

        private static void Persist()
        {
            // Caller holds _lock.
            try
            {
                var dir = Path.GetDirectoryName(_registryPath)!;
                Directory.CreateDirectory(dir);
                var file = new RegistryFile
                {
                    Version = FormatVersion,
                    Entries = _entries.Values.OrderBy(e => e.Ordinal).ToList()
                };
                var json = JsonSerializer.Serialize(file, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(_registryPath, json);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("build-queue.notgit", $"Local build id registry persist failed: {ex.Message}");
            }
        }
    }
}
