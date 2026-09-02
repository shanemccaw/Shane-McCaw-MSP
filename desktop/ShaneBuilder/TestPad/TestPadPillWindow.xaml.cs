using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using ShaneBuilder.Services;

namespace ShaneBuilder
{
    /// <summary>
    /// Git #2327 — the always-visible bottom-right pill. Shows the live unsent-note count as a
    /// badge (hidden at zero) and toggles <see cref="TestPadWindow"/> open/closed on click.
    /// Positioning/topmost mechanics mirror AlertStackWindow's Reposition/ForceTopmost verbatim.
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

        public Action? OnTogglePad;

        public TestPadPillWindow()
        {
            InitializeComponent();
            WindowStartupLocation = WindowStartupLocation.Manual;
            SizeChanged += (_, _) => Reposition();
            Loaded += (_, _) => { Reposition(); ForceTopmost(); Render(); };
            Deactivated += (_, _) => ForceTopmost();

            TestPadService.NotesChanged += Render;
        }

        private void Pill_Click(object sender, MouseButtonEventArgs e) => OnTogglePad?.Invoke();

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

        private void Reposition()
        {
            try
            {
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
            catch { }
        }
    }
}
