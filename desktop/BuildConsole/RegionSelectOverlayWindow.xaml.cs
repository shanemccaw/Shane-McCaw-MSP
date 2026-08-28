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
    /// </summary>
    public partial class RegionSelectOverlayWindow : Window
    {
        /// <summary>The drawn region in DIPs relative to this window's (the WebView2's) top-left. Only
        /// meaningful when DialogResult == true.</summary>
        public Rect SelectedRect { get; private set; } = Rect.Empty;

        private Point _dragStart;
        private bool _dragging;

        public RegionSelectOverlayWindow() => InitializeComponent();

        private void RootCanvas_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            _dragStart = e.GetPosition(RootCanvas);
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
