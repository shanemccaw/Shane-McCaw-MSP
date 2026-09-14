using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #3981 — shared modal single-line text prompt, same window/box/button chrome as
    /// <c>BuildQueuePanel.PromptForReplyMessage</c>/<c>PromptForNoteText</c>. Used for the
    /// bug-lifecycle "Not a Bug" resolution reason, which the DB's
    /// <c>chk_vtt_resolution_reason</c> CHECK constraint requires whenever
    /// <c>resolution = 'NotABug'</c>. Returns the trimmed text, or null on cancel/empty.
    /// </summary>
    internal static class SimpleTextPromptDialog
    {
        public static string? Show(FrameworkElement owner, string title, string message)
        {
            var win = new Window
            {
                Title = title,
                Width = 480,
                Height = 220,
                Owner = Window.GetWindow(owner),
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E))
            };

            var root = new DockPanel { Margin = new Thickness(14) };

            var header = new TextBlock
            {
                Text = message,
                Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xC2, 0xDE)),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 10)
            };
            DockPanel.SetDock(header, Dock.Top);
            root.Children.Add(header);

            var buttons = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 10, 0, 0)
            };
            DockPanel.SetDock(buttons, Dock.Bottom);

            string? result = null;

            var box = new TextBox
            {
                AcceptsReturn = false,
                TextWrapping = TextWrapping.Wrap,
                Background = new SolidColorBrush(Color.FromRgb(0x18, 0x18, 0x25)),
                Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                CaretBrush = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8),
                FontSize = 13,
                MinHeight = 60
            };
            box.KeyDown += (_, e) =>
            {
                if (e.Key == Key.Enter)
                {
                    result = box.Text?.Trim();
                    win.DialogResult = !string.IsNullOrEmpty(result);
                }
            };

            var cancel = new Button { Content = "Cancel", Padding = new Thickness(14, 6, 14, 6), IsCancel = true };
            cancel.Click += (_, _) => win.DialogResult = false;

            var save = new Button { Content = "Save  (Enter)", Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(14, 6, 14, 6), IsDefault = true };
            save.Click += (_, _) =>
            {
                result = box.Text?.Trim();
                win.DialogResult = !string.IsNullOrEmpty(result);
            };

            buttons.Children.Add(cancel);
            buttons.Children.Add(save);
            root.Children.Add(buttons);
            root.Children.Add(box); // last child fills the remaining space

            win.Content = root;
            win.Loaded += (_, _) => box.Focus();
            return win.ShowDialog() == true ? result : null;
        }
    }
}
