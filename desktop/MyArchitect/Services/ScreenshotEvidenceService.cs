using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// File-backed local evidence cache persisted to %LocalAppData%\MyArchitect\screenshot_evidence.json.
/// Operates completely locally without requiring any remote database connectivity.
/// </summary>
public sealed class ScreenshotEvidenceService : IScreenshotEvidenceService
{
    private static readonly Lazy<ScreenshotEvidenceService> _instance = new(() => new ScreenshotEvidenceService());
    public static ScreenshotEvidenceService Instance => _instance.Value;

    private readonly string _cacheFilePath;
    private readonly SemaphoreSlim _semaphore = new(1, 1);
    private readonly List<ScreenshotEvidenceItem> _items = new();
    private bool _initialized;

    public event EventHandler<ScreenshotEvidenceItem>? ItemAdded;
    public event EventHandler<string>? ItemDeleted;
    public event EventHandler<ScreenshotEvidenceItem>? ItemUpdated;

    public ScreenshotEvidenceService(string? customCachePath = null)
    {
        if (!string.IsNullOrWhiteSpace(customCachePath))
        {
            _cacheFilePath = customCachePath;
        }
        else
        {
            var baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MyArchitect");
            Directory.CreateDirectory(baseDir);
            _cacheFilePath = Path.Combine(baseDir, "screenshot_evidence.json");
        }
    }

    private async Task EnsureLoadedAsync()
    {
        if (_initialized) return;

        await _semaphore.WaitAsync();
        try
        {
            if (_initialized) return;

            if (File.Exists(_cacheFilePath))
            {
                try
                {
                    var json = await File.ReadAllTextAsync(_cacheFilePath);
                    var loaded = JsonSerializer.Deserialize<List<ScreenshotEvidenceItem>>(json);
                    if (loaded != null)
                    {
                        _items.Clear();
                        _items.AddRange(loaded.OrderByDescending(i => i.CapturedAt));
                    }
                }
                catch
                {
                    // Fallback to empty if parse fails
                    _items.Clear();
                }
            }

            _initialized = true;
        }
        finally
        {
            _semaphore.Release();
        }
    }

    private async Task PersistAsync()
    {
        var options = new JsonSerializerOptions { WriteIndented = true };
        var json = JsonSerializer.Serialize(_items, options);
        var dir = Path.GetDirectoryName(_cacheFilePath);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }
        await File.WriteAllTextAsync(_cacheFilePath, json);
    }

    public async Task<IReadOnlyList<ScreenshotEvidenceItem>> GetAllAsync()
    {
        await EnsureLoadedAsync();
        await _semaphore.WaitAsync();
        try
        {
            return _items.ToList().AsReadOnly();
        }
        finally
        {
            _semaphore.Release();
        }
    }

    public async Task<ScreenshotEvidenceItem> AddAsync(ScreenshotEvidenceItem item)
    {
        await EnsureLoadedAsync();
        await _semaphore.WaitAsync();
        try
        {
            _items.Insert(0, item);
            await PersistAsync();
        }
        finally
        {
            _semaphore.Release();
        }

        ItemAdded?.Invoke(this, item);
        return item;
    }

    public async Task UpdateCaptionAsync(string id, string caption, string? stepRef = null, string? changeRef = null, int? customerId = null)
    {
        await EnsureLoadedAsync();
        ScreenshotEvidenceItem? target = null;
        await _semaphore.WaitAsync();
        try
        {
            target = _items.FirstOrDefault(i => i.Id == id);
            if (target != null)
            {
                target.Caption = caption;
                if (stepRef != null) target.StepRef = stepRef;
                if (changeRef != null) target.ChangeRef = changeRef;
                if (customerId != null) target.CustomerId = customerId;
                await PersistAsync();
            }
        }
        finally
        {
            _semaphore.Release();
        }

        if (target != null)
        {
            ItemUpdated?.Invoke(this, target);
        }
    }

    public async Task MarkPostedAsync(string id, int attachmentId)
    {
        await EnsureLoadedAsync();
        ScreenshotEvidenceItem? target = null;
        await _semaphore.WaitAsync();
        try
        {
            target = _items.FirstOrDefault(i => i.Id == id);
            if (target != null)
            {
                target.PostedAttachmentId = attachmentId;
                await PersistAsync();
            }
        }
        finally
        {
            _semaphore.Release();
        }

        if (target != null)
        {
            ItemUpdated?.Invoke(this, target);
        }
    }

    public async Task DeleteAsync(string id, bool deleteLocalFile = false)
    {
        await EnsureLoadedAsync();
        ScreenshotEvidenceItem? target = null;
        await _semaphore.WaitAsync();
        try
        {
            target = _items.FirstOrDefault(i => i.Id == id);
            if (target != null)
            {
                _items.Remove(target);
                await PersistAsync();

                if (deleteLocalFile && !string.IsNullOrWhiteSpace(target.FilePath) && File.Exists(target.FilePath))
                {
                    try
                    {
                        File.Delete(target.FilePath);
                    }
                    catch
                    {
                        // Ignore file lock or deletion errors
                    }
                }
            }
        }
        finally
        {
            _semaphore.Release();
        }

        if (target != null)
        {
            ItemDeleted?.Invoke(this, id);
        }
    }
}
