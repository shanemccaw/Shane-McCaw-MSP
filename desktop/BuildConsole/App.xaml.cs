using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;

namespace BuildConsole
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

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
