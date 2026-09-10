using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Service managing the local screenshot_evidence cache without database dependency.
/// </summary>
public interface IScreenshotEvidenceService
{
    event EventHandler<ScreenshotEvidenceItem>? ItemAdded;
    event EventHandler<string>? ItemDeleted;
    event EventHandler<ScreenshotEvidenceItem>? ItemUpdated;

    Task<IReadOnlyList<ScreenshotEvidenceItem>> GetAllAsync();
    Task<ScreenshotEvidenceItem> AddAsync(ScreenshotEvidenceItem item);
    Task UpdateCaptionAsync(string id, string caption, string? stepRef = null, string? changeRef = null, int? customerId = null);
    Task MarkPostedAsync(string id, int attachmentId);
    Task DeleteAsync(string id, bool deleteLocalFile = false);
}
