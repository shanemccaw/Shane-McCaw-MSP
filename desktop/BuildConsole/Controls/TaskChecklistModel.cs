using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// One row in the Build Watch Task Checklist side panel — a single task the agent reported
    /// via a checklist marker (see <see cref="ChecklistExtractor"/>). Shown pending (☐) until the
    /// agent later reports the same item complete, then flipped to <see cref="Done"/> (a real green
    /// ✓ in the view). Reuses this app's hand-rolled <see cref="ObservableObject"/> so the flip to
    /// done updates live in place rather than re-creating the row.
    /// </summary>
    public sealed class ChecklistItemViewModel : ObservableObject
    {
        /// <summary>Which live build (queue item) reported this task — items are attributed per build so 8 concurrent agents don't blur into one list, and matching is scoped to a single build.</summary>
        public int QueueItemId { get; }

        /// <summary>The GitHub issue number this build is tied to (null for a local / unattributed build). Recorded so Focus Mode can surface only on-milestone builds' checklists — via <see cref="Services.FocusModeService.IsIssueInActiveMilestone"/> — without re-parsing <see cref="BuildLabel"/>.</summary>
        public int? GithubNumber { get; }

        /// <summary>Short human label for the source build, e.g. "GH #984" or "queue #12".</summary>
        public string BuildLabel { get; }

        public string Text { get; }

        /// <summary>Precomputed normalized form used for similarity matching (never shown).</summary>
        public string Normalized { get; }

        private bool _done;
        public bool Done
        {
            get => _done;
            set
            {
                if (SetProperty(ref _done, value))
                    OnPropertyChanged(nameof(Glyph));
            }
        }

        /// <summary>The checkbox glyph the view renders — a hollow box while pending, a check once done. (The green tint is applied by a DataTrigger on <see cref="Done"/> in XAML.)</summary>
        public string Glyph => _done ? "✔" : "☐"; // ✔ / ☐

        public ChecklistItemViewModel(int queueItemId, string buildLabel, int? githubNumber, string text, bool done)
        {
            QueueItemId = queueItemId;
            BuildLabel = buildLabel;
            GithubNumber = githubNumber;
            Text = text;
            Normalized = ChecklistExtractor.Normalize(text);
            _done = done;
        }
    }

    /// <summary>
    /// Backing model for the Build Watch Task Checklist side panel. Owns the flat, cross-build
    /// list of detected checklist items and the ingest/match rules that keep it live:
    ///   • a newly-seen PENDING marker adds a pending row (deduped against near-identical
    ///     already-known items for the same build, so an agent re-printing its whole checklist
    ///     each turn doesn't pile up duplicates);
    ///   • a DONE marker flips the best same-build text-similarity match to done, or — when no
    ///     confident match exists — adds a fresh already-done row (an agent can report a task
    ///     complete that we never saw ticked as pending, e.g. it started mid-stream).
    /// All mutation happens on the WPF UI thread (driven by BuildWatchWindow's poll tick).
    /// </summary>
    public sealed class TaskChecklistViewModel : ObservableObject
    {
        /// <summary>Confident-match floor for treating a "done" report as an existing pending item rather than a new one. Deliberately conservative: below this we prefer a visible duplicate row over silently retitling an unrelated task (see <see cref="ChecklistExtractor.Similarity"/> for the failure modes this guards).</summary>
        private const double MatchThreshold = 0.60;

        /// <summary>A near-identity floor used only to suppress duplicate PENDING rows when the same item is reported again — higher than <see cref="MatchThreshold"/> so we don't fold two genuinely different pending tasks together.</summary>
        private const double DedupeThreshold = 0.82;

        /// <summary>
        /// The single app-wide checklist tracker. Build Watch feeds it (its poll tick's
        /// <see cref="Ingest"/> calls) and clears it when the window closes; Focus Mode's strip
        /// (<see cref="FocusModeBar"/>) reads this very same instance, so the two surfaces show one
        /// truth off #28's one detector — never a second parser. All access is on the WPF UI thread
        /// (Build Watch's poll tick and Focus Mode's bar both run there), so no locking is needed.
        /// </summary>
        public static TaskChecklistViewModel Shared { get; } = new();

        public ObservableCollection<ChecklistItemViewModel> Items { get; } = new();

        private string _summary = "No checklist items detected yet.";
        public string Summary { get => _summary; private set => SetProperty(ref _summary, value); }

        private bool _hasItems;
        public bool HasItems { get => _hasItems; private set => SetProperty(ref _hasItems, value); }

        /// <summary>
        /// Feeds one detected marker into the list. <paramref name="marker"/> must be a real
        /// Pending/Done result from <see cref="ChecklistExtractor.TryParse"/>; callers never pass
        /// <see cref="ChecklistExtractor.Marker.None"/>. Returns true if the list changed.
        /// </summary>
        public bool Ingest(int queueItemId, string buildLabel, int? githubNumber, ChecklistExtractor.Marker marker, string text)
        {
            bool changed = marker == ChecklistExtractor.Marker.Done
                ? IngestDone(queueItemId, buildLabel, githubNumber, text)
                : IngestPending(queueItemId, buildLabel, githubNumber, text);
            if (changed) Recompute();
            return changed;
        }

        private bool IngestPending(int queueItemId, string buildLabel, int? githubNumber, string text)
        {
            // Already tracking this (or a near-identical) task for this build? Do nothing —
            // re-printing the same unchecked line each turn shouldn't stack duplicates. Note we
            // do NOT un-tick an item that's already done just because a stale pending line
            // reappears; completion is sticky.
            var existing = BestMatch(queueItemId, text, DedupeThreshold);
            if (existing != null) return false;

            Items.Add(new ChecklistItemViewModel(queueItemId, buildLabel, githubNumber, text, done: false));
            return true;
        }

        private bool IngestDone(int queueItemId, string buildLabel, int? githubNumber, string text)
        {
            // Prefer flipping an existing PENDING item for this build; fall back to matching an
            // already-done one (idempotent re-report) before creating anything new.
            var pending = BestMatch(queueItemId, text, MatchThreshold, doneState: false);
            if (pending != null)
            {
                if (pending.Done) return false;
                pending.Done = true;
                return true;
            }

            var already = BestMatch(queueItemId, text, DedupeThreshold, doneState: true);
            if (already != null) return false; // same completed item reported again

            // Reported complete with no pending counterpart we can confidently tie it to —
            // record it as an already-done row rather than dropping the signal.
            Items.Add(new ChecklistItemViewModel(queueItemId, buildLabel, githubNumber, text, done: true));
            return true;
        }

        /// <summary>Highest-similarity item for the same build at/above <paramref name="minScore"/>, optionally restricted to a given done-state. Null if none clears the bar.</summary>
        private ChecklistItemViewModel? BestMatch(int queueItemId, string text, double minScore, bool? doneState = null)
        {
            ChecklistItemViewModel? best = null;
            double bestScore = minScore;
            foreach (var item in Items)
            {
                if (item.QueueItemId != queueItemId) continue;
                if (doneState.HasValue && item.Done != doneState.Value) continue;
                double score = ChecklistExtractor.Similarity(item.Text, text);
                if (score >= bestScore)
                {
                    bestScore = score;
                    best = item;
                }
            }
            return best;
        }

        /// <summary>Drops every item that belonged to a build whose slot has been freed / reused, so a finished build's checklist doesn't linger under the next occupant.</summary>
        public void RemoveForBuild(int queueItemId)
        {
            bool removed = false;
            for (int i = Items.Count - 1; i >= 0; i--)
            {
                if (Items[i].QueueItemId == queueItemId) { Items.RemoveAt(i); removed = true; }
            }
            if (removed) Recompute();
        }

        /// <summary>Drops every tracked item — called when the Build Watch window closes so a fresh
        /// session starts clean (preserving #28's original per-window-instance behaviour now that this
        /// is an app-wide singleton) and nothing lingers/leaks across window open-close cycles.</summary>
        public void Clear()
        {
            if (Items.Count == 0) return;
            Items.Clear();
            Recompute();
        }

        private void Recompute()
        {
            HasItems = Items.Count > 0;
            if (!HasItems)
            {
                Summary = "No checklist items detected yet.";
                return;
            }
            int done = Items.Count(i => i.Done);
            Summary = $"{done} / {Items.Count} done";
        }
    }
}
