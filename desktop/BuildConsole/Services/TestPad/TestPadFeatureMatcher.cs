using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using BuildConsole.Services;

namespace BuildConsole.Services.TestPad;

/// <summary>Ported from ShaneBuilder (Git #2531, Feature: Test Pad #2530; originally Git #2349,
/// ShaneBuilder Feature: Test Pad #2326). Matches an import candidate's real text against the
/// real, live "Feature:" issues a caller resolves (in BuildConsole, via
/// <see cref="GitHubApiClient.SearchIssuesAsync"/> — e.g. a search query like
/// <c>"Feature in:title state:open"</c>), so an imported note can be stamped with the feature it's
/// actually testing without the user having to pick it by hand every time. This is deliberately a
/// heuristic over real titles, not a fabricated lookup table — every candidate feature considered
/// is a real open GitHub issue.
///
/// Takes both the candidate's <see cref="TestPadImportCandidate.Section"/> (a real Section header
/// text, when the paste had one) and its body text — "from section or body text", per the original
/// issue's own title — and matches against whichever signal is present, weighting a Section-header
/// hit no differently than a body hit since either is a real, honest signal of what the note is
/// actually about.
///
/// Dependency-surface note (#2531): ShaneBuilder's original read a ShaneBuilder-only
/// <c>GitIssueRow</c> (from its own `gh`-CLI-shelling <c>GitIssuesService</c>) and called that
/// service's one-line <c>StripFeatureTitlePrefix</c> helper. BuildConsole's real equivalent issue
/// row is <see cref="GitHubIssueResult"/> (the shape <see cref="GitHubApiClient.SearchIssuesAsync"/>
/// already returns) — this file reads only <c>.Title</c> off it, same as the original read only
/// <c>GitIssueRow.Title</c>. BuildConsole has no <c>GitIssuesService</c>/<c>GitMapService</c>-style
/// home for the title-prefix helper, so it's kept local here as a private static helper rather than
/// inventing new shared infrastructure this issue doesn't call for.</summary>
public static class TestPadFeatureMatcher
{
    // Below this score, a match is too weak to trust automatically — the row is left for the
    // dropdown fallback rather than silently guessing wrong.
    private const int MinScore = 8;

    private static readonly Regex CoreTitle =
        new(@"^[^—\-(]+", RegexOptions.Compiled);

    private static readonly Regex WordToken =
        new(@"[A-Za-z']{4,}", RegexOptions.Compiled);

    private static readonly Regex FeatureTitlePrefix =
        new(@"^feature:\s*", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "this", "that", "with", "from", "into", "onto", "feature", "shanebuilder",
        "buildconsole", "should", "which", "where", "there", "their", "about", "these",
    };

    /// <summary>Same real "strip the repo's own title-convention prefix" pattern the ShaneBuilder
    /// original's <c>GitIssuesService.StripFeatureTitlePrefix</c> used.</summary>
    private static string StripFeatureTitlePrefix(string title) => FeatureTitlePrefix.Replace(title ?? "", "");

    /// <summary>Picks the best-scoring real feature for <paramref name="bodyText"/> and/or
    /// <paramref name="sectionText"/>, or <c>null</c> when nothing clears <see cref="MinScore"/> —
    /// an honest "unmatched", not a guess, so the import preview's dropdown fallback is what fills
    /// it in.</summary>
    public static GitHubIssueResult? Match(string? bodyText, string? sectionText, IReadOnlyList<GitHubIssueResult> features)
    {
        if (features.Count == 0) return null;

        var haystack = string.Join(" ", new[] { sectionText, bodyText }.Where(s => !string.IsNullOrWhiteSpace(s)));
        if (haystack.Length == 0) return null;

        GitHubIssueResult? best = null;
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
        var stripped = StripFeatureTitlePrefix(featureTitle).Trim();
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
