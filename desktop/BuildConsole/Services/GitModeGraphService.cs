using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using Npgsql;

namespace BuildConsole.Services
{
    public enum GitChainMode
    {
        FullChain,
        BlockersOnly,
        DependentsOnly
    }

    public enum GitEdgeType
    {
        HardBlock,   // Red
        SoftBlock,   // Yellow
        Resolved,    // Green
        Build,       // Blue
        Ai           // Purple
    }

    public class GitModeGraphNode
    {
        public int IssueNumber { get; set; }
        public string Title { get; set; } = "";
        public string State { get; set; } = "open";
        public bool IsOpen => string.Equals(State, "open", StringComparison.OrdinalIgnoreCase);
        public bool IsCompletedBlocker { get; set; }

        public int MilestoneNumber { get; set; }
        public string MilestoneTitle { get; set; } = "";
        public int ParentNumber { get; set; }
        public bool IsGate { get; set; }

        public string Bucket { get; set; } = "Backlog";
        public List<string> Labels { get; set; } = new List<string>();
        public string BuildStatus { get; set; } = "none"; // success, failed, running, queued, none
        public bool IsDispatchable { get; set; }

        public List<int> BlockedByNumbers { get; set; } = new List<int>();
        public List<int> BlockingNumbers { get; set; } = new List<int>();

        // Layout metrics
        public int RankColumn { get; set; }
        public double X { get; set; }
        public double Y { get; set; }
        public double Width { get; set; } = 220;
        public double Height { get; set; } = 90;

        // Interactive highlight state
        public bool IsSelected { get; set; }
        public bool IsHighlighted { get; set; }
        public bool IsGhosted { get; set; }
    }

    public class GitModeGraphEdge
    {
        public int FromIssue { get; set; }
        public int ToIssue { get; set; }
        public GitEdgeType EdgeType { get; set; } = GitEdgeType.HardBlock;
        public Point StartPoint { get; set; }
        public Point ControlPoint1 { get; set; }
        public Point ControlPoint2 { get; set; }
        public Point EndPoint { get; set; }

        public bool IsHighlighted { get; set; }
        public bool IsGhosted { get; set; }
    }

    public class GitModeGraphContainer
    {
        public string Header { get; set; } = "";
        public Rect Bounds { get; set; }
        public string Type { get; set; } = "Milestone"; // Milestone, GATE, Epic, Feature
    }

    public class GitModeGraphData
    {
        public List<GitModeGraphNode> Nodes { get; set; } = new List<GitModeGraphNode>();
        public List<GitModeGraphEdge> Edges { get; set; } = new List<GitModeGraphEdge>();
        public List<GitModeGraphContainer> Containers { get; set; } = new List<GitModeGraphContainer>();
        public double TotalWidth { get; set; } = 1200;
        public double TotalHeight { get; set; } = 800;
    }

    /// <summary>
    /// Data loader and layout engine for Phase 3 Middle Panel (Graph).
    /// Loads open issues + direct completed blockers from local Postgres.
    /// Calculates left-to-right DAG layout with curved edges and zero overlapping nodes.
    /// </summary>
    public static class GitModeGraphService
    {
        public static string NormalizeBuildStatus(string? rawStatus, List<string>? labels = null)
        {
            if (labels != null && (labels.Contains("outdated", StringComparer.OrdinalIgnoreCase) || labels.Contains("build-outdated", StringComparer.OrdinalIgnoreCase)))
            {
                return "outdated";
            }
            if (string.IsNullOrWhiteSpace(rawStatus) || rawStatus.Equals("none", StringComparison.OrdinalIgnoreCase))
            {
                return "missing";
            }
            var s = rawStatus.Trim().ToLowerInvariant();
            return s switch
            {
                "built" or "success" or "done" or "passed" or "completed" => "built",
                "failed" or "failure" or "error" or "canceled" => "failed",
                "outdated" or "stale" => "outdated",
                "pending" or "queued" or "running" or "in_progress" or "verifying" => "pending",
                "missing" or "none" => "missing",
                _ => "missing"
            };
        }

        public static async Task<GitModeGraphData> LoadGraphFromPostgresAsync(
            int? milestoneFilter = null,
            int? epicFilter = null,
            string? bucketFilter = null,
            string? buildStatusFilter = null,
            bool? dispatchableOnly = null)
        {
            var data = new GitModeGraphData();
            var connStr = GitModeTreeService.ResolveConnectionString();
            if (string.IsNullOrWhiteSpace(connStr)) return data;

            var rawNodes = new Dictionary<int, GitModeGraphNode>();
            var buildStatuses = new Dictionary<int, string>();

            try
            {
                using var conn = new NpgsqlConnection(connStr);
                await conn.OpenAsync();

                // 1. Fetch build queue status for issues
                using (var cmd = new NpgsqlCommand("SELECT github_number, status FROM bt_build_queue WHERE github_number IS NOT NULL AND status IS NOT NULL ORDER BY id DESC", conn))
                using (var rdr = await cmd.ExecuteReaderAsync())
                {
                    while (await rdr.ReadAsync())
                    {
                        int num = rdr.GetInt32(0);
                        if (!buildStatuses.ContainsKey(num))
                        {
                            buildStatuses[num] = rdr.GetString(1).ToLowerInvariant();
                        }
                    }
                }

                // 2. Fetch all issues from bt_issue_mirror
                using (var cmd = new NpgsqlCommand(@"
                    SELECT 
                        issue_number, 
                        title, 
                        state, 
                        COALESCE(milestone_number, 0) as milestone_number, 
                        COALESCE(milestone_title, '') as milestone_title,
                        COALESCE(parent_number, 0) as parent_number,
                        COALESCE(board_status_name, 'Backlog') as bucket,
                        COALESCE(blocked_by_numbers, ARRAY[]::integer[]) as blocked_by_numbers,
                        COALESCE(blocking_numbers, ARRAY[]::integer[]) as blocking_numbers,
                        COALESCE(labels, ARRAY[]::text[]) as labels
                    FROM bt_issue_mirror", conn))
                using (var rdr = await cmd.ExecuteReaderAsync())
                {
                    while (await rdr.ReadAsync())
                    {
                        var n = new GitModeGraphNode
                        {
                            IssueNumber = rdr.GetInt32(0),
                            Title = rdr.IsDBNull(1) ? "" : rdr.GetString(1),
                            State = rdr.IsDBNull(2) ? "open" : rdr.GetString(2),
                            MilestoneNumber = rdr.GetInt32(3),
                            MilestoneTitle = rdr.GetString(4),
                            ParentNumber = rdr.GetInt32(5),
                            Bucket = rdr.GetString(6)
                        };

                        // Check if GATE
                        n.IsGate = n.Title.StartsWith("GATE", StringComparison.OrdinalIgnoreCase) ||
                                   n.Title.Contains("GATE", StringComparison.OrdinalIgnoreCase);

                        // BlockedBy
                        if (!rdr.IsDBNull(7))
                        {
                            if (rdr.GetValue(7) is int[] blockedArr)
                            {
                                n.BlockedByNumbers.AddRange(blockedArr);
                            }
                        }

                        // Blocking
                        if (!rdr.IsDBNull(8))
                        {
                            if (rdr.GetValue(8) is int[] blockingArr)
                            {
                                n.BlockingNumbers.AddRange(blockingArr);
                            }
                        }

                        // Labels
                        if (!rdr.IsDBNull(9))
                        {
                            if (rdr.GetValue(9) is string[] lblArr)
                            {
                                n.Labels.AddRange(lblArr);
                            }
                        }

                        if (buildStatuses.TryGetValue(n.IssueNumber, out var bStatus))
                        {
                            n.BuildStatus = NormalizeBuildStatus(bStatus, n.Labels);
                        }
                        else
                        {
                            n.BuildStatus = NormalizeBuildStatus("missing", n.Labels);
                        }

                        rawNodes[n.IssueNumber] = n;
                    }
                }
            }
            catch
            {
                // Fallback / log error
            }

            if (rawNodes.Count == 0) return data;

            // Precompute GATE completion status by Milestone
            var milestoneGateMap = new Dictionary<int, bool>();
            foreach (var msGroup in rawNodes.Values.GroupBy(n => n.MilestoneNumber))
            {
                if (msGroup.Key <= 0) continue;
                int totalInMs = msGroup.Count();
                int closedInMs = msGroup.Count(n => !n.IsOpen);
                milestoneGateMap[msGroup.Key] = (totalInMs > 0 && closedInMs == totalInMs);
            }

            // 3. Determine open issues vs completed blockers rule
            // "Graph shows ONLY open issues. Completed issues appear ONLY if they are direct blockers (dimmed)."
            var openNodes = rawNodes.Values.Where(n => n.IsOpen).ToList();

            var directCompletedBlockerNumbers = new HashSet<int>();
            foreach (var openNode in openNodes)
            {
                foreach (var bNum in openNode.BlockedByNumbers)
                {
                    if (rawNodes.TryGetValue(bNum, out var bNode) && !bNode.IsOpen)
                    {
                        bNode.IsCompletedBlocker = true;
                        directCompletedBlockerNumbers.Add(bNum);
                    }
                }
            }

            var activeNodesMap = new Dictionary<int, GitModeGraphNode>();
            foreach (var openNode in openNodes)
            {
                activeNodesMap[openNode.IssueNumber] = openNode;
            }
            foreach (var bNum in directCompletedBlockerNumbers)
            {
                if (rawNodes.TryGetValue(bNum, out var cNode))
                {
                    activeNodesMap[bNum] = cNode;
                }
            }

            // PHASE 7 DISPATCHABILITY RULES:
            // Issue dispatchable ONLY IF:
            // 1. All blockers resolved
            // 2. All required builds exist (status is 'built')
            // 3. GATE complete (if applicable)
            foreach (var node in activeNodesMap.Values)
            {
                if (node.IsOpen)
                {
                    int openBlockerCount = node.BlockedByNumbers.Count(bNum => rawNodes.TryGetValue(bNum, out var bn) && bn.IsOpen);
                    bool allBlockersResolved = (openBlockerCount == 0);

                    bool requiredBuildsExist = string.Equals(node.BuildStatus, "built", StringComparison.OrdinalIgnoreCase);

                    bool gateComplete = true;
                    if (node.IsGate)
                    {
                        var msNodes = rawNodes.Values.Where(n => n.MilestoneNumber == node.MilestoneNumber).ToList();
                        int total = msNodes.Count;
                        int closed = msNodes.Count(n => !n.IsOpen);
                        gateComplete = (total > 0 && closed == total);
                    }
                    else if (node.MilestoneNumber > 0 && milestoneGateMap.TryGetValue(node.MilestoneNumber, out var isMsGateComplete))
                    {
                        gateComplete = isMsGateComplete;
                    }

                    node.IsDispatchable = allBlockersResolved && requiredBuildsExist && gateComplete;
                }
                else
                {
                    node.IsDispatchable = false;
                }
            }

            // 4. Apply Filters
            var filteredNodes = activeNodesMap.Values.AsEnumerable();

            if (milestoneFilter.HasValue && milestoneFilter.Value > 0)
            {
                filteredNodes = filteredNodes.Where(n => n.MilestoneNumber == milestoneFilter.Value);
            }
            if (epicFilter.HasValue && epicFilter.Value > 0)
            {
                filteredNodes = filteredNodes.Where(n => n.ParentNumber == epicFilter.Value || n.IssueNumber == epicFilter.Value);
            }
            if (!string.IsNullOrWhiteSpace(bucketFilter) && !bucketFilter.Equals("All", StringComparison.OrdinalIgnoreCase))
            {
                filteredNodes = filteredNodes.Where(n => string.Equals(n.Bucket, bucketFilter, StringComparison.OrdinalIgnoreCase));
            }
            if (!string.IsNullOrWhiteSpace(buildStatusFilter) && !buildStatusFilter.Equals("All", StringComparison.OrdinalIgnoreCase))
            {
                filteredNodes = filteredNodes.Where(n => string.Equals(n.BuildStatus, buildStatusFilter, StringComparison.OrdinalIgnoreCase));
            }
            if (dispatchableOnly.HasValue && dispatchableOnly.Value)
            {
                filteredNodes = filteredNodes.Where(n => n.IsDispatchable);
            }

            var renderNodesList = filteredNodes.ToList();
            var renderNodeIds = new HashSet<int>(renderNodesList.Select(n => n.IssueNumber));

            // 5. Calculate Topological Left-to-Right Ranks
            CalculateRanks(renderNodesList, renderNodeIds);

            // 6. Layout Coordinates (Auto-spacing & Grouping)
            CalculateLayoutCoordinates(data, renderNodesList);

            // 7. Generate Curved Edges with Bezier Segments
            GenerateEdges(data, renderNodesList, renderNodeIds, rawNodes);

            return data;
        }

        private static void CalculateRanks(List<GitModeGraphNode> nodes, HashSet<int> nodeIds)
        {
            var nodeMap = nodes.ToDictionary(n => n.IssueNumber);
            var visited = new HashSet<int>();

            int GetRank(GitModeGraphNode n)
            {
                if (visited.Contains(n.IssueNumber)) return n.RankColumn;
                visited.Add(n.IssueNumber);

                int maxBlockerRank = -1;
                foreach (var bNum in n.BlockedByNumbers)
                {
                    if (nodeIds.Contains(bNum) && nodeMap.TryGetValue(bNum, out var bNode))
                    {
                        int r = GetRank(bNode);
                        if (r > maxBlockerRank) maxBlockerRank = r;
                    }
                }

                n.RankColumn = maxBlockerRank + 1;
                return n.RankColumn;
            }

            foreach (var n in nodes)
            {
                GetRank(n);
            }
        }

        private static void CalculateLayoutCoordinates(GitModeGraphData data, List<GitModeGraphNode> nodes)
        {
            if (nodes.Count == 0) return;

            double nodeWidth = 220;
            double nodeHeight = 95;
            double vGap = 35;
            double hGap = 60;
            double startX = 40;
            double startY = 40;

            var maxRank = nodes.Max(n => n.RankColumn);
            var rankGroups = nodes.GroupBy(n => n.RankColumn).ToDictionary(g => g.Key, g => g.OrderBy(n => n.ParentNumber).ThenBy(n => n.IssueNumber).ToList());

            double maxCanvasHeight = 0;

            for (int r = 0; r <= maxRank; r++)
            {
                if (!rankGroups.TryGetValue(r, out var columnNodes)) continue;

                double currentY = startY;
                double currentX = startX + r * (nodeWidth + hGap);

                foreach (var node in columnNodes)
                {
                    node.X = currentX;
                    node.Y = currentY;
                    node.Width = nodeWidth;
                    node.Height = nodeHeight;

                    currentY += nodeHeight + vGap;
                }

                if (currentY > maxCanvasHeight) maxCanvasHeight = currentY;
            }

            data.Nodes = nodes;
            data.TotalWidth = Math.Max(1200, startX + (maxRank + 1) * (nodeWidth + hGap) + 100);
            data.TotalHeight = Math.Max(800, maxCanvasHeight + 100);

            // Compute containers (Milestone / Epic groupings)
            var milestoneGroups = nodes.GroupBy(n => n.MilestoneTitle).Where(g => !string.IsNullOrEmpty(g.Key));
            foreach (var mg in milestoneGroups)
            {
                double minX = mg.Min(n => n.X) - 15;
                double minY = mg.Min(n => n.Y) - 30;
                double maxX = mg.Max(n => n.X + n.Width) + 15;
                double maxY = mg.Max(n => n.Y + n.Height) + 15;

                data.Containers.Add(new GitModeGraphContainer
                {
                    Header = string.IsNullOrWhiteSpace(mg.Key) ? "Milestone" : mg.Key,
                    Bounds = new Rect(minX, minY, Math.Max(260, maxX - minX), Math.Max(140, maxY - minY)),
                    Type = "Milestone"
                });
            }
        }

        private static void GenerateEdges(GitModeGraphData data, List<GitModeGraphNode> nodes, HashSet<int> nodeIds, Dictionary<int, GitModeGraphNode> rawNodes)
        {
            var nodeMap = nodes.ToDictionary(n => n.IssueNumber);

            foreach (var toNode in nodes)
            {
                foreach (var fromNum in toNode.BlockedByNumbers)
                {
                    if (nodeIds.Contains(fromNum) && nodeMap.TryGetValue(fromNum, out var fromNode))
                    {
                        var edge = new GitModeGraphEdge
                        {
                            FromIssue = fromNum,
                            ToIssue = toNode.IssueNumber,
                            StartPoint = new Point(fromNode.X + fromNode.Width, fromNode.Y + fromNode.Height / 2),
                            EndPoint = new Point(toNode.X, toNode.Y + toNode.Height / 2)
                        };

                        // Bezier control points for smooth left-to-right curve
                        double dx = edge.EndPoint.X - edge.StartPoint.X;
                        double controlOffset = Math.Max(30, dx * 0.4);

                        edge.ControlPoint1 = new Point(edge.StartPoint.X + controlOffset, edge.StartPoint.Y);
                        edge.ControlPoint2 = new Point(edge.EndPoint.X - controlOffset, edge.EndPoint.Y);

                        // Edge Color Type
                        if (fromNode.IsCompletedBlocker || !fromNode.IsOpen)
                        {
                            edge.EdgeType = GitEdgeType.Resolved; // Green
                        }
                        else if (toNode.Title.Contains("AI", StringComparison.OrdinalIgnoreCase) || fromNode.Title.Contains("AI", StringComparison.OrdinalIgnoreCase))
                        {
                            edge.EdgeType = GitEdgeType.Ai; // Purple
                        }
                        else if (toNode.Title.Contains("Build", StringComparison.OrdinalIgnoreCase) || fromNode.Title.Contains("Build", StringComparison.OrdinalIgnoreCase))
                        {
                            edge.EdgeType = GitEdgeType.Build; // Blue
                        }
                        else if (toNode.Labels.Contains("soft-block", StringComparer.OrdinalIgnoreCase))
                        {
                            edge.EdgeType = GitEdgeType.SoftBlock; // Yellow
                        }
                        else
                        {
                            edge.EdgeType = GitEdgeType.HardBlock; // Red
                        }

                        data.Edges.Add(edge);
                    }
                }
            }
        }

        public static void ApplyChainHighlighting(GitModeGraphData data, int selectedIssueNumber, GitChainMode chainMode)
        {
            if (selectedIssueNumber <= 0)
            {
                // Clear all highlights
                foreach (var n in data.Nodes)
                {
                    n.IsSelected = false;
                    n.IsHighlighted = false;
                    n.IsGhosted = false;
                }
                foreach (var e in data.Edges)
                {
                    e.IsHighlighted = false;
                    e.IsGhosted = false;
                }
                return;
            }

            var highlightedNodes = new HashSet<int> { selectedIssueNumber };
            var highlightedEdges = new List<GitModeGraphEdge>();

            // Upstream (Blockers) walk
            void WalkUpstream(int currentId)
            {
                foreach (var edge in data.Edges.Where(e => e.ToIssue == currentId))
                {
                    highlightedEdges.Add(edge);
                    if (highlightedNodes.Add(edge.FromIssue))
                    {
                        WalkUpstream(edge.FromIssue);
                    }
                }
            }

            // Downstream (Dependents) walk
            void WalkDownstream(int currentId)
            {
                foreach (var edge in data.Edges.Where(e => e.FromIssue == currentId))
                {
                    highlightedEdges.Add(edge);
                    if (highlightedNodes.Add(edge.ToIssue))
                    {
                        WalkDownstream(edge.ToIssue);
                    }
                }
            }

            if (chainMode == GitChainMode.FullChain || chainMode == GitChainMode.BlockersOnly)
            {
                WalkUpstream(selectedIssueNumber);
            }
            if (chainMode == GitChainMode.FullChain || chainMode == GitChainMode.DependentsOnly)
            {
                WalkDownstream(selectedIssueNumber);
            }

            var edgeSet = new HashSet<GitModeGraphEdge>(highlightedEdges);

            foreach (var n in data.Nodes)
            {
                n.IsSelected = (n.IssueNumber == selectedIssueNumber);
                n.IsHighlighted = highlightedNodes.Contains(n.IssueNumber);
                n.IsGhosted = !n.IsHighlighted;
            }

            foreach (var e in data.Edges)
            {
                e.IsHighlighted = edgeSet.Contains(e);
                e.IsGhosted = !e.IsHighlighted;
            }
        }
    }
}
