using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #807 (Epic #803 Phase 3) — shared result shape for every manifest executor
    /// (#807 apiTests, #808 graphTests, #809 uiSteps) and the bottom "Test Results" tab
    /// (#810) that will read this back. One pipeline, per #803/#807's framing — not a
    /// separate output file per executor kind. Written to test-results/{issue}-{timestamp}.json
    /// per #803's Repo Structure section.
    ///
    /// Git #812 (Phase 7) — Expected/Actual/Context split out of the free-text Detail
    /// string so Claude Code can diagnose a failure straight from the JSON file without
    /// re-running anything: Detail stays the short human-readable summary (unchanged
    /// shape for #810's telemetry cards), Expected/Actual hold the specific assertion
    /// values that were compared, and Context carries request/response or DOM detail
    /// (method+url+status+truncated body for api/graph, selector+action for ui) that
    /// wasn't part of the pass/fail comparison itself but is what you'd want on hand
    /// while diagnosing.
    /// </summary>
    public class TestStepResult
    {
        public string Kind { get; set; } = "api"; // "api" | "graph" | "ui"
        public string Label { get; set; } = "";
        public bool Passed { get; set; }
        public string Detail { get; set; } = "";
        public long DurationMs { get; set; }
        public string Expected { get; set; } = "";
        public string Actual { get; set; } = "";
        public string Context { get; set; } = "";
        /// <summary>Git #966 — repo-relative path (forward slashes) of the WebView2 screenshot captured for this
        /// step, or empty when none was taken. Screenshots are captured for uiSteps on any step failure, or when
        /// the uiStep declares `"screenshot": true`; a reader (Claude Code, or TestRunnerWindow's review gallery)
        /// resolves this against the repo root. Only uiSteps ("ui" Kind) ever populate it.</summary>
        public string ScreenshotPath { get; set; } = "";
    }

    public class ManifestRunResult
    {
        public int Issue { get; set; }
        public string Feature { get; set; } = "";
        public string Mode { get; set; } = "single";
        public DateTime StartedAt { get; set; }
        public bool Cancelled { get; set; }
        public List<TestStepResult> Steps { get; set; } = new();

        public bool AllPassed => Steps.Count > 0 && Steps.All(s => s.Passed);

        public void AddRange(IEnumerable<TestStepResult> steps) => Steps.AddRange(steps);

        /// <summary>Git #966 — the per-run folder stem ("{issue}-{timestamp}") shared by this run's results
        /// JSON (WriteToFile) and its screenshots directory (test-results/{stem}/screenshots/), so a step's
        /// ScreenshotPath in the JSON always sits under a folder named for the same run that wrote the JSON.</summary>
        public string RunFolderName => $"{Issue}-{StartedAt:yyyyMMddHHmmss}";

        /// <summary>Git #812 — this app's module-level logger.child({channel}) equivalent (ActivityLog.Log(channel, ...); no Node logger exists in this WPF process — see the sibling "testing.api-executor"/"testing.graph-executor"/"testing.ui-executor"/"testing.results-panel" channels).</summary>
        private const string Channel = "testing.results-writer";

        public string WriteToFile(string repoRoot)
        {
            var dir = Path.Combine(repoRoot, "test-results");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, $"{RunFolderName}.json");
            File.WriteAllText(path, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));

            int passed = Steps.Count(s => s.Passed);
            ActivityLog.Log(Channel,
                $"Wrote {Steps.Count} step result(s) for issue #{Issue} ({passed}/{Steps.Count} passed) to {path}.");

            // Git #968 — every WriteToFile call (menu Run, regression sweep, and the #898
            // remote-trigger poll all funnel through this single method) also appends one
            // summary row to test-results/_history.jsonl, so trend tracking covers every
            // trigger path with no separate wiring per caller.
            TestHistoryStore.Append(repoRoot, this, path);

            return path;
        }
    }
}
