using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client for the real, existing MSP-console POA&amp;M endpoints (msp-poams.ts, Git #3080,
/// Phase 1a of #1935) — #3481's real remaining scope (list + detail, milestone CRUD, cancel)
/// is exactly this service plus the record-workspace wiring in MainWindow, since the backend
/// itself already exists.
/// </summary>
public interface IPoamsService
{
    /// <summary>Bearer token attached to every request, sourced from
    /// <see cref="IAuthService"/> the same way every other service's <c>AuthToken</c> is
    /// (#3501). These routes are gated by requireCapability("ladder.msp-operator")
    /// (requireCapability("ladder.msp-admin") for cancel), so a call made with this unset
    /// will legitimately 401/403 rather than succeed.</summary>
    string? AuthToken { get; set; }

    /// <summary>GET /api/msp/poams — every POA&amp;M for the signed-in operator's MSP. No
    /// per-tenant filter server-side; callers filter client-side, same approach
    /// <see cref="ChangeControlService"/> already takes.</summary>
    Task<IReadOnlyList<Poam>> GetPoamsAsync(CancellationToken cancellationToken = default);

    /// <summary>GET /api/msp/poams/:poamId — one plan, with its milestones.</summary>
    Task<Poam> GetPoamAsync(string poamId, CancellationToken cancellationToken = default);

    /// <summary>POST /api/msp/poams — author a new plan.</summary>
    Task<CreatePoamResult> CreatePoamAsync(
        string tenantId,
        string tenantName,
        string primaryDomain,
        string title,
        string weaknessDescription,
        string scheduledCompletionDate,
        string interimCompensatingControl,
        string resourcesRequired,
        string status,
        CancellationToken cancellationToken = default);

    /// <summary>PATCH /api/msp/poams/:poamId — a targeted partial edit. <paramref name="fields"/>
    /// carries only the keys actually changing (e.g. a single write-through
    /// <c>WorkspaceEdit</c>'s <c>OnChange</c>), matching the route's own optional-field
    /// <c>updatePoamSchema</c> rather than round-tripping the whole record on every edit.</summary>
    Task<PoamActionResult> UpdatePoamAsync(
        string poamId,
        IReadOnlyDictionary<string, object?> fields,
        CancellationToken cancellationToken = default);

    /// <summary>PATCH /api/msp/poams/:poamId/cancel.</summary>
    Task<PoamActionResult> CancelPoamAsync(string poamId, CancellationToken cancellationToken = default);

    /// <summary>POST /api/msp/poams/:poamId/milestones — add a milestone.</summary>
    Task<MilestoneActionResult> CreateMilestoneAsync(
        string poamId,
        string title,
        string? description,
        string dueDate,
        CancellationToken cancellationToken = default);

    /// <summary>PATCH /api/msp/poams/:poamId/milestones/:milestoneId — edit fields, or mark
    /// complete via <c>fields["status"] = "completed"</c>.</summary>
    Task<MilestoneActionResult> UpdateMilestoneAsync(
        string poamId,
        int milestoneId,
        IReadOnlyDictionary<string, object?> fields,
        CancellationToken cancellationToken = default);

    /// <summary>DELETE /api/msp/poams/:poamId/milestones/:milestoneId.</summary>
    Task<MilestoneActionResult> DeleteMilestoneAsync(
        string poamId,
        int milestoneId,
        CancellationToken cancellationToken = default);
}
