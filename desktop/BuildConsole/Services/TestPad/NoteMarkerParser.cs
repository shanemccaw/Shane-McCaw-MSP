using System.Collections.Generic;

namespace BuildConsole.Services.TestPad;

/// <summary>Ported from ShaneBuilder (Git #2531, Feature: Test Pad #2530; originally Git #2329,
/// ShaneBuilder Feature: Test Pad #2326). Reads a leading marker character off a Test Pad
/// composer's raw text and resolves it to a <see cref="NoteType"/>, stripping the marker (and any
/// whitespace right after it) from the note body that actually gets saved. Pure/stateless so the
/// composer, type chips, and the Notepad importer (which reuses the same marker vocabulary for
/// per-row type correction) can all share one parsing rule instead of drifting.</summary>
public static class NoteMarkerParser
{
    /// <summary>The one leading character each <see cref="NoteType"/> recognizes. Order here is
    /// insertion order for anything that wants to render all markers/chips consistently.</summary>
    public static readonly IReadOnlyDictionary<char, NoteType> MarkerToType = new Dictionary<char, NoteType>
    {
        ['!'] = NoteType.Bug,
        ['?'] = NoteType.Question,
        ['+'] = NoteType.Idea,
        ['.'] = NoteType.Works,
    };

    /// <summary>The marker character a given type inserts (the inverse of <see cref="MarkerToType"/>),
    /// used by a Type Chips feature to insert the marker for the user.</summary>
    public static char? MarkerFor(NoteType type)
    {
        foreach (var pair in MarkerToType)
        {
            if (pair.Value == type)
            {
                return pair.Key;
            }
        }

        return null;
    }

    /// <summary>
    /// Parses <paramref name="rawInput"/> for a leading marker (<c>!</c> bug, <c>?</c> question,
    /// <c>+</c> idea, <c>.</c> works). A marker only counts when it is the very first
    /// non-whitespace character of the input; anything else is a plain <see cref="NoteType.Note"/>
    /// with the text returned unchanged. When a marker is recognized it — and a single run of
    /// whitespace immediately following it, if any — is stripped from the returned text, so the
    /// marker never ends up duplicated in the saved note body.
    /// </summary>
    public static (NoteType Type, string Text) Parse(string? rawInput)
    {
        var raw = rawInput ?? string.Empty;
        var trimmedStart = raw.TrimStart();
        if (trimmedStart.Length == 0)
        {
            return (NoteType.Note, raw);
        }

        if (!MarkerToType.TryGetValue(trimmedStart[0], out var type))
        {
            return (NoteType.Note, raw);
        }

        var rest = trimmedStart[1..].TrimStart(' ', '\t');
        return (type, rest);
    }
}
