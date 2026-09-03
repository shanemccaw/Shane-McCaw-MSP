using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;
using BuildConsole.Services.TestPad;

namespace BuildConsole.TestPad
{
    /// <summary>Ported from ShaneBuilder (Git #2533, Feature: Test Pad #2530; originally Git #2343
    /// and its follow-ons #2348-#2354, ShaneBuilder Feature: Test Pad #2326) — "Import: paste a
    /// whole Notepad file." Two stages: paste raw text and hit Parse, which runs it through the
    /// real <see cref="TestPadImportParser"/> (#2531) and renders a checkable preview; then Import
    /// files every checked candidate as a real <see cref="TestPadNote"/> via
    /// <see cref="TestPadService.AddNote"/> (so it picks up the same auto-stamping every other
    /// note-filing path gets) and closes. <see cref="PreviewHeaderText"/> reports real stats off
    /// the parsed candidates: chars pasted, notes/sections found, how many auto-matched a feature,
    /// and a per-type tally — every number here is a real count, never a placeholder.
    /// "Sections" and "matched" read <see cref="TestPadImportCandidate.Section"/>/
    /// <see cref="TestPadImportCandidate.MatchedFeature"/>. <see cref="TestPadFeatureMatcher"/>
    /// (#2531) is what actually sets <c>MatchedFeature</c>: each candidate's <c>Section</c> (when
    /// the paste had one) and body text are matched against the real, live "Feature:" issues
    /// BuildConsole's own <see cref="GitHubApiClient.SearchIssuesAsync"/> returns (dependency-swap
    /// noted in TestPadFeatureMatcher's own doc comment — ShaneBuilder's original read its
    /// `gh`-shelling GitIssuesService instead). Every preview row also gets a feature dropdown —
    /// pre-selected to whatever auto-matched, always including every real active feature plus
    /// "— No feature —" — which is both the fallback for a row that came back unmatched and the
    /// correction path for a wrong auto-match. Per-row type-chip correction is done: each row's
    /// chip is clickable and cycles its candidate's <see cref="NoteType"/> in place, via
    /// <see cref="NextType"/>. Merge-up extends <see cref="PreviewHost"/> in place: multi-select
    /// "Merge N up" plus the per-row single-click "↑ merge up" chip (via
    /// <see cref="TestPadImportMerger.MergeRowUp"/>) both fold a row's text into whatever row
    /// precedes it; the "+N merged" badge (<c>BuildPreviewRow</c>) is clickable to split that one
    /// row's merges back out via <see cref="TestPadImportMerger.SplitBackOut"/>, and the header's
    /// "Undo merges" button (visible whenever any row carries a merge) resets the whole preview via
    /// <see cref="TestPadImportMerger.UndoAllMerges"/>. Ported unreduced — every real ShaneBuilder
    /// behavior above carries over, only the plumbing underneath (feature lookup, chrome, brushes,
    /// toast/service calls) changed to BuildConsole's real equivalents.</summary>
    public partial class TestPadImportWindow : Window
    {
        private List<TestPadImportCandidate> _candidates = new();
        private int _lastParsedCharCount;

        // The real active-"Feature:"-issue list, fetched once (lazily) and reused across however
        // many times the user hits Parse in one Import session, rather than re-hitting the GitHub
        // API per keystroke/click.
        private Task<List<GitHubIssueResult>>? _featuresTask;
        private List<GitHubIssueResult> _activeFeatures = new();

        private static readonly Regex FeatureTitlePrefix =
            new(@"^feature:\s*", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private TestPadImportWindow()
        {
            InitializeComponent();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        /// <summary>Shows the dialog modally. Owner-scoped, same pattern BuildConsole's other
        /// secondary dialogs use. Kicks off the real active-features fetch immediately so it's
        /// usually already resolved by the time the user has pasted text and hit Parse.</summary>
        public static void ShowFor(Window? owner)
        {
            var dlg = new TestPadImportWindow { Owner = owner };
            if (owner != null) dlg.ShowInTaskbar = false;
            dlg._featuresTask = LoadFeaturesAsync();
            dlg.ShowDialog();
        }

        /// <summary>Real "active Feature:-titled issues" fetch — BuildConsole's equivalent of
        /// ShaneBuilder's <c>GitIssuesService.GetActiveFeaturesAsync</c> (#2531's own dependency
        /// note: no GitIssuesService-style home exists here, so this reads
        /// <see cref="GitHubApiClient.SearchIssuesAsync"/> directly with the query
        /// <see cref="TestPadFeatureMatcher"/>'s doc comment already names). Degrades to an empty
        /// list (never throws into the caller) so a missing PAT or a network failure just means
        /// every row falls back to the manual dropdown instead of crashing Import.</summary>
        private static async Task<List<GitHubIssueResult>> LoadFeaturesAsync()
        {
            try
            {
                var settings = BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat)
                {
                    ActivityLog.Log("testpad-import", "couldn't load active features for auto-match: no GitHub PAT configured");
                    return new List<GitHubIssueResult>();
                }

                var gh = new GitHubApiClient(settings.GitHubPat);
                var results = await gh.SearchIssuesAsync("Feature in:title state:open");
                return results;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("testpad-import", $"couldn't load active features for auto-match: {ex.Message}");
                return new List<GitHubIssueResult>();
            }
        }

        private async void BtnParse_Click(object sender, RoutedEventArgs e)
        {
            _lastParsedCharCount = (PasteBox.Text ?? string.Empty).Length;
            _candidates = TestPadImportParser.Parse(PasteBox.Text).ToList();

            // Auto-match each candidate (Section, then body text) against the real active-feature
            // list before rendering, so the preview's dropdown opens pre-selected wherever a real
            // match was found rather than making the user pick every row by hand.
            _activeFeatures = await (_featuresTask ??= LoadFeaturesAsync());
            foreach (var candidate in _candidates)
            {
                var match = TestPadFeatureMatcher.Match(candidate.Text, candidate.Section, _activeFeatures);
                candidate.MatchedFeature = match == null ? null : StripFeatureTitlePrefix(match.Title);
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
                MergeBar.Visibility = Visibility.Collapsed;
                BtnUndoMerges.Visibility = Visibility.Collapsed;
                return;
            }

            PreviewHeaderText.Visibility = Visibility.Visible;
            PreviewHeaderText.Text = $"{BuildHeaderStatsText()} — uncheck any you don't want imported.";

            // A Section header line in the paste doesn't become a note of its own; it's surfaced
            // here instead, as a divider above the notes parsed under it. A row merged away
            // (IsMergedAway) already lives inside the row it was merged into, so it's skipped here
            // rather than rendered as its own row.
            string? lastSection = null;
            var visible = _candidates.Where(c => !c.IsMergedAway).ToList();
            foreach (var candidate in visible)
            {
                if (candidate.Section != null && candidate.Section != lastSection)
                    PreviewHost.Children.Add(BuildSectionHeaderRow(candidate.Section));
                lastSection = candidate.Section;

                // The topmost visible row has nothing above it to merge into; every other row gets
                // the per-row merge-up button.
                var canMergeUp = visible.IndexOf(candidate) > 0;
                PreviewHost.Children.Add(BuildPreviewRow(candidate, canMergeUp));
            }

            UpdateImportButton();
            UpdateMergeBar();
        }

        /// <summary>The header-stats line: chars pasted, notes/sections the splitter found, how
        /// many auto-matched a feature, and a per-type tally. Every number here is a real count off
        /// <see cref="_candidates"/> (or the raw paste for chars) — "sections" and "matched" read
        /// genuinely 0 until the parser/matcher have something to set, they are not placeholders
        /// that get swapped out later.</summary>
        private string BuildHeaderStatsText()
        {
            // A merged-away row's content lives inside its anchor row now, so every count here
            // reads the live (non-merged-away) set rather than the raw parse output.
            var live = _candidates.Where(c => !c.IsMergedAway).ToList();
            var noteCount = live.Count;
            var sectionCount = live
                .Select(c => c.Section)
                .Where(s => !string.IsNullOrEmpty(s))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count();
            var matchedCount = live.Count(c => !string.IsNullOrEmpty(c.MatchedFeature));

            var tally = live
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
                Foreground = (Brush)FindResource("TextSecondaryBrush"),
                Margin = new Thickness(2, 10, 0, 4),
            };
        }

        /// <summary><paramref name="canMergeUp"/> is false only for the topmost visible row, which
        /// has nothing above it to merge into.</summary>
        private Border BuildPreviewRow(TestPadImportCandidate candidate, bool canMergeUp)
        {
            var row = new Border
            {
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 0, 0, 6),
                Background = (Brush)FindResource("Surface0Brush"),
                BorderBrush = (Brush)FindResource("BorderDividerBrush"),
                BorderThickness = new Thickness(1),
            };

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // merge select
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Include
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // The multi-select tick box "Merge N up" acts on. Separate from Include below:
            // selecting a row for merging doesn't change whether it files on Import.
            var selectCheck = new CheckBox
            {
                IsChecked = candidate.Selected,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 2, 4, 0),
                ToolTip = "Select for \"Merge N up\"",
            };
            selectCheck.Checked += (_, _) => { candidate.Selected = true; UpdateMergeBar(); };
            selectCheck.Unchecked += (_, _) => { candidate.Selected = false; UpdateMergeBar(); };
            Grid.SetRow(selectCheck, 0);
            Grid.SetColumn(selectCheck, 0);
            grid.Children.Add(selectCheck);

            var check = new CheckBox
            {
                IsChecked = candidate.Include,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 2, 8, 0),
            };
            check.Checked += (_, _) => { candidate.Include = true; UpdateImportButton(); };
            check.Unchecked += (_, _) => { candidate.Include = false; UpdateImportButton(); };
            Grid.SetRow(check, 0);
            Grid.SetColumn(check, 1);
            grid.Children.Add(check);

            var text = new TextBlock
            {
                Text = candidate.Text,
                TextWrapping = TextWrapping.Wrap,
                FontSize = 11,
                Foreground = (Brush)FindResource("TextPrimaryBrush"),
            };
            Grid.SetRow(text, 0);
            Grid.SetColumn(text, 2);
            grid.Children.Add(text);

            // Every chip that can appear to the right of a row's text (type, needs-shot,
            // "+N merged") stacks in one column now that Grid columns shifted for the two
            // checkboxes.
            var chips = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Top };
            Grid.SetRow(chips, 0);
            Grid.SetColumn(chips, 3);
            Grid.SetColumnSpan(chips, 2);
            grid.Children.Add(chips);

            var typeChip = new Border
            {
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(5, 1, 5, 1),
                Margin = new Thickness(8, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Top,
                Cursor = Cursors.Hand,
                ToolTip = "Click to change type",
                Background = (Brush)FindResource("CardBackgroundBrush"),
            };
            var typeChipText = new TextBlock
            {
                Text = LabelFor(candidate.Type),
                FontSize = 9,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("TextSecondaryBrush"),
            };
            typeChip.Child = typeChipText;
            typeChip.MouseLeftButtonDown += (_, _) =>
            {
                candidate.Type = NextType(candidate.Type);
                typeChipText.Text = LabelFor(candidate.Type);
            };
            chips.Children.Add(typeChip);

            // "Import: per-row merge-up button." A quick single-click fold of just this row into
            // whatever row precedes it, with no select tick box involved — the multi-select
            // "Merge N up" bar stays for folding several rows at once.
            if (canMergeUp)
            {
                var mergeUpChip = new Border
                {
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1, 5, 1),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Top,
                    Cursor = Cursors.Hand,
                    ToolTip = "Merge this row up into the one above it",
                    Background = (Brush)FindResource("CardBackgroundBrush"),
                };
                mergeUpChip.Child = new TextBlock
                {
                    Text = "↑ merge up",
                    FontSize = 9,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("TextSecondaryBrush"),
                };
                mergeUpChip.MouseLeftButtonDown += (_, _) =>
                {
                    if (TestPadImportMerger.MergeRowUp(_candidates, candidate))
                        RenderPreview();
                };
                chips.Children.Add(mergeUpChip);
            }

            // "+N merged" indicator: honest trace that this row's Text now carries other rows'
            // content folded in via "Merge N up", and itself clickable to split every one of them
            // back out via TestPadImportMerger.SplitBackOut.
            if (candidate.MergedChildren.Count > 0)
            {
                var mergedBadge = new Border
                {
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1, 5, 1),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Top,
                    Cursor = Cursors.Hand,
                    Background = (Brush)FindResource("CardBackgroundBrush"),
                    ToolTip = $"{candidate.MergedChildren.Count} row(s) merged up into this one — click to split back out.",
                };
                mergedBadge.Child = new TextBlock
                {
                    Text = $"+{candidate.MergedChildren.Count} merged",
                    FontSize = 9,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("TextSecondaryBrush"),
                };
                mergedBadge.MouseLeftButtonDown += (_, _) =>
                {
                    if (TestPadImportMerger.SplitBackOut(candidate))
                        RenderPreview();
                };
                chips.Children.Add(mergedBadge);
            }

            if (candidate.NeedsShot)
            {
                // Visible confirmation that the stripped "<need screen shots>" marker will carry
                // through as a droppable shot slot on the filed note.
                var shotChip = new Border
                {
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1, 5, 1),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Top,
                    Background = (Brush)FindResource("CardBackgroundBrush"),
                    ToolTip = "Flagged for a screenshot — imports with an empty shot slot.",
                };
                shotChip.Child = new TextBlock
                {
                    Text = "needs shot",
                    FontSize = 9,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("TextSecondaryBrush"),
                };
                chips.Children.Add(shotChip);
            }

            var featureCombo = BuildFeatureCombo(candidate);
            Grid.SetRow(featureCombo, 1);
            Grid.SetColumn(featureCombo, 2);
            Grid.SetColumnSpan(featureCombo, 3);
            grid.Children.Add(featureCombo);

            row.Child = grid;
            return row;
        }

        /// <summary>One row's feature picker: pre-selects whatever <see cref="TestPadFeatureMatcher"/>
        /// auto-matched (<see cref="TestPadImportCandidate.MatchedFeature"/> already carries the
        /// stripped title string), and always includes a real "— No feature —" option plus every
        /// real active feature so the dropdown genuinely is a usable fallback for a row that came
        /// back unmatched, not just a read-only display of the guess.</summary>
        private ComboBox BuildFeatureCombo(TestPadImportCandidate candidate)
        {
            var options = new List<FeatureOption> { new() { Label = "— No feature —", StrippedTitle = null } };
            options.AddRange(_activeFeatures
                .OrderBy(f => f.Title, StringComparer.OrdinalIgnoreCase)
                .Select(f =>
                {
                    var stripped = StripFeatureTitlePrefix(f.Title);
                    return new FeatureOption { Label = $"#{f.Number} {stripped}", StrippedTitle = stripped };
                }));

            var combo = new ComboBox
            {
                ItemsSource = options,
                Margin = new Thickness(0, 6, 0, 0),
                FontSize = 10.5,
                Background = (Brush)FindResource("CardBackgroundBrush"),
                Foreground = (Brush)FindResource("TextPrimaryBrush"),
                BorderBrush = (Brush)FindResource("BorderDividerBrush"),
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

        /// <summary>Same real "strip the repo's own title-convention prefix" pattern
        /// <see cref="TestPadFeatureMatcher"/>'s own private helper uses (and ShaneBuilder's
        /// original <c>GitIssuesService.StripFeatureTitlePrefix</c> before it) — kept local here too
        /// per #2531's note that BuildConsole has no shared GitIssuesService-style home for it.</summary>
        private static string StripFeatureTitlePrefix(string title) => FeatureTitlePrefix.Replace(title ?? "", "");

        private static string LabelFor(NoteType type) => type.ToString().ToLowerInvariant();

        /// <summary>"Click any type chip in the preview to correct it." Cycles a candidate's type
        /// forward through every <see cref="NoteType"/> value, wrapping back to the start, so a
        /// repeated click walks the whole set without needing a picker.</summary>
        private static NoteType NextType(NoteType current)
        {
            var values = Enum.GetValues<NoteType>();
            var index = Array.IndexOf(values, current);
            return values[(index + 1) % values.Length];
        }

        private void UpdateImportButton()
        {
            var count = _candidates.Count(c => c.Include && !c.IsMergedAway);
            BtnImport.Content = count == 0 ? "Import" : $"Import {count}";
            BtnImport.IsEnabled = count > 0;
        }

        /// <summary>Keeps the "Merge N up" bar's visibility/text/enabled state in sync with the
        /// live selection every time a select tick box changes. Also keeps "Undo merges" visible
        /// exactly while at least one row actually carries a merge
        /// (<see cref="TestPadImportMerger.UndoAllMerges"/> would have something to do).</summary>
        private void UpdateMergeBar()
        {
            BtnUndoMerges.Visibility = _candidates.Any(c => c.MergedChildren.Count > 0)
                ? Visibility.Visible
                : Visibility.Collapsed;

            var selectedCount = _candidates.Count(c => c.Selected && !c.IsMergedAway);
            if (selectedCount == 0)
            {
                MergeBar.Visibility = Visibility.Collapsed;
                return;
            }

            MergeBar.Visibility = Visibility.Visible;
            var noun = selectedCount == 1 ? "row" : "rows";
            MergeBarText.Text = $"{selectedCount} {noun} selected";
            BtnMergeUp.Content = $"Merge {selectedCount} up";

            // A selection starting at the very top of the visible list has nothing above it to
            // merge into — mirror that in the button rather than letting the click silently no-op.
            var visible = _candidates.Where(c => !c.IsMergedAway).ToList();
            var firstSelectedIndex = visible.FindIndex(c => c.Selected);
            BtnMergeUp.IsEnabled = firstSelectedIndex > 0;
        }

        /// <summary>"Merge N up": folds every ticked row up into whatever row precedes the topmost
        /// selection, via <see cref="TestPadImportMerger.MergeSelectedUp"/>, then re-renders so the
        /// merged-away rows drop out and the anchor's "+N merged" badge shows.</summary>
        private void BtnMergeUp_Click(object sender, RoutedEventArgs e)
        {
            var merged = TestPadImportMerger.MergeSelectedUp(_candidates);
            if (merged == 0) return;

            RenderPreview();
        }

        /// <summary>"Undo merges resets all." Splits every merged row back out to what it looked
        /// like right after Parse, via <see cref="TestPadImportMerger.UndoAllMerges"/>.</summary>
        private void BtnUndoMerges_Click(object sender, RoutedEventArgs e)
        {
            if (TestPadImportMerger.UndoAllMerges(_candidates))
                RenderPreview();
        }

        private void BtnImport_Click(object sender, RoutedEventArgs e)
        {
            var toImport = _candidates.Where(c => c.Include && !c.IsMergedAway).ToList();
            if (toImport.Count == 0) return;

            foreach (var candidate in toImport)
            {
                // A candidate flagged "<need screen shots>" files with the same droppable-thumbnail
                // slot the manual "Attach shot" composer chip arms. Stamp whatever feature
                // auto-match (or the row's dropdown override) landed on; a genuinely-unset row
                // stays null rather than guessing.
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
