using System;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2003 — turns the two manual usage controls (the #1989 Conservation Cap and the
    /// #1416/#1419 primary/secondary account routing) into decisions driven by the real,
    /// polled Anthropic OAuth usage meter (<see cref="ClaudeUsageMeterService"/>), instead of
    /// buttons Shane has to click. Blocked on #2002, which made the per-account meter readings
    /// trustworthy (Primary reports primary regardless of toggle, real ISO reset timestamps,
    /// Secondary actually returns a reading).
    ///
    /// It does four things, in priority order:
    ///   1. Auto-conservation — engages <see cref="AccountCapPolicy.ExceedsSonnetHigh"/> capping
    ///      when the account with the least headroom that a heavy build would still land on crosses
    ///      the configured threshold (default 85%), and releases it on a genuine reset with
    ///      HYSTERESIS (release band well below the engage band, so it can't flap across a poll).
    ///   2. Headroom-aware routing — a heavy build's effective account is the one with more
    ///      headroom (Shane's example: Primary 75% used, Secondary 25% used → send it to Secondary).
    ///      Reuses <see cref="AccountCapPolicy.ExceedsSonnetHigh"/> as the single "big build"
    ///      predicate — it never authors a second one.
    ///   3. FAIL CLOSED on bad data — the load-bearing rule. If a reading is unavailable, errored,
    ///      or STALE (older than <see cref="StaleAfter"/>), automation does NOT act: no auto-engage,
    ///      no auto-route, no guessed percentage. It holds the last manual state and surfaces plainly
    ///      that automation is inactive. This is the direct lesson from #2002 defect 2 — a guessed
    ///      value that rendered identically to a real one turned a display bug into confident wrong
    ///      behaviour; automating on that would turn it into a build-routing bug.
    ///   4. MANUAL ALWAYS WINS — a manual Conservation toggle (or Drain) takes precedence for a
    ///      visible window (<see cref="ManualHoldWindow"/>) and is never silently undone by the next
    ///      poll. Per-item "Run at Full Model" / Run Now overrides already bypass the cap via
    ///      isForced in QueueWatcherService and are untouched here.
    ///
    /// This is explicitly NOT licence to auto-detect the network connection — #1986's Home/Rental
    /// prohibition stands (usage percent is measurable; which house Shane is in is not). And it does
    /// NOT serialize accounts — routing changes credentials, not concurrency (_maxConcurrent already
    /// runs multiple builds at once).
    ///
    /// Logging channel: "usage-automation" via ActivityLog.Log.
    /// </summary>
    public sealed class UsageAutomationService
    {
        public const string Channel = "usage-automation";

        /// <summary>Singleton — QueueWatcherService (background thread) reaches the routing decision
        /// through <see cref="Instance"/>, while MainWindow (UI thread) feeds it meter snapshots.</summary>
        public static UsageAutomationService Instance { get; } = new UsageAutomationService();

        /// <summary>A reading older than this is STALE and disables automation for that account. The
        /// meter polls every 10 minutes, so 30 minutes is three missed polls — unambiguously stale,
        /// not just a skipped tick. Concrete by design: #2003 requires "stale" be a defined poll-age
        /// threshold, not left implicit.</summary>
        public static readonly TimeSpan StaleAfter = TimeSpan.FromMinutes(30);

        /// <summary>How long a manual Conservation toggle wins over automation. Within this window
        /// after Shane flips the toggle (either direction), automation will not change the cap on a
        /// poll — a deliberate "spend the last of my headroom" OFF, or an early ON, both survive. A
        /// genuine reset detected mid-window still eventually returns control once the window lapses.</summary>
        public static readonly TimeSpan ManualHoldWindow = TimeSpan.FromHours(2);

        /// <summary>Minimum headroom advantage (in percentage points) the alternative account must
        /// have over a heavy build's currently-assigned account before routing moves it. Prevents
        /// pointless flip-flopping when the two accounts sit close together.</summary>
        private const int RoutingMarginPercent = 10;

        private readonly object _gate = new object();

        // Latest per-account snapshot, updated from the meter on the UI thread and read (under lock)
        // by the watcher's launch thread. Null percent / !fresh => not usable for automation.
        private AccountReading _primary;
        private AccountReading _secondary;

        // Auto-conservation memory.
        private DateTime? _manualHoldUntil;            // a manual toggle wins until this moment
        private DateTime? _lastTrackedResetTarget;     // the reset moment we last saw, to detect a rollover

        // Last computed public state, for the title-bar surface.
        private AutomationState _state = AutomationState.Inactive;
        private string _stateReason = "meter not yet read";

        /// <summary>Raised (on whatever thread ran the evaluation — the caller marshals to UI) whenever
        /// automation may have changed the Conservation setting or its own active/inactive state, so the
        /// title bar can repaint the Conservation toggle and the automation status text.</summary>
        public event Action? Changed;

        private UsageAutomationService() { }

        public enum AutomationState
        {
            /// <summary>Master switch off — behaving as the pure manual #1989/#1419 controls.</summary>
            Disabled,
            /// <summary>On, but not acting because the reading is unavailable/errored/stale (fail closed).</summary>
            Inactive,
            /// <summary>On and acting on real, fresh readings.</summary>
            Active,
        }

        private struct AccountReading
        {
            public bool Configured;
            public int? Percent;
            public DateTime? ResetTarget;
            public DateTime? LastPoll;
            public ClaudeUsageMeterState State;

            /// <summary>A reading automation may act on: configured, Ok, a real percent, and polled
            /// within <see cref="StaleAfter"/>. Anything else fails closed.</summary>
            public bool Fresh =>
                Configured &&
                State == ClaudeUsageMeterState.Ok &&
                Percent.HasValue &&
                LastPoll.HasValue &&
                (DateTime.Now - LastPoll.Value) <= StaleAfter;
        }

        // ── public surface for the title bar ────────────────────────────────────

        public AutomationState State { get { lock (_gate) return _state; } }
        public string StateReason { get { lock (_gate) return _stateReason; } }

        /// <summary>One-line, human-readable status for the title bar next to the Conservation toggle.</summary>
        public string StatusText()
        {
            lock (_gate)
            {
                return _state switch
                {
                    AutomationState.Disabled => "Auto: off",
                    AutomationState.Active => "Auto: on — acting",
                    _ => $"Auto: inactive ({_stateReason})",
                };
            }
        }

        /// <summary>Called by MainWindow the instant Shane manually clicks the Conservation toggle (or
        /// Drain, which also turns it off). Arms the manual-hold window so the next poll can't silently
        /// undo his choice for the duration of <see cref="ManualHoldWindow"/>; automation resumes full
        /// authority once that visible window lapses.</summary>
        public void NotifyManualConservationChange()
        {
            lock (_gate)
            {
                _manualHoldUntil = DateTime.Now + ManualHoldWindow;
                ActivityLog.Log(Channel, $"Manual Conservation change — automation will not change the cap until {_manualHoldUntil:HH:mm:ss} (manual wins).");
            }
        }

        // ── meter feed + auto-conservation evaluation ───────────────────────────

        /// <summary>Feed a fresh meter snapshot. Updates the internal per-account readings and runs the
        /// auto-conservation state machine. Safe to call on the UI thread (it does no UI work itself).</summary>
        public void OnMeterStatus(ClaudeUsageStatus status)
        {
            if (status == null) return;

            // A transient "Polling" emit (fired at the START of every poll cycle) carries the SAME
            // underlying numbers as the last real reading — it's purely a "checking now" UI cue. Do
            // not re-evaluate on it, or automation would flicker to inactive for that instant and the
            // title bar would blink a spurious "unusable" reason every poll. The following
            // Ok/Unavailable/Error emit carries the real outcome and drives the decision.
            if (status.State == ClaudeUsageMeterState.Polling) return;

            bool changed;
            lock (_gate)
            {
                _primary = new AccountReading
                {
                    Configured = true, // the primary account is always the app's own ~/.claude
                    Percent = status.WeeklyPercent,
                    ResetTarget = status.WeeklyResetTarget,
                    LastPoll = status.LastPoll,
                    State = status.State,
                };
                _secondary = new AccountReading
                {
                    Configured = status.SecondaryConfigured,
                    Percent = status.SecondaryWeeklyPercent,
                    ResetTarget = status.SecondaryWeeklyResetTarget,
                    LastPoll = status.SecondaryLastPoll,
                    State = status.SecondaryState,
                };
                changed = EvaluateAutoConservationLocked();
            }
            if (changed) Changed?.Invoke();
        }

        /// <summary>Returns true if it changed the Conservation setting OR the public automation state,
        /// so the caller knows to raise <see cref="Changed"/>. Caller holds <see cref="_gate"/>.</summary>
        private bool EvaluateAutoConservationLocked()
        {
            var settings = BuildConsoleSettings.Load();
            var prevState = _state;
            var prevReason = _stateReason;

            if (!settings.UsageAutomationEnabled)
            {
                _state = AutomationState.Disabled;
                _stateReason = "master switch off";
                return _state != prevState || _stateReason != prevReason;
            }

            // Fail closed: auto-conservation needs at least the primary account fresh & valid.
            // (Routing additionally needs both — handled in ResolveAccountForLaunch.)
            if (!_primary.Fresh)
            {
                _state = AutomationState.Inactive;
                _stateReason = DescribeUnusable(_primary, "primary");
                // Deliberately DO NOT touch ConservationModeEnabled — hold the last manual/auto state.
                return _state != prevState || _stateReason != prevReason;
            }

            _state = AutomationState.Active;
            _stateReason = "acting on live readings";

            // Manual wins for the visible window — never override a manual toggle inside it.
            if (_manualHoldUntil.HasValue && DateTime.Now < _manualHoldUntil.Value)
            {
                _stateReason = $"manual hold until {_manualHoldUntil:HH:mm}";
                return _state != prevState || _stateReason != prevReason;
            }

            int threshold = ClampPercent(settings.AutoConservationThresholdPercent, 85);
            int release = ClampPercent(settings.AutoConservationReleasePercent, 50);
            if (release >= threshold) release = Math.Max(0, threshold - 1); // guarantee real hysteresis

            // The usage that matters for capping is the LEAST-headroom account a heavy build would
            // still land on — i.e. the best (min-usage) account routing could send it to. If even
            // that account is over the threshold, there is nowhere with headroom and capping is
            // right; if it has headroom, routing (not capping) handles it.
            int effectiveUsage = BestAccountUsageLocked();

            bool changedSetting = false;
            bool currentlyOn = settings.ConservationModeEnabled;

            // Reset detection: the tracked reset moment passed since we last looked -> a genuine
            // rollover, independent of the percentage path (belt-and-suspenders with the release band).
            bool resetPassed = ResetJustPassedLocked();

            if (!currentlyOn && effectiveUsage >= threshold)
            {
                settings.ConservationModeEnabled = true;
                settings.Save();
                changedSetting = true;
                ActivityLog.Log(Channel, $"Auto-conservation ENGAGED — best-account weekly usage {effectiveUsage}% ≥ threshold {threshold}%. Heavy builds (ExceedsSonnetHigh) now park until a real reset.");
            }
            else if (currentlyOn && (effectiveUsage <= release || resetPassed))
            {
                settings.ConservationModeEnabled = false;
                settings.Save();
                changedSetting = true;
                string why = resetPassed ? "weekly reset moment passed" : $"best-account usage {effectiveUsage}% ≤ release band {release}%";
                ActivityLog.Log(Channel, $"Auto-conservation RELEASED — {why}. Capped builds return to the queue at full model.");
            }

            return changedSetting || _state != prevState || _stateReason != prevReason;
        }

        /// <summary>The min-usage (max-headroom) weekly percent across the accounts automation may act
        /// on. Only fresh accounts count; if only primary is fresh, it's primary's percent. Caller holds
        /// the lock; <see cref="_primary"/> is known fresh when this is called.</summary>
        private int BestAccountUsageLocked()
        {
            int best = _primary.Percent!.Value;
            if (_secondary.Fresh && _secondary.Percent!.Value < best)
                best = _secondary.Percent.Value;
            return best;
        }

        /// <summary>True once, when the reset moment we were tracking has now passed — a genuine weekly
        /// rollover. Tracks the primary account's reset target (the account auto-conservation keys on).</summary>
        private bool ResetJustPassedLocked()
        {
            var current = _primary.ResetTarget;
            bool passed = false;
            if (_lastTrackedResetTarget.HasValue && DateTime.Now >= _lastTrackedResetTarget.Value)
            {
                // The moment we were tracking is in the past now, and the API has moved the target
                // forward (or cleared it) — treat as a real reset.
                if (!current.HasValue || current.Value > _lastTrackedResetTarget.Value)
                    passed = true;
            }
            _lastTrackedResetTarget = current;
            return passed;
        }

        private static string DescribeUnusable(AccountReading r, string label)
        {
            if (!r.Configured) return $"{label} not configured";
            if (r.State == ClaudeUsageMeterState.Error) return $"{label} reading errored";
            if (r.State == ClaudeUsageMeterState.Unavailable) return $"{label} reading unavailable";
            if (!r.Percent.HasValue) return $"{label} reading has no value";
            if (!r.LastPoll.HasValue) return $"{label} never polled";
            if ((DateTime.Now - r.LastPoll.Value) > StaleAfter) return $"{label} reading stale (>{StaleAfter.TotalMinutes:0}m old)";
            return $"{label} reading unusable";
        }

        // ── routing decision (called by the watcher at launch) ──────────────────

        /// <summary>
        /// The effective account a build should launch against, given the live meter. Returns the
        /// build's own <paramref name="assignedAccount"/> unchanged when automation must not act:
        /// master switch off, either account unusable (fail closed), a light (non-heavy) build, or an
        /// explicit per-build account choice that differs from the current default (manual wins).
        /// Otherwise returns "primary"/"secondary" for the account with more headroom, but only when
        /// it beats the assigned account by <see cref="RoutingMarginPercent"/>.
        ///
        /// Reuses <see cref="AccountCapPolicy.ExceedsSonnetHigh"/> — the one shared "big build" test.
        /// Called off the UI thread by QueueWatcherService.LaunchItem; snapshot reads are locked.
        /// </summary>
        public string? ResolveAccountForLaunch(string? model, string? effort, string? assignedAccount)
        {
            var settings = BuildConsoleSettings.Load();
            if (!settings.UsageAutomationEnabled) return assignedAccount;

            // Only heavy builds are routed — they consume the most, and #2003 is explicit that these
            // are the ones that matter. Reuse the single predicate; never author a second one.
            if (!AccountCapPolicy.ExceedsSonnetHigh(model, effort)) return assignedAccount;

            int primaryPct, secondaryPct;
            lock (_gate)
            {
                // Fail closed: routing across accounts needs BOTH accounts fresh & valid. A stale or
                // errored reading on either side means we cannot know which has headroom, so hold.
                if (!_primary.Fresh || !_secondary.Fresh) return assignedAccount;
                primaryPct = _primary.Percent!.Value;
                secondaryPct = _secondary.Percent!.Value;
            }

            string assigned = NormalizeAccount(assignedAccount);
            string defaultAccount = NormalizeAccount(settings.DefaultAccount);

            // Manual wins: an explicit per-build account that differs from the current default toggle
            // was a deliberate choice in the Edit Build Prompt dialog / --account flag — respect it.
            // A build that simply carries the default is fair game for headroom routing.
            if (assigned != defaultAccount) return assignedAccount;

            string best = secondaryPct < primaryPct ? "secondary" : "primary";
            int assignedPct = assigned == "secondary" ? secondaryPct : primaryPct;
            int bestPct = best == "secondary" ? secondaryPct : primaryPct;

            if (best == assigned) return assignedAccount;                 // already on the best account
            if (assignedPct - bestPct < RoutingMarginPercent) return assignedAccount; // too close to bother

            ActivityLog.Log(Channel, $"Routing heavy build ({model ?? "?"}/{effort ?? "?"}) → {best} account (primary {primaryPct}% vs secondary {secondaryPct}% used; more headroom on {best}).");
            return best;
        }

        private static string NormalizeAccount(string? a) =>
            string.Equals(a, "secondary", StringComparison.OrdinalIgnoreCase) ? "secondary" : "primary";

        private static int ClampPercent(int v, int fallback) =>
            (v < 1 || v > 100) ? fallback : v;
    }
}
