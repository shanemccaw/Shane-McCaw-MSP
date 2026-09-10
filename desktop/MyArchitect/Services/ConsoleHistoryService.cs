using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real local-file implementation of <see cref="IConsoleHistoryService"/> — same JSON
/// persistence style already used by <see cref="AssessmentService"/>'s offline snapshots, applied
/// here to console run history under %LOCALAPPDATA%\MyArchitect\console-history.json. In-memory
/// list is the source of truth during the session; every mutation is flushed to disk immediately
/// so a crash doesn't lose "mark for report" state.
/// </summary>
public sealed class ConsoleHistoryService : IConsoleHistoryService
{
    private readonly string _filePath;
    private readonly List<ConsoleExecutionRecord> _records;
    private readonly object _lock = new();

    public ConsoleHistoryService(string? filePath = null)
    {
        _filePath = filePath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MyArchitect", "console-history.json");

        _records = LoadFromDisk(_filePath);
    }

    public IReadOnlyList<ConsoleExecutionRecord> GetAll()
    {
        lock (_lock) return _records.OrderByDescending(r => r.StartedAtUtc).ToList();
    }

    public void Add(ConsoleExecutionRecord record)
    {
        if (record == null) throw new ArgumentNullException(nameof(record));
        lock (_lock)
        {
            _records.Add(record);
            SaveToDisk();
        }
    }

    public bool ToggleMarkedForReport(Guid executionId)
    {
        lock (_lock)
        {
            var record = _records.FirstOrDefault(r => r.ExecutionId == executionId);
            if (record == null) return false;
            record.MarkedForReport = !record.MarkedForReport;
            SaveToDisk();
            return true;
        }
    }

    public IReadOnlyList<ConsoleExecutionRecord> GetMarkedForReport()
    {
        lock (_lock) return _records.Where(r => r.MarkedForReport).OrderByDescending(r => r.StartedAtUtc).ToList();
    }

    private static List<ConsoleExecutionRecord> LoadFromDisk(string filePath)
    {
        try
        {
            if (!File.Exists(filePath)) return new List<ConsoleExecutionRecord>();
            var json = File.ReadAllText(filePath);
            return JsonSerializer.Deserialize<List<ConsoleExecutionRecord>>(json) ?? new List<ConsoleExecutionRecord>();
        }
        catch
        {
            // Corrupt/unreadable history file — start clean rather than crash the app on launch.
            return new List<ConsoleExecutionRecord>();
        }
    }

    private void SaveToDisk()
    {
        try
        {
            var dir = Path.GetDirectoryName(_filePath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var json = JsonSerializer.Serialize(_records, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(_filePath, json);
        }
        catch
        {
            // Best-effort persistence — a save failure should not crash a running console session.
        }
    }
}
