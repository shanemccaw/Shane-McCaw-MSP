using System;
using System.Linq;

namespace ShaneBuilder.Services.TestPad;

/// <summary>What a single raw pasted line reads as during Notepad import (Git #2343-#2354).
/// <see cref="Section"/> is the only kind this file resolves (Git #2344); everything else
/// starts life as <see cref="Note"/> and gets refined by the rules landing on top of this one
/// — paragraph joining (#2345) merges consecutive <see cref="Note"/> lines under a
/// <see cref="Section"/> into one note, bullet/number splitting (#2467/#2346, now landed via
/// <see cref="NotepadImportBulletParser"/>) and orphaned/bare-line handling (#2468/#2347, now
/// landed via <see cref="TestPadImportParser.ParseCore"/>'s pending-header tracking) both start
/// from a line this classifier already called <see cref="Note"/>.
/// </summary>
public enum ImportLineKind
{
    /// <summary>A header line — groups the notes that follow it until the next Section.</summary>
    Section,

    /// <summary>Everything else. The default; later import rules may re-split or re-merge it,
    /// but they never turn a <see cref="Section"/> line into a <see cref="Note"/> or vice versa
    /// — that call belongs entirely to this classifier.</summary>
    Note,
}

/// <summary>
/// Git #2344 — classifies one raw line from a pasted Notepad file as a Section header or plain
/// note text. Pure/stateless, same shape as <see cref="NoteMarkerParser"/>, so the eventual
/// paste-import pipeline (#2343) can run it line-by-line without any UI or Test Pad state.
/// </summary>
public static class NotepadImportLineClassifier
{
    /// <summary>Colon-terminated headers stay a Section up to this many words (excluding the
    /// colon) — e.g. "General Notes:" or "Action Items for This Pass:" both count; a full
    /// sentence that happens to end with a colon does not.</summary>
    private const int MaxColonHeaderWords = 6;

    /// <summary>A bare line with no trailing colon only reads as a Section within this word
    /// range — e.g. "Bugs Found" or "RAW JSON" (per the doc's own example of the boundary this
    /// rule shares with the bare-short-line-as-note rule, #2347) is short enough; a full
    /// sentence is not.</summary>
    private const int MinBareHeaderWords = 1;
    private const int MaxBareHeaderWords = 4;

    private static readonly char[] SentenceEndings = { '.', '?', '!' };

    /// <summary>
    /// True when <paramref name="line"/> reads as a Section header per Git #2344's rule: a
    /// short line ending in <c>:</c>, or a bare 1-4 word line that doesn't read like a sentence
    /// (no closing punctuation, no comma). Blank/whitespace-only lines are never a Section.
    /// </summary>
    public static bool IsSectionHeader(string? line)
    {
        var trimmed = line?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return false;
        }

        // Git #2467/#2346 — a bulleted or numbered line ("- did A thing", "1. did C thing") can
        // easily be 4 words or fewer and would otherwise satisfy the bare-header rule below,
        // swallowing the very first bullet of a list as a spurious Section instead of a note.
        // A list item is never a header, regardless of word count.
        if (NotepadImportBulletParser.TryStripMarker(trimmed, out _))
        {
            return false;
        }

        if (trimmed.EndsWith(":", StringComparison.Ordinal))
        {
            var withoutColon = trimmed[..^1].Trim();
            if (withoutColon.Length == 0)
            {
                return false;
            }

            return CountWords(withoutColon) <= MaxColonHeaderWords;
        }

        // Bare line, no trailing colon — only a Section if it's short and doesn't read like a
        // sentence. A trailing sentence-ending mark or an embedded comma means it's prose, not
        // a header, no matter how few words it has.
        if (SentenceEndings.Any(ending => trimmed.EndsWith(ending)) || trimmed.Contains(','))
        {
            return false;
        }

        var wordCount = CountWords(trimmed);
        return wordCount >= MinBareHeaderWords && wordCount <= MaxBareHeaderWords;
    }

    /// <summary>Classifies <paramref name="line"/> per <see cref="IsSectionHeader"/>.</summary>
    public static ImportLineKind Classify(string? line)
        => IsSectionHeader(line) ? ImportLineKind.Section : ImportLineKind.Note;

    private static int CountWords(string text)
        => text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
}
