using System;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One row exactly as returned by GET/POST /api/msp/vip-classifications
/// (`msp-vip-classifications.ts` / `toWireVipClassification`). No field invented
/// here that the endpoint doesn't already send. "told" always wins over the two
/// discovery routes — see the route's own doc comment for the resolved #1552
/// precedence rule; this client never re-derives that, only displays it.
/// </summary>
public sealed class VipClassification
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    [JsonPropertyName("principalId")]
    public string PrincipalId { get; set; } = string.Empty;

    [JsonPropertyName("principalUpn")]
    public string PrincipalUpn { get; set; } = string.Empty;

    [JsonPropertyName("isVip")]
    public bool IsVip { get; set; }

    /// <summary>"told" | "discovered_group" | "discovered_attribute".</summary>
    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;

    [JsonPropertyName("classifiedByName")]
    public string? ClassifiedByName { get; set; }

    [JsonPropertyName("classifiedAt")]
    public DateTimeOffset ClassifiedAt { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>The response envelope from GET /api/msp/vip-classifications.</summary>
public sealed class VipClassificationsResponse
{
    [JsonPropertyName("classifications")]
    public System.Collections.Generic.List<VipClassification> Classifications { get; set; } = new();
}
