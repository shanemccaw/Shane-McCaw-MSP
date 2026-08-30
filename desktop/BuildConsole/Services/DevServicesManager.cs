using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    public class DevServiceStatusInfo
    {
        public string Name { get; set; } = string.Empty;
        public string Title { get; set; } = string.Empty;
        public int Port { get; set; }
        public bool IsRunning { get; set; }
        public int? Pid { get; set; }
        public string LogPath { get; set; } = string.Empty;
        public string DirectoryPath { get; set; } = string.Empty;
        public string Url => $"http://localhost:{Port}";
    }

    /// <summary>
    /// Coordinates individual and multi-service development processes (Marketing, Portal, Admin, API Server)
    /// integrating with scripts/dev-all.mjs and file-based logging.
    /// </summary>
    public static class DevServicesManager
    {
        private const string LogChannel = "devserver.services";

        /// <summary>
        /// Icon glyphs are cosmetic and BuildConsole-specific, so they stay in a small
        /// C#-side lookup rather than in the shared JSON config that scripts/dev-all.mjs
        /// also reads (Git #1782). Anything not listed here falls back to <see cref="DefaultIconGlyph"/>.
        /// </summary>
        private static readonly Dictionary<string, string> IconGlyphs = new()
        {
            ["shane-mccaw-consulting"] = "🌐",
            ["portal"] = "💼",
            ["admin-panel"] = "⚙️",
            ["api-server"] = "🖥️",
            ["msp-website"] = "📄",
        };

        private const string DefaultIconGlyph = "🧩";

        /// <summary>
        /// The one real source of truth for the port-based dev service list is
        /// scripts/dev-server/services.json — the same file scripts/dev-all.mjs reads
        /// (Git #1782). Loaded once at startup; a new artifact needs only a line added
        /// to that JSON file, not a code change here.
        /// </summary>
        public static readonly Dictionary<string, (string Title, int Port, string RelPath, string Icon)> KnownServices = LoadKnownServices();

        private static Dictionary<string, (string Title, int Port, string RelPath, string Icon)> LoadKnownServices()
        {
            var result = new Dictionary<string, (string Title, int Port, string RelPath, string Icon)>();
            try
            {
                // Git #1985 — audited, genuinely tolerable: `?? "."` falls back to the process
                // cwd, but the very next line's File.Exists check already catches a wrong/missing
                // path and logs it honestly (never fabricates a service list from a guess) —
                // KnownServices just stays empty, same as any other "config not found" case.
                string? repoRoot = BuildTrackerConfig.FindRepoRoot();
                string configPath = Path.Combine(repoRoot ?? ".", "scripts", "dev-server", "services.json");
                if (!File.Exists(configPath))
                {
                    ActivityLog.Log(LogChannel, $"[dev-all] Shared services config not found at {configPath}.");
                    return result;
                }

                string json = File.ReadAllText(configPath);
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("services", out var servicesEl) && servicesEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var svcEl in servicesEl.EnumerateArray())
                    {
                        if (!svcEl.TryGetProperty("name", out var nameEl)) continue;
                        string name = nameEl.GetString() ?? string.Empty;
                        if (string.IsNullOrWhiteSpace(name)) continue;

                        string title = svcEl.TryGetProperty("title", out var titleEl) ? (titleEl.GetString() ?? name) : name;
                        int port = svcEl.TryGetProperty("port", out var portEl) ? portEl.GetInt32() : 0;
                        string relPath = $"artifacts/{name}";
                        string icon = IconGlyphs.TryGetValue(name, out var glyph) ? glyph : DefaultIconGlyph;

                        result[name] = (title, port, relPath, icon);
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"[dev-all] Failed to load shared services config: {ex.Message}");
            }

            return result;
        }

        // Git #1985 — audited, genuinely tolerable: `?? "."` here only relocates where THIS
        // process reads/writes its own dev-service log files. GetServiceLogPath (below) is the
        // only consumer, so writer and reader always agree on the same (possibly cwd-relative)
        // location — self-consistent, no risk of reading/writing against different directories.
        public static string GetLogDir()
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            string envDir = Environment.GetEnvironmentVariable("DEV_ALL_LOG_DIR") ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(envDir)) return envDir;
            return Path.Combine(repoRoot ?? ".", ".logs", "dev-all");
        }

        public static string GetServiceLogPath(string serviceName)
        {
            return Path.Combine(GetLogDir(), $"{serviceName}.log");
        }

        /// <summary>
        /// Checks if a service is currently listening on its port.
        /// Uses Socket with CancellationTokenSource so cancellation cleanly aborts the connect
        /// and guarantees no unobserved Task exceptions are leaked when the port is closed or timed out.
        /// </summary>
        public static async Task<bool> IsPortOpenAsync(int port, int timeoutMs = 400)
        {
            try
            {
                using var cts = new CancellationTokenSource(timeoutMs);
                using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
                await socket.ConnectAsync(IPAddress.Loopback, port, cts.Token);
                return socket.Connected;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Gets live status info for a specific service.
        /// </summary>
        public static async Task<DevServiceStatusInfo> GetServiceStatusAsync(string serviceName)
        {
            var info = new DevServiceStatusInfo
            {
                Name = serviceName,
                LogPath = GetServiceLogPath(serviceName)
            };

            if (KnownServices.TryGetValue(serviceName, out var def))
            {
                info.Title = def.Title;
                info.Port = def.Port;
                info.DirectoryPath = def.RelPath;
            }

            // Check meta file
            string metaFile = Path.Combine(GetLogDir(), $"{serviceName}.meta.json");
            if (File.Exists(metaFile))
            {
                try
                {
                    string json = await File.ReadAllTextAsync(metaFile);
                    using var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement;
                    if (root.TryGetProperty("pid", out var p) && p.ValueKind == JsonValueKind.Number)
                    {
                        info.Pid = p.GetInt32();
                    }
                }
                catch { }
            }

            // Verify live listening port
            info.IsRunning = await IsPortOpenAsync(info.Port);
            return info;
        }

        /// <summary>
        /// Starts a specific service independently.
        /// </summary>
        public static async Task<bool> StartServiceAsync(string serviceName)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                ActivityLog.Log(LogChannel, $"Cannot start {serviceName}: repo root not found.");
                return false;
            }

            int port = KnownServices.TryGetValue(serviceName, out var def) ? def.Port : 0;
            ActivityLog.Log(LogChannel, $"[dev-all] Starting service '{serviceName}' on port {port}…");

            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-all.mjs");
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = $"\"{scriptPath}\" --start {serviceName}",
                    WorkingDirectory = repoRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var proc = Process.Start(psi);
                if (proc != null)
                {
                    await Task.Delay(1500); // give process time to bind port
                    bool isUp = await IsPortOpenAsync(port);
                    ActivityLog.Log(LogChannel, $"[dev-all] Service '{serviceName}' start dispatched (PID {proc.Id}, listening: {isUp}).");
                    return true;
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"[dev-all] Failed to start '{serviceName}': {ex.Message}");
            }

            return false;
        }

        /// <summary>
        /// Stops a specific service independently.
        /// </summary>
        public static async Task<bool> StopServiceAsync(string serviceName)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null) return false;

            int port = KnownServices.TryGetValue(serviceName, out var def) ? def.Port : 0;
            ActivityLog.Log(LogChannel, $"[dev-all] Stopping service '{serviceName}' (port {port})…");

            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-all.mjs");
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = $"\"{scriptPath}\" --stop {serviceName}",
                    WorkingDirectory = repoRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var proc = Process.Start(psi);
                if (proc != null)
                {
                    await proc.WaitForExitAsync();
                }

                // Secondary port cleanup guarantee if still bound
                if (port > 0)
                {
                    string killPortScript = Path.Combine(repoRoot, "scripts", "kill-port.mjs");
                    if (File.Exists(killPortScript))
                    {
                        var killPsi = new ProcessStartInfo
                        {
                            FileName = "node",
                            Arguments = $"\"{killPortScript}\" {port}",
                            WorkingDirectory = repoRoot,
                            UseShellExecute = false,
                            CreateNoWindow = true
                        };
                        using var killProc = Process.Start(killPsi);
                        if (killProc != null) await killProc.WaitForExitAsync();
                    }
                }

                ActivityLog.Log(LogChannel, $"[dev-all] Service '{serviceName}' stopped successfully.");
                return true;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"[dev-all] Error stopping '{serviceName}': {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Starts all configured dev services.
        /// </summary>
        public static async Task<bool> StartAllServicesAsync()
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null) return false;

            ActivityLog.Log(LogChannel, "[dev-all] Launching all dev services…");
            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-all.mjs");
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = $"\"{scriptPath}\"",
                    WorkingDirectory = repoRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                Process.Start(psi);
                await Task.Delay(1000);
                ActivityLog.Log(LogChannel, "[dev-all] Multi-service development bundle started.");
                return true;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"[dev-all] Failed to launch dev-all: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Stops all running dev services.
        /// </summary>
        public static async Task<bool> StopAllServicesAsync()
        {
            ActivityLog.Log(LogChannel, "[dev-all] Stopping all dev services…");
            foreach (var kvp in KnownServices)
            {
                await StopServiceAsync(kvp.Key);
            }
            ActivityLog.Log(LogChannel, "[dev-all] All dev services stopped.");
            return true;
        }
    }
}
