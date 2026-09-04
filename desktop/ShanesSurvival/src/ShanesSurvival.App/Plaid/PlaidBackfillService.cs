using Npgsql;

namespace ShanesSurvival.App.Plaid;

public sealed record PlaidBackfillItemResult(
    string InstitutionName,
    bool Success,
    int TransactionsUpdated,
    string? ErrorMessage);

public sealed record PlaidBackfillResult(bool Success, IReadOnlyList<PlaidBackfillItemResult> Items, string? ErrorMessage);

/// <summary>
/// One-time historical backfill for existing `transactions` rows whose `name` is still NULL
/// (rows synced before #2913 added name/description capture) — Git #2914, follow-up to #2913.
///
/// #2913's forward fix only affects rows /transactions/sync returns from an item's current
/// cursor position onward, so already-synced rows stay NULL until either re-synced or backfilled
/// here. Uses Plaid's older date-ranged /transactions/get (not /transactions/sync) to re-fetch
/// each linked item's history and UPDATE ... WHERE name IS NULL by plaid_transaction_id — never
/// touches sync_cursor or any row that already has a name. Never throws: every real failure
/// becomes a Result the UI shows, same pattern as PlaidSyncService.
/// </summary>
public sealed class PlaidBackfillService(IPlaidClient? plaidClient = null)
{
    private readonly IPlaidClient _plaidClient = plaidClient ?? new PlaidClient();

    public async Task<PlaidBackfillResult> BackfillAllAsync(PlaidCredentials credentials, string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new PlaidBackfillResult(false, [], "No Postgres connection string configured. Open Settings to add one.");
        }
        if (!credentials.IsConfigured)
        {
            return new PlaidBackfillResult(false, [], "No Plaid credentials configured. Open Settings to add your Client ID and Secret.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            var items = new List<(Guid Id, string AccessToken, string InstitutionName)>();
            await using (var select = new NpgsqlCommand(
                "SELECT id, access_token, institution_name FROM plaid_items WHERE plaid_item_id IS NOT NULL",
                connection))
            await using (var reader = await select.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    items.Add((reader.GetGuid(0), reader.GetString(1), reader.GetString(2)));
                }
            }

            var results = new List<PlaidBackfillItemResult>();
            foreach (var item in items)
            {
                results.Add(await BackfillOneItemAsync(connection, credentials, item.Id, item.AccessToken, item.InstitutionName));
            }

            return new PlaidBackfillResult(true, results, null);
        }
        catch (Exception ex)
        {
            return new PlaidBackfillResult(false, [], $"Could not reach Postgres: {ex.Message}");
        }
    }

    private async Task<PlaidBackfillItemResult> BackfillOneItemAsync(
        NpgsqlConnection connection, PlaidCredentials credentials, Guid itemId, string accessToken, string institutionName)
    {
        var updated = 0;

        try
        {
            // Only bother calling Plaid at all if this item actually has rows still missing a
            // name — most syncs after #2913 landed won't. The date range comes from the real
            // NULL rows themselves, not an arbitrary "since the beginning of time" span.
            DateOnly? earliest = null;
            DateOnly? latest = null;
            await using (var range = new NpgsqlCommand(
                """
                SELECT MIN(t.date), MAX(t.date)
                FROM transactions t
                JOIN accounts a ON a.id = t.account_id
                WHERE a.plaid_item_id = @itemId AND t.name IS NULL
                """, connection))
            {
                range.Parameters.AddWithValue("itemId", itemId);
                await using var reader = await range.ExecuteReaderAsync();
                if (await reader.ReadAsync() && !reader.IsDBNull(0))
                {
                    earliest = DateOnly.FromDateTime(reader.GetDateTime(0));
                    latest = DateOnly.FromDateTime(reader.GetDateTime(1));
                }
            }

            if (earliest is null || latest is null)
            {
                // Nothing missing a name for this item — nothing to backfill.
                return new PlaidBackfillItemResult(institutionName, true, 0, null);
            }

            var offset = 0;
            var total = int.MaxValue;
            while (offset < total)
            {
                var page = await _plaidClient.GetTransactionsAsync(
                    credentials, accessToken, earliest.Value, latest.Value, offset, 500);
                total = page.TotalTransactions;

                foreach (var transaction in page.Transactions)
                {
                    if (transaction.Name is null)
                    {
                        continue;
                    }

                    await using var update = new NpgsqlCommand(
                        "UPDATE transactions SET name = @name WHERE plaid_transaction_id = @plaidTransactionId AND name IS NULL",
                        connection);
                    update.Parameters.AddWithValue("name", transaction.Name);
                    update.Parameters.AddWithValue("plaidTransactionId", transaction.TransactionId);
                    updated += await update.ExecuteNonQueryAsync();
                }

                offset += page.Transactions.Count;
                if (page.Transactions.Count == 0)
                {
                    // Defensive: avoid an infinite loop if Plaid ever reports a total higher
                    // than what it actually returns.
                    break;
                }
            }

            return new PlaidBackfillItemResult(institutionName, true, updated, null);
        }
        catch (Exception ex)
        {
            return new PlaidBackfillItemResult(institutionName, false, updated, ex.Message);
        }
    }
}
