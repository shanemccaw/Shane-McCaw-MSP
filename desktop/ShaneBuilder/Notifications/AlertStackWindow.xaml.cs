using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace ShaneBuilder
{
    /// <summary>
    /// Git #2201 — the single shared host for the alert stack, owned by AlertCenter's
    /// AlertsChanged event (same "lazily created, self-closing" lifecycle ToastHostWindow uses).
    /// Renders at most 2 <see cref="AlertCard"/>s (the mockup's <c>S.alerts.slice(0, 2)</c>); a 3rd+
    /// live alert collapses into the "N more" pill instead of growing the stack off-screen — the
    /// doc's own "three 150–185px cards do not fit a 541px window" reasoning, and the exact scenario
    /// the "Done when" bar names ("nothing renders off-screen with three alerts queued").
    /// </summary>
    public partial class AlertStackWindow : Window
    {
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

        private static readonly IntPtr HwndTopmost = new IntPtr(-1);
        private const uint SwpNoMove = 0x0002;
        private const uint SwpNoSize = 0x0001;
        private const uint SwpNoActivate = 0x0010;

        private const int MaxVisible = 2;
        private const double RightOffset = 14;
        private const double BottomOffset = 36; // above the 23px status bar, per the mockup's own bottom:36px

        public Action? OnOpenAlertLab;

        public AlertStackWindow()
        {
            InitializeComponent();
            WindowStartupLocation = WindowStartupLocation.Manual;
            SizeChanged += (_, _) => Reposition();
            Loaded += (_, _) => { Reposition(); ForceTopmost(); };
            Deactivated += (_, _) => ForceTopmost();
        }

        public void Render(System.Collections.Generic.IReadOnlyList<Alert> liveAlerts)
        {
            CardStack.Children.Clear();

            var visible = liveAlerts.Count > MaxVisible
                ? new System.Collections.Generic.List<Alert>(liveAlerts).GetRange(0, MaxVisible)
                : liveAlerts;

            foreach (var alert in visible)
            {
                var card = new AlertCard(alert);
                card.Dismissed += (_, _) => AlertCenter.DismissAlert(alert.Id);
                CardStack.Children.Add(card);
            }

            int more = Math.Max(0, liveAlerts.Count - MaxVisible);
            if (more > 0)
            {
                OverflowText.Text = $"{more} more waiting in the bell";
                OverflowPill.Visibility = Visibility.Visible;
            }
            else
            {
                OverflowPill.Visibility = Visibility.Collapsed;
            }

            if (liveAlerts.Count == 0)
            {
                try { Hide(); } catch { }
            }
            else
            {
                if (!IsVisible) { try { Show(); } catch { } }
                Reposition();
                ForceTopmost();
            }
        }

        private void OverflowPill_Click(object sender, System.Windows.Input.MouseButtonEventArgs e) => OnOpenAlertLab?.Invoke();

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
