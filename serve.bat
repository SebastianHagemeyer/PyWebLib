@echo off
setlocal
cd /d "%~dp0"

rem Port defaults to 8000; override by passing one, e.g.  serve.bat 9000
set "PORT=8000"
if not "%~1"=="" set "PORT=%~1"

rem -- Find a Python launcher: prefer "python", fall back to the "py" launcher --
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY ( where py >nul 2>nul && set "PY=py -3" )

if not defined PY (
  echo ERROR: Python 3 was not found on your PATH.
  echo Install it from https://www.python.org/downloads/ and run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   PyWebLib
echo   Serving : %CD%
echo   URL     : http://localhost:%PORT%
echo   Stop    : press Ctrl+C, then close this window
echo.

rem Open the browser, then start the server (it holds this window open).
start "" "http://localhost:%PORT%"
%PY% -m http.server %PORT%

echo.
echo Server stopped.
pause
