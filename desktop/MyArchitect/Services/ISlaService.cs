using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for the MSP-side SLA surfaces (msp-sla.ts's internal ticket-response/
/// resolution engine and msp-m365-sla.ts's Microsoft third-party uptime view — #3487's audited
/// endpoints). No local fixture data; every method is a real call.
/// </summary>
public interface ISlaService
{
    /// <summary>Bearer token attached to every request — set from <c>IAuthService.SessionChanged</c>,
    /// same convention as every other MSP-scoped service in this app.</summary>
    string? AuthToken { get; set; }

    /// <summary>GET /api/msp/sla/policies — active policies for this MSP (own + global defaults).
    /// Not tenant-scoped.</summary>
    Task<IReadOnlyList<SlaPolicy>> GetPoliciesAsync(CancellationToken cancellationToken = default);

    /// <summary>GET /api/msp/sla/breaches[?customerId=] — unresolved breaches. Optional numeric
    /// customerId filter; omit to see the full book.</summary>
    Task<IReadOnlyList<SlaBreach>> GetBreachesAsync(int? customerId = null, CancellationToken cancellationToken = default);

    /// <summary>GET /api/msp/sla/escalations — open (pending/in_progress) escalations for this
    /// MSP. The route itself carries no customerId filter.</summary>
    Task<IReadOnlyList<SlaEscalation>> GetEscalationsAsync(CancellationToken cancellationToken = default);

    /// <summary>GET /api/msp/sla/compliance[?customerId=] — monthly compliance history.</summary>
    Task<IReadOnlyList<SlaComplianceRecord>> GetComplianceAsync(int? customerId = null, CancellationToken cancellationToken = default);

    /// <summary>GET /api/msp/m365-sla[?customerId=] — per-customer, per-service M365 uptime
    /// against Microsoft's 99.9% commitment.</summary>
    Task<M365SlaResponse> GetM365SlaAsync(int? customerId = null, CancellationToken cancellationToken = default);

    /// <summary>POST /api/msp/sla/timers/:timerId/resolve — the real backend action behind a
    /// breach's "Resolve" — resolves the underlying timer, not the breach row directly.</summary>
    Task<bool> ResolveTimerAsync(string timerId, string? notes, CancellationToken cancellationToken = default);
}
