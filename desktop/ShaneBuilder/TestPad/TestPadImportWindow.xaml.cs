using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using ShaneBuilder.Services;
using ShaneBuilder.Services.TestPad;

namespace ShaneBuilder
{
    /// <summary>Git #2343 (Feature: Test Pad, #2326) — "Import: paste a whole Notepad file."
    /// Two stages: paste raw text and hit Parse, which runs it through
    /// <see cref="TestPadImportParser"/> and renders a checkable preview; then Import files every
    /// checked candidate as a real <see cref="TestPadNote"/> via <see cref="TestPadService.AddNote"/>
    /// (so it picks up the same auto-stamping every other note-filing path gets, #2331) and closes.
    /// The header-stats line (chars/notes/sections/matched, #2350), per-row type-chip correction
    /// (#2351), and merge-up UI (#2352-#2354) are separate open sub-issues that extend
    /// <see cref="PreviewHost"/>/<see cref="PreviewHeaderText"/> in place — this issue's preview is
    /// deliberately just a checkable list of what the baseline splitter produced.</summary>
    public partial class TestPadImportWindow : Window
    {
        private List<TestPadImportCandidate> _candidates = new();

        private TestPadImportWindow()
        {
            InitializeComponent();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        /// <summary>Shows the dialog modally. Owner-scoped like NewChatAnchorDialog/AppDialog.</summary>
        public static void ShowFor(Window? owner)
        {
            var dlg = new TestPadImportWindow { Owner = owner };
            if (owner != null) dlg.ShowInTaskbar = false;
            dlg.ShowDialog();
        }

        private void BtnParse_Click(object sender, RoutedEventArgs e)
        {
            _candidates = TestPadImportParser.Parse(PasteBox.Text).ToList();
            RenderPreview();
        }

        private void RenderPreview()
        {
            PreviewHost.Children.Clear();

            if (_candidates.Count == 0)
            {
                PreviewHeaderText.Visibility = Visibility.Visible;
                PreviewHeaderText.Text = string.IsNullOrWhiteSpace(PasteBox.Text)
                    ? "Paste some text above, then Parse."
                    : "Nothing came out of that paste — nothing to import.";
                BtnImport.IsEnabled = false;
                return;
            }

            PreviewHeaderText.Visibility = Visibility.Visible;
            PreviewHeaderText.Text = $"{_candidates.Count} {(_candidates.Count == 1 ? "note" : "notes")} found — uncheck any you don't want imported.";

            // Git #2344 — a Section header line in the paste doesn't become a note of its own;
            // it's surfaced here instead, as a divider above the notes parsed under it.
            string? lastSection = null;
            foreach (var candidate in _candidates)
            {
                if (candidate.Section != null && candidate.Section != lastSection)
                    PreviewHost.Children.Add(BuildSectionHeaderRow(candidate.Section));
                lastSection = candidate.Section;

                PreviewHost.Children.Add(BuildPreviewRow(candidate));
            }

            UpdateImportButton();
        }

        private TextBlock BuildSectionHeaderRow(string section)
        {
            return new TextBlock
            {
                Text = section,
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                Foreground = (Brush)FindResource("Brush.Text.Muted"),
                Margin = new Thickness(2, 10, 0, 4),
            };
        }

        private Border BuildPreviewRow(TestPadImportCandidate candidate)
        {
            var row = new Border
            {
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 0, 0, 6),
                Background = (Brush)FindResource("Brush.Bg.Chip"),
                BorderBrush = (Brush)FindResource("Brush.Border.Default"),
                BorderThickness = new Thickness(1),
            };

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var check = new CheckBox
            {
                IsChecked = candidate.Include,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 2, 8, 0),
            };
            check.Checked += (_, _) => { candidate.Include = true; UpdateImportButton(); };
            check.Unchecked += (_, _) => { candidate.Include = false; UpdateImportButton(); };
            Grid.SetColumn(check, 0);
            grid.Children.Add(check);

            var text = new TextBlock
            {
                Text = candidate.Text,
                TextWrapping = TextWrapping.Wrap,
                FontSize = 11,
                Foreground = (Brush)FindResource("Brush.Text.Primary"),
            };
            Grid.SetColumn(text, 1);
            grid.Children.Add(text);

            var marker = NoteMarkerParser.MarkerFor(candidate.Type);
            var typeChip = new Border
            {
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(5, 1, 5, 1),
                Margin = new Thickness(8, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Top,
                Background = (Brush)FindResource("Brush.Bg.Card"),
            };
            typeChip.Child = new TextBlock
            {
                Text = marker == null ? "note" : candidate.Type.ToString().ToLowerInvariant(),
                FontSize = 9,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("Brush.Text.Muted"),
            };
            Grid.SetColumn(typeChip, 2);
            grid.Children.Add(typeChip);

            row.Child = grid;
            return row;
        }

        private void UpdateImportButton()
        {
            var count = _candidates.Count(c => c.Include);
            BtnImport.Content = count == 0 ? "Import" : $"Import {count}";
            BtnImport.IsEnabled = count > 0;
        }

        private void BtnImport_Click(object sender, RoutedEventArgs e)
        {
            var toImport = _candidates.Where(c => c.Include).ToList();
            if (toImport.Count == 0) return;

            foreach (var candidate in toImport)
            {
                TestPadService.AddNote(new TestPadNote { Text = candidate.Text, Type = candidate.Type });
            }

            var imported = toImport.Count;
            ToastEngine.Success("Test Pad", $"Imported {imported} {(imported == 1 ? "note" : "notes")} from Notepad.");
            Close();
        }

        private void BtnCancel_Click(object sender, RoutedEventArgs e) => Close();
        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        private void Window_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape) Close();
        }
    }
}
