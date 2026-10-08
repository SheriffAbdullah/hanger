# Triage: SECURITY + VENDOR + ISOLATION (live evidence, 2026-10-07)

| Process / driver | Live evidence (this box) | Verdict |
|---|---|---|
| MsMpEng.exe (PID 7744, PPID 1212=services.exe, session Services) | File `C:\ProgramData\Microsoft\Windows Defender\Platform\4.18.26080.4-0\MsMpEng.exe`: Company=`Microsoft Corporation`, Desc=`Antimalware Service Executable`; WdFilter + WdNisDrv drivers Running | CONFIRMED Defender |
| Br-uxendm.exe x2 (PIDs 27604 svc-session child of BrService; 15768 console child of BrHostSvr) | Path `C:\Program Files\HP\Sure Click\bin\`; console cmdline: `-n uVM0009 … Bromium\vSentry\4.4.33.1019\Stage2\Stage2Image0008 … --clone --gui` (binary has blank VersionInfo, path+cmdline conclusive) | CONFIRMED Sure Click micro-VM |
| BrService.exe (PID 6904, child of services.exe) | `…\Sure Click\servers\BrService.exe`: Company=`HP`, Desc=`HP Sure Click Host Management Service 4.4.33.1019`; service `BrService` RUNNING | CONFIRMED broker service |
| BrHostSvr.exe (PID 2640, child of BrService) | `…\servers\BrHostSvr.exe`: Company=`HP`, Desc=`HP Sure Click`, Prod=`Sure Click`; cmdline GUID session token | CONFIRMED isolated-app GUI host |
| BrEndpointSvc.exe | No such process (CIM query: NOT RUNNING; absent from tasklist) | CORRECTED: phantom — it is a *service* name, not an exe |
| BemSvc.exe (PID 7688, child of services.exe) | `…\servers\BemSvc.exe`: Company=`HP`, Desc=`HP Sure Click Endpoint Service`; registry: `BrEndpointSvc.ImagePath` = that BemSvc.exe; service `BrEndpointSvc` (`HP Sure Click Endpoint Service`) RUNNING | CORRECTED: not "Dell/HP support service" — it IS the BrEndpointSvc binary |
| uxen.sys | Driver Running, PathName=`\??\C:\Program Files\HP\Sure Click\bin\uxen.sys` (NOT System32\drivers): Company=`HP`, Desc=`uXen VMM driver`; plus Running `BrCow_4_4_33_1019` + `BrFilter_4_4_33_1019` matching install dir `4.4.33.1019` | CONFIRMED microvisor driver (location corrected) |
| Other Br\*/HP processes found | Only unrelated HP bloatware (hpsvcsscan, hpqwmiex, HPCommRecovery, HpSfuService64, HPAudioAnalytics) — HP vendor, no isolation role; no Brother printer processes at all | CONFIRMED scope (no more Sure Click components) |

## How the Brother error happened (5 lines)

1. The `Br*` prefix was matched to Brother-printer folklore (Brother uses BrYNSvc/BrStMon-style names), treating a filename prefix as a vendor identity with zero corroboration.
2. No check ever read `VersionInfo.CompanyName` — every Sure Click binary says `HP`, which alone kills the Brother theory.
3. No check followed the service linkage — `BrEndpointSvc.ImagePath` points at `HP\Sure Click\servers\BemSvc.exe`, a path that cannot be a printer utility.
4. No check looked at cmdline or drivers — `uVM0009/Stage2Image0008/--clone` plus a Running `uXen VMM driver` is a microvisor fingerprint, never a printer's.
5. Structural fix: KNOWN-map entries must cite (CompanyName + full path + service/driver linkage) and any `Br*` label must pass a "prove it is not Bromium" gate — path containing `Sure Click`/`Bromium`, `uxen` driver present, or uVM cmdline markers — before any vendor claim ships.
