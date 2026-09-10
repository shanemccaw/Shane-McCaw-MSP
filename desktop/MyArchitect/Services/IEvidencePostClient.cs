using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client contract for posting screenshot evidence to the Portal Admin backend.
/// BLOCKED: Cross-epic dependency on Portal Admin issue #1571 (schema & attach-evidence endpoint addition).
/// Once the endpoint exists under #1571, this client will upload the file and associate it with
/// remediation_tracker_steps or change-control execution records.
/// </summary>
public interface IEvidencePostClient
{
    /// <summary>
    /// Indicates whether remote evidence posting is supported by the current backend schema.
    /// Returns false until Portal Admin #1571 is resolved.
    /// </summary>
    bool IsRemotePostingSupported => false;

    /// <summary>
    /// Post evidence to the backend once #1571 lands.
    /// </summary>
    Task<bool> PostEvidenceAsync(ScreenshotEvidenceItem item);
}

/// <summary>
/// Default implementation of <see cref="IEvidencePostClient"/> reflecting the current blocked state.
/// </summary>
public sealed class BlockedEvidencePostClient : IEvidencePostClient
{
    public bool IsRemotePostingSupported => false;

    public Task<bool> PostEvidenceAsync(ScreenshotEvidenceItem item)
    {
        // Blocked until Portal Admin #1571 adds attachment/evidence route
        return Task.FromResult(false);
    }
}
