using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BuildConsole.Services
{
    /// <summary>
    /// Shane: "There is a new feature that shows me the tokens and estimated
    /// cost of the session... but that should persist. And then give me a
    /// breakdown when I click it... I would love to track how much AI tokens
    /// total, AI cost total, AI tokens this session, AI cost this session
    /// would be for fun and tracking purposes."
    ///
    /// The existing Build Queue header badge (QueueWatcherService.GetActiveUsageSummary)
    /// is a live, in-memory-only ROUGH ESTIMATE of the CURRENT context window across
    /// still-running builds ($5/1M tokens, from the most recent stream-json `usage`
    /// field) — it necessarily zeroes out the moment nothing is actively running,
    /// which reads as "not persisting". This service is the separate, real, durable
    /// counterpart: it records the CLI's own authoritative per-build totals (the
    /// `total_cost_usd` and final `usage` object on a completed turn's stream-json
    /// `result` line — real numbers Anthropic's own billing meter agrees with, not an
    /// estimate) every time a build actually finishes a turn, both into an in-memory
    /// "this session" counter (since this app instance launched) and a JSON file under
    /// %AppData%\BuildConsole\ so the all-time total survives app restarts.
    ///
    /// Deliberately a flat local JSON file, not a Postgres table: this is a for-fun/
    /// tracking counter on Shane's own machine, not customer-facing product state, so
    /// it doesn't need a migration Shane has to review/run (see CLAUDE.md's "Schema
    /// changes require manual SQL" rule) — same reasoning as ActivityLog's own
    /// %AppData%\BuildConsole\logs\ and BuildConsoleSettings' settings.json.
    /// </summary>
    public static class UsageTrackingService
    {
        private sealed class PersistedTotals
        {
            [JsonPropertyName("totalTokens")] public long TotalTokens { get; set; }
            [JsonPropertyName("totalCostUsd")] public double TotalCostUsd { get; set; }
            [JsonPropertyName("totalBuilds")] public int TotalBuilds { get; set; }
        }

        public readonly struct Snapshot
        {
            public long TotalTokens { get; init; }
            public double TotalCostUsd { get; init; }
            public int TotalBuilds { get; init; }
            public long SessionTokens { get; init; }
            public double SessionCostUsd { get; init; }
            public int SessionBuilds { get; init; }
        }

        private static readonly string FilePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole", "usage-totals.json");

        private static readonly object _gate = new();
        private static bool _loaded;
        private static long _totalTokens;
        private static double _totalCostUsd;
        private static int _totalBuilds;

        // "This session" = since THIS app instance launched — always starts at zero,
        // unlike the persisted all-time totals above.
        private static long _sessionTokens;
        private static double _sessionCostUsd;
        private static int _sessionBuilds;

        /// <summary>Raised (off any thread) after a completion is recorded, so the UI badge can refresh without polling.</summary>
        public static event Action? Changed;

        /// <summary>
        /// Records one real, completed build turn's authoritative usage — call with the
        /// CLI's own `total_cost_usd` and summed `usage` token fields from a stream-json
        /// `result` line, once per such line (an interactive build sends several over its
        /// life; each is a distinct real turn, not a running total, so each is added).
        /// </summary>
        public static void RecordCompletion(long tokens, double costUsd)
        {
            lock (_gate)
            {
                EnsureLoaded();
                _totalTokens += tokens;
                _totalCostUsd += costUsd;
                _totalBuilds++;
                _sessionTokens += tokens;
                _sessionCostUsd += costUsd;
                _sessionBuilds++;
                Save();
            }
            Changed?.Invoke();
        }

        public static Snapshot GetSnapshot()
        {
            lock (_gate)
            {
                EnsureLoaded();
                return new Snapshot
                {
                    TotalTokens = _totalTokens,
                    TotalCostUsd = _totalCostUsd,
                    TotalBuilds = _totalBuilds,
                    SessionTokens = _sessionTokens,
                    SessionCostUsd = _sessionCostUsd,
                    SessionBuilds = _sessionBuilds,
                };
            }
        }

        private static void EnsureLoaded()
        {
            if (_loaded) return;
            _loaded = true;
            try
            {
                if (File.Exists(FilePath))
                {
                    var json = File.ReadAllText(FilePath);
                    var parsed = JsonSerializer.Deserialize<PersistedTotals>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (parsed != null)
                    {
                        _totalTokens = parsed.TotalTokens;
                        _totalCostUsd = parsed.TotalCostUsd;
                        _totalBuilds = parsed.TotalBuilds;
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("usage-tracking", $"Couldn't load usage totals ({FilePath}): {ex.Message}");
            }
        }

        private static void Save()
        {
            try
            {
                var dir = Path.GetDirectoryName(FilePath)!;
                Directory.CreateDirectory(dir);
                var json = JsonSerializer.Serialize(
                    new PersistedTotals { TotalTokens = _totalTokens, TotalCostUsd = _totalCostUsd, TotalBuilds = _totalBuilds },
                    new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(FilePath, json);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("usage-tracking", $"Couldn't save usage totals ({FilePath}): {ex.Message}");
            }
        }
    }
}
