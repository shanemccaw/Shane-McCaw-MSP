using System;
using System.Collections.Generic;
using System.IO;
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
                    "SELECT id, entry_uuid, page_id, base_url, page_path, title, notes, severity, status, created_at, updated_at " +
                    "FROM visual_test_tracker_entries WHERE page_id = @pid ORDER BY created_at DESC", conn);
                cmd.Parameters.AddWithValue("@pid", pageId);
                await using var reader = await cmd.ExecuteReaderAsync();
                var dbList = new List<VisualTestTrackerEntry>();
                while (await reader.ReadAsync())
                {
                    dbList.Add(new VisualTestTrackerEntry
                    {
                        Id = reader.GetInt32(0),
                        EntryUuid = reader.GetString(1),
                        PageId = reader.GetInt32(2),
                        BaseUrl = reader.GetString(3),
                        PagePath = reader.GetString(4),
                        Title = reader.GetString(5),
                        Notes = reader.GetString(6),
                        Severity = reader.GetString(7),
                        Status = reader.GetString(8),
                        CreatedAt = reader.GetFieldValue<DateTime>(9),
                        UpdatedAt = reader.GetFieldValue<DateTime>(10)
                    });
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
                    "INSERT INTO visual_test_tracker_entries (entry_uuid, page_id, base_url, page_path, title, notes, severity, status, created_at, updated_at) " +
                    "VALUES (@u, @pid, @b, @p, @t, @n, @sev, @st, @c, @up) " +
                    "ON CONFLICT (entry_uuid) DO UPDATE SET " +
                    "title = EXCLUDED.title, notes = EXCLUDED.notes, severity = EXCLUDED.severity, " +
                    "status = EXCLUDED.status, updated_at = EXCLUDED.updated_at " +
                    "RETURNING id", conn);
                cmd.Parameters.AddWithValue("@u", entry.EntryUuid);
                cmd.Parameters.AddWithValue("@pid", entry.PageId);
                cmd.Parameters.AddWithValue("@b", entry.BaseUrl ?? "");
                cmd.Parameters.AddWithValue("@p", entry.PagePath ?? "");
                cmd.Parameters.AddWithValue("@t", entry.Title ?? "");
                cmd.Parameters.AddWithValue("@n", entry.Notes ?? "");
                cmd.Parameters.AddWithValue("@sev", entry.Severity ?? "Bug");
                cmd.Parameters.AddWithValue("@st", entry.Status ?? "Open");
                cmd.Parameters.AddWithValue("@c", entry.CreatedAt);
                cmd.Parameters.AddWithValue("@up", entry.UpdatedAt);
                var idObj = await cmd.ExecuteScalarAsync();
                if (idObj is int idVal) entry.Id = idVal;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"DB save entry skipped: {ex.Message}");
            }
        }

        /// <summary>Updates an entry's status (e.g. 'Open' or 'Resolved').</summary>
        public async Task UpdateEntryStatusAsync(string entryUuid, string status)
        {
            if (string.IsNullOrWhiteSpace(entryUuid)) return;

            var all = LoadLocalEntries();
            var target = all.Find(e => string.Equals(e.EntryUuid, entryUuid, StringComparison.OrdinalIgnoreCase));
            if (target != null)
            {
                target.Status = status;
                target.UpdatedAt = DateTime.Now;
                PersistLocalEntries(all);
            }

            try
            {
                await using var conn = await OpenAsync();
                await using var cmd = new NpgsqlCommand(
                    "UPDATE visual_test_tracker_entries SET status = @st, updated_at = now() WHERE entry_uuid = @u", conn);
                cmd.Parameters.AddWithValue("@st", status);
                cmd.Parameters.AddWithValue("@u", entryUuid);
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"DB status update skipped: {ex.Message}");
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
