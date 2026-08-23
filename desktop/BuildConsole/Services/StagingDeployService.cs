using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>One reported step of a manual Staging deploy — its name, whether it succeeded,
    /// human-readable detail, and whether it was deliberately skipped (e.g. SSH not configured, so
    /// #911's own pull covers the git-pull step instead). Surfaced per-step so the final toast can
    /// show real success/failure for each link in the chain, not just a single overall verdict.</summary>
    public sealed class StagingDeployStep
    {
        public string Name { get; set; } = "";
        public bool Ok { get; set; }
        public bool Skipped { get; set; }
        public string Detail { get; set; } = "";
    }

    /// <summary>The end-to-end outcome of one manual "Deploy to Staging" run. Carries the real live
    /// commit hashes (old -&gt; new) as the concrete proof the restart genuinely landed, plus a per-step
    /// breakdown so Shane sees exactly which link succeeded or failed.</summary>
    public sealed class StagingDeployResult
    {
        /// <summary>The live (server-startup) commit on Staging BEFORE the deploy, read from #805.</summary>
        public string OldCommit { get; set; } = "";
        /// <summary>The live (server-startup) commit on Staging AFTER the confirmed restart, from #805.</summary>
        public string NewCommit { get; set; } = "";
        /// <summary>Staging was already on the latest origin/main commit with no migration SQL to apply — nothing to deploy, no restart triggered. A benign no-op, not a failure.</summary>
        public bool AlreadyLive { get; set; }
        public double ElapsedSeconds { get; set; }

        /// <summary>Where the chain ended: "already-live" | "ssh-pull-failed" | "deploy-trigger-failed" | "restart-not-confirmed" | "complete".</summary>
        public string Stage { get; set; } = "";
        public string? Error { get; set; }
        public List<StagingDeployStep> Steps { get; } = new();

        /// <summary>True only when every non-skipped step succeeded and the restart was confirmed
        /// (or nothing needed deploying).</summary>
        public bool OverallOk { get; set; }
    }

    /// <summary>
    /// The single, manual, Shane-only "Deploy to Staging" chain. This is deliberately NOT automatic:
    /// the platform now runs locally (Dev) for day-to-day agent-driven work, and Staging (Replit) is a
    /// deliberate, human-initiated action Shane triggers from the WPF UI when he's ready to push — not
    /// something an agent, a build completion, or a background timer ever fires. (The old automatic
    /// deploy+test-on-build-complete path — <see cref="PostBuildDeployPipeline"/>, gated by
    /// AutoDeployOnBuildComplete/AutoRunTestsOnBuildComplete — is being paused per that same scope
    /// change; this service is its manual replacement.)
    ///
    /// It reuses the exact real, proven mechanisms already in this codebase — nothing new is invented:
    ///
    ///   1. SSH connect + git pull — <see cref="ReplitSshService.DeployAsync"/> (git pull --ff-only,
    ///      falling back to fetch + reset --hard origin/main) over the proven SSH connection. Skipped
    ///      cleanly when SSH isn't configured/enabled, in which case #911's own git pull below covers it.
    ///      (The actual rebuild happens when the container restarts in step 2 and re-runs Replit's Run
    ///      button — install + build — so the pull only needs to advance the checkout.)
    ///   2. Apply pending DB migrations + restart — <c>#911</c>'s build-complete endpoint
    ///      (POST /api/admin/deploy/build-complete, injected as <see cref="_triggerDeployAsync"/>).
    ///      Its schema-SQL-apply logic IS the real, existing migration-running mechanism (validated
    ///      CREATE/ALTER/INSERT only, run all-or-nothing in one transaction) — reused verbatim, never a
    ///      new migration runner and never a raw ad-hoc DB query from here. Its own <c>git pull
    ///      --ff-only</c> is a harmless no-op after the SSH reset, and its deferred/detached <c>kill 1</c>
    ///      is what actually restarts the Staging server so the pulled commit is loaded.
    ///   3. Confirm the restart genuinely completed — polls <c>#805</c>'s deploy-status
    ///      (GET /api/internal/deploy-status, injected as <see cref="_getDeployStatusAsync"/>) until the
    ///      live (server-STARTUP) commit hash flips / reaches the freshly-pulled origin/main HEAD, the
    ///      same real "new code is live" proof <see cref="PostBuildDeployPipeline"/> and
    ///      trigger-deploy-and-wait.ps1 rely on. The caller then surfaces the outcome via the #24
    ///      ToastEngine.
    ///
    /// CRUCIAL targeting note: the two injected HTTP delegates MUST be bound to a client whose base URL
    /// is the Staging tier (BuildTrackerConfig.ForEnvironment(TargetEnvironment.Staging)) — otherwise
    /// #911/#805 would hit the now-local Dev api-server (http://localhost:5000) and this would restart
    /// the wrong server. The SSH step already targets Replit directly via its own SshHost.
    ///
    /// Single-flight: a restart and a second deploy must never overlap, so a second call while one is in
    /// flight is refused (returns a result flagged as such) rather than double-restarting.
    ///
    /// Every step logs on the <c>staging.deploy</c> ActivityLog channel so the whole chain is traceable
    /// from the log alone, and reports through <paramref name="onStep"/> so the UI can show live progress.
    /// </summary>
    public sealed class StagingDeployService
    {
        public const string Channel = "staging.deploy";

        // Matches PostBuildDeployPipeline's 10-minute flip window — a kill-1 restart reboots the whole
        // Repl container (re-install + full rebuild before the server listens again) and can genuinely
        // take that long on a large change; a shorter cap would falsely report a slow-but-good deploy as
        // failed (the exact defect BUILD_LOG's "Progress-aware deploy restart wait" row documents).
        private const int DeployTimeoutSeconds = 600;
        private const int PollIntervalSeconds = 3;

        private readonly Func<string?, Task<BuildCompleteResult?>> _triggerDeployAsync;
        private readonly Func<Task<DeployStatus?>> _getDeployStatusAsync;

        private bool _busy;
        public bool IsBusy => _busy;

        public StagingDeployService(
            Func<string?, Task<BuildCompleteResult?>> triggerDeployAsync,
            Func<Task<DeployStatus?>> getDeployStatusAsync)
        {
            _triggerDeployAsync = triggerDeployAsync;
            _getDeployStatusAsync = getDeployStatusAsync;
        }

        /// <summary>
        /// Runs the full manual Staging deploy chain. <paramref name="schemaSql"/> is optional pending
        /// migration SQL Shane supplies (CREATE/ALTER/INSERT only — hard-filtered server-side by #911);
        /// null/blank means a code-only deploy. <paramref name="onStep"/> fires as each step completes so
        /// the UI can log/stream live. Never throws — every failure is captured in the returned result.
        /// </summary>
        public async Task<StagingDeployResult> DeployAsync(string? schemaSql, Action<StagingDeployStep>? onStep = null)
        {
            var result = new StagingDeployResult();

            if (_busy)
            {
                result.Stage = "busy";
                result.Error = "A Staging deploy is already in progress — refused to start a second one.";
                result.OverallOk = false;
                ActivityLog.Log(Channel, result.Error);
                return result;
            }

            _busy = true;
            var sw = Stopwatch.StartNew();
            try
            {
                schemaSql = string.IsNullOrWhiteSpace(schemaSql) ? null : schemaSql.Trim();
                ActivityLog.Log(Channel, $"=== Manual Deploy to Staging started (schema SQL: {(schemaSql == null ? "none" : "provided")}). ===");

                var settings = BuildConsoleSettings.Load();
                bool sshReady = settings.UseSshForDeploy && ReplitSshService.Instance.IsConfigured;

                // ── [1/4] Read the CURRENT live Staging commit (via #805) so a real restart can be proven.
                string oldHash = "";
                try
                {
                    var status = await _getDeployStatusAsync();
                    oldHash = status?.CommitHash ?? "";
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(Channel, $"[1/4] Could not read the current Staging commit before deploy ({ex.Message}) — the server may be asleep; proceeding.");
                }
                result.OldCommit = oldHash;
                ActivityLog.Log(Channel, $"[1/4] Current live Staging commit: {Short(oldHash)}.");

                // ── [2/4] SSH connect + git pull (ReplitSshService.DeployAsync). ────────────────────────
                string expectedHash = "";
                if (sshReady)
                {
                    ActivityLog.Log(Channel, "[2/4] SSH connect + git pull (--ff-only, fallback fetch + reset --hard origin/main)…");
                    var sshRes = await ReplitSshService.Instance.DeployAsync(line => ActivityLog.Log(Channel, $"[SSH] {line}"));
                    if (!sshRes.Success)
                    {
                        // Non-fatal: fall through to #911's own git pull, exactly as PostBuildDeployPipeline does.
                        var sshErr = string.IsNullOrWhiteSpace(sshRes.Error) ? $"exit code {sshRes.ExitCode}" : sshRes.Error;
                        var step = new StagingDeployStep
                        {
                            Name = "SSH connect + git pull",
                            Ok = false,
                            Detail = $"SSH pull failed ({sshErr}); falling back to the #911 server-side git pull.",
                        };
                        result.Steps.Add(step);
                        onStep?.Invoke(step);
                        ActivityLog.Log(Channel, $"[2/4] {step.Detail}");
                    }
                    else
                    {
                        // The remote checkout is now at origin/main HEAD — that's the commit we expect to be
                        // live once the restart lands, a stronger confirm target than an old-hash flip alone.
                        expectedHash = (await ReplitSshService.Instance.GetRemoteCommitHashAsync()) ?? "";
                        var step = new StagingDeployStep
                        {
                            Name = "SSH connect + git pull",
                            Ok = true,
                            Detail = $"Pulled origin/main; remote checkout now at {Short(expectedHash)} (loads on restart).",
                        };
                        result.Steps.Add(step);
                        onStep?.Invoke(step);
                        ActivityLog.Log(Channel, $"[2/4] SSH pull OK — remote checkout at {Short(expectedHash)} (not yet loaded until restart).");
                    }
                }
                else
                {
                    var step = new StagingDeployStep
                    {
                        Name = "SSH connect + git pull",
                        Ok = true,
                        Skipped = true,
                        Detail = "SSH not configured/enabled — the #911 server-side git pull will fetch the latest instead.",
                    };
                    result.Steps.Add(step);
                    onStep?.Invoke(step);
                    ActivityLog.Log(Channel, $"[2/4] {step.Detail}");
                }

                // Nothing-to-do short-circuit: code already at origin/main HEAD AND no migration SQL to
                // apply → skip the needless restart (a same-commit restart yields no #805 flip to confirm,
                // which would otherwise look like a failure). Only reachable when SSH gave us both hashes.
                if (schemaSql == null && !string.IsNullOrEmpty(oldHash) && !string.IsNullOrEmpty(expectedHash) && HashesMatch(oldHash, expectedHash))
                {
                    result.AlreadyLive = true;
                    result.NewCommit = oldHash;
                    result.Stage = "already-live";
                    result.OverallOk = true;
                    var step = new StagingDeployStep
                    {
                        Name = "Apply migrations + restart",
                        Ok = true,
                        Skipped = true,
                        Detail = $"Staging already live on {Short(oldHash)} (latest origin/main) and no migration SQL — nothing to deploy.",
                    };
                    result.Steps.Add(step);
                    onStep?.Invoke(step);
                    result.ElapsedSeconds = sw.Elapsed.TotalSeconds;
                    ActivityLog.Log(Channel, $"[done] {step.Detail} Chain complete in {result.ElapsedSeconds:F0}s.");
                    return result;
                }

                // ── [3/4] Apply pending migrations (#911 schema-SQL) + git pull (no-op after SSH) + restart.
                ActivityLog.Log(Channel, $"[3/4] POST #911 build-complete: {(schemaSql == null ? "no schema SQL, " : "apply schema SQL, ")}git pull --ff-only, kill 1 restart…");
                BuildCompleteResult? resp;
                try
                {
                    resp = await _triggerDeployAsync(schemaSql);
                }
                catch (Exception ex)
                {
                    // A dropped connection mid-flush is consistent with the restart firing — proceed to poll.
                    resp = new BuildCompleteResult { Ok = true, Restarting = true };
                    ActivityLog.Log(Channel, $"[3/4] build-complete request did not return cleanly ({ex.Message}) — consistent with the server restarting; proceeding to poll.");
                }

                // Surface #911's own per-step results (apply schema SQL / git pull / restart) verbatim, so
                // Shane sees the real migration + pull + restart outcome, and a rolled-back migration is loud.
                if (resp?.Steps != null && resp.Steps.Count > 0)
                {
                    foreach (var s in resp.Steps)
                    {
                        var step = new StagingDeployStep { Name = MapServerStepName(s.Label), Ok = s.Ok, Detail = FirstLine(s.Output) };
                        result.Steps.Add(step);
                        onStep?.Invoke(step);
                        ActivityLog.Log(Channel, $"[3/4] server step {s.Label}: {(s.Ok ? "ok" : "FAIL")} — {FirstLine(s.Output)}");
                    }
                }

                // A non-restarting failure (schema SQL rolled back, or git pull failed) aborts here — the
                // server keeps running the current commit, so there is nothing to confirm.
                if (resp != null && !resp.Ok && !resp.Restarting)
                {
                    result.Stage = "deploy-trigger-failed";
                    result.Error = string.IsNullOrWhiteSpace(resp.Error)
                        ? "#911 build-complete reported failure with no restart scheduled (schema SQL rolled back or git pull failed)."
                        : resp.Error;
                    result.OverallOk = false;
                    result.ElapsedSeconds = sw.Elapsed.TotalSeconds;
                    ActivityLog.Log(Channel, $"[3/4] Deploy aborted — {result.Error} Restart not scheduled.");
                    return result;
                }

                // ── [4/4] Confirm the restart genuinely completed via #805. ────────────────────────────
                bool expectFlip = string.IsNullOrEmpty(oldHash) || string.IsNullOrEmpty(expectedHash) || !HashesMatch(oldHash, expectedHash);
                ActivityLog.Log(Channel, $"[4/4] Confirming restart via #805 deploy-status (mode: {(expectFlip ? "commit-flip" : "health, commit unchanged")}; timeout {DeployTimeoutSeconds}s)…");

                var (confirmed, newHash, confirmNote) = await ConfirmRestartAsync(oldHash, expectedHash, expectFlip);
                result.NewCommit = newHash;

                var confirmStep = new StagingDeployStep
                {
                    Name = "Confirm restart live",
                    Ok = confirmed,
                    Detail = confirmed
                        ? (expectFlip ? $"Live on {Short(newHash)} — {confirmNote}" : $"Server back up — {confirmNote}")
                        : $"Not confirmed — {confirmNote}",
                };
                result.Steps.Add(confirmStep);
                onStep?.Invoke(confirmStep);

                result.ElapsedSeconds = sw.Elapsed.TotalSeconds;
                if (!confirmed)
                {
                    result.Stage = "restart-not-confirmed";
                    result.Error = confirmNote;
                    result.OverallOk = false;
                    ActivityLog.Log(Channel, $"[4/4] Restart NOT confirmed — {confirmNote}. Chain ended in {result.ElapsedSeconds:F0}s.");
                    return result;
                }

                result.Stage = "complete";
                result.OverallOk = true;
                ActivityLog.Log(Channel, $"[done] Deploy to Staging CONFIRMED: {Short(oldHash)} -> {Short(newHash)} in {result.ElapsedSeconds:F0}s. {confirmNote}");
                return result;
            }
            catch (Exception ex)
            {
                result.Stage = string.IsNullOrEmpty(result.Stage) ? "errored" : result.Stage;
                result.Error = ex.Message;
                result.OverallOk = false;
                result.ElapsedSeconds = sw.Elapsed.TotalSeconds;
                ActivityLog.Log(Channel, $"Deploy to Staging ERRORED: {ex.Message}");
                return result;
            }
            finally
            {
                _busy = false;
            }
        }

        /// <summary>Polls #805 until the restart is proven. Flip mode: the live commit changed from
        /// <paramref name="oldHash"/> or reached <paramref name="expectedHash"/> (the freshly-pulled
        /// origin/main HEAD). Health mode (a same-commit restart, so no flip is observable): the server
        /// goes unreachable then answers healthy again — the honest best signal available when the commit
        /// itself can't change. Server-unreachable mid-restart is expected and simply retried.</summary>
        private async Task<(bool ok, string newHash, string note)> ConfirmRestartAsync(string oldHash, string expectedHash, bool expectFlip)
        {
            var deadline = DateTime.UtcNow.AddSeconds(DeployTimeoutSeconds);
            bool sawUnreachable = false;

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
                    sawUnreachable = true; // server down mid-restart — expected; keep waiting.
                    ActivityLog.Log(Channel, "   … deploy-status unreachable (server restarting) — waiting.");
                    continue;
                }

                if (string.IsNullOrEmpty(current)) { sawUnreachable = true; continue; }

                if (expectFlip)
                {
                    bool flipped = !string.IsNullOrEmpty(oldHash) && !HashesMatch(current, oldHash);
                    bool reachedExpected = !string.IsNullOrEmpty(expectedHash) && HashesMatch(current, expectedHash);
                    if (flipped || reachedExpected)
                    {
                        string note = reachedExpected
                            ? "live commit matches the freshly-pulled origin/main HEAD"
                            : $"live commit flipped from {Short(oldHash)}";
                        return (true, current, note);
                    }
                    ActivityLog.Log(Channel, $"   … still {Short(current)} (unchanged).");
                }
                else
                {
                    // Same-commit restart: confirmed once the server is reachable+healthy again after the
                    // kill-1 dip. If we never saw it go down, the restart may have been near-instant — still
                    // treat a healthy response as back-up but say the flip couldn't be observed.
                    string note = sawUnreachable
                        ? "restarted and came back healthy (commit unchanged, so no hash flip to observe)"
                        : "server healthy (commit unchanged; restart was too fast to observe a downtime dip)";
                    return (true, current, note);
                }
            }

            return (false, "",
                $"deploy-status never confirmed the restart within {DeployTimeoutSeconds}s — either nothing new was on origin/main to load, or the restart did not complete");
        }

        // ── helpers ─────────────────────────────────────────────────────────────────────────────────

        private static string MapServerStepName(string serverLabel)
        {
            var l = (serverLabel ?? "").ToLowerInvariant();
            if (l.Contains("schema")) return "Apply migration SQL";
            if (l.Contains("pull")) return "git pull (server)";
            if (l.Contains("restart")) return "Restart Staging server";
            return string.IsNullOrWhiteSpace(serverLabel) ? "server step" : serverLabel;
        }

        private static string FirstLine(string? text)
        {
            if (string.IsNullOrWhiteSpace(text)) return "";
            foreach (var raw in text.Split('\n'))
            {
                var line = raw.Trim();
                if (line.Length > 0) return line.Length > 160 ? line.Substring(0, 160) + "…" : line;
            }
            return "";
        }

        /// <summary>Prefix-tolerant commit-hash equality — git's --short abbreviation length can differ
        /// between two checkouts of the same commit, so compare by prefix in either direction.</summary>
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
    }
}
