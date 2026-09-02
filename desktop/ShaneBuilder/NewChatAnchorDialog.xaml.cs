using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using ShaneBuilder.Services;

namespace ShaneBuilder
{
    /// <summary>Git #2321 (Feature #2318 item 3) — real anchor-disclosure dialog
    /// <see cref="MainWindow.OpenNewChatFlow"/> shows before navigating a new chat to
    /// claude.ai/new. Lists every real open "Feature:" issue (<see cref="GitIssuesService.GetActiveFeaturesAsync"/>)
    /// with its real parent Epic and real state — never a fabricated list. Picking a row is the
    /// real anchor decision; <see cref="SelectedFeatureNumber"/>/<see cref="SelectedEpicNumber"/>
    /// carry it back to the caller. Writing that anchor into the new tab's subtitle is #2323's
    /// separate remaining work — out of scope here. Git #2322 (Feature #2318 item 4) adds the real
    /// "no feature yet — decide later" path (<see cref="DecideLater"/>): a deliberate choice to
    /// proceed unanchored, distinct from Cancel/Escape/close, which is still a full abort — no
    /// navigation, nothing decided either way.</summary>
    public partial class NewChatAnchorDialog : Window
    {
        /// <summary>The real Feature issue number the user picked, or null if none was picked
        /// (either cancelled, or explicitly deferred via <see cref="DecideLater"/>).</summary>
        public int? SelectedFeatureNumber { get; private set; }
        public string? SelectedFeatureTitle { get; private set; }
        public int? SelectedEpicNumber { get; private set; }
        public string? SelectedEpicTitle { get; private set; }

        /// <summary>True when the user explicitly picked "No feature yet — decide later" —
        /// the caller should still navigate the new chat, just without an anchor, as opposed to
        /// Cancel/Escape/close (false here too, but also no navigation at all).</summary>
        public bool DecideLater { get; private set; }

        private NewChatAnchorDialog()
        {
            InitializeComponent();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        /// <summary>Shows the dialog modally and returns the picked anchor, or null fields
        /// across the board if the user cancelled. Owner-scoped like AppDialog's own statics.</summary>
        public static NewChatAnchorDialog ShowFor(Window? owner)
        {
            var dlg = new NewChatAnchorDialog { Owner = owner };
            if (owner != null) dlg.ShowInTaskbar = false;
            dlg.Loaded += (_, _) => _ = dlg.LoadFeaturesAsync();
            dlg.ShowDialog();
            return dlg;
        }

        private async System.Threading.Tasks.Task LoadFeaturesAsync()
        {
            StatusText.Visibility = Visibility.Visible;
            StatusText.Text = "Loading active features…";
            FeatureListHost.Children.Clear();

            var (ok, features, error) = await GitIssuesService.GetActiveFeaturesAsync();
            if (!ok)
            {
                StatusText.Text = $"Couldn't load features — {error}";
                return;
            }
            if (features.Count == 0)
            {
                StatusText.Text = "No open Features found.";
                return;
            }

            StatusText.Visibility = Visibility.Collapsed;
            foreach (var f in features.OrderBy(f => f.Title, StringComparer.OrdinalIgnoreCase))
                FeatureListHost.Children.Add(BuildFeatureRow(f));
        }

        private Border BuildFeatureRow(GitIssueRow feature)
        {
            var (label, brushKey) = StateBadge(feature);

            var row = new Border
            {
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(10, 8, 10, 8),
                Margin = new Thickness(0, 0, 0, 6),
                Background = (Brush)FindResource("Brush.Bg.Chip"),
                BorderBrush = (Brush)FindResource("Brush.Border.Default"),
                BorderThickness = new Thickness(1),
                Cursor = Cursors.Hand,
            };

            var stack = new StackPanel();

            var titleRow = new StackPanel { Orientation = Orientation.Horizontal };
            titleRow.Children.Add(new Ellipse
            {
                Width = 7,
                Height = 7,
                Margin = new Thickness(0, 0, 7, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Fill = (Brush)FindResource(brushKey),
            });
            titleRow.Children.Add(new TextBlock
            {
                Text = $"#{feature.Number} {GitIssuesService.StripFeatureTitlePrefix(feature.Title)}",
                TextWrapping = TextWrapping.Wrap,
                MaxWidth = 320,
                FontSize = (double)FindResource("FontSize.12.5"),
                FontWeight = (FontWeight)FindResource("FontWeight.SemiBold"),
                Foreground = (Brush)FindResource("Brush.Text.Primary"),
            });
            stack.Children.Add(titleRow);

            string epicLine = feature.ParentNumber.HasValue
                ? $"Epic #{feature.ParentNumber} {feature.ParentTitle}"
                : "No parent Epic found";
            stack.Children.Add(new TextBlock
            {
                Text = $"{epicLine} · {label}",
                Margin = new Thickness(14, 2, 0, 0),
                FontSize = (double)FindResource("FontSize.10.5"),
                Foreground = (Brush)FindResource("Brush.Text.Muted"),
            });

            row.Child = stack;
            row.MouseEnter += (_, _) => row.Background = (Brush)FindResource("Brush.Border.Hover");
            row.MouseLeave += (_, _) => row.Background = (Brush)FindResource("Brush.Bg.Chip");
            row.MouseLeftButtonUp += (_, _) =>
            {
                SelectedFeatureNumber = feature.Number;
                SelectedFeatureTitle = GitIssuesService.StripFeatureTitlePrefix(feature.Title);
                SelectedEpicNumber = feature.ParentNumber;
                SelectedEpicTitle = feature.ParentTitle;
                Close();
            };
            return row;
        }

        /// <summary>Real state vocabulary off the feature's own labels — same coarse mapping
        /// MainWindow.PaletteEpicFeatureRow already uses for an epic's features (in-flight/
        /// blocked/complete, else plain open), kept local since this dialog has no reference to
        /// MainWindow's private helper.</summary>
        private static (string Label, string BrushKey) StateBadge(GitIssueRow feature)
        {
            if (feature.Labels.Contains("complete", StringComparer.OrdinalIgnoreCase))
                return ("Complete", "Brush.Status.Done");
            if (feature.Labels.Contains("blocked", StringComparer.OrdinalIgnoreCase))
                return ("Blocked", "Brush.Status.Blocked");
            if (feature.Labels.Contains("in-flight", StringComparer.OrdinalIgnoreCase))
                return ("In flight", "Brush.Status.Running");
            return ("Open", "Brush.Status.Queued");
        }

        private void BtnCancel_Click(object sender, RoutedEventArgs e) => Close();
        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        private void BtnDecideLater_Click(object sender, RoutedEventArgs e)
        {
            DecideLater = true;
            Close();
        }

        private void Window_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape) Close();
        }
    }
}
