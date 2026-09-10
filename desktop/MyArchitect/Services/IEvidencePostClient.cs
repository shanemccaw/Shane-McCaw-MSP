using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Result of an evidence-post attempt — carries enough detail for the gallery UI to
/// show a real success/failure message rather than a bare bool.
/// </summary>
public sealed class EvidencePostResult
{
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public int? AttachmentId { get; init; }

    public static EvidencePostResult Ok(int attachmentId) => new() { Success = true, AttachmentId = attachmentId };
    public static EvidencePostResult Fail(string error) => new() { Success = false, ErrorMessage = error };
}

/// <summary>
/// Client contract for posting screenshot evidence to the Portal Admin backend
/// (#3503's evidence-attachments endpoints, under #1571). Posts against either a
/// remediation tracker step (customerId + stepId) or a change-control execution
/// (executionId), matching the two real POST routes in
/// artifacts/api-server/src/routes/msp-evidence-attachments.ts.
/// </summary>
public interface IEvidencePostClient
{
    /// <summary>
    /// True now that #3503 shipped the real attach-evidence endpoints — the backend
    /// schema/route gap that previously blocked this is resolved.
    /// </summary>
    bool IsRemotePostingSupported => true;

    /// <summary>
    /// Post evidence for a remediation tracker step:
    /// POST /api/msp/customers/{customerId}/remediation-tracker/steps/{stepId}/evidence
    /// </summary>
    Task<EvidencePostResult> PostRemediationStepEvidenceAsync(
        int customerId,
        string stepId,
        ScreenshotEvidenceItem item,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Post evidence for a change-control execution:
    /// POST /api/msp/change-control/executions/{executionId}/evidence
    /// </summary>
    Task<EvidencePostResult> PostChangeControlEvidenceAsync(
        int executionId,
        ScreenshotEvidenceItem item,
        CancellationToken cancellationToken = default);
}
