@echo off
setlocal

REM Thin forwarder — MyArchitect lives in its own separate repo/checkout
REM (C:\Source\ShaneMcCawConsulting\MyArchitect-clone), not in this one. The
REM real deploy logic (git clean/merge checks, build, redeploy, relaunch)
REM lives in that repo's own deploy-myarchitect.cmd; this just calls it so it
REM can also be run from here alongside deploy-shanesbuild.cmd.

set "TARGET=C:\Source\ShaneMcCawConsulting\MyArchitect-clone\deploy-myarchitect.cmd"

if not exist "%TARGET%" (
  echo deploy-myarchitect.cmd not found at %TARGET%
  exit /b 1
)

call "%TARGET%" %*
exit /b %ERRORLEVEL%
