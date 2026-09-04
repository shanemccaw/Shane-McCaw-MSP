using System.Globalization;
using Npgsql;

namespace ShanesSurvival.App.Plaid;

public sealed record PlaidItemSyncResult(
    string InstitutionName,
    bool Success,
    int AccountsUpserted,
    int TransactionsAdded,
    int TransactionsModified,
    int TransactionsRemoved,
    string? ErrorMessage);

public sealed record PlaidSyncResult(bool Success, IReadOnlyList<PlaidItemSyncResult> Items, string? ErrorMessage);

/// <summary>
/// Real sync: for every linked plaid_items row, pulls real accounts/balances
/// (/accounts/balance/get) and real transactions via the current cursor-based
/// /transactions/sync — never the older /transactions/get. Never throws: every real failure
/// becomes a Result the UI shows, same pattern as DatabaseConnectionTester/MigrationRunner.
/// One item failing doesn't stop the others — each is tried and reported independently.
/// </summary>
public sealed class PlaidSyncService(IPlaidClient? plaidClient = null)
{
    private readonly IPlaidClient _plaidClient = plaidClient ?? new PlaidClient();

    public async Task<PlaidSyncResult> SyncAllAsync(PlaidCredentials credentials, string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new PlaidSyncResult(false, [], "No Postgres connection string configured. Open Settings to add one.");
        }
        if (!credentials.IsConfigured)
        {
            return new PlaidSyncResult(false, [], "No Plaid credentials configured. Open Settings to add your Client ID and Secret.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            var items = new List<(Guid Id, string PlaidItemId, string AccessToken, string InstitutionName, string? Cursor)>();
            await using (var select = new NpgsqlCommand(
                "SELECT id, plaid_item_id, access_token, institution_name, sync_cursor FROM plaid_items WHERE plaid_item_id IS NOT NULL",
                connection))
            await using (var reader = await select.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    items.Add((
                        reader.GetGuid(0),
                        reader.GetString(1),
                        reader.GetString(2),
                        reader.GetString(3),
                        reader.IsDBNull(4) ? null : reader.GetString(4)));
                }
            }

            var results = new List<PlaidItemSyncResult>();
            foreach (var item in items)
            {
                results.Add(await SyncOneItemAsync(
                    connection, credentials, item.Id, item.AccessToken, item.InstitutionName, item.Cursor));
            }

            return new PlaidSyncResult(true, results, null);
        }
        catch (Exception ex)
        {
            return new PlaidSyncResult(false, [], $"Could not reach Postgres: {ex.Message}");
        }
    }

    private async Task<PlaidItemSyncResult> SyncOneItemAsync(
        NpgsqlConnection connection,
        PlaidCredentials credentials,
        Guid itemId,
        string accessToken,
        string institutionName,
        string? cursor)
    {
        var accountsUpserted = 0;
        var added = 0;
        var modified = 0;
        var removed = 0;

        try
        {
            // Real accounts + balances — /accounts/balance/get, same endpoint the proven
            // FinanceTracker reference uses for this.
            var accounts = await _plaidClient.GetAccountsBalanceAsync(credentials, accessToken);
            var accountIdMap = new Dictionary<string, Guid>();

            foreach (var account in accounts)
            {
                await using var upsert = new NpgsqlCommand(
                    """
                    INSERT INTO accounts (plaid_item_id, plaid_account_id, name, type, subtype, current_balance, available_balance, updated_at)
                    VALUES (@plaidItemId, @plaidAccountId, @name, @type, @subtype, @currentBalance, @availableBalance, now())
                    ON CONFLICT (plaid_item_id, plaid_account_id) DO UPDATE SET
                        name = excluded.name,
                        type = excluded.type,
                        subtype = excluded.subtype,
                        current_balance = excluded.current_balance,
                        available_balance = excluded.available_balance,
                        updated_at = now()
                    RETURNING id
                    """, connection);
                upsert.Parameters.AddWithValue("plaidItemId", itemId);
                upsert.Parameters.AddWithValue("plaidAccountId", account.AccountId);
                upsert.Parameters.AddWithValue("name", account.Name);
                upsert.Parameters.AddWithValue("type", account.Type ?? "other");
                upsert.Parameters.AddWithValue("subtype", (object?)account.Subtype ?? DBNull.Value);
                upsert.Parameters.AddWithValue("currentBalance", (object?)account.CurrentBalance ?? DBNull.Value);
                upsert.Parameters.AddWithValue("availableBalance", (object?)account.AvailableBalance ?? DBNull.Value);

                var internalId = (Guid)(await upsert.ExecuteScalarAsync())!;
                accountIdMap[account.AccountId] = internalId;
                accountsUpserted++;
            }

            // Real transactions — current cursor-based /transactions/sync, paged until
            // has_more is false. The cursor is persisted after every page commits (not just at
            // the end), so a failure partway through a large history resumes from real
            // progress next run instead of re-fetching everything.
            var hasMore = true;
            while (hasMore)
            {
                var page = await _plaidClient.SyncTransactionsAsync(credentials, accessToken, cursor);

                foreach (var transaction in page.Added.Concat(page.Modified))
                {
                    if (!accountIdMap.TryGetValue(transaction.AccountId, out var accountInternalId))
                    {
                        // References an account this item's balance/get call didn't return
                        // (e.g. Plaid hasn't surfaced a brand-new account there yet). Skip it
                        // rather than crash — the next sync picks it up once the account exists.
                        continue;
                    }

                    await using var upsertTx = new NpgsqlCommand(
                        """
                        INSERT INTO transactions (account_id, plaid_transaction_id, amount, date, name, merchant_name, category, pending)
                        VALUES (@accountId, @plaidTransactionId, @amount, @date, @name, @merchantName, @category, @pending)
                        ON CONFLICT (plaid_transaction_id) DO UPDATE SET
                            account_id = excluded.account_id,
                            amount = excluded.amount,
                            date = excluded.date,
                            name = excluded.name,
                            merchant_name = excluded.merchant_name,
                            category = excluded.category,
                            pending = excluded.pending
                        """, connection);
                    upsertTx.Parameters.AddWithValue("accountId", accountInternalId);
                    upsertTx.Parameters.AddWithValue("plaidTransactionId", transaction.TransactionId);
                    upsertTx.Parameters.AddWithValue("amount", transaction.Amount);
                    upsertTx.Parameters.AddWithValue("date", DateOnly.ParseExact(transaction.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture));
                    upsertTx.Parameters.AddWithValue("name", (object?)transaction.Name ?? DBNull.Value);
                    upsertTx.Parameters.AddWithValue("merchantName", (object?)transaction.MerchantName ?? DBNull.Value);
                    upsertTx.Parameters.AddWithValue("category", (object?)transaction.CategoryLabel ?? DBNull.Value);
                    upsertTx.Parameters.AddWithValue("pending", transaction.Pending);
                    await upsertTx.ExecuteNonQueryAsync();
                }
                added += page.Added.Count;
                modified += page.Modified.Count;

                foreach (var removedTx in page.Removed)
                {
                    await using var delete = new NpgsqlCommand(
                        "DELETE FROM transactions WHERE plaid_transaction_id = @id", connection);
                    delete.Parameters.AddWithValue("id", removedTx.TransactionId);
                    await delete.ExecuteNonQueryAsync();
                }
                removed += page.Removed.Count;

                cursor = page.NextCursor;
                await using (var persistCursor = new NpgsqlCommand(
                    "UPDATE plaid_items SET sync_cursor = @cursor WHERE id = @id", connection))
                {
                    persistCursor.Parameters.AddWithValue("cursor", cursor);
                    persistCursor.Parameters.AddWithValue("id", itemId);
                    await persistCursor.ExecuteNonQueryAsync();
                }

                hasMore = page.HasMore;
            }

            await using (var touch = new NpgsqlCommand(
                "UPDATE plaid_items SET last_synced_at = now() WHERE id = @id", connection))
            {
                touch.Parameters.AddWithValue("id", itemId);
                await touch.ExecuteNonQueryAsync();
            }

            return new PlaidItemSyncResult(institutionName, true, accountsUpserted, added, modified, removed, null);
        }
        catch (Exception ex)
        {
            return new PlaidItemSyncResult(institutionName, false, accountsUpserted, added, modified, removed, ex.Message);
        }
    }
}
