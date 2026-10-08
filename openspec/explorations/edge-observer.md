# Edge cases: the observer problem

When the box hangs, observation itself costs. Rule: light path always, heavy path only when affordable. `watch` = light (2s RAM + one `probeBundle` Get-Counter, no spawn/lag/snapshot). `trace` = heavy (2s `node -e` spawn probe + bundle + on-HANG tasklist/EcoQoS/Responding + WPR/admin). If the machine cannot be observed at all, that IS the signal — record the gap, don't fill it.

## 1. Similar problems elsewhere (one line each)

- Heisenberg/profiler effect: instrumenting changes timing; lesson: measure spawn cost AFTER the signal, never inside it (bundle runs after `lat`, telltale.js:399-403).
- eBPF overhead budgets: kernel tracers cap instructions + drop on overload; lesson: cap snapshot (top-3, 6 PIDs) and skip rather than queue.
- ICU monitor alarms: alarming drains the nurse it warns; lesson: observer budget — `slipS`/`bundleMs`/`snapMs`/`ecoMs` are first-class fields, alert on them.
- Flight-recorder ring buffers: always-on light ring, dump heavy on trigger; lesson: `watch` JSONL is the ring, `trace`/WPR dumps only on pressure.
- Watchdog timers: the checker must not depend on the checked; lesson: external wall-clock `slipS` (Date.parse − traceT0 − tSec) detects grid stall even when the loop is frozen.
- GC safepoint bias: stop-the-world pauses cluster samples at safepoints; lesson: spawn probes bias toward schedulable moments — cross-check with `osHungWindows` (Responding=false) + user marks.
- Nyquist for 60s hangs: 2s grid resolves ≥4s features, aliases sub-second spikes; lesson: 50ms lag timer fills the gap statistically (p95), never claim per-spike attribution.

## 2–3. Edge catalog: detect + policy

1. Box too loaded to spawn (tasklist 5.3s observed): detect `sh` timeout/code≠0 or `snapMs`>2000. Policy: DEGRADE — skip re-snapshot while `lastSnapMs`>2000, keep PIDs; flag `collection.snapshot=skipped-overload`.
2. Observer exceeds 2s grid (slip 146s observed): detect `slipS`>2 on any probe, or `bundleMs`>1000 sustained. Policy: FLAG — keep the row (gap is data), mark `slipS`, widen context window W; never interpolate hangs across the gap.
3. EcoQoS compile per-hang cost (~2s first Add-Type per process): detect `ecoMs`>1500. Policy: DEGRADE — batch post-trace to one compile/run (v0.6.1), cap 6 PIDs; on-HANG record `ecoQoS={deferred}` if box melting.
4. WPR trace fills disk: detect target-drive free<2GB before `--wpr` start, stop on write error. Policy: SKIP — refuse start with reason, `wprEtl=null`; stop session in finally/interrupt handlers so no session leaks.
5. Admin prompt absent (headless/standard user): detect `TIER=user` (not elevated). Policy: SKIP gracefully — `collection.tier=user`, `admin.skipped` + reason, same schema; `--wpr`/thermal/SMART off, never hard-fail.
6. Counters missing (N editions, specific builds, localized names): detect `probeBundle` field null/absent (bundleOk count). Policy: DEGRADE — null with reason per field, verdicts requiring it become `unknown`, never 0.
7. Clock jumps (NTP/sleep) break tSec joins: detect `slipS` negative jump or wall−monotonic divergence >5s. Policy: FLAG — join context windows on monotonic `tSec`, keep wall `at` for display only; mark `clock=jump-suspect`.
8. User marks with zero detected hangs (false negative): detect `userMarks.length>0` AND `hangs==0`. Policy: FLAG — report recall miss explicitly (`spawn<800 but felt-hang`), lower `--hang` candidate for calibration; never move the threshold silently.
9. All-green trace (calm proof vs insufficient load): detect 0 reasons + `slipS`≈0 + `bundleMs` nominal. Policy: DISTINGUISH — `calmShare%` + green-window tops + power state = calm proof ONLY if load existed (top-group MB, cpuPct, user session active); else label `insufficient-load — rerun under real workload`, never VERDICT OK as capacity proof.
