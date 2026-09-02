using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;

namespace ShaneBuilder;

/// <summary>
/// Git #2201 — the single shared hub both real emitters (AlertWatchers.cs) and the Alert Lab publish
/// through, and both channel windows (AlertStackWindow, CritterOverlayWindow) subscribe to. Modeled
/// on ToastEngine's static, UI-thread-marshaling, never-throws shape (Notifications/ToastEngine.cs) —
/// same "one simple static call from anywhere, on or off the UI thread" contract — but this engine
/// carries STRUCTURED Alert/Celebration records instead of a title/message string pair, and its state
/// (the live alert stack + history) persists across calls rather than each toast being fire-and-forget.
///
/// Caps mirror the mockup's own celebrate()/pushAlert() logic verbatim: at most 3 live alerts kept
/// (newest first — a 4th push evicts the oldest), history capped at 30 for the Alert Lab.
/// </summary>
public static class AlertCenter
{
    private const int MaxLiveAlerts = 3;
    private const int MaxHistory = 30;

    private static readonly List<Alert> _alerts = new();
    private static readonly List<Alert> _log = new();

    public static event Action? AlertsChanged;
    public static event Action<Celebration>? CelebrationRequested;

    public static IReadOnlyList<Alert> LiveAlerts { get { lock (_alerts) return _alerts.ToList(); } }
    public static IReadOnlyList<Alert> History { get { lock (_log) return _log.ToList(); } }

    /// <summary>Publishes a real Alert (Channel 1). Thread-safe — marshals to the UI thread like
    /// ToastEngine.Show, and a publish must never throw back into the caller (a watcher's poll loop).</summary>
    public static void PublishAlert(Alert alert)
    {
        var app = Application.Current;
        if (app?.Dispatcher == null) return;
        if (app.Dispatcher.CheckAccess()) PublishCore(alert);
        else app.Dispatcher.BeginInvoke(new Action(() => PublishCore(alert)));
    }

    private static void PublishCore(Alert alert)
    {
        try
        {
            lock (_alerts)
            {
                _alerts.Insert(0, alert);
                while (_alerts.Count > MaxLiveAlerts) _alerts.RemoveAt(_alerts.Count - 1);
            }
            lock (_log)
            {
                _log.Insert(0, alert);
                while (_log.Count > MaxHistory) _log.RemoveAt(_log.Count - 1);
            }
            AlertsChanged?.Invoke();
        }
        catch { /* a notification failing must never take down the emitter that raised it */ }
    }

    public static void DismissAlert(string id)
    {
        var app = Application.Current;
        if (app?.Dispatcher == null) return;
        void Core()
        {
            try
            {
                lock (_alerts) _alerts.RemoveAll(a => a.Id == id);
                AlertsChanged?.Invoke();
            }
            catch { }
        }
        if (app.Dispatcher.CheckAccess()) Core();
        else app.Dispatcher.BeginInvoke(new Action(Core));
    }

    /// <summary>Publishes a Celebration (Channel 2). Fire-and-forget — the critter overlay owns its
    /// own lifetime/removal timer, same non-blocking shape as ToastEngine.</summary>
    public static void Celebrate(Celebration celebration)
    {
        var app = Application.Current;
        if (app?.Dispatcher == null) return;
        void Core()
        {
            try { CelebrationRequested?.Invoke(celebration); }
            catch { }
        }
        if (app.Dispatcher.CheckAccess()) Core();
        else app.Dispatcher.BeginInvoke(new Action(Core));
    }
}
