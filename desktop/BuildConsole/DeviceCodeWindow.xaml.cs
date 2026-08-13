using System;
using System.Diagnostics;
using System.Windows;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Navigation;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Interactive device-code sign-in floaty for powerShellVerify (Play Test / manual runs only).
    /// When Connect-MgGraph needs a delegated sign-in, PowerShellTestExecutor parses the real device
    /// code + verification URL and hands them here (via MainWindow) instead of aborting the run. This
    /// always-on-top, non-blocking floaty — same shape as the #937 Sticky Notes / #973 LinkedIn
    /// windows — shows the code and a clickable devicelogin link so Shane can sign in; the waiting pwsh
    /// process detects success and continues to the verification cmdlet on its own. Its status line is
    /// updated (signed in / timed out) once the executor's wait resolves.
    /// </summary>
    public partial class DeviceCodeWindow : Window
    {
        private readonly string _url;
        private readonly string _code;

        public DeviceCodeWindow(PowerShellTestExecutor.DeviceCodePrompt prompt)
        {
            InitializeComponent();

            _code = prompt?.UserCode ?? "";
            _url = string.IsNullOrWhiteSpace(prompt?.VerificationUrl)
                ? "https://microsoft.com/devicelogin"
                : prompt!.VerificationUrl;

            CodeText.Text = string.IsNullOrWhiteSpace(_code) ? "(see the message)" : _code;
            UrlRun.Text = _url;
            try { UrlLink.NavigateUri = new Uri(_url); } catch { /* keep the XAML default if malformed */ }

            // If the code couldn't be parsed, show the raw instruction so Shane still has something usable.
            if (string.IsNullOrWhiteSpace(_code) && !string.IsNullOrWhiteSpace(prompt?.Message))
                StatusText.Text = prompt!.Message;

            // Park near the top-right of the primary work area so it doesn't sit over the editor.
            WindowStartupLocation = WindowStartupLocation.Manual;
            Loaded += (_, _) =>
            {
                try
                {
                    var wa = SystemParameters.WorkArea;
                    Left = wa.Right - ActualWidth - 24;
                    Top = wa.Top + 24;
                }
                catch { WindowStartupLocation = WindowStartupLocation.CenterScreen; }
            };
        }

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try { DragMove(); } catch { /* DragMove throws if the button was already released */ }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e) => Close();

        private void BtnCopy_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(_code))
                {
                    Clipboard.SetText(_code);
                    StatusText.Text = "Code copied — paste it after opening the link.";
                }
            }
            catch { /* clipboard can transiently fail; harmless */ }
        }

        private void UrlLink_RequestNavigate(object sender, RequestNavigateEventArgs e)
        {
            try
            {
                Process.Start(new ProcessStartInfo(_url) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                ActivityLog.Log("testing.powershell-verify", $"device-code: couldn't open browser to {_url} — {ex.Message}");
            }
            e.Handled = true;
        }

        /// <summary>Executor reported sign-in succeeded and verification is continuing. Turns the status
        /// green and auto-dismisses shortly after so it doesn't linger.</summary>
        public void MarkSignedIn(string message)
        {
            StatusText.Foreground = (Brush)FindResource("GreenBrush");
            StatusText.Text = string.IsNullOrWhiteSpace(message) ? "Signed in — continuing." : "✓ " + message;
            AutoDismiss(TimeSpan.FromSeconds(4));
        }

        /// <summary>Executor gave up waiting (the extended device-code window elapsed). Turns the status red.</summary>
        public void MarkTimedOut(string message)
        {
            StatusText.Foreground = (Brush)FindResource("RedBrush");
            StatusText.Text = string.IsNullOrWhiteSpace(message) ? "Timed out waiting for sign-in." : "⚠ " + message;
        }

        private void AutoDismiss(TimeSpan after)
        {
            var timer = new System.Windows.Threading.DispatcherTimer { Interval = after };
            timer.Tick += (_, _) => { timer.Stop(); try { Close(); } catch { } };
            timer.Start();
        }
    }
}
