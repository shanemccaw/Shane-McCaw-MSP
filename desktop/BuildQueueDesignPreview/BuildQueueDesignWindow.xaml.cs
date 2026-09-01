using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #2135 (Epic #1788 — Build Console → Build Queue Panel) — code-behind for the
    /// isolated Build Queue redesign-scaffold window. See the header comment in
    /// BuildQueueDesignWindow.xaml for the full "why" and the isolation guarantee.
    ///
    /// Responsibilities kept here (data), leaving all VISUALS to the XAML templates so
    /// Shane can iterate the look without touching this file:
    ///   • Read the REAL live queue — the exact same source every other panel uses,
    ///     <see cref="BuildQueuePostgresClient.GetQueueAsync"/> — no fixture/mock data.
    ///   • Project each row into a plain view-model the XAML DataTemplates bind to, and
    ///     group the rows by Build Set (<see cref="QueueItem.BuildSet"/>) into
    ///     collapsible groups with a stable per-group ("epic") color.
    ///   • Resolve each declared blocker to a dimmed ghost card, using the blocker's
    ///     REAL title/state when that blocker is itself a queue item in this snapshot.
    ///
    /// v1 scope / honest tradeoffs (see the issue #2135 bookend):
    ///   • READ-ONLY — no actions (restart/cancel/reply/drag). The real BuildQueuePanel
    ///     keeps owning all queue mutations; this is a design preview, not a replacement.
    ///   • Blocker liveness is the DECLARED-blocker + snapshot-cross-reference view, not
    ///     the live `gh`-open/closed check the Build Queue Map (#2110) performs. A blocker
    ///     is shown "cleared" only when the queue item it names has reached a terminal
    ///     state in this same snapshot; an external (non-queued) blocker is shown as still
    ///     holding (fail-closed), never silently as cleared.
    /// </summary>
    public partial class BuildQueueDesignWindow : Window
    {
        private readonly BuildQueuePostgresClient? _db;
        private readonly DispatcherTimer _timer;
        private bool _busy;

        /// <summary>Expand/collapse state survives a refresh (which rebuilds every VM), keyed
        /// by the group's normalized Build-Set name. New groups default to expanded.</summary>
        private readonly Dictionary<string, bool> _expanded = new(StringComparer.OrdinalIgnoreCase);

        // Statuses that are terminal / no longer "active in the queue" — hidden from the
        // canvas so it reflects the working set, like the real panel's active view.
        private static readonly HashSet<string> HiddenStatuses = new(StringComparer.OrdinalIgnoreCase)
        {
            "done", "canceled", "cancelled", BuildQueuePostgresClient.SupersededStatus,
        };

        // The #2126 accent/status tokens cycled to give each Build Set a distinct, stable
        // color. Named-resource keys only — no invented hex (issue #2135 constraint).
        private static readonly string[] GroupPalette =
        {
            "AccentBrush", "StatusRunningBrush", "StatusSuccessBrush",
            "StatusWarningBrush", "StatusErrorBrush",
        };

        public BuildQueueDesignWindow(BuildQueuePostgresClient? db)
        {
            InitializeComponent();
            _db = db;

            _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(6) };
            _timer.Tick += async (_, __) => await RefreshAsync();

            Loaded += async (_, __) =>
            {
                await RefreshAsync();
                if (AutoRefreshToggle.IsChecked == true) _timer.Start();
            };
            Closed += (_, __) => _timer.Stop();
        }

        private void AutoRefreshToggle_Changed(object sender, RoutedEventArgs e)
        {
            if (AutoRefreshToggle.IsChecked == true) _timer.Start();
            else _timer.Stop();
        }

        private async void BtnRefresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync();

        // ── Live pull ───────────────────────────────────────────────────────────────
        private async Task RefreshAsync()
        {
            if (_busy) return;
            if (_db == null)
            {
                ShowEmpty("Not connected to the build queue database — see Settings.");
                SummaryText.Text = "Not connected.";
                return;
            }

            _busy = true;
            try
            {
                var items = await _db.GetQueueAsync();
                Render(items);
            }
            catch (Exception ex)
            {
                ShowEmpty("Couldn't load the queue: " + ex.Message);
                SummaryText.Text = "Error loading queue.";
                ActivityLog.Log("build-queue-design", "refresh failed: " + ex.Message);
            }
            finally
            {
                _busy = false;
            }
        }

        // ── Project one snapshot into grouped view-models ─────────────────────────────
        private void Render(IReadOnlyList<QueueItem> allItems)
        {
            GeneratedText.Text = "Updated " + DateTime.Now.ToString("HH:mm:ss");

            // Index the whole snapshot by github_number so a declared blocker can be
            // resolved to the real queue item (and its real title/state) it names.
            var byNumber = new Dictionary<int, QueueItem>();
            foreach (var it in allItems)
                if (it.GithubNumber is int n && n > 0 && !byNumber.ContainsKey(n))
                    byNumber[n] = it;

            var visible = allItems.Where(i => !HiddenStatuses.Contains(i.Status ?? "")).ToList();

            if (visible.Count == 0)
            {
                GroupsList.ItemsSource = null;
                ShowEmpty("The build queue has no active items — nothing running, queued, blocked, or recently failed.");
                SummaryText.Text = $"{allItems.Count} total row(s) · none active.";
                return;
            }
            EmptyOverlay.Visibility = Visibility.Collapsed;

            // Group by Build Set, preserving first-seen (created_at ASC) order; Ungrouped last.
            var groupOrder = new List<string>();
            var buckets = new Dictionary<string, List<QueueItem>>(StringComparer.OrdinalIgnoreCase);
            foreach (var it in visible)
            {
                string key = NormalizeSet(it.BuildSet);
                if (!buckets.TryGetValue(key, out var list))
                {
                    list = new List<QueueItem>();
                    buckets[key] = list;
                    groupOrder.Add(key);
                }
                list.Add(it);
            }
            groupOrder.Sort((a, b) =>
            {
                bool au = a == UngroupedKey, bu = b == UngroupedKey;
                if (au != bu) return au ? 1 : -1;         // Ungrouped always last
                return groupOrder.IndexOf(a).CompareTo(groupOrder.IndexOf(b)); // stable otherwise
            });

            var groups = new List<BuildSetGroupVm>();
            int colorIdx = 0;
            foreach (var key in groupOrder)
            {
                var rows = buckets[key];
                bool ungrouped = key == UngroupedKey;
                Brush groupBrush = ungrouped
                    ? (Brush("TextSecondaryBrush") ?? Brushes.Gray)
                    : (Brush(GroupPalette[colorIdx++ % GroupPalette.Length]) ?? Brushes.CornflowerBlue);

                var cards = new ObservableCollection<QueueCardVm>(rows.Select(r => BuildCard(r, groupBrush, byNumber)));

                if (!_expanded.TryGetValue(key, out bool isExpanded)) isExpanded = true;

                int running = rows.Count(r => IsStatus(r, "running"));
                int blocked = cards.Count(c => c.HasBlockers && c.StatusLabel == "BLOCKED");
                string summary = $"{rows.Count} build{(rows.Count == 1 ? "" : "s")}";
                if (running > 0) summary += $" · {running} running";
                if (blocked > 0) summary += $" · {blocked} blocked";

                groups.Add(new BuildSetGroupVm(key, groupBrush, summary, cards, isExpanded,
                    exp => _expanded[key] = exp));
            }

            GroupsList.ItemsSource = groups;

            int totRunning = visible.Count(i => IsStatus(i, "running"));
            int totBlocked = groups.Sum(g => g.Items.Count(c => c.HasBlockers && c.StatusLabel == "BLOCKED"));
            int totVerifying = visible.Count(i => IsStatus(i, BuildQueuePostgresClient.VerifyingStatus));
            int totFailed = visible.Count(i => IsStatus(i, "failed"));
            SummaryText.Text =
                $"{visible.Count} active · {groups.Count} build set(s) · {totRunning} running · {totBlocked} blocked · {totVerifying} verifying · {totFailed} failed";
        }

        // ── One queue card VM ─────────────────────────────────────────────────────────
        private QueueCardVm BuildCard(QueueItem it, Brush groupBrush, IReadOnlyDictionary<int, QueueItem> byNumber)
        {
            var (statusLabel, statusBrush, isBlocked) = Classify(it, byNumber);

            string idLabel = it.GithubNumber is int g && g > 0 ? "#" + g : "Build " + it.Id;

            var meta = new List<string>();
            if (!string.IsNullOrWhiteSpace(it.Model)) meta.Add(ShortModel(it.Model!));
            if (!string.IsNullOrWhiteSpace(it.Effort)) meta.Add(it.Effort!);
            if (!string.IsNullOrWhiteSpace(it.Cli) && !string.Equals(it.Cli, "claude", StringComparison.OrdinalIgnoreCase))
                meta.Add(it.Cli!);
            if (!string.IsNullOrWhiteSpace(it.Account) && !string.Equals(it.Account, "primary", StringComparison.OrdinalIgnoreCase))
                meta.Add(it.Account!);
            if (IsStatus(it, "running") && it.BuildPid is int pid && pid > 0) meta.Add("pid " + pid);
            string metaLine = meta.Count > 0 ? string.Join("  ·  ", meta) : "--";

            // Blocker ghost cards — one per declared blocker, resolved to real title/state.
            var blockers = new List<BlockerVm>();
            var declared = (it.BlockedByNumbers != null && it.BlockedByNumbers.Count > 0)
                ? it.BlockedByNumbers
                : (it.BlockedByNumber is int bn ? new List<int> { bn } : new List<int>());
            foreach (var num in declared.Where(x => x > 0).Distinct())
            {
                if (byNumber.TryGetValue(num, out var blk))
                {
                    bool cleared = HiddenStatuses.Contains(blk.Status ?? "") || IsStatus(blk, "done");
                    blockers.Add(new BlockerVm(
                        "#" + num,
                        string.IsNullOrWhiteSpace(blk.Title) ? "(untitled)" : blk.Title,
                        cleared ? "cleared" : (blk.Status ?? "queued"),
                        cleared ? (Brush("StatusSuccessBrush") ?? Brushes.Green)
                                : (Brush("StatusWarningBrush") ?? Brushes.Goldenrod)));
                }
                else
                {
                    // External issue (not itself a queued build) — fail-closed as still holding.
                    blockers.Add(new BlockerVm("#" + num, "external issue", "waiting",
                        Brush("StatusWarningBrush") ?? Brushes.Goldenrod));
                }
            }

            return new QueueCardVm
            {
                IdLabel = idLabel,
                Title = string.IsNullOrWhiteSpace(it.Title) ? "(untitled)" : it.Title,
                StatusLabel = statusLabel,
                StatusBrush = statusBrush,
                AccentBrush = groupBrush,
                MetaLine = metaLine,
                CardOpacity = 1.0,
                Blockers = blockers,
            };
        }

        // ── Status classification → (label, brush, isBlocked) ─────────────────────────
        private (string label, Brush brush, bool blocked) Classify(
            QueueItem it, IReadOnlyDictionary<int, QueueItem> byNumber)
        {
            var s = it.Status ?? "queued";

            if (IsStatus(it, "running"))
                return ("RUNNING", Brush("StatusRunningBrush") ?? Brushes.LightBlue, false);
            if (IsStatus(it, BuildQueuePostgresClient.VerifyingStatus))
                return ("VERIFYING", Brush("StatusSuccessBrush") ?? Brushes.MediumSeaGreen, false);
            if (IsStatus(it, "failed"))
                return ("FAILED", Brush("StatusErrorBrush") ?? Brushes.IndianRed, false);
            if (IsStatus(it, AccountCapPolicy.CappedStatus))
                return ("CAPPED", Brush("StatusWarningBrush") ?? Brushes.Goldenrod, false);
            if (IsStatus(it, SessionLimitAutoRestartService.LimitPausedStatus))
                return ("LIMIT-PAUSED", Brush("StatusWarningBrush") ?? Brushes.Goldenrod, false);
            if (IsStatus(it, "parked"))
                return ("PARKED", Brush("TextSecondaryBrush") ?? Brushes.Gray, false);

            // queued (or any other pre-launch state): blocked if any declared blocker is
            // still holding (not terminal in this snapshot; external = fail-closed).
            bool blocked = AnyBlockerHolding(it, byNumber);
            if (blocked)
                return ("BLOCKED", Brush("StatusWarningBrush") ?? Brushes.Goldenrod, true);
            return ("QUEUED", Brush("AccentBrush") ?? Brushes.CornflowerBlue, false);
        }

        private bool AnyBlockerHolding(QueueItem it, IReadOnlyDictionary<int, QueueItem> byNumber)
        {
            var declared = (it.BlockedByNumbers != null && it.BlockedByNumbers.Count > 0)
                ? it.BlockedByNumbers
                : (it.BlockedByNumber is int bn ? new List<int> { bn } : new List<int>());
            foreach (var num in declared.Where(x => x > 0))
            {
                if (byNumber.TryGetValue(num, out var blk))
                {
                    if (!(HiddenStatuses.Contains(blk.Status ?? "") || IsStatus(blk, "done")))
                        return true;   // a queued/running blocker still holds
                }
                else
                {
                    return true;       // external blocker → fail-closed
                }
            }
            return false;
        }

        private static bool IsStatus(QueueItem it, string status)
            => string.Equals(it.Status, status, StringComparison.OrdinalIgnoreCase);

        private static string ShortModel(string model)
        {
            // "claude-opus-4-8" → "opus"; keep anything unrecognized as-is.
            var m = model.ToLowerInvariant();
            if (m.Contains("opus")) return "opus";
            if (m.Contains("sonnet")) return "sonnet";
            if (m.Contains("haiku")) return "haiku";
            if (m.Contains("fable")) return "fable";
            if (m.Contains("gemini")) return "gemini";
            return model;
        }

        private const string UngroupedKey = "Ungrouped";
        private static string NormalizeSet(string? buildSet)
            => string.IsNullOrWhiteSpace(buildSet) ? UngroupedKey : buildSet.Trim();

        private void ShowEmpty(string message)
        {
            EmptyOverlay.Text = message;
            EmptyOverlay.Visibility = Visibility.Visible;
        }

        private Brush? Brush(string key) => TryFindResource(key) as Brush;
    }

    // ════ View-models the XAML DataTemplates bind to (plain data, no visuals) ════

    /// <summary>One declared blocker rendered as a dimmed ghost card.</summary>
    public sealed class BlockerVm
    {
        public string NumberLabel { get; }
        public string TitleLabel { get; }
        public string StateLabel { get; }
        public Brush StateBrush { get; }
        public double GhostOpacity => 0.55;

        public BlockerVm(string numberLabel, string titleLabel, string stateLabel, Brush stateBrush)
        {
            NumberLabel = numberLabel;
            TitleLabel = titleLabel;
            StateLabel = stateLabel;
            StateBrush = stateBrush;
        }
    }

    /// <summary>One queue item as it appears on a card.</summary>
    public sealed class QueueCardVm
    {
        public string IdLabel { get; init; } = "";
        public string Title { get; init; } = "";
        public string StatusLabel { get; init; } = "";
        public Brush StatusBrush { get; init; } = Brushes.Gray;
        public Brush AccentBrush { get; init; } = Brushes.Gray;
        public string MetaLine { get; init; } = "";
        public double CardOpacity { get; init; } = 1.0;
        public IReadOnlyList<BlockerVm> Blockers { get; init; } = Array.Empty<BlockerVm>();
        public bool HasBlockers => Blockers.Count > 0;
    }

    /// <summary>One Build Set — a collapsible group of cards. IsExpanded notifies so the
    /// chevron's TwoWay binding toggles the card list in place, and pushes the new state
    /// back to the window so it survives the next refresh.</summary>
    public sealed class BuildSetGroupVm : INotifyPropertyChanged
    {
        public string Name { get; }
        public Brush AccentBrush { get; }
        public string SummaryLabel { get; }
        public ObservableCollection<QueueCardVm> Items { get; }

        private readonly Action<bool> _onExpandedChanged;
        private bool _isExpanded;
        public bool IsExpanded
        {
            get => _isExpanded;
            set
            {
                if (_isExpanded == value) return;
                _isExpanded = value;
                _onExpandedChanged(value);
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsExpanded)));
            }
        }

        public event PropertyChangedEventHandler? PropertyChanged;

        public BuildSetGroupVm(string name, Brush accentBrush, string summaryLabel,
            ObservableCollection<QueueCardVm> items, bool isExpanded, Action<bool> onExpandedChanged)
        {
            Name = name;
            AccentBrush = accentBrush;
            SummaryLabel = summaryLabel;
            Items = items;
            _isExpanded = isExpanded;
            _onExpandedChanged = onExpandedChanged;
        }
    }
}
