using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>Git #3877 — one real toast that was actually shown, recorded for the Notification
    /// Tray's history list (Feature #3876). Not a fixture row: this file starts empty and only
    /// gains entries as <c>ToastEngine</c> (#3878, the sibling wiring issue) actually fires a
    /// real toast.</summary>
    public sealed class NotificationHistoryEntry
    {
        public required Guid Id { get; init; }
        public required string Title { get; init; }
        public required string Message { get; init; }
        /// <summary>Mirrors <see cref="ToastKind"/> — stored as its own string rather than a
        /// direct enum reference so this file has no compile dependency on the Notifications
        /// namespace, matching how the other stores in this folder stay decoupled from their
        /// callers' types.</summary>
        public required string Kind { get; init; }
        public required DateTime CreatedAtUtc { get; init; }
        public bool Bookmarked { get; set; }
    }

    /// <summary>
    /// Git #3877 — persisted history of every real toast BuildConsole has shown, plus bookmark
    /// state, so the Notification Tray (Feature #3876) has real history to display instead of
    /// only whatever's currently floating on screen. Follows the exact same real, existing
    /// convention as <see cref="ChatUrlStore"/> / <see cref="BuildSetPriorityStore"/> /
    /// <see cref="QuickThoughtStore"/>: a static class, a %APPDATA%/BuildConsole-rooted JSON
    /// file, loaded once in the static constructor, saved on every write — survives an app
    /// restart. No new persistence pattern introduced here.
    ///
    /// Bookmarked entries are exempt from both <see cref="ClearAllNonBookmarked"/> and the
    /// rolling cap below — "kept until explicitly un-bookmarked" is the entire point of
    /// bookmarking, per Shane's own ask in the issue body.
    /// </summary>
    public static class NotificationHistoryStore
    {
        /// <summary>Git #3880 — raised after any real mutation (Add/SetBookmarked/
        /// ClearAllNonBookmarked) so a live UI (the ActivityBar bell's bookmarked-state color,
        /// the tray panel itself) can refresh without polling. Fired outside the lock to avoid
        /// re-entrancy if a handler reads back into the store.</summary>
        public static event EventHandler? Changed;
        private static readonly string StorePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BuildConsole",
            "notification-history.json");

        /// <summary>Real, sensible cap on total stored entries so this file can't grow unbounded
        /// across a long-running session. Oldest non-bookmarked entries drop first once the
        /// cap is exceeded; bookmarked entries are never evicted by this.</summary>
        private const int MaxEntries = 500;

        private static readonly List<NotificationHistoryEntry> _items = new();
        private static readonly object _gate = new();

        static NotificationHistoryStore()
        {
            Load();
        }

        /// <summary>Files a new real toast entry. Returns its real <see cref="Guid"/> so the
        /// caller (ToastEngine's own wiring, #3878) can later reference the same entry from a
        /// bookmark button on the still-visible toast.</summary>
        public static Guid Add(string title, string message, string kind)
        {
            var entry = new NotificationHistoryEntry
            {
                Id = Guid.NewGuid(),
                Title = title ?? string.Empty,
                Message = message ?? string.Empty,
                Kind = kind ?? string.Empty,
                CreatedAtUtc = DateTime.UtcNow,
                Bookmarked = false
            };

            lock (_gate)
            {
                _items.Add(entry);
                EnforceCap();
                Save();
            }

            Changed?.Invoke(null, EventArgs.Empty);
            return entry.Id;
        }

        public static void SetBookmarked(Guid id, bool bookmarked)
        {
            bool changed;
            lock (_gate)
            {
                var entry = _items.FirstOrDefault(e => e.Id == id);
                changed = entry != null && entry.Bookmarked != bookmarked;
                if (changed)
                {
                    entry!.Bookmarked = bookmarked;
                    Save();
                }
            }

            if (changed) Changed?.Invoke(null, EventArgs.Empty);
        }

        /// <summary>Removes every entry where <see cref="NotificationHistoryEntry.Bookmarked"/>
        /// is false. Bookmarked entries are untouched.</summary>
        public static void ClearAllNonBookmarked()
        {
            int removed;
            lock (_gate)
            {
                removed = _items.RemoveAll(e => !e.Bookmarked);
                if (removed > 0) Save();
            }

            if (removed > 0) Changed?.Invoke(null, EventArgs.Empty);
        }

        /// <summary>Every stored entry, newest first — a live snapshot, safe to enumerate while
        /// another thread mutates the underlying list concurrently.</summary>
        public static IReadOnlyList<NotificationHistoryEntry> All
        {
            get
            {
                lock (_gate)
                {
                    return _items.OrderByDescending(e => e.CreatedAtUtc).ToList();
                }
            }
        }

        /// <summary>Only the bookmarked entries, newest first.</summary>
        public static IReadOnlyList<NotificationHistoryEntry> Bookmarked
        {
            get
            {
                lock (_gate)
                {
                    return _items.Where(e => e.Bookmarked).OrderByDescending(e => e.CreatedAtUtc).ToList();
                }
            }
        }

        /// <summary>Must be called while already holding <see cref="_gate"/>. Drops the oldest
        /// non-bookmarked entries once the total exceeds <see cref="MaxEntries"/>.</summary>
        private static void EnforceCap()
        {
            if (_items.Count <= MaxEntries) return;

            var overflow = _items.Count - MaxEntries;
            var toDrop = _items
                .Where(e => !e.Bookmarked)
                .OrderBy(e => e.CreatedAtUtc)
                .Take(overflow)
                .ToList();

            foreach (var entry in toDrop)
                _items.Remove(entry);
        }

        private static void Load()
        {
            try
            {
                if (!File.Exists(StorePath)) return;
                var json = File.ReadAllText(StorePath);
                var parsed = JsonSerializer.Deserialize<List<NotificationHistoryEntry>>(json);
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
            catch { /* best-effort persistence — a failed write doesn't lose the in-memory state */ }
        }
    }
}
