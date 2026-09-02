using System;
using System.Collections.Generic;
using System.Text;

namespace ShaneBuilder.Services.TestPad;

/// <summary>Git #2337 — formats a batch of Test Pad notes into the single block "Send to Claude"
/// drops into the open chat's composer. Pure/stateless (takes notes in, returns text out) so the
/// pipeline step that follows (#2338 — Claude architects, you approve, prompt + git issue, Batter
/// Up) can reuse the same block shape without this class knowing anything about composers or
/// windows. Every note's real stamp (screen/feature/build number, captured at file time by
/// <see cref="NoteContextStamper"/> via <see cref="TestPadService.AddNote"/>) rides along — that's
/// the whole point of stamping notes in the first place: so the note reads the same weeks later
/// as it did the moment it was taken.</summary>
public static class TestPadSendFormatter
{
    /// <summary>One line per note: its type tag, its stamp (via <see cref="NoteStamp.Format"/>, so
    /// the same "[Screen · Feature · Build #N]" shape the rest of Test Pad already uses), and its
    /// text. A header names the count so Claude reads "N Test Pad notes" before the list. Notes
    /// with no stamped context at all still get their type tag and text — <see cref="NoteStamp.Format"/>
    /// already tolerates every part being unresolved.</summary>
    public static string Format(IReadOnlyList<TestPadNote> notes)
    {
        if (notes.Count == 0) return string.Empty;

        var sb = new StringBuilder();
        sb.Append("Test Pad — ").Append(notes.Count).Append(notes.Count == 1 ? " note" : " notes").Append('\n');

        foreach (var note in notes)
        {
            var capturedAt = new DateTimeOffset(DateTime.SpecifyKind(note.CreatedAt, DateTimeKind.Utc));
            var stamp = new NoteStamp(note.Screen, note.Feature, note.BuildNumber, capturedAt).Format();
            sb.Append('\n').Append('-').Append(' ').Append('[').Append(TypeTag(note.Type)).Append(']');
            if (stamp.Length > 0) sb.Append(' ').Append(stamp);
            sb.Append(' ').Append(note.Text);
        }

        return sb.ToString();
    }

    private static string TypeTag(NoteType type) => type switch
    {
        NoteType.Bug => "BUG",
        NoteType.Question => "QUESTION",
        NoteType.Idea => "IDEA",
        NoteType.Works => "WORKS",
        _ => "NOTE",
    };
}
