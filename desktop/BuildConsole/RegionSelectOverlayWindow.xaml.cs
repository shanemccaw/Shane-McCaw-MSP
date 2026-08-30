using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Shapes;

namespace BuildConsole
{
    /// <summary>
    /// Git #1472 — the draw-a-box crop tool for the Visual Test Tracker's region
    /// capture. Caller positions this window's Left/Top/Width/Height to exactly
    /// cover the active WebView2's on-screen bounds, then calls ShowDialog(). A
    /// drag draws the selection rectangle; releasing the mouse ends the dialog with
    /// DialogResult=true and <see cref="SelectedRect"/> set (device-independent
    /// pixels, relative to this window's own top-left — i.e. relative to the
    /// WebView2's top-left, which is what the caller needs). Esc cancels
    /// (DialogResult=false, SelectedRect untouched).
    ///
    /// Git #1866 — additively also serves the desktop screen-clipping tool. Call
    /// <see cref="ConfigureForVirtualScreen"/> BEFORE ShowDialog() to make the
    /// overlay cover the entire virtual screen (all monitors). In that mode the
    /// authoritative selection comes back as <see cref="SelectedPhysicalRect"/> —
    /// an <see cref="Int32Rect"/> in physical screen pixels taken directly from the
    /// Win32 cursor position, NOT from WPF's per-visual-root DIP mapping. That
    /// sidesteps the per-monitor-DPI trap entirely: <c>GetCursorPos</c> and
    /// <c>Graphics.CopyFromScreen</c> share the same GDI/process coordinate space,
    /// so a selection that spans two monitors at different scale factors is captured
    /// at the right offset and size regardless of DPI. The DIP-based
    /// <see cref="SelectedRect"/> and the existing WebView2 caller are untouched.
    /// </summary>
    public partial class RegionSelectOverlayWindow : Window
    {
        /// <summary>The drawn region in DIPs relative to this window's (the WebView2's) top-left. Only
        /// meaningful when DialogResult == true (and the caller used the WebView2 path, not desktop mode).</summary>
        public Rect SelectedRect { get; private set; } = Rect.Empty;

        /// <summary>Git #1866 — the drawn region in PHYSICAL screen pixels (absolute, virtual-screen origin),
        /// taken from the Win32 cursor position rather than WPF DIPs. Only meaningful when DialogResult == true
        /// AND <see cref="ConfigureForVirtualScreen"/> was called first (desktop screen-clip mode).</summary>
        public Int32Rect SelectedPhysicalRect { get; private set; } = Int32Rect.Empty;

        private Point _dragStart;
        private bool _dragging;

        // ── Git #1866 — desktop (full virtual screen) mode ────────────────────────
        private bool _desktopMode;
        private POINT _dragStartPhysical;

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int X; public int Y; }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetCursorPos(out POINT lpPoint);

        public RegionSelectOverlayWindow() => InitializeComponent();

        /// <summary>Git #1866 — switch this overlay into desktop screen-clip mode: cover the whole virtual
        /// screen (spanning every monitor) and report the selection via <see cref="SelectedPhysicalRect"/> in
        /// physical pixels. Call once, before ShowDialog(). The window bounds use WPF's virtual-screen metrics
        /// (DIPs) purely so the dimming layer covers everything; the captured geometry does NOT depend on them.</summary>
        public void ConfigureForVirtualScreen()
        {
            _desktopMode = true;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = SystemParameters.VirtualScreenLeft;
            Top = SystemParameters.VirtualScreenTop;
            Width = SystemParameters.VirtualScreenWidth;
            Height = SystemParameters.VirtualScreenHeight;
        }

        private void RootCanvas_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            _dragStart = e.GetPosition(RootCanvas);
            if (_desktopMode) GetCursorPos(out _dragStartPhysical);
            _dragging = true;
            SelectionRect.Visibility = Visibility.Visible;
            Canvas.SetLeft(SelectionRect, _dragStart.X);
            Canvas.SetTop(SelectionRect, _dragStart.Y);
            SelectionRect.Width = 0;
            SelectionRect.Height = 0;
            Mouse.Capture(RootCanvas);
        }

        private void RootCanvas_MouseMove(object sender, MouseEventArgs e)
        {
            if (!_dragging) return;
            var pos = e.GetPosition(RootCanvas);
            double x = System.Math.Min(pos.X, _dragStart.X);
            double y = System.Math.Min(pos.Y, _dragStart.Y);
            double w = System.Math.Abs(pos.X - _dragStart.X);
            double h = System.Math.Abs(pos.Y - _dragStart.Y);
            Canvas.SetLeft(SelectionRect, x);
            Canvas.SetTop(SelectionRect, y);
            SelectionRect.Width = w;
            SelectionRect.Height = h;
        }

        private void RootCanvas_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        {
            if (!_dragging) return;
            _dragging = false;
            Mouse.Capture(null);

            if (_desktopMode)
            {
                // Git #1866 — authoritative geometry from the Win32 cursor position (physical pixels,
                // same coordinate space Graphics.CopyFromScreen reads), NOT from WPF DIPs. This is what
                // makes a selection spanning two monitors at different DPI capture correctly.
                GetCursorPos(out var endPhysical);
                int x = Math.Min(_dragStartPhysical.X, endPhysical.X);
                int y = Math.Min(_dragStartPhysical.Y, endPhysical.Y);
                int w = Math.Abs(endPhysical.X - _dragStartPhysical.X);
                int h = Math.Abs(endPhysical.Y - _dragStartPhysical.Y);

                if (w < 4 || h < 4)
                {
                    DialogResult = false; // too small to be intentional
                    return;
                }

                SelectedPhysicalRect = new Int32Rect(x, y, w, h);
                DialogResult = true;
                return;
            }

            double left = Canvas.GetLeft(SelectionRect);
            double top = Canvas.GetTop(SelectionRect);
            var rect = new Rect(left, top, SelectionRect.Width, SelectionRect.Height);

            if (rect.Width < 4 || rect.Height < 4)
            {
                // Too small to be an intentional selection — cancel rather than
                // saving a near-empty/junk crop.
                DialogResult = false;
                return;
            }

            SelectedRect = rect;
            DialogResult = true;
        }

        private void Window_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape)
                DialogResult = false;
        }
    }
}
