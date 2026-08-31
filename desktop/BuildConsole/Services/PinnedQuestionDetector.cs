using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2105 — Phase 2 of the pinned-questions system (#2036). The prose-parse half of
    /// active detection: given the reply a chat produces to <see cref="ProbePrompt"/>, split it
    /// into DISTINCT questions — one string per question, never bundled — which the host then
    /// persists as individual <c>chat_pinned_questions</c> rows (Phase 1, #2104). This class is
    /// deliberately stateless and side-effect-free: the WebView2 send/receive, the trigger, the
    /// cooldown and the DB writes all live in the host (FloatingChatWindow / LeftSidebar); this
    /// is only the probe text and the parser, so both are unit-reasoned and testable in isolation.
    ///
    /// Parsing is a genuine judgment call with no single correct answer (see the issue). The
    /// approach here is: shape the probe so the agent answers in a strict, machine-parseable
    /// format (one "Q: …" line per question, or the single token NONE), parse THAT as the primary
    /// path, and fall back to a best-effort heuristic ONLY when the agent ignored the format.
    /// Its known limitations are documented honestly in build-journal/2105.md rather than
    /// overstated here — the agent may not honour the format, may re-raise an already-resolved
    /// question, or may phrase a single ask as several sentences.
    /// </summary>
    public static class PinnedQuestionDetector
    {
        /// <summary>
        /// The probe sent into the chat. It is "something like 'are there any outstanding
        /// questions for Shane?'" (the issue's words) but shaped for a deterministic parse: the
        /// agent is asked to answer in a strict format so <see cref="ParseQuestions"/> has a
        /// reliable primary path instead of guessing at free prose.
        /// </summary>
        public const string ProbePrompt =
            "Are there any questions or decisions you are currently waiting on from Shane before you can continue?\n\n" +
            "Reply in EXACTLY this format and nothing else:\n" +
            "- If there are none, reply with the single word: NONE\n" +
            "- Otherwise put each distinct outstanding question on its own line, each line beginning with \"Q: \" and containing only that one question. Do not number them, do not merge two questions onto one line, and do not add any commentary before or after the list.";

        /// <summary>
        /// Splits the probe answer into distinct questions. Returns an empty list when the answer
        /// clearly indicates there are none. Never returns a single bundled string containing more
        /// than one question when the format (or heuristics) let them be separated.
        /// </summary>
        public static List<string> ParseQuestions(string? answerMarkdown)
        {
            var result = new List<string>();
            if (string.IsNullOrWhiteSpace(answerMarkdown)) return result;

            var text = answerMarkdown.Replace("\r\n", "\n").Replace("\r", "\n");
            var lines = text.Split('\n');

            // ── Primary path: the strict "Q: …" lines the probe prompt asks for. ──
            // Tolerate a leading list marker the agent may add anyway ("- Q: …").
            var qLine = new Regex(@"^\s*(?:[-*•]\s*)?Q\s*[:\-]\s*(.+?)\s*$", RegexOptions.IgnoreCase);
            foreach (var line in lines)
            {
                var m = qLine.Match(line);
                if (!m.Success) continue;
                var q = Clean(m.Groups[1].Value);
                if (IsUsableQuestion(q)) AddUnique(result, q);
            }
            if (result.Count > 0) return result;

            // ── Explicit "none": the probe's NONE token, or an ordinary prose no, with no
            // question actually present. Guard against a false negative by requiring there be
            // no question mark anywhere before treating it as "nothing outstanding". ──
            var flat = Clean(text);
            if (LooksLikeNoQuestions(flat)) return result;

            // ── Fallback heuristic (the agent ignored the format). Best-effort only. ──
            // First, structured list items that are genuinely questions.
            var bullet = new Regex(@"^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$");
            foreach (var line in lines)
            {
                var m = bullet.Match(line);
                if (!m.Success) continue;
                var item = Clean(m.Groups[1].Value);
                if (item.IndexOf('?') >= 0 && IsUsableQuestion(item)) AddUnique(result, item);
            }
            if (result.Count > 0) return result;

            // Last resort: sentence-split the whole prose and keep the interrogatives. This can
            // over- or under-split; it exists so a totally free-form reply still yields SOMETHING
            // rather than nothing, and is the least reliable path (documented in the bookend).
            foreach (var sentence in SplitSentences(flat))
            {
                var s = sentence.Trim();
                if (s.EndsWith("?") && IsUsableQuestion(s)) AddUnique(result, s);
            }
            return result;
        }

        // Strip list markers, markdown emphasis/backticks and surrounding quotes, and collapse
        // internal whitespace, so two DB rows that differ only in cosmetics don't slip past the
        // partial-unique-index dedupe (#2104).
        private static string Clean(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "";
            var s = raw.Trim();
            s = Regex.Replace(s, @"^\s*(?:[-*•]|\d+[.)])\s+", "");   // leading bullet/number
            s = s.Replace("**", "").Replace("`", "");                 // md emphasis / inline code
            s = s.Trim().Trim('"', '“', '”', '\'').Trim();  // surrounding quotes
            s = Regex.Replace(s, @"\s+", " ");                        // collapse whitespace
            return s.Trim();
        }

        private static bool IsUsableQuestion(string q)
        {
            if (string.IsNullOrWhiteSpace(q)) return false;
            if (q.Length < 5) return false;                 // "ok?", "y?" — noise
            if (Regex.IsMatch(q, "[A-Za-z]") == false) return false; // must have letters
            // A lone "NONE"/"none" that slipped through as a Q: line is not a question.
            if (Regex.IsMatch(q, @"^none[.!]?$", RegexOptions.IgnoreCase)) return false;
            return true;
        }

        private static bool LooksLikeNoQuestions(string flat)
        {
            if (string.IsNullOrWhiteSpace(flat)) return true;
            if (flat.IndexOf('?') >= 0) return false; // a question mark is present — not "none"
            var lower = flat.ToLowerInvariant();
            if (Regex.IsMatch(lower, @"^\s*none[.!]?\s*$")) return true;
            return lower.Contains("no outstanding")
                || lower.Contains("no pending")
                || lower.Contains("no open question")
                || lower.Contains("no questions")
                || lower.Contains("nothing outstanding")
                || lower.Contains("nothing pending")
                || lower.Contains("not waiting on")
                || lower.Contains("no decisions")
                || (lower.StartsWith("no,") && lower.Length < 120);
        }

        private static IEnumerable<string> SplitSentences(string flat)
        {
            // Keep the terminating '?' with its sentence so EndsWith('?') works downstream.
            return Regex.Split(flat, @"(?<=[.?!])\s+");
        }

        private static void AddUnique(List<string> list, string q)
        {
            foreach (var existing in list)
                if (string.Equals(existing, q, StringComparison.OrdinalIgnoreCase)) return;
            list.Add(q);
        }
    }
}
