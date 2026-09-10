namespace MyArchitect.Models;

/// <summary>
/// Represents a managed tenant inside the operator cockpit.
/// </summary>
public sealed class Tenant
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string TenantGuid { get; set; } = string.Empty;
    public TenantPortalUrls PortalUrls { get; set; } = new();

    public override string ToString() => $"{Name} ({TenantGuid})";
}
