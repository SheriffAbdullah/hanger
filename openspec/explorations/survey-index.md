# Survey Index — Unified Zeroth-Order Signal Inventory

Consolidates zero-memory, zero-cpu-disk-gpu, zero-power-proc-events, zero-net-containers-probes vs orders-framework. No keep/kill judgments.

## 1. Unified signal inventory (by domain)

**Memory:** Total RAM `os.totalmem` ~1ms; Available MBytes, Committed %, Pages/sec, Page Reads/sec, Pages Input/sec, Page Faults/sec, Transition Faults/sec, Pool Paged/Nonpaged Bytes, Cache/Resident Bytes, Paging File %Usage — all bundled in 1× `Get-Counter` ~150–300ms; Pagefile Base `Win32_PageFileUsage` ~100–300ms; per-proc WorkingSet/PrivateBytes `Get-Process`/tasklist ~80–200ms, Page File Bytes bundled.
**CPU/Scheduler:** `%ProcessorTime _Total`, DPC %, Interrupt %, Queue Length, Ctx switches/sec, Interrupts/sec, `% of Maximum Frequency` — bundled; per-proc User+Privileged Time +2 paths/proc; Clock vs Max `Win32_Processor` once/run cheap; MsMpEng CPU bundled.
**Disk/IO:** Per-volume Current/Avg Queue +2 paths/disk, sec/Transfer-R/W + Bytes R/W bundled with above; pagefile-vs-app volume map once + per-disk (CIM LogicalDisk + PageFileUsage).
**GPU (cheap subset):** Per-engine `_Total`-only util medium cost (never full `(*)` at ≤500ms); per-proc Local/Shared Usage medium; dwm/warp WS via tasklist cheap on-HANG; Driver+VRAM via CIM once/run.
**Power/Thermal:** Scheme `powercfg` ~200ms once/run; Plug+battery% ~300ms refresh 15–30s; `Win32_Battery`+`BatteryStatus` ~400ms once/run; AC/DC derived free; throttle via maxFreq (bundled) + clocks + ThermalZone ~400ms if visible.
**Process identity:** tasklist CSV rollup 200–500ms start/end+on-HANG; `Get-Process` (WS/PM/NPM/handles/threads/CPU/Path/Responding) ~500ms; FileDescription/Source top-8 ~400ms; `Win32_Process` PPID+CommandLine ~500ms on-HANG (redact); svchost `-s` split ~300ms; Sysmon ID1/ID5 ~500ms if installed.
**OS events/WER:** App 1000/1001/1002 + System 2004/41 ~500ms each once/run; WLAN/DNS on-demand ~500ms; WER `*.wer` scan ~400ms (counts only); RAC location note cheap.
**Network (local only):** Per-proc IO B/s med; TCP state×proc ~200ms; adapter/gateway/VPN low once/run; TcpClient-connect, ping, DNS-resolve, `psql SELECT 1`, `redis-cli PING` all low.
**Containers/WSL/DB:** `docker ps` low + `stats --no-stream` blocks (10s timeout); `wsl -l -v` low; vmmem WS via tasklist low; `.wslconfig` once; `pg_settings` shared_buffers low; Redis `INFO memory` low.
**Active probes:** `node -e` spawn ~30–80ms self-load; hrtime/setImmediate drift negligible; 1ms timer-slack negligible; `cmd /c echo` low; 1MB file-read low; keypress marks zero (TTY only, ~200ms reaction lag).

**Overlaps deduped:** (1) `% of Maximum Frequency` in cpu + power — one bundled counter. (2) `Win32_Processor` clocks in cpu + power — one once/run call. (3) `tasklist` in memory + power + gpu + net — one call, four consumers. (4) `Get-Process` WS/PM in memory + power — one call. (5) `Win32_PageFileUsage` in memory + disk — one call. (6) `Pages/sec` in memory + disk + net inferences — one signal, three readers. (7) `MsMpEng CPU` in cpu + AV-alibi — same counter.

## 2. Coverage map vs orders-framework first-order rules

**Full zeroth backing:** STALL (spawn.ms + drift + keypress); PRESSURE_COMMIT (committed %); LOW_FREE (Available MBytes); THRASH_PAGES (pages/sec + input/reads); OS_HANG (1002 rows); CPU_SAT (queue + maxFreq + clocks); DISK_STALL (per-vol queue + sec + bytes); CONTEXT_WINDOW (W±10s slices); VERDICTs (reasons[] composition).
**Thin backing:** PRESSURE_SUSTAINED (used% duration — no zeroth used% derivation); AV_ALIBI (defender % exists, disk-write join has no per-proc split); LOOP_CONF (drift only, self-block confound, supporting-only); RECOVERY_OK (next-probe delta, no independent probe); DISK_STALL attribution (per-volume split specified but not yet sampled).

## 3. Depth-probe backlog

1. Standby-cache counters (`Memory\Standby Cache*`) — separate reclaimable from true pressure; bundled Get-Counter cost.
2. Thermal zones without admin (`MSAcpi_ThermalZoneTemperature` visibility survey) — confirm throttle; ~400ms once/run.
3. Per-volume disk split (C: pagefile vs D: project queues) — attribute stall to paging vs build; +2 paths/disk.
4. Postgres runtime views (`pg_stat_activity` wait events) — distinguish cold-connect vs query stall; low.
5. Redis runtime views (`INFO stats/persistence`, evicted_keys) — fork vs eviction stall; low.
6. Timer-slack isolation (1ms overshoot vs power-throttle state) — calibrate LOOP_CONF; negligible.
7. DPC-storm isolation (DPC% + ctx + intr sustained triplet) — driver vs app-spin; bundled.
8. svchost service-group split at hang — stop blaming host aggregate; ~300ms on-HANG.
9. Sysmon spawn-burst baseline (ID1 rate at hang vs calm) — spawn stall vs leak; ~500ms if installed.
10. WER apphang history trend (counts over time, no dumps) — prior-pain prior for conf cap; ~400ms.
11. GPU per-proc local-vs-shared split at hang — media vs compositor path; medium, on-HANG only.
