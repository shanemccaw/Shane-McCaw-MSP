using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows.Threading;

namespace BuildConsole.Services
{
    /// <summary>
    /// Focus Mode — the single behavioral-design spine that sits on TOP of every
    /// panel (Git Board, Chats, Build Queue, Home). It is deliberately one service,
    /// not four features, because Shane's problem is one thing: builds have downtime,
    /// downtime turns into "more fun" side quests, side quests eat the day.
    ///
    /// The five pieces this owns:
    ///   1. Active-milestone declaration (one at a time, persisted).
    ///   2. The hard global filter predicate every panel consults to HIDE off-milestone
    ///      content (genuinely hidden, not deprioritised).
    ///   3. Downtime detection — genuine build-slot saturation: every one of the 8 Build
    ///      Watch slots is occupied AND the queue still has items waiting behind them —
    ///      with quick on-milestone task suggestions. (No idle timer: Shane never lets
    ///      builds sit, so "he's idle" was the wrong signal; a full-and-backed-up queue
    ///      is the real "nothing more I can start right now" moment.)
    ///   4. Automatic context snapshot on downtime + auto-restore when the build that
    ///      caused it finishes (or a quick task is finished/dismissed).
    ///   5. A tasteful game layer over the REAL milestone numbers (honest closed/total,
    ///      a least-squares ETA reusing <see cref="UsageProjection"/>'s math, points and
    ///      earned achievements).
    ///
    /// Everything is single-window: this raises events; MainWindow / FocusModeBar react
    /// inside the existing multi-pane shell. Nothing here opens a window.
    ///
    /// Threading: every entry point runs on the WPF UI Dispatcher (LeftSidebar populate,
    /// the queue watcher's DispatcherTimer, this class's own DispatcherTimer), so state
    /// is single-threaded by construction; only disk I/O is wrapped defensively.
    /// All notable transitions are logged on the <c>focus-mode</c> ActivityLog channel.
    /// </summary>
    public class FocusModeService
    {
        private static readonly Lazy<FocusModeService> _instance = new(() => new FocusModeService());
        public static FocusModeService Instance => _instance.Value;

        // ---- tunables --------------------------------------------------
        private const int PointsPerClose = 10;
        private const int MaxSuggestions = 5;
        // ETA confidence gates (mirrors UsageProjection's spirit; closes are rarer than
        // usage ticks, so the span gate is looser but never trusts one or two points).
        private const int MinEtaSamples = 3;
        private static readonly TimeSpan MinEtaSpan = TimeSpan.FromHours(1);

        // ---- injected probes (set once by MainWindow.InitFocusMode) -----
        /// <summary>Real build-slot saturation right now (occupied slots, queued backlog, slot capacity)
        /// read from the shared server queue snapshot. This — not any idle timer — is the downtime signal.</summary>
        private Func<FocusBuildSaturation>? _buildSaturation;
        private Func<FocusContextSnapshot?>? _captureContext;
        private Action<FocusContextSnapshot>? _restoreContext;

        // ---- live state ------------------------------------------------
        private FocusPersistState _state = new();
        private DispatcherTimer? _timer;
        private bool _started;

        // board snapshot (issue -> milestone map + raw issues for suggestions)
        private Dictionary<int, int?> _issueToMilestone = new();
        private List<GitBoardIssue> _issues = new();
        private List<FocusMilestone> _milestones = new();
        private List<BoardChat> _chats = new();
        private Dictionary<int, BoardEpic> _epicById = new();

        // downtime machine
        private bool _inDowntime;
        private FocusContextSnapshot? _pendingRestore; // captured context awaiting a restore trigger
        private bool _suppressReentry;                 // Shane took a quick task — don't re-nag until resolved
        private DateTime _lastDowntimeEnd = DateTime.MinValue;
        private static readonly TimeSpan ReentryCooldown = TimeSpan.FromSeconds(30);

        // ---- public read state -----------------------------------------
        public bool IsActive => _state.IsActive && _state.ActiveMilestoneNumber.HasValue;
        public int? ActiveMilestoneNumber => _state.ActiveMilestoneNumber;
        public string ActiveMilestoneTitle => _state.ActiveMilestoneTitle;
        public int Points => _state.Points;
        public bool InDowntime => _inDowntime;
        public IReadOnlyList<FocusMilestone> Milestones => _milestones;
        public IReadOnlyList<FocusAchievement> Achievements => _state.Achievements;
        public IReadOnlyList<FocusSuggestion> Suggestions { get; private set; } = new List<FocusSuggestion>();
        public FocusProgress Progress { get; private set; } = new();

        /// <summary>Whether the dedicated full-screen immersive Focus view is engaged right now (a real
        /// window-covering takeover, distinct from <see cref="IsActive"/> which is just "a milestone is
        /// focused / panels are filtered"). You can be focused without being immersive (the bar shows);
        /// immersive requires a focused milestone to zoom into.</summary>
        public bool ImmersiveActive => _state.IsActive && _state.ImmersiveActive && _state.ActiveMilestoneNumber.HasValue;

        /// <summary>The active "Epic" (focus milestone)'s real child issues — every board issue under the
        /// active milestone, ordered the way the immersive view lists them: real GitHub epics first (they
        /// anchor the tree), then Shane-To-Do items, then the rest, closed issues last. Empty when not
        /// focused. (There is no client-side epic→child linkage — <c>SubIssueCount</c> is a count only — so
        /// "the Epic's children" is honestly the milestone's issue set, with real epics surfaced first.)</summary>
        public IReadOnlyList<GitBoardIssue> ActiveChildIssues
        {
            get
            {
                if (!IsActive) return Array.Empty<GitBoardIssue>();
                int? active = _state.ActiveMilestoneNumber;
                return _issues
                    .Where(i => i.MilestoneNumber == active)
                    .OrderBy(i => i.IsClosed ? 1 : 0)                          // open first
                    .ThenBy(i => i.IsEpic ? 0 : (i.IsTodo ? 1 : 2))           // epics, then To-Do, then rest
                    .ThenByDescending(i => i.SubIssueCount)                    // bigger epics first
                    .ThenBy(i => i.Number)
                    .ToList();
            }
        }

        // ---- events (UI reacts on the same UI thread) ------------------
        /// <summary>Active milestone / points / progress / achievements changed — refresh the bar.</summary>
        public event Action? StateChanged;
        /// <summary>The filter changed — every panel must re-render (hide/show).</summary>
        public event Action? FilterChanged;
        /// <summary>Downtime started/ended or its suggestions changed — the bar shows/hides the quick list.</summary>
        public event Action? DowntimeChanged;
        /// <summary>A real achievement was just unlocked — pop a tasteful toast.</summary>
        public event Action<FocusAchievement>? AchievementUnlocked;
        /// <summary>The immersive full-screen view was engaged / dismissed — MainWindow shows or hides the
        /// window-covering overlay in response.</summary>
        public event Action? ImmersiveChanged;
        /// <summary>N real issue(s) just closed under the active milestone (a positive closed-count delta vs
        /// the persisted baseline, computed in <see cref="RecomputeGame"/>). Drives the immersive view's
        /// tasteful "issue closed" celebration. Honest caveat: it's the milestone's aggregate closed count
        /// advancing — which only moves when GitHub milestone data is refreshed (manual-refresh-only) — not
        /// a per-issue push signal, since no per-issue "closed" event exists in the app.</summary>
        public event Action<int, FocusMilestone>? MilestoneIssuesClosed;

        private FocusModeService() { }

        // ================================================================
        // Wiring / lifecycle
        // ================================================================

        /// <summary>Called once by MainWindow.InitFocusMode with the probes only the shell can
        /// provide, then starts the downtime timer. Safe to call before any board data exists.</summary>
        public void Start(Dispatcher ui, Func<FocusBuildSaturation> buildSaturation,
                          Func<FocusContextSnapshot?> captureContext,
                          Action<FocusContextSnapshot> restoreContext)
        {
            if (_started) return;
            _started = true;
            _buildSaturation = buildSaturation;
            _captureContext = captureContext;
            _restoreContext = restoreContext;

            Load();

            _timer = new DispatcherTimer(DispatcherPriority.Background, ui)
            {
                Interval = TimeSpan.FromSeconds(5)
            };
            _timer.Tick += (_, _) => Tick();
            _timer.Start();

            ActivityLog.Log("focus-mode",
                IsActive
                    ? $"started; restored active milestone '{_state.ActiveMilestoneTitle}' (#{_state.ActiveMilestoneNumber}), {_state.Points} pts"
                    : "started; no active milestone");

            // If a milestone was active last session, panels should filter immediately
            // once their snapshots arrive — fire so any already-rendered panel re-renders.
            if (IsActive) { RaiseFilterChanged(); RaiseStateChanged(); }
        }

        // ================================================================
        // Piece 1 — active milestone declaration
        // ================================================================

        public void Activate(int? milestoneNumber, string milestoneTitle)
        {
            if (!milestoneNumber.HasValue)
            {
                ActivityLog.Log("focus-mode", $"activate ignored — '{milestoneTitle}' has no real GitHub milestone number to focus on");
                return;
            }
            _state.IsActive = true;
            _state.ActiveMilestoneNumber = milestoneNumber;
            _state.ActiveMilestoneTitle = milestoneTitle ?? "";
            ActivityLog.Log("focus-mode", $"milestone activated: '{_state.ActiveMilestoneTitle}' (#{milestoneNumber}) — hard-filtering all panels");
            Save();
            // Reflect any thresholds this milestone had already crossed before it was focused,
            // silently (no toast storm) — so a mature milestone's achievements aren't blank.
            var ms = _milestones.FirstOrDefault(m => m.Number == milestoneNumber);
            if (ms != null) MaybeAwardProgressAchievements(ms, silent: true);
            RecomputeGame();
            RecomputeSuggestions();
            RaiseFilterChanged();
            RaiseStateChanged();
        }

        public void Deactivate()
        {
            if (!_state.IsActive) return;
            var was = _state.ActiveMilestoneTitle;
            _state.IsActive = false;
            // keep ActiveMilestoneNumber/Title as the "last focused" for quick re-entry;
            // IsActive is the switch panels read.
            _pendingRestore = null;
            _suppressReentry = false;
            ExitDowntime(restore: false, reason: "focus deactivated");
            bool wasImmersive = _state.ImmersiveActive;
            _state.ImmersiveActive = false; // can't be immersive in an epic you're no longer focused on
            ActivityLog.Log("focus-mode", $"milestone deactivated (was '{was}') — all panels unfiltered");
            Save();
            if (wasImmersive) ImmersiveChanged?.Invoke();
            RaiseFilterChanged();
            RaiseStateChanged();
        }

        // ================================================================
        // Immersive full-screen view (the dedicated zoom-in on the Epic)
        // ================================================================

        /// <summary>Engage the dedicated full-screen immersive view — the window-covering "video-game-esque"
        /// zoom onto the one Epic being worked. No-op unless a milestone is actually focused (there's nothing
        /// to be immersive about otherwise). MainWindow shows the overlay on <see cref="ImmersiveChanged"/>.</summary>
        public void EnterImmersive()
        {
            if (!IsActive)
            {
                ActivityLog.Log("focus-mode", "enter-immersive ignored — no milestone is focused to zoom into");
                return;
            }
            if (_state.ImmersiveActive) return;
            _state.ImmersiveActive = true;
            ActivityLog.Log("focus-mode", $"entered immersive view — full-screen zoom on '{_state.ActiveMilestoneTitle}' (#{_state.ActiveMilestoneNumber})");
            Save();
            ImmersiveChanged?.Invoke();
        }

        /// <summary>Dismiss the immersive view, dropping back to the normal multi-pane shell. The milestone
        /// stays focused (the bar remains) — this only collapses the full-screen takeover.</summary>
        public void ExitImmersive()
        {
            if (!_state.ImmersiveActive) return;
            _state.ImmersiveActive = false;
            ActivityLog.Log("focus-mode", "exited immersive view — back to the normal shell (milestone still focused)");
            Save();
            ImmersiveChanged?.Invoke();
        }

        /// <summary>Toggle the immersive view (the Ctrl+Shift+F hotkey and the bar's ⛶ button use this).</summary>
        public void ToggleImmersive()
        {
            if (ImmersiveActive) ExitImmersive(); else EnterImmersive();
        }

        // ================================================================
        // Piece 2 — the hard global filter predicate
        // ================================================================

        /// <summary>Git Board: keep only the active milestone's group. Exact by number,
        /// falling back to title for the synthetic "No Milestone" bucket.</summary>
        public bool IsMilestoneInFocus(int? milestoneNumber, string? milestoneTitle)
        {
            if (!IsActive) return true;
            if (_state.ActiveMilestoneNumber.HasValue && milestoneNumber.HasValue)
                return milestoneNumber.Value == _state.ActiveMilestoneNumber.Value;
            return string.Equals(milestoneTitle, _state.ActiveMilestoneTitle, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Build Queue: an item's GitHub issue must belong to the active milestone.
        /// Unattributable/local items (no or negative issue number) are NEVER hidden — hiding
        /// the build that's actually running would defeat the point. Unknown positive issues
        /// (closed / dropped off the OPEN-only board) are hidden while the map is warm.</summary>
        public bool IsIssueInFocus(int? githubNumber)
        {
            if (!IsActive) return true;
            if (githubNumber is null || githubNumber.Value <= 0) return true;
            if (_issueToMilestone.TryGetValue(githubNumber.Value, out var ms))
                return ms == _state.ActiveMilestoneNumber;
            return _issueToMilestone.Count == 0; // cold map: don't hide everything
        }

        /// <summary>Strict "this issue genuinely belongs to the ACTIVE milestone" test. Unlike
        /// <see cref="IsIssueInFocus"/> — whose job is "should this be shown / not hidden", so it errs
        /// toward SHOWING (null/local numbers and a cold map both pass, since you never hide the running
        /// build) — this returns true only on a positive, warm-map milestone match. The Focus checklist
        /// band uses it to surface only on-milestone builds' progress, never a local/off-milestone build.</summary>
        public bool IsIssueInActiveMilestone(int? githubNumber)
        {
            if (!IsActive || githubNumber is null || githubNumber.Value <= 0) return false;
            return _issueToMilestone.TryGetValue(githubNumber.Value, out var ms)
                   && ms == _state.ActiveMilestoneNumber;
        }

        /// <summary>Chats tree: resolve the chat's issue (direct, or via its epic's issue number)
        /// then apply <see cref="IsIssueInFocus"/> semantics. Unlinked chats are hidden while
        /// focused (they belong to no milestone), but never when the map is cold.</summary>
        public bool IsChatInFocus(BoardChat chat)
        {
            if (!IsActive || _issueToMilestone.Count == 0) return true;
            int? num = chat.IssueGithubNumber
                ?? (chat.EpicId.HasValue && _epicById.TryGetValue(chat.EpicId.Value, out var epic) ? epic.GithubNumber : null);
            if (num is null || num.Value <= 0) return false; // unlinked -> off-milestone
            if (_issueToMilestone.TryGetValue(num.Value, out var ms))
                return ms == _state.ActiveMilestoneNumber;
            return false;
        }

        /// <summary>How many currently-known items the active filter is hiding (for the bar's
        /// honest "N hidden" affordance so nothing vanishes silently).</summary>
        public int HiddenIssueCount()
        {
            if (!IsActive) return 0;
            return _issues.Count(i => i.MilestoneNumber != _state.ActiveMilestoneNumber);
        }

        // ================================================================
        // Board snapshot ingestion (fed by LeftSidebar on every board refresh)
        // ================================================================

        public void UpdateBoardSnapshot(
            IReadOnlyList<GitBoardIssue> issues,
            IReadOnlyList<GitHubApiClient.GitHubMilestoneInfo> milestoneInfos)
        {
            _issues = issues?.ToList() ?? new();
            _issueToMilestone = _issues
                .GroupBy(i => i.Number)
                .ToDictionary(g => g.Key, g => g.First().MilestoneNumber);

            _milestones = (milestoneInfos ?? new List<GitHubApiClient.GitHubMilestoneInfo>())
                .Select(m => new FocusMilestone
                {
                    Number = m.Number,
                    Title = m.Title,
                    OpenIssues = m.OpenIssues,
                    ClosedIssues = m.ClosedIssues
                })
                .OrderBy(m => m.Title, StringComparer.OrdinalIgnoreCase)
                .ToList();

            RecomputeGame();
            RecomputeSuggestions();
            RaiseStateChanged();
            if (IsActive) RaiseFilterChanged();
        }

        public void UpdateChatSnapshot(IReadOnlyList<BoardChat> chats, IReadOnlyDictionary<int, BoardEpic> epicById)
        {
            _chats = chats?.ToList() ?? new();
            _epicById = epicById != null ? new Dictionary<int, BoardEpic>(epicById) : new();
        }

        // ================================================================
        // Piece 3 — downtime detection + quick-task suggestions
        // ================================================================

        private void Tick()
        {
            if (!IsActive) { if (_inDowntime) ExitDowntime(false, "focus off"); return; }

            FocusBuildSaturation sat;
            try { sat = _buildSaturation?.Invoke() ?? default; }
            catch { sat = default; }

            // The precise real trigger: every build slot occupied AND items still queued
            // behind them — genuine saturation, no idle timer (see FocusBuildSaturation).
            bool downtimeNow = sat.IsSaturated;

            if (downtimeNow && !_inDowntime && !_suppressReentry
                && (DateTime.Now - _lastDowntimeEnd) > ReentryCooldown)
            {
                EnterDowntime(sat);
            }
            else if (!downtimeNow && _inDowntime)
            {
                // Saturation broke — a slot freed (running < slots) or the queue drained
                // (nothing left queued behind them). Stop nagging, but do NOT auto-restore on
                // mere de-saturation; restore is reserved for the genuine build-complete signal
                // (the finished build that freed the slot fires it) or a resolved quick task.
                string reason = sat.RunningCount < sat.SlotCount
                    ? $"a slot freed ({sat.RunningCount}/{sat.SlotCount} occupied, {sat.QueuedCount} queued)"
                    : $"queue drained (0 waiting behind {sat.RunningCount}/{sat.SlotCount} occupied)";
                ExitDowntime(restore: false, reason: reason);
                // No builds running at all → no build-complete signal will ever come to trigger a
                // restore; drop the now-orphaned capture so it can't restore out of nowhere later.
                if (sat.RunningCount == 0) { _pendingRestore = null; _suppressReentry = false; }
            }
        }

        private void EnterDowntime(FocusBuildSaturation sat)
        {
            _inDowntime = true;

            // Capture EXACTLY what Shane was doing, before suggestions can pull him elsewhere.
            // Only on a FRESH downtime (no capture already pending) — re-entries must not clobber
            // the original "what I was doing" snapshot with a half-done quick-task view.
            if (_pendingRestore == null)
            {
                try
                {
                    var snap = _captureContext?.Invoke();
                    if (snap != null && !snap.IsEmpty)
                    {
                        _pendingRestore = snap;
                        _state.LastContext = snap;
                        Save();
                        ActivityLog.Log("focus-mode",
                            $"context saved — {snap.Tabs.Count} tab(s), active pane {snap.ActivePaneIndex + 1}, layout '{snap.LayoutMode}'");
                    }
                }
                catch (Exception ex) { ActivityLog.Log("focus-mode", $"context capture failed: {ex.Message}"); }
            }

            RecomputeSuggestions();
            ActivityLog.Log("focus-mode",
                $"downtime detected — genuine saturation: all {sat.RunningCount}/{sat.SlotCount} build slots occupied with {sat.QueuedCount} item(s) queued behind them; offering {Suggestions.Count} quick on-milestone task(s)");
            DowntimeChanged?.Invoke();
        }

        private void ExitDowntime(bool restore, string reason)
        {
            if (!_inDowntime && !restore) { return; }
            bool was = _inDowntime;
            _inDowntime = false;
            _lastDowntimeEnd = DateTime.Now;
            Suggestions = new List<FocusSuggestion>();

            if (restore && _pendingRestore != null)
            {
                var snap = _pendingRestore;
                _pendingRestore = null;
                _suppressReentry = false;
                try
                {
                    _restoreContext?.Invoke(snap);
                    ActivityLog.Log("focus-mode",
                        $"context restored ({reason}) — snapping back to {snap.Tabs.Count} tab(s), pane {snap.ActivePaneIndex + 1}");
                }
                catch (Exception ex) { ActivityLog.Log("focus-mode", $"context restore failed: {ex.Message}"); }
            }
            else if (was)
            {
                ActivityLog.Log("focus-mode", $"downtime ended ({reason})");
            }

            if (was || restore) DowntimeChanged?.Invoke();
        }

        private void RecomputeSuggestions()
        {
            if (!IsActive) { Suggestions = new List<FocusSuggestion>(); return; }
            int? active = _state.ActiveMilestoneNumber;

            var open = _issues.Where(i => i.MilestoneNumber == active && !i.IsClosed).ToList();

            // Waiting-on-Shane items first (genuinely quick, genuinely his), then small
            // non-epic issues. Never epics (those are big), never off-milestone.
            var todo = open.Where(i => i.IsTodo)
                           .OrderBy(i => i.Number)
                           .Select(i => new FocusSuggestion { IssueNumber = i.Number, Title = Clean(i.Title), Kind = "Waiting on you", Emoji = "🔴" });

            var small = open.Where(i => !i.IsTodo && !i.IsEpic)
                            .OrderBy(i => i.Number)
                            .Select(i => new FocusSuggestion { IssueNumber = i.Number, Title = Clean(i.Title), Kind = "Quick task", Emoji = "🟢" });

            Suggestions = todo.Concat(small).Take(MaxSuggestions).ToList();
        }

        private static string Clean(string title)
        {
            title = (title ?? "").Trim();
            return title.Length > 70 ? title.Substring(0, 68) + "…" : title;
        }

        /// <summary>Shane tapped a quick task. Open it and stop nagging, but keep the captured
        /// context pending — he'll be snapped back when the build finishes (or he hits "back now").
        /// Suppress re-entry so a second idle spell mid-quick-task doesn't clobber the capture.</summary>
        public void SuggestionTaken(int issueNumber)
        {
            _suppressReentry = true;
            ActivityLog.Log("focus-mode",
                $"suggestion taken: #{issueNumber} — opening it; will restore prior context when the build finishes");
            ExitDowntime(restore: false, reason: $"quick task #{issueNumber} taken");
        }

        /// <summary>Shane hit "back to my task" — restore the saved context right now.</summary>
        public void RequestRestoreNow()
        {
            if (_pendingRestore == null) { ActivityLog.Log("focus-mode", "manual return requested but nothing was saved"); return; }
            ActivityLog.Log("focus-mode", "manual 'back to my task' — restoring saved context now");
            ExitDowntime(restore: true, reason: "manual return");
        }

        /// <summary>Fired when a suggestion is first surfaced to the user (bar shown).</summary>
        public void NoteSuggestionsShown()
        {
            if (Suggestions.Count > 0)
                ActivityLog.Log("focus-mode", $"suggestions shown: {string.Join(", ", Suggestions.Select(s => "#" + s.IssueNumber))}");
        }

        // ================================================================
        // Piece 4 — build-complete restore hook
        // ================================================================

        /// <summary>The queue watcher's genuine "this build finished" signal. If we captured
        /// context because of downtime, snap Shane back to it now.</summary>
        public void NotifyBuildFinished(int queueItemId, string title, int exitCode)
        {
            if (_pendingRestore != null)
            {
                ActivityLog.Log("focus-mode", $"build finished ('{title}', exit {exitCode}) — auto-restoring saved context");
                ExitDowntime(restore: true, reason: $"build '{title}' finished");
            }
        }

        // ================================================================
        // Piece 5 — the game layer over REAL milestone data
        // ================================================================

        private void RecomputeGame()
        {
            var ms = _milestones.FirstOrDefault(m => m.Number == _state.ActiveMilestoneNumber);
            if (ms == null)
            {
                Progress = new FocusProgress { Points = _state.Points };
                return;
            }

            int number = ms.Number ?? -1;
            int closed = ms.ClosedIssues;
            int total = ms.TotalIssues;
            bool active = _state.IsActive; // points/achievements only accrue while focused

            // ---- points for real closes (delta vs persisted baseline) ----
            if (number >= 0)
            {
                bool haveBaseline = _state.ClosedBaseline.TryGetValue(number, out var prevClosed);
                int delta = haveBaseline ? closed - prevClosed : 0;

                if (active && haveBaseline && delta > 0)
                {
                    _state.Points += delta * PointsPerClose;
                    ActivityLog.Log("focus-mode", $"+{delta * PointsPerClose} pts — {delta} issue(s) closed under '{ms.Title}' ({closed}/{total})");
                    MaybeAwardProgressAchievements(ms, silent: false);
                    MilestoneIssuesClosed?.Invoke(delta, ms); // → immersive view's "issue closed" celebration
                }
                else if (active && !haveBaseline)
                {
                    // first sight — reflect any already-earned thresholds in the list, but
                    // quietly (no toast storm for a milestone that was already part-done).
                    MaybeAwardProgressAchievements(ms, silent: true);
                }
                _state.ClosedBaseline[number] = closed; // always current, so re-activation never retro-awards

                // ---- Shane To-Do "inbox zero" (real >0 -> 0 transition) ----
                int todoOpen = _issues.Count(i => i.MilestoneNumber == number && i.IsTodo && !i.IsClosed);
                if (active && _state.TodoBaseline.TryGetValue(number, out var prevTodo) && prevTodo > 0 && todoOpen == 0)
                    Award($"ms{number}-todozero-{DateTime.Now:yyyyMMdd}", "📭", "Inbox zero",
                          $"No Shane-To-Dos left under '{ms.Title}'", silent: false);
                _state.TodoBaseline[number] = todoOpen;

                // ---- record a closed-count sample for the ETA fit (while focused) ----
                if (active) RecordClosedSample(number, closed, total);
            }

            Progress = BuildProgress(ms);
            Save();
        }

        private void MaybeAwardProgressAchievements(FocusMilestone ms, bool silent)
        {
            int number = ms.Number ?? -1;
            if (number < 0 || ms.TotalIssues == 0) return;
            int pct = ms.ProgressPercent;
            if (ms.ClosedIssues >= 1) Award($"ms{number}-first", "🚩", "On the board", $"First close under '{ms.Title}'", silent);
            if (pct >= 50) Award($"ms{number}-half", "⛰️", "Halfway there", $"'{ms.Title}' is {pct}% done", silent);
            if (pct >= 90) Award($"ms{number}-90", "🏁", "Home stretch", $"'{ms.Title}' is {pct}% done", silent);
            if (ms.ClosedIssues == ms.TotalIssues) Award($"ms{number}-done", "🎉", "Milestone cleared!", $"'{ms.Title}' — {ms.ClosedIssues}/{ms.TotalIssues} done", silent);
        }

        /// <summary>Add an achievement once. <paramref name="silent"/> records it (list + log) without a
        /// toast — used when seeding thresholds a milestone had already crossed before it was focused.</summary>
        private void Award(string id, string emoji, string title, string detail, bool silent = false)
        {
            if (_state.Achievements.Any(a => a.Id == id)) return;
            var a = new FocusAchievement { Id = id, Emoji = emoji, Title = title, Detail = detail, UnlockedAt = DateTime.Now };
            _state.Achievements.Add(a);
            ActivityLog.Log("focus-mode", $"achievement {(silent ? "recorded" : "unlocked")}: {emoji} {title} — {detail}");
            if (!silent) AchievementUnlocked?.Invoke(a);
            RaiseStateChanged();
        }

        private void RecordClosedSample(int milestoneNumber, int closed, int total)
        {
            var last = _state.ClosedSamples.Where(s => s.MilestoneNumber == milestoneNumber)
                                           .OrderBy(s => s.At).LastOrDefault();
            if (last != null && last.Closed == closed && last.Total == total) return; // no change, no new point
            _state.ClosedSamples.Add(new FocusClosedSample { MilestoneNumber = milestoneNumber, At = DateTime.Now, Closed = closed, Total = total });
            // keep the series bounded
            if (_state.ClosedSamples.Count > 500)
                _state.ClosedSamples = _state.ClosedSamples.OrderByDescending(s => s.At).Take(500).OrderBy(s => s.At).ToList();
        }

        private FocusProgress BuildProgress(FocusMilestone ms)
        {
            var p = new FocusProgress
            {
                MilestoneNumber = ms.Number,
                MilestoneTitle = ms.Title,
                Closed = ms.ClosedIssues,
                Total = ms.TotalIssues,
                Points = _state.Points
            };

            int number = ms.Number ?? -1;
            var samples = _state.ClosedSamples.Where(s => s.MilestoneNumber == number).OrderBy(s => s.At).ToList();
            if (samples.Count < MinEtaSamples)
            {
                p.EtaReason = $"not enough closed-count history yet ({samples.Count}/{MinEtaSamples} readings)";
                return p;
            }
            var span = samples[^1].At - samples[0].At;
            if (span < MinEtaSpan)
            {
                p.EtaReason = $"history only spans {span.TotalMinutes:0}m (< {MinEtaSpan.TotalMinutes:0}m) — too short to trust a pace";
                return p;
            }

            // Reuse the usage-meter's least-squares slope: feed (time, closed-count) as the
            // series so the fitted slope is "issues closed per hour" (UsageSample.Percent is
            // just the y value here). Same math as the "time until 100%" projection.
            var window = samples.Select(s => new UsageSample { At = s.At, Percent = s.Closed }).ToList();
            double perHour = UsageProjection.LeastSquaresSlopePerHour(window);
            if (perHour <= 0.0001)
            {
                p.EtaReason = "pace is flat in the current history — no honest ETA";
                return p;
            }
            p.IssuesPerDay = perHour * 24.0;
            int remaining = Math.Max(0, ms.TotalIssues - ms.ClosedIssues);
            if (remaining == 0) { p.EtaReason = "milestone complete"; return p; }
            p.Eta = TimeSpan.FromHours(remaining / perHour);
            p.HasEta = true;
            return p;
        }

        // ================================================================
        // Persistence (focus-mode.json, next to settings.json)
        // ================================================================

        private static string Dir => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole");
        private static string StatePath => Path.Combine(Dir, "focus-mode.json");

        private void Load()
        {
            try
            {
                if (!File.Exists(StatePath)) { _state = new FocusPersistState(); return; }
                var json = File.ReadAllText(StatePath);
                _state = JsonSerializer.Deserialize<FocusPersistState>(json,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new FocusPersistState();
                _state.Achievements ??= new();
                _state.ClosedSamples ??= new();
                _state.ClosedBaseline ??= new();
                _state.TodoBaseline ??= new();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("focus-mode", $"couldn't load focus-mode.json ({ex.Message}) — starting fresh");
                _state = new FocusPersistState();
            }
        }

        private void Save()
        {
            try
            {
                Directory.CreateDirectory(Dir);
                var json = JsonSerializer.Serialize(_state, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(StatePath, json);
            }
            catch (Exception ex) { ActivityLog.Log("focus-mode", $"couldn't save focus-mode.json: {ex.Message}"); }
        }

        private void RaiseStateChanged() => StateChanged?.Invoke();
        private void RaiseFilterChanged() => FilterChanged?.Invoke();
    }
}
