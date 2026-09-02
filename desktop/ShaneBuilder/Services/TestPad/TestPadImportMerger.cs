using System.Collections.Generic;
using System.Linq;

namespace ShaneBuilder.Services.TestPad;

/// <summary>Git #2353 (Feature: Test Pad, #2326) — "Import: multi-select tick boxes with
/// `Merge N up`." The actual merge mechanics behind <see cref="TestPadImportCandidate.Selected"/>:
/// every currently-selected, not-yet-merged-away candidate gets folded upward into whatever
/// unselected candidate immediately precedes the topmost selected one, in the same visible order
/// the preview renders them in. Per-row merge-up (#2352) and the "+N merged" split-back-out/undo
/// UI (#2354) are separate open sub-issues; this is the shared merge primitive both build on —
/// merging one selected row up is just this with N=1.</summary>
public static class TestPadImportMerger
{
    /// <summary>Merges every selected, non-merged-away row in <paramref name="candidates"/> up
    /// into the nearest preceding non-merged-away, non-selected row (in list/render order).
    /// Returns the number of rows actually merged (0 if nothing was selected, or the only
    /// selected rows sit at the very top with nothing above to merge into).</summary>
    public static int MergeSelectedUp(IReadOnlyList<TestPadImportCandidate> candidates)
    {
        // Render order == list order (merged-away rows are simply skipped when rendering), so
        // walking the raw list front-to-back is the same order the user sees.
        var visible = candidates.Where(c => !c.IsMergedAway).ToList();
        var firstSelectedIndex = visible.FindIndex(c => c.Selected);
        if (firstSelectedIndex <= 0) return 0; // nothing selected, or the selection starts at row 0 with nothing above it

        var anchor = visible[firstSelectedIndex - 1];
        var toMerge = visible.Skip(firstSelectedIndex).Where(c => c.Selected).ToList();
        if (toMerge.Count == 0) return 0;

        foreach (var child in toMerge)
        {
            anchor.Text = string.IsNullOrEmpty(anchor.Text) ? child.Text : $"{anchor.Text}\n\n{child.Text}";
            anchor.NeedsShot = anchor.NeedsShot || child.NeedsShot;
            anchor.MergedChildren.Add(child);

            child.Selected = false;
            child.IsMergedAway = true;
        }

        anchor.Selected = false;
        return toMerge.Count;
    }
}
