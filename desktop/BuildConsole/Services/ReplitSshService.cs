using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    public sealed class SshCommandResult
    {
        public bool Success => ExitCode == 0;
        public int ExitCode { get; set; } = -1;
        public string Output { get; set; } = "";
        public string Error { get; set; } = "";
        public long DurationMs { get; set; }
    }

    /// <summary>
    /// Direct SSH service for executing commands, deployments (git pull + build),
    /// and SQL queries directly on Replit without routing through custom HTTP Express endpoints.
    /// </summary>
    public sealed class ReplitSshService
    {
        private static readonly Lazy<ReplitSshService> _instance = new(() => new ReplitSshService());
        public static ReplitSshService Instance => _instance.Value;

        private const string LogChannel = "replit.ssh";

        private string? _cachedSshPath;

        public bool IsConfigured
        {
            get
            {
                var s = BuildConsoleSettings.Load();
                return !string.IsNullOrWhiteSpace(s.SshHost) &&
                       !string.IsNullOrWhiteSpace(s.SshKeyPath) &&
                       File.Exists(s.SshKeyPath);
            }
        }

        private string FindSshExe()
        {
            if (_cachedSshPath != null && File.Exists(_cachedSshPath))
                return _cachedSshPath;

            var defaultWinSsh = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "OpenSSH", "ssh.exe");
            if (File.Exists(defaultWinSsh))
            {
                _cachedSshPath = defaultWinSsh;
                return defaultWinSsh;
            }

            _cachedSshPath = "ssh.exe";
            return _cachedSshPath;
        }

        /// <summary>
        /// Executes an arbitrary shell command on the remote Replit host over SSH, streaming output in real-time.
        /// </summary>
        public async Task<SshCommandResult> ExecuteCommandAsync(
            string command,
            Action<string>? onOutput = null,
            int timeoutSeconds = 120)
        {
            var s = BuildConsoleSettings.Load();
            var result = new SshCommandResult();

            if (!IsConfigured)
            {
                var err = "SSH is not configured or key file does not exist. Check Settings -> SSH & Remote.";
                ActivityLog.Log(LogChannel, err);
                ShaneAppStreamService.Instance.AppendLine($"[SSH ERROR] {err}", ShaneAppLogLevel.Error);
                result.Error = err;
                return result;
            }

            var sshExe = FindSshExe();
            var target = s.SshHost.Trim();
            if (!string.IsNullOrWhiteSpace(s.SshUser) && !target.Contains('@'))
            {
                target = $"{s.SshUser.Trim()}@{target}";
            }
            int port = s.SshPort > 0 ? s.SshPort : 22;
            var escapedCmd = command.Replace("\"", "\\\"");

            // Build OpenSSH arguments (-n redirects stdin from null, -T disables tty allocation)
            var args = $"-i \"{s.SshKeyPath}\" -p {port} -n -T -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes {target} \"{escapedCmd}\"";

            ActivityLog.Log(LogChannel, $"Executing over SSH ({target}): {command}");
            ShaneAppStreamService.Instance.AppendLine($"[SSH] > {command}", ShaneAppLogLevel.Info);

            var sw = Stopwatch.StartNew();
            var outSb = new StringBuilder();
            var errSb = new StringBuilder();

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = sshExe,
                    Arguments = args,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var proc = new Process { StartInfo = psi };
                proc.OutputDataReceived += (sender, e) =>
                {
                    if (e.Data != null)
                    {
                        lock (outSb) { outSb.AppendLine(e.Data); }
                        onOutput?.Invoke(e.Data);
                        ShaneAppStreamService.Instance.AppendLine(e.Data, ShaneAppLogLevel.Info);
                    }
                };
                proc.ErrorDataReceived += (sender, e) =>
                {
                    if (e.Data != null)
                    {
                        lock (errSb) { errSb.AppendLine(e.Data); }
                        onOutput?.Invoke(e.Data);
                        ShaneAppStreamService.Instance.AppendLine(e.Data, ShaneAppLogLevel.Warning);
                    }
                };

                proc.Start();
                try { proc.StandardInput.Close(); } catch { }
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();

                var exited = await Task.Run(() => proc.WaitForExit(timeoutSeconds * 1000));
                sw.Stop();
                result.DurationMs = sw.ElapsedMilliseconds;

                if (!exited)
                {
                    try { proc.Kill(); } catch { }
                    result.ExitCode = -1;
                    result.Error = $"SSH command timed out after {timeoutSeconds}s.";
                    ActivityLog.Log(LogChannel, result.Error);
                    ShaneAppStreamService.Instance.AppendLine($"[SSH TIMEOUT] {result.Error}", ShaneAppLogLevel.Error);
                    return result;
                }

                result.ExitCode = proc.ExitCode;
                result.Output = CleanSshText(outSb.ToString());
                result.Error = CleanSshText(errSb.ToString());

                if (result.Success)
                {
                    ActivityLog.Log(LogChannel, $"SSH command succeeded in {sw.ElapsedMilliseconds}ms (exit code 0).");
                }
                else
                {
                    ActivityLog.Log(LogChannel, $"SSH command failed with exit code {result.ExitCode}: {result.Error}");
                }
            }
            catch (Exception ex)
            {
                sw.Stop();
                result.DurationMs = sw.ElapsedMilliseconds;
                result.ExitCode = -1;
                result.Error = ex.Message;
                ActivityLog.Log(LogChannel, $"SSH execution exception: {ex.Message}");
                ShaneAppStreamService.Instance.AppendLine($"[SSH EXCEPTION] {ex.Message}", ShaneAppLogLevel.Error);
            }

            return result;
        }

        private static string CleanSshText(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return "";
            var lines = text.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
            var clean = System.Linq.Enumerable.Where(lines, l =>
                !l.Contains("Welcome to the Replit SSH Proxy", StringComparison.OrdinalIgnoreCase) &&
                !l.Contains("docs.replit.com/replit-workspace/ssh", StringComparison.OrdinalIgnoreCase) &&
                !l.StartsWith("From github.com", StringComparison.OrdinalIgnoreCase) &&
                !l.Contains("* branch", StringComparison.OrdinalIgnoreCase) &&
                !l.Contains("-> FETCH_HEAD", StringComparison.OrdinalIgnoreCase)
            );
            return string.Join("\n", clean).Trim();
        }

        /// <summary>
        /// Triggers a live deployment on Replit: pulls latest main into the remote workspace.
        /// </summary>
        public async Task<SshCommandResult> DeployAsync(Action<string>? onOutput = null)
        {
            var s = BuildConsoleSettings.Load();
            var dir = string.IsNullOrWhiteSpace(s.SshRemoteDir) ? "/home/runner/workspace" : s.SshRemoteDir;

            var deployScript = $"git config --global --add safe.directory '*' 2>/dev/null || true; cd {dir} && ( rm -f .git/index.lock 2>/dev/null || true ) && ( git pull --ff-only origin main || ( git fetch origin main && git reset --hard origin/main ) )";
            ActivityLog.Log(LogChannel, $"Triggering SSH deploy in {dir}…");
            ShaneAppStreamService.Instance.BeginRun("SSH Deploy", $"Target: {dir}");

            var result = await ExecuteCommandAsync(deployScript, onOutput, timeoutSeconds: 180);
            if (!result.Success && string.IsNullOrWhiteSpace(result.Error) && !string.IsNullOrWhiteSpace(result.Output))
            {
                result.Error = result.Output;
            }
            ShaneAppStreamService.Instance.EndRun(result.Success, result.Success ? "Deploy pull successful" : $"Deploy pull failed (exit code {result.ExitCode}) {result.Error}".Trim());
            return result;
        }

        /// <summary>
        /// Triggers a deferred restart of the remote Replit container via PID 1 signal.
        /// </summary>
        public async Task<SshCommandResult> RestartServerAsync(Action<string>? onOutput = null)
        {
            var s = BuildConsoleSettings.Load();
            var dir = string.IsNullOrWhiteSpace(s.SshRemoteDir) ? "/home/runner/workspace" : s.SshRemoteDir;
            var restartScript = $"cd {dir} && ( sleep 2; kill 1 ) >/dev/null 2>&1 & echo 'restart scheduled'";
            return await ExecuteCommandAsync(restartScript, onOutput, timeoutSeconds: 15);
        }

        /// <summary>
        /// Queries the current git commit hash on the remote Replit workspace.
        /// </summary>
        public async Task<string?> GetRemoteCommitHashAsync()
        {
            var s = BuildConsoleSettings.Load();
            var dir = string.IsNullOrWhiteSpace(s.SshRemoteDir) ? "/home/runner/workspace" : s.SshRemoteDir;

            var res = await ExecuteCommandAsync($"git -C {dir} rev-parse HEAD", timeoutSeconds: 15);
            if (res.Success && !string.IsNullOrWhiteSpace(res.Output))
            {
                var lines = res.Output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                foreach (var line in lines)
                {
                    var trimmed = line.Trim();
                    if (System.Text.RegularExpressions.Regex.IsMatch(trimmed, @"^[0-9a-fA-F]{7,40}$"))
                    {
                        return trimmed;
                    }
                }
            }
            return null;
        }

        /// <summary>
        /// Runs scripts/src/manual-migration-status.ts on the remote Replit workspace, against
        /// whatever DATABASE_URL that process's own environment (Staging's Replit Secret) points
        /// at. Returns the raw JSON stdout — see manual-migration-status.ts for the shape
        /// ({ ok, totalFiles, appliedCount, pendingCount, pending: string[] }). Used by
        /// StagingDeployDialog (Git #1199) so Shane sees the real, current set of manual
        /// migration files that have landed on Dev but not yet run on Staging, instead of relying
        /// on memory or a hand-maintained list that goes stale.
        /// </summary>
        public async Task<SshCommandResult> GetPendingManualMigrationsAsync()
        {
            var s = BuildConsoleSettings.Load();
            var dir = string.IsNullOrWhiteSpace(s.SshRemoteDir) ? "/home/runner/workspace" : s.SshRemoteDir;
            var cmd = $"cd {dir} && (node scripts/dist/manual-migration-status.js 2>/dev/null || npx --yes tsx scripts/src/manual-migration-status.ts)";
            return await ExecuteCommandAsync(cmd, timeoutSeconds: 30);
        }

        /// <summary>
        /// Tests the SSH connection and measures latency.
        /// </summary>
        public async Task<(bool Success, string Message, long LatencyMs)> TestConnectionAsync()
        {
            var sw = Stopwatch.StartNew();
            var res = await ExecuteCommandAsync("echo SSH_CONNECTED_OK && uname -a", timeoutSeconds: 15);
            sw.Stop();

            if (res.Success && res.Output.Contains("SSH_CONNECTED_OK"))
            {
                return (true, $"SSH Connected successfully! ({sw.ElapsedMilliseconds}ms)\n{res.Output}", sw.ElapsedMilliseconds);
            }

            var errMsg = !string.IsNullOrWhiteSpace(res.Error) ? res.Error : res.Output;
            if (string.IsNullOrWhiteSpace(errMsg)) errMsg = "Connection timed out or failed with no output.";
            return (false, $"SSH Connection failed: {errMsg}", sw.ElapsedMilliseconds);
        }
    }
}
