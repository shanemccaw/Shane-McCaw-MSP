using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;

namespace BuildConsole
{
    public partial class App : Application
    {
        /// <summary>
        /// Set when THIS process is a cold start triggered by a shaneapp:// launch
        /// (no already-running instance answered the pipe to forward to). MainWindow
        /// drains it once its listener + api client are up. Only ever touched on the
        /// UI thread (OnStartup writes it, MainWindow's ctor reads+clears it).
        /// </summary>
        internal static string? PendingProtocolUri;
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
            // ── shaneapp:// protocol launch handling (executeSql local trigger) ──
            // Windows hands a registered shaneapp:// URI to this exe as an arg. What
            // this process does with it depends on whether an instance is already up:
            //   • already running → forward the URI over the named pipe and exit
            //     WITHOUT ever creating a window (clear StartupUri so DoStartup skips
            //     the MainWindow, then Shutdown). This process was only a courier.
            //   • nothing running → we are the cold start; stash the URI and fall
            //     through to normal startup, MainWindow drains it once it's ready.
            // Guarded on the arg being present, so a normal (no-arg) launch — the
            // always-open build-queue instance — is completely unaffected.
            string? protocolUri = e.Args?.FirstOrDefault(a =>
                a != null && a.StartsWith(Services.ShaneAppProtocol.Scheme + "://", StringComparison.OrdinalIgnoreCase));
            if (protocolUri != null)
            {
                if (Services.ShaneAppProtocol.TryForwardToRunningInstance(protocolUri))
                {
                    StartupUri = null; // DoStartup checks this AFTER OnStartup returns — no window is built
                    Shutdown(0);
                    return;            // deliberately skip base.OnStartup + the rest: this courier is done
                }
                PendingProtocolUri = protocolUri; // cold start — MainWindow handles it
            }

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

            // Git #935 — if this exception happened during startup (MainWindow
            // never finished constructing, e.g. a XAML parse failure), marking
            // it Handled used to leave the process running invisibly forever:
            // no window, nothing in the taskbar, but still alive and holding
            // the exe file locked. Shane couldn't tell it hadn't opened, so
            // he'd relaunch — over and over, piling up zombie processes that
            // also blocked every subsequent `dotnet build`. If nothing ever
            // became the MainWindow, there's nothing left to run for; shut down
            // for real instead of idling invisibly.
            if (this.MainWindow == null)
            {
                Shutdown(-1);
            }
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
            // Git #935 — a TargetInvocationException (thrown whenever WPF's XAML
            // parser or reflection invokes a constructor that itself throws, e.g.
            // during Application.DoStartup()'s BAML load) has a useless top-level
            // Message ("Exception has been thrown by the target of an invocation.")
            // — the real cause is always in InnerException, which this used to
            // never look at, so the dialog and crash log were both blind to the
            // actual root cause of any startup crash.
            var sb = new System.Text.StringBuilder();
            sb.Append($"[{title}]\n");
            Exception? current = ex;
            int depth = 0;
            while (current != null)
            {
                string prefix = depth == 0 ? "" : $"--- Inner Exception #{depth} ---\n";
                sb.Append($"{prefix}Type: {current.GetType().FullName}\n");
                sb.Append($"Message: {current.Message}\n");
                if (current is System.Windows.Markup.XamlParseException xpe)
                {
                    sb.Append($"XAML Line: {xpe.LineNumber}, Position: {xpe.LinePosition}\n");
                }
                sb.Append($"Stack Trace:\n{current.StackTrace}\n\n");
                current = current.InnerException;
                depth++;
            }
            string errMessage = sb.ToString();

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
