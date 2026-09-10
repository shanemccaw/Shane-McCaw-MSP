using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real local-file implementation of <see cref="IActivityContextService"/> — same JSON
/// persistence style as <see cref="ConsoleHistoryService"/>, under
/// %LOCALAPPDATA%\MyArchitect\activity-log.json. In-memory list is the source of truth during the
/// session; every mutation is flushed to disk immediately. Events older than 30 days are pruned on
/// load — this is a daily review timeline, not an unbounded archive.
/// </summary>
public sealed class ActivityContextService : IActivityContextService
{
    private const int RetentionDays = 30;

    private readonly string _filePath;
    private readonly List<ActivityEvent> _events;
    private readonly object _lock = new();

    private Tenant? _activeTenant;
    private (string Kind, string Id, string Label)? _activeRecord;

    public event EventHandler<ActivityEvent>? EventRecorded;

    public ActivityContextService(string? filePath = null)
    {
        _filePath = filePath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MyArchitect", "activity-log.json");

        _events = LoadFromDisk(_filePath);
    }

    public Tenant? ActiveTenant => _activeTenant;
    public (string Kind, string Id, string Label)? ActiveRecord => _activeRecord;

    public IReadOnlyList<ActivityEvent> GetAll()
    {
        lock (_lock) return _events.OrderByDescending(e => e.TimestampUtc).ToList();
    }

    public IReadOnlyList<ActivityEvent> GetForDay(DateOnly day)
    {
        lock (_lock)
        {
            return _events
                .Where(e => DateOnly.FromDateTime(e.TimestampUtc.ToLocalTime().DateTime) == day)
                .OrderByDescending(e => e.TimestampUtc)
                .ToList();
        }
    }

    public void RecordTenantSwitch(Tenant? tenant)
    {
        _activeTenant = tenant;
        if (tenant == null) return;

        Add(new ActivityEvent
        {
            Kind = "tenant-switch",
            Detail = tenant.Name,
            TenantId = tenant.Id,
            TenantName = tenant.Name,
        });
    }

    public void RecordConsoleCommand(ConsoleExecutionRecord record)
    {
        if (record == null) throw new ArgumentNullException(nameof(record));

        var detail = record.Command.Length > 120 ? record.Command[..120] + "…" : record.Command;
        Add(new ActivityEvent
        {
            Kind = "console-command",
            Detail = $"{detail} ({(record.Succeeded ? "ok" : "failed")}, {record.DurationMs}ms)",
            TenantId = string.IsNullOrEmpty(record.TenantId) ? _activeTenant?.Id : record.TenantId,
            TenantName = string.IsNullOrEmpty(record.TenantName) ? _activeTenant?.Name : record.TenantName,
        });
    }

    public void RecordOpen(string kind, string id, string label)
    {
        if (string.IsNullOrEmpty(kind)) throw new ArgumentException("kind required", nameof(kind));

        _activeRecord = (kind, id, label);
        Add(new ActivityEvent
        {
            Kind = "record-open",
            Detail = $"{kind}: {label}",
            TenantId = _activeTenant?.Id,
            TenantName = _activeTenant?.Name,
        });
    }

    public void RecordExternalApp(string appLabel)
    {
        if (string.IsNullOrEmpty(appLabel)) return;

        var context = _activeRecord is { } r
            ? $" — last in {r.Kind}: {r.Label}"
            : (_activeTenant != null ? $" — last tenant: {_activeTenant.Name}" : string.Empty);

        Add(new ActivityEvent
        {
            Kind = "external-app",
            Detail = $"{appLabel}{context}",
            TenantId = _activeTenant?.Id,
            TenantName = _activeTenant?.Name,
        });
    }

    public bool SetTag(Guid eventId, string? tag)
    {
        lock (_lock)
        {
            var ev = _events.FirstOrDefault(e => e.Id == eventId);
            if (ev == null) return false;
            ev.Tag = string.IsNullOrWhiteSpace(tag) ? null : tag.Trim();
            SaveToDisk();
            return true;
        }
    }

    private void Add(ActivityEvent ev)
    {
        lock (_lock)
        {
            _events.Add(ev);
            PruneOldEvents();
            SaveToDisk();
        }
        EventRecorded?.Invoke(this, ev);
    }

    private void PruneOldEvents()
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-RetentionDays);
        _events.RemoveAll(e => e.TimestampUtc < cutoff);
    }

    private static List<ActivityEvent> LoadFromDisk(string filePath)
    {
        try
        {
            if (!File.Exists(filePath)) return new List<ActivityEvent>();
            var json = File.ReadAllText(filePath);
            var loaded = JsonSerializer.Deserialize<List<ActivityEvent>>(json) ?? new List<ActivityEvent>();
            var cutoff = DateTimeOffset.UtcNow.AddDays(-RetentionDays);
            return loaded.Where(e => e.TimestampUtc >= cutoff).ToList();
        }
        catch
        {
            // Corrupt/unreadable log file — start clean rather than crash the app on launch.
            return new List<ActivityEvent>();
        }
    }

    private void SaveToDisk()
    {
        try
        {
            var dir = Path.GetDirectoryName(_filePath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var json = JsonSerializer.Serialize(_events, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(_filePath, json);
        }
        catch
        {
            // Best-effort persistence — a save failure should not crash a running session.
        }
    }
}
