using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows;
using System.Windows.Threading;
using WinFormsClipboard = System.Windows.Forms.Clipboard;
using WinFormsDataFormats = System.Windows.Forms.DataFormats;
using WinFormsDataObject = System.Windows.Forms.DataObject;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1866 — the desktop screen-clipping tool. Shane: "a screenshot clipping tool ...
    /// let me select in a box what I want to screen clip, and auto put it in my system
    /// clipboard, as well as save in ...\Pictures\Screenshots\BuildConsole." Fired from the
    /// title-bar icon and from the PrintScreen key.
    ///
    /// Flow: open <see cref="RegionSelectOverlayWindow"/> in full-virtual-screen desktop mode
    /// (spans every monitor), read the selection back in PHYSICAL pixels (see that window's
    /// docs on why that sidesteps the per-monitor-DPI trap), let the dim overlay actually leave
    /// the screen, then <c>Graphics.CopyFromScreen</c> that rect into a 24bpp <see cref="Bitmap"/>.
    /// The result goes to BOTH the clipboard (multi-format DataObject, anti-black) and disk
    /// (timestamped PNG). If one of those two sinks fails the other still stands and the failure
    /// is surfaced — never lose both silently.
    ///
    /// Must be called on the WPF UI (STA) thread — ShowDialog, CopyFromScreen and the OLE
    /// clipboard all require it.
    /// </summary>
    public static class DesktopScreenClipService
    {
        public const string Channel = "system.core";

        // Guard against a second capture starting while an overlay is already open (both the
        // title-bar icon and the two PrintScreen paths funnel through here).
        private static bool _overlayOpen;

        /// <summary>Run one capture: draw a region, then copy to clipboard + save to disk. Safe to call
        /// repeatedly. No-op (logged) if an overlay is already open.</summary>
        public static void Capture()
        {
            if (_overlayOpen)
            {
                ActivityLog.Log(Channel, "Screen clip ignored — a selection overlay is already open.");
                return;
            }

            Int32Rect rect;
            _overlayOpen = true;
            try
            {
                var overlay = new RegionSelectOverlayWindow();
                overlay.ConfigureForVirtualScreen();
                bool? drawn = overlay.ShowDialog();
                if (drawn != true)
                {
                    // Esc, or a too-small selection: nothing captured, nothing saved, clipboard untouched.
                    ActivityLog.Log(Channel, "Screen clip cancelled (Esc or too-small selection) — clipboard and disk untouched.");
                    return;
                }
                rect = overlay.SelectedPhysicalRect;
            }
            finally
            {
                _overlayOpen = false;
            }

            if (rect.Width <= 0 || rect.Height <= 0)
            {
                ActivityLog.Log(Channel, "Screen clip aborted — empty selection rectangle.");
                return;
            }

            // The overlay window is CLOSED (not merely Hidden) once ShowDialog returns, but the
            // compositor may not have presented the frame without the dim layer yet. Flush WPF's
            // pending renders and give DWM a beat before reading pixels — capturing the dimming
            // layer over the content is the classic bug here.
            SettleAfterOverlayClosed();

            Bitmap? bmp = null;
            try
            {
                // 24bpp (no alpha): CopyFromScreen never writes the alpha channel, so a 32bpp target
                // would leave alpha=0 and paste BLACK in classic apps. 24bpp sidesteps that entirely.
                bmp = new Bitmap(rect.Width, rect.Height, PixelFormat.Format24bppRgb);
                using (var g = Graphics.FromImage(bmp))
                {
                    g.CopyFromScreen(rect.X, rect.Y, 0, 0,
                        new System.Drawing.Size(rect.Width, rect.Height), CopyPixelOperation.SourceCopy);
                }

                string? savedPath = null, saveError = null, clipError = null;
                bool clipboardOk = false;

                try { savedPath = SaveToDisk(bmp); }
                catch (Exception ex)
                {
                    saveError = ex.Message;
                    ActivityLog.Log(Channel, $"Screen clip disk save FAILED: {ex.Message}");
                }

                try { CopyToClipboard(bmp); clipboardOk = true; }
                catch (Exception ex)
                {
                    clipError = ex.Message;
                    ActivityLog.Log(Channel, $"Screen clip clipboard copy FAILED: {ex.Message}");
                }

                ReportResult(rect, savedPath, saveError, clipboardOk, clipError);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Screen clip capture FAILED: {ex.Message}");
                ToastEngine.Error("Screen clip failed", ex.Message);
            }
            finally
            {
                bmp?.Dispose();
            }
        }

        private static void SettleAfterOverlayClosed()
        {
            var disp = Application.Current?.Dispatcher;
            disp?.Invoke(() => { }, DispatcherPriority.Render);
            disp?.Invoke(() => { }, DispatcherPriority.ApplicationIdle);
            System.Threading.Thread.Sleep(120); // DWM runs out-of-process; this just lets the frame present.
            disp?.Invoke(() => { }, DispatcherPriority.Render);
        }

        private static string SaveToDisk(Bitmap bmp)
        {
            var settings = BuildConsoleSettings.Load();
            string dir = string.IsNullOrWhiteSpace(settings.ScreenClipSaveDirectory)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Screenshots", "BuildConsole")
                : settings.ScreenClipSaveDirectory;
            Directory.CreateDirectory(dir);

            // Sortable + collision-free: yyyy-MM-dd_HH-mm-ss-fff already separates two clips in the
            // same second (millisecond precision); the counter is belt-and-suspenders for the same ms.
            var stamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss-fff");
            string path = Path.Combine(dir, $"screenclip_{stamp}.png");
            int n = 1;
            while (File.Exists(path))
                path = Path.Combine(dir, $"screenclip_{stamp}_{n++}.png");

            bmp.Save(path, ImageFormat.Png);
            ActivityLog.Log(Channel, $"Screen clip saved: {path} ({bmp.Width}x{bmp.Height}).");
            return path;
        }

        private static void CopyToClipboard(Bitmap bmp)
        {
            // Put the image on the clipboard in a way that survives a REAL paste (Paint, Office,
            // browsers, chat apps) — a DataObject carrying more than one format is the usual answer:
            //   - Bitmap (CF_BITMAP; the OLE clipboard synthesizes CF_DIB from it for classic apps).
            //     The source Bitmap is 24bpp/opaque, so no alpha-zero -> black.
            //   - PNG stream: preferred by browsers/chat apps and preserving exact pixels.
            var data = new WinFormsDataObject();
            data.SetData(WinFormsDataFormats.Bitmap, true, bmp);

            var png = new MemoryStream();
            bmp.Save(png, ImageFormat.Png);
            png.Position = 0;
            data.SetData("PNG", false, png);

            // copy: true -> OLE flushes/renders every format now, so the image survives after
            // BuildConsole exits and it's safe to Dispose the source Bitmap immediately after.
            WinFormsClipboard.SetDataObject(data, true);
            ActivityLog.Log(Channel, $"Screen clip copied to clipboard ({bmp.Width}x{bmp.Height}; Bitmap + PNG formats).");
        }

        private static void ReportResult(Int32Rect rect, string? savedPath, string? saveError, bool clipboardOk, string? clipError)
        {
            string dim = $"{rect.Width}×{rect.Height}";
            if (savedPath != null && clipboardOk)
                ToastEngine.Success("Screen clip captured", $"{dim} — copied to clipboard and saved to\n{savedPath}");
            else if (savedPath != null && !clipboardOk)
                ToastEngine.Warning("Screen clip saved (clipboard failed)", $"{dim} saved to {savedPath}.\nClipboard copy failed: {clipError}");
            else if (savedPath == null && clipboardOk)
                ToastEngine.Warning("Screen clip copied (save failed)", $"{dim} copied to clipboard.\nDisk save failed: {saveError}");
            else
                ToastEngine.Error("Screen clip failed", $"Could not save or copy. Save: {saveError}; Clipboard: {clipError}");
        }
    }
}
