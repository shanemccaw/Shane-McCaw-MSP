using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// The real, settled result of one <see cref="SubprocessRunner"/> invocation (across
    /// however many internal retry attempts it took). <see cref="LaunchError"/> is non-null
    /// only when the process could not be started/completed at all (Win32 spawn failure, or a
    /// timeout that had to kill it); <see cref="ExitCode"/>/<see cref="StdOut"/>/<see cref="StdErr"/>
    /// are the child's real output when it did run.
    /// </summary>
    public readonly record struct SubprocessResult(
        int ExitCode,
        string StdOut,
        string StdErr,
        string? LaunchError,
        bool Crashed,
        int Attempts)
    {
        /// <summary>True if the process actually ran to completion (whatever its exit code).</summary>
        public bool Started => LaunchError == null;

        /// <summary>True only on a genuine zero-exit completion — the one "everything worked" state.</summary>
        public bool Ok => LaunchError == null && ExitCode == 0;

        /// <summary>A single trimmed line describing what went wrong, for a status label / log — the launch
        /// error, a crash note, or git/gh's own first stderr line. Empty when <see cref="Ok"/>.</summary>
        public string ShortError()
        {
            if (Ok) return "";
            if (LaunchError != null) return Trim1(LaunchError);
            if (Crashed) return $"process crashed (exit 0x{unchecked((uint)ExitCode):X8}){AttemptsSuffix()}";
            var err = FirstLine(StdErr);
            if (!string.IsNullOrEmpty(err)) return err;
            var outp = FirstLine(StdOut);
            if (!string.IsNullOrEmpty(outp)) return outp;
            return $"exit code {ExitCode}";
        }

        private string AttemptsSuffix() => Attempts > 1 ? $" after {Attempts} attempts" : "";

        private static string FirstLine(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return "";
            foreach (var raw in s.Split('\n'))
            {
                var t = raw.Trim();
                if (t.Length > 0) return t.Length > 200 ? t.Substring(0, 199) + "…" : t;
            }
            return "";
        }

        private static string Trim1(string s)
        {
            s = (s ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
            return s.Length > 200 ? s.Substring(0, 199) + "…" : s;
        }
    }

    /// <summary>
    /// Git #2539 — the one place BuildConsole spawns <c>git</c>/<c>gh</c> child processes, with the
    /// three things the real, evidenced startup-crash bug needs and the ~18 scattered ad-hoc
    /// spawn sites did not all have:
    ///
    /// 1. <b>Honest capture.</b> Both stdout and stderr are drained (before the process is waited
    ///    on, so a full-pipe buffer can never deadlock the wait), and the real exit code is
    ///    returned. Several call sites read stdout only and never checked the exit code, so a
    ///    child that CRASHED (empty stdout, an NTSTATUS exit code) was silently indistinguishable
    ///    from a clean/empty success — e.g. StartupConnectivityService reporting "main (clean)"
    ///    off a git.exe that had actually aborted. This mirrors the surface #2535/#2536 built for
    ///    the Git panel.
    ///
    /// 2. <b>Crash-class retry with backoff.</b> The real root cause found for #2539 was Git for
    ///    Windows <b>2.20.1 (Dec 2018)</b> aborting with <c>0x40000015</c> (STATUS_FATAL_APP_EXIT)
    ///    ~28 times across 14 days of the Application event log — always in short concurrent bursts,
    ///    i.e. a transient contention crash of an ancient binary, not a deterministic argument bug.
    ///    (gh.exe is current, 2.96.0, and never faulted; the "gh.exe 0xc0000142" dialog text in the
    ///    issue was a misattribution — no <c>0xc0000142</c> event exists in the log at all.) For a
    ///    transient crash, a couple of short-delayed retries is the correct resilience, so a spawn
    ///    that hits a crash-class exit code (<see cref="IsCrashExitCode"/>) or a spawn failure is
    ///    retried a few times before honestly giving up. A legitimate non-zero git/gh exit
    ///    (1, 128, …) is NOT retried — that is a real answer, not a crash.
    ///
    /// 3. <b>Bounded concurrency.</b> The crashes cluster because many spawns fire in the first
    ///    second of startup (DoneBookendVerifier alone shells 2-3 git processes per blocked queue
    ///    item, and this machine also runs many concurrent Claude sessions each spawning their own
    ///    git). BuildConsole cannot control the other processes, but it can stop firing its own in a
    ///    tight simultaneous cluster: every spawn passes through a small <see cref="SemaphoreSlim"/>
    ///    so at most <see cref="MaxConcurrent"/> of BuildConsole's own git/gh children run at once —
    ///    staggering the burst the evidence correlates with the crashes.
    ///
    /// Updating the ancient git binary itself is the real environmental fix and is out of an agent's
    /// reach (an admin installer); that is filed/surfaced to Shane separately. This class makes
    /// BuildConsole resilient to and honest about the crash in the meantime.
    /// </summary>
    public static class SubprocessRunner
    {
        public const string Channel = "subprocess";

        /// <summary>At most this many of BuildConsole's own git/gh children run concurrently. Small
        /// enough to flatten the startup burst the crash evidence correlates with, large enough that
        /// independent startup probes still overlap rather than fully serializing.</summary>
        private const int MaxConcurrent = 4;
        private static readonly SemaphoreSlim Gate = new(MaxConcurrent, MaxConcurrent);

        /// <summary>Total launch attempts for a crash-class/spawn failure (1 initial + retries).</summary>
        private const int MaxAttempts = 3;
        /// <summary>Backoff before retry N (short — these are transient contention crashes that
        /// "sometimes clear on retry"). Index 0 is the delay after the 1st attempt, etc.</summary>
        private static readonly int[] BackoffMs = { 150, 400 };

        /// <summary>Default hard cap on a single attempt before it is killed and reported as a
        /// timeout (not a crash — a hang is not retried, and would otherwise starve the gate).</summary>
        private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(30);

        /// <summary>
        /// True if <paramref name="exitCode"/> is an abnormal-termination NTSTATUS rather than a
        /// normal small git/gh exit code. Covers the real, evidenced code
        /// <c>0x40000015</c> STATUS_FATAL_APP_EXIT (abort/CRT-fatal), plus any error-severity
        /// NTSTATUS (top two bits set → <c>0xC0000000</c>+), which includes <c>0xC0000142</c>
        /// STATUS_DLL_INIT_FAILED (the code named in the issue dialog), <c>0xC0000005</c>
        /// STATUS_ACCESS_VIOLATION and <c>0xC000013A</c> STATUS_CONTROL_C_EXIT. git/gh never return
        /// a code in that range as a legitimate result (their real codes are small: 0, 1, 2, 128…),
        /// so this only ever fires on a genuine crash.
        /// </summary>
        public static bool IsCrashExitCode(int exitCode)
        {
            if (exitCode == 0) return false;
            uint u = unchecked((uint)exitCode);
            if (u == 0x40000015u) return true;                 // STATUS_FATAL_APP_EXIT (the real #2539 crash)
            if ((u & 0xC0000000u) == 0xC0000000u) return true; // any error-severity NTSTATUS (0xC0000142/0005/013A…)
            return false;
        }

        // ── public entry points ─────────────────────────────────────────────────

        /// <summary>Run <paramref name="fileName"/> with a single pre-joined <paramref name="arguments"/>
        /// string. Prefer the <see cref="IEnumerable{T}"/> overload when arguments contain spaces/quotes.</summary>
        public static Task<SubprocessResult> RunAsync(string fileName, string arguments,
            string? workingDirectory = null, TimeSpan? timeout = null, string logChannel = Channel)
        {
            return RunCoreAsync(fileName, arguments, null, workingDirectory, timeout, logChannel);
        }

        /// <summary>Run <paramref name="fileName"/> with an argument list (each element passed verbatim,
        /// no shell quoting pitfalls) — matches the <c>ProcessStartInfo.ArgumentList</c> call sites.</summary>
        public static Task<SubprocessResult> RunAsync(string fileName, IEnumerable<string> argumentList,
            string? workingDirectory = null, TimeSpan? timeout = null, string logChannel = Channel)
        {
            return RunCoreAsync(fileName, null, argumentList, workingDirectory, timeout, logChannel);
        }

        /// <summary>Synchronous wrapper for the many callers that already run on a background
        /// <c>Task.Run</c> thread (VersionInfo, LocalDeployStatusService, StartupConnectivityService's
        /// git probe). Safe to block here because the core uses <c>ConfigureAwait(false)</c>
        /// throughout — there is no captured UI context to deadlock on. Do NOT call from the UI thread.</summary>
        public static SubprocessResult Run(string fileName, string arguments,
            string? workingDirectory = null, TimeSpan? timeout = null, string logChannel = Channel)
        {
            return RunCoreAsync(fileName, arguments, null, workingDirectory, timeout, logChannel)
                .ConfigureAwait(false).GetAwaiter().GetResult();
        }

        // ── core ────────────────────────────────────────────────────────────────

        private static async Task<SubprocessResult> RunCoreAsync(
            string fileName, string? arguments, IEnumerable<string>? argumentList,
            string? workingDirectory, TimeSpan? timeout, string channel)
        {
            var effectiveTimeout = timeout ?? DefaultTimeout;
            string display = fileName + (arguments != null ? " " + arguments : "");

            await Gate.WaitAsync().ConfigureAwait(false);
            try
            {
                string? lastLaunchError = null;
                int lastExit = -1;
                string lastOut = "", lastErr = "";

                for (int attempt = 1; attempt <= MaxAttempts; attempt++)
                {
                    bool crashed = false;
                    Process? proc = null;
                    try
                    {
                        var psi = new ProcessStartInfo
                        {
                            FileName = fileName,
                            RedirectStandardOutput = true,
                            RedirectStandardError = true,
                            UseShellExecute = false,
                            CreateNoWindow = true,
                        };
                        if (!string.IsNullOrEmpty(workingDirectory)) psi.WorkingDirectory = workingDirectory;
                        if (arguments != null) psi.Arguments = arguments;
                        if (argumentList != null) foreach (var a in argumentList) psi.ArgumentList.Add(a);

                        proc = new Process { StartInfo = psi };
                        if (!proc.Start())
                        {
                            lastLaunchError = "process failed to start (Process.Start returned false)";
                        }
                        else
                        {
                            // Drain both streams concurrently while we wait, so neither a full
                            // stdout nor a full stderr pipe can wedge the wait.
                            var outTask = proc.StandardOutput.ReadToEndAsync();
                            var errTask = proc.StandardError.ReadToEndAsync();

                            using var cts = new CancellationTokenSource(effectiveTimeout);
                            bool exited = true;
                            try { await proc.WaitForExitAsync(cts.Token).ConfigureAwait(false); }
                            catch (OperationCanceledException) { exited = false; }

                            if (!exited)
                            {
                                try { proc.Kill(true); } catch { /* already gone */ }
                                // Don't leave the reads unobserved once the pipes close post-kill.
                                _ = outTask.ContinueWith(t => { _ = t.Exception; }, TaskScheduler.Default);
                                _ = errTask.ContinueWith(t => { _ = t.Exception; }, TaskScheduler.Default);
                                ActivityLog.Log(channel, $"`{display}` timed out after {effectiveTimeout.TotalSeconds:F0}s — killed (a hang is not retried).");
                                return new SubprocessResult(-2, "", "", $"timed out after {effectiveTimeout.TotalSeconds:F0}s", false, attempt);
                            }

                            lastOut = await outTask.ConfigureAwait(false);
                            lastErr = await errTask.ConfigureAwait(false);
                            lastExit = proc.ExitCode;
                            lastLaunchError = null;

                            if (!IsCrashExitCode(lastExit))
                            {
                                // Normal completion: 0, or a legitimate non-zero git/gh answer.
                                // Either way it's a real result — return it, no retry.
                                return new SubprocessResult(lastExit, lastOut, lastErr, null, false, attempt);
                            }
                            crashed = true;
                        }
                    }
                    catch (Exception ex)
                    {
                        // Win32 spawn failure (binary not startable) — some 0xc0000142-class
                        // failures surface here rather than as a running-then-dead child.
                        lastLaunchError = ex.Message;
                    }
                    finally
                    {
                        proc?.Dispose();
                    }

                    bool retryable = lastLaunchError != null || crashed;
                    if (retryable && attempt < MaxAttempts)
                    {
                        int delay = BackoffMs[Math.Min(attempt - 1, BackoffMs.Length - 1)];
                        string why = crashed
                            ? $"crashed (exit 0x{unchecked((uint)lastExit):X8})"
                            : $"failed to launch: {lastLaunchError}";
                        ActivityLog.Log(channel, $"`{display}` {why} — retry {attempt}/{MaxAttempts - 1} in {delay}ms.");
                        try { await Task.Delay(delay).ConfigureAwait(false); } catch { }
                        continue;
                    }
                    break; // out of attempts, or a non-retryable result already returned above
                }

                // Exhausted all attempts.
                if (lastLaunchError != null)
                {
                    ActivityLog.Log(channel, $"`{display}` could not run after {MaxAttempts} attempts: {lastLaunchError}");
                    return new SubprocessResult(-1, lastOut, lastErr, lastLaunchError, false, MaxAttempts);
                }
                ActivityLog.Log(channel, $"`{display}` kept crashing (exit 0x{unchecked((uint)lastExit):X8}) through {MaxAttempts} attempts — giving up honestly.");
                return new SubprocessResult(lastExit, lastOut, lastErr, null, true, MaxAttempts);
            }
            finally
            {
                Gate.Release();
            }
        }
    }
}
