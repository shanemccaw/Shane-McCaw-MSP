using System.Collections.Generic;
using System.Linq;

namespace ShaneBuilder.Services.TestPad;

/// <summary>Git #2353 (Feature: Test Pad, #2326) — "Import: multi-select tick boxes with
/// `Merge N up`." The actual merge mechanics behind <see cref="TestPadImportCandidate.Selected"/>:
/// every currently-selected, not-yet-merged-away candidate gets folded upward into whatever
/// unselected candidate immediately precedes the topmost selected one, in the same visible order
/// the preview renders them in. Per-row merge-up (#2352) reuses the same fold-one-candidate-into-
/// another primitive below (<see cref="MergeOneUp"/>) without requiring the select tick box at
/// all; the "+N merged" split-back-out/undo UI (#2354) is a separate open sub-issue.</summary>
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
            MergeOneUp(anchor, child);

        anchor.Selected = false;
        return toMerge.Count;
    }

    /// <summary>Git #2352 — "Import: per-row merge-up button." Folds <paramref name="row"/> up
    /// into whichever non-merged-away row immediately precedes it in <paramref name="candidates"/>
    /// (in the same render order <see cref="MergeSelectedUp"/> walks), with no select tick box
    /// involved — a single click on the row itself. No-ops (returns false) when <paramref name="row"/>
    /// is already the topmost visible row, since there's nothing above it to merge into.</summary>
    public static bool MergeRowUp(IReadOnlyList<TestPadImportCandidate> candidates, TestPadImportCandidate row)
    {
        var visible = candidates.Where(c => !c.IsMergedAway).ToList();
        var index = visible.IndexOf(row);
        if (index <= 0) return false; // not found, or already the topmost visible row

        var anchor = visible[index - 1];
        MergeOneUp(anchor, row);
        return true;
    }

    /// <summary>Shared fold: <paramref name="child"/>'s text/needs-shot state folds into
    /// <paramref name="anchor"/>, <paramref name="child"/> is recorded in
    /// <paramref name="anchor"/>'s <see cref="TestPadImportCandidate.MergedChildren"/> for a
    /// future split-back-out, and <paramref name="child"/> itself is marked merged-away so
    /// rendering and Import both skip it.</summary>
    private static void MergeOneUp(TestPadImportCandidate anchor, TestPadImportCandidate child)
    {
        anchor.Text = string.IsNullOrEmpty(anchor.Text) ? child.Text : $"{anchor.Text}\n\n{child.Text}";
        anchor.NeedsShot = anchor.NeedsShot || child.NeedsShot;
        anchor.MergedChildren.Add(child);

        child.Selected = false;
        child.IsMergedAway = true;
    }
}
