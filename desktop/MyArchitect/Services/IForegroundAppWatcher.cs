using System;

namespace MyArchitect.Services;

/// <summary>
/// Foreground-window fallback (#3463) — tags activity against whatever genuinely external app
/// (VS Code, a terminal, Slack, ...) currently has focus, so the local Activity Layer timeline
/// still has a real entry for time spent outside MyArchitect entirely. Local only.
/// </summary>
public interface IForegroundAppWatcher : IDisposable
{
    /// <summary>Fires with a friendly app label whenever a genuinely external app takes the
    /// foreground — never fires for MyArchitect's own window, and never fires twice in a row for
    /// the same app without an intervening switch away.</summary>
    event Action<string>? ForegroundAppChanged;

    void Start();
    void Stop();
}
