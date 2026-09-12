using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client for the real, new automation_registry API (`admin-automation-registry.ts`, Git #3771)
/// — a persistent, browsable list of the Power Automate flows and Power Platform/Azure AI Studio
/// agents Shane builds for a customer. Distinct from <see cref="IAdminRetainerService"/>, which
/// stays the place ad-hoc hours get logged.
/// </summary>
public interface IAutomationRegistryService
{
    /// <summary>Bearer access token from the real MyArchitect session (#3501). This route is
    /// gated by `requireAdmin` (platform-admin role), same gate as <see cref="IAdminRetainerService"/>.</summary>
    string? AuthToken { get; set; }

    /// <summary>GET /api/admin/automation-registry/:customerId — every automation registered
    /// for that customer.</summary>
    Task<IReadOnlyList<AutomationRegistryEntry>> GetEntriesAsync(
        int customerId,
        CancellationToken cancellationToken = default);

    /// <summary>POST /api/admin/automation-registry/:customerId — registers a new automation.
    /// <paramref name="type"/> is "power_automate_flow" or "ai_studio_agent"; <paramref name="name"/>
    /// is required; <paramref name="status"/> and <paramref name="notes"/> are optional, matching
    /// the server's own <c>createSchema</c>.</summary>
    Task<AutomationRegistryEntry> CreateEntryAsync(
        int customerId,
        string type,
        string name,
        string? status = null,
        string? notes = null,
        CancellationToken cancellationToken = default);

    /// <summary>PATCH /api/admin/automation-registry/entry/:id — edits an existing entry. Only
    /// non-null parameters are sent, matching the server's own partial <c>patchSchema</c>.</summary>
    Task<AutomationRegistryEntry> UpdateEntryAsync(
        int id,
        string? type = null,
        string? name = null,
        string? status = null,
        string? notes = null,
        CancellationToken cancellationToken = default);

    /// <summary>DELETE /api/admin/automation-registry/entry/:id — removes an entry.</summary>
    Task DeleteEntryAsync(int id, CancellationToken cancellationToken = default);
}
