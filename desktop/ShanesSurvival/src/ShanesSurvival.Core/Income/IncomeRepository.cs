using Npgsql;
using NpgsqlTypes;

namespace ShanesSurvival.Core.Income;

/// <summary>
/// Real read/write access to income_sources/income_entries (migrations/005_income_tracking.sql).
/// Never throws: every real failure becomes a Result the caller (an MCP tool, so far — no WPF UI
/// for this yet) shows, same pattern as AccountRepository/PayPeriodPlanRepository. Sets up (but
/// does not itself wire) #2904's pay_period_due_status pulling next_pay_date automatically from a
/// real income source — out of scope here.
/// </summary>
public sealed class IncomeRepository
{
    /// <summary>
    /// Upserts a real income source by name (case-insensitive, same convention
    /// AccountRepository/FinanceTools already use for accounts). An existing source keeps any
    /// field not supplied on this call — a null argument here means "leave it as-is", not "clear
    /// it", so a later set_income_source(name) call to only nudge next_pay_date can't silently
    /// wipe an already-recorded payFrequencyDays/expectedPerCycle.
    /// </summary>
    public async Task<IncomeSourceWriteResult> UpsertSourceAsync(
        string? connectionString, string name, string? person, int? payFrequencyDays,
        decimal? expectedPerCycle, DateOnly? nextPayDate)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new IncomeSourceWriteResult(false, null, "No Postgres connection string configured. Open Settings to add one.");
        }
        if (string.IsNullOrWhiteSpace(name))
        {
            return new IncomeSourceWriteResult(false, null, "Income source name is required.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            await using var command = new NpgsqlCommand(
                """
                INSERT INTO income_sources (id, name, person, pay_frequency_days, expected_per_cycle, next_pay_date)
                VALUES (@id, @name, @person, @payFrequencyDays, @expectedPerCycle, @nextPayDate)
                ON CONFLICT (name) DO UPDATE SET
                    person = COALESCE(@person, income_sources.person),
                    pay_frequency_days = COALESCE(@payFrequencyDays, income_sources.pay_frequency_days),
                    expected_per_cycle = COALESCE(@expectedPerCycle, income_sources.expected_per_cycle),
                    next_pay_date = COALESCE(@nextPayDate, income_sources.next_pay_date)
                RETURNING id, name, person, pay_frequency_days, expected_per_cycle, next_pay_date, is_active
                """, connection);
            command.Parameters.AddWithValue("id", Guid.NewGuid());
            command.Parameters.AddWithValue("name", name);
            command.Parameters.AddWithValue("person", (object?)person ?? "shane");
            command.Parameters.AddWithValue("payFrequencyDays", (object?)payFrequencyDays ?? DBNull.Value);
            command.Parameters.AddWithValue("expectedPerCycle", (object?)expectedPerCycle ?? DBNull.Value);
            command.Parameters.AddWithValue("nextPayDate", (object?)nextPayDate ?? DBNull.Value);

            await using var reader = await command.ExecuteReaderAsync();
            await reader.ReadAsync();
            var row = ReadSourceRow(reader);

            return new IncomeSourceWriteResult(true, row, null);
        }
        catch (Exception ex)
        {
            return new IncomeSourceWriteResult(false, null, $"Could not save income source \"{name}\": {ex.Message}");
        }
    }

    /// <summary>
    /// Records a real deposit against a named income source, matched case-insensitively (same
    /// convention as recent_transactions/set_bill_target). If that source has a real
    /// pay_frequency_days set, also advances its next_pay_date to date + pay_frequency_days —
    /// real and deterministic, never guessed. Both writes happen in one transaction so a source's
    /// next_pay_date can never drift out of sync with its own most recent recorded entry.
    /// </summary>
    public async Task<IncomeEntryWriteResult> RecordEntryAsync(
        string? connectionString, string sourceName, decimal amount, DateOnly date, string? notes)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new IncomeEntryWriteResult(false, null, null, "No Postgres connection string configured. Open Settings to add one.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();

            Guid sourceId;
            string realSourceName;
            int? payFrequencyDays;
            await using (var findSource = new NpgsqlCommand(
                "SELECT id, name, pay_frequency_days FROM income_sources WHERE lower(name) = lower(@name)",
                connection, transaction))
            {
                findSource.Parameters.AddWithValue("name", sourceName);
                await using var reader = await findSource.ExecuteReaderAsync();
                if (!await reader.ReadAsync())
                {
                    return new IncomeEntryWriteResult(false, null, null,
                        $"No income source named \"{sourceName}\" found. Use set_income_source to create it first.");
                }
                sourceId = reader.GetGuid(0);
                realSourceName = reader.GetString(1);
                payFrequencyDays = reader.IsDBNull(2) ? null : reader.GetInt32(2);
            }

            Guid entryId = Guid.NewGuid();
            DateTimeOffset createdAt;
            await using (var insertEntry = new NpgsqlCommand(
                """
                INSERT INTO income_entries (id, source_id, date, amount, notes)
                VALUES (@id, @sourceId, @date, @amount, @notes)
                RETURNING created_at
                """, connection, transaction))
            {
                insertEntry.Parameters.AddWithValue("id", entryId);
                insertEntry.Parameters.AddWithValue("sourceId", sourceId);
                insertEntry.Parameters.AddWithValue("date", date);
                insertEntry.Parameters.AddWithValue("amount", amount);
                insertEntry.Parameters.AddWithValue("notes", (object?)notes ?? DBNull.Value);
                await using var reader = await insertEntry.ExecuteReaderAsync();
                await reader.ReadAsync();
                createdAt = reader.GetFieldValue<DateTimeOffset>(0);
            }

            DateOnly? newNextPayDate = null;
            if (payFrequencyDays is > 0)
            {
                newNextPayDate = date.AddDays(payFrequencyDays.Value);
                await using var advance = new NpgsqlCommand(
                    "UPDATE income_sources SET next_pay_date = @nextPayDate WHERE id = @id",
                    connection, transaction);
                advance.Parameters.AddWithValue("nextPayDate", newNextPayDate.Value);
                advance.Parameters.AddWithValue("id", sourceId);
                await advance.ExecuteNonQueryAsync();
            }

            await transaction.CommitAsync();

            var entry = new IncomeEntryRow(entryId, sourceId, realSourceName, date, amount, notes, createdAt);
            return new IncomeEntryWriteResult(true, entry, newNextPayDate, null);
        }
        catch (Exception ex)
        {
            return new IncomeEntryWriteResult(false, null, null, $"Could not record income entry: {ex.Message}");
        }
    }

    /// <summary>
    /// Real entries, most-recent-first, optionally filtered to one source name (case-insensitive).
    /// Bounded limit, same convention as recent_transactions (default 20, capped at 100).
    /// </summary>
    public async Task<IncomeHistoryResult> GetHistoryAsync(string? connectionString, string? sourceName, int limit)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new IncomeHistoryResult(false, [], "No Postgres connection string configured. Open Settings to add one.");
        }

        var boundedLimit = Math.Clamp(limit <= 0 ? 20 : limit, 1, 100);

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            await using var command = new NpgsqlCommand(
                """
                SELECT e.id, e.source_id, s.name, e.date, e.amount, e.notes, e.created_at
                FROM income_entries e
                JOIN income_sources s ON s.id = e.source_id
                WHERE (@sourceName IS NULL OR lower(s.name) = lower(@sourceName))
                ORDER BY e.date DESC, e.created_at DESC
                LIMIT @limit
                """, connection);
            command.Parameters.Add(new NpgsqlParameter("sourceName", NpgsqlDbType.Text)
            {
                Value = (object?)sourceName ?? DBNull.Value,
            });
            command.Parameters.AddWithValue("limit", boundedLimit);

            var entries = new List<IncomeEntryRow>();
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                entries.Add(new IncomeEntryRow(
                    reader.GetGuid(0),
                    reader.GetGuid(1),
                    reader.GetString(2),
                    DateOnly.FromDateTime(reader.GetDateTime(3)),
                    reader.GetDecimal(4),
                    reader.IsDBNull(5) ? null : reader.GetString(5),
                    reader.GetFieldValue<DateTimeOffset>(6)));
            }

            if (entries.Count == 0 && !string.IsNullOrWhiteSpace(sourceName))
            {
                await using var checkSource = new NpgsqlCommand(
                    "SELECT 1 FROM income_sources WHERE lower(name) = lower(@name)", connection);
                checkSource.Parameters.AddWithValue("name", sourceName);
                if (await checkSource.ExecuteScalarAsync() is null)
                {
                    return new IncomeHistoryResult(false, [], $"No income source named \"{sourceName}\" found.");
                }
            }

            return new IncomeHistoryResult(true, entries, null);
        }
        catch (Exception ex)
        {
            return new IncomeHistoryResult(false, [], $"Could not read income history: {ex.Message}");
        }
    }

    private static IncomeSourceRow ReadSourceRow(NpgsqlDataReader reader) => new(
        reader.GetGuid(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.IsDBNull(3) ? null : reader.GetInt32(3),
        reader.IsDBNull(4) ? null : reader.GetDecimal(4),
        reader.IsDBNull(5) ? null : DateOnly.FromDateTime(reader.GetDateTime(5)),
        reader.GetBoolean(6));
}
