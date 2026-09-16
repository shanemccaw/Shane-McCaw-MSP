@echo off
setlocal enabledelayedexpansion

set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR_NOSLASH=%~dp0"
if "%PROJECT_DIR_NOSLASH:~-1%"=="\" set "PROJECT_DIR_NOSLASH=%PROJECT_DIR_NOSLASH:~0,-1%"
set "CONFIG=Release"
set "BUILD_OUT=%PROJECT_DIR%bin\%CONFIG%\net10.0-windows"
set "OUT_DIR=%PROJECT_DIR%bin\ShanesBuild"
set "NOTIFY_PS1=%~dp0deploy-shanesbuild-notify.ps1"

REM Any failure below shows a dismissable dialog (real build/deploy errors)
REM or a printed block + `pause` (git state - see below) instead of letting
REM the console window just vanish before anyone can read it.
REM
REM Git handling philosophy: auto-fix ONLY the two states that are provably
REM safe and non-destructive (fast-forward pull, fast-forward push - nothing
REM is rewritten or discarded either way). Anything else (a dirty working
REM tree, or history that's genuinely diverged) is NOT auto-fixed and NEVER
REM spawns Claude itself - it just prints a copy-paste-ready diagnostic block
REM and stops, so Shane can hand it to Claude (or fix it) himself.

:CHECK_CLEAN
echo === Checking BuildConsole's own files are clean (ignoring Marketing/Portal/Product elsewhere in the monorepo) ===
set "DIRTY="
for /f "delims=" %%S in ('git -C "%PROJECT_DIR_NOSLASH%" status --porcelain -- . 2^>nul') do set "DIRTY=1"
if defined DIRTY (
  echo.
  echo ================================================================
  echo  ShanesBuild Deploy - BLOCKED: uncommitted changes
  echo ================================================================
  echo desktop\BuildConsole has uncommitted/untracked changes, so the build
  echo refuses to run over them. ^(Changes elsewhere in the repo - Marketing,
  echo Portal, etc - are ignored; only this folder is checked.^)
  echo.
  echo This can't be auto-fixed safely - it might be work in progress.
  echo Copy everything between the ---- lines below and paste it to Claude,
  echo or resolve it yourself, then re-run this script.
  echo ----------------------------------------------------------------
  echo Fix desktop\BuildConsole's dirty git working tree so ShanesBuild can
  echo deploy. Working dir: %PROJECT_DIR_NOSLASH%
  echo.
  echo git status --porcelain -- . output:
  git -C "%PROJECT_DIR_NOSLASH%" status --porcelain -- .
  echo.
  echo Follow this repo's CLAUDE.md git conventions ^("Leave the working tree
  echo clean"^): commit + push genuine work, git checkout -- any accidental
  echo edits, or delete ^(and .gitignore if it'll recur^) stray untracked
  echo files - whichever actually fits what's there. Don't force-discard
  echo anything you didn't create without understanding it first.
  echo ----------------------------------------------------------------
  echo.
  pause
  exit /b 1
)

echo === Checking .pnpmfile.cjs / pnpm-lock.yaml pnpmfileChecksum are in sync (Git #2064) ===
node "%PROJECT_DIR_NOSLASH%\..\..\scripts\dev-server\check-pnpmfile-checksum.mjs" --root "%PROJECT_DIR_NOSLASH%\..\.."
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShanesBuild Deploy - Error" -Message "pnpm-lock.yaml's pnpmfileChecksum is missing or does not match .pnpmfile.cjs (the same drift that caused #2060) - re-run node scripts/dev-server/check-pnpmfile-checksum.mjs for the exact fix, commit pnpm-lock.yaml, then re-run deploy-shanesbuild.cmd."
  exit /b 1
)

echo === Fetching origin/main ===
git -C "%PROJECT_DIR_NOSLASH%" fetch origin main
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShanesBuild Deploy - Error" -Message "git fetch origin main failed at %PROJECT_DIR%. Check network/auth, then re-run deploy-shanesbuild.cmd."
  exit /b 1
)

set "SYNC_RETRY=0"

:CHECK_SYNC
set "BEHIND="
set "AHEAD="
for /f "tokens=1,2" %%A in ('git -C "%PROJECT_DIR_NOSLASH%" rev-list --left-right --count origin/main...HEAD') do (
  set "BEHIND=%%A"
  set "AHEAD=%%B"
)

if "%BEHIND%"=="0" if "%AHEAD%"=="0" goto SYNCED

if "%AHEAD%"=="0" (
  echo === Local is %BEHIND% commit^(s^) behind origin/main - fast-forwarding ^(non-destructive^) ===
  git -C "%PROJECT_DIR_NOSLASH%" merge --ff-only origin/main
  if errorlevel 1 (
    call :PRINT_SYNC_DIAGNOSTIC "fast-forward pull failed unexpectedly"
    exit /b 1
  )
  goto SYNCED
)

if "%BEHIND%"=="0" (
  echo === Local is %AHEAD% commit^(s^) ahead of origin/main - pushing ^(fast-forward, non-destructive^) ===
  git -C "%PROJECT_DIR_NOSLASH%" push origin HEAD:main
  if not errorlevel 1 goto SYNCED
  if "%SYNC_RETRY%"=="0" (
    echo === Push was rejected - someone else likely pushed just now. Re-fetching and retrying once ===
    set "SYNC_RETRY=1"
    git -C "%PROJECT_DIR_NOSLASH%" fetch origin main
    goto CHECK_SYNC
  )
  call :PRINT_SYNC_DIAGNOSTIC "push to origin/main kept failing after a retry"
  exit /b 1
)

REM Both ahead and behind: real divergence. Not safe to auto-resolve
REM (needs a real rebase/merge decision) - print and stop.
call :PRINT_SYNC_DIAGNOSTIC "local main has diverged from origin/main (both ahead and behind) and can't fast-forward either way"
exit /b 1

:SYNCED

echo === Deploying commit ===
for /f "delims=" %%C in ('git -C "%PROJECT_DIR_NOSLASH%" log -1 --oneline') do echo %%C

echo === Cleaning obj ===
if exist "%PROJECT_DIR%obj" rmdir /s /q "%PROJECT_DIR%obj"

echo === Building BuildConsole (%CONFIG%) ===
dotnet build "%PROJECT_DIR%BuildConsole.csproj" -c %CONFIG%
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShanesBuild Deploy - Error" -Message "dotnet build failed for %PROJECT_DIR%BuildConsole.csproj (%CONFIG%). See the console output above for the real compiler error, fix it, then re-run deploy-shanesbuild.cmd."
  exit /b 1
)

echo === Stopping running ShanesBuild instance (if any) ===
powershell -NoProfile -Command ^
  "Get-Process -Name BuildConsole -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\ShanesBuild\*' } | Stop-Process -Force"

echo === Deploying to %OUT_DIR% ===
robocopy "%BUILD_OUT%" "%OUT_DIR%" /E /W:5
if %ERRORLEVEL% GEQ 8 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShanesBuild Deploy - Error" -Message "Deploy failed - robocopy exit code %ERRORLEVEL% copying %BUILD_OUT% to %OUT_DIR%."
  exit /b 1
)

echo === Relaunching ShanesBuild ===
start "" "%OUT_DIR%\BuildConsole.exe"

echo === Done ===
endlocal
exit /b 0

:PRINT_SYNC_DIAGNOSTIC
echo.
echo ================================================================
echo  ShanesBuild Deploy - BLOCKED: %~1
echo ================================================================
echo desktop\BuildConsole at %PROJECT_DIR_NOSLASH% can't be auto-synced with
echo origin/main. This needs a real decision (rebase/merge), so it hasn't
echo been touched. Copy everything between the ---- lines below and paste
echo it to Claude, or resolve it yourself, then re-run this script.
echo ----------------------------------------------------------------
echo Reconcile desktop\BuildConsole's local main with origin/main so a plain
echo 'git merge --ff-only origin/main' would succeed afterward. Working dir:
echo %PROJECT_DIR_NOSLASH%
echo.
echo Commits on origin/main not yet local ^(git log HEAD..origin/main --oneline^):
git -C "%PROJECT_DIR_NOSLASH%" log HEAD..origin/main --oneline
echo.
echo Local commits not yet on origin/main ^(git log origin/main..HEAD --oneline^):
git -C "%PROJECT_DIR_NOSLASH%" log origin/main..HEAD --oneline
echo.
echo Follow this repo's CLAUDE.md git conventions - commit directly to main,
echo no new branches - by rebasing or merging onto current origin/main and
echo pushing. If there's uncommitted work of your own, commit and push it
echo first; leave anything you didn't create alone.
echo ----------------------------------------------------------------
echo.
pause
goto :eof
