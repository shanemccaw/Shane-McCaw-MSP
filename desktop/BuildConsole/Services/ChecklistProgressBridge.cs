using System;
using System.Collections.Generic;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1251 — bridges an agent's own free-form checklist (the ☐ / - [ ] / - [x] / ✅ markers it
    /// naturally prints in chat) into the Build Watch progress panel, for the very common case where
    /// a session keeps a checklist in text but never calls shaneapp://reportProgress. #1206
    /// strengthened the launch-preamble/CLAUDE.md/AGENT_PROTOCOLS instruction to "report at every
    /// checkpoint" and it STILL didn't stick (this issue), so we stop relying on the agent's
    /// compliance: every checklist marker Build Watch already renders (see BuildWatchWindow's
    /// AddParagraph) is fed here; the resulting done/total for the build is pushed to
    /// <see cref="BuildProgressTracker.BridgeFromChecklist"/>, which advances the same panel #1206
    /// built — without the agent doing anything new. An explicit reportProgress call always wins:
    /// once a build reports for itself, the tracker ignores bridged updates.
    ///
    /// This is a deliberately HEADLESS accumulator (no WPF / ObservableCollection), kept separate
    /// from the UI-side <see cref="Controls.TaskChecklistViewModel"/> — the progress bridge has to
    /// run in the render path and must not entangle the progress fix with that (now
    /// ProgressPanel-superseded) checklist column's lifecycle. Detection and text similarity are the
    /// SAME shared <see cref="ChecklistExtractor"/> — one detector, not a second parser. All access
    /// is on the WPF UI thread (Build Watch's render pump), so no locking is needed.
    ///
    /// HONESTY NOTE — this is a text heuristic over the agent's own wording, inheriting exactly the
    /// misfire modes documented on <see cref="ChecklistExtractor.Similarity"/> (two near-worded tasks
    /// can conflate; a heavily-reworded completion shows as a separate already-done row). It is a
    /// best-effort progress signal, never an authoritative task ledger — and it yields entirely to a
    /// real reportProgress call.
    /// </summary>
    public static class ChecklistProgressBridge
    {
        /// <summary>Flip a "done" report onto a pending item at/above this text similarity. Mirrors
        /// <see cref="Controls.TaskChecklistViewModel"/>'s MatchThreshold so both surfaces agree on
        /// "is this the same task, now done?".</summary>
        private const double MatchThreshold = 0.60;

        /// <summary>Suppress a duplicate PENDING item at/above this near-identity — an agent
        /// re-printing its whole checklist each turn must not stack duplicates. Mirrors
        /// TaskChecklistViewModel's DedupeThreshold.</summary>
        private const double DedupeThreshold = 0.82;

        private sealed class Item { public string Text = ""; public bool Done; }

        // buildId (queue item id) → that build's accumulated checklist items. Kept per build so
        // concurrent agents never blur into one another's counts; cleared when a slot frees.
        private static readonly Dictionary<int, List<Item>> _byBuild = new();

        /// <summary>
        /// Feeds one (possibly multi-line) block of agent prose for a build. Detects any checklist
        /// markers, updates that build's accumulated item set (dedup a re-printed pending line, flip
        /// a pending item to done — exactly like the UI checklist), and, when the set actually
        /// changed, pushes the derived done/total to <see cref="BuildProgressTracker"/> as a
        /// synthesized report. No markers, or no state change, is a cheap no-op. Explicit precedence
        /// is enforced downstream in <see cref="BuildProgressTracker.BridgeFromChecklist"/>.
        /// </summary>
        public static void Observe(int buildId, string text)
        {
            if (buildId <= 0 || string.IsNullOrEmpty(text)) return;

            List<Item>? items = null;
            bool changed = false;
            foreach (var raw in text.Split('\n'))
            {
                var marker = ChecklistExtractor.TryParse(raw, out var itemText);
                if (marker == ChecklistExtractor.Marker.None) continue;
                items ??= Get(buildId);
                changed |= marker == ChecklistExtractor.Marker.Done
                    ? ApplyDone(items, itemText)
                    : ApplyPending(items, itemText);
            }
            if (!changed || items == null) return;

            int done = 0;
            string? firstPending = null;
            foreach (var it in items)
            {
                if (it.Done) done++;
                else firstPending ??= it.Text;
            }
            int total = items.Count;
            string label = done >= total
                ? "All checklist items complete"
                : firstPending ?? $"{done} of {total} checklist items done";

            var report = BuildProgressTracker.BridgeFromChecklist(buildId, done, total, label);
            if (report != null)
                ActivityLog.Log(BuildProgressTracker.LogChannel,
                    $"[checklist-bridge] build #{buildId}: derived {done}/{total} from agent checklist — '{label}'");
        }

        private static List<Item> Get(int buildId)
        {
            if (!_byBuild.TryGetValue(buildId, out var list))
            {
                list = new List<Item>();
                _byBuild[buildId] = list;
            }
            return list;
        }

        /// <summary>A newly-seen pending item adds a row; a re-print of one we already track (pending
        /// OR done) is ignored — completion is sticky, so a stale unchecked reprint never un-ticks a
        /// done item. Returns true only when a genuinely new item was added.</summary>
        private static bool ApplyPending(List<Item> items, string text)
        {
            foreach (var it in items)
                if (ChecklistExtractor.Similarity(it.Text, text) >= DedupeThreshold) return false;
            items.Add(new Item { Text = text, Done = false });
            return true;
        }

        /// <summary>A "done" report flips the best pending match at/above <see cref="MatchThreshold"/>;
        /// failing that, it's treated as an idempotent re-report of an already-done row (no change) or,
        /// when nothing matches, recorded as a fresh already-done row (an agent can report a task
        /// complete we never saw ticked pending). Same decision semantics as the UI checklist's
        /// IngestDone. Returns true when the set changed.</summary>
        private static bool ApplyDone(List<Item> items, string text)
        {
            Item? bestPending = null; double bestPendingScore = MatchThreshold;
            Item? bestDone = null; double bestDoneScore = DedupeThreshold;
            foreach (var it in items)
            {
                double score = ChecklistExtractor.Similarity(it.Text, text);
                if (!it.Done && score >= bestPendingScore) { bestPendingScore = score; bestPending = it; }
                if (it.Done && score >= bestDoneScore) { bestDoneScore = score; bestDone = it; }
            }

            if (bestPending != null) { bestPending.Done = true; return true; }
            if (bestDone != null) return false; // same completed item reported again
            items.Add(new Item { Text = text, Done = true });
            return true;
        }

        /// <summary>Drops a build's accumulated checklist state when its slot is freed/reused, so a
        /// finished build's items never bleed into the next occupant of that slot.</summary>
        public static void ClearForBuild(int buildId) => _byBuild.Remove(buildId);
    }
}
