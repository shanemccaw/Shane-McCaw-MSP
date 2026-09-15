using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace BuildConsole.Services
{
    public class GitModeWhyResult
    {
        public int IssueNumber { get; set; }
        public string Title { get; set; } = "";
        public string WhyBlocked { get; set; } = "";
        public string WhatItBlocks { get; set; } = "";
        public string BuildRequirements { get; set; } = "";
        public string Dispatchability { get; set; } = "";
        public string NextSteps { get; set; } = "";
        public string GateExplanation { get; set; } = "";
    }

    public class GitModeEdgeWhyResult
    {
        public int FromIssue { get; set; }
        public int ToIssue { get; set; }
        public GitEdgeType EdgeType { get; set; }
        public string Summary { get; set; } = "";
        public string Explanation { get; set; } = "";
    }

    /// <summary>
    /// Phase 5 WHY Engine.
    /// Synthesizes dependency graph, build status, bucket, labels, GATE rules, and AI metadata
    /// into human-readable explanations for Why Blocked, What It Blocks, Build Requirements,
    /// Dispatchability, and Next Steps.
    /// </summary>
    public static class GitModeWhyEngine
    {
        public static GitModeWhyResult AnalyzeNode(GitModeGraphNode node, GitModeGraphData? graphData, GitModeIssueDetail? detail)
        {
            var result = new GitModeWhyResult
            {
                IssueNumber = node.IssueNumber,
                Title = node.Title
            };

            // 1. Why Blocked
            var openBlockers = node.BlockedByNumbers.ToList();
            if (detail != null && detail.Blockers.Count > 0)
            {
                var openBList = detail.Blockers.Where(b => b.IsOpen).Select(b => $"#{b.IssueNumber} ('{b.Title}')").ToList();
                if (openBList.Count > 0)
                {
                    result.WhyBlocked = $"Blocked by {openBList.Count} open issue(s): {string.Join(", ", openBList)}.";
                }
                else
                {
                    result.WhyBlocked = "Zero open blockers. All prerequisite dependencies are completed.";
                }
            }
            else if (openBlockers.Count > 0)
            {
                result.WhyBlocked = $"Blocked by {openBlockers.Count} issue(s): #{string.Join(", #", openBlockers)}.";
            }
            else
            {
                result.WhyBlocked = "Zero open blockers. All prerequisite dependencies are completed.";
            }

            // 2. What It Blocks
            if (detail != null && detail.Dependents.Count > 0)
            {
                var depList = detail.Dependents.Select(d => $"#{d.IssueNumber} ('{d.Title}')").ToList();
                result.WhatItBlocks = $"Blocks {depList.Count} downstream issue(s): {string.Join(", ", depList)}.";
            }
            else if (node.BlockingNumbers.Count > 0)
            {
                result.WhatItBlocks = $"Blocks {node.BlockingNumbers.Count} downstream issue(s): #{string.Join(", #", node.BlockingNumbers)}.";
            }
            else
            {
                result.WhatItBlocks = "Does not block any downstream open issues.";
            }

            // 3. Build Requirements
            string bStatus = node.BuildStatus.ToUpperInvariant();
            if (bStatus == "SUCCESS")
            {
                result.BuildRequirements = "Build status: SUCCESS. Build verification is clean.";
            }
            else if (bStatus == "FAILED")
            {
                result.BuildRequirements = "Build status: FAILED. Requires build fix or re-run prior to dispatch.";
            }
            else if (bStatus == "RUNNING")
            {
                result.BuildRequirements = "Build status: RUNNING. Build is currently executing in queue.";
            }
            else if (bStatus == "QUEUED")
            {
                result.BuildRequirements = "Build status: QUEUED. Waiting for build runner turn.";
            }
            else
            {
                result.BuildRequirements = "Build status: NONE. No active build queued.";
            }

            // 4. Dispatchability
            if (node.IsDispatchable && node.IsOpen)
            {
                result.Dispatchability = "⚡ READY FOR DISPATCH. Zero open blockers preventing execution.";
            }
            else if (!node.IsOpen)
            {
                result.Dispatchability = "✓ CLOSED. Issue is completed.";
            }
            else
            {
                result.Dispatchability = "🛑 BLOCKED FROM DISPATCH. Waiting for upstream open blockers to close.";
            }

            // 5. GATE Rules
            if (node.IsGate || (detail != null && detail.GateProgress.IsGate))
            {
                double pct = detail != null ? detail.GateProgress.PercentComplete : 0;
                if (pct >= 100.0)
                {
                    result.GateExplanation = $"✓ GATE IS 100% COMPLETE ({pct}%). Release actions enabled.";
                }
                else
                {
                    result.GateExplanation = $"🛑 GATE IS AT {pct}% COMPLETION. Release actions locked until 100% complete.";
                }
            }
            else
            {
                result.GateExplanation = "Standard issue (Non-GATE).";
            }

            // 6. Next Steps Recommendation
            if (!node.IsOpen)
            {
                result.NextSteps = "Issue is closed. No further action needed.";
            }
            else if (node.IsDispatchable)
            {
                result.NextSteps = "Dispatch work or assign to agent for execution.";
            }
            else if (detail != null && detail.Blockers.Any(b => b.IsOpen))
            {
                var firstBlocker = detail.Blockers.First(b => b.IsOpen);
                result.NextSteps = $"Resolve blocker #{firstBlocker.IssueNumber} ('{firstBlocker.Title}') to unblock this issue.";
            }
            else if (node.BlockedByNumbers.Count > 0)
            {
                result.NextSteps = $"Resolve blocker #{node.BlockedByNumbers.First()} to unblock this issue.";
            }
            else
            {
                result.NextSteps = "Review metadata and move bucket to Batter Up.";
            }

            return result;
        }

        public static GitModeEdgeWhyResult AnalyzeEdge(GitModeGraphEdge edge, GitModeGraphNode? fromNode, GitModeGraphNode? toNode)
        {
            var res = new GitModeEdgeWhyResult
            {
                FromIssue = edge.FromIssue,
                ToIssue = edge.ToIssue,
                EdgeType = edge.EdgeType
            };

            string fromTitle = fromNode != null ? $"#{fromNode.IssueNumber} ('{fromNode.Title}')" : $"#{edge.FromIssue}";
            string toTitle = toNode != null ? $"#{toNode.IssueNumber} ('{toNode.Title}')" : $"#{edge.ToIssue}";

            switch (edge.EdgeType)
            {
                case GitEdgeType.HardBlock:
                    res.Summary = "Hard Block Dependency (Red)";
                    res.Explanation = $"Issue {toTitle} is HARD BLOCKED by open Issue {fromTitle}. {toTitle} cannot be dispatched until {fromTitle} closes.";
                    break;
                case GitEdgeType.SoftBlock:
                    res.Summary = "Soft Block Dependency (Yellow)";
                    res.Explanation = $"Issue {toTitle} has a SOFT BLOCK dependency on Issue {fromTitle}. Recommended order, but not hard locked.";
                    break;
                case GitEdgeType.Resolved:
                    res.Summary = "Resolved Blocker (Green)";
                    res.Explanation = $"Blocker Issue {fromTitle} is CLOSED. Issue {toTitle} is unblocked along this path.";
                    break;
                case GitEdgeType.Build:
                    res.Summary = "Build Dependency (Blue)";
                    res.Explanation = $"Issue {toTitle} requires build output or verification from Issue {fromTitle}.";
                    break;
                case GitEdgeType.Ai:
                    res.Summary = "AI/Agent Dependency (Purple)";
                    res.Explanation = $"Issue {toTitle} requires AI agent coordination or prompt context from Issue {fromTitle}.";
                    break;
                default:
                    res.Summary = "Dependency Link";
                    res.Explanation = $"Issue {fromTitle} connects to Issue {toTitle}.";
                    break;
            }

            return res;
        }
    }
}
