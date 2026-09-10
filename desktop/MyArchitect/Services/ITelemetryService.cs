using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Service providing live telemetry queries against confirmed backend endpoints for the selected tenant (Issue #3476).
/// </summary>
public interface ITelemetryService
{
    Task<TenantTelemetryDashboard> FetchTelemetryAsync(Tenant tenant, bool sinceYesterdayOnly = false);
}
