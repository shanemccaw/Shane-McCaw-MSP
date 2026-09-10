using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// Wire shapes for GET /api/admin/retainer/:customerId (admin-retainer.ts), the real backend
/// this Feature (#3474) is a client of. Field names/shapes mirror <c>SettingsWire</c> and
/// <c>bucketToWire</c> in <c>artifacts/api-server/src/routes/admin-retainer.ts</c> exactly —
/// nothing invented. As of #3473 the period is anniversary-based (Stripe cycle), not
/// calendar-month, so <see cref="RetainerBucketWire"/> already reflects the corrected logic.
/// </summary>
public sealed class RetainerCustomerWire
{
    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;
}

public sealed class RetainerSettingsWire
{
    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    [JsonPropertyName("retainedHours")]
    public double RetainedHours { get; set; }

    [JsonPropertyName("hourlyRateCents")]
    public int HourlyRateCents { get; set; }

    [JsonPropertyName("architectName")]
    public string? ArchitectName { get; set; }

    [JsonPropertyName("active")]
    public bool Active { get; set; }

    /// <summary>False when the customer has no retainer_settings row at all — the endpoint
    /// still returns a bucket (defaulted to DEFAULT_RETAINED_MINUTES), but there's nothing
    /// really configured for them yet.</summary>
    [JsonPropertyName("configured")]
    public bool Configured { get; set; }
}

/// <summary>The real used/retained/remaining shape for the current anniversary-based period
/// (#3473). <see cref="IsOverMonth"/> is the honest, uncapped over-month signal the server
/// computes — never inferred client-side from RemainingHours == 0, which is also true for a
/// customer who used exactly their allotment (see the server's own comment on bucketToWire).</summary>
public sealed class RetainerBucketWire
{
    [JsonPropertyName("period")]
    public string Period { get; set; } = string.Empty;

    [JsonPropertyName("retainedHours")]
    public double RetainedHours { get; set; }

    [JsonPropertyName("rolledHours")]
    public double RolledHours { get; set; }

    [JsonPropertyName("usedHours")]
    public double UsedHours { get; set; }

    [JsonPropertyName("remainingHours")]
    public double RemainingHours { get; set; }

    [JsonPropertyName("overHours")]
    public double OverHours { get; set; }

    [JsonPropertyName("isOverMonth")]
    public bool IsOverMonth { get; set; }
}

/// <summary>Response body of GET /api/admin/retainer/:customerId. <c>months</c>/<c>entries</c>
/// exist on the real response too (full ledger) but aren't needed for the status-bar progress
/// bar this Feature builds, so they're left off this model rather than deserialized unused.</summary>
public sealed class RetainerDetailResponse
{
    [JsonPropertyName("customer")]
    public RetainerCustomerWire? Customer { get; set; }

    [JsonPropertyName("settings")]
    public RetainerSettingsWire? Settings { get; set; }

    [JsonPropertyName("bucket")]
    public RetainerBucketWire? Bucket { get; set; }
}
