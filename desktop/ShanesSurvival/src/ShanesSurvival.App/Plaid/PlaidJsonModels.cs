using System.Text.Json.Serialization;

namespace ShanesSurvival.App.Plaid;

// Raw wire shapes for Plaid's REST API (https://plaid.com/docs/api/). Field names are
// snake_case on the wire — mapped explicitly with JsonPropertyName rather than relying on a
// naming policy, so the mapping is visible and correct at a glance. Internal: PlaidClient is
// the only thing that should ever see these; everything else in the app talks in the
// PlaidAccountInfo/PlaidTransactionInfo domain types.

internal sealed class LinkTokenCreateRequest
{
    [JsonPropertyName("client_id")] public required string ClientId { get; init; }
    [JsonPropertyName("secret")] public required string Secret { get; init; }
    [JsonPropertyName("client_name")] public required string ClientName { get; init; }
    [JsonPropertyName("language")] public required string Language { get; init; }
    [JsonPropertyName("country_codes")] public required string[] CountryCodes { get; init; }
    [JsonPropertyName("user")] public required LinkTokenUser User { get; init; }
    [JsonPropertyName("products")] public required string[] Products { get; init; }
}

internal sealed class LinkTokenUser
{
    [JsonPropertyName("client_user_id")] public required string ClientUserId { get; init; }
}

internal sealed class LinkTokenCreateResponse
{
    [JsonPropertyName("link_token")] public string LinkToken { get; init; } = "";
}

internal sealed class ExchangeRequest
{
    [JsonPropertyName("client_id")] public required string ClientId { get; init; }
    [JsonPropertyName("secret")] public required string Secret { get; init; }
    [JsonPropertyName("public_token")] public required string PublicToken { get; init; }
}

internal sealed class ExchangeResponse
{
    [JsonPropertyName("access_token")] public string AccessToken { get; init; } = "";
    [JsonPropertyName("item_id")] public string ItemId { get; init; } = "";
}

internal sealed class AccessTokenRequest
{
    [JsonPropertyName("client_id")] public required string ClientId { get; init; }
    [JsonPropertyName("secret")] public required string Secret { get; init; }
    [JsonPropertyName("access_token")] public required string AccessToken { get; init; }
}

internal sealed class AccountsBalanceGetResponse
{
    [JsonPropertyName("accounts")] public List<PlaidAccountJson> Accounts { get; init; } = [];
}

internal sealed class PlaidAccountJson
{
    [JsonPropertyName("account_id")] public string AccountId { get; init; } = "";
    [JsonPropertyName("name")] public string Name { get; init; } = "";
    [JsonPropertyName("type")] public string? Type { get; init; }
    [JsonPropertyName("subtype")] public string? Subtype { get; init; }
    [JsonPropertyName("balances")] public PlaidBalancesJson? Balances { get; init; }
}

internal sealed class PlaidBalancesJson
{
    [JsonPropertyName("current")] public decimal? Current { get; init; }
    [JsonPropertyName("available")] public decimal? Available { get; init; }
}

internal sealed class TransactionsSyncRequest
{
    [JsonPropertyName("client_id")] public required string ClientId { get; init; }
    [JsonPropertyName("secret")] public required string Secret { get; init; }
    [JsonPropertyName("access_token")] public required string AccessToken { get; init; }

    // Omit entirely on the very first sync for an item — Plaid rejects an explicit empty-string
    // cursor on some API versions, so this must be null (not "") until we have a real one.
    [JsonPropertyName("cursor")] public string? Cursor { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; } = 500;
}

internal sealed class TransactionsSyncResponse
{
    [JsonPropertyName("added")] public List<PlaidTransactionJson> Added { get; init; } = [];
    [JsonPropertyName("modified")] public List<PlaidTransactionJson> Modified { get; init; } = [];
    [JsonPropertyName("removed")] public List<PlaidRemovedTransactionJson> Removed { get; init; } = [];
    [JsonPropertyName("next_cursor")] public string NextCursor { get; init; } = "";
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
}

internal sealed class PlaidTransactionJson
{
    [JsonPropertyName("transaction_id")] public string TransactionId { get; init; } = "";
    [JsonPropertyName("account_id")] public string AccountId { get; init; } = "";
    [JsonPropertyName("amount")] public decimal Amount { get; init; }
    [JsonPropertyName("date")] public string Date { get; init; } = "";
    [JsonPropertyName("merchant_name")] public string? MerchantName { get; init; }
    [JsonPropertyName("category")] public List<string>? Category { get; init; }
    [JsonPropertyName("personal_finance_category")] public PlaidPersonalFinanceCategoryJson? PersonalFinanceCategory { get; init; }
    [JsonPropertyName("pending")] public bool Pending { get; init; }
}

internal sealed class PlaidPersonalFinanceCategoryJson
{
    [JsonPropertyName("primary")] public string? Primary { get; init; }
    [JsonPropertyName("detailed")] public string? Detailed { get; init; }
}

internal sealed class PlaidRemovedTransactionJson
{
    [JsonPropertyName("transaction_id")] public string TransactionId { get; init; } = "";
}

internal sealed class PlaidErrorResponse
{
    [JsonPropertyName("error_type")] public string? ErrorType { get; init; }
    [JsonPropertyName("error_code")] public string? ErrorCode { get; init; }
    [JsonPropertyName("error_message")] public string? ErrorMessage { get; init; }
    [JsonPropertyName("display_message")] public string? DisplayMessage { get; init; }
}
