$file = "hello-world-ui.json"
$out  = Join-Path $env:TEMP "shaneapp-runTest-$file.result.json"
Remove-Item $out -ErrorAction SilentlyContinue

Start-Process ("shaneapp://runTest?src=claude-code&file=" + [uri]::EscapeDataString($file))

while (-not (Test-Path $out)) { Start-Sleep -Milliseconds 300 }
Get-Content $out -Raw | ConvertFrom-Json



$sql = "SELECT count(*) AS users FROM public.users;"
$ref = Join-Path $env:TEMP ("shaneapp-sql-" + [guid]::NewGuid() + ".sql")
Set-Content -Path $ref -Value $sql -Encoding utf8

Start-Process ("shaneapp://executeSql?src=claude-code&ref=" + [uri]::EscapeDataString($ref))

$out = "$ref.result.json"
while (-not (Test-Path $out)) { Start-Sleep -Milliseconds 200 }
Get-Content $out -Raw | ConvertFrom-Json



$file = "hello-world-sql.json"
$out  = Join-Path $env:TEMP "shaneapp-runTest-$file.result.json"
Remove-Item $out -ErrorAction SilentlyContinue

Start-Process ("shaneapp://runTest?src=claude-code&file=" + [uri]::EscapeDataString($file))

while (-not (Test-Path $out)) { Start-Sleep -Milliseconds 300 }
Get-Content $out -Raw | ConvertFrom-Json