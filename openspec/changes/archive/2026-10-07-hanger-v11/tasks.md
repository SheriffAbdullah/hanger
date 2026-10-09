# Tasks — hanger-v11 (+ review gate fixes)

- [x] 1. `gpuEngines` collector: per-PID % grouped by `pid_N`; absent counters → `unavailable` gap. (No-driver RED path untested — needs Basic-Display box.)
- [x] 2. Keep 2s bundle `_Total`-only GPU sample (cheap path, no `(*)` poll). Verified honest-null on WDDM (no _Total instances); 60s p95 baseline not run.
- [x] 3. `gpuMem` collector: `\GPU Process Memory(*)\Local Usage` per PID. Stub green with MB + `n` on WDDM2+.
- [x] 4. nvidia-smi parse-only fallback, never bundled. Present/absent with reason.
- [x] 5. Inferences in hang context + culprits (dwm/warp attribution). Forced-hang JSON has gpu fields with `n`. (Live `gpuAtHang` never fired — box always melts; needs calm hang.)
- [x] 6. COLLECTORS + mac-stub entries. `--strict` passes, `--help` lists weights.
- [x] 7. Honesty: every GPU row carries `n`; zero never emitted. No-driver grep pending (same box limitation as #1).
- [x] Gate fixes: byPid maps scrubbed against hide/scope (+fail receipt); multi-GPU sum documented.
