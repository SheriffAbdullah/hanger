# Dividend — tribunal verdicts (argue phase)

> Merged from the three benches. Kills stand unless the admin relitigation overturns them.
> Standing rule: capability-tiered collection (admin where elevatable, graceful skip elsewhere).

---

# Dividend Memory — Tribunal Verdict

Pain: 2–3s Warp/openspec stalls at commit 85–97%, plugged in. Keep what explains high-commit hangs with flat avail; kill vanity.

## System

| Signal | Verdict | Reason |
|---|---|---|
| Total RAM | KEEP | ~1ms once/run; denominator for MB claims. |
| Committed % | KEEP | Bundled ceiling; 85/90 gates fire here. |
| Available | KEEP | Bundled; flat-avail + high-commit = hang signature. |
| Pages/sec | KEEP | Bundled; >500 sustained = thrash proof. |
| Page Reads/sec | KEEP | Bundled hard-fault reads. |
| Pages Input/sec | KEEP | Bundled hard-fault confirm. |
| Page Faults/sec | KILL → Pages/sec + Input | Mostly soft noise. |
| Transition Faults | KILL → Pages/sec | <1000 normal, no hang signal. |
| Pool Nonpaged | KEEP | Bundled; monotonic climb = leak tell. |
| Pool Paged | KILL → Nonpaged trend | Slow drift, never gated a stall. |
| Cache/Resident | KILL → Standby + Lifetime | Reclaimable, lies about pressure. |
| Pagefile %Usage | KEEP | Bundled; 40% = paging, 0% = RAM-contained. |
| Pagefile Base (CIM) | DEFER | Extra ~200ms; start/end. |

## Per-process

| Signal | Verdict | Reason |
|---|---|---|
| WorkingSet | KEEP | Shared call; rank only. |
| PrivateBytes | KEEP | Same call; commit-culprit signal. |
| Page File Bytes | DEFER | Peak≠current; on-HANG only. |
| Per-proc Faults/sec | KILL → PrivateBytes Δ | `#n` remap pain; ΔMB cheaper. |

## Standby/cache (same bundle, zero extra calls)

| Signal | Verdict | Reason |
|---|---|---|
| Standby Normal | KEEP | Falls while commit high = trimming. |
| Standby Reserve | KEEP | Near-zero = no cushion. |
| Standby Core | DEFER | Stable unless extreme; on-HANG. |
| Modified List | KEEP | >300MB = write-back stall. |
| Standby Lifetime | KEEP | <30s = cache thrashing. |
| Shareable ≈ WS−PM | KEEP | Free; kills WS mirages (±30%). |
| SysMain + Prefetch | DEFER | Once/report; waste flag only. |

## Kept set — registry rows

| id | unit | cadence |
|---|---|---|
| mem.total | GB | once/run |
| mem.committed_pct | % | 2s trace / 15s watch |
| mem.avail | MB | 2s trace / 15s watch |
| mem.pages_per_sec | pg/s | 2s trace |
| mem.page_reads_per_sec | /s | 2s trace |
| mem.pages_input_per_sec | pg/s | 2s trace |
| mem.pool_nonpaged | MB | 15s watch + on-HANG |
| mem.pagefile_pct | % | 2s trace |
| proc.ws.top5 | MB | start/end + on-HANG |
| proc.private.top5 | MB | start/end + on-HANG |
| proc.shareable_est | MB | on-HANG |
| mem.standby_normal | MB | 2s trace |
| mem.standby_reserve | MB | 2s trace |
| mem.modified_list | MB | 2s trace |
| mem.standby_lifetime | s | 2s trace |

---

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

---

# Dividend Context — Tribunal Verdict (Power + Proc-Identity + OS-Events + Net + Container/DB + Probes)

Owner pain first: "plugged in, still hangs" must be answerable every sample; zero unknown names; local-vs-network stall must split; frozen-daemon must still yield signal.

## Verdicts — KEEP / KILL / DEFER + reason (cost × signal × confound)

**Power:** KEEP scheme GUID+name — ~200ms once/run, proves HP-Optimized cap story. KEEP plug+battery% — ~300ms, enables AC-vs-BAT refutation. KEEP Win32_Battery+BatteryStatus — ~400ms once/run, discharge-rate truth. KEEP AC/DC derived — free, feeds throttle rule. KEEP maxFreq+clocks — bundled/cheap, EC-cap detector. DEFER ThermalZone — often invisible, confirm visibility first.
**Identity:** KEEP tasklist rollup — 200–500ms, one call feeds four domains. KEEP Get-Process Responding+Path — ~500ms, only OS-confirmed hung set. KEEP FileDescription+Source top-8 + unresolved flag — ~400ms, kills unknown-name pain. KEEP svchost -s split — ~300ms on-HANG, stops host-aggregate blame. DEFER Win32_Process CommandLine depth≤3 — ~500ms + secret-redaction burden, take only on-HANG. KILL Sysmon ID1/ID5 as required — install-gated luxury; substitute tasklist spawn-delta.
**OS events:** KEEP App 1002 hang rows — ~500ms, ±60s corroboration. KEEP App 1000/1001 crash+bucket — same call batch, crash-vs-hang split. KEEP System 2004/41 — cheap, exhaustion-vs-reboot split. KEEP WER counts only — ~400ms, history-prior with no dump cost. KILL WLAN/DNS channels as routine — PII (SSID/host) × on-demand; substitute adapter/gateway enum. DEFER RAC store — location note only until reader exists.
**Network:** KEEP TCP state×proc deltas — ~200ms, TIME_WAIT churn discounted by join. KEEP SELECT 1 + redis PING — ms each, TCP-ok-but-SELECT-slow = local stall proof. KEEP adapter/gateway/VPN enum — low once/run, link-vs-port split. KEEP TcpClient-connect — cheap, port-block detector. KILL per-proc IO B/s routine — med cost + svchost/remap confound; substitute TCP+SELECT split. DEFER ping/DNS-resolve — ICMP-deprioritized + cache-hit confounds; on-demand only.
**Container/DB:** KEEP docker ps + vmmem WS — low, survives daemon freeze. KEEP wsl -l -v + .wslconfig — cheap, cap-hit story. KEEP pg_settings + Redis INFO memory — ~ms, tuned-small/evict signals. KILL docker stats routine — blocks when frozen; substitute ps+vmmem trend. KILL full docker-inspect sweep — 4 fields × containers luxury; substitute ps -a + SELECT 1/PING. DEFER pg_stat_activity/bgwriter + Redis persistence/keyspace — ~5ms but needs timeout discipline; take on-HANG only.
**Probes:** KEEP node spawn ms — 30–80ms, IS the hang. KEEP 1ms timer-slack — negligible, spawn-vs-loop splitter. KEEP echo + file-read baselines — cheap, IO-vs-spawn split. KEEP user marks — zero cost, threshold calibrator. DEFER hrtime drift — self-block confound, supporting-only. KILL --report routine — opt-in self-OOM only; substitute process.memoryUsage flat-heap check.

Luxury questioned: per-engine GPU full `(*)`, Sysmon channel, full inspect — all high-cost/low-coverage vs substitutes above.

## Kept set — registry-ready rows

`power.scheme/plugged/batteryPct/maxFreq` | `proc.rollup/identity+unresolved/svcGroup/oshung_responding[]` | `sys.event_hang/crash/exhaust/boot41 + wer_apphang_total` | `net.tcp_by_state + db.select1_ms/redis_ping_ms + link.enum` | `docker.ps/vmmem_ws/wsl_state/wslconfig + db.pg_tuned_small/redis_mem` | `probe.spawn_ms/timer_slack/echo/file_read + user.marks[]` → `hang.context[±10s]` + RCA step 5.

---

## Relitigation outcome (admin granted — deep-admin-surface.md tier table)
OVERTURNED to `tier: admin` (collect when elevatable, `admin-skipped`+reason otherwise):
thermal-zone temp (chassis caveat stands), ETW/WPR capture (opt-in `--wpr`, never
always-on), Sysmon ID1/5 read (detect-only, never install), SMART/health, MemDiag
results read (never trigger), WER system queue (user queue stays tier:user),
SeDebug process details on-HANG, sleep-study + battery-report one-shots.
UPHELD kills: RAMMap driver install (friction + HVCI — read-only counters stand);
fan speed / TCC / DTT remain UNAVAILABLE — substitute is maxFreq proxy + thermal zone.
v0.6 implements tier detection once at startup (`collection.tier` per signal).
