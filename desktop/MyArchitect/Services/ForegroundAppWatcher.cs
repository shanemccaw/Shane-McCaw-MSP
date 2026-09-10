using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Timer = System.Threading.Timer;

namespace MyArchitect.Services;

/// <summary>
/// Real Win32 foreground-window polling implementation of <see cref="IForegroundAppWatcher"/>.
/// Polls every 15s on a background timer (no WPF dependency — safe to construct off the UI
/// thread) via <c>GetForegroundWindow</c>/<c>GetWindowThreadProcessId</c>, resolves the owning
/// process, and raises <see cref="ForegroundAppChanged"/> only on a genuine switch to a
/// genuinely-external app (never MyArchitect's own process, never a no-op repeat).
/// </summary>
public sealed class ForegroundAppWatcher : IForegroundAppWatcher
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(15);

    private readonly int _ownProcessId = Process.GetCurrentProcess().Id;
    private Timer? _timer;
    private string? _lastExternalLabel;

    public event Action<string>? ForegroundAppChanged;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    public void Start()
    {
        _timer ??= new Timer(_ => Poll(), null, PollInterval, PollInterval);
    }

    public void Stop()
    {
        _timer?.Dispose();
        _timer = null;
    }

    private void Poll()
    {
        try
        {
            var hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return;

            GetWindowThreadProcessId(hwnd, out var pid);
            if (pid == 0 || pid == (uint)_ownProcessId)
            {
                // Focus is back on MyArchitect (or unresolvable) — clear so the next genuine
                // external switch fires again instead of being deduped against a stale label.
                _lastExternalLabel = null;
                return;
            }

            using var process = Process.GetProcessById((int)pid);
            var label = FriendlyLabel(process.ProcessName);

            if (label == _lastExternalLabel) return;
            _lastExternalLabel = label;
            ForegroundAppChanged?.Invoke(label);
        }
        catch
        {
            // Process may have exited between GetWindowThreadProcessId and GetProcessById, or
            // access may be denied for an elevated window — a poll miss is not worth surfacing.
        }
    }

    /// <summary>Maps a handful of real, commonly-hit process names to a friendlier label; falls
    /// back to the real process name itself for anything else — never a fabricated label.</summary>
    private static string FriendlyLabel(string processName) => processName.ToLowerInvariant() switch
    {
        "code" => "VS Code",
        "windowsterminal" => "Terminal",
        "cmd" => "Command Prompt",
        "powershell" or "pwsh" => "PowerShell",
        "slack" => "Slack",
        "chrome" => "Chrome",
        "msedge" => "Edge",
        "outlook" => "Outlook",
        "teams" or "ms-teams" => "Teams",
        _ => processName,
    };

    public void Dispose() => Stop();
}
