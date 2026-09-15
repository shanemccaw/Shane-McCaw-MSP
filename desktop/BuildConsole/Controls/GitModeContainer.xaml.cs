using System.Windows.Controls;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git Mode container control (Phase 1 Shell).
    /// Holds the Git Mode header bar and 3-panel placeholder layout:
    ///   - Left Panel: Epic Tree Placeholder
    ///   - Middle Panel: Issue Grid Placeholder
    ///   - Right Panel: Issue Details Placeholder
    /// </summary>
    public partial class GitModeContainer : UserControl
    {
        public GitModeContainer()
        {
            InitializeComponent();
        }
    }
}
