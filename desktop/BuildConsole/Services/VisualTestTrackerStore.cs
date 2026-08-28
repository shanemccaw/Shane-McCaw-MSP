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

            var repoRoot = BuildTrackerConfig.FindRepoRoot() ?? "";
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
