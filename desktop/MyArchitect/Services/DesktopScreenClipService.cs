using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows;
using System.Windows.Threading;
using MyArchitect.Models;
using WinFormsClipboard = System.Windows.Forms.Clipboard;
using WinFormsDataFormats = System.Windows.Forms.DataFormats;
using WinFormsDataObject = System.Windows.Forms.DataObject;

namespace MyArchitect.Services;

/// <summary>
/// Screen clipping service ported from BuildConsole (Git #1866) and adapted for MyArchitect (Issue #3470).
/// Captures a user-drawn region in physical pixels across all monitors, copies to clipboard (Bitmap + PNG stream),
/// saves to disk in %Pictures%\Screenshots\MyArchitect, and registers the capture in the local screenshot_evidence cache.
/// </summary>
public static class DesktopScreenClipService
{
    private static bool _overlayOpen;

    public static event EventHandler<ScreenshotEvidenceItem>? CaptureCompleted;

    /// <summary>
    /// Run one capture: opens region select overlay across the virtual screen, saves to disk and clipboard,
    /// and indexes into the evidence cache with active tenant and portal context.
    /// Safe to call repeatedly; no-op if an overlay is already open.
    /// </summary>
    public static ScreenshotEvidenceItem? Capture(Tenant? activeTenant = null, string? activeUrl = null, string? activeTitle = null)
    {
        if (_overlayOpen)
        {
            return null;
        }

        _overlayOpen = true;
        Bitmap? bmp = null;
        try
        {
            Int32Rect rect;
            try
            {
                var overlay = new RegionSelectOverlayWindow();
                overlay.ConfigureForVirtualScreen();
                bool? drawn = overlay.ShowDialog();
                if (drawn != true)
                {
                    // Esc or right-click or too small
                    return null;
                }
                rect = overlay.SelectedPhysicalRect;
            }
            finally
            {
                _overlayOpen = false;
            }

            if (rect.Width <= 0 || rect.Height <= 0)
            {
                return null;
            }

            // Flush pending WPF renders and let DWM composite the screen without the overlay
            SettleAfterOverlayClosed();

            // 24bpp (no alpha): CopyFromScreen never writes alpha channel, so 24bpp avoids black paste in classic apps
            bmp = new Bitmap(rect.Width, rect.Height, PixelFormat.Format24bppRgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(rect.X, rect.Y, 0, 0,
                    new System.Drawing.Size(rect.Width, rect.Height), CopyPixelOperation.SourceCopy);
            }

            string? savedPath = null;
            try
            {
                savedPath = SaveToDisk(bmp);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[MyArchitect] Disk save failed: {ex.Message}");
            }

            try
            {
                CopyToClipboard(bmp);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[MyArchitect] Clipboard copy failed: {ex.Message}");
            }

            if (savedPath != null)
            {
                var evidenceItem = new ScreenshotEvidenceItem
                {
                    CapturedAt = DateTimeOffset.UtcNow,
                    FilePath = savedPath,
                    TenantId = activeTenant?.Id ?? activeTenant?.TenantGuid,
                    TenantName = activeTenant?.Name,
                    ActiveUrl = activeUrl,
                    Caption = !string.IsNullOrWhiteSpace(activeTitle) ? $"Capture from {activeTitle}" : null,
                    Width = rect.Width,
                    Height = rect.Height,
                    Status = "Captured"
                };

                // Asynchronously register into local cache
                _ = ScreenshotEvidenceService.Instance.AddAsync(evidenceItem);

                CaptureCompleted?.Invoke(null, evidenceItem);
                return evidenceItem;
            }

            return null;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[MyArchitect] Screen capture failed: {ex.Message}");
            return null;
        }
        finally
        {
            _overlayOpen = false;
            bmp?.Dispose();
        }
    }

    private static void SettleAfterOverlayClosed()
    {
        var disp = System.Windows.Application.Current?.Dispatcher;
        disp?.Invoke(() => { }, DispatcherPriority.Render);
        disp?.Invoke(() => { }, DispatcherPriority.ApplicationIdle);
        System.Threading.Thread.Sleep(120); // DWM compositor catch-up
        disp?.Invoke(() => { }, DispatcherPriority.Render);
    }

    private static string SaveToDisk(Bitmap bmp)
    {
        string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Screenshots", "MyArchitect");
        Directory.CreateDirectory(dir);

        var stamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss-fff");
        string path = Path.Combine(dir, $"screenclip_{stamp}.png");
        int n = 1;
        while (File.Exists(path))
        {
            path = Path.Combine(dir, $"screenclip_{stamp}_{n++}.png");
        }

        bmp.Save(path, ImageFormat.Png);
        return path;
    }

    private static void CopyToClipboard(Bitmap bmp)
    {
        var data = new WinFormsDataObject();
        data.SetData(WinFormsDataFormats.Bitmap, true, bmp);

        var png = new MemoryStream();
        bmp.Save(png, ImageFormat.Png);
        png.Position = 0;
        data.SetData("PNG", false, png);

        WinFormsClipboard.SetDataObject(data, true);
    }
}
