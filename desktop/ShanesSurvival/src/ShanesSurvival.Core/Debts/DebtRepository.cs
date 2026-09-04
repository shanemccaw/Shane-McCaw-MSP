using Npgsql;

namespace ShanesSurvival.Core.Debts;

/// <summary>Real row from debts — manually entered by Shane, never sourced from Plaid.</summary>
public sealed record DebtRow(
    Guid Id,
    string CreditorName,
    decimal Balance,
    decimal? MinimumPayment,
    bool IsDelinquent,
    int DaysPastDue,
    string? Notes,
    DateTimeOffset UpdatedAt,
    bool IsCritical);

public sealed record DebtListResult(bool Success, IReadOnlyList<DebtRow> Debts, string? ErrorMessage);
public sealed record DebtUpsertResult(bool Success, DebtRow? Debt, bool WasCreated, string? ErrorMessage);

/// <summary>
/// Real read/write access to the debts table (migrations/001_init.sql). Never throws: every
/// real failure becomes a Result the caller (MCP tool / future UI) can show, same pattern as
/// AccountRepository/TransactionRepository. Upsert matches by creditor_name
/// (case-insensitive) — same account-matching convention already used by
/// set_bill_target/recent_transactions in FinanceTools.
/// </summary>
public sealed class DebtRepository
{
    public async Task<DebtListResult> ListAsync(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new DebtListResult(false, [], "No Postgres connection string configured. Open Settings to add one.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            var debts = new List<DebtRow>();
            await using var command = new NpgsqlCommand(
                """
                SELECT id, creditor_name, balance, minimum_payment, is_delinquent, days_past_due, notes, updated_at, is_critical
                FROM debts
                ORDER BY is_critical DESC, days_past_due DESC, creditor_name
                """, connection);
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                debts.Add(Map(reader));
            }

            return new DebtListResult(true, debts, null);
        }
        catch (Exception ex)
        {
            return new DebtListResult(false, [], $"Could not read debts: {ex.Message}");
        }
    }

    /// <summary>
    /// Upserts one debt by creditor_name (case-insensitive match). If a debt for that
    /// creditor already exists, updates its balance/minimum_payment/is_delinquent/
    /// days_past_due/notes and updated_at; otherwise creates a new row. A null optional
    /// parameter on an update leaves that column unchanged rather than clearing it, so a
    /// caller can e.g. update just the balance without having to re-state notes every time.
    /// </summary>
    public async Task<DebtUpsertResult> UpsertAsync(
        string? connectionString,
        string creditorName,
        decimal balance,
        decimal? minimumPayment,
        bool? isDelinquent,
        int? daysPastDue,
        string? notes,
        bool? isCritical = null)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new DebtUpsertResult(false, null, false, "No Postgres connection string configured. Open Settings to add one.");
        }

        if (string.IsNullOrWhiteSpace(creditorName))
        {
            return new DebtUpsertResult(false, null, false, "Creditor name is required.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            await using var existingCommand = new NpgsqlCommand(
                "SELECT id FROM debts WHERE lower(creditor_name) = lower(@creditorName)", connection);
            existingCommand.Parameters.AddWithValue("creditorName", creditorName);
            var existingId = (Guid?)await existingCommand.ExecuteScalarAsync();

            Guid id;
            bool wasCreated;

            if (existingId is null)
            {
                id = Guid.NewGuid();
                wasCreated = true;

                await using var insertCommand = new NpgsqlCommand(
                    """
                    INSERT INTO debts (id, creditor_name, balance, minimum_payment, is_delinquent, days_past_due, notes, updated_at, is_critical)
                    VALUES (@id, @creditorName, @balance, @minimumPayment, @isDelinquent, @daysPastDue, @notes, now(), @isCritical)
                    """, connection);
                insertCommand.Parameters.AddWithValue("id", id);
                insertCommand.Parameters.AddWithValue("creditorName", creditorName);
                insertCommand.Parameters.AddWithValue("balance", balance);
                insertCommand.Parameters.AddWithValue("minimumPayment", (object?)minimumPayment ?? DBNull.Value);
                insertCommand.Parameters.AddWithValue("isDelinquent", isDelinquent ?? false);
                insertCommand.Parameters.AddWithValue("daysPastDue", daysPastDue ?? 0);
                insertCommand.Parameters.AddWithValue("notes", (object?)notes ?? DBNull.Value);
                insertCommand.Parameters.AddWithValue("isCritical", isCritical ?? false);
                await insertCommand.ExecuteNonQueryAsync();
            }
            else
            {
                id = existingId.Value;
                wasCreated = false;

                await using var updateCommand = new NpgsqlCommand(
                    """
                    UPDATE debts
                    SET balance = @balance,
                        minimum_payment = COALESCE(@minimumPayment, minimum_payment),
                        is_delinquent = COALESCE(@isDelinquent, is_delinquent),
                        days_past_due = COALESCE(@daysPastDue, days_past_due),
                        notes = COALESCE(@notes, notes),
                        is_critical = COALESCE(@isCritical, is_critical),
                        updated_at = now()
                    WHERE id = @id
                    """, connection);
                updateCommand.Parameters.AddWithValue("id", id);
                updateCommand.Parameters.AddWithValue("balance", balance);
                updateCommand.Parameters.AddWithValue("minimumPayment", (object?)minimumPayment ?? DBNull.Value);
                updateCommand.Parameters.AddWithValue("isDelinquent", (object?)isDelinquent ?? DBNull.Value);
                updateCommand.Parameters.AddWithValue("daysPastDue", (object?)daysPastDue ?? DBNull.Value);
                updateCommand.Parameters.AddWithValue("notes", (object?)notes ?? DBNull.Value);
                updateCommand.Parameters.AddWithValue("isCritical", (object?)isCritical ?? DBNull.Value);
                await updateCommand.ExecuteNonQueryAsync();
            }

            await using var readBackCommand = new NpgsqlCommand(
                """
                SELECT id, creditor_name, balance, minimum_payment, is_delinquent, days_past_due, notes, updated_at, is_critical
                FROM debts WHERE id = @id
                """, connection);
            readBackCommand.Parameters.AddWithValue("id", id);
            await using var reader = await readBackCommand.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
            {
                return new DebtUpsertResult(false, null, wasCreated, "Debt was written but could not be read back.");
            }

            return new DebtUpsertResult(true, Map(reader), wasCreated, null);
        }
        catch (Exception ex)
        {
            return new DebtUpsertResult(false, null, false, $"Could not save debt for \"{creditorName}\": {ex.Message}");
        }
    }

    private static DebtRow Map(NpgsqlDataReader reader) => new(
        reader.GetGuid(0),
        reader.GetString(1),
        reader.GetDecimal(2),
        reader.IsDBNull(3) ? null : reader.GetDecimal(3),
        reader.GetBoolean(4),
        reader.GetInt32(5),
        reader.IsDBNull(6) ? null : reader.GetString(6),
        reader.GetFieldValue<DateTimeOffset>(7),
        reader.GetBoolean(8));
}
