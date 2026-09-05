using Npgsql;

namespace ShanesSurvival.Core.Transactions;

/// <summary>
/// One real transaction tagging rule (migrations/012_transaction_tags.sql, #2931) — a real
/// merchant substring match plus an optional real amount range, mapped to a real human meaning.
/// MinAmount/MaxAmount null means unbounded on that side.
/// </summary>
public sealed record TransactionTagRule(
    Guid Id, string MerchantPattern, decimal? MinAmount, decimal? MaxAmount, string Tag, DateTime CreatedAt)
{
    /// <summary>
    /// Real match test: merchant/name case-insensitive substring match against
    /// <see cref="MerchantPattern"/>, and amount within [MinAmount, MaxAmount] (each side
    /// unbounded when null). Matches <paramref name="merchantName"/> OR <paramref name="name"/>
    /// so it works for transactions where Plaid's merchant_name is null (see #2913) but the raw
    /// name still carries the real merchant text (e.g. an ATM withdrawal description).
    /// </summary>
    public bool Matches(string? merchantName, string? name, decimal amount)
    {
        var merchantMatch = !string.IsNullOrEmpty(merchantName) &&
                             merchantName.Contains(MerchantPattern, StringComparison.OrdinalIgnoreCase);
        var nameMatch = !string.IsNullOrEmpty(name) &&
                        name.Contains(MerchantPattern, StringComparison.OrdinalIgnoreCase);
        if (!merchantMatch && !nameMatch)
        {
            return false;
        }

        if (MinAmount.HasValue && amount < MinAmount.Value)
        {
            return false;
        }

        if (MaxAmount.HasValue && amount > MaxAmount.Value)
        {
            return false;
        }

        return true;
    }
}

public sealed record TransactionTagListResult(bool Success, IReadOnlyList<TransactionTagRule> Rules, string? ErrorMessage);
public sealed record TransactionTagCreateResult(bool Success, TransactionTagRule? Rule, string? ErrorMessage);

/// <summary>
/// Real read/write access to transaction_tags. Never throws: every real failure becomes a
/// Result, same pattern as AccountRepository/TransactionRepository/DashboardService.
/// </summary>
public sealed class TransactionTagRepository
{
    public async Task<TransactionTagListResult> ListAsync(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new TransactionTagListResult(false, [], "No Postgres connection string configured. Open Settings to add one.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            var rules = new List<TransactionTagRule>();
            await using var command = new NpgsqlCommand(
                """
                SELECT id, merchant_pattern, min_amount, max_amount, tag, created_at
                FROM transaction_tags
                ORDER BY created_at
                """, connection);
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                rules.Add(new TransactionTagRule(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetDecimal(2),
                    reader.IsDBNull(3) ? null : reader.GetDecimal(3),
                    reader.GetString(4),
                    reader.GetDateTime(5)));
            }

            return new TransactionTagListResult(true, rules, null);
        }
        catch (Exception ex)
        {
            return new TransactionTagListResult(false, [], $"Could not read transaction tags: {ex.Message}");
        }
    }

    public async Task<TransactionTagCreateResult> CreateAsync(
        string? connectionString, string merchantPattern, string tag, decimal? minAmount, decimal? maxAmount)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new TransactionTagCreateResult(false, null, "No Postgres connection string configured. Open Settings to add one.");
        }

        if (string.IsNullOrWhiteSpace(merchantPattern))
        {
            return new TransactionTagCreateResult(false, null, "merchantPattern cannot be empty.");
        }

        if (string.IsNullOrWhiteSpace(tag))
        {
            return new TransactionTagCreateResult(false, null, "tag cannot be empty.");
        }

        if (minAmount.HasValue && maxAmount.HasValue && minAmount.Value > maxAmount.Value)
        {
            return new TransactionTagCreateResult(false, null,
                $"minAmount ({minAmount}) cannot be greater than maxAmount ({maxAmount}).");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            await using var command = new NpgsqlCommand(
                """
                INSERT INTO transaction_tags (merchant_pattern, min_amount, max_amount, tag)
                VALUES (@merchantPattern, @minAmount, @maxAmount, @tag)
                RETURNING id, merchant_pattern, min_amount, max_amount, tag, created_at
                """, connection);
            command.Parameters.AddWithValue("merchantPattern", merchantPattern);
            command.Parameters.AddWithValue("minAmount", (object?)minAmount ?? DBNull.Value);
            command.Parameters.AddWithValue("maxAmount", (object?)maxAmount ?? DBNull.Value);
            command.Parameters.AddWithValue("tag", tag);

            await using var reader = await command.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
            {
                return new TransactionTagCreateResult(false, null, "Insert did not return the new row.");
            }

            var rule = new TransactionTagRule(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetDecimal(2),
                reader.IsDBNull(3) ? null : reader.GetDecimal(3),
                reader.GetString(4),
                reader.GetDateTime(5));

            return new TransactionTagCreateResult(true, rule, null);
        }
        catch (Exception ex)
        {
            return new TransactionTagCreateResult(false, null, $"Could not create transaction tag rule: {ex.Message}");
        }
    }
}
