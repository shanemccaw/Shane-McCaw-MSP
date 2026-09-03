using System;
using System.Windows;
using System.Windows.Input;
using BuildConsole.Services;
using BuildConsole.Services.TestPad;

namespace BuildConsole.TestPad
{
    /// <summary>#2698 — "Test Pad: pop-out/expand view for a single note." The notes list row
    /// (<see cref="TestPadWindow.BuildRow"/>) trims each note's <see cref="TestPadNote.Text"/> to a
    /// single ellipsized line, which can't usefully show a large chunk of content (a wide markdown
    /// table, a long paste). This is a real, minimal, view-only pop-out for exactly one note's full
    /// text — same real custom-chrome window pattern already proven by
    /// <see cref="TestPadImportWindow"/> (#2533): <see cref="WindowChromeHelper.Setup"/> from
    /// OnSourceInitialized, resizable, centered on its owner. Renders via a read-only
    /// <c>TextBox</c> with <c>TextWrapping="NoWrap"</c> + both scrollbars rather than word-wrapping —
    /// a wrapped wide markdown table reads as garbage, whereas NoWrap + horizontal scroll keeps its
    /// column alignment intact and legible. Read/view only, per the issue's own scope note; editing
    /// stays in the existing composer edit-in-place flow on the main pad.</summary>
    public partial class TestPadNoteDetailWindow : Window
    {
        private TestPadNoteDetailWindow()
        {
            InitializeComponent();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        /// <summary>Shows the pop-out modally, owner-scoped to the Test Pad, for one note's full
        /// text. Title/meta line mirror the same type-tag vocabulary
        /// <see cref="TestPadSendFormatter"/> already uses so the pop-out reads consistently with
        /// every other Test Pad surface.</summary>
        public static void ShowFor(Window? owner, TestPadNote note)
        {
            var dlg = new TestPadNoteDetailWindow { Owner = owner };
            if (owner != null) dlg.ShowInTaskbar = false;

            dlg.TitleText.Text = $"[{TypeTag(note.Type)}] Note";
            dlg.MetaText.Text = BuildMetaLine(note);
            dlg.BodyText.Text = note.Text;

            dlg.ShowDialog();
        }

        private static string TypeTag(NoteType type) => type switch
        {
            NoteType.Bug => "BUG",
            NoteType.Question => "QUESTION",
            NoteType.Idea => "IDEA",
            NoteType.Works => "WORKS",
            _ => "NOTE",
        };

        private static string BuildMetaLine(TestPadNote note)
        {
            var parts = new System.Collections.Generic.List<string>();
            if (!string.IsNullOrWhiteSpace(note.Feature)) parts.Add(note.Feature!);
            if (!string.IsNullOrWhiteSpace(note.Screen)) parts.Add(note.Screen!);
            if (note.BuildNumber.HasValue) parts.Add($"Build #{note.BuildNumber.Value}");
            parts.Add(note.CreatedAt.ToLocalTime().ToString("MMM d, h:mm tt"));
            if (note.IsSent) parts.Add("SENT");
            return string.Join(" · ", parts);
        }

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        private void Window_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape) Close();
        }
    }
}
