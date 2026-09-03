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

    /// <summary>Git #2372 (Feature #2367 item 5) — reads the real shots <see
    /// cref="DesktopScreenClipService"/> already saves to disk, and copies one back to the clipboard.
    /// Git #2370 (Feature #2367 item 3) adds real run grouping on top of that same list. Search
    /// (#2368), tags (#2369), and DIFF badges (#2371) are separate, real sibling sub-issues under
    /// Feature #2367, layered on top of this same list.</summary>
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
    }
}
