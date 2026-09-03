using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace ShaneBuilder.Services
{
    /// <summary>Git #2372 (Feature #2367 item 5) — one real shot on disk. There is no separate
    /// metadata/tag/run store for Shot Vault (real audit: only <see cref="DesktopScreenClipService"/>'s
    /// manual clip exists) — a shot is the file itself, named/timestamped by that service's own
    /// convention. Git #2368 adds one real piece of capture-time metadata, <see cref="Screen"/>,
    /// which <see cref="DesktopScreenClipService"/> now encodes into that same filename (see its
    /// <c>SaveToDisk</c>) rather than a second sidecar file — still exactly one real source on disk.</summary>
    public sealed record ShotVaultItem(string FilePath, string FileName, DateTime CreatedAtUtc, string Screen);

    /// <summary>Git #2370 (Feature #2367 item 3) — a "run": one or more shots captured close enough
    /// together in time that they're plainly the same capture session (e.g. a burst of PrintScreen/
    /// region clips taken back to back while working a bug), newest shot first within the run.
    /// <see cref="ShotVaultService.ListRuns"/> is what actually derives these — there is no persisted
    /// run id anywhere on disk, so a run only ever exists as this in-memory grouping over
    /// <see cref="ShotVaultService.ListShots"/>'s real timestamps.</summary>
    public sealed record ShotVaultRun(IReadOnlyList<ShotVaultItem> Shots)
    {
        /// <summary>Real shot count in this run — issue #2370's "counts" text.</summary>
        public int Count => Shots.Count;

        /// <summary>Newest timestamp in the run (Shots is already newest-first) — what the run's own
        /// row displays, and what runs are newest-first-sorted by.</summary>
        public DateTime NewestUtc => Shots[0].CreatedAtUtc;

        /// <summary>Oldest timestamp in the run — only differs from <see cref="NewestUtc"/> when the
        /// run actually has more than one shot.</summary>
        public DateTime OldestUtc => Shots[^1].CreatedAtUtc;
    }

    /// <summary>Git #2371 (Feature #2367 item 4) — a real shot plus whether it visually differs from
    /// the shot immediately before it in time. "Before it" means chronologically previous on disk —
    /// the only real ordering that exists, independent of which run (#2370) it happens to fall in.
    /// Git #2374 (Feature #2367 item 7) adds <see cref="HasDiffFromBaseline"/>: null when no baseline
    /// shot is currently pinned (the panel's original chronological-only behavior, unchanged), or the
    /// real computed diff against that one pinned shot when it is. The pinned baseline shot itself
    /// always compares as <c>false</c> — it cannot differ from itself.</summary>
    public sealed record ShotVaultTile(ShotVaultItem Shot, bool HasDiffFromPrevious, bool? HasDiffFromBaseline = null);

    /// <summary>Git #2369 (Feature #2367 item 2) — the real, derived tag set for one shot. There is
    /// still no manual tag store (real audit — see <see cref="ShotVaultItem"/>'s own doc-comment), so
    /// every tag here is computed straight off data the shot already really carries: its own real
    /// capture screen (#2368), its own real capture timestamp, its own real decoded pixel dimensions,
    /// and (when known) whether it diffs from the shot before it (#2371). Nothing here is a fixture
    /// label or a guessed taxonomy — a shot with no decodable image still gets its screen/date tags,
    /// just no resolution tag.</summary>
    public sealed record ShotVaultTag(string Label, string Kind);

    /// <summary>Git #2372 (Feature #2367 item 5) — reads the real shots <see
    /// cref="DesktopScreenClipService"/> already saves to disk, and copies one back to the clipboard.
    /// Git #2370 (Feature #2367 item 3) adds real run grouping on top of that same list. Git #2371
    /// (Feature #2367 item 4) adds the real DIFF computation below. Git #2368 (Feature #2367 item 1)
    /// adds real search by shot name or screen (<see cref="MatchesQuery"/>). Git #2369 (Feature #2367
    /// item 2) adds real, derived tag computation (<see cref="GetTags"/>) on top of the same tiles.</summary>
    public static class ShotVaultService
    {
        /// <summary>Gap between two consecutive shots (by real file timestamp) beyond which they're
        /// no longer the same capture session and start a new run. There's no persisted "run" concept
        /// to read this from (real audit — see <see cref="ShotVaultRun"/>'s own doc-comment), so this
        /// is a deliberate, named threshold rather than a magic number buried in <see cref="ListRuns()"/>.</summary>
        public static readonly TimeSpan RunGap = TimeSpan.FromMinutes(5);

        /// <summary>Git #2368 — matches the <c>_screen&lt;N&gt;</c> tag <see
        /// cref="DesktopScreenClipService"/> now writes into the filename at capture time (real
        /// monitor identity, not a fabricated label), tolerating the existing collision-counter suffix
        /// (e.g. <c>screenclip_..._screen2_1.png</c>).</summary>
        private static readonly Regex ScreenTagPattern = new(@"_screen(\d+)(?:_\d+)?\.png$", RegexOptions.IgnoreCase);

        /// <summary>Same folder <see cref="DesktopScreenClipService.Capture"/> saves into — one real
        /// source, not a second path someone has to keep in sync.</summary>
        public static string ShotsDirectory => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Screenshots", "ShaneBuilder");

        /// <summary>Every real shot on disk, newest-first. Returns an empty list — never a fabricated
        /// row — if the folder doesn't exist yet (nothing captured).</summary>
        public static IReadOnlyList<ShotVaultItem> ListShots()
        {
            string dir = ShotsDirectory;
            if (!Directory.Exists(dir))
                return Array.Empty<ShotVaultItem>();

            return Directory.EnumerateFiles(dir, "*.png", SearchOption.TopDirectoryOnly)
                .Select(path =>
                {
                    string name = Path.GetFileName(path);
                    var m = ScreenTagPattern.Match(name);
                    // A shot captured before Git #2368 (or one dropped in by hand) carries no screen
                    // tag — "Unknown" is an honest label, not a guessed monitor number.
                    string screen = m.Success ? $"Screen {m.Groups[1].Value}" : "Unknown";
                    return new ShotVaultItem(path, name, File.GetLastWriteTimeUtc(path), screen);
                })
                .OrderByDescending(shot => shot.CreatedAtUtc)
                .ToList();
        }

        /// <summary>Git #2370's real "runs newest-first with timestamps and counts": groups
        /// <see cref="ListShots"/>'s real, newest-first shots into runs by <see cref="RunGap"/>, then
        /// returns those runs newest-run-first. Each run carries its own real shot list (also
        /// newest-first) rather than a synthesized average or a fabricated label.</summary>
        public static IReadOnlyList<ShotVaultRun> ListRuns() => ListRuns(ListShots());

        /// <summary>Git #2368 — same real run-grouping, over a caller-supplied shot list (already
        /// newest-first) rather than always re-reading disk. Lets the search filter below re-group its
        /// own already-filtered subset without duplicating the gap logic.</summary>
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

        /// <summary>Git #2368's real "search by shot name or screen": a case-insensitive substring
        /// match against the shot's actual filename or its real, capture-time <see
        /// cref="ShotVaultItem.Screen"/> label — never a fuzzy/ranked match invented for this, and
        /// never against fabricated metadata.</summary>
        public static bool MatchesQuery(ShotVaultItem shot, string query) =>
            shot.FileName.Contains(query, StringComparison.OrdinalIgnoreCase) ||
            shot.Screen.Contains(query, StringComparison.OrdinalIgnoreCase);

        /// <summary>The real per-shot Copy action this issue delivers: put that exact shot's PNG back
        /// on the clipboard.</summary>
        public static void CopyToClipboard(ShotVaultItem shot) => DesktopScreenClipService.CopyFileToClipboard(shot.FilePath);

        /// <summary>Git #2371 — pairs each shot with a real, computed DIFF flag: does its pixel content
        /// differ from the shot immediately before it (the next-older entry in <paramref
        /// name="shotsNewestFirst"/>)? Computed from a small downsampled MD5 of each image's actual
        /// pixels, never a fixture or a guess. The oldest shot has no older neighbor to diff against
        /// and always comes back with <see cref="ShotVaultTile.HasDiffFromPrevious"/> false. A shot
        /// that fails to decode is treated as "not different" rather than badged on a guess.
        /// Git #2374 — when <paramref name="baselineFilePath"/> is supplied (a real shot the panel
        /// pinned via "Set as baseline"), also computes <see cref="ShotVaultTile.HasDiffFromBaseline"/>
        /// for every shot against that one pinned image's own real hash, reusing the same per-shot hash
        /// already being computed for the chronological chain rather than a second decode pass. Left
        /// null (not false) when no baseline is pinned, or when either image fails to decode — an
        /// honest "unknown", never a guessed "same".</summary>
        public static IReadOnlyList<ShotVaultTile> BuildTiles(IReadOnlyList<ShotVaultItem> shotsNewestFirst, string? baselineFilePath = null)
        {
            string? baselineHash = baselineFilePath is not null ? TryComputeVisualHash(baselineFilePath) : null;

            var tiles = new List<ShotVaultTile>(shotsNewestFirst.Count);
            string? previousHash = null; // hash of the next-newer shot already visited, i.e. this shot's "after"

            // shotsNewestFirst is newest → oldest. Walk oldest → newest so each shot compares against
            // the one that came right before it in real time.
            for (int i = shotsNewestFirst.Count - 1; i >= 0; i--)
            {
                var shot = shotsNewestFirst[i];
                string? hash = TryComputeVisualHash(shot.FilePath);
                bool diffs = previousHash is not null && hash is not null && hash != previousHash;
                bool? diffsFromBaseline = baselineFilePath is null
                    ? null
                    : hash is not null && baselineHash is not null ? hash != baselineHash : null;
                tiles.Add(new ShotVaultTile(shot, diffs, diffsFromBaseline));
                previousHash = hash ?? previousHash; // an undecodable shot doesn't reset the chain
            }

            tiles.Reverse(); // back to newest-first, matching the input order
            return tiles;
        }

        /// <summary>Git #2374 (Feature #2367 item 7) — the real retention purge: permanently deletes
        /// shot files older than <paramref name="maxAgeDays"/>, by the same real file timestamp <see
        /// cref="ListShots"/> already reads. There is no separate metadata/soft-delete row to mark —
        /// the file on disk IS the vault entry (see <see cref="ShotVaultItem"/>'s own doc-comment), so
        /// "retention" can only mean actually removing the file. <paramref name="maxAgeDays"/> &lt;= 0
        /// means "keep forever" (the historical, pre-#2374 behavior) and is a real no-op. A shot that
        /// fails to delete (locked/in-use) is skipped rather than throwing — the next purge picks it up.
        /// Returns the real shots actually deleted, so a caller can report an honest count rather than
        /// a guessed one.</summary>
        public static IReadOnlyList<ShotVaultItem> ApplyRetention(IReadOnlyList<ShotVaultItem> shotsNewestFirst, int maxAgeDays)
        {
            if (maxAgeDays <= 0) return Array.Empty<ShotVaultItem>();

            var cutoffUtc = DateTime.UtcNow - TimeSpan.FromDays(maxAgeDays);
            var deleted = new List<ShotVaultItem>();
            foreach (var shot in shotsNewestFirst)
            {
                if (shot.CreatedAtUtc >= cutoffUtc) continue;
                try
                {
                    File.Delete(shot.FilePath);
                    deleted.Add(shot);
                }
                catch { /* locked/in-use file right now — leave it, next purge picks it up */ }
            }
            return deleted;
        }

        /// <summary>Git #2369 — the real, derived tag set for one shot: its real capture <see
        /// cref="ShotVaultItem.Screen"/> (#2368), a date bucket off its own real
        /// <see cref="ShotVaultItem.CreatedAtUtc"/>, a resolution tag off its own real decoded pixel
        /// dimensions (when the file decodes), and a "Changed" tag when <paramref name="tile"/>
        /// already carries a real DIFF flag (#2371). Order is stable (screen, date, resolution, diff)
        /// so chip rendering doesn't reshuffle between panel refreshes.</summary>
        public static IReadOnlyList<ShotVaultTag> GetTags(ShotVaultTile tile)
        {
            var tags = new List<ShotVaultTag> { new(tile.Shot.Screen, "screen"), new(DateBucket(tile.Shot.CreatedAtUtc), "date") };

            var resolution = TryGetResolution(tile.Shot.FilePath);
            if (resolution is { } res)
                tags.Add(new ShotVaultTag($"{res.Width}×{res.Height}", "resolution"));

            if (tile.HasDiffFromPrevious)
                tags.Add(new ShotVaultTag("Changed", "diff"));

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
        /// size — the same honest-failure convention <see cref="TryComputeVisualHash"/> already uses.</summary>
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

        /// <summary>A cheap perceptual hash: decode the shot at a tiny fixed size (so two shots of
        /// different resolutions still compare, and decode cost stays trivial), convert to a fixed
        /// pixel format, and MD5 the raw bytes. Returns null on any decode failure (corrupt file, or a
        /// capture still mid-write) rather than throwing — a shot Vault build must never crash on one
        /// bad file.</summary>
        private static string? TryComputeVisualHash(string filePath)
        {
            try
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.DecodePixelWidth = 24;
                bmp.UriSource = new Uri(filePath, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();

                var converted = new FormatConvertedBitmap(bmp, PixelFormats.Bgr24, null, 0);
                int stride = converted.PixelWidth * 3;
                var pixels = new byte[Math.Max(stride, 1) * Math.Max(converted.PixelHeight, 1)];
                converted.CopyPixels(pixels, stride, 0);

                using var md5 = MD5.Create();
                return Convert.ToHexString(md5.ComputeHash(pixels));
            }
            catch
            {
                return null;
            }
        }
    }
}
