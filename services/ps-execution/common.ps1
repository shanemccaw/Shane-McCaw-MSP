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

# Invoke-CmdletWithWallClockTimeout — #1852: run ONE cmdlet by name against an
# isolated background Runspace with a real wall-clock ceiling, so a single
# hanging cmdlet can be abandoned WITHOUT the calling code itself ever
# blocking past $TimeoutSeconds. Built for survey.ps1's per-cmdlet probe loop
# (a single child-worker.ps1 process runs many cmdlets in one request there),
# but deliberately generic — it takes a bare command name/params/timeout, not
# anything survey-specific.
#
# THE PROBLEM THIS SOLVES: none of the cmdlets probed here expose their own
# -Timeout/-TimeoutSeconds parameter, and PowerShell has no built-in way for a
# thread to abort a call it is itself synchronously blocked inside. A second,
# independent Runspace running the SAME command asynchronously (BeginInvoke)
# lets the calling thread poll with a real wall-clock wait and, on timeout,
# ask that other pipeline to stop WITHOUT waiting for it — see the BeginStop
# comment below for why that half is load-bearing.
#
# WHY THE ISOLATED RUNSPACE CAN STILL SEE THE LIVE APP-ONLY SESSION: this is
# NOT a fresh, disconnected PowerShell process — it is a second Runspace in
# THIS SAME child-worker.ps1 process, after Connect-ExchangeOnline /
# Connect-IPPSSession / Connect-MicrosoftTeams has already run on the primary
# Runspace. Both implicit-remoting proxy functions (the dynamically generated
# tmpEXO_* module Connect-ExchangeOnline/Connect-IPPSSession create) and
# MicrosoftTeams' own connection state resolve PROCESS-WIDE, not per-Runspace:
# a PSSession lives in the process-global RunspaceRepository (what
# `Get-PSSession` reads), and MicrosoftTeams is a binary module whose
# connection/token state is static CLR state shared by every Runspace in the
# process. Importing the SAME already-loaded module (by name — it is already
# resident in this process, never a fresh install or a second Connect-* round
# trip) into the second Runspace gives it the SAME live session for free.
function Invoke-CmdletWithWallClockTimeout {
    param(
        [string]$CommandName,
        [hashtable]$Parameters = @{},
        [string[]]$ModuleNames = @(),
        [int]$TimeoutSeconds
    )

    $runspace = [runspacefactory]::CreateRunspace()
    $runspace.Open()
    $ps = [powershell]::Create()
    $ps.Runspace = $runspace

    try {
        foreach ($moduleName in $ModuleNames) {
            $importPs = [powershell]::Create()
            try {
                $importPs.Runspace = $runspace
                [void]$importPs.AddCommand("Import-Module").AddParameter("Name", $moduleName).AddParameter("ErrorAction", "Stop")
                $importPs.Invoke() | Out-Null
                if ($importPs.HadErrors) {
                    $errText = ($importPs.Streams.Error | ForEach-Object { $_.ToString() }) -join "; "
                    throw "failed to import module '$moduleName' into the isolated timeout runspace: $errText"
                }
            }
            finally { $importPs.Dispose() }
        }
    }
    catch {
        # Setup failed (module import) before any command ever started —
        # nothing is running yet, so it is safe to tear everything down
        # synchronously right here rather than via the abandon-on-timeout
        # path below.
        try { $runspace.Close() } catch {}
        try { $runspace.Dispose() } catch {}
        try { $ps.Dispose() } catch {}
        throw
    }

    [void]$ps.AddCommand($CommandName)
    foreach ($key in $Parameters.Keys) { [void]$ps.AddParameter($key, $Parameters[$key]) }

    $asyncResult = $ps.BeginInvoke()
    $completed = $asyncResult.AsyncWaitHandle.WaitOne([TimeSpan]::FromSeconds($TimeoutSeconds))

    if (-not $completed) {
        # BeginStop, not Stop: Stop() blocks the CALLING thread until the
        # pipeline actually finishes stopping, which for a genuinely wedged
        # remote call (the exact failure this guard exists for — see
        # Get-ScopeEntities in Git #1852) could itself hang indefinitely,
        # reintroducing the very problem the timeout was meant to prevent.
        # BeginStop only REQUESTS the stop and returns immediately, so this
        # function can never block past $TimeoutSeconds regardless of
        # whether the abandoned pipeline ever actually finishes stopping.
        #
        # The abandoned $ps/$runspace are deliberately never disposed on this
        # path — disposing an instance that may still be mid-stop risks
        # blocking on the same wedge. They are reclaimed when this
        # short-lived child process exits shortly after the batch completes.
        try { [void]$ps.BeginStop($null, $null) } catch {}
        return @{ TimedOut = $true; Result = $null; ErrorRecord = $null }
    }

    try {
        $result = $ps.EndInvoke($asyncResult)
        $errorRecord = if ($ps.HadErrors -and $ps.Streams.Error.Count -gt 0) { $ps.Streams.Error[0] } else { $null }
        return @{ TimedOut = $false; Result = $result; ErrorRecord = $errorRecord }
    }
    catch {
        # EndInvoke() is a plain .NET method call from script, so PowerShell
        # wraps whatever the pipeline actually threw in a
        # MethodInvocationException ("Exception calling "EndInvoke"...") —
        # unwrap to .InnerException (the real underlying exception: a
        # RuntimeException/CommandNotFoundException/etc — confirmed by a live
        # throwaway test this session ran before this fix) so callers see the
        # cmdlet's real exception type/message, not the wrapper's, matching
        # what a caught `& $Cmdlet` exception looks like on the unguarded path.
        $realException = if ($_.Exception.InnerException) { $_.Exception.InnerException } else { $_.Exception }
        $errorRecord = New-Object System.Management.Automation.ErrorRecord($realException, "CmdletInvocationFailed", [System.Management.Automation.ErrorCategory]::NotSpecified, $null)
        return @{ TimedOut = $false; Result = $null; ErrorRecord = $errorRecord }
    }
    finally {
        try { $runspace.Close() } catch {}
        try { $runspace.Dispose() } catch {}
        try { $ps.Dispose() } catch {}
    }
}
