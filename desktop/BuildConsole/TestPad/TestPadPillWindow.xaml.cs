using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using BuildConsole.Services;
using BuildConsole.Services.TestPad;

namespace BuildConsole.TestPad
{
    /// <summary>
    /// Ported from ShaneBuilder (Git #2531/#2532, Feature: Test Pad #2530; originally Git #2327,
    /// ShaneBuilder Feature: Test Pad #2326) — the always-visible bottom-right pill. Shows the
    /// live unsent-note count as a badge (hidden at zero) and toggles <see cref="TestPadWindow"/>
    /// open/closed on click. Positioning/topmost mechanics are the same real
    /// SystemParameters.WorkArea + SetWindowPos(HWND_TOPMOST) recipe
    /// <see cref="Notifications.ToastHostWindow"/> already uses, anchored bottom-right instead of
    /// mid-top-center.
    /// </summary>
    public partial class TestPadPillWindow : Window
    {
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

        private static readonly IntPtr HwndTopmost = new IntPtr(-1);
        private const uint SwpNoMove = 0x0002;
        private const uint SwpNoSize = 0x0001;
        private const uint SwpNoActivate = 0x0010;

        private const double RightOffset = 14;
        private const double BottomOffset = 14;

        // Git #3792 — set by the context menu's "Move", consumed by the very next
        // PreviewMouseLeftButtonDown on the pill, which starts the real DragMove(). Splitting
        // arm/consume this way is necessary because DragMove() requires the left button to
        // already be down when it's called — it can't be invoked directly from the context
        // menu's own Click handler, since the button that opened/clicked the menu is already up
        // by then.
        private bool _armedForMove;

        public Action? OnTogglePad;

        public TestPadPillWindow()
        {
            InitializeComponent();
            WindowStartupLocation = WindowStartupLocation.Manual;
            SizeChanged += (_, _) => Reposition();
            Loaded += (_, _) => { Reposition(); ForceTopmost(); Render(); };
            Deactivated += (_, _) => ForceTopmost();

            TestPadService.NotesChanged += Render;
            Closed += (_, _) => TestPadService.NotesChanged -= Render;
        }

        private void Pill_Click(object sender, MouseButtonEventArgs e) => OnTogglePad?.Invoke();

        /// <summary>Git #3792 — real right-click "Move": arms on click, then the very next
        /// left-button-down on the pill (this handler) consumes the arm and starts a real
        /// <see cref="DragMove"/> instead of letting the button-up open the pad. Marking the
        /// event handled here prevents <see cref="Pill_Click"/> from also firing for this
        /// gesture.</summary>
        private void Pill_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (!_armedForMove)
            {
                return;
            }

            _armedForMove = false;
            Cursor = System.Windows.Input.Cursors.Hand;
            e.Handled = true;

            try
            {
                DragMove();
            }
            catch { /* DragMove throws if the button was already released before the move started */ }

            PersistPosition();
        }

        private void MoveMenuItem_Click(object sender, RoutedEventArgs e)
        {
            _armedForMove = true;
            Cursor = System.Windows.Input.Cursors.SizeAll;
        }

        /// <summary>Git #3792 — right-click "Hide": persists <c>TestPadPillVisible = false</c> so
        /// the pill stays hidden across restarts, then hides the window itself. The real,
        /// non-dead-end way back is the Settings tab's "Show Test Pad pill" checkbox
        /// (<see cref="Controls.SettingsTabView"/>), which flips the same setting and calls
        /// <see cref="MainWindow.RefreshTestPadPillVisibility"/> to re-show it live.</summary>
        private void HideMenuItem_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.TestPadPillVisible = false;
                settings.Save();
            }
            catch { /* best-effort persistence */ }

            Hide();
        }

        /// <summary>Git #3792 — persists the pill's current position immediately after a
        /// Move drag completes, so it survives app restarts. Read back by <see
        /// cref="Reposition"/>.</summary>
        private void PersistPosition()
        {
            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.TestPadPillLeft = Left;
                settings.TestPadPillTop = Top;
                settings.Save();
            }
            catch { /* best-effort persistence */ }
        }

        public void Render()
        {
            int unsent = TestPadService.UnsentCount;
            if (unsent > 0)
            {
                CountBadgeText.Text = unsent > 99 ? "99+" : unsent.ToString();
                CountBadge.Visibility = Visibility.Visible;
            }
            else
            {
                CountBadge.Visibility = Visibility.Collapsed;
            }
        }

        /// <summary>Fires on every SizeChanged (e.g. the unsent-count badge appearing/disappearing
        /// changes the pill's size) and on Loaded. Git #3792 — once a real custom position has
        /// been set via right-click Move (<see cref="PersistPosition"/>), this must respect it
        /// instead of unconditionally forcing the bottom-right anchor, or a manual move gets
        /// silently fought/undone the next time anything resizes the pill.</summary>
        private void Reposition()
        {
            try
            {
                var settings = BuildConsoleSettings.Load();
                if (settings.TestPadPillLeft.HasValue && settings.TestPadPillTop.HasValue)
                {
                    Left = settings.TestPadPillLeft.Value;
                    Top = settings.TestPadPillTop.Value;
                    return;
                }

                var wa = SystemParameters.WorkArea;
                Left = wa.Right - ActualWidth - RightOffset;
                Top = wa.Bottom - ActualHeight - BottomOffset;
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
