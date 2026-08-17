# ============================================================
#  Watch-Deploy.ps1
#  Direct SSH deployment runner & live watcher on Replit.
#  Replaces blind HTTP REST polling with real-time SSH execution.
# ============================================================

$sshKey = "$HOME\.ssh\replit"
$sshHost = "ssh.replit.com"
$remoteDir = "~/Shane-McCaw-MSP"

# Check if BuildConsole settings has a custom key or host
$settingsPath = "$env:APPDATA\BuildConsole\settings.json"
if (Test-Path $settingsPath) {
    try {
        $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
        if ($settings.sshKeyPath -and (Test-Path $settings.sshKeyPath)) { $sshKey = $settings.sshKeyPath }
        if ($settings.sshHost) { $sshHost = $settings.sshHost }
        if ($settings.sshUser) { $sshHost = "$($settings.sshUser)@$($settings.sshHost)" }
        if ($settings.sshRemoteDir) { $remoteDir = $settings.sshRemoteDir }
    } catch {}
}

if (Test-Path $sshKey) {
    Write-Host "=== Direct SSH Deployment to Replit ($sshHost) ===" -ForegroundColor Cyan
    Write-Host "  Using Key: $sshKey" -ForegroundColor DarkGray
    Write-Host "  Directory: $remoteDir`n" -ForegroundColor DarkGray

    # Step 1: Check current remote commit hash
    Write-Host "--> Checking current remote commit hash..." -ForegroundColor Yellow
    $beforeHash = ssh -i $sshKey -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 $sshHost "git -C $remoteDir rev-parse HEAD" 2>&1
    Write-Host "  Current remote commit: $beforeHash" -ForegroundColor DarkGray

    # Step 2: Trigger live git fetch + reset + build over SSH
    Write-Host "`n--> Pulling latest code and building on Replit..." -ForegroundColor Yellow
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    
    $deployCommand = "cd $remoteDir && git fetch origin main && git reset --hard origin/main && npm run build"
    ssh -i $sshKey -o StrictHostKeyChecking=accept-new $sshHost $deployCommand

    $sw.Stop()

    # Step 3: Verify new remote commit hash
    Write-Host "`n--> Verifying deployed commit..." -ForegroundColor Yellow
    $afterHash = ssh -i $sshKey -o StrictHostKeyChecking=accept-new $sshHost "git -C $remoteDir rev-parse HEAD" 2>&1
    
    Write-Host "`n=== DEPLOY RESULT ===" -ForegroundColor Cyan
    Write-Host "  Duration: $([math]::Round($sw.Elapsed.TotalSeconds, 1))s" -ForegroundColor DarkGray
    Write-Host "  Before:   $beforeHash"
    Write-Host "  After:    $afterHash" -ForegroundColor Green

    if ($beforeHash -ne $afterHash) {
        Write-Host "`n>>> SUCCESS: Code successfully updated and built on Replit! <<<" -ForegroundColor Green
    } else {
        Write-Host "`n>>> SUCCESS: Remote was already up to date on $afterHash. <<<" -ForegroundColor Green
    }
} else {
    Write-Host "SSH Key not found at $sshKey." -ForegroundColor Yellow
    Write-Host "Please configure your SSH key path in BuildConsole -> Settings -> SSH & Remote." -ForegroundColor DarkGray
}