# ============================================================
#  Watch-Deploy.ps1
#  Manually test & watch the git-pull + kill-1-restart + poll
#  chain (real #911 build-complete + real #805 deploy-status
#  endpoints), step by step, with verbose progress output.
# ============================================================

$baseUrl = "https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev"
$token   = "e4cd1d817351c233cfcda3ef61ff5cbee1a49c61cbdd07f32ff1cb285d465d2f"
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }

function Get-RealDeployStatus {
    try {
        $resp = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/internal/deploy-status" -Headers $headers -TimeoutSec 15
        return $resp
    } catch {
        Write-Host "  [deploy-status] REQUEST FAILED: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

Write-Host "=== STEP 1: Real commit hash BEFORE triggering ===" -ForegroundColor Cyan
$before = Get-RealDeployStatus
if ($null -eq $before) { Write-Host "Could not reach deploy-status at all. STOP -- this is a real endpoint-reachability problem, not a timing problem." -ForegroundColor Red; exit 1 }
Write-Host "  commitHash: $($before.commitHash)"
Write-Host "  timestamp:  $($before.timestamp)"
$beforeHash = $before.commitHash

Write-Host "`n=== STEP 2: Triggering POST /admin/deploy/build-complete (git pull + kill 1) ===" -ForegroundColor Cyan
$triggerStart = Get-Date
try {
    $triggerResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/admin/deploy/build-complete" -Headers $headers -Body "{}" -TimeoutSec 30
    Write-Host "  Trigger accepted. Real response:" -ForegroundColor Green
    $triggerResp | ConvertTo-Json -Depth 5 | Write-Host
} catch {
    Write-Host "  TRIGGER FAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "  Real status code: $($_.Exception.Response.StatusCode.Value__)" -ForegroundColor Red
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            if ($stream) {
                $reader = New-Object System.IO.StreamReader($stream)
                $body = $reader.ReadToEnd()
                Write-Host "  Server response body:" -ForegroundColor Yellow
                Write-Host $body -ForegroundColor Yellow
            }
        } catch {}
    }
    Write-Host "  This means the endpoint itself is the problem -- stop here, don't assume a timing issue." -ForegroundColor Yellow
    exit 1
}

Write-Host "`n=== STEP 3: Polling deploy-status every 5s, watch it live ===" -ForegroundColor Cyan
Write-Host "  (Connection may have dropped from the restart -- that's expected, keep polling.)" -ForegroundColor DarkGray

$maxWaitSeconds = 180
$elapsed = 0
$changed = $false

while ($elapsed -lt $maxWaitSeconds) {
    Start-Sleep -Seconds 5
    $elapsed += 5
    $current = Get-RealDeployStatus
    if ($null -eq $current) {
        Write-Host "  [+${elapsed}s] server unreachable (likely mid-restart) — still waiting..." -ForegroundColor DarkYellow
        continue
    }
    Write-Host "  [+${elapsed}s] real commitHash: $($current.commitHash)"
    if ($current.commitHash -ne $beforeHash) {
        Write-Host "`n  >>> HASH CHANGED — real restart genuinely completed. <<<" -ForegroundColor Green
        $changed = $true
        break
    }
}

Write-Host "`n=== RESULT ===" -ForegroundColor Cyan
if ($changed) {
    $totalTime = (Get-Date) - $triggerStart
    Write-Host "SUCCESS — deploy confirmed live. Total real time: $([math]::Round($totalTime.TotalSeconds))s" -ForegroundColor Green
    Write-Host "Before: $beforeHash"
    Write-Host "After:  $($current.commitHash)"
} else {
    Write-Host "TIMED OUT after ${maxWaitSeconds}s — hash never changed. Real conclusion: either the git pull/restart genuinely isn't happening server-side, or it's taking longer than $maxWaitSeconds seconds. This is the real data point to act on." -ForegroundColor Red
}