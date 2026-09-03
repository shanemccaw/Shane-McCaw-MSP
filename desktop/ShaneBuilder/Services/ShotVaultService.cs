using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace ShaneBuilder.Services
{
    /// <summary>Git #2372 (Feature #2367 item 5) — one real shot on disk. There is no metadata/tag/run
    /// store for Shot Vault yet (real audit: only <see cref="DesktopScreenClipService"/>'s manual clip
    /// exists, and it writes loose PNGs with no sidecar data) — a shot is therefore exactly the file
    /// itself, named/timestamped by <see cref="DesktopScreenClipService"/>'s own convention.</summary>
    public sealed record ShotVaultItem(string FilePath, string FileName, DateTime CreatedAtUtc);

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
    /// the shot immediately before it in time. There is still no tag/screen-name metadata (#2369 is a
    /// separate sibling issue), so "before it" means chronologically previous on disk — the only real
    /// ordering that exists today, independent of which run (#2370) it happens to fall in.</summary>
    public sealed record ShotVaultTile(ShotVaultItem Shot, bool HasDiffFromPrevious);

    /// <summary>Git #2372 (Feature #2367 item 5) — reads the real shots <see
    /// cref="DesktopScreenClipService"/> already saves to disk, and copies one back to the clipboard.
    /// Git #2370 (Feature #2367 item 3) adds real run grouping on top of that same list. Git #2371
    /// (Feature #2367 item 4) adds the real DIFF computation below. Search (#2368) and tags (#2369)
    /// are separate, real sibling sub-issues under Feature #2367, layered on top of this same list.</summary>
    public static class ShotVaultService
    {
        /// <summary>Gap between two consecutive shots (by real file timestamp) beyond which they're
        /// no longer the same capture session and start a new run. There's no persisted "run" concept
        /// to read this from (real audit — see <see cref="ShotVaultRun"/>'s own doc-comment), so this
        /// is a deliberate, named threshold rather than a magic number buried in <see cref="ListRuns"/>.</summary>
        public static readonly TimeSpan RunGap = TimeSpan.FromMinutes(5);

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
                .Select(path => new ShotVaultItem(path, Path.GetFileName(path), File.GetLastWriteTimeUtc(path)))
                .OrderByDescending(shot => shot.CreatedAtUtc)
                .ToList();
        }

        /// <summary>Git #2370's real "runs newest-first with timestamps and counts": groups
        /// <see cref="ListShots"/>'s real, newest-first shots into runs by <see cref="RunGap"/>, then
        /// returns those runs newest-run-first. Each run carries its own real shot list (also
        /// newest-first) rather than a synthesized average or a fabricated label.</summary>
        public static IReadOnlyList<ShotVaultRun> ListRuns()
        {
            var shots = ListShots(); // already newest-first
            var runs = new List<ShotVaultRun>();
            var current = new List<ShotVaultItem>();

            foreach (var shot in shots)
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

        /// <summary>The real per-shot Copy action this issue delivers: put that exact shot's PNG back
        /// on the clipboard.</summary>
        public static void CopyToClipboard(ShotVaultItem shot) => DesktopScreenClipService.CopyFileToClipboard(shot.FilePath);

        /// <summary>Git #2371 — pairs each shot with a real, computed DIFF flag: does its pixel content
        /// differ from the shot immediately before it (the next-older entry in <paramref
        /// name="shotsNewestFirst"/>)? Computed from a small downsampled MD5 of each image's actual
        /// pixels, never a fixture or a guess. The oldest shot has no older neighbor to diff against
        /// and always comes back with <see cref="ShotVaultTile.HasDiffFromPrevious"/> false. A shot
        /// that fails to decode is treated as "not different" rather than badged on a guess.</summary>
        public static IReadOnlyList<ShotVaultTile> BuildTiles(IReadOnlyList<ShotVaultItem> shotsNewestFirst)
        {
            var tiles = new List<ShotVaultTile>(shotsNewestFirst.Count);
            string? previousHash = null; // hash of the next-newer shot already visited, i.e. this shot's "after"

            // shotsNewestFirst is newest → oldest. Walk oldest → newest so each shot compares against
            // the one that came right before it in real time.
            for (int i = shotsNewestFirst.Count - 1; i >= 0; i--)
            {
                var shot = shotsNewestFirst[i];
                string? hash = TryComputeVisualHash(shot.FilePath);
                bool diffs = previousHash is not null && hash is not null && hash != previousHash;
                tiles.Add(new ShotVaultTile(shot, diffs));
                previousHash = hash ?? previousHash; // an undecodable shot doesn't reset the chain
            }

            tiles.Reverse(); // back to newest-first, matching the input order
            return tiles;
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
