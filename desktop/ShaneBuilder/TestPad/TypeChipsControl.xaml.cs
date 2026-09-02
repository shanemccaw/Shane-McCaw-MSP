using System;
using System.Windows.Controls;
using System.Windows.Input;
using ShaneBuilder.Services.TestPad;

namespace ShaneBuilder
{
    /// <summary>
    /// Git #2330 (Feature: Test Pad, #2326) — "Type chips insert the marker for you." Four chips,
    /// one per <see cref="NoteType"/> that carries a marker (<see cref="NoteType.Note"/> itself has
    /// none — see <see cref="NoteMarkerParser.MarkerFor"/>). Wire a composer's <see cref="TextBox"/>
    /// in via <see cref="TargetTextBox"/> and a chip click inserts that type's marker at the head of
    /// the box's text, replacing any marker already leading it — the exact same rule #2329's
    /// <see cref="NoteMarkerParser"/> parses back out when a note is filed, so a chip and hand-typed
    /// marker always agree. <see cref="ChipClicked"/> fires regardless, for a caller that wants to
    /// react to the type choice without wiring a TextBox directly (e.g. the Notepad importer's
    /// per-row type-correction chips, #2351, which don't have one composer box to aim at).
    /// </summary>
    public partial class TypeChipsControl : UserControl
    {
        public event Action<NoteType>? ChipClicked;

        /// <summary>The composer TextBox this control edits directly. Optional — leave it null and
        /// handle <see cref="ChipClicked"/> instead if there's no single box to insert into.</summary>
        public TextBox? TargetTextBox { get; set; }

        public TypeChipsControl()
        {
            InitializeComponent();
        }

        private void ChipBug_Click(object sender, MouseButtonEventArgs e) => Select(NoteType.Bug);
        private void ChipQuestion_Click(object sender, MouseButtonEventArgs e) => Select(NoteType.Question);
        private void ChipIdea_Click(object sender, MouseButtonEventArgs e) => Select(NoteType.Idea);
        private void ChipWorks_Click(object sender, MouseButtonEventArgs e) => Select(NoteType.Works);

        private void Select(NoteType type)
        {
            if (TargetTextBox != null)
                InsertMarker(TargetTextBox, type);

            ChipClicked?.Invoke(type);
        }

        /// <summary>
        /// Inserts <paramref name="type"/>'s marker at the head of <paramref name="box"/>'s text,
        /// first stripping any marker already leading it (via <see cref="NoteMarkerParser.Parse"/>)
        /// so a chip click never stacks two markers on top of each other. Caret lands at the end so
        /// typing continues naturally. A no-op for <see cref="NoteType.Note"/>, which carries no
        /// marker to insert.
        /// </summary>
        public static void InsertMarker(TextBox box, NoteType type)
        {
            var marker = NoteMarkerParser.MarkerFor(type);
            if (marker == null)
            {
                return;
            }

            var (_, body) = NoteMarkerParser.Parse(box.Text);
            box.Text = body.Length == 0 ? $"{marker} " : $"{marker} {body}";
            box.CaretIndex = box.Text.Length;
            box.Focus();
        }
    }
}
