@echo off
setlocal DisableDelayedExpansion
"%~dp0..\..\primary-runtime\dependencies\node\bin\node.exe" "%~dp0..\launch.mjs" %*
exit /b %errorlevel%
