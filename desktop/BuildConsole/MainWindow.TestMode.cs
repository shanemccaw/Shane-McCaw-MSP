using System;
using System.Windows;

namespace BuildConsole
{
    /// <summary>
    /// Test Mode state management for MainWindow.
    /// Converts the application into Test Mode:
    ///   - Left panel icons slide out and get replaced with a blank Icon panel
    ///   - Left sidebar collapses (if open), keeping the left edge clean
    ///   - Right panel is replaced with an empty panel 540 px wide
    /// 
    /// Exiting Test Mode (via Ctrl+K "I'm done" or Ctrl+Shift+T):
    ///   - Restores left panel icons (slide back in)
    ///   - Restores left sidebar width &amp; pin state
    ///   - Restores right panel (Build Queue restored to previous width)
    /// </summary>
    public partial class MainWindow
    {
        private bool _isTestMode;
        public bool IsTestMode => _isTestMode;

        private GridLength _savedColSidebarWidth = new(260);
        private GridLength _savedColQueueWidth = new(300);
        private bool _savedQueuePinned = true;
        private Visibility _savedSidebarSplitterVisibility = Visibility.Visible;

        /// <summary>Toggle Test Mode on or off.</summary>
        public void ToggleTestMode()
        {
            if (_isTestMode)
                ExitTestMode();
            else
                EnterTestMode();
        }

        /// <summary>
        /// Converts the app into Test Mode:
        /// Left icons slide out to reveal blank icon panel; right panel replaced with 540px empty panel.
        /// </summary>
        public void EnterTestMode()
        {
            if (_isTestMode)
            {
                ToastEngine.Warning("Test Mode", "Already in Test Mode. Type \"I'm done\" or press Ctrl+Shift+T to exit.");
                return;
            }

            _isTestMode = true;

            // 1. Save current workspace layout state
            _savedColSidebarWidth = ColSidebar.Width;
            _savedColQueueWidth = ColQueue.Width;
            _savedQueuePinned = _queuePinned;
            _savedSidebarSplitterVisibility = SidebarSplitter.Visibility;

            // 2. Left panel icons slide out and get replaced with a blank Icon panel
            ActivityBar.EnterTestMode(animate: true);

            // Collapse left sidebar so only the blank icon panel is present on the left
            if (ColSidebar.Width.Value > 0)
            {
                ColSidebar.Width = new GridLength(0);
                SidebarSplitter.Visibility = Visibility.Collapsed;
                LeftSidebar.SyncPinState(false);
            }

            // 3. Right panel is replaced with an empty panel 540 px wide
            BuildQueuePanel.Visibility = Visibility.Collapsed;
            TestModeEmptyRightPanel.Visibility = Visibility.Visible;
            ColQueue.Width = new GridLength(540);

            ToastEngine.Success("Test Mode", "Entered Test Mode — Left icons slid out, 540px right panel active. (Type \"I'm done\" in Ctrl+K or press Ctrl+Shift+T to exit)");
        }

        /// <summary>
        /// Exits Test Mode and restores workspace layout back to what it was right before entering.
        /// </summary>
        public void ExitTestMode()
        {
            if (!_isTestMode)
            {
                ToastEngine.Warning("Test Mode", "Already in normal mode.");
                return;
            }

            _isTestMode = false;

            // 1. Restore left panel icons (slide back in)
            ActivityBar.ExitTestMode(animate: true);

            // 2. Restore left sidebar
            ColSidebar.Width = _savedColSidebarWidth.Value > 0 ? _savedColSidebarWidth : new GridLength(0);
            SidebarSplitter.Visibility = _savedSidebarSplitterVisibility;
            LeftSidebar.SyncPinState(ColSidebar.Width.Value > 0);

            // 3. Restore right panel (replace empty panel with Build Queue, restore width)
            TestModeEmptyRightPanel.Visibility = Visibility.Collapsed;
            BuildQueuePanel.Visibility = Visibility.Visible;
            _queuePinned = _savedQueuePinned;
            ColQueue.Width = _savedColQueueWidth.Value > 0 ? _savedColQueueWidth : new GridLength(DefaultQueueWidth);
            UpdateColQueueWidth();

            ToastEngine.Success("Test Mode", "Exited Test Mode — Workspace restored to previous layout.");
        }

        private void BtnExitTestMode_Click(object sender, RoutedEventArgs e)
        {
            ExitTestMode();
        }

        private void MenuToggleTestMode_Click(object sender, RoutedEventArgs e)
        {
            ToggleTestMode();
        }
    }
}
