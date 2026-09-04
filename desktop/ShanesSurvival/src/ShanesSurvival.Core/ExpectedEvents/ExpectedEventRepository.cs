using Npgsql;

namespace ShanesSurvival.Core.ExpectedEvents;

/// <summary>
/// Real row from expected_one_time_events (#2910) — a pending one-time inflow/outflow that
/// hasn't happened yet, e.g. a real insurance deductible owed or a contingent reimbursement.
/// </summary>
public sealed record ExpectedEventRow(
    Guid Id,
    string Description,
    string Direction,
    decimal Amount,
    string Status,
    string? ContingencyNotes,
    DateOnly? ExpectedDate,
    DateTimeOffset CreatedAt,
    DateTimeOffset? RealizedAt);

public sealed record ExpectedEventListResult(bool Success, IReadOnlyList<ExpectedEventRow> Events, string? ErrorMessage);
public sealed record ExpectedEventWriteResult(bool Success, ExpectedEventRow? Event, string? ErrorMessage);

/// <summary>
/// Real read/write access to expected_one_time_events (migrations/010_expected_events.sql).
/// Never throws: every real failure becomes a Result the caller (MCP tool) can show, same
/// pattern as DebtRepository/PayPeriodPlanRepository. Deliberately has no linkage into
/// gate_status/bill_status shortfall math — these are pending, not-yet-real amounts.
/// </summary>
public sealed class ExpectedEventRepository
{
    /// <summary>
    /// Real pending events (status = 'pending'), most-relevant first: those with a real
    /// expected_date sorted soonest first, then no-date ones after.
    /// </summary>
    public async Task<ExpectedEventListResult> ListPendingAsync(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new ExpectedEventListResult(false, [], "No Postgres connection string configured. Open Settings to add one.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            var events = new List<ExpectedEventRow>();
            await using var command = new NpgsqlCommand(
                """
                SELECT id, description, direction, amount, status, contingency_notes, expected_date, created_at, realized_at
                FROM expected_one_time_events
                WHERE status = 'pending'
                ORDER BY (expected_date IS NULL), expected_date, created_at
                """, connection);
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                events.Add(Map(reader));
            }

            return new ExpectedEventListResult(true, events, null);
        }
        catch (Exception ex)
        {
            return new ExpectedEventListResult(false, [], $"Could not read expected events: {ex.Message}");
        }
    }

    public async Task<ExpectedEventWriteResult> RecordAsync(
        string? connectionString,
        string description,
        string direction,
        decimal amount,
        DateOnly? expectedDate,
        string? contingencyNotes)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new ExpectedEventWriteResult(false, null, "No Postgres connection string configured. Open Settings to add one.");
        }

        if (string.IsNullOrWhiteSpace(description))
        {
            return new ExpectedEventWriteResult(false, null, "Description is required.");
        }

        if (direction is not ("inflow" or "outflow"))
        {
            return new ExpectedEventWriteResult(false, null, "Direction must be \"inflow\" or \"outflow\".");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            var id = Guid.NewGuid();
            await using var insertCommand = new NpgsqlCommand(
                """
                INSERT INTO expected_one_time_events
                    (id, description, direction, amount, status, contingency_notes, expected_date, created_at)
                VALUES (@id, @description, @direction, @amount, 'pending', @contingencyNotes, @expectedDate, now())
                """, connection);
            insertCommand.Parameters.AddWithValue("id", id);
            insertCommand.Parameters.AddWithValue("description", description);
            insertCommand.Parameters.AddWithValue("direction", direction);
            insertCommand.Parameters.AddWithValue("amount", amount);
            insertCommand.Parameters.AddWithValue("contingencyNotes", (object?)contingencyNotes ?? DBNull.Value);
            insertCommand.Parameters.AddWithValue("expectedDate", (object?)expectedDate ?? DBNull.Value);
            await insertCommand.ExecuteNonQueryAsync();

            return await ReadBackAsync(connection, id);
        }
        catch (Exception ex)
        {
            return new ExpectedEventWriteResult(false, null, $"Could not record expected event \"{description}\": {ex.Message}");
        }
    }

    /// <summary>
    /// Flips a pending event to realized and stamps realized_at. Does NOT write into
    /// debts/income_entries/any account balance — Shane still confirms the real transaction
    /// separately (same "app never invents money" principle as mark_allocation_executed).
    /// Idempotent — marking an already-realized event again is a safe no-op, not an error.
    /// </summary>
    public async Task<ExpectedEventWriteResult> MarkRealizedAsync(string? connectionString, Guid eventId)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new ExpectedEventWriteResult(false, null, "No Postgres connection string configured. Open Settings to add one.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            await using var updateCommand = new NpgsqlCommand(
                """
                UPDATE expected_one_time_events
                SET status = 'realized', realized_at = COALESCE(realized_at, now())
                WHERE id = @id AND status = 'pending'
                """, connection);
            updateCommand.Parameters.AddWithValue("id", eventId);
            var rowsAffected = await updateCommand.ExecuteNonQueryAsync();

            await using var existsCommand = new NpgsqlCommand(
                "SELECT 1 FROM expected_one_time_events WHERE id = @id", connection);
            existsCommand.Parameters.AddWithValue("id", eventId);
            var exists = await existsCommand.ExecuteScalarAsync() is not null;
            if (!exists)
            {
                return new ExpectedEventWriteResult(false, null, "No expected event found with that id.");
            }

            // rowsAffected == 0 here means it was already realized (or cancelled) — idempotent no-op.
            _ = rowsAffected;

            return await ReadBackAsync(connection, eventId);
        }
        catch (Exception ex)
        {
            return new ExpectedEventWriteResult(false, null, $"Could not mark expected event realized: {ex.Message}");
        }
    }

    private static async Task<ExpectedEventWriteResult> ReadBackAsync(NpgsqlConnection connection, Guid id)
    {
        await using var readBackCommand = new NpgsqlCommand(
            """
            SELECT id, description, direction, amount, status, contingency_notes, expected_date, created_at, realized_at
            FROM expected_one_time_events WHERE id = @id
            """, connection);
        readBackCommand.Parameters.AddWithValue("id", id);
        await using var reader = await readBackCommand.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return new ExpectedEventWriteResult(false, null, "Expected event was written but could not be read back.");
        }

        return new ExpectedEventWriteResult(true, Map(reader), null);
    }

    private static ExpectedEventRow Map(NpgsqlDataReader reader) => new(
        reader.GetGuid(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.GetDecimal(3),
        reader.GetString(4),
        reader.IsDBNull(5) ? null : reader.GetString(5),
        reader.IsDBNull(6) ? null : DateOnly.FromDateTime(reader.GetDateTime(6)),
        reader.GetFieldValue<DateTimeOffset>(7),
        reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8));
}
