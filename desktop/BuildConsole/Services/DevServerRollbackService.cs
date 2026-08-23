using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Windows;
using BuildConsole.Controls;

namespace BuildConsole.Services
{
    /// <summary>
    /// Model for a dev-server merge rollback event recorded by coordinator.mjs.
    /// </summary>
    public class DevServerRollbackEvent
    {
        public string Id { get; set; } = string.Empty;
        public string Key { get; set; } = string.Empty;
        public string Title { get; set; } = string.Empty;
        public string Summary { get; set; } = string.Empty;
        public string Details { get; set; } = string.Empty;
        public bool IsFailure { get; set; } = true;
        public DateTime AtLocal { get; set; } = DateTime.Now;
        public long Timestamp { get; set; }
        public List<string>? RevertedCommits { get; set; }
        public string? RestoredCommit { get; set; }
    }

    /// <summary>
    /// Service for detecting and surfacing dev-server merge rollbacks to Shane via
    /// ToastEngine (#24) and the Build Queue "Needs Attention" panel (#67).
    /// </summary>
    public static class DevServerRollbackService
    {
        private const string LogChannel = "devserver.rollback";
        private static readonly HashSet<string> _processedRollbacks = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// Check stateDir/needs-attention/ for any new rollback events and surface them.
        /// </summary>
        public static void CheckForRollbacks(BuildQueuePanel? queuePanel)
        {
            try
            {
                string? repoRoot = BuildTrackerConfig.FindRepoRoot();
                if (repoRoot == null) return;

                // State directory per config.mjs: DEV_SERVER_STATE_DIR or C:\dev-server-state or repoRoot/.dev-server-state
                string stateDir = Environment.GetEnvironmentVariable("DEV_SERVER_STATE_DIR")
                    ?? (OperatingSystem.IsWindows() ? @"C:\dev-server-state" : Path.Combine(repoRoot, ".dev-server-state"));

                string needsAttentionDir = Path.Combine(stateDir, "needs-attention");
                if (!Directory.Exists(needsAttentionDir)) return;

                var files = Directory.GetFiles(needsAttentionDir, "rollback-*.json");
                foreach (var file in files)
                {
                    string fileName = Path.GetFileNameWithoutExtension(file);
                    if (_processedRollbacks.Contains(fileName)) continue;

                    try
                    {
                        string json = File.ReadAllText(file);
                        var evt = JsonSerializer.Deserialize<DevServerRollbackEvent>(json, new JsonSerializerOptions
                        {
                            PropertyNameCaseInsensitive = true,
                        });

                        if (evt == null) continue;

                        _processedRollbacks.Add(fileName);

                        string attentionKey = string.IsNullOrWhiteSpace(evt.Key) ? fileName : evt.Key;
                        string title = string.IsNullOrWhiteSpace(evt.Title) ? "🔴 Dev Server Merge Rolled Back" : evt.Title;
                        string summary = string.IsNullOrWhiteSpace(evt.Summary) ? "Dev server merge failed health check and was rolled back." : evt.Summary;
                        string details = string.IsNullOrWhiteSpace(evt.Details) ? summary : evt.Details;

                        ActivityLog.Log(LogChannel, $"[ROLLBACK DETECTED] {title} ({fileName}): {summary}");

                        Action onOpen = () =>
                        {
                            try
                            {
                                var parentWin = Application.Current?.MainWindow;
                                var dlg = new NeedsAttentionDetailDialog(title, summary, details, isFailure: true, evt.AtLocal, null);
                                if (parentWin != null) dlg.Owner = parentWin;
                                dlg.ShowDialog();
                            }
                            catch (Exception ex)
                            {
                                ActivityLog.Log(LogChannel, $"Failed to open rollback dialog: {ex.Message}");
                            }
                        };

                        if (queuePanel != null)
                        {
                            queuePanel.AddNeedsAttention(attentionKey, title, summary, isFailure: true, onOpen, details);
                        }

                        Action onToastClick = () =>
                        {
                            onOpen();
                            queuePanel?.ClearNeedsAttention(attentionKey);
                        };

                        ToastEngine.Show(title, summary, ToastKind.Error, duration: TimeSpan.FromSeconds(15), onClick: onToastClick);
                    }
                    catch (Exception ex)
                    {
                        ActivityLog.Log(LogChannel, $"Error parsing rollback record {file}: {ex.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"Error checking rollbacks: {ex.Message}");
            }
        }
    }
}
