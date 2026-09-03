using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using BuildConsole.Services.TestPad;

namespace BuildConsole.TestPad
{
    /// <summary>
    /// Ported from ShaneBuilder (Git #2531/#2532, Feature: Test Pad #2530; originally Git #2327
    /// and its follow-ons, ShaneBuilder Feature: Test Pad #2326) — the pad the pill expands to.
    /// Reads live off <see cref="TestPadService"/> so it never goes stale relative to the badge. A
    /// minimal composer files a new note on Enter, type chips insert a marker into it, and clicking
    /// a note's text loads it back into the composer for in-place editing — Enter there saves the
    /// edit (marking <see cref="TestPadNote.IsEdited"/> so the row shows an EDITED tag) and Esc
    /// cancels back to an empty box, leaving the note untouched. The "By feature" toggle regroups
    /// the list under a header per <see cref="TestPadNote.Feature"/> stamp instead of the flat
    /// newest-first order. Every note row carries a select checkbox, a delete button wired to
    /// <see cref="TestPadService.RemoveNote"/>, and a "SENT" badge that locks the row's visual
    /// treatment — and its clickability for edit — once the note has gone out. An honest
    /// "No notes yet." otherwise.
    ///
    /// "Send to Claude" formats the selected (or, with nothing checked, every unsent) note via
    /// <see cref="TestPadSendFormatter"/> and puts it on the clipboard — ShaneBuilder's original
    /// dropped the block straight into the open chat's composer via a live
    /// AlertActions.AppendToComposer bridge, but that bridge (and the ClaudeActivityService busy/
    /// free status it also read) was never ported into BuildConsole, so this is the honest real
    /// action available with what's actually here rather than a fabricated direct-injection.
    /// "Copy as markdown" acts only on whatever is checked (any mix of sent/unsent) and is hidden
    /// entirely when nothing is checked, unlike "Send to Claude" which falls back to every unsent
    /// note. "Import" (#2533) opens the real <see cref="TestPadImportWindow"/> modal — paste a whole
    /// Notepad file, Parse, correct/merge the preview, Import files every checked candidate as a
    /// real note. "Attach shot"/Paste Tray from the ShaneBuilder source is intentionally not carried
    /// over here — no PasteTrayWindow port exists — so that button alone is still absent from this
    /// pad.
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

        // "By feature" regroups the list. Off by default (flat, newest-first); toggled on, notes
        // are bucketed under a header per Feature stamp, features in first-seen order, notes
        // within a feature keeping their existing (newest-first) order.
        private bool _groupByFeature;
        private const string NoFeatureLabel = "No feature";

        /// <summary>Non-null while a click on a note body has loaded it into the composer for
        /// editing; null when the composer's next Enter files a brand-new note instead.</summary>
        private string? _editingNoteId;

        public TestPadWindow()
        {
            InitializeComponent();
            WindowStartupLocation = WindowStartupLocation.Manual;
            SizeChanged += (_, _) => Reposition();
            Loaded += (_, _) => { Reposition(); ForceTopmost(); Render(); };
            Deactivated += (_, _) => ForceTopmost();

            TypeChips.TargetTextBox = ComposerBox;

            TestPadService.NotesChanged += Render;
            Closed += (_, _) => TestPadService.NotesChanged -= Render;
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

        /// <summary>"Import" (#2533) — opens the real <see cref="TestPadImportWindow"/> modal,
        /// owner-scoped to this pad. The dialog files its own notes straight into
        /// <see cref="TestPadService"/> on Import, so the pad's list/pill badge pick them up via
        /// the existing <see cref="TestPadService.NotesChanged"/> subscription with no extra
        /// wiring needed here.</summary>
        private void BtnImport_Click(object sender, MouseButtonEventArgs e)
        {
            TestPadImportWindow.ShowFor(this);
        }

        private void ComposerBox_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                e.Handled = true;
                SaveComposer();
            }
            else if (e.Key == Key.Escape)
            {
                e.Handled = true;
                CancelEdit();
            }
        }

        /// <summary>Enter in the composer. Files a new note unless a note is currently loaded for
        /// editing, in which case it saves the edit onto that same note instead of creating a
        /// duplicate.</summary>
        private void SaveComposer()
        {
            var (type, text) = NoteMarkerParser.Parse(ComposerBox.Text);
            text = text.Trim();
            if (text.Length == 0)
            {
                return;
            }

            if (_editingNoteId != null)
            {
                TestPadService.UpdateNote(_editingNoteId, text, type);
            }
            else
            {
                var note = new TestPadNote { Text = text, Type = type };
                TestPadService.AddNote(note);
            }

            CancelEdit();
        }

        /// <summary>Esc — or a completed save. Clears the composer and drops out of edit mode
        /// without touching whatever note was loaded.</summary>
        private void CancelEdit()
        {
            _editingNoteId = null;
            EditingBanner.Visibility = Visibility.Collapsed;
            ComposerBox.Text = "";
        }

        /// <summary>Click a note body to load it back into the composer, marker restored, ready to
        /// re-save on Enter. A sent note is locked so it's not clickable at all.</summary>
        private void LoadNoteIntoComposer(TestPadNote note)
        {
            var marker = NoteMarkerParser.MarkerFor(note.Type);
            ComposerBox.Text = marker == null ? note.Text : $"{marker} {note.Text}";
            ComposerBox.CaretIndex = ComposerBox.Text.Length;
            ComposerBox.Focus();

            _editingNoteId = note.Id;
            EditingBanner.Visibility = Visibility.Visible;
        }

        /// <summary>"Send to Claude" — formats the checked-selected unsent notes if any are
        /// checked, otherwise every unsent note, so the button always has an obvious "send
        /// everything waiting" default, and copies the block to the clipboard (see the class doc
        /// for why this is clipboard rather than a direct composer-append). Sent notes flip to
        /// <see cref="TestPadNote.IsSent"/> (the SENT badge/lock renders) and clear their
        /// selection.</summary>
        private void BtnSendToClaude_Click(object sender, MouseButtonEventArgs e)
        {
            var all = TestPadService.Notes;
            var selectedUnsent = all.Where(n => n.IsSelected && !n.IsSent).ToList();
            var target = selectedUnsent.Count > 0 ? selectedUnsent : all.Where(n => !n.IsSent).ToList();

            if (target.Count == 0)
            {
                ToastEngine.Warning("Test Pad", "Nothing to send — every note is already SENT.");
                return;
            }

            var block = TestPadSendFormatter.Format(target);
            try
            {
                Clipboard.SetText(block);
            }
            catch
            {
                ToastEngine.Warning("Test Pad", "Couldn't reach the clipboard — try again.");
                return;
            }

            TestPadService.MarkSent(target.Select(n => n.Id));

            var count = target.Count;
            ToastEngine.Success("Test Pad", $"Copied {count} {(count == 1 ? "note" : "notes")} — paste into Claude's composer.");
        }

        /// <summary>"Copy as markdown" for the selection, distinct from "Send to Claude": it never
        /// falls back to "every unsent note" — it acts strictly on whatever is checked, sent or
        /// not, and does nothing (with a nudge toast) if nothing is checked at all, which shouldn't
        /// be reachable since the button is hidden in that state.</summary>
        private void BtnCopyMarkdown_Click(object sender, MouseButtonEventArgs e)
        {
            var selected = TestPadService.Notes.Where(n => n.IsSelected).ToList();
            if (selected.Count == 0)
            {
                ToastEngine.Warning("Test Pad", "Check a note first to copy it as markdown.");
                return;
            }

            var block = TestPadSendFormatter.Format(selected);
            try
            {
                Clipboard.SetText(block);
            }
            catch
            {
                ToastEngine.Warning("Test Pad", "Couldn't reach the clipboard — try again.");
                return;
            }

            var count = selected.Count;
            ToastEngine.Success("Test Pad", $"Copied {count} {(count == 1 ? "note" : "notes")} as markdown.");
        }

        public void Render()
        {
            var notes = TestPadService.Notes;
            NotesHost.Children.Clear();

            RenderStatusBand();
            RenderSendToClaudeButton(notes);
            RenderCopyMarkdownButton(notes);

            EmptyState.Visibility = notes.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            GroupByFeatureLabel.Foreground = _groupByFeature
                ? (Brush)FindResource("BlueBrush")
                : (Brush)FindResource("TextSecondaryBrush");
            BtnGroupByFeature.Background = _groupByFeature
                ? (Brush)FindResource("Surface0Brush")
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
                        Foreground = (Brush)FindResource("TextSecondaryBrush"),
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

        /// <summary>One note row: select checkbox, text (with an EDITED tag once the note's been
        /// re-saved, and clickable to load it back into the composer for editing unless it's
        /// locked by the "SENT" badge), and a delete button that removes the note straight from the
        /// shared store so the pill's unsent-count badge and any other subscriber stay in
        /// sync.</summary>
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

            var textLine = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 4, 6, 4),
                Cursor = note.IsSent ? Cursors.Arrow : Cursors.Hand,
                // The click-to-edit lock has no affordance explaining WHY a sent row doesn't
                // respond to a click; an unsent row needs none since the pointer cursor already
                // implies it.
                ToolTip = note.IsSent ? "Sent — locked from editing" : null,
            };
            textLine.Children.Add(new TextBlock
            {
                Text = note.Text,
                FontSize = 11,
                TextTrimming = TextTrimming.CharacterEllipsis,
                Foreground = note.IsSent
                    ? (Brush)FindResource("TextDisabledBrush")
                    : (Brush)FindResource("TextPrimaryBrush"),
            });
            if (note.IsEdited)
            {
                textLine.Children.Add(new TextBlock
                {
                    Text = "EDITED",
                    FontSize = 9,
                    FontWeight = FontWeights.SemiBold,
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)FindResource("TextSecondaryBrush"),
                });
            }
            if (!note.IsSent)
            {
                // Click the note body to load it back into the composer for editing. A sent note
                // is locked, so it's not wired up at all.
                textLine.MouseLeftButtonUp += (_, _) => LoadNoteIntoComposer(note);
            }
            Grid.SetColumn(textLine, 1);
            grid.Children.Add(textLine);

            if (note.IsSent)
            {
                var badge = new Border
                {
                    CornerRadius = new CornerRadius(4),
                    Background = (Brush)FindResource("Surface0Brush"),
                    Padding = new Thickness(5, 1, 5, 1),
                    Margin = new Thickness(0, 0, 6, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                };
                badge.Child = new TextBlock
                {
                    Text = "SENT",
                    FontSize = 9,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("GreenBrush"),
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
                Text = "",
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 9,
                Foreground = (Brush)FindResource("TextSecondaryBrush"),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };
            delete.MouseEnter += (_, _) => delete.Background = (Brush)FindResource("Surface0Brush");
            delete.MouseLeave += (_, _) => delete.Background = Brushes.Transparent;
            delete.MouseLeftButtonUp += (_, _) => TestPadService.RemoveNote(note.Id);
            Grid.SetColumn(delete, 3);
            grid.Children.Add(delete);

            root.Child = grid;
            return root;
        }

        // The status band. Reports the honest unsent count — see the class doc for why this
        // doesn't split "Claude is working" vs "Claude is free" the way ShaneBuilder's original did.
        private void RenderStatusBand()
        {
            int unsent = TestPadService.UnsentCount;
            StatusBandText.Text = unsent == 0 ? "Nothing waiting" : $"{unsent} waiting to send";
        }

        /// <summary>Labels the button with exactly what a click will send: the selected-unsent
        /// count if anything is checked, otherwise the total unsent count (the same target
        /// <see cref="BtnSendToClaude_Click"/> resolves). Dims and disables the hand cursor when
        /// there's genuinely nothing unsent to send.</summary>
        private void RenderSendToClaudeButton(IReadOnlyList<TestPadNote> notes)
        {
            var selectedUnsent = notes.Count(n => n.IsSelected && !n.IsSent);
            var totalUnsent = notes.Count(n => !n.IsSent);
            var target = selectedUnsent > 0 ? selectedUnsent : totalUnsent;

            SendToClaudeLabel.Text = target == 0 ? "Send to Claude" : $"Send to Claude ({target})";
            BtnSendToClaude.Opacity = target == 0 ? 0.5 : 1.0;
            BtnSendToClaude.Cursor = target == 0 ? Cursors.Arrow : Cursors.Hand;
        }

        /// <summary>The header's "Copy as markdown" action only exists while there's a selection to
        /// act on; it's collapsed entirely rather than shown disabled, and labels itself with the
        /// real count so it's obvious exactly what a click copies.</summary>
        private void RenderCopyMarkdownButton(IReadOnlyList<TestPadNote> notes)
        {
            var selected = notes.Count(n => n.IsSelected);
            BtnCopyMarkdown.Visibility = selected == 0 ? Visibility.Collapsed : Visibility.Visible;
            CopyMarkdownLabel.Text = $"Copy as markdown ({selected})";
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
            catch { /* best-effort */ }
        }
    }
}
