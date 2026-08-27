using System;
using System.ComponentModel;
using System.Linq;
using System.ServiceProcess;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    public enum PostgresServiceState
    {
        Running,
        Stopped,
        StartPending,
        StopPending,
        Unknown,
        NotFound
    }

    public class PostgresServiceStatus
    {
        public PostgresServiceState State { get; set; } = PostgresServiceState.Unknown;
        public string ServiceName { get; set; } = string.Empty;
        public string Summary { get; set; } = "Checking…";
        public string Details { get; set; } = string.Empty;
        public DateTime CheckedAt { get; set; } = DateTime.Now;
        public bool IsHealthy => State == PostgresServiceState.Running;
    }

    /// <summary>
    /// Git #1417 — Shane: "I need a way in the WPF App to know when the
    /// Postgres service goes down, and turn it back on." Checks the real
    /// local PostgreSQL Windows service directly via ServiceController, and
    /// can start it. Deliberately separate from SystemHealthService's
    /// "Local Database Pipe" check, which only proves BuildConsole's own
    /// api-server can reach Postgres through the SqlRunner HTTP pipe — that
    /// check goes red whenever the api-server itself is down too, so it can't
    /// tell "Postgres service is stopped" apart from "api-server is down".
    /// This monitor answers the Windows-service question on its own.
    /// </summary>
    public static class PostgresServiceMonitor
    {
        private const string LogChannel = "system.health";

        /// Confirmed the real installed service name on Shane's machine
        /// (Get-Service | Where Name -like '*postgres*' → "postgresql-x64-18").
        /// FindService() falls back to a "postgresql*"/"postgres" search so a
        /// future major-version upgrade (e.g. postgresql-x64-19) doesn't quietly
        /// go NotFound.
        private const string PreferredServiceName = "postgresql-x64-18";

        public static Task<PostgresServiceStatus> CheckAsync() => Task.Run(() =>
        {
            var status = new PostgresServiceStatus();
            try
            {
                using var svc = FindService();
                if (svc == null)
                {
                    status.State = PostgresServiceState.NotFound;
                    status.Summary = "⚪ No local PostgreSQL service found";
                    status.Details = $"No Windows service named '{PreferredServiceName}' or matching 'postgres*' was found on this machine.";
                    ActivityLog.Log(LogChannel, $"Postgres service check — {status.Summary}");
                    return status;
                }

                status.ServiceName = svc.ServiceName;
                status.State = MapStatus(svc.Status);
                status.Summary = status.State switch
                {
                    PostgresServiceState.Running => $"🟢 {svc.ServiceName} running",
                    PostgresServiceState.StartPending => $"🟡 {svc.ServiceName} starting…",
                    PostgresServiceState.StopPending => $"🟡 {svc.ServiceName} stopping…",
                    PostgresServiceState.Stopped => $"🔴 {svc.ServiceName} stopped",
                    _ => $"{svc.ServiceName}: {svc.Status}"
                };
                status.Details = $"Service: {svc.ServiceName}\nStatus: {svc.Status}\nChecked: {status.CheckedAt:HH:mm:ss}";
                ActivityLog.Log(LogChannel, $"Postgres service check — {status.Summary}");
            }
            catch (Exception ex)
            {
                status.State = PostgresServiceState.Unknown;
                status.Summary = $"Error checking service: {ex.Message}";
                status.Details = ex.ToString();
                ActivityLog.Log(LogChannel, $"Postgres service check FAILED — {ex.Message}");
            }

            return status;
        });

        private static ServiceController? FindService()
        {
            var all = ServiceController.GetServices();
            var exact = all.FirstOrDefault(s => string.Equals(s.ServiceName, PreferredServiceName, StringComparison.OrdinalIgnoreCase));
            if (exact != null)
            {
                foreach (var other in all)
                {
                    if (!ReferenceEquals(other, exact)) other.Dispose();
                }
                return exact;
            }

            var fallback = all
                .Where(s => s.ServiceName.StartsWith("postgresql", StringComparison.OrdinalIgnoreCase)
                         || s.DisplayName.Contains("postgres", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(s => s.ServiceName)
                .FirstOrDefault();

            foreach (var other in all)
            {
                if (!ReferenceEquals(other, fallback)) other.Dispose();
            }
            return fallback;
        }

        /// <summary>
        /// Checks one named service directly (no FindService() fallback search) —
        /// used to re-verify the exact service StartAsync just started, so a stale
        /// or mismatched name can never be silently reported as the wrong service's
        /// (healthy) state.
        /// </summary>
        private static Task<PostgresServiceStatus> CheckSpecificAsync(string serviceName) => Task.Run(() =>
        {
            var status = new PostgresServiceStatus { ServiceName = serviceName };
            try
            {
                using var svc = new ServiceController(serviceName);
                svc.Refresh();
                status.State = MapStatus(svc.Status);
                status.Summary = status.State switch
                {
                    PostgresServiceState.Running => $"🟢 {serviceName} running",
                    PostgresServiceState.StartPending => $"🟡 {serviceName} starting…",
                    PostgresServiceState.StopPending => $"🟡 {serviceName} stopping…",
                    PostgresServiceState.Stopped => $"🔴 {serviceName} stopped",
                    _ => $"{serviceName}: {svc.Status}"
                };
                status.Details = $"Service: {serviceName}\nStatus: {svc.Status}\nChecked: {status.CheckedAt:HH:mm:ss}";
            }
            catch (Exception ex)
            {
                status.State = PostgresServiceState.Unknown;
                status.Summary = $"Error checking service: {ex.Message}";
                status.Details = ex.ToString();
            }

            return status;
        });

        private static PostgresServiceState MapStatus(ServiceControllerStatus s) => s switch
        {
            ServiceControllerStatus.Running => PostgresServiceState.Running,
            ServiceControllerStatus.Stopped => PostgresServiceState.Stopped,
            ServiceControllerStatus.StartPending => PostgresServiceState.StartPending,
            ServiceControllerStatus.StopPending => PostgresServiceState.StopPending,
            _ => PostgresServiceState.Unknown
        };

        /// <summary>
        /// Starts the given Windows service and re-checks the real state
        /// afterward — never reports success just because Start() didn't
        /// throw. Reports elevation failures (Win32 error 5, ERROR_ACCESS_DENIED)
        /// with a clear, actionable message instead of a raw exception string.
        /// </summary>
        public static async Task<(bool success, string message)> StartAsync(string serviceName)
        {
            ActivityLog.Log(LogChannel, $"Attempting to start local Postgres service '{serviceName}'…");

            try
            {
                using var sc = new ServiceController(serviceName);
                sc.Refresh();
                if (sc.Status == ServiceControllerStatus.Running)
                {
                    ActivityLog.Log(LogChannel, $"'{serviceName}' already running.");
                    return (true, $"{serviceName} is already running.");
                }

                sc.Start();
                await Task.Run(() =>
                {
                    try
                    {
                        sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(15));
                    }
                    catch (System.ServiceProcess.TimeoutException)
                    {
                        // fall through — the re-check below is the real source of truth
                    }
                });
            }
            catch (Win32Exception win32ex) when (win32ex.NativeErrorCode == 5)
            {
                ActivityLog.Log(LogChannel, $"Start of '{serviceName}' FAILED — access denied (not elevated).");
                return (false, "Access denied — starting this Windows service requires BuildConsole to run elevated (right-click → Run as administrator).");
            }
            catch (InvalidOperationException ioex) when (ioex.InnerException is Win32Exception w2 && w2.NativeErrorCode == 5)
            {
                ActivityLog.Log(LogChannel, $"Start of '{serviceName}' FAILED — access denied (not elevated).");
                return (false, "Access denied — starting this Windows service requires BuildConsole to run elevated (right-click → Run as administrator).");
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"Start of '{serviceName}' FAILED — {ex.Message}");
                return (false, $"Failed to start '{serviceName}': {ex.Message}");
            }

            // Don't trust WaitForStatus/exit code alone — re-check the SPECIFIC service
            // that was started via a fresh query, not CheckAsync()'s generic Postgres
            // finder (which would silently report a different service's state if
            // FindService()'s fallback ever resolved to something other than `serviceName`).
            var recheck = await CheckSpecificAsync(serviceName);
            if (recheck.State == PostgresServiceState.Running)
            {
                ActivityLog.Log(LogChannel, $"Start of '{serviceName}' CONFIRMED — {recheck.Summary}");
                return (true, recheck.Summary);
            }

            ActivityLog.Log(LogChannel, $"Start of '{serviceName}' NOT confirmed — {recheck.Summary}");
            return (false, $"Start command did not error, but the service is not confirmed Running ({recheck.State}). {recheck.Details}");
        }
    }
}
