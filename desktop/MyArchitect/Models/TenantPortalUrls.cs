namespace MyArchitect.Models;

/// <summary>
/// Contains direct portal URL endpoints scoped to a specific tenant.
/// </summary>
public sealed class TenantPortalUrls
{
    public string M365AdminUrl { get; set; } = string.Empty;
    public string AzurePortalUrl { get; set; } = string.Empty;
    public string EntraAdminUrl { get; set; } = string.Empty;
    public string IntuneAdminUrl { get; set; } = string.Empty;
    public string ExchangeAdminUrl { get; set; } = string.Empty;

    public static TenantPortalUrls CreateForTenant(string tenantGuid)
    {
        return new TenantPortalUrls
        {
            M365AdminUrl = $"https://admin.microsoft.com/?tid={tenantGuid}",
            AzurePortalUrl = $"https://portal.azure.com/{tenantGuid}",
            EntraAdminUrl = $"https://entra.microsoft.com/{tenantGuid}",
            IntuneAdminUrl = $"https://intune.microsoft.com/{tenantGuid}",
            ExchangeAdminUrl = $"https://admin.exchange.microsoft.com/?tid={tenantGuid}"
        };
    }
}
