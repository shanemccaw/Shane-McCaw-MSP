using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;

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
            lock (_notes) _notes.Insert(0, note);
            RaiseChanged();
        }
        catch { /* a note failing to file must never take down the caller */ }
        return note;
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
