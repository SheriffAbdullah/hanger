# Proposal

## Why

The owner runs Hanger while Postgres and Docker reproduce the hang. Today the tool cannot see that workload. It has no notion of a workload phase (idle vs loaded). It records one end-of-run `docker stats` row and no container time series. The WSL2/Docker Desktop VM is a black box: no memory cap and no guest memory (R02-P1-7). Nothing gives a workload-side freeze signal, so "the hang you felt" rests only on the generic process-spawn probe (R03-P0-4). The diagnosis rules for VM memory dominance and database memory/I/O (R03-ADD-3, R03-ADD-4) cannot be built without these data.

## What Changes

- **Workload session phases:** the user tags phase start/stop with a label (key press during a run, or a flag at start). Phase bounds are written to the run stream immediately, and the run summary compares idle vs loaded phases per signal, with n on each side.
- **Workload lifecycle markers:** start/exit of in-scope processes and start/stop of in-scope containers are recorded as timestamped markers. Out-of-scope lifecycle is never recorded.
- **Container and WSL2 visibility over time:** per in-scope container CPU % and memory used/limit as a time series at a bounded cadence. The VM host's memory as seen by Windows. The configured VM memory cap and guest-reported memory where visible. When the daemon is absent, stopped, or unresponsive, values are null with a plain-language reason (never raw shell errors). Every call is time-bounded.
- **Workload latency probe (opt-in):** declared in the scope file. It records timing only, discards output, has a 5 s default timeout, never runs elevated, and records timeouts as timeouts.
- **Workload configuration facts (opt-in):** database memory settings when the database is in scope and reachable without stored credentials, and the configured WSL memory cap. Each fact is a value or an unavailable reason, with its source.
- Scope file schema gains `phases`, `probes[]`, and `config[]` (additive, non-breaking).
- Report JSON gains `workload.{phases[], markers[], containers{}, vm{}, probes{}}` plus a top-level `workloadConfig[]` (opt-in configuration facts, referenced by `system-profile-for-it` via `workloadConfigRef`). This is additive and listed in a `2.x` changelog section.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `tracking`: ADDED "Workload session phases" and "Workload lifecycle markers".
- `metrics`: ADDED "Container and WSL2 visibility over time", "Workload latency probe", and "Workload configuration facts".

## Impact

- New `tools/hanger/lib/workload/*.js` (phases, markers, containers, vm, probes, config), registered through the collector registration interface from `sampling-engine-and-provenance`.
- `tools/hanger/lib/scope.js` scope-file schema extension (owned by `software-inventory-and-scope`, extended additively here).
- `tools/hanger/hanger.js`: key handling for phase tags, flag parsing (`--phase`), report assembly key `workload`.
- `tools/hanger/SCHEMA-CHANGELOG.md`: a `2.x` additive section.
- Consumers downstream: `diagnosis-engine-rebuild` (latency probe as a confirmation source; idle-vs-loaded comparison) and `diagnosis-cause-rules` (VM memory dominance rule, database memory and I/O rule). `report-and-visualization` uses phase and marker annotations on charts.
- Depends on `sampling-engine-and-provenance` (registration, provenance) and `software-inventory-and-scope` (resolver). Runs in wave 4, parallel with `data-signals-completeness`.

## Findings addressed

- R01-P1-4: Docker/WSL signal coverage gap (container and VM visibility).
- R01-P1-6: workload session (phases, idle vs loaded) and the WSL cap.
- R01-REC-5: tracking gains the workload-session requirement.
- R02-P1-7: the WSL2/Docker Desktop VM is no longer a black box.
- R02-REC-7: Docker/WSL as a first-class source (container time series, lifecycle markers, VM cap, guest memory).
- R03-P0-4: a workload-side latency signal next to the generic spawn probe.
- R03-P1-2: WSL memory cap and Postgres memory settings, which were never collected.
- R03-ADD-3: data for the VM memory dominance rule (VM host memory, configured cap).
- R03-ADD-4: data for the database memory and I/O rule (database memory settings, in-scope database process series).
- R03-REC-9: workload latency probe for the declared scope.
