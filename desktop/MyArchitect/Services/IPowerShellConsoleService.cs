using System;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Hosts a real System.Management.Automation runspace in-process (#3459) — not a shelled-out
/// powershell.exe/pwsh.exe child process — and executes commands against it, one at a time,
/// capturing real stdout/error output and duration per command.
/// </summary>
public interface IPowerShellConsoleService : IDisposable
{
    /// <summary>Fires once per executed command with the real captured record — the command +
    /// duration + tenant logging hook #3459 asks for, that feeds the Activity Layer (#3463).</summary>
    event EventHandler<ConsoleExecutionRecord>? CommandExecuted;

    /// <summary>Fires for every line the hosted runspace writes through its host UI (Write-Host,
    /// Write-Warning, Write-Verbose, and critically Connect-MgGraph's device-code prompt text) —
    /// there is no real console window backing this runspace, so this is the only place that
    /// output is observable.</summary>
    event Action<string>? HostOutputReceived;

    bool IsBusy { get; }

    /// <summary>Runs <paramref name="command"/> to completion against the shared, persistent
    /// runspace (variables/imported modules persist between calls, same as a real console) and
    /// returns the real captured result. <paramref name="tenant"/> is recorded on the result for
    /// the logging hook; it does not change what the command executes against — Graph/Az module
    /// connection scoping is <see cref="ITenantModuleConnectionService"/>'s job.</summary>
    Task<ConsoleExecutionRecord> ExecuteAsync(string command, Tenant? tenant, CancellationToken cancellationToken = default);
}
