@echo off
setlocal enabledelayedexpansion

set "REPO_ROOT=%~dp0"
set "REPO_ROOT_NOSLASH=%~dp0"
if "%REPO_ROOT_NOSLASH:~-1%"=="\" set "REPO_ROOT_NOSLASH=%REPO_ROOT_NOSLASH:~0,-1%"

set "APP_DIR=%REPO_ROOT%desktop\ShaneBuilder\"
set "CSPROJ=%APP_DIR%ShaneBuilder.csproj"
set "CONFIG=Release"
set "BUILD_OUT=%APP_DIR%bin\%CONFIG%\net8.0-windows"
set "OUT_DIR=%REPO_ROOT%bin\ShaneBuilder"
set "NOTIFY_PS1=%REPO_ROOT%deploy-shanesbuild-notify.ps1"
set "CLAUDE_EXE=%USERPROFILE%\.local\bin\claude.exe"

REM Any failure below shows a dismissable dialog before exiting instead of
REM letting the console window just vanish.

set "GIT_CLEAN_FIX_TRIED=0"
set "GIT_MERGE_FIX_TRIED=0"

:CHECK_CLEAN
echo === Checking working tree is clean ===
set "DIRTY="
for /f "delims=" %%S in ('git -C "%REPO_ROOT_NOSLASH%" status --porcelain 2^>nul') do set "DIRTY=1"
if defined DIRTY (
  if "%GIT_CLEAN_FIX_TRIED%"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -YesNo -Title "ShaneBuilder Deploy - Git issue" -Message "Working tree at %REPO_ROOT% is dirty - refusing to build over uncommitted changes. Spawn Claude Code to fix it automatically?"
    if not errorlevel 1 (
      set "GIT_CLEAN_FIX_TRIED=1"
      echo === Spawning Claude Code to fix the dirty working tree ===
      if exist "%CLAUDE_EXE%" (
        start "Claude Code - Git Cleanup" /wait "%CLAUDE_EXE%" --permission-mode auto --print --output-format text -- "The working tree at %REPO_ROOT_NOSLASH% is dirty (uncommitted or untracked changes), which is blocking a ShaneBuilder deploy. Investigate what changed, then follow this repo's own CLAUDE.md git conventions ('Leave the working tree clean') to resolve it: commit and push any genuine work of yours, git checkout -- any accidental/scratch edits, or delete (and .gitignore if it will recur) stray untracked files. Do not force-discard anything you did not create without first understanding what it is. When done, git status --porcelain at that path must be empty."
      ) else (
        echo claude.exe not found at %CLAUDE_EXE% - cannot auto-fix.
      )
      goto CHECK_CLEAN
    )
  )
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShaneBuilder Deploy - Error" -Message "Working tree at %REPO_ROOT% is still dirty. Commit, stash elsewhere, or discard the change, then re-run this script."
  exit /b 1
)

echo === Pulling latest from origin/main ===
git -C "%REPO_ROOT_NOSLASH%" fetch origin main
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShaneBuilder Deploy - Error" -Message "git fetch origin main failed at %REPO_ROOT%. Check network/auth, then re-run this script."
  exit /b 1
)

:CHECK_MERGE
git -C "%REPO_ROOT_NOSLASH%" merge --ff-only origin/main
if errorlevel 1 (
  if "%GIT_MERGE_FIX_TRIED%"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -YesNo -Title "ShaneBuilder Deploy - Git issue" -Message "Local history at %REPO_ROOT% has diverged from origin/main and cannot fast-forward. Spawn Claude Code to fix it automatically?"
    if not errorlevel 1 (
      set "GIT_MERGE_FIX_TRIED=1"
      echo === Spawning Claude Code to fix the diverged history ===
      if exist "%CLAUDE_EXE%" (
        start "Claude Code - Git Cleanup" /wait "%CLAUDE_EXE%" --permission-mode auto --print --output-format text -- "The local main branch at %REPO_ROOT_NOSLASH% has diverged from origin/main and 'git merge --ff-only origin/main' just failed there, which is blocking a ShaneBuilder deploy. Reconcile it per this repo's own CLAUDE.md git conventions - commit directly to main, no new branches - by rebasing or merging onto the current origin/main and pushing, so a plain 'git merge --ff-only origin/main' would succeed afterward. If you find uncommitted work of your own in the process, commit and push it first; leave anything you did not create alone. Confirm the branch is genuinely an ancestor of/equal to origin/main when done."
      ) else (
        echo claude.exe not found at %CLAUDE_EXE% - cannot auto-fix.
      )
      goto CHECK_MERGE
    )
  )
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShaneBuilder Deploy - Error" -Message "Local history at %REPO_ROOT% has diverged from origin/main and cannot fast-forward. Resolve manually (rebase/merge) in the main checkout, then re-run this script."
  exit /b 1
)

echo === Deploying commit ===
for /f "delims=" %%C in ('git -C "%REPO_ROOT_NOSLASH%" log -1 --oneline') do echo %%C

echo === Cleaning obj ===
if exist "%APP_DIR%obj" rmdir /s /q "%APP_DIR%obj"

echo === Building ShaneBuilder (%CONFIG%) ===
dotnet build "%CSPROJ%" -c %CONFIG%
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShaneBuilder Deploy - Error" -Message "dotnet build failed for %CSPROJ% (%CONFIG%). See the console output above for the real compiler error, fix it, then re-run this script."
  exit /b 1
)

echo === Stopping running ShaneBuilder instance (if any) ===
powershell -NoProfile -Command ^
  "Get-Process -Name ShaneBuilder -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\ShaneBuilder\*' } | Stop-Process -Force"

echo === Deploying to %OUT_DIR% ===
robocopy "%BUILD_OUT%" "%OUT_DIR%" /E /W:5
if %ERRORLEVEL% GEQ 8 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "ShaneBuilder Deploy - Error" -Message "Deploy failed - robocopy exit code %ERRORLEVEL% copying %BUILD_OUT% to %OUT_DIR%."
  exit /b 1
)

echo === Relaunching ShaneBuilder ===
start "" "%OUT_DIR%\ShaneBuilder.exe"

echo === Done ===
endlocal