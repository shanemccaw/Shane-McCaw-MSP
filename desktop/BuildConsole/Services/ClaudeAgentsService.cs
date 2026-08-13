using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>Git #831 — matches `claude agents --json`'s real row shape (confirmed via a live run).</summary>
    public class ClaudeAgentSession
    {
        public int Pid { get; set; }
        public string Cwd { get; set; } = "";
        /// <summary>"interactive" | "background"</summary>
        public string Kind { get; set; } = "";
        /// <summary>Unix epoch milliseconds.</summary>
        [JsonPropertyName("startedAt")]
        public long StartedAtMs { get; set; }
        public string SessionId { get; set; } = "";
        public string Name { get; set; } = "";

        public DateTime StartedAt => DateTimeOffset.FromUnixTimeMilliseconds(StartedAtMs).LocalDateTime;
    }

    /// <summary>
    /// Git #831 — Shane: "the right panel needs to have an All In session...
    /// like you are not in the queue, but you are running, and I should see
    /// the things you are working on but I cannot." A live interactive
    /// Claude Code session (like the one Shane is talking to right now) is
    /// NOT a queue row - it never goes through bt_build_queue at all, so
    /// nothing in the Build Queue panel could ever show it. `claude agents
    /// --json` is a real, documented, scriptable command (confirmed via a
    /// live run) that lists every active session on this machine -
    /// interactive and background both - with no TTY required. This shells
    /// out to it directly; there's no server round-trip since this is
    /// purely local machine state, not anything bt_build_queue tracks.
    /// </summary>
    public static class ClaudeAgentsService
    {
        private static readonly string ClaudeExe = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin", "claude.exe");

        /// <summary>
        /// Git #957 — Shane: "I think this is what Session is for? But it's
        /// always empty. So maybe a bug is there?" Found a real one: this
        /// redirected BOTH stdout and stderr but only ever read stdout, and
        /// only AFTER starting the process — a textbook .NET Process
        /// deadlock. If `claude agents --json` ever writes enough to stderr
        /// to fill the OS pipe buffer (a few KB — an update-check notice, a
        /// deprecation warning, anything), the child process blocks trying
        /// to write more while this call sits blocked in `ReadToEndAsync()`
        /// on stdout, waiting for a process that's waiting right back on it
        /// — neither side ever finishes, so this call just hangs forever on
        /// whichever poll tick hit it. That reads as "Sessions is always
        /// empty," not as an error, since nothing ever throws either. Now
        /// reads both streams concurrently (never sequentially) so neither
        /// pipe can ever fill up and block the other, and logs the exit
        /// code/stderr/parse failure on every non-empty failure path
        /// instead of swallowing it silently, so a future failure is
        /// actually diagnosable from the Activity Log instead of just
        /// looking like "nothing running."
        /// </summary>
        public static async Task<List<ClaudeAgentSession>> ListActiveSessionsAsync()
        {
            if (!File.Exists(ClaudeExe)) return new List<ClaudeAgentSession>();

            var psi = new ProcessStartInfo
            {
                FileName = ClaudeExe,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("agents");
            psi.ArgumentList.Add("--json");

            using var proc = new Process { StartInfo = psi };
            proc.Start();
            var stdoutTask = proc.StandardOutput.ReadToEndAsync();
            var stderrTask = proc.StandardError.ReadToEndAsync();
            await Task.WhenAll(stdoutTask, stderrTask);
            await proc.WaitForExitAsync();
            string stdout = stdoutTask.Result;
            string stderr = stderrTask.Result;

            if (proc.ExitCode != 0 || string.IsNullOrWhiteSpace(stdout))
            {
                ActivityLog.Log("sessions", $"claude agents --json exit {proc.ExitCode}"
                    + (string.IsNullOrWhiteSpace(stderr) ? "" : $": {stderr.Trim()}"));
                return new List<ClaudeAgentSession>();
            }

            try
            {
                var sessions = System.Text.Json.JsonSerializer.Deserialize<List<ClaudeAgentSession>>(
                    stdout, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return sessions ?? new List<ClaudeAgentSession>();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("sessions", $"claude agents --json parse failed: {ex.Message}");
                return new List<ClaudeAgentSession>();
            }
        }
    }
}
