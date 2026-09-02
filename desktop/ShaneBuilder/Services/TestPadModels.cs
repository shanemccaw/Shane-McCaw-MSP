using System;
using ShaneBuilder.Services.TestPad;

namespace ShaneBuilder.Services;

/// <summary>
/// Git #2327 (Feature: Test Pad, #2326) — one note in the Test Pad. The composer (#2328),
/// type chips (#2330), stamping (#2331), notes list (#2333), edit-in-place (#2335), locking
/// (#2336) and "Send to Claude" (#2337) each build out a slice of this record; this issue only
/// needs enough of the shape to compute the pill's unsent-count badge. <see cref="Type"/> reuses
/// the canonical <see cref="NoteType"/>/<see cref="NoteMarkerParser"/> vocabulary landed by #2329
/// rather than a second, drifting enum.
/// </summary>
public sealed class TestPadNote
{
    public string Id { get; } = Guid.NewGuid().ToString("N");
    public string Text { get; set; } = "";
    public NoteType Type { get; set; } = NoteType.Note;

    // Auto-stamped context (#2331) — populated by whoever creates the note.
    public string? Screen { get; set; }
    public string? Feature { get; set; }
    public int? BuildNumber { get; set; }

    public DateTime CreatedAt { get; } = DateTime.UtcNow;
    public bool IsSent { get; set; }
    public bool IsEdited { get; set; }
}
