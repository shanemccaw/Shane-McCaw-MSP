using Npgsql;

namespace ShanesSurvival.App.Accounts;

/// <summary>Real row from accounts, joined with its owning plaid_items.institution_name.</summary>
public sealed record AccountRow(
    Guid Id,
    string Name,
    string? InstitutionName,
    string Type,
    string? Subtype,
    decimal? CurrentBalance,
    decimal? AvailableBalance,
    AccountRole Role,
    decimal? TargetAmount,
    bool IsGate);

public sealed record AccountListResult(bool Success, IReadOnlyList<AccountRow> Accounts, string? ErrorMessage);
public sealed record AccountUpdateResult(bool Success, string? ErrorMessage);

/// <summary>
/// Real read/write access to accounts' role/target_amount/is_gate columns
/// (migrations/003_account_roles.sql). Never throws: every real failure becomes a Result the
/// UI shows, same pattern as DatabaseConnectionTester/MigrationRunner/PlaidSyncService.
/// </summary>
public sealed class AccountRepository
{
    public async Task<AccountListResult> ListAsync(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new AccountListResult(false, [], "No Postgres connection string configured. Open Settings to add one.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            var accounts = new List<AccountRow>();
            await using var command = new NpgsqlCommand(
                """
                SELECT a.id, a.name, p.institution_name, a.type, a.subtype,
                       a.current_balance, a.available_balance, a.role, a.target_amount, a.is_gate
                FROM accounts a
                JOIN plaid_items p ON p.id = a.plaid_item_id
                ORDER BY p.institution_name, a.name
                """, connection);
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                accounts.Add(new AccountRow(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.GetString(3),
                    reader.IsDBNull(4) ? null : reader.GetString(4),
                    reader.IsDBNull(5) ? null : reader.GetDecimal(5),
                    reader.IsDBNull(6) ? null : reader.GetDecimal(6),
                    AccountRoleExtensions.ParseDbValue(reader.IsDBNull(7) ? null : reader.GetString(7)),
                    reader.IsDBNull(8) ? null : reader.GetDecimal(8),
                    reader.GetBoolean(9)));
            }

            return new AccountListResult(true, accounts, null);
        }
        catch (Exception ex)
        {
            return new AccountListResult(false, [], $"Could not read accounts: {ex.Message}");
        }
    }

    /// <summary>
    /// Persists one account's role/target_amount/is_gate in a single UPDATE. target_amount is
    /// only meaningful for role = Bill; callers that pass a non-Bill role should pass a null
    /// target and isGate: false, but this method itself doesn't reject an inconsistent
    /// combination — it just writes what it's given, same as any other column update.
    /// </summary>
    public async Task<AccountUpdateResult> UpdateRoleAsync(
        string? connectionString, Guid accountId, AccountRole role, decimal? targetAmount, bool isGate)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new AccountUpdateResult(false, "No Postgres connection string configured. Open Settings to add one.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            await using var command = new NpgsqlCommand(
                "UPDATE accounts SET role = @role, target_amount = @targetAmount, is_gate = @isGate WHERE id = @id",
                connection);
            command.Parameters.AddWithValue("role", (object?)role.ToDbValue() ?? DBNull.Value);
            command.Parameters.AddWithValue("targetAmount", (object?)targetAmount ?? DBNull.Value);
            command.Parameters.AddWithValue("isGate", isGate);
            command.Parameters.AddWithValue("id", accountId);

            var rows = await command.ExecuteNonQueryAsync();
            return rows > 0
                ? new AccountUpdateResult(true, null)
                : new AccountUpdateResult(false, "Account not found — it may have been removed by a Plaid sync.");
        }
        catch (Exception ex)
        {
            return new AccountUpdateResult(false, $"Could not save account role: {ex.Message}");
        }
    }
}
