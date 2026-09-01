# Small dialog helper for deploy-shanesbuild.cmd, split into its own file so
# the .cmd never has to inline PowerShell in a batch %VAR% string (quoting/
# escaping across cmd -> powershell -Command is fragile; -File with real
# parameters is not).
#
# Usage:
#   deploy-shanesbuild-notify.ps1 -Title "..." -Message "..."          # OK-only, exit 0
#   deploy-shanesbuild-notify.ps1 -Title "..." -Message "..." -YesNo   # exit 0 = Yes, 1 = No
param(
    [Parameter(Mandatory = $true)][string]$Message,
    [string]$Title = "ShanesBuild Deploy",
    [switch]$YesNo
)

Add-Type -AssemblyName System.Windows.Forms | Out-Null

if ($YesNo) {
    $result = [System.Windows.Forms.MessageBox]::Show(
        $Message, $Title,
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($result -eq [System.Windows.Forms.DialogResult]::Yes) { exit 0 } else { exit 1 }
}
else {
    [System.Windows.Forms.MessageBox]::Show(
        $Message, $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 0
}
