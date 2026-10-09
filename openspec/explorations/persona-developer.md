# Persona: Senior Developer (Docker + Node + Playwright daily)

## 1. Story (3 lines)
I run Docker (Postgres/Redis/app), Node services, and Playwright Chromium all day on an HP ProBook i7/15.6GB; Warp/VS Code freeze 2–3s on type, deploy, or test start.
My last ticket came back with "reboot and close Chrome" because the first report did not say enough: I need a pack that shows the pressure under MY workload, not idle Task Manager screenshots, so IT can act without asking me for more.
I collect it on my own machine and hand it over; if the box is fine, tell me which container/process to fix; if not, give IT numbers they can check.

## 2. Evidence I demand

**MUST (ticket lives or dies):**
- Hang table with wall-clock + trace-pos + spawn latency: `HANG 2100ms @11:47:03 (t+42s)` — so I can say "froze during `docker compose up` / Playwright run", plus `hangRate/min`, `%time-frozen`, `spawn.p95[60s,n=30]`.
- ±10s context per hang: `commit% pre/post`, `pages/s pre/post`, `cpuQ`, `diskQ/sec`, top-3 culprits AT hang (not end-of-trace average) with MB + instance count + app label (`node.exe → Node: playwright.config.js`, `vmmem → Docker WSL2 aggregate`).
- Power truth every trace: `PLUGGED IN vs BATTERY`, scheme GUID (HP Optimized vs Best performance), `% of max frequency min` — answers the "is it just the power plan" question inside the report; plugged + still hangs = not power.
- Calm comparison in same pack: `calmShare%` + "when fine top was X MB" vs "at hang top was Y MB" — proves delta, not just a scary number.

**SHOULD (makes the first ticket complete):**
- Before/after workload splits: Docker up vs down, Chrome open vs closed, Playwright running vs idle — `committedPeak`, `pagesAvg/sustained`, `minFreeGB` per window.
- Per-container drill-down: `docker stats Name|Mem|CPU` per container (not just vmmem 2GB blob); which Postgres/Redis/app container grew.
- OS corroboration: Event 1002 (AppHang) count, WER `apphang=N/total`, non-responding list at hang, `recoveryMs/MTTR` to next `<400ms` probe.

**COULD (nice):**
- `privateTop` (commit charge, no shared-DLL double-count) alongside WS rollup; EcoQoS per hang PID (ECO vs full); GPU per-PID join for dwm/compositor blame; cost line with explicit params (`45min/day × $60/hr`).

## 3. Red flags — why a report would not be useful to IT or to me
- Single-sample counters as proof (`pages 7759/s` one spike, no sustained avg); averaged-away timeline with no n/window/cadence.
- Unknown rows (`xyz.exe 400MB`, no publisher/path/cmdline) or silent redaction without receipt (no per-name MB + filter hash).
- No power row; no calm baseline; verdict words ("RAM-BOUND", "buy 32GB") without thresholds + reasons + confounds (Defender %, throttle, prover self-block).
- Culprits only at end, not at hang; WSL/docker "absent" with no reason; missing `collection.failures[]` — gaps presented as zeros.

## 4. Pipelines Hanger must build for me
**P1 — Hang→cause pack:** inputs: `spawnProbes[2s cadence: ms, committed%, pages/s, cpuQ, diskQ/sec, maxFreq%] + on-HANG tasklist snapshot + user key-marks + powerState` → computation: threshold crossing (`≥800ms`), ±10s pre/post avgs, culprit rollup + `friendly()` identity + `cmdlineFor()` app label, RCA rank with conf + disprover → artifact: `hanger-*.json` (truth) + MD hang table + HTML spawn strip with `!` markers.
**P2 — Workload A/B:** inputs: two traces (or watch JSONL segments) tagged `docker-up/playwright-run` vs `baseline-idle` → computation: delta `committedPeak`, `pagesSustained`, `minFreeGB`, `hangRate`, per-container mem → artifact: `trend` comparison table + calm-vs-hang card for the ticket attach.
