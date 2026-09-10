using System;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real implementation of #3459's "auto-connect Graph/Azure modules on tenant switch" — subscribes
/// to <see cref="ITenantService.CurrentTenantChanged"/> and, for every real tenant switch, runs
/// Connect-MgGraph (required) and Connect-AzAccount (best-effort, only when Az.Accounts is
/// installed) in the shared hosted runspace, explicitly scoped via -TenantId to the tenant that
/// was just switched to.
/// </summary>
public sealed class TenantModuleConnectionService : ITenantModuleConnectionService, IDisposable
{
    private readonly ITenantService _tenantService;
    private readonly IPowerShellConsoleService _console;

    public event Action<string>? DeviceCodePromptDetected;
    public event Action<TenantModuleConnectionResult>? ConnectionCompleted;

    public TenantModuleConnectionService(ITenantService tenantService, IPowerShellConsoleService console)
    {
        _tenantService = tenantService ?? throw new ArgumentNullException(nameof(tenantService));
        _console = console ?? throw new ArgumentNullException(nameof(console));

        _console.HostOutputReceived += OnHostOutput;
        _tenantService.CurrentTenantChanged += OnTenantChanged;
    }

    private void OnHostOutput(string line)
    {
        if (LooksLikeDeviceCodePrompt(line))
            DeviceCodePromptDetected?.Invoke(line);
    }

    // Same detection shape as BuildConsole's proven PowerShellTestExecutor.LooksLikeAuthPrompt —
    // the Graph SDK's device-code instruction text is consistent across hosts.
    private static bool LooksLikeDeviceCodePrompt(string? line) =>
        !string.IsNullOrEmpty(line) &&
        (line.IndexOf("devicelogin", StringComparison.OrdinalIgnoreCase) >= 0
         || line.IndexOf("enter the code", StringComparison.OrdinalIgnoreCase) >= 0
         || line.IndexOf("to sign in", StringComparison.OrdinalIgnoreCase) >= 0);

    private async void OnTenantChanged(object? sender, Tenant? tenant)
    {
        // async void is unavoidable here — this is a top-level event handler on
        // ITenantService.CurrentTenantChanged with no caller to await it. Because an exception
        // escaping an async void handler is uncatchable and kills the whole process (#3554), the
        // ENTIRE body is guarded: not just the ConnectAsync await, but the ConnectionCompleted
        // invoke inside the catch, which can itself throw if a subscriber throws. Nothing here is
        // allowed to escape — the tenant switch that fires this must never be able to crash the app.
        try
        {
            if (tenant == null || string.IsNullOrWhiteSpace(tenant.TenantGuid)) return;
            try
            {
                await ConnectAsync(tenant).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                ConnectionCompleted?.Invoke(new TenantModuleConnectionResult
                {
                    Tenant = tenant,
                    GraphConnected = false,
                    GraphDetail = $"Auto-connect failed: {ex.Message}",
                });
            }
        }
        catch (Exception ex)
        {
            // Last line of defence — a throwing ConnectionCompleted subscriber (or any other
            // unexpected failure) is logged instead of taking the process down uncatchably.
            Infrastructure.CrashLog.Write("TenantModuleConnectionService.OnTenantChanged", ex);
        }
    }

    public async Task<TenantModuleConnectionResult> ConnectAsync(Tenant tenant)
    {
        if (tenant == null) throw new ArgumentNullException(nameof(tenant));

        // Microsoft Graph — required, delegated device-code auth (matches BuildConsole's proven
        // PowerShellTestExecutor pattern: -UseDeviceCode so a missing/expired cached token
        // surfaces as a detectable prompt via HostOutputReceived instead of hanging silently).
        var graphCmd =
            "if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) { throw 'Microsoft.Graph.Authentication module is not installed' }\n" +
            "Import-Module Microsoft.Graph.Authentication -ErrorAction Stop\n" +
            $"Connect-MgGraph -TenantId '{EscapeSingleQuotes(tenant.TenantGuid)}' -UseDeviceCode -ContextScope CurrentUser -NoWelcome -ErrorAction Stop\n" +
            "(Get-MgContext).TenantId";
        var graphResult = await _console.ExecuteAsync(graphCmd, tenant).ConfigureAwait(false);
        bool graphConnected = graphResult.Succeeded
            && graphResult.Output.Trim().Equals(tenant.TenantGuid, StringComparison.OrdinalIgnoreCase);
        string graphDetail = graphConnected
            ? $"Connected to Microsoft Graph for tenant {tenant.TenantGuid}."
            : (string.IsNullOrEmpty(graphResult.ErrorOutput)
                ? "Connect-MgGraph did not confirm the expected tenant."
                : graphResult.ErrorOutput);

        // Az — optional. Not every operator machine has Az.Accounts installed; skip cleanly
        // rather than failing the whole connect just because it's absent.
        var azProbe = await _console.ExecuteAsync("[bool](Get-Module -ListAvailable -Name Az.Accounts)", tenant).ConfigureAwait(false);
        bool azAvailable = azProbe.Succeeded && azProbe.Output.Trim().Equals("True", StringComparison.OrdinalIgnoreCase);

        bool azConnected = false;
        string azDetail;
        if (azAvailable)
        {
            var azCmd =
                "Import-Module Az.Accounts -ErrorAction Stop\n" +
                $"Connect-AzAccount -TenantId '{EscapeSingleQuotes(tenant.TenantGuid)}' -UseDeviceAuthentication -ErrorAction Stop | Out-Null\n" +
                "(Get-AzContext).Tenant.Id";
            var azResult = await _console.ExecuteAsync(azCmd, tenant).ConfigureAwait(false);
            azConnected = azResult.Succeeded && azResult.Output.Trim().Equals(tenant.TenantGuid, StringComparison.OrdinalIgnoreCase);
            azDetail = azConnected
                ? $"Connected to Az for tenant {tenant.TenantGuid}."
                : (string.IsNullOrEmpty(azResult.ErrorOutput)
                    ? "Connect-AzAccount did not confirm the expected tenant."
                    : azResult.ErrorOutput);
        }
        else
        {
            azDetail = "Az.Accounts module is not installed — skipped (Graph connection is unaffected).";
        }

        var result = new TenantModuleConnectionResult
        {
            Tenant = tenant,
            GraphConnected = graphConnected,
            GraphDetail = graphDetail,
            AzModuleAvailable = azAvailable,
            AzConnected = azConnected,
            AzDetail = azDetail,
        };
        ConnectionCompleted?.Invoke(result);
        return result;
    }

    private static string EscapeSingleQuotes(string value) => value.Replace("'", "''");

    public void Dispose()
    {
        _console.HostOutputReceived -= OnHostOutput;
        _tenantService.CurrentTenantChanged -= OnTenantChanged;
    }
}
