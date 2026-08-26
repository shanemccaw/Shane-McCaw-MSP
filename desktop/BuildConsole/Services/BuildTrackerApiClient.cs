using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    public class QueueItem
    {
        public int Id { get; set; }
        public string Title { get; set; } = "";
        public string Prompt { get; set; } = "";
        public string? Model { get; set; }
        public string? Effort { get; set; }
        public string? Cwd { get; set; }
        /// <summary>Build Sets — an optional named group (the `--buildSet &lt;name&gt;` build-prompt header flag) shared by a stack of related builds. When set, the scripts/dev-server coordinator DEFERS the dev-server restart until every member of the set has merged, then fires exactly ONE restart+rebuild of all services + one combined test pass. Passed to each launched build as the DEV_BUILD_SET env var. Null = ungrouped (existing per-build behavior).</summary>
        public string? BuildSet { get; set; }
        public int? GithubNumber { get; set; }
        public int? BlockedByNumber { get; set; }
        /// <summary>Git #813 — the real field going forward; BlockedByNumber (singular) stays for back-compat, set to the first entry.</summary>
        public List<int>? BlockedByNumbers { get; set; }
        public string Status { get; set; } = "queued";
        public int? ExitCode { get; set; }
        /// <summary>Git #826 — the real Claude Code session id this run's own stream-json output revealed, captured at completion so a later Reply can resume this exact conversation.</summary>
        public string? SessionId { get; set; }
        /// <summary>Git #826 — set by a Reply action: tells the watcher to launch this item with --resume &lt;this&gt; instead of a fresh session.</summary>
        public string? ResumeSessionId { get; set; }
        /// <summary>The full Claude chat URL that queued this build request.</summary>
        public string? ChatUrl { get; set; }
        /// <summary>Originating Claude conversation UUID when queued from a chat tab.</summary>
        public string? OriginatingChatId { get; set; }
        /// <summary>Git #905 — the server's own `updatedAt` was already in the response (`GET /extension/queue` spreads the whole row), just never captured client-side; used to show "done {time}" on the new Completed tile.</summary>
        public DateTimeOffset? UpdatedAt { get; set; }
    }

    /// <summary>Matches POST /admin/simulator/deploy/console's real `{ ok, command, output }` response shape.</summary>
    public class DeployConsoleResult
    {
        public bool Ok { get; set; }
        public string Command { get; set; } = "";
        public string Output { get; set; } = "";
    }

    public class BlockedByInfo
    {
        public int Number { get; set; }
        public string Title { get; set; } = "";
        public string State { get; set; } = "";
        public bool Complete { get; set; }
    }

    public class InProgressItem
    {
        public int GithubNumber { get; set; }
        public string Title { get; set; } = "";
        public List<string> Labels { get; set; } = new();
        public string GithubUrl { get; set; } = "";
        public bool IsEpic { get; set; }
        public bool IsTodo { get; set; }
        public bool IsBlocked { get; set; }
        public BlockedByInfo? BlockedBy { get; set; }
        public string? SqlPath { get; set; }
    }

    public class BoardEpic
    {
        public int Id { get; set; }
        public string Title { get; set; } = "";
        public string Status { get; set; } = "";
        public int? GithubNumber { get; set; }
    }

    public class BoardChat
    {
        public string ConversationId { get; set; } = "";
        public string Title { get; set; } = "";
        public int? EpicId { get; set; }
        public int? IssueGithubNumber { get; set; }
        /// <summary>All GitHub issue/epic/milestone numbers associated with this chat (many-to-many join table bt_chat_issues).</summary>
        public List<int> AssociatedIssueNumbers { get; set; } = new();
        public string ClaudeUrl { get; set; } = "";
        public DateTime? UpdatedAt { get; set; }
        /// <summary>Soft-hidden from the default Chats panel view — the real row + all associations stay intact. Reversible via Unarchive.</summary>
        public bool Archived { get; set; }
        public DateTime? ArchivedAt { get; set; }
    }

    public class BoardResponse
    {
        public List<BoardEpic> Epics { get; set; } = new();
        public List<BoardChat> Chats { get; set; } = new();
    }

    /// <summary>Git #829 — matches GET /admin/build-tracker/issues's real row shape.</summary>
    public class IssueSummary
    {
        public int Id { get; set; }
        public int? EpicId { get; set; }
        public string Title { get; set; } = "";
        public string Status { get; set; } = "";
        public int? GithubNumber { get; set; }
        public string? GithubUrl { get; set; }
        public int ChatCount { get; set; }
    }

    /// <summary>Git #805 — matches GET /api/internal/deploy-status's `{ commitHash, timestamp }` shape.</summary>
    public class DeployStatus
    {
        public string CommitHash { get; set; } = "";
        public string Timestamp { get; set; } = "";
    }

    /// <summary>Git #911 — matches POST /api/admin/deploy/build-complete's response shape
    /// (`{ ok, steps, restarting, pollUrl, note, error? }`). `restarting` true means the deferred
    /// `kill 1` restart was scheduled and the connection is about to drop — poll deploy-status (#805)
    /// for the new commit hash; do NOT treat this body as "the server is back".</summary>
    public class BuildCompleteResult
    {
        public bool Ok { get; set; }
        public bool Restarting { get; set; }
        public string? Error { get; set; }
        public string? Note { get; set; }
        public List<BuildCompleteStep> Steps { get; set; } = new();
    }

    /// <summary>One step of #911's pipeline (apply schema SQL / git pull / restart). `command` is
    /// present in the wire shape too but not needed here, so it's left off (extra JSON is ignored).</summary>
    public class BuildCompleteStep
    {
        public string Label { get; set; } = "";
        public bool Ok { get; set; }
        public string Output { get; set; } = "";
    }

    /// <summary>
    /// Git #898 — one claimed test-run request from GET /admin/deploy/test-run/next.
    /// RunId is null when nothing is pending (the poll's "nothing to do" answer);
    /// otherwise it's the id to report completion against, and ManifestFile is the
    /// bare filename under test-manifests/ that Claude Code asked to run.
    /// </summary>
    public class TestRunRequest
    {
        public string? RunId { get; set; }
        public string ManifestFile { get; set; } = "";
    }

    /// <summary>SSMS-style per-statement result — matches admin-engines.ts's StatementResult exactly (POST /simulator/sql/execute, same endpoint the extension's floaty SQL Runner already uses for real).</summary>
    public class SqlStatementResult
    {
        public int StatementIndex { get; set; }
        public string StatementText { get; set; } = "";
        public bool Success { get; set; }
        public List<Dictionary<string, JsonElement>> Rows { get; set; } = new();
        public int RowCount { get; set; }
        public List<string> Fields { get; set; } = new();
        public int ExecutionMs { get; set; }
        public string? Error { get; set; }
    }

    /// <summary>
    /// Git #931 — Shane: "the dev server auto shutting down every 15 min
    /// with no refresh really is sucking and slowing me down." /
    /// "even the build queue does the same thing... but that one I want to
    /// keep on the server, but maybe also have a synced local JSON file so
    /// I can keep going even when the Replit dev servers shut down."
    /// Wraps a live-fetch result (IsStale = false) or, when the live call
    /// fails but a local cache from a previous successful fetch exists, the
    /// cached data instead (IsStale = true, CachedAtUtc = when it was last
    /// genuinely live) - so a display-only panel can keep showing
    /// last-known-good state through a dev-server nap instead of going
    /// blank, while still being able to tell the difference and say so.
    /// </summary>
    public class CachedResult<T>
    {
        public T Data { get; set; } = default!;
        public bool IsStale { get; set; }
        public DateTime? CachedAtUtc { get; set; }
    }

    /// <summary>
    /// Talks to the SAME /api/admin/build-tracker/extension/* endpoints the browser
    /// extension and scripts/build-queue-watcher.ps1 already use - one real backend,
    /// three different front ends, so behavior (nesting, blocked state, label sync)
    /// never has to be reinvented or drift between them.
    /// </summary>
    public class BuildTrackerApiClient
    {
        private static readonly JsonSerializerOptions JsonOpts = new()
        {
            PropertyNameCaseInsensitive = true,
        };

        private readonly HttpClient _http;

        public HttpClient HttpClient => _http;

        public bool IsConfigured { get; }
        public string ConfiguredApiBaseUrl { get; }
        public string? ConfigPath { get; }

        public BuildTrackerApiClient(BuildTrackerConfig config)
        {
            IsConfigured = config.IsConfigured;
            ConfiguredApiBaseUrl = config.ApiBaseUrl;
            var baseUrl = string.IsNullOrWhiteSpace(config.ApiBaseUrl) ? "http://localhost:8080" : config.ApiBaseUrl.TrimEnd('/') + "/";
            _http = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(20) };
            if (!string.IsNullOrWhiteSpace(config.IngestToken))
            {
                _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.IngestToken);
            }
        }

        /// <summary>
        /// Git #931 — read-through local JSON cache, one file per `key`
        /// under `%AppData%\BuildConsole\cache\`. A successful live fetch
        /// always overwrites the cache and wins - this is a fallback for
        /// when the server's unreachable, never a replacement for it. Scoped
        /// deliberately to DISPLAY-ONLY callers (the Chats tree, the visible
        /// Build Queue panel) - QueueWatcherService's own claim/launch calls
        /// go through the plain (uncached) GetQueueAsync below unchanged,
        /// since serving it stale data could mean claiming/launching against
        /// a queue state that's no longer true.
        /// </summary>
        private static readonly string CacheDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole", "cache");

        private static async Task<CachedResult<T>> CachedAsync<T>(string key, Func<Task<T>> liveFetch) where T : class
        {
            string path = Path.Combine(CacheDir, $"{key}.json");
            try
            {
                var data = await liveFetch();
                try
                {
                    Directory.CreateDirectory(CacheDir);
                    File.WriteAllText(path, JsonSerializer.Serialize(data));
                }
                catch { /* best-effort - a failed cache write shouldn't fail a successful live fetch */ }
                return new CachedResult<T> { Data = data, IsStale = false };
            }
            catch (Exception liveEx) when (TryLoadCache<T>(path, out var cached))
            {
                ActivityLog.Log("api", $"cache: {key} live fetch failed ({liveEx.Message}), serving cached copy from {File.GetLastWriteTimeUtc(path):u}");
                return new CachedResult<T> { Data = cached!, IsStale = true, CachedAtUtc = File.GetLastWriteTimeUtc(path) };
            }
        }

        private static bool TryLoadCache<T>(string path, out T? cached) where T : class
        {
            cached = null;
            try
            {
                if (!File.Exists(path)) return false;
                cached = JsonSerializer.Deserialize<T>(File.ReadAllText(path), JsonOpts);
                return cached != null;
            }
            catch { return false; }
        }

        /// <summary>
        /// Git #815 — Shane: "put the startup SSE and api calls in there...
        /// so we can just look and see whats happening as its happening in
        /// the background." Wraps every real HTTP call with a start/end (or
        /// failure) line into ActivityLog; ActivityLog.Log() itself never
        /// blocks the caller (fire-and-forget onto the UI thread), so this
        /// adds visibility without adding any risk of the app hanging on it.
        /// </summary>
        private static async Task<T> TrackAsync<T>(string label, Func<Task<T>> fn)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            ActivityLog.Log("api", $"-> {label}");
            try
            {
                var result = await fn();
                ActivityLog.Log("api", $"<- {label} ok ({sw.ElapsedMilliseconds}ms)");
                return result;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("api", $"x {label} FAILED ({sw.ElapsedMilliseconds}ms): {ex.Message}");
                throw;
            }
        }

        public Task<List<QueueItem>> GetQueueAsync() => TrackAsync("GET queue", async () =>
        {
            var res = await _http.GetFromJsonAsync<QueueResponse>("api/admin/build-tracker/extension/queue", JsonOpts);
            return res?.Items ?? new List<QueueItem>();
        });

        /// <summary>Git #931 — display-only twin of GetQueueAsync above, for BuildQueuePanel's own visible tree: falls back to the local cache when the live fetch fails, so the panel keeps showing last-known-good state through a dev-server nap instead of a dead error. Deliberately NOT used by QueueWatcherService's claim/launch path - that one needs GetQueueAsync's real live-or-throw behavior, never a stale substitute.</summary>
        public Task<CachedResult<List<QueueItem>>> GetQueueCachedAsync() => TrackAsync("GET queue (cached)", () => CachedAsync("queue", async () =>
        {
            var res = await _http.GetFromJsonAsync<QueueResponse>("api/admin/build-tracker/extension/queue", JsonOpts);
            return res?.Items ?? new List<QueueItem>();
        }));

        public Task<List<QueueItem>> GetNextQueueItemsAsync(int limit, List<int> excludeIds) => TrackAsync($"GET queue/next?limit={limit}", async () =>
        {
            string url = $"api/admin/build-tracker/extension/queue/next?limit={limit}";
            if (excludeIds != null && excludeIds.Count > 0)
            {
                url += $"&exclude={string.Join(",", excludeIds)}";
            }
            var res = await _http.GetFromJsonAsync<QueueResponse>(url, JsonOpts);
            return res?.Items ?? new List<QueueItem>();
        });

        public Task<List<InProgressItem>> GetInProgressAsync() => TrackAsync("GET in-progress", async () =>
        {
            var res = await _http.GetFromJsonAsync<InProgressResponse>("api/admin/build-tracker/extension/in-progress", JsonOpts);
            return res?.Issues ?? new List<InProgressItem>();
        });

        /// <summary>Git #805 — NOT under api/admin/build-tracker/extension/*; this hits the standalone GET /api/internal/deploy-status endpoint (version.ts), the same versionInfo the platform's own GET /api/version already serves.</summary>
        public Task<DeployStatus?> GetDeployStatusAsync() => TrackAsync("GET internal/deploy-status", () =>
            _http.GetFromJsonAsync<DeployStatus>("api/internal/deploy-status", JsonOpts));

        /// <summary>
        /// Git #911 (Epic #803) — POST /api/admin/deploy/build-complete: the api-server runs the
        /// real `git pull --ff-only` then schedules the deferred/detached `kill 1` restart so the
        /// pulled commit is actually loaded. This is the SAME endpoint trigger-deploy-and-wait.ps1
        /// drives by hand; PostBuildDeployPipeline fires it automatically on build completion. The
        /// restart drops the connection AFTER this response flushes, so a returned body is NOT proof
        /// the server is back — the caller must poll GetDeployStatusAsync() (#805) until commitHash
        /// flips. `schemaSql` is normally null (this repo's rule: Shane supplies any CREATE/ALTER/
        /// INSERT SQL by hand); passed through verbatim only when non-null.
        ///
        /// Deliberately does NOT throw on a non-2xx: #911 legitimately answers 500 with a JSON body
        /// (git pull diverged / schema SQL rolled back) the caller needs to read, so the parsed body
        /// is returned regardless of status. A hard connection failure (the restart dropping
        /// mid-flush, or a non-JSON body) is caught and returned as a shaped Restarting result rather
        /// than thrown, since the commit-hash flip is the real source of truth either way.
        /// </summary>
        public Task<BuildCompleteResult?> PostBuildCompleteAsync(string? schemaSql = null) =>
            TrackAsync<BuildCompleteResult?>("POST admin/deploy/build-complete", async () =>
            {
                object body = schemaSql != null ? new { schemaSql } : new { };
                var resp = await _http.PostAsJsonAsync("api/admin/deploy/build-complete", body);
                try
                {
                    return await resp.Content.ReadFromJsonAsync<BuildCompleteResult>(JsonOpts)
                           ?? new BuildCompleteResult { Ok = resp.IsSuccessStatusCode, Restarting = resp.IsSuccessStatusCode };
                }
                catch
                {
                    // Non-JSON / empty body (e.g. the connection dropped mid-flush on restart): don't
                    // fail the pipeline — hand back a shaped result so it proceeds to poll #805.
                    return new BuildCompleteResult { Ok = resp.IsSuccessStatusCode, Restarting = resp.IsSuccessStatusCode };
                }
            });

        /// <summary>
        /// Git #898 — polls GET /admin/deploy/test-run/next to atomically claim the
        /// oldest pending test-run request Claude Code POSTed. Deliberately NOT wrapped
        /// in TrackAsync (unlike every call above): this fires every few seconds on the
        /// #898 poll timer whether or not anything is pending, and an "-> / <- ok" pair
        /// per empty poll would flood the Output log. The meaningful lifecycle events
        /// (claimed / running / done / failed) are logged on `testing.remote-trigger`
        /// from MainWindow's poll handler instead. Returns a request whose RunId is null
        /// when nothing is waiting.
        /// </summary>
        public Task<TestRunRequest?> GetNextTestRunAsync() =>
            _http.GetFromJsonAsync<TestRunRequest>("api/admin/deploy/test-run/next", JsonOpts);

        /// <summary>
        /// Git #898 — reports a finished test-run back to the api-server so the waiting
        /// Claude Code poll (GET /admin/deploy/test-run/:runId) can read it. `status` is
        /// "done" (it executed — the results JSON carries per-step pass/fail) or "failed"
        /// (it couldn't run at all, e.g. the manifest file was missing). `results` is the
        /// exact ManifestRunResult JSON (same shape written to test-results/), passed as a
        /// JsonElement so its property names round-trip verbatim rather than being
        /// re-cased; null on the failed-before-run path.
        /// </summary>
        public Task<HttpResponseMessage> CompleteTestRunAsync(string runId, string status, JsonElement? results, string? error) =>
            TrackAsync($"POST deploy/test-run/{runId}/complete ({status})", () =>
                _http.PostAsJsonAsync($"api/admin/deploy/test-run/{runId}/complete", new { status, results, error }));

        /// <summary>
        /// Git #967 (Epic #803) — the background RegressionScheduleService calls this ONLY
        /// when a scheduled regression run has one or more failing manifests, to raise an
        /// admin web-push alert (server-side sendWebPushToAdmins, the #727 pattern) naming the
        /// failing manifest/step with a deep link back into the app. A fully passing scheduled
        /// run never calls this. Uses the same shared, Bearer-ingest-token _http as every other
        /// call; returns true only on a 2xx so the scheduler can log whether the push actually
        /// went out (vs the api-server being asleep or Build Tracker not configured).
        /// </summary>
        public async Task<bool> SendTestAlertAsync(string title, string body, string linkPath)
        {
            if (!IsConfigured) return false;
            try
            {
                var resp = await _http.PostAsJsonAsync("api/admin/deploy/test-alert", new { title, body, linkPath });
                return resp.IsSuccessStatusCode;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// No conversationId — this app isn't tied to one specific claude.ai
        /// chat the way the browser extension is, so `currentChat` in the
        /// response is always null; `epics`/`chats` still come back full,
        /// which is all the Chats tree needs. Git #931 — Shane: "convert the
        /// chats list into a local JSON file... this pulling it from the dev
        /// server, the dev server auto shutting down every 15 min... really
        /// is sucking and slowing me down." Falls back to the local cache
        /// when the live fetch fails, same shape as GetQueueCachedAsync
        /// above - display-only (the Chats tree is purely a read view, no
        /// claim/launch semantics to worry about like the queue watcher).
        /// </summary>
        public Task<CachedResult<BoardResponse>> GetBoardAsync() => TrackAsync("GET board", () => CachedAsync("board", async () =>
        {
            var res = await _http.GetFromJsonAsync<BoardResponse>("api/admin/build-tracker/extension/board", JsonOpts);
            return res ?? new BoardResponse();
        }));

        /// <summary>Git #829 — Shane: "I need the right panel to have another section that shows me all the issues assigned to the chat I'm on." Real GET /admin/build-tracker/issues?epicId=N, same route the admin-panel's own issue tracker UI uses.</summary>
        public Task<List<IssueSummary>> GetIssuesForEpicAsync(int epicId) => TrackAsync($"GET issues?epicId={epicId}", async () =>
        {
            var res = await _http.GetFromJsonAsync<List<IssueSummary>>($"api/admin/build-tracker/issues?epicId={epicId}", JsonOpts);
            return res ?? new List<IssueSummary>();
        });

        /// <summary>
        /// Git #828 — Shane: "I need a way to assign a chat to an epic in
        /// the WPF app." Same POST /chats/ingest the extension's own "link
        /// this chat to that epic" click already uses (Git #781 — force:
        /// true is what makes an explicit assignment win over the
        /// non-clobbering passive title-sync rule; issueId is always null
        /// here since this app only assigns by epic, matching the ask).
        /// </summary>
        public Task<HttpResponseMessage> LinkChatToEpicAsync(string conversationId, int epicId) =>
            TrackAsync($"POST chats/ingest (chat -> epic {epicId})", () => _http.PostAsJsonAsync("api/admin/build-tracker/chats/ingest", new
            {
                conversation_id = conversationId,
                epicId,
                force = true,
            }));

        /// <summary>
        /// "Unassign from Epic" — clears a chat's real epicId server-side via
        /// POST /chats/unassign-epic (looked up by conversationId, since the
        /// /extension/board response never exposes the chat's numeric db id).
        /// On success the chat drops out of its former epic's group and
        /// falls into the existing "Unlinked" bucket the next time the tree
        /// re-renders — no client-side grouping change needed.
        /// </summary>
        public Task<HttpResponseMessage> UnlinkChatFromEpicAsync(string conversationId) =>
            TrackAsync("POST chats/unassign-epic", () => _http.PostAsJsonAsync("api/admin/build-tracker/chats/unassign-epic", new
            {
                conversation_id = conversationId,
            }));

        /// <summary>
        /// Links a chat to any GitHub issue/epic/milestone number via many-to-many join table bt_chat_issues.
        /// </summary>
        public Task<HttpResponseMessage> LinkChatToIssueAsync(string conversationId, int issueNumber, string? title = null) =>
            TrackAsync($"POST chats/assign-issue ({conversationId} -> #{issueNumber})", () => _http.PostAsJsonAsync("api/admin/build-tracker/chats/assign-issue", new
            {
                conversation_id = conversationId,
                issue_number = issueNumber,
                title,
            }));

        /// <summary>
        /// Unlinks a chat from a specific GitHub issue/epic/milestone number in bt_chat_issues.
        /// </summary>
        public Task<HttpResponseMessage> UnlinkChatFromIssueAsync(string conversationId, int issueNumber) =>
            TrackAsync($"POST chats/unassign-issue ({conversationId} -x #{issueNumber})", () => _http.PostAsJsonAsync("api/admin/build-tracker/chats/unassign-issue", new
            {
                conversation_id = conversationId,
                issue_number = issueNumber,
            }));

        /// <summary>
        /// Renames a chat's display title in bt_chats by its conversationId.
        /// </summary>
        public Task<HttpResponseMessage> RenameChatAsync(string conversationId, string newTitle) =>
            TrackAsync($"POST chats/rename ({conversationId} -> \"{newTitle}\")", () => _http.PostAsJsonAsync("api/admin/build-tracker/chats/rename", new
            {
                conversation_id = conversationId,
                title = newTitle,
            }));

        /// <summary>
        /// Archives a chat — soft-hides it from the default active Chats panel view.
        /// The real bt_chats row and every association (bt_chat_issues, epic/issue
        /// links) stay fully intact and retrievable. Reversible via UnarchiveChatAsync.
        /// </summary>
        public Task<HttpResponseMessage> ArchiveChatAsync(string conversationId) =>
            TrackAsync($"POST chats/archive ({conversationId})", () => _http.PostAsJsonAsync("api/admin/build-tracker/chats/archive", new
            {
                conversation_id = conversationId,
            }));

        /// <summary>Reverses ArchiveChatAsync — restores a chat to the default active Chats panel view.</summary>
        public Task<HttpResponseMessage> UnarchiveChatAsync(string conversationId) =>
            TrackAsync($"POST chats/unarchive ({conversationId})", () => _http.PostAsJsonAsync("api/admin/build-tracker/chats/unarchive", new
            {
                conversation_id = conversationId,
            }));

        /// <summary>
        /// "Assign Chat to Epic" auto-register-on-miss: same
        /// POST /extension/sync-epic the admin panel's "Sync GitHub" button
        /// calls, scoped to one issue number. Always upserts the target
        /// issue's own bt_epics row (line ~1907 of admin-build-tracker.ts),
        /// regardless of whether it has sub-issues - so it registers plain
        /// leaf issues as epics too, not just ones with children.
        /// </summary>
        public Task<HttpResponseMessage> SyncEpicAsync(int epicNumber, string? title = null, string? description = null, string? status = null) =>
            TrackAsync($"POST extension/sync-epic ({epicNumber})", () => _http.PostAsJsonAsync("api/admin/build-tracker/extension/sync-epic", new
            {
                epicNumber,
                title,
                description,
                status,
            }));

        /// <summary>Same file-content endpoint the extension's Shane-To-Do 🗄 button uses — reads a real migration file's text straight from GitHub, no local filesystem assumption.</summary>
        public Task<string> GetFileContentAsync(string path) => TrackAsync($"GET file-content {path}", async () =>
        {
            var res = await _http.GetFromJsonAsync<FileContentResponse>(
                $"api/admin/build-tracker/extension/file-content?path={Uri.EscapeDataString(path)}", JsonOpts);
            return res?.Content ?? "";
        });

        private class FileContentResponse { public string Content { get; set; } = ""; }

        /// <summary>
        /// Shane: "the Terminal panel... is supposed to send the commands to
        /// the Replit server." Real POST /admin/simulator/deploy/console —
        /// the SAME free-text deploy-console endpoint the admin panel's own
        /// floating console already uses (`admin-deploy-console.ts`): runs
        /// the command verbatim via child_process.exec on the dev server
        /// itself (cwd = repo root), gated by the same Bearer ingest-token
        /// auth as everything else here. Not a local shell — a real command
        /// executed on Replit, with real stdout/stderr returned.
        /// </summary>
        public Task<DeployConsoleResult> RunDeployConsoleCommandAsync(string command) => TrackAsync($"POST deploy/console \"{command}\"", async () =>
        {
            var res = await _http.PostAsJsonAsync("api/admin/simulator/deploy/console", new { command });
            var body = await res.Content.ReadFromJsonAsync<DeployConsoleResult>(JsonOpts);
            if (body != null) return body;
            var raw = await res.Content.ReadAsStringAsync();
            return new DeployConsoleResult { Ok = false, Command = command, Output = string.IsNullOrWhiteSpace(raw) ? $"HTTP {(int)res.StatusCode}" : raw };
        });

        /// <summary>
        /// Real execute — POST /api/simulator/sql/execute, the SAME endpoint the
        /// browser extension's floaty SQL Runner already uses. Not a Claude Code
        /// session (CLAUDE.md's "no direct database access" rule is specifically
        /// about those) — this is Shane's own local app talking to the real
        /// dev api-server, which does have DB access, the exact same path he
        /// already explicitly approved for the extension.
        /// </summary>
        public Task<List<SqlStatementResult>> ExecuteSqlAsync(string query) => TrackAsync("POST sql/execute", async () =>
        {
            var res = await _http.PostAsJsonAsync("api/simulator/sql/execute", new { query });
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync();
                throw new HttpRequestException($"HTTP {(int)res.StatusCode}: {body}");
            }
            var parsed = await res.Content.ReadFromJsonAsync<SqlExecuteResponse>(JsonOpts);
            return parsed?.Statements ?? new List<SqlStatementResult>();
        });

        private class SqlExecuteResponse { public List<SqlStatementResult> Statements { get; set; } = new(); }

        /// <summary>Git #814 — same POST the extension's "📋 Queue" button and background.js's queueBuild() already use, now called directly from the WPF app's own injected chat buttons. Git #826 added resumeSessionId — set by a Reply action so the watcher launches with --resume instead of a fresh session.</summary>
        public Task<HttpResponseMessage> QueueBuildAsync(string title, string prompt, string? model, string? effort, string? cwd, int? githubNumber, List<int>? blockedByNumbers, string? resumeSessionId = null, string? chatUrl = null, string? originatingChatId = null) =>
            TrackAsync($"POST queue \"{title}\"", () => _http.PostAsJsonAsync("api/admin/build-tracker/extension/queue", new
            {
                title,
                prompt,
                model,
                effort,
                cwd,
                githubNumber,
                blockedByNumbers,
                resumeSessionId,
                chatUrl,
                originatingChatId,
            }));

        /// <summary>Git #826 — sessionId (captured from this run's own stream-json output) is stored so a later Reply can resume this exact conversation.</summary>
        public Task<HttpResponseMessage> MarkQueueItemCompleteAsync(int id, int exitCode, string? sessionId = null) =>
            TrackAsync($"POST queue/{id}/complete", () => _http.PostAsJsonAsync($"api/admin/build-tracker/extension/queue/{id}/complete", new { exitCode, sessionId }));

        public Task<HttpResponseMessage> CancelQueueItemAsync(int id) =>
            TrackAsync($"DELETE queue/{id}", () => _http.DeleteAsync($"api/admin/build-tracker/extension/queue/{id}"));

        /// <summary>Git #820 — "Run Now": atomically claims a still-queued row right now, bypassing the normal blocker/free-slot check. Returns the claimed row (caller still has to actually launch it) or throws on a 409 (already claimed/no longer queued).</summary>
        public Task<QueueItem> ForceClaimQueueItemAsync(int id) => TrackAsync($"POST queue/{id}/force-claim", async () =>
        {
            var res = await _http.PostAsync($"api/admin/build-tracker/extension/queue/{id}/force-claim", null);
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync();
                throw new HttpRequestException($"HTTP {(int)res.StatusCode}: {body}");
            }
            return await res.Content.ReadFromJsonAsync<QueueItem>(JsonOpts) ?? throw new HttpRequestException("Empty response");
        });

        public Task<HttpResponseMessage> ToggleLabelAsync(int number, string label, bool add) =>
            TrackAsync($"POST toggle-label #{number} {label}={add}", () => _http.PostAsJsonAsync("api/admin/build-tracker/extension/toggle-label", new { number, label, add }));

        private class QueueResponse { public List<QueueItem> Items { get; set; } = new(); }
        private class InProgressResponse { [JsonPropertyName("issues")] public List<InProgressItem> Issues { get; set; } = new(); }
    }
}
