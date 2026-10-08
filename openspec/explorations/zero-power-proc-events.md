# Zeroth-Order: Power + Process-Identity + OS-Event Surface (no admin)

Every reading below works without elevation. Feeds `watch` baseline + `trace` on-HANG context.

## A. Power truth

| Signal | Collector | Cost | Privacy |
|---|---|---|---|
| Scheme GUID + name (`powercfg /GETACTIVESCHEME`, `/LIST`; overlay `/GETOVERLAYSCHEME`) | `sh('powercfg …')` once/run | ~200ms | none |
| Plug + battery % (`SystemInformation.PowerStatus`: `PowerLineStatus`, `BatteryLifePercent`) | 1 ps, refresh 15–30s | ~300ms | none |
| `Win32_Battery` (`EstimatedChargeRemaining`, `BatteryStatus`) + `root\wmi BatteryStatus` (`PowerOnline`, `DischargeRate`) | 2× `Get-CimInstance`, once/run | ~400ms | none |
| AC vs DC derived (`plugged` + `batteryPct`) per probe | cached | free | none |
| Throttle: `% of Maximum Frequency` (bundled `maxFreq`) + `Win32_Processor Current/MaxClockSpeed` + `MSAcpi_ThermalZoneTemperature` if visible | bundle + 1 ps | ~0 / ~400ms | none |

## B. Process identity (no unknown names)

| Signal | Collector | Cost | Privacy |
|---|---|---|---|
| `tasklist /FO CSV` (Image Name, PID, Session, Mem) → `rollup()` WS groups | `sh('tasklist…')` start/end + on-HANG | 200–500ms | names+PIDs; hostname in report |
| `Get-Process`: WS, PM, NPM, Handles, Threads, CPU, Path, Responding, MainWindowHandle | 1 ps | ~500ms | Path leaks username → anonymize |
| `FileDescription` + `Get-Command.Source`; fallback live `.Path` | 1 ps, top-8 unknowns | ~400ms | path only |
| `Win32_Process` PPID + CommandLine (depth≤3, match by CommandLine) | `Get-CimInstance` on-HANG + end | ~500ms | **CommandLine may hold secrets → redact** |
| `svchost -s` split (`tasklist /SVC` or `Win32_Service→ProcessId`) | 1 call on-HANG | ~300ms | none |
| Sysmon Operational ID1/ID5, if installed | `Get-WinEvent -MaxEvents` once | ~500ms | command-lines PII |

## C. OS-event surface

| Signal | Collector | Cost | Privacy |
|---|---|---|---|
| App 1000 crash / 1001 bucket / 1002 hang + faulting-module text | `Get-WinEvent` ×3, once/run | ~500ms ea | app paths, usernames |
| System 2004 exhaustion / 41 reboot | `Get-WinEvent` once/run | ~500ms | minimal |
| WLAN (`WLAN-AutoConfig`) + DNS (`DNS-Client`) channels | on-demand | ~500ms | **SSIDs + hostnames = PII** |
| WER `ReportArchive/ReportQueue/*.wer` (`EventName`, bucket, module) | `Get-ChildItem \| Select-String`, first 200 | ~400ms | **counts only, never dumps** |
| Reliability RAC store (`%ProgramData%\Microsoft\RAC\…`) | location note, read-only | cheap | local only |

## D. Direct inferences

- `plugged + HP Optimized + maxFreq≈45%` = EC-capped regardless of scheme.
- `BAT + maxFreq<60%` at hang = throttle suspect; same hang on AC refutes it.
- `Responding=false` non-empty = OS-confirmed hung set.
- `WER apphang>0` = history of this exact pain with zero fresh 1002s.
- 1002 within ±60s of HANG = corroboration (+0.1–0.2); absence caps conf ≤0.7.
- Split `svchost` by `-s` before blaming it; attribute to service group.
- Sysmon ID1 storm for headless-shell at hang = spawn stall, not leak.

## E. FIRST-ORDER FEED

`power.scheme/plugged/batteryPct/maxFreq`, `proc.rollup/private/handles/threads/tree/svcGroup`, `sys.event_hang/crash/exhaust/boot41`, `sys.wer_apphang_total`, `sys.oshung_responding[]`, `sys.sysmon_spawn_burst?` → `hang.context[±10s]` + `culprit.attribution` + RCA step 5.
