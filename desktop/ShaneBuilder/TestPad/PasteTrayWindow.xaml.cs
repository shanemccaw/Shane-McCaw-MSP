using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media.Imaging;
using ShaneBuilder.Services;

namespace ShaneBuilder
{
    /// <summary>
    /// Git #2342 (Feature: Test Pad, #2326) — the modal-free walkthrough #2341 opens once "Send to
    /// Claude" (#2337) fires on a batch that includes notes carrying an attached shot (#2340's
    /// <see cref="TestPadNote.ImagePath"/>). One shot on screen at a time: large preview, that
    /// note's own text underneath it for context, "N of M" in the header, Copy Image (puts the
    /// shot on the clipboard and shows the inline "Copied — paste with Ctrl+V" confirmation), Next
    /// to advance, Done to close early or once the last shot's handled. Reusable/testable on its
    /// own — takes whatever list it's handed rather than reaching into <see cref="TestPadService"/>
    /// itself, so a caller can drive it with any notes that happen to carry a shot.
    /// </summary>
    public partial class PasteTrayWindow : Window
    {
        private readonly List<TestPadNote> _shots;
        private int _index;

        public PasteTrayWindow(IReadOnlyList<TestPadNote> shots)
        {
            InitializeComponent();
            _shots = shots.Where(n => !string.IsNullOrWhiteSpace(n.ImagePath)).ToList();

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
                // real exit at that point (BtnNext is dimmed/disabled there, see RenderCurrent).
                return;
            }

            _index++;
            RenderCurrent();
        }

        /// <summary>Copies the current shot's image to the clipboard so the operator can Ctrl+V it
        /// into whatever chat/window they click into next, and shows the inline confirmation. A
        /// shot whose file has since moved/been deleted fails quietly with a toast rather than
        /// throwing — never take the whole tray down over one missing file.</summary>
        private void BtnCopyImage_Click(object sender, MouseButtonEventArgs e)
        {
            var note = _shots[_index];
            var path = note.ImagePath;
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            {
                ToastEngine.Warning("Paste Tray", "This shot's file is missing — nothing copied.");
                return;
            }

            try
            {
                var bitmap = LoadBitmap(path);
                Clipboard.SetImage(bitmap);
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

            var path = note.ImagePath;
            if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
            {
                try
                {
                    Preview.Source = LoadBitmap(path);
                    Preview.Visibility = Visibility.Visible;
                    PreviewUnavailable.Visibility = Visibility.Collapsed;
                }
                catch
                {
                    Preview.Visibility = Visibility.Collapsed;
                    PreviewUnavailable.Visibility = Visibility.Visible;
                }
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

        /// <summary>OnLoad + Freeze so the file handle closes immediately and the bitmap is safe to
        /// hand to <see cref="Clipboard.SetImage"/> from this thread without holding the source
        /// file open for the rest of the tray's life.</summary>
        private static BitmapImage LoadBitmap(string path)
        {
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.UriSource = new Uri(path, UriKind.Absolute);
            bitmap.EndInit();
            bitmap.Freeze();
            return bitmap;
        }
    }
}
