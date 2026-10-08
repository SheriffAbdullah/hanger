# Triage — Windows system processes (live, 2026-10-07)

| Process | Live evidence | KNOWN map | Verdict |
|---|---|---|---|
| explorer.exe (PID 11232, 118MB) | `C:\WINDOWS\Explorer.EXE`, Company=Microsoft Corporation, desc=Windows Explorer | "Windows Explorer" | CONFIRMED |
| dwm.exe (PID 1776, ~41MB) | `C:\Windows\System32\dwm.exe`, Microsoft Corporation, "Desktop Window Manager" (protected: Get-Process.Path empty, verified via Get-Item) | "Desktop compositor" | CONFIRMED |
| svchost.exe (97 instances, 559MB agg; top: 6844 DiagTrack 33MB, 9156 BITS 28MB, 19796 whesvc 16MB, 19308 InventorySvc 15MB, 3660 EventLog 10MB) | `C:\Windows\System32\svchost.exe`, Microsoft Corporation, "Host Process for Windows Services"; `tasklist /svc` confirms service-host grouping (1 service per instance mostly) | absent | CORRECTED — add: generic service host, judge per-service via tasklist /svc, never as one blob |
| SearchIndexer.exe (PID 13672, ~30MB) | `C:\Windows\System32\SearchIndexer.exe`, Microsoft Corporation, "Microsoft Windows Search Indexer" | "Windows Search indexer" | CONFIRMED |
| Memory Compression (PID 3808, tasklist 387MB) | No path (kernel store pseudo-process); WorkingSet 386MB but PrivateMemory only 6MB | "compressed RAM store — high MB = pressure, not a leak" | CONFIRMED — number = compressed pages held in RAM, not private alloc; large value signals memory pressure, never a leak |
| Secure System (PID 188, 63MB) | Kernel pseudo-process, no path, no VersionInfo (expected) | absent | CORRECTED — add: kernel (VBS/HVCI) accounting, not an exe, cannot kill |
| msedgewebview2.exe (13 instances, 78MB agg) | `C:\Program Files (x86)\Microsoft\EdgeWebView\...`, Microsoft Corporation, "Microsoft Edge WebView2" | absent | CORRECTED — add: WebView2 runtime hosting app-embedded web UI (Widgets etc.), not Edge tabs |
| pwsh.exe (6×, 508MB agg) / powershell.exe (6×, 295MB agg) | pwsh=`C:\Program Files\PowerShell\7\pwsh.EXE` Microsoft "PowerShell 7"; powershell=`C:\Windows\System32\...\powershell.exe` Microsoft "Windows PowerShell" (includes telltale's own probes) | absent | CORRECTED — add both, note self-observation: telltale spawns powershell per probe |
| Widgets.exe (PID 26500, 38MB, top-RAM system extra) | `C:\Program Files\WindowsApps\MicrosoftWindows.Client.WebExperience_...\Widgets.exe` (Store app, WebView2-backed) | absent | CORRECTED — add: Widgets board; StartMenuExperienceHost (36MB, SystemApps) same category, optional |
