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

        public static readonly Dictionary<string, (string Title, int Port, string RelPath, string Icon)> KnownServices = new()
        {
            ["shane-mccaw-consulting"] = ("Marketing", 5173, "artifacts/shane-mccaw-consulting", "🌐"),
            ["msp-portal"] = ("Portal", 5175, "artifacts/msp-portal", "💼"),
            ["admin-panel"] = ("Admin", 5174, "artifacts/admin-panel", "⚙️"),
            ["api-server"] = ("API Server", 8080, "artifacts/api-server", "🖥️"),
            ["msp-website"] = ("Website", 5176, "artifacts/msp-website", "📄")
        };

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
