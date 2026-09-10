using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Service providing live assessment data queries against real endpoints and local snapshot save/load (Issue #3475).
/// </summary>
public interface IAssessmentService
{
    /// <summary>Bearer access token from the real MyArchitect session (#3501). Set by the shell
    /// on sign-in/refresh so these auth-gated endpoints receive a real Authorization header.</summary>
    string? AuthToken { get; set; }

    Task<TenantAssessmentSnapshot> FetchLiveAssessmentAsync(Tenant tenant);
    Task SaveSnapshotAsync(TenantAssessmentSnapshot snapshot, string filePath);
    Task<TenantAssessmentSnapshot> LoadSnapshotAsync(string filePath);
}
