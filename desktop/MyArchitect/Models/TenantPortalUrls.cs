using System;
using System.Collections.Generic;

namespace MyArchitect.Models;

/// <summary>
/// Supported portal types available within the operator cockpit.
/// </summary>
public enum PortalType
{
    M365Admin,
    AzurePortal,
    EntraAdmin,
    IntuneAdmin,
    ExchangeAdmin,
    SecurityAdmin,
    ComplianceAdmin,
    TeamsAdmin
}

/// <summary>
/// Contains direct portal URL endpoints and deep-link templates scoped to a specific tenant.
/// </summary>
public sealed class TenantPortalUrls
{
    public string TenantGuid { get; init; } = string.Empty;
    public string M365AdminUrl { get; set; } = string.Empty;
    public string AzurePortalUrl { get; set; } = string.Empty;
    public string EntraAdminUrl { get; set; } = string.Empty;
    public string IntuneAdminUrl { get; set; } = string.Empty;
    public string ExchangeAdminUrl { get; set; } = string.Empty;
    public string SecurityAdminUrl { get; set; } = string.Empty;
    public string ComplianceAdminUrl { get; set; } = string.Empty;
    public string TeamsAdminUrl { get; set; } = string.Empty;

    public static TenantPortalUrls CreateForTenant(string tenantGuid)
    {
        return new TenantPortalUrls
        {
            TenantGuid = tenantGuid,
            M365AdminUrl = $"https://admin.microsoft.com/?tid={tenantGuid}",
            AzurePortalUrl = $"https://portal.azure.com/{tenantGuid}",
            EntraAdminUrl = $"https://entra.microsoft.com/{tenantGuid}",
            IntuneAdminUrl = $"https://intune.microsoft.com/{tenantGuid}",
            ExchangeAdminUrl = $"https://admin.exchange.microsoft.com/?tid={tenantGuid}",
            SecurityAdminUrl = $"https://security.microsoft.com/?tid={tenantGuid}",
            ComplianceAdminUrl = $"https://compliance.microsoft.com/?tid={tenantGuid}",
            TeamsAdminUrl = $"https://admin.teams.microsoft.com/?tid={tenantGuid}"
        };
    }

    public string GetUrl(PortalType portalType) => portalType switch
    {
        PortalType.M365Admin => M365AdminUrl,
        PortalType.AzurePortal => AzurePortalUrl,
        PortalType.EntraAdmin => EntraAdminUrl,
        PortalType.IntuneAdmin => IntuneAdminUrl,
        PortalType.ExchangeAdmin => ExchangeAdminUrl,
        PortalType.SecurityAdmin => SecurityAdminUrl,
        PortalType.ComplianceAdmin => ComplianceAdminUrl,
        PortalType.TeamsAdmin => TeamsAdminUrl,
        _ => M365AdminUrl
    };

    public string GetDeepLink(PortalType portalType, string subPath)
    {
        var baseUri = GetUrl(portalType).TrimEnd('/');
        var cleanSub = subPath.TrimStart('/');
        return $"{baseUri}/{cleanSub}";
    }
}
