using System;
using System.Collections.Generic;
using System.Linq;

namespace ShaneBuilder.Services.TestPad;

/// <summary>Git #2343 (Feature: Test Pad, #2326) — the entry point for Notepad import: turns a
/// whole pasted Notepad file's raw text into candidate <see cref="TestPadNote"/> rows. This is
/// deliberately the baseline splitter only — one blank-line-separated block of text becomes one
/// note, with any leading marker (<see cref="NoteMarkerParser"/>) on the block still recognized.
/// The section-vs-note distinction, wrapped-line rejoin refinement, bullet/numbering stripping,
/// bare-short-line splitting, "&lt;need screen shots&gt;" flagging, and feature auto-match are
/// each their own open sub-issue (#2344-#2349) that will replace/extend this splitter in place —
/// this issue only has to get a whole pasted file turned into real notes at all, not perfectly.</summary>
public static class TestPadImportParser
{
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

            var (type, body) = NoteMarkerParser.Parse(joined);
            body = body.Trim();
            if (body.Length == 0) return;

            candidates.Add(new TestPadImportCandidate(body, type));
        }

        foreach (var line in text.Split('\n'))
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                FlushBlock();
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

    /// <summary>Whether this candidate is checked to actually be filed on Import. Defaults to
    /// included — the user unchecks what they don't want rather than opting every row in.</summary>
    public bool Include { get; set; } = true;
}
