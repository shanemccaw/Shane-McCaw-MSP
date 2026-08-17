using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Global "Queue Paused / Running" toggle for the Build Queue panel header —
    /// kept in its own partial-class file so it stays independent of the heavily
    /// co-edited main BuildQueuePanel.xaml.cs.
    ///
    /// This is a per-instance switch on the in-app queue processor
    /// (<see cref="QueueWatcherService"/>), completely separate from any single
    /// build's own Stop. While paused, queuing new items keeps working exactly as
    /// before; the processor simply doesn't pick up and START any new queued item
    /// — nothing begins running until Play/Resume is pressed. Builds already
    /// running when Pause is pressed continue to completion untouched.
    ///
    /// The pause state lives entirely in QueueWatcherService (and is in-memory /
    /// per-app-instance), so the app always comes up "Running". Because this
    /// button is the only thing that ever changes that state, the button's visual
    /// is simply synced on each click — no startup ordering dependency on
    /// Initialize(), which is why this needs no hook there.
    /// </summary>
    public partial class BuildQueuePanel
    {
        private void BtnPauseQueue_Click(object sender, RoutedEventArgs e)
        {
            // No in-app watcher (API not configured, or claude.exe not found) —
            // there's no processor to pause. Say so rather than silently no-op.
            if (_watcher == null)
            {
                ToastEngine.Info("Queue", "The in-app build queue watcher isn't active, so there's nothing to pause.");
                return;
            }

            _watcher.SetPaused(!_watcher.IsPaused);
            SyncPauseToggleVisual(_watcher.IsPaused);
            ActivityLog.Log("build-queue-panel", _watcher.IsPaused
                ? "Queue paused via header toggle."
                : "Queue resumed via header toggle.");
        }

        /// <summary>Reflects the current pause state onto the header toggle: glyph, label, colour and tooltip. Paused reads in the app's peach accent so it's unmistakable; running is the quiet default IconButton foreground.</summary>
        private void SyncPauseToggleVisual(bool paused)
        {
            var accent = (Brush)Application.Current.FindResource("PeachBrush");
            var runningAccent = (Brush)Application.Current.FindResource("GreenBrush");
            var quiet = (Brush)Application.Current.FindResource("Subtext1Brush");

            PauseQueueIcon.Text = paused ? "\uE768" : "\uE769";
            PauseQueueLabel.Text = paused ? "Paused" : "Running";
            PauseQueueIcon.Foreground = paused ? accent : runningAccent;
            PauseQueueLabel.Foreground = paused ? accent : quiet;
            BtnPauseQueue.ToolTip = paused
                ? "Queue paused — new items won't start. Click to resume."
                : "Queue running — click to pause (already-running builds keep going; no new items start until resumed).";
        }
    }
}
