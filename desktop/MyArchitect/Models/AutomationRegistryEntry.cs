using System;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// Wire shape for the automation_registry entries served by
/// artifacts/api-server/src/routes/admin-automation-registry.ts (Git #3771) — mirrors
/// that route's own <c>entryToWire</c> exactly, nothing invented. A persistent,
/// browsable list of the Microsoft-ecosystem automations Shane builds for a
/// customer — Power Automate flows and Power Platform/Azure AI Studio agents,
/// same shape, distinguished by <see cref="Type"/>.
/// </summary>
public sealed class AutomationRegistryEntry
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    /// <summary>"power_automate_flow" | "ai_studio_agent" (AUTOMATION_REGISTRY_TYPES). Kept as a
    /// free string client-side rather than a C# enum, per this app's convention for
    /// server-driven small-choice text — see <see cref="MyArchitect.Models.RetainerWorkLogEntry.StateStored"/>
    /// for the same rationale.</summary>
    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>"active" | "inactive" | "in_development" (AUTOMATION_REGISTRY_STATUSES).</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>Response body of POST/PATCH /api/admin/automation-registry/... — a single entry.</summary>
public sealed class AutomationRegistryEntryResponse
{
    [JsonPropertyName("entry")]
    public AutomationRegistryEntry? Entry { get; set; }
}

/// <summary>Response body of GET /api/admin/automation-registry/:customerId.</summary>
public sealed class AutomationRegistryListResponse
{
    [JsonPropertyName("entries")]
    public System.Collections.Generic.List<AutomationRegistryEntry> Entries { get; set; } = new();
}
