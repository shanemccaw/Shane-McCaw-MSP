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
    /// </summary>
    public class TestStepResult
    {
        public string Kind { get; set; } = "api"; // "api" | "graph" | "ui"
        public string Label { get; set; } = "";
        public bool Passed { get; set; }
        public string Detail { get; set; } = "";
        public long DurationMs { get; set; }
    }

    public class ManifestRunResult
    {
        public int Issue { get; set; }
        public string Feature { get; set; } = "";
        public string Mode { get; set; } = "single";
        public DateTime StartedAt { get; set; }
        public List<TestStepResult> Steps { get; set; } = new();

        public bool AllPassed => Steps.Count > 0 && Steps.All(s => s.Passed);

        public void AddRange(IEnumerable<TestStepResult> steps) => Steps.AddRange(steps);

        public string WriteToFile(string repoRoot)
        {
            var dir = Path.Combine(repoRoot, "test-results");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, $"{Issue}-{StartedAt:yyyyMMddHHmmss}.json");
            File.WriteAllText(path, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
            return path;
        }
    }
}
