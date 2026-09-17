using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Npgsql;

namespace BuildConsole.Services
{
    /// <summary>Git #1472 — one tracked page (auto-filled path + Good/Bad + notes).</summary>
    public sealed class VisualTestTrackerPage
    {
        public int Id;
        public string BaseUrl = "";
        public string PagePath = "";
        public bool IsGood;
        public string Notes = "";
        public DateTime CreatedAt;
        public DateTime UpdatedAt;
    }

    /// <summary>Git #1472 — one saved screenshot against a page, newest-first in the gallery.</summary>
    public sealed class VisualTestTrackerScreenshot
    {
        public int Id;
        public int PageId;
        public string CaptureType = "full"; // "full" | "region"
        public string FilePath = "";
        public DateTime CreatedAt;
    }

    /// <summary>Persistent DOM mutation baseline recorded for a watched page.</summary>
    public sealed class VisualTestTrackerDomBaseline
    {
        public int Id { get; set; }
        public int PageId { get; set; }
        public string BaseUrl { get; set; } = "";
        public string PagePath { get; set; } = "";
        public List<DomMutationRecord> Mutations { get; set; } = new();

        /// <summary>Git #4442 — stable structural element keys (see <see cref="DomBaselineDiff"/>)
        /// persisted in the table's dom_snapshot column. Empty with <see cref="HasStructureSnapshot"/>
        /// false for a row saved before #4442 — structure is then "not comparable", never "all added".</summary>
        public List<string> StructureKeys { get; set; } = new();
        public bool HasStructureSnapshot { get; set; }

        public DateTime LastVerifiedAt { get; set; } = DateTime.Now;
        public DateTime CreatedAt { get; set; } = DateTime.Now;
        public DateTime UpdatedAt { get; set; } = DateTime.Now;

        public int AgeInDays => (int)(DateTime.Now - LastVerifiedAt).TotalDays;
        public bool IsVerificationDue => AgeInDays >= 7;
    }

    /// <summary>Git #4442 — the last accessibility audit persisted for a watched page
    /// (visual_test_tracker_a11y_audits), so Test Mode knows whether a page has ever been audited.</summary>
    public sealed class VisualTestTrackerA11yAudit
    {
        public int Id { get; set; }
        public int PageId { get; set; }
        public string BaseUrl { get; set; } = "";
        public string PagePath { get; set; } = "";
        public List<AccessibilityViolation> Violations { get; set; } = new();
        public int TotalViolations => Violations.Count;
        public DateTime LastAuditedAt { get; set; } = DateTime.Now;
        public DateTime CreatedAt { get; set; } = DateTime.Now;
        public DateTime UpdatedAt { get; set; } = DateTime.Now;
    }

    /// <summary>
    /// Git #1472 — direct Npgsql store for the Visual Test Tracker floaty's persistent
    /// state: per-page Good/Bad + notes, and every screenshot ever captured for that
    /// page (full history, not just latest — Shane scrolls the gallery to visually
    /// diff "before this build" vs "after"). Same direct-local-Postgres pattern as
    /// BuildQueuePostgresClient/LocalSqlExecutor — reads DATABASE_URL from
    /// scripts/build-queue-watcher.config.json or .env.local, no separate config step.
    ///
    /// New table (visual_test_tracker_pages / visual_test_tracker_screenshots), added
    /// via lib/db/migrations/manual/2026-08-28-visual-test-tracker.sql — per the
    /// project's "schema changes require manual SQL, for Shane to review and run
    /// himself" rule, this store does NOT create the table itself. Every call here
    /// surfaces a real ("relation does not exist") Npgsql exception up to the caller
    /// if Shane hasn't run that migration yet; the window turns that into an honest
    /// "database not ready — ask Shane to run the migration" state rather than ever
    /// falling back to fixture/fake page data (the project's standing hard rule).
    ///
    /// Logs on the "visual-test-tracker" channel via ActivityLog (this app's
    /// logger.child({channel}) equivalent — no Node logger runs in this WPF process).
    /// </summary>
    public sealed class VisualTestTrackerStore
    {
        public const string Channel = "visual-test-tracker";

        private readonly string _connectionString;

        public VisualTestTrackerStore(string connectionString)
        {
            if (string.IsNullOrWhiteSpace(connectionString))
                throw new ArgumentException("connectionString must not be empty", nameof(connectionString));
            _connectionString = BuildQueuePostgresClient.ParseConnectionString(connectionString);
        }

        /// <summary>Resolves the local DATABASE_URL the same way LocalSqlExecutor/BuildQueuePostgresClient
        /// do (config file, then .env.local), or null if neither has one set.</summary>
        public static string? ResolveConnectionString()
        {
            var config = BuildTrackerConfig.Load();
            if (!string.IsNullOrWhiteSpace(config.DatabaseUrl))
                return BuildQueuePostgresClient.ParseConnectionString(config.DatabaseUrl);

            // Git #1985 — was `?? ""`, same bug as LocalSqlExecutor/BuildQueuePostgresClient:
            // resolves .env.local against the process cwd instead of the repo root, which could
            // silently pick up an unrelated .env.local and connect to the wrong database. Fail
            // closed — null repo root means "no DATABASE_URL resolvable," same as any other
            // unset-config case here.
            var repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (string.IsNullOrWhiteSpace(repoRoot)) return null;
            var envLocal = Path.Combine(repoRoot, ".env.local");
            if (!File.Exists(envLocal)) return null;

            foreach (var line in File.ReadAllLines(envLocal))
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith('#') || !trimmed.StartsWith("DATABASE_URL=", StringComparison.OrdinalIgnoreCase))
                    continue;
                var url = trimmed.Substring("DATABASE_URL=".Length).Trim().Trim('"').Trim('\'');
                if (!string.IsNullOrWhiteSpace(url))
                    return BuildQueuePostgresClient.ParseConnectionString(url);
            }
            return null;
        }

        private async Task<NpgsqlConnection> OpenAsync()
        {
            var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();
            return conn;
        }

        /// <summary>Loads the tracked row for (baseUrl, pagePath) if it exists — a revisit — or creates it
        /// fresh with IsGood=false (defaults to Bad on first visit, per spec). Never returns null.</summary>
        public async Task<VisualTestTrackerPage> GetOrCreatePageAsync(string baseUrl, string pagePath)
        {
            await using var conn = await OpenAsync();

            await using (var sel = new NpgsqlCommand(
                "SELECT id, base_url, page_path, is_good, notes, created_at, updated_at " +
                "FROM visual_test_tracker_pages WHERE base_url = @b AND page_path = @p", conn))
            {
                sel.Parameters.AddWithValue("@b", baseUrl);
                sel.Parameters.AddWithValue("@p", pagePath);
                await using var reader = await sel.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    var page = ReadPage(reader);
                    ActivityLog.Log(Channel, $"Revisit: {baseUrl}{pagePath} (id={page.Id}, good={page.IsGood}).");
                    return page;
                }
            }

            await using (var ins = new NpgsqlCommand(
                "INSERT INTO visual_test_tracker_pages (base_url, page_path, is_good, notes) " +
                "VALUES (@b, @p, false, '') " +
                "RETURNING id, base_url, page_path, is_good, notes, created_at, updated_at", conn))
            {
                ins.Parameters.AddWithValue("@b", baseUrl);
                ins.Parameters.AddWithValue("@p", pagePath);
                await using var reader = await ins.ExecuteReaderAsync();
                await reader.ReadAsync();
                var page = ReadPage(reader);
                ActivityLog.Log(Channel, $"First visit: {baseUrl}{pagePath} (id={page.Id}) — defaults to Bad.");
                return page;
            }
        }

        /// <summary>Git #3983 — read-only page lookup (never creates). A page that doesn't exist yet
        /// can't have any bugs logged against it, so the DOM inspector's element-status lookup uses
        /// this instead of <see cref="GetOrCreatePageAsync"/> — checking for an existing bug is not a
        /// "visit" and must not create a page row as a side effect.</summary>
        public async Task<int?> FindPageIdAsync(string baseUrl, string pagePath)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "SELECT id FROM visual_test_tracker_pages WHERE base_url = @b AND page_path = @p", conn);
            cmd.Parameters.AddWithValue("@b", baseUrl);
            cmd.Parameters.AddWithValue("@p", pagePath);
            var result = await cmd.ExecuteScalarAsync();
            return result is int id ? id : null;
        }

        /// <summary>Git #3983 — every bug tracked against one exact element, newest first. Real
        /// dedup/lookup key is (page_id, selector), scoped to the current page (global cross-page
        /// dedup is #3984, not this). Returns an empty list rather than throwing if the table/columns
        /// don't exist yet or the DB is unreachable — a failed lookup must never block hovering an
        /// element.</summary>
        public async Task<List<VisualTestTrackerEntry>> GetBugsForElementAsync(int pageId, string selector)
        {
            var result = new List<VisualTestTrackerEntry>();
            if (pageId <= 0 || string.IsNullOrWhiteSpace(selector)) return result;

            try
            {
                await using var conn = await OpenAsync();
                await using var cmd = new NpgsqlCommand(
                    "SELECT id, entry_uuid, page_id, base_url, page_path, title, notes, severity, status, created_at, updated_at, " +
                    "COALESCE(bug_number, id) as bug_num, git_issue_number, site_name, epic_name, closing_build_id, " +
                    "steps_to_reproduce, expected_behavior, actual_behavior, resolution, resolution_reason, is_design, selector " +
                    "FROM visual_test_tracker_entries WHERE page_id = @pid AND selector = @sel ORDER BY created_at DESC", conn);
                cmd.Parameters.AddWithValue("@pid", pageId);
                cmd.Parameters.AddWithValue("@sel", selector);
                await using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    result.Add(ReadEntryFromReader(reader));
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"GetBugsForElementAsync lookup skipped: {ex.Message}");
            }

            return result;
        }

        /// <summary>Persists the checkbox state + notes for a page (debounced from the UI). updated_at bumps.</summary>
        public async Task SavePageAsync(int pageId, bool isGood, string notes)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "UPDATE visual_test_tracker_pages SET is_good = @g, notes = @n, updated_at = now() WHERE id = @id", conn);
            cmd.Parameters.AddWithValue("@g", isGood);
            cmd.Parameters.AddWithValue("@n", notes ?? "");
            cmd.Parameters.AddWithValue("@id", pageId);
            await cmd.ExecuteNonQueryAsync();
            ActivityLog.Log(Channel, $"Saved page id={pageId}: good={isGood}, notes.len={notes?.Length ?? 0}.");
        }

        /// <summary>Records a completed capture and returns its new row id. Only called AFTER the PNG is
        /// confirmed written to disk — a failed capture must never reach here (standing rule: never let
        /// the gallery imply something was captured when it wasn't).</summary>
        public async Task<int> AddScreenshotAsync(int pageId, string captureType, string filePath)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "INSERT INTO visual_test_tracker_screenshots (page_id, capture_type, file_path) " +
                "VALUES (@pid, @t, @f) RETURNING id", conn);
            cmd.Parameters.AddWithValue("@pid", pageId);
            cmd.Parameters.AddWithValue("@t", captureType);
            cmd.Parameters.AddWithValue("@f", filePath);
            var id = (int)(await cmd.ExecuteScalarAsync())!;
            ActivityLog.Log(Channel, $"Screenshot saved: page={pageId} type={captureType} id={id} -> {filePath}");
            return id;
        }

        /// <summary>Every screenshot ever taken for a page, newest first — the full gallery, not just latest.</summary>
        public async Task<List<VisualTestTrackerScreenshot>> ListScreenshotsAsync(int pageId)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "SELECT id, page_id, capture_type, file_path, created_at " +
                "FROM visual_test_tracker_screenshots WHERE page_id = @pid ORDER BY created_at DESC", conn);
            cmd.Parameters.AddWithValue("@pid", pageId);
            await using var reader = await cmd.ExecuteReaderAsync();
            var list = new List<VisualTestTrackerScreenshot>();
            while (await reader.ReadAsync())
            {
                list.Add(new VisualTestTrackerScreenshot
                {
                    Id = reader.GetInt32(0),
                    PageId = reader.GetInt32(1),
                    CaptureType = reader.GetString(2),
                    FilePath = reader.GetString(3),
                    CreatedAt = reader.GetFieldValue<DateTime>(4),
                });
            }
            return list;
        }

        /// <summary>Deletes one screenshot's DB row AND its on-disk PNG (best-effort on the file — a
        /// missing file never blocks removing the stale row). Keeps the gallery from growing unbounded.</summary>
        public async Task DeleteScreenshotAsync(int screenshotId)
        {
            string? path = null;
            await using (var conn = await OpenAsync())
            {
                await using (var sel = new NpgsqlCommand(
                    "SELECT file_path FROM visual_test_tracker_screenshots WHERE id = @id", conn))
                {
                    sel.Parameters.AddWithValue("@id", screenshotId);
                    var result = await sel.ExecuteScalarAsync();
                    path = result as string;
                }
                await using (var del = new NpgsqlCommand(
                    "DELETE FROM visual_test_tracker_screenshots WHERE id = @id", conn))
                {
                    del.Parameters.AddWithValue("@id", screenshotId);
                    await del.ExecuteNonQueryAsync();
                }
            }

            if (!string.IsNullOrEmpty(path))
            {
                try { if (File.Exists(path)) File.Delete(path); }
                catch (Exception ex) { ActivityLog.Log(Channel, $"Deleted screenshot row id={screenshotId} but couldn't remove file '{path}': {ex.Message}"); }
            }
            ActivityLog.Log(Channel, $"Deleted screenshot id={screenshotId} (file='{path}').");
        }

        // ── Bug Entries Management (Local JSON + optional PostgreSQL sync) ────────

        private static string LocalEntriesFilePath
        {
            get
            {
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole", "visual-test-tracker");
                Directory.CreateDirectory(dir);
                return Path.Combine(dir, "entries.json");
            }
        }

        private static readonly object _entriesLock = new();

        private static List<VisualTestTrackerEntry> LoadLocalEntries()
        {
            lock (_entriesLock)
            {
                try
                {
                    var file = LocalEntriesFilePath;
                    if (!File.Exists(file)) return new List<VisualTestTrackerEntry>();
                    var json = File.ReadAllText(file);
                    return System.Text.Json.JsonSerializer.Deserialize<List<VisualTestTrackerEntry>>(json) ?? new List<VisualTestTrackerEntry>();
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(Channel, $"Failed to load local entries: {ex.Message}");
                    return new List<VisualTestTrackerEntry>();
                }
            }
        }

        private static void PersistLocalEntries(List<VisualTestTrackerEntry> list)
        {
            lock (_entriesLock)
            {
                try
                {
                    var file = LocalEntriesFilePath;
                    var opts = new System.Text.Json.JsonSerializerOptions { WriteIndented = true };
                    var json = System.Text.Json.JsonSerializer.Serialize(list, opts);
                    File.WriteAllText(file, json);
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(Channel, $"Failed to persist local entries: {ex.Message}");
                }
            }
        }

        /// <summary>Lists bug entries for a specific page, newest first. Combines local JSON cache with PostgreSQL when available.</summary>
        public async Task<List<VisualTestTrackerEntry>> ListEntriesAsync(int pageId, string baseUrl, string pagePath)
        {
            var local = LoadLocalEntries().FindAll(e =>
                (pageId > 0 && e.PageId == pageId) ||
                (!string.IsNullOrWhiteSpace(baseUrl) && string.Equals(e.BaseUrl, baseUrl, StringComparison.OrdinalIgnoreCase) &&
                 string.Equals(e.PagePath, pagePath, StringComparison.OrdinalIgnoreCase)));

            try
            {
                await using var conn = await OpenAsync();
                await using var cmd = new NpgsqlCommand(
                    "SELECT id, entry_uuid, page_id, base_url, page_path, title, notes, severity, status, created_at, updated_at, " +
                    "COALESCE(bug_number, id) as bug_num, git_issue_number, site_name, epic_name, closing_build_id, " +
                    "steps_to_reproduce, expected_behavior, actual_behavior, resolution, resolution_reason, is_design, selector " +
                    "FROM visual_test_tracker_entries WHERE page_id = @pid ORDER BY bug_num DESC, created_at DESC", conn);
                cmd.Parameters.AddWithValue("@pid", pageId);
                await using var reader = await cmd.ExecuteReaderAsync();
                var dbList = new List<VisualTestTrackerEntry>();
                while (await reader.ReadAsync())
                {
                    dbList.Add(ReadEntryFromReader(reader));
                }

                // Merge with local screenshot paths
                var localMap = new Dictionary<string, VisualTestTrackerEntry>(StringComparer.OrdinalIgnoreCase);
                foreach (var loc in local)
                {
                    localMap[loc.EntryUuid] = loc;
                }

                foreach (var d in dbList)
                {
                    if (localMap.TryGetValue(d.EntryUuid, out var locMatch))
                    {
                        d.ScreenshotPaths = locMatch.ScreenshotPaths;
                        d.ConsoleLogs = locMatch.ConsoleLogs;
                        d.NetworkFailures = locMatch.NetworkFailures;
                        d.ReproductionEvents = locMatch.ReproductionEvents;
                    }
                }

                // Any local entries not yet in DB
                var dbUuids = new HashSet<string>(dbList.ConvertAll(d => d.EntryUuid), StringComparer.OrdinalIgnoreCase);
                foreach (var loc in local)
                {
                    if (!dbUuids.Contains(loc.EntryUuid))
                        dbList.Add(loc);
                }

                dbList.Sort((a, b) => b.CreatedAt.CompareTo(a.CreatedAt));
                return dbList;
            }
            catch
            {
                // DB table may not exist yet or DB offline — return local entries cleanly
                local.Sort((a, b) => b.CreatedAt.CompareTo(a.CreatedAt));
                return local;
            }
        }

        /// <summary>Lists ALL bugs across all pages for the Bug Tracker Document View.</summary>
        public async Task<List<VisualTestTrackerEntry>> ListAllBugsAsync()
        {
            var local = LoadLocalEntries();

            try
            {
                await using var conn = await OpenAsync();
                await using var cmd = new NpgsqlCommand(
                    "SELECT id, entry_uuid, page_id, base_url, page_path, title, notes, severity, status, created_at, updated_at, " +
                    "COALESCE(bug_number, id) as bug_num, git_issue_number, site_name, epic_name, closing_build_id, " +
                    "steps_to_reproduce, expected_behavior, actual_behavior, resolution, resolution_reason, is_design, selector " +
                    "FROM visual_test_tracker_entries ORDER BY site_name ASC, epic_name ASC, bug_num DESC, created_at DESC", conn);
                await using var reader = await cmd.ExecuteReaderAsync();
                var dbList = new List<VisualTestTrackerEntry>();
                while (await reader.ReadAsync())
                {
                    dbList.Add(ReadEntryFromReader(reader));
                }

                var localMap = new Dictionary<string, VisualTestTrackerEntry>(StringComparer.OrdinalIgnoreCase);
                foreach (var loc in local)
                {
                    localMap[loc.EntryUuid] = loc;
                }

                foreach (var d in dbList)
                {
                    if (localMap.TryGetValue(d.EntryUuid, out var locMatch))
                    {
                        d.ScreenshotPaths = locMatch.ScreenshotPaths;
                        d.ConsoleLogs = locMatch.ConsoleLogs;
                        d.NetworkFailures = locMatch.NetworkFailures;
                        d.ReproductionEvents = locMatch.ReproductionEvents;
                    }
                }

                var dbUuids = new HashSet<string>(dbList.ConvertAll(d => d.EntryUuid), StringComparer.OrdinalIgnoreCase);
                foreach (var loc in local)
                {
                    if (!dbUuids.Contains(loc.EntryUuid))
                        dbList.Add(loc);
                }

                return dbList;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"DB ListAllBugsAsync fallback to local: {ex.Message}");
                return local;
            }
        }

        /// <summary>
        /// Reconciles local bugs with GitHub Issue state via GitHubIssueMirror.
        /// If a linked Git issue is closed on GitHub, marks the local bug as Resolved.
        /// If SiteName, EpicName, or Title are blank, populates them from GitHub issue metadata.
        /// </summary>
        public async Task ReconcileGitIssueSyncAsync()
        {
            try
            {
                var allBugs = await ListAllBugsAsync();
                foreach (var bug in allBugs)
                {
                    if (bug.GitIssueNumber.HasValue && bug.GitIssueNumber.Value > 0)
                    {
                        var mirror = await GitHubIssueMirror.TryGetAsync(bug.GitIssueNumber.Value);
                        if (mirror != null)
                        {
                            bool updated = false;

                            // Sync State: If closed on GitHub, set local status to Resolved
                            if (string.Equals(mirror.State, "closed", StringComparison.OrdinalIgnoreCase) &&
                                string.Equals(bug.Status, "Open", StringComparison.OrdinalIgnoreCase))
                            {
                                bug.Status = "Resolved";
                                await UpdateEntryStatusAsync(bug.EntryUuid, "Resolved");
                                updated = true;
                            }

                            // Sync Title if blank
                            if (string.IsNullOrWhiteSpace(bug.Title) && !string.IsNullOrWhiteSpace(mirror.Title))
                            {
                                bug.Title = mirror.Title;
                                updated = true;
                            }

                            // Sync Epic if blank
                            if (string.IsNullOrWhiteSpace(bug.EpicName) && !string.IsNullOrWhiteSpace(mirror.BoardStatusName))
                            {
                                bug.EpicName = mirror.BoardStatusName;
                                updated = true;
                            }

                            if (updated)
                            {
                                await SaveEntryAsync(bug);
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"ReconcileGitIssueSyncAsync error: {ex.Message}");
            }
        }

        /// <summary>One entry's real, currently-live lifecycle state, straight from Postgres —
        /// no local-JSON overlay. See <see cref="GetLifecycleSnapshotAsync"/>.</summary>
        public sealed class LifecycleSnapshot
        {
            public string Status = "Open";
            public int? GitIssueNumber;
            public string? Resolution;
            public string? ResolutionReason;
        }

        /// <summary>
        /// Git #3980 — direct-from-Postgres lifecycle read for the given entry_uuids, deliberately
        /// bypassing the local-JSON-overlay merge that <see cref="ListEntriesAsync"/>/<see cref="ListAllBugsAsync"/>
        /// do. Those two exist to let the composer UI show a bug's rich (screenshots/console/notes)
        /// data before it's ever reached Postgres; local JSON is never the source of truth for
        /// status/git_issue_number/resolution once a bug has been synced, and a build dispatched per
        /// #3985 writes those fields directly to Postgres with no local JSON involved at all — so a
        /// reconcile pass that went through the merge would miss exactly the writes it exists to
        /// detect. Returns only uuids that still exist; the caller treats a missing uuid as "nothing
        /// to compare" rather than an error (the bug row may have been deleted).
        /// </summary>
        public async Task<Dictionary<string, LifecycleSnapshot>> GetLifecycleSnapshotAsync(IReadOnlyCollection<string> entryUuids)
        {
            var result = new Dictionary<string, LifecycleSnapshot>(StringComparer.OrdinalIgnoreCase);
            if (entryUuids == null || entryUuids.Count == 0) return result;

            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "SELECT entry_uuid, status, git_issue_number, resolution, resolution_reason " +
                "FROM visual_test_tracker_entries WHERE entry_uuid = ANY(@uuids)", conn);
            cmd.Parameters.AddWithValue("@uuids", entryUuids.ToArray());
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                result[reader.GetString(0)] = new LifecycleSnapshot
                {
                    Status = reader.GetString(1),
                    GitIssueNumber = reader.IsDBNull(2) ? null : reader.GetInt32(2),
                    Resolution = reader.IsDBNull(3) ? null : reader.GetString(3),
                    ResolutionReason = reader.IsDBNull(4) ? null : reader.GetString(4),
                };
            }
            return result;
        }

        /// <summary>Git #3984 — one combined-scope bug for the per-tab browser toolbar's status icon:
        /// the latest bug (by created_at) across page-level (page_id set, selector NULL) and global
        /// (page_id NULL, base_url set) rows for the given tab, plus the total count across both sets.
        /// Deliberately its own reader (not <see cref="ReadEntryFromReader"/>) because a global row's
        /// page_id is genuinely NULL — reading it via GetInt32 the way ReadEntryFromReader's ordinal 2
        /// does would throw (the real bug tracked as #3991).</summary>
        public sealed class ScopedBugSummary
        {
            public int TotalCount;
            public List<VisualTestTrackerEntry> Entries { get; } = new();
        }

        public async Task<ScopedBugSummary> GetToolbarBugSummaryAsync(string baseUrl, string pagePath)
        {
            var summary = new ScopedBugSummary();
            if (string.IsNullOrWhiteSpace(baseUrl)) return summary;

            await using var conn = await OpenAsync();

            // Page-level scope needs a real page_id — read-only lookup (never creates a page row,
            // unlike GetOrCreatePageAsync, since just hovering/navigating a tab shouldn't seed data).
            int? pageId = null;
            await using (var pageSel = new NpgsqlCommand(
                "SELECT id FROM visual_test_tracker_pages WHERE base_url = @b AND page_path = @p", conn))
            {
                pageSel.Parameters.AddWithValue("@b", baseUrl);
                pageSel.Parameters.AddWithValue("@p", pagePath ?? "");
                var result = await pageSel.ExecuteScalarAsync();
                if (result != null) pageId = (int)result;
            }

            const string selectCols =
                "id, entry_uuid, page_id, base_url, page_path, title, notes, severity, status, created_at, updated_at, " +
                "COALESCE(bug_number, id) as bug_num, git_issue_number, site_name, epic_name, closing_build_id, resolution, resolution_reason";

            if (pageId.HasValue)
            {
                await using var cmd = new NpgsqlCommand(
                    $"SELECT {selectCols} FROM visual_test_tracker_entries " +
                    "WHERE page_id = @pid AND selector IS NULL ORDER BY created_at DESC", conn);
                cmd.Parameters.AddWithValue("@pid", pageId.Value);
                await using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                    summary.Entries.Add(ReadScopedEntry(reader, pageId));
            }

            await using (var cmd = new NpgsqlCommand(
                $"SELECT {selectCols} FROM visual_test_tracker_entries " +
                "WHERE page_id IS NULL AND base_url = @b ORDER BY created_at DESC", conn))
            {
                cmd.Parameters.AddWithValue("@b", baseUrl);
                await using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                    summary.Entries.Add(ReadScopedEntry(reader, null));
            }

            summary.Entries.Sort((a, b) => b.CreatedAt.CompareTo(a.CreatedAt));
            summary.TotalCount = summary.Entries.Count;
            return summary;
        }

        private static VisualTestTrackerEntry ReadScopedEntry(NpgsqlDataReader reader, int? knownPageId)
        {
            return new VisualTestTrackerEntry
            {
                Id = reader.GetInt32(0),
                EntryUuid = reader.GetString(1),
                PageId = reader.IsDBNull(2) ? (knownPageId ?? 0) : reader.GetInt32(2),
                BaseUrl = reader.GetString(3),
                PagePath = reader.GetString(4),
                Title = reader.GetString(5),
                Notes = reader.GetString(6),
                Severity = reader.GetString(7),
                Status = reader.GetString(8),
                CreatedAt = reader.GetFieldValue<DateTime>(9),
                UpdatedAt = reader.GetFieldValue<DateTime>(10),
                BugNumber = reader.IsDBNull(11) ? reader.GetInt32(0) : reader.GetInt32(11),
                GitIssueNumber = reader.IsDBNull(12) ? null : reader.GetInt32(12),
                SiteName = reader.IsDBNull(13) ? "" : reader.GetString(13),
                EpicName = reader.IsDBNull(14) ? "" : reader.GetString(14),
                ClosingBuildId = reader.IsDBNull(15) ? null : reader.GetString(15),
                Resolution = reader.IsDBNull(16) ? null : reader.GetString(16),
                ResolutionReason = reader.IsDBNull(17) ? null : reader.GetString(17),
            };
        }

        /// <summary>Saves or updates a bug entry to both local JSON and PostgreSQL.</summary>
        public async Task SaveEntryAsync(VisualTestTrackerEntry entry)
        {
            if (entry == null) return;
            entry.UpdatedAt = DateTime.Now;

            // 1. Save locally
            var all = LoadLocalEntries();
            int idx = all.FindIndex(e => string.Equals(e.EntryUuid, entry.EntryUuid, StringComparison.OrdinalIgnoreCase));
            if (idx >= 0) all[idx] = entry;
            else all.Insert(0, entry);
            PersistLocalEntries(all);

            // 2. Best-effort DB upsert
            try
            {
                await using var conn = await OpenAsync();
                await using var cmd = new NpgsqlCommand(
                    "INSERT INTO visual_test_tracker_entries (entry_uuid, page_id, base_url, page_path, title, notes, severity, status, " +
                    "resolution, resolution_reason, is_design, selector, " +
                    "git_issue_number, site_name, epic_name, closing_build_id, steps_to_reproduce, expected_behavior, actual_behavior, created_at, updated_at) " +
                    "VALUES (@u, @pid, @b, @p, @t, @n, @sev, @st, @res, @resr, @isd, @sel, @git, @site, @epic, @close, @steps, @exp, @act, @c, @up) " +
                    "ON CONFLICT (entry_uuid) DO UPDATE SET " +
                    "title = EXCLUDED.title, notes = EXCLUDED.notes, severity = EXCLUDED.severity, " +
                    "status = EXCLUDED.status, resolution = EXCLUDED.resolution, resolution_reason = EXCLUDED.resolution_reason, " +
                    "is_design = EXCLUDED.is_design, selector = EXCLUDED.selector, git_issue_number = EXCLUDED.git_issue_number, site_name = EXCLUDED.site_name, " +
                    "epic_name = EXCLUDED.epic_name, closing_build_id = EXCLUDED.closing_build_id, " +
                    "steps_to_reproduce = EXCLUDED.steps_to_reproduce, expected_behavior = EXCLUDED.expected_behavior, " +
                    "actual_behavior = EXCLUDED.actual_behavior, updated_at = EXCLUDED.updated_at " +
                    "RETURNING id, COALESCE(bug_number, id)", conn);
                cmd.Parameters.AddWithValue("@u", entry.EntryUuid);
                cmd.Parameters.AddWithValue("@pid", entry.PageId > 0 ? entry.PageId : DBNull.Value);
                cmd.Parameters.AddWithValue("@b", entry.BaseUrl ?? "");
                cmd.Parameters.AddWithValue("@p", entry.PagePath ?? "");
                cmd.Parameters.AddWithValue("@t", entry.Title ?? "");
                cmd.Parameters.AddWithValue("@n", entry.Notes ?? "");
                cmd.Parameters.AddWithValue("@sev", entry.Severity ?? "Bug");
                cmd.Parameters.AddWithValue("@st", entry.Status ?? "Open");
                cmd.Parameters.AddWithValue("@res", (object?)entry.Resolution ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@resr", (object?)entry.ResolutionReason ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@isd", entry.IsDesign);
                cmd.Parameters.AddWithValue("@sel", (object?)entry.Selector ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@git", (object?)entry.GitIssueNumber ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@site", entry.SiteName ?? "");
                cmd.Parameters.AddWithValue("@epic", entry.EpicName ?? "");
                cmd.Parameters.AddWithValue("@close", (object?)entry.ClosingBuildId ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@steps", entry.StepsToReproduce ?? "");
                cmd.Parameters.AddWithValue("@exp", entry.ExpectedBehavior ?? "");
                cmd.Parameters.AddWithValue("@act", entry.ActualBehavior ?? "");
                cmd.Parameters.AddWithValue("@c", entry.CreatedAt);
                cmd.Parameters.AddWithValue("@up", entry.UpdatedAt);

                await using var reader = await cmd.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    entry.Id = reader.GetInt32(0);
                    entry.BugNumber = reader.GetInt32(1);
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"DB save entry skipped: {ex.Message}");
            }
        }

        /// <summary>Updates an entry's Git Issue Number.</summary>
        public async Task UpdateGitIssueNumberAsync(string entryUuid, int? gitIssueNumber)
        {
            if (string.IsNullOrWhiteSpace(entryUuid)) return;

            var all = LoadLocalEntries();
            var target = all.Find(e => string.Equals(e.EntryUuid, entryUuid, StringComparison.OrdinalIgnoreCase));
            if (target != null)
            {
                target.GitIssueNumber = gitIssueNumber;
                target.UpdatedAt = DateTime.Now;
                PersistLocalEntries(all);
            }

            try
            {
                await using var conn = await OpenAsync();
                await using var cmd = new NpgsqlCommand(
                    "UPDATE visual_test_tracker_entries SET git_issue_number = @git, updated_at = now() WHERE entry_uuid = @u", conn);
                cmd.Parameters.AddWithValue("@git", (object?)gitIssueNumber ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@u", entryUuid);
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"DB git issue update skipped: {ex.Message}");
            }
        }

        /// <summary>
        /// Updates an entry's status ("Open", "Verifying", "Closed" — Git #3981) and, optionally,
        /// its resolution/resolutionReason. Pass null for resolution/resolutionReason to clear them
        /// (e.g. re-opening a bug). The DB's chk_vtt_resolution_reason CHECK constraint requires a
        /// non-null resolutionReason whenever resolution == "NotABug".
        /// </summary>
        public async Task UpdateEntryStatusAsync(string entryUuid, string status, string? resolution = null, string? resolutionReason = null)
        {
            if (string.IsNullOrWhiteSpace(entryUuid)) return;

            var all = LoadLocalEntries();
            var target = all.Find(e => string.Equals(e.EntryUuid, entryUuid, StringComparison.OrdinalIgnoreCase));
            if (target != null)
            {
                target.Status = status;
                target.Resolution = resolution;
                target.ResolutionReason = resolutionReason;
                target.UpdatedAt = DateTime.Now;
                PersistLocalEntries(all);
            }

            try
            {
                await using var conn = await OpenAsync();
                await using var cmd = new NpgsqlCommand(
                    "UPDATE visual_test_tracker_entries SET status = @st, resolution = @res, resolution_reason = @resr, updated_at = now() WHERE entry_uuid = @u", conn);
                cmd.Parameters.AddWithValue("@st", status);
                cmd.Parameters.AddWithValue("@res", (object?)resolution ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@resr", (object?)resolutionReason ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@u", entryUuid);
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"DB status update skipped: {ex.Message}");
            }
        }

        /// <summary>Updates an entry's IsDesign flag (Git #3978/#3981 addendum — coexists with Status, doesn't gate it).</summary>
        public async Task UpdateEntryDesignFlagAsync(string entryUuid, bool isDesign)
        {
            if (string.IsNullOrWhiteSpace(entryUuid)) return;

            var all = LoadLocalEntries();
            var target = all.Find(e => string.Equals(e.EntryUuid, entryUuid, StringComparison.OrdinalIgnoreCase));
            if (target != null)
            {
                target.IsDesign = isDesign;
                target.UpdatedAt = DateTime.Now;
                PersistLocalEntries(all);
            }

            try
            {
                await using var conn = await OpenAsync();
                await using var cmd = new NpgsqlCommand(
                    "UPDATE visual_test_tracker_entries SET is_design = @isd, updated_at = now() WHERE entry_uuid = @u", conn);
                cmd.Parameters.AddWithValue("@isd", isDesign);
                cmd.Parameters.AddWithValue("@u", entryUuid);
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"DB design flag update skipped: {ex.Message}");
            }
        }

        /// <summary>Deletes a bug entry by UUID from local storage and DB.</summary>
        public async Task DeleteEntryAsync(string entryUuid)
        {
            if (string.IsNullOrWhiteSpace(entryUuid)) return;

            var all = LoadLocalEntries();
            all.RemoveAll(e => string.Equals(e.EntryUuid, entryUuid, StringComparison.OrdinalIgnoreCase));
            PersistLocalEntries(all);

            try
            {
                await using var conn = await OpenAsync();
                await using var cmd = new NpgsqlCommand(
                    "DELETE FROM visual_test_tracker_entries WHERE entry_uuid = @u", conn);
                cmd.Parameters.AddWithValue("@u", entryUuid);
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"DB entry delete skipped: {ex.Message}");
            }
        }

        /// <summary>Retrieves the saved DOM baseline for a given page path, or null if none exists.</summary>
        public async Task<VisualTestTrackerDomBaseline?> GetDomBaselineAsync(string baseUrl, string pagePath)
        {
            try
            {
                return await GetDomBaselineOrThrowAsync(baseUrl, pagePath);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"GetDomBaselineAsync error: {ex.Message}");
            }
            return null;
        }

        /// <summary>Git #4442 — same lookup as <see cref="GetDomBaselineAsync"/>, but a DB failure throws
        /// instead of reading as "no baseline". The navigation auto-check needs that distinction: treating
        /// a dropped connection as "never visited" would overwrite a real baseline with a fresh observation.</summary>
        public async Task<VisualTestTrackerDomBaseline?> GetDomBaselineOrThrowAsync(string baseUrl, string pagePath)
        {
            if (string.IsNullOrWhiteSpace(baseUrl) && string.IsNullOrWhiteSpace(pagePath)) return null;

            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "SELECT id, page_id, base_url, page_path, baseline_mutations, last_verified_at, created_at, updated_at, dom_snapshot " +
                "FROM visual_test_tracker_dom_mutations WHERE base_url = @b AND page_path = @p", conn);
            cmd.Parameters.AddWithValue("@b", baseUrl ?? "");
            cmd.Parameters.AddWithValue("@p", pagePath ?? "");

            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync()) return null;

            var baseline = new VisualTestTrackerDomBaseline
            {
                Id = reader.GetInt32(0),
                PageId = reader.IsDBNull(1) ? 0 : reader.GetInt32(1),
                BaseUrl = reader.GetString(2),
                PagePath = reader.GetString(3),
                LastVerifiedAt = reader.GetFieldValue<DateTime>(5),
                CreatedAt = reader.GetFieldValue<DateTime>(6),
                UpdatedAt = reader.GetFieldValue<DateTime>(7),
            };

            if (!reader.IsDBNull(4))
            {
                string json = reader.GetString(4);
                try
                {
                    var muts = System.Text.Json.JsonSerializer.Deserialize<List<DomMutationRecord>>(json);
                    if (muts != null) baseline.Mutations = muts;
                }
                catch { }
            }

            if (!reader.IsDBNull(8))
            {
                try
                {
                    using var snap = System.Text.Json.JsonDocument.Parse(reader.GetString(8));
                    if (snap.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object &&
                        snap.RootElement.TryGetProperty("structureKeys", out var keysEl) &&
                        keysEl.ValueKind == System.Text.Json.JsonValueKind.Array)
                    {
                        baseline.StructureKeys = keysEl.EnumerateArray()
                            .Where(k => k.ValueKind == System.Text.Json.JsonValueKind.String)
                            .Select(k => k.GetString() ?? "")
                            .Where(k => k.Length > 0)
                            .ToList();
                        baseline.HasStructureSnapshot = true;
                    }
                }
                catch { }
            }

            return baseline;
        }

        /// <summary>Saves or updates a DOM baseline for a page.</summary>
        public async Task SaveDomBaselineAsync(VisualTestTrackerDomBaseline baseline)
        {
            try
            {
                await SaveDomBaselineOrThrowAsync(baseline);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"SaveDomBaselineAsync error: {ex.Message}");
            }
        }

        /// <summary>Git #4442 — throwing variant of <see cref="SaveDomBaselineAsync"/>, so the auto-check
        /// can tell Shane a baseline was NOT recorded instead of claiming it was.</summary>
        public async Task SaveDomBaselineOrThrowAsync(VisualTestTrackerDomBaseline baseline)
        {
            if (baseline == null) return;
            baseline.UpdatedAt = DateTime.Now;

            await using var conn = await OpenAsync();
            string jsonMutations = System.Text.Json.JsonSerializer.Serialize(baseline.Mutations ?? new List<DomMutationRecord>());
            string jsonSnapshot = baseline.HasStructureSnapshot
                ? System.Text.Json.JsonSerializer.Serialize(new { structureKeys = baseline.StructureKeys ?? new List<string>() })
                : "{}";

            await using var cmd = new NpgsqlCommand(
                "INSERT INTO visual_test_tracker_dom_mutations (page_id, base_url, page_path, baseline_mutations, dom_snapshot, last_verified_at, created_at, updated_at) " +
                "VALUES (@pid, @b, @p, @mut::jsonb, @snap::jsonb, @v, @c, @up) " +
                "ON CONFLICT (base_url, page_path) DO UPDATE SET " +
                "baseline_mutations = EXCLUDED.baseline_mutations, " +
                // A caller that captured no structure must not wipe a snapshot that already exists.
                "dom_snapshot = CASE WHEN EXCLUDED.dom_snapshot = '{}'::jsonb THEN visual_test_tracker_dom_mutations.dom_snapshot ELSE EXCLUDED.dom_snapshot END, " +
                "page_id = COALESCE(EXCLUDED.page_id, visual_test_tracker_dom_mutations.page_id), " +
                "last_verified_at = EXCLUDED.last_verified_at, updated_at = EXCLUDED.updated_at " +
                "RETURNING id", conn);
            cmd.Parameters.AddWithValue("@pid", baseline.PageId > 0 ? (object)baseline.PageId : DBNull.Value);
            cmd.Parameters.AddWithValue("@b", baseline.BaseUrl ?? "");
            cmd.Parameters.AddWithValue("@p", baseline.PagePath ?? "");
            cmd.Parameters.AddWithValue("@mut", jsonMutations);
            cmd.Parameters.AddWithValue("@snap", jsonSnapshot);
            cmd.Parameters.AddWithValue("@v", baseline.LastVerifiedAt);
            cmd.Parameters.AddWithValue("@c", baseline.CreatedAt);
            cmd.Parameters.AddWithValue("@up", baseline.UpdatedAt);

            var idObj = await cmd.ExecuteScalarAsync();
            if (idObj is int idVal) baseline.Id = idVal;
        }

        /// <summary>Git #4442 — records a structural snapshot on an existing baseline row saved without one
        /// (dom_snapshot = '{}'), without touching its mutations or verification date.</summary>
        public async Task UpdateDomBaselineSnapshotOrThrowAsync(string baseUrl, string pagePath, List<string> structureKeys)
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "UPDATE visual_test_tracker_dom_mutations SET dom_snapshot = @snap::jsonb, updated_at = now() WHERE base_url = @b AND page_path = @p", conn);
            cmd.Parameters.AddWithValue("@snap", System.Text.Json.JsonSerializer.Serialize(new { structureKeys = structureKeys ?? new List<string>() }));
            cmd.Parameters.AddWithValue("@b", baseUrl ?? "");
            cmd.Parameters.AddWithValue("@p", pagePath ?? "");
            await cmd.ExecuteNonQueryAsync();
        }

        /// <summary>Updates last_verified_at timestamp to now() for a page baseline.</summary>
        public async Task UpdateDomBaselineVerificationDateAsync(string baseUrl, string pagePath)
        {
            try
            {
                await using var conn = await OpenAsync();
                await using var cmd = new NpgsqlCommand(
                    "UPDATE visual_test_tracker_dom_mutations SET last_verified_at = now(), updated_at = now() WHERE base_url = @b AND page_path = @p", conn);
                cmd.Parameters.AddWithValue("@b", baseUrl ?? "");
                cmd.Parameters.AddWithValue("@p", pagePath ?? "");
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"UpdateDomBaselineVerificationDateAsync error: {ex.Message}");
            }
        }

        /// <summary>Git #4442 — retrieves the last accessibility audit persisted for a page, or null if the
        /// page has never been audited. Mirrors <see cref="GetDomBaselineAsync"/>.</summary>
        public async Task<VisualTestTrackerA11yAudit?> GetA11yAuditAsync(string baseUrl, string pagePath)
        {
            try
            {
                return await GetA11yAuditOrThrowAsync(baseUrl, pagePath);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"GetA11yAuditAsync error: {ex.Message}");
            }
            return null;
        }

        /// <summary>Git #4442 — throwing variant of <see cref="GetA11yAuditAsync"/> (see
        /// <see cref="GetDomBaselineOrThrowAsync"/> for why the auto-check needs it).</summary>
        public async Task<VisualTestTrackerA11yAudit?> GetA11yAuditOrThrowAsync(string baseUrl, string pagePath)
        {
            if (string.IsNullOrWhiteSpace(baseUrl) && string.IsNullOrWhiteSpace(pagePath)) return null;

            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "SELECT id, page_id, base_url, page_path, violation_summary, last_audited_at, created_at, updated_at " +
                "FROM visual_test_tracker_a11y_audits WHERE base_url = @b AND page_path = @p", conn);
            cmd.Parameters.AddWithValue("@b", baseUrl ?? "");
            cmd.Parameters.AddWithValue("@p", pagePath ?? "");

            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync()) return null;

            var audit = new VisualTestTrackerA11yAudit
            {
                Id = reader.GetInt32(0),
                PageId = reader.IsDBNull(1) ? 0 : reader.GetInt32(1),
                BaseUrl = reader.GetString(2),
                PagePath = reader.GetString(3),
                LastAuditedAt = reader.GetFieldValue<DateTime>(5),
                CreatedAt = reader.GetFieldValue<DateTime>(6),
                UpdatedAt = reader.GetFieldValue<DateTime>(7),
            };

            if (!reader.IsDBNull(4))
            {
                try
                {
                    using var summary = System.Text.Json.JsonDocument.Parse(reader.GetString(4));
                    if (summary.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object &&
                        summary.RootElement.TryGetProperty("violations", out var violationsEl))
                    {
                        var list = System.Text.Json.JsonSerializer.Deserialize<List<AccessibilityViolation>>(violationsEl.GetRawText());
                        if (list != null) audit.Violations = list;
                    }
                }
                catch { }
            }

            return audit;
        }

        /// <summary>Git #4442 — saves or replaces the accessibility audit for a page. Mirrors
        /// <see cref="SaveDomBaselineAsync"/>.</summary>
        public async Task SaveA11yAuditAsync(VisualTestTrackerA11yAudit audit)
        {
            try
            {
                await SaveA11yAuditOrThrowAsync(audit);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"SaveA11yAuditAsync error: {ex.Message}");
            }
        }

        /// <summary>Git #4442 — throwing variant of <see cref="SaveA11yAuditAsync"/>.</summary>
        public async Task SaveA11yAuditOrThrowAsync(VisualTestTrackerA11yAudit audit)
        {
            if (audit == null) return;
            audit.UpdatedAt = DateTime.Now;
            var violations = audit.Violations ?? new List<AccessibilityViolation>();

            string jsonSummary = System.Text.Json.JsonSerializer.Serialize(new
            {
                total = violations.Count,
                missingAlt = violations.Count(v => v.Category == "MissingAlt"),
                contrast = violations.Count(v => v.Category == "Contrast"),
                aria = violations.Count(v => v.Category == "Aria"),
                violations,
            });

            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "INSERT INTO visual_test_tracker_a11y_audits (page_id, base_url, page_path, total_violations, violation_summary, last_audited_at, created_at, updated_at) " +
                "VALUES (@pid, @b, @p, @total, @sum::jsonb, @a, @c, @up) " +
                "ON CONFLICT (base_url, page_path) DO UPDATE SET " +
                "total_violations = EXCLUDED.total_violations, violation_summary = EXCLUDED.violation_summary, " +
                "page_id = COALESCE(EXCLUDED.page_id, visual_test_tracker_a11y_audits.page_id), " +
                "last_audited_at = EXCLUDED.last_audited_at, updated_at = EXCLUDED.updated_at " +
                "RETURNING id", conn);
            cmd.Parameters.AddWithValue("@pid", audit.PageId > 0 ? (object)audit.PageId : DBNull.Value);
            cmd.Parameters.AddWithValue("@b", audit.BaseUrl ?? "");
            cmd.Parameters.AddWithValue("@p", audit.PagePath ?? "");
            cmd.Parameters.AddWithValue("@total", violations.Count);
            cmd.Parameters.AddWithValue("@sum", jsonSummary);
            cmd.Parameters.AddWithValue("@a", audit.LastAuditedAt);
            cmd.Parameters.AddWithValue("@c", audit.CreatedAt);
            cmd.Parameters.AddWithValue("@up", audit.UpdatedAt);

            var idObj = await cmd.ExecuteScalarAsync();
            if (idObj is int idVal) audit.Id = idVal;
        }

        /// <summary>Git #4442 — whether both tables the navigation auto-check persists into exist yet.
        /// visual_test_tracker_a11y_audits arrives via a manual migration Shane runs himself, so until then
        /// the auto-check reports it is off rather than treating every page as "never audited". Throws if
        /// the database is unreachable.</summary>
        public async Task<(bool DomBaselines, bool A11yAudits)> GetAutoCheckTablesReadyOrThrowAsync()
        {
            await using var conn = await OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "SELECT to_regclass('visual_test_tracker_dom_mutations') IS NOT NULL, to_regclass('visual_test_tracker_a11y_audits') IS NOT NULL", conn);
            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync()) return (false, false);
            return (reader.GetBoolean(0), reader.GetBoolean(1));
        }

        private static VisualTestTrackerEntry ReadEntryFromReader(NpgsqlDataReader reader)
        {
            var entry = new VisualTestTrackerEntry
            {
                Id = reader.GetInt32(0),
                EntryUuid = reader.GetString(1),
                PageId = reader.IsDBNull(2) ? 0 : reader.GetInt32(2),
                BaseUrl = reader.GetString(3),
                PagePath = reader.GetString(4),
                Title = reader.GetString(5),
                Notes = reader.GetString(6),
                Severity = reader.GetString(7),
                Status = reader.GetString(8),
                CreatedAt = reader.GetFieldValue<DateTime>(9),
                UpdatedAt = reader.GetFieldValue<DateTime>(10),
                BugNumber = reader.IsDBNull(11) ? reader.GetInt32(0) : reader.GetInt32(11),
                GitIssueNumber = reader.IsDBNull(12) ? null : reader.GetInt32(12),
                SiteName = reader.IsDBNull(13) ? "" : reader.GetString(13),
                EpicName = reader.IsDBNull(14) ? "" : reader.GetString(14),
                ClosingBuildId = reader.IsDBNull(15) ? null : reader.GetString(15),
            };

            if (reader.FieldCount > 16)
            {
                entry.StepsToReproduce = reader.IsDBNull(16) ? "" : reader.GetString(16);
                entry.ExpectedBehavior = reader.IsDBNull(17) ? "" : reader.GetString(17);
                entry.ActualBehavior = reader.IsDBNull(18) ? "" : reader.GetString(18);
            }

            // Git #3978/#3980/#3981 — resolution/resolution_reason/is_design only exist on installs
            // that have already run 2026-09-14-bug-lifecycle-3978.sql; guard the same way the trio
            // above guards a pre-2026-09-13 table.
            if (reader.FieldCount > 21)
            {
                entry.Resolution = reader.IsDBNull(19) ? null : reader.GetString(19);
                entry.ResolutionReason = reader.IsDBNull(20) ? null : reader.GetString(20);
                entry.IsDesign = !reader.IsDBNull(21) && reader.GetBoolean(21);
            }

            // Git #3983 — selector (element-level dedup key) is the last column in the SELECT
            // list wherever it's included; same FieldCount guard pattern.
            if (reader.FieldCount > 22)
            {
                entry.Selector = reader.IsDBNull(22) ? null : reader.GetString(22);
            }

            return entry;
        }

        private static VisualTestTrackerPage ReadPage(NpgsqlDataReader reader) => new VisualTestTrackerPage
        {
            Id = reader.GetInt32(0),
            BaseUrl = reader.GetString(1),
            PagePath = reader.GetString(2),
            IsGood = reader.GetBoolean(3),
            Notes = reader.GetString(4),
            CreatedAt = reader.GetFieldValue<DateTime>(5),
            UpdatedAt = reader.GetFieldValue<DateTime>(6),
        };
    }
}
