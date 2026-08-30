using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>Matches `gh issue list --json number,title,url,updatedAt,parent`'s real row shape (confirmed via a live run).</summary>
    public class GitHubIssueSummary
    {
        public int Number { get; set; }
        public string Title { get; set; } = "";
        public string Url { get; set; } = "";
        /// <summary>GitHub always returns this in UTC (ISO 8601 "Z" suffix) — callers must ToLocalTime() before comparing against DateTime.Now/displaying, or the offset skews the result (confirmed: Shane saw "-234m ago" from exactly this mismatch).</summary>
        public DateTime UpdatedAt { get; set; }
        /// <summary>Git #854 — null means this issue has no parent (either unlinked, or it IS an epic itself).</summary>
        public GitHubIssueParent? Parent { get; set; }
    }

    public class GitHubIssueParent
    {
        public int Number { get; set; }
        public string Title { get; set; } = "";
    }

    /// <summary>
    /// Git #1600 — result of a live "which issues are currently open" query, with an
    /// explicit Success flag so a dispatch gate can fail closed on an unreachable
    /// GitHub instead of silently treating "couldn't check" the same as "nothing is
    /// open" (see TryGetOpenIssueNumbersAsync's own doc comment for why that
    /// distinction is load-bearing here).
    /// </summary>
    public class LiveOpenIssuesResult
    {
        public bool Success { get; init; }
        public HashSet<int> OpenNumbers { get; init; } = new();
        public string? Error { get; init; }

        public static LiveOpenIssuesResult Ok(HashSet<int> openNumbers) => new() { Success = true, OpenNumbers = openNumbers };
        public static LiveOpenIssuesResult Failure(string error) => new() { Success = false, Error = error };
    }

    /// <summary>
    /// Git #848 — Shane: "why can't the WPF just connect directly to Git to
    /// get this stuff... no real reason for it to go through my server
    /// anymore... 834 is already making a live Git connection for the Git
    /// panel." He's right for read-only GitHub data: this machine's `gh` CLI
    /// is already authenticated (confirmed - used all session for issue
    /// create/comment/label calls), so there's no token to manage and no
    /// server round-trip needed, same reasoning as ClaudeAgentsService
    /// shelling out to `claude agents --json` directly instead of some
    /// server-mediated version of the same local data. Scoped to this one
    /// read-only panel for now, not a wholesale migration of every
    /// GitHub-touching feature in the app off the server.
    /// </summary>
    public static class GitHubIssuesService
    {
        private const string Repo = "shanemccaw/Shane-McCaw-MSP";

        public static async Task<List<GitHubIssueSummary>> ListOpenByLabelAsync(string label, int limit = 50)
        {
            var psi = new ProcessStartInfo
            {
                FileName = "gh",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("issue");
            psi.ArgumentList.Add("list");
            psi.ArgumentList.Add("--repo");
            psi.ArgumentList.Add(Repo);
            psi.ArgumentList.Add("--state");
            psi.ArgumentList.Add("open");
            psi.ArgumentList.Add("--label");
            psi.ArgumentList.Add(label);
            psi.ArgumentList.Add("--json");
            psi.ArgumentList.Add("number,title,url,updatedAt,parent");
            psi.ArgumentList.Add("--limit");
            psi.ArgumentList.Add(limit.ToString());

            using var proc = new Process { StartInfo = psi };
            try
            {
                proc.Start();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"Couldn't start gh CLI (is it installed/on PATH?): {ex.Message}");
                return new List<GitHubIssueSummary>();
            }
            string stdout = await proc.StandardOutput.ReadToEndAsync();
            string stderr = await proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();
            if (proc.ExitCode != 0)
            {
                ActivityLog.Log("github", $"gh issue list failed (exit {proc.ExitCode}): {stderr.Trim()}");
                return new List<GitHubIssueSummary>();
            }

            try
            {
                var issues = System.Text.Json.JsonSerializer.Deserialize<List<GitHubIssueSummary>>(
                    stdout, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return issues ?? new List<GitHubIssueSummary>();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"Couldn't parse gh issue list output: {ex.Message}");
                return new List<GitHubIssueSummary>();
            }
        }

        /// <summary>
        /// Git #905 — Shane: "I ran a fix on an item in the 400s, it went to
        /// done... I don't know what it was... Maybe I need like a last
        /// complete list that stays there until the actual issue is closed
        /// in Git." One `gh` call for every currently-open issue NUMBER
        /// (no label filter, unlike ListOpenByLabelAsync above) - the
        /// BuildQueuePanel Completed tile cross-references this against
        /// done queue rows to know which finished builds still have their
        /// real GitHub issue open, i.e. still need Shane's review/close.
        ///
        /// Kept as a thin wrapper over <see cref="TryGetOpenIssueNumbersAsync"/> for
        /// existing callers that only ever wanted a set (and already treated a
        /// failure the same as "no open issues") — a real caller that needs to
        /// tell failure apart from a genuinely-empty result (Git #1600's dispatch
        /// gate) uses TryGetOpenIssueNumbersAsync directly instead.
        /// </summary>
        public static async Task<HashSet<int>> GetOpenIssueNumbersAsync(int limit = 500)
        {
            var result = await TryGetOpenIssueNumbersAsync(limit);
            return result.OpenNumbers;
        }

        /// <summary>
        /// Git #1600 — the dispatch-time blocker gate needs to tell "GitHub says
        /// nothing is open" apart from "couldn't reach GitHub at all", because the
        /// two demand opposite decisions (release vs. fail-closed hold). The older
        /// <see cref="GetOpenIssueNumbersAsync"/> collapsed both cases to an empty
        /// set, which is exactly wrong for a build-dispatch gate — an unreachable
        /// `gh` CLI must never look identical to "every issue is closed, go ahead."
        /// </summary>
        public static async Task<LiveOpenIssuesResult> TryGetOpenIssueNumbersAsync(int limit = 500)
        {
            var psi = new ProcessStartInfo
            {
                FileName = "gh",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("issue");
            psi.ArgumentList.Add("list");
            psi.ArgumentList.Add("--repo");
            psi.ArgumentList.Add(Repo);
            psi.ArgumentList.Add("--state");
            psi.ArgumentList.Add("open");
            psi.ArgumentList.Add("--json");
            psi.ArgumentList.Add("number");
            psi.ArgumentList.Add("--limit");
            psi.ArgumentList.Add(limit.ToString());

            using var proc = new Process { StartInfo = psi };
            try
            {
                proc.Start();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"Couldn't start gh CLI (is it installed/on PATH?): {ex.Message}");
                return LiveOpenIssuesResult.Failure($"couldn't start gh CLI: {ex.Message}");
            }
            string stdout = await proc.StandardOutput.ReadToEndAsync();
            string stderr = await proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();
            if (proc.ExitCode != 0)
            {
                ActivityLog.Log("github", $"gh issue list (open numbers) failed (exit {proc.ExitCode}): {stderr.Trim()}");
                return LiveOpenIssuesResult.Failure($"gh issue list exited {proc.ExitCode}: {stderr.Trim()}");
            }

            try
            {
                var rows = System.Text.Json.JsonSerializer.Deserialize<List<OpenIssueNumberRow>>(
                    stdout, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return LiveOpenIssuesResult.Ok(rows == null ? new HashSet<int>() : new HashSet<int>(rows.Select(r => r.Number)));
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"Couldn't parse gh issue list (open numbers) output: {ex.Message}");
                return LiveOpenIssuesResult.Failure($"couldn't parse gh output: {ex.Message}");
            }
        }

        /// <summary>
        /// Git #1645 — defensive guard, independent of any single root cause. Every `gh`
        /// call below passes the issue number as a POSITIONAL argument
        /// (`gh issue view <num>` / `gh issue edit <num>`). When that number is non-positive
        /// — e.g. the negative sentinel a --notGit local build stores as its github_number —
        /// `gh`'s own flag parser reads the leading dash as a shorthand flag and fails hard
        /// ("unknown shorthand flag: '2' in -26"), burning a real subprocess on a guaranteed
        /// error. A real GitHub issue number is always ≥ 1, so anything ≤ 0 is never worth
        /// handing to `gh`: skip it and log a clear warning instead. This protects against
        /// whatever upstream lets a stray non-positive number through, now or in future.
        /// </summary>
        private static bool IsQueryableIssueNumber(int issueNumber, string operation)
        {
            if (issueNumber > 0) return true;
            ActivityLog.Log("github",
                $"Skipped `gh issue {operation}` for non-positive number {issueNumber} — not a real GitHub issue " +
                "(likely a --notGit local build's negative sentinel). No gh call made.");
            return false;
        }

        public static async Task<bool> AddLabelAsync(int issueNumber, string label)
        {
            if (!IsQueryableIssueNumber(issueNumber, "edit")) return false;

            var psi = new ProcessStartInfo
            {
                FileName = "gh",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("issue");
            psi.ArgumentList.Add("edit");
            psi.ArgumentList.Add(issueNumber.ToString());
            psi.ArgumentList.Add("--repo");
            psi.ArgumentList.Add(Repo);
            psi.ArgumentList.Add("--add-label");
            psi.ArgumentList.Add(label);

            using var proc = new Process { StartInfo = psi };
            try
            {
                proc.Start();
                await proc.WaitForExitAsync();
                return proc.ExitCode == 0;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"gh issue edit --add-label failed for #{issueNumber}: {ex.Message}");
                return false;
            }
        }

        public static async Task<bool> RemoveLabelAsync(int issueNumber, string label)
        {
            if (!IsQueryableIssueNumber(issueNumber, "edit")) return false;

            var psi = new ProcessStartInfo
            {
                FileName = "gh",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("issue");
            psi.ArgumentList.Add("edit");
            psi.ArgumentList.Add(issueNumber.ToString());
            psi.ArgumentList.Add("--repo");
            psi.ArgumentList.Add(Repo);
            psi.ArgumentList.Add("--remove-label");
            psi.ArgumentList.Add(label);

            using var proc = new Process { StartInfo = psi };
            try
            {
                proc.Start();
                await proc.WaitForExitAsync();
                return proc.ExitCode == 0;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"gh issue edit --remove-label failed for #{issueNumber}: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Result of a title lookup. <see cref="NotFound"/> is only true when `gh` itself reported
        /// the number doesn't resolve to any issue/PR (GraphQL "Could not resolve to an issue or pull
        /// request" — a permanent condition, safe to cache hard). Any other failure (couldn't start
        /// the CLI, non-zero exit for a different reason, unparseable output) leaves <see cref="NotFound"/>
        /// false so a transient blip (network/auth/rate-limit) doesn't get treated as a dead number —
        /// see Git #1979.
        /// </summary>
        public readonly struct IssueTitleLookup
        {
            public string? Title { get; }
            public bool NotFound { get; }
            public IssueTitleLookup(string? title, bool notFound)
            {
                Title = title;
                NotFound = notFound;
            }
        }

        public static async Task<IssueTitleLookup> GetIssueTitleAsync(int issueNumber)
        {
            if (!IsQueryableIssueNumber(issueNumber, "view")) return new IssueTitleLookup(null, false);

            var psi = new ProcessStartInfo
            {
                FileName = "gh",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("issue");
            psi.ArgumentList.Add("view");
            psi.ArgumentList.Add(issueNumber.ToString());
            psi.ArgumentList.Add("--repo");
            psi.ArgumentList.Add(Repo);
            psi.ArgumentList.Add("--json");
            psi.ArgumentList.Add("title");

            using var proc = new Process { StartInfo = psi };
            try
            {
                proc.Start();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"Couldn't start gh CLI for issue #{issueNumber}: {ex.Message}");
                return new IssueTitleLookup(null, false);
            }
            string stdout = await proc.StandardOutput.ReadToEndAsync();
            string stderr = await proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();
            if (proc.ExitCode != 0)
            {
                var trimmedStderr = stderr.Trim();
                ActivityLog.Log("github", $"gh issue view #{issueNumber} failed (exit {proc.ExitCode}): {trimmedStderr}");
                bool notFound = trimmedStderr.Contains("Could not resolve to an issue", StringComparison.OrdinalIgnoreCase);
                return new IssueTitleLookup(null, notFound);
            }

            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(stdout);
                if (doc.RootElement.TryGetProperty("title", out var titleProp))
                {
                    return new IssueTitleLookup(titleProp.GetString(), false);
                }
                return new IssueTitleLookup(null, false);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"Couldn't parse gh issue view output for #{issueNumber}: {ex.Message}");
                return new IssueTitleLookup(null, false);
            }
        }

        private class OpenIssueNumberRow
        {
            public int Number { get; set; }
        }
    }
}
