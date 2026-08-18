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
    ///   1. Deploys the just-finished commit. HYBRID (2026-08-17): when Direct SSH is enabled +
    ///      configured, the git PULL+build runs over SSH (ReplitSshService.DeployAsync = fetch +
    ///      reset --hard origin/main + build) — the one piece the concurrent SSH refactor genuinely
    ///      replaces. The RESTART is then still driven by #911 (`POST /api/admin/deploy/build-complete`
    ///      — git pull --ff-only, a no-op after the SSH reset, + deferred/detached `kill 1`), the same
    ///      endpoint trigger-deploy-and-wait.ps1 drives by hand — because SSH does NOT yet issue a
    ///      `kill 1`, and a pull without a restart leaves the OLD code running in memory. With SSH off,
    ///      #911 does both the pull and the restart as before.
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

        // 600s deploy-flip timeout (10 minutes) to absorb slow Replit compilation and Wi-Fi rate limits
        private const int DeployTimeoutSeconds = 600;
        private const int PollIntervalSeconds = 3;

        private readonly string _repoRoot;
        private readonly Func<Task<BuildCompleteResult?>> _triggerDeployAsync;
        private readonly Func<Task<DeployStatus?>> _getDeployStatusAsync;
        private readonly Func<int?, Task<List<ManifestRunResult>>> _runTestsAsync;
        private readonly Action<PostBuildPipelineResult> _surfaceOutcome;

        private bool _busy;
        private bool _rerunPending;
        private (int id, string title, int? githubNumber) _latest;

        public PostBuildDeployPipeline(
            string repoRoot,
            Func<Task<BuildCompleteResult?>> triggerDeployAsync,
            Func<Task<DeployStatus?>> getDeployStatusAsync,
            Func<int?, Task<List<ManifestRunResult>>> runTestsAsync,
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
        public async Task OnBuildFinishedAsync(int queueItemId, string title, int exitCode, int? githubNumber = null)
        {
            try
            {
                // Loud, unconditional "the listener actually fired" marker — the very first
                // thing recorded so the durable log proves this code path was reached at all
                // (Q1 of the Epic #803/#911 investigation: is the build-completion listener
                // even firing?). Every early-return below logs its own reason too.
                ActivityLog.Log(Channel, $"[fired] Build-completion listener fired for build #{queueItemId} '{title}' (exit {exitCode}). Durable log: {ActivityLog.CurrentLogFilePath}");

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
                _latest = (queueItemId, title, githubNumber);
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
                        var (id, t, ghNum) = _latest;
                        PostBuildPipelineResult result = await RunPipelineAsync(id, t, ghNum);
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

        private async Task<PostBuildPipelineResult> RunPipelineAsync(int queueItemId, string title, int? githubNumber)
        {
            var result = new PostBuildPipelineResult { QueueItemId = queueItemId, BuildTitle = title };
            var sw = Stopwatch.StartNew();

            // ── [1/5] Build completed — capture our own commit so the deploy can be verified to have
            //          advanced to at least it.
            string expectedShort = TryGit(_repoRoot, "rev-parse --short HEAD");
            string expectedFull = TryGit(_repoRoot, "rev-parse HEAD");
            result.ExpectedCommit = expectedShort;
            ActivityLog.Log(Channel, $"[1/5] Build completed: #{queueItemId} '{title}' (exit 0). Local HEAD = {Short(expectedShort)}. ");
            
            // Read the CURRENT live commit BEFORE triggering (via SSH if enabled, else HTTP deploy-status).
            var settings = BuildConsoleSettings.Load();
            bool useSsh = settings.UseSshForDeploy && ReplitSshService.Instance.IsConfigured;

            string oldHash;
            try
            {
                if (useSsh)
                {
                    oldHash = (await ReplitSshService.Instance.GetRemoteCommitHashAsync()) ?? "";
                }
                else
                {
                    var status = await _getDeployStatusAsync();
                    oldHash = status?.CommitHash ?? "";
                }
            }
            catch (Exception ex)
            {
                oldHash = "";
                ActivityLog.Log(Channel, $"[1/5] Could not read current deploy commit before triggering ({ex.Message}) — proceeding.");
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

            //   • git PULL + build       → SSH when enabled+configured. ReplitSshService.DeployAsync
            //                              runs `git fetch origin main && git reset --hard origin/main
            //                              && npm run build` — a real, genuine pull+build. This is the
            //                              one piece the SSH refactor has genuinely replaced, so we use it.
            //   • RESTART + live-CONFIRM → STILL HTTP: #911 (`git pull --ff-only` + deferred/detached
            //                              `kill 1`) then #805 (`GET /api/internal/deploy-status`) polled
            //                              until the commit flips.
            //
            // Why restart+confirm stay on HTTP (NOT yet genuinely replaced by SSH): a `git pull`/`reset`
            // only rewrites files on disk — the OLD code keeps running in the process's memory until PID 1
            // is killed (admin-deploy-console.ts documents exactly this: "a `git pull` only rewrites files
            // on disk; the old code stays in the running process's memory until the process itself is
            // replaced", and Replit workflows do NOT auto-restart an exited process). ReplitSshService does
            // NOT issue any `kill 1`, so an SSH-only deploy never actually goes live. And its
            // `GetRemoteCommitHashAsync` (`git rev-parse HEAD`) reflects the CHECKOUT — which advances the
            // instant `reset --hard` runs — NOT the running process, so it cannot prove the new code is
            // live. #805's commitHash is the commit captured at server STARTUP (only changes on a real
            // restart), so it is the genuine "new code is live" proof and we keep confirming through it.
            //
            // Net: the SSH pull is an accelerator in FRONT of the proven #911/#805 restart+confirm — after
            // an SSH `reset --hard origin/main`, #911's own `git pull --ff-only` is a harmless no-op and its
            // `kill 1` is what actually loads the commit. Once the SSH refactor adds a real detached
            // `kill 1` restart AND a startup-commit confirm, this whole block can move fully to SSH.
            // ── [2/5] & [3/5] Deploy restart + confirm live under exclusive coordination lock
            // Acquire the deploy lock so we NEVER restart the server while another build's tests are in flight.
            settings = BuildConsoleSettings.Load();
            string newHash = "";
            string advNote = "";
            result.DeployTriggered = true;

            var deploySuccess = await TestQueueService.Instance.ExecuteDeployExclusiveAsync(
                $"Build #{queueItemId} ({title})",
                async () =>
                {
                    if (settings.UseSshForDeploy && ReplitSshService.Instance.IsConfigured)
                    {
                        ActivityLog.Log(Channel, $"[2/5] SSH pre-pull: git fetch + reset --hard origin/main + build on {settings.SshHost} (RESTART + live-confirm still via #911/#805)…");
                        var sshRes = await ReplitSshService.Instance.DeployAsync(line =>
                        {
                            ActivityLog.Log(Channel, $"[SSH Deploy] {line}");
                        });

                        if (!sshRes.Success)
                        {
                            result.Stage = "deploy-trigger-failed";
                            result.Error = string.IsNullOrWhiteSpace(sshRes.Error) ? $"SSH pull+build failed with exit code {sshRes.ExitCode}" : sshRes.Error;
                            ActivityLog.Log(Channel, $"[2/5] SSH pull+build FAILED — {result.Error}. Restart + tests skipped (never restart/test on a failed pull).");
                            return false;
                        }
                        ActivityLog.Log(Channel, "[2/5] SSH pull+build OK — the pulled commit is on disk but NOT yet loaded (no restart happened over SSH); triggering the #911 restart so it actually goes live (its ff-only pull is a no-op after the SSH reset).");
                    }

                    // ── [2/5] Restart via #911 (git pull --ff-only + deferred/detached `kill 1`). Runs for BOTH
                    //          the SSH-pre-pull path and the pure-HTTP path — this is the genuine restart that
                    //          loads the pulled commit into a fresh process.
                    ActivityLog.Log(Channel, $"[2/5] Deploy triggered: current live commit {Short(oldHash)}; POST /api/admin/deploy/build-complete (git pull --ff-only + kill 1 restart)…");
                    try
                    {
                        BuildCompleteResult? resp = await _triggerDeployAsync();
                        ActivityLog.Log(Channel, $"[2/5] build-complete RESPONSE received: {DescribeDeployResponse(resp)}");

                        if (resp != null && !resp.Ok && !resp.Restarting)
                        {
                            result.Stage = "deploy-trigger-failed";
                            result.Error = string.IsNullOrWhiteSpace(resp.Error)
                                ? "build-complete reported failure with no restart scheduled"
                                : resp.Error;
                            ActivityLog.Log(Channel, $"[2/5] Deploy trigger FAILED — {result.Error}. No restart scheduled; aborting (tests skipped).");
                            return false;
                        }
                        ActivityLog.Log(Channel, $"[2/5] Deploy accepted — restart scheduled.{(string.IsNullOrWhiteSpace(resp?.Note) ? "" : " " + resp!.Note)}");
                    }
                    catch (Exception ex)
                    {
                        ActivityLog.Log(Channel, $"[2/5] build-complete request did not return cleanly ({ex.Message}) — consistent with the server restarting. Proceeding to poll.");
                    }

                    // ── [3/5] Poll deploy-status until the live (server-STARTUP) commit hash flips (or provably
                    //          contains our commit), or timeout. This #805 flip is the genuine restart proof —
                    //          the only signal that confirms the new code is actually running, not just on disk.
                    ActivityLog.Log(Channel, $"[3/5] Polling GET /api/internal/deploy-status every {PollIntervalSeconds}s until the commit changes from {Short(oldHash)} (timeout {DeployTimeoutSeconds}s)…");
                    newHash = await PollUntilDeployedAsync(oldHash, expectedFull, expectedShort);
                    result.DeployElapsedSeconds = sw.Elapsed.TotalSeconds;

                    if (string.IsNullOrEmpty(newHash))
                    {
                        result.Stage = "deploy-not-confirmed";
                        result.Error = $"deploy-status commit never changed from {Short(oldHash)} within {DeployTimeoutSeconds}s — either nothing new was pushed to origin/main to pull, or the restart did not complete";
                        ActivityLog.Log(Channel, $"[3/5] Deploy NOT confirmed — {result.Error}. Tests skipped (never run against unconfirmed code).");
                        return false;
                    }

                    result.NewCommit = newHash;
                    result.DeployConfirmed = true;
                    result.AdvancedToOwnCommit = VerifyAdvancedToOwnCommit(_repoRoot, expectedFull, expectedShort, newHash, out advNote);
                    result.AdvancementNote = advNote;
                    ActivityLog.Log(Channel, $"[3/5] Deploy CONFIRMED LIVE: {Short(oldHash)} -> {Short(newHash)} in {result.DeployElapsedSeconds:F0}s. advancedToOwnCommit={FormatBool(result.AdvancedToOwnCommit)} (expected {Short(expectedShort)}; {advNote}).");

                    // Warmup check: ensure HTTP server is fully compiled and serving responses
                    ActivityLog.Log(Channel, $"[3/5] Server startup confirmed on {Short(newHash)} — verifying full HTTP responsiveness before releasing deploy lock…");
                    await WaitForServerWarmupAsync();
                    return true;
                });

            if (!deploySuccess)
            {
                return result;
            }

            // Gate: the live commit changed (a real restart happened), but if we can PROVE
            // it does not yet contain this build's own commit (server is behind it — the
            // deploy flipped for some other reason, e.g. an unrelated restart, and our pull
            // hasn't landed), we must NOT run tests against that stale code. This enforces
            // the core intent — a genuine git-pull+restart to OUR commit before any test
            // executes. A null verdict (couldn't resolve the live commit locally) is left to
            // proceed, since the hash flip is still real evidence the server advanced.
            if (result.AdvancedToOwnCommit == false)
            {
                result.Stage = "deploy-not-confirmed";
                result.Error = $"live commit {Short(newHash)} does NOT contain this build's commit {Short(expectedShort)} (server is behind it) — {advNote}";
                ActivityLog.Log(Channel, $"[3/5] Deploy advanced but NOT to this build's commit — {result.Error}. Tests skipped (never run against stale code).");
                return result;
            }

            // ── [4/5] Run tests (scoped to the build's matching issue manifest; skips full suite).
            settings = BuildConsoleSettings.Load();
            if (!settings.AutoRunTestsOnBuildComplete)
            {
                ActivityLog.Log(Channel, "[4/5] Auto-run tests is OFF in Settings — test execution skipped.");
                result.Stage = "complete";
                return result;
            }

            ActivityLog.Log(Channel, $"[4/5] Tests triggered: checking for test manifests scoped to build #{queueItemId} (issue {(githubNumber.HasValue ? $"#{githubNumber.Value}" : "none")})…");
            result.TestsTriggered = true;
            List<ManifestRunResult> runs;
            try
            {
                runs = await TestQueueService.Instance.EnqueueAndRunAsync(
                    $"Build #{queueItemId} Scoped Tests",
                    "post-build-deploy",
                    () => _runTestsAsync(githubNumber));
            }
            catch (Exception ex)
            {
                result.Stage = "tests-errored";
                result.Error = $"test execution threw: {ex.Message}";
                ActivityLog.Log(Channel, $"[4/5] Tests ERRORED — {result.Error}.");
                return result;
            }

            if (runs.Count == 0)
            {
                result.Stage = "complete";
                ActivityLog.Log(Channel, $"[5/5] Pipeline DONE in {sw.Elapsed.TotalSeconds:F0}s (deploy {Short(oldHash)}->{Short(newHash)} confirmed live, no matching issue tests to run).");
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
            ActivityLog.Log(Channel, $"[5/5] Scoped tests completed: {result.TestsPassed}/{result.TestsTotal} manifest(s) passed{failSummary}. Pipeline DONE in {sw.Elapsed.TotalSeconds:F0}s (deploy {Short(oldHash)}->{Short(newHash)}, overallOk={FormatBool(result.OverallOk)}).");
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

        private async Task WaitForServerWarmupAsync(int maxWarmupSeconds = 60)
        {
            var deadline = DateTime.UtcNow.AddSeconds(maxWarmupSeconds);
            int attempt = 0;
            while (DateTime.UtcNow < deadline)
            {
                attempt++;
                try
                {
                    var status = await _getDeployStatusAsync();
                    if (status != null && !string.IsNullOrEmpty(status.CommitHash))
                    {
                        ActivityLog.Log(Channel, $"[3/5] Server responded healthy and ready on attempt #{attempt}.");
                        return;
                    }
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(Channel, $"   … waiting for server warmup ({ex.Message})");
                }
                await Task.Delay(2000);
            }
            ActivityLog.Log(Channel, $"[3/5] Server warmup check finished.");
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

        /// <summary>Renders the real build-complete response — ok/restarting/error plus each
        /// pipeline step's (git pull / restart) own ok+label — into one loud log-friendly line,
        /// so the durable log shows exactly what the server-side deploy actually did.</summary>
        private static string DescribeDeployResponse(BuildCompleteResult? resp)
        {
            if (resp == null) return "null (no body — treated as a restart-drop; will poll)";
            string steps = (resp.Steps != null && resp.Steps.Count > 0)
                ? " steps=[" + string.Join(", ", resp.Steps.ConvertAll(s => $"{s.Label}:{(s.Ok ? "ok" : "FAIL")}")) + "]"
                : "";
            string err = string.IsNullOrWhiteSpace(resp.Error) ? "" : $" error=\"{resp.Error}\"";
            return $"ok={FormatBool(resp.Ok)} restarting={FormatBool(resp.Restarting)}{steps}{err}";
        }
    }
}
