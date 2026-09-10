using System;
using System.IO;
using System.Text;

namespace MyArchitect.Infrastructure;

/// <summary>
/// #3554 — the app previously had zero global exception handling, so any unhandled exception
/// killed the process instantly with no trace. This is the real local sink: a best-effort,
/// never-throwing append to <c>%LOCALAPPDATA%\MyArchitect\logs\crash.log</c> (same
/// <c>%LOCALAPPDATA%\MyArchitect</c> root <see cref="ConsoleHistoryService"/> already uses).
/// Every method here swallows its own IO failures — a logger that throws while logging a crash
/// would only compound the crash it is trying to record.
/// </summary>
public static class CrashLog
{
    private static readonly object Gate = new();

    /// <summary>The real on-disk path crash entries are appended to. Public so a caller (e.g. the
    /// global handler's dialog) can point the user at it.</summary>
    public static string LogPath { get; } = BuildLogPath();

    private static string BuildLogPath()
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "MyArchitect", "logs");
            return Path.Combine(dir, "crash.log");
        }
        catch
        {
            // Even resolving the folder can fail on a locked-down profile — fall back to temp so
            // there is still somewhere to write rather than crashing the crash logger.
            return Path.Combine(Path.GetTempPath(), "MyArchitect-crash.log");
        }
    }

    /// <summary>Appends a single timestamped entry. Never throws.</summary>
    public static void Write(string source, Exception? ex, string? note = null)
    {
        try
        {
            var sb = new StringBuilder();
            sb.Append('[').Append(DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")).Append("] ");
            sb.Append(source);
            if (!string.IsNullOrEmpty(note))
                sb.Append(" — ").Append(note);
            sb.AppendLine();
            if (ex != null)
                sb.AppendLine(ex.ToString());
            sb.AppendLine(new string('-', 60));

            lock (Gate)
            {
                var dir = Path.GetDirectoryName(LogPath);
                if (!string.IsNullOrEmpty(dir))
                    Directory.CreateDirectory(dir);
                File.AppendAllText(LogPath, sb.ToString());
            }
        }
        catch
        {
            // Deliberately swallowed — logging a crash must never itself throw.
        }
    }
}
