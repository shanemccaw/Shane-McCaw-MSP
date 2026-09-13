using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace BuildConsole.Services
{
    /// <summary>
    /// The one parser for a queued build prompt's leading <c>--flag value</c> header line
    /// (<c>--model … --effort … --title … --blocked-by …</c>), shared by
    /// <see cref="EditBuildPromptDialog"/> and <see cref="BuildQueuePostgresClient.QueueBuildAsync"/>.
    ///
    /// Git #3623 — moved here out of EditBuildPromptDialog so the queue's own insert path can read
    /// the dispatch's declared <c>--blocked-by</c> numbers itself. #3585 was auto-queued by Batter Up
    /// with a prompt whose first line was <c>--model claude-sonnet-5 --effort low --title 3585
    /// --blocked-by 3582,3584</c>, yet its row landed with blocked_by_numbers NULL, because no caller
    /// on that path ever read the flag. BUILD_QUEUE_BLOCKING_AND_GATING.md §3 calls that flag "the
    /// bridge" from the dispatch to the enforced local blockers; this makes the bridge part of the
    /// insert itself rather than something each caller has to remember.
    /// </summary>
    public static class BuildPromptHeader
    {
        private static readonly Regex FlagRe = new(@"--([\w-]+)\s+(\S+)", RegexOptions.Compiled);

        /// <summary>
        /// Splits a prompt into its leading flag line and the rest. The whole first line must be
        /// flags only, or none are parsed and the full text is returned as the body (the header
        /// convention in CLAUDE.md).
        /// </summary>
        public static (Dictionary<string, string> flags, string rest) ExtractLeadingFlags(string text)
        {
            int newlineIdx = text.IndexOf('\n');
            string firstLine = newlineIdx == -1 ? text : text.Substring(0, newlineIdx);

            // Allow a valueless --notGit (the letter id is auto-allocated). Normalize a bare
            // "--notGit" (end of line, or immediately before another --flag) to "--notGit local"
            // so the flag/value regex below still recognizes it. "--notGit 109" is untouched
            // (its value is simply ignored downstream).
            firstLine = Regex.Replace(firstLine, @"--notGit(?=\s+--|\s*$)", "--notGit local");

            var flags = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            foreach (Match m in FlagRe.Matches(firstLine))
            {
                flags[m.Groups[1].Value] = m.Groups[2].Value;
            }

            if (flags.Count == 0 || FlagRe.Replace(firstLine, "").Trim() != "")
            {
                return (new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase), text);
            }

            string rest = newlineIdx == -1 ? "" : text.Substring(newlineIdx + 1).TrimStart('\r', '\n');
            return (flags, rest);
        }

        /// <summary>
        /// Git #3623 — the real GitHub issue numbers a prompt's header declares via
        /// <c>--blocked-by</c> (comma-separated). Only positive integers count: a letter token that
        /// slipped into <c>--blocked-by</c> is a LOCAL reference MainWindow already resolves through
        /// the registry, and <c>--block-by</c> (local letter ids) is deliberately not read here.
        /// Empty when the prompt has no valid header line or no <c>--blocked-by</c> flag.
        /// </summary>
        public static List<int> ParseGitHubBlockers(string? prompt)
        {
            if (string.IsNullOrWhiteSpace(prompt)) return new List<int>();
            var (flags, _) = ExtractLeadingFlags(prompt.TrimStart());
            if (!flags.TryGetValue("blocked-by", out var csv) || string.IsNullOrWhiteSpace(csv))
                return new List<int>();

            return csv.Split(',')
                .Select(s => s.Trim().TrimStart('#'))
                .Select(s => int.TryParse(s, out var n) ? n : 0)
                .Where(n => n > 0)
                .Distinct()
                .ToList();
        }

        /// <summary>
        /// Git #3872 — a prompt header's optional <c>--epic &lt;N&gt;</c> override: an explicit
        /// declaration of this build's real Epic, bypassing <see cref="EpicResolver"/>'s DB-inferred
        /// <c>parent_number</c> walk entirely for cases where the local mirror hasn't caught up yet
        /// (#3871's sync-gap fix is the root-cause remedy; this is the independent, explicit-declaration
        /// safety net, not a replacement for it) or an issue's real Epic is otherwise ambiguous/slow to
        /// resolve. Null when the prompt has no valid header line, no <c>--epic</c> flag, or the value
        /// isn't a positive integer.
        /// </summary>
        public static int? ParseEpicNumber(string? prompt)
        {
            if (string.IsNullOrWhiteSpace(prompt)) return null;
            var (flags, _) = ExtractLeadingFlags(prompt.TrimStart());
            if (!flags.TryGetValue("epic", out var raw) || string.IsNullOrWhiteSpace(raw))
                return null;

            var trimmed = raw.Trim().TrimStart('#');
            return int.TryParse(trimmed, out var n) && n > 0 ? n : (int?)null;
        }
    }
}
