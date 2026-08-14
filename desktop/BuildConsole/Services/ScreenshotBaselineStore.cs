using System;
using System.Collections.Generic;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace BuildConsole.Services
{
    /// <summary>
    /// Epic #803 — persistent visual BASELINE storage + similarity comparison for the WebView2
    /// screenshots #966 captures. This is the "source of truth" half of the screenshot-review
    /// feature: on Shane's first Approve of a run's screenshots (see ScreenshotReviewService),
    /// they are promoted to test-results/baselines/{area}/{slug}/{stepIndex}.png; every later run
    /// then diffs its fresh captures against those baselines so a meaningful visual change surfaces
    /// for review instead of slipping by. A baseline is only ever overwritten by an explicit
    /// re-approval — never silently.
    ///
    /// Deliberately NOT exact-pixel matching (which #966 explicitly rejected as too fragile against
    /// font rendering / anti-aliasing / live data): each image is rendered down to a small grid and
    /// compared by mean per-channel difference against a tolerance threshold, so sub-pixel /
    /// anti-aliasing noise averages away while real layout / content changes still register. The grid's
    /// width is fixed but its height scales with the image's real aspect ratio, so a tall full-page
    /// capture is compared at a proportionally taller resolution instead of being crushed into a square
    /// that would average localized text changes out of existence (a full-page false-negative risk).
    /// All imaging is in-box WPF (System.Windows.Media.Imaging + RenderTargetBitmap) so nothing new
    /// has to be restored from NuGet (the build-time package proxy can't fetch new packages here).
    ///
    /// The baseline set lives under test-results/ which is .gitignore'd — baselines are Shane's local
    /// source of truth across runs, exactly like the run screenshots #966 writes; they are never
    /// swept into a commit.
    ///
    /// Logs on the "testing.baseline" channel via ActivityLog (this app's logger.child({channel})
    /// equivalent — there is no Node logger in this WPF process; see the sibling
    /// "testing.screenshot"/"testing.screenshot-review" channels).
    /// </summary>
    public static class ScreenshotBaselineStore
    {
        public const string Channel = "testing.baseline";

        /// <summary>Horizontal resolution every screenshot is normalized to before comparison. Small
        /// enough that font anti-aliasing / a 1px reflow averages out, large enough that a real layout
        /// or content change moves enough cells to clear the threshold. The VERTICAL resolution is no
        /// longer fixed to this — it scales with the image's real aspect ratio (see <see cref="Compare"/>),
        /// so a tall full-page capture isn't crushed into a square that averages localized text changes
        /// away. A roughly-square viewport screenshot still normalizes to CompareWidth×CompareWidth,
        /// exactly as the old fixed 64×64 grid did.</summary>
        private const int CompareWidth = 64;

        /// <summary>Floor for the computed comparison-grid height (a square/short image never goes below
        /// this — keeps the old 64×64 behaviour for viewport shots).</summary>
        private const int MinCompareHeight = 64;

        /// <summary>Ceiling for the computed comparison-grid height. Caps the pixel buffer for an
        /// extremely long page (64×2048 Bgra32 ≈ 512 KB) while still giving a full-page capture far more
        /// vertical signal than the old 64 rows. 2048 rows ≈ ~32× the old vertical resolution.</summary>
        private const int MaxCompareHeight = 2048;

        /// <summary>Mean per-channel difference (0..1) above which two screenshots count as a
        /// MEANINGFUL visual diff worth Shane's review. ~6% tolerates rendering noise / minor live-data
        /// churn but catches genuine changes. A similarity threshold, not exact-pixel, by design.</summary>
        public const double MeaningfulDiffThreshold = 0.06;

        public static string BaselineRoot(string repoRoot) =>
            Path.Combine(repoRoot, "test-results", "baselines");

        public static string BaselineDir(string repoRoot, string area, string slug) =>
            Path.Combine(BaselineRoot(repoRoot), Sanitize(area), Sanitize(slug));

        public static string BaselinePath(string repoRoot, string area, string slug, int stepIndex) =>
            Path.Combine(BaselineDir(repoRoot, area, slug), $"{stepIndex}.png");

        /// <summary>The outcome of comparing one freshly-captured screenshot against its stored baseline.</summary>
        public sealed class Comparison
        {
            public bool HasBaseline;
            public string BaselinePath = "";
            /// <summary>0..1 mean per-channel difference; 0 = identical. Only meaningful when HasBaseline.</summary>
            public double DiffRatio;
            /// <summary>1 - DiffRatio, for human-readable display.</summary>
            public double Similarity => 1.0 - DiffRatio;
            /// <summary>True when no baseline exists yet (always needs review), the diff exceeds the
            /// threshold, or the compare itself errored (surfaced, never silently passed).</summary>
            public bool NeedsReview;
            public string Note = "";
        }

        /// <summary>Compares one freshly-captured screenshot against its stored baseline. A missing
        /// baseline always NeedsReview (first capture is the source of truth to approve). A comparison
        /// error is surfaced as NeedsReview rather than silently passing. Must be called on the UI/STA
        /// thread — RenderTargetBitmap needs a Dispatcher (the whole manifest run is UI-thread already).</summary>
        public static Comparison Compare(string repoRoot, string area, string slug, int stepIndex, string capturedPath)
        {
            string baselinePath = BaselinePath(repoRoot, area, slug, stepIndex);
            var c = new Comparison { BaselinePath = baselinePath };

            // Diagnostic trace (task: make a "why did it re-prompt?" recurrence diagnosable from the log
            // alone). Logs the EXACT read-side inputs — repoRoot, the sanitized area/slug actually used to
            // build the path, stepIndex — and the fully-resolved baseline path, so a read-vs-write path
            // drift (or a per-run area/slug drift from a changed SourcePath) is visible without a debugger.
            // This must mirror, key-for-key, what Promote logs on the write side.
            if (!File.Exists(baselinePath))
            {
                c.HasBaseline = false;
                c.NeedsReview = true;
                c.Note = "no baseline yet — first capture (approve to set it)";
                ActivityLog.Log(Channel,
                    $"Compare[read] repoRoot='{repoRoot}' area='{Sanitize(area)}' slug='{Sanitize(slug)}' step={stepIndex} "
                    + $"baseline='{baselinePath}' EXISTS=false → NO BASELINE, review (first capture).");
                return c;
            }
            c.HasBaseline = true;

            // Compare grid: width is fixed (CompareWidth); height scales with the taller of the two
            // images' real aspect ratio, so a tall full-page capture is compared at a proportionally
            // taller resolution instead of being crushed into a square that averages localized text
            // changes away (the false-negative risk Shane raised). Both images are then rendered to the
            // SAME grid — the compare stays resolution-independent, exactly as the old fixed grid was.
            int gridW = CompareWidth;
            int gridH = ComputeGridHeight(baselinePath, capturedPath);
            try
            {
                byte[] a = Normalize(baselinePath, gridW, gridH);
                byte[] b = Normalize(capturedPath, gridW, gridH);
                c.DiffRatio = MeanDiff(a, b);
                c.NeedsReview = c.DiffRatio > MeaningfulDiffThreshold;
                c.Note = c.NeedsReview
                    ? $"differs {c.DiffRatio * 100:0.0}% from baseline (> {MeaningfulDiffThreshold * 100:0.#}% tolerance) — review"
                    : $"matches baseline ({c.DiffRatio * 100:0.0}% diff, within tolerance)";
            }
            catch (Exception ex)
            {
                c.NeedsReview = true;
                c.Note = $"couldn't compare against baseline: {ex.Message}";
            }
            // Log the REAL comparison grid actually used for this screenshot (task: verifiable/tunable
            // from the log alone, without re-reading code) — so a full-page shot showing e.g. grid=64x1180
            // vs a viewport shot's grid=64x64 is visible, and MaxCompareHeight clamping is diagnosable.
            ActivityLog.Log(Channel,
                $"Compare[read] repoRoot='{repoRoot}' area='{Sanitize(area)}' slug='{Sanitize(slug)}' step={stepIndex} "
                + $"baseline='{baselinePath}' EXISTS=true captured='{capturedPath}' grid={gridW}x{gridH} "
                + $"diff={c.DiffRatio * 100:0.0}% (thresh {MeaningfulDiffThreshold * 100:0.#}%) → {(c.NeedsReview ? "REVIEW" : "match, no review")}.");
            return c;
        }

        /// <summary>Promotes a run's captured screenshots to the persistent baseline set (overwriting
        /// any existing baseline for the same step). Only ever called on an explicit Approve — never
        /// silently. Returns the number of baseline files written. Logs each on "testing.baseline".</summary>
        public static int Promote(string repoRoot, string area, string slug, IEnumerable<UiScreenshotCapture> shots)
        {
            string dir = BaselineDir(repoRoot, area, slug);
            Directory.CreateDirectory(dir);

            // Diagnostic trace (task): log the EXACT write-side inputs up front — repoRoot, the sanitized
            // area/slug actually used, and the resolved baseline dir — so this line can be diffed against
            // Compare[read]'s line for the SAME (area, slug) on a later run. If a run re-prompts despite a
            // prior approve, the two lines' repoRoot/area/slug/dir must be identical; any difference here is
            // the bug. (Confirmed identical in this task via byte-identical baseline↔promoted-run MD5s.)
            var shotList = shots as ICollection<UiScreenshotCapture> ?? new List<UiScreenshotCapture>(shots);
            ActivityLog.Log(Channel,
                $"Promote[write] repoRoot='{repoRoot}' area='{Sanitize(area)}' slug='{Sanitize(slug)}' dir='{dir}' "
                + $"— {shotList.Count} candidate shot(s).");

            int written = 0;
            foreach (var shot in shotList)
            {
                if (string.IsNullOrEmpty(shot.FilePath) || !File.Exists(shot.FilePath))
                {
                    // Previously a silent `continue` — log it so a promote that writes fewer files than
                    // expected (or zero) is never a mystery.
                    ActivityLog.Log(Channel,
                        $"Promote[write] SKIP step {shot.StepIndex} ({shot.Reason}) — source screenshot missing: '{shot.FilePath}'.");
                    continue;
                }
                string dest = BaselinePath(repoRoot, area, slug, shot.StepIndex);
                try
                {
                    File.Copy(shot.FilePath, dest, overwrite: true);
                    written++;
                    ActivityLog.Log(Channel, $"Baseline set: dest='{dest}' <- step {shot.StepIndex} ({shot.Reason}) src='{shot.FilePath}'.");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(Channel, $"Couldn't write baseline dest='{dest}': {ex.Message}");
                }
            }
            ActivityLog.Log(Channel, $"Promoted {written} screenshot(s) to baseline for {Sanitize(area)}/{Sanitize(slug)} (dir='{dir}').");
            return written;
        }

        // ── image normalization + compare (in-box WPF imaging; no extra NuGet) ──

        /// <summary>Picks the comparison-grid HEIGHT for a pair of images: CompareWidth scaled by the
        /// LARGER of the two images' height/width aspect ratios (so neither a tall baseline nor a tall
        /// capture loses vertical signal), clamped to [MinCompareHeight, MaxCompareHeight]. A
        /// roughly-square pair yields ≈CompareWidth (the old 64×64 behaviour); a full-page capture (say
        /// 1280×25600) yields the full MaxCompareHeight so localized text changes aren't averaged out.
        /// Falls back to MinCompareHeight if neither image's dimensions can be read.</summary>
        private static int ComputeGridHeight(string baselinePath, string capturedPath)
        {
            double aspect = 1.0; // Max() floor → a square/wide image never drops below CompareWidth rows.
            aspect = Math.Max(aspect, AspectHeightOverWidth(baselinePath));
            aspect = Math.Max(aspect, AspectHeightOverWidth(capturedPath));
            int h = (int)Math.Round(CompareWidth * aspect);
            return Math.Max(MinCompareHeight, Math.Min(MaxCompareHeight, h));
        }

        /// <summary>height/width of the PNG at <paramref name="path"/>, or 0 if it can't be read (so it
        /// contributes nothing to the Max() in <see cref="ComputeGridHeight"/>).</summary>
        private static double AspectHeightOverWidth(string path)
        {
            try
            {
                if (string.IsNullOrEmpty(path) || !File.Exists(path)) return 0;
                // BitmapFrame.Create reads just the header/metadata (PixelWidth/PixelHeight) without
                // decoding the full raster — cheap even for a very large full-page PNG.
                var frame = BitmapFrame.Create(new Uri(path, UriKind.Absolute),
                    BitmapCreateOptions.DelayCreation, BitmapCacheOption.None);
                if (frame.PixelWidth <= 0 || frame.PixelHeight <= 0) return 0;
                return (double)frame.PixelHeight / frame.PixelWidth;
            }
            catch
            {
                return 0;
            }
        }

        /// <summary>Loads a PNG and renders it into a gridWidth×gridHeight Bgra32 grid, then returns its
        /// raw pixels. Rendering both sides to the identical grid is what makes the compare robust to
        /// anti-aliasing / a 1px reflow and independent of the two images' original resolutions (both
        /// sides get the same resample, so any distortion is shared and cancels out). The grid is now
        /// aspect-scaled (see <see cref="ComputeGridHeight"/>) rather than a fixed square.</summary>
        private static byte[] Normalize(string path, int gridWidth, int gridHeight)
        {
            var src = new BitmapImage();
            src.BeginInit();
            src.CacheOption = BitmapCacheOption.OnLoad;          // release the file handle immediately
            src.CreateOptions = BitmapCreateOptions.IgnoreImageCache;
            src.UriSource = new Uri(path, UriKind.Absolute);
            src.EndInit();
            src.Freeze();

            var visual = new DrawingVisual();
            using (var dc = visual.RenderOpen())
                dc.DrawImage(src, new Rect(0, 0, gridWidth, gridHeight));

            var rtb = new RenderTargetBitmap(gridWidth, gridHeight, 96, 96, PixelFormats.Pbgra32);
            rtb.Render(visual);

            var converted = new FormatConvertedBitmap(rtb, PixelFormats.Bgra32, null, 0);
            int stride = gridWidth * 4;
            byte[] px = new byte[stride * gridHeight];
            converted.CopyPixels(px, stride, 0);
            return px;
        }

        /// <summary>Mean absolute per-channel difference of two equal-length pixel buffers, normalized
        /// to 0..1. Both buffers are rendered to the same computed grid, so their lengths always match.</summary>
        private static double MeanDiff(byte[] a, byte[] b)
        {
            int n = Math.Min(a.Length, b.Length);
            if (n == 0) return 1.0;
            long sum = 0;
            for (int i = 0; i < n; i++) sum += Math.Abs(a[i] - b[i]);
            return sum / (double)(n * 255.0);
        }

        private static string Sanitize(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return "_";
            foreach (var ch in Path.GetInvalidFileNameChars())
                s = s.Replace(ch, '_');
            return s;
        }
    }
}
