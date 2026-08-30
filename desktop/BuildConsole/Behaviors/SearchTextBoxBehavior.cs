using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace BuildConsole.Behaviors
{
    /// <summary>
    /// Git #2000 — wires the inline "✕" clear button baked into the
    /// <c>SearchTextBox</c> control template (Themes/DarkTheme.xaml) plus
    /// Escape-to-clear, without any per-site code-behind. Turned on by the
    /// style itself via a Setter on <see cref="IsEnabledProperty"/>, so every
    /// TextBox that uses <c>Style="{StaticResource SearchTextBox}"</c> gets
    /// both behaviors automatically.
    ///
    /// Clearing always goes through <see cref="TextBox.Clear"/> (equivalent
    /// to setting Text=""), which raises the box's normal TextChanged event —
    /// the same path typing already uses, so every site's live filter/search
    /// re-runs exactly as it would on any other edit. No box needed special
    /// per-site wiring for this.
    ///
    /// Escape is opt-out via <see cref="HandlesEscapeProperty"/> (default on)
    /// for the one site — MainWindow's TitleSearchBox — that already owns a
    /// richer Escape behavior (closing the command-palette dropdown) which
    /// this must not race with; see MainWindow.UniversalSearch.cs instead,
    /// which was extended to also clear the text on Escape.
    /// </summary>
    public static class SearchTextBoxBehavior
    {
        public static readonly DependencyProperty IsEnabledProperty =
            DependencyProperty.RegisterAttached(
                "IsEnabled",
                typeof(bool),
                typeof(SearchTextBoxBehavior),
                new PropertyMetadata(false, OnIsEnabledChanged));

        public static bool GetIsEnabled(DependencyObject obj) => (bool)obj.GetValue(IsEnabledProperty);
        public static void SetIsEnabled(DependencyObject obj, bool value) => obj.SetValue(IsEnabledProperty, value);

        public static readonly DependencyProperty HandlesEscapeProperty =
            DependencyProperty.RegisterAttached(
                "HandlesEscape",
                typeof(bool),
                typeof(SearchTextBoxBehavior),
                new PropertyMetadata(true));

        public static bool GetHandlesEscape(DependencyObject obj) => (bool)obj.GetValue(HandlesEscapeProperty);
        public static void SetHandlesEscape(DependencyObject obj, bool value) => obj.SetValue(HandlesEscapeProperty, value);

        private static void OnIsEnabledChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        {
            if (d is not TextBox textBox) return;

            if ((bool)e.NewValue)
            {
                textBox.Loaded += TextBox_Loaded;
                textBox.PreviewKeyDown += TextBox_PreviewKeyDown;
                if (textBox.IsLoaded) HookClearButton(textBox);
            }
            else
            {
                textBox.Loaded -= TextBox_Loaded;
                textBox.PreviewKeyDown -= TextBox_PreviewKeyDown;
            }
        }

        private static void TextBox_Loaded(object sender, RoutedEventArgs e) => HookClearButton((TextBox)sender);

        private static void HookClearButton(TextBox textBox)
        {
            if (textBox.Template?.FindName("PART_ClearButton", textBox) is Button clearButton)
            {
                clearButton.Click -= ClearButton_Click;
                clearButton.Click += ClearButton_Click;
            }
        }

        private static void ClearButton_Click(object sender, RoutedEventArgs e)
        {
            if (sender is FrameworkElement { TemplatedParent: TextBox textBox })
            {
                textBox.Clear();
                textBox.Focus();
            }
        }

        private static void TextBox_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Escape) return;
            if (sender is not TextBox textBox) return;
            if (!GetHandlesEscape(textBox)) return;
            if (string.IsNullOrEmpty(textBox.Text)) return;

            textBox.Clear();
            e.Handled = true;
        }
    }
}
