using System;
using System.Collections.Generic;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Service contract managing active tenant scope across MyArchitect modules.
/// </summary>
public interface ITenantService
{
    IReadOnlyList<Tenant> Tenants { get; }
    Tenant? CurrentTenant { get; set; }
    event EventHandler<Tenant?>? CurrentTenantChanged;
    void SelectTenant(string tenantId);
}
