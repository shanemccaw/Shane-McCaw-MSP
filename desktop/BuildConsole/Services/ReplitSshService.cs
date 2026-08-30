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

        // ── Git #1828: Dev-only SSH lock ─────────────────────────────────────────
        // ReplitSshService reaches the Staging (Replit) server. Real remote access was
        // previously gated only by a UseSshForDeploy bool + IsConfigured, with NO check
        // against the app's currently-selected Target Environment — contradicting
        // TargetEnvironment.cs's own doc comment ("Agent/protocol executions (shaneapp://)
        // are hard-locked to Dev. Staging and Production are only reachable via explicit
        // manual UI actions by Shane."). The gate below (CheckRemoteAccessBlockReason,
        // enforced at the single choke point ExecuteCommandAsync) makes that real:
        //   1. Agent/protocol (shaneapp://) origin  → refused ALWAYS (structural; no UI
        //      state can unlock it). Checked first.
        //   2. Explicit manual Staging operation     → allowed (the deliberate Shane-only
        //      "Deploy to Staging" action — see AuthorizeManualStagingOperation).
        //   3. Otherwise                              → allowed only when the live Target
        //      Environment selector reads Staging (the single source of truth), else refused.
        private static readonly System.Threading.AsyncLocal<bool> _manualStagingAuthorized = new();

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

        /// <summary>
        /// Opens an EXPLICIT, human-initiated Staging-operation authorization for the duration of the
        /// returned scope (Git #1828). Used ONLY by the deliberate, Shane-only "Deploy to Staging"
        /// action (<see cref="StagingDeployService"/> and <see cref="StagingDeployDialog"/>'s pending-
        /// migration read) — an operation whose target is unambiguously Staging, independent of the
        /// Target Environment selector's current value. That button is deliberately a distinct action
        /// from the selector (see <c>LeftSidebar.DeployToStagingRequested</c>), so without this the
        /// selector-based gate would fail-close the legitimate deploy whenever the selector sat on Dev.
        ///
        /// This is NOT a duplicate of the selector: it's a transient, in-memory, per-flow authorization
        /// tied to one specific human action, and it can NEVER unlock an agent-originated call — the
        /// agent hard-lock (<see cref="ShaneAppExecutionContext.IsAgentOrigin"/>) is checked first and
        /// takes precedence, and this method refuses to open at all from an agent context.
        /// Flows across awaits (<see cref="System.Threading.AsyncLocal{T}"/>) so it covers every SSH
        /// call the deploy awaits.
        /// </summary>
        public static IDisposable AuthorizeManualStagingOperation()
        {
            if (ShaneAppExecutionContext.IsAgentOrigin)
            {
                throw new InvalidOperationException(
                    "Refusing to authorize a manual Staging SSH operation from an agent/protocol (shaneapp://) context. " +
                    "Agents are hard-locked to Dev (Git #1828).");
            }
            bool prev = _manualStagingAuthorized.Value;
            _manualStagingAuthorized.Value = true;
            return new ManualStagingAuthScope(prev);
        }

        private sealed class ManualStagingAuthScope : IDisposable
        {
            private readonly bool _prev;
            private bool _disposed;
            public ManualStagingAuthScope(bool prev) => _prev = prev;
            public void Dispose()
            {
                if (_disposed) return;
                _disposed = true;
                _manualStagingAuthorized.Value = _prev;
            }
        }

        /// <summary>
        /// Reads the app's currently-selected <see cref="TargetEnvironment"/> — the SINGLE source of
        /// truth, the live <c>ComboTargetEnvironment</c> selector surfaced by
        /// <c>LeftSidebar.GetSelectedTargetEnvironment()</c> — via the same UI-thread dispatch pattern
        /// <see cref="LocalSqlExecutor"/> uses. Falls back to the safest tier (Dev) if the UI can't be
        /// reached, so an unknown state never accidentally permits remote access.
        /// </summary>
        private static TargetEnvironment GetCurrentTargetEnvironment()
        {
            TargetEnvironment env = TargetEnvironment.Dev;
            if (System.Windows.Application.Current != null)
            {
                try
                {
                    System.Windows.Application.Current.Dispatcher.Invoke(() =>
                    {
                        if (System.Windows.Application.Current.MainWindow is MainWindow mw && mw.LeftSidebar != null)
                        {
                            env = mw.LeftSidebar.GetSelectedTargetEnvironment();
                        }
                    });
                }
                catch
                {
                    // Fall back to Dev if UI-thread dispatch fails — never fail OPEN.
                }
            }
            return env;
        }

        /// <summary>
        /// The Git #1828 gate. Returns a human-readable reason string when real SSH access is
        /// currently NOT permitted, or <c>null</c> when it is allowed. Fails CLOSED — see the field
        /// comment above for the three-way decision. Public so read-only callers (e.g.
        /// <see cref="SystemHealthService"/>'s Staging-SSH health probe) can render an honest
        /// "disabled under Dev" status instead of firing a doomed connection, using the exact same
        /// gate as the executor rather than a duplicate check.
        /// </summary>
        public string? GetRemoteAccessBlockReason() =>
            EvaluateRemoteAccess(
                ShaneAppExecutionContext.IsAgentOrigin,
                _manualStagingAuthorized.Value,
                GetCurrentTargetEnvironment());

        /// <summary>
        /// The pure Git #1828 access-policy decision, separated from the ambient reads
        /// (<see cref="ShaneAppExecutionContext.IsAgentOrigin"/>, the manual-Staging authorization scope,
        /// and the live Target Environment selector) so it can be exercised deterministically for every
        /// combination — including the Staging-allowed branch that otherwise needs a real WPF selector.
        /// Returns a human-readable reason when remote SSH access is NOT permitted, or <c>null</c> when it
        /// is. Fails CLOSED.
        /// </summary>
        public static string? EvaluateRemoteAccess(bool isAgentOrigin, bool manualStagingAuthorized, TargetEnvironment env)
        {
            // (1) Structural agent hard-lock — highest priority, no UI state or manual scope can unlock it.
            if (isAgentOrigin)
            {
                return "SSH/Replit access is hard-locked away from agent/protocol (shaneapp://) executions — " +
                       "agents are confined to Dev, and Staging/Production remote access is reachable only through " +
                       "Shane's explicit manual UI actions (Git #1828). Refusing.";
            }

            // (2) Explicit, human-initiated manual Staging operation (the "Deploy to Staging" action).
            if (manualStagingAuthorized)
            {
                return null; // allowed — the operation's target is unambiguously Staging.
            }

            // (3) Default gate: the live Target Environment selector is the single source of truth.
            if (env != TargetEnvironment.Staging)
            {
                return $"SSH/Replit access is disabled while the Target Environment is '{env}'. SSH reaches the " +
                       "Staging (Replit) server; set the Target Environment selector to Staging — or use the manual " +
                       $"\"Deploy to Staging\" action — to enable it (Git #1828). Refusing to run over SSH under '{env}'.";
            }

            return null; // Staging selected — allowed.
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

            // ── Git #1828: enforce the Dev-only SSH lock at the single choke point. Every
            // ReplitSshService method that reaches a remote host routes through here, so gating
            // ExecuteCommandAsync gates them all. Fail CLOSED with a clear message — never a silent
            // no-op, never a connection — when access isn't permitted for the current context/env.
            var blockReason = GetRemoteAccessBlockReason();
            if (blockReason != null)
            {
                ActivityLog.Log(LogChannel, $"[SSH BLOCKED] {blockReason} (command: {command})");
                ShaneAppStreamService.Instance.AppendLine($"[SSH BLOCKED] {blockReason}", ShaneAppLogLevel.Error);
                result.ExitCode = -1;
                result.Error = blockReason;
                return result;
            }

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
