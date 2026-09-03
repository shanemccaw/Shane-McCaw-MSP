using System;
using System.Windows.Media.Imaging;

namespace BuildConsole.Services.TestPad;

/// <summary>Ported from ShaneBuilder (Git #2531, Feature: Test Pad #2530; originally Git #2327,
/// ShaneBuilder Feature: Test Pad #2326). One note in the Test Pad. The composer, type chips,
/// stamping, notes list, edit-in-place, locking and "Send to Claude" each build out a slice of
/// this record. <see cref="Type"/> reuses the canonical <see cref="NoteType"/>/
/// <see cref="NoteMarkerParser"/> vocabulary rather than a second, drifting enum.
/// <see cref="IsSelected"/> is for the notes list's per-note checkbox.</summary>
public sealed class TestPadNote
{
    public string Id { get; } = Guid.NewGuid().ToString("N");
    public string Text { get; set; } = "";
    public NoteType Type { get; set; } = NoteType.Note;

    // Auto-stamped context — populated by whoever creates the note.
    public string? Screen { get; set; }
    public string? Feature { get; set; }
    public int? BuildNumber { get; set; }

    public DateTime CreatedAt { get; } = DateTime.UtcNow;
    public bool IsSent { get; set; }
    public bool IsEdited { get; set; }

    // Per-note selection state for the notes list (bulk copy-as-markdown and "Send to Claude"
    // both read this same flag rather than each inventing their own).
    public bool IsSelected { get; set; }

    // "Attach shot" (the composer chip) arms this flag on the note it's about to file rather than
    // the image itself, so the note renders a droppable thumbnail slot immediately even before
    // anything's been dropped onto it. <see cref="ShotImage"/> is filled in later by that drop (or
    // by a Paste Tray) — both write to this same slot.
    public bool HasShotSlot { get; set; }
    public BitmapSource? ShotImage { get; set; }
}
