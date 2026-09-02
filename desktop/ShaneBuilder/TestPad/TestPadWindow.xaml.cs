using System;
using System.Collections.Generic;
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
    /// never goes stale relative to the badge. Composer/select/delete/edit behavior is built out
    /// across #2328-#2354; this shell renders a plain read-only line per note so an already-filed
    /// note is at least visible, and an honest "No notes yet." otherwise. Git #2334 adds the "By
    /// feature" toggle that regroups this list under a header per <see cref="TestPadNote.Feature"/>
    /// stamp instead of the flat newest-first order.
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

        // Git #2334 — "By feature" regroups the list. Off by default (flat, newest-first);
        // toggled on, notes are bucketed under a header per Feature stamp (#2331), features in
        // first-seen order, notes within a feature keeping their existing (newest-first) order.
        private bool _groupByFeature;
        private const string NoFeatureLabel = "No feature";

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

        private void BtnGroupByFeature_Click(object sender, MouseButtonEventArgs e)
        {
            _groupByFeature = !_groupByFeature;
            Render();
        }

        public void Render()
        {
            var notes = TestPadService.Notes;
            NotesHost.Children.Clear();

            EmptyState.Visibility = notes.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            GroupByFeatureLabel.Foreground = _groupByFeature
                ? (Brush)FindResource("Brush.Accent.Primary")
                : (Brush)FindResource("Brush.Text.Muted");
            BtnGroupByFeature.Background = _groupByFeature
                ? (Brush)FindResource("Brush.Bg.Chip")
                : Brushes.Transparent;

            if (_groupByFeature)
            {
                // First-seen order over the already newest-first list, so within each group notes
                // stay newest-first and the groups themselves surface the most recently-touched
                // feature first.
                var groups = new List<(string Feature, List<TestPadNote> Notes)>();
                foreach (var note in notes)
                {
                    var feature = string.IsNullOrWhiteSpace(note.Feature) ? NoFeatureLabel : note.Feature!;
                    var group = groups.Find(g => g.Feature == feature);
                    if (group.Notes == null)
                    {
                        group = (feature, new List<TestPadNote>());
                        groups.Add(group);
                    }
                    group.Notes.Add(note);
                }

                foreach (var (feature, groupNotes) in groups)
                {
                    var header = new TextBlock
                    {
                        Text = feature,
                        FontSize = 10,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = (Brush)FindResource("Brush.Text.Muted"),
                        Margin = new Thickness(6, 8, 6, 2),
                    };
                    NotesHost.Children.Add(header);

                    foreach (var note in groupNotes)
                        NotesHost.Children.Add(BuildNoteRow(note));
                }
            }
            else
            {
                foreach (var note in notes)
                    NotesHost.Children.Add(BuildNoteRow(note));
            }

            Reposition();
        }

        private TextBlock BuildNoteRow(TestPadNote note) => new()
        {
            Text = (note.IsSent ? "[SENT] " : "") + note.Text,
            FontSize = 11,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Foreground = note.IsSent
                ? (Brush)FindResource("Brush.Text.Dim")
                : (Brush)FindResource("Brush.Text.Primary"),
            Margin = new Thickness(6, 4, 6, 4),
        };

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
