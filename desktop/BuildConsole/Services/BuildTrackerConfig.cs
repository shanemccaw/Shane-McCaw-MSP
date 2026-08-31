using System;
using System.IO;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Reads the SAME config Shane already set up for scripts/build-queue-watcher.ps1
    /// (scripts/build-queue-watcher.config.json - apiBaseUrl/ingestToken/maxConcurrent)
    /// rather than inventing a second, separate config entry for this app to duplicate
    /// and drift out of sync with. Walks up from wherever the exe is running (bin/Debug
    /// or bin/Release under desktop/BuildConsole) to find the repo root's scripts/
    /// folder, so this works regardless of build configuration or exactly where the
    /// repo is cloned.
    /// </summary>
    public class BuildTrackerConfig
    {
        public string ApiBaseUrl { get; set; } = "";
        public string IngestToken { get; set; } = "";
        public int MaxConcurrent { get; set; } = 8;

        public string DevBaseUrl { get; set; } = "http://localhost:8080";
        public string StagingBaseUrl { get; set; } = "https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/";
        public string ProductionBaseUrl { get; set; } = "https://shanemccaw.com";

        /// <summary>
        /// Returns the base URL for the given environment tier.
        /// Dev -> devBaseUrl (default http://localhost:8080)
        /// Staging -> stagingBaseUrl (default Replit deployment)
        /// Production -> productionBaseUrl (default https://shanemccaw.com)
        /// </summary>
        public string GetBaseUrl(TargetEnvironment env) => env switch
        {
            TargetEnvironment.Dev => !string.IsNullOrWhiteSpace(DevBaseUrl) ? DevBaseUrl : (!string.IsNullOrWhiteSpace(ApiBaseUrl) && ApiBaseUrl.Contains("localhost") ? ApiBaseUrl : "http://localhost:8080"),
            TargetEnvironment.Staging => !string.IsNullOrWhiteSpace(StagingBaseUrl) ? StagingBaseUrl : (!string.IsNullOrWhiteSpace(ApiBaseUrl) ? ApiBaseUrl : "https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/"),
            TargetEnvironment.Production => !string.IsNullOrWhiteSpace(ProductionBaseUrl) ? ProductionBaseUrl : "https://shanemccaw.com",
            _ => GetBaseUrl(TargetEnvironment.Dev)
        };

        /// <summary>
        /// Creates a copy of this config with ApiBaseUrl mapped to the target environment's specific base URL.
        /// </summary>
        public BuildTrackerConfig ForEnvironment(TargetEnvironment env)
        {
            return new BuildTrackerConfig
            {
                ApiBaseUrl = GetBaseUrl(env),
                IngestToken = this.IngestToken,
                MaxConcurrent = this.MaxConcurrent,
                DatabaseUrl = this.DatabaseUrl,
                DevBaseUrl = this.DevBaseUrl,
                StagingBaseUrl = this.StagingBaseUrl,
                ProductionBaseUrl = this.ProductionBaseUrl
            };
        }

        /// <summary>
        /// DEPRECATED / no longer used. This once held a direct Postgres connection string
        /// for an earlier <c>shaneapp://executeSql</c> design that opened its own local
        /// Npgsql connection — a design that always failed "no local Postgres connection
        /// string configured" because it was never set. <c>executeSql</c> now routes SQL
        /// through the SAME pipe the manual SQL Runner uses
        /// (<see cref="BuildTrackerApiClient.ExecuteSqlAsync"/> →
        /// <c>POST /api/simulator/sql/execute</c>), so no separate connection string is
        /// required. Kept only so an old config file carrying this key still deserializes
        /// cleanly; nothing reads it anymore.
        /// </summary>
        public string DatabaseUrl { get; set; } = "";

        [System.Text.Json.Serialization.JsonIgnore]
        public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiBaseUrl) && !string.IsNullOrWhiteSpace(IngestToken);

        public static string? FindConfigPath()
        {
            var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "scripts", "build-queue-watcher.config.json");
                if (File.Exists(candidate)) return candidate;
                dir = dir.Parent;
            }
            return null;
        }

        // ── Git #1978 — cached, robust repo-root resolution ─────────────────────
        // FindRepoRoot() used to re-derive the repo root on EVERY call by walking up
        // from the exe looking for scripts/build-queue-watcher.config.json and testing
        // File.Exists at each level. That config file is gitignored/untracked and
        // local-only; during heavy concurrent IO on the MAIN checkout (dev-server
        // merge-backs + pnpm churn during a restart cycle — the "Too many changes at
        // once" watcher floods) the File.Exists check on that file (or a directory
        // along the walk) transiently returned false, so FindRepoRoot returned null
        // and the worktree cleanup sweep silently no-opped for that cycle — and after
        // #1971, the pre-removal work-preservation inside removeWorktreeSafe did NOT
        // run, i.e. a suppressed data-loss protection. Observed 96+ times in a single
        // day, in ~30s bursts (the HomeView health timer) that recovered on their own:
        // the config file was never actually deleted — its mtime was stable — the
        // filesystem check just transiently missed under IO contention.
        //
        // Fix: resolve the repo root ONCE (at startup, while the tree is quiet — see
        // InitializeRepoRoot, called from App.OnStartup) and hold it for the process
        // lifetime. A value that was valid at startup is strictly better than a fresh
        // derivation that can transiently miss. Resolution also now tries a .git-directory
        // walk (a stable directory, not a gitignored file) and an explicit configured
        // override (BuildConsoleSettings.RepoRootOverride) before giving up, and a
        // genuinely unresolvable root is SURFACED (rate-limited toast) instead of only
        // writing a log line nobody watches.
        private static string? _cachedRepoRoot;
        private static readonly object _repoRootLock = new object();
        private static DateTime _lastRepoRootSurfaceUtc = DateTime.MinValue;

        /// <summary>
        /// Git #1978 — resolve and cache the repo root once, ideally at startup while the
        /// working tree is quiet (called from <c>App.OnStartup</c>). Idempotent and safe
        /// to call more than once. After this runs, every later <see cref="FindRepoRoot"/>
        /// returns the cached value and can never transiently miss.
        /// </summary>
        public static string? InitializeRepoRoot()
        {
            lock (_repoRootLock)
            {
                if (!string.IsNullOrEmpty(_cachedRepoRoot) && Directory.Exists(_cachedRepoRoot))
                    return _cachedRepoRoot;

                var resolved = ResolveRepoRoot();
                if (!string.IsNullOrEmpty(resolved))
                {
                    _cachedRepoRoot = resolved;
                    ActivityLog.Log("system.core", $"Repo root resolved and cached at startup: {resolved}");
                }
                else
                {
                    ActivityLog.Log("system.core",
                        "Repo root could not be resolved at startup (config walk, .git walk, and RepoRootOverride all missed).");
                }
                return _cachedRepoRoot;
            }
        }

        /// <summary>Git #817 — QueueWatcherService needs the repo root as claude.exe's default working directory (same as build-queue-watcher.ps1's `$repoRoot = Split-Path $PSScriptRoot -Parent`); derived from the same config file's location rather than a second hardcoded path. Git #1978 — now returns a value resolved ONCE and cached for the process lifetime, immune to the transient File.Exists misses that silently no-opped the worktree cleanup sweep.</summary>
        public static string? FindRepoRoot()
        {
            // Fast path: the value resolved once at startup, held for the process lifetime.
            var cached = _cachedRepoRoot;
            if (!string.IsNullOrEmpty(cached) && Directory.Exists(cached))
                return cached;

            lock (_repoRootLock)
            {
                if (!string.IsNullOrEmpty(_cachedRepoRoot) && Directory.Exists(_cachedRepoRoot))
                    return _cachedRepoRoot;

                var resolved = ResolveRepoRoot();
                if (!string.IsNullOrEmpty(resolved))
                {
                    _cachedRepoRoot = resolved;
                    return _cachedRepoRoot;
                }

                // Genuinely unresolvable — surface it (rate-limited) instead of failing
                // silently. Inside the worktree cleanup sweep this is a suppressed
                // data-loss protection (#1971), so it must be visible.
                SurfaceRepoRootFailure();
                return null;
            }
        }

        /// <summary>
        /// Git #1978 — the actual multi-strategy resolution, tried in order:
        /// (1) the build-queue-watcher.config.json walk (anchors on the MAIN checkout, the
        /// same root build-queue-watcher.ps1 uses); (2) a .git walk up from the exe (a stable
        /// directory, not a gitignored untracked file — robust to the transient File.Exists
        /// miss that caused #1978); (3) an explicit <see cref="BuildConsoleSettings.RepoRootOverride"/>
        /// (last-resort manual pin). Returns null only if all three miss.
        /// </summary>
        private static string? ResolveRepoRoot()
        {
            // 1. config-file walk (primary — anchors on the MAIN checkout)
            var configPath = FindConfigPath();
            if (configPath != null)
            {
                var root = Directory.GetParent(Path.GetDirectoryName(configPath)!)?.FullName;
                if (!string.IsNullOrEmpty(root) && Directory.Exists(root))
                    return root;
            }

            // 2. .git walk (robust: a directory that exists, not a gitignored file)
            try
            {
                var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
                while (dir != null)
                {
                    if (Directory.Exists(Path.Combine(dir.FullName, ".git")) ||
                        File.Exists(Path.Combine(dir.FullName, ".git")))
                        return dir.FullName;
                    dir = dir.Parent;
                }
            }
            catch { /* fall through to the configured override */ }

            // 3. explicit configured override (BuildConsoleSettings.RepoRootOverride)
            try
            {
                var overridePath = BuildConsoleSettings.Load().RepoRootOverride;
                if (!string.IsNullOrWhiteSpace(overridePath) && Directory.Exists(overridePath))
                    return overridePath;
            }
            catch { /* settings unreadable — nothing more to try */ }

            return null;
        }

        /// <summary>
        /// Git #1978 — a genuinely unresolvable repo root is surfaced, not swallowed. Logs
        /// every time; shows a non-modal toast at most once per 10 minutes (a permanent
        /// failure would otherwise be hit every 30s health tick and spam the toast stack).
        /// Never throws into the caller.
        /// </summary>
        private static void SurfaceRepoRootFailure()
        {
            try
            {
                ActivityLog.Log("system.core",
                    "Repo root not found (config walk, .git walk, and RepoRootOverride all missed) — worktree cleanup / work-preservation cannot run this cycle. Set RepoRootOverride in %AppData%\\BuildConsole\\settings.json to pin it.");

                var now = DateTime.UtcNow;
                if ((now - _lastRepoRootSurfaceUtc).TotalMinutes < 10) return;
                _lastRepoRootSurfaceUtc = now;

                BuildConsole.ToastEngine.Warning(
                    "Repo root not found",
                    "Worktree cleanup and work-preservation can't run — the repo root couldn't be located. Set RepoRootOverride in settings.json to pin it.");
            }
            catch { /* surfacing must never take down the operation that raised it */ }
        }

        public static BuildTrackerConfig Load()
        {
            var path = FindConfigPath();
            if (path == null) return new BuildTrackerConfig();
            try
            {
                var json = File.ReadAllText(path);
                var cfg = JsonSerializer.Deserialize<BuildTrackerConfig>(
                    json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return cfg ?? new BuildTrackerConfig();
            }
            catch
            {
                return new BuildTrackerConfig();
            }
        }

        /// <summary>
        /// Git #2122 — writes this config back to the SAME file <see cref="Load"/> reads
        /// (scripts/build-queue-watcher.config.json), so a change made in Settings (e.g. the max
        /// concurrent build slots field) persists for both this app and
        /// build-queue-watcher.ps1's own <c>-MaxConcurrent</c> default — no second, drifting config
        /// entry. Camel-case property names to match the hand-authored file convention (see
        /// build-queue-watcher.config.example.json); <see cref="Load"/> itself is case-insensitive
        /// on read regardless. If the file doesn't exist yet (a fresh checkout with only the
        /// .example template present), writes it alongside that template instead of silently
        /// no-oping; if even the scripts/ folder can't be located, this is a no-op.
        /// </summary>
        public void Save()
        {
            var path = FindConfigPath();
            if (path == null)
            {
                var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
                while (dir != null)
                {
                    var exampleCandidate = Path.Combine(dir.FullName, "scripts", "build-queue-watcher.config.example.json");
                    if (File.Exists(exampleCandidate))
                    {
                        path = Path.Combine(dir.FullName, "scripts", "build-queue-watcher.config.json");
                        break;
                    }
                    dir = dir.Parent;
                }
                if (path == null) return;
            }

            var json = JsonSerializer.Serialize(this, new JsonSerializerOptions
            {
                WriteIndented = true,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });
            File.WriteAllText(path, json);
        }
    }
}
