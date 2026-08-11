using System;
using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    public class LogEntry
    {
        public string Icon { get; set; } = "•";
        public Brush IconColor { get; set; } = Brushes.Gray;
        public string Time { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public Brush DescColor { get; set; } = Brushes.White;
    }

    public partial class BuildLogView : UserControl
    {
        private readonly ObservableCollection<LogEntry> _logEntries = new();

        private static readonly SolidColorBrush BlueBrush  = Frozen(0x89, 0xB4, 0xFA);
        private static readonly SolidColorBrush GreenBrush = Frozen(0xA6, 0xE3, 0xA1);
        private static readonly SolidColorBrush RedBrush   = Frozen(0xF3, 0x8B, 0xA8);
        private static readonly SolidColorBrush MauveBrush = Frozen(0xC0, 0xA0, 0xF8);
        private static readonly SolidColorBrush TextBrush  = Frozen(0xCD, 0xD6, 0xF4);
        private static readonly SolidColorBrush Subtext    = Frozen(0xBA, 0xC2, 0xDE);

        private static SolidColorBrush Frozen(byte r, byte g, byte b)
        {
            var b2 = new SolidColorBrush(Color.FromRgb(r, g, b));
            b2.Freeze();
            return b2;
        }

        public BuildLogView()
        {
            InitializeComponent();
            LogList.ItemsSource = _logEntries;
        }

        public void LoadTaskLog(string epic, string task, string status, string statusDetails)
        {
            EmptyState.Visibility = Visibility.Collapsed;
            _logEntries.Clear();

            EpicLabel.Text = epic;
            TaskLabel.Text = task;
            StatusBadgeText.Text = status;
            ElapsedLabel.Text = "00:02:14";

            if (status.Equals("In Progress", StringComparison.OrdinalIgnoreCase))
            {
                HeaderDot.Fill = BlueBrush;
                HeaderVerb.Text = "BUILDING TASK";
                StatusBadgeText.Foreground = BlueBrush;

                AddEntry("▶", BlueBrush, "18:04:01", $"Started task '{task}' in epic [{epic}]", TextBrush);
                AddEntry("⚡", MauveBrush, "18:04:02", "Invoking tool: git_status()", Subtext);
                AddEntry("✓", GreenBrush, "18:04:03", "Tool git_status returned clean working directory", Subtext);
                AddEntry("⚡", MauveBrush, "18:04:05", "Invoking tool: replace_file_content(MainWindow.xaml)", Subtext);
                AddEntry("✓", GreenBrush, "18:04:06", "Successfully updated layout controls", Subtext);
                AddEntry("⚡", MauveBrush, "18:04:10", "Running command: dotnet build --configuration Release", Subtext);
                AddEntry("⚙", BlueBrush, "18:04:12", "Build in progress... compiling WPF project components...", TextBrush);
            }
            else if (status.Equals("Blocked", StringComparison.OrdinalIgnoreCase))
            {
                HeaderDot.Fill = RedBrush;
                HeaderVerb.Text = "TASK BLOCKED";
                StatusBadgeText.Foreground = RedBrush;

                AddEntry("▶", BlueBrush, "18:00:10", $"Started task '{task}' in epic [{epic}]", TextBrush);
                AddEntry("⚡", MauveBrush, "18:00:11", "Invoking tool: check_dependencies()", Subtext);
                AddEntry("⚠️", RedBrush, "18:00:12", $"DEPENDENCY BLOCKER: {statusDetails}", RedBrush);
                AddEntry("✖", RedBrush, "18:00:13", "Execution paused. Waiting for blocker resolution before retry.", RedBrush);
            }
            else if (status.Equals("Done", StringComparison.OrdinalIgnoreCase))
            {
                HeaderDot.Fill = GreenBrush;
                HeaderVerb.Text = "TASK COMPLETED";
                StatusBadgeText.Foreground = GreenBrush;

                AddEntry("▶", BlueBrush, "17:30:00", $"Started task '{task}' in epic [{epic}]", TextBrush);
                AddEntry("⚡", MauveBrush, "17:30:15", "Running verification suite...", Subtext);
                AddEntry("✓", GreenBrush, "17:30:45", "All 14 unit & UI tests passed cleanly.", GreenBrush);
                AddEntry("✓", GreenBrush, "17:30:46", "Task finished with status SUCCESS (0 warnings, 0 errors).", GreenBrush);
            }
            else
            {
                HeaderDot.Fill = Subtext;
                HeaderVerb.Text = "PENDING TASK";
                StatusBadgeText.Foreground = Subtext;

                AddEntry("⌛", Subtext, "18:05:00", $"Task '{task}' is queued for execution.", Subtext);
            }
        }

        private void AddEntry(string icon, Brush iconColor, string time, string desc, Brush descColor)
        {
            _logEntries.Add(new LogEntry
            {
                Icon = icon,
                IconColor = iconColor,
                Time = time,
                Description = desc,
                DescColor = descColor
            });
        }
    }
}
