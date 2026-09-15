using System;
using System.Collections.Generic;
using System.Linq;

namespace BuildConsole.Controls
{
    /// <summary>Git #4164 — one entry in an Epic filter dropdown. <see cref="IsAll"/> is the
    /// "All Epics" default (matches every row, no filtering); otherwise <see cref="EpicNumber"/>
    /// (null for a real "No Epic" group) is what the panel filters its rows on.</summary>
    public readonly struct EpicFilterOption
    {
        public bool IsAll { get; init; }
        public int? EpicNumber { get; init; }
        public string Label { get; init; }
    }

    /// <summary>
    /// Git #4164 — the real Epic-filter-dropdown shape extracted from #4146's original
    /// AiBatterUpPanel-only implementation, so a second Epic-grouped panel
    /// (<see cref="WhatsRemainingPanel"/>) shares the exact same options/selection-preservation
    /// logic instead of re-deriving it a third time. AiBatterUpPanel's own combobox now builds
    /// its options through this too.
    /// </summary>
    public static class EpicFilterHelper
    {
        /// <summary>Builds the real option list for an Epic filter dropdown: a real "All Epics"
        /// default first, then one option per <paramref name="epicGroups"/> entry (already
        /// resolved/ordered by the caller's own GroupByEpic) — never a hardcoded list.</summary>
        public static List<EpicFilterOption> BuildOptions(IEnumerable<(int? EpicNumber, string Label)> epicGroups)
        {
            var options = new List<EpicFilterOption>
            {
                new() { IsAll = true, EpicNumber = null, Label = "All Epics" },
            };
            options.AddRange(epicGroups.Select(g => new EpicFilterOption
            {
                IsAll = false,
                EpicNumber = g.EpicNumber,
                Label = g.Label,
            }));
            return options;
        }

        /// <summary>Resolves which index of <paramref name="options"/> should be selected after a
        /// refresh rebuilds them: preserves <paramref name="previouslySelected"/> if that Epic is
        /// still present, otherwise falls back to "All Epics" (index 0) — e.g. that Epic's last
        /// row just left the queue.</summary>
        public static int ResolveSelectedIndex(List<EpicFilterOption> options, EpicFilterOption? previouslySelected)
        {
            if (previouslySelected is { IsAll: false } sel)
            {
                int found = options.FindIndex(o => !o.IsAll && o.EpicNumber == sel.EpicNumber);
                if (found >= 0) return found;
            }
            return 0;
        }
    }
}
