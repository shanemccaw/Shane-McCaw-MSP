using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Input;
using ShaneBuilder.Services;

namespace ShaneBuilder
{
    /// <summary>
    /// Git #2342 (Feature: Test Pad, #2326) — the walkthrough #2341 opens once "Send to Claude"
    /// (#2337) fires on a batch that includes notes carrying a real attached shot (#2340's
    /// <see cref="TestPadNote.ShotImage"/>). One shot on screen at a time: large preview, that
    /// note's own text underneath it for context, "N of M" in the header, Copy Image (puts the
    /// shot on the clipboard and shows the inline "Copied — paste with Ctrl+V" confirmation), Next
    /// to advance, Done to close early or once the last shot's handled. Reusable/testable on its
    /// own — takes whatever list it's handed rather than reaching into <see cref="TestPadService"/>
    /// itself, so a caller can drive it with any notes that happen to carry a shot. Non-modal and
    /// Topmost (Show, not ShowDialog) — the whole point is the operator alt-tabbing or clicking
    /// into the chat window mid-flow to paste, then coming back for the next shot.
    /// </summary>
    public partial class PasteTrayWindow : Window
    {
        private readonly List<TestPadNote> _shots;
        private int _index;

        public PasteTrayWindow(IReadOnlyList<TestPadNote> shots)
        {
            InitializeComponent();
            _shots = shots.Where(n => n.ShotImage != null).ToList();

            if (_shots.Count == 0)
            {
                // Nothing to walk through — the caller should have checked before constructing
                // this, but never show an empty tray if it slips through.
                Loaded += (_, _) => Close();
                return;
            }

            Loaded += (_, _) => RenderCurrent();
        }

        private void BtnClose_Click(object sender, MouseButtonEventArgs e) => Close();
        private void BtnDone_Click(object sender, MouseButtonEventArgs e) => Close();

        private void BtnNext_Click(object sender, MouseButtonEventArgs e)
        {
            if (_index >= _shots.Count - 1)
            {
                // Already on the last shot — Next has nothing left to advance to; Done is the
                // real exit at that point (BtnNext is dimmed there, see RenderCurrent).
                return;
            }

            _index++;
            RenderCurrent();
        }

        /// <summary>Copies the current shot's image to the clipboard so the operator can Ctrl+V it
        /// into whatever chat/window they click into next, and shows the inline confirmation.
        /// Never throws back into the caller — a clipboard failure gets a toast, not a crash.</summary>
        private void BtnCopyImage_Click(object sender, MouseButtonEventArgs e)
        {
            var image = _shots[_index].ShotImage;
            if (image == null)
            {
                ToastEngine.Warning("Paste Tray", "This shot is missing — nothing copied.");
                return;
            }

            try
            {
                Clipboard.SetImage(image);
                CopiedConfirmation.Visibility = Visibility.Visible;
            }
            catch (Exception ex)
            {
                ToastEngine.Warning("Paste Tray", $"Couldn't copy this shot — {ex.Message}");
            }
        }

        private void RenderCurrent()
        {
            var note = _shots[_index];

            CounterLabel.Text = $"{_index + 1} of {_shots.Count}";
            NoteText.Text = note.Text;
            CopiedConfirmation.Visibility = Visibility.Collapsed;

            if (note.ShotImage != null)
            {
                Preview.Source = note.ShotImage;
                Preview.Visibility = Visibility.Visible;
                PreviewUnavailable.Visibility = Visibility.Collapsed;
            }
            else
            {
                Preview.Visibility = Visibility.Collapsed;
                PreviewUnavailable.Visibility = Visibility.Visible;
            }

            var isLast = _index == _shots.Count - 1;
            BtnNext.Opacity = isLast ? 0.5 : 1.0;
            BtnNext.Cursor = isLast ? Cursors.Arrow : Cursors.Hand;
            DoneLabel.Foreground = isLast
                ? (System.Windows.Media.Brush)FindResource("Brush.Accent.Primary")
                : (System.Windows.Media.Brush)FindResource("Brush.Text.Muted");
        }
    }
}
