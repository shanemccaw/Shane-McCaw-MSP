using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Point = System.Windows.Point;
using MouseEventArgs = System.Windows.Input.MouseEventArgs;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;

namespace MyArchitect;

/// <summary>
/// Full-virtual-screen transparent overlay window for selecting a screen capture region.
/// Reports the selected bounds in physical pixels (via Win32 cursor pos), avoiding per-monitor DPI issues.
/// </summary>
public partial class RegionSelectOverlayWindow : Window
{
    public Int32Rect SelectedPhysicalRect { get; private set; } = Int32Rect.Empty;

    private Point _dragStart;
    private bool _dragging;
    private POINT _dragStartPhysical;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out POINT lpPoint);

    public RegionSelectOverlayWindow()
    {
        InitializeComponent();
    }

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

        GetCursorPos(out var endPhysical);
        int x = Math.Min(_dragStartPhysical.X, endPhysical.X);
        int y = Math.Min(_dragStartPhysical.Y, endPhysical.Y);
        int w = Math.Abs(endPhysical.X - _dragStartPhysical.X);
        int h = Math.Abs(endPhysical.Y - _dragStartPhysical.Y);

        if (w < 4 || h < 4)
        {
            DialogResult = false;
            return;
        }

        SelectedPhysicalRect = new Int32Rect(x, y, w, h);
        DialogResult = true;
    }

    private void RootCanvas_MouseRightButtonDown(object sender, MouseButtonEventArgs e)
    {
        DialogResult = false;
    }

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            DialogResult = false;
        }
    }
}
