using System;
using ShaneBuilder.Services.TestPad;

namespace ShaneBuilder.Services;

/// <summary>
/// Git #2327 (Feature: Test Pad, #2326) — one note in the Test Pad. The composer (#2328),
/// type chips (#2330), stamping (#2331), notes list (#2333), edit-in-place (#2335), locking
/// (#2336) and "Send to Claude" (#2337) each build out a slice of this record. <see cref="Type"/>
/// reuses the canonical <see cref="NoteType"/>/<see cref="NoteMarkerParser"/> vocabulary landed
/// by #2329 rather than a second, drifting enum. <see cref="IsSelected"/> was added by #2333 for
/// the notes list's per-note checkbox.
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

    // Git #2333 — per-note selection state for the notes list (bulk copy-as-markdown #2339 and
    // "Send to Claude" #2337 will read this same flag rather than each inventing their own).
    public bool IsSelected { get; set; }

    // Git #2340/#2341 — a note can carry one attached shot (full "arm next note; droppable
    // thumbnail" attach UI is #2340's own scope; this field is the plumbing #2342's Paste Tray
    // needs to exist at all). Null for the overwhelming majority of notes, which never attach a
    // shot. A local file path on disk, not embedded image bytes — the tray loads it lazily per
    // note (#2342) rather than this record holding decoded bitmaps for every note in memory.
    public string? ImagePath { get; set; }
}
