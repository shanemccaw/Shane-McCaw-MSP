using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShanesSurvival.App.Plaid;

/// <summary>
/// Real Plaid REST client — Link token creation, public_token exchange, account balances, the
/// current cursor-based /transactions/sync endpoint, and the older date-ranged
/// /transactions/get endpoint (used only by PlaidBackfillService for a one-time historical
/// re-fetch — ongoing sync always stays on /transactions/sync).
/// Every method throws <see cref="PlaidApiException"/> on any real failure (Plaid error
/// response, unreachable network, malformed response) with a message safe to show directly;
/// callers (PlaidLinkService/PlaidSyncService) are the boundary that catches it and turns it
/// into a Result the UI displays without crashing — same shape as DatabaseConnectionTester.
/// </summary>
public sealed class PlaidClient : IPlaidClient
{
    // Shared across calls: a fresh HttpClient per request risks socket exhaustion under load,
    // and this app makes many small sequential Plaid calls during a sync.
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<string> CreateLinkTokenAsync(PlaidCredentials credentials, string clientUserId)
    {
        var request = new LinkTokenCreateRequest
        {
            ClientId = credentials.ClientId!,
            Secret = credentials.Secret!,
            ClientName = "Shane's Survival",
            Language = "en",
            CountryCodes = ["US"],
            User = new LinkTokenUser { ClientUserId = clientUserId },
            Products = ["transactions"],
        };
        var response = await PostAsync<LinkTokenCreateRequest, LinkTokenCreateResponse>(
            credentials, "/link/token/create", request);
        return response.LinkToken;
    }

    public async Task<(string AccessToken, string ItemId)> ExchangePublicTokenAsync(PlaidCredentials credentials, string publicToken)
    {
        var request = new ExchangeRequest
        {
            ClientId = credentials.ClientId!,
            Secret = credentials.Secret!,
            PublicToken = publicToken,
        };
        var response = await PostAsync<ExchangeRequest, ExchangeResponse>(
            credentials, "/item/public_token/exchange", request);
        return (response.AccessToken, response.ItemId);
    }

    public async Task<IReadOnlyList<PlaidAccountInfo>> GetAccountsBalanceAsync(PlaidCredentials credentials, string accessToken)
    {
        var request = new AccessTokenRequest
        {
            ClientId = credentials.ClientId!,
            Secret = credentials.Secret!,
            AccessToken = accessToken,
        };
        var response = await PostAsync<AccessTokenRequest, AccountsBalanceGetResponse>(
            credentials, "/accounts/balance/get", request);

        return response.Accounts
            .Select(a => new PlaidAccountInfo(a.AccountId, a.Name, a.Type, a.Subtype, a.Balances?.Current, a.Balances?.Available))
            .ToList();
    }

    public async Task<PlaidSyncPage> SyncTransactionsAsync(PlaidCredentials credentials, string accessToken, string? cursor)
    {
        var request = new TransactionsSyncRequest
        {
            ClientId = credentials.ClientId!,
            Secret = credentials.Secret!,
            AccessToken = accessToken,
            Cursor = string.IsNullOrEmpty(cursor) ? null : cursor,
            Count = 500,
        };
        var response = await PostAsync<TransactionsSyncRequest, TransactionsSyncResponse>(
            credentials, "/transactions/sync", request);

        return new PlaidSyncPage(
            response.Added.Select(ToInfo).ToList(),
            response.Modified.Select(ToInfo).ToList(),
            response.Removed.Select(r => new PlaidRemovedTransactionInfo(r.TransactionId)).ToList(),
            response.NextCursor,
            response.HasMore);
    }

    public async Task<PlaidGetTransactionsPage> GetTransactionsAsync(
        PlaidCredentials credentials, string accessToken, DateOnly startDate, DateOnly endDate, int offset, int count)
    {
        var request = new TransactionsGetRequest
        {
            ClientId = credentials.ClientId!,
            Secret = credentials.Secret!,
            AccessToken = accessToken,
            StartDate = startDate.ToString("yyyy-MM-dd"),
            EndDate = endDate.ToString("yyyy-MM-dd"),
            Options = new TransactionsGetOptions { Count = count, Offset = offset },
        };
        var response = await PostAsync<TransactionsGetRequest, TransactionsGetResponse>(
            credentials, "/transactions/get", request);

        return new PlaidGetTransactionsPage(response.Transactions.Select(ToInfo).ToList(), response.TotalTransactions);
    }

    private static PlaidTransactionInfo ToInfo(PlaidTransactionJson t) => new(
        t.TransactionId,
        t.AccountId,
        t.Amount,
        t.Date,
        t.Name,
        t.MerchantName,
        t.PersonalFinanceCategory?.Detailed
            ?? t.PersonalFinanceCategory?.Primary
            ?? (t.Category is { Count: > 0 } category ? string.Join(", ", category) : null),
        t.Pending);

    private async Task<TResponse> PostAsync<TRequest, TResponse>(PlaidCredentials credentials, string path, TRequest body)
    {
        string raw;
        System.Net.HttpStatusCode statusCode;
        try
        {
            using var httpResponse = await Http.PostAsJsonAsync(credentials.BaseUrl + path, body, JsonOptions);
            statusCode = httpResponse.StatusCode;
            raw = await httpResponse.Content.ReadAsStringAsync();

            if (!httpResponse.IsSuccessStatusCode)
            {
                var error = SafeDeserialize<PlaidErrorResponse>(raw);
                var message = error?.ErrorMessage ?? error?.DisplayMessage
                    ?? $"Plaid returned HTTP {(int)statusCode} with no error detail.";
                throw new PlaidApiException(message);
            }
        }
        catch (PlaidApiException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Covers DNS failure, TLS failure, timeout, connection refused, etc.
            throw new PlaidApiException($"Could not reach Plaid: {ex.Message}");
        }

        try
        {
            return JsonSerializer.Deserialize<TResponse>(raw, JsonOptions)
                ?? throw new PlaidApiException("Plaid returned an empty response.");
        }
        catch (JsonException ex)
        {
            throw new PlaidApiException($"Could not parse Plaid's response: {ex.Message}");
        }
    }

    private static T? SafeDeserialize<T>(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<T>(json, JsonOptions);
        }
        catch (JsonException)
        {
            return default;
        }
    }
}
