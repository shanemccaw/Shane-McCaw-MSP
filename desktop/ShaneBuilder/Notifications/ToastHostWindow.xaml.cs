using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace ShaneBuilder
{
    /// <summary>
    /// The single shared container window for <see cref="ToastCard"/> notifications, owned and
    /// driven by <see cref="ToastEngine"/>. Borderless, transparent, always-on-top and never
    /// activated:
    ///
    ///  * <b>Positioning</b> — centred horizontally and parked at the mid-top of the primary work
    ///    area, re-centred whenever the stack grows/shrinks (SizeToContent changes ActualWidth).
    ///  * <b>Never blocks / never steals focus</b> — shown with <c>Show()</c> (never
    ///    <c>ShowDialog()</c>), <c>ShowActivated="False"</c>, and HWND_TOPMOST re-asserted via
    ///    SWP_NOACTIVATE so it stays above other windows without pulling focus.
    ///  * <b>Stacking</b> — a vertical StackPanel holds every live card; a soft cap evicts the
    ///    oldest once too many pile up.
    ///  * <b>Self-closing</b> — closes itself when its last toast dismisses (the engine transparently
    ///    recreates it next time), so a lingering empty host can never keep the process alive.
    /// </summary>
    public partial class ToastHostWindow : Window
    {
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

        private static readonly IntPtr HwndTopmost = new IntPtr(-1);
        private const uint SwpNoMove = 0x0002;
        private const uint SwpNoSize = 0x0001;
        private const uint SwpNoActivate = 0x0010;

        // Distance from the top edge of the work area — "mid-top", clear of the very edge.
        private const double TopOffset = 40;

        // Most cards visible at once; older ones are evicted so the stack can't run off-screen.
        private const int MaxVisible = 6;

        public ToastHostWindow()
        {
            InitializeComponent();

            WindowStartupLocation = WindowStartupLocation.Manual;
            SizeChanged += (_, _) => Reposition();
            Loaded += (_, _) => { Reposition(); ForceTopmost(); };

            // Topmost="True" alone doesn't reliably stick against a separate maximized top-level
            // window once it activates — re-assert HWND_TOPMOST without stealing focus.
            Deactivated += (_, _) => ForceTopmost();
        }

        /// <summary>Adds a new toast to the bottom of the stack, showing the host if hidden.
        /// <paramref name="onClick"/>, when supplied, makes the card body clickable (see <see cref="ToastCard"/>).
        /// <paramref name="persistent"/> suppresses auto-dismiss entirely — only the card's own ✕
        /// button (or a self-dismissing <paramref name="onClick"/>) can close it.</summary>
        public void AddToast(string title, string message, ToastKind kind, TimeSpan duration, Action? onClick = null, bool persistent = false)
        {
            var card = new ToastCard(title, message, kind, duration, onClick, persistent);
            card.Dismissed += (_, _) => RemoveCard(card);
            ToastStack.Children.Add(card);

            // Soft cap: drop the oldest card(s) immediately (no wait for their own timers) so a burst
            // of notifications can't grow the stack past the screen.
            while (ToastStack.Children.Count > MaxVisible)
                ToastStack.Children.RemoveAt(0);

            if (!IsVisible)
            {
                try { Show(); } catch { /* owner not ready in a rare early call — swallow */ }
            }

            Reposition();
            ForceTopmost();
        }

        private void RemoveCard(ToastCard card)
        {
            ToastStack.Children.Remove(card);
            if (ToastStack.Children.Count == 0)
            {
                // Close (not just hide) so a stray empty host can never keep the app alive at
                // shutdown; ToastEngine recreates it on the next Show().
                try { Close(); } catch { /* best-effort */ }
            }
            else
            {
                Reposition();
            }
        }

        private void Reposition()
        {
            try
            {
                var wa = SystemParameters.WorkArea;
                Left = wa.Left + (wa.Width - ActualWidth) / 2;
                Top = wa.Top + TopOffset;
            }
            catch { /* best-effort positioning */ }
        }

        private void ForceTopmost()
        {
            try
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                if (hwnd != IntPtr.Zero)
                    SetWindowPos(hwnd, HwndTopmost, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoActivate);
            }
            catch { /* best-effort */ }
        }
    }
}
