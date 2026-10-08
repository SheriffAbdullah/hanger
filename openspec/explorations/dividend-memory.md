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
