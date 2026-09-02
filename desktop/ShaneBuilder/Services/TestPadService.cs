using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using ShaneBuilder.Services.TestPad;

namespace ShaneBuilder.Services;

/// <summary>
/// Git #2327 (Feature: Test Pad, #2326) — the single shared store the pill's unsent-count badge
/// reads from, and the store every later Test Pad sub-issue (composer #2328, notes list #2333,
/// "Send to Claude" #2337, import #2343-#2354, ...) will append to. Modeled on AlertCenter's
/// static, thread-safe, never-throws shape (Notifications/AlertCenter.cs) — one simple static
/// surface reachable from anywhere, real in-memory state, no fixture rows.
/// </summary>
public static class TestPadService
{
    private static readonly List<TestPadNote> _notes = new();

    public static event Action? NotesChanged;

    public static IReadOnlyList<TestPadNote> Notes { get { lock (_notes) return _notes.ToList(); } }

    public static int UnsentCount { get { lock (_notes) return _notes.Count(n => !n.IsSent); } }

    /// <summary>Files a new note. Thread-safe — marshals to the UI thread like AlertCenter.PublishAlert,
    /// and a call must never throw back into the caller.</summary>
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

    /// <summary>Git #2331 — every note stamps screen, feature, and the build number running at the
    /// moment it's filed. Applied here, in the one funnel every note passes through, so a caller
    /// (composer, import, ...) never has to remember to stamp — only fills in whatever the caller
    /// left <c>null</c>, so an already-stamped note (e.g. re-filed from an edit) keeps its original
    /// stamp rather than being overwritten with the current moment's context.</summary>
    private static void StampIfUnset(TestPadNote note)
    {
        if (note.Screen != null && note.Feature != null && note.BuildNumber != null) return;

        var stamp = NoteContextStamper.Current.Capture();
        note.Screen ??= stamp.Screen;
        note.Feature ??= stamp.Feature;
        note.BuildNumber ??= stamp.BuildNumber;
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

    private static void RaiseChanged()
    {
        var app = Application.Current;
        if (app?.Dispatcher == null) { NotesChanged?.Invoke(); return; }
        if (app.Dispatcher.CheckAccess()) NotesChanged?.Invoke();
        else app.Dispatcher.BeginInvoke(new Action(() => NotesChanged?.Invoke()));
    }
}
