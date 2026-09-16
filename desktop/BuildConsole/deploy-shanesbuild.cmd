@echo off
setlocal enabledelayedexpansion

set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR_NOSLASH=%~dp0"
if "%PROJECT_DIR_NOSLASH:~-1%"=="\" set "PROJECT_DIR_NOSLASH=%PROJECT_DIR_NOSLASH:~0,-1%"
set "CONFIG=Release"
set "BUILD_OUT=%PROJECT_DIR%bin\%CONFIG%\net10.0-windows"
set "OUT_DIR=%PROJECT_DIR%bin\ShanesBuild"
set "NOTIFY_PS1=%~dp0deploy-shanesbuild-notify.ps1"
set "CLAUDE_EXE=%USERPROFILE%\.local\bin\claude.exe"

REM Any failure below shows a dismissable dialog before exiting instead of
REM letting the console window just vanish (that was the original complaint —
REM the message was there in the console output, but the window closed before
REM anyone could read it).

set "GIT_CLEAN_FIX_TRIED=0"
set "GIT_MERGE_FIX_TRIED=0"

:CHECK_CLEAN
echo === Checking BuildConsole's own files are clean (ignoring Marketing/Portal/Product elsewhere in the monorepo) ===
set "DIRTY="
for /f "delims=" %%S in ('git -C "%PROJECT_DIR_NOSLASH%" status --porcelain -- . 2^>nul') do set "DIRTY=1"
if defined DIRTY (
  if "%GIT_CLEAN_FIX_TRIED%"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -YesNo -Title "ShanesBuild Deploy - Git issue" -Message "desktop\BuildConsole at %PROJECT_DIR% has uncommitted/untracked changes - refusing to build over them. (Changes elsewhere in the repo - Marketing, Portal, etc - are ignored.) Spawn Claude Code to fix it automatically?"
    if not errorlevel 1 (
      set "GIT_CLEAN_FIX_TRIED=1"
      echo === Spawning Claude Code to fix the dirty working tree ===
      if exist "%CLAUDE_EXE%" (
        start "Claude Code - Git Cleanup" /wait "%CLAUDE_EXE%" --permission-mode auto --print --output-format text -- "desktop/BuildConsole at %PROJECT_DIR_NOSLASH% has uncommitted or untracked changes (git status --porcelain -- . scoped to that folder), which is blocking a ShanesBuild deploy (deploy-shanesbuild.cmd refuses to build over dirty BuildConsole files; it deliberately ignores dirty state elsewhere in the monorepo like Marketing/Portal/Product). Investigate what changed under desktop/BuildConsole, then follow this repo's own CLAUDE.md git conventions ('Leave the working tree clean') to resolve it: commit and push any genuine work of yours, git checkout -- any accidental/scratch edits, or delete (and .gitignore if it will recur) stray untracked files - whichever is actually appropriate for what you find. Do not force-discard anything you did not create without first understanding what it is. When done, git status --porcelain -- . run from desktop/BuildConsole must be empty."
      ) else (
        echo claude.exe not found at %CLAUDE_EXE% - cannot auto-fix.
      )
      goto CHECK_CLEAN
    )
  )
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShanesBuild Deploy - Error" -Message "desktop\BuildConsole at %PROJECT_DIR% is still dirty. Commit, stash elsewhere, or discard the change, then re-run deploy-shanesbuild.cmd."
  exit /b 1
)

echo === Checking .pnpmfile.cjs / pnpm-lock.yaml pnpmfileChecksum are in sync (Git #2064) ===
node "%PROJECT_DIR_NOSLASH%\..\..\scripts\dev-server\check-pnpmfile-checksum.mjs" --root "%PROJECT_DIR_NOSLASH%\..\.."
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShanesBuild Deploy - Error" -Message "pnpm-lock.yaml's pnpmfileChecksum is missing or does not match .pnpmfile.cjs (the same drift that caused #2060) - re-run node scripts/dev-server/check-pnpmfile-checksum.mjs for the exact fix, commit pnpm-lock.yaml, then re-run deploy-shanesbuild.cmd."
  exit /b 1
)

echo === Pulling latest from origin/main ===
git -C "%PROJECT_DIR_NOSLASH%" fetch origin main
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShanesBuild Deploy - Error" -Message "git fetch origin main failed at %PROJECT_DIR%. Check network/auth, then re-run deploy-shanesbuild.cmd."
  exit /b 1
)

:CHECK_MERGE
git -C "%PROJECT_DIR_NOSLASH%" merge --ff-only origin/main
if errorlevel 1 (
  if "%GIT_MERGE_FIX_TRIED%"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -YesNo -Title "ShanesBuild Deploy - Git issue" -Message "Local history at %PROJECT_DIR% has diverged from origin/main and cannot fast-forward. Spawn Claude Code to fix it automatically?"
    if not errorlevel 1 (
      set "GIT_MERGE_FIX_TRIED=1"
      echo === Spawning Claude Code to fix the diverged history ===
      if exist "%CLAUDE_EXE%" (
        start "Claude Code - Git Cleanup" /wait "%CLAUDE_EXE%" --permission-mode auto --print --output-format text -- "The local main branch at %PROJECT_DIR_NOSLASH% has diverged from origin/main and 'git merge --ff-only origin/main' just failed there, which is blocking a ShanesBuild deploy (deploy-shanesbuild.cmd requires a clean fast-forward). Reconcile it per this repo's own CLAUDE.md git conventions - commit directly to main, no new branches - by rebasing or merging onto the current origin/main and pushing, so a plain 'git merge --ff-only origin/main' would succeed afterward. If you find uncommitted work of your own in the process, commit and push it first; leave anything you did not create alone. Confirm the branch is genuinely an ancestor of/equal to origin/main when done."
      ) else (
        echo claude.exe not found at %CLAUDE_EXE% - cannot auto-fix.
      )
      goto CHECK_MERGE
    )
  )
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShanesBuild Deploy - Error" -Message "Local history at %PROJECT_DIR% has diverged from origin/main and cannot fast-forward. Resolve manually (rebase/merge) in the main checkout, then re-run deploy-shanesbuild.cmd."
  exit /b 1
)

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
