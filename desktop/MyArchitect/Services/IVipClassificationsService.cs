using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real client for the MSP-side VIP classification object (#1552 / #3484) —
/// `GET/POST /api/msp/vip-classifications` (`msp-vip-classifications.ts`). Feature
/// #3484's own scope: read + author, surfaced before acting on a user in the
/// Console (#3459) and Remediation execution (#3471) flows. Discovery-seed
/// (`POST .../discover`) is a bulk onboarding operation, not a per-user safety
/// check, and is out of this client's scope.
/// </summary>
public interface IVipClassificationsService
{
    /// <summary>Bearer token attached to every request — see
    /// <see cref="IChangeControlService.AuthToken"/> for the shared pattern.</summary>
    string? AuthToken { get; set; }

    /// <summary>All of this customer's current classifications.</summary>
    Task<IReadOnlyList<VipClassification>> GetClassificationsAsync(int customerId, CancellationToken cancellationToken = default);

    /// <summary>
    /// "Told" — the platform decision, always wins over a discovery seed. Used for
    /// a deliberate individual classify/de-classify act, never a batch import.
    /// </summary>
    Task<VipClassification> SetToldAsync(
        int customerId,
        string principalId,
        string principalUpn,
        bool isVip,
        CancellationToken cancellationToken = default);
}
