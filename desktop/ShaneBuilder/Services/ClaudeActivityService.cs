using System;
using System.Windows;

namespace ShaneBuilder.Services;

/// <summary>
/// Git #2332 (Feature: Test Pad, #2326, item 6 of 28) — the real "is Claude currently generating a
/// response" signal the Test Pad's status band reads. There is no native chat-session object to hook
/// here: ShaneBuilder's chat surface is the real claude.ai site loaded in the active keep-alive
/// tab's own WebView2 (Git #2470; MainWindow.KeepAliveTabs.cs), not a wrapped Claude Code process,
/// so this can't be a simple
/// IsRunning-flips-around-an-await flag the way <see cref="TerminalSession.IsRunning"/> is. Instead
/// MainWindow polls the active chat tab's WebView2 DOM (same ExecuteScriptAsync pattern as its own
/// TryReadLastAssistantTurnAsync) for claude.ai's own "Stop response" control and reports the result
/// here. Modeled on TestPadService's static/thread-safe/never-throws shape — one shared surface any
/// window (the pill, the pad) can read or subscribe to without a MainWindow reference.
/// </summary>
public static class ClaudeActivityService
{
    private static readonly object _lock = new();
    private static bool _isWorking;

    public static event Action? Changed;

    public static bool IsWorking { get { lock (_lock) return _isWorking; } }

    /// <summary>Called by MainWindow's poll timer with the freshly-read DOM state. A no-op (and no
    /// event) when the value hasn't actually changed, so subscribers aren't repainted every poll tick.</summary>
    public static void SetWorking(bool working)
    {
        try
        {
            lock (_lock)
            {
                if (_isWorking == working) return;
                _isWorking = working;
            }
            RaiseChanged();
        }
        catch { /* a poll result failing to publish must never take down the caller */ }
    }

    private static void RaiseChanged()
    {
        var app = Application.Current;
        if (app?.Dispatcher == null) { Changed?.Invoke(); return; }
        if (app.Dispatcher.CheckAccess()) Changed?.Invoke();
        else app.Dispatcher.BeginInvoke(new Action(() => Changed?.Invoke()));
    }
}
