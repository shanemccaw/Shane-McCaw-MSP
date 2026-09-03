using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Focus Mode — the single behavioral-design spine that sits on TOP of every
    /// panel (Git Board, Chats, Build Queue, Home).
    ///
    /// The pieces this owns:
    ///   1. Active-milestone declaration (one at a time, persisted).
    ///   2. The hard global filter predicate every panel consults to HIDE off-milestone
    ///      content (genuinely hidden, not deprioritised).
    ///   3. A tasteful game layer over the REAL milestone numbers (honest closed/total,
    ///      a least-squares ETA reusing <see cref="UsageProjection"/>'s math, points and
    ///      earned achievements).
    ///
    /// (#1874 — the downtime "quick wins while you wait" band, its build-slot-saturation
    /// detection, and the context capture/auto-restore behind it were removed. Shane never
    /// used it and it had no close affordance, appearing exactly when all 8 build slots
    /// were busy — the moment he had the least screen to spare. <see cref="Suggestions"/>
    /// / <see cref="RecomputeSuggestions"/> survive, kept alive purely as the data source
    /// for <c>FocusImmersiveView</c>'s own empty-state suggestion chips — a different
    /// surface Shane didn't ask to remove.)
    ///
    /// Everything is single-window: this raises events; MainWindow / FocusModeBar react
    /// inside the existing multi-pane shell. Nothing here opens a window.
    ///
    /// Threading: every entry point runs on the WPF UI Dispatcher (LeftSidebar populate,
    /// the queue watcher's DispatcherTimer), so state is single-threaded by construction;
    /// only disk I/O is wrapped defensively.
    /// All notable transitions are logged on the <c>focus-mode</c> ActivityLog channel.
    /// </summary>
    public class FocusModeService
    {
        private static readonly Lazy<FocusModeService> _instance = new(() => new FocusModeService());
        public static FocusModeService Instance => _instance.Value;

        // ---- tunables --------------------------------------------------
        private const int PointsPerClose = 10;
        private const int MaxSuggestions = 5;
        // ETA confidence gates now live in the shared IssueEtaProjection core (#2714 extracted
        // them verbatim so the Home dashboard panel reuses the same discipline) —
        // see IssueEtaProjection.MinEtaSamples / .MinEtaSpan.

        // ---- live state ------------------------------------------------
        private FocusPersistState _state = new();
        private bool _started;

        // board snapshot (issue -> milestone map + raw issues for suggestions)
        private Dictionary<int, int?> _issueToMilestone = new();
        /// <summary>issue number -> its real parent epic (number) and that epic's own milestone number, from
        /// GitHub's sub-issue graph. The queue filter resolves a build → issue → parent epic → epic's
        /// milestone through this, because Shane milestones the EPIC, not each sub-issue (so a sub-issue's
        /// own <c>MilestoneNumber</c> is null even though the build genuinely belongs to the epic's milestone).
        /// Only issues that actually have a parent appear here.</summary>
        private Dictionary<int, (int? EpicNumber, int? EpicMilestone)> _issueParentInfo = new();
        private List<GitBoardIssue> _issues = new();
        private List<FocusMilestone> _milestones = new();
        private List<BoardChat> _chats = new();
        private Dictionary<int, BoardEpic> _epicById = new();

        // ---- public read state -----------------------------------------
        public bool IsActive => _state.IsActive && _state.ActiveMilestoneNumber.HasValue;
        public int? ActiveMilestoneNumber => _state.ActiveMilestoneNumber;
        public string ActiveMilestoneTitle => _state.ActiveMilestoneTitle;
        public int Points => _state.Points;
        public IReadOnlyList<FocusMilestone> Milestones => _milestones;
        public IReadOnlyList<FocusAchievement> Achievements => _state.Achievements;
        /// <summary>On-milestone quick-task suggestions. No longer used by the (removed) downtime band —
        /// kept purely as the data source for <c>FocusImmersiveView.ShowEmptyState</c>'s own suggestion
        /// chips (#1874). Recomputed on <see cref="Activate"/> and every <see cref="UpdateBoardSnapshot"/>.</summary>
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

        /// <summary>Chats marked as In Progress for quick access during Focus Mode.</summary>
        public IReadOnlyList<PersistedInProgressChat> InProgressChats => _state.InProgressChats ?? (IReadOnlyList<PersistedInProgressChat>)Array.Empty<PersistedInProgressChat>();

        /// <summary>Git #1480 — <see cref="InProgressChats"/> filtered to the given account
        /// (resolved against the last board snapshot's real bt_chats.account, from
        /// <see cref="UpdateChatSnapshot"/>). Fail-open like this project's other closed-state
        /// filters (#839/#1450): an entry whose chat isn't in the snapshot yet — freshly marked
        /// before the next Chats poll, or the account column doesn't exist locally — stays
        /// visible rather than being hidden on a guess.</summary>
        public IReadOnlyList<PersistedInProgressChat> InProgressChatsForAccount(string account)
        {
            var list = InProgressChats;
            if (list.Count == 0 || _chats.Count == 0) return list;
            var accountByConvId = _chats
                .Where(c => !string.IsNullOrWhiteSpace(c.ConversationId))
                .GroupBy(c => c.ConversationId, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().Account, StringComparer.OrdinalIgnoreCase);
            return list
                .Where(pc => !accountByConvId.TryGetValue(pc.ConversationId, out var acc)
                             || string.Equals(acc, account, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        /// <summary>Git #1644 — account-aware version of <see cref="IsChatInProgress"/>, reusing
        /// <see cref="InProgressChatsForAccount"/>'s exact cross-reference/fail-open logic rather
        /// than duplicating it, so the Chats panel's badges/counts/highlights honor the
        /// Primary/Secondary account toggle the same way Focus Mode's own strip already does.</summary>
        public bool IsChatInProgressForAccount(string? conversationId, string account)
        {
            if (string.IsNullOrWhiteSpace(conversationId)) return false;
            return InProgressChatsForAccount(account).Any(c => string.Equals(c.ConversationId, conversationId, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>Git #1480 — forces FocusModeBar to re-render its In Progress strip when the
        /// title-bar account toggle flips, even though the underlying marked-chat list itself
        /// hasn't changed (just which slice of it should now be visible).</summary>
        public void NotifyAccountToggleChanged() => InProgressChatsChanged?.Invoke();

        // ---- events (UI reacts on the same UI thread) ------------------
        /// <summary>Active milestone / points / progress / achievements changed — refresh the bar.</summary>
        public event Action? StateChanged;
        /// <summary>The filter changed — every panel must re-render (hide/show).</summary>
        public event Action? FilterChanged;
        /// <summary>A real achievement was just unlocked — pop a tasteful toast.</summary>
        public event Action<FocusAchievement>? AchievementUnlocked;
        /// <summary>The immersive full-screen view was engaged / dismissed — MainWindow shows or hides the
        /// window-covering overlay in response.</summary>
        public event Action? ImmersiveChanged;
        /// <summary>Fired when the in-progress chat list is toggled/updated.</summary>
        public event Action? InProgressChatsChanged;
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

        /// <summary>Called once by MainWindow.InitFocusMode. Safe to call before any board data exists.</summary>
        public void Start()
        {
            if (_started) return;
            _started = true;

            Load();

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
            RecomputeGame($"milestone #{milestoneNumber} activated");
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
        /// the build that's actually running would defeat the point. Delegates to
        /// <see cref="DescribeIssueFocus"/>, which traces the real chain build → issue → parent epic →
        /// epic's milestone (see that method for why the sub-issue's own milestone alone isn't enough).</summary>
        public bool IsIssueInFocus(int? githubNumber) => DescribeIssueFocus(githubNumber).Shown;

        /// <summary>
        /// The single source of truth for a queue item's focus decision: traces the REAL association
        /// chain a build needs to match the active milestone —
        ///   build → its GitHub issue number → that issue's parent epic → the epic's milestone —
        /// and returns whether the item should be SHOWN (not hidden), the milestone it resolved to (if
        /// any), and a short human-readable path for the per-queue-item focus log (so an over/under-
        /// filtering regression is diagnosable straight from the feed).
        ///
        /// Why the chain, not just the issue's own milestone: Shane assigns a milestone to the EPIC, not
        /// to each sub-issue. A queued build's sub-issue therefore carries <c>MilestoneNumber == null</c>
        /// even though it genuinely belongs to its parent epic's milestone. #46 filtered on the sub-issue's
        /// own (null) milestone, so <c>null == activeMilestone</c> hid every real on-milestone build — the
        /// exact over-filtering this resolves. It still errs toward SHOWING when genuinely unattributable
        /// (null/local number, a parent epic with no milestone of its own, or a cold board map), so an
        /// actively-running build is never hidden out from under Shane.
        /// </summary>
        public (bool Shown, int? Milestone, string Path) DescribeIssueFocus(int? githubNumber)
        {
            if (!IsActive) return (true, null, "focus off");
            if (githubNumber is null || githubNumber.Value <= 0)
                return (true, null, "local/unnumbered build — never hidden");

            int n = githubNumber.Value;
            int? active = _state.ActiveMilestoneNumber;

            bool onBoard = _issueToMilestone.TryGetValue(n, out var direct);

            // 1) The issue carries its own milestone → match it directly.
            if (onBoard && direct.HasValue)
                return (direct == active, direct, $"#{n} milestone #{direct}");

            // 2) No direct milestone — inherit from the real parent epic (the sub-issue graph).
            if (_issueParentInfo.TryGetValue(n, out var pi) && pi.EpicNumber.HasValue)
            {
                if (pi.EpicMilestone.HasValue)
                    return (pi.EpicMilestone == active, pi.EpicMilestone,
                            $"#{n} → epic #{pi.EpicNumber} milestone #{pi.EpicMilestone}");
                // Parent epic known but it carries no milestone of its own → unattributable, don't hide.
                return (true, null, $"#{n} → epic #{pi.EpicNumber} (epic has no milestone) — not hidden");
            }

            // 3) On the board, no milestone, no parent epic → genuinely belongs to no milestone → hide while focused.
            if (onBoard)
                return (false, null, $"#{n} on board, no milestone / no parent epic → off-milestone");

            // 4) Unknown to the warm open board (closed / dropped off / truncated). Don't hide on a cold
            //    map; on a warm map an unknown positive issue is treated as off-milestone (pre-#46 behaviour).
            return (_issueToMilestone.Count == 0, null,
                    _issueToMilestone.Count == 0 ? $"#{n} unknown — board map cold, not hidden"
                                                 : $"#{n} not on open board → off-milestone");
        }

        /// <summary>Strict "this issue genuinely belongs to the ACTIVE milestone" test. Unlike
        /// <see cref="IsIssueInFocus"/> — whose job is "should this be shown / not hidden", so it errs
        /// toward SHOWING (null/local numbers and a cold map both pass, since you never hide the running
        /// build) — this returns true only on a positive milestone match. Resolves through the SAME
        /// build → issue → parent epic → milestone chain (via <see cref="DescribeIssueFocus"/>), so a
        /// sub-issue build under the active epic's milestone is correctly recognised; the unattributable
        /// cases (null milestone / cold map) resolve to a null milestone here and therefore fail the
        /// strict positive-match test. The Focus checklist band uses it to surface only on-milestone
        /// builds' progress, never a local/off-milestone build.</summary>
        public bool IsIssueInActiveMilestone(int? githubNumber)
        {
            if (!IsActive || githubNumber is null || githubNumber.Value <= 0) return false;
            var d = DescribeIssueFocus(githubNumber);
            return d.Milestone.HasValue && d.Milestone == _state.ActiveMilestoneNumber;
        }

        /// <summary>Checks whether a conversation is marked as In Progress.</summary>
        public bool IsChatInProgress(string? conversationId)
        {
            if (string.IsNullOrWhiteSpace(conversationId)) return false;
            return (_state.InProgressChats ??= new()).Any(c => string.Equals(c.ConversationId, conversationId, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>Toggles a chat between In Progress and normal.</summary>
        public void ToggleChatInProgress(string conversationId, string title, string? claudeUrl)
        {
            if (string.IsNullOrWhiteSpace(conversationId)) return;
            _state.InProgressChats ??= new();
            var existing = _state.InProgressChats.FirstOrDefault(c => string.Equals(c.ConversationId, conversationId, StringComparison.OrdinalIgnoreCase));
            if (existing != null)
            {
                _state.InProgressChats.Remove(existing);
                ActivityLog.Log("focus-mode", $"Unmarked chat as In Progress: \"{title}\" ({conversationId})");
            }
            else
            {
                _state.InProgressChats.Add(new PersistedInProgressChat
                {
                    ConversationId = conversationId,
                    Title = string.IsNullOrWhiteSpace(title) ? "Chat" : title,
                    ClaudeUrl = claudeUrl ?? "",
                    MarkedAtUtc = DateTime.UtcNow
                });
                ActivityLog.Log("focus-mode", $"Marked chat as In Progress: \"{title}\" ({conversationId})");
            }
            Save();
            InProgressChatsChanged?.Invoke();
            RaiseStateChanged();
            RaiseFilterChanged();
        }

        /// <summary>Chats tree: resolve the chat's issue (direct, or via its epic's issue number)
        /// then apply <see cref="IsIssueInFocus"/> semantics. Unlinked chats are hidden while
        /// focused (they belong to no milestone), but chats marked In Progress are ALWAYS kept visible.</summary>
        public bool IsChatInFocus(BoardChat chat)
        {
            if (!IsActive) return true;
            if (!string.IsNullOrEmpty(chat.ConversationId) && IsChatInProgress(chat.ConversationId)) return true;
            if (_issueToMilestone.Count == 0) return true;

            // Get all candidate issue numbers for this chat
            var candidates = new System.Collections.Generic.List<int>();
            if (chat.IssueGithubNumber.HasValue) candidates.Add(chat.IssueGithubNumber.Value);
            if (chat.EpicId.HasValue && _epicById.TryGetValue(chat.EpicId.Value, out var epic) && epic.GithubNumber.HasValue)
            {
                candidates.Add(epic.GithubNumber.Value);
            }
            if (chat.AssociatedIssueNumbers != null)
            {
                candidates.AddRange(chat.AssociatedIssueNumbers);
            }

            foreach (var num in candidates)
            {
                if (num <= 0) continue;
                if (_issueToMilestone.TryGetValue(num, out var ms) && ms == _state.ActiveMilestoneNumber)
                {
                    return true;
                }
                // If it's a sub-issue, check if its parent epic is in the active milestone
                var issue = _issues.FirstOrDefault(i => i.Number == num);
                if (issue != null && issue.ParentNumber.HasValue)
                {
                    if (_issueToMilestone.TryGetValue(issue.ParentNumber.Value, out var pms) && pms == _state.ActiveMilestoneNumber)
                    {
                        return true;
                    }
                }
            }

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

        /// <summary><paramref name="trigger"/> — a short human tag for WHAT caused this board feed
        /// (e.g. "manual Git refresh", "board update"), carried straight into the focus-mode progress
        /// recalculation log so a stale-progress-bar report is diagnosable straight from the feed:
        /// you can see the manual refresh arrive AND the old→new closed/total it produced.</summary>
        public void UpdateBoardSnapshot(
            IReadOnlyList<GitBoardIssue> issues,
            IReadOnlyList<GitHubApiClient.GitHubMilestoneInfo> milestoneInfos,
            string trigger = "board update")
        {
            _issues = issues?.ToList() ?? new();
            _issueToMilestone = _issues
                .GroupBy(i => i.Number)
                .ToDictionary(g => g.Key, g => g.First().MilestoneNumber);

            // issue -> (parent epic, epic's milestone), for the build → issue → epic → milestone chain
            // (only issues that genuinely have a parent epic).
            _issueParentInfo = _issues
                .Where(i => i.ParentNumber.HasValue)
                .GroupBy(i => i.Number)
                .ToDictionary(
                    g => g.Key,
                    g => (g.First().ParentNumber, g.First().ParentMilestoneNumber));

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

            RecomputeGame(trigger);
            RecomputeSuggestions();
            RaiseStateChanged();
            if (IsActive) RaiseFilterChanged();
        }

        public void UpdateChatSnapshot(IReadOnlyList<BoardChat> chats, IReadOnlyDictionary<int, BoardEpic> epicById)
        {
            _chats = chats?.ToList() ?? new();
            _epicById = epicById != null ? new Dictionary<int, BoardEpic>(epicById) : new();

            // Shane: "the top bar where the In Progress chats are stored... loads
            // everything, Primary & Secondary... then I have to click [something] to get
            // it to narrow down." Root cause: InProgressChatsForAccount fails OPEN
            // (returns the unfiltered list) while _chats is still empty — true for every
            // render before this snapshot's first real fetch lands, including
            // FocusModeBar's very first Loaded-triggered render. Nothing told it to
            // re-render once _chats stopped being empty, so it kept showing that
            // unfiltered snapshot until some unrelated event (the account toggle, marking
            // a chat in progress) happened to fire InProgressChatsChanged. Firing it here
            // — the moment real per-chat account data actually becomes known — is the fix:
            // the account-correct filtered list is now shown as soon as it can be, not on
            // whatever later click happens to ask for a repaint.
            InProgressChatsChanged?.Invoke();
        }

        // ================================================================
        // Quick-task suggestions — real on-milestone data, no downtime tie-in (#1874).
        // Kept solely as the data source for FocusImmersiveView's empty-state chips.
        // ================================================================

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

        // ================================================================
        // Piece 5 — the game layer over REAL milestone data
        // ================================================================

        /// <summary>Recompute the honest progress/game layer off the freshest milestone snapshot.
        /// <paramref name="trigger"/> names what caused this recompute (a manual Git refresh, a board
        /// poll, milestone activation, …) and is logged with the old→new closed/total so a "the progress
        /// bar didn't move after I refreshed" report is answerable straight from the focus-mode feed —
        /// you can see whether the recalc even ran and whether the underlying counts actually changed.</summary>
        private void RecomputeGame(string trigger = "recompute")
        {
            // Snapshot the prior progress so the log can show the real old→new transition (this is the
            // single point every focus progress-bar surface — the bar AND the immersive header — reads).
            int priorProgClosed = Progress.Closed, priorProgTotal = Progress.Total;
            int? priorProgMs = Progress.MilestoneNumber;

            var ms = _milestones.FirstOrDefault(m => m.Number == _state.ActiveMilestoneNumber);
            if (ms == null)
            {
                Progress = new FocusProgress { Points = _state.Points };
                if (_state.ActiveMilestoneNumber.HasValue)
                    ActivityLog.Log("focus-mode",
                        $"progress recompute [{trigger}] — active milestone #{_state.ActiveMilestoneNumber} not in the {_milestones.Count} milestone(s) this snapshot carried; progress cleared");
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

            // Log every recompute of the focus progress bar with its trigger and the real old→new
            // numbers, so "manual refresh didn't move the bar" is diagnosable: a CHANGED line proves
            // fresh counts landed; an unchanged line with a manual-refresh trigger points straight at
            // the data source (a stale ETag/cache upstream) rather than at this recompute.
            bool changed = Progress.Closed != priorProgClosed || Progress.Total != priorProgTotal || priorProgMs != Progress.MilestoneNumber;
            ActivityLog.Log("focus-mode",
                $"progress {(changed ? "recalculated" : "recomputed (unchanged)")} [{trigger}]: '{ms.Title}' (#{ms.Number}) "
                + $"{priorProgClosed}/{priorProgTotal} → {Progress.Closed}/{Progress.Total} ({Progress.Percent}%)");

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

            // Fit the ETA with the ONE shared honest-projection core (#2714 extracted this from
            // here verbatim so the Home dashboard's per-Epic / Milestone panel reuses the exact
            // same sampling/gating discipline instead of approximating it). Feed (time, closed-count)
            // so the fitted slope is "issues closed per hour"; the gates and reason strings are
            // unchanged from what this method has always produced.
            var window = samples.Select(s => new UsageSample { At = s.At, Percent = s.Closed }).ToList();
            int remaining = Math.Max(0, ms.TotalIssues - ms.ClosedIssues);
            var proj = IssueEtaProjection.Project(window, remaining, "milestone");
            p.HasEta = proj.HasEta;
            p.Eta = proj.HasEta ? proj.Eta : (TimeSpan?)null;
            p.IssuesPerDay = proj.IssuesPerDay;
            p.EtaReason = proj.EtaReason ?? "";
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
                _state.InProgressChats ??= new();
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
