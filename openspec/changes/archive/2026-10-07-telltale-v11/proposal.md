# telltale-v11 — per-process GPU attribution

## Why
GPU stalls (dwm compositor, warp, Chromium) are invisible: registry tracks only
`gpu.total_util` / `dwm_MB` via `_Total`-only cheap path, and per-engine `(*)`
polling is banned EXPENSIVE (registry §A, ontology #9 run-when-calm-only).
Task Manager's own source — `\GPU Engine(*)\Utilization Percentage` grouped by
`pid_N` + `\GPU Process Memory(*)\Local Usage` — needs no admin (WDDM2+) and
answers "which PID held the engine during the hang". Absent counters (no WDDM2
driver, headless) are a recorded gap, never zero. mac-stub.json has no GPU
entries today.

## What Changes
- New collector `gpuEngines`: parses `pid_N` instances from
`\GPU Engine(*)\Utilization Percentage`, aggregates % per PID; `_Total`-only
sample stays in 2s bundle (cheap path).
- New collector `gpuMem`: `\GPU Process Memory(*)\Local Usage` per PID.
- Parse-only `nvidia-smi --query-gpu --format=csv` fallback; never bundled.
- New inferences `gpu.util_per_proc`, `gpu.vram_per_proc` → hang context ±10s +
culprit attribution (dwm/warp share); rows carry `n` samples; absent driver →
`unavailable` + reason. Weight: per-PID aggregation on-HANG/end only.
