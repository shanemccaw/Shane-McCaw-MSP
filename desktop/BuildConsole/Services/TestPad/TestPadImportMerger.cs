using System.Collections.Generic;
using System.Linq;

namespace BuildConsole.Services.TestPad;

/// <summary>Ported from ShaneBuilder (Git #2531, Feature: Test Pad #2530; originally Git #2353,
/// ShaneBuilder Feature: Test Pad #2326). "Import: multi-select tick boxes with `Merge N up`."
/// The actual merge mechanics behind <see cref="TestPadImportCandidate.Selected"/>: every
/// currently-selected, not-yet-merged-away candidate gets folded upward into whatever unselected
/// candidate immediately precedes the topmost selected one, in the same visible order the preview
/// renders them in. Per-row merge-up reuses the same fold-one-candidate-into-another primitive
/// below (<see cref="MergeOneUp"/>) without requiring the select tick box at all. "click to split
/// back out; Undo merges resets all": <see cref="SplitBackOut"/> reverses a single row's own
/// merge(s) using the pre-merge snapshot <see cref="MergeOneUp"/> captures on first fold;
/// <see cref="UndoAllMerges"/> walks every row and splits it back out, which flattens the whole
/// preview back to its just-parsed state regardless of how many merges (including nested ones — a
/// row that was itself merged into another) happened along the way.</summary>
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

    /// <summary>"Import: per-row merge-up button." Folds <paramref name="row"/> up into whichever
    /// non-merged-away row immediately precedes it in <paramref name="candidates"/> (in the same
    /// render order <see cref="MergeSelectedUp"/> walks), with no select tick box involved — a
    /// single click on the row itself. No-ops (returns false) when <paramref name="row"/> is
    /// already the topmost visible row, since there's nothing above it to merge into.</summary>
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
    /// <paramref name="anchor"/>'s <see cref="TestPadImportCandidate.MergedChildren"/> for
    /// split-back-out, and <paramref name="child"/> itself is marked merged-away so rendering and
    /// Import both skip it. The very first fold into a given anchor snapshots its pre-merge
    /// <see cref="TestPadImportCandidate.Text"/>/<see cref="TestPadImportCandidate.NeedsShot"/>
    /// (never overwritten by a later fold into the same anchor) so <see cref="SplitBackOut"/> can
    /// restore exactly what the row looked like before any of its children joined it.</summary>
    private static void MergeOneUp(TestPadImportCandidate anchor, TestPadImportCandidate child)
    {
        if (anchor.MergedChildren.Count == 0)
        {
            anchor.TextBeforeMerge = anchor.Text;
            anchor.NeedsShotBeforeMerge = anchor.NeedsShot;
        }

        anchor.Text = string.IsNullOrEmpty(anchor.Text) ? child.Text : $"{anchor.Text}\n\n{child.Text}";
        anchor.NeedsShot = anchor.NeedsShot || child.NeedsShot;
        anchor.MergedChildren.Add(child);

        child.Selected = false;
        child.IsMergedAway = true;
    }

    /// <summary>"click to split back out." Reverses every merge folded into <paramref name="anchor"/>:
    /// restores its own pre-merge <see cref="TestPadImportCandidate.Text"/>/
    /// <see cref="TestPadImportCandidate.NeedsShot"/> from the snapshot <see cref="MergeOneUp"/>
    /// took, un-marks every direct child as merged-away so it renders as its own row again, and
    /// clears the anchor's merge state. A child that was itself an anchor of its own earlier merges
    /// (a nested "merge up" chain) keeps its own <see cref="TestPadImportCandidate.MergedChildren"/>
    /// intact — splitting it further out is its own click. No-ops (returns false) for a row
    /// nothing has been merged into.</summary>
    public static bool SplitBackOut(TestPadImportCandidate anchor)
    {
        if (anchor.MergedChildren.Count == 0) return false;

        anchor.Text = anchor.TextBeforeMerge ?? anchor.Text;
        anchor.NeedsShot = anchor.NeedsShotBeforeMerge ?? anchor.NeedsShot;
        anchor.TextBeforeMerge = null;
        anchor.NeedsShotBeforeMerge = null;

        foreach (var child in anchor.MergedChildren)
            child.IsMergedAway = false;
        anchor.MergedChildren.Clear();

        return true;
    }

    /// <summary>"Undo merges resets all." Splits every row with merged children back out, one
    /// <see cref="SplitBackOut"/> per anchor — order doesn't matter for the end state: each anchor
    /// only ever restores its own pre-merge snapshot and un-merges its own direct children, so even
    /// a nested merge chain (A merged into Z, after X/Y were already merged into A) fully flattens
    /// back to the just-parsed candidate set. Returns whether anything was actually undone.</summary>
    public static bool UndoAllMerges(IReadOnlyList<TestPadImportCandidate> candidates)
    {
        var anchors = candidates.Where(c => c.MergedChildren.Count > 0).ToList();
        if (anchors.Count == 0) return false;

        foreach (var anchor in anchors)
            SplitBackOut(anchor);

        return true;
    }
}
