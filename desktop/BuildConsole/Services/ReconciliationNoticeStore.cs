using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3518 — the kind of real action <see cref="FalseDoneReconciler"/> took on a queue row.
    /// Kept as an explicit, stable enum (not free-text) so the detail view can group/colour by it and
    /// so the persisted JSON survives a wording change to the log strings.
    /// </summary>
    public enum ReconciliationActionKind
    {
        /// <summary>Shape A (#2685/#2775): origin/main bookend said 🛑 BLOCKED → reset to 'canceled' (re-dispatchable) + Backlog.</summary>
        BlockedReset,
        /// <summary>Shape B (#3513): 'done' but the GitHub issue is still OPEN and the work genuinely landed → reverted 'done' → 'verifying'.</summary>
        FalseDoneReverted,
        /// <summary>Shape B (#3513): 'done' but the GitHub issue is still OPEN and NO verified DONE bookend exists → reset 'done' → 'canceled' (re-dispatchable) + Backlog.</summary>
        FalseDoneReset,
        /// <summary>Shape C (#3521): a stale 'canceled' row whose GitHub issue is now CLOSED (resolved on GitHub, often weeks ago) → moved 'canceled' → 'superseded' so it drops out of the active Canceled list instead of lingering as if it were current, actionable canceled work.</summary>
        StaleCanceledResolved,
        /// <summary>Shape D, Rule A (#3607): a terminal 'canceled' row with a real GitHub issue confirmed CLOSED (bt_issue_mirror, live-checked when the mirror is missing/stale) → soft-archived (archived=true), NOT deleted — drops out of the default Canceled board view, row stays queryable.</summary>
        CanceledArchivedClosedIssue,
        /// <summary>Shape D, Rule B (#3607): a terminal 'canceled' row with NO real GitHub issue at all (null or the Git #1645 negative "local #N" sentinel) → soft-archived directly, no GitHub-side check possible.</summary>
        CanceledArchivedNoIssue,
    }

    /// <summary>
    /// Git #3518 — one real, traceable record of a single row the reconciler acted on. Persisted so
    /// Shane can, next time BuildConsole is actually open/focused, see exactly which real issues were
    /// affected and why — not just an aggregate count buried in the raw ActivityLog.
    /// </summary>
    public class ReconciliationNotice
    {
        /// <summary>Stable id for de-duping the persisted set (a row is only acted on once, but a
        /// re-add of an already-recorded row must not create a second line).</summary>
        public string Id { get; set; } = Guid.NewGuid().ToString("N");
        public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;
        public int IssueNumber { get; set; }
        public int QueueRowId { get; set; }
        /// <summary>The status the row held BEFORE the reconciler touched it ('done' / 'verifying').</summary>
        public string PreviousStatus { get; set; } = "";
        public ReconciliationActionKind Kind { get; set; }
        /// <summary>Whether the follow-on board Status → Backlog move confirmed (only meaningful for the two reset kinds).</summary>
        public bool BoardMovedToBacklog { get; set; }
        /// <summary>The full human reason, mirroring the ActivityLog line, so the detail view is self-explanatory.</summary>
        public string Reason { get; set; } = "";
        /// <summary>False until Shane has actually seen it (opened the detail view / dismissed the summary).</summary>
        public bool Seen { get; set; }

        /// <summary>The short board-facing verb for this action, used in the summary counts and detail rows.</summary>
        [JsonIgnore]
        public string ActionLabel => Kind switch
        {
            ReconciliationActionKind.FalseDoneReverted => "reverted to verifying",
            ReconciliationActionKind.FalseDoneReset => "reset for re-dispatch",
            ReconciliationActionKind.BlockedReset => "reset for re-dispatch (BLOCKED)",
            ReconciliationActionKind.StaleCanceledResolved => "cleared (issue closed)",
            ReconciliationActionKind.CanceledArchivedClosedIssue => "archived (issue closed)",
            ReconciliationActionKind.CanceledArchivedNoIssue => "archived (no linked issue)",
            _ => "reconciled",
        };
    }

    /// <summary>
    /// Git #3518 — persists <see cref="FalseDoneReconciler"/>'s real per-row actions to
    /// <c>%APPDATA%/BuildConsole/reconciliation-notices.json</c> so they SURVIVE AN APP RESTART and can
    /// be replayed the next time BuildConsole is actually open — the overnight case the issue was filed
    /// for, where the reconciler cancelled ~30 real dispatched items and Shane was not looking / the app
    /// had since restarted. Same static-store shape as <see cref="ChatContextMeterStore"/>: loaded in the
    /// static ctor, saved on every mutation. A per-notice <c>Seen</c> flag is the "until Shane has
    /// actually seen it" gate — nothing is deleted on view, only marked seen, so the full history stays
    /// clickable-through later; only a bounded tail is retained to keep the file small.
    /// </summary>
    public static class ReconciliationNoticeStore
    {
        private static readonly string StorePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BuildConsole",
            "reconciliation-notices.json");

        // Keep the persisted history bounded — the reconciler is a backstop that fires in occasional
        // bursts, not a firehose, so a generous tail covers "click through to see what happened" without
        // letting the file grow forever. Newest are always retained.
        private const int MaxRetained = 500;

        private static readonly object _gate = new();
        private static readonly List<ReconciliationNotice> _notices = new();

        static ReconciliationNoticeStore()
        {
            Load();
        }

        /// <summary>Records a batch of real reconciler actions and persists them. Ignores any whose Id is
        /// already present (idempotent re-add). Returns the number genuinely added.</summary>
        public static int AddRange(IEnumerable<ReconciliationNotice> notices)
        {
            if (notices == null) return 0;
            int added = 0;
            lock (_gate)
            {
                var existingIds = new HashSet<string>(_notices.Select(n => n.Id), StringComparer.Ordinal);
                foreach (var n in notices)
                {
                    if (n == null || string.IsNullOrEmpty(n.Id) || existingIds.Contains(n.Id)) continue;
                    _notices.Add(n);
                    existingIds.Add(n.Id);
                    added++;
                }
                if (added == 0) return 0;
                TrimLocked();
                Save();
            }
            return added;
        }

        /// <summary>All recorded notices, newest first.</summary>
        public static IReadOnlyList<ReconciliationNotice> GetAll()
        {
            lock (_gate)
                return _notices.OrderByDescending(n => n.TimestampUtc).ToList();
        }

        /// <summary>Only the notices Shane has not yet seen, newest first.</summary>
        public static IReadOnlyList<ReconciliationNotice> GetUnseen()
        {
            lock (_gate)
                return _notices.Where(n => !n.Seen).OrderByDescending(n => n.TimestampUtc).ToList();
        }

        /// <summary>Count of not-yet-seen notices — drives the startup replay + summary toast.</summary>
        public static int UnseenCount
        {
            get { lock (_gate) return _notices.Count(n => !n.Seen); }
        }

        /// <summary>Marks every recorded notice as seen (called when Shane opens the detail view or
        /// dismisses the summary). Persisted immediately so a restart won't re-nag about seen items.</summary>
        public static void MarkAllSeen()
        {
            lock (_gate)
            {
                bool any = false;
                foreach (var n in _notices)
                    if (!n.Seen) { n.Seen = true; any = true; }
                if (any) Save();
            }
        }

        private static void TrimLocked()
        {
            if (_notices.Count <= MaxRetained) return;
            // Drop the oldest, but never silently drop an UNSEEN notice — those are exactly the ones
            // Shane still needs to see. Trim from the oldest SEEN entries first; only if still over cap
            // (implausible in practice) drop oldest overall.
            var seenOldestFirst = _notices.Where(n => n.Seen).OrderBy(n => n.TimestampUtc).ToList();
            int over = _notices.Count - MaxRetained;
            foreach (var n in seenOldestFirst)
            {
                if (over <= 0) break;
                _notices.Remove(n);
                over--;
            }
            if (_notices.Count > MaxRetained)
            {
                _notices.Sort((a, b) => a.TimestampUtc.CompareTo(b.TimestampUtc));
                _notices.RemoveRange(0, _notices.Count - MaxRetained);
            }
        }

        private class StoreData
        {
            public List<ReconciliationNotice> Notices { get; set; } = new();
        }

        private static void Load()
        {
            try
            {
                if (!File.Exists(StorePath)) return;
                var json = File.ReadAllText(StorePath);
                var data = JsonSerializer.Deserialize<StoreData>(json, new JsonSerializerOptions
                {
                    Converters = { new JsonStringEnumConverter() }
                });
                if (data?.Notices != null)
                {
                    lock (_gate)
                    {
                        _notices.Clear();
                        foreach (var n in data.Notices)
                            if (n != null && !string.IsNullOrEmpty(n.Id)) _notices.Add(n);
                    }
                }
            }
            catch { /* a corrupt/older file must never crash startup — start empty */ }
        }

        private static void Save()
        {
            try
            {
                var dir = Path.GetDirectoryName(StorePath);
                if (dir != null) Directory.CreateDirectory(dir);
                var data = new StoreData { Notices = new List<ReconciliationNotice>(_notices) };
                File.WriteAllText(StorePath, JsonSerializer.Serialize(data, new JsonSerializerOptions
                {
                    WriteIndented = true,
                    Converters = { new JsonStringEnumConverter() }
                }));
            }
            catch { /* persistence is best-effort; never take down the reconcile/UI that raised it */ }
        }
    }
}
