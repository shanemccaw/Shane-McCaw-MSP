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
    /// Step executed during an automated UI test run.
    /// </summary>
    public sealed class AutomationStepItem
    {
        public int Index { get; set; }
        public string Action { get; set; } = string.Empty;
        public string Selector { get; set; } = string.Empty;
        public string TargetUrl { get; set; } = string.Empty;
        public string Expected { get; set; } = string.Empty;
        public string Actual { get; set; } = string.Empty;
        public bool Passed { get; set; }
        public long DurationMs { get; set; }
        public string Detail { get; set; } = string.Empty;
        public string? ScreenshotPath { get; set; }
        public string? DomSnapshotPath { get; set; }
    }

    /// <summary>
    /// Visual screenshot difference detected against baseline.
    /// </summary>
    public sealed class AutomationScreenshotDiffItem
    {
        public int StepIndex { get; set; }
        public string StepLabel { get; set; } = string.Empty;
        public string CurrentImagePath { get; set; } = string.Empty;
        public string BaselineImagePath { get; set; } = string.Empty;
        public string DiffImagePath { get; set; } = string.Empty;
        public double DifferencePercent { get; set; }
        public bool HasDiff { get; set; }
    }

    /// <summary>
    /// Context containing all artifacts, telemetry, and execution details of an automated UI test run.
    /// </summary>
    public sealed class AutomationQaSessionContext
    {
        public string TestName { get; set; } = "Automated UI Test";
        public string ProductName { get; set; } = "MSP_Console";
        public string SessionId { get; set; } = string.Empty;
        public DateTime StartedAt { get; set; } = DateTime.Now;
        public DateTime EndedAt { get; set; } = DateTime.Now;
        public TimeSpan Duration { get; set; } = TimeSpan.Zero;
        public bool Success { get; set; }
        public string ShortSummary { get; set; } = string.Empty;
        public string Recommendations { get; set; } = string.Empty;
        public string TargetUrl { get; set; } = string.Empty;
        public string ExpectedOutcome { get; set; } = string.Empty;

        public List<string> UrlsVisited { get; set; } = new();
        public List<AutomationStepItem> Steps { get; set; } = new();
        public List<ConsoleLogItem> ConsoleErrors { get; set; } = new();
        public List<AutomationApiFailureItem> ApiFailures { get; set; } = new();
        public List<string> ScreenshotPaths { get; set; } = new();
        public List<AutomationScreenshotDiffItem> ScreenshotDiffs { get; set; } = new();
        public List<AutomationDomDiffItem> DomDiffs { get; set; } = new();
        public List<DevToolsRunnerService.ConsoleExecutionResult> ExecutedCommands { get; set; } = new();
        public List<DevToolsRunnerService.ApiResponseResult> ExecutedApiCalls { get; set; } = new();
    }

    /// <summary>
    /// Result of an automated QA session finalization and Git synchronization.
    /// </summary>
    public sealed class AutomationSyncResult
    {
        public bool Success { get; set; }
        public string? Error { get; set; }
        public string ProductName { get; set; } = string.Empty;
        public string SessionId { get; set; } = string.Empty;
        public string AutomationDirectory { get; set; } = string.Empty;
        public string ReportJsonPath { get; set; } = string.Empty;
        public string SummaryMdPath { get; set; } = string.Empty;
        public int ScreenshotsSaved { get; set; }
        public int DomSnapshotsSaved { get; set; }
        public int ConsoleErrorsCaptured { get; set; }
        public int ApiFailuresCaptured { get; set; }
        public string CommitHash { get; set; } = string.Empty;
        public string CommitMessage { get; set; } = string.Empty;
    }

    /// <summary>
    /// UI Automation Tool – QA HUD Feature Integration Service.
    /// Packages automated UI test runs into rich, structured artifacts under /Bugs/<ProductName>/<SessionId>/automation/
    /// mirroring the QA HUD format for build agents and Claude MCP Git tooling.
    /// </summary>
    public static class UiAutomationQaSessionService
    {
        private const string Channel = "testing.automation-session";

        public static string GenerateSessionId() => DateTime.Now.ToString("yyyy-MM-dd-HHmm");

        /// <summary>
        /// Saves all automated test artifacts and optionally commits and pushes to Git.
        /// </summary>
        public static async Task<AutomationSyncResult> FinalizeAutomationSessionAsync(
            AutomationQaSessionContext context,
            bool commitToGit = true,
            bool pushToRemote = false,
            string? repoRoot = null)
        {
            if (context == null) throw new ArgumentNullException(nameof(context));

            repoRoot ??= VisualTestTrackerExportService.ResolveRepoRoot();

            if (string.IsNullOrWhiteSpace(context.SessionId))
            {
                context.SessionId = GenerateSessionId();
            }

            if (string.IsNullOrWhiteSpace(context.ProductName))
            {
                string firstUrl = context.UrlsVisited.FirstOrDefault() ?? string.Empty;
                context.ProductName = VisualTestTrackerExportService.DetectArea(firstUrl, null);
            }

            string cleanProduct = VisualTestTrackerExportService.SanitizeDirectoryName(context.ProductName);
            string automationDir = Path.Combine(repoRoot, "Bugs", cleanProduct, context.SessionId, "automation");

            var result = new AutomationSyncResult
            {
                ProductName = cleanProduct,
                SessionId = context.SessionId,
                AutomationDirectory = automationDir
            };

            long startMemory = GC.GetTotalMemory(false);
            var totalSw = Stopwatch.StartNew();

            try
            {
                var ioSw = Stopwatch.StartNew();
                await Task.Run(() =>
                {
                    Directory.CreateDirectory(automationDir);
                    string screenshotsDir = Path.Combine(automationDir, "screenshots");
                    string domDir = Path.Combine(automationDir, "dom");
                    string apiDir = Path.Combine(automationDir, "api");

                    Directory.CreateDirectory(screenshotsDir);
                    Directory.CreateDirectory(domDir);
                    Directory.CreateDirectory(apiDir);

                    // 1. Copy and bundle screenshots
                    var relativeScreenshots = new List<string>();
                    int shotIndex = 1;
                    foreach (var src in context.ScreenshotPaths)
                    {
                        if (string.IsNullOrWhiteSpace(src) || !File.Exists(src)) continue;
                        try
                        {
                            string ext = Path.GetExtension(src);
                            if (string.IsNullOrEmpty(ext)) ext = ".png";
                            string destFileName = $"screenshot-{shotIndex:D2}{ext}";
                            string destPath = Path.Combine(screenshotsDir, destFileName);
                            File.Copy(src, destPath, overwrite: true);
                            relativeScreenshots.Add($"screenshots/{destFileName}");
                            shotIndex++;
                        }
                        catch (Exception ex)
                        {
                            ActivityLog.Log(Channel, $"Screenshot copy error: {ex.Message}");
                        }
                    }
                    result.ScreenshotsSaved = relativeScreenshots.Count;

                    // 2. Save individual API failure JSON files
                    int apiCount = 0;
                    foreach (var api in context.ApiFailures)
                    {
                        try
                        {
                            string slug = VisualTestTrackerExportService.MakeSlug(api.Name);
                            string apiFileName = $"{apiCount + 1:D2}-{slug}.json";
                            string apiFilePath = Path.Combine(apiDir, apiFileName);

                            var apiData = new
                            {
                                name = api.Name,
                                method = api.Method,
                                requestUrl = api.RequestUrl,
                                statusCode = api.StatusCode,
                                durationMs = api.DurationMs,
                                reason = api.Reason,
                                requestHeaders = api.RequestHeaders,
                                responseHeaders = api.ResponseHeaders,
                                responseBody = api.ResponseBody,
                                timestamp = api.Timestamp.ToString("o")
                            };

                            File.WriteAllText(apiFilePath, JsonSerializer.Serialize(apiData, new JsonSerializerOptions { WriteIndented = true }));
                            apiCount++;
                        }
                        catch (Exception ex)
                        {
                            ActivityLog.Log(Channel, $"API failure file write error: {ex.Message}");
                        }
                    }
                    result.ApiFailuresCaptured = apiCount;

                    // 3. Save DOM diff snapshots into dom/
                    int domCount = 0;
                    foreach (var diff in context.DomDiffs)
                    {
                        try
                        {
                            string domFileName = $"dom-step-{diff.StepIndex:D2}.json";
                            string domFilePath = Path.Combine(domDir, domFileName);
                            File.WriteAllText(domFilePath, JsonSerializer.Serialize(diff, new JsonSerializerOptions { WriteIndented = true }));
                            diff.SnapshotPath = $"dom/{domFileName}";
                            domCount++;
                        }
                        catch (Exception ex)
                        {
                            ActivityLog.Log(Channel, $"DOM snapshot write error: {ex.Message}");
                        }
                    }
                    result.DomSnapshotsSaved = domCount;

                    // 4. Save console.json (capturing console errors only)
                    string consoleJsonPath = Path.Combine(automationDir, "console.json");
                    var consoleErrorsExport = context.ConsoleErrors.Select(c => new
                    {
                        level = c.Level,
                        message = c.Message,
                        stack = c.StackTrace,
                        timestamp = c.Timestamp
                    }).ToList();

                    File.WriteAllText(consoleJsonPath, JsonSerializer.Serialize(consoleErrorsExport, new JsonSerializerOptions { WriteIndented = true }));
                    result.ConsoleErrorsCaptured = consoleErrorsExport.Count;

                    // 5. Generate and write report.json
                    string reportJsonPath = Path.Combine(automationDir, "report.json");
                    string reportJsonContent = GenerateReportJson(context, relativeScreenshots);
                    File.WriteAllText(reportJsonPath, reportJsonContent);
                    result.ReportJsonPath = reportJsonPath;

                    // 6. Generate and write summary.md
                    string summaryMdPath = Path.Combine(automationDir, "summary.md");
                    string summaryMdContent = GenerateSummaryMarkdown(context, relativeScreenshots);
                    File.WriteAllText(summaryMdPath, summaryMdContent);
                    result.SummaryMdPath = summaryMdPath;
                });
                ioSw.Stop();
                if (ioSw.ElapsedMilliseconds > 1000)
                {
                    ActivityLog.Log(Channel, $"Slow automated artifact write: {ioSw.ElapsedMilliseconds}ms for session {context.SessionId}");
                }

                // 7. Commit and push to Git if enabled. Commit-without-push is never done (Git #4330):
                // repoRoot is the shared checkout serving the dev ports, and a local-only commit there
                // makes every dev-server fast-forward skip until someone removes it by hand. A persisted
                // settings.json "AutomationQaAutoPushEnabled": false from before #4122 kept 6 of these
                // stranded — so with push off the artifacts stay on disk, uncommitted and unstaged.
                if (commitToGit && !pushToRemote)
                {
                    ActivityLog.Log(Channel, $"Automated QA session {context.SessionId}: artifacts written to Bugs/{cleanProduct}/{context.SessionId}/automation/ but NOT committed — auto-push is off, and a commit that isn't pushed would diverge the shared checkout from origin/main (Git #4330). Turn on AutomationQaAutoPushEnabled to publish them.");
                }
                else if (commitToGit)
                {
                    string shortSummary = !string.IsNullOrWhiteSpace(context.ShortSummary)
                        ? context.ShortSummary
                        : GenerateAutoShortSummary(context);

                    string commitMsg = $"Automated QA Session {context.SessionId}: {shortSummary}";
                    result.CommitMessage = commitMsg;

                    string relAutomationPath = $"Bugs/{cleanProduct}/{context.SessionId}/automation/";
                    string branch = await GetGitBranchAsync(repoRoot);
                    var gitPublishSw = Stopwatch.StartNew();
                    // Builds and pushes the commit in isolation (GIT_INDEX_FILE + commit-tree), never
                    // touching the shared checkout's real index or branch ref (Git #4389) — so nothing
                    // needs staging or unwinding here any more.
                    var (pubOk, pubErr, pubHash, committed) = await PublishArtifactCommitIsolatedAsync(repoRoot, branch, context.SessionId, relAutomationPath, commitMsg);
                    gitPublishSw.Stop();
                    if (gitPublishSw.ElapsedMilliseconds > 1000)
                    {
                        ActivityLog.Log(Channel, $"Slow isolated git publish (fetch+commit-tree+push) for automation: {gitPublishSw.ElapsedMilliseconds}ms");
                    }

                    if (pubOk)
                    {
                        if (committed)
                        {
                            result.CommitHash = pubHash ?? "committed";
                        }
                        else
                        {
                            ActivityLog.Log(Channel, $"Automated QA session {context.SessionId}: no changes to publish under {relAutomationPath} — content already matches origin/{branch}.");
                        }
                    }
                    else
                    {
                        // No local commit was ever created, so the artifact files remain on disk,
                        // untracked — nothing to unwind.
                        result.Error = pubErr;
                    }
                }

                totalSw.Stop();
                long endMemory = GC.GetTotalMemory(false);
                long memDeltaMb = (endMemory - startMemory) / (1024 * 1024);
                ActivityLog.Log(Channel, $"Automation QA session finalized: total={totalSw.ElapsedMilliseconds}ms, memory delta={memDeltaMb}MB (start: {startMemory / (1024 * 1024)}MB, end: {endMemory / (1024 * 1024)}MB)");

                result.Success = true;
                ActivityLog.Log(Channel, $"Successfully saved automated QA session to {automationDir}.");
                return result;
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.Error = ex.Message;
                ActivityLog.Log(Channel, $"Failed to finalize automated QA session: {ex.Message}");
                return result;
            }
        }

        public static string GenerateReportJson(AutomationQaSessionContext context, List<string>? relativeScreenshots = null)
        {
            var data = new
            {
                testName = context.TestName,
                productName = context.ProductName,
                sessionId = context.SessionId,
                startedAt = context.StartedAt.ToString("o"),
                endedAt = context.EndedAt.ToString("o"),
                durationSeconds = Math.Round(context.Duration.TotalSeconds, 2),
                success = context.Success,
                summary = !string.IsNullOrWhiteSpace(context.ShortSummary) ? context.ShortSummary : GenerateAutoShortSummary(context),
                urlsVisited = context.UrlsVisited,
                steps = context.Steps.Select(s => new
                {
                    index = s.Index,
                    action = s.Action,
                    selector = s.Selector,
                    targetUrl = s.TargetUrl,
                    expected = s.Expected,
                    actual = s.Actual,
                    passed = s.Passed,
                    durationMs = s.DurationMs,
                    detail = s.Detail,
                    screenshotPath = s.ScreenshotPath,
                    domSnapshotPath = s.DomSnapshotPath
                }),
                consoleErrors = context.ConsoleErrors.Select(c => new
                {
                    level = c.Level,
                    message = c.Message,
                    stack = c.StackTrace,
                    timestamp = c.Timestamp
                }),
                apiFailures = context.ApiFailures.Select(a => new
                {
                    name = a.Name,
                    method = a.Method,
                    requestUrl = a.RequestUrl,
                    statusCode = a.StatusCode,
                    durationMs = a.DurationMs,
                    reason = a.Reason,
                    timestamp = a.Timestamp.ToString("o")
                }),
                executedCommands = context.ExecutedCommands.Select(cmd => new
                {
                    command = cmd.Command,
                    success = !cmd.IsError,
                    output = cmd.ReturnValue,
                    error = cmd.ErrorMessage,
                    durationMs = cmd.DurationMs
                }),
                screenshotPaths = relativeScreenshots ?? context.ScreenshotPaths,
                screenshotDiffs = context.ScreenshotDiffs,
                domDiffs = context.DomDiffs,
                recommendations = context.Recommendations
            };

            return JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true });
        }

        public static string GenerateSummaryMarkdown(AutomationQaSessionContext context, List<string>? relativeScreenshots = null)
        {
            var sb = new StringBuilder();
            int failedSteps = context.Steps.Count(s => !s.Passed);
            int passedSteps = context.Steps.Count(s => s.Passed);
            int totalSteps = context.Steps.Count;
            double passRate = totalSteps > 0 ? (passedSteps * 100.0 / totalSteps) : 100.0;

            sb.AppendLine($"# Automated QA Session Summary – {context.TestName}");
            sb.AppendLine();
            sb.AppendLine($"> **Product**: `{context.ProductName}`  ");
            sb.AppendLine($"> **Session ID**: `{context.SessionId}`  ");
            sb.AppendLine($"> **Date**: {context.StartedAt:yyyy-MM-dd HH:mm:ss} – {context.EndedAt:HH:mm:ss}  ");
            sb.AppendLine($"> **Duration**: {context.Duration.Minutes:D2}m {context.Duration.Seconds:D2}s ({Math.Round(context.Duration.TotalSeconds, 1)}s)  ");
            sb.AppendLine($"> **Result**: {(context.Success ? "✅ ALL PASSED" : $"❌ {failedSteps} STEP FAILURE(S)")} ({passedSteps}/{totalSteps} passed, {passRate:F1}%)  ");
            sb.AppendLine();

            // 1. Executive Summary
            sb.AppendLine("## Executive Summary");
            string summary = !string.IsNullOrWhiteSpace(context.ShortSummary)
                ? context.ShortSummary
                : GenerateAutoShortSummary(context);
            sb.AppendLine(summary);
            sb.AppendLine();

            // 2. Pages Visited
            sb.AppendLine("## Pages Visited");
            if (context.UrlsVisited.Count == 0)
            {
                sb.AppendLine("- *(No external navigations recorded)*");
            }
            else
            {
                foreach (var url in context.UrlsVisited)
                {
                    sb.AppendLine($"- `{url}`");
                }
            }
            sb.AppendLine();

            // 3. Step Execution & Failures
            sb.AppendLine("## Test Steps & Assertions");
            if (context.Steps.Count == 0)
            {
                sb.AppendLine("*(No steps recorded)*");
            }
            else
            {
                sb.AppendLine("| Step | Action | Target / Selector | Status | Duration | Details |");
                sb.AppendLine("|:---:|:---|:---|:---:|:---:|:---|");
                foreach (var step in context.Steps)
                {
                    string statusBadge = step.Passed ? "✅ PASS" : "❌ FAIL";
                    string target = !string.IsNullOrWhiteSpace(step.Selector) ? $"`{step.Selector}`" : (!string.IsNullOrWhiteSpace(step.TargetUrl) ? $"`{step.TargetUrl}`" : "—");
                    string detail = step.Detail.Replace("\r", "").Replace("\n", " ").Trim();
                    if (detail.Length > 80) detail = detail.Substring(0, 77) + "...";
                    sb.AppendLine($"| {step.Index} | `{step.Action}` | {target} | {statusBadge} | {step.DurationMs}ms | {detail} |");
                }
            }
            sb.AppendLine();

            // 4. Console Errors
            sb.AppendLine("## Console Errors");
            if (context.ConsoleErrors.Count == 0)
            {
                sb.AppendLine("✅ **Zero console errors observed during this automated run.**");
            }
            else
            {
                sb.AppendLine($"⚠️ **{context.ConsoleErrors.Count} console error(s) captured:**");
                sb.AppendLine();
                foreach (var err in context.ConsoleErrors)
                {
                    sb.AppendLine($"- **{err.Message}**  ");
                    if (!string.IsNullOrEmpty(err.StackTrace))
                    {
                        sb.AppendLine("  ```text");
                        sb.AppendLine(err.StackTrace.Trim());
                        sb.AppendLine("  ```");
                    }
                }
            }
            sb.AppendLine();

            // 5. API Failures & Slow Requests
            sb.AppendLine("## API Failures & Network Performance");
            if (context.ApiFailures.Count == 0)
            {
                sb.AppendLine("✅ **No HTTP errors or slow API calls detected.**");
            }
            else
            {
                sb.AppendLine("| Method | Status | Duration | Reason | URL |");
                sb.AppendLine("|:---:|:---:|:---:|:---:|:---|");
                foreach (var api in context.ApiFailures)
                {
                    string statusStr = api.StatusCode > 0 ? api.StatusCode.ToString() : "ERR";
                    sb.AppendLine($"| `{api.Method}` | `{statusStr}` | {api.DurationMs}ms | {api.Reason} | `{api.RequestUrl}` |");
                }
            }
            sb.AppendLine();

            // 6. Screenshot & Visual Diffs
            sb.AppendLine("## Screenshot & DOM Attachments");
            var shots = relativeScreenshots ?? context.ScreenshotPaths;
            if (shots.Count == 0)
            {
                sb.AppendLine("- *(No screenshots attached)*");
            }
            else
            {
                sb.AppendLine($"- **Screenshots ({shots.Count})**:");
                foreach (var s in shots)
                {
                    sb.AppendLine($"  - `{s}`");
                }
            }

            if (context.DomDiffs.Count > 0)
            {
                sb.AppendLine($"- **DOM Snapshots & Diffs ({context.DomDiffs.Count})**:");
                foreach (var d in context.DomDiffs)
                {
                    sb.AppendLine($"  - Step {d.StepIndex}: `{d.Selector}` ({d.ModifiedElementsCount} elements) &rarr; `{d.SnapshotPath ?? "dom/snapshot.json"}`");
                }
            }
            sb.AppendLine();

            // 7. Optional DevTools Commands Executed
            if (context.ExecutedCommands.Count > 0 || context.ExecutedApiCalls.Count > 0)
            {
                sb.AppendLine("## DevTools Commands Executed");
                foreach (var cmd in context.ExecutedCommands)
                {
                    sb.AppendLine($"- **JS**: `{cmd.Command}` ({(!cmd.IsError ? "✅ OK" : "❌ Err")}, {cmd.DurationMs}ms)");
                }
                foreach (var api in context.ExecutedApiCalls)
                {
                    sb.AppendLine($"- **Fetch**: `{api.Method} {api.Url}` ({api.StatusCode}, {api.DurationMs}ms)");
                }
                sb.AppendLine();
            }

            // 8. Claude Recommendations
            sb.AppendLine("## Recommendations for Claude & Engineering");
            if (!string.IsNullOrWhiteSpace(context.Recommendations))
            {
                sb.AppendLine(context.Recommendations);
            }
            else if (context.Success && context.ConsoleErrors.Count == 0 && context.ApiFailures.Count == 0)
            {
                sb.AppendLine("1. Automated suite passed cleanly with zero browser console errors or API regressions.");
                sb.AppendLine("2. Safe to proceed with build verification and merge.");
            }
            else
            {
                sb.AppendLine("1. Review failed test step assertions in `report.json` to inspect expected vs actual values.");
                if (context.ConsoleErrors.Count > 0)
                    sb.AppendLine("2. Investigate browser console errors documented in `console.json`.");
                if (context.ApiFailures.Count > 0)
                    sb.AppendLine("3. Check backend logs for non-200 / slow endpoints documented under `api/`.");
            }

            return sb.ToString();
        }

        private static string GenerateAutoShortSummary(AutomationQaSessionContext context)
        {
            int passed = context.Steps.Count(s => s.Passed);
            int total = context.Steps.Count;
            if (context.Success && context.ConsoleErrors.Count == 0 && context.ApiFailures.Count == 0)
            {
                return $"All {total} step(s) passed cleanly; 0 console errors, 0 API failures.";
            }

            var parts = new List<string>();
            if (passed < total)
                parts.Add($"{total - passed}/{total} step(s) failed");
            else
                parts.Add($"{total} step(s) passed");

            if (context.ConsoleErrors.Count > 0)
                parts.Add($"{context.ConsoleErrors.Count} console error(s)");
            if (context.ApiFailures.Count > 0)
                parts.Add($"{context.ApiFailures.Count} API failure(s)");

            return string.Join("; ", parts) + ".";
        }

        private static async Task<(bool success, string error)> RunGitCommandAsync(string repoRoot, string args, IDictionary<string, string>? extraEnv = null)
        {
            var (ok, _, err) = await RunGitCommandWithOutputAsync(repoRoot, args, extraEnv);
            return (ok, err);
        }

        private static async Task<(bool success, string output, string error)> RunGitCommandWithOutputAsync(string repoRoot, string args, IDictionary<string, string>? extraEnv = null)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "git",
                    Arguments = args,
                    WorkingDirectory = repoRoot,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };

                if (extraEnv != null)
                {
                    foreach (var kvp in extraEnv)
                    {
                        psi.Environment[kvp.Key] = kvp.Value;
                    }
                }

                using var proc = new Process { StartInfo = psi };
                proc.Start();

                var outTask = proc.StandardOutput.ReadToEndAsync();
                var errTask = proc.StandardError.ReadToEndAsync();

                var exited = await Task.Run(() => proc.WaitForExit(30000));
                if (!exited)
                {
                    try { proc.Kill(); } catch { }
                    return (false, "", "Git command timed out after 30 seconds.");
                }

                string stdOut = await outTask;
                string stdErr = await errTask;

                return (proc.ExitCode == 0, stdOut.Trim(), stdErr.Trim());
            }
            catch (Exception ex)
            {
                return (false, "", ex.Message);
            }
        }

        private static async Task<string> GetGitBranchAsync(string repoRoot)
        {
            var (ok, branch, _) = await RunGitCommandWithOutputAsync(repoRoot, "rev-parse --abbrev-ref HEAD");
            return ok && !string.IsNullOrWhiteSpace(branch) ? branch.Trim() : "main";
        }

        /// <summary>
        /// Publishes the QA artifact under <paramref name="relArtifactPath"/> as a standalone commit on
        /// top of origin/<paramref name="branch"/>, without ever touching the shared checkout's real
        /// index or branch ref (Git #4389). The prior approach (`git add`/`git commit -- path` against
        /// the checkout's real index, then `git fetch`/`rebase`/`push` against its whole local branch —
        /// <c>PushArtifactCommitWithRebaseAsync</c>) had two real failure modes: any unrelated unpushed
        /// local commit sitting in the checkout got rebased and published right along with the artifact,
        /// and any staged/dirty tracked file elsewhere made the rebase refuse outright, so artifacts
        /// never published while the checkout was dirty.
        ///
        /// This builds the commit entirely with plumbing against a throwaway index
        /// (<c>GIT_INDEX_FILE</c>), never the checkout's own <c>.git/index</c>: <c>read-tree
        /// origin/&lt;branch&gt;</c> populates it with origin's current tree, <c>add -- relArtifactPath</c>
        /// stages only the artifact files from the working tree on top of that, <c>write-tree</c> +
        /// <c>commit-tree</c> build the commit object directly (parented on origin, not HEAD), and
        /// <c>push origin &lt;sha&gt;:&lt;branch&gt;</c> lands it — retried with a fresh fetch on a
        /// non-fast-forward rejection. Because HEAD and the real index are never touched, an unrelated
        /// local commit is never rebased/published, a dirty/staged tracked file elsewhere never blocks
        /// anything, and there is nothing to "unwind" on failure — no local commit is ever created, so a
        /// failed attempt just leaves the artifact files on disk, same as before. Shared with
        /// <see cref="VisualTestTrackerSessionSyncService.StageCommitPushAsync"/>.
        /// </summary>
        internal static async Task<(bool success, string? error, string? commitHash, bool committed)> PublishArtifactCommitIsolatedAsync(
            string repoRoot, string branch, string sessionId, string relArtifactPath, string commitMessage)
        {
            const int maxAttempts = 3;
            string? lastError = null;
            string tempIndex = Path.Combine(Path.GetTempPath(), $"buildconsole-qa-index-{Guid.NewGuid():N}.tmp");
            var indexEnv = new Dictionary<string, string> { ["GIT_INDEX_FILE"] = tempIndex };

            try
            {
                for (int attempt = 1; attempt <= maxAttempts; attempt++)
                {
                    var (fetchOk, fetchErr) = await RunGitCommandAsync(repoRoot, $"fetch origin {branch}");
                    if (!fetchOk)
                    {
                        lastError = $"git fetch origin {branch} failed: {fetchErr}";
                        ActivityLog.Log(Channel, $"Isolated QA artifact publish attempt {attempt}/{maxAttempts} for session {sessionId}: {lastError}");
                        continue;
                    }

                    var (readTreeOk, _, readTreeErr) = await RunGitCommandWithOutputAsync(repoRoot, $"read-tree origin/{branch}", indexEnv);
                    if (!readTreeOk)
                    {
                        lastError = $"git read-tree origin/{branch} failed: {readTreeErr}";
                        ActivityLog.Log(Channel, $"Isolated QA artifact publish attempt {attempt}/{maxAttempts} for session {sessionId}: {lastError}");
                        continue;
                    }

                    var (addOk, _, addErr) = await RunGitCommandWithOutputAsync(repoRoot, $"add -- \"{relArtifactPath}\"", indexEnv);
                    if (!addOk)
                    {
                        // A genuine staging failure (e.g. nothing exists at relArtifactPath) — not a
                        // race with origin, so retrying won't help.
                        lastError = $"git add -- {relArtifactPath} failed: {addErr}";
                        ActivityLog.Log(Channel, $"Isolated QA artifact publish for session {sessionId}: {lastError}");
                        return (false, lastError, null, false);
                    }

                    var (writeTreeOk, treeSha, writeTreeErr) = await RunGitCommandWithOutputAsync(repoRoot, "write-tree", indexEnv);
                    if (!writeTreeOk || string.IsNullOrWhiteSpace(treeSha))
                    {
                        lastError = $"git write-tree failed: {writeTreeErr}";
                        ActivityLog.Log(Channel, $"Isolated QA artifact publish attempt {attempt}/{maxAttempts} for session {sessionId}: {lastError}");
                        continue;
                    }

                    // If the resulting tree is identical to origin's current tree, the artifact content
                    // already matches what's published — nothing to commit or push.
                    var (parentTreeOk, parentTreeSha, _) = await RunGitCommandWithOutputAsync(repoRoot, $"rev-parse origin/{branch}^{{tree}}");
                    if (parentTreeOk && string.Equals(treeSha.Trim(), parentTreeSha.Trim(), StringComparison.OrdinalIgnoreCase))
                    {
                        return (true, null, null, false);
                    }

                    var msgLines = (commitMessage ?? "").Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
                    string mArgs = msgLines.Length > 0
                        ? string.Join(" ", msgLines.Select(l => $"-m \"{l.Replace("\"", "\\\"")}\""))
                        : $"-m \"{sessionId}\"";
                    string commitArgs = $"commit-tree {treeSha.Trim()} -p origin/{branch} {mArgs}";
                    var (commitTreeOk, commitSha, commitTreeErr) = await RunGitCommandWithOutputAsync(repoRoot, commitArgs);
                    if (!commitTreeOk || string.IsNullOrWhiteSpace(commitSha))
                    {
                        // A genuine failure building the commit object (e.g. missing user.name/email) —
                        // not a race with origin, so retrying won't help.
                        lastError = $"git commit-tree failed: {commitTreeErr}";
                        ActivityLog.Log(Channel, $"Isolated QA artifact publish for session {sessionId}: {lastError}");
                        return (false, lastError, null, false);
                    }

                    string sha = commitSha.Trim();
                    var (pushOk, pushErr) = await RunGitCommandAsync(repoRoot, $"push origin {sha}:{branch}");
                    if (pushOk)
                    {
                        var (hashOk, shortHash, _) = await RunGitCommandWithOutputAsync(repoRoot, $"rev-parse --short {sha}");
                        return (true, null, hashOk && !string.IsNullOrWhiteSpace(shortHash) ? shortHash.Trim() : sha.Substring(0, 7), true);
                    }

                    lastError = $"git push origin {sha}:{branch} failed: {pushErr}";
                    ActivityLog.Log(Channel, $"Isolated QA artifact publish attempt {attempt}/{maxAttempts} for session {sessionId} rejected: {pushErr}. Retrying with a fresh fetch.");
                }
            }
            finally
            {
                try { if (File.Exists(tempIndex)) File.Delete(tempIndex); } catch { /* best-effort cleanup of the throwaway index */ }
            }

            string failMsg = $"push failed after {maxAttempts} attempt(s): {lastError}. No local commit was ever created against the shared checkout, so there is nothing to unwind — the artifact files remain on disk, untracked.";
            ActivityLog.Log(Channel, $"Isolated QA artifact publish for session {sessionId}: {failMsg}");
            return (false, failMsg, null, false);
        }
    }
}
