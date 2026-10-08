# Deep Admin Surface — What Elevation Unlocks (Win11 Laptop)

Standing rule: owner grants admin where available. Collection is capability-tiered: admin signals collected when elevatable, skipped gracefully with `tier=admin-skipped` + reason otherwise. Never fail a run for lack of admin.

## Catalog (collector | cost | elevation vs install)

1. **Thermal-zone temps:** `Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | Select CurrentTemperature` (deci-Kelvin → °C = /10-273.15). One-shot ~400ms. Needs elevation only. Confound: chassis/skin sensor, often 1 stale zone on HP; not CPU die.
2. **ETW kernel rundown (DPC/ISR/hardfaults/precise-CPU):** `wpr.exe -start CPU -start Memory -start DiskIO -filemode` → repro hang → `wpr.exe -stop trace.etl`; analyze `CPU Usage (Precise)`, `DPC/ISR Duration by Module`, `Hard Faults` tables in WPA. Continuous: minutes-long trace, 100s MB, ~2-5% observer overhead. Elevation only, no install/reboot. Never leave trace running.
3. **Sysmon state + log:** install-state `Get-Service Sysmon64; Get-WinEvent -ListLog 'Microsoft-Windows-Sysmon/Operational'`; spawn-burst `Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Sysmon/Operational'; ID=1,5}`. One-shot ~500ms. Read needs elevation; install needs admin + installer + reboot-prompt (out of scope for tool — detect only, never install).
4. **DebugDiag hang-rule service:** `Get-Service DbgSvc; dbgcmd.exe /dump <pid> /hang` or Analysis `DebugDiag.Analysis.exe`. On-demand dump, seconds + 100s MB freeze. Needs elevation + DebugDiag install; no reboot. Default: document rule only, dump only on explicit consent.
5. **RAMMap driver realities:** `rammap.exe` loads live-kernel driver → requires elevation + HVCI-off/driver-sign friction on Win11. Recommendation: read-only counters only (`Memory\Standby Cache*`, `Pool Paged/Nonpaged Bytes` via `Get-Counter`, no driver). Do not install/sideload driver in-app.
6. **Storage SMART/health:** `Get-PhysicalDisk | Get-StorageReliabilityCounter` (wear, temp, read/write errors, power-on hours); fallback `Get-CimInstance MSStorageDriver_FailurePredictStatus`. One-shot ~300ms. Elevation only. Confound: USB/NVMe-bridge hides SMART → report `health=unknown(bridge)`.
7. **Memory diagnostics schedule:** `Get-ScheduledTask \Microsoft\Windows\MemoryDiagnostic\*; Get-WinEvent -LogName System -Source MemoryDiagnostics-Results`. One-shot cheap. Read needs elevation; running `mdsched.exe` needs reboot — never trigger; report schedule state only.
8. **Full WER queue:** user view needs nothing: `Get-ChildItem $env:LOCALAPPDATA\..\Local\Microsoft\Windows\WER\ReportQueue\*.wer`. System-wide `C:\ProgramData\Microsoft\Windows\WER\ReportQueue` + `HKLM\...\Windows Error Reporting` need elevation. Counts-only scan ~400ms one-shot. No install/reboot.
9. **SeDebugPrivilege process details:** `whoami /priv` → enable `SeDebugPrivilege`; then `Get-Process -IncludeUserName`, protected-PID CommandLine via `Win32_Process`. On-HANG snapshot ~500ms. Elevation only. Without it: `Access Denied` on SYSTEM/PPL PIDs is expected.
10. **Sleep-study (Modern Standby):** `powercfg /sleepstudy /duration 3 /xml sleepstudy.xml`. One-shot seconds, generates report. Elevation required. Confound: S0 wakes mimic idle dips — join with Kernel-Power 506/507 entry/exit.
11. **Battery report (plug-vs-drain):** `powercfg /batteryreport /duration 7 /xml battery.xml`. One-shot seconds. Runs unelevated but full drain-history + capacity needs elevation on some builds. Join with `PowerLineStatus` + AC/DC maxFreq baselines.

## Tier table

| Signal | Tier | Fallback when unelevated |
|---|---|---|
| Thermal-zone temp | admin | `thermal.zone=denied`; use maxFreq proxy, never score cool |
| ETW DPC/ISR/precise-CPU | admin | bundled DPC%+ctx+intr triplet; `cause unresolved` |
| Sysmon ID1/ID5 | admin-read / install-out-of-scope | tasklist + Win32_Process CommandLine |
| DebugDiag dump | admin+install | on-HANG tasklist + Get-Process top-8 |
| RAMMap internals | admin+driver (skip) | Get-Counter standby/pool, no driver |
| SMART/health | admin | disk queue+latency counters only |
| MemDiag results | admin-read (run needs reboot, never) | pages/sec sustained thrash verdict |
| WER system queue | user (own) / admin (full) | user queue + App 1000/1001/1002 |
| Protected proc details | admin (SeDebug) | `PROCESS_QUERY_LIMITED_INFORMATION` + throttling-state API |
| Sleep-study | admin | Kernel-Power 506/507 + `powercfg /a` |
| Battery drain history | user-partial / admin-full | live plug state + AC/DC maxFreq compare |
