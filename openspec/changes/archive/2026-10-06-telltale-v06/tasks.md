# Tasks — telltale-v06

- [x] Bundle+: DPC/Interrupt %, standby tiers, modified list, lifetime, pool-nonpaged (+transFaults, pagesIn, pagefile, maxFreq)
- [x] Tier detection (`collection.tier` per signal, graceful `admin-skipped`)
- [x] Admin tier: thermal zone, Sysmon read, SMART, MemDiag results, WER sys queue,
      SeDebug details, sleep/battery one-shots (`--deep-admin`); `--wpr` opt-in capture
- [x] EcoQoS per-process on-HANG (P/Invoke, PSTypeName guard, cost recorded); provisional RCA kept
- `--wpr` captures whole-trace ETW opt-in (admin only; proposal text corrected from earlier 15s sketch)
- [x] First-order params externalized (`--hang/--commit/--min-free/--pages/--queue/--disk-sec/--defender/--recovery`) + ideal-TBD table in orders-framework
- [x] Smoke unelevated: trace 10s (2x HANG ~3s @ commit 92-94%, tier=user graceful)
- [x] Re-review fixes verified in JSON (standby tiers/dpc/pagesIn/pagefile populate, thresholds recorded)
- [x] Light-observer fix: adaptive snapshot (Get-Process path when melting), EcoQoS batched post-trace, verified (snap 1999ms kept, batch 7s off-path)
- [x] Smoke elevated (owner 60s run: tier=admin, 5 HANGs, 2 user-marks, thermal/SMART/SeDebug live)
