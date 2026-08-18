using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole
{
    public partial class StreamingConsoleWindow : Window
    {
        private static StreamingConsoleWindow? _instance;
        private readonly DispatcherTimer _timer;
        private string _filter = "";

        public static void OpenOrFocus()
        {
            if (_instance == null || !_instance.IsLoaded)
            {
                _instance = new StreamingConsoleWindow();
                _instance.Show();
            }
            else
            {
                if (_instance.WindowState == WindowState.Minimized)
                    _instance.WindowState = WindowState.Normal;
                _instance.Activate();
                _instance.Focus();
            }
        }

        public StreamingConsoleWindow()
        {
            InitializeComponent();

            _timer = new DispatcherTimer
            {
                Interval = TimeSpan.FromSeconds(1)
            };
            _timer.Tick += (s, e) => UpdateStatus();

            Loaded += OnLoaded;
            Unloaded += OnUnloaded;
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            var svc = ShaneAppStreamService.Instance;
            svc.StatusChanged += OnServiceStatusChanged;
            svc.LineAppended += OnLineAppended;

            _timer.Start();
            UpdateStatus();
            RebuildLogList();
        }

        private void OnUnloaded(object sender, RoutedEventArgs e)
        {
            _timer.Stop();
            var svc = ShaneAppStreamService.Instance;
            svc.StatusChanged -= OnServiceStatusChanged;
            svc.LineAppended -= OnLineAppended;
            _instance = null;
        }

        private void OnServiceStatusChanged()
        {
            Dispatcher.Invoke(UpdateStatus);
        }

        private void OnLineAppended(ShaneAppLogEntry entry)
        {
            Dispatcher.Invoke(() =>
            {
                if (PassesFilter(entry))
                {
                    var elem = CreateLogElement(entry);
                    LogListBox.Items.Add(elem);

                    if (ChkAutoScroll.IsChecked == true)
                    {
                        LogListBox.ScrollIntoView(elem);
                    }
                }
            });
        }

        private void UpdateStatus()
        {
            var svc = ShaneAppStreamService.Instance;
            if (svc.IsRunning)
            {
                StatusDot.Foreground = (Brush)FindResource("GreenBrush");
                StatusLabel.Text = "RUNNING";
                ActiveBadge.BorderBrush = (Brush)FindResource("GreenBrush");
                ActiveBadge.Background = new SolidColorBrush(Color.FromArgb(0x33, 0xA6, 0xE3, 0xA1));

                var elapsed = svc.Elapsed;
                HeaderActionText.Text = $"{svc.CurrentAction} · {elapsed.Minutes:D2}:{elapsed.Seconds:D2}";
                HeaderActionText.Foreground = (Brush)FindResource("TextBrush");
            }
            else
            {
                StatusDot.Foreground = (Brush)FindResource("Subtext0Brush");
                StatusLabel.Text = "IDLE";
                ActiveBadge.BorderBrush = (Brush)FindResource("Surface1Brush");
                ActiveBadge.Background = (Brush)FindResource("Surface0Brush");

                HeaderActionText.Text = svc.CurrentAction == "Idle" ? "Idle" : $"Last: {svc.CurrentAction}";
                HeaderActionText.Foreground = (Brush)FindResource("Subtext0Brush");
            }
        }

        private void RebuildLogList()
        {
            LogListBox.Items.Clear();
            var entries = ShaneAppStreamService.Instance.LogEntries;
            foreach (var entry in entries)
            {
                if (PassesFilter(entry))
                {
                    LogListBox.Items.Add(CreateLogElement(entry));
                }
            }

            if (ChkAutoScroll.IsChecked == true && LogListBox.Items.Count > 0)
            {
                LogListBox.ScrollIntoView(LogListBox.Items[^1]);
            }
        }

        private bool PassesFilter(ShaneAppLogEntry entry)
        {
            if (string.IsNullOrWhiteSpace(_filter)) return true;
            return entry.Message.IndexOf(_filter, StringComparison.OrdinalIgnoreCase) >= 0 ||
                   entry.Channel.IndexOf(_filter, StringComparison.OrdinalIgnoreCase) >= 0 ||
                   entry.Level.ToString().IndexOf(_filter, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private UIElement CreateLogElement(ShaneAppLogEntry entry)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal };

            Brush SafeBrush(string key, Brush fallback) =>
                (TryFindResource(key) as Brush) ?? (Application.Current?.TryFindResource(key) as Brush) ?? fallback;

            // Timestamp
            sp.Children.Add(new TextBlock
            {
                Text = $"[{entry.Timestamp:HH:mm:ss.fff}] ",
                Foreground = SafeBrush("Subtext0Brush", Brushes.Gray),
                FontSize = 11
            });

            // Level Tag
            var tagBrush = entry.Level switch
            {
                ShaneAppLogLevel.Success => SafeBrush("GreenBrush", Brushes.LightGreen),
                ShaneAppLogLevel.Error => SafeBrush("RedBrush", Brushes.Salmon),
                ShaneAppLogLevel.Warning => SafeBrush("YellowBrush", Brushes.Khaki),
                ShaneAppLogLevel.Sql => SafeBrush("SkyBrush", Brushes.SkyBlue),
                ShaneAppLogLevel.PowerShell => SafeBrush("MauveBrush", Brushes.MediumPurple),
                ShaneAppLogLevel.Test => SafeBrush("BlueBrush", Brushes.CornflowerBlue),
                _ => SafeBrush("Subtext1Brush", Brushes.LightGray)
            };

            var tagText = $"[{entry.Level.ToString().ToUpperInvariant()}] ";
            sp.Children.Add(new TextBlock
            {
                Text = tagText,
                Foreground = tagBrush,
                FontWeight = FontWeights.SemiBold,
                FontSize = 11
            });

            // Message text
            var msgBrush = entry.Level switch
            {
                ShaneAppLogLevel.Success => SafeBrush("GreenBrush", Brushes.LightGreen),
                ShaneAppLogLevel.Error => SafeBrush("RedBrush", Brushes.Salmon),
                ShaneAppLogLevel.Warning => SafeBrush("YellowBrush", Brushes.Khaki),
                _ => SafeBrush("TextBrush", Brushes.White)
            };

            sp.Children.Add(new TextBlock
            {
                Text = entry.Message,
                Foreground = msgBrush,
                FontSize = 11.5,
                TextWrapping = TextWrapping.Wrap
            });

            return sp;
        }

        private void FilterBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            _filter = FilterBox.Text.Trim();
            RebuildLogList();
        }

        private void BtnCopy_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var sb = new StringBuilder();
                foreach (var entry in ShaneAppStreamService.Instance.LogEntries)
                {
                    if (PassesFilter(entry))
                    {
                        sb.AppendLine(entry.DisplayText);
                    }
                }
                Clipboard.SetText(sb.ToString());
                ToastEngine.Success("Copied", "Console output copied to clipboard.");
            }
            catch (Exception ex)
            {
                ToastEngine.Warning("Copy Failed", ex.Message);
            }
        }

        private void BtnClear_Click(object sender, RoutedEventArgs e)
        {
            ShaneAppStreamService.Instance.ClearLog();
            RebuildLogList();
        }

        // ── Window Chrome buttons ──
        private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

        private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
            BtnMaximizeRestoreIcon.Text = WindowState == WindowState.Maximized ? "\uE923" : "\uE922";
        }

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();
    }
}
