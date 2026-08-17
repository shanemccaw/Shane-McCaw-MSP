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

        /// <summary>Discovered config placeholders (added OR already-known) that surfaced via a
        /// <c>powerShellVerify[].afterStep</c> bare-name reference rather than literal <c>{{...}}</c> syntax.
        /// Reported distinctly on the scan channel because these are the names the old scanner missed
        /// entirely (e.g. <c>GRAPH_TEST_TENANT_ID</c> in <c>smoke/hello-world-powershell.json</c>).</summary>
        public List<string> AfterStepSourcedNames { get; } = new();

        /// <summary>Map of variable name to the relative manifest file paths (e.g. "smoke/hello-world-powershell.json") that reference it.</summary>
        public Dictionary<string, List<string>> VariableManifestMap { get; } = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>Map of variable name to the distinct test areas (e.g. "smoke", "auth", "crm") that reference it.</summary>
        public Dictionary<string, List<string>> VariableAreaMap { get; } = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>Names removed from the store because they are no longer referenced by any manifest.</summary>
        public List<string> RemovedOrphanedNames { get; } = new();

        public string SummaryLine
        {
            get
            {
                if (!RepoRootFound)
                    return "Could not locate test-manifests/ — no repo root (Settings has the config path).";

                var parts = new List<string>();
                if (AddedNames.Count > 0)
                    parts.Add($"added {AddedNames.Count} new ({string.Join(", ", AddedNames)})");
                if (RemovedOrphanedNames.Count > 0)
                    parts.Add($"pruned {RemovedOrphanedNames.Count} obsolete ({string.Join(", ", RemovedOrphanedNames)})");

                if (parts.Count == 0)
                    return $"Scanned {ManifestsScanned} manifest(s): {DistinctConfigPlaceholders} placeholder(s) — 100% in sync.";

                return $"Scanned {ManifestsScanned} manifest(s): {string.Join(", ", parts)}.";
            }
        }
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
    /// Git #961 — one manifest field does NOT use literal <c>{{...}}</c> syntax:
    /// <c>powerShellVerify[].afterStep</c>. <see cref="PowerShellTestExecutor"/> wraps a bare
    /// <c>afterStep</c> string in <c>{{}}</c> itself before calling
    /// <see cref="TestRunVariables.Resolve"/> (<c>afterStep.Contains("{{") ? afterStep : "{{"+afterStep+"}}"</c>),
    /// so a value like <c>"GRAPH_TEST_TENANT_ID"</c> is a real config-variable reference even though it
    /// carries no braces. This scanner mirrors that exact wrapping: for each <c>powerShellVerify[]</c>
    /// entry it treats a brace-less <c>afterStep</c> as an implicit <c>{{afterStep}}</c> reference (subject
    /// to the same per-manifest extract subtraction — an <c>afterStep</c> that names a value an earlier
    /// step of the SAME manifest extracts is still a cross-step value, not config). <c>afterStep</c> is
    /// the only field with this bare-name behavior — every other Resolve call site (paths, headers, bodies,
    /// cmdlet text, Graph mailbox/subject, UI selector/value) passes the raw field through Resolve and so
    /// requires literal <c>{{...}}</c>, which the generic string walk already catches. Names discovered via
    /// <c>afterStep</c> are reported distinctly (<see cref="ManifestVariableScanResult.AfterStepSourcedNames"/>).
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

        // Git #961 — a bare afterStep is only a valid implicit {{NAME}} reference if the whole (trimmed)
        // string is a single placeholder-grammar identifier; PowerShellTestExecutor wraps it as
        // {{afterStep}} and Resolve's regex ([A-Za-z0-9_]+) would never match anything else anyway.
        private static readonly Regex BareNamePattern =
            new(@"^[A-Za-z0-9_]+$", RegexOptions.Compiled);

        /// <summary>
        /// Scan all manifests and auto-fill any discovered placeholder not already in
        /// <paramref name="settings"/>. Mutates and <see cref="BuildConsoleSettings.Save"/>s
        /// <paramref name="settings"/> only when at least one variable is added; never
        /// overwrites an existing value. Safe to call repeatedly (idempotent once every
        /// placeholder is known) — the Settings section calls it on open and on the
        /// "Rescan Manifests" button.
        /// </summary>
        public static ManifestVariableScanResult Scan(BuildConsoleSettings settings, bool pruneOrphans = true)
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
            // Git #961 — names that surfaced via a bare powerShellVerify[].afterStep reference and
            // survived per-manifest subtraction into `discovered`. Reported distinctly below.
            var afterStepSourced = new HashSet<string>(StringComparer.Ordinal);

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
                    // Git #961 — bare powerShellVerify[].afterStep names found in THIS manifest.
                    var afterStepRefs = new HashSet<string>(StringComparer.Ordinal);
                    Walk(doc.RootElement, placeholders, extractNames, afterStepRefs);

                    string relPath = Path.GetRelativePath(manifestsDir, file).Replace('\\', '/');
                    string area = Path.GetDirectoryName(Path.GetRelativePath(manifestsDir, file))?.Replace('\\', '/') ?? "general";
                    if (string.IsNullOrEmpty(area) || area == ".") area = "general";

                    // Per-manifest subtraction BEFORE the cross-file union: a name this
                    // manifest extracts for itself is a cross-step value, not config.
                    foreach (var name in placeholders)
                    {
                        if (ExcludedNames.Contains(name)) continue;
                        if (extractNames.Contains(name)) continue;
                        discovered.Add(name);
                        // Track distinctly if THIS manifest sourced the name via a bare afterStep
                        // (it survived exclusion + extract subtraction, so it's a real config var).
                        if (afterStepRefs.Contains(name)) afterStepSourced.Add(name);

                        // Record manifest usage and area
                        if (!result.VariableManifestMap.TryGetValue(name, out var mList))
                        {
                            mList = new List<string>();
                            result.VariableManifestMap[name] = mList;
                        }
                        if (!mList.Contains(relPath)) mList.Add(relPath);

                        if (!result.VariableAreaMap.TryGetValue(name, out var aList))
                        {
                            aList = new List<string>();
                            result.VariableAreaMap[name] = aList;
                        }
                        if (!aList.Contains(area)) aList.Add(area);
                    }
                }
                result.ManifestsScanned++;
            }

            result.DistinctConfigPlaceholders = discovered.Count;
            result.AfterStepSourcedNames.AddRange(afterStepSourced.OrderBy(n => n, StringComparer.Ordinal));

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

            // Prune variables that are no longer referenced by any manifest
            if (pruneOrphans && result.RepoRootFound && files.Length > 0)
            {
                var orphaned = settings.TestEnvironmentVariables
                    .Where(v => !discovered.Contains(v.Name))
                    .ToList();

                if (orphaned.Count > 0)
                {
                    foreach (var o in orphaned)
                    {
                        settings.TestEnvironmentVariables.Remove(o);
                        result.RemovedOrphanedNames.Add(o.Name);
                    }
                    changed = true;
                }
            }

            if (changed) settings.Save();

            ActivityLog.Log(Channel, result.SummaryLine);

            // Git #961 — report afterStep-sourced discoveries distinctly (these are the ones the old
            // literal-{{}}-only scanner missed): which came from a bare powerShellVerify[].afterStep, and
            // of those, which were newly added this scan vs already known.
            if (afterStepSourced.Count > 0)
            {
                var afterStepAdded = afterStepSourced
                    .Where(n => result.AddedNames.Contains(n))
                    .OrderBy(n => n, StringComparer.Ordinal)
                    .ToList();
                ActivityLog.Log(Channel,
                    $"of those, {afterStepSourced.Count} came from a powerShellVerify[].afterStep bare-name reference (implicit {{{{...}}}}): {string.Join(", ", result.AfterStepSourcedNames)}"
                    + (afterStepAdded.Count > 0
                        ? $"; newly added (needsReview): {string.Join(", ", afterStepAdded)}."
                        : "; all already known."));
            }

            return result;
        }

        /// <summary>Recursively collect every <c>{{NAME}}</c> placeholder from string values, every
        /// <c>extract.as</c> name (a cross-step value the run populates itself, so it is NOT a config
        /// var — matches <see cref="TestRunVariables.Extract"/>'s read of the <c>as</c> field), and
        /// (Git #961) every bare <c>powerShellVerify[].afterStep</c> name treated as an implicit
        /// <c>{{NAME}}</c> reference, mirroring <see cref="PowerShellTestExecutor"/>'s own wrapping.</summary>
        private static void Walk(JsonElement el, HashSet<string> placeholders, HashSet<string> extractNames,
            HashSet<string> afterStepRefs)
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

                        // Git #961 — powerShellVerify[].afterStep specifically: its bare string value is
                        // an implicit {{NAME}} reference (PowerShellTestExecutor wraps a brace-less afterStep
                        // in {{}} before resolving). Scoped to the powerShellVerify array so no other stray
                        // "afterStep"-named field could be misread. A braced afterStep is left to the generic
                        // string walk below (which the recursion into prop.Value still performs).
                        if (string.Equals(prop.Name, "powerShellVerify", StringComparison.Ordinal)
                            && prop.Value.ValueKind == JsonValueKind.Array)
                        {
                            CollectAfterStepRefs(prop.Value, placeholders, afterStepRefs);
                        }

                        Walk(prop.Value, placeholders, extractNames, afterStepRefs);
                    }
                    break;

                case JsonValueKind.Array:
                    foreach (var item in el.EnumerateArray())
                        Walk(item, placeholders, extractNames, afterStepRefs);
                    break;
            }
        }

        /// <summary>Git #961 — for each <c>powerShellVerify[]</c> entry, read its <c>afterStep</c>: a
        /// brace-less value (e.g. <c>"GRAPH_TEST_TENANT_ID"</c>) is an implicit <c>{{NAME}}</c> reference
        /// and is added to both <paramref name="placeholders"/> (so it flows through the normal
        /// exclusion/extract-subtraction pipeline) and <paramref name="afterStepRefs"/> (so the scan can
        /// report it distinctly). A value already containing <c>{{...}}</c> is left to the generic string
        /// walk. Only accepts a value matching the placeholder-name grammar — anything else would never
        /// resolve at runtime either.</summary>
        private static void CollectAfterStepRefs(JsonElement arrayEl, HashSet<string> placeholders,
            HashSet<string> afterStepRefs)
        {
            foreach (var entry in arrayEl.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object) continue;
                if (!entry.TryGetProperty("afterStep", out var afterEl)
                    || afterEl.ValueKind != JsonValueKind.String) continue;

                var raw = afterEl.GetString();
                if (string.IsNullOrWhiteSpace(raw)) continue;

                // A braced afterStep is handled by the generic {{...}} walk — don't double-count.
                if (raw.IndexOf("{{", StringComparison.Ordinal) >= 0) continue;

                var name = raw.Trim();
                if (!BareNamePattern.IsMatch(name)) continue;

                placeholders.Add(name);
                afterStepRefs.Add(name);
            }
        }
    }
}
