using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace ShaneBuilder.Services;

/// <summary>Git #2203 — one real local dev service's status for the Command Center's "Services"
/// category, straight off the same real files <c>scripts/dev-all.mjs</c> itself writes — no
/// fixture list.</summary>
public sealed class DevServiceRow
{
    public string Name { get; init; } = "";
    public string Title { get; init; } = "";
    public int Port { get; init; }
    public int? Pid { get; init; }
    public string Status { get; init; } = "stopped";
    public string? LogFile { get; init; }
    public bool PortOpen { get; init; }
}

/// <summary>Git #2203 — read-only(-ish) client for ShaneBuilder's own copy of the real local dev
/// service registry. Ported from BuildConsole's <c>Services/DevServicesManager.cs</c> (that app
/// is frozen for new feature work per #2178, so this is a genuine port, not a shared reference —
/// same real files, same real <c>--start</c>/<c>--stop</c> flags <c>scripts/dev-all.mjs</c>
/// itself defines), trimmed to what the palette's Services tab actually needs.</summary>
public static class DevServicesReadClient
{
    private static readonly Dictionary<string, (string Title, int Port)> KnownServices = new()
    {
        ["api-server"] = ("API Server", 8080),
        ["shane-mccaw-consulting"] = ("Marketing", 5173),
        ["admin-panel"] = ("Admin", 5174),
        ["portal"] = ("Portal", 5175),
        ["msp-website"] = ("Website", 5176),
    };

    /// <summary>Loads the real port list from <c>scripts/dev-server/services.json</c> — the same
    /// file <c>scripts/dev-all.mjs</c> and BuildConsole's own manager both read — overriding the
    /// small hardcoded fallback above only where the file actually has a value, so a missing/odd
    /// config never turns into a wrong port for a genuinely-listed service.</summary>
    private static void LoadRealPortsFrom(string repoRoot)
    {
        try
        {
            var configPath = Path.Combine(repoRoot, "scripts", "dev-server", "services.json");
            if (!File.Exists(configPath)) return;
            using var doc = JsonDocument.Parse(File.ReadAllText(configPath));
            if (!doc.RootElement.TryGetProperty("services", out var arr) || arr.ValueKind != JsonValueKind.Array) return;
            foreach (var el in arr.EnumerateArray())
            {
                if (!el.TryGetProperty("name", out var nameEl)) continue;
                var name = nameEl.GetString();
                if (string.IsNullOrWhiteSpace(name)) continue;
                var title = el.TryGetProperty("title", out var t) ? (t.GetString() ?? name) : name;
                var port = el.TryGetProperty("port", out var p) ? p.GetInt32() : 0;
                KnownServices[name] = (title, port);
            }
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[dev-services] couldn't read services.json: {ex.Message}");
        }
    }

    private static string LogDir(string repoRoot) => Path.Combine(repoRoot, ".logs", "dev-all");

    /// <summary>Every known service's real current status — meta file (name/title/port/pid/status,
    /// written by <c>dev-all.mjs</c> itself on every state change) plus a live TCP probe of the
    /// port, since the meta file can lag a crash. Honestly falls back to "stopped, port closed"
    /// for a service with no meta file yet rather than inventing a row.</summary>
    public static async Task<List<DevServiceRow>> GetAllAsync(string repoRoot)
    {
        LoadRealPortsFrom(repoRoot);
        var dir = LogDir(repoRoot);
        var result = new List<DevServiceRow>();

        // Snapshot before the async loop below — GetAllAsync can be in flight from more than one
        // caller at once (a 30s cache refresh racing a Start/Stop button's force:true reload), and
        // each call's own LoadRealPortsFrom mutates the shared KnownServices dictionary in place.
        // Enumerating the live dictionary across an await would risk "Collection was modified"
        // if another call's LoadRealPortsFrom lands mid-iteration.
        var known = KnownServices.ToList();
        foreach (var (name, (title, port)) in known)
        {
            string? logFile = null;
            string status = "stopped";
            int? pid = null;

            var metaPath = Path.Combine(dir, $"{name}.meta.json");
            if (File.Exists(metaPath))
            {
                try
                {
                    using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(metaPath));
                    var root = doc.RootElement;
                    if (root.TryGetProperty("status", out var s)) status = s.GetString() ?? status;
                    if (root.TryGetProperty("pid", out var p) && p.ValueKind == JsonValueKind.Number) pid = p.GetInt32();
                    if (root.TryGetProperty("logFile", out var lf)) logFile = lf.GetString();
                }
                catch (Exception ex)
                {
                    ConsoleOutputSink.Log(LogLevel.Warn, $"[dev-services] couldn't read {name}.meta.json: {ex.Message}");
                }
            }
            logFile ??= Path.Combine(dir, $"{name}.log");

            bool portOpen = port > 0 && await IsPortOpenAsync(port);
            result.Add(new DevServiceRow
            {
                Name = name, Title = title, Port = port, Pid = pid,
                Status = portOpen ? "running" : status,
                LogFile = File.Exists(logFile) ? logFile : null,
                PortOpen = portOpen
            });
        }

        return result;
    }

    public static async Task<bool> IsPortOpenAsync(int port, int timeoutMs = 400)
    {
        try
        {
            using var cts = new CancellationTokenSource(timeoutMs);
            using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
            await socket.ConnectAsync(System.Net.IPAddress.Loopback, port, cts.Token);
            return socket.Connected;
        }
        catch { return false; }
    }

    /// <summary>Real <c>node scripts/dev-all.mjs --start &lt;name&gt;</c> — the same command
    /// BuildConsole's own Start button runs. Fire-and-forget by design (dev-all.mjs backgrounds
    /// the actual child); the caller re-polls <see cref="GetAllAsync"/> to see it land.</summary>
    public static bool StartService(string repoRoot, string name)
    {
        try
        {
            var scriptPath = Path.Combine(repoRoot, "scripts", "dev-all.mjs");
            Process.Start(new ProcessStartInfo
            {
                FileName = "node",
                Arguments = $"\"{scriptPath}\" --start {name}",
                WorkingDirectory = repoRoot,
                UseShellExecute = false,
                CreateNoWindow = true
            });
            return true;
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[dev-services] couldn't start '{name}': {ex.Message}");
            return false;
        }
    }

    public static bool StopService(string repoRoot, string name)
    {
        try
        {
            var scriptPath = Path.Combine(repoRoot, "scripts", "dev-all.mjs");
            Process.Start(new ProcessStartInfo
            {
                FileName = "node",
                Arguments = $"\"{scriptPath}\" --stop {name}",
                WorkingDirectory = repoRoot,
                UseShellExecute = false,
                CreateNoWindow = true
            });
            return true;
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[dev-services] couldn't stop '{name}': {ex.Message}");
            return false;
        }
    }
}
