using System;
using System.Collections.Generic;
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
        /// <summary>Git #905 — the server's own `updatedAt` was already in the response (`GET /extension/queue` spreads the whole row), just never captured client-side; used to show "done {time}" on the new Completed tile.</summary>
        public DateTimeOffset? UpdatedAt { get; set; }
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
        public string ClaudeUrl { get; set; } = "";
        public DateTime? UpdatedAt { get; set; }
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

        public bool IsConfigured { get; }
        public string ConfiguredApiBaseUrl { get; }
        public string? ConfigPath { get; }

        public BuildTrackerApiClient(BuildTrackerConfig config)
        {
            IsConfigured = config.IsConfigured;
            ConfiguredApiBaseUrl = config.ApiBaseUrl;
            ConfigPath = BuildTrackerConfig.FindConfigPath();
            var baseUrl = string.IsNullOrWhiteSpace(config.ApiBaseUrl) ? "http://localhost" : config.ApiBaseUrl.TrimEnd('/') + "/";
            _http = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(20) };
            if (!string.IsNullOrWhiteSpace(config.IngestToken))
            {
                _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.IngestToken);
            }
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

        /// <summary>Git #817 — the same endpoint scripts/build-queue-watcher.ps1 polls (atomically claims up to `limit` ready rows, marks them running). Used by QueueWatcherService so the app can do this itself instead of requiring that separate script.</summary>
        public Task<List<QueueItem>> GetNextQueueItemsAsync(int limit) => TrackAsync($"GET queue/next?limit={limit}", async () =>
        {
            var res = await _http.GetFromJsonAsync<QueueResponse>($"api/admin/build-tracker/extension/queue/next?limit={limit}", JsonOpts);
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

        /// <summary>No conversationId — this app isn't tied to one specific claude.ai chat the way the browser extension is, so `currentChat` in the response is always null; `epics`/`chats` still come back full, which is all the Chats tree needs.</summary>
        public Task<BoardResponse> GetBoardAsync() => TrackAsync("GET board", async () =>
        {
            var res = await _http.GetFromJsonAsync<BoardResponse>("api/admin/build-tracker/extension/board", JsonOpts);
            return res ?? new BoardResponse();
        });

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

        /// <summary>Same file-content endpoint the extension's Shane-To-Do 🗄 button uses — reads a real migration file's text straight from GitHub, no local filesystem assumption.</summary>
        public Task<string> GetFileContentAsync(string path) => TrackAsync($"GET file-content {path}", async () =>
        {
            var res = await _http.GetFromJsonAsync<FileContentResponse>(
                $"api/admin/build-tracker/extension/file-content?path={Uri.EscapeDataString(path)}", JsonOpts);
            return res?.Content ?? "";
        });

        private class FileContentResponse { public string Content { get; set; } = ""; }

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
        public Task<HttpResponseMessage> QueueBuildAsync(string title, string prompt, string? model, string? effort, string? cwd, int? githubNumber, List<int>? blockedByNumbers, string? resumeSessionId = null) =>
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
