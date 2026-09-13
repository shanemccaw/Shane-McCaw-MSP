using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace BuildConsole.Services
{
    /// <summary>
    /// Visual Diffing service for comparing screenshots across builds, test sessions, and baselines.
    /// Computes pixel differences, similarity percentage, bounding boxes, difference heatmaps,
    /// and side-by-side comparison composites using in-box WPF imaging.
    /// </summary>
    public static class VisualDiffService
    {
        public const double DefaultTolerance = 0.05; // 5% per-channel threshold to absorb anti-aliasing

        public sealed class VisualDiffResult
        {
            public bool Success { get; set; }
            public string Error { get; set; } = "";
            public int Width { get; set; }
            public int Height { get; set; }
            public int TotalPixels { get; set; }
            public int MismatchedPixels { get; set; }
            public double DiffRatio { get; set; } // 0.0 to 1.0
            public double DiffPercentage => Math.Round(DiffRatio * 100.0, 2);
            public double SimilarityPercentage => Math.Round((1.0 - DiffRatio) * 100.0, 2);
            public Rect BoundingBox { get; set; } = Rect.Empty;
            public BitmapSource? BaselineImage { get; set; }
            public BitmapSource? CurrentImage { get; set; }
            public BitmapSource? DiffMapImage { get; set; }
            public BitmapSource? SideBySideImage { get; set; }
            public string BaselinePath { get; set; } = "";
            public string CurrentPath { get; set; } = "";
            public string DiffMapSavedPath { get; set; } = "";
            public string Summary { get; set; } = "";
        }

        /// <summary>
        /// Compares two screenshot files pixel-by-pixel, producing diff metrics, a difference heatmap,
        /// and a side-by-side composite.
        /// </summary>
        public static VisualDiffResult Compare(string baselinePath, string currentPath, double tolerance = DefaultTolerance)
        {
            var result = new VisualDiffResult
            {
                BaselinePath = baselinePath,
                CurrentPath = currentPath
            };

            if (!File.Exists(baselinePath))
            {
                result.Error = $"Baseline image does not exist: {baselinePath}";
                return result;
            }

            if (!File.Exists(currentPath))
            {
                result.Error = $"Current image does not exist: {currentPath}";
                return result;
            }

            try
            {
                var baseBmp = LoadNormalizedBitmap(baselinePath);
                var currBmp = LoadNormalizedBitmap(currentPath);

                if (baseBmp == null || currBmp == null)
                {
                    result.Error = "Failed to load one or both images for comparison.";
                    return result;
                }

                int width = Math.Max(baseBmp.PixelWidth, currBmp.PixelWidth);
                int height = Math.Max(baseBmp.PixelHeight, currBmp.PixelHeight);

                // Render both onto equal-sized surfaces if sizes differ
                var normalizedBase = EnsureCanvasSize(baseBmp, width, height);
                var normalizedCurr = EnsureCanvasSize(currBmp, width, height);

                result.Width = width;
                result.Height = height;
                result.TotalPixels = width * height;
                result.BaselineImage = normalizedBase;
                result.CurrentImage = normalizedCurr;

                int stride = width * 4;
                byte[] basePixels = new byte[stride * height];
                byte[] currPixels = new byte[stride * height];
                byte[] diffPixels = new byte[stride * height];

                normalizedBase.CopyPixels(basePixels, stride, 0);
                normalizedCurr.CopyPixels(currPixels, stride, 0);

                int mismatchedCount = 0;
                int minX = int.MaxValue, minY = int.MaxValue;
                int maxX = int.MinValue, maxY = int.MinValue;

                for (int y = 0; y < height; y++)
                {
                    int rowOffset = y * stride;
                    for (int x = 0; x < width; x++)
                    {
                        int p = rowOffset + (x * 4);

                        byte b1 = basePixels[p];
                        byte g1 = basePixels[p + 1];
                        byte r1 = basePixels[p + 2];
                        byte a1 = basePixels[p + 3];

                        byte b2 = currPixels[p];
                        byte g2 = currPixels[p + 1];
                        byte r2 = currPixels[p + 2];
                        byte a2 = currPixels[p + 3];

                        double diffB = Math.Abs(b1 - b2) / 255.0;
                        double diffG = Math.Abs(g1 - g2) / 255.0;
                        double diffR = Math.Abs(r1 - r2) / 255.0;
                        double diffA = Math.Abs(a1 - a2) / 255.0;

                        double pixelDiff = (diffB + diffG + diffR + diffA) / 4.0;

                        if (pixelDiff > tolerance)
                        {
                            mismatchedCount++;
                            if (x < minX) minX = x;
                            if (x > maxX) maxX = x;
                            if (y < minY) minY = y;
                            if (y > maxY) maxY = y;

                            // Highlight changed pixel in bright neon magenta (#FF007F) with full alpha
                            diffPixels[p] = 127;     // Blue
                            diffPixels[p + 1] = 0;   // Green
                            diffPixels[p + 2] = 255; // Red
                            diffPixels[p + 3] = 255; // Alpha
                        }
                        else
                        {
                            // Dimmed grayscale context for unchanged pixels (30% intensity)
                            byte gray = (byte)((0.299 * r2 + 0.587 * g2 + 0.114 * b2) * 0.35);
                            diffPixels[p] = gray;
                            diffPixels[p + 1] = gray;
                            diffPixels[p + 2] = gray;
                            diffPixels[p + 3] = 220;
                        }
                    }
                }

                result.MismatchedPixels = mismatchedCount;
                result.DiffRatio = result.TotalPixels > 0 ? (double)mismatchedCount / result.TotalPixels : 0.0;

                if (mismatchedCount > 0 && minX <= maxX && minY <= maxY)
                {
                    result.BoundingBox = new Rect(minX, minY, maxX - minX + 1, maxY - minY + 1);
                }

                // Create DiffMap Bitmap
                var diffMap = new WriteableBitmap(width, height, 96, 96, PixelFormats.Bgra32, null);
                diffMap.WritePixels(new Int32Rect(0, 0, width, height), diffPixels, stride, 0);
                diffMap.Freeze();
                result.DiffMapImage = diffMap;

                // Create Side-By-Side composite
                result.SideBySideImage = CreateSideBySideComposite(normalizedBase, normalizedCurr, diffMap);

                // Save diff map to a cache file
                string cacheDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "BuildConsole", "visual-diff-cache");
                Directory.CreateDirectory(cacheDir);
                string diffFileName = $"diff_{DateTime.Now:yyyyMMdd_HHmmss}_{Guid.NewGuid().ToString("N")[..6]}.png";
                string diffFilePath = Path.Combine(cacheDir, diffFileName);
                SaveBitmapAsPng(diffMap, diffFilePath);
                result.DiffMapSavedPath = diffFilePath;

                result.Summary = $"Visual Diff: {result.DiffPercentage:F2}% difference ({result.MismatchedPixels:N0} of {result.TotalPixels:N0} px mismatched, {result.SimilarityPercentage:F2}% match).";
                result.Success = true;
            }
            catch (Exception ex)
            {
                result.Error = $"Diff calculation error: {ex.Message}";
                result.Success = false;
            }

            return result;
        }

        /// <summary>
        /// Creates a high-visibility side-by-side composite containing Baseline, Current, and Diff Map.
        /// </summary>
        public static BitmapSource CreateSideBySideComposite(BitmapSource baseline, BitmapSource current, BitmapSource diffMap)
        {
            int singleW = Math.Max(baseline.PixelWidth, current.PixelWidth);
            int singleH = Math.Max(baseline.PixelHeight, current.PixelHeight);

            // 3-column layout: Baseline | Current | Diff Map
            int totalW = singleW * 3 + 16;
            int totalH = singleH + 40; // 40px top bar for labels

            var dv = new DrawingVisual();
            using (var dc = dv.RenderOpen())
            {
                // Background
                dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(24, 24, 37)), null, new Rect(0, 0, totalW, totalH));

                var typeface = new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.SemiBold, FontStretches.Normal);

                // Labels
                var labelBase = new FormattedText("Baseline", System.Globalization.CultureInfo.InvariantCulture,
                    FlowDirection.LeftToRight, typeface, 14, Brushes.SkyBlue, 1.0);
                var labelCurr = new FormattedText("Current", System.Globalization.CultureInfo.InvariantCulture,
                    FlowDirection.LeftToRight, typeface, 14, Brushes.LightGreen, 1.0);
                var labelDiff = new FormattedText("Diff Map (Changed)", System.Globalization.CultureInfo.InvariantCulture,
                    FlowDirection.LeftToRight, typeface, 14, Brushes.Magenta, 1.0);

                dc.DrawText(labelBase, new Point(10, 10));
                dc.DrawText(labelCurr, new Point(singleW + 18, 10));
                dc.DrawText(labelDiff, new Point(singleW * 2 + 26, 10));

                // Images
                dc.DrawImage(baseline, new Rect(10, 35, singleW, singleH));
                dc.DrawImage(current, new Rect(singleW + 18, 35, singleW, singleH));
                dc.DrawImage(diffMap, new Rect(singleW * 2 + 26, 35, singleW, singleH));
            }

            var rtb = new RenderTargetBitmap(totalW, totalH, 96, 96, PixelFormats.Pbgra32);
            rtb.Render(dv);
            rtb.Freeze();
            return rtb;
        }

        /// <summary>
        /// Resolves the baseline directory and path for a given page URL.
        /// </summary>
        public static string GetBaselinePath(string pageUrl)
        {
            string sanitized = SanitizeUrl(pageUrl);
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string baselineDir = Path.Combine(appData, "BuildConsole", "visual-test-baselines", sanitized);
            return Path.Combine(baselineDir, "baseline.png");
        }

        public static bool HasBaseline(string pageUrl)
        {
            string path = GetBaselinePath(pageUrl);
            return File.Exists(path);
        }

        /// <summary>
        /// Saves or updates the baseline image for a given page URL.
        /// </summary>
        public static bool SaveBaseline(string pageUrl, string sourceImagePath)
        {
            if (!File.Exists(sourceImagePath)) return false;
            try
            {
                string targetPath = GetBaselinePath(pageUrl);
                Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
                File.Copy(sourceImagePath, targetPath, overwrite: true);
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Retrieves past screenshot files recorded for a given page path or URL.
        /// </summary>
        public static List<string> GetAvailableScreenshotsForPage(string pageUrl)
        {
            var list = new List<string>();
            try
            {
                string sanitized = SanitizeUrl(pageUrl);

                // Check baselines
                string baselinePath = GetBaselinePath(pageUrl);
                if (File.Exists(baselinePath)) list.Add(baselinePath);

                // Check visual-test-screenshots directory
                string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                string screenshotsRoot = Path.Combine(appData, "BuildConsole", "visual-test-screenshots");
                if (Directory.Exists(screenshotsRoot))
                {
                    var files = Directory.GetFiles(screenshotsRoot, "*.png", SearchOption.AllDirectories);
                    foreach (var f in files)
                    {
                        if (f.Contains(sanitized, StringComparison.OrdinalIgnoreCase) && !list.Contains(f))
                        {
                            list.Add(f);
                        }
                    }
                }
            }
            catch { }
            return list;
        }

        private static BitmapSource? LoadNormalizedBitmap(string path)
        {
            try
            {
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                var frame = BitmapFrame.Create(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
                if (frame.Format != PixelFormats.Bgra32)
                {
                    var converted = new FormatConvertedBitmap(frame, PixelFormats.Bgra32, null, 0);
                    converted.Freeze();
                    return converted;
                }
                frame.Freeze();
                return frame;
            }
            catch
            {
                return null;
            }
        }

        private static BitmapSource EnsureCanvasSize(BitmapSource source, int targetWidth, int targetHeight)
        {
            if (source.PixelWidth == targetWidth && source.PixelHeight == targetHeight)
                return source;

            var dv = new DrawingVisual();
            using (var dc = dv.RenderOpen())
            {
                dc.DrawRectangle(Brushes.Black, null, new Rect(0, 0, targetWidth, targetHeight));
                dc.DrawImage(source, new Rect(0, 0, source.PixelWidth, source.PixelHeight));
            }

            var rtb = new RenderTargetBitmap(targetWidth, targetHeight, 96, 96, PixelFormats.Pbgra32);
            rtb.Render(dv);
            rtb.Freeze();
            return rtb;
        }

        public static void SaveBitmapAsPng(BitmapSource bitmap, string targetPath)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
            using var fileStream = new FileStream(targetPath, FileMode.Create);
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(bitmap));
            encoder.Save(fileStream);
        }

        public static string SanitizeUrl(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "unknown_page";
            try
            {
                if (Uri.TryCreate(raw, UriKind.Absolute, out var uri))
                {
                    string combined = (uri.Host + uri.AbsolutePath).Trim('/');
                    return Regex.Replace(combined, @"[^a-zA-Z0-9_\-\.]", "_");
                }
            }
            catch { }
            return Regex.Replace(raw, @"[^a-zA-Z0-9_\-\.]", "_");
        }
    }
}
