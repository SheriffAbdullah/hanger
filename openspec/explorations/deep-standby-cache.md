# Deep Standby Cache — File-Cache + Standby-List Pressure (No RAMMap, No Admin)

Extends `zero-memory.md`: when reclaimable stops being free.

## Counters (one `Get-Counter` bundle, ~150–300ms, no admin)

| Signal | Exact counter | Cost | Direct inference |
|---|---|---|---|
| Standby Normal | `\Memory\Standby Cache Normal Priority Bytes` | bundled | File-cache bulk. Falling while commit high = active trimming. |
| Standby Reserve | `\Memory\Standby Cache Reserve Bytes` | bundled | Near-zero = no cushion before repurpose. |
| Standby Core | `\Memory\Standby Cache Core Bytes` | bundled | Should be stable. Collapse = extreme pressure. |
| Modified list | `\Memory\Modified Page List Bytes` | bundled | Dirty pages awaiting write. >200–500MB sustained = write-back stall; disk/pagefile bottleneck. |
| System cache resident | `\Memory\System Cache Resident Bytes` | bundled | Kernel file-cache resident. Shrinking = OS sacrificing cache to protect commit. |
| Standby lifetime | `\Memory\Long-Term Average Standby Cache Lifetime (s)` | bundled | Cache half-life. **<30s = cache thrashing**; >300s healthy; 30–300s degrading. |

All are `\Memory\` — same sample as zero-memory's committed/avail/pages; zero extra calls.

## Shareable estimate: WorkingSet − PrivateBytes

- Method: `shareable ≈ WorkingSet64 − PagedMemorySize64` (`Get-Process WS/PM` or `\Process(*)\Working Set` minus `\Process(*)\Private Bytes`; ~80–200ms, no admin).
- Inference: large shareable + small PrivateBytes = WS-leader mirage (shared DLLs/mapped files). Large PrivateBytes = real commit culprit.
- Error bars: **±20–40% per process.** Double-counts shared DLLs across processes (never sum); includes shareable-but-dirty pages; misses file-backed private mappings. Rank only; report `shareable~XMB (±30%)`.

## SysMain (SuperFetch) + Prefetch state

- API: `Get-Service SysMain` (~20ms) + `HKLM\...\PrefetchParameters\EnablePrefetcher` (0–3; 3 = app+boot, 0 = off). Read needs no admin.
- Inference: SysMain Running + lifetime<30s = prefetcher filling cache that pressure instantly evicts (wasted I/O, inflates Page Reads/sec). Stopped + short lifetime = pure workload thrash. Changing it needs admin — observe only.
- Feed: log `sysmain:{running|stopped} prefetch:{0-3}` once per report; `prefetchWaste = sysmainRunning && lifetime<30s`.

## Why Available lies while commit screams

Trim path: commit pressure → OS repurposes standby → standby drops → Available (includes standby) stays flat or rises. So Available 3000MB + committed 93% + lifetime <30s = eating cache to survive; next is Modified growth, then hard faults. Gate on committed + lifetime, never Available alone.

## EmptyStandbyList.exe — ethics

- What it does: purges standby/modified lists, forcing cold cache. Disturbance: destroys lifetime counter, spikes Page Reads/sec, makes post-purge look catastrophically worse.
- Rule: **do NOT recommend routine use.** Confound only: lifetime cliff to ~0 + standby step to near-zero mid-capture → flag window invalid (`standbyPurged:suspected`), exclude from thrash verdict. Only valid as explicit-consent before/after experiment, never a "fix."

## First-Order Feed

- `cache.pressure`: sample standby-normal/reserve/core + modified + lifetime at same cadence as `hang.context` (2s, W=±10s). Emit `lifetimeAvg`, `standbyDropRate MB/s`, `modifiedAvg`.
- RCA join: `cacheThrash = lifetime<30s && standbyDrop>50MB/s`; `writeStall = modified>300MB sustained`; disprovers: `lifetime>300s`, `modified<50MB`.
- `culprit.attribution` upgrade: down-weight WS-only leaders by shareable estimate (`conf −= 0.15 if shareable>60% of WS`).
