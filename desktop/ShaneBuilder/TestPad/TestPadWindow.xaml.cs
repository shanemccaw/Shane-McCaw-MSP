using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using ShaneBuilder.Services;
using ShaneBuilder.Services.TestPad;

namespace ShaneBuilder
{
    /// <summary>
    /// Git #2327 — the pad the pill expands to. Reads live off <see cref="TestPadService"/> so it
    /// never goes stale relative to the badge. A minimal Composer (#2328) files a new note on
    /// Enter, Type Chips (#2330) insert a marker into it, and clicking a note's text (#2335) loads
    /// it back into the composer for in-place editing — Enter there saves the edit (marking
    /// <see cref="TestPadNote.IsEdited"/> so the row shows an EDITED tag) and Esc cancels back to
    /// an empty box, leaving the note untouched. Git #2334 adds the "By feature" toggle that
    /// regroups the list under a header per <see cref="TestPadNote.Feature"/> stamp instead of the
    /// flat newest-first order. Git #2333 adds the real per-note row: a select checkbox, a delete
    /// button wired to <see cref="TestPadService.RemoveNote"/>, and a "SENT" badge that locks the
    /// row's visual treatment — and its clickability for edit (#2335/#2336) — once the note has
    /// gone out. An honest "No notes yet." otherwise. Git #2337 adds the real "Send to Claude"
    /// action: formats the selected (or, with nothing checked, every unsent) note into one block
    /// via <see cref="TestPadSendFormatter"/> and drops it into the currently active chat tab's
    /// composer through <see cref="AlertActions.AppendToComposer"/>. Git #2339 adds "Copy as
    /// markdown" — unlike Send to Claude it never falls back to "every unsent note"; it acts only
    /// on whatever is checked (<see cref="TestPadNote.IsSelected"/>, any mix of sent/unsent) and is
    /// hidden entirely when nothing is checked.
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

        /// <summary>Non-null while a click on a note body (#2335) has loaded it into the composer
        /// for editing; null when the composer's next Enter files a brand-new note instead.</summary>
        private string? _editingNoteId;

        // Git #2340 — true while "Attach shot" is armed. Consumed (and reset) the moment the next
        // brand-new note is filed; toggling the chip again before then disarms it without filing
        // anything.
        private bool _shotArmed;

        public TestPadWindow()
        {
            InitializeComponent();
            WindowStartupLocation = WindowStartupLocation.Manual;
            SizeChanged += (_, _) => Reposition();
            Loaded += (_, _) => { Reposition(); ForceTopmost(); Render(); RenderShotChip(); };
            Deactivated += (_, _) => ForceTopmost();

            TypeChips.TargetTextBox = ComposerBox;

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

        /// <summary>Git #2340 — toggles the arm. Doesn't touch any existing note; it only decides
        /// whether the NEXT brand-new note filed gets a shot slot.</summary>
        private void AttachShotChip_Click(object sender, MouseButtonEventArgs e)
        {
            _shotArmed = !_shotArmed;
            RenderShotChip();
        }

        private void RenderShotChip()
        {
            var brush = _shotArmed
                ? (Brush)FindResource("Brush.Accent.Primary")
                : (Brush)FindResource("Brush.Text.Muted");
            AttachShotIcon.Foreground = brush;
            AttachShotLabel.Foreground = brush;
            AttachShotLabel.Text = _shotArmed ? " Attach shot — armed" : " Attach shot";
            AttachShotChip.BorderBrush = _shotArmed ? brush : (Brush)FindResource("Brush.Border.Default");
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

        /// <summary>Enter in the composer. Files a new note (#2328) unless a note is currently
        /// loaded for editing (#2335), in which case it saves the edit onto that same note instead
        /// of creating a duplicate.</summary>
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
                if (_shotArmed)
                {
                    // Git #2340 — the arm is consumed by THIS note, not carried forward.
                    note.HasShotSlot = true;
                    _shotArmed = false;
                    RenderShotChip();
                }
                TestPadService.AddNote(note);
            }

            CancelEdit();
        }

        /// <summary>Esc — or a completed save. Clears the composer and drops out of edit mode
        /// without touching whatever note was loaded, per #2335's "Esc cancels."</summary>
        private void CancelEdit()
        {
            _editingNoteId = null;
            EditingBanner.Visibility = Visibility.Collapsed;
            ComposerBox.Text = "";
        }

        /// <summary>#2335 — click a note body to load it back into the composer, marker restored,
        /// ready to re-save on Enter. A sent note is locked (#2336) so it's not clickable at all.</summary>
        private void LoadNoteIntoComposer(TestPadNote note)
        {
            var marker = NoteMarkerParser.MarkerFor(note.Type);
            ComposerBox.Text = marker == null ? note.Text : $"{marker} {note.Text}";
            ComposerBox.CaretIndex = ComposerBox.Text.Length;
            ComposerBox.Focus();

            _editingNoteId = note.Id;
            EditingBanner.Visibility = Visibility.Visible;
        }

        /// <summary>Git #2337 — "Send to Claude" drops a formatted block with every stamp into the
        /// open chat's composer. Targets the checked-selected unsent notes if any are checked;
        /// otherwise every unsent note, so the button always has an obvious "send everything
        /// waiting" default. Reuses the same static <see cref="AlertActions.AppendToComposer"/>
        /// bridge MainWindow already wires to the currently active chat tab's composer for the
        /// Alert Lab reply path — no new bridge needed. Sent notes flip to
        /// <see cref="TestPadNote.IsSent"/> (the SENT badge/lock #2333 already renders) and clear
        /// their selection.</summary>
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

            if (AlertActions.AppendToComposer == null)
            {
                ToastEngine.Warning("Test Pad", "No open chat to send to — couldn't reach the composer.");
                return;
            }

            var block = TestPadSendFormatter.Format(target);
            AlertActions.AppendToComposer.Invoke(block);
            TestPadService.MarkSent(target.Select(n => n.Id));

            var count = target.Count;
            ToastEngine.Success("Test Pad", $"Sent {count} {(count == 1 ? "note" : "notes")} into the composer — review, then Send.");

            // Git #2341 — sending a batch that includes notes carrying an attached shot (#2340)
            // opens the Paste Tray (#2342) right after: the text already landed in the composer
            // above, but the clipboard can only hold one image at a time, so shots need a manual
            // walkthrough rather than riding along in that same block. HasShotSlot alone isn't
            // enough — the operator can leave a slot armed and never actually drop an image onto
            // it (#2340's drop is optional), so only a note whose ShotImage is real gets walked.
            var shots = target.Where(n => n.ShotImage != null).ToList();
            if (shots.Count > 0)
            {
                new PasteTrayWindow(shots) { Owner = this }.Show();
            }
        }

        /// <summary>Git #2339 — "Copy as markdown" for the selection, distinct from "Send to
        /// Claude": it never falls back to "every unsent note" — it acts strictly on whatever is
        /// checked, sent or not, and does nothing (with a nudge toast) if nothing is checked at
        /// all, which shouldn't be reachable since the button is hidden in that state.</summary>
        private void BtnCopyMarkdown_Click(object sender, MouseButtonEventArgs e)
        {
            var selected = TestPadService.Notes.Where(n => n.IsSelected).ToList();
            if (selected.Count == 0)
            {
                ToastEngine.Warning("Test Pad", "Check a note first to copy it as markdown.");
                return;
            }

            var block = TestPadSendFormatter.Format(selected);
            Clipboard.SetText(block);

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

        /// <summary>Git #2333 — one note row: select checkbox, text (with an EDITED tag from #2335
        /// once the note's been re-saved, and clickable to load it back into the composer for
        /// editing unless it's locked by #2336's "SENT" badge), and a delete button that removes
        /// the note straight from the shared store so the pill's unsent-count badge (#2327) and
        /// any other subscriber stay in sync.</summary>
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
            };
            textLine.Children.Add(new TextBlock
            {
                Text = note.Text,
                FontSize = 11,
                TextTrimming = TextTrimming.CharacterEllipsis,
                Foreground = note.IsSent
                    ? (Brush)FindResource("Brush.Text.Dim")
                    : (Brush)FindResource("Brush.Text.Primary"),
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
                    Foreground = (Brush)FindResource("Brush.Text.Muted"),
                });
            }
            if (!note.IsSent)
            {
                // Git #2335 — click the note body to load it back into the composer for editing.
                // A sent note is locked (#2336), so it's not wired up at all.
                textLine.MouseLeftButtonUp += (_, _) => LoadNoteIntoComposer(note);
            }
            Grid.SetColumn(textLine, 1);
            grid.Children.Add(textLine);

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

            if (!note.HasShotSlot)
            {
                root.Child = grid;
                return root;
            }

            // Git #2340 — this note was filed with "Attach shot" armed, so it carries a droppable
            // thumbnail slot underneath its text regardless of whether a shot has landed on it yet.
            var stack = new StackPanel();
            stack.Children.Add(grid);
            stack.Children.Add(BuildShotThumb(note));
            root.Child = stack;
            return root;
        }

        /// <summary>Git #2340 — the droppable thumbnail slot for a note filed with "Attach shot"
        /// armed. Empty (a camera glyph placeholder) until an image is dropped onto it; a real drop
        /// paints the actual image and locks in as the note's attached shot. Sending notes with
        /// shots (#2341) and the Paste Tray (#2342) are separate, not-yet-built issues — this only
        /// covers the drop-target half.</summary>
        private UIElement BuildShotThumb(TestPadNote note)
        {
            var thumb = new Border
            {
                Width = 44,
                Height = 44,
                Margin = new Thickness(24, 0, 0, 6),
                CornerRadius = new CornerRadius(6),
                Background = (Brush)FindResource("Brush.Bg.Chip"),
                BorderBrush = (Brush)FindResource("Brush.Border.Default"),
                BorderThickness = new Thickness(1),
                AllowDrop = true,
                ToolTip = note.ShotImage == null
                    ? "Drop an image here to attach a shot"
                    : "Attached shot",
            };

            thumb.Child = note.ShotImage != null
                ? new Image { Source = note.ShotImage, Stretch = Stretch.UniformToFill }
                : new TextBlock
                {
                    Text = "",
                    FontFamily = new FontFamily("Segoe MDL2 Assets"),
                    FontSize = 14,
                    Foreground = (Brush)FindResource("Brush.Text.Dim"),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                };

            thumb.DragEnter += (_, e) => SetDropEffect(e);
            thumb.DragOver += (_, e) => SetDropEffect(e);
            thumb.Drop += (_, e) =>
            {
                var image = ExtractDroppedImage(e.Data);
                if (image == null)
                {
                    return;
                }
                note.ShotImage = image;
                TestPadService.NotifyMutated();
            };

            return thumb;
        }

        private static void SetDropEffect(DragEventArgs e)
        {
            e.Effects = HasImageData(e.Data) ? DragDropEffects.Copy : DragDropEffects.None;
            e.Handled = true;
        }

        private static bool HasImageData(IDataObject data)
        {
            if (data.GetDataPresent(DataFormats.Bitmap))
            {
                return true;
            }
            if (!data.GetDataPresent(DataFormats.FileDrop))
            {
                return false;
            }
            return data.GetData(DataFormats.FileDrop) is string[] paths && paths.Any(IsImageFile);
        }

        private static bool IsImageFile(string path)
        {
            var ext = Path.GetExtension(path).ToLowerInvariant();
            return ext is ".png" or ".jpg" or ".jpeg" or ".gif" or ".bmp";
        }

        /// <summary>Reads whatever image the OS drop actually carried — a dropped file (Explorer,
        /// most browsers) or a raw bitmap (dragged straight off some apps' canvases) — into a
        /// frozen, cross-thread-safe <see cref="BitmapSource"/>. Never throws back into the Drop
        /// handler; a bad/partial drop just leaves the slot empty.</summary>
        private static BitmapSource? ExtractDroppedImage(IDataObject data)
        {
            try
            {
                if (data.GetDataPresent(DataFormats.FileDrop) &&
                    data.GetData(DataFormats.FileDrop) is string[] paths)
                {
                    var path = paths.FirstOrDefault(IsImageFile);
                    if (path != null)
                    {
                        var bitmap = new BitmapImage();
                        bitmap.BeginInit();
                        bitmap.CacheOption = BitmapCacheOption.OnLoad;
                        bitmap.UriSource = new Uri(path);
                        bitmap.EndInit();
                        bitmap.Freeze();
                        return bitmap;
                    }
                }

                if (data.GetDataPresent(DataFormats.Bitmap) &&
                    data.GetData(DataFormats.Bitmap, true) is BitmapSource bitmapSource)
                {
                    if (bitmapSource.CanFreeze)
                    {
                        bitmapSource.Freeze();
                    }
                    return bitmapSource;
                }
            }
            catch
            {
                // a malformed/partial drop must never crash the pad
            }
            return null;
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

        /// <summary>Git #2337 — labels the button with exactly what a click will send: the
        /// selected-unsent count if anything is checked, otherwise the total unsent count (the
        /// same target <see cref="BtnSendToClaude_Click"/> resolves). Dims and disables the hand
        /// cursor when there's genuinely nothing unsent to send.</summary>
        private void RenderSendToClaudeButton(IReadOnlyList<TestPadNote> notes)
        {
            var selectedUnsent = notes.Count(n => n.IsSelected && !n.IsSent);
            var totalUnsent = notes.Count(n => !n.IsSent);
            var target = selectedUnsent > 0 ? selectedUnsent : totalUnsent;

            SendToClaudeLabel.Text = target == 0 ? "Send to Claude" : $"Send to Claude ({target})";
            BtnSendToClaude.Opacity = target == 0 ? 0.5 : 1.0;
            BtnSendToClaude.Cursor = target == 0 ? Cursors.Arrow : Cursors.Hand;
        }

        /// <summary>Git #2339 — the header's "Copy as markdown" action only exists while there's a
        /// selection to act on; it's collapsed entirely rather than shown disabled, and labels
        /// itself with the real count so it's obvious exactly what a click copies.</summary>
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
            catch { }
        }
    }
}
