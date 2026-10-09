# hanger v0.7 tasks

- [x] 1. Add `COLLECTORS` weight registry table in `hanger.js` (one row per existing collector: weight light|heavy, budgetMs, policy) — verify: `node hanger.js --help` prints the table.
- [x] 2. Add per-probe weight accounting (`weightMs` per collector + `degraded[]` reasons on the probe object) to trace-loop JSON — verify: 30s smoke trace shows `weightMs` keys on every probe.
- [x] 3. Generalize melting-box auto-degrade: loop checks live `slipS>2`/`snapMs>2000`/`bundleMs>1000` each probe and defers heavy / skips calm-only collectors with reason — verify: smoke trace with `--hang 1` shows `degraded` reasons, no crash.
- [x] 4. Route on-HANG EcoQoS + Responding + snapshot through the policy gate (defer-post-trace when melting, not just the tasklist branch) — verify: forced-hang smoke run records `ecoDeferred`/`snapshotDegraded` via the gate.
- [x] 5. Add `collection.failures[]` schema (`inference, collector, mode, reason`) and route every existing `catch`/skip site into it — verify:Disconnect-network + unelevated smoke run lists failures, exit 0, valid JSON.
- [x] 6. Implement terminal state: zero-usable-samples run still writes valid JSON+MD (`verdict: insufficient-evidence`, failures listed) and exits 0 — verify: stub a run with all collectors failing, outputs parse.
- [x] 7. Write `tools/hanger/mac-stub.json` with ~14 entries (`inference, type/shape, windows-collector, mac-probe, green_when`) matching the portability-layer catalog — verify: `node -e "JSON.parse(fs.readFileSync(...))"` parses, 14 entries.
- [x] 8. Implement `node hanger.js check-stub` mode validating the current machine against the stub (per-inference green/red + summary count) — verify: `check-stub` on Windows prints 14/14 (or lists reds with reasons).
- [x] 9. Wire stub greens to the weight registry (each `check-stub` inference maps to a registered collector, no orphan entries) — verify: `check-stub --strict` fails if any stub entry lacks a registry row.
- [x] 10. Full smoke: `watch` 30s + `trace` 60s + `check-stub` all pass on Windows with no new collectors and no schema break for existing JSON consumers — verify: all three commands exit 0.
