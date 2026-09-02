using System;
using System.Collections.Generic;
using System.Linq;

namespace ShaneBuilder.Services.TestPad;

/// <summary>Git #2343 (Feature: Test Pad, #2326) — the entry point for Notepad import: turns a
/// whole pasted Notepad file's raw text into candidate <see cref="TestPadNote"/> rows. This is
/// deliberately the baseline splitter only — one blank-line-separated block of text becomes one
/// note, with any leading marker (<see cref="NoteMarkerParser"/>) on the block still recognized.
/// Git #2344 adds the one refinement layered on top so far: a block that opens with a line
/// <see cref="NotepadImportLineClassifier"/> reads as a Section header is not itself filed as a
/// note — it becomes the <see cref="TestPadImportCandidate.Section"/> every candidate parsed
/// after it (until the next Section header) carries. Git #2348 layered "&lt;need screen
/// shots&gt;" stripping/flagging on top of the same splitter. The wrapped-line rejoin
/// refinement, bullet/numbering stripping, bare-short-line splitting, and feature auto-match are
/// each their own open sub-issue (#2345-#2347, #2349) that will replace/extend this splitter in
/// place — this issue only has to get a whole pasted file turned into real notes at all, not
/// perfectly.</summary>
public static class TestPadImportParser
{
    /// <summary>Git #2348 — the literal marker a Notepad note uses to call out that it needs a
    /// screenshot attached. Matched case-insensitively and stripped from the note body; its
    /// presence flags the resulting candidate's <see cref="TestPadImportCandidate.NeedsShot"/>.</summary>
    private static readonly System.Text.RegularExpressions.Regex NeedsShotMarker =
        new(@"<\s*need\s+screen\s*shots?\s*>", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

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

            // Naive dewrap: join the block's lines with a single space and collapse internal
            // whitespace runs. #2345 replaces this with a real "wrapped lines rejoin, but a
            // genuinely new note inside a section starts a new paragraph" rule.
            var joined = string.Join(" ", currentLines.Select(l => l.Trim()));
            joined = System.Text.RegularExpressions.Regex.Replace(joined, @"\s+", " ").Trim();
            currentLines.Clear();

            if (joined.Length == 0) return;

            // Git #2348 — strip the "<need screen shots>" marker wherever it falls in the block
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

            candidates.Add(new TestPadImportCandidate(body, type) { Section = currentSection, NeedsShot = needsShot });
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
}
