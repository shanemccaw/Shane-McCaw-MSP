using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #4202 — read-only "Waiting On You" document tab. Shane: "How do I track this. How do I
    /// know what's waiting for me." Two real, separate sections — "Needs your action" (the real
    /// `Shane To-Do` label) and "Needs your decision" (the real "Ask Shane" board column) — backed
    /// by <see cref="Services.WaitingOnYouService"/>, which reuses the existing mirror-first board
    /// read and label-search mechanisms rather than a new query path. No Yes/No, no board-status
    /// mutation — this is a viewer, same style as WhatsRemainingPanel (#4149). Opened via
    /// MainWindow's own open-or-focus singleton document-tab recipe (see MainWindow.BatterUpTabs.cs).
    /// </summary>
    public partial class WaitingOnYouPanel : UserControl
    {
        private List<Services.ShaneToDoItem> _toDoRows = new();
        private List<Services.AskShaneItem> _askShaneRows = new();

        public WaitingOnYouPanel()
        {
            InitializeComponent();
            IsVisibleChanged += OnIsVisibleChanged;
        }

        /// <summary>Fires every time this document tab becomes visible (opened, or focused after
        /// already being open) — a cheap local-mirror-only read on the common path, so re-running
        /// it on every focus costs nothing live and keeps the list from opening onto stale data.</summary>
        private async void OnIsVisibleChanged(object sender, DependencyPropertyChangedEventArgs e)
        {
            if (IsVisible) await RefreshAsync();
        }

        private async void BtnRefresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync();

        private Services.GitHubApiClient? GetClient()
        {
            var settings = Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat) return null;
            return new Services.GitHubApiClient(settings.GitHubPat);
        }

        public async System.Threading.Tasks.Task RefreshAsync()
        {
            var gh = GetClient();
            if (gh == null)
            {
                _toDoRows = new List<Services.ShaneToDoItem>();
                _askShaneRows = new List<Services.AskShaneItem>();
                RenderEmpty("No GitHub PAT configured — connect one in Settings to read this.");
                return;
            }

            BtnRefresh.IsEnabled = false;
            try
            {
                var (toDo, askShane) = await Services.WaitingOnYouService.GetWaitingOnYouAsync(gh);
                _toDoRows = toDo;
                _askShaneRows = askShane;

                var total = _toDoRows.Count + _askShaneRows.Count;
                TxtCount.Text = total == 0
                    ? "— nothing waiting on you right now"
                    : $"({total}) waiting on you — {_toDoRows.Count} to do, {_askShaneRows.Count} to decide";
                TxtEmpty.Visibility = Visibility.Collapsed;
                Render();
            }
            catch (Exception ex)
            {
                Services.ActivityLog.Log("waiting-on-you", $"Refresh failed: {ex.Message}");
                _toDoRows = new List<Services.ShaneToDoItem>();
                _askShaneRows = new List<Services.AskShaneItem>();
                RenderEmpty($"Couldn't read Waiting On You: {ex.Message}");
            }
            finally
            {
                BtnRefresh.IsEnabled = true;
            }
        }

        private void RenderEmpty(string message)
        {
            TxtCount.Text = "";
            RowsList.Children.Clear();
            TxtEmpty.Text = message;
            TxtEmpty.Visibility = Visibility.Visible;
        }

        private void Render()
        {
            RowsList.Children.Clear();

            if (_toDoRows.Count == 0 && _askShaneRows.Count == 0)
            {
                RowsList.Children.Add(new TextBlock
                {
                    Text = "nothing waiting on you right now",
                    FontSize = 11,
                    FontStyle = FontStyles.Italic,
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                    Margin = new Thickness(2, 4, 2, 4),
                });
                return;
            }

            RowsList.Children.Add(BuildSectionHeader($"Needs your action ({_toDoRows.Count})",
                "Real, open issues labeled “Shane To-Do” — something only you can do (run SQL, restart a server, commission a Design export, set a secret)."));
            if (_toDoRows.Count == 0)
                RowsList.Children.Add(BuildSectionEmpty("nothing labeled “Shane To-Do” right now"));
            else
                foreach (var row in _toDoRows.OrderBy(r => r.Number))
                    RowsList.Children.Add(BuildRow(row.Number, row.Title, row.Excerpt, row.HtmlUrl));

            RowsList.Children.Add(BuildSectionHeader($"Needs your decision ({_askShaneRows.Count})",
                "Real, open issues sitting in the “Ask Shane” board column — a genuine product/UX question code can't settle on its own."));
            if (_askShaneRows.Count == 0)
                RowsList.Children.Add(BuildSectionEmpty("nothing in “Ask Shane” right now"));
            else
                foreach (var row in _askShaneRows.OrderBy(r => r.Number))
                    RowsList.Children.Add(BuildRow(row.Number, row.Title, row.Excerpt, row.HtmlUrl));
        }

        private static UIElement BuildSectionHeader(string title, string subtitle)
        {
            var panel = new StackPanel { Margin = new Thickness(2, 14, 2, 6) };
            panel.Children.Add(new TextBlock
            {
                Text = title,
                FontSize = 12.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
            });
            panel.Children.Add(new TextBlock
            {
                Text = subtitle,
                FontSize = 10.5,
                Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 2, 0, 0),
            });
            return panel;
        }

        private static UIElement BuildSectionEmpty(string text) => new TextBlock
        {
            Text = text,
            FontSize = 11,
            FontStyle = FontStyles.Italic,
            Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
            Margin = new Thickness(2, 0, 2, 4),
        };

        /// <summary>One plain document row — number, title, and (when cheaply available) the
        /// issue's own first real body line. Click opens the real issue on GitHub. No card shell,
        /// no board-status mutation — a viewer, per #4202's own ask.</summary>
        private static UIElement BuildRow(int number, string title, string? excerpt, string htmlUrl)
        {
            var grid = new Grid { Margin = new Thickness(2, 3, 2, 3) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var numBadge = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x28, 0x29, 0x3D)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(5, 1.5, 5, 1.5),
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Top,
            };
            numBadge.Child = new TextBlock
            {
                Text = Services.LocalBuildId.FormatRef(number),
                FontSize = 9.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.FindResource("PeachBrush"),
            };
            Grid.SetColumn(numBadge, 0);
            grid.Children.Add(numBadge);

            var textPanel = new StackPanel();
            textPanel.Children.Add(new TextBlock
            {
                Text = title,
                FontSize = 11.5,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
            });
            if (!string.IsNullOrWhiteSpace(excerpt))
            {
                textPanel.Children.Add(new TextBlock
                {
                    Text = excerpt,
                    FontSize = 10,
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 2, 0, 0),
                });
            }
            Grid.SetColumn(textPanel, 1);
            grid.Children.Add(textPanel);

            var border = new Border
            {
                Child = grid,
                Cursor = System.Windows.Input.Cursors.Hand,
                ToolTip = htmlUrl,
            };
            if (!string.IsNullOrEmpty(htmlUrl))
            {
                border.MouseLeftButtonUp += (_, _) =>
                {
                    try
                    {
                        var psi = new System.Diagnostics.ProcessStartInfo { FileName = htmlUrl, UseShellExecute = true };
                        System.Diagnostics.Process.Start(psi);
                    }
                    catch { /* best-effort — never blocks the viewer on a launch failure */ }
                };
            }
            return border;
        }
    }
}
