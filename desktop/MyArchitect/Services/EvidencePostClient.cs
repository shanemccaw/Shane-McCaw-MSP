using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for #3503's evidence-attachments endpoints
/// (artifacts/api-server/src/routes/msp-evidence-attachments.ts) — the live
/// server side <see cref="IEvidencePostClient"/> was waiting on since #3470
/// shipped its local capture pipeline.
/// </summary>
public sealed class EvidencePostClient : IEvidencePostClient
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public bool IsRemotePostingSupported => true;

    /// <summary>
    /// Bearer token attached to every request, once MyArchitect has a real
    /// auth/session mechanism to source one from — none exists yet anywhere in
    /// this app (same open item as ChangeControlService/LaunchControlActionsService,
    /// #3460/#3501). These routes are gated by requireCapability("ladder.msp-operator"),
    /// so a call made with this unset will legitimately 401/403 rather than succeed.
    /// </summary>
    public string? AuthToken { get; set; }

    public EvidencePostClient(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        // Larger timeout than the JSON services — this uploads a real image file.
        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
    }

    public Task<EvidencePostResult> PostRemediationStepEvidenceAsync(
        int customerId,
        string stepId,
        ScreenshotEvidenceItem item,
        CancellationToken cancellationToken = default)
    {
        var url = $"{_baseUrl}/api/msp/customers/{customerId}/remediation-tracker/steps/{Uri.EscapeDataString(stepId)}/evidence";
        return PostAsync(url, item, cancellationToken);
    }

    public Task<EvidencePostResult> PostChangeControlEvidenceAsync(
        int executionId,
        ScreenshotEvidenceItem item,
        CancellationToken cancellationToken = default)
    {
        var url = $"{_baseUrl}/api/msp/change-control/executions/{executionId}/evidence";
        return PostAsync(url, item, cancellationToken);
    }

    private async Task<EvidencePostResult> PostAsync(string url, ScreenshotEvidenceItem item, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(item.FilePath) || !File.Exists(item.FilePath))
        {
            return EvidencePostResult.Fail($"Captured file no longer exists on disk: {item.FilePath}");
        }

        try
        {
            using var form = new MultipartFormDataContent();
            using var fileStream = File.OpenRead(item.FilePath);
            using var fileContent = new StreamContent(fileStream);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue(GuessContentType(item.FilePath));
            form.Add(fileContent, "file", Path.GetFileName(item.FilePath));

            if (!string.IsNullOrWhiteSpace(item.Caption))
            {
                form.Add(new StringContent(item.Caption), "caption");
            }
            if (item.Width > 0)
            {
                form.Add(new StringContent(item.Width.ToString()), "width");
            }
            if (item.Height > 0)
            {
                form.Add(new StringContent(item.Height.ToString()), "height");
            }
            form.Add(new StringContent(item.CapturedAt.ToString("O")), "capturedAt");

            using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = form };
            if (!string.IsNullOrWhiteSpace(AuthToken))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthToken);
            }

            using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                return EvidencePostResult.Fail(
                    $"POST {url} returned {(int)response.StatusCode} {response.ReasonPhrase}: {body}");
            }

            try
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("attachment", out var attachmentEl) &&
                    attachmentEl.TryGetProperty("id", out var idEl) &&
                    idEl.TryGetInt32(out var attachmentId))
                {
                    return EvidencePostResult.Ok(attachmentId);
                }
            }
            catch (JsonException)
            {
                // Fall through — still a 2xx, just couldn't parse the id back out.
            }

            return EvidencePostResult.Ok(0);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            return EvidencePostResult.Fail($"Failed to post evidence to {url}: {ex.Message}");
        }
    }

    private static string GuessContentType(string filePath)
    {
        var ext = Path.GetExtension(filePath).ToLowerInvariant();
        return ext switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".bmp" => "image/bmp",
            _ => "application/octet-stream",
        };
    }
}
