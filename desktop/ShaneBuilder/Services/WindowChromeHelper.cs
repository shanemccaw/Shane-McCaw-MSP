using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace ShaneBuilder.Services
{
    /// <summary>
    /// Git #2179 — ported from desktop/BuildConsole/Services/WindowChromeHelper.cs (Git #1006/#894)
    /// so ShaneBuilder's own custom-chrome windows (WindowStyle="None" + WindowChrome) get the same
    /// dark immersive title bar + the WM_GETMINMAXINFO clamp that keeps a chromeless window's
    /// Maximize from covering the taskbar. Call <see cref="Setup"/> from each window's
    /// OnSourceInitialized.
    /// </summary>
    public static class WindowChromeHelper
    {
        [DllImport("dwmapi.dll", PreserveSig = true)]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        private struct MINMAXINFO
        {
            public POINT ptReserved;
            public POINT ptMaxSize;
            public POINT ptMaxPosition;
            public POINT ptMinTrackSize;
            public POINT ptMaxTrackSize;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public int dwFlags;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr handle, int flags);

        [DllImport("user32.dll")]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        private const int MONITOR_DEFAULTTONEAREST = 0x00000002;
        private const int WM_GETMINMAXINFO = 0x0024;

        private static void ClampMaximizedBoundsToWorkArea(IntPtr hwnd, IntPtr lParam)
        {
            var mmi = Marshal.PtrToStructure<MINMAXINFO>(lParam);

            IntPtr monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if (monitor != IntPtr.Zero)
            {
                var monitorInfo = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
                GetMonitorInfo(monitor, ref monitorInfo);
                RECT workArea = monitorInfo.rcWork;
                RECT monitorArea = monitorInfo.rcMonitor;

                mmi.ptMaxPosition.X = Math.Abs(workArea.Left - monitorArea.Left);
                mmi.ptMaxPosition.Y = Math.Abs(workArea.Top - monitorArea.Top);
                mmi.ptMaxSize.X = Math.Abs(workArea.Right - workArea.Left);
                mmi.ptMaxSize.Y = Math.Abs(workArea.Bottom - workArea.Top);
            }

            Marshal.StructureToPtr(mmi, lParam, true);
        }

        /// <summary>Dark immersive title bar + maximize-respects-taskbar fix. Call once, from OnSourceInitialized.</summary>
        public static void Setup(Window window)
        {
            var hwnd = new WindowInteropHelper(window).Handle;
            try
            {
                int darkMode = 1;
                DwmSetWindowAttribute(hwnd, 20, ref darkMode, sizeof(int)); // DWMWA_USE_IMMERSIVE_DARK_MODE
                DwmSetWindowAttribute(hwnd, 19, ref darkMode, sizeof(int)); // Fallback for older Win10 builds

                int roundedValue = 2; // DWMWCP_ROUND
                DwmSetWindowAttribute(hwnd, 33, ref roundedValue, sizeof(int)); // DWMWA_WINDOW_CORNER_PREFERENCE

                int micaValue = 2; // DWMSBT_MAINWINDOW
                DwmSetWindowAttribute(hwnd, 38, ref micaValue, sizeof(int)); // DWMWA_SYSTEMBACKDROP_TYPE
            }
            catch { }

            HwndSource.FromHwnd(hwnd)?.AddHook((IntPtr wnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled) =>
            {
                if (msg == WM_GETMINMAXINFO)
                {
                    ClampMaximizedBoundsToWorkArea(wnd, lParam);
                    handled = true;
                }
                return IntPtr.Zero;
            });
        }
    }
}
