using System;
using System.Collections.Generic;
using System.Linq;

namespace MyArchitect.Shell;

/// <summary>
/// Layered command-palette matcher, ported from AdminV2's <c>command/cmdScore.ts</c>
/// (SHELL.md §4): exact name → prefix → word-start → substring → acronym → subsequence with a
/// gap penalty. The acronym tier is what makes a 3-letter guess ("gar") find "Guest Access
/// Review" without perfect recall — keep it, it is not redundant with subsequence matching.
/// </summary>
public static class CommandMatcher
{
    /// <summary>Returns matches ordered best-first; entries scoring 0 are excluded.</summary>
    public static List<PaletteCommand> Match(IEnumerable<PaletteCommand> commands, string query)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return commands.ToList();
        }

        var q = query.Trim();
        return commands
            .Select(c => (Command: c, Score: Score(c.Name, q)))
            .Where(r => r.Score > 0)
            .OrderByDescending(r => r.Score)
            .Select(r => r.Command)
            .ToList();
    }

    private static int Score(string name, string query)
    {
        var n = name.ToLowerInvariant();
        var q = query.ToLowerInvariant();

        if (n == q) return 1000;
        if (n.StartsWith(q, StringComparison.Ordinal)) return 800;

        var words = n.Split(' ', '-', '_', '/');
        if (words.Any(w => w.StartsWith(q, StringComparison.Ordinal))) return 600;
        if (n.Contains(q, StringComparison.Ordinal)) return 400;

        var acronym = string.Concat(words.Where(w => w.Length > 0).Select(w => w[0]));
        if (acronym.Equals(q, StringComparison.Ordinal)) return 300;
        if (acronym.StartsWith(q, StringComparison.Ordinal)) return 250;

        return SubsequenceScore(n, q);
    }

    /// <summary>Every character of <paramref name="q"/> must appear in order in
    /// <paramref name="n"/>; score decays with the total gap between matched characters so a
    /// tight subsequence ranks above a scattered one.</summary>
    private static int SubsequenceScore(string n, string q)
    {
        int ni = 0, matched = 0, gapPenalty = 0, lastMatch = -1;
        for (int qi = 0; qi < q.Length; qi++)
        {
            var ch = q[qi];
            var found = -1;
            for (int i = ni; i < n.Length; i++)
            {
                if (n[i] == ch) { found = i; break; }
            }
            if (found < 0) return 0; // not a subsequence at all
            if (lastMatch >= 0) gapPenalty += (found - lastMatch - 1);
            lastMatch = found;
            ni = found + 1;
            matched++;
        }

        if (matched < q.Length) return 0;
        var baseScore = 150;
        return Math.Max(1, baseScore - gapPenalty * 5);
    }
}
