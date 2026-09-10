using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Service providing live assessment data queries against real endpoints and local snapshot save/load (Issue #3475).
/// </summary>
public interface IAssessmentService
{
    Task<TenantAssessmentSnapshot> FetchLiveAssessmentAsync(Tenant tenant);
    Task SaveSnapshotAsync(TenantAssessmentSnapshot snapshot, string filePath);
    Task<TenantAssessmentSnapshot> LoadSnapshotAsync(string filePath);
}
