using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1472 — screenshot capture for the Visual Test Tracker floaty. Two capture
    /// types, both via CoreWebView2.CapturePreviewAsync (rendered-content capture
    /// straight from the browser process, no OS-level Print-Screen/compositor
    /// capture) — this is the direct fix for the "freezes his machine" problem the
    /// issue describes:
    ///   - Full page: resize the WebView2 to the page's real scrollHeight before
    ///     capturing, then restore — same technique UiTestExecutor.CaptureScreenshotAsync
    ///     (Git #966) already uses for automated-test full-page shots.
    ///   - Region: capture the current viewport, then crop to the caller-supplied
    ///     rectangle (drawn by VisualTestTrackerWindow's overlay) via CroppedBitmap —
    ///     in-box WPF imaging, no extra NuGet (same approach as ScreenshotBaselineStore).
    ///
    /// Standing rule (per the issue): if CapturePreviewAsync fails or a region crop
    /// can't get a clean capture, this returns a failed CaptureResult with no file
    /// written — callers must show an honest failure state, never save a blank/corrupt
    /// image and let the gallery imply something was captured when it wasn't.
    /// </summary>
    public static class VisualTestTrackerCapture
    {
        public const string Channel = VisualTestTrackerStore.Channel;

        private const int CaptureTimeoutMs = 15000;
        private const int FullPageResizeSettleMs = 150;
        private const int FullPageHeightQueryTimeoutMs = 4000;

        public sealed class CaptureResult
        {
            public bool Success;
            public string FilePath = "";
            public string Error = "";
        }

        /// <summary>Absolute on-disk directory for one page's screenshots, organized by app (sanitized
        /// base URL) then route (sanitized page path), under %AppData%\BuildConsole\visual-test-screenshots.</summary>
        public static string DirectoryFor(string baseUrl, string pagePath)
        {
            var root = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "BuildConsole", "visual-test-screenshots", Sanitize(baseUrl), Sanitize(pagePath));
            return root;
        }

        /// <summary>Captures the WebView2's full scrollable page height as a PNG. Never throws — a failure
        /// (timeout, WebView2 not renderable, IO error) comes back as Success=false with Error set.</summary>
        public static async Task<CaptureResult> CaptureFullPageAsync(WebView2 webView, string baseUrl, string pagePath)
        {
            if (webView?.CoreWebView2 == null)
                return Fail("WebView2 not ready — no page loaded to capture.");

            double? originalHeight = null;
            FileStream? stream = null;
            string path = BuildFilePath(baseUrl, pagePath);
            try
            {
                int? fullHeight = await GetFullPageHeightAsync(webView);
                if (fullHeight.HasValue)
                {
                    originalHeight = webView.Height;
                    webView.Height = fullHeight.Value;
                    await Task.Delay(FullPageResizeSettleMs);
                }

                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                stream = new FileStream(path, FileMode.Create, FileAccess.Write);
                var captureTask = webView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                var completed = await Task.WhenAny(captureTask, Task.Delay(CaptureTimeoutMs));
                if (completed != captureTask)
                {
                    var localStream = stream;
                    stream = null; // continuation owns disposal
                    _ = captureTask.ContinueWith(t => { _ = t.Exception; localStream.Dispose(); }, TaskScheduler.Default);
                    ActivityLog.Log(Channel, $"Full-page capture timed out after {CaptureTimeoutMs}ms for {baseUrl}{pagePath}.");
                    TryDelete(path);
                    return Fail($"Capture timed out after {CaptureTimeoutMs / 1000}s — WebView2 likely not in a renderable state.");
                }
                await captureTask; // observe/throw any capture exception
                stream.Dispose();
                stream = null;

                ActivityLog.Log(Channel, $"Full-page capture OK: {baseUrl}{pagePath} -> {path}");
                return new CaptureResult { Success = true, FilePath = path };
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Full-page capture FAILED for {baseUrl}{pagePath}: {ex.Message}");
                TryDelete(path);
                return Fail($"Capture failed: {ex.Message}");
            }
            finally
            {
                stream?.Dispose();
                if (originalHeight.HasValue) webView.Height = originalHeight.Value;
            }
        }

        /// <summary>Captures the current viewport, then crops to <paramref name="regionDeviceRect"/> (in
        /// device pixels relative to the WebView2's rendered surface). Fails honestly (no file written) if
        /// the crop rectangle is empty/out of bounds or the capture itself fails.</summary>
        public static async Task<CaptureResult> CaptureRegionAsync(WebView2 webView, string baseUrl, string pagePath, Int32Rect regionDeviceRect)
        {
            if (webView?.CoreWebView2 == null)
                return Fail("WebView2 not ready — no page loaded to capture.");
            if (regionDeviceRect.Width <= 0 || regionDeviceRect.Height <= 0)
                return Fail("Selected region is empty — draw a box before capturing.");

            using var mem = new MemoryStream();
            try
            {
                var captureTask = webView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, mem);
                var completed = await Task.WhenAny(captureTask, Task.Delay(CaptureTimeoutMs));
                if (completed != captureTask)
                {
                    ActivityLog.Log(Channel, $"Region capture timed out after {CaptureTimeoutMs}ms for {baseUrl}{pagePath}.");
                    return Fail($"Capture timed out after {CaptureTimeoutMs / 1000}s — WebView2 likely not in a renderable state.");
                }
                await captureTask;
                mem.Position = 0;

                var full = new BitmapImage();
                full.BeginInit();
                full.CacheOption = BitmapCacheOption.OnLoad;
                full.StreamSource = mem;
                full.EndInit();
                full.Freeze();

                var clamped = ClampRect(regionDeviceRect, full.PixelWidth, full.PixelHeight);
                if (clamped.Width <= 0 || clamped.Height <= 0)
                    return Fail("Selected region falls outside the captured viewport — try again.");

                var cropped = new CroppedBitmap(full, clamped);
                string path = BuildFilePath(baseUrl, pagePath);
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                var encoder = new PngBitmapEncoder();
                encoder.Frames.Add(BitmapFrame.Create(cropped));
                using (var outStream = new FileStream(path, FileMode.Create, FileAccess.Write))
                    encoder.Save(outStream);

                ActivityLog.Log(Channel, $"Region capture OK: {baseUrl}{pagePath} rect={clamped} -> {path}");
                return new CaptureResult { Success = true, FilePath = path };
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Region capture FAILED for {baseUrl}{pagePath}: {ex.Message}");
                return Fail($"Capture failed: {ex.Message}");
            }
        }

        private static Int32Rect ClampRect(Int32Rect r, int maxW, int maxH)
        {
            int x = Math.Max(0, Math.Min(r.X, maxW));
            int y = Math.Max(0, Math.Min(r.Y, maxH));
            int w = Math.Max(0, Math.Min(r.Width, maxW - x));
            int h = Math.Max(0, Math.Min(r.Height, maxH - y));
            return new Int32Rect(x, y, w, h);
        }

        /// <summary>Same full-page-height detection UiTestExecutor uses (Git #966): the larger of
        /// document.body/documentElement scrollHeight. Returns null on timeout/error — caller falls back
        /// to capturing at the WebView2's current size.</summary>
        private static async Task<int?> GetFullPageHeightAsync(WebView2 webView)
        {
            const string script = @"
(function() {
    try {
        var body = document.body ? document.body.scrollHeight : 0;
        var html = document.documentElement ? document.documentElement.scrollHeight : 0;
        return Math.max(body, html);
    } catch (ex) { return 0; }
})();";
            try
            {
                var scriptTask = webView.ExecuteScriptAsync(script);
                var completed = await Task.WhenAny(scriptTask, Task.Delay(FullPageHeightQueryTimeoutMs));
                if (completed != scriptTask) return null;
                var raw = await scriptTask;
                if (int.TryParse(raw, out var height) && height > 0) return height;
                return null;
            }
            catch
            {
                return null;
            }
        }

        private static string BuildFilePath(string baseUrl, string pagePath)
        {
            var dir = DirectoryFor(baseUrl, pagePath);
            var stamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss-fff");
            return Path.Combine(dir, $"{stamp}.png");
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { /* best-effort cleanup of a failed capture */ }
        }

        private static CaptureResult Fail(string error) => new CaptureResult { Success = false, Error = error };

        private static string Sanitize(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return "_";
            var cleaned = s.Trim('/').Replace('/', '_').Replace('\\', '_').Replace(':', '_');
            foreach (var ch in Path.GetInvalidFileNameChars())
                cleaned = cleaned.Replace(ch, '_');
            return cleaned.Length == 0 ? "_" : cleaned;
        }
    }
}
