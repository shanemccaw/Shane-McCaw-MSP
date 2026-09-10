using System;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// Evidence metadata item stored in the local screenshot_evidence cache.
/// Associates captured screenshots with the active tenant, portal context, and execution/remediation refs.
/// </summary>
public sealed class ScreenshotEvidenceItem
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    [JsonPropertyName("capturedAt")]
    public DateTimeOffset CapturedAt { get; set; } = DateTimeOffset.UtcNow;

    [JsonPropertyName("filePath")]
    public string FilePath { get; set; } = string.Empty;

    [JsonPropertyName("tenantId")]
    public string? TenantId { get; set; }

    [JsonPropertyName("tenantName")]
    public string? TenantName { get; set; }

    [JsonPropertyName("activeUrl")]
    public string? ActiveUrl { get; set; }

    [JsonPropertyName("stepRef")]
    public string? StepRef { get; set; }

    [JsonPropertyName("changeRef")]
    public string? ChangeRef { get; set; }

    [JsonPropertyName("caption")]
    public string? Caption { get; set; }

    [JsonPropertyName("width")]
    public int Width { get; set; }

    [JsonPropertyName("height")]
    public int Height { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "Captured";

    [JsonIgnore]
    public string FormattedTime => CapturedAt.ToLocalTime().ToString("MMM dd, yyyy HH:mm:ss");

    [JsonIgnore]
    public string DisplayResolution => $"{Width} × {Height} px";

    [JsonIgnore]
    public string DisplayContext => !string.IsNullOrWhiteSpace(TenantName)
        ? (!string.IsNullOrWhiteSpace(Caption) ? $"{TenantName} • {Caption}" : TenantName)
        : (!string.IsNullOrWhiteSpace(Caption) ? Caption : "General Capture");
}
