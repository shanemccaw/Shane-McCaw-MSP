using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Npgsql;
using BuildConsole.Services;

namespace BuildConsole.Services.TestPad;

/// <summary>
/// Git #3466 — the real, local-Postgres persistence layer behind <see cref="TestPadService"/>.
/// Before this, Test Pad's notes lived ONLY in a <c>static List&lt;TestPadNote&gt;</c> with no
/// backing store, so every note vanished on BuildConsole restart. This store gives that funnel a
/// real <c>bt_test_pad_notes</c> table (migration
/// <c>lib/db/migrations/manual/2026-09-10-bt-test-pad-notes-3466.sql</c>): load-on-startup seeds
/// the in-memory list, and every mutation the service funnels (add / edit / delete / mark-sent /
/// selection) writes through here.
///
/// Same direct-Npgsql, BUILD_DATABASE_URL-resolved pattern as <see cref="GitHubIssueMirror"/>
/// (BuildConsole's own database, Git #3651) — no separate config step, connection resolved once
/// and cached.
/// Every call is wrapped so ANY failure (unresolved DB, table not migrated, a query error) is
/// logged and swallowed: a persistence failure must never take down the pad, exactly like the
/// never-throws contract <see cref="TestPadService"/> itself already holds. When the DB is
/// unreachable the pad simply behaves as it did before this issue (in-memory only) rather than
/// crashing.
///
/// Writes are serialized through a single-slot gate so a rapid add→delete on the same id can't
/// race into the wrong final DB state; because each public entry point takes its field snapshot
/// SYNCHRONOUSLY before enqueuing the gated write, a note object mutated further after the call
/// still persists the value it had at call time.
/// </summary>
public static class TestPadPersistence
{
    public const string Channel = "testpad.persist";

    private static string? _connString;
    private static readonly object _connLock = new();

    /// <summary>Serializes DB writes so they land in call order (add-then-delete can't invert).</summary>
    private static readonly SemaphoreSlim _writeGate = new(1, 1);

    private static string? ConnString()
    {
        lock (_connLock)
        {
            if (!string.IsNullOrEmpty(_connString)) return _connString;
            var raw = BuildQueuePostgresClient.TryResolveConnectionString(BuildTrackerConfig.FindRepoRoot());
            if (string.IsNullOrWhiteSpace(raw)) return null;
            _connString = BuildQueuePostgresClient.ParseConnectionString(raw!);
            return _connString;
        }
    }

    private static async Task<NpgsqlConnection?> TryOpenAsync()
    {
        var cs = ConnString();
        if (cs == null) return null;
        var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        return conn;
    }

    /// <summary>An immutable snapshot of a note's persisted fields, captured synchronously at the
    /// moment a mutation is enqueued so the gated write records call-time state even if the live
    /// note is mutated again before the write runs.</summary>
    private readonly struct NoteRow
    {
        public string Id { get; init; }
        public string Text { get; init; }
        public string NoteType { get; init; }
        public string? Screen { get; init; }
        public string? Feature { get; init; }
        public int? BuildNumber { get; init; }
        public DateTime CreatedAt { get; init; }
        public bool IsSent { get; init; }
        public bool IsEdited { get; init; }
        public bool IsSelected { get; init; }
        public bool HasShotSlot { get; init; }
    }

    private static NoteRow Snapshot(TestPadNote n) => new()
    {
        Id = n.Id,
        Text = n.Text ?? "",
        NoteType = n.Type.ToString(),
        Screen = n.Screen,
        Feature = n.Feature,
        BuildNumber = n.BuildNumber,
        CreatedAt = n.CreatedAt,
        IsSent = n.IsSent,
        IsEdited = n.IsEdited,
        IsSelected = n.IsSelected,
        HasShotSlot = n.HasShotSlot,
    };

    // ── Load ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>Every persisted note, newest-first (matching the in-memory list's Insert(0, …)
    /// order via the monotonic <c>sort_seq</c>). Returns an empty list on a fresh DB, and also on
    /// ANY error (DB unreachable / table not migrated) — the pad then just runs in-memory only,
    /// exactly as it did before this issue.</summary>
    public static async Task<List<TestPadNote>> LoadAllAsync()
    {
        var result = new List<TestPadNote>();
        try
        {
            await using var conn = await TryOpenAsync();
            if (conn == null) return result;
            await using var cmd = new NpgsqlCommand(
                "SELECT id, text, note_type, screen, feature, build_number, created_at, " +
                "is_sent, is_edited, is_selected, has_shot_slot " +
                "FROM bt_test_pad_notes ORDER BY sort_seq DESC", conn);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                result.Add(new TestPadNote
                {
                    Id = reader.GetString(0),
                    Text = reader.IsDBNull(1) ? "" : reader.GetString(1),
                    Type = ParseNoteType(reader.IsDBNull(2) ? null : reader.GetString(2)),
                    Screen = reader.IsDBNull(3) ? null : reader.GetString(3),
                    Feature = reader.IsDBNull(4) ? null : reader.GetString(4),
                    BuildNumber = reader.IsDBNull(5) ? (int?)null : reader.GetInt32(5),
                    CreatedAt = reader.IsDBNull(6) ? DateTime.UtcNow : reader.GetFieldValue<DateTime>(6),
                    IsSent = !reader.IsDBNull(7) && reader.GetBoolean(7),
                    IsEdited = !reader.IsDBNull(8) && reader.GetBoolean(8),
                    IsSelected = !reader.IsDBNull(9) && reader.GetBoolean(9),
                    HasShotSlot = !reader.IsDBNull(10) && reader.GetBoolean(10),
                });
            }
        }
        catch (Exception ex)
        {
            ActivityLog.Log(Channel, $"LoadAllAsync failed ({ex.Message}) — pad runs in-memory only this session.");
            result.Clear();
        }
        return result;
    }

    private static NoteType ParseNoteType(string? name) =>
        Enum.TryParse<NoteType>(name, ignoreCase: true, out var t) ? t : NoteType.Note;

    // ── Writes (fire-and-forget, gated for ordering) ──────────────────────────────────────────

    /// <summary>Insert or update one note. Called from <see cref="TestPadService"/>'s add / edit /
    /// mark-sent / selection funnels. Snapshots synchronously, then persists on the gated writer.</summary>
    public static void Upsert(TestPadNote note)
    {
        if (note == null) return;
        var row = Snapshot(note);
        _ = RunGatedAsync(() => UpsertRowAsync(row));
    }

    /// <summary>Upsert several notes as one gated unit (e.g. "Send to Claude" marking a batch sent),
    /// so the whole batch persists in order relative to other writes.</summary>
    public static void UpsertMany(IEnumerable<TestPadNote> notes)
    {
        if (notes == null) return;
        var rows = new List<NoteRow>();
        foreach (var n in notes) if (n != null) rows.Add(Snapshot(n));
        if (rows.Count == 0) return;
        _ = RunGatedAsync(async () => { foreach (var r in rows) await UpsertRowAsync(r); });
    }

    /// <summary>Delete one note by id.</summary>
    public static void Delete(string id)
    {
        if (string.IsNullOrEmpty(id)) return;
        _ = RunGatedAsync(() => DeleteRowAsync(id));
    }

    private static async Task RunGatedAsync(Func<Task> work)
    {
        await _writeGate.WaitAsync();
        try { await work(); }
        catch (Exception ex) { ActivityLog.Log(Channel, $"write failed ({ex.Message}) — non-fatal, in-memory state is unaffected."); }
        finally { _writeGate.Release(); }
    }

    private static async Task UpsertRowAsync(NoteRow r)
    {
        await using var conn = await TryOpenAsync();
        if (conn == null) return;
        await using var cmd = new NpgsqlCommand(@"
            INSERT INTO bt_test_pad_notes
                (id, text, note_type, screen, feature, build_number, created_at,
                 is_sent, is_edited, is_selected, has_shot_slot, updated_at)
            VALUES (@id, @text, @type, @screen, @feature, @build, @created,
                    @sent, @edited, @selected, @shot, NOW())
            ON CONFLICT (id) DO UPDATE SET
                text          = EXCLUDED.text,
                note_type     = EXCLUDED.note_type,
                screen        = EXCLUDED.screen,
                feature       = EXCLUDED.feature,
                build_number  = EXCLUDED.build_number,
                is_sent       = EXCLUDED.is_sent,
                is_edited     = EXCLUDED.is_edited,
                is_selected   = EXCLUDED.is_selected,
                has_shot_slot = EXCLUDED.has_shot_slot,
                updated_at    = NOW()", conn);
        cmd.Parameters.AddWithValue("@id", r.Id);
        cmd.Parameters.AddWithValue("@text", r.Text);
        cmd.Parameters.AddWithValue("@type", r.NoteType);
        cmd.Parameters.AddWithValue("@screen", (object?)r.Screen ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@feature", (object?)r.Feature ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@build", (object?)r.BuildNumber ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@created", r.CreatedAt);
        cmd.Parameters.AddWithValue("@sent", r.IsSent);
        cmd.Parameters.AddWithValue("@edited", r.IsEdited);
        cmd.Parameters.AddWithValue("@selected", r.IsSelected);
        cmd.Parameters.AddWithValue("@shot", r.HasShotSlot);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task DeleteRowAsync(string id)
    {
        await using var conn = await TryOpenAsync();
        if (conn == null) return;
        await using var cmd = new NpgsqlCommand("DELETE FROM bt_test_pad_notes WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("@id", id);
        await cmd.ExecuteNonQueryAsync();
    }
}
