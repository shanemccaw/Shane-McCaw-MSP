using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>Git #2548 §7 — one selectable destination for a cross-epic question: another open
    /// chat tab, identified by its conversation id (the real return/target address) and its epic.</summary>
    public readonly struct ChatEpicTarget
    {
        public string ConversationId { get; init; }
        public int? EpicNumber { get; init; }
        public string EpicName { get; init; }
        public override string ToString()
            => (EpicNumber.HasValue ? $"#{EpicNumber.Value} " : "") + EpicName;
    }

    /// <summary>Git #2548 §7 — the "ASK THAT CHAT" prompt: pick a destination epic's chat, type a
    /// question (three presets from the doc), and take it there. Built in code (no XAML) to keep the
    /// round-trip self-contained; the warm palette matches the chat document.</summary>
    public sealed class CrossEpicAskDialog : Window
    {
        private readonly ComboBox _targets;
        private readonly TextBox _question;

        public ChatEpicTarget? SelectedTarget =>
            _targets.SelectedItem is ChatEpicTarget t ? t : (ChatEpicTarget?)null;
        public string QuestionText => _question.Text ?? "";

        private static readonly string[] Presets =
        {
            "Does this already exist? Show me the closed issues and the evidence.",
            "Is there a monitoring API on this side? Where does it live?",
            "What is actually left open here?",
        };

        public CrossEpicAskDialog(IReadOnlyList<ChatEpicTarget> targets)
        {
            Title = "Ask that chat";
            Width = 460; SizeToContent = SizeToContent.Height;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            ResizeMode = ResizeMode.NoResize;
            Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1a1a19"));

            var root = new StackPanel { Margin = new Thickness(16) };

            root.Children.Add(Label("ASK THAT CHAT"));

            _targets = new ComboBox { Margin = new Thickness(0, 8, 0, 0), Height = 28 };
            foreach (var t in targets) _targets.Items.Add(t);
            if (_targets.Items.Count > 0) _targets.SelectedIndex = 0;
            root.Children.Add(_targets);

            _question = new TextBox
            {
                Margin = new Thickness(0, 12, 0, 0), MinHeight = 66, AcceptsReturn = true,
                TextWrapping = TextWrapping.Wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#0d0f10")),
                Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#ece9e4")),
                BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#302f2d")),
                FontSize = 12, Padding = new Thickness(6)
            };
            root.Children.Add(_question);

            var presets = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
            foreach (var p in Presets)
            {
                var b = new Button
                {
                    Content = new TextBlock { Text = p, TextWrapping = TextWrapping.Wrap, FontSize = 10 },
                    Margin = new Thickness(0, 0, 6, 6), Padding = new Thickness(7, 3, 7, 3),
                    MaxWidth = 420, Cursor = System.Windows.Input.Cursors.Hand,
                    Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#232320")),
                    Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#c2c0bc")),
                    BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#35342f"))
                };
                string preset = p;
                b.Click += (_, _) => _question.Text = preset;
                presets.Children.Add(b);
            }
            root.Children.Add(presets);

            var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 10, 0, 0) };
            var cancel = new Button { Content = "Cancel", Width = 84, Height = 28, Margin = new Thickness(0, 0, 8, 0), Cursor = System.Windows.Input.Cursors.Hand };
            cancel.Click += (_, _) => { DialogResult = false; Close(); };
            var go = new Button
            {
                Content = "Take it to that chat", Height = 28, Padding = new Thickness(12, 0, 12, 0),
                Cursor = System.Windows.Input.Cursors.Hand,
                Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#d97757")),
                Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1a0f0a"))
            };
            go.Click += (_, _) =>
            {
                if (SelectedTarget == null || string.IsNullOrWhiteSpace(QuestionText)) { DialogResult = false; }
                else { DialogResult = true; }
                Close();
            };
            actions.Children.Add(cancel);
            actions.Children.Add(go);
            root.Children.Add(actions);

            Content = root;
        }

        private static TextBlock Label(string t) => new TextBlock
        {
            Text = t, FontSize = 9, FontWeight = FontWeights.ExtraBold,
            Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#7a7975"))
        };
    }
}
