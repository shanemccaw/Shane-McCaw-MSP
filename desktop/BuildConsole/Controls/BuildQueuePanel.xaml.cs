using System;
using System.Windows;
using System.Windows.Controls;

namespace BuildConsole.Controls
{
    public class TaskSelectedEventArgs : EventArgs
    {
        public string Epic { get; set; } = string.Empty;
        public string Task { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string StatusDetails { get; set; } = string.Empty;
    }

    public partial class BuildQueuePanel : UserControl
    {
        public event EventHandler<TaskSelectedEventArgs>? TaskSelected;

        public BuildQueuePanel() => InitializeComponent();

        private void QueueTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is string tagData)
            {
                var parts = tagData.Split('|');
                if (parts.Length >= 3)
                {
                    TaskSelected?.Invoke(this, new TaskSelectedEventArgs
                    {
                        Epic = parts[0],
                        Task = parts[1],
                        Status = parts[2],
                        StatusDetails = parts.Length > 3 ? parts[3] : string.Empty
                    });
                }
            }
        }
    }
}
