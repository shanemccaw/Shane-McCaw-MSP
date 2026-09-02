using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Threading.Tasks;
using ShaneBuilder.Services;
using ShaneBuilder.Services.TestPad;

namespace ShaneBuilder
{
    /// <summary>Git #2343 (Feature: Test Pad, #2326) — "Import: paste a whole Notepad file."
    /// Two stages: paste raw text and hit Parse, which runs it through
    /// <see cref="TestPadImportParser"/> and renders a checkable preview; then Import files every
    /// checked candidate as a real <see cref="TestPadNote"/> via <see cref="TestPadService.AddNote"/>
    /// (so it picks up the same auto-stamping every other note-filing path gets, #2331) and closes.
    /// Git #2350 — <see cref="PreviewHeaderText"/> reports real stats off the parsed candidates:
    /// chars pasted, notes/sections found, how many auto-matched a feature, and a per-type tally.
    /// "Sections" and "matched" read <see cref="TestPadImportCandidate.Section"/>/
    /// <see cref="TestPadImportCandidate.MatchedFeature"/>. Git #2349 — <see cref="TestPadFeatureMatcher"/>
    /// is what actually sets <c>MatchedFeature</c> now: each candidate's <c>Section</c> (when the
    /// paste had one) and body text are matched against the real, live "Feature:" issues
    /// <see cref="GitIssuesService.GetActiveFeaturesAsync"/> returns. Every preview row also gets a
    /// feature dropdown — pre-selected to whatever auto-matched, always including every real active
    /// feature plus "— No feature —" — which is both the fallback for a row that came back
    /// unmatched and the correction path for a wrong auto-match. Merge-up UI (#2352-#2354)
    /// is a separate open sub-issue that extends <see cref="PreviewHost"/> in place — this issue's
    /// preview is deliberately just a checkable list of what the splitter produced. Per-row
    /// type-chip correction (#2351) is done: each row's chip is clickable and cycles its
    /// candidate's <see cref="NoteType"/> in place, via <see cref="NextType"/>.</summary>
    public partial class TestPadImportWindow : Window
    {
        private List<TestPadImportCandidate> _candidates = new();
        private int _lastParsedCharCount;

        // Git #2349 — the real active-feature list, fetched once (lazily) and reused across
        // however many times the user hits Parse in one Import session, rather than re-hitting
        // `gh` per keystroke/click.
        private Task<List<GitIssueRow>>? _featuresTask;
        private List<GitIssueRow> _activeFeatures = new();

        private TestPadImportWindow()
        {
            InitializeComponent();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        /// <summary>Shows the dialog modally. Owner-scoped like NewChatAnchorDialog/AppDialog.
        /// Kicks off the real active-features fetch immediately (same prewarm pattern
        /// NewChatAnchorDialog uses) so it's usually already resolved by the time the user has
        /// pasted text and hit Parse.</summary>
        public static void ShowFor(Window? owner)
        {
            var dlg = new TestPadImportWindow { Owner = owner };
            if (owner != null) dlg.ShowInTaskbar = false;
            dlg._featuresTask = LoadFeaturesAsync();
            dlg.ShowDialog();
        }

        private static async Task<List<GitIssueRow>> LoadFeaturesAsync()
        {
            var (ok, features, error) = await GitIssuesService.GetActiveFeaturesAsync();
            if (!ok)
            {
                ConsoleOutputSink.Log(LogLevel.Warn, $"[testpad-import] couldn't load active features for auto-match: {error}");
                return new List<GitIssueRow>();
            }
            return features;
        }

        private async void BtnParse_Click(object sender, RoutedEventArgs e)
        {
            _lastParsedCharCount = (PasteBox.Text ?? string.Empty).Length;
            _candidates = TestPadImportParser.Parse(PasteBox.Text).ToList();

            // Git #2349 — auto-match each candidate (Section, then body text) against the real
            // active-feature list before rendering, so the preview's dropdown opens pre-selected
            // wherever a real match was found rather than making the user pick every row by hand.
            _activeFeatures = await (_featuresTask ??= LoadFeaturesAsync());
            foreach (var candidate in _candidates)
            {
                var match = TestPadFeatureMatcher.Match(candidate.Text, candidate.Section, _activeFeatures);
                candidate.MatchedFeature = match == null ? null : GitIssuesService.StripFeatureTitlePrefix(match.Title);
            }

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
            PreviewHeaderText.Text = $"{BuildHeaderStatsText()} — uncheck any you don't want imported.";

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

        /// <summary>Git #2350 — the header-stats line: chars pasted, notes/sections the splitter
        /// found, how many auto-matched a feature, and a per-type tally. Every number here is a
        /// real count off <see cref="_candidates"/> (or the raw paste for chars) — "sections" and
        /// "matched" read genuinely 0 until #2344/#2349 have something to set, they are not
        /// placeholders that get swapped out later.</summary>
        private string BuildHeaderStatsText()
        {
            var noteCount = _candidates.Count;
            var sectionCount = _candidates
                .Select(c => c.Section)
                .Where(s => !string.IsNullOrEmpty(s))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count();
            var matchedCount = _candidates.Count(c => !string.IsNullOrEmpty(c.MatchedFeature));

            var tally = _candidates
                .GroupBy(c => c.Type)
                .OrderByDescending(g => g.Count())
                .ThenBy(g => g.Key.ToString(), StringComparer.OrdinalIgnoreCase)
                .Select(g => $"{g.Count()} {g.Key.ToString().ToLowerInvariant()}")
                .ToList();
            var tallyText = tally.Count > 0 ? string.Join(", ", tally) : "0 notes";

            var sectionsPhrase = sectionCount == 1 ? "1 section" : $"{sectionCount} sections";
            var notesPhrase = noteCount == 1 ? "1 note" : $"{noteCount} notes";

            return $"{_lastParsedCharCount:N0} chars → {notesPhrase}, {sectionsPhrase}, {matchedCount} matched — {tallyText}";
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
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var check = new CheckBox
            {
                IsChecked = candidate.Include,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 2, 8, 0),
            };
            check.Checked += (_, _) => { candidate.Include = true; UpdateImportButton(); };
            check.Unchecked += (_, _) => { candidate.Include = false; UpdateImportButton(); };
            Grid.SetRow(check, 0);
            Grid.SetColumn(check, 0);
            grid.Children.Add(check);

            var text = new TextBlock
            {
                Text = candidate.Text,
                TextWrapping = TextWrapping.Wrap,
                FontSize = 11,
                Foreground = (Brush)FindResource("Brush.Text.Primary"),
            };
            Grid.SetRow(text, 0);
            Grid.SetColumn(text, 1);
            grid.Children.Add(text);

            var typeChip = new Border
            {
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(5, 1, 5, 1),
                Margin = new Thickness(8, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Top,
                Cursor = Cursors.Hand,
                ToolTip = "Click to change type",
                Background = (Brush)FindResource("Brush.Bg.Card"),
            };
            var typeChipText = new TextBlock
            {
                Text = LabelFor(candidate.Type),
                FontSize = 9,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("Brush.Text.Muted"),
            };
            typeChip.Child = typeChipText;
            typeChip.MouseLeftButtonDown += (_, _) =>
            {
                candidate.Type = NextType(candidate.Type);
                typeChipText.Text = LabelFor(candidate.Type);
            };
            Grid.SetColumn(typeChip, 2);
            grid.Children.Add(typeChip);

            if (candidate.NeedsShot)
            {
                // Git #2348 — visible confirmation that the stripped "<need screen shots>" marker
                // will carry through as a droppable shot slot on the filed note (#2340's mechanism).
                var shotChip = new Border
                {
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1, 5, 1),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Top,
                    Background = (Brush)FindResource("Brush.Bg.Card"),
                    ToolTip = "Flagged for a screenshot — imports with an empty shot slot.",
                };
                shotChip.Child = new TextBlock
                {
                    Text = "needs shot",
                    FontSize = 9,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("Brush.Text.Muted"),
                };
                Grid.SetRow(shotChip, 0);
                Grid.SetColumn(shotChip, 3);
                grid.Children.Add(shotChip);
            }

            var featureCombo = BuildFeatureCombo(candidate);
            Grid.SetRow(featureCombo, 1);
            Grid.SetColumn(featureCombo, 1);
            Grid.SetColumnSpan(featureCombo, 3);
            grid.Children.Add(featureCombo);

            row.Child = grid;
            return row;
        }

        /// <summary>Git #2349 — one row's feature picker: pre-selects whatever
        /// <see cref="TestPadFeatureMatcher"/> auto-matched (<see cref="TestPadImportCandidate.MatchedFeature"/>
        /// already carries the stripped title string), and always includes a real "— No feature —"
        /// option plus every real active Feature so the dropdown genuinely is a usable fallback for
        /// a row that came back unmatched, not just a read-only display of the guess.</summary>
        private ComboBox BuildFeatureCombo(TestPadImportCandidate candidate)
        {
            var options = new List<FeatureOption> { new() { Label = "— No feature —", StrippedTitle = null } };
            options.AddRange(_activeFeatures
                .OrderBy(f => f.Title, StringComparer.OrdinalIgnoreCase)
                .Select(f =>
                {
                    var stripped = GitIssuesService.StripFeatureTitlePrefix(f.Title);
                    return new FeatureOption { Label = $"#{f.Number} {stripped}", StrippedTitle = stripped };
                }));

            var combo = new ComboBox
            {
                ItemsSource = options,
                Margin = new Thickness(0, 6, 0, 0),
                FontSize = 10.5,
                Background = (Brush)FindResource("Brush.Bg.Card"),
                Foreground = (Brush)FindResource("Brush.Text.Primary"),
                BorderBrush = (Brush)FindResource("Brush.Border.Default"),
                BorderThickness = new Thickness(1),
            };
            combo.SelectedItem = options.FirstOrDefault(o =>
                string.Equals(o.StrippedTitle, candidate.MatchedFeature, StringComparison.OrdinalIgnoreCase)) ?? options[0];
            combo.SelectionChanged += (_, _) => candidate.MatchedFeature = (combo.SelectedItem as FeatureOption)?.StrippedTitle;
            return combo;
        }

        /// <summary>Local wrapper so the feature dropdown can carry the real stripped feature title
        /// alongside a display label — ComboBox renders an item via <see cref="object.ToString"/>
        /// when no DisplayMemberPath is set, so <see cref="Label"/> doubles as that.</summary>
        private sealed class FeatureOption
        {
            public string Label { get; init; } = "";
            public string? StrippedTitle { get; init; }
            public override string ToString() => Label;
        }

        private static string LabelFor(NoteType type) => type.ToString().ToLowerInvariant();

        /// <summary>Git #2351 — "click any type chip in the preview to correct it." Cycles a
        /// candidate's type forward through every <see cref="NoteType"/> value, wrapping back to
        /// the start, so a repeated click walks the whole set without needing a picker.</summary>
        private static NoteType NextType(NoteType current)
        {
            var values = Enum.GetValues<NoteType>();
            var index = Array.IndexOf(values, current);
            return values[(index + 1) % values.Length];
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
                // Git #2348 — a candidate flagged "<need screen shots>" files with the same
                // droppable-thumbnail slot the manual "Attach shot" composer chip arms (#2340).
                // Git #2349 — stamp whatever feature auto-match (or the row's dropdown override)
                // landed on; a genuinely-unset row stays null rather than guessing.
                TestPadService.AddNote(new TestPadNote
                {
                    Text = candidate.Text,
                    Type = candidate.Type,
                    HasShotSlot = candidate.NeedsShot,
                    Feature = candidate.MatchedFeature,
                });
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
