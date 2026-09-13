using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>Details of a screenshot attached to an exported bug report.</summary>
    public sealed class BugExportScreenshotInfo
    {
        public string FileName { get; set; } = "";
        public string RelativePath { get; set; } = "";
        public string AbsolutePath { get; set; } = "";
        public string OriginalPath { get; set; } = "";
    }

    /// <summary>Result summary of an export operation.</summary>
    public sealed class BugExportResult
    {
        public bool Success { get; set; }
        public string? Error { get; set; }
        public string Area { get; set; } = "";
        public string DirectoryPath { get; set; } = "";
        public List<string> ExportedFiles { get; set; } = new();
        public int ExportedCount { get; set; }
        public List<string> CopiedScreenshots { get; set; } = new();
    }

    /// <summary>
    /// Phase 7: Export & Integration Engine.
    /// Exports bug reports directly to local repo /Bugs/<Area>/ as clean, structured JSON documents,
    /// complete with metadata, notes, reproduction steps, bundled screenshots, and telemetry logs.
    /// </summary>
    public static class VisualTestTrackerExportService
    {
        public static readonly string[] DefaultAreas = new[]
        {
            "MSP_Console",
            "Portal",
            "Admin-Panel",
            "Marketing",
            "MSP_Marketing",
            "Website",
            "General"
        };

        /// <summary>
        /// Auto-detects recommended destination area based on route, domain, or port.
        /// Priority port mappings for local development:
        ///   - localhost:5175/portal/ -> Portal
        ///   - localhost:5173/        -> Marketing
        ///   - localhost:5174/        -> Admin-Panel (Admin Panel)
        ///   - localhost:5177/        -> MSP_Console (MSP Console)
        ///   - localhost:5176/        -> MSP_Marketing (MSP Marketing)
        /// </summary>
        public static string DetectArea(string? url, string? pagePath)
        {
            // 1. Port auto-detection has highest precedence for local development
            int port = ExtractPort(url);
            if (port == 5175) return "Portal";
            if (port == 5173) return "Marketing";
            if (port == 5174) return "Admin-Panel";
            if (port == 5177) return "MSP_Console";
            if (port == 5176) return "MSP_Marketing";

            var combined = $"{url ?? ""} {pagePath ?? ""}".ToLowerInvariant();

            // Also check port substring in combined string if port was provided without scheme
            if (Regex.IsMatch(combined, @"(?::|\b)5175(?::|/|\b)")) return "Portal";
            if (Regex.IsMatch(combined, @"(?::|\b)5173(?::|/|\b)")) return "Marketing";
            if (Regex.IsMatch(combined, @"(?::|\b)5174(?::|/|\b)")) return "Admin-Panel";
            if (Regex.IsMatch(combined, @"(?::|\b)5177(?::|/|\b)")) return "MSP_Console";
            if (Regex.IsMatch(combined, @"(?::|\b)5176(?::|/|\b)")) return "MSP_Marketing";

            // 2. Keyword & route detection
            // MSP Marketing (check before generic marketing or console)
            if (combined.Contains("msp-marketing") || combined.Contains("msp_marketing") ||
                combined.Contains("msp marketing") || combined.Contains("msp-website") ||
                combined.Contains("mspwebsite"))
            {
                return "MSP_Marketing";
            }

            // Portal routes & keywords
            if (combined.Contains("portal") || combined.Contains("client") || combined.Contains("customer") || combined.Contains("billing"))
            {
                return "Portal";
            }

            // Admin routes & keywords
            if (combined.Contains("admin") || combined.Contains("control-panel"))
            {
                return "Admin-Panel";
            }

            // Marketing / landing routes & keywords
            if (combined.Contains("marketing") || combined.Contains("landing") ||
                combined.Contains("shane-mccaw.com") || combined.Contains("shane-mccaw-consulting") ||
                combined.Contains("sales") || combined.Contains("pricing") ||
                combined.Contains("quick-start") || combined.Contains("scan"))
            {
                return "Marketing";
            }

            // MSP Console routes & keywords
            if (combined.Contains("console") || combined.Contains("msp-console") ||
                combined.Contains("msp_console") || combined.Contains("localhost:3000") ||
                combined.Contains("msp"))
            {
                return "MSP_Console";
            }

            return "MSP_Console";
        }

        /// <summary>Extracts TCP port number from a URL string, handling scheme-less hostnames.</summary>
        private static int ExtractPort(string? url)
        {
            if (string.IsNullOrWhiteSpace(url)) return -1;
            var trimmed = url.Trim();
            if (!trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                trimmed = "http://" + trimmed;
            }

            if (Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) && uri.Port > 0)
            {
                return uri.Port;
            }

            var match = Regex.Match(url, @":(\d{4,5})");
            if (match.Success && int.TryParse(match.Groups[1].Value, out int p))
            {
                return p;
            }

            return -1;
        }

        /// <summary>Normalizes area or product name for comparison across spaces, hyphens, and underscores.</summary>
        public static string NormalizeAreaKey(string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "";
            return name.Replace(" ", "").Replace("-", "").Replace("_", "").ToLowerInvariant();
        }

        /// <summary>Returns the human-friendly display name corresponding to an area or folder.</summary>
        public static string FormatDisplayName(string? area)
        {
            var norm = NormalizeAreaKey(area);
            return norm switch
            {
                "adminpanel" => "Admin Panel",
                "mspconsole" => "MSP Console",
                "mspmarketing" => "MSP Marketing",
                "portal" => "Portal",
                "marketing" => "Marketing",
                "website" => "MSP Marketing",
                _ => string.IsNullOrWhiteSpace(area) ? "General" : area.Trim()
            };
        }

        /// <summary>Resolves the root path of the local git repository.</summary>
        public static string ResolveRepoRoot()
        {
            return BuildTrackerConfig.FindRepoRoot() ?? AppDomain.CurrentDomain.BaseDirectory;
        }

        /// <summary>Returns the destination directory path for the given area under local repo /Bugs/<Area>.</summary>
        public static string GetAreaDirectory(string area)
        {
            var sanitizedArea = SanitizeDirectoryName(area);
            var repoRoot = ResolveRepoRoot();
            return Path.Combine(repoRoot, "Bugs", sanitizedArea);
        }

        /// <summary>Sanitizes area name to be a valid, clean folder name matching the repo /Bugs/<Area> structure.</summary>
        public static string SanitizeDirectoryName(string? area)
        {
            if (string.IsNullOrWhiteSpace(area)) return "General";
            var trimmed = area.Trim();
            var norm = NormalizeAreaKey(trimmed);

            switch (norm)
            {
                case "adminpanel":
                    return "Admin-Panel";
                case "mspconsole":
                    return "MSP_Console";
                case "mspmarketing":
                case "mspwebsite":
                case "website":
                    return "MSP_Marketing";
                case "marketing":
                    return "Marketing";
                case "portal":
                    return "Portal";
                case "general":
                    return "General";
                default:
                    var clean = trimmed.Replace('/', '_').Replace('\\', '_').Replace(' ', '_');
                    foreach (var c in Path.GetInvalidFileNameChars())
                    {
                        clean = clean.Replace(c, '_');
                    }
                    return clean;
            }
        }

        /// <summary>Generates a filesystem-safe slug from a title string.</summary>
        public static string MakeSlug(string? text, int maxLen = 35)
        {
            if (string.IsNullOrWhiteSpace(text)) return "bug";
            var slug = Regex.Replace(text.ToLowerInvariant(), @"[^a-z0-9]+", "-").Trim('-');
            if (string.IsNullOrEmpty(slug)) return "bug";
            if (slug.Length > maxLen) slug = slug.Substring(0, maxLen).TrimEnd('-');
            return slug;
        }

        /// <summary>
        /// Exports a single VisualTestTrackerEntry as a structured JSON document to /Bugs/<Area>/bug-*.json,
        /// bundling attachments into /Bugs/<Area>/attachments/<bug-id>/.
        /// </summary>
        public static BugExportResult ExportEntry(VisualTestTrackerEntry entry, string area, bool copyScreenshots = true)
        {
            if (entry == null)
                return new BugExportResult { Success = false, Error = "No entry provided to export." };

            try
            {
                var areaDir = GetAreaDirectory(area);
                Directory.CreateDirectory(areaDir);

                var displayTitle = !string.IsNullOrWhiteSpace(entry.Title)
                    ? entry.Title
                    : (!string.IsNullOrWhiteSpace(entry.Notes)
                        ? entry.Notes.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)[0].Trim()
                        : "Visual Observation");

                var slug = MakeSlug(displayTitle);
                var bugId = $"bug-{entry.CreatedAt:yyyyMMdd-HHmmss}-{slug}";
                var jsonFileName = $"{bugId}.json";
                var jsonFilePath = Path.Combine(areaDir, jsonFileName);

                var screenshotInfos = new List<BugExportScreenshotInfo>();
                var copiedFiles = new List<string>();

                // Copy screenshots into local repo attachments folder
                if (entry.ScreenshotPaths != null && entry.ScreenshotPaths.Count > 0)
                {
                    string attachmentsRelDir = Path.Combine("attachments", bugId).Replace('\\', '/');
                    string attachmentsAbsDir = Path.Combine(areaDir, "attachments", bugId);

                    if (copyScreenshots)
                    {
                        Directory.CreateDirectory(attachmentsAbsDir);
                    }

                    int shotIdx = 1;
                    foreach (var originalPath in entry.ScreenshotPaths)
                    {
                        if (string.IsNullOrWhiteSpace(originalPath)) continue;

                        var ext = Path.GetExtension(originalPath);
                        if (string.IsNullOrEmpty(ext)) ext = ".png";
                        var destFileName = $"screenshot_{shotIdx}{ext}";
                        var destRelPath = $"{attachmentsRelDir}/{destFileName}";
                        var destAbsPath = Path.Combine(attachmentsAbsDir, destFileName);

                        if (copyScreenshots && File.Exists(originalPath))
                        {
                            try
                            {
                                File.Copy(originalPath, destAbsPath, overwrite: true);
                                copiedFiles.Add(destAbsPath);
                            }
                            catch (Exception ex)
                            {
                                ActivityLog.Log("visual-test-tracker", $"Screenshot copy error: {ex.Message}");
                            }
                        }

                        screenshotInfos.Add(new BugExportScreenshotInfo
                        {
                            FileName = destFileName,
                            RelativePath = destRelPath,
                            AbsolutePath = destAbsPath,
                            OriginalPath = originalPath
                        });

                        shotIdx++;
                    }
                }

                // Parse structured reproduction steps
                var structuredSteps = new List<string>();
                if (!string.IsNullOrWhiteSpace(entry.StepsToReproduce))
                {
                    var lines = entry.StepsToReproduce.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (var l in lines)
                    {
                        var trimmed = l.Trim();
                        var clean = Regex.Replace(trimmed, @"^\d+\.\s*", "");
                        if (!string.IsNullOrWhiteSpace(clean)) structuredSteps.Add(clean);
                    }
                }

                string effectiveUrl = !string.IsNullOrWhiteSpace(entry.CurrentUrl)
                    ? entry.CurrentUrl
                    : $"{entry.BaseUrl}{entry.PagePath}";

                // Build complete JSON export payload
                var exportPayload = new Dictionary<string, object?>
                {
                    ["$schema"] = "https://json-schema.org/draft/2020-12/schema",
                    ["exportVersion"] = "1.0",
                    ["exportedAt"] = DateTime.UtcNow.ToString("o"),
                    ["id"] = bugId,
                    ["uuid"] = entry.EntryUuid,
                    ["area"] = SanitizeDirectoryName(area),
                    ["title"] = displayTitle,
                    ["severity"] = entry.Severity,
                    ["status"] = entry.Status,
                    ["tags"] = entry.Tags ?? new List<string>(),

                    // 1. Metadata
                    ["metadata"] = new Dictionary<string, object?>
                    {
                        ["entryUuid"] = entry.EntryUuid,
                        ["currentUrl"] = effectiveUrl,
                        ["baseUrl"] = entry.BaseUrl,
                        ["pagePath"] = entry.PagePath,
                        ["pageTitle"] = entry.PageTitle,
                        ["browserVersion"] = entry.BrowserVersion,
                        ["osVersion"] = entry.OsVersion,
                        ["windowSize"] = entry.WindowSize,
                        ["viewportSize"] = entry.ViewportSize,
                        ["userAgent"] = entry.UserAgent,
                        ["createdAt"] = entry.CreatedAt.ToString("o"),
                        ["updatedAt"] = entry.UpdatedAt.ToString("o"),
                        ["performance"] = entry.Performance != null ? new Dictionary<string, object?>
                        {
                            ["pageLoadTimeMs"] = entry.Performance.PageLoadTimeMs,
                            ["dnsTimeMs"] = entry.Performance.DnsTimeMs,
                            ["tcpTimeMs"] = entry.Performance.TcpTimeMs,
                            ["ttfbMs"] = entry.Performance.TtfbMs,
                            ["domContentLoadedMs"] = entry.Performance.DomContentLoadedMs,
                            ["firstContentfulPaintMs"] = entry.Performance.FirstContentfulPaintMs,
                            ["largestContentfulPaintMs"] = entry.Performance.LargestContentfulPaintMs,
                            ["scriptErrorCount"] = entry.Performance.ScriptErrorCount
                        } : null
                    },

                    // 2. Notes
                    ["notes"] = new Dictionary<string, object?>
                    {
                        ["summary"] = displayTitle,
                        ["markdown"] = entry.Notes,
                        ["expectedBehavior"] = entry.ExpectedBehavior,
                        ["actualBehavior"] = entry.ActualBehavior
                    },

                    // 3. Repro Steps
                    ["reproSteps"] = new Dictionary<string, object?>
                    {
                        ["text"] = entry.StepsToReproduce,
                        ["structuredSteps"] = structuredSteps,
                        ["events"] = entry.ReproductionEvents ?? new List<ReproductionEventItem>()
                    },

                    // 4. Screenshots
                    ["screenshots"] = screenshotInfos,

                    // 5. Logs
                    ["logs"] = new Dictionary<string, object?>
                    {
                        ["consoleLogs"] = entry.ConsoleLogs ?? new List<ConsoleLogItem>(),
                        ["networkFailures"] = entry.NetworkFailures ?? new List<NetworkFailureItem>()
                    }
                };

                var opts = new JsonSerializerOptions
                {
                    WriteIndented = true
                };

                var jsonText = JsonSerializer.Serialize(exportPayload, opts);
                File.WriteAllText(jsonFilePath, jsonText, Encoding.UTF8);

                return new BugExportResult
                {
                    Success = true,
                    Area = SanitizeDirectoryName(area),
                    DirectoryPath = areaDir,
                    ExportedFiles = new List<string> { jsonFilePath },
                    ExportedCount = 1,
                    CopiedScreenshots = copiedFiles
                };
            }
            catch (Exception ex)
            {
                return new BugExportResult
                {
                    Success = false,
                    Error = ex.Message
                };
            }
        }

        /// <summary>
        /// Exports multiple VisualTestTrackerEntry instances to /Bugs/<Area>/, creating individual
        /// bug JSON files and a manifest.json summary.
        /// </summary>
        public static BugExportResult ExportEntries(IEnumerable<VisualTestTrackerEntry> entries, string area, bool copyScreenshots = true)
        {
            var list = entries?.ToList() ?? new List<VisualTestTrackerEntry>();
            if (list.Count == 0)
                return new BugExportResult { Success = false, Error = "No bug entries to export." };

            try
            {
                var areaDir = GetAreaDirectory(area);
                Directory.CreateDirectory(areaDir);

                var exportedFiles = new List<string>();
                var allCopiedScreenshots = new List<string>();
                var manifestItems = new List<object>();

                foreach (var entry in list)
                {
                    var res = ExportEntry(entry, area, copyScreenshots);
                    if (res.Success && res.ExportedFiles.Count > 0)
                    {
                        exportedFiles.AddRange(res.ExportedFiles);
                        allCopiedScreenshots.AddRange(res.CopiedScreenshots);

                        manifestItems.Add(new
                        {
                            file = Path.GetFileName(res.ExportedFiles[0]),
                            uuid = entry.EntryUuid,
                            title = entry.Title,
                            severity = entry.Severity,
                            status = entry.Status,
                            pagePath = entry.PagePath,
                            createdAt = entry.CreatedAt.ToString("o")
                        });
                    }
                }

                // Write/update manifest.json
                var manifestPath = Path.Combine(areaDir, "manifest.json");
                var manifestObj = new
                {
                    area = SanitizeDirectoryName(area),
                    updatedAt = DateTime.UtcNow.ToString("o"),
                    totalBugs = manifestItems.Count,
                    bugs = manifestItems
                };
                File.WriteAllText(manifestPath, JsonSerializer.Serialize(manifestObj, new JsonSerializerOptions { WriteIndented = true }), Encoding.UTF8);
                exportedFiles.Add(manifestPath);

                return new BugExportResult
                {
                    Success = true,
                    Area = SanitizeDirectoryName(area),
                    DirectoryPath = areaDir,
                    ExportedFiles = exportedFiles,
                    ExportedCount = list.Count,
                    CopiedScreenshots = allCopiedScreenshots
                };
            }
            catch (Exception ex)
            {
                return new BugExportResult
                {
                    Success = false,
                    Error = ex.Message
                };
            }
        }

        /// <summary>
        /// Asynchronously exports a single VisualTestTrackerEntry off the UI thread with latency tracking.
        /// </summary>
        public static Task<BugExportResult> ExportEntryAsync(VisualTestTrackerEntry entry, string area, bool copyScreenshots = true, CancellationToken cancellationToken = default)
        {
            return Task.Run(() =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                var sw = Stopwatch.StartNew();
                var res = ExportEntry(entry, area, copyScreenshots);
                sw.Stop();
                if (sw.ElapsedMilliseconds > 1000)
                {
                    ActivityLog.Log("visual-test-tracker", $"Slow single-entry export: {sw.ElapsedMilliseconds}ms for {entry.Id}");
                }
                return res;
            }, cancellationToken);
        }

        /// <summary>
        /// Asynchronously exports multiple VisualTestTrackerEntry instances off the UI thread with latency tracking.
        /// </summary>
        public static Task<BugExportResult> ExportEntriesAsync(IEnumerable<VisualTestTrackerEntry> entries, string area, bool copyScreenshots = true, CancellationToken cancellationToken = default)
        {
            return Task.Run(() =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                var sw = Stopwatch.StartNew();
                var res = ExportEntries(entries, area, copyScreenshots);
                sw.Stop();
                if (sw.ElapsedMilliseconds > 1000)
                {
                    ActivityLog.Log("visual-test-tracker", $"Slow multi-entry export: {sw.ElapsedMilliseconds}ms for {res.ExportedCount} entries");
                }
                return res;
            }, cancellationToken);
        }
    }
}
