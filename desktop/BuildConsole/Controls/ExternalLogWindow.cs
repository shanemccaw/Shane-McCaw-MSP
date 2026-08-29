using System;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #1638 — the ad-hoc log viewer promised by the locked "Send to Builder" tracking
    /// decision: a "Send to Builder" launch (status 'external' in bt_build_queue) is
    /// deliberately never admitted into Build Watch's 8-slot grid, but its real stdout/stderr
    /// is now genuinely captured (scripts/run-claude.ps1 redirects into the exact same
    /// BuildLogPaths.ForQueueItem(id) convention the in-app watcher already uses for tracked
    /// builds — see BuildLogPaths.cs / MainWindow.TailBuildLog). This is a standalone,
    /// non-modal, self-contained live tail of that one file — reused viewing logic, not a
    /// second admission path into the slot grid.
    /// </summary>
    public static class ExternalLogWindow
    {
        public static void ShowFor(int queueId, string title)
        {
            var path = Services.BuildLogPaths.ForQueueItem(queueId);

            var win = new Window
            {
                Title = $"External Log — {title} (queue #{queueId})",
                Width = 820,
                Height = 560,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E))
            };

            var root = new DockPanel { Margin = new Thickness(10) };

            var header = new TextBlock
            {
                Text = File.Exists(path) ? path : $"{path}  (not written yet — waiting for the launch to start producing output)",
                Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xC2, 0xDE)),
                FontSize = 11,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 6)
            };
            DockPanel.SetDock(header, Dock.Top);
            root.Children.Add(header);

            var box = new TextBox
            {
                IsReadOnly = true,
                TextWrapping = TextWrapping.NoWrap,
                FontFamily = new FontFamily("Consolas, Cascadia Mono, monospace"),
                FontSize = 12,
                Background = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)),
                Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                BorderThickness = new Thickness(0),
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto
            };
            root.Children.Add(box);
            win.Content = root;

            long tailedLength = 0;
            void Tail()
            {
                try
                {
                    if (!File.Exists(path)) return;
                    using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                    if (fs.Length < tailedLength) tailedLength = 0; // file truncated/replaced — start over
                    if (fs.Length <= tailedLength) return;
                    fs.Seek(tailedLength, SeekOrigin.Begin);
                    using var reader = new StreamReader(fs);
                    string newText = reader.ReadToEnd();
                    tailedLength = fs.Length;
                    box.AppendText(newText);
                    box.ScrollToEnd();
                }
                catch { /* file locked mid-write — just retry next tick, same as TailBuildLog */ }
            }

            Tail();
            var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            timer.Tick += (_, _) => Tail();
            timer.Start();
            win.Closed += (_, _) => timer.Stop();

            win.Show();
        }
    }
}
