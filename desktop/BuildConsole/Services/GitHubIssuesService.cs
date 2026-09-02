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

        /// <summary>Git #2195 — the one real issue URL construction used by any caller (the Floating
        /// Chat Window's side dock included) that needs to open an issue number without already
        /// holding a live-fetched <c>html_url</c> for it.</summary>
        public static string IssueUrl(int issueNumber) => $"https://github.com/{Repo}/issues/{issueNumber}";

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

        /// <summary>Git #2103 — the real project-board "Status" options that count as the "Batter
        /// Up family" for the re-dispatch check: the plain launch queue and the AI-filed-findings
        /// review queue (CLAUDE.md's "Board status" section) both feed the same dispatch pipeline.</summary>
        private static readonly string[] BatterUpFamilyStatuses = { "Batter Up", "AI Batter Up" };

        /// <summary>Git #2103 — the two demotion targets the issue body names explicitly ("last
        /// closed OR moved to Backlog/Park"). A transition to any OTHER status (e.g. "In progress")
        /// deliberately does NOT count as leaving the family — Shane pulling an item out to Backlog
        /// or Park is him saying "stop, this isn't working"; other statuses aren't that signal.</summary>
        private static readonly string[] LeftFamilyTargetStatuses = { "Backlog", "Park" };

        /// <summary>
        /// Git #2103 — the real "since when should re-dispatches for this issue count" boundary:
        /// the most recent moment it (a) transitioned from a Batter-Up-family status
        /// (<see cref="BatterUpFamilyStatuses"/>) into Backlog or Park
        /// (<see cref="LeftFamilyTargetStatuses"/>), or (b) was closed — whichever is later. Reads
        /// GitHub's own real project-status timeline (`ProjectV2ItemStatusChangedEvent`, confirmed
        /// live via `gh api graphql` introspection — not a raw field poll, an actual per-transition
        /// history) plus `ClosedEvent`, both off the issue's `timelineItems`. Returns null when the
        /// issue has never left the family (or was never on the board at all) — the caller then
        /// counts every dispatch row on file for it, since there's no narrower boundary to apply.
        /// A properly closed-and-reopened issue correctly does NOT carry its old dispatch count
        /// forward: the close event resets the boundary.
        /// </summary>
        public static async Task<DateTime?> GetLastLeftBatterUpFamilyAtAsync(int issueNumber)
        {
            if (!IsQueryableIssueNumber(issueNumber, "view")) return null;

            var parts = Repo.Split('/');
            string owner = parts[0], name = parts[1];
            string query = $@"query {{
  repository(owner: ""{owner}"", name: ""{name}"") {{
    issue(number: {issueNumber}) {{
      timelineItems(itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT, CLOSED_EVENT], first: 250) {{
        nodes {{
          __typename
          ... on ProjectV2ItemStatusChangedEvent {{ createdAt previousStatus status }}
          ... on ClosedEvent {{ createdAt }}
        }}
      }}
    }}
  }}
}}";
            var psi = new ProcessStartInfo
            {
                FileName = "gh",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("api");
            psi.ArgumentList.Add("graphql");
            psi.ArgumentList.Add("-f");
            psi.ArgumentList.Add($"query={query}");

            using var proc = new Process { StartInfo = psi };
            try
            {
                proc.Start();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"Couldn't start gh CLI for #{issueNumber}'s board-status timeline: {ex.Message}");
                return null;
            }
            string stdout = await proc.StandardOutput.ReadToEndAsync();
            string stderr = await proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();
            if (proc.ExitCode != 0)
            {
                ActivityLog.Log("github", $"gh api graphql (board-status timeline) failed for #{issueNumber} (exit {proc.ExitCode}): {stderr.Trim()}");
                return null;
            }

            try
            {
                var body = System.Text.Json.JsonSerializer.Deserialize<DispatchTimelineResponse>(
                    stdout, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (body?.Errors is { Count: > 0 } errs)
                {
                    ActivityLog.Log("github", $"gh api graphql (board-status timeline) returned errors for #{issueNumber}: {string.Join("; ", errs.Select(e => e.Message))}");
                    return null;
                }

                var nodes = body?.Data?.Repository?.Issue?.TimelineItems?.Nodes ?? new List<DispatchTimelineNode>();
                DateTime? lastLeft = null;
                // GitHub returns timelineItems in chronological (ascending) order, so simply keep
                // overwriting on every qualifying event — the final value is the most recent one.
                foreach (var node in nodes)
                {
                    if (node.CreatedAt is not { } createdAt) continue;

                    if (string.Equals(node.TypeName, "ClosedEvent", StringComparison.Ordinal))
                    {
                        lastLeft = createdAt.UtcDateTime;
                    }
                    else if (string.Equals(node.TypeName, "ProjectV2ItemStatusChangedEvent", StringComparison.Ordinal))
                    {
                        bool wasFamily = node.PreviousStatus != null && BatterUpFamilyStatuses.Contains(node.PreviousStatus, StringComparer.Ordinal);
                        bool leftToTarget = node.Status != null && LeftFamilyTargetStatuses.Contains(node.Status, StringComparer.Ordinal);
                        if (wasFamily && leftToTarget)
                            lastLeft = createdAt.UtcDateTime;
                    }
                }
                return lastLeft;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"Couldn't parse gh api graphql (board-status timeline) output for #{issueNumber}: {ex.Message}");
                return null;
            }
        }

        private class DispatchTimelineResponse
        {
            public DispatchTimelineData? Data { get; set; }
            public List<DispatchGraphQlError>? Errors { get; set; }
        }
        private class DispatchGraphQlError { public string Message { get; set; } = ""; }
        private class DispatchTimelineData { public DispatchTimelineRepo? Repository { get; set; } }
        private class DispatchTimelineRepo { public DispatchTimelineIssue? Issue { get; set; } }
        private class DispatchTimelineIssue { public DispatchTimelineItemsConnection? TimelineItems { get; set; } }
        private class DispatchTimelineItemsConnection { public List<DispatchTimelineNode> Nodes { get; set; } = new(); }
        private class DispatchTimelineNode
        {
            [JsonPropertyName("__typename")]
            public string? TypeName { get; set; }
            public DateTimeOffset? CreatedAt { get; set; }
            public string? PreviousStatus { get; set; }
            public string? Status { get; set; }
        }
    }
}
