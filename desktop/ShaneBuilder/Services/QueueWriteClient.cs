using System;
using System.Diagnostics;
using System.Threading.Tasks;
using Npgsql;

namespace ShaneBuilder.Services;

/// <summary>Git #2288 (Feature #2281 "Build Matrix", item 7 of 7 — the drawer's own stated gap:
/// "no slot-level cancel, requeue, or reassign yet"). <see cref="QueueReadClient"/> is read-only
/// by contract; this is the one deliberate, narrow exception — three real mutations against the
/// same shared <c>bt_build_queue</c> row a busy Matrix slot is already showing, using the exact
/// same status/column semantics BuildConsole's own <c>BuildQueuePostgresClient</c> already
/// established (verified against its <c>MarkCompleteAsync</c>/<c>QueueBuildAsync</c> "reuse an
/// existing row" branch) so a row this app touches looks identical, to every other reader, to one
/// BuildConsole itself touched.
///
/// A slot's real process isn't reachable through BuildConsole's own in-memory <c>_running</c>
/// dictionary (that only exists inside BuildConsole's own process) — but <c>bt_build_queue</c>
/// has carried a real <c>build_pid</c> + <c>build_pid_started_at</c> fingerprint since #1839
/// (BuildConsole's own orphan-adoption safety gate), stamped at launch specifically so a *second*
/// process can tell "this pid is genuinely still our build" apart from "Windows already reused
/// this pid for something unrelated". Fired here the same way: open the pid, compare its real
/// process-creation time against the stored fingerprint within a couple of seconds' float, and
/// only kill on a match — a mismatch (or the pid already being gone) means the process is left
/// alone and the row is still transitioned honestly (it may have already finished/crashed by the
/// time Shane clicked the button).
/// </summary>
public sealed record SlotActionResult(bool Success, bool ProcessKilled, string Message);

public sealed class QueueWriteClient
{
    private readonly string _connectionString;

    public QueueWriteClient(string connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new ArgumentException("connectionString must not be empty", nameof(connectionString));
        _connectionString = connectionString;
    }

    public static QueueWriteClient? CreateFromEnvironment()
    {
        var conn = ChatReadClient.ResolveConnectionStringForSqlRunner();
        return string.IsNullOrWhiteSpace(conn) ? null : new QueueWriteClient(conn!);
    }

    /// <summary>Stop (Cancel from a busy slot's own perspective) — kills the real OS process if
    /// its stored pid fingerprint still matches a live process, then always marks the row the
    /// same way BuildConsole's own "Stop" (<c>QuickCancelOrStopAsync</c>'s running branch,
    /// <c>MarkCompleteAsync(id, -1)</c>) does: exit_code -1 -> status 'failed', pid columns
    /// cleared. Never silently marks a row failed while leaving the process alive with no attempt
    /// to reach it — the caller finds out honestly whether the kill actually landed.</summary>
    public async Task<SlotActionResult> CancelRunningAsync(int id)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync();

        var (pid, startedAt) = await ReadPidFingerprintAsync(conn, id);
        bool killed = TryKillFingerprinted(pid, startedAt);

        await using var cmd = new NpgsqlCommand(@"
            UPDATE bt_build_queue
               SET status = 'failed',
                   exit_code = -1,
                   completed_at = NOW(),
                   updated_at = NOW(),
                   build_pid = NULL,
                   build_pid_started_at = NULL
             WHERE id = @id
               AND status = 'running'", conn);
        cmd.Parameters.AddWithValue("id", id);
        int rows = await cmd.ExecuteNonQueryAsync();

        if (rows == 0)
            return new SlotActionResult(false, killed, "Row wasn't 'running' anymore — nothing to cancel (it may have already finished).");
        return new SlotActionResult(true, killed,
            killed ? "Process killed and row marked failed." : "Row marked failed — no live process matched its stored pid (already exited).");
    }

    /// <summary>Requeue — same stop-if-live step as <see cref="CancelRunningAsync"/>, then resets
    /// this SAME row back to 'queued' (claimed_at/completed_at/exit_code/session_id cleared)
    /// instead of inserting a second row, mirroring <c>QueueBuildAsync</c>'s own "existingId"
    /// reuse branch — the watcher's claim query (<c>WHERE status = 'queued'</c>) picks it straight
    /// back up with its original title/prompt/model intact.</summary>
    public async Task<SlotActionResult> RequeueAsync(int id)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync();

        var (pid, startedAt) = await ReadPidFingerprintAsync(conn, id);
        bool killed = TryKillFingerprinted(pid, startedAt);

        await using var cmd = new NpgsqlCommand(@"
            UPDATE bt_build_queue
               SET status = 'queued',
                   claimed_at = NULL,
                   completed_at = NULL,
                   exit_code = NULL,
                   session_id = NULL,
                   build_pid = NULL,
                   build_pid_started_at = NULL,
                   updated_at = NOW()
             WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", id);
        int rows = await cmd.ExecuteNonQueryAsync();

        if (rows == 0)
            return new SlotActionResult(false, killed, "Row no longer exists — couldn't requeue.");
        return new SlotActionResult(true, killed, "Re-queued — will be claimed again on the next watcher pass.");
    }

    /// <summary>Reassign — same stop-and-requeue as <see cref="RequeueAsync"/>, plus setting
    /// <c>model</c> to <paramref name="newModel"/> in the same statement, so the next claim
    /// launches under the new model instead of the one it was originally dispatched with.</summary>
    public async Task<SlotActionResult> ReassignAsync(int id, string newModel)
    {
        if (string.IsNullOrWhiteSpace(newModel))
            return new SlotActionResult(false, false, "No model chosen — nothing to reassign to.");

        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync();

        var (pid, startedAt) = await ReadPidFingerprintAsync(conn, id);
        bool killed = TryKillFingerprinted(pid, startedAt);

        await using var cmd = new NpgsqlCommand(@"
            UPDATE bt_build_queue
               SET status = 'queued',
                   model = @model,
                   claimed_at = NULL,
                   completed_at = NULL,
                   exit_code = NULL,
                   session_id = NULL,
                   build_pid = NULL,
                   build_pid_started_at = NULL,
                   updated_at = NOW()
             WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("model", newModel.Trim());
        int rows = await cmd.ExecuteNonQueryAsync();

        if (rows == 0)
            return new SlotActionResult(false, killed, "Row no longer exists — couldn't reassign.");
        return new SlotActionResult(true, killed, $"Reassigned to {newModel.Trim()} and re-queued.");
    }

    private static async Task<(int? Pid, DateTimeOffset? StartedAt)> ReadPidFingerprintAsync(NpgsqlConnection conn, int id)
    {
        await using var cmd = new NpgsqlCommand(
            "SELECT build_pid, build_pid_started_at FROM bt_build_queue WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", id);
        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return (null, null);
        int? pid = reader.IsDBNull(0) ? null : reader.GetInt32(0);
        DateTimeOffset? startedAt = reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1);
        return (pid, startedAt);
    }

    /// <summary>Git #1839's own pid-reuse safety gate, replicated with plain
    /// <see cref="Process"/> (this app has no reason to take BuildConsole's native-handle route —
    /// it never adopts/streams the process, only ever kills it once, so the managed API is
    /// enough): no stored pid -> nothing to kill; pid not found -> already gone; creation time off
    /// by more than a couple of seconds -> a DIFFERENT process now holds this pid, leave it alone.</summary>
    private static bool TryKillFingerprinted(int? pid, DateTimeOffset? startedAt)
    {
        if (!pid.HasValue || !startedAt.HasValue) return false;
        try
        {
            var proc = Process.GetProcessById(pid.Value);
            if (proc.HasExited) return false;
            var drift = (proc.StartTime - startedAt.Value.LocalDateTime).Duration();
            if (drift > TimeSpan.FromSeconds(2)) return false; // pid reused by something else
            proc.Kill(entireProcessTree: true);
            return true;
        }
        catch (ArgumentException)
        {
            return false; // no such process — already gone
        }
        catch (InvalidOperationException)
        {
            return false; // already exited between the checks above and Kill
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[queue] pid kill failed: {ex.Message}");
            return false;
        }
    }
}
