using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using ShaneBuilder.Services;

namespace ShaneBuilder
{
    /// <summary>
    /// Git #2327 — the pad the pill expands to. Reads live off <see cref="TestPadService"/> so it
    /// never goes stale relative to the badge. Composer/list/import behavior is built out across
    /// #2328-#2354; this shell renders a plain read-only line per note (no select/delete/edit yet)
    /// so an already-filed note is at least visible, and an honest "No notes yet." otherwise.
    /// </summary>
    public partial class TestPadWindow : Window
    {
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

        private static readonly IntPtr HwndTopmost = new IntPtr(-1);
        private const uint SwpNoMove = 0x0002;
        private const uint SwpNoSize = 0x0001;
        private const uint SwpNoActivate = 0x0010;

        private const double RightOffset = 14;
        private const double BottomOffset = 60; // sits just above the pill

        public Action? OnPadClosed;

        public TestPadWindow()
        {
            InitializeComponent();
            WindowStartupLocation = WindowStartupLocation.Manual;
            SizeChanged += (_, _) => Reposition();
            Loaded += (_, _) => { Reposition(); ForceTopmost(); Render(); };
            Deactivated += (_, _) => ForceTopmost();

            TestPadService.NotesChanged += Render;
        }

        private void BtnClose_Click(object sender, MouseButtonEventArgs e)
        {
            Hide();
            OnPadClosed?.Invoke();
        }

        public void Render()
        {
            var notes = TestPadService.Notes;
            NotesHost.Children.Clear();

            EmptyState.Visibility = notes.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            foreach (var note in notes)
            {
                var row = new TextBlock
                {
                    Text = (note.IsSent ? "[SENT] " : "") + note.Text,
                    FontSize = 11,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    Foreground = note.IsSent
                        ? (Brush)FindResource("Brush.Text.Dim")
                        : (Brush)FindResource("Brush.Text.Primary"),
                    Margin = new Thickness(6, 4, 6, 4),
                };
                NotesHost.Children.Add(row);
            }

            Reposition();
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
