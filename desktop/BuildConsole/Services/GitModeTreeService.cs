using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Npgsql;

namespace BuildConsole.Services
{
    public enum GitModeNodeType
    {
        Milestone,
        Gate,
        Epic,
        Feature
    }

    public class GitModeTreeNode
    {
        public GitModeNodeType Type { get; set; }
        public int Id { get; set; }
        public string Title { get; set; } = "";
        public string State { get; set; } = "open";
        public bool IsOpen => string.Equals(State, "open", StringComparison.OrdinalIgnoreCase);
        public int OpenCount { get; set; }
        public int TotalCount { get; set; }
        public int? MilestoneNumber { get; set; }
        public int? ParentNumber { get; set; }
        public List<GitModeTreeNode> Children { get; set; } = new();

        public string IconGlyph => Type switch
        {
            GitModeNodeType.Milestone => "🎯",
            GitModeNodeType.Gate => "🛡️",
            GitModeNodeType.Epic => "⚡",
            GitModeNodeType.Feature => "▪",
            _ => "•"
        };

        public string DisplayBadge => Type switch
        {
            GitModeNodeType.Milestone => $"{OpenCount} open",
            GitModeNodeType.Epic => $"{OpenCount} open",
            GitModeNodeType.Gate => IsOpen ? "GATE: OPEN" : "GATE: CLOSED",
            GitModeNodeType.Feature => IsOpen ? "OPEN" : "CLOSED",
            _ => ""
        };

        public bool IsGate => Type == GitModeNodeType.Gate;
    }

    /// <summary>
    /// Postgres-only data loader for Git Mode Left Panel Tree (Phase 2).
    /// Loads Milestones, GATE issues, Epics, and Features into a 3-level tree hierarchy.
    /// Only open issues count toward progress.
    /// </summary>
    public static class GitModeTreeService
    {
        public static string ResolveConnectionString()
        {
            // 1. Try DatabaseRegistry buildconsole connection string
            var buildConsoleEntry = DatabaseRegistry.FindByKey(DatabaseRegistry.BuildConsoleKey);
            if (buildConsoleEntry != null)
            {
                var resolved = DatabaseRegistry.Resolve(buildConsoleEntry, BuildTrackerConfig.FindRepoRoot());
                if (resolved.IsReachable && !string.IsNullOrWhiteSpace(resolved.ConnectionString))
                {
                    return resolved.ConnectionString;
                }
            }

            // 2. Try product connection string
            var defaultEntry = DatabaseRegistry.FindByKey(DatabaseRegistry.DefaultKey);
            if (defaultEntry != null)
            {
                var resolved = DatabaseRegistry.Resolve(defaultEntry, BuildTrackerConfig.FindRepoRoot());
                if (resolved.IsReachable && !string.IsNullOrWhiteSpace(resolved.ConnectionString))
                {
                    return resolved.ConnectionString;
                }
            }

            // 3. Fallback connection string
            return "Host=localhost;Database=BuildConsole;Username=postgres;Password=postgres";
        }

        public static async Task<List<GitModeTreeNode>> LoadTreeFromPostgresAsync()
        {
            var tree = new List<GitModeTreeNode>();
            string connStr = ResolveConnectionString();

            try
            {
                await using var conn = new NpgsqlConnection(connStr);
                await conn.OpenAsync();

                // 1. Read Milestones
                var milestones = new List<(int Number, string Title, string State)>();
                const string milestoneSql = @"
                    SELECT number, title, state 
                    FROM bt_milestone_mirror 
                    ORDER BY number DESC;";

                try
                {
                    await using var mCmd = new NpgsqlCommand(milestoneSql, conn);
                    await using var mReader = await mCmd.ExecuteReaderAsync();
                    while (await mReader.ReadAsync())
                    {
                        int num = mReader.GetInt32(0);
                        string title = mReader.GetString(1);
                        string state = mReader.GetString(2);
                        milestones.Add((num, title, state));
                    }
                }
                catch
                {
                    // Fallback to reading distinct milestones from bt_issue_mirror
                    milestones.Clear();
                    const string fallbackMilestonesSql = @"
                        SELECT DISTINCT milestone_number, COALESCE(milestone_title, 'Milestone #' || milestone_number) 
                        FROM bt_issue_mirror 
                        WHERE milestone_number IS NOT NULL 
                        ORDER BY milestone_number DESC;";

                    await using var fCmd = new NpgsqlCommand(fallbackMilestonesSql, conn);
                    await using var fReader = await fCmd.ExecuteReaderAsync();
                    while (await fReader.ReadAsync())
                    {
                        if (!fReader.IsDBNull(0))
                        {
                            int num = fReader.GetInt32(0);
                            string title = fReader.IsDBNull(1) ? $"Milestone #{num}" : fReader.GetString(1);
                            milestones.Add((num, title, "open"));
                        }
                    }
                }

                // 2. Read Issues from bt_issue_mirror
                var allIssues = new List<RawIssueRecord>();
                const string issuesSql = @"
                    SELECT issue_number, title, state, milestone_number, parent_number, labels 
                    FROM bt_issue_mirror 
                    ORDER BY issue_number DESC;";

                try
                {
                    await using var iCmd = new NpgsqlCommand(issuesSql, conn);
                    await using var iReader = await iCmd.ExecuteReaderAsync();
                    while (await iReader.ReadAsync())
                    {
                        int issueNum = iReader.GetInt32(0);
                        string title = iReader.IsDBNull(1) ? "" : iReader.GetString(1);
                        string state = iReader.IsDBNull(2) ? "open" : iReader.GetString(2);
                        int? milestoneNum = iReader.IsDBNull(3) ? null : iReader.GetInt32(3);
                        int? parentNum = iReader.IsDBNull(4) ? null : iReader.GetInt32(4);
                        string[] labels = iReader.IsDBNull(5) ? Array.Empty<string>() : iReader.GetFieldValue<string[]>(5);

                        allIssues.Add(new RawIssueRecord(issueNum, title, state, milestoneNum, parentNum, labels));
                    }
                }
                catch { }

                // Group issues by parent number for feature lookup
                var childIssuesMap = allIssues
                    .Where(i => i.ParentNumber.HasValue)
                    .GroupBy(i => i.ParentNumber!.Value)
                    .ToDictionary(g => g.Key, g => g.ToList());

                // Build tree nodes
                foreach (var ms in milestones)
                {
                    var msNode = new GitModeTreeNode
                    {
                        Type = GitModeNodeType.Milestone,
                        Id = ms.Number,
                        Title = ms.Title,
                        State = ms.State,
                        MilestoneNumber = ms.Number
                    };

                    var msIssues = allIssues.Where(i => i.MilestoneNumber == ms.Number).ToList();

                    // A. GATE Issues under this Milestone
                    var gateIssues = msIssues.Where(IsGateIssue).ToList();
                    foreach (var gateIssue in gateIssues)
                    {
                        var gateNode = new GitModeTreeNode
                        {
                            Type = GitModeNodeType.Gate,
                            Id = gateIssue.IssueNumber,
                            Title = gateIssue.Title,
                            State = gateIssue.State,
                            MilestoneNumber = ms.Number,
                            ParentNumber = gateIssue.ParentNumber
                        };
                        msNode.Children.Add(gateNode);
                    }

                    // B. Epics under this Milestone
                    var epics = msIssues
                        .Where(i => !IsGateIssue(i) && (i.ParentNumber == null || IsEpicTitle(i.Title)))
                        .ToList();

                    foreach (var epic in epics)
                    {
                        var epicNode = new GitModeTreeNode
                        {
                            Type = GitModeNodeType.Epic,
                            Id = epic.IssueNumber,
                            Title = epic.Title,
                            State = epic.State,
                            MilestoneNumber = ms.Number,
                            ParentNumber = epic.ParentNumber
                        };

                        // Features under this Epic
                        if (childIssuesMap.TryGetValue(epic.IssueNumber, out var features))
                        {
                            foreach (var feat in features)
                            {
                                var featNode = new GitModeTreeNode
                                {
                                    Type = GitModeNodeType.Feature,
                                    Id = feat.IssueNumber,
                                    Title = feat.Title,
                                    State = feat.State,
                                    MilestoneNumber = ms.Number,
                                    ParentNumber = epic.IssueNumber
                                };
                                epicNode.Children.Add(featNode);
                            }
                        }

                        // Count open features for Epic progress
                        epicNode.OpenCount = epicNode.Children.Count > 0 
                            ? epicNode.Children.Count(c => c.IsOpen) 
                            : (epicNode.IsOpen ? 1 : 0);
                        epicNode.TotalCount = epicNode.Children.Count > 0 
                            ? epicNode.Children.Count 
                            : 1;

                        msNode.Children.Add(epicNode);
                    }

                    // Compute total open issues under Milestone
                    int totalOpenUnderMilestone = msIssues.Count(i => string.Equals(i.State, "open", StringComparison.OrdinalIgnoreCase));
                    msNode.OpenCount = totalOpenUnderMilestone;
                    msNode.TotalCount = msIssues.Count;

                    tree.Add(msNode);
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("git-mode", $"LoadTreeFromPostgresAsync error: {ex.Message}");
            }

            return tree;
        }

        private static bool IsGateIssue(RawIssueRecord issue)
        {
            if (string.IsNullOrWhiteSpace(issue.Title)) return false;
            if (issue.Title.StartsWith("GATE", StringComparison.OrdinalIgnoreCase)) return true;
            if (issue.Title.Contains("GATE", StringComparison.OrdinalIgnoreCase)) return true;
            if (issue.Labels != null && issue.Labels.Any(l => string.Equals(l, "gate", StringComparison.OrdinalIgnoreCase))) return true;
            return false;
        }

        private static bool IsEpicTitle(string title)
        {
            if (string.IsNullOrWhiteSpace(title)) return false;
            return title.StartsWith("EPIC", StringComparison.OrdinalIgnoreCase);
        }

        private record RawIssueRecord(int IssueNumber, string Title, string State, int? MilestoneNumber, int? ParentNumber, string[] Labels);
    }
}
