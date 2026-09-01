using System;
using System.Windows;
using BuildConsole.Services;

namespace BuildQueueDesignPreview
{
    /// <summary>
    /// Git #2137 (Epic #1788 — Build Console → Build Queue Panel) — entry point for the
    /// standalone Build Queue "Design Canvas" preview exe.
    ///
    /// This is the whole reason the project is split out: it lets Shane compile and run
    /// the design window as its OWN process/exe, decoupled from the live BuildConsole.exe
    /// managing his real queue. It constructs the SAME live data client MainWindow uses
    /// (BuildQueuePostgresClient.TryCreate against the config / .env.local DATABASE_URL),
    /// so the canvas reads the exact real queue — never fixture data. If the DB can't be
    /// reached (no DATABASE_URL), the window renders its existing "Not connected" empty
    /// state, same as inside BuildConsole.
    /// </summary>
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            BuildQueuePostgresClient? db = null;
            try
            {
                // Identical construction path to MainWindow.RunDeferredStartupAsync — share
                // the real config + client, don't reinvent the connection logic here.
                var btConfig = BuildTrackerConfig.Load();
                var repoRoot = BuildTrackerConfig.FindRepoRoot();
                db = BuildQueuePostgresClient.TryCreate(
                    btConfig,
                    repoRoot,
                    msg => ActivityLog.Log("build-queue-design-preview", msg));
            }
            catch (Exception ex)
            {
                // Never let a config/DB hiccup stop the window opening — it degrades to the
                // window's own "Not connected" state, and the reason is logged.
                ActivityLog.Log("build-queue-design-preview", "DB init failed: " + ex.Message);
            }

            var win = new BuildConsole.BuildQueueDesignWindow(db);
            win.Show();
        }
    }
}
