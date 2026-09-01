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
        /// Git #1889 — true when THIS process is a --dev/--agent cold start that exists solely to
        /// courier one shaneapp:// payload (report-progress, executeSql, runTest, …) to whatever
        /// happens to be running, not a deliberate agent verification/screenshot launch. Set once in
        /// OnStartup; MainWindow reads it to decide whether to actually run the pending URI (instead
        /// of dropping it, agent mode's normal behavior) and to exit once that one job is done.
        /// </summary>
        internal static bool QuietProtocolCourierLaunch;

        /// <summary>
        /// Git #2141 — process-wide single-instance ownership token. <c>Global\</c> so it is
        /// path-independent: a second launch from ANY folder (dev build output, the deployed
        /// ShanesBuild folder, a worktree, wherever) still collides with the same name. The FIRST
        /// process to start owns it; every later one sees <c>createdNew==false</c>. Held for the
        /// whole process lifetime — a static field so the GC never collects it out from under us.
        /// </summary>
        internal const string SingleInstanceMutexName = @"Global\ShaneMcCawBuildConsole_SingleInstance";
        /// <summary>
        /// Git #2141 — distinct non-zero exit code a blocked second instance exits with, so a
        /// calling script/agent can detect the refusal programmatically, not just from the text.
        /// </summary>
        internal const int SingleInstanceRefusedExitCode = 10;
        private static System.Threading.Mutex? _singleInstanceMutex;

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

            // ── Single-instance guard (Git #2141) ─────────────────────────────────────
            // EMERGENCY hard guard: a second FULL BuildConsole.exe launch on top of Shane's
            // live session directly interrupts his active work (this exe manages his real
            // queue). A named SYSTEM mutex is the ownership token — the FIRST process to start
            // owns it; any later one sees createdNew==false and is refused a window here,
            // BEFORE the shaneapp:// branch below and before base.OnStartup can build anything.
            //
            // Deliberate carve-out — a launch carrying a shaneapp:// URI is NOT a rival window:
            // it is a transient protocol courier (reportProgress / executeSql / runTest, …)
            // whose whole job is to forward that URI to the already-running instance over the
            // pipe below and exit WITHOUT ever drawing a window. Refusing it here would silently
            // break every agent protocol (report-progress.mjs itself falls back to a protocol
            // launch), so the guard refuses only launches with NO protocol URI — a plain no-arg
            // double-click / `dotnet run` / an agent running the exe directly to verify the UI.
            // (A courier that finds nothing running becomes the cold-start owner:
            // createdNew==true, so it is never refused.)
            _singleInstanceMutex = new System.Threading.Mutex(true, SingleInstanceMutexName, out bool createdNew);
            if (!createdNew && protocolUri == null)
            {
                // Bring Shane's real window forward, tell any agent reading this to stop, and
                // exit with a distinct code — without building a window (same "clear StartupUri,
                // skip MainWindow, Shutdown" idiom the successful-forward courier branch uses).
                TryActivateRunningInstance();
                WriteSingleInstanceRefusal();
                Environment.ExitCode = SingleInstanceRefusedExitCode;
                StartupUri = null;
                Shutdown(SingleInstanceRefusedExitCode);
                return;
            }

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

            // Git #1838 — decide the launch mode ONCE, here, before base.OnStartup builds
            // any window and before MainWindow's ctor can arm a single background service.
            // In agent mode (--agent / --dev / BUILDCONSOLE_AGENT=1) BuildConsole is a passive
            // shell: nothing polls, claims, launches, deploys, tests, drives Shane's browser
            // sessions, or takes the shaneapp:// pipe. Placed AFTER the courier branch above so
            // that path still forwards+Shutdowns without a window exactly as before.
            Services.AppMode.Initialize(e.Args);

            // Git #1889 — the forward attempt above just failed (no listener answered inside its
            // 2s window: genuinely nothing running yet, OR a primary that's momentarily
            // unreachable — mid ShanesBuild-deploy stop/relaunch, or the pipe's serial accept loop
            // racing heavy concurrent shaneapp:// traffic). Either way, THIS process still has to
            // do the real work the URI asked for (MainWindow drains PendingProtocolUri once ready),
            // so it can't just Shutdown() like the successful-forward branch above. But its whole
            // purpose here is couriering ONE payload for an already-running (or about-to-be-running)
            // primary — it was never meant to be seen, so it must not grab Shane's screen or focus
            // while it does that. A bare --agent/--dev launch with NO protocol payload is a
            // different, deliberate use case (Git #1838: an agent verifying/screenshotting the UI
            // itself) and keeps today's visible-shell behavior unchanged — parking IT off-screen
            // would defeat the one thing it was launched for.
            QuietProtocolCourierLaunch = Services.AppMode.IsAgent && protocolUri != null;
            if (QuietProtocolCourierLaunch)
            {
                StartupUri = null; // build/show the window ourselves below instead of WPF's default (CenterScreen, Maximized, activated)
            }

            base.OnStartup(e);

            if (QuietProtocolCourierLaunch)
            {
                // Same "park off-screen, ShowActivated=false, never Activate()" idiom
                // TestRunnerWindow already uses for the identical reason (Git #857: "tests should
                // never interrupt me"). DWM still composites an off-screen Normal window, so nothing
                // downstream (WebView2, etc.) is starved the way a Minimized/Hidden window would be —
                // it's just never where Shane can see it, and Windows never gives it the foreground.
                var window = new MainWindow
                {
                    WindowStartupLocation = WindowStartupLocation.Manual,
                    WindowState = WindowState.Normal,
                    ShowActivated = false,
                    Left = SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth + 200,
                    Top = Math.Max(SystemParameters.VirtualScreenTop, 0),
                };
                MainWindow = window;
                window.Show();
            }

            // Git #1978 — resolve and cache the repo root ONCE here, at cold start while the
            // working tree is quiet, before MainWindow's ctor uses it for the queue DB / worktree
            // services. Holding a startup-valid value for the process lifetime makes FindRepoRoot()
            // immune to the transient File.Exists misses (during dev-server merge-back / pnpm churn)
            // that used to silently no-op the worktree cleanup sweep and, after #1971, its
            // pre-removal work-preservation.
            try { Services.BuildTrackerConfig.InitializeRepoRoot(); } catch { }

            // Git #1914 — self-heal the mybuilder:// registry command against this
            // process's own known-current repo root on every startup, rather than
            // relying on a one-time manual scripts/setup-extension-host.ps1 run whose
            // baked-in path can silently go stale if the repo ever moves. Cheap,
            // idempotent, and must never block/interrupt startup — errors are logged,
            // not thrown.
            try { Services.MyBuilderProtocolRegistration.EnsureRegistered(Services.BuildTrackerConfig.FindRepoRoot()); } catch { }

            try { SetCurrentProcessExplicitAppUserModelID("ShaneMcCaw.BuildConsole"); } catch { }

            // Catch UI thread unhandled exceptions
            DispatcherUnhandledException += App_DispatcherUnhandledException;

            // Catch non-UI background thread unhandled exceptions
            AppDomain.CurrentDomain.UnhandledException += CurrentDomain_UnhandledException;

            // Catch unobserved async Task exceptions
            TaskScheduler.UnobservedTaskException += TaskScheduler_UnobservedTaskException;
        }

        /// <summary>
        /// Git #2141 — ask the already-running BuildConsole to bring its real MainWindow to the
        /// foreground, by couriering a <c>shaneapp://activate</c> message over the SAME per-user
        /// named pipe every other protocol invocation uses (never a second parallel pipe). The
        /// running instance's listener handles "activate" in MainWindow.HandleShaneAppUriAsync.
        /// Best-effort: a missing/unreachable listener (e.g. the live instance is in agent mode
        /// and isn't listening) is not fatal — the refusal below still fires either way.
        /// </summary>
        private static void TryActivateRunningInstance()
        {
            try
            {
                Services.ShaneAppProtocol.TryForwardToRunningInstance(
                    Services.ShaneAppProtocol.Scheme + "://activate?src=single-instance-guard");
            }
            catch { /* foregrounding is best-effort; never block the refusal path */ }
        }

        /// <summary>
        /// Git #2141 — the unmissable refusal, written for an AI agent to read, not just Shane.
        /// Goes to <see cref="Console.Error"/> (seen when an agent runs the exe from an attached
        /// console/terminal) AND <see cref="Services.ActivityLog"/> (durable on disk regardless of
        /// whether any console is attached).
        /// </summary>
        private static void WriteSingleInstanceRefusal()
        {
            string message =
                "====================================================================\n" +
                " BUILDCONSOLE REFUSED TO LAUNCH — A LIVE SESSION IS ALREADY RUNNING\n" +
                "====================================================================\n" +
                "BuildConsole is already running on this machine and a second instance\n" +
                "was just blocked.\n" +
                "\n" +
                "IF YOU ARE AN AI AGENT: STOP. Do NOT run, build-and-run (`dotnet run`),\n" +
                "or relaunch BuildConsole.exe. Shane has a live session open right now and\n" +
                "launching a second instance interrupts his active work. This is a HARD\n" +
                "RULE, not a suggestion. Do not retry, and do not look for another way to\n" +
                "start it. Shane's real window has been brought to the foreground for him.\n" +
                "This process is exiting with code " + SingleInstanceRefusedExitCode + ".\n" +
                "====================================================================";
            try { Console.Error.WriteLine(message); Console.Error.Flush(); } catch { }
            try
            {
                Services.ActivityLog.Log("system.core",
                    "Single-instance guard (#2141): blocked a second BuildConsole launch on top of a live " +
                    "session; foregrounded the running instance and refused with exit code " +
                    SingleInstanceRefusedExitCode + ". Directive written to Console.Error telling any AI " +
                    "agent NOT to run/relaunch BuildConsole.exe.");
            }
            catch { }
        }

        private void App_DispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
        {
            if (IsFatalRenderingException(e.Exception))
            {
                e.Handled = true;
                string details = FormatExceptionDetails("Fatal Render Error", e.Exception);
                LogExceptionToDisk("Fatal Render Error", e.Exception);
                
                string friendlyMessage = "A fatal rendering error occurred (UCEERR_RENDERTHREADFAILURE).\n\n" +
                    "This is usually caused by a graphics driver crash, remote desktop reconnection, or hardware acceleration issues.\n" +
                    "The application will now shut down to prevent system freeze.\n\n" +
                    "Details:\n" + details;
                
                AppDialog.Alert(null, friendlyMessage, "BuildConsole Error: Fatal Render Error", AppDialogIcon.Error);
                Environment.Exit(-1);
                return;
            }

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
                // Always record to crash log for diagnostics
                LogExceptionToDisk("Background Task Error", e.Exception);

                // Transient background errors (such as socket connection refusals, network aborts, or task cancellations)
                // should not interrupt the user with a blocking modal dialog box.
                if (!IsBenignBackgroundException(e.Exception))
                {
                    ShowExceptionDialog("Background Task Error", e.Exception);
                }
            }
        }

        private static bool IsBenignBackgroundException(Exception ex)
        {
            Exception? current = ex;
            while (current != null)
            {
                if (current is System.Net.Sockets.SocketException ||
                    current is System.Net.Http.HttpRequestException ||
                    current is System.IO.IOException ||
                    current is OperationCanceledException ||
                    current is TaskCanceledException ||
                    current is ObjectDisposedException)
                {
                    return true;
                }
                current = current.InnerException;
            }
            return false;
        }

        private static bool IsFatalRenderingException(Exception ex)
        {
            Exception? current = ex;
            while (current != null)
            {
                if (current is System.Runtime.InteropServices.COMException comEx)
                {
                    // UCEERR_RENDERTHREADFAILURE (0x88980406) or Desktop composition disabled (0x80263001)
                    if (comEx.HResult == unchecked((int)0x88980406) || 
                        comEx.HResult == unchecked((int)0x80263001) ||
                        comEx.Message.Contains("UCEERR_RENDERTHREADFAILURE"))
                    {
                        return true;
                    }
                }
                
                string stack = current.StackTrace ?? "";
                if (stack.Contains("System.Windows.Media.Composition") || 
                    stack.Contains("HwndTarget.UpdateWindowSettings") ||
                    stack.Contains("WindowChromeWorker._ExtendGlassFrame"))
                {
                    return true;
                }
                
                current = current.InnerException;
            }
            return false;
        }

        private void LogExceptionToDisk(string title, Exception ex)
        {
            try
            {
                string errMessage = FormatExceptionDetails(title, ex);
                string logFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "buildconsole_crash.log");
                File.AppendAllText(logFile, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {errMessage}\n\n");
            }
            catch { }
        }

        private static string FormatExceptionDetails(string title, Exception ex)
        {
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
            return sb.ToString();
        }

        private void ShowExceptionDialog(string title, Exception ex)
        {
            string errMessage = FormatExceptionDetails(title, ex);
            LogExceptionToDisk(title, ex);
            AppDialog.Alert(null, errMessage, $"BuildConsole Error: {title}", AppDialogIcon.Error);
        }
    }
}
