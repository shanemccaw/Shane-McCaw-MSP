using System;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real implementation of #3459's hosted PowerShell console: a single persistent
/// <see cref="Runspace"/> opened once against <see cref="HostedConsolePSHost"/>, reused for
/// every command (so imported modules / connected Graph & Az contexts / local variables persist
/// between commands, the same way a real interactive console session behaves), executed one at a
/// time via <see cref="ExecuteAsync"/>.
/// </summary>
public sealed class PowerShellConsoleService : IPowerShellConsoleService
{
    private readonly HostedConsolePSHost _host;
    private readonly Runspace _runspace;
    private readonly SemaphoreSlim _executionLock = new(1, 1);
    private bool _disposed;

    public event EventHandler<ConsoleExecutionRecord>? CommandExecuted;
    public event Action<string>? HostOutputReceived;

    public bool IsBusy { get; private set; }

    public PowerShellConsoleService()
    {
        _host = new HostedConsolePSHost();
        _host.LineWritten += line => HostOutputReceived?.Invoke(line);

        var iss = InitialSessionState.CreateDefault();
        _runspace = RunspaceFactory.CreateRunspace(_host, iss);
        _runspace.Open();
    }

    public async Task<ConsoleExecutionRecord> ExecuteAsync(string command, Tenant? tenant, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(command))
            throw new ArgumentException("Command must not be empty.", nameof(command));

        await _executionLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        var record = new ConsoleExecutionRecord
        {
            Command = command,
            TenantId = tenant?.Id ?? string.Empty,
            TenantName = tenant?.Name ?? string.Empty,
            TenantGuid = tenant?.TenantGuid ?? string.Empty,
            StartedAtUtc = DateTimeOffset.UtcNow,
        };
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            IsBusy = true;
            using var ps = System.Management.Automation.PowerShell.Create();
            ps.Runspace = _runspace;
            ps.AddScript(command);

            var errorBuilder = new StringBuilder();
            var outputBuilder = new StringBuilder();

            ps.Streams.Error.DataAdded += (sender, e) =>
            {
                if (sender is PSDataCollection<ErrorRecord> errors && e.Index < errors.Count)
                    errorBuilder.AppendLine(errors[e.Index].ToString());
            };
            ps.Streams.Warning.DataAdded += (sender, e) =>
            {
                if (sender is PSDataCollection<WarningRecord> warnings && e.Index < warnings.Count)
                    outputBuilder.AppendLine("WARNING: " + warnings[e.Index].Message);
            };

            var results = await Task.Factory.StartNew(
                () => ps.Invoke(),
                cancellationToken,
                TaskCreationOptions.LongRunning,
                TaskScheduler.Default).ConfigureAwait(false);

            foreach (var item in results)
            {
                if (item != null)
                    outputBuilder.AppendLine(item.ToString());
            }

            record.Output = outputBuilder.ToString().TrimEnd();
            record.ErrorOutput = errorBuilder.ToString().TrimEnd();
            record.Succeeded = !ps.HadErrors;
        }
        catch (Exception ex)
        {
            record.ErrorOutput = ex.Message;
            record.Succeeded = false;
        }
        finally
        {
            sw.Stop();
            record.DurationMs = sw.ElapsedMilliseconds;
            IsBusy = false;
            _executionLock.Release();
        }

        CommandExecuted?.Invoke(this, record);
        return record;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _runspace.Close(); } catch { /* best-effort shutdown */ }
        _runspace.Dispose();
        _executionLock.Dispose();
    }
}
