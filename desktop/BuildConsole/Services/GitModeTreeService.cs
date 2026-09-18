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

    }
}
