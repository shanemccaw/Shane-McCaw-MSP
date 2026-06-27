/**
 * manual-script-package.ts
 *
 * Generates a downloadable PowerShell script and a plain-text instruction
 * document for scripts that require delegated authentication and cannot run
 * unattended in Azure Automation.
 */

export interface ManualScriptPackageInput {
  scriptId: number;
  scriptName: string;
  description: string | null;
  manualRequirements: string[];
  psScriptBody?: string | null;
  runResultId: number;
  customerDisplayName?: string;
  uploadBaseUrl: string;
}

export interface ManualScriptPackage {
  psContent: string;
  instructions: string;
  filename: string;
}

export function generateManualScriptPackage(input: ManualScriptPackageInput): ManualScriptPackage {
  const {
    scriptName,
    description,
    manualRequirements,
    psScriptBody,
    runResultId,
    customerDisplayName,
    uploadBaseUrl,
  } = input;

  const safeScriptName = scriptName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeScriptName}.ps1`;
  const uploadUrl = `${uploadBaseUrl}/api/admin/manual-scripts/${runResultId}/upload`;

  const requirementsList = manualRequirements.length > 0
    ? manualRequirements.map(r => `#   - ${r}`).join("\n")
    : "#   (none listed)";

  const psContent = `<#
.SYNOPSIS
    ${scriptName}
    ${description ? `\n.DESCRIPTION\n    ${description}` : ""}

.NOTES
    This script requires DELEGATED authentication and must be run locally
    by a user with appropriate Microsoft 365 permissions.
    After running, upload the JSON output file to the portal.

    Run Result ID : ${runResultId}
    Customer      : ${customerDisplayName ?? "N/A"}
    Upload URL    : ${uploadUrl}

.REQUIREMENTS
${requirementsList}
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TenantId,

    [Parameter(Mandatory = $true)]
    [string]$UserPrincipalName,

    [Parameter()]
    [string]$OutputPath = ".\\${safeScriptName}_output_${runResultId}.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "[${scriptName}] Starting — connecting as $UserPrincipalName to tenant $TenantId" -ForegroundColor Cyan

# ── Install required modules ───────────────────────────────────────────────────
$requiredModules = @("Microsoft.Graph", "ExchangeOnlineManagement")
foreach ($mod in $requiredModules) {
    if (-not (Get-Module -ListAvailable -Name $mod)) {
        Write-Host "  Installing $mod…" -ForegroundColor Yellow
        Install-Module -Name $mod -Scope CurrentUser -Force -AllowClobber
    }
}

# ── Connect with delegated credentials ────────────────────────────────────────
Write-Host "[${scriptName}] Connecting to Microsoft Graph (delegated)…" -ForegroundColor Cyan
Connect-MgGraph -TenantId $TenantId -Scopes "User.Read.All","Organization.Read.All" -ErrorAction Stop

# ── Collect data ───────────────────────────────────────────────────────────────
Write-Host "[${scriptName}] Collecting data…" -ForegroundColor Cyan

${psScriptBody
  ? `# Script-specific collection logic:
${psScriptBody}
`
  : `# No script body stored — add your data collection logic here.
# Populate \$data with whatever the AI Analyzer should receive.
$data = @{}
`}
$output = @{
    scriptName    = "${scriptName}"
    runResultId   = ${runResultId}
    collectedAt   = (Get-Date -Format "o")
    tenant        = $TenantId
    runBy         = $UserPrincipalName
    data          = $data
}

# ── Disconnect ─────────────────────────────────────────────────────────────────
Disconnect-MgGraph -ErrorAction SilentlyContinue

# ── Write output JSON ──────────────────────────────────────────────────────────
$jsonOutput = $output | ConvertTo-Json -Depth 10
$jsonOutput | Out-File -FilePath $OutputPath -Encoding utf8
Write-Host "[${scriptName}] Output written to: $OutputPath" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEP: Upload the JSON file to the portal:" -ForegroundColor Yellow
Write-Host "  URL: ${uploadUrl}" -ForegroundColor Yellow
Write-Host "  Or use the portal UI — locate this script's card and click 'Upload Results'." -ForegroundColor Yellow
`;

  const instructions = `MANUAL SCRIPT EXECUTION INSTRUCTIONS
======================================
Script      : ${scriptName}
Run Result  : #${runResultId}
Customer    : ${customerDisplayName ?? "N/A"}
Generated   : ${new Date().toISOString()}

WHY THIS SCRIPT CANNOT BE AUTOMATED
-------------------------------------
${manualRequirements.length > 0
  ? manualRequirements.map(r => `  • ${r}`).join("\n")
  : "  • Requires delegated (interactive) authentication that Azure Automation cannot provide."}

PREREQUISITES
-------------
  1. PowerShell 7.x or Windows PowerShell 5.1
  2. Microsoft.Graph module (auto-installed by the script)
  3. ExchangeOnlineManagement module (auto-installed if needed)
  4. A Microsoft 365 account with the appropriate admin roles

STEP 1: AUTHENTICATE
---------------------
  The script will prompt for your Microsoft 365 credentials (delegated login).
  Use an account that has the permissions listed above.

STEP 2: RUN THE SCRIPT
-----------------------
  Run the downloaded .ps1 file in PowerShell:

      .\\${filename} -TenantId "<your-tenant-id>" -UserPrincipalName "<your-upn>"

  The script collects data and writes a JSON file to the same directory.

STEP 3: SAVE THE JSON FILE
---------------------------
  The script writes output to: ${safeScriptName}_output_${runResultId}.json
  Keep this file — you will upload it in the next step.

STEP 4: UPLOAD THE RESULTS
---------------------------
  Option A (Portal UI):
    - Return to the Admin Panel → M365 Script Catalog
    - Find this script's card in the active package run
    - Click "Upload Results" and select the JSON file

  Option B (API — for automation):
    POST ${uploadUrl}
    Content-Type: application/json
    Authorization: Bearer <admin-password>
    Body: <contents of the JSON file>

WHAT DATA IS COLLECTED?
------------------------
  ${description ?? "See the script body for specifics."}
  The collected data is processed by the AI Analyzer to generate findings,
  recommendations, and M365 health score updates for the client.

SUPPORT
-------
  If you encounter issues, contact the portal admin.
`;

  return { psContent, instructions, filename };
}
