using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Primary-StatusBar resource meters — real system-wide (not just BuildConsole's own
    /// process) CPU % and Memory used/total, polled on a 1.5s timer. (Moved out of the
    /// never-opened bottom panel into the always-visible StatusBar in Git #4544, same
    /// x:Names.)
    ///
    /// CPU: <see cref="PerformanceCounter"/> against "Processor"/"% Processor
    /// Time"/"_Total" — the standard Windows-native counter (WMI's
    /// ManagementObjectSearcher is avoided here: it's known to hang indefinitely
    /// on this machine, see BUILD_LOG). NextValue() returns 0 on the very first
    /// call (no prior sample to diff against) and settles from the second tick
    /// on, which is fine at this poll interval.
    ///
    /// Memory: GlobalMemoryStatusEx (kernel32) — a single synchronous call
    /// returning real total/available physical memory, no warm-up sample needed.
    ///
    /// Git #4543 — this same poll is also the early/predictive memory-pressure detector
    /// that auto-pauses the build queue. The <see cref="MEMORYSTATUSEX"/> struct already
    /// carries <c>ullTotalPageFile</c>/<c>ullAvailPageFile</c> (previously read but unused);
    /// pagefile-in-use (<c>ullTotalPageFile - ullAvailPageFile</c>) climbing over consecutive
    /// samples while physical RAM load is already elevated is the genuine LEADING indicator
    /// of imminent swap thrashing — visible well before the box goes unresponsive. When that
    /// crosses the threshold we call <see cref="Services.QueueWatcherService.SetMemoryPressurePause"/>
    /// (true) so no NEW build is launched into the pressure; when it clears for a sustained
    /// cooldown we call it (false). Fully automatic, zero user interaction — the meter only
    /// REFLECTS the state (red bar + "Queue paused: memory pressure"), it never triggers it.
    ///
    /// Git #4599 — the pause %, resume %, clear-sustain duration and a full on/off master switch
    /// are now real, persisted <see cref="Services.BuildConsoleSettings"/> Shane can tune himself
    /// (loaded at startup in <see cref="InitializeResourceMonitor"/>, live-applied via
    /// <see cref="MainWindow.SettingsTab"/>'s forwarding methods same as #4542's Max
    /// Concurrent/Hard Cap sliders) — no longer the original #4543/#4561 fixed constants.
    /// <see cref="PagefileTrendSamples"/>/<see cref="PagefileRiseMinBytes"/>/
    /// <see cref="PagefileClearToleranceBytes"/> remain internal tuning constants; Shane didn't
    /// ask to control those.
    /// </summary>
    public partial class MainWindow
    {
        private PerformanceCounter? _cpuCounter;
        private DispatcherTimer? _resourceMonitorTimer;

        // ── Git #4543/#4599 memory-pressure detector state/config ────────────────────────
        // Git #4599 — master on/off switch for the whole feature (BuildConsoleSettings-backed).
        // When false, EvaluateMemoryPressure skips pause/resume logic entirely and immediately
        // releases any pause already in effect.
        private bool _memoryPressureAutoPauseEnabled = true;
        // Physical RAM load (%) at/above which, combined with a rising pagefile, we auto-pause.
        // Git #4599 — real, persisted Setting (BuildConsoleSettings.MemoryPressurePauseThresholdPercent,
        // default 98, raised from #4543's original fixed 88 per Shane's ask to pause much later,
        // closer to when real swapping actually starts).
        private uint _memoryPressurePauseThreshold = 98;
        // Hysteresis: RAM load must fall back UNDER this (lower than the pause threshold) to count
        // toward clearing — prevents flapping right at the boundary. Git #4599 — real, persisted
        // Setting (MemoryPressureResumeThresholdPercent, default 92, from #4543's original fixed 80).
        private uint _memoryPressureResumeThreshold = 92;
        // Number of most-recent 1.5s samples over which pagefile-in-use must net-rise to count as
        // "actively growing" (≈6s of climb — a trend, not a single noisy spike). Internal tuning
        // constant — Shane didn't ask to control this.
        private const int PagefileTrendSamples = 4;
        // Minimum net rise in pagefile-in-use across that window to be treated as real (filters the
        // small commit jitter normal allocations produce). 300 MB. Internal tuning constant.
        private const ulong PagefileRiseMinBytes = 300UL * 1024 * 1024;
        // Git #4561: the clear/resume side needs its own noise floor, not a zero-tolerance exact
        // non-positive delta. Confirmed live (synthetic 90s run, ordinary ±2MB background-paging
        // noise, RAM held safely under the resume threshold throughout): a same-tick net rise of a
        // few MB — completely unrelated to the original pressure — broke the clear streak on most
        // ticks and the queue never auto-resumed. 32 MB is comfortably above normal background
        // jitter and far below the 300 MB PagefileRiseMinBytes real-pressure floor, so it cannot
        // mask an actual renewed rise. Internal tuning constant.
        private const ulong PagefileClearToleranceBytes = 32UL * 1024 * 1024;
        // Pressure must stay CLEARED continuously for this long before auto-resume — a real
        // sustained cooldown, not one good sample. Git #4599 — real, persisted Setting
        // (MemoryPressureClearSustainSeconds, default 10s, shortened from #4543/#4561's original
        // fixed 30s per Shane's ask to release/resume faster).
        private TimeSpan _memoryPressureClearSustain = TimeSpan.FromSeconds(10);

        // Rolling history of pagefile-in-use bytes (keep PagefileTrendSamples+1 so we can measure
        // the net change across exactly PagefileTrendSamples steps). UI-thread only (DispatcherTimer).
        private readonly Queue<ulong> _pagefileInUseHistory = new();
        // When the clear condition first began holding continuously; null while under pressure or
        // when the clear streak has been broken. Only meaningful while the queue is memory-paused.
        private DateTime? _memoryPressureClearSince;
        // Cached meter brushes (resolved once; either may be null if the theme lacks it).
        private Brush? _memoryMeterNormalBrush;
        private Brush? _memoryMeterPausedBrush;

        private void InitializeResourceMonitor()
        {
            try
            {
                _cpuCounter = new PerformanceCounter("Processor", "% Processor Time", "_Total");
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log("resource-monitor", $"CPU counter unavailable: {ex.Message}");
            }

            // Git #4599 — load the real, persisted memory-pressure tuning at startup.
            LoadMemoryPressureSettings();

            _memoryMeterNormalBrush = TryFindResource("MauveBrush") as Brush;
            _memoryMeterPausedBrush = TryFindResource("RedBrush") as Brush;

            _resourceMonitorTimer = new DispatcherTimer(DispatcherPriority.Background)
            {
                Interval = TimeSpan.FromSeconds(1.5)
            };
            _resourceMonitorTimer.Tick += (_, _) => TickResourceMonitor();
            _resourceMonitorTimer.Start();
            TickResourceMonitor();

            this.Closed += (_, _) =>
            {
                _resourceMonitorTimer?.Stop();
                _cpuCounter?.Dispose();
            };
        }

        private void TickResourceMonitor()
        {
            if (_cpuCounter != null)
            {
                try
                {
                    float cpuPercent = _cpuCounter.NextValue();
                    CpuMeterBar.Value = Math.Clamp(cpuPercent, 0, 100);
                    CpuMeterText.Text = $"{cpuPercent:0}%";
                }
                catch (Exception ex)
                {
                    BuildConsole.Services.ActivityLog.Log("resource-monitor", $"CPU read failed: {ex.Message}");
                }
            }

            var status = new MEMORYSTATUSEX();
            if (GlobalMemoryStatusEx(ref status))
            {
                double totalGb = status.ullTotalPhys / 1024.0 / 1024.0 / 1024.0;
                double usedGb = (status.ullTotalPhys - status.ullAvailPhys) / 1024.0 / 1024.0 / 1024.0;
                double usedPercent = status.dwMemoryLoad;

                MemoryMeterBar.Value = Math.Clamp(usedPercent, 0, 100);
                MemoryMeterText.Text = $"{usedPercent:0}% ({usedGb:0.0}/{totalGb:0.0} GB)";

                EvaluateMemoryPressure(status);
            }
        }

        /// <summary>
        /// Git #4543 — the early/predictive memory-pressure decision, run every 1.5s off the same
        /// GlobalMemoryStatusEx read. Drives <see cref="Services.QueueWatcherService.SetMemoryPressurePause"/>
        /// and reflects the result on the memory meter. No-ops harmlessly if the queue watcher isn't
        /// constructed yet (early startup ticks).
        /// </summary>
        private void EvaluateMemoryPressure(MEMORYSTATUSEX status)
        {
            var watcher = _queueWatcher;

            // Git #4599 — master switch OFF: skip pause/resume logic entirely (never call
            // SetMemoryPressurePause(true)), and if a pause from before switching off is still in
            // effect, release it immediately so a bedtime run doesn't stay stuck paused.
            if (!_memoryPressureAutoPauseEnabled)
            {
                if (watcher != null && watcher.IsMemoryPressurePaused)
                    watcher.SetMemoryPressurePause(false);
                _memoryPressureClearSince = null;

                var normalBrushOff = _memoryMeterNormalBrush;
                if (normalBrushOff != null) MemoryMeterBar.Foreground = normalBrushOff;
                if (MemoryPressurePauseText != null) MemoryPressurePauseText.Visibility = Visibility.Collapsed;
                if (MemoryPressureForceClearText != null) MemoryPressureForceClearText.Visibility = Visibility.Collapsed;
                return;
            }

            // Pagefile-in-use trend over the rolling window.
            ulong pagefileInUse = status.ullTotalPageFile - status.ullAvailPageFile;
            _pagefileInUseHistory.Enqueue(pagefileInUse);
            while (_pagefileInUseHistory.Count > PagefileTrendSamples + 1)
                _pagefileInUseHistory.Dequeue();

            bool haveFullWindow = _pagefileInUseHistory.Count >= PagefileTrendSamples + 1;
            ulong oldest = pagefileInUse, newest = pagefileInUse, prev = pagefileInUse;
            if (haveFullWindow)
            {
                var arr = _pagefileInUseHistory.ToArray();
                oldest = arr[0];
                newest = arr[arr.Length - 1];
                prev = arr[arr.Length - 2];
            }

            // "Actively growing": a real net rise across the window AND still climbing on the most
            // recent step (not already receding). Needs a full window first, so no false pause in
            // the first few seconds after launch.
            bool pagefileRising = haveFullWindow
                && newest > oldest
                && (newest - oldest) >= PagefileRiseMinBytes
                && newest >= prev;
            // "Stable or shrinking" (the cooldown side): net change across the window within a real
            // noise tolerance — NOT an exact non-positive delta (Git #4561; see
            // PagefileClearToleranceBytes above for why zero tolerance broke real auto-resume).
            bool pagefileNotRising = !haveFullWindow || newest <= oldest + PagefileClearToleranceBytes;

            bool ramElevated = status.dwMemoryLoad >= _memoryPressurePauseThreshold;
            bool ramLow = status.dwMemoryLoad < _memoryPressureResumeThreshold;

            bool underPressure = ramElevated && pagefileRising;

            if (watcher != null)
            {
                if (!watcher.IsMemoryPressurePaused)
                {
                    if (underPressure)
                    {
                        watcher.SetMemoryPressurePause(true);
                        _memoryPressureClearSince = null;
                    }
                }
                else
                {
                    // Currently auto-paused. Resume only once the machine is genuinely clear
                    // (RAM back under the resume threshold AND pagefile stable/shrinking) for the
                    // full sustained cooldown — a broken streak restarts the clock.
                    bool clearNow = ramLow && pagefileNotRising;

                    // Git #4575 — real, per-tick diagnostic logging while paused. #4561's fix was
                    // verified only against a synthetic harness and Shane's real machine got stuck
                    // again anyway; this gives the next stuck episode real tick-by-tick data instead
                    // of a third blind guess. Cheap (one log line per already-running 1.5s poll) and
                    // only fires while actually paused, so it costs nothing the rest of the time.
                    double? clearElapsedSeconds = _memoryPressureClearSince.HasValue
                        ? (DateTime.UtcNow - _memoryPressureClearSince.Value).TotalSeconds
                        : (double?)null;
                    ActivityLog.Log("resource-monitor",
                        $"memory-pressure-paused tick: dwMemoryLoad={status.dwMemoryLoad} " +
                        $"pagefileInUse={pagefileInUse} oldest={oldest} newest={newest} prev={prev} " +
                        $"pagefileRising={pagefileRising} pagefileNotRising={pagefileNotRising} " +
                        $"ramLow={ramLow} clearNow={clearNow} " +
                        $"memoryPressureClearSince={(clearElapsedSeconds.HasValue ? clearElapsedSeconds.Value.ToString("F1") + "s" : "null")}");

                    if (clearNow)
                    {
                        _memoryPressureClearSince ??= DateTime.UtcNow;
                        if (DateTime.UtcNow - _memoryPressureClearSince.Value >= _memoryPressureClearSustain)
                        {
                            watcher.SetMemoryPressurePause(false);
                            _memoryPressureClearSince = null;
                        }
                    }
                    else
                    {
                        _memoryPressureClearSince = null;
                    }
                }
            }

            // Informational only — reflect the live pause state on the meter (never a trigger).
            bool memPaused = watcher?.IsMemoryPressurePaused ?? false;
            var pausedBrush = _memoryMeterPausedBrush;
            var normalBrush = _memoryMeterNormalBrush;
            if (memPaused && pausedBrush != null) MemoryMeterBar.Foreground = pausedBrush;
            else if (!memPaused && normalBrush != null) MemoryMeterBar.Foreground = normalBrush;
            if (MemoryPressurePauseText != null)
                MemoryPressurePauseText.Visibility = memPaused ? Visibility.Visible : Visibility.Collapsed;
            if (MemoryPressureForceClearText != null)
                MemoryPressureForceClearText.Visibility = memPaused ? Visibility.Visible : Visibility.Collapsed;
        }

        /// <summary>
        /// Git #4577 — manual escape hatch: force-clears the CURRENT #4543 memory-pressure
        /// auto-pause on click, without disabling the automatic detector. Resets
        /// <see cref="_memoryPressureClearSince"/> so the automatic cooldown logic above doesn't
        /// immediately re-evaluate against stale tracking, then clears the pause directly on the
        /// watcher (which itself re-evaluates the queue immediately — see
        /// <see cref="QueueWatcherService.SetMemoryPressurePause"/>). If real pressure genuinely
        /// returns afterward, the automatic detector re-engages normally on its next poll.
        /// </summary>
        private void ForceClearMemoryPressurePause_Click(object sender, MouseButtonEventArgs e)
        {
            var watcher = _queueWatcher;
            if (watcher == null || !watcher.IsMemoryPressurePaused) return;
            _memoryPressureClearSince = null;
            watcher.SetMemoryPressurePause(false);
            ActivityLog.Log("watcher", "Queue memory-pressure pause force-cleared manually (Git #4577) — automatic detection remains active and will re-pause if real pressure returns.");
        }

        /// <summary>Git #4599 — read the persisted memory-pressure tuning at startup into the live
        /// instance fields <see cref="EvaluateMemoryPressure"/> actually reads every tick.</summary>
        private void LoadMemoryPressureSettings()
        {
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            _memoryPressureAutoPauseEnabled = settings.MemoryPressureAutoPauseEnabled;
            _memoryPressurePauseThreshold = (uint)Math.Clamp(settings.MemoryPressurePauseThresholdPercent, 1, 100);
            _memoryPressureResumeThreshold = (uint)Math.Clamp(settings.MemoryPressureResumeThresholdPercent, 0, (int)_memoryPressurePauseThreshold - 1);
            _memoryPressureClearSustain = TimeSpan.FromSeconds(Math.Max(0, settings.MemoryPressureClearSustainSeconds));
        }

        /// <summary>Git #4599 — live-apply forwarding target for the Settings UI's memory-pressure
        /// pause-threshold control (see SettingsTabView.BtnSaveMemoryPressurePause_Click). Sibling of
        /// <see cref="UpdateMemoryPressureResumeThreshold"/>; unlike #4542's Max Concurrent/Hard Cap
        /// (which forward into QueueWatcherService), this sets an instance field read directly by
        /// EvaluateMemoryPressure on its next 1.5s tick — no restart needed.</summary>
        public void UpdateMemoryPressurePauseThreshold(uint percent) => _memoryPressurePauseThreshold = percent;

        /// <summary>Git #4599 — live-apply forwarding target for the resume/hysteresis threshold.</summary>
        public void UpdateMemoryPressureResumeThreshold(uint percent) => _memoryPressureResumeThreshold = percent;

        /// <summary>Git #4599 — live-apply forwarding target for the sustained-clear cooldown duration.</summary>
        public void UpdateMemoryPressureClearSustainSeconds(int seconds) =>
            _memoryPressureClearSustain = TimeSpan.FromSeconds(Math.Max(0, seconds));

        /// <summary>Git #4599 — live-apply forwarding target for the whole feature's on/off master
        /// switch. Turning it off immediately releases any pause already in effect on the very next
        /// tick (see the enabled-gate at the top of <see cref="EvaluateMemoryPressure"/>) — a bedtime
        /// run doesn't stay stuck paused from before the toggle.</summary>
        public void UpdateMemoryPressureAutoPauseEnabled(bool enabled) => _memoryPressureAutoPauseEnabled = enabled;

        /// <summary>Current live values, read by the Settings UI on open so it reflects whatever is
        /// actually in effect this session (mirrors QueueWatcher.MaxConcurrent/HardCap's pattern)
        /// rather than only the persisted file.</summary>
        public bool MemoryPressureAutoPauseEnabled => _memoryPressureAutoPauseEnabled;
        public uint MemoryPressurePauseThresholdPercent => _memoryPressurePauseThreshold;
        public uint MemoryPressureResumeThresholdPercent => _memoryPressureResumeThreshold;
        public int MemoryPressureClearSustainSecondsLive => (int)_memoryPressureClearSustain.TotalSeconds;

        [StructLayout(LayoutKind.Sequential)]
        private struct MEMORYSTATUSEX
        {
            public uint dwLength;
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;

            public MEMORYSTATUSEX()
            {
                dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>();
                dwMemoryLoad = 0;
                ullTotalPhys = 0;
                ullAvailPhys = 0;
                ullTotalPageFile = 0;
                ullAvailPageFile = 0;
                ullTotalVirtual = 0;
                ullAvailVirtual = 0;
                ullAvailExtendedVirtual = 0;
            }
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);
    }
}
