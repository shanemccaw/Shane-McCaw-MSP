using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #980 — Shane: "This should be a floaty panel so I can put it off to
    /// another monitor and watch as it progresses... 8 total builds running at
    /// once... 8 squares each can contain a build output... When one is done...
    /// a green overlay or something around the completed one... I can look go
    /// yep cool and click a button... if a build comes in and 8 are there, you
    /// replace the oldest done one automatically. If the Git issue closes, then
    /// it should auto disappear."
    ///
    /// An independent, resizable, draggable-to-any-monitor top-level window (not
    /// docked in MainWindow). It watches the shared build queue and mirrors each
    /// live build into one of 8 slots, streaming that build's real output by
    /// reusing the existing #802/#825 per-item log-tail convention
    /// (<see cref="BuildLogPaths.ForQueueItem"/>) — no new streaming mechanism.
    ///
    /// Per-slot rendering (design_handoff_claude_cli_chat/README.md redesign) is
    /// a <see cref="Controls.ChatSessionPane"/> UserControl bound to a
    /// <see cref="ChatPaneViewModel"/> — this file owns the queue-driven business
    /// logic (admit/evict, state transitions, log tailing) and just pushes turns/
    /// pill state into that view model; the old imperative Border/TextBlock
    /// construction is gone.
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

        /// <summary>The number of concurrent Build Watch slots. Public so Focus Mode's downtime
        /// detection (<see cref="Services.FocusBuildSaturation"/>) keys "all slots occupied" off the
        /// same single definition of saturation Build Watch itself renders.</summary>
        public const int SlotCount = 8;
        private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(3);

        /// <summary>The maximum number of transcript turns kept per slot — older turns fall off the top so a very long build can't grow the visual tree without bound (the pre-redesign code had the same cap on its own card list).</summary>
        private const int MaxCardsPerSlot = 200;

        /// <summary>The standard Claude context-window size — a real model constant (not fetched per-build; every model this app launches uses the standard 200k window). Shown as the composer footer's token-fraction denominator only once real usage data exists (QueueWatcherService.GetContextTokens) — never fabricated.</summary>
        private const long StandardContextWindowTokens = 200_000;

        private enum SlotState { Empty, Running, Done, Failed, Stale }

        private sealed class BuildWatchSlot
        {
            // Visual tree (built once in BuildSlotVisual)
            public Border Container = null!;
            public Grid ContentGrid = null!;
            public TextBlock EmptyText = null!;
            public ChatSessionPane Pane = null!;

            // ── Interactive chat input (only wired for BuildConsole-owned queue builds) ──
            public bool InteractiveBound;
            public int InteractiveCursor;
            /// <summary>The build's working directory, captured at occupy time — powers @path autocomplete (forwarded to Pane.Cwd).</summary>
            public string? Cwd;
            public InteractiveInputState? LastInteractiveState;
            /// <summary>
            /// Structured events pulled from the watcher's buffer (<see cref="CopyEventsSince"/>) but not
            /// yet rendered into the transcript. Drained in small chunks by <see cref="PumpSlotRender"/>,
            /// yielding between them, so a fast build's backlog never floods the UI thread in one
            /// synchronous flush — the direct cause of the whole-app freeze this fixes.
            /// </summary>
            public readonly Queue<InteractiveEvent> PendingRender = new();
            /// <summary>True while a background-priority render pump is already scheduled for this slot — the guard that stops overlapping pumps from stacking up per poll.</summary>
            public bool RenderPumpScheduled;

            // Transcript bookkeeping
            /// <summary>The trailing live status turn while this slot is running (removed on any terminal state); mutated in place rather than re-created each poll.</summary>
            public StatusLineTurn? StatusLine;
            /// <summary>Whether we're currently mid an assistant "run" — controls whether the next assistant content needs a fresh AssistantTurnStartTurn (CLAUDE role header) inserted first. Reset false on every user message.</summary>
            public bool InAssistantRun;
            /// <summary>The collapsed "Ran N tools" turn currently absorbing consecutive tool calls, or null if the last event wasn't a tool call.</summary>
            public ToolGroupTurn? CurrentToolGroup;
            /// <summary>Maps a tool_use id → its chip detail line, so a tool_result event (which arrives a beat later, on its own stream-json line) can fill in that exact call's real output. Interactive builds only; reset per occupancy, soft-capped to bound a very long build's memory.</summary>
            public readonly Dictionary<string, ToolDetailLine> ToolCallsById = new();
            /// <summary>Maps a <c>TaskCreate</c> tool_use id → the pending checklist row it added, held only
            /// until that call's tool_result reveals the assigned "Task #N" id and the row is bound to it
            /// (see the structured Task-tool checklist path). Lets a later <c>TaskUpdate</c> flip exactly
            /// that row by its real id. Reset per occupancy alongside <see cref="ToolCallsById"/>.</summary>
            public readonly Dictionary<string, ChecklistItemViewModel> PendingTaskCreatesByUseId = new();
            /// <summary>Lines of an in-progress code diff being folded into a single DiffTurn, or null when not currently inside a diff — mirrors CurrentToolGroup's "consecutive run" bookkeeping (see HandleDiffLine).</summary>
            public List<string>? DiffLines;
            /// <summary>True while <see cref="DiffLines"/> is being filled from inside a fenced ```diff block (which closes on the ``` fence); false for a raw unified-diff run (which closes on the first non-diff line).</summary>
            public bool InDiffFence;
            public string LineBuffer = "";
            /// <summary>Last time a real event landed — drives "longer-running wait" idle detection for the easter egg.</summary>
            public DateTime LastOutputUtc;
            /// <summary>While now &lt; this, a rolled easter-egg phrase is left on screen instead of being overwritten each poll.</summary>
            public DateTime EasterEggUntilUtc;
            /// <summary>When this slot was occupied — drives the composer footer's "Running for Nm Ss" ticking elapsed label.</summary>
            public DateTime RunStartedUtc;

            // Live state
            public bool Occupied;
            public int QueueItemId;
            public int? GithubNumber;
            public string Title = "";
            public SlotState State = SlotState.Empty;
            /// <summary>True while a Running slot is actually the #943 "VERIFYING…" hold (queue said failed with the -2 sentinel).</summary>
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
        private DispatcherTimer? _elapsedTimer;
        private bool _polling;
        private List<QueueItem> _lastQueue = new();

        /// <summary>Backs the live "Task Checklist" side panel (Git #980 follow-on): checklist items
        /// extracted from every slot's reported progress via <see cref="ChecklistExtractor"/>, attributed
        /// per build. Bound to ChecklistPanel in XAML; mutated only on the UI-thread poll tick.
        /// The app-wide <see cref="Controls.TaskChecklistViewModel.Shared"/> singleton — Focus Mode's
        /// strip reads the very same instance so its live checklist band reflects #28's real detection
        /// with no second parser. Cleared when this window closes (see the Closed handler) so each
        /// Build Watch session starts fresh, exactly as it did when this was a per-window field.</summary>
        private readonly Controls.TaskChecklistViewModel _checklist = Controls.TaskChecklistViewModel.Shared;

        // Theme brushes (resolved once)
        private readonly Brush _emptyBorder;
        private readonly Brush _ringSuccess;
        private readonly Brush _ringDanger;
        private readonly Brush _ringWarning;
        private readonly Brush _ringMuted;
        private readonly Brush _pillRunningDot;
        private readonly Brush _pillRunningText;
        private readonly Brush _pillIdleTone;
        private readonly Brush _pillErrorTone;
        private readonly Brush _pillWarningTone;
        private readonly Brush _pillSuccessTone;
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

            _emptyBorder = (Brush)FindResource("Surface0Brush");
            _ringSuccess = (Brush)FindResource("ChatPane.Success");
            _ringDanger = (Brush)FindResource("ChatPane.Danger");
            _ringWarning = (Brush)FindResource("ChatPane.Warning");
            _ringMuted = (Brush)FindResource("ChatPane.Muted7");
            _pillRunningDot = (Brush)FindResource("ChatPane.AccentText1");
            _pillRunningText = (Brush)FindResource("ChatPane.AccentText3");
            _pillIdleTone = (Brush)FindResource("ChatPane.Muted4");
            _pillErrorTone = (Brush)FindResource("ChatPane.Danger");
            _pillWarningTone = (Brush)FindResource("ChatPane.Warning");
            _pillSuccessTone = (Brush)FindResource("ChatPane.Success");

            for (int i = 0; i < SlotCount; i++)
            {
                var slot = new BuildWatchSlot();
                BuildSlotVisual(slot);
                _slots.Add(slot);
                SlotGrid.Children.Add(slot.Container);
            }

            ReflowSlotGrid(); // 0 active → 1x1 full-window empty state to start

            ChecklistPanel.DataContext = _checklist;

            RestoreWindowBounds();

            Loaded += (s, e) =>
            {
                _loaded = true;
                UpdateSubtitle();

                _elapsedTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
                _elapsedTimer.Tick += (_, _) => UpdateElapsedLabels();
                _elapsedTimer.Start();

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
            Closed += (s, e) =>
            {
                _pollTimer?.Stop();
                _elapsedTimer?.Stop();
                // Reset the shared checklist tracker so the next Build Watch session starts clean and
                // Focus Mode's band doesn't linger stale rows for builds we're no longer detecting.
                _checklist.Clear();
            };
            LocationChanged += (s, e) => PersistBounds();
            SizeChanged += (s, e) => PersistBounds();
        }

        // ── Slot visual construction ────────────────────────────────────────

        private void BuildSlotVisual(BuildWatchSlot slot)
        {
            slot.Pane = new ChatSessionPane();
            slot.Pane.SendRequested += text => SendSlotInput(slot, text);
            slot.Pane.StopRequested += () => StopSlot(slot);
            slot.Pane.DismissRequested += () =>
            {
                ClearSlot(slot, "dismissed");
                // Fill the freed slot right away from anything that was waiting,
                // instead of making Shane wait for the next poll tick.
                AdmitNewRunning(_lastQueue);
                UpdateWaitingBanner();
                UpdateSubtitle();
            };

            slot.Container = new Border
            {
                Margin = new Thickness(4),
                CornerRadius = new CornerRadius(6),
                BorderBrush = _emptyBorder,
                BorderThickness = new Thickness(1),
                Background = (Brush)FindResource("MantleBrush"),
            };

            var grid = new Grid();

            slot.EmptyText = new TextBlock
            {
                Text = "empty",
                FontSize = 12,
                Foreground = (Brush)FindResource("OverlayBrush"),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };
            grid.Children.Add(slot.EmptyText);

            slot.ContentGrid = new Grid { Visibility = Visibility.Collapsed };
            slot.ContentGrid.Children.Add(slot.Pane);
            grid.Children.Add(slot.ContentGrid);

            slot.Container.Child = grid;
        }

        // ── Pill state (RUNNING/IDLE/ERROR/etc — extends the spec's 3 literal states with the
        // extra Warning tone for "needs input"/"stale", using colors already in its own token set) ──

        private void ApplyPillTone(BuildWatchSlot slot, string tone, string label, string? tooltip, bool pulsing)
        {
            var vm = slot.Pane.ViewModel;
            vm.PillFill = (Brush)FindResource($"ChatPane.Pill.{tone}Fill");
            vm.PillBorder = (Brush)FindResource($"ChatPane.Pill.{tone}Border");
            (vm.PillDot, vm.PillText) = tone switch
            {
                "Running" => (_pillRunningDot, _pillRunningText),
                "Success" => (_pillSuccessTone, _pillSuccessTone),
                "Error" => (_pillErrorTone, _pillErrorTone),
                "Warning" => (_pillWarningTone, _pillWarningTone),
                _ => (_pillIdleTone, _pillIdleTone),
            };
            vm.PillLabel = label;
            vm.PillTooltip = tooltip;
            vm.PillPulsing = pulsing;
        }

        // ── #1004 event-line classification → transcript turns ──────────────

        private static readonly Regex ToolTokenRegex = new(@"\[tool:\s*([^\]]+)\]", RegexOptions.Compiled);

        // ── Code-diff detection signals (see HandleDiffLine) ─────────────────
        /// <summary>Opening fence of a ```diff / ```patch code block (the strongest "this is a diff" signal in agent prose).</summary>
        private static readonly Regex DiffFenceOpenRegex = new(@"^\s*`{3,}\s*(diff|patch|udiff)\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        /// <summary>A closing (or bare) ``` fence.</summary>
        private static readonly Regex CodeFenceCloseRegex = new(@"^\s*`{3,}\s*$", RegexOptions.Compiled);
        /// <summary>A unified-diff hunk header — "@@ -a,b +c,d @@" — the most reliable structural anchor for a raw (unfenced) diff.</summary>
        private static readonly Regex DiffHunkHeaderRegex = new(@"^@@ -\d+(,\d+)? \+\d+(,\d+)? @@", RegexOptions.Compiled);

        /// <summary>Distinguishes obvious stderr / error lines (folded in raw by the watcher) so they get a red-tinted paragraph,
        /// while staying tight enough not to redden ordinary assistant prose that merely mentions the word "error".</summary>
        private static bool LooksLikeError(string line)
        {
            return Regex.IsMatch(line,
                @"^\s*(error\b|error:|exception\b|fatal:|panic:|traceback|npm ERR!|unhandled|\bat\s+\S+\(|\w+Error:|\w+Exception:)",
                RegexOptions.IgnoreCase);
        }

        // ── Task Checklist side panel extraction ────────────────────────────
        // Non-destructively observes the same text that flows into the transcript and mirrors any
        // genuine checklist markers into the live side panel (_checklist). This never consumes or
        // alters a line — the transcript still renders it exactly as before.

        /// <summary>
        /// Scans a chunk of reported progress text (one log line, or a multi-line assistant block)
        /// for checklist markers and feeds each hit into the side-panel model. Only real markers
        /// (☐/☑/✓/✔ or "- [ ]"/"- [x]") are picked up — ordinary prose and plain bullets are ignored
        /// (see <see cref="ChecklistExtractor"/>). Safe to call on every text event.
        /// </summary>
        private void ScanForChecklist(BuildWatchSlot slot, string? text)
        {
            if (string.IsNullOrEmpty(text)) return;
            foreach (var raw in text.Split('\n'))
            {
                var line = raw.TrimEnd('\r');
                var marker = ChecklistExtractor.TryParse(line, out var item);
                if (marker == ChecklistExtractor.Marker.None) continue;
                _checklist.Ingest(slot.QueueItemId, ChecklistBuildLabel(slot), slot.GithubNumber, marker, item);
            }
        }

        /// <summary>Short per-build label shown beside each checklist row (matches the pane's own LocalLabel format).</summary>
        private static string ChecklistBuildLabel(BuildWatchSlot slot) =>
            slot.GithubNumber.HasValue ? $"GH #{slot.GithubNumber}" : $"queue #{slot.QueueItemId}";

        /// <summary>
        /// Classifies one completed log line into a transcript turn:
        ///   • "--- done … ---"  → green-tinted AssistantParagraphTurn(Kind=Done)
        ///   • obvious stderr    → red-tinted AssistantParagraphTurn(Kind=Error)
        ///   • text with [tool:] → the prose becomes a normal paragraph; each tool marker folds into the
        ///                         current collapsed "Ran N tools" ToolGroupTurn (see AddToolCallChip)
        ///   • anything else     → a plain AssistantParagraphTurn
        /// </summary>
        private void AppendEventCard(BuildWatchSlot slot, string rawLine)
        {
            var line = rawLine.TrimEnd();

            // Mirror any checklist marker on this line into the side panel first (observe-only —
            // it never consumes the line, which still renders as a normal turn below).
            ScanForChecklist(slot, line);

            // A run of consecutive code-diff lines (a ```diff fence, or a raw unified-diff
            // hunk) folds into ONE DiffTurn — rendered by DiffView as a real green/red
            // diff view — instead of a stack of grey prose paragraphs. Checked BEFORE the
            // empty-line guard because a blank line INSIDE a fenced diff is real code
            // content, not noise. Returns true when the line was consumed by the diff run.
            if (HandleDiffLine(slot, line)) return;

            if (line.Length == 0) return;

            if (line.StartsWith("--- done", StringComparison.Ordinal))
            {
                var label = line.Trim('-', ' ');
                AddParagraph(slot, string.IsNullOrWhiteSpace(label) ? "done" : label, ParagraphKind.Done);
                return;
            }

            if (LooksLikeError(line))
            {
                AddParagraph(slot, line, ParagraphKind.Error);
                return;
            }

            var matches = ToolTokenRegex.Matches(line);
            if (matches.Count == 0)
            {
                AddParagraph(slot, line, ParagraphKind.Normal);
                return;
            }

            // Split "text [tool: X] more text" into prose turn(s) + tool chip(s) in order.
            int cursor = 0;
            foreach (Match m in matches)
            {
                var before = line.Substring(cursor, m.Index - cursor).Trim();
                if (before.Length > 0) AddParagraph(slot, before, ParagraphKind.Normal);

                var toolName = m.Groups[1].Value.Trim();
                AddToolCallChip(slot, toolName);

                cursor = m.Index + m.Length;
            }
            var after = line.Substring(cursor).Trim();
            if (after.Length > 0) AddParagraph(slot, after, ParagraphKind.Normal);
        }

        /// <summary>
        /// Folds a run of consecutive code-diff lines into a single <see cref="DiffTurn"/>,
        /// mirroring how AddToolCallChip folds a run of tool calls into one ToolGroupTurn.
        /// A diff is opened by a strong, low-false-positive anchor — a ```diff fence, or a
        /// raw unified-diff hunk header ("@@ … @@") / "diff --git" line — and then absorbs
        /// its body lines until the fence closes (fenced case) or the first non-diff line
        /// arrives (raw case). Returns true when the line was consumed by diff handling;
        /// false means the caller should classify it normally (prose / tool / done / error).
        /// Ordinary prose and tool-call chips are never touched — only genuine diff content.
        /// </summary>
        private bool HandleDiffLine(BuildWatchSlot slot, string line)
        {
            // Inside a fenced ```diff block: everything up to the closing fence is content.
            if (slot.InDiffFence)
            {
                if (CodeFenceCloseRegex.IsMatch(line)) { FinishDiff(slot); return true; }
                slot.DiffLines!.Add(line);
                return true;
            }

            // Inside a raw (unfenced) diff run: keep absorbing while lines still look like diff body.
            if (slot.DiffLines != null)
            {
                if (IsRawDiffBodyLine(line)) { slot.DiffLines.Add(line); return true; }
                FinishDiff(slot);   // run ended — fall through so THIS line is classified normally
            }

            // Not currently in a diff: does this line open one?
            if (DiffFenceOpenRegex.IsMatch(line)) { StartDiff(slot, fenced: true); return true; }
            if (DiffHunkHeaderRegex.IsMatch(line) || line.StartsWith("diff --git ", StringComparison.Ordinal))
            {
                StartDiff(slot, fenced: false);
                slot.DiffLines!.Add(line);
                return true;
            }

            return false;
        }

        /// <summary>Continuation test for a raw (unfenced) diff run — an add/remove/context/hunk/header line. The build's own "--- done" completion marker is explicitly excluded so it never gets swallowed as a removed line.</summary>
        private static bool IsRawDiffBodyLine(string line)
        {
            if (line.Length == 0) return false;                                   // blank line ends a raw hunk
            if (line.StartsWith("--- done", StringComparison.Ordinal)) return false; // build-complete marker, not a diff line
            char c = line[0];
            return c == '+' || c == '-' || c == ' ' || c == '@' || c == '\\'
                   || line.StartsWith("index ", StringComparison.Ordinal)
                   || line.StartsWith("diff --git ", StringComparison.Ordinal);
        }

        private void StartDiff(BuildWatchSlot slot, bool fenced)
        {
            // No EnsureAssistantRun here — the CLAUDE role header is added by FinishDiff
            // only once real diff content is confirmed, so a false-positive/empty fence
            // never leaves an orphan header behind.
            slot.CurrentToolGroup = null;   // a diff breaks any consecutive tool-chip run, same as a paragraph does
            slot.DiffLines = new List<string>();
            slot.InDiffFence = fenced;
            slot.LastOutputUtc = DateTime.UtcNow;
        }

        /// <summary>
        /// Materializes the collected diff lines into a DiffTurn. Guards against a false
        /// positive (e.g. a ```diff fence that turned out to hold no +/- lines) by replaying
        /// the collected lines as ordinary prose instead — so nothing is ever lost or hidden.
        /// </summary>
        private void FinishDiff(BuildWatchSlot slot)
        {
            var lines = slot.DiffLines;
            slot.DiffLines = null;
            slot.InDiffFence = false;
            if (lines == null) return;

            while (lines.Count > 0 && lines[^1].Length == 0) lines.RemoveAt(lines.Count - 1); // trim trailing blanks
            if (lines.Count == 0) return;

            bool hasChange = lines.Any(l =>
                (l.StartsWith("+", StringComparison.Ordinal) && !l.StartsWith("+++", StringComparison.Ordinal)) ||
                (l.StartsWith("-", StringComparison.Ordinal) && !l.StartsWith("---", StringComparison.Ordinal)));

            if (!hasChange)
            {
                // Not actually a diff — don't hide it behind an empty diff card; show the prose.
                foreach (var l in lines)
                    if (l.Length > 0) AddParagraph(slot, l, ParagraphKind.Normal);
                return;
            }

            EnsureAssistantRun(slot);
            AddTurn(slot, new DiffTurn(string.Join("\n", lines)));
            slot.LastOutputUtc = DateTime.UtcNow;
        }

        private void AddParagraph(BuildWatchSlot slot, string text, ParagraphKind kind)
        {
            EnsureAssistantRun(slot);
            AddTurn(slot, new AssistantParagraphTurn { Text = text, Kind = kind });
            slot.CurrentToolGroup = null;
            slot.LastOutputUtc = DateTime.UtcNow;
        }

        /// <summary>The spec's DOM groups a whole run of paragraphs/tool-groups under ONE "CLAUDE" role header — inserts that marker turn the first time assistant content appears after a user message (or at the very start).</summary>
        private void EnsureAssistantRun(BuildWatchSlot slot)
        {
            if (slot.InAssistantRun) return;
            slot.InAssistantRun = true;
            AddTurn(slot, new AssistantTurnStartTurn());
        }

        private void AddUserMessage(BuildWatchSlot slot, string text)
        {
            slot.InAssistantRun = false;
            AddTurn(slot, new UserMessageTurn(text.Trim()));
        }

        /// <summary>Appends one turn, keeping the live StatusLine (if present) pinned as the LAST item, and trims from the front once over MaxCardsPerSlot.</summary>
        private void AddTurn(BuildWatchSlot slot, TurnItem item)
        {
            var turns = slot.Pane.ViewModel.Turns;
            bool hadStatus = slot.StatusLine != null && turns.Count > 0 && ReferenceEquals(turns[^1], slot.StatusLine);
            if (hadStatus) turns.RemoveAt(turns.Count - 1);
            turns.Add(item);
            if (hadStatus) turns.Add(slot.StatusLine!);
            while (turns.Count > MaxCardsPerSlot) turns.RemoveAt(0);
        }

        private void EnsureStatusLine(BuildWatchSlot slot)
        {
            if (slot.StatusLine != null) return;
            slot.StatusLine = new StatusLineTurn();
            slot.Pane.ViewModel.Turns.Add(slot.StatusLine);
        }

        private void RemoveStatusLine(BuildWatchSlot slot)
        {
            if (slot.StatusLine == null) return;
            slot.Pane.ViewModel.Turns.Remove(slot.StatusLine);
            slot.StatusLine = null;
        }

        /// <summary>
        /// Matches Claude.ai's own chat pattern: a consecutive run of tool calls (Bash, Glob,
        /// Grep, Read, …) folds into a single small muted "Ran N tools" turn instead of one row
        /// per call, click-to-expand to the real per-call detail. For a BuildConsole-owned
        /// interactive build that detail is now genuinely rich — the real command/params, the
        /// real output, and a real diff for file edits (see <see cref="AddInteractiveToolCall"/>).
        /// A foreign/legacy file-tail build only has the tool name (the log FILE keeps the old
        /// "[tool: X]" flattening), so this name-only overload is what it uses — an honest
        /// boundary, nothing faked. AddParagraph clears CurrentToolGroup whenever any other turn
        /// lands, which is what makes a run "consecutive".
        /// </summary>
        private void AddToolCallChip(BuildWatchSlot slot, string toolName) =>
            AddToolCallDetail(slot, toolName, new ToolDetailLine(toolName));

        /// <summary>Folds one already-built <see cref="ToolDetailLine"/> into the slot's current (or a fresh) collapsed tool group.</summary>
        private void AddToolCallDetail(BuildWatchSlot slot, string toolName, ToolDetailLine detail)
        {
            slot.LastOutputUtc = DateTime.UtcNow;
            if (slot.State == SlotState.Running && slot.StatusLine != null)
                slot.StatusLine.ActivityText = $"running {toolName}…";

            var group = slot.CurrentToolGroup;
            if (group == null)
            {
                EnsureAssistantRun(slot);
                group = new ToolGroupTurn();
                slot.CurrentToolGroup = group;
                AddTurn(slot, group);
            }
            group.Details.Add(detail);
            UpdateToolGroupSummary(group);
        }

        /// <summary>"Ran X" for a single call (names the tool), "Ran N tools" once a run has more than one — the exact Claude.ai collapsed-chip phrasing. Glyph: file-text for a single Read, wrench otherwise (matches the spec's two named glyphs).</summary>
        private static void UpdateToolGroupSummary(ToolGroupTurn group)
        {
            var names = group.Details.Select(d => d.ToolName).ToList();
            group.Title = names.Count == 1 ? $"Ran {names[0]}" : $"Ran {names.Count} tools";
            group.Summary = string.Join(" · ", names.Distinct());
            group.GlyphKey = names.Count == 1 && names[0].Equals("Read", StringComparison.OrdinalIgnoreCase) ? "file-text" : "wrench";
        }

        // ── Structured interactive event → transcript turns (the real fix) ──────
        // The interactive Build Watch render consumes the full-fidelity InteractiveEvent
        // stream (real command/args + real tool output), NOT the old flattened "[tool: X]"
        // text lines. AppendEventCard above stays the name-only path for foreign/file-tail builds.

        private const int MaxToolCallsTracked = 2000;

        /// <summary>Turns one structured stream-json event into transcript turns / chip detail.</summary>
        private void ApplyInteractiveEvent(BuildWatchSlot slot, InteractiveEvent ev)
        {
            switch (ev.Kind)
            {
                case InteractiveEventKind.AssistantText:
                    {
                        var text = (ev.Text ?? "").TrimEnd();
                        if (text.Length == 0) return;
                        // Scan the full (possibly multi-line) block for checklist markers before it's
                        // rendered — the structured stream delivers a whole paragraph per event.
                        ScanForChecklist(slot, text);
                        AddParagraph(slot, text, (ev.IsError || LooksLikeError(text)) ? ParagraphKind.Error : ParagraphKind.Normal);
                        break;
                    }
                case InteractiveEventKind.ToolCall:
                    AddInteractiveToolCall(slot, ev);
                    break;
                case InteractiveEventKind.ToolResult:
                    FillToolResult(slot, ev);
                    TryResolveStructuredTaskResult(slot, ev);
                    break;
                case InteractiveEventKind.TurnResult:
                    {
                        var dur = ev.DurationMs.HasValue ? $" ({ev.DurationMs}ms)" : "";
                        AddParagraph(slot, $"done{dur}", ParagraphKind.Done);
                        if (!string.IsNullOrWhiteSpace(ev.Text))
                        {
                            // A wrap-up message can restate the checklist with items now ticked.
                            ScanForChecklist(slot, ev.Text);
                            AddParagraph(slot, ev.Text!.Trim(), ParagraphKind.Normal);
                        }
                        break;
                    }
            }
        }

        /// <summary>Builds a rich tool-call chip detail from a ToolCall event — real command preview, an Edit/Write/MultiEdit diff, and a slot in <see cref="BuildWatchSlot.ToolCallsById"/> so its later tool_result can fill in the real output.</summary>
        private void AddInteractiveToolCall(BuildWatchSlot slot, InteractiveEvent ev)
        {
            var toolName = string.IsNullOrWhiteSpace(ev.ToolName) ? "tool" : ev.ToolName!;
            var detail = new ToolDetailLine(toolName, ev.ToolUseId, ev.CommandPreview)
            {
                Diff = BuildDiffForToolCall(toolName, ev.InputJson),
            };
            if (!string.IsNullOrEmpty(ev.ToolUseId))
            {
                if (slot.ToolCallsById.Count >= MaxToolCallsTracked) slot.ToolCallsById.Clear(); // bound memory on a very long build
                slot.ToolCallsById[ev.ToolUseId!] = detail;
            }
            AddToolCallDetail(slot, toolName, detail);

            // If this is a Task-tool call, ALSO mirror its real structured data into the checklist
            // side panel (the reliable path that supersedes #28's text matching). The chip above still
            // renders it as ordinary agent activity — this is additive, never a substitute for the chip.
            TryIngestStructuredTaskCall(slot, ev);
        }

        // ── Structured Task-tool checklist (TaskCreate / TaskUpdate) ─────────────
        // TodoWrite is a disabled legacy path in current Claude Code; the live mechanism is the
        // structured Task tools, which carry real task data (a subject, an explicit id, a status)
        // as JSON fields on their tool-call events — not text to pattern-match. We drive the Task
        // Checklist side panel off those directly here, keeping #28's free-form checkbox-text
        // detection (ScanForChecklist, still wired above) as the fallback for agents that print
        // text checklists without using the Task tools, so nothing regresses.

        /// <summary>Parses "Task #N" out of a TaskCreate tool_result so the pending row created on the
        /// call can be bound to the id a later TaskUpdate references.</summary>
        private static readonly Regex TaskCreatedIdRegex =
            new(@"Task\s+#?(\d+)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /// <summary>If this tool call is a <c>TaskCreate</c>/<c>TaskUpdate</c>, mirror its real structured
        /// data into the checklist panel. TaskCreate adds a pending row from the task's own subject and is
        /// remembered by tool_use id so its result can bind the assigned "Task #N"; TaskUpdate flips (or
        /// drops) the matching row by that real id. A no-op for every other tool.</summary>
        private void TryIngestStructuredTaskCall(BuildWatchSlot slot, InteractiveEvent ev)
        {
            var name = ev.ToolName;
            if (string.IsNullOrEmpty(name)) return;

            if (name.Equals("TaskCreate", StringComparison.OrdinalIgnoreCase))
            {
                var text = ExtractTaskCreateText(ev.InputJson);
                if (string.IsNullOrWhiteSpace(text)) return;
                var row = _checklist.AddStructuredTask(slot.QueueItemId, ChecklistBuildLabel(slot), slot.GithubNumber, text!);
                if (!string.IsNullOrEmpty(ev.ToolUseId))
                {
                    if (slot.PendingTaskCreatesByUseId.Count >= MaxToolCallsTracked) slot.PendingTaskCreatesByUseId.Clear();
                    slot.PendingTaskCreatesByUseId[ev.ToolUseId!] = row;
                }
            }
            else if (name.Equals("TaskUpdate", StringComparison.OrdinalIgnoreCase))
            {
                if (!TryParseTaskUpdate(ev.InputJson, out var taskId, out bool done, out bool deleted)) return;
                _checklist.MarkStructuredStatus(slot.QueueItemId, taskId, done, deleted);
            }
        }

        /// <summary>Binds a pending TaskCreate row to the real "Task #N" id parsed from that create call's
        /// tool_result, so a subsequent TaskUpdate (which references the task by that id) flips the exact
        /// row. A no-op when the result isn't for a tracked TaskCreate.</summary>
        private void TryResolveStructuredTaskResult(BuildWatchSlot slot, InteractiveEvent ev)
        {
            if (string.IsNullOrEmpty(ev.ResultForToolUseId)) return;
            if (!slot.PendingTaskCreatesByUseId.TryGetValue(ev.ResultForToolUseId!, out var row)) return;
            slot.PendingTaskCreatesByUseId.Remove(ev.ResultForToolUseId!);
            var m = TaskCreatedIdRegex.Match(ev.Text ?? "");
            if (m.Success) row.AssignTaskId(m.Groups[1].Value);
        }

        /// <summary>Pulls the display label out of a TaskCreate call's raw <c>input</c> — the concise
        /// <c>subject</c> (a task's brief title, the natural checklist-row label), falling back to
        /// <c>description</c> then <c>activeForm</c>. Null when none is present.</summary>
        private static string? ExtractTaskCreateText(string? inputJson)
        {
            if (string.IsNullOrWhiteSpace(inputJson)) return null;
            try
            {
                using var doc = JsonDocument.Parse(inputJson);
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object) return null;
                string? S(string k) => root.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                var text = S("subject");
                if (string.IsNullOrWhiteSpace(text)) text = S("description");
                if (string.IsNullOrWhiteSpace(text)) text = S("activeForm");
                return string.IsNullOrWhiteSpace(text) ? null : text!.Trim();
            }
            catch { return null; }
        }

        /// <summary>Reads a TaskUpdate call's raw <c>input</c>: its <c>taskId</c> (string or number,
        /// leading '#'/whitespace normalized off) and whether its <c>status</c> marks the task done
        /// ("completed"/"done") or deleted. False when there's no usable taskId.</summary>
        private static bool TryParseTaskUpdate(string? inputJson, out string taskId, out bool done, out bool deleted)
        {
            taskId = ""; done = false; deleted = false;
            if (string.IsNullOrWhiteSpace(inputJson)) return false;
            try
            {
                using var doc = JsonDocument.Parse(inputJson);
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object) return false;
                if (!root.TryGetProperty("taskId", out var tid)) return false;
                taskId = tid.ValueKind == JsonValueKind.String ? (tid.GetString() ?? "")
                       : tid.ValueKind == JsonValueKind.Number ? tid.GetRawText()
                       : "";
                taskId = taskId.TrimStart('#').Trim();
                if (taskId.Length == 0) return false;
                var status = root.TryGetProperty("status", out var st) && st.ValueKind == JsonValueKind.String ? st.GetString() : null;
                if (!string.IsNullOrEmpty(status))
                {
                    done = status.Equals("completed", StringComparison.OrdinalIgnoreCase) || status.Equals("done", StringComparison.OrdinalIgnoreCase);
                    deleted = status.Equals("deleted", StringComparison.OrdinalIgnoreCase);
                }
                return true;
            }
            catch { return false; }
        }

        /// <summary>Fills a prior tool call's chip with its real output when the matching tool_result event lands. Does NOT break the tool group (CurrentToolGroup stays), so consecutive calls keep folding into one chip.</summary>
        private void FillToolResult(BuildWatchSlot slot, InteractiveEvent ev)
        {
            if (string.IsNullOrEmpty(ev.ResultForToolUseId)) return;
            if (!slot.ToolCallsById.TryGetValue(ev.ResultForToolUseId!, out var detail)) return;

            var outText = ev.Text ?? "";
            const int cap = 4000;
            if (outText.Length > cap) outText = outText.Substring(0, cap) + $"\n… (+{outText.Length - cap} more chars)";
            detail.Output = outText;
            detail.IsError = ev.IsError;
            slot.LastOutputUtc = DateTime.UtcNow;
        }

        // ── File-edit diff rendering (Edit / Write / MultiEdit) ─────────────────

        /// <summary>Max diff lines rendered for one file-edit chip (a huge edit is truncated with a marker, never silently).</summary>
        private const int MaxDiffLines = 60;

        /// <summary>
        /// Builds a real colored diff from a file-edit tool call's raw `input` — the genuine
        /// before/after content the agent is writing, not a fabricated approximation. Edit uses
        /// old_string→new_string, Write shows the whole new content as additions, MultiEdit shows
        /// each edit. Returns null for any non-file-edit tool (its chip just shows command+output).
        /// </summary>
        private static ObservableCollection<DiffLine>? BuildDiffForToolCall(string toolName, string? inputJson)
        {
            if (string.IsNullOrWhiteSpace(inputJson)) return null;
            JsonDocument doc;
            try { doc = JsonDocument.Parse(inputJson); }
            catch { return null; }

            using (doc)
            {
                var input = doc.RootElement;
                if (input.ValueKind != JsonValueKind.Object) return null;
                string? S(string k) => input.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

                var lines = new ObservableCollection<DiffLine>();
                switch (toolName)
                {
                    case "Write":
                        {
                            var content = S("content");
                            if (content == null) return null;
                            lines.Add(new DiffLine($"＋ new file · {S("file_path")}", DiffLineKind.Meta));
                            AppendReplaceBlock(lines, "", content);
                            break;
                        }
                    case "Edit":
                        {
                            var oldS = S("old_string"); var newS = S("new_string");
                            if (oldS == null || newS == null) return null;
                            lines.Add(new DiffLine($"✎ {S("file_path")}", DiffLineKind.Meta));
                            AppendReplaceBlock(lines, oldS, newS);
                            break;
                        }
                    case "MultiEdit":
                        {
                            if (!input.TryGetProperty("edits", out var edits) || edits.ValueKind != JsonValueKind.Array) return null;
                            lines.Add(new DiffLine($"✎ {S("file_path")} · {edits.GetArrayLength()} edits", DiffLineKind.Meta));
                            int i = 0;
                            foreach (var e in edits.EnumerateArray())
                            {
                                if (e.ValueKind != JsonValueKind.Object) continue;
                                if (i++ > 0) AddDiff(lines, "┈┈┈┈┈", DiffLineKind.Context);
                                var oldS = e.TryGetProperty("old_string", out var o) && o.ValueKind == JsonValueKind.String ? o.GetString() : null;
                                var newS = e.TryGetProperty("new_string", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null;
                                AppendReplaceBlock(lines, oldS ?? "", newS ?? "");
                            }
                            break;
                        }
                    default:
                        return null;
                }
                return lines.Count > 0 ? lines : null;
            }
        }

        /// <summary>Appends a minimal before→after diff for one replacement: common leading/trailing lines are kept as a little context, the changed middle is shown as "-" removed then "+" added lines.</summary>
        private static void AppendReplaceBlock(ObservableCollection<DiffLine> lines, string oldText, string newText)
        {
            var oldLines = oldText.Length == 0 ? Array.Empty<string>() : oldText.Replace("\r\n", "\n").Split('\n');
            var newLines = newText.Length == 0 ? Array.Empty<string>() : newText.Replace("\r\n", "\n").Split('\n');

            int p = 0; // common prefix
            while (p < oldLines.Length && p < newLines.Length && oldLines[p] == newLines[p]) p++;
            int s = 0; // common suffix (not overlapping the prefix)
            while (s < oldLines.Length - p && s < newLines.Length - p &&
                   oldLines[oldLines.Length - 1 - s] == newLines[newLines.Length - 1 - s]) s++;

            int ctxBefore = Math.Min(2, p);
            for (int i = p - ctxBefore; i < p; i++) AddDiff(lines, "  " + oldLines[i], DiffLineKind.Context);
            for (int i = p; i < oldLines.Length - s; i++) AddDiff(lines, "- " + oldLines[i], DiffLineKind.Removed);
            for (int i = p; i < newLines.Length - s; i++) AddDiff(lines, "+ " + newLines[i], DiffLineKind.Added);
            int ctxAfter = Math.Min(2, s);
            for (int i = oldLines.Length - s; i < oldLines.Length - s + ctxAfter; i++) AddDiff(lines, "  " + oldLines[i], DiffLineKind.Context);
        }

        private static void AddDiff(ObservableCollection<DiffLine> lines, string text, DiffLineKind kind)
        {
            if (lines.Count >= MaxDiffLines)
            {
                if (lines.Count == MaxDiffLines) lines.Add(new DiffLine("… (diff truncated)", DiffLineKind.Context));
                return;
            }
            lines.Add(new DiffLine(text, kind));
        }

        /// <summary>
        /// Refreshes the live status turn's activity text while a slot is running. Normally alternates between
        /// "working…" (output landed recently) and "thinking…" (a quiet stretch). During a longer quiet stretch it
        /// occasionally swaps in an easter-egg phrase and pins it briefly so it doesn't flicker away on the very
        /// next poll. Called once per poll tick per running slot.
        /// </summary>
        private void UpdateThinkingText(BuildWatchSlot slot, bool verifying)
        {
            if (slot.StatusLine == null) return;
            slot.StatusLine.Spinning = true;
            if (verifying) { slot.StatusLine.ActivityText = "verifying…"; return; }

            var now = DateTime.UtcNow;
            if (now < slot.EasterEggUntilUtc) return; // let a rolled easter egg linger

            var idle = now - slot.LastOutputUtc;
            if (idle < TimeSpan.FromSeconds(6))
            {
                slot.StatusLine.ActivityText = "working…";
                return;
            }

            if (_rng.NextDouble() < 0.12)
            {
                slot.StatusLine.ActivityText = EasterEggPhrases[_rng.Next(EasterEggPhrases.Length)];
                slot.EasterEggUntilUtc = now + TimeSpan.FromSeconds(9);
            }
            else
            {
                slot.StatusLine.ActivityText = "thinking…";
            }
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

                    // Real token usage (interactive builds only — the file-tail path only
                    // ever sees already-summarized lines, no raw usage JSON to read).
                    if (slot.InteractiveBound && _watcher != null)
                    {
                        var ctx = _watcher.GetContextTokens(slot.QueueItemId);
                        slot.Pane.ViewModel.TokensUsed = ctx;
                        slot.Pane.ViewModel.TokenBudget = ctx.HasValue ? StandardContextWindowTokens : (long?)null;
                    }

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
                        slot.LastInteractiveState = null;
                        if (slot.State == SlotState.Running)
                            UpdateThinkingText(slot, slot.Verifying); // refresh activity line / roll the easter egg
                    }
                }

                // 2) Admit newly-running builds into free / oldest-completed slots.
                AdmitNewRunning(queue);

                // 3) Manual-only GitHub (Shane, 2026-08-14): the ≈30s automatic
                // `gh` issue-closure check (CheckIssueClosuresAsync — one gh CLI
                // spawn against GitHub's shared 5,000/hr limit, every 10th 3s
                // tick, the whole time this window was open) is DISABLED. Shane:
                // "this app is killing my git connections... turn git into a
                // manual refresh." A slot whose GitHub issue is closed is no
                // longer auto-removed here — dismiss it with the slot's own
                // manual close (unchanged), which costs zero GitHub traffic. The
                // rest of this tick (queue reconcile / admit) is local dev-server
                // data, not GitHub, and keeps its 3s cadence.

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
            var vm = slot.Pane.ViewModel;

            // If a code diff was still being collected when the run ended, flush it now so
            // its content isn't lost — the raw-run case normally closes on the next non-diff
            // line, but a build can go terminal/stale without one ever arriving.
            if (newState is SlotState.Done or SlotState.Failed or SlotState.Stale)
                FinishDiff(slot);

            switch (newState)
            {
                case SlotState.Running:
                    slot.Verifying = verifying;
                    vm.Mode = slot.InteractiveBound ? ComposerMode.Interactive : ComposerMode.ReadOnlyRunning;
                    vm.CanStop = slot.InteractiveBound;
                    slot.CompletedAtUtc = null;
                    slot.Container.BorderBrush = _emptyBorder;
                    slot.Container.BorderThickness = new Thickness(1);
                    EnsureStatusLine(slot);
                    // For a BuildConsole-owned interactive build the pill/border/thinking
                    // are owned by ApplyInteractiveState (which knows the real
                    // working/paused/waiting sub-state); don't fight it here.
                    if (!slot.InteractiveBound)
                    {
                        ApplyPillTone(slot, "Running", verifying ? "VERIFYING…" : "RUNNING",
                            verifying ? "Queue reported failed with the #943 orphan-sweep sentinel (exit -2) — holding as running until a real exit code lands." : null,
                            pulsing: false);
                        if (changed) UpdateThinkingText(slot, verifying);
                    }
                    break;

                case SlotState.Done:
                    slot.Verifying = false;
                    vm.Mode = ComposerMode.Terminal;
                    vm.CanStop = false;
                    slot.Container.BorderBrush = _ringSuccess;
                    slot.Container.BorderThickness = new Thickness(3); // the "green overlay around the completed one"
                    ApplyPillTone(slot, "Success", exitCode.HasValue ? $"DONE ✓ (exit {exitCode})" : "DONE ✓", null, pulsing: false);
                    slot.CompletedAtUtc ??= DateTime.UtcNow;
                    RemoveStatusLine(slot);
                    break;

                case SlotState.Failed:
                    slot.Verifying = false;
                    vm.Mode = ComposerMode.Terminal;
                    vm.CanStop = false;
                    slot.Container.BorderBrush = _ringDanger;
                    slot.Container.BorderThickness = new Thickness(3);
                    ApplyPillTone(slot, "Error", exitCode.HasValue ? $"FAILED (exit {exitCode})" : "FAILED", null, pulsing: false);
                    slot.CompletedAtUtc ??= DateTime.UtcNow;
                    RemoveStatusLine(slot);
                    break;

                case SlotState.Stale:
                    slot.Verifying = false;
                    vm.Mode = ComposerMode.Terminal;
                    vm.CanStop = false;
                    slot.Container.BorderBrush = _ringWarning;
                    slot.Container.BorderThickness = new Thickness(2);
                    ApplyPillTone(slot, "Warning", "NOT IN QUEUE",
                        "This build's queue row disappeared while it was running — its process may still be alive (see #943). Not treated as done; dismiss it yourself when you're sure.",
                        pulsing: false);
                    slot.CompletedAtUtc = null; // deliberately not a confirmed completion
                    RemoveStatusLine(slot);
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
            // If this slot was reused (evicted straight into a new build, no ClearSlot in between),
            // drop the previous occupant's checklist rows before the new build's start streaming.
            if (slot.QueueItemId != 0 && slot.QueueItemId != item.Id)
                _checklist.RemoveForBuild(slot.QueueItemId);

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
            slot.RunStartedUtc = DateTime.UtcNow;
            slot.InAssistantRun = false;
            slot.CurrentToolGroup = null;
            slot.ToolCallsById.Clear();
            slot.PendingTaskCreatesByUseId.Clear();
            slot.DiffLines = null;
            slot.InDiffFence = false;
            slot.StatusLine = null;

            var vm = slot.Pane.ViewModel;
            vm.Turns.Clear();
            vm.Draft = "";
            vm.SessionLabel = slot.Title;
            vm.LocalLabel = slot.GithubNumber.HasValue ? $"GH #{slot.GithubNumber}" : $"queue #{item.Id}";
            vm.ModelLabel = string.IsNullOrWhiteSpace(item.Model) ? "" : item.Model!;
            vm.TokensUsed = null;
            vm.TokenBudget = null;

            slot.EmptyText.Visibility = Visibility.Collapsed;
            slot.ContentGrid.Visibility = Visibility.Visible;

            // Interactive rebind — is this a build THIS app owns the stdin of?
            slot.Cwd = item.Cwd;
            slot.Pane.Cwd = item.Cwd;
            slot.InteractiveCursor = 0;
            slot.PendingRender.Clear();
            slot.RenderPumpScheduled = false;
            slot.LastInteractiveState = null;
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

            // This build's checklist rows belong to it — drop them as the slot frees.
            _checklist.RemoveForBuild(id);

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
            slot.PendingRender.Clear();
            slot.RenderPumpScheduled = false;
            slot.LastInteractiveState = null;
            slot.Cwd = null;
            slot.Pane.Cwd = null;
            slot.CurrentToolGroup = null;
            slot.ToolCallsById.Clear();
            slot.PendingTaskCreatesByUseId.Clear();
            slot.StatusLine = null;
            slot.InAssistantRun = false;

            var vm = slot.Pane.ViewModel;
            vm.Turns.Clear();
            vm.Draft = "";
            vm.Mode = ComposerMode.ReadOnlyRunning;
            vm.CanStop = false;
            vm.TokensUsed = null;
            vm.TokenBudget = null;

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
                    slot.Pane.ViewModel.Turns.Clear();
                    slot.CurrentToolGroup = null;
                    slot.DiffLines = null;
                    slot.InDiffFence = false;
                    slot.StatusLine = null;
                    slot.InAssistantRun = false;
                }
                if (fs.Length <= slot.TailedLength) return;
                fs.Seek(slot.TailedLength, SeekOrigin.Begin);
                using var reader = new StreamReader(fs);
                string newText = reader.ReadToEnd();
                slot.TailedLength = fs.Length;

                // Accumulate and emit one turn per COMPLETE line — the watcher writes
                // each event as `summary + NewLine`, so a turn only forms on a newline;
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
        /// Renders an owned interactive build's live output by pulling the full-fidelity
        /// structured events the watcher has buffered since our cursor (real command/args +
        /// real tool output, replacing the old flattened "[tool: X]" strings) and turning each
        /// into transcript turns / rich chip detail. The foreign/legacy file-tail path
        /// (<see cref="TailSlotLog"/> → <see cref="AppendEventCard"/>) is unchanged and stays
        /// name-only, an honest boundary.
        /// </summary>
        /// <summary>
        /// Max structured events rendered into the transcript per UI-thread pump pass before the pump
        /// yields (re-posts itself at <see cref="DispatcherPriority.Background"/>). Keeps each pass short
        /// so input, layout and render stay responsive while a big backlog drains.
        /// </summary>
        private const int RenderChunkBudget = 40;
        /// <summary>
        /// Hard cap on a slot's un-rendered backlog. Beyond this the oldest surplus is dropped — it would
        /// only be rendered and then immediately trimmed off the far end of the ≤<see cref="MaxCardsPerSlot"/>
        /// transcript anyway (pure wasted UI-thread work, and the thing that made "catch up" freeze the whole
        /// app) — with one honest inline marker so the skip is visible, never silent.
        /// </summary>
        private const int MaxPendingRender = 600;
        /// <summary>A pull larger than this (a build outrunning the render) is logged with real counts so the batching behaviour is diagnosable.</summary>
        private const int LargePullLogThreshold = 200;
        /// <summary>A pump pass slower than this is logged with real timing (ms + counts) so flush/batching cost is visible in the log.</summary>
        private const int SlowPumpLogThresholdMs = 60;

        /// <summary>
        /// Pulls the owned interactive build's newly-buffered structured events into this slot's
        /// <see cref="BuildWatchSlot.PendingRender"/> queue and kicks the chunked render pump — it does
        /// NOT render them inline any more.
        ///
        /// The freeze this fixes: the old body rendered the ENTIRE per-poll backlog (up to
        /// <see cref="Services.QueueWatcherService"/>'s ~4000 buffered events) in one synchronous
        /// <c>foreach</c>, and did so for EVERY occupied slot inside a single <see cref="PollAsync"/>
        /// tick, into a NON-virtualized ItemsControl (ChatSessionPane transcript) whose every add forces a
        /// full measure/arrange + <c>ScrollToEnd()</c>. A fast build emits hundreds–thousands of stream-json
        /// lines between the 3s polls, so the catch-up was ~O(n²) work that blocked the one Dispatcher thread
        /// (every window) until it finished — exactly the "not staying live, then hangs the whole app on catch
        /// up; 6 slots all stamped the same instant" symptom. Now the pull is cheap (enqueue only) and the
        /// actual rendering is bounded + yielded by <see cref="PumpSlotRender"/>.
        /// </summary>
        private void DrainInteractiveOutput(BuildWatchSlot slot)
        {
            if (_watcher == null) return;
            int cursor = slot.InteractiveCursor;
            List<InteractiveEvent> events;
            try { events = _watcher.CopyEventsSince(slot.QueueItemId, ref cursor); }
            catch { return; }
            slot.InteractiveCursor = cursor;

            if (events.Count > 0)
            {
                foreach (var ev in events) slot.PendingRender.Enqueue(ev);
                if (events.Count >= LargePullLogThreshold)
                    ActivityLog.Log("build-watch", $"render backlog: pulled {events.Count} event(s) this poll for {slot.Title} (queue #{slot.QueueItemId}); {slot.PendingRender.Count} now queued to render (build is outrunning the UI — draining in {RenderChunkBudget}-event chunks)");
                CoalescePendingIfHuge(slot);
            }
            // Kick (or keep) the pump even on an empty pull — an earlier backlog may still be draining.
            EnsureRenderPump(slot);
        }

        /// <summary>
        /// Guards against a runaway-fast build burying the UI thread: only the last
        /// <see cref="MaxCardsPerSlot"/> turns can survive the transcript's front-trim, so a backlog past
        /// <see cref="MaxPendingRender"/> is mostly events that would be rendered and instantly trimmed —
        /// wasted work and the direct cause of the whole-app freeze on catch-up. Drop the oldest surplus,
        /// keep the recent tail, and render ONE honest inline marker so the skip is visible, not silent.
        /// Dropping un-rendered events is safe: a later <c>tool_result</c> whose <c>tool_use</c> chip was
        /// dropped simply finds no chip in <see cref="BuildWatchSlot.ToolCallsById"/> and is a no-op.
        /// UI-thread only (called from <see cref="DrainInteractiveOutput"/>).
        /// </summary>
        private void CoalescePendingIfHuge(BuildWatchSlot slot)
        {
            if (slot.PendingRender.Count <= MaxPendingRender) return;
            int drop = slot.PendingRender.Count - MaxPendingRender;
            for (int i = 0; i < drop; i++) slot.PendingRender.Dequeue();
            AddParagraph(slot, $"… (skipped {drop} buffered event{(drop == 1 ? "" : "s")} to catch up)", ParagraphKind.Normal);
            ActivityLog.Log("build-watch", $"render backlog coalesced: dropped {drop} un-rendered event(s) for {slot.Title} (queue #{slot.QueueItemId}) to keep the UI responsive; {slot.PendingRender.Count} kept");
        }

        /// <summary>Schedules the yielding render pump for a slot if one isn't already pending and there's anything to render.</summary>
        private void EnsureRenderPump(BuildWatchSlot slot)
        {
            if (slot.RenderPumpScheduled || slot.PendingRender.Count == 0) return;
            slot.RenderPumpScheduled = true;
            // Background priority: the pump runs after pending input/layout/render, so the app stays
            // responsive; it re-posts itself between chunks rather than looping, letting a big backlog
            // drain smoothly instead of blocking the Dispatcher thread in one synchronous flush.
            Dispatcher.BeginInvoke(new Action(() => PumpSlotRender(slot)), DispatcherPriority.Background);
        }

        /// <summary>
        /// Renders at most <see cref="RenderChunkBudget"/> queued events into the transcript, then — if any
        /// remain — re-posts itself at Background priority instead of continuing to loop. This is the core of
        /// the freeze fix: each UI-thread pass is bounded and the thread is released between passes, so a
        /// catch-up drains progressively and never hangs the app. Real per-slow-chunk timing is logged.
        /// </summary>
        private void PumpSlotRender(BuildWatchSlot slot)
        {
            slot.RenderPumpScheduled = false;
            // Slot dismissed / rebound to a non-interactive build since scheduling: nothing to render.
            if (!slot.Occupied || !slot.InteractiveBound) { slot.PendingRender.Clear(); return; }
            if (slot.PendingRender.Count == 0) return;

            var sw = System.Diagnostics.Stopwatch.StartNew();
            int rendered = 0;
            while (rendered < RenderChunkBudget && slot.PendingRender.Count > 0)
            {
                ApplyInteractiveEvent(slot, slot.PendingRender.Dequeue());
                rendered++;
            }
            sw.Stop();

            if (sw.ElapsedMilliseconds >= SlowPumpLogThresholdMs)
                ActivityLog.Log("build-watch", $"render pump chunk: {rendered} event(s) in {sw.ElapsedMilliseconds}ms, {slot.PendingRender.Count} still queued ({slot.Title}, queue #{slot.QueueItemId})");

            if (slot.PendingRender.Count > 0) EnsureRenderPump(slot);
        }

        /// <summary>
        /// Drives the composer's Mode + pill + status-line for a live owned interactive
        /// build: Working (blue/RUNNING), WaitingForInput (warning tone, pulsing "NEEDS
        /// INPUT"), Stopped/paused (idle tone, muted). Idempotent and gated on a real
        /// sub-state change so it never restarts animations per poll.
        /// </summary>
        private void ApplyInteractiveState(BuildWatchSlot slot, InteractiveInputState state)
        {
            slot.Pane.ViewModel.Mode = ComposerMode.Interactive;
            slot.Pane.ViewModel.CanStop = state == InteractiveInputState.Working;
            EnsureStatusLine(slot);

            if (slot.LastInteractiveState == state) return; // no visual churn on an unchanged state
            slot.LastInteractiveState = state;

            switch (state)
            {
                case InteractiveInputState.Working:
                    slot.Container.BorderBrush = _emptyBorder;
                    slot.Container.BorderThickness = new Thickness(1);
                    ApplyPillTone(slot, "Running", "RUNNING", "Working — type below to steer it mid-task; text goes straight to its stdin.", pulsing: false);
                    slot.StatusLine!.ActivityText = "working…";
                    slot.StatusLine!.Spinning = true;
                    break;

                case InteractiveInputState.WaitingForInput:
                    slot.Container.BorderBrush = _ringWarning;
                    slot.Container.BorderThickness = new Thickness(3);
                    ApplyPillTone(slot, "Warning", "✋ NEEDS INPUT", "This build finished its turn and is waiting on you — reply to continue, or it wraps up on its own shortly.", pulsing: true);
                    slot.StatusLine!.ActivityText = "waiting for your input…";
                    slot.StatusLine!.Spinning = false;
                    break;

                case InteractiveInputState.Stopped:
                    slot.Container.BorderBrush = _ringMuted;
                    slot.Container.BorderThickness = new Thickness(2);
                    ApplyPillTone(slot, "Idle", "⏸ PAUSED", "Interrupted — Send corrective guidance to redirect it, or Stop again to hard-kill.", pulsing: false);
                    slot.StatusLine!.ActivityText = "stopped — send guidance to resume…";
                    slot.StatusLine!.Spinning = false;
                    break;
            }
        }

        /// <summary>Send clicked / Enter pressed (raised by ChatSessionPane.SendRequested) — types the text into the running build's real stdin, echoes it as a user turn.</summary>
        private void SendSlotInput(BuildWatchSlot slot, string text)
        {
            if (_watcher == null || string.IsNullOrWhiteSpace(text)) return;
            _watcher.SendInput(slot.QueueItemId, text);
            AddUserMessage(slot, text);
            // Reflect immediately: back to working; force a re-apply next poll.
            slot.LastInteractiveState = null;
            ApplyPillTone(slot, "Running", "RUNNING", "Working — type below to steer it mid-task; text goes straight to its stdin.", pulsing: false);
            EnsureStatusLine(slot);
            slot.StatusLine!.ActivityText = "working…";
            slot.StatusLine!.Spinning = true;
        }

        /// <summary>Stop clicked (raised by ChatSessionPane.StopRequested) — soft interrupt (escalating to a hard kill in the watcher if unresponsive / on a repeat press). Optimistically shows the paused state right away.</summary>
        private void StopSlot(BuildWatchSlot slot)
        {
            if (_watcher == null) return;
            _ = _watcher.RequestStopAsync(slot.QueueItemId);
            slot.LastInteractiveState = null;
            ApplyInteractiveState(slot, InteractiveInputState.Stopped);
        }

        /// <summary>Ticks the composer footer's "Running for Nm Ss" label for every occupied slot — spec: "ticking every second while RunState is Running" (kept ticking for terminal slots too, showing total elapsed since Build Watch started watching).</summary>
        private void UpdateElapsedLabels()
        {
            var now = DateTime.UtcNow;
            foreach (var slot in _slots.Where(s => s.Occupied))
                slot.Pane.ViewModel.ElapsedLabel = "Running for " + FormatElapsed(now - slot.RunStartedUtc);
        }

        private static string FormatElapsed(TimeSpan ts)
        {
            if (ts.TotalHours >= 1) return $"{(int)ts.TotalHours}h {ts.Minutes}m";
            return $"{(int)ts.TotalMinutes}m {ts.Seconds}s";
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
        ///
        /// Manual-only GitHub (Shane, 2026-08-14): NO LONGER CALLED AUTOMATICALLY.
        /// Its ≈30s `gh` poll was real, continuous GitHub traffic on the shared
        /// 5,000/hr limit ("this app is killing my git connections"), so the tick
        /// that invoked it (see PollAsync) was removed. Retained intact so a future
        /// explicit "re-check closures" action can call it on demand; until then a
        /// closed issue's slot is simply dismissed with the slot's own manual close.
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
            BtnMaximizeRestoreIcon.Text = maximized ? "" : "";
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
