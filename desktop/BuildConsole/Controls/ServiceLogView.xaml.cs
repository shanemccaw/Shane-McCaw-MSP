using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    public partial class ServiceLogView : UserControl
    {
        private string _serviceName = string.Empty;
        private string _title = string.Empty;
        private int _port;
        private string _relPath = string.Empty;
        private string _icon = "🌐";

        private readonly PausableTextBoxLog _pausableLog;
        private DispatcherTimer? _tailTimer;
        private long _lastReadOffset = 0;
        private bool _isFirstLoad = true;
        private bool _isUpdatingStatus = false;

        public ServiceLogView()
        {
            InitializeComponent();
            _pausableLog = new PausableTextBoxLog(LogOutputBox);

            Unloaded += (_, _) =>
            {
                _tailTimer?.Stop();
            };
        }

        public void Initialize(string serviceName, string title, int port, string relPath, string icon)
        {
            _serviceName = serviceName;
            _title = title;
            _port = port;
            _relPath = relPath;
            _icon = icon;

            ServiceTitleText.Text = title;
            ServicePortText.Text = $":{port}";
            ServicePathText.Text = relPath;
            ServiceIconText.Text = icon;

            _tailTimer?.Stop();
            _tailTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
            _tailTimer.Tick += async (_, _) =>
            {
                PollLogFile();
                await UpdateStatusAsync();
            };
            _tailTimer.Start();

            _ = UpdateStatusAsync();
            PollLogFile();
        }

        public async Task UpdateStatusAsync()
        {
            if (_isUpdatingStatus || _port <= 0) return;
            _isUpdatingStatus = true;
            try
            {
                bool isOpen = await DevServicesManager.IsPortOpenAsync(_port);
                if (isOpen)
                {
                    StatusDot.Fill = (Brush)FindResource("GreenBrush");
                    BtnStartService.IsEnabled = false;
                    BtnStopService.IsEnabled = true;
                    BtnBrowseService.IsEnabled = true;
                }
                else
                {
                    StatusDot.Fill = (Brush)FindResource("Surface2Brush");
                    BtnStartService.IsEnabled = true;
                    BtnStopService.IsEnabled = false;
                    BtnBrowseService.IsEnabled = false;
                }
            }
            catch { }
            finally
            {
                _isUpdatingStatus = false;
            }
        }

        private void PollLogFile()
        {
            string logPath = DevServicesManager.GetServiceLogPath(_serviceName);
            if (!File.Exists(logPath))
            {
                // Fallback to composite dev-all.log if individual log file not created yet
                string compositeLog = Path.Combine(DevServicesManager.GetLogDir(), "dev-all.log");
                if (File.Exists(compositeLog) && _isFirstLoad)
                {
                    logPath = compositeLog;
                }
                else
                {
                    return;
                }
            }

            try
            {
                var fileInfo = new FileInfo(logPath);
                if (fileInfo.Length < _lastReadOffset)
                {
                    // Log rotated or truncated
                    _lastReadOffset = 0;
                    _pausableLog.Reset();
                    LogOutputBox.Text = string.Empty;
                }

                if (fileInfo.Length == _lastReadOffset) return;

                using var fs = new FileStream(logPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                if (_isFirstLoad)
                {
                    _isFirstLoad = false;
                    // Tail last 64 KB for fast initial render
                    long startPos = Math.Max(0, fs.Length - 65536);
                    fs.Seek(startPos, SeekOrigin.Begin);
                    _lastReadOffset = startPos;
                }
                else
                {
                    fs.Seek(_lastReadOffset, SeekOrigin.Begin);
                }

                using var reader = new StreamReader(fs, Encoding.UTF8);
                string newContent = reader.ReadToEnd();
                _lastReadOffset = fs.Position;

                if (!string.IsNullOrEmpty(newContent))
                {
                    if (LogOutputBox.Text == "[Service] Waiting for output…")
                    {
                        LogOutputBox.Text = string.Empty;
                    }
                    _pausableLog.Append(newContent);
                }
            }
            catch
            {
                /* best effort file read */
            }
        }

        private async void BtnStartService_Click(object sender, RoutedEventArgs e)
        {
            BtnStartService.IsEnabled = false;
            _pausableLog.Append($"\n[Console] Starting {_title} ({_serviceName}) on port {_port}…\n");
            await DevServicesManager.StartServiceAsync(_serviceName);
            await UpdateStatusAsync();
        }

        private async void BtnStopService_Click(object sender, RoutedEventArgs e)
        {
            BtnStopService.IsEnabled = false;
            _pausableLog.Append($"\n[Console] Stopping {_title} ({_serviceName}) on port {_port}…\n");
            await DevServicesManager.StopServiceAsync(_serviceName);
            await UpdateStatusAsync();
        }

        private void BtnBrowseService_Click(object sender, RoutedEventArgs e)
        {
            string url = $"http://localhost:{_port}";
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                ToastEngine.Show("Open Browser", $"Could not open {url}: {ex.Message}", ToastKind.Warning);
            }
        }

        private void BtnPauseLog_Click(object sender, RoutedEventArgs e)
        {
            _pausableLog.Toggle();
            BtnPauseLog.Content = _pausableLog.IsPaused ? "▶ Resume" : "⏸ Pause";
        }

        private void BtnClearLog_Click(object sender, RoutedEventArgs e)
        {
            _pausableLog.Reset();
            LogOutputBox.Text = string.Empty;
        }
    }
}
