# common.ps1 — dot-sourced by both entrypoint.ps1 (the long-lived parent
# dispatcher) and child-worker.ps1 (the fresh-per-request child, #1400).
#
# Write-Log's target stream differs by which process calls it: the parent's
# own stdout IS the container's log stream Azure captures directly, but a
# child process's stdout is reserved exclusively for its one-line JSON
# result envelope (child-worker.ps1's own contract with the parent) — a
# stray log line on that stream would corrupt the parent's ConvertFrom-Json
# parse of the child's output. Each entrypoint sets $script:PsExecutionLogStream
# before dot-sourcing this file: the parent leaves it unset (default "Out"),
# child-worker.ps1 sets it to "Error" so its log entries land on stderr,
# which the parent explicitly relays line-for-line onto its own stdout (see
# entrypoint.ps1's Invoke-ChildRequest) so nothing is lost from the
# container's log stream.
function Write-Log {
    param(
        [string]$Level,
        [string]$Message,
        [hashtable]$Extra = @{},
        # Defaults to this service's own operational channel. Write-cmdlet
        # audit entries (see the CmdletCatalog's IsWrite handling in
        # child-worker.ps1) pass "audit" instead — CLAUDE.md's locked
        # channel taxonomy reserves "audit" platform-wide for exactly this
        # kind of action record, and it's a distinct channel (not just a
        # distinct message) so it can be filtered/shipped independently of
        # routine request-handling noise.
        [string]$Channel = "integration.ps-execution"
    )
    $entry = @{
        channel   = $Channel
        level     = $Level
        message   = $Message
        timestamp = [DateTimeOffset]::UtcNow.ToString("o")
    }
    foreach ($key in $Extra.Keys) { $entry[$key] = $Extra[$key] }
    $json = ($entry | ConvertTo-Json -Compress)
    if ($script:PsExecutionLogStream -eq "Error") {
        [Console]::Error.WriteLine($json)
    }
    else {
        # [Console]::WriteLine, not Write-Output: this still lands in the
        # container's stdout stream (Azure's log capture reads stdout), but
        # does NOT enter PowerShell's success output pipeline — Write-Output
        # here got silently captured as part of a caller's return value
        # whenever Write-Log was invoked inside a function whose result the
        # caller assigned (#207, caused by #206's diagnostic logging addition).
        [Console]::WriteLine($json)
    }
}

function Get-HttpErrorResponseBody {
    param($ErrorRecord)

    # PowerShell 7's Invoke-RestMethod populates $_.ErrorDetails.Message with
    # the response body text on a non-2xx response — this is the correct
    # pwsh 7 pattern and works regardless of the underlying exception type.
    if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
        return $ErrorRecord.ErrorDetails.Message
    }

    # Fallback for cases ErrorDetails isn't populated: pwsh 7's
    # Invoke-RestMethod throws Microsoft.PowerShell.Commands.HttpResponseException,
    # whose .Response is a System.Net.Http.HttpResponseMessage — NOT the
    # System.Net.HttpWebResponse from Windows PowerShell 5.1/.NET Framework,
    # so there's no .GetResponseStream(). Read the body via
    # Content.ReadAsStringAsync() instead.
    $httpResponse = $ErrorRecord.Exception.Response
    if ($httpResponse -and $httpResponse.Content) {
        try {
            return $httpResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        }
        catch {
            return $null
        }
    }

    return $null
}

function ConvertTo-ParamHashtable {
    param($JsonParamsObject)

    $result = @{}
    if ($null -eq $JsonParamsObject) { return $result }
    foreach ($prop in $JsonParamsObject.PSObject.Properties) {
        $result[$prop.Name] = $prop.Value
    }
    return $result
}
