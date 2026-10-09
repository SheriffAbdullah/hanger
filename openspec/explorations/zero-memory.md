# Zero-Memory — Zeroth-Order Memory Surface (Windows, no admin, no wmic)

## Context
Everything hanger reads unelevated before derivation. Proven in `hanger.js` + registry.

## System signals
| Signal | Collector | Unit | Cost | Admin | Confounds |
|---|---|---|---|---|---|
| Total RAM | `os.totalmem()` | GB | ~1ms | no | fixed |
| Available | `'\Memory\Available MBytes'` | MB | bundled ~150–300ms | no | cache noise; pair with committed |
| Committed | `'\Memory\% Committed Bytes In Use'` | % | bundled | no | leads used%; 80%+ = ceiling |
| Pages | `'\Memory\Pages/sec'` | pg/s | bundled | no | spikes ≠ proof; judge 5s avg |
| Page Reads | `'\Memory\Page Reads/sec'` | /s | bundled | no | hard-fault reads; SSD hides lag |
| Pages Input | `'\Memory\Pages Input/sec'` | pg/s | bundled | no | hard-fault confirm |
| Page Faults | `'\Memory\Page Faults/sec'` | /s | bundled | no | mostly soft; needs pages/sec |
| Transition Faults | `'\Memory\Transition Faults/sec'` | /s | bundled | no | <1000 normal |
| Pool Paged | `'\Memory\Pool Paged Bytes'` | MB | bundled | no | slow drift normal |
| Pool Nonpaged | `'\Memory\Pool Nonpaged Bytes'` | MB | bundled | no | monotonic = leak |
| Cache / Resident | `'\Memory\Cache Bytes'`, `'\Memory\System Cache Resident Bytes'` | MB | bundled | no | reclaimable, not pressure |
| SupervisorDriven | no such counter — drop | — | — | — | — |
| Pagefile %Usage | `'\Paging File(_Total)\% Usage'` | % | bundled | no | monotonic; start/end only |
| Pagefile Base | `Get-CimInstance Win32_PageFileUsage` | MB | ~100–300ms | no | sum multiple files |

## Per-process signals
| Signal | Collector | Unit | Cost | Admin | Confounds |
|---|---|---|---|---|---|
| WorkingSet | `Get-Process WS`; `tasklist /FO CSV /NH`; `'\Process(*)\Working Set'` | MB | ~80–200ms | no | shared-DLL double count; rank only |
| PrivateBytes | `Get-Process PM`; `'\Process(*)\Private Bytes'` | MB | ~80–150ms | no | excludes shared; verdict signal |
| PageFileBytes | `'\Process(*)\Page File Bytes'`; `VirtualMemorySize64` | MB | bundled | no | peak≠current; children inflate n |
| PageFaults | `'\Process(*)\Page Faults/sec'` | /s | bundled | no | `#n` remap — wildcard; wraps |

One `Get-Counter` covers all `\Memory\`+`\Paging File\`; never poll ≤500ms per-engine.

## Zeroth-Order Analysis (no computation)
- Committed 97% = 3% from ceiling. Avail <1500MB = pressure, <500MB = imminent stall.
- Pages >500 sustained = thrashing; one spike = ignore. Pages Input + Reads >0 = hard faults on disk.
- Faults high + pages ~0 = soft-only, healthy. Pagefile 40% = backing store active; 0% = RAM-contained.
- Nonpaged 800MB+ climbing = driver-leak suspect. Cache high + avail low = reclaimable, not pressure.
- PrivateBytes leader = commit culprit; WS-only lead = shared-memory mirage.

## First-Order Feed
- `hang.context[W=±10s]`: committed/pages/avail pre/post avg; param `W=10s`, 2s cadence.
- Pressure states: committed 75/85, avail 3000/1500, pages 200/500; thresholds per-report.
- `culprit.attribution`: PrivateBytes Δ + WS rank + co-occur; `conf=.4*share+.3*co-occur+.2*pagingAgree+.1*eventAgree`, cap .95.
- `proc.rollup`: tasklist WS grouped lowercase top-5 (`pids≤4`); start/end + on-HANG.
- RCA gate: committed>85 / pages>500; disprovers commit<70, pages<100.
