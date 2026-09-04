namespace ShanesSurvival.App.Plaid;

/// <summary>
/// Plaid API credentials + environment, read from Settings. Never hardcoded, never logged —
/// same rule as the Postgres connection string.
/// </summary>
public sealed record PlaidCredentials(string? ClientId, string? Secret, string? Environment)
{
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(Secret);

    /// <summary>
    /// Plaid retired "development" as a separate base URL in 2023 — development-enabled
    /// credentials now call production.plaid.com directly, so only sandbox gets its own host.
    /// </summary>
    public string BaseUrl => string.Equals(Environment, "sandbox", StringComparison.OrdinalIgnoreCase)
        ? "https://sandbox.plaid.com"
        : "https://production.plaid.com";
}
