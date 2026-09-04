using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using System.Windows.Media;
using Npgsql;

namespace BuildConsole.Services;

// Log Viewer core — ported from desktop/ShaneBuilder/Services/LogService.cs
// (built there via Git #2200) into BuildConsole per Git #2785 (sub-issue of
// #2784, Feature: Log Viewer). #2786 (LogViewerDock) / #2787 (LogPeekPanel) /
// #2788 (decommission BuildLogView) all build on this contract, so the data
// shape is deliberately kept identical to ShaneBuilder's.
//
// Real per-source audit for the BuildConsole side (Git #2785, done live before
// porting — same discipline #2200 used, and required because BuildConsole's own
// paths/connection may differ from ShaneBuilder's):
//   - API Server → platform_log_stream (24,103 rows on this machine). CONFIRMED
//     DIFFERENCE from a naive port: the real `id` column is `integer` (int4),
//     NOT bigint. ShaneBuilder's live-tail read it with `(long)`-unbox on the
//     MAX(id) scalar and `reader.GetInt64(0)`, both of which throw
//     InvalidCastException against an int4 column — its API Server LIVE/BURST
//     tail could never have worked on this schema. This port reads it with
//     schema-agnostic `Convert.ToInt64(...)` so it works whether the column is
//     int4 or int8. Filed as a finding against #2784. Levels observed live:
//     {info, warn, error} — read straight from `level`, zero inference.
//   - Marketing/Portal/Admin → real .logs/dev-all/{shane-mccaw-consulting,
//     portal,admin-panel}.log. CONFIRMED they live in the MAIN checkout, not
//     this worktree — see ResolveMainRepoRoot's comment. All three present live.
//   - "SQL Server" → this project runs local PostgreSQL 18, never MS SQL Server
//     (CLAUDE.md Database section). Reads the ACTUAL Postgres server log dir the
//     instance reports (`SHOW data_directory` + `SHOW log_directory`), confirmed
//     real & populated on this machine (D:/Program Files/PostgreSQL/18/data/log,
//     logging_collector on). Honest mapping, not a guessed path.
//   - Build → the shared machine-wide build-queue log dir. BuildConsole already
//     owns this path convention (Services/BuildLogPaths.cs → %TEMP%\
//     bt-build-queue-logs\queue-*.log), identical to what ShaneBuilder
//     duplicated — this port reuses BuildLogPaths.LogDirectory rather than
//     re-deriving it.
//   - Console Output → a new bounded in-memory ring buffer sink
//     (ConsoleOutputSink). Real foundational infra so the source has real data,
//     not a fixture; callers report their own real level (no inference).
//   - SSH / Terminal → listed as real LogSource entries (the design's 9-source
//     rail) but with ZERO backing today. BuildConsole DOES have
//     Services/ReplitSshService.cs, but that is one-shot remote command
//     execution, not a streaming SSH *session-log capture*; there is no ported
//     terminal capture either. Tail()/Query() honestly return nothing for both
//     rather than fabricating lines (#2784 tracks real capture separately).
//
// Level handling is PER-SOURCE, not one uniform inference strategy (the real
// finding on #2200): API Server rows carry a real structured `level`; every
// other file/stdout source is raw text with no level field, so InferLevel's
// keyword match is the only honest option and every such line is flagged
// LevelIsInferred=true so the UI can render it with visibly less confidence.

public enum LogLevel { Trace, Debug, Info, Warn, Error, Fatal }

public enum LogStreamMode { Cold, Burst, Live }

public sealed record LogSource(string Id, string Group, string Label, Color Colour, string? RelativeLogPath);

public sealed record LogLine(
    DateTime Ts, LogLevel Level, string SourceId, string Logger,
    string CorrelationId, string Message, bool LevelIsInferred);

public sealed record LogQuery(
    string? Text, bool Regex, string[]? Exclude, LogLevel[]? Levels,
    string[]? SourceIds, DateTime? From, DateTime? To, string? Logger);

public sealed record ArchiveNode(
    string Id, string Label, string Kind,
    IReadOnlyList<ArchiveNode> Children, string? FilePath = null, string? GitIssueId = null);

public interface ILogService
{
    /// LIVE/BURST — merges every currently-tailable source named in sourceIds
    /// (an empty/null collection means "the sources that have real backing at
    /// all") into one ordered stream. Self-contained: the caller owns
    /// cancellation, BURST's self-cancel timer, and LIVE's indefinite hold.
    IAsyncEnumerable<LogLine> Tail(IEnumerable<string>? sourceIds, CancellationToken ct);

    /// COLD search — works with or without anything streaming, per the
    /// "COLD still returns search results" done-when criterion.
    IReadOnlyList<LogLine> Query(LogQuery q);

    IReadOnlyList<ArchiveNode> Archive();

    /// Real file content behind an Archive leaf (a bookend .md, a raw
    /// stdout.log capture) — used to open it read-only, dropped to COLD.
    string? ReadArchiveFile(string filePath);
}

/// <summary>
/// A keyword-matching GUESS, nothing more — used only for the sources that
/// never carry a real structured level (every source except API Server's
/// platform_log_stream rows; see LogService's own header comment). The
/// derived <see cref="LogLevel"/> is not verified fact: the MESSAGE text it
/// was derived from is the only real thing about the line. Every caller
/// MUST set <see cref="LogLine.LevelIsInferred"/> = true for a line this
/// produces, and the UI MUST render an inferred badge with visibly less
/// confidence (outline/dashed pill, a leading "~", muted tone) than a real
/// platform_log_stream level badge — never the same visual weight. Treating
/// a guess and a fact identically here is exactly what issue #2200's
/// 2026-09-02 comment called out as the wrong default.
/// </summary>
public static class InferLevel
{
    private static readonly (string Keyword, LogLevel Level)[] Rules =
    {
        ("fatal", LogLevel.Fatal),
        ("panic", LogLevel.Fatal),
        ("unhandled exception", LogLevel.Error),
        ("exception", LogLevel.Error),
        ("stack trace", LogLevel.Error),
        (" error", LogLevel.Error),
        ("error:", LogLevel.Error),
        ("failed", LogLevel.Error),
        ("failure", LogLevel.Error),
        ("enoent", LogLevel.Error),
        ("econnrefused", LogLevel.Error),
        ("warn", LogLevel.Warn),
        ("deprecat", LogLevel.Warn),
        ("retry", LogLevel.Warn),
        ("[debug]", LogLevel.Debug),
        ("debug:", LogLevel.Debug),
        ("[trace]", LogLevel.Trace),
    };

    public static LogLevel From(string message)
    {
        if (string.IsNullOrEmpty(message)) return LogLevel.Info;
        var lower = message.ToLowerInvariant();
        foreach (var (keyword, level) in Rules)
            if (lower.Contains(keyword)) return level;
        return LogLevel.Info;
    }
}

/// <summary>
/// BuildConsole had no internal logging sink of its own dedicated to the Log
/// Viewer's "Console Output" source before this — this is genuine foundational
/// infrastructure that source needs to have anything real to show, not a
/// fixture. A bounded in-memory ring buffer; callers report their own real
/// level (this is NOT run through InferLevel — the call site already knows what
/// actually happened), so LevelIsInferred is always false here.
/// </summary>
public static class ConsoleOutputSink
{
    private const int MaxLines = 5000;
    private static readonly ConcurrentQueue<LogLine> Lines = new();

    public static event Action<LogLine>? LineWritten;

    public static void Log(LogLevel level, string message)
    {
        var line = new LogLine(DateTime.Now, level, "console", "BuildConsole", "", message, LevelIsInferred: false);
        Lines.Enqueue(line);
        while (Lines.Count > MaxLines) Lines.TryDequeue(out _);
        LineWritten?.Invoke(line);
    }

    public static IReadOnlyList<LogLine> Snapshot() => Lines.ToArray();
}

public sealed class LogService : ILogService
{
    // Group/colour/id match the real handoff mockup verbatim
    // (wpf-handoff/wpf-handoff/Shell Skeleton v2.html LOG_SRC, ~line 4383) —
    // "port the numbers, not the vibe." RelativeLogPath is the real filename
    // scripts/dev-all.mjs writes under <mainRepoRoot>/.logs/dev-all/ (see
    // services.json); null means no per-file backing (resolved another way,
    // or genuinely nothing yet — see the class header comment). All four
    // file-backed names confirmed present live on this machine (Git #2785).
    public static readonly IReadOnlyList<LogSource> Sources = new List<LogSource>
    {
        new("marketing", "Websites", "Marketing",       ColorFromHex("#4F8FF0"), "shane-mccaw-consulting.log"),
        new("portal",    "Websites", "Portal",          ColorFromHex("#00B4D8"), "portal.log"),
        new("admin",     "Websites", "Admin",           ColorFromHex("#A374EA"), "admin-panel.log"),
        new("api",       "Services", "API Server",      ColorFromHex("#E2593F"), "api-server.log"),
        new("sql",       "Services", "SQL Server",      ColorFromHex("#38BDF8"), null),
        new("build",     "Local",    "Build",           ColorFromHex("#E2B039"), null),
        new("ssh",       "Local",    "SSH",             ColorFromHex("#7FB08A"), null),
        new("terminal",  "Local",    "Terminal",        ColorFromHex("#6EE7B7"), null),
        new("console",   "Local",    "Console Output",  ColorFromHex("#8FA7C4"), null),
    };

    private static Color ColorFromHex(string hex)
    {
        hex = hex.TrimStart('#');
        byte r = byte.Parse(hex.Substring(0, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        byte g = byte.Parse(hex.Substring(2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        byte b = byte.Parse(hex.Substring(4, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        return Color.FromRgb(r, g, b);
    }

    public string? MainRepoRoot { get; }
    private readonly string? _connectionString;
    private string? _postgresLogDir;

    public LogService()
    {
        MainRepoRoot = ResolveMainRepoRoot();
        _connectionString = LoadConnectionString(MainRepoRoot);
    }

    // ── Repo root — mirrors scripts/dev-server/config.mjs's gitCommonDirAbs
    // resolution exactly, because that script is the one actually writing
    // .logs/dev-all/*.log: from inside a worktree (this app almost always
    // runs from one — see CLAUDE.md's mandatory worktree isolation, and Git
    // #1395 confirming BuildConsole's dev server runs from the MAIN checkout),
    // a plain ".git" walk (BuildTrackerConfig.FindRepoRoot's .git-walk
    // fallback) stops at the WORKTREE root, whose .logs/dev-all is empty — the
    // real, populated logs live at the MAIN checkout the dev server actually
    // runs from. A worktree's .git is a FILE ("gitdir: <root>/.git/worktrees/
    // <name>"); that directory's own "commondir" file (relative) resolves to
    // the real shared .git dir, whose parent is the main repo root. This is why
    // the port keeps its own resolver rather than reusing
    // BuildTrackerConfig.FindRepoRoot (which can legitimately return the
    // worktree root for its own callers, wrong for dev-all logs).
    private static string? ResolveMainRepoRoot()
    {
        var envOverride = Environment.GetEnvironmentVariable("DEV_SERVER_MAIN_ROOT");
        if (!string.IsNullOrWhiteSpace(envOverride) && Directory.Exists(envOverride)) return envOverride;

        var start = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
        var dir = start;
        while (dir != null)
        {
            var gitPath = Path.Combine(dir.FullName, ".git");
            if (Directory.Exists(gitPath))
                return dir.FullName; // already the main checkout — .git is a real directory here

            if (File.Exists(gitPath))
            {
                try
                {
                    var gitFileText = File.ReadAllText(gitPath).Trim();
                    const string prefix = "gitdir:";
                    if (gitFileText.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    {
                        var worktreeGitDir = gitFileText.Substring(prefix.Length).Trim();
                        var commonDirFile = Path.Combine(worktreeGitDir, "commondir");
                        if (File.Exists(commonDirFile))
                        {
                            var relCommon = File.ReadAllText(commonDirFile).Trim();
                            var commonDir = Path.GetFullPath(Path.Combine(worktreeGitDir, relCommon));
                            var commonParent = Path.GetFileName(commonDir.TrimEnd(Path.DirectorySeparatorChar))
                                .Equals(".git", StringComparison.OrdinalIgnoreCase)
                                ? Directory.GetParent(commonDir)?.FullName
                                : commonDir;
                            if (!string.IsNullOrEmpty(commonParent) && Directory.Exists(commonParent))
                                return commonParent;
                        }
                    }
                }
                catch { /* fall through to worktree root below */ }
                return dir.FullName; // worktree root — best available fallback
            }
            dir = dir.Parent;
        }
        return null;
    }

    private static string DevAllLogDir(string mainRoot) => Path.Combine(mainRoot, ".logs", "dev-all");

    // ── DATABASE_URL — same source BuildConsole's own
    // BuildQueuePostgresClient.CreateFromEnvironment uses: a DATABASE_URL= line
    // in <repoRoot>/.env.local (confirmed present live, Git #2785). Parsing is
    // delegated to the app's existing, tested
    // BuildQueuePostgresClient.ParseConnectionString rather than duplicating a
    // second URL parser (ShaneBuilder had to port its own copy because the two
    // apps don't share a lib project; inside BuildConsole we reuse the real one).
    private static string? LoadConnectionString(string? repoRoot)
    {
        if (string.IsNullOrEmpty(repoRoot)) return null;
        var envLocal = Path.Combine(repoRoot, ".env.local");
        if (!File.Exists(envLocal)) return null;

        foreach (var raw in File.ReadAllLines(envLocal))
        {
            var trimmed = raw.Trim();
            if (trimmed.StartsWith('#') || !trimmed.StartsWith("DATABASE_URL=", StringComparison.OrdinalIgnoreCase))
                continue;
            var url = trimmed.Substring("DATABASE_URL=".Length).Trim().Trim('"').Trim('\'');
            return BuildQueuePostgresClient.ParseConnectionString(url);
        }
        return null;
    }

    private bool DbAvailable => !string.IsNullOrEmpty(_connectionString);

    // ── Postgres server log directory ("SQL Server" source) ────────────────
    // Real product-decision call, disclosed rather than made silently: the
    // mockup's "SQL Server" literally means Microsoft SQL Server, which this
    // project has never run — the real database engine is local PostgreSQL 18
    // (CLAUDE.md's Database section). Rather than leave the source with no
    // backing at all, it reads the ACTUAL Postgres server log directory this
    // instance reports for itself (`SHOW log_directory` is relative to
    // `data_directory`), confirmed real and populated on this machine (Git
    // #2785) — not a guessed path.
    private string? ResolvePostgresLogDir()
    {
        if (_postgresLogDir != null) return _postgresLogDir;
        if (!DbAvailable) return null;
        try
        {
            using var conn = new NpgsqlConnection(_connectionString);
            conn.Open();
            string dataDir = ScalarString(conn, "SHOW data_directory") ?? "";
            string logDir = ScalarString(conn, "SHOW log_directory") ?? "log";
            if (string.IsNullOrEmpty(dataDir)) return null;
            var combined = Path.IsPathRooted(logDir) ? logDir : Path.Combine(dataDir, logDir);
            _postgresLogDir = combined;
            return combined;
        }
        catch
        {
            return null;
        }
    }

    private static string? ScalarString(NpgsqlConnection conn, string sql)
    {
        using var cmd = new NpgsqlCommand(sql, conn);
        var result = cmd.ExecuteScalar();
        return result?.ToString();
    }

    // Shared build-queue-watcher stdout capture ("Build" source) — real,
    // machine-wide, written by scripts/build-queue-watcher.ps1 regardless of
    // which desktop app (BuildConsole or ShaneBuilder) is running. This reuses
    // BuildConsole's own canonical path (Services/BuildLogPaths.cs, Git #802/
    // #1876) rather than re-deriving %TEMP%\bt-build-queue-logs. Keyed by
    // internal queue id, not Git issue number — there is no reliable id → issue
    // mapping without a live queue-DB join, so lines here are shown as-is (not
    // labeled with a Git issue).
    private static IEnumerable<string> BuildLogFiles()
    {
        var dir = BuildLogPaths.LogDirectory;
        if (!Directory.Exists(dir)) return Array.Empty<string>();
        return Directory.GetFiles(dir, "queue-*.log")
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .Take(5);
    }

    // ── Raw-text line parsing (every non-API-Server, non-console source) ──
    // No universal timestamp format exists across heterogeneous stdout
    // (Vite emits none; pino-pretty emits its own [HH:mm:ss.fff]; Postgres's
    // own log uses a full local timestamp prefix) — real, not invented, but
    // genuinely inconsistent. This tries the two real formats actually seen,
    // else timestamps the line with the moment it was read (documented, not
    // silently passed off as production time).
    private static readonly Regex IsoTsRegex = new(@"^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)Z?\]?", RegexOptions.Compiled);
    private static readonly Regex ClockTsRegex = new(@"^\[?(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]?", RegexOptions.Compiled);

    private static LogLine ParseRawLine(string sourceId, string line, DateTime readAt)
    {
        DateTime ts = readAt;
        var isoMatch = IsoTsRegex.Match(line);
        if (isoMatch.Success && DateTime.TryParse(isoMatch.Groups[1].Value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsedIso))
            ts = parsedIso;
        else
        {
            var clockMatch = ClockTsRegex.Match(line);
            if (clockMatch.Success && DateTime.TryParse(clockMatch.Groups[1].Value, CultureInfo.InvariantCulture, DateTimeStyles.NoCurrentDateDefault, out var parsedClock))
                ts = readAt.Date + parsedClock.TimeOfDay;
        }

        var level = InferLevel.From(line);
        return new LogLine(ts, level, sourceId, sourceId, "", line, LevelIsInferred: true);
    }

    // ── Query() — COLD search, real per issue #2200's per-source rule ──────
    public IReadOnlyList<LogLine> Query(LogQuery q)
    {
        var wantSources = (q.SourceIds != null && q.SourceIds.Length > 0)
            ? q.SourceIds.ToHashSet()
            : Sources.Select(s => s.Id).ToHashSet();

        var results = new List<LogLine>();

        if (wantSources.Contains("api"))
            results.AddRange(QueryApiServerFromDb(q));

        foreach (var src in Sources)
        {
            if (src.Id == "api" || !wantSources.Contains(src.Id)) continue;
            results.AddRange(QueryRawSource(src, q));
        }

        return ApplyCommonFilters(results, q)
            .OrderByDescending(l => l.Ts)
            .Take(2000)
            .ToList();
    }

    private IEnumerable<LogLine> QueryApiServerFromDb(LogQuery q)
    {
        if (!DbAvailable) yield break;

        using var conn = new NpgsqlConnection(_connectionString);
        try { conn.Open(); } catch { yield break; }

        var sql = "SELECT channel, level, message, correlation_id, occurred_at FROM platform_log_stream WHERE 1=1";
        var parms = new List<NpgsqlParameter>();
        if (q.From.HasValue) { sql += " AND occurred_at >= @from"; parms.Add(new NpgsqlParameter("from", q.From.Value)); }
        if (q.To.HasValue) { sql += " AND occurred_at <= @to"; parms.Add(new NpgsqlParameter("to", q.To.Value)); }
        sql += " ORDER BY occurred_at DESC LIMIT 3000";

        using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddRange(parms.ToArray());
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var channel = reader.IsDBNull(0) ? "" : reader.GetString(0);
            var levelText = reader.IsDBNull(1) ? "info" : reader.GetString(1);
            var message = reader.IsDBNull(2) ? "" : reader.GetString(2);
            var correlationId = reader.IsDBNull(3) ? "" : reader.GetGuid(3).ToString();
            var occurredAt = reader.GetDateTime(4);

            if (!Enum.TryParse<LogLevel>(levelText, ignoreCase: true, out var level))
                level = LogLevel.Info;

            // channel (e.g. "engine.monitor") is the real analog of "Logger"
            // in this schema — there is no separate logger column.
            yield return new LogLine(occurredAt, level, "api", channel, correlationId, message, LevelIsInferred: false);
        }
    }

    private IEnumerable<LogLine> QueryRawSource(LogSource src, LogQuery q)
    {
        var readAt = DateTime.Now;
        switch (src.Id)
        {
            case "console":
                return ConsoleOutputSink.Snapshot();

            case "sql":
            {
                var dir = ResolvePostgresLogDir();
                if (dir == null || !Directory.Exists(dir)) return Array.Empty<LogLine>();
                var newest = Directory.GetFiles(dir, "*.log").OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault();
                return newest == null ? Array.Empty<LogLine>() : ReadTailLines(newest, "sql", readAt);
            }

            case "build":
                return BuildLogFiles().SelectMany(f => ReadTailLines(f, "build", readAt));

            case "ssh":
            case "terminal":
                // No real capture exists for either yet — see class header
                // comment. Honest empty result, not a fabricated line.
                return Array.Empty<LogLine>();

            default:
            {
                if (MainRepoRoot == null || src.RelativeLogPath == null) return Array.Empty<LogLine>();
                var path = Path.Combine(DevAllLogDir(MainRepoRoot), src.RelativeLogPath);
                return File.Exists(path) ? ReadTailLines(path, src.Id, readAt) : Array.Empty<LogLine>();
            }
        }
    }

    private static IEnumerable<LogLine> ReadTailLines(string path, string sourceId, DateTime readAt, int maxLines = 4000)
    {
        List<string> lines;
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var sr = new StreamReader(fs);
            var all = new List<string>();
            string? line;
            while ((line = sr.ReadLine()) != null) all.Add(line);
            lines = all.Count > maxLines ? all.Skip(all.Count - maxLines).ToList() : all;
        }
        catch
        {
            yield break;
        }

        foreach (var l in lines)
        {
            if (string.IsNullOrWhiteSpace(l)) continue;
            yield return ParseRawLine(sourceId, l, readAt);
        }
    }

    private static IEnumerable<LogLine> ApplyCommonFilters(IEnumerable<LogLine> lines, LogQuery q)
    {
        IEnumerable<LogLine> result = lines;

        if (q.Levels is { Length: > 0 })
        {
            var levelSet = q.Levels.ToHashSet();
            result = result.Where(l => levelSet.Contains(l.Level));
        }

        if (!string.IsNullOrWhiteSpace(q.Logger))
            result = result.Where(l => l.Logger.Contains(q.Logger, StringComparison.OrdinalIgnoreCase));

        if (!string.IsNullOrWhiteSpace(q.Text))
        {
            if (q.Regex)
            {
                Regex? rx = null;
                try { rx = new Regex(q.Text, RegexOptions.IgnoreCase); } catch { /* invalid pattern — no matches rather than throwing */ }
                result = rx == null ? Array.Empty<LogLine>() : result.Where(l => rx.IsMatch(l.Message));
            }
            else
            {
                var text = q.Text;
                result = result.Where(l => l.Message.Contains(text, StringComparison.OrdinalIgnoreCase));
            }
        }

        if (q.Exclude is { Length: > 0 })
        {
            var excludes = q.Exclude.Where(e => !string.IsNullOrWhiteSpace(e)).ToArray();
            if (excludes.Length > 0)
                result = result.Where(l => !excludes.Any(ex => l.Message.Contains(ex, StringComparison.OrdinalIgnoreCase)));
        }

        return result;
    }

    // ── Tail() — LIVE/BURST. One background poll loop per requested source
    // with real backing, merged into a single ordered channel; ssh/terminal
    // contribute nothing (no real backing — see class header). Poll rather
    // than FileSystemWatcher/SSE: simplest correct thing that is still real
    // (no fabricated heartbeats), and consistent with this project's default
    // of connecting directly rather than adding an HTTP/token hop.
    public async IAsyncEnumerable<LogLine> Tail(IEnumerable<string>? sourceIds, [EnumeratorCancellation] CancellationToken ct)
    {
        var wantSources = (sourceIds != null && sourceIds.Any())
            ? sourceIds.ToHashSet()
            : Sources.Select(s => s.Id).ToHashSet();

        var channel = Channel.CreateUnbounded<LogLine>();
        var tasks = new List<Task>();

        if (wantSources.Contains("api"))
            tasks.Add(TailApiServerAsync(channel.Writer, ct));

        foreach (var src in Sources)
        {
            if (src.Id == "api" || !wantSources.Contains(src.Id)) continue;
            if (src.Id == "ssh" || src.Id == "terminal") continue; // no real backing
            tasks.Add(TailRawSourceAsync(src, channel.Writer, ct));
        }

        if (wantSources.Contains("console"))
            tasks.Add(TailConsoleAsync(channel.Writer, ct));

        _ = Task.WhenAll(tasks).ContinueWith(_ => channel.Writer.TryComplete(), TaskScheduler.Default);

        await foreach (var line in channel.Reader.ReadAllAsync(ct))
            yield return line;
    }

    private async Task TailApiServerAsync(ChannelWriter<LogLine> writer, CancellationToken ct)
    {
        if (!DbAvailable) return;
        // Git #2785 — platform_log_stream.id is int4 on this schema (audited
        // live). Convert.ToInt64 handles a boxed Int32 scalar; a plain
        // `(long)`-unbox would throw InvalidCastException (the latent bug in the
        // ShaneBuilder source this was ported from). COALESCE(MAX(id),0) can
        // still return DBNull on an empty table — coalesce that to 0 too.
        long lastId = 0;
        try
        {
            using var initConn = new NpgsqlConnection(_connectionString);
            await initConn.OpenAsync(ct);
            using var initCmd = new NpgsqlCommand("SELECT COALESCE(MAX(id), 0) FROM platform_log_stream", initConn);
            var scalar = await initCmd.ExecuteScalarAsync(ct);
            lastId = (scalar == null || scalar is DBNull) ? 0L : Convert.ToInt64(scalar);
        }
        catch { return; }

        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync(ct);
                using var cmd = new NpgsqlCommand(
                    "SELECT id, channel, level, message, correlation_id, occurred_at FROM platform_log_stream WHERE id > @lastId ORDER BY id ASC LIMIT 500", conn);
                cmd.Parameters.AddWithValue("lastId", lastId);
                using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    lastId = Convert.ToInt64(reader.GetValue(0)); // int4 or int8 — schema-agnostic
                    var channelName = reader.IsDBNull(1) ? "" : reader.GetString(1);
                    var levelText = reader.IsDBNull(2) ? "info" : reader.GetString(2);
                    var message = reader.IsDBNull(3) ? "" : reader.GetString(3);
                    var correlationId = reader.IsDBNull(4) ? "" : reader.GetGuid(4).ToString();
                    var occurredAt = reader.GetDateTime(5);
                    if (!Enum.TryParse<LogLevel>(levelText, ignoreCase: true, out var level)) level = LogLevel.Info;
                    await writer.WriteAsync(new LogLine(occurredAt, level, "api", channelName, correlationId, message, false), ct);
                }
            }
            catch (OperationCanceledException) { break; }
            catch { /* transient — keep polling */ }

            try { await Task.Delay(TimeSpan.FromSeconds(1.5), ct); } catch (OperationCanceledException) { break; }
        }
    }

    private async Task TailRawSourceAsync(LogSource src, ChannelWriter<LogLine> writer, CancellationToken ct)
    {
        string? ResolvePath() => src.Id switch
        {
            "sql" => Directory.Exists(ResolvePostgresLogDir())
                ? Directory.GetFiles(ResolvePostgresLogDir()!, "*.log").OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault()
                : null,
            "build" => BuildLogFiles().FirstOrDefault(),
            _ => MainRepoRoot != null && src.RelativeLogPath != null
                ? Path.Combine(DevAllLogDir(MainRepoRoot), src.RelativeLogPath)
                : null
        };

        long lastLength = 0;
        string? lastPath = null;

        while (!ct.IsCancellationRequested)
        {
            var path = ResolvePath();
            if (path != null && File.Exists(path))
            {
                try
                {
                    if (path != lastPath) { lastPath = path; lastLength = new FileInfo(path).Length; } // start tailing from current EOF, not the whole history

                    var info = new FileInfo(path);
                    if (info.Length > lastLength)
                    {
                        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                        fs.Seek(lastLength, SeekOrigin.Begin);
                        using var sr = new StreamReader(fs);
                        string? line;
                        var readAt = DateTime.Now;
                        while ((line = await sr.ReadLineAsync()) != null)
                        {
                            if (!string.IsNullOrWhiteSpace(line))
                                await writer.WriteAsync(ParseRawLine(src.Id, line, readAt), ct);
                        }
                        lastLength = info.Length;
                    }
                    else if (info.Length < lastLength)
                    {
                        lastLength = 0; // rotated (dev-all.mjs's 15MB rotation) — restart from the new file's top
                    }
                }
                catch (OperationCanceledException) { break; }
                catch { /* transient IO — keep polling */ }
            }

            try { await Task.Delay(TimeSpan.FromSeconds(1), ct); } catch (OperationCanceledException) { break; }
        }
    }

    private static async Task TailConsoleAsync(ChannelWriter<LogLine> writer, CancellationToken ct)
    {
        var tcs = new TaskCompletionSource();
        void Handler(LogLine l) { try { writer.TryWrite(l); } catch { /* channel closed */ } }
        ConsoleOutputSink.LineWritten += Handler;
        using var reg = ct.Register(() => tcs.TrySetResult());
        try { await tcs.Task; }
        finally { ConsoleOutputSink.LineWritten -= Handler; }
    }

    // ── Archive — real day → build tree, per issue #2200's own real-audit
    // finding: no on-disk archive infrastructure exists anywhere in this
    // repo. build-journal/<id>.md (real, one per Git issue) is the only real,
    // openable "bookend" data available; the mockup's stdout.log leaf per
    // build has no honest source to read from (BuildConsole's own
    // %TEMP%\bt-build-queue-logs\queue-{id}.log is keyed by an internal queue
    // id with no reliable join back to a Git issue number) — an honest gap,
    // not fabricated. "Day" groups by each bookend file's real last-write
    // date (filesystem metadata), the closest available real proxy for "the
    // day this build happened." MainRepoRoot is the MAIN checkout, where
    // build-journal/ actually lives (Git #2785).
    public IReadOnlyList<ArchiveNode> Archive()
    {
        if (MainRepoRoot == null) return Array.Empty<ArchiveNode>();
        var dir = Path.Combine(MainRepoRoot, "build-journal");
        if (!Directory.Exists(dir)) return Array.Empty<ArchiveNode>();

        var byDay = new SortedDictionary<DateTime, List<ArchiveNode>>(Comparer<DateTime>.Create((a, b) => b.CompareTo(a)));

        foreach (var file in Directory.GetFiles(dir, "*.md"))
        {
            var id = Path.GetFileNameWithoutExtension(file);
            if (id.Equals("README", StringComparison.OrdinalIgnoreCase)) continue;

            var day = File.GetLastWriteTime(file).Date;
            var title = ExtractBookendTitle(file) ?? $"#{id}";
            var bookendLeaf = new ArchiveNode(id + "-bookend", $"{id}.md (bookend)", "bookend",
                Array.Empty<ArchiveNode>(), FilePath: file, GitIssueId: id);
            var buildNode = new ArchiveNode(id, title, "build", new List<ArchiveNode> { bookendLeaf }, GitIssueId: id);

            if (!byDay.TryGetValue(day, out var list)) byDay[day] = list = new List<ArchiveNode>();
            list.Add(buildNode);
        }

        var days = new List<ArchiveNode>();
        foreach (var (day, builds) in byDay)
        {
            builds.Sort((a, b) => string.Compare(b.GitIssueId, a.GitIssueId, StringComparison.OrdinalIgnoreCase));
            days.Add(new ArchiveNode(day.ToString("yyyy-MM-dd"), day.ToString("MMM d, yyyy"), "day", builds));
        }
        return days;
    }

    private static string? ExtractBookendTitle(string file)
    {
        try
        {
            foreach (var line in File.ReadLines(file).Take(3))
            {
                var trimmed = line.TrimStart('#', ' ');
                if (!string.IsNullOrWhiteSpace(trimmed)) return trimmed.Trim();
            }
        }
        catch { /* unreadable — fall back to the filename-derived title */ }
        return null;
    }

    /// Opens an archive bookend by its real Git issue id — the
    /// "an archive bookend opens by Git ID" done-when criterion. Returns null
    /// if that id has no bookend file (never fabricates content).
    public string? ReadArchiveFile(string filePath)
    {
        try { return File.Exists(filePath) ? File.ReadAllText(filePath) : null; }
        catch { return null; }
    }

    public string? OpenBookendByGitId(string gitId)
    {
        if (MainRepoRoot == null) return null;
        var path = Path.Combine(MainRepoRoot, "build-journal", gitId + ".md");
        return ReadArchiveFile(path);
    }
}
