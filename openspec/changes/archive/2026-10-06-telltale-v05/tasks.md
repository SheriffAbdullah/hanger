# Tasks — telltale-v05

- [x] Rival dives 7/7 landed, convergence table in proposal.md
- [x] `watch` mode: 2s loop (bundle, no spawn probes) → JSONL baseline with 5MB rotation + `--watch-secs` exit, pressure hint + streak count at exit
- [x] `proc.friendly`: KNOWN map + FileDescription fallback (Get-Command, then live-process path) + `unresolved` flag
- [x] Power truth: `power.plugged`, `power.battery_pct`, scheme, `%maxFreq` in bundle (powerState L111-121; scheme L165; maxFreq/pagesIn/pagefile in probeBundle L211-213,232-234; per-probe plugged/batteryPct L273, refresh L288)
- [x] Calm windows in pack (green summary: min/avg/max + top) (calmProbes/calmShare L374-375; calmSharePct L440; md row L487)
- [x] `wer` archive counts (total + AppHang, global — per-bucket grouping deferred v0.6) + `hang.os_confirm` (`Responding` poll on-HANG, poll ms recorded)
- [x] `Pages Input/sec` + pagefile% mid-run; `Pages/sec` stays for trend (probeBundle paths L204-205,212-213; parsed L225,233-234)
- [ ] Deferred to v0.6 (opt-in/admin): `--wpr`, `--dump`, net split, DEX score, self-baseline 2σ, proc.tree, timer-slack probe, fault-buckets (none in telltale.js; only WER counts comment L376)
- [x] `rca[]` provisional ranked RCA per hang w/ conf + disprover (L412-424, report L453)
- [x] `bundleOk` probe health (`bundleOk/bundleOkProbes` L331,L442)
- [x] cost params `--cost-min/--cost-rate` + costNote/costParams (L408-411, summary L449-450)
- [x] self-load accounting `bundleMs`/`snapMs`/`respondMs`/`slipS` per probe
- [x] `privateTop` Private Bytes top-12 groups (L308-310, report L455)
- [x] `userMarks[]` keypress ground truth (onKey/userMarks L243-254, report L454)
- [x] Smoke: `watch` 12s (6 rows, exit+rotation+streaks OK) + `trace` 10s (commit 97%, pages 86k/s, RAM-BOUND) + review gate HOLD fixed (num+bundle hoist, watch exit/rotation, respondMs, transFaults, proc-path fallback, context pre/post, spec v0.6 deferrals)
