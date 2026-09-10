using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Service providing live telemetry queries against confirmed backend endpoints for the selected tenant (Issue #3476).
/// </summary>
public interface ITelemetryService
{
    /// <summary>Bearer access token from the real MyArchitect session (#3501). Set by the shell
    /// on sign-in/refresh so these auth-gated endpoints receive a real Authorization header.</summary>
    string? AuthToken { get; set; }

    Task<TenantTelemetryDashboard> FetchTelemetryAsync(Tenant tenant, bool sinceYesterdayOnly = false);
}
