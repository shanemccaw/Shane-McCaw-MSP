using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;

namespace BuildConsole.Services.TestPad;

/// <summary>Ported from ShaneBuilder (Git #2531, Feature: Test Pad #2530; originally Git #2327,
/// ShaneBuilder Feature: Test Pad #2326). The single shared store the pill's unsent-count badge
/// reads from, and the store every later Test Pad sub-issue (composer, notes list, "Send to
/// Claude", import, ...) appends to. Modeled on the same static, thread-safe, never-throws shape
/// ShaneBuilder's own AlertCenter used — one simple static surface reachable from anywhere, real
/// in-memory state, no fixture rows.
///
/// Git #3466 — this funnel is now backed by real local-Postgres persistence
/// (<see cref="TestPadPersistence"/>): <see cref="InitializeAsync"/> loads saved notes on startup,
/// and every mutation below (add / edit / delete / mark-sent / selection) writes through so notes
/// survive a BuildConsole restart. The in-memory list stays the authoritative live surface; the DB
/// is a write-through mirror, and every persistence call is best-effort (a DB failure leaves the
/// pad working exactly as it did before, in-memory only).</summary>
public static class TestPadService
{
    private static readonly List<TestPadNote> _notes = new();

    /// <summary>0 until the one-shot startup load has been kicked off (see <see cref="InitializeAsync"/>).</summary>
    private static int _initialized;

    public static event Action? NotesChanged;

    public static IReadOnlyList<TestPadNote> Notes { get { lock (_notes) return _notes.ToList(); } }

    public static int UnsentCount { get { lock (_notes) return _notes.Count(n => !n.IsSent); } }

    /// <summary>Git #3466 — one-shot startup load: pulls every persisted note from
    /// <see cref="TestPadPersistence"/> (newest-first) and seeds the in-memory list, then raises
    /// <see cref="NotesChanged"/> so the pill badge and the pad both re-render with the restored
    /// notes. Idempotent (guarded), safe to call from the UI thread — the actual DB read runs off
    /// the caller's context. Any note the user managed to add between app start and this load
    /// completing is preserved (merge is by id; already-present ids are not duplicated). A DB
    /// failure is swallowed inside the persistence layer and simply yields an empty load.</summary>
    public static async Task InitializeAsync()
    {
        if (Interlocked.CompareExchange(ref _initialized, 1, 0) != 0) return;
        try
        {
            var loaded = await TestPadPersistence.LoadAllAsync().ConfigureAwait(false);
            if (loaded.Count == 0) return;
            lock (_notes)
            {
                var present = _notes.Select(n => n.Id).ToHashSet();
                foreach (var n in loaded)
                    if (!present.Contains(n.Id)) _notes.Add(n);
            }
            RaiseChanged();
        }
        catch { /* startup load must never take down the app */ }
    }

    /// <summary>Files a new note. Thread-safe — marshals to the UI thread, and a call must never
    /// throw back into the caller.</summary>
    public static TestPadNote AddNote(TestPadNote note)
    {
        try
        {
            StampIfUnset(note);
            lock (_notes) _notes.Insert(0, note);
            TestPadPersistence.Upsert(note); // Git #3466 — write-through so the note survives restart.
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
            TestPadNote? note;
            lock (_notes)
            {
                note = _notes.FirstOrDefault(n => n.Id == id);
                if (note == null || note.IsSent) return;

                note.Text = text;
                note.Type = type;
                note.IsEdited = true;
            }
            TestPadPersistence.Upsert(note); // Git #3466 — persist the edit.
            RaiseChanged();
        }
        catch { /* an edit failing to save must never take down the caller */ }
    }

    public static void RemoveNote(string id)
    {
        try
        {
            lock (_notes) _notes.RemoveAll(n => n.Id == id);
            TestPadPersistence.Delete(id); // Git #3466 — a deleted note must stay deleted across restart.
            RaiseChanged();
        }
        catch { }
    }

    /// <summary>Any mutation to an existing note (edit, mark sent, ...) goes through here so every
    /// subscriber — the pill badge, the pad's notes list — re-renders off the same event.</summary>
    public static void NotifyMutated() => RaiseChanged();

    /// <summary>Git #3466 — the notes list's per-row select checkbox routes through here (rather
    /// than mutating <see cref="TestPadNote.IsSelected"/> in the UI and only calling
    /// <see cref="NotifyMutated"/>) so the selection state is persisted too and survives a restart
    /// exactly as left. A no-op for a note that no longer exists.</summary>
    public static void SetSelected(string id, bool selected)
    {
        try
        {
            TestPadNote? note;
            lock (_notes)
            {
                note = _notes.FirstOrDefault(n => n.Id == id);
                if (note == null || note.IsSelected == selected) return;
                note.IsSelected = selected;
            }
            TestPadPersistence.Upsert(note);
            RaiseChanged();
        }
        catch { /* a selection toggle failing must never take down the caller */ }
    }

    /// <summary>"Send to Claude" flips every sent note's <see cref="TestPadNote.IsSent"/> (the pad
    /// already renders the SENT badge and locks the row) and clears its selection so a re-send
    /// doesn't immediately re-target the same rows. A note id that no longer exists (deleted
    /// mid-send) is silently skipped rather than throwing.</summary>
    public static void MarkSent(IEnumerable<string> ids)
    {
        try
        {
            var idSet = ids.ToHashSet();
            List<TestPadNote> affected;
            lock (_notes)
            {
                affected = _notes.Where(n => idSet.Contains(n.Id)).ToList();
                foreach (var note in affected)
                {
                    note.IsSent = true;
                    note.IsSelected = false;
                }
            }
            TestPadPersistence.UpsertMany(affected); // Git #3466 — the SENT lock must survive restart.
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
