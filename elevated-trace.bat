@echo off
cd /d "%~dp0"
echo [hanger-elevated] cwd=%CD%
whoami /groups | findstr S-1-16-12288
node --version
if not exist tools\hanger\hanger.js echo [hanger-elevated] SCRIPT MISSING FROM THIS CONTEXT
rem The run writes its own scope-resolved log (--log). Raw console output is never redirected to disk.
node tools\hanger\hanger.js trace --duration 60 --interval 500 --out .\reports --anonymize --deep-admin --log .\reports\elevated-run.log
echo [hanger-elevated] EXIT:%ERRORLEVEL% log=reports\elevated-run.log
pause
