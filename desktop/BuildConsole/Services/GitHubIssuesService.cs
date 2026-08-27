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
        /// </summary>
        public static async Task<HashSet<int>> GetOpenIssueNumbersAsync(int limit = 500)
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
                return new HashSet<int>();
            }
            string stdout = await proc.StandardOutput.ReadToEndAsync();
            string stderr = await proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();
            if (proc.ExitCode != 0)
            {
                ActivityLog.Log("github", $"gh issue list (open numbers) failed (exit {proc.ExitCode}): {stderr.Trim()}");
                return new HashSet<int>();
            }

            try
            {
                var rows = System.Text.Json.JsonSerializer.Deserialize<List<OpenIssueNumberRow>>(
                    stdout, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return rows == null ? new HashSet<int>() : new HashSet<int>(rows.Select(r => r.Number));
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"Couldn't parse gh issue list (open numbers) output: {ex.Message}");
                return new HashSet<int>();
            }
        }

        public static async Task<bool> AddLabelAsync(int issueNumber, string label)
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

        public static async Task<string?> GetIssueTitleAsync(int issueNumber)
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
                return null;
            }
            string stdout = await proc.StandardOutput.ReadToEndAsync();
            string stderr = await proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();
            if (proc.ExitCode != 0)
            {
                ActivityLog.Log("github", $"gh issue view #{issueNumber} failed (exit {proc.ExitCode}): {stderr.Trim()}");
                return null;
            }

            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(stdout);
                if (doc.RootElement.TryGetProperty("title", out var titleProp))
                {
                    return titleProp.GetString();
                }
                return null;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"Couldn't parse gh issue view output for #{issueNumber}: {ex.Message}");
                return null;
            }
        }

        private class OpenIssueNumberRow
        {
            public int Number { get; set; }
        }
    }
}
