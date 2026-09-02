using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Shapes;

namespace ShaneBuilder
{
    /// <summary>
    /// Git #2210 — ported from desktop/BuildConsole/RegionSelectOverlayWindow.xaml.cs (Git #1866),
    /// desktop-mode only. Caller calls <see cref="ConfigureForVirtualScreen"/> to cover the whole
    /// virtual screen (spanning every monitor), then ShowDialog(). A drag draws the selection box;
    /// releasing the mouse ends the dialog with DialogResult=true and <see cref="SelectedPhysicalRect"/>
    /// set — an <see cref="Int32Rect"/> in physical screen pixels taken directly from the Win32 cursor
    /// position (GetCursorPos), NOT from WPF's per-visual-root DIP mapping. That sidesteps the
    /// per-monitor-DPI trap entirely: GetCursorPos and Graphics.CopyFromScreen share the same GDI/process
    /// coordinate space, so a selection that spans two monitors at different scale factors is captured
    /// at the right offset and size regardless of DPI. Esc or right-click cancels (DialogResult=false).
    /// </summary>
    public partial class RegionSelectOverlayWindow : Window
    {
        /// <summary>The drawn region in PHYSICAL screen pixels (absolute, virtual-screen origin). Only
        /// meaningful when DialogResult == true.</summary>
        public Int32Rect SelectedPhysicalRect { get; private set; } = Int32Rect.Empty;

        private Point _dragStart;
        private bool _dragging;
        private POINT _dragStartPhysical;

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int X; public int Y; }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetCursorPos(out POINT lpPoint);

        public RegionSelectOverlayWindow() => InitializeComponent();

        /// <summary>Covers the whole virtual screen (spanning every monitor). Call once, before
        /// ShowDialog(). The window bounds use WPF's virtual-screen metrics (DIPs) purely so the
        /// dimming layer covers everything; the captured geometry does NOT depend on them.</summary>
        public void ConfigureForVirtualScreen()
        {
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = SystemParameters.VirtualScreenLeft;
            Top = SystemParameters.VirtualScreenTop;
            Width = SystemParameters.VirtualScreenWidth;
            Height = SystemParameters.VirtualScreenHeight;
        }

        private void RootCanvas_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            _dragStart = e.GetPosition(RootCanvas);
            GetCursorPos(out _dragStartPhysical);
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
            double x = Math.Min(pos.X, _dragStart.X);
            double y = Math.Min(pos.Y, _dragStart.Y);
            double w = Math.Abs(pos.X - _dragStart.X);
            double h = Math.Abs(pos.Y - _dragStart.Y);
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

            // Authoritative geometry from the Win32 cursor position (physical pixels, same
            // coordinate space Graphics.CopyFromScreen reads), NOT from WPF DIPs — see class doc.
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
        }

        private void Window_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape)
                DialogResult = false;
        }

        private void RootCanvas_MouseRightButtonDown(object sender, MouseButtonEventArgs e)
        {
            DialogResult = false;
        }
    }
}
