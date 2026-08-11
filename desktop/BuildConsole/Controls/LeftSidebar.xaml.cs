using System.Windows;
using System.Windows.Controls;

namespace BuildConsole.Controls
{
    public partial class LeftSidebar : UserControl
    {
        private string _currentView = "Chats";

        public LeftSidebar() => InitializeComponent();

        /// <summary>Returns the currently displayed view name.</summary>
        public string GetCurrentView() => _currentView;

        /// <summary>Switch the visible content panel based on the activity bar selection.</summary>
        public void SwitchView(string view)
        {
            _currentView = view;
            ChatsView.Visibility    = view == "Chats"    ? Visibility.Visible : Visibility.Collapsed;
            ExplorerView.Visibility = view == "Explorer" ? Visibility.Visible : Visibility.Collapsed;
            SearchView.Visibility   = view == "Search"   ? Visibility.Visible : Visibility.Collapsed;
            GitView.Visibility      = view == "Git"      ? Visibility.Visible : Visibility.Collapsed;
            SettingsView.Visibility = view == "Settings" ? Visibility.Visible : Visibility.Collapsed;

            HeaderTitle.Text = view.ToUpperInvariant();

            // Adjust the New button tooltip to match the active view
            BtnNewItem.ToolTip = view switch
            {
                "Chats"    => "New Chat",
                "Explorer" => "New File",
                "Search"   => "Search",
                "Git"      => "Commit",
                _          => "New"
            };
        }

        private void CollapseAll_Click(object sender, RoutedEventArgs e)
        {
            // Collapse all top-level nodes in the active tree
            foreach (var item in ChatsTree.Items)
            {
                if (ChatsTree.ItemContainerGenerator.ContainerFromItem(item) is TreeViewItem tvi)
                    tvi.IsExpanded = false;
            }
        }
    }
}
