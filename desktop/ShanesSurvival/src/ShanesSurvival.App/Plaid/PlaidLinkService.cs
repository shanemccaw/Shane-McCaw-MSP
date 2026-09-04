using Npgsql;

namespace ShanesSurvival.App.Plaid;

public sealed record PlaidLinkTokenResult(bool Success, string? LinkToken, string? ErrorMessage);

public sealed record PlaidExchangeResult(bool Success, string? InstitutionName, string? ErrorMessage);

/// <summary>
/// The two real, non-UI steps of Plaid Link: creating a real Link token to hand to the hosted
/// Link flow, and — once Link succeeds — exchanging the real public_token it returns for a real
/// access_token and storing it in plaid_items. Never throws: every real failure (Plaid API,
/// Postgres) becomes a Result the UI shows, same pattern as DatabaseConnectionTester/MigrationRunner.
/// </summary>
public sealed class PlaidLinkService(IPlaidClient? plaidClient = null)
{
    private readonly IPlaidClient _plaidClient = plaidClient ?? new PlaidClient();

    public async Task<PlaidLinkTokenResult> CreateLinkTokenAsync(PlaidCredentials credentials, string clientUserId)
    {
        if (!credentials.IsConfigured)
        {
            return new PlaidLinkTokenResult(false, null,
                "No Plaid credentials configured. Open Settings to add your Client ID and Secret.");
        }

        try
        {
            var linkToken = await _plaidClient.CreateLinkTokenAsync(credentials, clientUserId);
            return new PlaidLinkTokenResult(true, linkToken, null);
        }
        catch (Exception ex)
        {
            // PlaidApiException from the client covers real Plaid/network failures; catching
            // Exception broadly too since this is called from an async void UI handler.
            return new PlaidLinkTokenResult(false, null, ex.Message);
        }
    }

    /// <summary>
    /// Exchanges a real public_token for a real access_token and upserts it into plaid_items,
    /// keyed on Plaid's own item_id — so re-linking the same institution (or an update-mode
    /// reconnect) updates the existing row instead of creating a duplicate.
    /// </summary>
    public async Task<PlaidExchangeResult> ExchangeAndStoreAsync(
        PlaidCredentials credentials, string? connectionString, string publicToken, string institutionName)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new PlaidExchangeResult(false, null, "No Postgres connection string configured. Open Settings to add one.");
        }

        try
        {
            var (accessToken, itemId) = await _plaidClient.ExchangePublicTokenAsync(credentials, publicToken);

            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            await using var upsert = new NpgsqlCommand(
                """
                INSERT INTO plaid_items (plaid_item_id, access_token, institution_name)
                VALUES (@plaidItemId, @accessToken, @institutionName)
                ON CONFLICT (plaid_item_id) DO UPDATE SET
                    access_token = excluded.access_token,
                    institution_name = excluded.institution_name
                """, connection);
            upsert.Parameters.AddWithValue("plaidItemId", itemId);
            upsert.Parameters.AddWithValue("accessToken", accessToken);
            upsert.Parameters.AddWithValue("institutionName", institutionName);
            await upsert.ExecuteNonQueryAsync();

            return new PlaidExchangeResult(true, institutionName, null);
        }
        catch (Exception ex)
        {
            return new PlaidExchangeResult(false, null, ex.Message);
        }
    }
}
