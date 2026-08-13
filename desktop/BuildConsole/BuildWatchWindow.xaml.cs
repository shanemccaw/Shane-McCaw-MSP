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

        /// <summary>
        /// #1004-refinement — matches Claude.ai's own chat pattern: consecutive tool calls
        /// (Bash/Glob/Grep/Read/etc.) collapse by default into one short muted "Ran N tools"
        /// chip instead of a row per call, click-to-expand to the real per-call detail
        /// (each tool name, in order — the log line format only carries the name, not
        /// args/output, so that's the full real detail available).
        /// </summary>
        private sealed class ToolCallGroup
        {
            public Border Card = null!;
            public TextBlock SummaryText = null!;
            public TextBlock Chevron = null!;
            public StackPanel DetailPanel = null!;
            public List<string> Names = new();
            public bool Expanded;
        }

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

            // ── Interactive chat input (only wired for BuildConsole-owned queue builds) ──
            /// <summary>The footer chat row (input box + Send + Stop), shown only while an owned interactive build is live (running / waiting / paused).</summary>
            public Border InputRow = null!;
            public TextBox InputBox = null!;
            public Button SendButton = null!;
            public Button StopButton = null!;
            /// <summary>Optional @path autocomplete popup anchored to this slot's input box.</summary>
            public System.Windows.Controls.Primitives.Popup? AutoCompletePopup;
            public ListBox? AutoCompleteList;
            /// <summary>True once this slot has been recognised as an owned interactive build — from then on it renders from the watcher's in-memory buffer and never falls back to a (double-rendering) file-tail.</summary>
            public bool InteractiveBound;
            /// <summary>Absolute line cursor into the watcher's owned output buffer (survives buffer trimming).</summary>
            public int InteractiveCursor;
            /// <summary>The build's working directory, captured at occupy time — powers @path autocomplete.</summary>
            public string? Cwd;
            /// <summary>Last interactive sub-state applied, so per-poll visual work only happens on a real change (no animation/pulse churn).</summary>
            public InteractiveInputState? LastInteractiveState;
            /// <summary>The peach "needs attention" pulse animation currently running on the badge (waiting-for-input), or null.</summary>
            public bool AttentionPulsing;

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
            /// <summary>The collapsed "Ran N tools" chip currently absorbing consecutive tool calls, or null if the
            /// last event wasn't a tool call (any other card — prose, error, done — closes the run; see AddEventBubble).</summary>
            public ToolCallGroup? CurrentToolGroup;

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
        /// <summary>The in-app queue watcher (may be null when claude.exe/config isn't set). For builds this instance launched interactively it owns their real stdin — the chat Send/Stop box and live-stream render go through it. Builds it doesn't own (a foreign instance / the legacy path) fall back to read-only file-tail with no input box, an honest boundary.</summary>
        private readonly Services.QueueWatcherService? _watcher;
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
        private readonly Brush _overlay;     // OverlayBrush — muted "paused" tone
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

        public BuildWatchWindow(BuildTrackerApiClient? api, Services.QueueWatcherService? watcher = null)
        {
            InitializeComponent();
            _api = api;
            _watcher = watcher;

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
            _overlay = (Brush)FindResource("OverlayBrush");

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

            slot.EventsPanel = new StackPanel { Margin = new Thickness(10, 10, 10, 6) };
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

            // Footer row (row 2): holds EITHER the interactive chat input row (while
            // an owned build is live) OR the "yep cool" dismiss button (terminal
            // slot). They're mutually exclusive by state, toggled in the poll loop.
            var footer = new Grid();

            // The chat input row — a real Send box wired to the running build's
            // stdin, plus a real Stop (soft interrupt → hard-kill escalation).
            BuildInputRow(slot);
            footer.Children.Add(slot.InputRow);

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
            footer.Children.Add(slot.DismissButton);

            Grid.SetRow(footer, 2);
            slot.ContentGrid.Children.Add(footer);

            grid.Children.Add(slot.ContentGrid);
            slot.Container.Child = grid;
        }

        /// <summary>
        /// Builds a slot's chat input row: a Send box that types real text into the
        /// running build's stdin (@paths pass through unmangled — it's a stream-json
        /// value, not a shell arg), a Send button, and a Stop button (soft interrupt
        /// escalating to a hard kill). Hidden by default; shown only for an owned,
        /// live interactive build. Includes a lightweight @path autocomplete popup.
        /// </summary>
        private void BuildInputRow(BuildWatchSlot slot)
        {
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            slot.InputBox = new TextBox
            {
                MinHeight = 26,
                MaxHeight = 96,
                VerticalContentAlignment = VerticalAlignment.Center,
                AcceptsReturn = false, // Enter = send; the autocomplete owns Enter only while open
                TextWrapping = TextWrapping.Wrap,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Background = (Brush)FindResource("BaseBrush"),
                Foreground = _cardText,
                CaretBrush = _cardText,
                BorderBrush = _runningBorder,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(7, 3, 7, 3),
                FontSize = 13,
                ToolTip = "Type to steer this running build — text goes straight to its stdin. Enter to send, @ for file paths.",
            };
            slot.InputBox.PreviewKeyDown += (s, e) => InputBox_PreviewKeyDown(slot, e);
            slot.InputBox.TextChanged += (s, e) => UpdateAutoComplete(slot);
            slot.InputBox.LostKeyboardFocus += (s, e) => CloseAutoComplete(slot);
            Grid.SetColumn(slot.InputBox, 0);
            grid.Children.Add(slot.InputBox);

            slot.SendButton = new Button
            {
                Content = "Send",
                Style = (Style)FindResource("IconButton"),
                Padding = new Thickness(10, 3, 10, 3),
                Margin = new Thickness(5, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Bottom,
                ToolTip = "Send this text to the running build (Enter)",
            };
            slot.SendButton.Click += (s, e) => SendSlotInput(slot);
            Grid.SetColumn(slot.SendButton, 1);
            grid.Children.Add(slot.SendButton);

            slot.StopButton = new Button
            {
                Content = "Stop",
                Style = (Style)FindResource("IconButton"),
                Padding = new Thickness(10, 3, 10, 3),
                Margin = new Thickness(5, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Bottom,
                ToolTip = "Interrupt this build (soft interrupt; press again / unresponsive → hard kill). After stopping, Send corrective guidance to redirect it.",
            };
            slot.StopButton.Click += (s, e) => StopSlot(slot);
            Grid.SetColumn(slot.StopButton, 2);
            grid.Children.Add(slot.StopButton);

            // @path autocomplete popup (bonus; degrades to nothing if cwd unknown).
            slot.AutoCompleteList = new ListBox
            {
                MaxHeight = 160,
                Background = (Brush)FindResource("MantleBrush"),
                Foreground = _cardText,
                BorderBrush = _runningBorder,
                BorderThickness = new Thickness(1),
                FontSize = 12.5,
            };
            slot.AutoCompleteList.PreviewMouseLeftButtonUp += (s, e) => AcceptAutoComplete(slot);
            slot.AutoCompletePopup = new System.Windows.Controls.Primitives.Popup
            {
                PlacementTarget = slot.InputBox,
                Placement = System.Windows.Controls.Primitives.PlacementMode.Top,
                StaysOpen = false,
                AllowsTransparency = true,
                MinWidth = 180,
                Child = new Border
                {
                    Background = (Brush)FindResource("MantleBrush"),
                    BorderBrush = _runningBorder,
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Child = slot.AutoCompleteList,
                },
            };

            slot.InputRow = new Border
            {
                Margin = new Thickness(6, 4, 6, 6),
                Visibility = Visibility.Collapsed,
                Child = grid,
            };
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
            slot.SpinnerRing.Visibility = Visibility.Visible;
            slot.ThinkingIndicator.Visibility = Visibility.Visible;
            var anim = new DoubleAnimation(0, 360, new Duration(TimeSpan.FromSeconds(0.9)))
            {
                RepeatBehavior = RepeatBehavior.Forever,
            };
            slot.SpinnerTransform.BeginAnimation(RotateTransform.AngleProperty, anim);
        }

        /// <summary>Keeps the activity row visible with its text but no spinning ring — used for the paused / waiting-for-input interactive sub-states (idle, but not terminal).</summary>
        private static void ShowStaticActivity(BuildWatchSlot slot)
        {
            slot.SpinnerTransform.BeginAnimation(RotateTransform.AngleProperty, null);
            slot.SpinnerRing.Visibility = Visibility.Collapsed;
            slot.ThinkingIndicator.Visibility = Visibility.Visible;
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
        ///   • text with [tool:] → the prose becomes an assistant card; each tool marker folds into the
        ///                         current collapsed "Ran N tools" chip (see AddToolCallChip)
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
                AddToolCallChip(slot, toolName);

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
            // Any non-tool card (prose/error/done) closes out whatever tool-call run was
            // in progress, so the NEXT tool call starts a fresh collapsed chip rather than
            // silently appending to a chip that's no longer adjacent to it on screen.
            slot.CurrentToolGroup = null;

            var body = new TextBlock
            {
                Text = glyph == null ? text : $"{glyph}  {text}",
                Foreground = textBrush,
                FontSize = 14.5,
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 23, // ≈1.6× — the calm reading rhythm Claude.ai's own assistant messages use (leading-[1.65])
                VerticalAlignment = VerticalAlignment.Center,
            };
            if (mono) body.FontFamily = new FontFamily("Cascadia Mono, Consolas");
            if (ReferenceEquals(accent, _mauve) || ReferenceEquals(accent, _green))
                body.FontWeight = FontWeights.SemiBold;

            var card = new Border
            {
                Background = _cardBg,
                CornerRadius = new CornerRadius(5, 14, 14, 14), // rounded-2xl-ish; keeps the subtle top-left chat "tail"
                BorderBrush = accent,
                BorderThickness = new Thickness(3, 0, 0, 0), // coloured left accent bar = event type
                Padding = new Thickness(13, 9, 13, 9),
                Margin = new Thickness(0, 0, 0, 9), // generous inter-card gap so cards read as distinct turns
                HorizontalAlignment = HorizontalAlignment.Stretch,
                Child = body,
                // Very subtle lift off the Base background — lighter than the app's speech-bubble
                // shadow (0.45), tuned for a dense stream so many stacked cards stay calm.
                Effect = new System.Windows.Media.Effects.DropShadowEffect
                {
                    BlurRadius = 7,
                    ShadowDepth = 1,
                    Direction = 270,
                    Opacity = 0.25,
                    Color = Colors.Black,
                },
            };

            slot.EventsPanel.Children.Add(card);
            while (slot.EventsPanel.Children.Count > MaxCardsPerSlot)
                slot.EventsPanel.Children.RemoveAt(0);

            slot.LastOutputUtc = DateTime.UtcNow;
            slot.EventsScroll.ScrollToEnd();
        }

        /// <summary>
        /// Matches Claude.ai's own chat pattern: a consecutive run of tool calls (Bash, Glob,
        /// Grep, Read, …) folds into a single small muted "Ran N tools" chip instead of one row
        /// per call, so the (much more important) narrative text cards stay visually dominant.
        /// The chip is click-to-expand, revealing the real per-call detail (each tool name, in
        /// order it happened). First call in a run creates the chip and remembers it on the slot
        /// (<see cref="BuildWatchSlot.CurrentToolGroup"/>); subsequent adjacent calls extend the
        /// same chip. AddEventBubble clears CurrentToolGroup whenever any other card lands, which
        /// is what makes a run "consecutive" — a text/error/done card in between starts a new chip.
        /// </summary>
        private void AddToolCallChip(BuildWatchSlot slot, string toolName)
        {
            slot.LastOutputUtc = DateTime.UtcNow;
            if (slot.State == SlotState.Running)
                slot.ThinkingText.Text = $"running {toolName}…";

            var group = slot.CurrentToolGroup;
            if (group != null)
            {
                group.Names.Add(toolName);
                group.DetailPanel.Children.Add(BuildToolDetailLine(toolName));
                group.SummaryText.Text = ToolGroupSummaryText(group.Names);
                return;
            }

            group = new ToolCallGroup();
            group.Names.Add(toolName);

            group.SummaryText = new TextBlock
            {
                FontSize = 12.5,
                FontWeight = FontWeights.Normal, // NOT semibold — a tool run is secondary to the narrative cards
                Foreground = _cardSubtext,       // muted Subtext1, readable but visibly lighter than prose
                VerticalAlignment = VerticalAlignment.Center,
                Text = ToolGroupSummaryText(group.Names),
            };
            group.Chevron = new TextBlock
            {
                Text = "▸",
                FontSize = 10,
                Foreground = _overlay, // dimmer still than the summary — the least-important affordance
                Margin = new Thickness(7, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center,
            };
            var summaryRow = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            summaryRow.Children.Add(group.SummaryText);
            summaryRow.Children.Add(group.Chevron);

            group.DetailPanel = new StackPanel { Visibility = Visibility.Collapsed, Margin = new Thickness(0, 6, 0, 0) };
            group.DetailPanel.Children.Add(BuildToolDetailLine(toolName));

            var outer = new StackPanel();
            outer.Children.Add(summaryRow);
            outer.Children.Add(group.DetailPanel);

            group.Card = new Border
            {
                // No fill + a thin Surface1 outline = a clearly-secondary pill that recedes against
                // the shadowed, filled prose cards, matching how Claude.ai renders collapsed tool blocks.
                Background = Brushes.Transparent,
                BorderBrush = (Brush)FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(13), // fully-rounded pill
                Padding = new Thickness(11, 5, 11, 5),
                Margin = new Thickness(0, 1, 0, 9),
                HorizontalAlignment = HorizontalAlignment.Left,
                Cursor = System.Windows.Input.Cursors.Hand,
                ToolTip = "Click to expand and see each tool call",
                Child = outer,
            };
            group.Card.MouseLeftButtonUp += (s, e) => ToggleToolGroup(group);

            slot.EventsPanel.Children.Add(group.Card);
            while (slot.EventsPanel.Children.Count > MaxCardsPerSlot)
                slot.EventsPanel.Children.RemoveAt(0);

            slot.CurrentToolGroup = group;
            slot.EventsScroll.ScrollToEnd();
        }

        private TextBlock BuildToolDetailLine(string toolName) => new()
        {
            Text = $"⚙  {toolName}",
            Foreground = _mauve,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 2, 0, 0),
        };

        /// <summary>"Ran X" for a single call (names the tool, e.g. "Ran Bash"), "Ran N tools" once a run has more than one — the exact Claude.ai collapsed-chip phrasing named in Git #1004's refinement.</summary>
        private static string ToolGroupSummaryText(List<string> names) =>
            names.Count == 1 ? $"⚙ Ran {names[0]}" : $"⚙ Ran {names.Count} tools";

        private static void ToggleToolGroup(ToolCallGroup group)
        {
            group.Expanded = !group.Expanded;
            group.DetailPanel.Visibility = group.Expanded ? Visibility.Visible : Visibility.Collapsed;
            group.Chevron.Text = group.Expanded ? "▾" : "▸";
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
                    bool owned = _watcher?.OwnsInteractive(slot.QueueItemId) ?? false;
                    if (owned) slot.InteractiveBound = true;

                    if (byId.TryGetValue(slot.QueueItemId, out var item))
                    {
                        ApplyItemStatusToSlot(slot, item);
                    }
                    else
                    {
                        // #943: gone from the queue is NOT proof of completion —
                        // the real process may still be alive. Mark Stale (kept,
                        // manually dismissable, never auto-evicted) and keep
                        // streaming its output in case it's still writing.
                        if (slot.State != SlotState.Stale) SetSlotState(slot, SlotState.Stale, null);
                    }

                    // Render: an owned interactive build streams from the watcher's
                    // in-memory buffer (replacing the file-tail for these); every
                    // other build tails its per-item log file exactly as before.
                    if (slot.InteractiveBound) DrainInteractiveOutput(slot);
                    else TailSlotLog(slot);

                    // Interactive overlay: while the queue still calls it running and
                    // we own the live process, surface the real working / paused /
                    // waiting-for-input sub-state and the chat input row.
                    var ist = (slot.State == SlotState.Running && owned)
                        ? _watcher!.GetInteractiveState(slot.QueueItemId)
                        : null;
                    if (ist.HasValue)
                    {
                        ApplyInteractiveState(slot, ist.Value);
                    }
                    else
                    {
                        ShowInputRow(slot, false);
                        StopAttentionPulse(slot);
                        slot.LastInteractiveState = null;
                        if (slot.State == SlotState.Running)
                            UpdateThinkingText(slot, slot.Verifying); // refresh activity line / roll the easter egg
                    }
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
                    slot.DismissButton.Visibility = Visibility.Collapsed;
                    slot.CompletedAtUtc = null;
                    // For a BuildConsole-owned interactive build the badge/border/
                    // spinner/thinking are owned by ApplyInteractiveState (which knows
                    // the real working/paused/waiting sub-state); don't fight it here.
                    if (!slot.InteractiveBound)
                    {
                        slot.Container.BorderBrush = _runningBorder;
                        slot.Container.BorderThickness = new Thickness(1);
                        slot.BadgeChip.Background = verifying ? _yellow : _blue;
                        slot.BadgeText.Text = verifying ? "VERIFYING…" : "RUNNING";
                        slot.BadgeChip.ToolTip = verifying
                            ? "Queue reported failed with the #943 orphan-sweep sentinel (exit -2) — holding as running until a real exit code lands."
                            : null;
                        StartSpinner(slot, verifying); // genuinely alive while the build runs
                        if (changed) UpdateThinkingText(slot, verifying);
                    }
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
            slot.CurrentToolGroup = null;
            slot.ThinkingText.Text = "starting…";
            slot.EmptyText.Visibility = Visibility.Collapsed;
            slot.ContentGrid.Visibility = Visibility.Visible;
            slot.HeaderText.Text = slot.GithubNumber.HasValue ? $"#{slot.GithubNumber}  {slot.Title}" : slot.Title;
            slot.HeaderText.ToolTip = slot.HeaderText.Text;

            // Interactive rebind — is this a build THIS app owns the stdin of?
            slot.Cwd = item.Cwd;
            slot.InteractiveCursor = 0;
            slot.LastInteractiveState = null;
            slot.InputBox.Text = "";
            CloseAutoComplete(slot);
            slot.InteractiveBound = _watcher?.OwnsInteractive(item.Id) ?? false;

            SetSlotState(slot, SlotState.Running, null);
            // Render from the owned in-memory stream for interactive builds
            // (replacing the file-tail for these); file-tail for everything else.
            if (slot.InteractiveBound) DrainInteractiveOutput(slot);
            else TailSlotLog(slot);
            ReflowSlotGrid(); // occupancy grew — resize the grid to fit
            ActivityLog.Log("build-watch",
                $"occupied slot: {slot.Title} (queue #{item.Id}{(slot.GithubNumber.HasValue ? $", GH #{slot.GithubNumber}" : "")})");
        }

        private void ClearSlot(BuildWatchSlot slot, string reason)
        {
            if (!slot.Occupied) return;
            int id = slot.QueueItemId;
            ActivityLog.Log("build-watch", $"{reason}: {slot.Title} (queue #{id})");

            // If this was an owned interactive build: gracefully finalize it if it's
            // still alive (close stdin → it exits → queue completes, never hangs),
            // then drop its retained output buffer.
            if (slot.InteractiveBound && _watcher != null)
            {
                _watcher.FinalizeInteractive(id); // no-op if already exited
                _watcher.ReleaseInteractive(id);
            }

            slot.Occupied = false;
            slot.QueueItemId = 0;
            slot.GithubNumber = null;
            slot.Title = "";
            slot.State = SlotState.Empty;
            slot.CompletedAtUtc = null;
            slot.TailedLength = 0;
            slot.Verifying = false;
            slot.LineBuffer = "";
            slot.InteractiveBound = false;
            slot.InteractiveCursor = 0;
            slot.LastInteractiveState = null;
            slot.Cwd = null;
            StopSpinner(slot);
            StopAttentionPulse(slot);
            ShowInputRow(slot, false);
            slot.InputBox.Text = "";
            CloseAutoComplete(slot);
            slot.EventsPanel.Children.Clear();
            slot.CurrentToolGroup = null;
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
                    slot.CurrentToolGroup = null;
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

        // ── Interactive builds: live stream, 3-state indicator, chat input ──

        /// <summary>
        /// Renders an owned interactive build's live output by pulling the lines the
        /// watcher has buffered since our cursor and turning each into an event card —
        /// the same card renderer the file-tail path uses, just sourced from the
        /// BuildConsole-owned in-memory stream instead of the per-item log file.
        /// </summary>
        private void DrainInteractiveOutput(BuildWatchSlot slot)
        {
            if (_watcher == null) return;
            int cursor = slot.InteractiveCursor;
            List<string> lines;
            try { lines = _watcher.CopyOutputSince(slot.QueueItemId, ref cursor); }
            catch { return; }
            slot.InteractiveCursor = cursor;
            foreach (var line in lines)
                AppendEventCard(slot, line);
        }

        /// <summary>Shows/hides a slot's chat input row (the Dismiss button shares the footer and shows opposite it, from the terminal SetSlotState cases).</summary>
        private static void ShowInputRow(BuildWatchSlot slot, bool show) =>
            slot.InputRow.Visibility = show ? Visibility.Visible : Visibility.Collapsed;

        /// <summary>
        /// Drives the clear three-state indicator + chat input row for a live owned
        /// interactive build: Working (blue, spinner running), WaitingForInput (peach —
        /// the app's existing "needs attention" colour, same as the waiting banner and
        /// stale slot — with a soft badge pulse), and Stopped/paused (muted). Idempotent
        /// and gated on a real sub-state change so it never restarts animations per poll.
        /// </summary>
        private void ApplyInteractiveState(BuildWatchSlot slot, InteractiveInputState state)
        {
            ShowInputRow(slot, true);

            if (slot.LastInteractiveState == state) return; // no visual churn on an unchanged state
            slot.LastInteractiveState = state;

            switch (state)
            {
                case InteractiveInputState.Working:
                    StopAttentionPulse(slot);
                    slot.Container.BorderBrush = _blue;
                    slot.Container.BorderThickness = new Thickness(1);
                    slot.BadgeChip.Background = _blue;
                    slot.BadgeText.Text = "RUNNING";
                    slot.BadgeChip.ToolTip = "Working — type below to steer it mid-task; text goes straight to its stdin.";
                    slot.ThinkingText.Text = "working…";
                    StartSpinner(slot, verifying: false);
                    break;

                case InteractiveInputState.WaitingForInput:
                    slot.Container.BorderBrush = _peach;
                    slot.Container.BorderThickness = new Thickness(3);
                    slot.BadgeChip.Background = _peach;
                    slot.BadgeText.Text = "✋ NEEDS INPUT";
                    slot.BadgeChip.ToolTip = "This build finished its turn and is waiting on you — reply to continue, or it wraps up on its own shortly.";
                    slot.ThinkingText.Text = "waiting for your input…";
                    ShowStaticActivity(slot);
                    StartAttentionPulse(slot);
                    break;

                case InteractiveInputState.Stopped:
                    StopAttentionPulse(slot);
                    slot.Container.BorderBrush = _overlay;
                    slot.Container.BorderThickness = new Thickness(2);
                    slot.BadgeChip.Background = _overlay;
                    slot.BadgeText.Text = "⏸ PAUSED";
                    slot.BadgeChip.ToolTip = "Interrupted — Send corrective guidance to redirect it, or Stop again to hard-kill.";
                    slot.ThinkingText.Text = "stopped — send guidance to resume…";
                    ShowStaticActivity(slot);
                    break;
            }
        }

        /// <summary>The peach "needs attention" pulse on a waiting slot's badge — a gentle opacity throb so a build genuinely waiting on Shane catches his eye from across the room.</summary>
        private void StartAttentionPulse(BuildWatchSlot slot)
        {
            if (slot.AttentionPulsing) return;
            slot.AttentionPulsing = true;
            var anim = new DoubleAnimation(1.0, 0.4, new Duration(TimeSpan.FromSeconds(0.7)))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
            };
            slot.BadgeChip.BeginAnimation(UIElement.OpacityProperty, anim);
        }

        private static void StopAttentionPulse(BuildWatchSlot slot)
        {
            if (!slot.AttentionPulsing) return;
            slot.AttentionPulsing = false;
            slot.BadgeChip.BeginAnimation(UIElement.OpacityProperty, null);
            slot.BadgeChip.Opacity = 1.0;
        }

        /// <summary>Send clicked / Enter pressed — types the box text into the running build's real stdin, echoes it as a chat bubble, and clears the box.</summary>
        private void SendSlotInput(BuildWatchSlot slot)
        {
            if (_watcher == null) return;
            CloseAutoComplete(slot);
            var text = slot.InputBox.Text;
            if (string.IsNullOrWhiteSpace(text)) return;
            _watcher.SendInput(slot.QueueItemId, text);
            AddUserBubble(slot, text);
            slot.InputBox.Text = "";
            // Reflect immediately: back to working; force a re-apply next poll.
            StopAttentionPulse(slot);
            slot.LastInteractiveState = null;
            slot.ThinkingText.Text = "working…";
        }

        /// <summary>Stop clicked — soft interrupt (escalating to a hard kill in the watcher if unresponsive / on a repeat press). Optimistically shows the paused state right away.</summary>
        private void StopSlot(BuildWatchSlot slot)
        {
            if (_watcher == null) return;
            CloseAutoComplete(slot);
            _ = _watcher.RequestStopAsync(slot.QueueItemId);
            slot.LastInteractiveState = null;
            ApplyInteractiveState(slot, InteractiveInputState.Stopped);
        }

        /// <summary>A right-aligned bubble echoing what Shane just typed, so a slot reads like a real chat thread.</summary>
        private void AddUserBubble(BuildWatchSlot slot, string text)
        {
            var body = new TextBlock
            {
                Text = "▷  " + text.Trim(),
                Foreground = _cardText,
                FontSize = 14.5,
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 19,
            };
            var card = new Border
            {
                Background = _runningBorder, // Surface2 — distinct from the Surface0 event cards
                CornerRadius = new CornerRadius(10, 4, 10, 10),
                BorderBrush = _blue,
                BorderThickness = new Thickness(0, 0, 3, 0),
                Padding = new Thickness(10, 7, 10, 7),
                Margin = new Thickness(24, 2, 0, 6),
                HorizontalAlignment = HorizontalAlignment.Right,
                Child = body,
            };
            slot.EventsPanel.Children.Add(card);
            while (slot.EventsPanel.Children.Count > MaxCardsPerSlot)
                slot.EventsPanel.Children.RemoveAt(0);
            slot.EventsScroll.ScrollToEnd();
        }

        // ── @path autocomplete (bonus; degrades to nothing when cwd is unknown) ──

        private void InputBox_PreviewKeyDown(BuildWatchSlot slot, System.Windows.Input.KeyEventArgs e)
        {
            // While the autocomplete popup is open it owns the arrow/Tab/Enter/Esc keys.
            if (slot.AutoCompletePopup?.IsOpen == true && slot.AutoCompleteList != null && slot.AutoCompleteList.Items.Count > 0)
            {
                switch (e.Key)
                {
                    case System.Windows.Input.Key.Down:
                        slot.AutoCompleteList.SelectedIndex = Math.Min(slot.AutoCompleteList.SelectedIndex + 1, slot.AutoCompleteList.Items.Count - 1);
                        slot.AutoCompleteList.ScrollIntoView(slot.AutoCompleteList.SelectedItem);
                        e.Handled = true; return;
                    case System.Windows.Input.Key.Up:
                        slot.AutoCompleteList.SelectedIndex = Math.Max(slot.AutoCompleteList.SelectedIndex - 1, 0);
                        slot.AutoCompleteList.ScrollIntoView(slot.AutoCompleteList.SelectedItem);
                        e.Handled = true; return;
                    case System.Windows.Input.Key.Tab:
                    case System.Windows.Input.Key.Enter:
                        AcceptAutoComplete(slot); e.Handled = true; return;
                    case System.Windows.Input.Key.Escape:
                        CloseAutoComplete(slot); e.Handled = true; return;
                }
            }

            if (e.Key == System.Windows.Input.Key.Enter &&
                (System.Windows.Input.Keyboard.Modifiers & System.Windows.Input.ModifierKeys.Shift) == 0)
            {
                SendSlotInput(slot);
                e.Handled = true;
            }
        }

        private void UpdateAutoComplete(BuildWatchSlot slot)
        {
            if (slot.AutoCompletePopup == null || slot.AutoCompleteList == null) return;
            var frag = CurrentAtFragment(slot.InputBox);
            if (frag == null || string.IsNullOrEmpty(slot.Cwd) || !Directory.Exists(slot.Cwd))
            {
                CloseAutoComplete(slot);
                return;
            }
            var matches = MatchPaths(slot.Cwd!, frag);
            if (matches.Count == 0) { CloseAutoComplete(slot); return; }
            slot.AutoCompleteList.ItemsSource = matches;
            slot.AutoCompleteList.SelectedIndex = 0;
            slot.AutoCompletePopup.IsOpen = true;
        }

        private static void CloseAutoComplete(BuildWatchSlot slot)
        {
            if (slot.AutoCompletePopup != null) slot.AutoCompletePopup.IsOpen = false;
        }

        private void AcceptAutoComplete(BuildWatchSlot slot)
        {
            if (slot.AutoCompleteList?.SelectedItem is not string pick) { CloseAutoComplete(slot); return; }
            var box = slot.InputBox;
            int caret = Math.Min(box.CaretIndex, (box.Text ?? "").Length);
            string text = box.Text ?? "";
            string upto = text.Substring(0, caret);
            int at = upto.LastIndexOf('@');
            if (at < 0) { CloseAutoComplete(slot); return; }
            string before = text.Substring(0, at + 1); // keep the '@'
            string after = text.Substring(caret);
            box.Text = before + pick + after;
            box.CaretIndex = (before + pick).Length;
            CloseAutoComplete(slot); // final word: closed (a re-trigger fired mid-assignment, this wins)
            box.Focus();
        }

        /// <summary>The '@'-prefixed path fragment immediately left of the caret (or null if the caret isn't inside one). '@' must start a token (be at the start or follow whitespace) and the fragment must be whitespace-free.</summary>
        private static string? CurrentAtFragment(TextBox box)
        {
            string text = box.Text ?? "";
            int caret = Math.Min(box.CaretIndex, text.Length);
            string upto = text.Substring(0, caret);
            int at = upto.LastIndexOf('@');
            if (at < 0) return null;
            if (at > 0 && !char.IsWhiteSpace(upto[at - 1])) return null;
            string frag = upto.Substring(at + 1);
            return frag.Any(char.IsWhiteSpace) ? null : frag;
        }

        /// <summary>Up to 20 files/dirs under <paramref name="cwd"/> matching the (possibly directory-qualified) fragment, as forward-slashed relative paths, directories suffixed with '/'.</summary>
        private static List<string> MatchPaths(string cwd, string frag)
        {
            var results = new List<string>();
            try
            {
                string rel = frag.Replace('\\', '/');
                string dirPart = "", namePart = rel;
                int slash = rel.LastIndexOf('/');
                if (slash >= 0) { dirPart = rel.Substring(0, slash); namePart = rel.Substring(slash + 1); }
                string baseDir = string.IsNullOrEmpty(dirPart) ? cwd : System.IO.Path.Combine(cwd, dirPart);
                if (!Directory.Exists(baseDir)) return results;
                foreach (var entry in Directory.EnumerateFileSystemEntries(baseDir))
                {
                    var name = System.IO.Path.GetFileName(entry);
                    if (name.StartsWith(".", StringComparison.Ordinal)) continue; // skip dotfiles / .git
                    if (namePart.Length > 0 && !name.StartsWith(namePart, StringComparison.OrdinalIgnoreCase)) continue;
                    bool isDir = Directory.Exists(entry);
                    string relOut = (string.IsNullOrEmpty(dirPart) ? name : dirPart + "/" + name) + (isDir ? "/" : "");
                    results.Add(relOut);
                    if (results.Count >= 20) break;
                }
                results.Sort(StringComparer.OrdinalIgnoreCase);
            }
            catch { /* best-effort autocomplete */ }
            return results;
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

        // ── Git #1006: custom title bar caption buttons (same pattern as MainWindow, Git #894) ──
        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

        private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e) =>
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        private void Window_StateChanged(object sender, EventArgs e)
        {
            bool maximized = WindowState == WindowState.Maximized;
            BtnMaximizeRestoreIcon.Text = maximized ? "" : "";
            BtnMaximizeRestore.ToolTip = maximized ? "Restore Down" : "Maximize";
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
