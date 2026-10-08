# Portability layer: collectors (OS-specific) vs inferences (universal)

## 1. Audit: where telltale.js mixes vs separates

Mixed (collector + inference fused):
- `probeBundle()` (L170–230): one `Get-Counter` call hardcodes Windows paths AND maps them to universal keys (`committed`, `pages`, `cpuQ`) via `p.includes(...)`. Names are portable, parsing is Windows-locked.
- `powerState()` (L154–164): `SystemInformation::PowerStatus` directly returns universal `plugged/batteryPct`. Same for `powercfg /GETACTIVESCHEME` (L342).
- `friendly()`/`filedescFor()` (L134–152): universal "who hoards RAM?" fused to `Get-Command`/`FileDescription` + `KNOWN` exe map. Mac needs bundle-id lookup, same output.
- `ecoQoS()` (L261–272): universal `power.throttled` embedded in C# `GetProcessInformation` P/Invoke.
- `adminSnapshot()` (L237–259): thermal/health inferences fused to `MSAcpi_ThermalZoneTemperature`, `Get-PhysicalDisk`, WER queue.
- Verdict/RCA (L541–580): portable logic (`committed≥TH.commit`, `pagesPeak`, `cpuQ>queue`) computed directly off Windows keys — non-portable inputs.

Separates (keep pattern):
- `parseTasklist()`+`rollup()` (L95–120): parse vs group; only `tasklist CSV` source is Windows.
- `hangEvents`/context/MTTR (L483–515): pure over `{ms, tSec, committed, pages, cpuQ}` — OS-independent.
- `sh()`/`ps()` (L64–89): exec boundary isolated; adapters replace bodies.

## 2. Canonical INFERENCE catalog (`id: type — definition`)

1. `power.on_wall_power: bool|null` — AC=true, battery=false, null=unknown.
2. `power.battery_pct: 0–100|null` — charge; null on desktop/unknown.
3. `power.throttled: bool` — maxFreq<60% on AC or EcoQoS=ECO at hang.
4. `mem.pressure: none|watch|severe` — committed<75 & free>3GB→none; committed≥85 or free<2GB→severe.
5. `mem.committed_pct: float` — Σ private commit / (RAM+pagefile) ×100.
6. `mem.thrashing: bool` — pages-in>500 sustained 5s avg (spike≠proof).
7. `cpu.saturated: bool` — run-queue>4 sustained; spin (cpu%~100) vs I/O-wait (cpu% low + hang).
8. `disk.stalled: bool` — sec/transfer>0.025 AND queue≥1 (queue=0→false).
9. `proc.top_hoarders[]: [{key, friendly, mb, n, pids≤4, source}]` — verdict on private/commit; WS rank only.
10. `proc.identity_unresolved: int` — top-5 without friendly name; 0-or-flagged.
11. `hang.events[]: [{at, tSec, ms≥HANG_MS, ctx±10s}]` — spawn probe ≥threshold + pre/post slices.
12. `hang.os_confirmed: bool` — Win `!Responding`/Ev1002; Mac spindump/hang sentinel.
13. `sys.os_events: {hangs, crashes, exhaustions}` — last-5 rows each.
14. `container.state: text|null` — docker/vmmem; best-effort, never gates verdict.

## 3. Collector-mapping table shape

| inference | windows-collector (today) | mac-collector (TBD, candidates) |
|---|---|---|
| `power.on_wall_power/battery_pct` | `SystemInformation.PowerStatus` | `pmset -g batt`; `ioreg -rn AppleSmartBattery` |
| `power.throttled` | `% of Maximum Frequency` + `ecoQoS` | `powermetrics -s cpu_power` (sudo); thermal-pressure API |
| `mem.committed/pressure` | `\% Committed`, `Available MBytes` | `vm_stat` pages/`hw.memsize`; `memory_pressure` |
| `mem.thrashing` | `Pages/sec`, `Pages Input/sec` | `vm_stat pageouts` Δ; `powermetrics vm` |
| `cpu.saturated` | `Processor Queue Length` | `top -l1` loadavg; `powermetrics --samplers cpu_power` |
| `disk.stalled` | `Avg sec/Transfer`+queue | `iostat -d`; `fs_usage` stall spans |
| `proc.top_hoarders` | `tasklist CSV` + `Get-Process PM` | `ps -axm -o pid,rss,comm` + `footprint`; `top -l1 -o mem` |
| `hang.events` | `node -e ""` spawn 2s | same spawn probe + `spindump` on-hang |
| `sys.os_events` | `Get-WinEvent` 1002/1000/2004 | `log show --predicate hang`; DiagnosticReports listing |
| `container.state` | `docker ps/stats`, `wsl -l -v` | `docker ps/stats`; colima/lima check |

Contract: `collectors/<os>/<inference>.js → {value, unit, windowS, n, collector}`; inferences consume only that.

## 4. Mac test-stub spec (fixture every future Mac collector must satisfy)

```json
{ "inference": "power.on_wall_power", "type": "boolean|null",
  "mac_probe": "pmset -g batt | ioreg AppleSmartBattery", "expect": "AC→true / discharging→false" }
```

Full stub = one entry per §2 id: `{inference, type/shape, mac_probe, expect, green_when}`. Key gates: `mem.pressure`≈Activity pressure color ±1; `top_hoarders` Σ≈used ±10%; `hang.ctx` ±10s non-null; `disk.stalled` queue=0→false. Mac agent fills `collectors/darwin/*` until `node test-stub.js --os darwin` prints 14/14 green without touching `inferences/`.

## 5. Refactor plan (smallest-first)

1. Extract `sh/ps→exec/win.js` + `exec/darwin.js` stub (`{skipped, reason}`).
2. Move `probeBundle` map to `collectors/win/mem_cpu_disk.js`; same return keys.
3. Move `powerState/ecoQoS/filedescFor/adminSnapshot` to `collectors/win/`; dispatcher `collectors/index.js` on `os.platform()`.
4. Move verdict/RCA/hang-context (L464–580) to `inferences/`; schema-assert adapter output.
5. Add `collectors/darwin/` + `test-stub.js`; port order: power → mem → proc → hang → events.
