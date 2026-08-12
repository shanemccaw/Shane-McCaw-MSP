using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;

namespace BuildConsole
{
    public partial class App : Application
    {
        /// <summary>
        /// Git #830 — Shane: "Is there a way to make push notifications from
        /// Claude.ai work in this WebView2 browser?" An unpackaged (non-MSIX)
        /// Win32 app has no App User Model ID by default, and Windows uses
        /// the AUMID to route a toast notification's click back to the right
        /// process/window — without one, WebView2's own toast plumbing for
        /// the standard web Notification API either can't display the toast
        /// at all or shows it with no working activation. Must be called
        /// BEFORE any window/WebView2 is created, hence here in OnStartup
        /// rather than MainWindow's constructor.
        /// </summary>
        [DllImport("shell32.dll", SetLastError = true)]
        private static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string AppID);

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            try { SetCurrentProcessExplicitAppUserModelID("ShaneMcCaw.BuildConsole"); } catch { }

            // Catch UI thread unhandled exceptions
            DispatcherUnhandledException += App_DispatcherUnhandledException;

            // Catch non-UI background thread unhandled exceptions
            AppDomain.CurrentDomain.UnhandledException += CurrentDomain_UnhandledException;

            // Catch unobserved async Task exceptions
            TaskScheduler.UnobservedTaskException += TaskScheduler_UnobservedTaskException;
        }

        private void App_DispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
        {
            e.Handled = true; // Prevent silent crash
            ShowExceptionDialog("UI Thread Error", e.Exception);
        }

        private void CurrentDomain_UnhandledException(object sender, UnhandledExceptionEventArgs e)
        {
            if (e.ExceptionObject is Exception ex)
            {
                ShowExceptionDialog("Fatal Domain Error", ex);
            }
        }

        private void TaskScheduler_UnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
        {
            e.SetObserved();
            if (e.Exception != null)
            {
                ShowExceptionDialog("Background Task Error", e.Exception);
            }
        }

        private void ShowExceptionDialog(string title, Exception ex)
        {
            string errMessage = $"[{title}]\n" +
                                $"Type: {ex.GetType().FullName}\n" +
                                $"Message: {ex.Message}\n\n" +
                                $"Stack Trace:\n{ex.StackTrace}";

            try
            {
                string logFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "buildconsole_crash.log");
                File.AppendAllText(logFile, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {errMessage}\n\n");
            }
            catch { }

            MessageBox.Show(errMessage, $"BuildConsole Error: {title}", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }
}
