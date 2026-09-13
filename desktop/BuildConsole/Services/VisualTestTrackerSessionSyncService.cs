using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Context containing all artifacts, metadata, and telemetry gathered during a QA session.
    /// </summary>
    public sealed class SessionSyncContext
    {
        public string ProductName { get; set; } = "MSP_Console";
        public string SessionId { get; set; } = "";
        public DateTime StartedAt { get; set; } = DateTime.Now;
        public DateTime EndedAt { get; set; } = DateTime.Now;
        public TimeSpan Duration { get; set; } = TimeSpan.Zero;
        public string BaseUrl { get; set; } = "";
        public string PagePath { get; set; } = "";
        public List<string> UrlsTested { get; set; } = new();
        public List<VisualTestTrackerEntry> Entries { get; set; } = new();
        public string CurrentNotes { get; set; } = "";
        public string GlobalNotes { get; set; } = "";
        public string StepsToReproduce { get; set; } = "";
        public string ExpectedBehavior { get; set; } = "";
        public string ActualBehavior { get; set; } = "";
        public List<string> ScreenshotPaths { get; set; } = new();
        public List<ConsoleLogItem> ConsoleLogs { get; set; } = new();
        public List<NetworkFailureItem> NetworkFailures { get; set; } = new();
        public List<DevToolsRunnerService.ApiResponseResult> ApiResults { get; set; } = new();
        public List<DevToolsRunnerService.ConsoleExecutionResult> ConsoleCommandRuns { get; set; } = new();
        public List<string> ExecutedCommands { get; set; } = new();
        public List<ReproductionEventItem> ReproEvents { get; set; } = new();
        public bool IsCleanConfirmed { get; set; }
    }

    /// <summary>
    /// Result of a session finalization and Git synchronization operation.
    /// </summary>
    public sealed class SessionSyncResult
    {
        public bool Success { get; set; }
        public string? Error { get; set; }
        public string ProductName { get; set; } = "";
        public string SessionId { get; set; } = "";
        public string SessionDirectory { get; set; } = "";
        public string ReportJsonPath { get; set; } = "";
        public string SummaryMdPath { get; set; } = "";
        public int ScreenshotsCopied { get; set; }
        public int ApiCallsSaved { get; set; }
        public int BugsExported { get; set; }
        public string CommitHash { get; set; } = "";
        public string CommitMessage { get; set; } = "";
        public string ShortSummary { get; set; } = "";
        public string SummaryMarkdown { get; set; } = "";
        public bool PushedToRemote { get; set; }
        public string? PushOutput { get; set; }
    }

    /// <summary>
    /// QA HUD – Session Finalization &amp; Repo Sync Service.
    /// Gathers all session artifacts, structures them under /Bugs/&lt;ProductName&gt;/&lt;SessionId&gt;/,
    /// authors report.json &amp; summary.md, stages the session folder, and commits &amp; pushes to Git.
    /// </summary>
    public static class VisualTestTrackerSessionSyncService
    {
        /// <summary>
        /// Generates a standardized Session ID string (timestamp based, e.g. '2026-09-13-1327').
        /// </summary>
        public static string GenerateSessionId(DateTime? timestamp = null)
        {
            var dt = timestamp ?? DateTime.Now;
            return dt.ToString("yyyy-MM-dd-HHmm");
        }

        /// <summary>
        /// Generates the short 1-2 sentence summary line for the commit message.
        /// </summary>
        public static string GenerateShortSummary(SessionSyncContext context)
        {
            int bugCount = context.Entries.Count;
            var distinctUrls = context.UrlsTested.Distinct().ToList();
            if (distinctUrls.Count == 0 && !string.IsNullOrWhiteSpace(context.BaseUrl))
            {
                distinctUrls.Add($"{context.BaseUrl}{context.PagePath}");
            }

            string pagesSummary;
            if (distinctUrls.Count <= 1)
            {
                string p = !string.IsNullOrWhiteSpace(context.PagePath) ? context.PagePath : "/";
                pagesSummary = $"Tested page {p}";
            }
            else
            {
                pagesSummary = $"Tested {distinctUrls.Count} pages ({string.Join(", ", distinctUrls.Take(3).Select(u => Path.GetFileName(u)))}...)";
            }

            string bugSummary = bugCount switch
            {
                0 => context.IsCleanConfirmed ? "Confirmed clean (0 issues)." : "Found 0 issues.",
                1 => "Found 1 issue.",
                _ => $"Found {bugCount} issues."
            };

            return $"{pagesSummary}. {bugSummary}";
        }

        /// <summary>
        /// Generates the full two-line commit message:
        /// QA Session &lt;SessionId&gt; – &lt;ProductName&gt;
        /// &lt;Short Summary Line&gt;
        /// </summary>
        public static string GenerateCommitMessage(SessionSyncContext context)
        {
            string shortSummary = GenerateShortSummary(context);
            return $"QA Session {context.SessionId} – {context.ProductName}\n{shortSummary}";
        }

        /// <summary>
        /// Generates a human-readable summary Markdown document designed for Claude via MCP Git tools.
        /// </summary>
        public static string GenerateSummaryMarkdown(SessionSyncContext context)
        {
            var sb = new StringBuilder();
            sb.AppendLine($"# QA Session Summary – {context.ProductName}");
            sb.AppendLine();
            sb.AppendLine($"> **Session ID**: `{context.SessionId}`  ");
            sb.AppendLine($"> **Date**: {context.StartedAt:yyyy-MM-dd HH:mm:ss} – {context.EndedAt:HH:mm:ss}  ");
            sb.AppendLine($"> **Duration**: {context.Duration.Minutes:D2}m {context.Duration.Seconds:D2}s ({Math.Round(context.Duration.TotalSeconds)} seconds)  ");
            sb.AppendLine($"> **Overall Assessment**: {(context.Entries.Count == 0 && context.IsCleanConfirmed ? "✅ PASS / Clean Run" : context.Entries.Count == 0 ? "ℹ️ No Bugs Recorded" : $"⚠️ {context.Entries.Count} Issues Requiring Attention")}  ");
            sb.AppendLine();

            // 1. Executive Summary
            sb.AppendLine("## Executive Summary");
            sb.AppendLine(GenerateShortSummary(context));
            sb.AppendLine();

            // 2. Pages / Routes Tested
            sb.AppendLine("## Pages & Endpoints Tested");
            var urls = context.UrlsTested.Distinct().ToList();
            if (urls.Count == 0 && !string.IsNullOrEmpty(context.BaseUrl))
            {
                urls.Add($"{context.BaseUrl}{context.PagePath}");
            }
            if (urls.Count > 0)
            {
                foreach (var u in urls) sb.AppendLine($"- `{u}`");
            }
            else
            {
                sb.AppendLine("- `(No navigation events recorded)`");
            }
            sb.AppendLine();

            // 3. Bugs & Observations
            sb.AppendLine($"## Bugs & Issues Logged ({context.Entries.Count})");
            if (context.Entries.Count > 0)
            {
                sb.AppendLine("| # | Severity | Status | Title / Description | Steps | Shots |");
                sb.AppendLine("|---|---|---|---|---|---|");
                int idx = 1;
                foreach (var b in context.Entries)
                {
                    string title = !string.IsNullOrWhiteSpace(b.Title)
                        ? b.Title
                        : (!string.IsNullOrWhiteSpace(b.Notes) ? b.Notes.Split('\n')[0].Trim() : "Visual Observation");
                    if (title.Length > 45) title = title.Substring(0, 42) + "...";

                    int shotCount = b.ScreenshotPaths?.Count ?? 0;
                    bool hasSteps = !string.IsNullOrWhiteSpace(b.StepsToReproduce);

                    sb.AppendLine($"| {idx++} | **{b.Severity}** | {b.Status} | {EscapeMarkdownTable(title)} | {(hasSteps ? "Yes" : "No")} | {shotCount} |");
                }
                sb.AppendLine();

                // Detailed bug entries
                foreach (var b in context.Entries)
                {
                    string title = !string.IsNullOrWhiteSpace(b.Title) ? b.Title : b.Notes.Split('\n')[0].Trim();
                    sb.AppendLine($"### [{b.Severity.ToUpperInvariant()}] {title}");
                    if (!string.IsNullOrWhiteSpace(b.CurrentUrl)) sb.AppendLine($"- **URL**: `{b.CurrentUrl}`");
                    if (b.Tags != null && b.Tags.Count > 0) sb.AppendLine($"- **Tags**: {string.Join(", ", b.Tags.Select(t => $"`{t}`"))}");
                    if (!string.IsNullOrWhiteSpace(b.Notes))
                    {
                        sb.AppendLine("\n**Notes**:");
                        sb.AppendLine(b.Notes);
                    }
                    if (!string.IsNullOrWhiteSpace(b.StepsToReproduce))
                    {
                        sb.AppendLine("\n**Steps to Reproduce**:");
                        sb.AppendLine(b.StepsToReproduce);
                    }
                    if (!string.IsNullOrWhiteSpace(b.ExpectedBehavior) || !string.IsNullOrWhiteSpace(b.ActualBehavior))
                    {
                        sb.AppendLine("\n**Expected vs Actual**:");
                        if (!string.IsNullOrWhiteSpace(b.ExpectedBehavior)) sb.AppendLine($"- **Expected**: {b.ExpectedBehavior}");
                        if (!string.IsNullOrWhiteSpace(b.ActualBehavior)) sb.AppendLine($"- **Actual**: {b.ActualBehavior}");
                    }
                    sb.AppendLine();
                }
            }
            else
            {
                sb.AppendLine("No bug entries were filed during this test session.");
                sb.AppendLine();
            }

            // 4. Console Errors & Telemetry Diagnostics
            var errors = context.ConsoleLogs.Where(l => l.Level == "error" || l.Level == "exception" || l.Level == "unhandledrejection").ToList();
            var warnings = context.ConsoleLogs.Where(l => l.Level == "warn").ToList();
            sb.AppendLine($"## Console & Script Diagnostics");
            sb.AppendLine($"- **Errors**: {errors.Count}");
            sb.AppendLine($"- **Warnings**: {warnings.Count}");
            sb.AppendLine($"- **Total Console Logs**: {context.ConsoleLogs.Count}");
            if (errors.Count > 0)
            {
                sb.AppendLine("\n### Key Errors Captured:");
                foreach (var err in errors.Take(10))
                {
                    sb.AppendLine($"- `[{err.Timestamp}]` {err.Message}");
                    if (!string.IsNullOrEmpty(err.StackTrace))
                    {
                        sb.AppendLine("  ```text");
                        sb.AppendLine("  " + err.StackTrace.Replace("\n", "\n  "));
                        sb.AppendLine("  ```");
                    }
                }
                if (errors.Count > 10) sb.AppendLine($"- ...and {errors.Count - 10} more errors (see `console/console.json`).");
            }
            sb.AppendLine();

            // 5. API Executions & Network Failures
            sb.AppendLine("## Network & API Activity");
            sb.AppendLine($"- **API Calls Executed (Runner)**: {context.ApiResults.Count}");
            sb.AppendLine($"- **Network Failures Captured**: {context.NetworkFailures.Count}");
            if (context.ApiResults.Count > 0)
            {
                sb.AppendLine("\n### API Runner Calls:");
                foreach (var api in context.ApiResults)
                {
                    string statusBadge = api.IsSuccess ? $"✅ {api.StatusCode}" : $"❌ {api.StatusCode} {api.StatusText}";
                    sb.AppendLine($"- `{api.Method}` `{api.Url}` &rarr; {statusBadge} ({api.DurationMs} ms, {api.SizeBytes} bytes)");
                }
            }
            if (context.NetworkFailures.Count > 0)
            {
                sb.AppendLine("\n### Network Failures / Drops:");
                foreach (var net in context.NetworkFailures.Take(10))
                {
                    sb.AppendLine($"- `{net.Method}` `{net.Url}` &rarr; **{net.Status} {net.StatusText}** ({net.DurationMs} ms)");
                }
            }
            sb.AppendLine();

            // 6. Commands Executed
            sb.AppendLine("## JavaScript Commands Executed");
            if (context.ExecutedCommands.Count > 0)
            {
                foreach (var cmd in context.ExecutedCommands.Distinct())
                {
                    sb.AppendLine($"- `{cmd}`");
                }
            }
            else
            {
                sb.AppendLine("- None.");
            }
            sb.AppendLine();

            // 7. Screenshots
            sb.AppendLine($"## Screenshots Captured ({context.ScreenshotPaths.Count})");
            if (context.ScreenshotPaths.Count > 0)
            {
                for (int i = 0; i < context.ScreenshotPaths.Count; i++)
                {
                    string fname = Path.GetFileName(context.ScreenshotPaths[i]);
                    sb.AppendLine($"- [{fname}](screenshots/{fname})");
                }
            }
            else
            {
                sb.AppendLine("- No screenshots attached.");
            }
            sb.AppendLine();

            // 8. Session Notes & General Observations
            if (!string.IsNullOrWhiteSpace(context.CurrentNotes) || !string.IsNullOrWhiteSpace(context.GlobalNotes))
            {
                sb.AppendLine("## Notes & Observations");
                if (!string.IsNullOrWhiteSpace(context.CurrentNotes))
                {
                    sb.AppendLine("### Active Page Notes");
                    sb.AppendLine(context.CurrentNotes);
                    sb.AppendLine();
                }
                if (!string.IsNullOrWhiteSpace(context.GlobalNotes))
                {
                    sb.AppendLine("### Global Testing Notes");
                    sb.AppendLine(context.GlobalNotes);
                    sb.AppendLine();
                }
            }

            // 9. Claude Recommendations
            sb.AppendLine("## Recommendations for Claude");
            if (context.Entries.Count > 0)
            {
                sb.AppendLine("1. Review each reported bug above, cross-referencing reproduction steps and console logs.");
                sb.AppendLine("2. Inspect `report.json` for structured telemetry, stack traces, and viewport details.");
                sb.AppendLine("3. Address high-severity bugs first before running regression verification.");
            }
            else
            {
                sb.AppendLine("1. All tested features and pages completed without user-reported regressions.");
                sb.AppendLine("2. Refer to `summary.md` and `console/console.json` to ensure clean baseline parity.");
            }

            return sb.ToString();
        }

        /// <summary>
        /// Writes all session artifacts to /Bugs/&lt;ProductName&gt;/&lt;SessionId&gt;/.
        /// </summary>
        public static SessionSyncResult WriteSessionFiles(SessionSyncContext context, string repoRoot)
        {
            var result = new SessionSyncResult
            {
                ProductName = context.ProductName,
                SessionId = context.SessionId,
                ShortSummary = GenerateShortSummary(context),
                SummaryMarkdown = GenerateSummaryMarkdown(context),
                CommitMessage = GenerateCommitMessage(context)
            };

            try
            {
                // Root session directory: Bugs/<ProductName>/<SessionId>/ (or Bug/<ProductName>/<SessionId>/)
                string bugsFolder = Directory.Exists(Path.Combine(repoRoot, "Bug")) && !Directory.Exists(Path.Combine(repoRoot, "Bugs")) ? "Bug" : "Bugs";
                string sessionRelDir = Path.Combine(bugsFolder, VisualTestTrackerExportService.SanitizeDirectoryName(context.ProductName), context.SessionId);
                string sessionAbsDir = Path.Combine(repoRoot, sessionRelDir);

                string screenshotsDir = Path.Combine(sessionAbsDir, "screenshots");
                string consoleDir = Path.Combine(sessionAbsDir, "console");
                string apiDir = Path.Combine(sessionAbsDir, "api");
                string notesDir = Path.Combine(sessionAbsDir, "notes");
                string attachmentsDir = Path.Combine(sessionAbsDir, "attachments");

                Directory.CreateDirectory(sessionAbsDir);
                Directory.CreateDirectory(screenshotsDir);
                Directory.CreateDirectory(consoleDir);
                Directory.CreateDirectory(apiDir);
                Directory.CreateDirectory(notesDir);
                Directory.CreateDirectory(attachmentsDir);

                result.SessionDirectory = sessionAbsDir;

                // 1. Copy Screenshots into /screenshots/
                var relativeScreenshotPaths = new List<string>();
                int shotIndex = 1;
                foreach (var origPath in context.ScreenshotPaths)
                {
                    if (string.IsNullOrWhiteSpace(origPath) || !File.Exists(origPath)) continue;

                    string ext = Path.GetExtension(origPath);
                    if (string.IsNullOrEmpty(ext)) ext = ".png";

                    string destFileName = $"screenshot-{shotIndex:D2}{ext}";
                    string destPath = Path.Combine(screenshotsDir, destFileName);

                    try
                    {
                        File.Copy(origPath, destPath, overwrite: true);
                        relativeScreenshotPaths.Add($"screenshots/{destFileName}");
                        result.ScreenshotsCopied++;
                        shotIndex++;
                    }
                    catch { }
                }

                // Also copy screenshots from bug entries if not already included
                foreach (var entry in context.Entries)
                {
                    if (entry.ScreenshotPaths != null)
                    {
                        foreach (var origPath in entry.ScreenshotPaths)
                        {
                            if (string.IsNullOrWhiteSpace(origPath) || !File.Exists(origPath)) continue;
                            if (context.ScreenshotPaths.Contains(origPath)) continue;

                            string ext = Path.GetExtension(origPath);
                            if (string.IsNullOrEmpty(ext)) ext = ".png";
                            string destFileName = $"screenshot-{shotIndex:D2}{ext}";
                            string destPath = Path.Combine(screenshotsDir, destFileName);

                            try
                            {
                                File.Copy(origPath, destPath, overwrite: true);
                                relativeScreenshotPaths.Add($"screenshots/{destFileName}");
                                result.ScreenshotsCopied++;
                                shotIndex++;
                            }
                            catch { }
                        }
                    }
                }

                // 2. Write /console/console.json
                string consoleJsonPath = Path.Combine(consoleDir, "console.json");
                var consolePayload = new
                {
                    sessionId = context.SessionId,
                    capturedAt = DateTime.Now,
                    totalLogs = context.ConsoleLogs.Count,
                    errorCount = context.ConsoleLogs.Count(l => l.Level == "error" || l.Level == "exception" || l.Level == "unhandledrejection"),
                    warningCount = context.ConsoleLogs.Count(l => l.Level == "warn"),
                    logs = context.ConsoleLogs
                };
                File.WriteAllText(consoleJsonPath, JsonSerializer.Serialize(consolePayload, new JsonSerializerOptions { WriteIndented = true }));

                // 3. Write /api/<Name>.json for each API call
                int apiIdx = 1;
                foreach (var api in context.ApiResults)
                {
                    string safeEndpoint = "api-call";
                    if (!string.IsNullOrEmpty(api.Url))
                    {
                        try
                        {
                            var uri = new Uri(api.Url, UriKind.RelativeOrAbsolute);
                            string pathPart = uri.IsAbsoluteUri ? uri.AbsolutePath : api.Url;
                            safeEndpoint = VisualTestTrackerExportService.MakeSlug(pathPart, 30);
                        }
                        catch
                        {
                            safeEndpoint = VisualTestTrackerExportService.MakeSlug(api.Url, 30);
                        }
                    }
                    string apiFileName = $"{apiIdx:D2}-{api.Method.ToLowerInvariant()}-{safeEndpoint}.json";
                    string apiFilePath = Path.Combine(apiDir, apiFileName);

                    var apiDoc = new
                    {
                        index = apiIdx,
                        method = api.Method,
                        url = api.Url,
                        statusCode = api.StatusCode,
                        statusText = api.StatusText,
                        durationMs = api.DurationMs,
                        sizeBytes = api.SizeBytes,
                        headers = api.Headers,
                        prettyJson = api.PrettyJson,
                        rawBody = api.RawBody,
                        errorMessage = api.ErrorMessage,
                        executedSnippet = api.ExecutedSnippet
                    };
                    File.WriteAllText(apiFilePath, JsonSerializer.Serialize(apiDoc, new JsonSerializerOptions { WriteIndented = true }));
                    result.ApiCallsSaved++;
                    apiIdx++;
                }

                // Also save any network failures as API failure records if not covered
                foreach (var net in context.NetworkFailures)
                {
                    string safeEndpoint = VisualTestTrackerExportService.MakeSlug(net.Url, 30);
                    string apiFileName = $"fail-{apiIdx:D2}-{net.Method.ToLowerInvariant()}-{safeEndpoint}.json";
                    string apiFilePath = Path.Combine(apiDir, apiFileName);

                    if (!File.Exists(apiFilePath))
                    {
                        var failDoc = new
                        {
                            index = apiIdx,
                            method = net.Method,
                            url = net.Url,
                            statusCode = net.Status,
                            statusText = net.StatusText,
                            durationMs = net.DurationMs,
                            payloadSize = net.PayloadSize,
                            timestamp = net.Timestamp,
                            failed = net.Failed
                        };
                        File.WriteAllText(apiFilePath, JsonSerializer.Serialize(failDoc, new JsonSerializerOptions { WriteIndented = true }));
                        result.ApiCallsSaved++;
                        apiIdx++;
                    }
                }

                // 4. Write /notes/notes.md
                string notesMdPath = Path.Combine(notesDir, "notes.md");
                var notesSb = new StringBuilder();
                notesSb.AppendLine($"# QA Session Notes – {context.ProductName} ({context.SessionId})\n");
                if (!string.IsNullOrWhiteSpace(context.CurrentNotes))
                {
                    notesSb.AppendLine("## Active Page Notes");
                    notesSb.AppendLine(context.CurrentNotes);
                    notesSb.AppendLine();
                }
                if (!string.IsNullOrWhiteSpace(context.GlobalNotes))
                {
                    notesSb.AppendLine("## Global Notes");
                    notesSb.AppendLine(context.GlobalNotes);
                    notesSb.AppendLine();
                }
                if (!string.IsNullOrWhiteSpace(context.StepsToReproduce))
                {
                    notesSb.AppendLine("## Steps to Reproduce (Session Draft)");
                    notesSb.AppendLine(context.StepsToReproduce);
                    notesSb.AppendLine();
                }
                if (!string.IsNullOrWhiteSpace(context.ExpectedBehavior) || !string.IsNullOrWhiteSpace(context.ActualBehavior))
                {
                    notesSb.AppendLine("## Expected vs Actual Observations");
                    if (!string.IsNullOrWhiteSpace(context.ExpectedBehavior)) notesSb.AppendLine($"- **Expected**: {context.ExpectedBehavior}");
                    if (!string.IsNullOrWhiteSpace(context.ActualBehavior)) notesSb.AppendLine($"- **Actual**: {context.ActualBehavior}");
                    notesSb.AppendLine();
                }
                File.WriteAllText(notesMdPath, notesSb.ToString());

                // 5. Write /summary.md
                string summaryMdPath = Path.Combine(sessionAbsDir, "summary.md");
                File.WriteAllText(summaryMdPath, result.SummaryMarkdown);
                result.SummaryMdPath = summaryMdPath;

                // 6. Write /report.json (Primary Structured Test Artifact)
                string reportJsonPath = Path.Combine(sessionAbsDir, "report.json");
                var reportPayload = new
                {
                    schemaVersion = "1.0",
                    productName = context.ProductName,
                    sessionId = context.SessionId,
                    timing = new
                    {
                        startedAt = context.StartedAt,
                        endedAt = context.EndedAt,
                        durationSeconds = Math.Round(context.Duration.TotalSeconds, 1),
                        formattedDuration = $"{context.Duration.Minutes:D2}m {context.Duration.Seconds:D2}s"
                    },
                    environment = new
                    {
                        baseUrl = context.BaseUrl,
                        activePage = context.PagePath,
                        urlsTested = context.UrlsTested.Distinct().ToList(),
                    },
                    summary = new
                    {
                        assessment = context.Entries.Count == 0 && context.IsCleanConfirmed ? "Clean" : (context.Entries.Count == 0 ? "Informational" : "Issues Found"),
                        totalBugs = context.Entries.Count,
                        blockers = context.Entries.Count(e => e.Severity == "Blocker"),
                        critical = context.Entries.Count(e => e.Severity == "Critical"),
                        bugs = context.Entries.Count(e => e.Severity == "Bug"),
                        minor = context.Entries.Count(e => e.Severity != "Blocker" && e.Severity != "Critical" && e.Severity != "Bug"),
                        consoleErrors = context.ConsoleLogs.Count(l => l.Level == "error" || l.Level == "exception" || l.Level == "unhandledrejection"),
                        networkFailures = context.NetworkFailures.Count,
                        screenshotsCaptured = result.ScreenshotsCopied,
                        apiCalls = result.ApiCallsSaved
                    },
                    bugs = context.Entries.Select((b, idx) => new
                    {
                        index = idx + 1,
                        id = b.Id,
                        uuid = b.EntryUuid,
                        severity = b.Severity,
                        status = b.Status,
                        title = b.Title,
                        notes = b.Notes,
                        stepsToReproduce = b.StepsToReproduce,
                        expectedBehavior = b.ExpectedBehavior,
                        actualBehavior = b.ActualBehavior,
                        tags = b.Tags,
                        url = b.CurrentUrl,
                        pageTitle = b.PageTitle,
                        browserVersion = b.BrowserVersion,
                        osVersion = b.OsVersion,
                        windowSize = b.WindowSize,
                        viewportSize = b.ViewportSize,
                        userAgent = b.UserAgent,
                        createdAt = b.CreatedAt,
                        performance = b.Performance,
                        screenshots = b.ScreenshotPaths != null ? b.ScreenshotPaths.Select(p => Path.GetFileName(p)).ToList() : new List<string>()
                    }),
                    consoleErrors = context.ConsoleLogs.Where(l => l.Level == "error" || l.Level == "exception" || l.Level == "unhandledrejection").ToList(),
                    commandsExecuted = context.ExecutedCommands.Distinct().ToList(),
                    screenshots = relativeScreenshotPaths,
                    artifacts = new
                    {
                        summaryMarkdown = "summary.md",
                        consoleJson = "console/console.json",
                        notesMarkdown = "notes/notes.md",
                        apiDirectory = "api/",
                        screenshotsDirectory = "screenshots/",
                        attachmentsDirectory = "attachments/"
                    }
                };

                File.WriteAllText(reportJsonPath, JsonSerializer.Serialize(reportPayload, new JsonSerializerOptions { WriteIndented = true }));
                result.ReportJsonPath = reportJsonPath;
                result.BugsExported = context.Entries.Count;
                result.Success = true;
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.Error = $"Failed to write session files: {ex.Message}";
            }

            return result;
        }

        /// <summary>
        /// Stages the session files, creates the formatted Git commit, and optionally pushes to the current branch.
        /// </summary>
        public static async Task<SessionSyncResult> ExecuteGitSyncAsync(SessionSyncContext context, string repoRoot, bool pushToRemote = true)
        {
            long startMemory = GC.GetTotalMemory(false);
            var totalSw = Stopwatch.StartNew();

            // 1. Write all session files off UI thread
            var writeSw = Stopwatch.StartNew();
            var result = await Task.Run(() => WriteSessionFiles(context, repoRoot));
            writeSw.Stop();
            if (writeSw.ElapsedMilliseconds > 1000)
            {
                ActivityLog.Log("visual-test-tracker", $"Slow session disk write: WriteSessionFiles took {writeSw.ElapsedMilliseconds}ms for session {context.SessionId}");
            }
            if (!result.Success) return result;

            string bugsFolder = Directory.Exists(Path.Combine(repoRoot, "Bug")) && !Directory.Exists(Path.Combine(repoRoot, "Bugs")) ? "Bug" : "Bugs";
            string relDir = Path.Combine(bugsFolder, VisualTestTrackerExportService.SanitizeDirectoryName(context.ProductName), context.SessionId).Replace('\\', '/');

            // 2. git add <relDir>
            var addSw = Stopwatch.StartNew();
            var addRes = await RunGitAsync(repoRoot, $"add \"{relDir}\"");
            addSw.Stop();
            if (addSw.ElapsedMilliseconds > 1000)
            {
                ActivityLog.Log("visual-test-tracker", $"Slow git add: {addSw.ElapsedMilliseconds}ms for {relDir}");
            }
            if (addRes.ExitCode != 0)
            {
                result.Success = false;
                result.Error = $"git add failed: {addRes.StdErr}";
                return result;
            }

            // 3. git commit
            var lines = (result.CommitMessage ?? "").Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
            string mArgs = lines.Length > 0
                ? string.Join(" ", lines.Select(l => $"-m \"{l.Replace("\"", "\\\"")}\""))
                : $"-m \"QA Session {context.SessionId} – {context.ProductName}\"";
            var commitSw = Stopwatch.StartNew();
            var commitRes = await RunGitAsync(repoRoot, $"commit {mArgs}");
            commitSw.Stop();
            if (commitSw.ElapsedMilliseconds > 1000)
            {
                ActivityLog.Log("visual-test-tracker", $"Slow git commit: {commitSw.ElapsedMilliseconds}ms");
            }
            if (commitRes.ExitCode != 0)
            {
                // Check if nothing to commit (e.g. already committed)
                if (commitRes.StdOut.Contains("nothing to commit") || commitRes.StdErr.Contains("nothing to commit"))
                {
                    result.CommitMessage = "Already committed.";
                }
                else
                {
                    result.Success = false;
                    result.Error = $"git commit failed: {commitRes.StdErr}";
                    return result;
                }
            }

            // 4. Query current commit hash
            var revRes = await RunGitAsync(repoRoot, "rev-parse --short HEAD");
            if (revRes.ExitCode == 0)
            {
                result.CommitHash = revRes.StdOut.Trim();
            }

            // 5. git push (if requested)
            if (pushToRemote)
            {
                var pushSw = Stopwatch.StartNew();
                // Query current branch
                var branchRes = await RunGitAsync(repoRoot, "rev-parse --abbrev-ref HEAD");
                string currentBranch = branchRes.ExitCode == 0 ? branchRes.StdOut.Trim() : "main";

                var pushRes = await RunGitAsync(repoRoot, $"push origin {currentBranch}", timeoutMs: 30000);
                if (pushRes.ExitCode == 0)
                {
                    result.PushedToRemote = true;
                    result.PushOutput = pushRes.StdOut.Trim();
                }
                else
                {
                    // If origin push failed, try plain 'git push'
                    var plainPush = await RunGitAsync(repoRoot, "push", timeoutMs: 30000);
                    if (plainPush.ExitCode == 0)
                    {
                        result.PushedToRemote = true;
                        result.PushOutput = plainPush.StdOut.Trim();
                    }
                    else
                    {
                        result.PushedToRemote = false;
                        result.PushOutput = !string.IsNullOrWhiteSpace(pushRes.StdErr) ? pushRes.StdErr.Trim() : plainPush.StdErr.Trim();
                        // Note: We do NOT fail the entire operation if push fails (e.g. offline or auth); commit is safely local!
                    }
                }
                pushSw.Stop();
                if (pushSw.ElapsedMilliseconds > 1000)
                {
                    ActivityLog.Log("visual-test-tracker", $"Slow git push: {pushSw.ElapsedMilliseconds}ms");
                }
            }

            totalSw.Stop();
            long endMemory = GC.GetTotalMemory(false);
            long memDeltaMb = (endMemory - startMemory) / (1024 * 1024);
            ActivityLog.Log("visual-test-tracker", $"Session sync performance: total={totalSw.ElapsedMilliseconds}ms, memory delta={memDeltaMb}MB (start: {startMemory / (1024 * 1024)}MB, end: {endMemory / (1024 * 1024)}MB)");

            result.Success = true;
            return result;
        }

        private static async Task<(int ExitCode, string StdOut, string StdErr)> RunGitAsync(string workingDir, string arguments, int timeoutMs = 20000)
        {
            var psi = new ProcessStartInfo("git", arguments)
            {
                WorkingDirectory = workingDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var proc = new Process { StartInfo = psi };
            try
            {
                proc.Start();
                var stdoutTask = proc.StandardOutput.ReadToEndAsync();
                var stderrTask = proc.StandardError.ReadToEndAsync();
                var exited = await Task.Run(() => proc.WaitForExit(timeoutMs));

                if (!exited)
                {
                    try { proc.Kill(entireProcessTree: true); } catch { }
                    return (-1, "", $"git {arguments} timed out after {timeoutMs}ms");
                }

                return (proc.ExitCode, await stdoutTask, await stderrTask);
            }
            catch (Exception ex)
            {
                return (-1, "", ex.Message);
            }
        }

        private static string EscapeMarkdownTable(string text) =>
            text.Replace("|", "\\|").Replace("\r", " ").Replace("\n", " ").Trim();
    }
}
