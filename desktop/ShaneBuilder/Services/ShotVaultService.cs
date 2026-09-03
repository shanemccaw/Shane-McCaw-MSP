using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace ShaneBuilder.Services
{
    /// <summary>Git #2372 (Feature #2367 item 5) — one real shot on disk. There is no metadata/tag/run
    /// store for Shot Vault yet (real audit: only <see cref="DesktopScreenClipService"/>'s manual clip
    /// exists, and it writes loose PNGs with no sidecar data) — a shot is therefore exactly the file
    /// itself, named/timestamped by <see cref="DesktopScreenClipService"/>'s own convention.</summary>
    public sealed record ShotVaultItem(string FilePath, string FileName, DateTime CreatedAtUtc);

    /// <summary>Git #2372 (Feature #2367 item 5) — reads the real shots <see
    /// cref="DesktopScreenClipService"/> already saves to disk, and copies one back to the clipboard.
    /// No index, search, tags, run grouping, or DIFF-vs-baseline exists here — those are the separate,
    /// real sibling sub-issues #2368-#2371 under Feature #2367, layered on top of this same list.</summary>
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
    }
}
