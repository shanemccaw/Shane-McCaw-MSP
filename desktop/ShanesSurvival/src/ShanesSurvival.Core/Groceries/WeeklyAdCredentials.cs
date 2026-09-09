namespace ShanesSurvival.Core.Groceries;

/// <summary>
/// Shane's Life MCP endpoint + bearer token, read from Settings. Never hardcoded, never logged —
/// same rule Plaid's <c>PlaidCredentials</c> follows. Minted with
/// <c>npm run issue-mcp-token -- --email you@example.com --label "ShanesSurvival Weekly Ad"</c>
/// against the real shanes-life deployment (see web/shanes-life/bin/issue-mcp-token.mjs) or from
/// that app's own Settings screen — this app has no way to mint one itself, it only holds and
/// uses one that already exists.
/// </summary>
public sealed record WeeklyAdCredentials(string? ApiBaseUrl, string? McpToken)
{
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiBaseUrl) && !string.IsNullOrWhiteSpace(McpToken);

    /// <summary>The real JSON-RPC endpoint this app POSTs `tools/call` requests to.</summary>
    public string McpEndpoint => $"{ApiBaseUrl!.TrimEnd('/')}/mcp";
}
