using System;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>Reports how a tenant's Graph/Az module connection attempt resolved, so a future
/// Console UI panel (blocked on #3493) can render real state instead of a guess.</summary>
public sealed class TenantModuleConnectionResult
{
    public Tenant Tenant { get; init; } = null!;
    public bool GraphConnected { get; init; }
    public string GraphDetail { get; init; } = string.Empty;
    public bool AzModuleAvailable { get; init; }
    public bool AzConnected { get; init; }
    public string AzDetail { get; init; } = string.Empty;
}

/// <summary>
/// #3459 — auto-connects Microsoft Graph (and, when installed, Az) PowerShell modules scoped to
/// whatever tenant is active, every time the operator switches tenants in <see cref="ITenantService"/>.
/// </summary>
public interface ITenantModuleConnectionService : IDisposable
{
    /// <summary>Real device-code sign-in text as it's detected in the hosted console's host
    /// output — the actual code + verification URL a human needs to complete sign-in.</summary>
    event Action<string>? DeviceCodePromptDetected;

    event Action<TenantModuleConnectionResult>? ConnectionCompleted;

    Task<TenantModuleConnectionResult> ConnectAsync(Tenant tenant);
}
