using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BuildConsole.Services
{
    /// <summary>Git #961 — what a single manifest scan found, returned to the UI so the
    /// Settings > Test Environment section can show a one-line "scanned N, added K" status
    /// after an auto- or manual rescan.</summary>
    public class ManifestVariableScanResult
    {
        public bool RepoRootFound { get; set; }
        public int ManifestsScanned { get; set; }
        public int DistinctConfigPlaceholders { get; set; }

        /// <summary>Names newly auto-added to the store this scan (with the &lt;unset&gt; default + needsReview flag).</summary>
        public List<string> AddedNames { get; } = new();

        /// <summary>Discovered placeholder names that were already present in the store (left untouched).</summary>
        public List<string> AlreadyKnownNames { get; } = new();

        public string SummaryLine =>
            !RepoRootFound
                ? "Could not locate test-manifests/ — no repo root (Settings has the config path)."
                : AddedNames.Count > 0
                    ? $"Scanned {ManifestsScanned} manifest(s): added {AddedNames.Count} new variable(s) needing review — {string.Join(", ", AddedNames)}."
                    : $"Scanned {ManifestsScanned} manifest(s): {DistinctConfigPlaceholders} placeholder(s), all already known — nothing added.";
    }

    /// <summary>
    /// Git #961 (Epic #803) — the smarts on top of #953's Test Environment Variables editor.
    /// Shane: "there is no way I can go through every test manifest and figure out what random
    /// thing the agent decided to make every time. So there needs to be something that reads the
    /// manifests, sets an auto value... then I can change that value."
    ///
    /// Walks every real manifest under <c>test-manifests/{area}/{feature-slug}.json</c>
    /// (post-#960 nested structure), regex-extracts every <c>{{NAME}}</c> placeholder referenced
    /// anywhere in the manifest, and for each one NOT already in the stored Test Environment
    /// Variables auto-adds it with an obvious <see cref="AutoDefaultValue"/> placeholder and a
    /// <see cref="TestEnvVar.NeedsReview"/> flag. It only ever FILLS GAPS — a value Shane has
    /// already set is never overwritten or re-flagged.
    ///
    /// Two placeholder classes are deliberately NOT treated as config vars:
    /// <list type="bullet">
    ///   <item><c>DEPLOY_URL</c>/<c>SECRET_KEY</c> — resolved separately by
    ///   <see cref="HttpTestExecutor"/> from <c>build-queue-watcher.config.json</c> (#805/#834),
    ///   never stored here.</item>
    ///   <item>Any name a manifest's OWN <c>extract</c> block populates within the same run —
    ///   those are cross-step values (#877's <see cref="TestRunVariables"/>), not something Shane
    ///   sets. Subtracted PER MANIFEST before unioning across files, so a name extracted in one
    ///   manifest but referenced un-extracted in another still surfaces from the second.</item>
    /// </list>
    ///
    /// Every scan logs a one-line summary to the dedicated <see cref="Channel"/>
    /// (<c>testing.config-vars.scan</c>), distinct from #953's <c>testing.config-vars</c>
    /// resolve/miss channel. No GitHub issue is filed per variable — the in-app "needs review"
    /// flag is the whole mechanism, kept local to BuildConsole.
    /// </summary>
    public static class TestManifestVariableScanner
    {
        /// <summary>Git #961 — dedicated scan channel, kept distinct from #953's
        /// <c>testing.config-vars</c> resolve/miss channel so a "scan added 3 new vars"
        /// event is greppable on its own.</summary>
        public const string Channel = "testing.config-vars.scan";

        /// <summary>The obvious placeholder value auto-populated for a freshly discovered variable.
        /// Editing a row's value away from this is what clears its needsReview flag.</summary>
        public const string AutoDefaultValue = "<unset>";

        /// <summary>Resolved separately (build-queue-watcher.config.json) — never a stored Settings config var.</summary>
        private static readonly HashSet<string> ExcludedNames =
            new(StringComparer.Ordinal) { "DEPLOY_URL", "SECRET_KEY" };

        // Same placeholder grammar TestRunVariables uses: {{ NAME }} with optional inner whitespace.
        private static readonly Regex PlaceholderPattern =
            new(@"\{\{\s*([A-Za-z0-9_]+)\s*\}\}", RegexOptions.Compiled);

        /// <summary>
        /// Scan all manifests and auto-fill any discovered placeholder not already in
        /// <paramref name="settings"/>. Mutates and <see cref="BuildConsoleSettings.Save"/>s
        /// <paramref name="settings"/> only when at least one variable is added; never
        /// overwrites an existing value. Safe to call repeatedly (idempotent once every
        /// placeholder is known) — the Settings section calls it on open and on the
        /// "Rescan Manifests" button.
        /// </summary>
        public static ManifestVariableScanResult Scan(BuildConsoleSettings settings)
        {
            var result = new ManifestVariableScanResult();

            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                ActivityLog.Log(Channel, "scan skipped — no repo root found (missing scripts\\build-queue-watcher.config.json).");
                return result;
            }

            string manifestsDir = Path.Combine(repoRoot, "test-manifests");
            if (!Directory.Exists(manifestsDir))
            {
                ActivityLog.Log(Channel, $"scan skipped — {manifestsDir} does not exist.");
                return result;
            }
            result.RepoRootFound = true;

            string[] files;
            try
            {
                files = Directory.GetFiles(manifestsDir, "*.json", SearchOption.AllDirectories);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"scan failed enumerating manifests: {ex.Message}");
                return result;
            }

            var discovered = new HashSet<string>(StringComparer.Ordinal);

            foreach (var file in files)
            {
                // _regression-suite.json is the registry list, not a manifest — skip it.
                if (string.Equals(Path.GetFileName(file), "_regression-suite.json", StringComparison.OrdinalIgnoreCase))
                    continue;

                JsonDocument doc;
                try { doc = JsonDocument.Parse(File.ReadAllText(file)); }
                catch { continue; } // a malformed manifest can't contribute names; skip it quietly

                using (doc)
                {
                    var placeholders = new HashSet<string>(StringComparer.Ordinal);
                    var extractNames = new HashSet<string>(StringComparer.Ordinal);
                    Walk(doc.RootElement, placeholders, extractNames);

                    // Per-manifest subtraction BEFORE the cross-file union: a name this
                    // manifest extracts for itself is a cross-step value, not config.
                    foreach (var name in placeholders)
                    {
                        if (ExcludedNames.Contains(name)) continue;
                        if (extractNames.Contains(name)) continue;
                        discovered.Add(name);
                    }
                }
                result.ManifestsScanned++;
            }

            result.DistinctConfigPlaceholders = discovered.Count;

            // Fill gaps only — an existing entry (whatever Shane set it to) is left untouched.
            var existing = new HashSet<string>(
                settings.TestEnvironmentVariables.Select(v => v.Name), StringComparer.Ordinal);

            bool changed = false;
            foreach (var name in discovered.OrderBy(n => n, StringComparer.Ordinal))
            {
                if (existing.Contains(name))
                {
                    result.AlreadyKnownNames.Add(name);
                    continue;
                }
                settings.TestEnvironmentVariables.Add(new TestEnvVar
                {
                    Name = name,
                    Value = AutoDefaultValue,
                    NeedsReview = true,
                });
                result.AddedNames.Add(name);
                changed = true;
            }

            if (changed) settings.Save();

            ActivityLog.Log(Channel,
                result.AddedNames.Count > 0
                    ? $"scanned {result.ManifestsScanned} manifest(s); {result.DistinctConfigPlaceholders} distinct config placeholder(s); added {result.AddedNames.Count} new (needsReview): {string.Join(", ", result.AddedNames)}."
                    : $"scanned {result.ManifestsScanned} manifest(s); {result.DistinctConfigPlaceholders} distinct config placeholder(s); all already known — nothing added.");

            return result;
        }

        /// <summary>Recursively collect every <c>{{NAME}}</c> placeholder from string values, and
        /// every <c>extract.as</c> name (a cross-step value the run populates itself, so it is NOT
        /// a config var). Matches <see cref="TestRunVariables.Extract"/>'s read of the <c>as</c>
        /// field.</summary>
        private static void Walk(JsonElement el, HashSet<string> placeholders, HashSet<string> extractNames)
        {
            switch (el.ValueKind)
            {
                case JsonValueKind.String:
                    var s = el.GetString();
                    if (!string.IsNullOrEmpty(s) && s.IndexOf("{{", StringComparison.Ordinal) >= 0)
                        foreach (Match m in PlaceholderPattern.Matches(s))
                            placeholders.Add(m.Groups[1].Value);
                    break;

                case JsonValueKind.Object:
                    foreach (var prop in el.EnumerateObject())
                    {
                        if (string.Equals(prop.Name, "extract", StringComparison.Ordinal)
                            && prop.Value.ValueKind == JsonValueKind.Object
                            && prop.Value.TryGetProperty("as", out var asEl)
                            && asEl.ValueKind == JsonValueKind.String)
                        {
                            var asName = asEl.GetString();
                            if (!string.IsNullOrWhiteSpace(asName)) extractNames.Add(asName!.Trim());
                        }
                        Walk(prop.Value, placeholders, extractNames);
                    }
                    break;

                case JsonValueKind.Array:
                    foreach (var item in el.EnumerateArray())
                        Walk(item, placeholders, extractNames);
                    break;
            }
        }
    }
}
