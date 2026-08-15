using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// The end-to-end result of one auto deploy+verify+test pipeline run. The load-bearing field is
    /// <see cref="NewCommit"/> — the REAL git commit hash the dev server reports as live AFTER the
    /// deploy, not a boolean — so whoever reads this (Shane, or a later agent) can independently
    /// verify the deploy genuinely advanced to at least this build's own commit. <see cref="OldCommit"/>
    /// and <see cref="ExpectedCommit"/> (local HEAD at completion) are carried alongside so the whole
    /// old -> new transition, and whether it contains our commit, is checkable from the surfaced text.
    /// </summary>
    public class PostBuildPipelineResult
    {
        public int QueueItemId { get; set; }
        public string BuildTitle { get; set; } = "";

        /// <summary>The local repo HEAD (short) captured the moment the build finished — "this build's own commit".</summary>
        public string ExpectedCommit { get; set; } = "";
        /// <summary>The live server commit (short) BEFORE the deploy was triggered.</summary>
        public string OldCommit { get; set; } = "";
        /// <summary>The REAL live server commit (short) AFTER the deploy — the concrete proof of success, not an assumed boolean.</summary>
        public string NewCommit { get; set; } = "";

        public bool DeployTriggered { get; set; }
        public bool DeployConfirmed { get; set; }
        /// <summary>The server was ALREADY live on our commit — nothing to deploy, no restart triggered, tests skipped. A benign no-op, not a failure.</summary>
        public bool AlreadyLive { get; set; }

        /// <summary>Did the confirmed-live commit provably contain this build's own commit? null = couldn't determine locally (verify the returned hash independently).</summary>
        public bool? AdvancedToOwnCommit { get; set; }
        public string AdvancementNote { get; set; } = "";
        public double DeployElapsedSeconds { get; set; }

        public bool TestsTriggered { get; set; }
        public bool TestsRan { get; set; }
        public int TestsTotal { get; set; }
        public int TestsPassed { get; set; }
        public int TestsFailed { get; set; }
        public List<string> FailedManifests { get; set; } = new();

        /// <summary>Where the pipeline ended: "already-live" | "deploy-trigger-failed" | "deploy-not-confirmed" | "tests-errored" | "complete".</summary>
        public string Stage { get; set; } = "";
        public string? Error { get; set; }

        /// <summary>True end-to-end success: deploy confirmed live AND every regression manifest passed.
        /// The "already live, nothing to deploy" no-op is NOT overallOk (no tests ran) but is surfaced
        /// distinctly via <see cref="AlreadyLive"/> rather than treated as a failure.</summary>
        public bool OverallOk => DeployConfirmed && TestsRan && TestsFailed == 0;
    }

    /// <summary>
    /// Epic #803 — the missing automation between "a queue-managed build finished" and "its code is
    /// live on the dev server and its tests are green". Fires automatically off
    /// <see cref="QueueWatcherService.BuildFinished"/> (success only) and, in order:
    ///
    ///   1. Triggers the REAL deploy via #911 (`POST /api/admin/deploy/build-complete` — git pull
    ///      --ff-only + deferred/detached `kill 1` restart), the same endpoint
    ///      trigger-deploy-and-wait.ps1 drives by hand.
    ///   2. Polls #805 (`GET /api/internal/deploy-status`) until the live commit hash FLIPS, mirroring
    ///      the .ps1's proven old-hash -> pull+restart -> poll-until-flip flow. The result carries the
    ///      real new live commit hash (not just a boolean) plus an ancestry check confirming the deploy
    ///      advanced to at least this build's own commit.
    ///   3. Once hash-confirmed, runs the FULL regression suite (_regression-suite.json) via the
    ///      in-process RunManifestAsync pipeline. Scoping a single manifest off a queue item isn't
    ///      reliable (an issue number isn't a manifest lookup key), so this is the documented
    ///      full-sweep fallback.
    ///   4. Surfaces the end-to-end outcome (deploy confirmed + real hash + test pass/fail) through the
    ///      existing notification mechanisms (#24 toast + the Build Queue "Needs Attention" section)
    ///      rather than completing silently.
    ///
    /// Follows <see cref="RegressionScheduleService"/>'s injected-delegate shape verbatim so this class
    /// stays free of UI/HTTP specifics: MainWindow injects the #911 POST, the #805 GET, its existing
    /// full-suite runner (RunRegressionSuiteCollectAsync, which drives the one shared WebView2
    /// TestRunnerWindow — hence this must be invoked on the UI thread, which BuildFinished already is),
    /// and a surface delegate that raises the toast / Needs-Attention row.
    ///
    /// Every stage logs on the <c>testing.post-build-deploy</c> ActivityLog channel (build completed ->
    /// deploy triggered -> deploy confirmed live w/ real hash -> tests triggered -> tests completed) so
    /// the full pipeline is traceable from the log alone.
    /// </summary>
    public class PostBuildDeployPipeline
    {
        private const string Channel = "testing.post-build-deploy";

        // Match trigger-deploy-and-wait.ps1's defaults exactly: 300s deploy-flip timeout, 3s poll
        // (the same cadence #805's own DispatcherTimer uses).
        private const int DeployTimeoutSeconds = 300;
        private const int PollIntervalSeconds = 3;

        private readonly string _repoRoot;
        private readonly Func<Task<BuildCompleteResult?>> _triggerDeployAsync;
        private readonly Func<Task<DeployStatus?>> _getDeployStatusAsync;
        private readonly Func<Task<List<ManifestRunResult>>> _runTestsAsync;
        private readonly Action<PostBuildPipelineResult> _surfaceOutcome;

        private bool _busy;
        private bool _rerunPending;
        private (int id, string title) _latest;

        public PostBuildDeployPipeline(
            string repoRoot,
            Func<Task<BuildCompleteResult?>> triggerDeployAsync,
            Func<Task<DeployStatus?>> getDeployStatusAsync,
            Func<Task<List<ManifestRunResult>>> runTestsAsync,
            Action<PostBuildPipelineResult> surfaceOutcome)
        {
            _repoRoot = repoRoot;
            _triggerDeployAsync = triggerDeployAsync;
            _getDeployStatusAsync = getDeployStatusAsync;
            _runTestsAsync = runTestsAsync;
            _surfaceOutcome = surfaceOutcome;
        }

        /// <summary>Entry point wired to QueueWatcherService.BuildFinished (id, title, exitCode). Gates
        /// itself on success + the AutoDeployOnBuildComplete setting, is single-flight (a completion
        /// landing mid-pipeline is coalesced into ONE follow-up run — a single deploy pulls the latest
        /// origin/main, so it covers any build that finished while we were busy), and never throws to
        /// the caller.</summary>
        public async Task OnBuildFinishedAsync(int queueItemId, string title, int exitCode)
        {
            try
            {
                // Only a genuinely successful build should trigger a deploy of new code.
                if (exitCode != 0)
                {
                    ActivityLog.Log(Channel, $"Build #{queueItemId} '{title}' finished with exit {exitCode} (not success) — auto deploy+test pipeline skipped.");
                    return;
                }

                // Kill-switch (default on): Shane can turn the whole automation off in settings.json.
                if (!BuildConsoleSettings.Load().AutoDeployOnBuildComplete)
                {
                    ActivityLog.Log(Channel, $"Build #{queueItemId} '{title}' finished — auto deploy+test is OFF in Settings (AutoDeployOnBuildComplete=false); skipping (use trigger-deploy-and-wait.ps1 manually).");
                    return;
                }

                // Never run two pipelines at once — a deploy restart and the shared WebView2 regression
                // sweep can't overlap. Remember the newest finished build and coalesce into one follow-up.
                _latest = (queueItemId, title);
                if (_busy)
                {
                    _rerunPending = true;
                    ActivityLog.Log(Channel, $"Build #{queueItemId} '{title}' finished while a deploy pipeline is already running — queued a single follow-up run.");
                    return;
                }

                _busy = true;
                try
                {
                    do
                    {
                        _rerunPending = false;
                        var (id, t) = _latest;
                        PostBuildPipelineResult result = await RunPipelineAsync(id, t);
                        try { _surfaceOutcome(result); }
                        catch (Exception ex) { ActivityLog.Log(Channel, $"Surfacing pipeline outcome failed: {ex.Message}"); }
                    }
                    while (_rerunPending);
                }
                finally
                {
                    _busy = false;
                }
            }
            catch (Exception ex)
            {
                // A pipeline is best-effort automation; a failure here must never crash the completion handler.
                ActivityLog.Log(Channel, $"Auto deploy+test pipeline ERRORED for build #{queueItemId}: {ex.Message}");
                _busy = false;
            }
        }

        private async Task<PostBuildPipelineResult> RunPipelineAsync(int queueItemId, string title)
        {
            var result = new PostBuildPipelineResult { QueueItemId = queueItemId, BuildTitle = title };
            var sw = Stopwatch.StartNew();

            // ── [1/5] Build completed — capture our own commit so the deploy can be verified to have
            //          advanced to at least it.
            string expectedShort = TryGit(_repoRoot, "rev-parse --short HEAD");
            string expectedFull = TryGit(_repoRoot, "rev-parse HEAD");
            result.ExpectedCommit = expectedShort;
            ActivityLog.Log(Channel, $"[1/5] Build completed: #{queueItemId} '{title}' (exit 0). Local HEAD = {Short(expectedShort)}. Starting auto deploy+verify+test.");

            // Read the CURRENT live commit BEFORE triggering, exactly like trigger-deploy-and-wait.ps1.
            string oldHash;
            try
            {
                var status = await _getDeployStatusAsync();
                oldHash = status?.CommitHash ?? "";
            }
            catch (Exception ex)
            {
                oldHash = "";
                ActivityLog.Log(Channel, $"[1/5] Could not read current deploy-status before triggering ({ex.Message}) — proceeding; the hash flip / ancestry check is still the source of truth.");
            }
            result.OldCommit = oldHash;

            // If the server is already live on our commit, there is nothing to deploy — skip the whole
            // pipeline (and the needless server restart). Covers the "nothing new pushed" no-op and the
            // "another build already deployed my commit" case.
            if (!string.IsNullOrEmpty(oldHash) && !string.IsNullOrEmpty(expectedShort) && HashesMatch(oldHash, expectedShort))
            {
                result.Stage = "already-live";
                result.NewCommit = oldHash;
                result.DeployConfirmed = true;
                result.AlreadyLive = true;
                result.AdvancedToOwnCommit = true;
                result.AdvancementNote = "server already live on this build's commit";
                ActivityLog.Log(Channel, $"[done] Server already live on {Short(oldHash)} (== local HEAD) — nothing to deploy; tests skipped. Pipeline complete in {sw.Elapsed.TotalSeconds:F0}s.");
                return result;
            }

            // ── [2/5] Trigger the real deploy (#911 git pull --ff-only + restart).
            ActivityLog.Log(Channel, $"[2/5] Deploy triggered: current live commit {Short(oldHash)}; POST /api/admin/deploy/build-complete (git pull --ff-only + kill 1 restart)…");
            result.DeployTriggered = true;
            try
            {
                BuildCompleteResult? resp = await _triggerDeployAsync();
                if (resp != null && !resp.Ok && !resp.Restarting)
                {
                    // A real failure with no restart scheduled (e.g. git pull diverged). Don't poll — abort.
                    result.Stage = "deploy-trigger-failed";
                    result.Error = string.IsNullOrWhiteSpace(resp.Error)
                        ? "build-complete reported failure with no restart scheduled"
                        : resp.Error;
                    ActivityLog.Log(Channel, $"[2/5] Deploy trigger FAILED — {result.Error}. No restart scheduled; aborting (tests skipped).");
                    return result;
                }
                ActivityLog.Log(Channel, $"[2/5] Deploy accepted — restart scheduled.{(string.IsNullOrWhiteSpace(resp?.Note) ? "" : " " + resp!.Note)}");
            }
            catch (Exception ex)
            {
                // #911's restart drops the connection after flushing; a throw here is consistent with that.
                ActivityLog.Log(Channel, $"[2/5] build-complete request did not return cleanly ({ex.Message}) — consistent with the server restarting. Proceeding to poll.");
            }

            // ── [3/5] Poll deploy-status until the live commit hash flips (or provably contains our
            //          commit), or timeout.
            ActivityLog.Log(Channel, $"[3/5] Polling GET /api/internal/deploy-status every {PollIntervalSeconds}s until the commit changes from {Short(oldHash)} (timeout {DeployTimeoutSeconds}s)…");
            string newHash = await PollUntilDeployedAsync(oldHash, expectedFull, expectedShort);
            result.DeployElapsedSeconds = sw.Elapsed.TotalSeconds;

            if (string.IsNullOrEmpty(newHash))
            {
                result.Stage = "deploy-not-confirmed";
                result.Error = $"deploy-status commit never changed from {Short(oldHash)} within {DeployTimeoutSeconds}s — either nothing new was pushed to origin/main to pull, or the restart did not complete";
                ActivityLog.Log(Channel, $"[3/5] Deploy NOT confirmed — {result.Error}. Tests skipped (never run against unconfirmed code).");
                return result;
            }

            result.NewCommit = newHash;
            result.DeployConfirmed = true;
            result.AdvancedToOwnCommit = VerifyAdvancedToOwnCommit(_repoRoot, expectedFull, expectedShort, newHash, out string advNote);
            result.AdvancementNote = advNote;
            ActivityLog.Log(Channel, $"[3/5] Deploy CONFIRMED LIVE: {Short(oldHash)} -> {Short(newHash)} in {result.DeployElapsedSeconds:F0}s. advancedToOwnCommit={FormatBool(result.AdvancedToOwnCommit)} (expected {Short(expectedShort)}; {advNote}).");

            // ── [4/5] Run the tests (full regression suite — the documented fallback since a single
            //          manifest can't be reliably scoped from a queue item).
            ActivityLog.Log(Channel, "[4/5] Tests triggered: running the full regression suite (_regression-suite.json) against the confirmed-live server…");
            result.TestsTriggered = true;
            List<ManifestRunResult> runs;
            try
            {
                runs = await _runTestsAsync();
            }
            catch (Exception ex)
            {
                result.Stage = "tests-errored";
                result.Error = $"regression suite threw: {ex.Message}";
                ActivityLog.Log(Channel, $"[4/5] Tests ERRORED — {result.Error}.");
                return result;
            }

            result.TestsRan = true;
            result.TestsTotal = runs.Count;
            result.TestsPassed = runs.Count(r => r.AllPassed);
            var failed = runs.Where(r => !r.AllPassed).ToList();
            result.TestsFailed = failed.Count;
            result.FailedManifests = failed.Select(r => $"{r.Feature} (#{r.Issue})").ToList();
            result.Stage = "complete";

            string failSummary = failed.Count > 0 ? $" — FAILING: {string.Join(", ", result.FailedManifests)}" : "";
            ActivityLog.Log(Channel, $"[5/5] Tests completed: {result.TestsPassed}/{result.TestsTotal} manifest(s) passed{failSummary}. Pipeline DONE in {sw.Elapsed.TotalSeconds:F0}s (deploy {Short(oldHash)}->{Short(newHash)}, overallOk={FormatBool(result.OverallOk)}).");
            return result;
        }

        /// <summary>Mirrors trigger-deploy-and-wait.ps1's poll loop: waits (server-unreachable-mid-restart
        /// is expected and simply retried) until the live commit either FLIPS from <paramref name="oldHash"/>
        /// or provably contains our own commit, then returns that live hash; "" on timeout.</summary>
        private async Task<string> PollUntilDeployedAsync(string oldHash, string expectedFull, string expectedShort)
        {
            var deadline = DateTime.UtcNow.AddSeconds(DeployTimeoutSeconds);
            while (DateTime.UtcNow < deadline)
            {
                await Task.Delay(TimeSpan.FromSeconds(PollIntervalSeconds));

                string current;
                try
                {
                    var status = await _getDeployStatusAsync();
                    current = status?.CommitHash ?? "";
                }
                catch
                {
                    // Server unreachable mid-restart — expected; keep waiting (the .ps1 does the same).
                    ActivityLog.Log(Channel, "   … deploy-status unreachable (server restarting) — waiting.");
                    continue;
                }

                if (string.IsNullOrEmpty(current)) continue;

                bool flipped = !string.IsNullOrEmpty(oldHash) && !HashesMatch(current, oldHash);
                bool containsOurs = ContainsOurCommit(expectedFull, expectedShort, current);
                if (flipped || containsOurs) return current;

                ActivityLog.Log(Channel, $"   … still {Short(current)} (unchanged).");
            }
            return "";
        }

        /// <summary>Does the live commit demonstrably include this build's own commit — either it IS our
        /// commit, or our commit is an ancestor of it? (Best-effort local git; false-ish when it can't
        /// be resolved, which the flip check still covers.)</summary>
        private bool ContainsOurCommit(string expectedFull, string expectedShort, string liveHash)
        {
            if (string.IsNullOrEmpty(expectedShort) || string.IsNullOrEmpty(liveHash)) return false;
            if (HashesMatch(liveHash, expectedShort)) return true;
            return IsAncestor(_repoRoot, expectedFull, liveHash) == true;
        }

        /// <summary>Post-confirmation verdict on whether the live commit contains our own commit.
        /// true = it does (equal, or our commit is an ancestor); false = it demonstrably does NOT (server
        /// is behind our commit — a real problem); null = couldn't resolve the live commit locally to
        /// judge (verify the returned hash independently).</summary>
        private static bool? VerifyAdvancedToOwnCommit(string repoRoot, string expectedFull, string expectedShort, string liveHash, out string note)
        {
            if (string.IsNullOrEmpty(expectedShort))
            {
                note = "local HEAD was unavailable — cannot compare";
                return null;
            }
            if (HashesMatch(liveHash, expectedShort))
            {
                note = "live commit == this build's commit";
                return true;
            }
            var anc = IsAncestor(repoRoot, expectedFull, liveHash);
            if (anc == true) { note = "this build's commit is an ancestor of the live commit (live is ahead)"; return true; }
            if (anc == false) { note = "live commit does NOT contain this build's commit — the server is behind it"; return false; }
            note = "could not resolve the live commit locally to confirm ancestry — verify the returned hash independently";
            return null;
        }

        // ── git helpers (the dev server the deploy targets is remote; these read our LOCAL checkout) ──

        /// <summary>Runs `git &lt;args&gt;` in the repo and returns trimmed stdout, or "" on any non-zero exit / failure.</summary>
        private static string TryGit(string repoRoot, string args)
        {
            try
            {
                var psi = new ProcessStartInfo("git", args)
                {
                    WorkingDirectory = repoRoot,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using var p = Process.Start(psi);
                if (p == null) return "";
                string outp = p.StandardOutput.ReadToEnd().Trim();
                p.StandardError.ReadToEnd();
                if (!p.WaitForExit(5000)) { try { p.Kill(); } catch { } return ""; }
                return p.ExitCode == 0 ? outp : "";
            }
            catch { return ""; }
        }

        /// <summary>Runs `git &lt;args&gt;` for its exit code only. Returns the exit code, or -1 if it couldn't run.</summary>
        private static int RunGitExit(string repoRoot, string args)
        {
            try
            {
                var psi = new ProcessStartInfo("git", args)
                {
                    WorkingDirectory = repoRoot,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using var p = Process.Start(psi);
                if (p == null) return -1;
                p.StandardOutput.ReadToEnd();
                p.StandardError.ReadToEnd();
                if (!p.WaitForExit(5000)) { try { p.Kill(); } catch { } return -1; }
                return p.ExitCode;
            }
            catch { return -1; }
        }

        /// <summary>Is <paramref name="ancestorFull"/> an ancestor of (or equal to) <paramref name="descendant"/>?
        /// true / false, or null when the descendant commit isn't known locally (indeterminate).</summary>
        private static bool? IsAncestor(string repoRoot, string ancestorFull, string descendant)
        {
            if (string.IsNullOrEmpty(ancestorFull) || string.IsNullOrEmpty(descendant)) return null;
            // Can't judge ancestry against a commit the local repo doesn't have (origin may have moved
            // beyond what we've fetched).
            if (string.IsNullOrEmpty(TryGit(repoRoot, $"rev-parse --verify --quiet {descendant}^{{commit}}"))) return null;
            int code = RunGitExit(repoRoot, $"merge-base --is-ancestor {ancestorFull} {descendant}");
            if (code == 0) return true;
            if (code == 1) return false;
            return null; // 128 / couldn't run — indeterminate
        }

        /// <summary>Prefix-tolerant commit-hash equality (git's --short abbreviation length can differ
        /// between two checkouts of the same commit, so compare by prefix in either direction).</summary>
        private static bool HashesMatch(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
            a = a.Trim();
            b = b.Trim();
            return a.StartsWith(b, StringComparison.OrdinalIgnoreCase)
                || b.StartsWith(a, StringComparison.OrdinalIgnoreCase);
        }

        private static string Short(string hash) =>
            string.IsNullOrEmpty(hash) ? "?" : (hash.Length > 12 ? hash.Substring(0, 12) : hash);

        private static string FormatBool(bool? b) => b == null ? "unknown" : (b.Value ? "yes" : "NO");
    }
}
