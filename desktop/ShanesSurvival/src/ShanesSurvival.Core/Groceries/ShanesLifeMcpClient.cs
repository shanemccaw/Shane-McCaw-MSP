using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ShanesSurvival.Core.Groceries;

/// <summary>Thrown when a real MCP call fails — bad token, unreachable host, or the tool itself
/// reporting a real error (isError:true). Message is always safe to show directly.</summary>
public sealed class ShanesLifeMcpException(string message) : Exception(message);

/// <summary>
/// A minimal, real client for shanes-life's own remote MCP server (web/shanes-life/src/routes/mcp.mjs
/// — `POST /mcp` with `Authorization: Bearer slmcp_...`, JSON-RPC 2.0, `tools/call`). This is the
/// SAME real pipeline `push_deals`/`push_coupons`/`fetch_weekly_ad` already serve Claude
/// conversations through (Git #3110) — this app is just another real MCP client speaking the same
/// protocol, not a second, parallel storage path or a REST reimplementation of what those tools
/// already do.
/// </summary>
public sealed class ShanesLifeMcpClient
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private int _nextId = 1;

    public async Task<JsonElement> CallToolAsync(WeeklyAdCredentials credentials, string toolName, object arguments)
    {
        if (!credentials.IsConfigured)
        {
            throw new ShanesLifeMcpException(
                "No Shane's Life API URL / MCP token configured. Open Settings to add them.");
        }

        var request = new HttpRequestMessage(HttpMethod.Post, credentials.McpEndpoint)
        {
            Content = JsonContent.Create(new
            {
                jsonrpc = "2.0",
                id = Interlocked.Increment(ref _nextId),
                method = "tools/call",
                @params = new { name = toolName, arguments },
            }),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credentials.McpToken);

        HttpResponseMessage response;
        try
        {
            response = await Http.SendAsync(request);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new ShanesLifeMcpException(
                $"Could not reach Shane's Life at {credentials.ApiBaseUrl}: {ex.Message}");
        }

        var bodyText = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            // 401 from the MCP endpoint carries a real, readable JSON-RPC error body (see mcp.mjs)
            // — surface it directly rather than a bare status code.
            var reason = TryExtractRpcErrorMessage(bodyText) ?? response.ReasonPhrase ?? "request failed";
            throw new ShanesLifeMcpException($"Shane's Life MCP call failed ({(int)response.StatusCode}): {reason}");
        }

        using var doc = JsonDocument.Parse(bodyText);
        var root = doc.RootElement;

        if (root.TryGetProperty("error", out var rpcError))
        {
            var message = rpcError.TryGetProperty("message", out var m) ? m.GetString() : "unknown RPC error";
            throw new ShanesLifeMcpException($"{toolName} failed: {message}");
        }

        if (!root.TryGetProperty("result", out var result))
        {
            throw new ShanesLifeMcpException($"{toolName}: malformed MCP response (no result).");
        }

        var isError = result.TryGetProperty("isError", out var errFlag) && errFlag.ValueKind == JsonValueKind.True;
        if (isError)
        {
            var text = result.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array
                && content.GetArrayLength() > 0 && content[0].TryGetProperty("text", out var t)
                ? t.GetString()
                : $"{toolName} reported an error.";
            throw new ShanesLifeMcpException(text ?? $"{toolName} reported an error.");
        }

        // structuredContent carries the tool's real return value verbatim (see mcp/protocol.mjs) —
        // clone it since it belongs to `doc`, which is disposed when this method returns.
        return result.TryGetProperty("structuredContent", out var structured)
            ? structured.Clone()
            : default;
    }

    /// <summary>Push real per-store prices read off a weekly ad — same shape as the `push_deals`
    /// MCP tool's own arguments (Git #3110).</summary>
    public async Task<int> PushDealsAsync(WeeklyAdCredentials credentials, string store, IReadOnlyList<ScrapedDealItem> items)
    {
        if (items.Count == 0) return 0;
        var result = await CallToolAsync(credentials, "push_deals", new
        {
            store,
            items = items.Select(i => new
            {
                item = i.ItemText,
                priceCents = i.PriceCents,
                unit = i.Unit,
                validOn = i.ValidOn,
            }),
        });
        return result.ValueKind == JsonValueKind.Object && result.TryGetProperty("pushed", out var pushed)
            ? pushed.GetInt32()
            : items.Count;
    }

    /// <summary>Push real coupons/multi-buy deals — same shape as `push_coupons` (Git #3110).</summary>
    public async Task<int> PushCouponsAsync(WeeklyAdCredentials credentials, string store, IReadOnlyList<ScrapedCouponItem> items)
    {
        if (items.Count == 0) return 0;
        var result = await CallToolAsync(credentials, "push_coupons", new
        {
            store,
            items = items.Select(i => new
            {
                item = i.ItemText,
                description = i.Description,
                multiBuyCount = i.MultiBuyCount,
                multiBuyPriceCents = i.MultiBuyPriceCents,
                discountCents = i.DiscountCents,
            }),
        });
        return result.ValueKind == JsonValueKind.Object && result.TryGetProperty("pushed", out var pushed)
            ? pushed.GetInt32()
            : items.Count;
    }

    private static string? TryExtractRpcErrorMessage(string bodyText)
    {
        try
        {
            var node = JsonNode.Parse(bodyText);
            return node?["error"]?["message"]?.GetValue<string>();
        }
        catch
        {
            return null;
        }
    }
}
