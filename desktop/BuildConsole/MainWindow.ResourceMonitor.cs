using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Threading;

namespace BuildConsole
{
    /// <summary>
    /// Bottom-panel resource meters — real system-wide (not just BuildConsole's own
    /// process) CPU % and Memory used/total, polled on a 1.5s timer.
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
    /// </summary>
    public partial class MainWindow
    {
        private PerformanceCounter? _cpuCounter;
        private DispatcherTimer? _resourceMonitorTimer;

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
            }
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
