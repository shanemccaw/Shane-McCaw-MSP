using System;
using System.Collections.Generic;
using System.Linq;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// In-memory tenant service providing tenant registration and current active tenant scoping.
/// </summary>
public sealed class TenantService : ITenantService
{
    private readonly List<Tenant> _tenants;
    private Tenant? _currentTenant;

    public event EventHandler<Tenant?>? CurrentTenantChanged;

    public TenantService()
    {
        _tenants = new List<Tenant>
        {
            new Tenant
            {
                Id = "tenant-001",
                Name = "Contoso Managed Services",
                TenantGuid = "72f988bf-86f1-41af-91ab-2d7cd011db47",
                PortalUrls = TenantPortalUrls.CreateForTenant("72f988bf-86f1-41af-91ab-2d7cd011db47")
            },
            new Tenant
            {
                Id = "tenant-002",
                Name = "Fabrikam Global Cloud",
                TenantGuid = "49a463a8-4e89-4d64-9b2f-87d465f12e8b",
                PortalUrls = TenantPortalUrls.CreateForTenant("49a463a8-4e89-4d64-9b2f-87d465f12e8b")
            },
            new Tenant
            {
                Id = "tenant-003",
                Name = "Northwind IT Infrastructure",
                TenantGuid = "b84501a3-1a2f-45be-bb3b-6320a02316e2",
                PortalUrls = TenantPortalUrls.CreateForTenant("b84501a3-1a2f-45be-bb3b-6320a02316e2")
            },
            new Tenant
            {
                Id = "tenant-004",
                Name = "Shane McCaw Consulting Internal",
                TenantGuid = "e9a0c201-92be-49b0-94d1-c11579be4001",
                PortalUrls = TenantPortalUrls.CreateForTenant("e9a0c201-92be-49b0-94d1-c11579be4001")
            }
        };

        _currentTenant = _tenants.FirstOrDefault();
    }

    public IReadOnlyList<Tenant> Tenants => _tenants.AsReadOnly();

    public Tenant? CurrentTenant
    {
        get => _currentTenant;
        set
        {
            if (_currentTenant != value)
            {
                _currentTenant = value;
                CurrentTenantChanged?.Invoke(this, _currentTenant);
            }
        }
    }

    public void SelectTenant(string tenantId)
    {
        var tenant = _tenants.FirstOrDefault(t => t.Id.Equals(tenantId, StringComparison.OrdinalIgnoreCase) ||
                                                 t.TenantGuid.Equals(tenantId, StringComparison.OrdinalIgnoreCase));
        if (tenant != null)
        {
            CurrentTenant = tenant;
        }
    }
}
