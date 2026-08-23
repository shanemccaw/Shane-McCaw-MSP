using System;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// The manual, Shane-only "Deploy to Staging" action, wired to LeftSidebar's
    /// <see cref="Controls.LeftSidebar.DeployToStagingRequested"/> button. This is the deliberate
    /// human-initiated replacement for the old automatic deploy-on-build-complete path (now paused per
    /// the local-first scope change): the product runs locally for day-to-day work, and pushing to
    /// Staging (Replit) is a single conscious action Shane takes when he's ready.
    ///
    /// It confirms via <see cref="StagingDeployDialog"/> (which also collects any pending migration SQL),
    /// then runs <see cref="StagingDeployService"/> — SSH connect + git pull -> #911 migrations+restart
    /// -> #805 confirm — against a client explicitly bound to the STAGING tier
    /// (BuildTrackerConfig.ForEnvironment(TargetEnvironment.Staging)) so #911/#805 hit Replit, not the
    /// now-local Dev api-server. The end-to-end outcome, with real per-step success/failure detail, is
    /// surfaced through the non-blocking #24 ToastEngine. No tests are triggered — Shane switches the
    /// Target Environment selector to Staging and runs them himself afterward.
    /// </summary>
    public partial class MainWindow
    {
        // Re-entrancy guard on top of StagingDeployService's own single-flight, so a second click while a
        // deploy is in flight gives a clear toast instead of silently building a second service/dialog.
        private bool _stagingDeployBusy;

        private async void LeftSidebar_DeployToStagingRequested(object? sender, EventArgs e)
        {
            if (_stagingDeployBusy)
            {
                ToastEngine.Warning("Deploy to Staging", "A Staging deploy is already in progress — please wait for it to finish.");
                return;
            }

            // Confirm + optionally collect pending migration SQL. Modal on purpose — a real deploy target.
            var dialog = new StagingDeployDialog { Owner = this };
            bool? ok = dialog.ShowDialog();
            if (ok != true) return;
            string? schemaSql = dialog.SchemaSql;

            // Bind the HTTP calls to the STAGING tier so #911/#805 hit Replit, not the local Dev server.
            var stagingCfg = BuildTrackerConfig.Load().ForEnvironment(TargetEnvironment.Staging);
            if (string.IsNullOrWhiteSpace(stagingCfg.IngestToken) || !stagingCfg.IsConfigured)
            {
                ToastEngine.Error("Deploy to Staging",
                    "Staging isn't fully configured — need a Staging base URL and a Build Tracker ingest token (Settings → Build Tracker / Target Environments) to reach #911/#805.");
                return;
            }

            var stagingApi = new BuildTrackerApiClient(stagingCfg);
            var service = new StagingDeployService(
                sql => stagingApi.PostBuildCompleteAsync(sql),
                () => stagingApi.GetDeployStatusAsync());

            _stagingDeployBusy = true;
            ActivityLog.Log(StagingDeployService.Channel,
                $"Manual Deploy to Staging invoked by Shane → {stagingCfg.ApiBaseUrl} (schema SQL: {(schemaSql == null ? "none" : "provided")}).");
            ToastEngine.Info("Deploying to Staging…",
                $"SSH pull → apply migrations → restart → confirm.\nTarget: {stagingCfg.ApiBaseUrl}");

            StagingDeployResult result;
            try
            {
                result = await service.DeployAsync(schemaSql);
            }
            catch (Exception ex)
            {
                // DeployAsync is defensively wrapped and shouldn't throw, but never let this crash the UI.
                ActivityLog.Log(StagingDeployService.Channel, $"Deploy to Staging threw unexpectedly: {ex.Message}");
                ToastEngine.Error("Deploy to Staging failed", ex.Message);
                _stagingDeployBusy = false;
                return;
            }
            finally
            {
                _stagingDeployBusy = false;
            }

            SurfaceStagingDeployOutcome(result);
        }

        /// <summary>Turns a <see cref="StagingDeployResult"/> into one clear, non-blocking toast carrying
        /// the real per-step success/failure detail — the "notify Shane when the whole chain finishes"
        /// step of the deploy.</summary>
        private void SurfaceStagingDeployOutcome(StagingDeployResult r)
        {
            var body = new StringBuilder();

            if (r.AlreadyLive)
            {
                body.Append($"Staging was already live on {r.NewCommit} (latest origin/main) — nothing to deploy.");
                ToastEngine.Success("Deploy to Staging — already current", body.ToString());
                return;
            }

            // One line per step with a ✓ / ✗ / (skipped) marker so every link's real outcome is visible.
            foreach (var s in r.Steps)
            {
                string mark = s.Skipped ? "○" : (s.Ok ? "✓" : "✗");
                body.Append($"{mark} {s.Name}");
                if (!s.Ok && !s.Skipped && !string.IsNullOrWhiteSpace(s.Detail))
                    body.Append($" — {s.Detail}");
                body.Append('\n');
            }

            if (r.OverallOk)
            {
                string commits = (!string.IsNullOrEmpty(r.OldCommit) || !string.IsNullOrEmpty(r.NewCommit))
                    ? $"{Trunc(r.OldCommit)} → {Trunc(r.NewCommit)} "
                    : "";
                body.Append($"\nLive {commits}in {r.ElapsedSeconds:F0}s. Switch Target Environment to Staging to run tests.");
                ToastEngine.Success("Deployed to Staging ✓", body.ToString(), TimeSpan.FromSeconds(12));
            }
            else
            {
                if (!string.IsNullOrWhiteSpace(r.Error)) body.Append($"\n{r.Error}");
                body.Append($"\n(stage: {r.Stage}, {r.ElapsedSeconds:F0}s)");
                ToastEngine.Error("Deploy to Staging failed", body.ToString(), TimeSpan.FromSeconds(14));
            }
        }

        private static string Trunc(string hash) =>
            string.IsNullOrEmpty(hash) ? "?" : (hash.Length > 10 ? hash.Substring(0, 10) : hash);
    }
}
