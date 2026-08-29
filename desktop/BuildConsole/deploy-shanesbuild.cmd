@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR_NOSLASH=%~dp0"
if "%PROJECT_DIR_NOSLASH:~-1%"=="\" set "PROJECT_DIR_NOSLASH=%PROJECT_DIR_NOSLASH:~0,-1%"
set "CONFIG=Release"
set "BUILD_OUT=%PROJECT_DIR%bin\%CONFIG%\net8.0-windows"
set "OUT_DIR=%PROJECT_DIR%bin\ShanesBuild"

echo === Checking working tree is clean ===
for /f "delims=" %%S in ('git -C "%PROJECT_DIR_NOSLASH%" status --porcelain') do (
  echo Working tree at %PROJECT_DIR% is dirty. Refusing to build over uncommitted changes.
  echo Commit, stash elsewhere, or discard the change, then re-run.
  exit /b 1
)

echo === Pulling latest from origin/main ===
git -C "%PROJECT_DIR_NOSLASH%" fetch origin main
if errorlevel 1 (
  echo git fetch failed. Aborting deploy.
  exit /b 1
)
git -C "%PROJECT_DIR_NOSLASH%" merge --ff-only origin/main
if errorlevel 1 (
  echo Local history has diverged from origin/main and cannot fast-forward. Aborting deploy.
  echo Resolve manually ^(rebase/merge^) in the main checkout, then re-run.
  exit /b 1
)

echo === Deploying commit ===
for /f "delims=" %%C in ('git -C "%PROJECT_DIR_NOSLASH%" log -1 --oneline') do echo %%C

echo === Cleaning obj ===
if exist "%PROJECT_DIR%obj" rmdir /s /q "%PROJECT_DIR%obj"

echo === Building BuildConsole (%CONFIG%) ===
dotnet build "%PROJECT_DIR%BuildConsole.csproj" -c %CONFIG%
if errorlevel 1 (
  echo Build failed. Aborting deploy.
  exit /b 1
)

echo === Stopping running ShanesBuild instance (if any) ===
powershell -NoProfile -Command ^
  "Get-Process -Name BuildConsole -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\ShanesBuild\*' } | Stop-Process -Force"

echo === Deploying to %OUT_DIR% ===
robocopy "%BUILD_OUT%" "%OUT_DIR%" /E
if %ERRORLEVEL% GEQ 8 (
  echo Deploy failed - robocopy exit code %ERRORLEVEL%.
  exit /b 1
)

echo === Relaunching ShanesBuild ===
start "" "%OUT_DIR%\BuildConsole.exe"

echo === Done ===
endlocal
