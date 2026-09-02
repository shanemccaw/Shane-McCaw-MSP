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
    /// never goes stale relative to the badge. Composer/edit/import behavior is built out across
    /// #2328, #2330-#2332, #2335-#2354. Git #2334 adds the "By feature" toggle that regroups this
    /// list under a header per <see cref="TestPadNote.Feature"/> stamp instead of the flat
    /// newest-first order. Git #2333 adds the real per-note row: a select checkbox, a delete
    /// button wired to <see cref="TestPadService.RemoveNote"/>, and a "SENT" badge that locks the
    /// row's visual treatment once the note has gone out — an honest "No notes yet." otherwise.
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
            ClaudeActivityService.Changed += Render;
            Closed += (_, _) =>
            {
                TestPadService.NotesChanged -= Render;
                ClaudeActivityService.Changed -= Render;
            };
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

            RenderStatusBand();

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
                        NotesHost.Children.Add(BuildRow(note));
                }
            }
            else
            {
                foreach (var note in notes)
                    NotesHost.Children.Add(BuildRow(note));
            }

            Reposition();
        }

        /// <summary>Git #2333 — one note row: select checkbox, text, a "SENT" badge once the note
        /// has gone out, and a delete button that removes the note straight from the shared store
        /// so the pill's unsent-count badge (#2327) and any other subscriber stay in sync.</summary>
        private UIElement BuildRow(TestPadNote note)
        {
            var root = new Border
            {
                CornerRadius = new CornerRadius(6),
                Margin = new Thickness(0, 0, 0, 2),
                Padding = new Thickness(4, 2, 4, 2),
                Background = Brushes.Transparent,
            };

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var select = new CheckBox
            {
                IsChecked = note.IsSelected,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 6, 0),
            };
            select.Checked += (_, _) => { note.IsSelected = true; TestPadService.NotifyMutated(); };
            select.Unchecked += (_, _) => { note.IsSelected = false; TestPadService.NotifyMutated(); };
            Grid.SetColumn(select, 0);
            grid.Children.Add(select);

            var text = new TextBlock
            {
                Text = note.Text,
                FontSize = 11,
                TextTrimming = TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = note.IsSent
                    ? (Brush)FindResource("Brush.Text.Dim")
                    : (Brush)FindResource("Brush.Text.Primary"),
                Margin = new Thickness(0, 4, 6, 4),
            };
            Grid.SetColumn(text, 1);
            grid.Children.Add(text);

            if (note.IsSent)
            {
                var badge = new Border
                {
                    CornerRadius = new CornerRadius(4),
                    Background = (Brush)FindResource("Brush.Bg.Chip"),
                    Padding = new Thickness(5, 1, 5, 1),
                    Margin = new Thickness(0, 0, 6, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                };
                badge.Child = new TextBlock
                {
                    Text = "SENT",
                    FontSize = 9,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("Brush.Alert.Success"),
                };
                Grid.SetColumn(badge, 2);
                grid.Children.Add(badge);
            }

            var delete = new Border
            {
                Width = 18,
                Height = 18,
                CornerRadius = new CornerRadius(4),
                Background = Brushes.Transparent,
                Cursor = Cursors.Hand,
                VerticalAlignment = VerticalAlignment.Center,
                ToolTip = "Delete note",
            };
            delete.Child = new TextBlock
            {
                Text = "\uE74D",
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 9,
                Foreground = (Brush)FindResource("Brush.Text.Muted"),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };
            delete.MouseEnter += (_, _) => delete.Background = (Brush)FindResource("Brush.Bg.Chip");
            delete.MouseLeave += (_, _) => delete.Background = Brushes.Transparent;
            delete.MouseLeftButtonUp += (_, _) => TestPadService.RemoveNote(note.Id);
            Grid.SetColumn(delete, 3);
            grid.Children.Add(delete);

            root.Child = grid;
            return root;
        }

        // Git #2332 — the three-state status band. "Nothing waiting" whenever the queue is
        // genuinely empty takes priority over the working/free split, since there's nothing to
        // send either way once N is 0.
        private void RenderStatusBand()
        {
            int unsent = TestPadService.UnsentCount;
            if (unsent == 0)
            {
                StatusBandText.Text = "Nothing waiting";
            }
            else if (ClaudeActivityService.IsWorking)
            {
                StatusBandText.Text = $"Claude is working — {unsent} waiting";
            }
            else
            {
                StatusBandText.Text = $"Claude is free — send {unsent}";
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
