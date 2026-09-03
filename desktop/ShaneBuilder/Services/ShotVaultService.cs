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

    /// <summary>Git #2371 (Feature #2367 item 4) — a real shot plus whether it visually differs from
    /// the shot immediately before it in time. There is still no run/tag/screen-name metadata (#2369,
    /// #2370 are separate sibling issues), so "before it" means chronologically previous on disk —
    /// the only real ordering that exists today.</summary>
    public sealed record ShotVaultTile(ShotVaultItem Shot, bool HasDiffFromPrevious);

    /// <summary>Git #2372 (Feature #2367 item 5) — reads the real shots <see
    /// cref="DesktopScreenClipService"/> already saves to disk, and copies one back to the clipboard.
    /// No index, search, tags, or run grouping exists here — those are the separate, real sibling
    /// sub-issues #2368-#2370 under Feature #2367, layered on top of this same list. Git #2371 adds
    /// the real DIFF computation below.</summary>
    public static class ShotVaultService
    {
        /// <summary>Same folder <see cref="DesktopScreenClipService.Capture"/> saves into — one real
        /// source, not a second path someone has to keep in sync.</summary>
        public static string ShotsDirectory => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Screenshots", "ShaneBuilder");

        /// <summary>Every real shot on disk, newest-first (issue #2370's "runs newest-first with
        /// timestamps" text, at the single-shot granularity this issue actually needs). Returns an
        /// empty list — never a fabricated row — if the folder doesn't exist yet (nothing captured).</summary>
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
