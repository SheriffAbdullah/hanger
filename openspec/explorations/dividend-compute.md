# Dividend Compute — CPU / Disk / GPU / Thermal Verdict

Pain: prove hangs are memory-pressure, not CPU/throttle/disk/GPU. Key alibi: HP Optimized EC+DTT caps maxFreq even with Best Performance selected — `cpuQ>4 + maxFreq<60 on AC` exonerates CPU, points at paging. Verdict per signal (cost×signal×confound); kills name substitute.

## CPU / Scheduler
- `%ProcessorTime _Total` — KEEP: bundled, refutes app-spin.
- `User+Privileged per-proc` — KEEP (top-8): +2 paths/proc; `#n` remap via rollup.
- `DPC% + Interrupt%` — KEEP: bundled driver-storm alibi (`>5%` sust.).
- `Processor Queue Length` — KEEP: bundled CPU_SAT input (`>4`).
- `Context Switches/sec` — DEFER (hang-triplet): bundled, scales w/ cores, useless alone.
- `Interrupts/sec + DPCs Queued/sec` — DEFER (hang-triplet): judges only with DPC%+ctx.
- `% of Maximum Frequency` — KEEP: bundled throttle alibi, EC/DTT proxy.
- `Clock vs Max (Win32_Processor)` — KEEP: once/run; Max=base ~1700MHz, Current>Max=turbo.
- `MsMpEng CPU` — KEEP: bundled AV_ALIBI (`>20%`+write burst).

## Disk / IO (per-volume split mandatory)
- `Current/Avg Queue per-vol` — KEEP: +2 paths/disk, DISK_STALL half (`>2`).
- `sec/Transfer+Read+Write per-vol` — KEEP: bundled; ignore when queue=0.
- `Bytes R/W per-vol` — KEEP: bundled; pagefile-vol bytes + pages>500 = paging stall.
- `Pagefile-vs-app volume map` — KEEP: once/run CIM; C:-pagefile vs D:-project attribution.

## GPU (cheap subset)
- `Per-engine _Total only` — DEFER (on-HANG): medium; never full `(*)` at 2s.
- `Per-proc Local+Shared` — DEFER (on-HANG): medium + pid-reuse.
- `dwm/warp MB (tasklist)` — KEEP: cheap on-HANG, refutes compositor.
- `Driver + VRAM (CIM)` — KEEP: once/run provenance.

## Thermal / Throttle (deep dive: no-admin truth)
- `MSAcpi_ThermalZoneTemperature` — KILL → `%maxFreq` proxy: Access Denied w/o admin, stale skin sensor.
- `Win32_TemperatureProbe` — KILL → `%maxFreq`+clocks: NULL on ACPI laptops.
- `LHM/OHM die temp` — KILL → out-of-band BYO JSON: needs WinRing0 driver+admin.
- `Intel DTT` — KEEP (presence `Get-PnpDevice *DTT*` once): `DTT+maxFreq≈45% on HP Optimized`=EC-cap proof.
- `Per-proc throttling (P/Invoke top-8 on-HANG)` — KEEP: same-user, proves OS slowed target.
- `EcoQoS/EXECUTION_SPEED` — KEEP: bundled above; `eco=1`=deprioritized, clear first.
- `Fan speed` — KILL → `fan=unknown(ec)`+maxFreq: Win32_Fan NULL, EC-controlled.
- `TCC/clock-stretch` — KILL → `capped (cause unresolved)`: MSR/ETW need admin.
- `Battery-vs-AC caps` — KEEP: cached plug+scheme+AC/DC baselines; proves HP override.
- `Modern Standby` — DEFER (506/507 on-HANG): residency% needs admin `/sleepstudy`.

## Kept set (registry-ready)
`cpu.total_pct|PDH|% 2s` · `cpu.user_priv_top8|PDH|% 2s` · `cpu.dpc_pct,intr_pct|PDH|% 2s` · `cpu.queue|PDH|threads 2s` · `cpu.pct_maxfreq|PDH|% 2s` · `cpu.clock|CIM|MHz once` · `av.defender|PDH|% 2s` · `disk.queue,sec,bytes_vol|PDH per-vol|ops/s/B 2s` · `disk.pagefile_vol|CIM|str once` · `gpu.dwm_MB|tasklist|MB hang` · `gpu.driver,vram|CIM|once` · `throttle.exec,eco|P/Invoke top-8|flags hang` · `power.plug,scheme,acdc,dtt|PowerStatus+powercfg+Pnp|cached`
