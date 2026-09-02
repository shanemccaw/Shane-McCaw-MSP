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

namespace ShaneBuilder.Services;

// Step 10 (Log Viewer) — desktop/ShaneBuilder/wpf-handoff/readme-phase2.md,
// corrected by the real finding on issue #2200 (2026-09-02 comment): level
// handling is PER-SOURCE, not one uniform inference strategy.
//
//   - API Server rows come from platform_log_stream.level — a real column
//     populated straight from pino's own numeric level
//     (artifacts/api-server/src/lib/logger.ts's logMethod hook,
//     LEVEL_NAMES[Math.floor(level/10)-1]). Zero inference for this source —
//     Query()/Tail() read it directly out of Postgres.
//   - Every other source here (Marketing/Portal/Admin dev-server stdout, the
//     local Postgres server log, the shared build-queue-watcher stdout
//     capture, and ShaneBuilder's own console output) is raw, unstructured
//     process output with no level field at all. InferLevel's keyword match
//     is the only honest option for those — see its own doc comment for the
//     UI-rendering rule that goes with it.
//   - SSH and Terminal are listed as real LogSource entries (per the design
//     contract's 9-source rail) but have ZERO backing today: ShaneBuilder has
//     no embedded terminal and no ported SSH session capture (that's
//     BuildConsole-only, Services/ReplitSshService.cs, never ported here).
//     Tail()/Query() honestly return nothing for them rather than fabricating
//     lines — same "honest gap, not an oversight" precedent GitDoctorService
//     already set for the two mockup checks it can't detect.

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
/// ShaneBuilder had no internal logging sink of its own at all before this
/// (real audit, Git #2200) — this is genuine foundational infrastructure the
/// "Console Output" source needs to have anything real to show, not a
/// fixture. A bounded in-memory ring buffer; callers report their own real
/// level (this is NOT run through InferLevel — the call site already knows
/// what actually happened), so LevelIsInferred is always false here.
/// </summary>
public static class ConsoleOutputSink
{
    private const int MaxLines = 5000;
    private static readonly ConcurrentQueue<LogLine> Lines = new();

    public static event Action<LogLine>? LineWritten;

    public static void Log(LogLevel level, string message)
    {
        var line = new LogLine(DateTime.Now, level, "console", "ShaneBuilder", "", message, LevelIsInferred: false);
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
    // or genuinely nothing yet — see the class header comment).
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
    // runs from one — see CLAUDE.md's mandatory worktree isolation), a plain
    // ".git" walk (GitDoctorService's approach) stops at the WORKTREE root,
    // whose .logs/dev-all is empty — the real, populated logs live at the
    // MAIN checkout the dev server actually runs from. A worktree's .git is a
    // FILE ("gitdir: <root>/.git/worktrees/<name>"); that directory's own
    // "commondir" file (relative) resolves to the real shared .git dir, whose
    // parent is the main repo root.
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

    // ── DATABASE_URL — same fallback chain as
    // desktop/BuildConsole/Services/BuildQueuePostgresClient.cs's
    // CreateFromEnvironment: a DATABASE_URL= line in <repoRoot>/.env.local.
    // ShaneBuilder has no prior Postgres connectivity at all (real audit,
    // Git #2200) so this is ported fresh rather than shared — the two apps
    // don't share a lib project.
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
            return ParseConnectionString(url);
        }
        return null;
    }

    // Ported from BuildQueuePostgresClient.ParseConnectionString — converts
    // a postgresql://user:pass@host:port/db URL into an Npgsql connection
    // string. Left as a passthrough for anything already in Npgsql's own
    // keyword=value form.
    public static string ParseConnectionString(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return input;
        var trimmed = input.Trim();
        if (!trimmed.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase) &&
            !trimmed.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase))
            return input;

        try
        {
            int prefixLen = trimmed.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase) ? 13 : 11;
            string remaining = trimmed.Substring(prefixLen);

            string userPass = "";
            string hostPortDbQuery = remaining;
            int atIndex = remaining.LastIndexOf('@');
            if (atIndex >= 0)
            {
                userPass = remaining.Substring(0, atIndex);
                hostPortDbQuery = remaining.Substring(atIndex + 1);
            }

            string username = "", password = "";
            if (!string.IsNullOrEmpty(userPass))
            {
                int colonIndex = userPass.IndexOf(':');
                if (colonIndex >= 0)
                {
                    username = Uri.UnescapeDataString(userPass.Substring(0, colonIndex));
                    password = Uri.UnescapeDataString(userPass.Substring(colonIndex + 1));
                }
                else username = Uri.UnescapeDataString(userPass);
            }

            string hostPort = hostPortDbQuery;
            string database = "";
            int slashIndex = hostPortDbQuery.IndexOf('/');
            if (slashIndex >= 0)
            {
                hostPort = hostPortDbQuery.Substring(0, slashIndex);
                var dbAndQuery = hostPortDbQuery.Substring(slashIndex + 1);
                int qIndex = dbAndQuery.IndexOf('?');
                database = qIndex >= 0 ? dbAndQuery.Substring(0, qIndex) : dbAndQuery;
            }

            string host = hostPort, port = "5432";
            int colonPortIndex = hostPort.LastIndexOf(':');
            if (colonPortIndex >= 0)
            {
                host = hostPort.Substring(0, colonPortIndex);
                port = hostPort.Substring(colonPortIndex + 1);
            }

            return $"Host={host};Port={port};Database={database};Username={username};Password={password};SSL Mode=Prefer;Trust Server Certificate=true";
        }
        catch
        {
            return input;
        }
    }

    private bool DbAvailable => !string.IsNullOrEmpty(_connectionString);

    // ── Postgres server log directory ("SQL Server" source) ────────────────
    // Real product-decision call, disclosed in issue #2200's completion
    // comment rather than made silently: the mockup's "SQL Server" literally
    // means Microsoft SQL Server, which this project has never run — the
    // real database engine is local PostgreSQL 18 (CLAUDE.md's Database
    // section). Rather than leave the source with no backing at all, it
    // reads the ACTUAL Postgres server log directory this instance reports
    // for itself (`SHOW log_directory` is relative to `data_directory`),
    // confirmed real and populated on this machine — not a guessed path.
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
    // which desktop app (BuildConsole or ShaneBuilder) is running; see
    // desktop/BuildConsole/Services/BuildLogPaths.cs. Keyed by internal queue
    // id, not Git issue number — there is no reliable id → issue mapping
    // without a live queue-DB join, so lines here are shown as-is (not
    // labeled with a Git issue).
    private static string BuildLogDir() => Path.Combine(Path.GetTempPath(), "bt-build-queue-logs");

    private static IEnumerable<string> BuildLogFiles()
    {
        var dir = BuildLogDir();
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
        long lastId = 0;
        try
        {
            using var initConn = new NpgsqlConnection(_connectionString);
            await initConn.OpenAsync(ct);
            using var initCmd = new NpgsqlCommand("SELECT COALESCE(MAX(id), 0) FROM platform_log_stream", initConn);
            lastId = (long)(await initCmd.ExecuteScalarAsync(ct) ?? 0L);
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
                    lastId = reader.GetInt64(0);
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
    // day this build happened."
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
