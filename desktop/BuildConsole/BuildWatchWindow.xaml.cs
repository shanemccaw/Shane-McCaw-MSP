using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #980 — Shane: "This should be a floaty panel so I can put it off to
    /// another monitor and watch as it progresses... I can have 8 total builds
    /// running at once... 8 squares each can contain a build output... When one
    /// is done... a green overlay or something around the completed one... I can
    /// look go yep cool and click a button... if a build comes in and 8 are
    /// there, you replace the oldest done one automatically. If the Git issue
    /// closes, then it should auto disappear."
    ///
    /// An independent, resizable, draggable-to-any-monitor top-level window (not
    /// docked in MainWindow). It watches the shared build queue and mirrors each
    /// live build into one of 8 slots, streaming that build's real output by
    /// reusing the existing #802/#825 per-item log-tail convention
    /// (<see cref="BuildLogPaths.ForQueueItem"/>) — no new streaming mechanism.
    ///
    /// COMPLETION DETECTION — the #943-informed reliable signal:
    /// #943 proved the queue's own Status field can lie: a second BuildConsole
    /// instance's startup orphan-sweep could stamp a still-running job
    /// `failed` with the sentinel `exitCode == -2` while its real process kept
    /// running. So this panel does NOT badge a slot "done/failed" on Status
    /// alone — a `failed`/`canceled` row carrying exit code
    /// <see cref="OrphanSweepSentinelExitCode"/> (-2) is treated as still
    /// running ("VERIFYING…") until a genuine terminal result lands.
    /// QueueWatcherService.TickAsync overwrites the bogus -2 with the true exit
    /// code once the process actually exits, and the next poll picks up the real
    /// result. Likewise, an item vanishing from the queue is NOT treated as
    /// completion (#943's "939 is still running but it's not showing in the
    /// queue"): the slot goes to a STALE state, keeps tailing its log, and only
    /// Shane can dismiss it — it is never auto-evicted, because we can't be sure
    /// it finished.
    /// </summary>
    public partial class BuildWatchWindow : Window
    {
        /// <summary>Git #943 — QueueWatcherService.RecoverOrphanedRunningItemsAsync marks orphan-swept rows failed with this exact sentinel. It is a KNOWN false-failure marker, never a real process exit code, so a slot carrying it is held as still-running rather than badged complete.</summary>
        private const int OrphanSweepSentinelExitCode = -2;

        private const int SlotCount = 8;
        private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(3);
        /// <summary>Issue-closure is checked every Nth poll tick (≈30s at a 3s poll) — a `gh` process spawn per check is heavier than the in-memory queue reconcile, so it runs less often.</summary>
        private const int IssueCheckEveryNTicks = 10;

        private enum SlotState { Empty, Running, Done, Failed, Stale }

        private sealed class BuildWatchSlot
        {
            // Visual tree (built once in BuildSlotVisual)
            public Border Container = null!;
            public Grid ContentGrid = null!;
            public TextBlock EmptyText = null!;
            public TextBlock HeaderText = null!;
            public Border BadgeChip = null!;
            public TextBlock BadgeText = null!;
            public Button DismissButton = null!;

            // #1004 display redesign — the raw streaming TextBox is replaced by a
            // scrolling list of per-event chat cards plus a live "thinking" row.
            /// <summary>Scrolls the event-card stack; pinned to the bottom as new cards land.</summary>
            public ScrollViewer EventsScroll = null!;
            /// <summary>Holds one colour-coded Border card per real event (assistant text, tool call, result, error).</summary>
            public StackPanel EventsPanel = null!;
            /// <summary>The animated "thinking" row (spinning arc + activity text) shown only while the build is live.</summary>
            public Border ThinkingIndicator = null!;
            public TextBlock ThinkingText = null!;
            /// <summary>The rotating arc; its Angle is animated forever while running and cleared on a terminal state.</summary>
            public RotateTransform SpinnerTransform = null!;
            public Ellipse SpinnerRing = null!;
            /// <summary>Carries a partial trailing line between byte-delta tail reads so a card is only emitted on a full line.</summary>
            public string LineBuffer = "";
            /// <summary>Last time a real event card landed — drives "longer-running wait" idle detection for the easter egg.</summary>
            public DateTime LastOutputUtc;
            /// <summary>While now &lt; this, a rolled easter-egg phrase is left on screen instead of being overwritten each poll.</summary>
            public DateTime EasterEggUntilUtc;

            // Live state
            public bool Occupied;
            public int QueueItemId;
            public int? GithubNumber;
            public string Title = "";
            public SlotState State = SlotState.Empty;
            /// <summary>True while a Running slot is actually the #943 "VERIFYING…" hold (queue said failed with the -2 sentinel). Drives the spinner colour and activity text.</summary>
            public bool Verifying;
            /// <summary>Set when the slot goes terminal (Done/Failed) — drives "oldest completed" eviction ordering. Null while Running/Stale (Stale is deliberately not a confirmed completion).</summary>
            public DateTime? CompletedAtUtc;
            public long TailedLength;
        }

        private readonly BuildTrackerApiClient? _api;
        private readonly List<BuildWatchSlot> _slots = new();
        /// <summary>Running builds that couldn't get a slot because all 8 are occupied by still-running builds (nothing completed to evict). Rebuilt every reconcile; drives the waiting banner only. See AdmitNewRunning for the "never force-evict a running build" decision.</summary>
        private readonly List<QueueItem> _waiting = new();
        private DispatcherTimer? _pollTimer;
        private int _ticksSinceIssueCheck;
        private bool _polling;
        private List<QueueItem> _lastQueue = new();

        // Theme brushes (resolved once)
        private readonly Brush _green;
        private readonly Brush _red;
        private readonly Brush _blue;
        private readonly Brush _yellow;
        private readonly Brush _peach;
        private readonly Brush _mauve;
        private readonly Brush _cardBg;      // Surface0 — the shared card fill
        private readonly Brush _cardText;    // TextBrush — primary readable text
        private readonly Brush _cardSubtext; // Subtext1 — muted meta text
        private readonly Brush _emptyBorder;
        private readonly Brush _runningBorder;
        private readonly Brush _badgeText;
        private bool _loaded;

        /// <summary>#1004 easter egg — during a longer-running quiet stretch, the activity line occasionally reads
        /// "Reticulating splines…" (Shane's nod to The Sims) instead of the plain "thinking…", plus a few sibling
        /// whimsies for variety. Weighted so the Sims classic is the one that surfaces most.</summary>
        private static readonly string[] EasterEggPhrases =
        {
            "Reticulating splines…",
            "Reticulating splines…",
            "Reticulating splines…",
            "Herding llamas…",
            "Generating witty dialog…",
            "Warming up the flux capacitor…",
            "Adjusting bell curves…",
            "Composing epic poem about your build…",
        };
        /// <summary>Cheap per-window RNG for the easter-egg roll. (Not Math.random — this is C#; System.Random is fine.)</summary>
        private readonly Random _rng = new();

        public BuildWatchWindow(BuildTrackerApiClient? api)
        {
            InitializeComponent();
            _api = api;

            _green = (Brush)FindResource("GreenBrush");
            _red = (Brush)FindResource("RedBrush");
            _blue = (Brush)FindResource("BlueBrush");
            _yellow = (Brush)FindResource("YellowBrush");
            _peach = (Brush)FindResource("PeachBrush");
            _mauve = (Brush)FindResource("MauveBrush");
            _cardBg = (Brush)FindResource("Surface0Brush");
            _cardText = (Brush)FindResource("TextBrush");
            _cardSubtext = (Brush)FindResource("Subtext1Brush");
            _emptyBorder = (Brush)FindResource("Surface0Brush");
            _runningBorder = (Brush)FindResource("Surface2Brush");
            _badgeText = (Brush)FindResource("CrustBrush");

            for (int i = 0; i < SlotCount; i++)
            {
                var slot = new BuildWatchSlot();
                BuildSlotVisual(slot);
                _slots.Add(slot);
                SlotGrid.Children.Add(slot.Container);
            }

            ReflowSlotGrid(); // 0 active → 1x1 full-window empty state to start

            RestoreWindowBounds();

            Loaded += (s, e) =>
            {
                _loaded = true;
                UpdateSubtitle();
                if (_api == null || !_api.IsConfigured)
                {
                    Subtitle.Text = "Build Tracker not configured — nothing to watch.";
                    return;
                }
                _pollTimer = new DispatcherTimer { Interval = PollInterval };
                _pollTimer.Tick += async (_, _) => await PollAsync();
                _pollTimer.Start();
                _ = PollAsync();
            };
            Closed += (s, e) => _pollTimer?.Stop();
            LocationChanged += (s, e) => PersistBounds();
            SizeChanged += (s, e) => PersistBounds();
        }

        // ── Slot visual construction ────────────────────────────────────────

        private void BuildSlotVisual(BuildWatchSlot slot)
        {
            slot.Container = new Border
            {
                Margin = new Thickness(4),
                CornerRadius = new CornerRadius(6),
                BorderBrush = _emptyBorder,
                BorderThickness = new Thickness(1),
                Background = (Brush)FindResource("MantleBrush"),
            };

            var grid = new Grid();

            // Empty-state placeholder (shown until a build occupies the slot)
            slot.EmptyText = new TextBlock
            {
                Text = "empty",
                FontSize = 12,
                Foreground = (Brush)FindResource("OverlayBrush"),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };
            grid.Children.Add(slot.EmptyText);

            // Occupied content: header row, streaming output, footer with dismiss
            slot.ContentGrid = new Grid { Visibility = Visibility.Collapsed };
            slot.ContentGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            slot.ContentGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            slot.ContentGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // Header (title + status badge), doubles as a tinted strip
            var header = new Border
            {
                Background = (Brush)FindResource("CrustBrush"),
                CornerRadius = new CornerRadius(5, 5, 0, 0),
                Padding = new Thickness(7, 4, 6, 4),
            };
            var headerGrid = new Grid();
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            slot.HeaderText = new TextBlock
            {
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("TextBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(slot.HeaderText, 0);
            headerGrid.Children.Add(slot.HeaderText);

            slot.BadgeText = new TextBlock
            {
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                Foreground = _badgeText,
                VerticalAlignment = VerticalAlignment.Center,
            };
            slot.BadgeChip = new Border
            {
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(6, 1, 6, 1),
                Margin = new Thickness(6, 0, 0, 0),
                Background = _blue,
                Child = slot.BadgeText,
            };
            Grid.SetColumn(slot.BadgeChip, 1);
            headerGrid.Children.Add(slot.BadgeChip);
            header.Child = headerGrid;
            Grid.SetRow(header, 0);
            slot.ContentGrid.Children.Add(header);

            // Streaming output — #1004 redesign. The raw byte tail (still the same
            // per-item log the main window's chat-tab pane uses, see TailSlotLog) is
            // now parsed into one colour-coded chat card per real event, stacked in a
            // ScrollViewer, with a live animated "thinking" row pinned underneath.
            var body = new Grid { Background = (Brush)FindResource("BaseBrush") };
            body.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            body.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            slot.EventsPanel = new StackPanel { Margin = new Thickness(8, 8, 8, 4) };
            slot.EventsScroll = new ScrollViewer
            {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                Content = slot.EventsPanel,
            };
            Grid.SetRow(slot.EventsScroll, 0);
            body.Children.Add(slot.EventsScroll);

            slot.ThinkingIndicator = BuildThinkingIndicator(slot);
            Grid.SetRow(slot.ThinkingIndicator, 1);
            body.Children.Add(slot.ThinkingIndicator);

            Grid.SetRow(body, 1);
            slot.ContentGrid.Children.Add(body);

            // Footer: the "yep cool" dismiss button (only shown on a terminal slot)
            slot.DismissButton = new Button
            {
                Content = "Dismiss",
                Style = (Style)FindResource("IconButton"),
                Padding = new Thickness(10, 3, 10, 3),
                Margin = new Thickness(0, 4, 0, 0),
                HorizontalAlignment = HorizontalAlignment.Right,
                Visibility = Visibility.Collapsed,
                ToolTip = "Clear this completed build and free the slot",
            };
            slot.DismissButton.Click += (s, e) =>
            {
                ClearSlot(slot, "dismissed");
                // Fill the freed slot right away from anything that was waiting,
                // instead of making Shane wait for the next poll tick.
                AdmitNewRunning(_lastQueue);
                UpdateWaitingBanner();
                UpdateSubtitle();
            };
            Grid.SetRow(slot.DismissButton, 2);
            slot.ContentGrid.Children.Add(slot.DismissButton);

            grid.Children.Add(slot.ContentGrid);
            slot.Container.Child = grid;
        }

        // ── #1004 "thinking" indicator (genuinely animated) ─────────────────

        /// <summary>
        /// Builds the live activity row shown while a build is running: a continuously
        /// spinning arc (a 3/4 stroked ring rotated forever — real motion, not a static
        /// glyph) beside an activity text line. The spinner's rotation is started/stopped
        /// and its colour set by StartSpinner/StopSpinner as the slot changes state.
        /// </summary>
        private Border BuildThinkingIndicator(BuildWatchSlot slot)
        {
            // A stroked ellipse with a dashed outline that leaves ~1/4 of the ring
            // open, rotated forever, reads as the classic "working" spinner. Dash
            // units are multiples of StrokeThickness; circumference ≈ π·16/2.6 ≈ 19.3
            // of those, so a ~14.5/4.8 dash/gap leaves roughly a quarter open.
            slot.SpinnerTransform = new RotateTransform(0, 8, 8);
            slot.SpinnerRing = new Ellipse
            {
                Width = 16,
                Height = 16,
                Stroke = _blue,
                StrokeThickness = 2.6,
                StrokeDashCap = PenLineCap.Round,
                StrokeDashArray = new DoubleCollection { 14.5, 4.8 },
                RenderTransform = slot.SpinnerTransform,
                VerticalAlignment = VerticalAlignment.Center,
            };

            slot.ThinkingText = new TextBlock
            {
                Text = "starting…",
                FontSize = 13.5,
                Foreground = _cardSubtext,
                FontStyle = FontStyles.Italic,
                Margin = new Thickness(9, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };

            var row = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            row.Children.Add(slot.SpinnerRing);
            row.Children.Add(slot.ThinkingText);

            return new Border
            {
                Background = _cardBg,
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(10, 6, 12, 6),
                Margin = new Thickness(8, 2, 8, 8),
                HorizontalAlignment = HorizontalAlignment.Left,
                Visibility = Visibility.Collapsed,
                Child = row,
            };
        }

        /// <summary>Shows the thinking row and starts the arc spinning (blue = running, yellow = #943 verifying).</summary>
        private void StartSpinner(BuildWatchSlot slot, bool verifying)
        {
            slot.SpinnerRing.Stroke = verifying ? _yellow : _blue;
            slot.ThinkingIndicator.Visibility = Visibility.Visible;
            var anim = new DoubleAnimation(0, 360, new Duration(TimeSpan.FromSeconds(0.9)))
            {
                RepeatBehavior = RepeatBehavior.Forever,
            };
            slot.SpinnerTransform.BeginAnimation(RotateTransform.AngleProperty, anim);
        }

        /// <summary>Stops the arc and hides the thinking row (used on every terminal / stale / cleared state).</summary>
        private static void StopSpinner(BuildWatchSlot slot)
        {
            slot.SpinnerTransform.BeginAnimation(RotateTransform.AngleProperty, null);
            slot.ThinkingIndicator.Visibility = Visibility.Collapsed;
        }

        /// <summary>
        /// Refreshes the activity line while a slot is running. Normally alternates between
        /// "working…" (output landed recently) and "thinking…" (a quiet stretch). During a
        /// longer quiet stretch it occasionally — rarely, by a low-probability roll — swaps in
        /// an easter-egg phrase ("Reticulating splines…" and friends) and pins it briefly so it
        /// doesn't flicker away on the very next poll. Called once per poll tick per running slot.
        /// </summary>
        private void UpdateThinkingText(BuildWatchSlot slot, bool verifying)
        {
            if (verifying)
            {
                slot.ThinkingText.Text = "verifying…";
                return;
            }

            var now = DateTime.UtcNow;
            if (now < slot.EasterEggUntilUtc) return; // let a rolled easter egg linger

            var idle = now - slot.LastOutputUtc;
            if (idle < TimeSpan.FromSeconds(6))
            {
                slot.ThinkingText.Text = "working…";
                return;
            }

            // A genuinely longer-running wait — the rare, surprising moment.
            if (_rng.NextDouble() < 0.12)
            {
                slot.ThinkingText.Text = EasterEggPhrases[_rng.Next(EasterEggPhrases.Length)];
                slot.EasterEggUntilUtc = now + TimeSpan.FromSeconds(9);
            }
            else
            {
                slot.ThinkingText.Text = "thinking…";
            }
        }

        // ── #1004 event-card rendering ──────────────────────────────────────

        private static readonly Regex ToolTokenRegex = new(@"\[tool:\s*([^\]]+)\]", RegexOptions.Compiled);

        /// <summary>Distinguishes obvious stderr / error lines (folded in raw by the watcher) so they get a red card,
        /// while staying tight enough not to redden ordinary assistant prose that merely mentions the word "error".</summary>
        private static bool LooksLikeError(string line)
        {
            return Regex.IsMatch(line,
                @"^\s*(error\b|error:|exception\b|fatal:|panic:|traceback|npm ERR!|unhandled|\bat\s+\S+\(|\w+Error:|\w+Exception:)",
                RegexOptions.IgnoreCase);
        }

        /// <summary>
        /// Classifies one completed log line into an event and appends the matching card:
        ///   • "--- done … ---"  → green result card
        ///   • obvious stderr    → red error card
        ///   • text with [tool:] → the prose becomes an assistant card and each tool marker its own mauve tool chip
        ///   • anything else     → a blue-accented assistant text card
        /// Distinct accent + text colour per type satisfies the colour-coding requirement, all from the existing palette.
        /// </summary>
        private void AppendEventCard(BuildWatchSlot slot, string rawLine)
        {
            var line = rawLine.TrimEnd();
            if (line.Length == 0) return;

            if (line.StartsWith("--- done", StringComparison.Ordinal))
            {
                var label = line.Trim('-', ' ');
                AddEventBubble(slot, string.IsNullOrWhiteSpace(label) ? "done" : label, _green, _green, mono: false, glyph: "✓");
                return;
            }

            if (LooksLikeError(line))
            {
                AddEventBubble(slot, line, _red, _red, mono: true, glyph: "⚠");
                return;
            }

            var matches = ToolTokenRegex.Matches(line);
            if (matches.Count == 0)
            {
                AddEventBubble(slot, line, _blue, _cardText, mono: false, glyph: null);
                return;
            }

            // Split "text [tool: X] more text" into prose card(s) + tool chip(s) in order.
            int cursor = 0;
            foreach (Match m in matches)
            {
                var before = line.Substring(cursor, m.Index - cursor).Trim();
                if (before.Length > 0)
                    AddEventBubble(slot, before, _blue, _cardText, mono: false, glyph: null);

                var toolName = m.Groups[1].Value.Trim();
                AddEventBubble(slot, toolName, _mauve, _mauve, mono: false, glyph: "⚙");
                // A tool call is fresh activity, and worth reflecting live in the spinner row.
                slot.LastOutputUtc = DateTime.UtcNow;
                if (slot.State == SlotState.Running)
                    slot.ThinkingText.Text = $"running {toolName}…";

                cursor = m.Index + m.Length;
            }
            var after = line.Substring(cursor).Trim();
            if (after.Length > 0)
                AddEventBubble(slot, after, _blue, _cardText, mono: false, glyph: null);
        }

        /// <summary>The maximum number of event cards kept per slot — older cards fall off the top so a very long
        /// build can't grow the visual tree without bound (the old TextBox had the same effect via its own buffer).</summary>
        private const int MaxCardsPerSlot = 200;

        /// <summary>
        /// Builds one chat card: a rounded Border (reusing the app's Surface0 card fill and CornerRadius idiom) with a
        /// coloured left accent bar and a wrapping TextBlock at a readable 14.5px, then appends it and pins the scroll.
        /// </summary>
        private void AddEventBubble(BuildWatchSlot slot, string text, Brush accent, Brush textBrush, bool mono, string? glyph)
        {
            var body = new TextBlock
            {
                Text = glyph == null ? text : $"{glyph}  {text}",
                Foreground = textBrush,
                FontSize = 14.5,
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 19,
                VerticalAlignment = VerticalAlignment.Center,
            };
            if (mono) body.FontFamily = new FontFamily("Cascadia Mono, Consolas");
            if (ReferenceEquals(accent, _mauve) || ReferenceEquals(accent, _green))
                body.FontWeight = FontWeights.SemiBold;

            var card = new Border
            {
                Background = _cardBg,
                CornerRadius = new CornerRadius(4, 10, 10, 10),
                BorderBrush = accent,
                BorderThickness = new Thickness(3, 0, 0, 0), // coloured left accent bar = event type
                Padding = new Thickness(10, 7, 10, 7),
                Margin = new Thickness(0, 0, 0, 6),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                Child = body,
            };

            slot.EventsPanel.Children.Add(card);
            while (slot.EventsPanel.Children.Count > MaxCardsPerSlot)
                slot.EventsPanel.Children.RemoveAt(0);

            slot.LastOutputUtc = DateTime.UtcNow;
            slot.EventsScroll.ScrollToEnd();
        }

        // ── Poll / reconcile ────────────────────────────────────────────────

        private async Task PollAsync()
        {
            if (_api == null || !_api.IsConfigured) return;
            if (_polling) return; // a slow gh/HTTP tick shouldn't stack on the next
            _polling = true;
            try
            {
                List<QueueItem> queue;
                try { queue = await _api.GetQueueAsync(); }
                catch { return; } // transient failure — keep the last state on screen
                _lastQueue = queue;

                var byId = queue.GroupBy(q => q.Id).ToDictionary(g => g.Key, g => g.First());

                // 1) Update every occupied slot from this snapshot.
                foreach (var slot in _slots.Where(s => s.Occupied))
                {
                    if (byId.TryGetValue(slot.QueueItemId, out var item))
                    {
                        ApplyItemStatusToSlot(slot, item);
                    }
                    else
                    {
                        // #943: gone from the queue is NOT proof of completion —
                        // the real process may still be alive. Mark Stale (kept,
                        // manually dismissable, never auto-evicted) and keep
                        // tailing its log in case it's still writing.
                        if (slot.State != SlotState.Stale) SetSlotState(slot, SlotState.Stale, null);
                    }
                    TailSlotLog(slot);
                    if (slot.State == SlotState.Running)
                        UpdateThinkingText(slot, slot.Verifying); // refresh activity line / roll the easter egg
                }

                // 2) Admit newly-running builds into free / oldest-completed slots.
                AdmitNewRunning(queue);

                // 3) Throttled: auto-remove any slot whose GitHub issue has closed.
                if (_ticksSinceIssueCheck++ >= IssueCheckEveryNTicks)
                {
                    _ticksSinceIssueCheck = 0;
                    await CheckIssueClosuresAsync();
                }

                UpdateWaitingBanner();
                UpdateSubtitle();
            }
            finally
            {
                _polling = false;
            }
        }

        /// <summary>Maps a queue item's server-side status onto its slot, applying the #943 reliability guards (see class doc). </summary>
        private void ApplyItemStatusToSlot(BuildWatchSlot slot, QueueItem item)
        {
            switch (item.Status)
            {
                case "done":
                    SetSlotState(slot, SlotState.Done, item.ExitCode);
                    break;
                case "failed":
                case "canceled":
                    // #943 GUARD: -2 is the orphan-sweep sentinel, a known
                    // false-failure that a second instance can stamp on a still
                    // -running job. Hold the slot as running ("VERIFYING…") until
                    // a real terminal result replaces it — never badge it failed
                    // or make it eligible for oldest-completed eviction.
                    if (item.ExitCode == OrphanSweepSentinelExitCode)
                        SetSlotState(slot, SlotState.Running, null, verifying: true);
                    else
                        SetSlotState(slot, SlotState.Failed, item.ExitCode);
                    break;
                case "running":
                case "queued":
                default:
                    SetSlotState(slot, SlotState.Running, null);
                    break;
            }
        }

        private void SetSlotState(BuildWatchSlot slot, SlotState newState, int? exitCode, bool verifying = false)
        {
            bool changed = slot.State != newState;
            slot.State = newState;

            switch (newState)
            {
                case SlotState.Running:
                    slot.Verifying = verifying;
                    slot.Container.BorderBrush = _runningBorder;
                    slot.Container.BorderThickness = new Thickness(1);
                    slot.BadgeChip.Background = verifying ? _yellow : _blue;
                    slot.BadgeText.Text = verifying ? "VERIFYING…" : "RUNNING";
                    slot.BadgeChip.ToolTip = verifying
                        ? "Queue reported failed with the #943 orphan-sweep sentinel (exit -2) — holding as running until a real exit code lands."
                        : null;
                    slot.DismissButton.Visibility = Visibility.Collapsed;
                    slot.CompletedAtUtc = null;
                    StartSpinner(slot, verifying); // genuinely alive while the build runs
                    if (changed) UpdateThinkingText(slot, verifying);
                    break;

                case SlotState.Done:
                    slot.Verifying = false;
                    slot.Container.BorderBrush = _green;
                    slot.Container.BorderThickness = new Thickness(3); // the "green overlay around the completed one"
                    slot.BadgeChip.Background = _green;
                    slot.BadgeChip.ToolTip = null;
                    slot.BadgeText.Text = exitCode.HasValue ? $"DONE ✓ (exit {exitCode})" : "DONE ✓";
                    slot.DismissButton.Visibility = Visibility.Visible;
                    slot.CompletedAtUtc ??= DateTime.UtcNow;
                    StopSpinner(slot);
                    break;

                case SlotState.Failed:
                    slot.Verifying = false;
                    slot.Container.BorderBrush = _red;
                    slot.Container.BorderThickness = new Thickness(3);
                    slot.BadgeChip.Background = _red;
                    slot.BadgeChip.ToolTip = null;
                    slot.BadgeText.Text = exitCode.HasValue ? $"FAILED (exit {exitCode})" : "FAILED";
                    slot.DismissButton.Visibility = Visibility.Visible;
                    slot.CompletedAtUtc ??= DateTime.UtcNow;
                    StopSpinner(slot);
                    break;

                case SlotState.Stale:
                    slot.Verifying = false;
                    slot.Container.BorderBrush = _peach;
                    slot.Container.BorderThickness = new Thickness(2);
                    slot.BadgeChip.Background = _peach;
                    slot.BadgeChip.ToolTip = "This build's queue row disappeared while it was running — its process may still be alive (see #943). Not treated as done; dismiss it yourself when you're sure.";
                    slot.BadgeText.Text = "NOT IN QUEUE";
                    slot.DismissButton.Visibility = Visibility.Visible;
                    slot.CompletedAtUtc = null; // deliberately not a confirmed completion
                    StopSpinner(slot);
                    break;
            }

            if (changed && newState is SlotState.Done or SlotState.Failed)
            {
                ActivityLog.Log("build-watch",
                    $"completed: {slot.Title} (queue #{slot.QueueItemId}, {newState.ToString().ToLowerInvariant()}{(exitCode.HasValue ? $", exit {exitCode}" : "")})");
            }
        }

        /// <summary>
        /// Admits every currently-running build that isn't already on screen. Slot
        /// choice per new build: (1) an empty slot, else (2) the OLDEST completed
        /// slot (auto-evicted), else (3) — all 8 occupied by still-running builds
        /// with nothing completed to evict — it WAITS. This is the explicit
        /// edge-case decision for "more than 8 builds running at once": we never
        /// force-evict a still-running slot to make room; the 9th+ build sits in
        /// the waiting list (shown in the banner) and is admitted the instant a
        /// slot frees (a completion + dismiss/auto-evict, or an issue-close
        /// removal). Consequence, documented honestly: if all 8 stay busy until a
        /// waiting build finishes, that build may complete without ever getting a
        /// square here — its result is still recorded in the queue/BuildQueuePanel
        /// as always; only the live *watch* is skipped.
        /// </summary>
        private void AdmitNewRunning(List<QueueItem> queue)
        {
            var occupied = new HashSet<int>(_slots.Where(s => s.Occupied).Select(s => s.QueueItemId));

            // Order by Id asc: queue ids increase with creation, so older builds
            // get a slot first — a stable, deterministic ordering.
            var pending = queue
                .Where(q => q.Status == "running" && !occupied.Contains(q.Id))
                .OrderBy(q => q.Id)
                .ToList();

            _waiting.Clear();

            foreach (var item in pending)
            {
                var target = FindEmptySlot();
                if (target == null)
                {
                    var oldest = FindOldestCompletedSlot();
                    if (oldest == null)
                    {
                        // No empty slot and nothing completed to evict — wait.
                        _waiting.Add(item);
                        continue;
                    }
                    ActivityLog.Log("build-watch",
                        $"auto-evicted oldest completed: {oldest.Title} (queue #{oldest.QueueItemId}) to admit {SafeTitle(item)} (queue #{item.Id})");
                    target = oldest;
                }
                OccupySlot(target, item);
            }
        }

        private BuildWatchSlot? FindEmptySlot() => _slots.FirstOrDefault(s => !s.Occupied);

        /// <summary>The oldest genuinely-completed (Done/Failed) slot — Stale/Running/Verifying slots are never auto-evicted (they aren't confirmed done).</summary>
        private BuildWatchSlot? FindOldestCompletedSlot() => _slots
            .Where(s => s.Occupied && s.CompletedAtUtc.HasValue && (s.State == SlotState.Done || s.State == SlotState.Failed))
            .OrderBy(s => s.CompletedAtUtc!.Value)
            .FirstOrDefault();

        private void OccupySlot(BuildWatchSlot slot, QueueItem item)
        {
            slot.Occupied = true;
            slot.QueueItemId = item.Id;
            slot.GithubNumber = item.GithubNumber;
            slot.Title = SafeTitle(item);
            slot.CompletedAtUtc = null;
            slot.TailedLength = 0;
            slot.Verifying = false;
            slot.LineBuffer = "";
            slot.LastOutputUtc = DateTime.UtcNow;
            slot.EasterEggUntilUtc = DateTime.MinValue;
            slot.EventsPanel.Children.Clear();
            slot.ThinkingText.Text = "starting…";
            slot.EmptyText.Visibility = Visibility.Collapsed;
            slot.ContentGrid.Visibility = Visibility.Visible;
            slot.HeaderText.Text = slot.GithubNumber.HasValue ? $"#{slot.GithubNumber}  {slot.Title}" : slot.Title;
            slot.HeaderText.ToolTip = slot.HeaderText.Text;
            SetSlotState(slot, SlotState.Running, null);
            TailSlotLog(slot);
            ReflowSlotGrid(); // occupancy grew — resize the grid to fit
            ActivityLog.Log("build-watch",
                $"occupied slot: {slot.Title} (queue #{item.Id}{(slot.GithubNumber.HasValue ? $", GH #{slot.GithubNumber}" : "")})");
        }

        private void ClearSlot(BuildWatchSlot slot, string reason)
        {
            if (!slot.Occupied) return;
            ActivityLog.Log("build-watch", $"{reason}: {slot.Title} (queue #{slot.QueueItemId})");
            slot.Occupied = false;
            slot.QueueItemId = 0;
            slot.GithubNumber = null;
            slot.Title = "";
            slot.State = SlotState.Empty;
            slot.CompletedAtUtc = null;
            slot.TailedLength = 0;
            slot.Verifying = false;
            slot.LineBuffer = "";
            StopSpinner(slot);
            slot.EventsPanel.Children.Clear();
            slot.HeaderText.ToolTip = null;
            slot.BadgeChip.ToolTip = null;
            slot.ContentGrid.Visibility = Visibility.Collapsed;
            slot.EmptyText.Visibility = Visibility.Visible;
            slot.Container.BorderBrush = _emptyBorder;
            slot.Container.BorderThickness = new Thickness(1);
            ReflowSlotGrid(); // occupancy shrank — resize the grid to fit
        }

        // ── Dynamic slot-grid sizing (Git #980) ─────────────────────────────

        /// <summary>
        /// Recomputes SlotGrid.Rows/Columns from the real current count of active
        /// (occupied) slots and packs the occupied slot visuals to the front of the
        /// UniformGrid, re-applied on every occupancy change. So the window shows
        /// exactly as many squares as there are live builds instead of a fixed 2x4:
        ///   1 → 1x1 (a single build fills the whole window)
        ///   2 → 1x2 (side-by-side split)
        ///   3-4 → 2x2 (quad)
        ///   5-6 → 2x3
        ///   7-8 → 2x4 (today's fixed layout — now only the true max)
        /// A UniformGrid lays its children row-major across exactly Rows×Columns
        /// cells, so any slot beyond that count falls outside the visible area.
        /// The 8 slot visuals are created once and never destroyed, but a slot can
        /// be freed at any index (dismiss / auto-evict / issue-close), so we reorder
        /// the child collection to put the occupied slots first (in stable _slots
        /// order) — that guarantees every live build stays on screen no matter which
        /// physical slot index it holds, while the empty slots are the ones that
        /// fall out of the shrunk grid. Idempotent: the child collection is only
        /// mutated when the desired order actually differs from the current one.
        /// </summary>
        private void ReflowSlotGrid()
        {
            int active = _slots.Count(s => s.Occupied);
            var (rows, cols) = GridDimsForActiveCount(active);

            // Desired order: occupied slots first (stable _slots order), then empties.
            var desired = _slots.Where(s => s.Occupied).Select(s => s.Container)
                .Concat(_slots.Where(s => !s.Occupied).Select(s => s.Container))
                .ToList();

            bool orderChanged = SlotGrid.Children.Count != desired.Count;
            if (!orderChanged)
            {
                for (int i = 0; i < desired.Count; i++)
                {
                    if (!ReferenceEquals(SlotGrid.Children[i], desired[i])) { orderChanged = true; break; }
                }
            }
            if (orderChanged)
            {
                SlotGrid.Children.Clear();
                foreach (var c in desired) SlotGrid.Children.Add(c);
            }

            if (SlotGrid.Rows != rows) SlotGrid.Rows = rows;
            if (SlotGrid.Columns != cols) SlotGrid.Columns = cols;
        }

        /// <summary>
        /// The (rows, columns) the slot grid should use for a given active-slot
        /// count. 0 active collapses to 1x1 (a single full-window "empty" square)
        /// rather than an empty grid; anything above the 8-slot max is clamped to
        /// the 2x4 ceiling as a safety net.
        /// </summary>
        private static (int rows, int cols) GridDimsForActiveCount(int active) => active switch
        {
            <= 1 => (1, 1),
            2 => (1, 2),
            <= 4 => (2, 2),
            <= 6 => (2, 3),
            _ => (2, 4), // 7-8 (and any overflow) → the true max
        };

        /// <summary>
        /// Reuses the exact per-item log-tail convention the main window's chat-tab
        /// build pane already uses (#802/#825): the watcher writes each build's
        /// live output to BuildLogPaths.ForQueueItem(id); this appends only the
        /// bytes grown since last tick. Same FileShare.ReadWrite + swallow-on-lock
        /// approach so a mid-write lock just retries next tick. Stale slots keep
        /// tailing too — a #943-style "vanished but still running" build keeps
        /// streaming.
        /// </summary>
        private void TailSlotLog(BuildWatchSlot slot)
        {
            if (!slot.Occupied) return;
            var path = BuildLogPaths.ForQueueItem(slot.QueueItemId);
            try
            {
                if (!File.Exists(path)) return;
                using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                if (fs.Length < slot.TailedLength)
                {
                    // File truncated/reused — reset and re-tail from the top.
                    slot.TailedLength = 0;
                    slot.LineBuffer = "";
                    slot.EventsPanel.Children.Clear();
                }
                if (fs.Length <= slot.TailedLength) return;
                fs.Seek(slot.TailedLength, SeekOrigin.Begin);
                using var reader = new StreamReader(fs);
                string newText = reader.ReadToEnd();
                slot.TailedLength = fs.Length;

                // Accumulate and emit one card per COMPLETE line — the watcher writes
                // each event as `summary + NewLine`, so a card only forms on a newline;
                // any trailing partial stays buffered until the rest of the line lands.
                slot.LineBuffer += newText;
                int nl;
                while ((nl = slot.LineBuffer.IndexOf('\n')) >= 0)
                {
                    var line = slot.LineBuffer.Substring(0, nl);
                    slot.LineBuffer = slot.LineBuffer.Substring(nl + 1);
                    AppendEventCard(slot, line);
                }
            }
            catch { /* file locked mid-write by the watcher — retry next tick */ }
        }

        /// <summary>
        /// Git #980 — auto-removes a slot whose build's GitHub issue has closed,
        /// even without a manual dismiss. Reuses the SAME issue-state awareness
        /// BuildQueuePanel's Completed tile already uses
        /// (<see cref="GitHubIssuesService.GetOpenIssueNumbersAsync"/>, one `gh`
        /// call returning every open issue number). That call returns an EMPTY set
        /// on any `gh` failure, so an empty result is treated as "couldn't
        /// determine" and skipped — otherwise a transient gh hiccup would nuke
        /// every slot. Only a non-empty (successful) result drives removals.
        /// </summary>
        private async Task CheckIssueClosuresAsync()
        {
            var withIssues = _slots.Where(s => s.Occupied && s.GithubNumber.HasValue).ToList();
            if (withIssues.Count == 0) return;

            HashSet<int> open;
            try { open = await GitHubIssuesService.GetOpenIssueNumbersAsync(1000); }
            catch { return; }
            if (open.Count == 0) return; // treat empty as "call failed", not "all closed"

            bool freed = false;
            foreach (var slot in withIssues)
            {
                if (!open.Contains(slot.GithubNumber!.Value))
                {
                    ClearSlot(slot, $"issue-closed-removal (GH #{slot.GithubNumber} closed)");
                    freed = true;
                }
            }
            if (freed) AdmitNewRunning(_lastQueue);
        }

        // ── Small UI helpers ────────────────────────────────────────────────

        private void UpdateWaitingBanner()
        {
            if (_waiting.Count == 0)
            {
                WaitingBannerBorder.Visibility = Visibility.Collapsed;
                return;
            }
            var names = string.Join(", ", _waiting.Take(5).Select(SafeTitle));
            var more = _waiting.Count > 5 ? $" +{_waiting.Count - 5} more" : "";
            WaitingBanner.Text =
                $"⏳ {_waiting.Count} build(s) waiting for a free slot — all 8 squares are busy with still-running builds (a running build is never evicted): {names}{more}";
            WaitingBannerBorder.Visibility = Visibility.Visible;
        }

        private void UpdateSubtitle()
        {
            int running = _slots.Count(s => s.Occupied && (s.State == SlotState.Running));
            int done = _slots.Count(s => s.Occupied && s.State == SlotState.Done);
            int failed = _slots.Count(s => s.Occupied && s.State == SlotState.Failed);
            int stale = _slots.Count(s => s.Occupied && s.State == SlotState.Stale);
            var parts = new List<string> { $"{running} running", $"{done} done" };
            if (failed > 0) parts.Add($"{failed} failed");
            if (stale > 0) parts.Add($"{stale} stale");
            if (_waiting.Count > 0) parts.Add($"{_waiting.Count} waiting");
            Subtitle.Text = string.Join("  ·  ", parts);
        }

        private static string SafeTitle(QueueItem item) =>
            string.IsNullOrWhiteSpace(item.Title) ? $"#{item.Id}" : item.Title;

        // ── Persisted position / size ───────────────────────────────────────

        private void RestoreWindowBounds()
        {
            try
            {
                var s = BuildConsoleSettings.Load();
                if (s.BuildWatchWidth > 0) Width = s.BuildWatchWidth;
                if (s.BuildWatchHeight > 0) Height = s.BuildWatchHeight;
                if (s.BuildWatchLeft >= 0 && s.BuildWatchTop >= 0)
                {
                    WindowStartupLocation = WindowStartupLocation.Manual;
                    Left = s.BuildWatchLeft;
                    Top = s.BuildWatchTop;
                }
            }
            catch { /* best-effort restore */ }
        }

        private void PersistBounds()
        {
            if (!_loaded) return;
            if (WindowState != WindowState.Normal) return;
            try
            {
                var s = BuildConsoleSettings.Load();
                s.BuildWatchLeft = Left;
                s.BuildWatchTop = Top;
                s.BuildWatchWidth = Width;
                s.BuildWatchHeight = Height;
                s.Save();
            }
            catch { /* best-effort */ }
        }
    }
}
