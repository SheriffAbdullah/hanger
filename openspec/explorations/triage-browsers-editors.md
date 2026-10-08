# Triage — Browsers + Editors + Meetings

| exe | current label | verdict | live evidence (company/path) | corrected label or proof-needed |
|---|---|---|---|---|
| msedge.exe | Edge browser | CONFIRMED | Microsoft Corporation / "Microsoft Edge" @ `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` (20 live processes, Get-Item VersionInfo) | — |
| chrome.exe | Chrome browser | GUESS | Not running; no `Get-Command chrome`, no `C:\Program Files*\Google\Chrome\Application\chrome.exe` on disk | Prove: `Get-Item 'C:\Program Files*\Google\Chrome\Application\chrome.exe').VersionInfo` showing Google LLC / "Google Chrome" |
| chrome-headless-shell.exe | Playwright Chromium (headless) | GUESS | Not running; no binary on disk (Playwright cache not checked — only PATH + process) | Prove: `(Get-Item "$env:USERPROFILE\.cache\ms-playwright\*\chrome-headless-shell.exe").VersionInfo` or running `Get-Process` path with Chromium FileDescription |
| code.exe | VS Code | CONFIRMED | Microsoft Corporation / "Visual Studio Code" @ `C:\Users\<user>\AppData\Local\Programs\Microsoft VS Code\Code.exe` (on-disk VersionInfo; shim `...\VS Code\bin\code.cmd` in PATH; no live process now) | — |
| slack.exe | Slack | GUESS | Not running; no Get-Command, no service | Prove: `Get-Item "$env:LOCALAPPDATA\slack\slack.exe").VersionInfo` = Slack Technologies / "Slack" |
| teams.exe | Teams | GUESS | Not running; no Get-Command, no matching service | Prove: `Get-Item "$env:LOCALAPPDATA\Microsoft\Teams\current\Teams.exe").VersionInfo` = Microsoft / "Microsoft Teams" (note: classic vs "ms-teams.exe" new client) |
| zoom.exe | Zoom meeting | GUESS | Not running; no Get-Command, no `C:\Program Files\Zoom\bin\Zoom.exe` | Prove: `(Get-Item 'C:\Program Files\Zoom\bin\Zoom.exe').VersionInfo` = Zoom Video Communications / "Zoom" |
| spotify.exe | Spotify | GUESS | Not running; no Get-Command, no service | Prove: `(Get-Item "$env:APPDATA\Spotify\Spotify.exe").VersionInfo` = Spotify AB / "Spotify" |
| onedrive.exe | OneDrive sync | GUESS | Not running now, but OneDrive scheduled tasks exist (Reporting, Standalone Update, Startup tasks) — install footprint present | Prove: `(Get-Item "$env:LOCALAPPDATA\Microsoft\OneDrive\OneDrive.exe").VersionInfo` = Microsoft / "Microsoft OneDrive" |
| putty.exe | PuTTY SSH | GUESS | Not running; no Get-Command, no `C:\Program Files\PuTTY\putty.exe` | Prove: `(Get-Item 'C:\Program Files\PuTTY\putty.exe').VersionInfo` = Simon Tatham / "PuTTY" |
| obs64.exe | OBS recorder | GUESS | Not running; no Get-Command, no `C:\Program Files\OBS-Studio\bin\64bit\obs64.exe` | Prove: `(Get-Item 'C:\Program Files\OBS-Studio\bin\64bit\obs64.exe').VersionInfo` = OBS Project / "OBS Studio" |
| Photos.exe | (no KNOWN entry — unresolved/FileDescription fallback) | GUESS | Not running; `C:\Program Files\WindowsApps\Microsoft.Windows.Photos*` not listable from this shell (store-app ACLs) | Prove: `(Get-AppxPackage *Photos*).InstallLocation` + `Get-Item ...\Photos.exe).VersionInfo` = Microsoft / "Photos" |

Method: `Get-Process` + `Get-Item … .VersionInfo` (CompanyName/FileDescription) per binary; `Get-Command` + well-known install paths + `Get-Service`/`Get-ScheduledTask` when not running. No web knowledge used.
