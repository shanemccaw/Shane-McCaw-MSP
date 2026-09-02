using System;
using System.Collections.Generic;
using System.Linq;

namespace ShaneBuilder.Services.TestPad;

/// <summary>Git #2343 (Feature: Test Pad, #2326) — the entry point for Notepad import: turns a
/// whole pasted Notepad file's raw text into candidate <see cref="TestPadNote"/> rows, with any
/// leading marker (<see cref="NoteMarkerParser"/>) on each note still recognized. Git #2344
/// layered Section-header detection on top: a block that opens with a line
/// <see cref="NotepadImportLineClassifier"/> reads as a Section header is not itself filed as a
/// note — it becomes the <see cref="TestPadImportCandidate.Section"/> every candidate parsed
/// after it (until the next Section header) carries. Git #2345/#2466 layered real paragraph
/// reflow on top of that: a blank line still hard-separates notes, but within one blank-line
/// block, <see cref="SplitIntoParagraphs"/> further splits on sentence boundaries so a
/// genuinely new note typed on its own line (no blank line before it, but the prior line ended
/// a sentence) still becomes its own note, while a soft-wrapped continuation (prior line has no
/// terminal punctuation — it was just wrapped mid-thought) rejoins into the same note. Git
/// #2348 layered "&lt;need screen shots&gt;" stripping/flagging on top of the same pipeline.
/// Bullet/numbering stripping, bare-short-line splitting, and feature auto-match are each their
/// own open sub-issue (#2346, #2347, #2349) that will further extend this in place.</summary>
public static class TestPadImportParser
{
    /// <summary>Git #2348 — the literal marker a Notepad note uses to call out that it needs a
    /// screenshot attached. Matched case-insensitively and stripped from the note body; its
    /// presence flags the resulting candidate's <see cref="TestPadImportCandidate.NeedsShot"/>.</summary>
    private static readonly System.Text.RegularExpressions.Regex NeedsShotMarker =
        new(@"<\s*need\s+screen\s*shots?\s*>", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    /// <summary>Git #2345/#2466 — a line ending in one of these reads as a complete sentence, so
    /// the line after it starts a new paragraph/note rather than rejoining as a wrap. Same
    /// vocabulary <see cref="NotepadImportLineClassifier"/> already uses to tell a bare header
    /// from a sentence.</summary>
    private static readonly char[] SentenceEndings = { '.', '?', '!' };

    /// <summary>Parses <paramref name="rawText"/> into candidate notes ready for preview. Never
    /// throws — a pathological paste degrades to an empty result rather than crashing the import
    /// dialog.</summary>
    public static IReadOnlyList<TestPadImportCandidate> Parse(string? rawText)
    {
        try
        {
            return ParseCore(rawText);
        }
        catch
        {
            return Array.Empty<TestPadImportCandidate>();
        }
    }

    private static IReadOnlyList<TestPadImportCandidate> ParseCore(string? rawText)
    {
        var text = rawText ?? string.Empty;
        // Normalize line endings so a Notepad (CRLF) paste and a Unix-origin paste split the same.
        text = text.Replace("\r\n", "\n").Replace("\r", "\n");

        var candidates = new List<TestPadImportCandidate>();
        var currentLines = new List<string>();
        string? currentSection = null;

        void FlushBlock()
        {
            if (currentLines.Count == 0) return;

            // Git #2345/#2466 — a blank-line block can still hold more than one genuine note:
            // split it into paragraphs on sentence boundaries first, then dewrap each paragraph
            // on its own (single space, whitespace runs collapsed) rather than joining the whole
            // block into one note regardless of how many distinct notes it actually contains.
            foreach (var paragraphLines in SplitIntoParagraphs(currentLines))
            {
                EmitCandidate(paragraphLines, currentSection, candidates);
            }
            currentLines.Clear();
        }

        foreach (var line in text.Split('\n'))
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                FlushBlock();
            }
            else if (currentLines.Count == 0 && NotepadImportLineClassifier.IsSectionHeader(line))
            {
                // Git #2344 — a short colon-terminated or bare 1-4 word line opening a fresh
                // block reads as a Section header, not note body: remember it (colon and outer
                // whitespace stripped) and keep accumulating whatever paragraph follows under
                // it, rather than filing the header line itself as a note. A header with no
                // paragraph following it before the next blank line/section currently produces
                // no candidate at all — #2347 (bare short lines split into their own notes) is
                // the sub-issue that reclassifies that specific case instead of dropping it.
                currentSection = line.Trim().TrimEnd(':').Trim();
            }
            else
            {
                currentLines.Add(line);
            }
        }
        FlushBlock();

        return candidates;
    }

    /// <summary>Git #2345/#2466 — splits one blank-line-delimited block's raw lines into the
    /// paragraphs it actually contains. A line starts a new paragraph unless the immediately
    /// preceding line ends mid-sentence (no <see cref="SentenceEndings"/>), in which case it's
    /// treated as that paragraph's wrapped continuation and rejoined instead. The very first
    /// line of the block always starts the first paragraph. Each returned paragraph is the
    /// already-trimmed lines that belong to it, in order — dewrapping (single-space join,
    /// whitespace-run collapse) is left to the caller.</summary>
    private static IEnumerable<List<string>> SplitIntoParagraphs(IReadOnlyList<string> lines)
    {
        var paragraphs = new List<List<string>>();
        List<string>? current = null;
        string? previous = null;

        foreach (var raw in lines)
        {
            var trimmed = raw.Trim();
            if (trimmed.Length == 0) continue;

            var startsNewParagraph = current is null
                || (previous is { Length: > 0 } && SentenceEndings.Contains(previous[^1]));

            if (startsNewParagraph)
            {
                current = new List<string>();
                paragraphs.Add(current);
            }

            current!.Add(trimmed);
            previous = trimmed;
        }

        return paragraphs;
    }

    /// <summary>Git #2345/#2466 — dewraps one paragraph's lines into a single note body (space
    /// join, whitespace-run collapse), then runs the same per-note pipeline every candidate goes
    /// through: Git #2348's "&lt;need screen shots&gt;" strip/flag, then <see cref="NoteMarkerParser"/>
    /// for a leading type marker. Adds nothing to <paramref name="candidates"/> when the
    /// paragraph reduces to nothing (e.g. it was only the needs-shot marker).</summary>
    private static void EmitCandidate(IReadOnlyList<string> paragraphLines, string? section, List<TestPadImportCandidate> candidates)
    {
        var joined = string.Join(" ", paragraphLines);
        joined = System.Text.RegularExpressions.Regex.Replace(joined, @"\s+", " ").Trim();
        if (joined.Length == 0) return;

        // Git #2348 — strip the "<need screen shots>" marker wherever it falls in the paragraph
        // and flag the candidate, rather than requiring it at a fixed position.
        var needsShot = NeedsShotMarker.IsMatch(joined);
        if (needsShot)
        {
            joined = NeedsShotMarker.Replace(joined, " ");
            joined = System.Text.RegularExpressions.Regex.Replace(joined, @"\s+", " ").Trim();
        }
        if (joined.Length == 0) return;

        var (type, body) = NoteMarkerParser.Parse(joined);
        body = body.Trim();
        if (body.Length == 0) return;

        candidates.Add(new TestPadImportCandidate(body, type) { Section = section, NeedsShot = needsShot });
    }
}

/// <summary>One row of the import preview before it's actually filed into
/// <see cref="TestPadService"/> — mutable so the preview (this issue's minimal version, and the
/// per-row type-chip correction / merge-up sub-issues, #2351-#2354, that extend it) can adjust
/// <see cref="Type"/> and <see cref="Include"/> before the real notes get created.</summary>
public sealed class TestPadImportCandidate
{
    public TestPadImportCandidate(string text, NoteType type)
    {
        Text = text;
        Type = type;
    }

    public string Text { get; set; }
    public NoteType Type { get; set; }

    /// <summary>Git #2344 — the Section header text (colon/outer whitespace stripped) this
    /// candidate was parsed under, or null when the paste had no header line above it yet.
    /// Feature auto-match (#2349) reads this as one of its inputs.</summary>
    public string? Section { get; set; }

    /// <summary>Git #2349 — the feature this candidate auto-matched to (from <see cref="Section"/>
    /// or its body text), or null when nothing matched and the row falls back to the manual
    /// dropdown. The matcher itself is #2349's own open scope; this field is here now so the
    /// header stats line (#2350) and the per-row dropdown fallback have something real to read
    /// the moment #2349 starts setting it — every candidate is honestly unmatched until then.</summary>
    public string? MatchedFeature { get; set; }

    /// <summary>Whether this candidate is checked to actually be filed on Import. Defaults to
    /// included — the user unchecks what they don't want rather than opting every row in.</summary>
    public bool Include { get; set; } = true;

    /// <summary>Git #2348 — set when the source block contained a "&lt;need screen shots&gt;"
    /// marker (already stripped out of <see cref="Text"/> by the time this is true). Filed notes
    /// carry this through to <see cref="TestPadNote.HasShotSlot"/> — the same droppable-thumbnail
    /// slot the manual "Attach shot" composer chip (#2340) arms.</summary>
    public bool NeedsShot { get; set; }

    /// <summary>Git #2353 — ticked in the preview's multi-select column to mark this row for
    /// "Merge N up". Independent of <see cref="Include"/>: a row can be selected for merging
    /// without being excluded from import, and vice versa.</summary>
    public bool Selected { get; set; }

    /// <summary>Git #2353 — set true once this candidate has been merged up into a prior row's
    /// <see cref="Text"/>. A merged-away candidate is skipped by rendering and by Import (its
    /// content already lives inside the row it was merged into); it is kept in the original list
    /// (not removed) and in <see cref="MergedInto"/>'s <see cref="MergedChildren"/> so a future
    /// split-back-out (#2354) has the real candidates to restore, not just their text.</summary>
    public bool IsMergedAway { get; set; }

    /// <summary>Git #2353 — the candidates merged into this one via "Merge N up", in the order
    /// they were merged. Drives a "+N merged" indicator on the row (#2354 extends this into a
    /// clickable split-back-out); empty for a row nothing has been merged into.</summary>
    public List<TestPadImportCandidate> MergedChildren { get; } = new();
}
