using System;
using System.Windows;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #1480 — "paste a full prompt" entry point next to the pause/running
    /// toggle in the Build Queue panel header. Kept in its own partial-class file
    /// for the same reason BuildQueuePanel.QueuePause.cs is: independent of the
    /// heavily co-edited main BuildQueuePanel.xaml.cs.
    ///
    /// This button doesn't own any queueing logic itself — it raises
    /// <see cref="NewBuildPasteRequested"/> and MainWindow (which already holds
    /// the queue DB client, the local-id resolver, and the pending-update-restart
    /// spillover path) opens the real EditBuildPromptDialog and processes its
    /// result exactly like the chat-injected "Edit Build" (BT_EDIT_BUILD) button
    /// does — same header-flag parsing (--model, --effort, --title, --buildSet,
    /// --account, --blocked-by/--block-by, --notGit), same "Add to Build Queue" /
    /// "Send to Builder" choice.
    /// </summary>
    public partial class BuildQueuePanel
    {
        /// <summary>Raised when the header's paste-prompt button is clicked. MainWindow
        /// subscribes and opens EditBuildPromptDialog with an empty starting prompt.</summary>
        public event EventHandler? NewBuildPasteRequested;

        private void BtnNewBuildFromPaste_Click(object sender, RoutedEventArgs e)
        {
            NewBuildPasteRequested?.Invoke(this, EventArgs.Empty);
        }
    }
}
