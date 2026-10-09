# Change: hanger-v06 — dividend winners + admin tiers

## Why
Tribunal (`dividend.md`) + admin relitigation settled what to collect. v0.5 lacks:
kept memory signals (standby tiers, modified list, lifetime, pool-nonpaged),
DPC/Interrupt alibi in the bundle, EcoQoS per-process state, tiered admin
collection, and first-order params from the orders catalog.

## What Changes
- Bundle: +% DPC Time, % Interrupt Time, Standby Normal/Reserve/Core, Modified
  Page List, Standby Lifetime, Pool Nonpaged (all `Get-Counter`, no admin)
- Tier detection at startup; admin tier: thermal zone, Sysmon read, SMART,
  MemDiag results, WER system queue, SeDebug details, sleep/battery one-shots
- EcoQoS per-process capture on-HANG; `--wpr` opt-in whole-trace ETW capture (admin only)
- First-order params externalized (`--hang/--commit/--pages/...`) + ideal-TBD table
- Specs updated: metrics/tracking SHALLs promoted from v0.5 deferrals where now true
