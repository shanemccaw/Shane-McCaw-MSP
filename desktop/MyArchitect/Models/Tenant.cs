namespace MyArchitect.Models;

/// <summary>
/// Represents a managed tenant (an MSP customer) inside the operator cockpit.
/// </summary>
public sealed class Tenant
{
    /// <summary>Display/lookup key kept for back-compat with existing consumers that key
    /// off a string (dictionary keys, sanitized filenames, telemetry tags) — the string form
    /// of <see cref="CustomerId"/> as of #3540, never a synthetic fixture id.</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Real numeric <c>tenants.id</c> from the api-server — the id every
    /// customer-scoped MSP endpoint (Launch Control, retainer hours, Runbooks, etc.) actually
    /// expects as <c>customerId</c>. Added by #3540; 0 means "not a real loaded customer."</summary>
    public int CustomerId { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>The customer's real Microsoft tenant GUID (<c>tenants.tenant_id</c>).</summary>
    public string TenantGuid { get; set; } = string.Empty;

    public string? Domain { get; set; }
    public string? Industry { get; set; }
    public string? Status { get; set; }
    public bool IsTestbed { get; set; }

    public TenantPortalUrls PortalUrls { get; set; } = new();

    public override string ToString() => $"{Name} ({TenantGuid})";
}
