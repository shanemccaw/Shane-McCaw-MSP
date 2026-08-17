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
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"runTest: manifest not found or unparseable: '{fileArg}' (searched recursively under {Path.Combine(repoRoot, "test-manifests")}).");
                    WriteShaneAppRunTestResult(req, fileArg, ok: false, error: $"manifest not found or unparseable: {fileArg}", manifestPath: manifestPath, result: null);
                    return;
                }

                // Stage: manifest successfully resolved + parsed.
                BuildConsole.Services.ActivityLog.Log(ch,
                    $"runTest: manifest resolved -> {manifestPath} (#{manifest.Issue} {manifest.Feature}).");

                // See the file header: hold the same latch #898's remote poll uses — both for
                // mutual exclusion on the single shared runner AND to make RunManifestAsync run
                // headless (no blocking device-code / screenshot-review modals). This flag is
                // only ever touched on the UI thread (here and in TestTriggerTickAsync), and
                // this check-and-set runs before any await, so it can't race that poll.
                if (_testTriggerBusy)
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"runTest: a test run is already in progress — refusing concurrent run of '{fileArg}'. Retry shortly.");
                    WriteShaneAppRunTestResult(req, fileArg, ok: false, error: "a test run is already in progress — retry shortly", manifestPath: manifestPath, result: null);
                    return;
                }

                var stream = BuildConsole.Services.ShaneAppStreamService.Instance;
                stream.BeginRun($"Web Test: #{manifest.Issue} {manifest.Feature}", $"File: {fileArg}, Source: {src}");
                stream.AppendLine($"[TEST] Manifest resolved: {manifestPath}", BuildConsole.Services.ShaneAppLogLevel.Test);
                int totalSteps = manifest.ApiTests.Count + manifest.GraphTests.Count + manifest.PostGraphApiTests.Count + manifest.ZohoTests.Count + manifest.UiSteps.Count + manifest.PowerShellVerify.Count;
                stream.AppendLine($"[TEST] Issue #{manifest.Issue} — {manifest.Feature} (Total steps: {totalSteps}, UI: {manifest.UiSteps.Count}, PowerShell: {manifest.PowerShellVerify.Count})", BuildConsole.Services.ShaneAppLogLevel.Test);

                _testTriggerBusy = true;
                var sw = System.Diagnostics.Stopwatch.StartNew();
                try
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"runTest running manifest #{manifest.Issue} ({manifest.Feature}) from {manifestPath} (src='{src}')…");

                    var result = await RunManifestAsync(manifest, isRegression: false);

                    int total = result.Steps.Count;
                    int passed = result.Steps.Count(s => s.Passed);
                    // A step-ful run is "ok" only when every step passed. A step-less manifest
                    // genuinely ran with nothing to assert — report ok, but leave the counts
                    // at zero so the caller can tell it asserted nothing.
                    bool ok = total == 0 || passed == total;
                    string? error = total == 0
                        ? null
                        : (passed == total ? null : $"{total - passed} of {total} step(s) failed");

                    WriteShaneAppRunTestResult(req, fileArg, ok, error, manifestPath, result);
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"runTest done in {sw.ElapsedMilliseconds}ms: {passed}/{total} step(s) passed. Result -> {ResolveRunTestResultPath(req, fileArg!)}");

                    stream.EndRun(ok, $"{passed}/{total} steps passed in {sw.ElapsedMilliseconds}ms");
                }
                catch (Exception ex)
                {
                    WriteShaneAppRunTestResult(req, fileArg, ok: false, error: ex.Message, manifestPath: manifestPath, result: null);
                    BuildConsole.Services.ActivityLog.Log(ch, $"runTest FAILED after {sw.ElapsedMilliseconds}ms: {ex.Message}");
                    stream.AppendLine($"[TEST ERROR] {ex.Message}", BuildConsole.Services.ShaneAppLogLevel.Error);
                    stream.EndRun(false, ex.Message);
                }
                finally
                {
                    _testTriggerBusy = false;
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

                var envelope = new
                {
                    ok,
                    error,
                    action = "runTest",
                    source = req.Source,
                    ranAtUtc = DateTime.UtcNow.ToString("o"),
                    manifestFile = fileArg,
                    manifestPath = manifestRel,
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
