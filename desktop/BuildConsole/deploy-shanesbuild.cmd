@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "CONFIG=Release"
set "BUILD_OUT=%PROJECT_DIR%bin\%CONFIG%\net7.0-windows"
set "OUT_DIR=%PROJECT_DIR%bin\ShanesBuild"

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
