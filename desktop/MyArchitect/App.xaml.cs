using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using MyArchitect.Infrastructure;

namespace MyArchitect;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : System.Windows.Application
{
    public App()
    {
        // #3554 — the app had ZERO global exception handling, so any unhandled exception anywhere
        // killed the whole process instantly, with no log and no message. That is the confirmed
        // root cause of the "random, unexplained" crashes. Wire all three sinks here, in the
        // constructor, so they are live before the main window is even shown.
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += OnAppDomainUnhandledException;
        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
    }

    /// <summary>UI-thread exceptions. These are recoverable: log, tell the user, and mark handled
    /// so the process keeps running instead of vanishing.</summary>
    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        CrashLog.Write("DispatcherUnhandledException", e.Exception);
        e.Handled = true; // keep the app alive — a single screen's failure must not kill the cockpit
        ShowCrashDialog(e.Exception, terminating: false);
    }

    /// <summary>Exceptions on non-UI threads (thread-pool, background). By the time this fires the
    /// runtime has already decided to terminate — we cannot prevent it, so log everything we can
    /// (best-effort dialog) before the process dies, which is the whole point: a trace where there
    /// was none.</summary>
    private void OnAppDomainUnhandledException(object sender, UnhandledExceptionEventArgs e)
    {
        var ex = e.ExceptionObject as Exception;
        CrashLog.Write("AppDomain.UnhandledException", ex,
            e.IsTerminating ? "IsTerminating=true" : "IsTerminating=false");
        if (e.IsTerminating)
            ShowCrashDialog(ex, terminating: true);
    }

    /// <summary>Exceptions from Tasks whose result/exception was never observed. Left unobserved
    /// these can tear down the process on finalization — log and mark observed so a swallowed
    /// background failure never becomes a crash.</summary>
    private void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        CrashLog.Write("TaskScheduler.UnobservedTaskException", e.Exception);
        e.SetObserved();
    }

    private static void ShowCrashDialog(Exception? ex, bool terminating)
    {
        try
        {
            var headline = terminating
                ? "MyArchitect hit an unexpected error and has to close."
                : "MyArchitect hit an unexpected error, but stayed running.";
            var message =
                $"{headline}\n\n" +
                $"{ex?.GetType().Name}: {ex?.Message}\n\n" +
                $"Details were written to:\n{CrashLog.LogPath}";
            System.Windows.MessageBox.Show(
                message,
                "MyArchitect",
                System.Windows.MessageBoxButton.OK,
                terminating ? System.Windows.MessageBoxImage.Error : System.Windows.MessageBoxImage.Warning);
        }
        catch
        {
            // A dialog can itself fail during a terminating crash (no message pump). The log write
            // above already captured the real detail — never let the dialog throw on top of a crash.
        }
    }
}
