using System;
using System.Text;
using System.Text.RegularExpressions;

namespace BuildConsole.Services
{
    /// <summary>
    /// Pulls checklist items out of an agent's own reported progress text, for the Build
    /// Watch "Task Checklist" side panel (<see cref="Controls.TaskChecklistViewModel"/>).
    ///
    /// Detection is deliberately NARROW — only genuine, matchable checklist markers count,
    /// never free-form bullet lists in general (a plain "- do the thing" line is prose, not
    /// a checklist item). The markers we accept:
    ///   • Unicode ballot boxes:  ☐ (U+2610) unchecked, ☑ (U+2611) checked
    ///   • Bare check marks:      ✓ (U+2713) / ✔ (U+2714)  → treated as "done"
    ///   • Markdown task list:    "- [ ]" pending, "- [x]" / "- [X]" done (also "* [ ]", "1. [ ]")
    ///
    /// A ✓/✔ that leads a line is a "done" report; ☐ / "- [ ]" is a "pending" item. The
    /// remaining text after the marker is the item label.
    ///
    /// HONESTY NOTE — this is a text heuristic, not a task-identity oracle. See
    /// <see cref="Similarity"/> for exactly where the later "is this the same item, now
    /// done?" match can misfire.
    /// </summary>
    public static class ChecklistExtractor
    {
        public enum Marker { None, Pending, Done }

        // Leading whitespace, an optional bullet/number prefix, then the marker itself.
        // Markdown task-list form: "- [ ] text" / "* [x] text" / "1. [X] text".
        private static readonly Regex MarkdownTask = new(
            @"^\s*(?:[-*+]|\d+[.)])\s+\[(?<box>[ xX])\]\s+(?<text>\S.*)$",
            RegexOptions.Compiled);

        // Unicode ballot boxes, optionally behind a bullet/number: "☐ text", "- ☑ text".
        private static readonly Regex BallotBox = new(
            @"^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?<box>[☐☑☒])\s*(?<text>\S.*)$",
            RegexOptions.Compiled);

        // A leading bare check mark reporting completion: "✓ text", "✔ text", "- ✓ text".
        private static readonly Regex LeadingCheck = new(
            @"^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?<mark>[✓✔])\s*(?<text>\S.*)$",
            RegexOptions.Compiled);

        /// <summary>
        /// Parses one line. Returns <see cref="Marker.None"/> (and null text) when the line
        /// carries no checklist marker — the overwhelmingly common case, so this is cheap and
        /// non-committal by design. On a hit, <paramref name="text"/> is the trimmed item label
        /// with any trailing checklist noise removed.
        /// </summary>
        public static Marker TryParse(string line, out string text)
        {
            text = "";
            if (string.IsNullOrWhiteSpace(line)) return Marker.None;

            var m = MarkdownTask.Match(line);
            if (m.Success)
            {
                text = CleanLabel(m.Groups["text"].Value);
                if (text.Length == 0) return Marker.None;
                return m.Groups["box"].Value == " " ? Marker.Pending : Marker.Done;
            }

            m = BallotBox.Match(line);
            if (m.Success)
            {
                text = CleanLabel(m.Groups["text"].Value);
                if (text.Length == 0) return Marker.None;
                // ☐ (2610) pending; ☑ (2611) / ☒ (2612) both mean "resolved/done".
                return m.Groups["box"].Value[0] == '☐' ? Marker.Pending : Marker.Done;
            }

            m = LeadingCheck.Match(line);
            if (m.Success)
            {
                text = CleanLabel(m.Groups["text"].Value);
                if (text.Length == 0) return Marker.None;
                return Marker.Done;
            }

            return Marker.None;
        }

        /// <summary>Strips surrounding markdown emphasis / inline-code backticks and a trailing
        /// completion mark the agent sometimes appends (e.g. "build the thing ✓"), then trims —
        /// so the label used for matching is the task wording alone, not its decoration.</summary>
        private static string CleanLabel(string raw)
        {
            var s = raw.Trim();
            // Drop a trailing standalone check/box the agent tacks on after the text.
            s = Regex.Replace(s, @"[\s☐☑☒✓✔\-–—:]+$", "");
            // Peel matched **bold** / *italic* / `code` wrappers (leave inner text).
            s = s.Trim('*', '`', '_', ' ');
            return s.Trim();
        }

        /// <summary>
        /// A 0..1 similarity score between two item labels, used to decide "is this 'done'
        /// report the same task as an earlier pending item?". It is the MAX of two cheap
        /// measures over the normalized (lower-cased, punctuation-stripped, whitespace-collapsed)
        /// text: a character-level normalized Levenshtein ratio, and a word-set Jaccard overlap.
        /// Taking the max lets either "almost the same wording" OR "same key words, reordered"
        /// count as a match.
        ///
        /// WHERE THIS MISFIRES — stated plainly rather than pretended away:
        ///   • Two genuinely different tasks that share most of their words ("add the users
        ///     table" vs "add the orders table") score high and can be conflated.
        ///   • A completion the agent re-words heavily from the pending line ("wire up auth"
        ///     → "finished the login/session plumbing") scores low and WON'T match — it then
        ///     shows as a separate already-done row (a visible duplicate, never a lost item).
        ///   • Very short labels ("done", "fix it") are dominated by a word or two, so the
        ///     score is jumpy.
        /// Matching is additionally scoped to a single build (see TaskChecklistViewModel), which
        /// removes cross-build false matches but does nothing for same-build ambiguity above.
        /// The caller uses a conservative threshold and, on no confident match, prefers adding a
        /// new row over silently retitling an unrelated one.
        /// </summary>
        public static double Similarity(string a, string b)
        {
            var na = Normalize(a);
            var nb = Normalize(b);
            if (na.Length == 0 || nb.Length == 0) return 0;
            if (na == nb) return 1.0;

            int dist = Levenshtein(na, nb);
            double lev = 1.0 - (double)dist / Math.Max(na.Length, nb.Length);

            double jac = WordJaccard(na, nb);

            return Math.Max(lev, jac);
        }

        /// <summary>Lower-cases, strips punctuation to spaces, and collapses runs of whitespace —
        /// so "Add the Users table." and "add   users_table" compare on their words, not their
        /// formatting.</summary>
        public static string Normalize(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return "";
            var sb = new StringBuilder(s.Length);
            foreach (char c in s.ToLowerInvariant())
                sb.Append(char.IsLetterOrDigit(c) ? c : ' ');
            return Regex.Replace(sb.ToString(), @"\s+", " ").Trim();
        }

        private static double WordJaccard(string na, string nb)
        {
            var setA = new System.Collections.Generic.HashSet<string>(na.Split(' ', StringSplitOptions.RemoveEmptyEntries));
            var setB = new System.Collections.Generic.HashSet<string>(nb.Split(' ', StringSplitOptions.RemoveEmptyEntries));
            if (setA.Count == 0 || setB.Count == 0) return 0;
            int inter = 0;
            foreach (var w in setA) if (setB.Contains(w)) inter++;
            int union = setA.Count + setB.Count - inter;
            return union == 0 ? 0 : (double)inter / union;
        }

        private static int Levenshtein(string a, string b)
        {
            var prev = new int[b.Length + 1];
            var cur = new int[b.Length + 1];
            for (int j = 0; j <= b.Length; j++) prev[j] = j;
            for (int i = 1; i <= a.Length; i++)
            {
                cur[0] = i;
                for (int j = 1; j <= b.Length; j++)
                {
                    int cost = a[i - 1] == b[j - 1] ? 0 : 1;
                    cur[j] = Math.Min(Math.Min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + cost);
                }
                (prev, cur) = (cur, prev);
            }
            return prev[b.Length];
        }
    }
}
