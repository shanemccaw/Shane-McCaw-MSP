using System;
using System.Windows;
using System.Windows.Controls;

namespace BuildConsole.Controls
{
    public partial class ActivityBar : UserControl
    {
        /// <summary>Raised when the user clicks a different activity-bar icon.</summary>
        public event EventHandler<string>? ActiveViewChanged;

        /// <summary>Raised when the user clicks one of the quick navigation icons.</summary>
        public event EventHandler<string>? QuickNavRequested;

        public ActivityBar() => InitializeComponent();

        /// <summary>Git #834 — File > Settings menu item routes here so it lands on the SAME SettingsView the cog icon already opens, instead of being a second, divergent path.</summary>
        public void SelectSettings() => BtnSettings.IsChecked = true;

        private void Btn_Checked(object sender, RoutedEventArgs e)
        {
            if (sender is RadioButton rb)
                ActiveViewChanged?.Invoke(this, rb.Tag?.ToString() ?? "Chats");
        }

        private void QuickNav_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string url)
            {
                QuickNavRequested?.Invoke(this, url);
            }
        }
    }
}
