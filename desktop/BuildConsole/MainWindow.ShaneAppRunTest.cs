using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole
{
    // ── shaneapp://runTest (alias uiTest) — LOCAL in-process manifest trigger ─────────
    //
    // A sibling to shaneapp://executeSql (dispatched from HandleShaneAppUriAsync in
    // MainWindow.xaml.cs). Where executeSql runs SQL, runTest runs a whole TEST MANIFEST
    // through the EXACT SAME RunManifestAsync pipeline a Play Test / manifest double-click
    // uses — every step type it supports (apiTests, graphTests, postGraphApiTests,
    // zohoTests, uiSteps, powerShellVerify), not just uiSteps. "uiTest" is accepted as an
    // alias purely because a caller might reach for it; both route here.
    //
    // WHY LOCAL, AND NOT #898's HTTP:
    //   #898 already exposes UI-test execution over plain HTTP for a genuinely REMOTE
    //   caller (e.g. a future CI box NOT on this machine): create run -> BuildConsole
    //   polls /admin/deploy/test-run/next -> runs -> POSTs /:runId/complete -> the caller
    //   polls /:runId. That path stays exactly as-is. But the actual current use case is a
    //   LOCAL Claude Code agent on the SAME machine as BuildConsole, for which that HTTP
    //   round-trip through the deployed api-server is pure overhead. This path skips all of
    //   it: the agent's shaneapp:// launch is couriered straight to the running instance
    //   (Services/ShaneAppProtocol.cs) and RunManifestAsync is invoked in-process, exactly
    //   as if Play Test had been clicked — no network hop.
    //
    // MANIFEST RESOLUTION:
    //   The manifest arrives as a filename in ?file= (with ?ref= accepted as a fallback
    //   alias). It's resolved by searching test-manifests/ recursively for that filename —
    //   the SAME resolution #898/#964 use, since #960 moved manifests into {area}/ subdirs.
    //   An absolute or repo-relative path that already exists is honored directly too.
    //
    // NON-INTERACTIVE BY DESIGN:
    //   The agent is polling a result file, so a blocking modal (the interactive
    //   device-code floaty or the screenshot-review dialog RunManifestAsync can raise on a
    //   Play Test) would strand it indefinitely. This run therefore holds _testTriggerBusy
    //   for its whole duration — the SAME latch #898's remote poll (TestTriggerTickAsync)
    //   uses. That has two effects, both wanted: (a) RunManifestAsync takes its headless
    //   branch (guarded on !_testTriggerBusy) so no modal ever blocks, and (b) it gives
    //   free mutual exclusion — RunManifestAsync drives the ONE shared TestRunnerWindow /
    //   WebView2, which can't service two runs at once, so a local run and the remote poll
    //   (or two local runs) can never overlap. If a run is already in flight, this one
    //   refuses cleanly and says so in the result envelope rather than corrupting it.
    //
    // RESULT ENVELOPE:
    //   Written to ?resultRef= (or a predictable %TEMP%\shaneapp-runTest-<file>.result.json
    //   default). It carries a top-line ok / pass-fail summary a CLI agent can branch on
    //   immediately, PLUS the full ManifestRunResult — the SAME shape test-results/*.json
    //   and #898's HTTP delivery use — so the agent can drill into per-step detail.
    //
    // Every branch logs on the shared shaneapp protocol channel (ShaneAppProtocol.LogChannel).
    public partial class MainWindow
    {
        /// <summary>
        /// Handles one shaneapp://runTest (or ://uiTest) invocation on the UI thread:
        /// resolves the manifest named by ?file=, runs it in-process through the real
        /// RunManifestAsync pipeline, and writes a JSON result envelope back for the
        /// calling agent. The outer HandleShaneAppUriAsync already wraps this in a
        /// try/catch backstop; this adds its own around the run so a failure still
        /// produces a result envelope (an agent's poll must never hang).
        /// </summary>
        private async Task HandleShaneAppRunTestAsync(BuildConsole.Services.ShaneAppRequest req, string src, string ch)
        {
            // fileArg + manifestPath are declared OUTSIDE the top-level try so the absolute
            // backstop catch at the bottom can still name the manifest in a guaranteed
            // failure envelope even if an exception is thrown mid-resolution.
            string? fileArg = null;
            string? manifestPath = null;

            // TOP-LEVEL GUARANTEE: this entire path is wrapped so that ANY failure — not
            // just one inside the run itself — still produces a result envelope. This
            // mirrors executeSql's "never silently no-op" contract: the original bug that
            // stranded Shane's poll was a URI that reached this app but produced no envelope,
            // so an agent polling the result file must NEVER be able to hang on an unhandled
            // exception occurring anywhere between URI receipt and the intended write.
            try
            {
                // The manifest to run rides in ?file= (a bare {feature}.json). ?ref= is
                // accepted as a fallback alias so a caller reusing the executeSql-style param
                // name still works.
                fileArg = GetShaneAppQueryParam(req.Raw, "file");
                if (string.IsNullOrWhiteSpace(fileArg)) fileArg = req.Ref;

                if (string.IsNullOrWhiteSpace(fileArg))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, "runTest called with no file= manifest filename — nothing to run.");
                    WriteShaneAppRunTestResult(req, fileArg, ok: false, error: "no file= manifest filename supplied", manifestPath: null, result: null);
                    return;
                }

                string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                if (repoRoot == null)
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        "runTest: no repo root found (missing scripts\\build-queue-watcher.config.json) — can't locate test-manifests/.");
                    WriteShaneAppRunTestResult(req, fileArg, ok: false, error: "no repo root found — can't locate test-manifests/", manifestPath: null, result: null);
                    return;
                }

                manifestPath = ResolveManifestPath(repoRoot, fileArg!);
                var manifest = manifestPath != null ? BuildConsole.Services.TestManifest.LoadFromFile(manifestPath) : null;
                if (manifest == null)
                {
                    // Git #3059 — before reporting a plain "not found," check whether this
                    // checkout's own test-manifests/ tree is simply behind origin/main and the
                    // file exists there. See DiagnoseManifestNotFoundAsync's own header for why
                    // this, not a path-construction bug, was the real cause of a "repeatable
                    // manifest-not-found" report against test-manifests/portal/.
                    string staleness = await DiagnoseManifestNotFoundAsync(repoRoot, fileArg!, manifestPath);
                    string error = $"manifest not found or unparseable: {fileArg}" + (staleness.Length > 0 ? $" — {staleness}" : "");

                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"runTest: manifest not found or unparseable: '{fileArg}' (searched recursively under {Path.Combine(repoRoot, "test-manifests")}).{(staleness.Length > 0 ? " " + staleness : "")}");
                    WriteShaneAppRunTestResult(req, fileArg, ok: false, error: error, manifestPath: manifestPath, result: null);
                    return;
                }

                // Stage: manifest successfully resolved + parsed.
                BuildConsole.Services.ActivityLog.Log(ch,
                    $"runTest: manifest resolved -> {manifestPath} (#{manifest.Issue} {manifest.Feature}).");

                string? onlyTag = GetShaneAppQueryParam(req.Raw, "onlyTag");
                if (!string.IsNullOrWhiteSpace(onlyTag))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, $"runTest: applying step filter onlyTag='{onlyTag}'.");
                    manifest.FilterByTag(onlyTag);

                    int filteredCount = manifest.ApiTests.Count + manifest.GraphTests.Count + manifest.PostGraphApiTests.Count + manifest.ZohoTests.Count + manifest.UiSteps.Count + manifest.PowerShellVerify.Count;
                    if (filteredCount == 0)
                    {
                        BuildConsole.Services.ActivityLog.Log(ch, $"runTest: filter onlyTag='{onlyTag}' resulted in 0 matching steps.");
                        WriteShaneAppRunTestResult(req, fileArg, ok: false, error: $"no steps matched session tag '{onlyTag}'", manifestPath: manifestPath, result: null);
                        return;
                    }
                }

                // See the file header: hold the same latch #898's remote poll uses — both for
                // mutual exclusion on the single shared runner AND to make RunManifestAsync run
                // headless (no blocking device-code / screenshot-review modals). This flag is
                // only ever touched on the UI thread (here and in TestTriggerTickAsync), and
                // this check-and-set runs before any await, so it can't race that poll.
                var stream = BuildConsole.Services.ShaneAppStreamService.Instance;
                stream.BeginRun($"Web Test: #{manifest.Issue} {manifest.Feature}", $"File: {fileArg}, Source: {src}");
                stream.AppendLine($"[TEST] Manifest resolved: {manifestPath}", BuildConsole.Services.ShaneAppLogLevel.Test);
                int totalSteps = manifest.ApiTests.Count + manifest.GraphTests.Count + manifest.PostGraphApiTests.Count + manifest.ZohoTests.Count + manifest.UiSteps.Count + manifest.PowerShellVerify.Count;
                stream.AppendLine($"[TEST] Issue #{manifest.Issue} — {manifest.Feature} (Total steps: {totalSteps}, UI: {manifest.UiSteps.Count}, PowerShell: {manifest.PowerShellVerify.Count})", BuildConsole.Services.ShaneAppLogLevel.Test);

                var sw = System.Diagnostics.Stopwatch.StartNew();
                try
                {
                    await BuildConsole.Services.TestQueueService.Instance.EnqueueAndRunAsync(
                        $"{fileArg} (#{manifest.Issue})",
                        src,
                        async () =>
                        {
                            _testTriggerBusy = true;
                            try
                            {
                                BuildConsole.Services.ActivityLog.Log(ch,
                                    $"[SECURITY BOUNDARY] runTest running manifest #{manifest.Issue} ({manifest.Feature}) from {manifestPath} (src='{src}') — HARD-LOCKED to TargetEnvironment.Dev ({BuildConsole.Services.BuildTrackerConfig.Load().GetBaseUrl(BuildConsole.Services.TargetEnvironment.Dev)})…");

                                // Git #3084 — pre-flight: the always-on api-server (:8080) has no
                                // supervisor keeping it alive, so if it died since the last run,
                                // every apiTest and every UI step that proxies to it fails purely
                                // because nothing restarted it — the exact "agents' tests fail via
                                // shaneapp:// because I had to start the server myself" report. Bring
                                // it up here, bounded, BEFORE the run, so a dead api-server is
                                // self-healed instead of producing a false-red result. Best-effort:
                                // if it genuinely can't come up in the window, the run proceeds and
                                // fails honestly rather than hanging the agent's poll.
                                await EnsureDevApiServerUpAsync(ch, stream);

                                var result = await RunManifestAsync(manifest, isRegression: false, targetEnv: BuildConsole.Services.TargetEnvironment.Dev);

                                int total = result.Steps.Count;
                                int passed = result.Steps.Count(s => s.Passed);
                                bool ok = total == 0 || passed == total;
                                string? error = total == 0
                                    ? null
                                    : (passed == total ? null : $"{total - passed} of {total} step(s) failed");

                                WriteShaneAppRunTestResult(req, fileArg, ok, error, manifestPath, result);
                                BuildConsole.Services.ActivityLog.Log(ch,
                                    $"runTest done in {sw.ElapsedMilliseconds}ms: {passed}/{total} step(s) passed. Result -> {ResolveRunTestResultPath(req, fileArg!)}");

                                stream.EndRun(ok, $"{passed}/{total} steps passed in {sw.ElapsedMilliseconds}ms");
                                return result;
                            }
                            finally
                            {
                                _testTriggerBusy = false;
                            }
                        });
                }
                catch (Exception ex)
                {
                    WriteShaneAppRunTestResult(req, fileArg, ok: false, error: ex.Message, manifestPath: manifestPath, result: null);
                    BuildConsole.Services.ActivityLog.Log(ch, $"runTest FAILED after {sw.ElapsedMilliseconds}ms: {ex.Message}");
                    stream.AppendLine($"[TEST ERROR] {ex.Message}", BuildConsole.Services.ShaneAppLogLevel.Error);
                    stream.EndRun(false, ex.Message);
                }
            }
            catch (Exception ex)
            {
                // Absolute backstop: any exception thrown OUTSIDE the run's own try/catch
                // above (e.g. during manifest resolution or the busy check) still yields a
                // result envelope so the caller's poll never hangs. The inner catch already
                // handles run-time failures and never rethrows, so this won't double-write on
                // the normal path.
                BuildConsole.Services.ActivityLog.Log(ch, $"runTest handler threw (backstop caught, writing failure envelope): {ex.Message}");
                WriteShaneAppRunTestResult(req, fileArg, ok: false, error: $"runTest handler error: {ex.Message}", manifestPath: manifestPath, result: null);
                BuildConsole.Services.ShaneAppStreamService.Instance.EndRun(false, ex.Message);
            }
        }

        /// <summary>
        /// Git #3084 — bring the always-on Dev api-server (:8080) up before a runTest manifest
        /// executes, if it's down. The api-server is the one service every apiTest hits directly
        /// and every UI step proxies through; it has no independent supervisor keeping it alive, so
        /// a crash/kill between runs left it dead and turned every subsequent shaneapp://runTest red
        /// for a reason unrelated to the code under test. This is a bounded, best-effort self-heal:
        /// if it's already responding, it returns immediately; if it's down, it starts it via the
        /// SAME dev-all launcher DevServicesManager uses and waits (bounded) for :8080 to answer
        /// /api/healthz. It NEVER throws and NEVER blocks indefinitely — on timeout the run proceeds
        /// and the manifest fails honestly rather than the agent's poll hanging.
        /// </summary>
        private static async Task EnsureDevApiServerUpAsync(string ch, BuildConsole.Services.ShaneAppStreamService stream)
        {
            try
            {
                int apiPort = BuildConsole.Services.DevServicesManager.KnownServices.TryGetValue("api-server", out var def)
                    ? def.Port
                    : 8080;

                // Already listening? Nothing to do — the common, zero-cost path.
                if (await BuildConsole.Services.DevServicesManager.IsPortOpenAsync(apiPort))
                    return;

                BuildConsole.Services.ActivityLog.Log(ch,
                    $"runTest pre-flight: api-server (:{apiPort}) is DOWN — starting it before the run (#3084 self-heal)…");
                stream.AppendLine($"[TEST] api-server (:{apiPort}) was down — starting it before the run…",
                    BuildConsole.Services.ShaneAppLogLevel.Test);

                await BuildConsole.Services.DevServicesManager.StartServiceAsync("api-server");

                // Bounded wait for a genuine rebuild+bind (dev-all runs kill-port -> build.mjs ->
                // node dist/index.mjs, so first bind can take a while). 90s ceiling so a build that
                // never comes up can't strand the agent's poll — the run then fails honestly.
                var deadline = DateTime.UtcNow.AddSeconds(90);
                while (DateTime.UtcNow < deadline)
                {
                    if (await BuildConsole.Services.DevServicesManager.IsPortOpenAsync(apiPort))
                    {
                        BuildConsole.Services.ActivityLog.Log(ch, $"runTest pre-flight: api-server (:{apiPort}) is up.");
                        stream.AppendLine($"[TEST] api-server (:{apiPort}) is up — proceeding with the run.",
                            BuildConsole.Services.ShaneAppLogLevel.Test);
                        return;
                    }
                    await Task.Delay(1500);
                }

                BuildConsole.Services.ActivityLog.Log(ch,
                    $"runTest pre-flight: api-server (:{apiPort}) did NOT come up within 90s — running anyway (result will reflect the real state).");
                stream.AppendLine($"[TEST] api-server (:{apiPort}) did not come up within 90s — running anyway.",
                    BuildConsole.Services.ShaneAppLogLevel.Test);
            }
            catch (Exception ex)
            {
                // Pre-flight must never break the run itself — if the self-heal throws, log and let
                // the manifest run (and fail honestly) rather than blocking the agent's poll.
                BuildConsole.Services.ActivityLog.Log(ch, $"runTest pre-flight ensure-api-server failed (non-fatal): {ex.Message}");
            }
        }

        /// <summary>
        /// Resolves a manifest ?file= value to a real path. Accepts, in order: an
        /// absolute/rooted path that exists; a repo-relative path that exists (e.g.
        /// "test-manifests/smoke/hello-world-ui.json"); otherwise the BARE filename,
        /// searched recursively under test-manifests/ — the same resolution #898/#964 use
        /// since #960 moved manifests into {area}/ subdirs. Null if nothing matches.
        /// </summary>
        private static string? ResolveManifestPath(string repoRoot, string fileArg)
        {
            if (Path.IsPathRooted(fileArg) && File.Exists(fileArg)) return fileArg;

            string repoRelative = Path.Combine(repoRoot, fileArg);
            if (File.Exists(repoRelative)) return repoRelative;

            string testManifestsRoot = Path.Combine(repoRoot, "test-manifests");
            if (!Directory.Exists(testManifestsRoot)) return null;

            string bare = Path.GetFileName(fileArg);
            if (string.IsNullOrWhiteSpace(bare)) return null;
            return Directory.EnumerateFiles(testManifestsRoot, bare, SearchOption.AllDirectories).FirstOrDefault();
        }

        /// <summary>
        /// Git #3059 — the real cause behind a "manifest not found or unparseable" report against
        /// test-manifests/portal/ (repeatable in that session, for two already-merged-to-origin/main
        /// manifests, both bare-filename and full-repo-relative-path forms).
        ///
        /// ResolveManifestPath's directory scan is NOT depth- or directory-name-sensitive — proven by
        /// re-running it standalone against this exact repo root and by re-invoking the real
        /// shaneapp://runTest end-to-end against test-manifests/portal/risk-register.json and
        /// .../security-plan.json (both resolved and ran through RunManifestAsync cleanly). There is
        /// no path-construction or portal/-specific scanning bug to fix.
        ///
        /// What IS real: <see cref="BuildConsole.Services.BuildTrackerConfig.FindRepoRoot"/> anchors on
        /// THIS PROCESS's own checkout (the one BuildConsole.exe runs from) — a checkout that only ever
        /// advances via an explicit dev-server merge-back (scripts/dev-server/request-restart.mjs), not
        /// a periodic pull. A manifest merged into origin/main minutes before an agent's runTest call
        /// is genuinely invisible here until the next merge-back lands it — a real, evidenced gap
        /// (confirmed live: this checkout sat 15 commits behind origin/main during this build with no
        /// error surfaced anywhere). That is the actual, repeatable failure mode the report hit, not a
        /// resolution-logic defect — and it self-resolves on the next merge-back, which is exactly why
        /// it no longer reproduces days later.
        ///
        /// This turns a misleading generic "not found" into an accurate one so nobody re-chases a path
        /// bug that isn't there. Best-effort and bounded (5s per git call): never throws, never blocks
        /// the caller's poll, and returns "" (falls back to the plain message) if git/origin isn't
        /// reachable, the checkout isn't behind, or the filename genuinely doesn't exist upstream either.
        /// </summary>
        private static async Task<string> DiagnoseManifestNotFoundAsync(string repoRoot, string fileArg, string? manifestPath)
        {
            // A resolved path that failed to PARSE is a real JSON/content bug, not staleness —
            // nothing to diagnose here.
            if (manifestPath != null) return "";

            try
            {
                string bare = Path.GetFileName(fileArg);
                if (string.IsNullOrWhiteSpace(bare)) return "";

                var behind = await BuildConsole.Services.SubprocessRunner.RunAsync(
                    "git", new[] { "-C", repoRoot, "rev-list", "--count", "HEAD..origin/main" },
                    timeout: TimeSpan.FromSeconds(5));
                if (!behind.Ok) return "";
                if (!int.TryParse(behind.StdOut.Trim(), out int behindCount) || behindCount <= 0) return "";

                var upstream = await BuildConsole.Services.SubprocessRunner.RunAsync(
                    "git", new[] { "-C", repoRoot, "ls-tree", "-r", "--name-only", "origin/main", "--", "test-manifests" },
                    timeout: TimeSpan.FromSeconds(5));
                if (!upstream.Ok) return "";

                string? upstreamMatch = upstream.StdOut
                    .Split('\n')
                    .Select(l => l.Trim())
                    .FirstOrDefault(l => l.Length > 0 &&
                        string.Equals(Path.GetFileName(l), bare, StringComparison.OrdinalIgnoreCase));

                if (upstreamMatch == null) return "";

                return $"this checkout is {behindCount} commit(s) behind origin/main and '{upstreamMatch}' exists there but not here yet — a stale local checkout (Git #3059), not a resolution bug; it self-resolves on the next dev-server merge-back";
            }
            catch
            {
                return "";
            }
        }

        /// <summary>
        /// Where the runTest result envelope is written: the caller's ?resultRef= if given;
        /// else a predictable temp-dir path keyed by the manifest filename, so a caller can
        /// compute it without passing resultRef (%TEMP%\shaneapp-runTest-&lt;file&gt;.result.json).
        /// </summary>
        private static string ResolveRunTestResultPath(BuildConsole.Services.ShaneAppRequest req, string fileArg)
        {
            if (!string.IsNullOrWhiteSpace(req.ResultRef)) return req.ResultRef!;
            string stem = string.IsNullOrWhiteSpace(fileArg) ? "manifest" : Path.GetFileName(fileArg);
            return Path.Combine(Path.GetTempPath(), $"shaneapp-runTest-{stem}.result.json");
        }

        /// <summary>
        /// Best-effort writes the runTest JSON result envelope: a top-line ok / pass-fail
        /// summary a CLI agent can branch on immediately, PLUS the full ManifestRunResult
        /// (the SAME shape test-results/*.json and #898's HTTP delivery use). A failed write
        /// is logged, never thrown.
        /// </summary>
        private void WriteShaneAppRunTestResult(BuildConsole.Services.ShaneAppRequest req, string? fileArg, bool ok, string? error,
            string? manifestPath, BuildConsole.Services.ManifestRunResult? result)
        {
            string path = ResolveRunTestResultPath(req, fileArg ?? "");
            try
            {
                string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                string? manifestRel = (manifestPath != null && repoRoot != null)
                    ? Path.GetRelativePath(repoRoot, manifestPath).Replace('\\', '/')
                    : manifestPath;

                int total = result?.Steps.Count ?? 0;
                int passed = result?.Steps.Count(s => s.Passed) ?? 0;

                string? onlyTag = GetShaneAppQueryParam(req.Raw, "onlyTag");

                var envelope = new
                {
                    ok,
                    error,
                    action = "runTest",
                    source = req.Source,
                    ranAtUtc = DateTime.UtcNow.ToString("o"),
                    manifestFile = fileArg,
                    manifestPath = manifestRel,
                    onlyTag = string.IsNullOrWhiteSpace(onlyTag) ? null : onlyTag,
                    issue = result?.Issue,
                    feature = result?.Feature,
                    stepCount = total,
                    passedCount = passed,
                    failedCount = total - passed,
                    result,
                };

                File.WriteAllText(path,
                    System.Text.Json.JsonSerializer.Serialize(envelope,
                        new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log(BuildConsole.Services.ShaneAppProtocol.LogChannel,
                    $"couldn't write runTest result file {path}: {ex.Message}");
            }
        }

        /// <summary>
        /// Minimal single-key query-string reader over a raw shaneapp:// URI, so runTest
        /// can read ?file= without touching the shared ShaneAppProtocol parser (kept
        /// edit-free to avoid colliding with the concurrent executeSql work on that file).
        /// Percent-decodes the value; returns null if the URI is unparseable or the key
        /// absent. Mirrors ShaneAppProtocol.ParseQuery's semantics (case-insensitive key,
        /// last-write-wins).
        /// </summary>
        private static string? GetShaneAppQueryParam(string? rawUri, string key)
        {
            if (string.IsNullOrWhiteSpace(rawUri)) return null;
            try
            {
                var uri = new Uri(rawUri);
                string? value = null;
                foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
                {
                    var idx = pair.IndexOf('=');
                    string k = idx < 0 ? pair : pair.Substring(0, idx);
                    if (!string.Equals(Uri.UnescapeDataString(k), key, StringComparison.OrdinalIgnoreCase)) continue;
                    value = idx < 0 ? "" : Uri.UnescapeDataString(pair.Substring(idx + 1));
                }
                return value;
            }
            catch
            {
                return null; // unparseable → treated as absent
            }
        }
    }
}
