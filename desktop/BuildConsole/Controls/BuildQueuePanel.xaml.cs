using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    public class TaskSelectedEventArgs : EventArgs
    {
        public string Epic { get; set; } = string.Empty;
        public string Task { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string StatusDetails { get; set; } = string.Empty;
    }

    /// <summary>
    /// The real Build Queue panel — Shane: "Feel free to change anything to patch how
    /// I actually work based on the Add-In." Was 100% hardcoded demo XAML before this;
    /// now reads the same live queue the browser extension's left panel and
    /// scripts/build-queue-watcher.ps1 both already talk to (GET
    /// /extension/queue), nesting a blocked item under its blocker the same way
    /// content.js's renderQueueSection() does (Git #798/#799).
    /// </summary>
    public partial class BuildQueuePanel : UserControl
    {
        public event EventHandler<TaskSelectedEventArgs>? TaskSelected;
        public event EventHandler<bool>? PinToggled;
        /// <summary>Git #815 — mirrors LeftSidebar's SyncError: null on a successful poll, a message on a failed one.</summary>
        public event EventHandler<string?>? SyncError;
        private bool _isPinned = true;

        private BuildTrackerApiClient? _api;
        private DispatcherTimer? _pollTimer;
        private List<QueueItem> _lastItems = new();
        private string _filter = "All";

        public BuildQueuePanel() => InitializeComponent();

        /// <summary>Called once from MainWindow with the shared API client — starts polling immediately.</summary>
        public void Initialize(BuildTrackerApiClient api)
        {
            _api = api;
            if (!api.IsConfigured)
            {
                QueueTree.Visibility = Visibility.Collapsed;
                QueueEmptyText.Text = "Not connected — set apiBaseUrl/ingestToken in scripts\\build-queue-watcher.config.json (Settings tab has the path).";
                QueueEmptyText.Visibility = Visibility.Visible;
                return;
            }

            _pollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
            _pollTimer.Tick += async (_, _) => await RefreshAsync();
            _pollTimer.Start();
            _ = RefreshAsync();
        }

        public async System.Threading.Tasks.Task RefreshAsync()
        {
            if (_api == null || !_api.IsConfigured) return;
            try
            {
                _lastItems = await _api.GetQueueAsync();
                if (_filter != "Tests") RenderQueue(ApplyFilter(_lastItems));
                // Git #812 — the Tests tree reads test-results/*.json off disk, not the queue
                // API, so a poll refreshes it every tick (a new test run can land results
                // without the queue itself changing at all).
                if (_filter == "Tests") RenderTestsTree();
                SyncError?.Invoke(this, null);
            }
            catch (Exception ex)
            {
                QueueTree.Visibility = Visibility.Collapsed;
                QueueEmptyText.Text = $"Couldn't reach the API: {ex.Message}";
                QueueEmptyText.Visibility = Visibility.Visible;
                SyncError?.Invoke(this, $"Build Queue: {ex.Message}");
            }
        }

        /// <summary>Git #814 - Shane: "can you make the filters in the build queue work." Chips were Shane's own hardcoded demo XAML, never wired to anything.</summary>
        private List<QueueItem> ApplyFilter(List<QueueItem> items) => _filter switch
        {
            "Active"   => items.Where(i => i.Status is "queued" or "running").ToList(),
            "Done"     => items.Where(i => i.Status == "done").ToList(),
            "Canceled" => items.Where(i => i.Status == "canceled").ToList(),
            _          => items,
        };

        private void FilterChip_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not ToggleButton clicked) return;
            foreach (var chip in new[] { ChipAll, ChipActive, ChipDone, ChipCanceled, ChipTests })
            {
                chip.IsChecked = chip == clicked;
            }
            _filter = clicked.Tag as string ?? "All";
            if (_filter == "Tests") RenderTestsTree();
            else RenderQueue(ApplyFilter(_lastItems));
        }

        private void RenderQueue(List<QueueItem> items)
        {
            QueueTree.Visibility = Visibility.Visible;
            QueueEmptyText.Visibility = items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            QueueEmptyText.Text = _filter switch
            {
                "Active"   => "Nothing queued or running.",
                "Done"     => "Nothing done yet.",
                "Canceled" => "Nothing canceled.",
                _          => "Queue is empty.",
            };
            QueueTree.Items.Clear();

            // Git #799/#813 — a queued item nests under its blocker only when
            // the blocker is ALSO currently in the queue (same scoping choice
            // content.js's renderQueueSection() made) - otherwise it just
            // shows its own "waiting on #N, #M" line, not nested. An item can
            // have several blockers (#813 - Shane tried "--blocked-by
            // 807,808,809"); it nests once, under the first one found in the
            // queue.
            var byGithubNumber = items.Where(i => i.GithubNumber.HasValue)
                                       .GroupBy(i => i.GithubNumber!.Value)
                                       .ToDictionary(g => g.Key, g => g.First());
            var childrenOf = new Dictionary<int, List<QueueItem>>();
            var topLevel = new List<QueueItem>();
            foreach (var item in items)
            {
                var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
                var nestUnder = blockers.FirstOrDefault(n => n != item.GithubNumber && byGithubNumber.ContainsKey(n), -1);
                if (nestUnder != -1)
                {
                    if (!childrenOf.TryGetValue(nestUnder, out var list))
                    {
                        list = new List<QueueItem>();
                        childrenOf[nestUnder] = list;
                    }
                    list.Add(item);
                }
                else
                {
                    topLevel.Add(item);
                }
            }

            void RenderOne(QueueItem item, ItemsControl parent)
            {
                var tvi = BuildQueueTreeItem(item);
                parent.Items.Add(tvi);
                if (item.GithubNumber.HasValue && childrenOf.TryGetValue(item.GithubNumber.Value, out var kids))
                {
                    foreach (var kid in kids) RenderOne(kid, tvi);
                }
            }

            foreach (var item in topLevel) RenderOne(item, QueueTree);
        }

        private static readonly Dictionary<string, (string Icon, string Hex)> StatusStyle = new()
        {
            ["queued"]   = ("⏳", "#8F8C88"),
            ["running"]  = ("▶", "#F2CA63"),
            ["done"]     = ("✅", "#7FAE91"),
            ["failed"]   = ("✕", "#E57A7A"),
            ["canceled"] = ("—", "#5A5856"),
        };

        /// <summary>Git #812 (Phase 7 of Epic #803) — Tests chip's status-dot palette, matching StatusStyle's shape/naming above (icon + hex pair keyed by state).</summary>
        private static readonly Dictionary<string, (string Icon, string Hex)> TestStatusStyle = new()
        {
            ["passed"] = ("✅", "#7FAE91"),
            ["failed"] = ("✕", "#E57A7A"),
            ["none"]   = ("•", "#8F8C88"),
        };

        /// <summary>
        /// Git #812 (Phase 7 of Epic #803) — Tests filter chip: reuses this same panel/TreeView
        /// but populates it from the local test-manifests/test-results file tree instead of the
        /// live queue API, since test results are written straight to disk by RunManifestAsync ->
        /// ManifestRunResult.WriteToFile (test-results/{issue}-{timestamp}.json per #803's Repo
        /// Structure section) rather than tracked by the build-tracker DB. Shows the most recent
        /// run's pass/fail per manifest using the same status-dot pattern BuildQueueTreeItem uses.
        /// </summary>
        private void RenderTestsTree()
        {
            QueueTree.Items.Clear();

            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                QueueTree.Visibility = Visibility.Collapsed;
                QueueEmptyText.Text = "No repo root found — can't locate test-manifests/test-results (Settings tab has the config path).";
                QueueEmptyText.Visibility = Visibility.Visible;
                return;
            }

            string manifestsDir = Path.Combine(repoRoot, "test-manifests");
            string resultsDir = Path.Combine(repoRoot, "test-results");

            var manifestFiles = Directory.Exists(manifestsDir)
                ? Directory.GetFiles(manifestsDir, "*.json")
                    .Where(f => !string.Equals(Path.GetFileName(f), "_regression-suite.json", StringComparison.OrdinalIgnoreCase))
                    .OrderBy(f => f)
                    .ToList()
                : new List<string>();

            QueueTree.Visibility = Visibility.Visible;
            QueueEmptyText.Visibility = manifestFiles.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            QueueEmptyText.Text = "No test manifests found in test-manifests/.";

            // Latest test-results/{issue}-{timestamp}.json per issue — filenames sort
            // chronologically since the timestamp segment is yyyyMMddHHmmss.
            var latestResultFileByIssue = new Dictionary<int, string>();
            if (Directory.Exists(resultsDir))
            {
                foreach (var file in Directory.GetFiles(resultsDir, "*.json"))
                {
                    string name = Path.GetFileNameWithoutExtension(file);
                    int dash = name.IndexOf('-');
                    if (dash <= 0 || !int.TryParse(name.Substring(0, dash), out int issueNum)) continue;
                    if (!latestResultFileByIssue.TryGetValue(issueNum, out var existing) || string.CompareOrdinal(file, existing) > 0)
                        latestResultFileByIssue[issueNum] = file;
                }
            }

            foreach (var manifestPath in manifestFiles)
            {
                var manifest = TestManifest.LoadFromFile(manifestPath);
                if (manifest == null) continue;

                string status = "none";
                string subtitle = "no runs yet";

                if (latestResultFileByIssue.TryGetValue(manifest.Issue, out var resultPath))
                {
                    try
                    {
                        var runResult = System.Text.Json.JsonSerializer.Deserialize<ManifestRunResult>(File.ReadAllText(resultPath));
                        if (runResult != null && runResult.Steps.Count > 0)
                        {
                            int passed = runResult.Steps.Count(s => s.Passed);
                            status = runResult.AllPassed ? "passed" : "failed";
                            subtitle = $"{passed}/{runResult.Steps.Count} passed — {runResult.StartedAt:MM/dd HH:mm} ({runResult.Mode})";
                        }
                    }
                    catch (Exception ex)
                    {
                        subtitle = $"couldn't read last result: {ex.Message}";
                    }
                }

                var (icon, hex) = TestStatusStyle[status];
                var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));

                var panel = new StackPanel { Orientation = Orientation.Horizontal };
                panel.Children.Add(new TextBlock { Text = icon + " ", FontSize = 12, Foreground = brush, VerticalAlignment = VerticalAlignment.Center });
                panel.Children.Add(new TextBlock
                {
                    Text = $"#{manifest.Issue} — {manifest.Feature}",
                    FontSize = 12,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                    VerticalAlignment = VerticalAlignment.Center,
                });
                panel.Children.Add(new TextBlock
                {
                    Text = "  " + subtitle,
                    FontSize = 10,
                    FontStyle = FontStyles.Italic,
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    VerticalAlignment = VerticalAlignment.Center,
                });

                QueueTree.Items.Add(new TreeViewItem { Header = panel, Tag = manifestPath });
            }
        }

        private TreeViewItem BuildQueueTreeItem(QueueItem item)
        {
            var (icon, hex) = StatusStyle.TryGetValue(item.Status, out var s) ? s : ("•", "#CDD6F4");
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));

            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(new TextBlock { Text = icon + " ", FontSize = 12, Foreground = brush, VerticalAlignment = VerticalAlignment.Center });
            panel.Children.Add(new TextBlock
            {
                Text = item.Title,
                FontSize = 12,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            });
            var blockerList = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
            if (blockerList.Count > 0 && item.Status == "queued")
            {
                panel.Children.Add(new TextBlock
                {
                    Text = $"  waiting on {string.Join(", ", blockerList.Select(n => $"#{n}"))}",
                    FontSize = 10,
                    FontStyle = FontStyles.Italic,
                    Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#E5A3A3")),
                    VerticalAlignment = VerticalAlignment.Center,
                });
            }
            if (item.Status == "failed" && item.ExitCode.HasValue)
            {
                panel.Children.Add(new TextBlock
                {
                    Text = $"  exit {item.ExitCode}",
                    FontSize = 10,
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    VerticalAlignment = VerticalAlignment.Center,
                });
            }

            var tvi = new TreeViewItem { Header = panel, IsExpanded = true, Tag = item };

            // Git #801 — same manual escape hatch content.js's panel has: if the
            // watcher's own in-memory tracking loses a running item (e.g. a
            // restart), there'd otherwise be no way to unstick it from here.
            var cm = new ContextMenu();
            if (item.Status == "running")
            {
                var miDone = new MenuItem { Header = "✓ Mark Done" };
                miDone.Click += async (_, _) => { if (_api != null) { await _api.MarkQueueItemCompleteAsync(item.Id, 0); await RefreshAsync(); } };
                cm.Items.Add(miDone);
            }
            if (item.Status == "queued")
            {
                var miCancel = new MenuItem { Header = "✕ Cancel" };
                miCancel.Click += async (_, _) => { if (_api != null) { await _api.CancelQueueItemAsync(item.Id); await RefreshAsync(); } };
                cm.Items.Add(miCancel);
            }
            if (cm.Items.Count > 0) tvi.ContextMenu = cm;

            return tvi;
        }

        private void QueueTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is QueueItem item)
            {
                TaskSelected?.Invoke(this, new TaskSelectedEventArgs
                {
                    Epic = item.GithubNumber.HasValue ? $"#{item.GithubNumber}" : "",
                    Task = item.Title,
                    Status = item.Status,
                    StatusDetails = (item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>())) is { Count: > 0 } blockers
                        ? $"Waiting on {string.Join(", ", blockers.Select(n => $"#{n}"))}"
                        : "",
                });
            }
        }

        private void BtnPinQueue_Click(object sender, RoutedEventArgs e)
        {
            _isPinned = !_isPinned;
            PinQueueIcon.Text = _isPinned ? "📌" : "📍";
            PinToggled?.Invoke(this, _isPinned);
        }
    }
}
