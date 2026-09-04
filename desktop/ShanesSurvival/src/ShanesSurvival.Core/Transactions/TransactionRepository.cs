using Npgsql;

namespace ShanesSurvival.Core.Transactions;

/// <summary>Real row from transactions, scoped to one account.</summary>
public sealed record TransactionRow(
    Guid Id,
    DateOnly Date,
    string? MerchantName,
    string? Category,
    decimal Amount,
    bool Pending);

public sealed record TransactionListResult(bool Success, IReadOnlyList<TransactionRow> Transactions, string? ErrorMessage);

/// <summary>
/// Real read-only access to transactions for one account, most-recent-first. Never throws:
/// every real failure becomes a Result, same pattern as AccountRepository/DashboardService.
/// </summary>
public sealed class TransactionRepository
{
    public async Task<TransactionListResult> ListRecentAsync(string? connectionString, Guid accountId, int limit)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new TransactionListResult(false, [], "No Postgres connection string configured. Open Settings to add one.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            var transactions = new List<TransactionRow>();
            await using var command = new NpgsqlCommand(
                """
                SELECT id, date, merchant_name, category, amount, pending
                FROM transactions
                WHERE account_id = @accountId
                ORDER BY date DESC, id DESC
                LIMIT @limit
                """, connection);
            command.Parameters.AddWithValue("accountId", accountId);
            command.Parameters.AddWithValue("limit", limit);
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                transactions.Add(new TransactionRow(
                    reader.GetGuid(0),
                    DateOnly.FromDateTime(reader.GetDateTime(1)),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.GetDecimal(4),
                    reader.GetBoolean(5)));
            }

            return new TransactionListResult(true, transactions, null);
        }
        catch (Exception ex)
        {
            return new TransactionListResult(false, [], $"Could not read transactions: {ex.Message}");
        }
    }
}
