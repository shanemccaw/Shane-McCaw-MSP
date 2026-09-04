namespace ShanesSurvival.App.Plaid;

/// <summary>Real account + balance data as returned by Plaid's /accounts/balance/get.</summary>
public sealed record PlaidAccountInfo(
    string AccountId,
    string Name,
    string? Type,
    string? Subtype,
    decimal? CurrentBalance,
    decimal? AvailableBalance);

/// <summary>Real transaction data as returned by Plaid's /transactions/sync (added or modified).</summary>
public sealed record PlaidTransactionInfo(
    string TransactionId,
    string AccountId,
    decimal Amount,
    string Date,
    string? Name,
    string? MerchantName,
    string? CategoryLabel,
    bool Pending);

/// <summary>A transaction Plaid reports as removed in a /transactions/sync page.</summary>
public sealed record PlaidRemovedTransactionInfo(string TransactionId);

/// <summary>One page of a /transactions/sync response.</summary>
public sealed record PlaidSyncPage(
    IReadOnlyList<PlaidTransactionInfo> Added,
    IReadOnlyList<PlaidTransactionInfo> Modified,
    IReadOnlyList<PlaidRemovedTransactionInfo> Removed,
    string NextCursor,
    bool HasMore);

/// <summary>
/// Thrown by <see cref="IPlaidClient"/> implementations for any real failure — a Plaid error
/// response, an unreachable network, a malformed response. Message is safe to show directly:
/// it never includes the client secret or an access token.
/// </summary>
public sealed class PlaidApiException(string message) : Exception(message);

/// <summary>
/// Real Plaid REST calls this app needs. Interface exists so PlaidLinkService/PlaidSyncService's
/// real database-writing logic can be verified against a real Postgres database using a fake
/// implementation of just this boundary, without needing live Plaid credentials to do it.
/// </summary>
public interface IPlaidClient
{
    Task<string> CreateLinkTokenAsync(PlaidCredentials credentials, string clientUserId);

    Task<(string AccessToken, string ItemId)> ExchangePublicTokenAsync(PlaidCredentials credentials, string publicToken);

    Task<IReadOnlyList<PlaidAccountInfo>> GetAccountsBalanceAsync(PlaidCredentials credentials, string accessToken);

    Task<PlaidSyncPage> SyncTransactionsAsync(PlaidCredentials credentials, string accessToken, string? cursor);
}
