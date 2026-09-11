using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows.Media.Imaging;

namespace BuildConsole.Services
{
    /// <summary>Git #3657 (sub-issue of Epic #1202) — one real shot on disk. There is no separate
    /// metadata/tag/run store for Shot Vault — a shot is the file itself, named/timestamped by
    /// <see cref="DesktopScreenClipService"/>'s own save convention (the only real shot-producing
    /// mechanism BuildConsole has). Unlike the ShaneBuilder source this was ported from, BuildConsole's
    /// own <see cref="DesktopScreenClipService"/> does not encode a monitor/screen identity into the
    /// filename at capture time (its region-select spans the whole virtual desktop across every
    /// monitor, not one physical screen — there is no single "screen" a clip cleanly belongs to), so
    /// <see cref="Screen"/> is always the honest "Unknown" here rather than a fabricated label.</summary>
    public sealed record ShotVaultItem(string FilePath, string FileName, DateTime CreatedAtUtc, string Screen);

    /// <summary>Git #3657 — a "run": one or more shots captured close enough together in time that
    /// they're plainly the same capture session (e.g. a burst of region clips taken back-to-back while
    /// working a bug), newest shot first within the run. <see cref="ShotVaultService.ListRuns()"/> is
    /// what actually derives these — there is no persisted run id anywhere on disk, so a run only ever
    /// exists as this in-memory grouping over <see cref="ShotVaultService.ListShots"/>'s real
    /// timestamps.</summary>
    public sealed record ShotVaultRun(IReadOnlyList<ShotVaultItem> Shots)
    {
        /// <summary>Real shot count in this run.</summary>
        public int Count => Shots.Count;

        /// <summary>Newest timestamp in the run (Shots is already newest-first) — what the run's own
        /// header displays, and what runs are newest-first-sorted by.</summary>
        public DateTime NewestUtc => Shots[0].CreatedAtUtc;

        /// <summary>Oldest timestamp in the run — only differs from <see cref="NewestUtc"/> when the
        /// run actually has more than one shot.</summary>
        public DateTime OldestUtc => Shots[^1].CreatedAtUtc;
    }

    /// <summary>Git #3657 — the real, derived tag set for one shot. There is no manual tag store, so
    /// every tag here is computed straight off data the shot already really carries: its own real
    /// capture screen ("Unknown" — see <see cref="ShotVaultItem"/>'s own doc-comment), a date bucket
    /// off its own real capture timestamp, and its own real decoded pixel dimensions when the file
    /// decodes. Nothing here is a fixture label or a guessed taxonomy.</summary>
    public sealed record ShotVaultTag(string Label, string Kind);

    /// <summary>Git #3657 — reads the real shots <see cref="DesktopScreenClipService"/> already saves
    /// to disk (the same <see cref="BuildConsoleSettings.ScreenClipSaveDirectory"/> that service
    /// itself writes to — one real source, never a second path to keep in sync), groups them into real
    /// runs, supports a real search by filename/screen, derives real tag chips, and copies a shot back
    /// to the clipboard. Ported from ShaneBuilder's <c>Services/ShotVaultService.cs</c> — behavior
    /// re-implemented against BuildConsole's own real capture output rather than a second/duplicated
    /// capture mechanism. Intentionally NOT ported from the ShaneBuilder source: DIFF-from-previous
    /// badges, baseline-compare pinning, retention auto-purge, and "send to tab" — issue #3657's own
    /// scope names only search, tag filters, runs grouping, thumbnail grid, and per-shot Copy.</summary>
    public static class ShotVaultService
    {
        public const string Channel = DesktopScreenClipService.Channel;

        /// <summary>Gap between two consecutive shots (by real file timestamp) beyond which they're no
        /// longer the same capture session and start a new run. There's no persisted "run" concept to
        /// read this from, so this is a deliberate, named threshold rather than a magic number buried
        /// in <see cref="ListRuns()"/>.</summary>
        public static readonly TimeSpan RunGap = TimeSpan.FromMinutes(5);

        /// <summary>The exact real directory <see cref="DesktopScreenClipService"/> saves shots to —
        /// reads the live setting (including Shane's own override), not a hardcoded default, so the
        /// vault never drifts from wherever captures are actually landing.</summary>
        public static string ShotsDirectory
        {
            get
            {
                var settings = BuildConsoleSettings.Load();
                return string.IsNullOrWhiteSpace(settings.ScreenClipSaveDirectory)
                    ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Screenshots", "BuildConsole")
                    : settings.ScreenClipSaveDirectory;
            }
        }

        /// <summary>Every real shot on disk, newest-first. Returns an empty list — never a fabricated
        /// row — if the folder doesn't exist yet (nothing captured).</summary>
        public static IReadOnlyList<ShotVaultItem> ListShots()
        {
            string dir = ShotsDirectory;
            if (!Directory.Exists(dir))
                return Array.Empty<ShotVaultItem>();

            return Directory.EnumerateFiles(dir, "*.png", SearchOption.TopDirectoryOnly)
                .Select(path => new ShotVaultItem(path, Path.GetFileName(path), File.GetLastWriteTimeUtc(path), "Unknown"))
                .OrderByDescending(shot => shot.CreatedAtUtc)
                .ToList();
        }

        /// <summary>Real "runs newest-first with timestamps and counts": groups <see cref="ListShots"/>'s
        /// real, newest-first shots into runs by <see cref="RunGap"/>, then returns those runs
        /// newest-run-first. Each run carries its own real shot list (also newest-first) rather than a
        /// synthesized average or a fabricated label.</summary>
        public static IReadOnlyList<ShotVaultRun> ListRuns() => ListRuns(ListShots());

        /// <summary>Same real run-grouping, over a caller-supplied shot list (already newest-first)
        /// rather than always re-reading disk — lets the search/tag filter re-group its own
        /// already-filtered subset without duplicating the gap logic.</summary>
        public static IReadOnlyList<ShotVaultRun> ListRuns(IReadOnlyList<ShotVaultItem> shotsNewestFirst)
        {
            var runs = new List<ShotVaultRun>();
            var current = new List<ShotVaultItem>();

            foreach (var shot in shotsNewestFirst)
            {
                if (current.Count > 0 && current[^1].CreatedAtUtc - shot.CreatedAtUtc > RunGap)
                {
                    runs.Add(new ShotVaultRun(current));
                    current = new List<ShotVaultItem>();
                }
                current.Add(shot);
            }
            if (current.Count > 0)
                runs.Add(new ShotVaultRun(current));

            return runs;
        }

        /// <summary>Real "search by shot name or screen": a case-insensitive substring match against
        /// the shot's actual filename or its real capture-time <see cref="ShotVaultItem.Screen"/>
        /// label — never a fuzzy/ranked match invented for this, and never against fabricated
        /// metadata.</summary>
        public static bool MatchesQuery(ShotVaultItem shot, string query) =>
            shot.FileName.Contains(query, StringComparison.OrdinalIgnoreCase) ||
            shot.Screen.Contains(query, StringComparison.OrdinalIgnoreCase);

        /// <summary>The real per-shot Copy action: put that exact shot's PNG back on the clipboard,
        /// reusing <see cref="DesktopScreenClipService"/>'s own multi-format clipboard write rather
        /// than a second one.</summary>
        public static void CopyToClipboard(ShotVaultItem shot) => DesktopScreenClipService.CopyFileToClipboard(shot.FilePath);

        /// <summary>The real, derived tag set for one shot: its real capture screen, a date bucket off
        /// its own real timestamp, and a resolution tag off its own real decoded pixel dimensions (when
        /// the file decodes). Order is stable (screen, date, resolution) so chip rendering doesn't
        /// reshuffle between panel refreshes.</summary>
        public static IReadOnlyList<ShotVaultTag> GetTags(ShotVaultItem shot)
        {
            var tags = new List<ShotVaultTag> { new(shot.Screen, "screen"), new(DateBucket(shot.CreatedAtUtc), "date") };

            var resolution = TryGetResolution(shot.FilePath);
            if (resolution is { } res)
                tags.Add(new ShotVaultTag($"{res.Width}×{res.Height}", "resolution"));

            return tags;
        }

        /// <summary>Real date-bucket label off a shot's own real capture timestamp — "Today"/
        /// "Yesterday" while it's genuinely recent, the real weekday name inside the last 7 days
        /// (still unambiguous at that range), and the real calendar date beyond that. Compared in
        /// local time since that's what the panel's own timestamps already render in.</summary>
        public static string DateBucket(DateTime createdAtUtc)
        {
            var createdLocalDate = createdAtUtc.ToLocalTime().Date;
            var today = DateTime.Now.Date;
            int daysAgo = (today - createdLocalDate).Days;

            return daysAgo switch
            {
                0 => "Today",
                1 => "Yesterday",
                >= 2 and <= 6 => createdLocalDate.ToString("dddd"),
                _ => createdLocalDate.ToString("MMM d")
            };
        }

        /// <summary>Real pixel dimensions of a shot, read from the file's own decoded header —
        /// <c>BitmapCacheOption.None</c> so this stays a cheap header read, not a full-size decode.
        /// Returns null on any decode failure (corrupt file, still mid-write) rather than a guessed
        /// size.</summary>
        public static (int Width, int Height)? TryGetResolution(string filePath)
        {
            try
            {
                var decoder = BitmapDecoder.Create(
                    new Uri(filePath, UriKind.Absolute),
                    BitmapCreateOptions.DelayCreation,
                    BitmapCacheOption.None);
                var frame = decoder.Frames[0];
                return (frame.PixelWidth, frame.PixelHeight);
            }
            catch
            {
                return null;
            }
        }
    }
}
