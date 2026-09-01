@echo off
setlocal enabledelayedexpansion

set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR_NOSLASH=%~dp0"
if "%PROJECT_DIR_NOSLASH:~-1%"=="\" set "PROJECT_DIR_NOSLASH=%PROJECT_DIR_NOSLASH:~0,-1%"
set "CONFIG=Release"
set "BUILD_OUT=%PROJECT_DIR%bin\%CONFIG%\net8.0-windows"
set "OUT_DIR=%PROJECT_DIR%bin\BuildQueueDesignPreview"
REM Reuses the shared notify helper already living next to BuildConsole's own
REM deploy script — generic (Title/Message/-YesNo params), no reason to fork
REM a second copy for this project. Same "share, don't duplicate" rule #2137
REM itself follows for the data layer and design tokens.
set "NOTIFY_PS1=%PROJECT_DIR%..\BuildConsole\deploy-shanesbuild-notify.ps1"
set "CLAUDE_EXE=%USERPROFILE%\.local\bin\claude.exe"

REM Any failure below shows a dismissable dialog before exiting instead of
REM letting the console window just vanish.

set "GIT_CLEAN_FIX_TRIED=0"
set "GIT_MERGE_FIX_TRIED=0"

:CHECK_CLEAN
echo === Checking working tree is clean ===
set "DIRTY="
for /f "delims=" %%S in ('git -C "%PROJECT_DIR_NOSLASH%" status --porcelain 2^>nul') do set "DIRTY=1"
if defined DIRTY (
  if "%GIT_CLEAN_FIX_TRIED%"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -YesNo -Title "BuildQueueDesignPreview Deploy - Git issue" -Message "Working tree at %PROJECT_DIR% is dirty - refusing to build over uncommitted changes. Spawn Claude Code to fix it automatically?"
    if not errorlevel 1 (
      set "GIT_CLEAN_FIX_TRIED=1"
      echo === Spawning Claude Code to fix the dirty working tree ===
      if exist "%CLAUDE_EXE%" (
        start "Claude Code - Git Cleanup" /wait "%CLAUDE_EXE%" --permission-mode auto --print --output-format text -- "The working tree at %PROJECT_DIR_NOSLASH% is dirty (uncommitted or untracked changes), which is blocking a BuildQueueDesignPreview deploy (deploy-buildqueuedesignpreview.cmd refuses to build over a dirty tree). Investigate what changed, then follow this repo's own CLAUDE.md git conventions ('Leave the working tree clean') to resolve it: commit and push any genuine work of yours, git checkout -- any accidental/scratch edits, or delete (and .gitignore if it will recur) stray untracked files - whichever is actually appropriate for what you find. Do not force-discard anything you did not create without first understanding what it is. When done, git status --porcelain at that path must be empty."
      ) else (
        echo claude.exe not found at %CLAUDE_EXE% - cannot auto-fix.
      )
      goto CHECK_CLEAN
    )
  )
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "BuildQueueDesignPreview Deploy - Error" -Message "Working tree at %PROJECT_DIR% is still dirty. Commit, stash elsewhere, or discard the change, then re-run deploy-buildqueuedesignpreview.cmd."
  exit /b 1
)

echo === Pulling latest from origin/main ===
git -C "%PROJECT_DIR_NOSLASH%" fetch origin main
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "BuildQueueDesignPreview Deploy - Error" -Message "git fetch origin main failed at %PROJECT_DIR%. Check network/auth, then re-run deploy-buildqueuedesignpreview.cmd."
  exit /b 1
)

:CHECK_MERGE
git -C "%PROJECT_DIR_NOSLASH%" merge --ff-only origin/main
if errorlevel 1 (
  if "%GIT_MERGE_FIX_TRIED%"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -YesNo -Title "BuildQueueDesignPreview Deploy - Git issue" -Message "Local history at %PROJECT_DIR% has diverged from origin/main and cannot fast-forward. Spawn Claude Code to fix it automatically?"
    if not errorlevel 1 (
      set "GIT_MERGE_FIX_TRIED=1"
      echo === Spawning Claude Code to fix the diverged history ===
      if exist "%CLAUDE_EXE%" (
        start "Claude Code - Git Cleanup" /wait "%CLAUDE_EXE%" --permission-mode auto --print --output-format text -- "The local main branch at %PROJECT_DIR_NOSLASH% has diverged from origin/main and 'git merge --ff-only origin/main' just failed there, which is blocking a BuildQueueDesignPreview deploy (deploy-buildqueuedesignpreview.cmd requires a clean fast-forward). Reconcile it per this repo's own CLAUDE.md git conventions - commit directly to main, no new branches - by rebasing or merging onto the current origin/main and pushing, so a plain 'git merge --ff-only origin/main' would succeed afterward. If you find uncommitted work of your own in the process, commit and push it first; leave anything you did not create alone. Confirm the branch is genuinely an ancestor of/equal to origin/main when done."
      ) else (
        echo claude.exe not found at %CLAUDE_EXE% - cannot auto-fix.
      )
      goto CHECK_MERGE
    )
  )
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "BuildQueueDesignPreview Deploy - Error" -Message "Local history at %PROJECT_DIR% has diverged from origin/main and cannot fast-forward. Resolve manually (rebase/merge) in the main checkout, then re-run deploy-buildqueuedesignpreview.cmd."
  exit /b 1
)

echo === Deploying commit ===
for /f "delims=" %%C in ('git -C "%PROJECT_DIR_NOSLASH%" log -1 --oneline') do echo %%C

echo === Cleaning obj ===
if exist "%PROJECT_DIR%obj" rmdir /s /q "%PROJECT_DIR%obj"

REM Note: this also rebuilds BuildConsole.csproj via the ProjectReference (it
REM supplies the real data layer + #2126 tokens - shared, not duplicated).
REM That build lands in BuildConsole's OWN bin\%CONFIG%\net8.0-windows, never
REM in the live app's deployed bin\ShanesBuild folder, so it cannot touch or
REM file-lock Shane's actively-running BuildConsole.exe instance. That
REM guarantee is the entire reason #2137 exists.
echo === Building BuildQueueDesignPreview (%CONFIG%) ===
dotnet build "%PROJECT_DIR%BuildQueueDesignPreview.csproj" -c %CONFIG%
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "BuildQueueDesignPreview Deploy - Error" -Message "dotnet build failed for %PROJECT_DIR%BuildQueueDesignPreview.csproj (%CONFIG%). See the console output above for the real compiler error, fix it, then re-run deploy-buildqueuedesignpreview.cmd."
  exit /b 1
)

echo === Stopping running BuildQueueDesignPreview instance (if any) ===
powershell -NoProfile -Command ^
  "Get-Process -Name BuildQueueDesignPreview -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\BuildQueueDesignPreview\*' } | Stop-Process -Force"

echo === Deploying to %OUT_DIR% ===
robocopy "%BUILD_OUT%" "%OUT_DIR%" /E /W:5
if %ERRORLEVEL% GEQ 8 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%NOTIFY_PS1%" -Title "BuildQueueDesignPreview Deploy - Error" -Message "Deploy failed - robocopy exit code %ERRORLEVEL% copying %BUILD_OUT% to %OUT_DIR%."
  exit /b 1
)

echo === Relaunching BuildQueueDesignPreview ===
start "" "%OUT_DIR%\BuildQueueDesignPreview.exe"

echo === Done ===
endlocal