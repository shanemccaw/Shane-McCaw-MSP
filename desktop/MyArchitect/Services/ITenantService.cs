using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Service contract managing the real MSP customer list and active tenant scope across
/// MyArchitect modules (#3540 — real client, was fixture data).
/// </summary>
public interface ITenantService
{
    IReadOnlyList<Tenant> Tenants { get; }
    Tenant? CurrentTenant { get; set; }
    event EventHandler<Tenant?>? CurrentTenantChanged;

    /// <summary>Raised whenever <see cref="Tenants"/> is replaced by a fresh load (success or
    /// failure) — <see cref="Controls.TenantSwitcher"/> and other list consumers subscribe to
    /// this instead of reading <see cref="Tenants"/> once at construction.</summary>
    event EventHandler? TenantsChanged;

    /// <summary>Bearer token attached to the customers-list request, fanned out from
    /// <c>MainWindow.ApplyAuthState</c> the same way every other real-endpoint service is (#3501).</summary>
    string? AuthToken { get; set; }

    /// <summary>True once a load has completed successfully (even with zero rows). False before
    /// the first load and whenever <see cref="LoadError"/> is set.</summary>
    bool IsLoaded { get; }

    /// <summary>The most recent load failure's message, or null when the last load succeeded.</summary>
    string? LoadError { get; }

    void SelectTenant(string tenantId);

    /// <summary>Loads (or reloads) the real customer list for the given MSP from
    /// <c>GET /api/msp/v1/msps/{mspId}/customers</c>. <paramref name="mspId"/> &lt;= 0 clears the
    /// list (e.g. on sign-out) rather than issuing a request.</summary>
    Task LoadTenantsAsync(int mspId, CancellationToken cancellationToken = default);
}
