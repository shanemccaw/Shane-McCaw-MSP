using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #3879 — the real Notification Tray popout panel content: lists every real entry in
    /// <see cref="NotificationHistoryStore"/>, newest first, with a per-item bookmark toggle and a
    /// "Clear All" that only removes non-bookmarked entries. A plain content UserControl (not a
    /// Popup itself) — the sibling bell-icon issue (#3880) hosts this inside an ActivityBar Popup,
    /// the same real convention <c>WebToolsPopup</c>/<c>ShelfPopup</c> already use for their own
    /// content (<c>WebToolsList</c>/<c>ShelfList</c>).
    /// </summary>
    public partial class NotificationTrayPanel : UserControl
    {
        public NotificationTrayPanel()
        {
            InitializeComponent();
            Loaded += (_, _) => Refresh();
        }

        /// <summary>Reloads the list fresh from <see cref="NotificationHistoryStore.All"/> — same
        /// "reload fresh every open" convention as <c>ActivityBar.BtnWebTools_Click</c>, so the
        /// host (#3880) can call this right before opening the popup and always show real,
        /// current state rather than a stale snapshot from whenever this control was created.</summary>
        public void Refresh()
        {
            HistoryList.Children.Clear();

            var entries = NotificationHistoryStore.All;
            if (entries.Count == 0)
            {
                HistoryList.Children.Add(new TextBlock
                {
                    Text = "No notifications.",
                    FontSize = 11,
                    Foreground = (Brush)FindResource("Subtext1Brush"),
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(8)
                });
                return;
            }

            foreach (var entry in entries)
                HistoryList.Children.Add(BuildRow(entry));
        }

        /// <summary>One real history row: kind icon (reusing <see cref="ToastCard.StyleFor"/> for
        /// the exact same accent/glyph mapping the floating toast used), title/message/timestamp,
        /// and a ★/☆ bookmark toggle wired straight to <see cref="NotificationHistoryStore.SetBookmarked"/>.</summary>
        private Border BuildRow(NotificationHistoryEntry entry)
        {
            var kind = Enum.TryParse<ToastKind>(entry.Kind, out var parsed) ? parsed : ToastKind.Info;
            var (accent, glyph) = ToastCard.StyleFor(kind);

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // icon
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // text
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // bookmark

            var icon = new TextBlock
            {
                Text = glyph,
                FontFamily = new FontFamily("Segoe UI Symbol, Segoe UI"),
                FontSize = 14,
                FontWeight = FontWeights.Bold,
                Foreground = accent,
                Margin = new Thickness(6, 9, 8, 0),
                VerticalAlignment = VerticalAlignment.Top
            };
            Grid.SetColumn(icon, 0);
            grid.Children.Add(icon);

            var textStack = new StackPanel { Margin = new Thickness(0, 6, 6, 8) };

            if (!string.IsNullOrWhiteSpace(entry.Title))
            {
                textStack.Children.Add(new TextBlock
                {
                    Text = entry.Title,
                    FontSize = 12,
                    FontWeight = FontWeights.SemiBold,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = (Brush)FindResource("TextBrush")
                });
            }

            if (!string.IsNullOrWhiteSpace(entry.Message))
            {
                textStack.Children.Add(new TextBlock
                {
                    Text = entry.Message,
                    FontSize = 11,
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 2, 0, 0),
                    Foreground = (Brush)FindResource("Subtext0Brush")
                });
            }

            textStack.Children.Add(new TextBlock
            {
                Text = entry.CreatedAtUtc.ToLocalTime().ToString("MMM d, h:mm tt"),
                FontSize = 10,
                Margin = new Thickness(0, 3, 0, 0),
                Foreground = (Brush)FindResource("Subtext1Brush")
            });

            Grid.SetColumn(textStack, 1);
            grid.Children.Add(textStack);

            var bookmarkBtn = new Button
            {
                Content = entry.Bookmarked ? "★" : "☆", // ★ / ☆
                Style = (Style)FindResource("IconButton"),
                FontSize = 13,
                Padding = new Thickness(6, 4, 6, 4),
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 4, 4, 0),
                Foreground = entry.Bookmarked ? (Brush)FindResource("PeachBrush") : (Brush)FindResource("Subtext1Brush"),
                ToolTip = entry.Bookmarked
                    ? "Bookmarked — kept until you un-bookmark it"
                    : "Bookmark — keeps this entry until you un-bookmark it",
                Tag = entry.Id
            };
            bookmarkBtn.Click += BookmarkToggle_Click;
            Grid.SetColumn(bookmarkBtn, 2);
            grid.Children.Add(bookmarkBtn);

            return new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                CornerRadius = new CornerRadius(6),
                Margin = new Thickness(4, 2, 4, 2),
                Child = grid
            };
        }

        /// <summary>Toggles bookmark state for the entry this button's <c>Tag</c> (its real
        /// <see cref="Guid"/>) references, then re-renders so the tray reflects the change live —
        /// not just from the original floating toast (#3878), per this issue's own verification ask.</summary>
        private void BookmarkToggle_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button { Tag: Guid id } button) return;

            var current = NotificationHistoryStore.All;
            var entry = System.Linq.Enumerable.FirstOrDefault(current, x => x.Id == id);
            if (entry == null) return;

            NotificationHistoryStore.SetBookmarked(id, !entry.Bookmarked);
            Refresh();
        }

        /// <summary>Real "Clear All" — removes every non-bookmarked entry; bookmarked entries stay,
        /// per Shane's own explicit ask (that's the entire point of bookmarking).</summary>
        private void BtnClearAll_Click(object sender, RoutedEventArgs e)
        {
            NotificationHistoryStore.ClearAllNonBookmarked();
            Refresh();
        }
    }
}
