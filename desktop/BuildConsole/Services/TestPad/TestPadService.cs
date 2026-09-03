using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;

namespace BuildConsole.Services.TestPad;

/// <summary>Ported from ShaneBuilder (Git #2531, Feature: Test Pad #2530; originally Git #2327,
/// ShaneBuilder Feature: Test Pad #2326). The single shared store the pill's unsent-count badge
/// reads from, and the store every later Test Pad sub-issue (composer, notes list, "Send to
/// Claude", import, ...) appends to. Modeled on the same static, thread-safe, never-throws shape
/// ShaneBuilder's own AlertCenter used — one simple static surface reachable from anywhere, real
/// in-memory state, no fixture rows.</summary>
public static class TestPadService
{
    private static readonly List<TestPadNote> _notes = new();

    public static event Action? NotesChanged;

    public static IReadOnlyList<TestPadNote> Notes { get { lock (_notes) return _notes.ToList(); } }

    public static int UnsentCount { get { lock (_notes) return _notes.Count(n => !n.IsSent); } }

    /// <summary>Files a new note. Thread-safe — marshals to the UI thread, and a call must never
    /// throw back into the caller.</summary>
    public static TestPadNote AddNote(TestPadNote note)
    {
        try
        {
            StampIfUnset(note);
            lock (_notes) _notes.Insert(0, note);
            RaiseChanged();
        }
        catch { /* a note failing to file must never take down the caller */ }
        return note;
    }

    /// <summary>Every note stamps screen, feature, and the build number running at the moment it's
    /// filed. Applied here, in the one funnel every note passes through, so a caller (composer,
    /// import, ...) never has to remember to stamp — only fills in whatever the caller left
    /// <c>null</c>, so an already-stamped note (e.g. re-filed from an edit) keeps its original
    /// stamp rather than being overwritten with the current moment's context.</summary>
    private static void StampIfUnset(TestPadNote note)
    {
        if (note.Screen != null && note.Feature != null && note.BuildNumber != null) return;

        var stamp = NoteContextStamper.Current.Capture();
        note.Screen ??= stamp.Screen;
        note.Feature ??= stamp.Feature;
        note.BuildNumber ??= stamp.BuildNumber;
    }

    /// <summary>Saves an edit loaded back into the composer onto the same note (rather than filing
    /// a duplicate), marking it <see cref="TestPadNote.IsEdited"/> so the list can show an EDITED
    /// tag. A no-op for a note that's already gone, or already sent — a sent note is locked and
    /// this is the same funnel that lock has to hold at.</summary>
    public static void UpdateNote(string id, string text, NoteType type)
    {
        try
        {
            lock (_notes)
            {
                var note = _notes.FirstOrDefault(n => n.Id == id);
                if (note == null || note.IsSent) return;

                note.Text = text;
                note.Type = type;
                note.IsEdited = true;
            }
            RaiseChanged();
        }
        catch { /* an edit failing to save must never take down the caller */ }
    }

    public static void RemoveNote(string id)
    {
        try
        {
            lock (_notes) _notes.RemoveAll(n => n.Id == id);
            RaiseChanged();
        }
        catch { }
    }

    /// <summary>Any mutation to an existing note (edit, mark sent, ...) goes through here so every
    /// subscriber — the pill badge, the pad's notes list — re-renders off the same event.</summary>
    public static void NotifyMutated() => RaiseChanged();

    /// <summary>"Send to Claude" flips every sent note's <see cref="TestPadNote.IsSent"/> (the pad
    /// already renders the SENT badge and locks the row) and clears its selection so a re-send
    /// doesn't immediately re-target the same rows. A note id that no longer exists (deleted
    /// mid-send) is silently skipped rather than throwing.</summary>
    public static void MarkSent(IEnumerable<string> ids)
    {
        try
        {
            var idSet = ids.ToHashSet();
            lock (_notes)
            {
                foreach (var note in _notes)
                {
                    if (!idSet.Contains(note.Id)) continue;
                    note.IsSent = true;
                    note.IsSelected = false;
                }
            }
            RaiseChanged();
        }
        catch { /* a mark-sent failure must never take down the caller */ }
    }

    private static void RaiseChanged()
    {
        var app = Application.Current;
        if (app?.Dispatcher == null) { NotesChanged?.Invoke(); return; }
        if (app.Dispatcher.CheckAccess()) NotesChanged?.Invoke();
        else app.Dispatcher.BeginInvoke(new Action(() => NotesChanged?.Invoke()));
    }
}
