using System;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    public partial class LeftSidebar : UserControl
    {
        private string _currentView = "Chats";
        private const string RootWorkspacePath = @"C:\Source\ShaneMcCawConsulting\Shane-McCaw-MSP";

        public LeftSidebar()
        {
            InitializeComponent();
            LoadWorkspaceExplorer(RootWorkspacePath);
        }

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

            if (view == "Explorer" && ExplorerTree.Items.Count == 0)
            {
                LoadWorkspaceExplorer(RootWorkspacePath);
            }
        }

        public void LoadWorkspaceExplorer(string rootPath)
        {
            ExplorerTree.Items.Clear();
            if (!Directory.Exists(rootPath)) return;

            var rootDir = new DirectoryInfo(rootPath);
            var rootNode = CreateDirectoryNode(rootDir);
            rootNode.IsExpanded = true;
            ExplorerTree.Items.Add(rootNode);
        }

        private TreeViewItem CreateDirectoryNode(DirectoryInfo dir)
        {
            var item = new TreeViewItem
            {
                Tag = dir.FullName,
                Header = CreateHeaderPanel("\uE838", dir.Name, FrozenBrush(0xFA, 0xB3, 0x87), isBold: true)
            };

            item.Items.Add(new TreeViewItem { Header = "Loading..." });
            item.Expanded += DirectoryNode_Expanded;
            return item;
        }

        private void DirectoryNode_Expanded(object sender, RoutedEventArgs e)
        {
            if (sender is TreeViewItem dirNode && dirNode.Tag is string path)
            {
                if (dirNode.Items.Count == 1 && dirNode.Items[0] is TreeViewItem dummy && dummy.Header?.ToString() == "Loading...")
                {
                    dirNode.Items.Clear();
                    try
                    {
                        var dirInfo = new DirectoryInfo(path);

                        foreach (var subDir in dirInfo.GetDirectories())
                        {
                            // Skip hidden system/cache folders if wanted, but list repo folders
                            if (subDir.Name.Equals(".git", StringComparison.OrdinalIgnoreCase) ||
                                subDir.Name.Equals("node_modules", StringComparison.OrdinalIgnoreCase) ||
                                subDir.Name.Equals("bin", StringComparison.OrdinalIgnoreCase) ||
                                subDir.Name.Equals("obj", StringComparison.OrdinalIgnoreCase))
                            {
                                continue;
                            }

                            dirNode.Items.Add(CreateDirectoryNode(subDir));
                        }

                        foreach (var file in dirInfo.GetFiles())
                        {
                            dirNode.Items.Add(CreateFileNode(file));
                        }
                    }
                    catch (Exception ex)
                    {
                        dirNode.Items.Add(new TreeViewItem { Header = $"Access Denied: {ex.Message}" });
                    }
                }
            }
        }

        private TreeViewItem CreateFileNode(FileInfo file)
        {
            var (icon, color) = GetFileIconAndColor(file.Extension);
            var item = new TreeViewItem
            {
                Tag = file.FullName,
                Header = CreateHeaderPanel(icon, file.Name, color, isBold: false)
            };
            return item;
        }

        private StackPanel CreateHeaderPanel(string iconText, string text, Brush foreground, bool isBold)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal };
            var iconBlock = new TextBlock
            {
                Text = iconText,
                FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            if (iconText.Length == 1 && iconText[0] >= 0xE000)
            {
                iconBlock.FontFamily = new FontFamily("Segoe MDL2 Assets");
                iconBlock.Foreground = foreground;
            }

            var textBlock = new TextBlock
            {
                Text = text,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = isBold ? (Brush)FindResource("TextBrush") : foreground
            };
            if (isBold) textBlock.FontWeight = FontWeights.SemiBold;

            sp.Children.Add(iconBlock);
            sp.Children.Add(textBlock);
            return sp;
        }

        private (string icon, Brush color) GetFileIconAndColor(string ext)
        {
            switch (ext.ToLowerInvariant())
            {
                case ".cs":
                    return ("⚡", FrozenBrush(0x89, 0xB4, 0xFA)); // Blue
                case ".xaml":
                    return ("🎨", FrozenBrush(0xCB, 0xA6, 0xF7)); // Mauve
                case ".ts":
                case ".tsx":
                case ".js":
                case ".jsx":
                    return ("⚛", FrozenBrush(0x89, 0xDC, 0xEB)); // Cyan
                case ".json":
                case ".config":
                case ".yaml":
                case ".yml":
                    return ("⚙", FrozenBrush(0xA6, 0xE3, 0xA1)); // Green
                case ".csproj":
                case ".sln":
                    return ("📦", FrozenBrush(0xF3, 0x8B, 0xA8)); // Red
                case ".md":
                case ".txt":
                case ".log":
                    return ("📝", FrozenBrush(0x94, 0xE2, 0xD5)); // Teal
                case ".gitignore":
                    return ("🔀", FrozenBrush(0xFA, 0xB3, 0x87)); // Orange
                default:
                    return ("📄", FrozenBrush(0xCD, 0xD6, 0xF4)); // Text
            }
        }

        private static SolidColorBrush FrozenBrush(byte r, byte g, byte b)
        {
            var b2 = new SolidColorBrush(Color.FromRgb(r, g, b));
            b2.Freeze();
            return b2;
        }

        private void CollapseAll_Click(object sender, RoutedEventArgs e)
        {
            // Collapse all top-level nodes in the active tree
            var tree = _currentView == "Explorer" ? ExplorerTree : ChatsTree;
            foreach (var item in tree.Items)
            {
                if (tree.ItemContainerGenerator.ContainerFromItem(item) is TreeViewItem tvi)
                    tvi.IsExpanded = false;
            }
        }
    }
}
