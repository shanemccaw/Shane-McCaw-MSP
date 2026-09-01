using System;
using System.Windows;

namespace ShaneBuilder
{
    /// <summary>
    /// ShaneBuilder's single, reusable, NON-BLOCKING notification engine — ported verbatim
    /// (Git #2174) from BuildConsole's <c>Notifications/ToastEngine.cs</c>, restyled against the
    /// #2147 token dictionary (<c>Themes/Colors.xaml</c>) instead of the old #2126 palette. It
    /// replaces scattered native <c>MessageBox.Show(...)</c> calls (blocking, modal, focus-stealing,
    /// with the system alert sound) with a soft themed toast that stacks at the top-centre of the
    /// screen and auto-dismisses.
    ///
    /// The visual/behavioural pattern: a borderless, transparent, Topmost window that never steals
    /// focus (SWP_NOACTIVATE + ShowActivated="False") and is never shown modally (<c>Show()</c>,
    /// never <c>ShowDialog()</c>). One shared <see cref="ToastHostWindow"/> hosts a vertical stack
    /// of <see cref="ToastCard"/>s so several notifications can be on screen at once.
    ///
    /// Usage — one simple static call from anywhere, on or off the UI thread:
    /// <code>
    ///     ToastEngine.Show("Queue Build", "Not connected — see Settings.", ToastKind.Warning);
    ///     ToastEngine.Error("New Issue", $"Couldn't create the issue: {ex.Message}");
    ///     ToastEngine.Success("Queued after update", "Saved — will queue right after the restart.");
    /// </code>
    /// A toast must never crash the caller, so every entry point is defensively wrapped and simply
    /// no-ops if there is no live WPF <see cref="Application"/> (e.g. during teardown).
    /// </summary>
    public static class ToastEngine
    {
        // The single shared host. Nulled again whenever it closes (it closes itself once its last
        // toast dismisses — see ToastHostWindow) so the next Show() transparently recreates it.
        private static ToastHostWindow? _host;

        /// <summary>Neutral information toast (blue).</summary>
        public static void Info(string title, string message = "", TimeSpan? duration = null)
            => Show(title, message, ToastKind.Info, duration);

        /// <summary>Success toast (green).</summary>
        public static void Success(string title, string message = "", TimeSpan? duration = null)
            => Show(title, message, ToastKind.Success, duration);

        /// <summary>Warning / precondition-not-met toast (amber).</summary>
        public static void Warning(string title, string message = "", TimeSpan? duration = null)
            => Show(title, message, ToastKind.Warning, duration);

        /// <summary>Failure toast (red).</summary>
        public static void Error(string title, string message = "", TimeSpan? duration = null)
            => Show(title, message, ToastKind.Error, duration);

        /// <summary>
        /// The one general-purpose entry point. Thread-safe: marshals onto the WPF UI thread if the
        /// caller isn't already on it. <paramref name="title"/> is the bold first line (typically the
        /// old MessageBox caption), <paramref name="message"/> the body. A null <paramref name="duration"/>
        /// picks a sensible default for the <paramref name="kind"/> (errors/warnings dwell longer).
        /// <paramref name="onClick"/>, when supplied, makes the whole card a click target (hand cursor):
        /// clicking the body invokes it (on the UI thread) and dismisses the toast. <paramref name="persistent"/>
        /// suppresses auto-dismiss entirely (see <see cref="ShowPersistent"/>) — the foundation #2026
        /// (persistent actionable notifications) and #2159 (chat-response notification, via
        /// <paramref name="onClick"/>-driven click-to-jump) build on.
        /// </summary>
        public static void Show(string title, string message, ToastKind kind = ToastKind.Info, TimeSpan? duration = null, Action? onClick = null, bool persistent = false)
        {
            var app = Application.Current;
            if (app?.Dispatcher == null) return; // no live WPF app (headless / teardown) — nothing to show

            if (app.Dispatcher.CheckAccess())
                ShowCore(title, message, kind, duration, onClick, persistent);
            else
                app.Dispatcher.BeginInvoke(new Action(() => ShowCore(title, message, kind, duration, onClick, persistent)));
        }

        /// <summary>A genuinely persistent toast: no auto-dismiss timer runs at all, so it stays on
        /// screen until dismissed via its own ✕ (or a self-dismissing <paramref name="onClick"/>).
        /// Ported for the same "must not be missed" use case as BuildConsole's Git #1636.</summary>
        public static void ShowPersistent(string title, string message, ToastKind kind = ToastKind.Success, Action? onClick = null)
            => Show(title, message, kind, duration: null, onClick: onClick, persistent: true);

        private static void ShowCore(string title, string message, ToastKind kind, TimeSpan? duration, Action? onClick, bool persistent = false)
        {
            try
            {
                var host = _host;
                if (host == null)
                {
                    host = new ToastHostWindow();

                    // Own the host off the main window so it tracks the app's lifecycle (closes when
                    // the app closes, hides when minimized) — and so a lingering host can never keep
                    // the process alive at shutdown.
                    var owner = Application.Current?.MainWindow;
                    if (owner != null && !ReferenceEquals(owner, host))
                    {
                        try { host.Owner = owner; } catch { /* owner not ready yet — fine, it still shows */ }
                    }

                    var created = host;
                    created.Closed += (_, _) => { if (ReferenceEquals(_host, created)) _host = null; };
                    _host = host;
                }

                host.AddToast(title ?? "", message ?? "", kind, duration ?? DefaultDuration(kind), onClick, persistent);
            }
            catch
            {
                // A notification failing must never take down the operation that raised it.
            }
        }

        private static TimeSpan DefaultDuration(ToastKind kind) => kind switch
        {
            ToastKind.Error => TimeSpan.FromSeconds(9),
            ToastKind.Warning => TimeSpan.FromSeconds(8),
            _ => TimeSpan.FromSeconds(5),
        };
    }
}
