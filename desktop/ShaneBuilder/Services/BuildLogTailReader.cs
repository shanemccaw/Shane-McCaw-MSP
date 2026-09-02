using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace ShaneBuilder.Services;

/// <summary>Git #2203 — reads the real per-build stdout log a queued build actually writes,
/// for the Command Center's "Builds"/"Build IDs" category. Machine-global (<c>%TEMP%</c>), not
/// worktree-scoped, so it's readable from ShaneBuilder's own main-checkout process regardless of
/// which isolated worktree the build itself ran in — same real path convention BuildConsole's
/// own <c>Services/BuildLogPaths.cs</c> defines (<c>queue-&lt;id&gt;.log</c>).</summary>
public static class BuildLogTailReader
{
    public static string LogDirectory => Path.Combine(Path.GetTempPath(), "bt-build-queue-logs");

    public static string PathForQueueItem(int id) => Path.Combine(LogDirectory, $"queue-{id}.log");

    public static bool HasLog(int id) => File.Exists(PathForQueueItem(id));

    // A build's real stdout log grows for the entire life of a long Claude Code session and can
    // reach hundreds of KB/MB — reading it whole just to keep the last 10 lines is real wasted
    // I/O and memory on a render path (RenderPaletteBuildDetail) that fires on every selection
    // change. This seeks backward from the end and only grows its read window if that chunk
    // genuinely doesn't contain enough lines, instead of buffering the whole file.
    private const int InitialTailChunkBytes = 8192;

    /// <summary>Last N non-empty lines, read with a shared read lock since the build that owns
    /// this file may still be actively appending to it.</summary>
    public static List<string> TailLines(int id, int count = 10)
    {
        var path = PathForQueueItem(id);
        if (!File.Exists(path)) return new List<string>();

        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            long length = fs.Length;
            int chunkSize = InitialTailChunkBytes;

            while (true)
            {
                int readSize = (int)Math.Min(chunkSize, length);
                fs.Seek(length - readSize, SeekOrigin.Begin);
                var buffer = new byte[readSize];
                int read = 0;
                while (read < readSize)
                {
                    int n = fs.Read(buffer, read, readSize - read);
                    if (n <= 0) break;
                    read += n;
                }

                var text = System.Text.Encoding.UTF8.GetString(buffer, 0, read);
                var lines = text.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => !string.IsNullOrWhiteSpace(l)).ToList();

                // The chunk boundary can land mid-line (first split entry) or we simply haven't
                // read far enough back yet to have `count` real lines — grow the window and retry,
                // unless we've already read the whole file, in which case this is genuinely all
                // there is.
                if (lines.Count > count || readSize >= length)
                    return lines.Count <= count ? lines : lines.Skip(lines.Count - count).ToList();

                chunkSize *= 4;
            }
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[build-log] couldn't tail queue-{id}.log: {ex.Message}");
            return new List<string>();
        }
    }
}
