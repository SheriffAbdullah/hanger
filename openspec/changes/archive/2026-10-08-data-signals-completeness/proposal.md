# Proposal: data-signals-completeness

## Why

The tool cannot name the process that saturated CPU or disk at a hang. It has no
temperature time series. Its throttle signal reads "100% of max" while a turbo laptop is
clamped to base clock. Battery % is always null, and check-stub then states the false fact
"desktop/no battery" on a laptop. Commit is stored only as a ratio. Defender CPU is
per-core scaled (79-190%) and compared with a 20% threshold. Network, GPU totals,
disk throughput, and the Windows 11 power-mode overlay are missing (R02-P0-3, R02-P0-4,
R02-P0-5, R01-P1-4). These are the owner-named visuals (RAM, CPU, GPU, temperature,
plugged-in vs battery, disk), and the diagnosis rules in waves 5-6 consume them.

## What Changes

- Per-process CPU (% of the whole machine, 0-100) and disk read/write rates for in-scope
  groups and the always-monitored system set, plus one anonymous out-of-scope aggregate.
  All of it goes through the scope resolver from `software-inventory-and-scope`.
- Security and system component activity (security software, memory compression, Search
  indexer) stored as a share of the machine with the logical CPU count beside it.
- A temperature time series per labelled zone (°C) at the user tier wherever the platform
  exposes it. Implausible readings are dropped and counted. GPU temperature is recorded
  when exposed. Otherwise the value is null with a reason.
- Turbo-aware performance % (can exceed 100), performance-limit %, and throttle reasons.
- Committed bytes and commit limit as absolute values. Pages input/s and pages output/s
  as separate series. Pagefile usage % per sample.
- Disk latency in ms, queue, busy %, and read/write throughput.
- Aggregate network throughput and errors per active adapter, plus VPN-adapter presence.
  No per-process network data.
- GPU utilization and VRAM when exposed. A total is derived when the platform exposes
  none. Per-process GPU data is collected only on trigger, only for in-scope PIDs, with
  its poll cost recorded.
- System-wide handle count.
- Power truth: battery % parser fix, as-of time per power value, AC/battery transitions
  with time, scheme friendly name, power-mode overlay and energy-saver state per sample.
  check-stub must never state "no battery" when a battery exists.
- **BREAKING (JSON):** removes the EcoQoS post-trace batch and its hang-row fields
  (`ecoQoS`, `ecoDeferred`, and the `eco` probe weight). The removal is recorded in a dated `2.x`
  changelog section; v2 is a draft until report-and-visualization freezes it (IMPLEMENTATION-PLAN §2). See design.md Migration for how this coordinates with the
  version already in effect.
- Rewrites two `metrics` requirements and one `tracking` requirement at the datum level,
  removing collector/API names (R01-P2-1).

## Capabilities

### New Capabilities
- (none; all requirements extend existing capabilities)

### Modified Capabilities
- `metrics`: ADDED per-process CPU/I/O, normalized component activity, temperature,
  turbo-aware throttle, commit bytes, paging direction, disk, network, GPU, and handle
  count. MODIFIED "Power and backing-store alibis" and "App/process rollups with friendly
  names".
- `tracking`: MODIFIED "Power truth per sample".

## Impact

- Code: new `tools/hanger/lib/collectors/*.js` (one module per signal family),
  registered through the collector registration interface of
  `sampling-engine-and-provenance`. `hanger.js` changes only at registration and to
  remove EcoQoS. `check-stub` battery wording. `mac-stub.json` entries for the new
  inferences.
- Schema: new per-sample series and summary fields in `SCHEMA-CHANGELOG.md`. EcoQoS
  fields are removed.
- Depends on: `fix-report-integrity` (timebase, null-not-zero), `software-inventory-and-scope`
  (resolver, system set), and `sampling-engine-and-provenance` (registration, provenance
  record, budget).
- Consumed by: `diagnosis-engine-rebuild`, `diagnosis-cause-rules` (throttle, hard-fault
  thrash, DPC, GPU), and `report-and-visualization` (charts).
- Parallel with `workload-session-and-containers` (wave 4). Neither edits the sampler core.

## Findings addressed

- R01-P1-3a: datum for throttle (turbo-aware performance/limit) now exists. The ranking rule is in diagnosis-cause-rules.
- R01-P1-4: per-process CPU, temperature, disk latency, network, GPU coverage.
- R01-P2-1: collector/API names removed from the modified metrics/tracking requirements.
- R01-REC-3: metrics gains the missing signals.
- R02-P0-3: per-process CPU and disk I/O.
- R02-P0-4: temperature time series and turbo-aware throttle signal.
- R02-P0-5: battery % parsed; check-stub never states a false "no battery".
- R02-P1-6: EcoQoS post-trace data no longer stored on hang rows (batch removed).
- R02-P1-8: security-software CPU normalized to machine share with CPU count.
- R02-P1-13: committed bytes and commit limit stored.
- R02-P2-1: GPU total derived; per-process GPU poll bounded and costed.
- R02-P2-2: network aggregate and system handle count (per-process handles deferred, DEF-1).
- R02-P2-5: as-of time on every power value; transitions recorded.
- R02-M-1: memory compression always sampled.
- R02-M-2: Search indexer and sync clients sampled when in system set or scope.
- R02-M-4: power-mode overlay and energy-saver state per sample.
- R02-REC-6: full missing-signal list.
- R02-REC-8: normalized CPU and EcoQoS-timestamp part (by removal).
- R03-P1-7: labelled temperature zones, implausible values filtered, user tier.
- R03-P2-7: EcoQoS compile cost removed.
- R03-ADD-2: pages output/s collected for the hard-fault thrash rule.
- R03-REM-5: EcoQoS batch removed.
- R03-REC-14: EcoQoS part of the remove/demote list.
