# Zero-Order CPU / Disk / GPU Surface (Windows, no admin)

Scope: what hanger v0.4 samples today vs what it must add. All collectors no-admin, bundled into the 1×/2s `probeBundle()` ps call unless noted.

## A. CPU / Scheduler

| Signal | Collector | Unit | Cost | Confounds |
|---|---|---|---|---|
| `%ProcessorTime _Total` | `'\Processor(_Total)\% Processor Time'` | % | bundled | 250ms aliasing; 2s avg only |
| `User+Privileged per-proc` | `'\Process(<name>*)\% User Time'`, `'\% Privileged Time'` | % | +2 paths/proc | instance `#n` remap — wildcard |
| `DPC + Interrupt %` | `'\Processor(_Total)\% DPC Time'`, `'\% Interrupt Time'` | % | bundled | small % normal; judge sustained |
| `Queue length` | `'\System\Processor Queue Length'` | threads | bundled | single-sample noisy |
| `Ctx switches` | `'\System\Context Switches/sec'` | ctx/s | bundled | scales w/ cores |
| `Interrupts+DPCs queued` | `'\Processor(_Total)\Interrupts/sec'`, `'\System\Processor Queue Length'` proxy; `'\Processor(_Total)\DPCs Queued/sec'` | /s | bundled | DPC storms inflate ctx |
| `% of Max Frequency` | `'\Processor Information(_Total)\% of Maximum Frequency'` | % | bundled | EC/thermal caps |
| `Clock vs Max` | `Get-CimInstance Win32_Processor \| CurrentClockSpeed,MaxClockSpeed` | MHz | once/run, cheap | VM reports host MHz |
| `MsMpEng CPU` | `'\Process(MsMpEng*)\% Processor Time'` | % | bundled | AV bursts legit |

## B. Disk / IO (split volumes)

| Signal | Collector | Unit | Cost | Confounds |
|---|---|---|---|---|
| `Current queue / Avg queue` | `'\PhysicalDisk(<N>)\Current Disk Queue Length'`, `'\Avg. Disk Queue Length'` per-instance, not `_Total` | ops | +2 paths/disk | SSD hides latency; queue=0 → sec meaningless |
| `Latency xfer + R/W` | `'\Avg. Disk sec/Transfer'`, `'\Avg. Disk sec/Read'`, `'\Avg. Disk sec/Write'` per disk | s | bundled w/ above | judge only when queue>0 |
| `Bytes R/W` | `'\Disk Read Bytes/sec'`, `'\Disk Write Bytes/sec'` per disk | B/s | bundled | pagefile I/O identical to app I/O |
| `Pagefile vs app volume` | `Get-CimInstance Win32_PageFileUsage` (volume) + `Win32_LogicalDisk` map; sample per-disk counters on each volume separately | — | once + per-disk | must split: C: pagefile vs D: project |

## C. GPU (cheap subset only)

| Signal | Collector | Unit | Cost | Confounds |
|---|---|---|---|---|
| `Per-engine util _Total only` | `'\GPU Engine(*_engtype_Total)\Utilization Percentage'` filter `*_Total` | % | medium; NEVER per-engine `(*)` at ≤500ms — expensive | 3D vs Copy vs VideoDecode differ |
| `Per-proc GPU mem` | `Get-Counter '\GPU Process Memory(*)\Local Usage'`, `'\Shared Usage'` | MB | medium; instance-name remap | pid reuse; sum local+shared |
| `dwm / warp MB` | `tasklist /FO CSV` rollup `dwm.exe,warp.exe` | MB WS | cheap, on-HANG | WS includes shared |
| `Driver + VRAM` | `Get-CimInstance Win32_PnPSignedDriver` (display) `DriverVersion`; `Win32_VideoController AdapterRAM,DriverVersion` | str/MB | once/run | AdapterRAM wraps at 4GB on old drivers |

## D. Direct inferences

- `DPC%>5 sustained + ctx>10k + low app-CPU at hang = driver/DPC storm`, not app spin.
- `cpuQ>4 sustained + %maxFreq>90 = true saturation`; `cpuQ>4 + %maxFreq<60 on AC = throttle alibi`.
- `diskQ>2 sustained + sec>0.025 = disk stall`; `sec>0.025 but queue=0 = idle-sample noise, ignore`.
- `high disk bytes on pagefile volume + pages/sec>500 = paging-backed stall`; same bytes on app volume only = build/AV scan.
- `GPU _Total>70 + dwm growth = compositor pressure`; `per-proc local>>shared + VideoDecode high = media path`.
- `defender>20% at hang + disk-write burst = AV alibi`.

## E. FIRST-ORDER FEED (add to bundle)

`cpu.dpc_pct, cpu.intr_pct, cpu.user_priv_<group>, cpu.pct_maxfreq, cpu.clock_mhz, disk.queue_<vol>, disk.sec_r/w_<vol>, disk.bytes_rw_<vol>, pagefile.vol, gpu.total_<eng>, gpu.local_<proc>, gpu.shared_<proc>, dwm_MB, gpu.driver, gpu.vram_MB` — all `{id,value,unit,windowS:2,n:1,conf}`.
