using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;

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
    /// </summary>
    public partial class MainWindow
    {
        private PerformanceCounter? _cpuCounter;
        private DispatcherTimer? _resourceMonitorTimer;

        // ── Git #4543 memory-pressure detector state/config ──────────────────────────────
        // Physical RAM load (%) at/above which, combined with a rising pagefile, we auto-pause.
        // Deliberately EARLY (well under 100%): the pause has to land while the machine is still
        // fully responsive, not once symptoms show.
        private const uint PhysicalLoadPauseThreshold = 88;
        // Hysteresis: RAM load must fall back UNDER this (lower than the pause threshold) to count
        // toward clearing — prevents flapping right at the boundary.
        private const uint PhysicalLoadResumeThreshold = 80;
        // Number of most-recent 1.5s samples over which pagefile-in-use must net-rise to count as
        // "actively growing" (≈6s of climb — a trend, not a single noisy spike).
        private const int PagefileTrendSamples = 4;
        // Minimum net rise in pagefile-in-use across that window to be treated as real (filters the
        // small commit jitter normal allocations produce). 300 MB.
        private const ulong PagefileRiseMinBytes = 300UL * 1024 * 1024;
        // Pressure must stay CLEARED continuously for this long before auto-resume — a real
        // sustained cooldown, not one good sample.
        private static readonly TimeSpan MemoryPressureClearSustain = TimeSpan.FromSeconds(30);

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
            // "Stable or shrinking" (the cooldown side): net non-increase across the window.
            bool pagefileNotRising = !haveFullWindow || newest <= oldest;

            bool ramElevated = status.dwMemoryLoad >= PhysicalLoadPauseThreshold;
            bool ramLow = status.dwMemoryLoad < PhysicalLoadResumeThreshold;

            bool underPressure = ramElevated && pagefileRising;

            var watcher = _queueWatcher;
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
                    if (clearNow)
                    {
                        _memoryPressureClearSince ??= DateTime.UtcNow;
                        if (DateTime.UtcNow - _memoryPressureClearSince.Value >= MemoryPressureClearSustain)
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
        }

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
