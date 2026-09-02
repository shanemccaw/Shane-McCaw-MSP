using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace ShaneBuilder.Services.TestPad;

/// <summary>Git #2349 (Feature: Test Pad, #2326) — matches an import candidate's real text against
/// the real, live "Feature:" issues <see cref="GitIssuesService.GetActiveFeaturesAsync"/> returns,
/// so an imported note can be stamped with the feature it's actually testing without the user
/// having to pick it by hand every time. This is deliberately a heuristic over real titles, not a
/// fabricated lookup table — every candidate feature considered is a real open GitHub issue.
///
/// Takes both the candidate's <see cref="TestPadImportCandidate.Section"/> (#2344's real Section
/// header text, when the paste had one) and its body text — "from section or body text", per this
/// issue's own title — and matches against whichever signal is present, weighting a Section-header
/// hit no differently than a body hit since either is a real, honest signal of what the note is
/// actually about.</summary>
public static class TestPadFeatureMatcher
{
    // Below this score, a match is too weak to trust automatically — the row is left for the
    // dropdown fallback rather than silently guessing wrong.
    private const int MinScore = 8;

    private static readonly Regex CoreTitle =
        new(@"^[^—\-(]+", RegexOptions.Compiled);

    private static readonly Regex WordToken =
        new(@"[A-Za-z']{4,}", RegexOptions.Compiled);

    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "this", "that", "with", "from", "into", "onto", "feature", "shanebuilder",
        "buildconsole", "should", "which", "where", "there", "their", "about", "these",
    };

    /// <summary>Picks the best-scoring real feature for <paramref name="bodyText"/> and/or
    /// <paramref name="sectionText"/>, or <c>null</c> when nothing clears <see cref="MinScore"/> —
    /// an honest "unmatched", not a guess, so the import preview's dropdown fallback is what fills
    /// it in.</summary>
    public static GitIssueRow? Match(string? bodyText, string? sectionText, IReadOnlyList<GitIssueRow> features)
    {
        if (features.Count == 0) return null;

        var haystack = string.Join(" ", new[] { sectionText, bodyText }.Where(s => !string.IsNullOrWhiteSpace(s)));
        if (haystack.Length == 0) return null;

        GitIssueRow? best = null;
        var bestScore = 0;

        foreach (var feature in features)
        {
            var score = ScoreMatch(haystack, feature.Title);
            if (score > bestScore)
            {
                bestScore = score;
                best = feature;
            }
        }

        return bestScore >= MinScore ? best : null;
    }

    private static int ScoreMatch(string haystack, string featureTitle)
    {
        var stripped = GitIssuesService.StripFeatureTitlePrefix(featureTitle).Trim();
        if (stripped.Length == 0) return 0;

        // Real titles here read like "Test Pad — floating test-notes capture (ShaneBuilder)" —
        // the "core" is the short name before the em-dash/paren descriptor.
        var core = CoreTitle.Match(stripped).Value.Trim();
        if (core.Length < 3) core = stripped;

        // A whole-phrase, word-bounded hit on the core name is the strongest honest signal —
        // score it high enough that keyword overlap alone can't outrank a real name match.
        if (core.Length >= 3 && Regex.IsMatch(haystack, $@"\b{Regex.Escape(core)}\b", RegexOptions.IgnoreCase))
            return 20 + core.Count(char.IsWhiteSpace) * 4;

        // Otherwise fall back to keyword overlap against the full (unstripped-of-descriptor)
        // title — catches e.g. "notepad import" text landing under an untitled/renamed feature.
        var titleWords = Tokenize(stripped);
        if (titleWords.Count == 0) return 0;
        var textWords = Tokenize(haystack);
        var overlap = titleWords.Count(w => textWords.Contains(w));
        return overlap == 0 ? 0 : overlap * 5;
    }

    private static HashSet<string> Tokenize(string s) =>
        WordToken.Matches(s)
            .Select(m => m.Value.ToLowerInvariant())
            .Where(w => !StopWords.Contains(w))
            .ToHashSet();
}
