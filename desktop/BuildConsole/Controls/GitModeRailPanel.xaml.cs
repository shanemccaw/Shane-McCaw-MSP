using System;
using System.Windows;
using System.Windows.Controls;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #4247 — the Git Mode left rail, modelled directly on
    /// <see cref="TestModeDiagnosticsPanel"/>'s collapsed(48px)/expanded(300px) rail idiom.
    /// It occupies Grid.Column 0 (the ActivityBar column) while Git Mode is active — a
    /// column-scoped control, NOT the old full-span translucent overlay that let the still-open
    /// document tabs bleed through.
    ///
    /// This rail is Git Mode's chrome + actions only. The real epic/issue TREE is the
    /// LeftSidebar's own Git Board view (switched to "Issues" on enter), and issue detail
    /// renders in the right-hand <see cref="GitModeIssueDetailPanel"/>. The rail does not
    /// rebuild any of that — the exact reuse discipline Test Mode already follows.
    /// </summary>
    public partial class GitModeRailPanel : UserControl
    {
        /// <summary>Fires with the new expanded state so MainWindow can widen/narrow ColActivityBar
        /// (48 ↔ 300), the same way TestModeDiagnosticsPanel.ExpansionChanged drives it.</summary>
        public event Action<bool>? ExpansionChanged;

        /// <summary>Open (or focus) the Dependency Graph document tab.</summary>
        public event Action? OpenGraphRequested;

        /// <summary>Refresh the Git Board tree.</summary>
        public event Action? RefreshBoardRequested;

        /// <summary>Leave Git Mode.</summary>
        public event Action? ExitGitModeRequested;

        private bool _isExpanded;

        public bool IsExpanded
        {
            get => _isExpanded;
            set
            {
                _isExpanded = value;
                RailCollapsed.Visibility = _isExpanded ? Visibility.Collapsed : Visibility.Visible;
                PanelExpanded.Visibility = _isExpanded ? Visibility.Visible : Visibility.Collapsed;
                Width = _isExpanded ? 300 : 48;
                ExpansionChanged?.Invoke(_isExpanded);
            }
        }

        public GitModeRailPanel()
        {
            InitializeComponent();
        }

        private void BtnExpandRail_Click(object sender, RoutedEventArgs e) => IsExpanded = true;

        private void BtnCollapseRail_Click(object sender, RoutedEventArgs e) => IsExpanded = false;

        private void RailBtnGraph_Click(object sender, RoutedEventArgs e) => OpenGraphRequested?.Invoke();

        private void RailBtnRefresh_Click(object sender, RoutedEventArgs e) => RefreshBoardRequested?.Invoke();

        private void RailBtnExit_Click(object sender, RoutedEventArgs e) => ExitGitModeRequested?.Invoke();
    }
}
