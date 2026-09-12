using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3724 — the context gauge (<see cref="Controls.ChatDocumentContainer"/>'s Band 1) used to
    /// fold a single opaque <c>FixedOverhead = 40_000</c> constant into its total with no explanation
    /// of what it represented or whether it was still the right order of magnitude. This class breaks
    /// that into its two real, separately-documented components:
    ///
    /// 1. <see cref="SystemPromptOverheadTokens"/> — a fixed, documented estimate of Claude's own
    ///    system prompt cost on claude.ai.
    /// 2. <see cref="GetMcpToolSchemaOverheadTokens"/> — the token cost of every MCP connector's tool
    ///    schemas (name + description, sent to the model on every turn), computed from
    ///    <c>mcp-tool-inventory.json</c>.
    ///
    /// <b>Honesty, per the issue's own instruction:</b> neither of these is a real measurement of
    /// what Anthropic's servers actually send. BuildConsole wraps claude.ai in a WebView2; it has no
    /// API and no DOM surface that exposes the live system prompt text or a chat's actual connected
    /// MCP tool schemas. Both numbers below are documented, reasoned approximations from real
    /// external/in-repo sources — never fabricated data — and are labeled as such everywhere they're
    /// surfaced (see <see cref="OverheadBreakdown.IsExtrapolated"/> per-server).
    /// </summary>
    public static class ChatContextOverheadEstimator
    {
        /// <summary>
        /// Git #3724 — Claude's own claude.ai system prompt is not something BuildConsole can read or
        /// measure from a WebView2 (it's never sent to the client, only to the model server-side).
        /// This value is the order-of-magnitude estimate cited by the issue's own reference design
        /// (`AndrewSWinston/context-coach`, a Chrome extension solving the identical problem for
        /// claude.ai/chatgpt.com, which documents ~15K tokens for Claude's system prompt). Treat this
        /// as a documented external estimate, not a direct measurement — if a more authoritative
        /// figure ever becomes available (Anthropic publishes one, or a real leaked/verified prompt
        /// dump is measured directly), replace this constant and update this comment with the source.
        /// </summary>
        public const double SystemPromptOverheadTokens = 15_000;

        private const double CharsPerTokenForToolSchemas = 4.0;

        private static readonly string InventoryPath = ResolveInventoryPath();

        private static string ResolveInventoryPath()
        {
            var repoRoot = BuildTrackerConfig.FindRepoRoot();
            var baseDir = !string.IsNullOrEmpty(repoRoot) ? repoRoot : AppContext.BaseDirectory;
            return Path.Combine(baseDir, "desktop", "BuildConsole", "mcp-tool-inventory.json");
        }

        public sealed class ServerOverhead
        {
            public string Name { get; set; } = "";
            public int ToolCount { get; set; }
            public double Tokens { get; set; }
            public bool IsExtrapolated { get; set; }
        }

        public sealed class OverheadBreakdown
        {
            public double TotalTokens { get; set; }
            public List<ServerOverhead> Servers { get; set; } = new();
        }

        private class InventoryTool
        {
            public string? Name { get; set; }
            public string? Description { get; set; }
        }

        private class InventoryServer
        {
            public string? Name { get; set; }
            public bool Documented { get; set; }
            public int ToolCount { get; set; }
            public List<InventoryTool>? Tools { get; set; }
        }

        private class InventoryFile
        {
            public List<InventoryServer>? Servers { get; set; }
        }

        /// <summary>
        /// Git #3724 — re-reads <c>mcp-tool-inventory.json</c> from disk on EVERY call (the file is a
        /// few KB; this is not a hot path — the gauge recomputes on a UI tick, not per keystroke).
        /// This is deliberate, not an oversight: there is no live push signal for "a connector's tool
        /// list changed" (BuildConsole cannot observe claude.ai's account-level connector state at
        /// all), so re-reading the file is what "refreshed when the tool list changes" means in
        /// practice here — edit the file, the very next gauge tick reflects it, no restart needed.
        /// A missing/malformed file returns an empty breakdown (0 tokens) rather than throwing, same
        /// failure-open convention as the rest of the context-meter chain.
        /// </summary>
        public static OverheadBreakdown GetMcpToolSchemaOverhead()
        {
            var result = new OverheadBreakdown();
            InventoryFile? inventory;
            try
            {
                if (!File.Exists(InventoryPath)) return result;
                var json = File.ReadAllText(InventoryPath);
                inventory = JsonSerializer.Deserialize<InventoryFile>(json,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch (Exception ex)
            {
                ActivityLog.Log("system.core.chat-context",
                    $"ChatContextOverheadEstimator: failed to read/parse {InventoryPath} — {ex.Message}. MCP tool-schema overhead reads as 0 for this tick (fail-open, same convention as the rest of the context-meter chain).");
                return result;
            }

            if (inventory?.Servers == null || inventory.Servers.Count == 0) return result;

            // Pass 1 — real, documented servers: sum ACTUAL name+description character length /4.
            // This is a genuine measurement of real text held in this repo (extracted from
            // BuildConsole-Chat-Tools-Reference.md), not an invented number.
            double documentedTokens = 0;
            int documentedTools = 0;
            foreach (var server in inventory.Servers.Where(s => s.Documented && s.Tools != null && s.Tools.Count > 0))
            {
                double chars = 0;
                foreach (var tool in server.Tools!)
                {
                    chars += (tool.Name?.Length ?? 0) + (tool.Description?.Length ?? 0);
                }
                double tokens = chars / CharsPerTokenForToolSchemas;
                result.Servers.Add(new ServerOverhead
                {
                    Name = server.Name ?? "(unnamed)",
                    ToolCount = server.Tools!.Count,
                    Tokens = tokens,
                    IsExtrapolated = false
                });
                documentedTokens += tokens;
                documentedTools += server.Tools!.Count;
            }

            // Pass 2 — undocumented servers (a real, known tool COUNT with no per-tool text anywhere
            // in this codebase, e.g. Shanes-Life-Production's 92 tools — Shane's own account, entirely
            // outside this repo). Extrapolate from the documented servers' own real average
            // tokens/tool rather than fabricating per-tool schema text. If there is no documented
            // server to derive an average from, this server contributes 0 (fail-open, not a guess).
            double avgTokensPerDocumentedTool = documentedTools > 0 ? documentedTokens / documentedTools : 0;
            foreach (var server in inventory.Servers.Where(s => !s.Documented))
            {
                double tokens = server.ToolCount * avgTokensPerDocumentedTool;
                result.Servers.Add(new ServerOverhead
                {
                    Name = server.Name ?? "(unnamed)",
                    ToolCount = server.ToolCount,
                    Tokens = tokens,
                    IsExtrapolated = true
                });
            }

            result.TotalTokens = result.Servers.Sum(s => s.Tokens);
            return result;
        }
    }
}
