# Design: data-signals-completeness

## Context

See proposal.md (Why). The state this design assumes, once waves 1-3 are archived:

- `sampling-engine-and-provenance` provides a long-lived continuous sampler with no
  per-tick process launches beyond the hang probe. It also provides a collector
  registration interface, `registerCollector({id, inference, tier: continuous|on-trigger|once,
  triggers, budgetMs, unit, precision, scopeAware, adminOnly, source, parse})`. That
  change's design.md is authoritative for the interface. It also provides a per-value provenance record
  (`{value, unit, windowS, n, source, measuredAt, precision}`).
- `software-inventory-and-scope` provides the scope resolver: PID → `in-scope group |
  system-set member | out-of-scope`. It also provides the rule that names leave the
  resolver only for in-scope and system-set members.
- `fix-report-integrity` provides wall-clock timestamps, observed-window rates, and
  null-with-reason for absent data.

Today (pre-change) the code samples only total CPU, queue, commit %, pages/s, disk
sec/queue, `% of Maximum Frequency`, and a per-core-scaled Defender counter. Power is
refreshed every 30 s, and battery % is never parsed because the parser expects one key per
line while the output is one line. Temperature is admin-only and taken once at the end.
EcoQoS is compiled and run after the trace, then written onto hang rows.

## Goals / Non-Goals

**Goals:**
- Every owner-named signal (RAM, CPU, GPU, temperature, AC/battery, disk) and every input
  needed by the R03 cause rules exists as a time series, or as null with a reason.
- Per-process attribution for CPU and disk I/O within the scope contract.
- Each value carries the provenance record. No per-core-scaled percentages are stored.

**Non-Goals:**
- Cause ranking and thresholds. Those belong to `diagnosis-engine-rebuild` and
  `diagnosis-cause-rules`.
- Containers, WSL2, workload probes, and workload configuration. Those belong to
  `workload-session-and-containers`.
- Static facts such as GPU model, driver, and battery design capacity. Those belong to
  `system-profile-for-it`.
- Per-process network, handles, threads, and GDI (DEF-7, DEF-1).
- Admin-only signal paths. If a datum is admin-only on a machine, it is null at the user
  tier with reason `tier`.

## Decisions

1. **Per-process CPU is stored as % of the whole machine (0-100).**
   - Raw per-process CPU counters are per-core scaled, so they read up to 100 × logical
     CPUs. We store `cpuPctMachine = raw / logicalCpus` and record `logicalCpus` once per
     run.
   - Alternative: store raw values plus the CPU count and let consumers divide. Rejected:
     every consumer re-implements the division, and the 20%-vs-190% bug (R02-P1-8) is
     exactly that failure.
2. **Attribution granularity.** We collect one series per in-scope group, one per
   system-set member (OQ-2), and one `outOfScope` aggregate (`{cpuPctMachine,
   readBps, writeBps, groupCount}`) with no names.
   - Alternative: the top-N processes overall. Rejected: it leaks names and loses in-scope
     processes ranked below N (R02-P1-4).
3. **Continuous tier for per-process CPU/I/O.** One enumeration per tick by the
   long-lived sampler, reduced through the resolver in memory before anything is stored.
   - Alternative: on-hang only. Rejected: rules need calm-vs-hang deltas (R03 §3), and
     "which process grew" needs a series.
4. **Temperature.** Read every exposed zone at the user tier.
   - Label each zone with the platform's zone name. A zone whose name indicates the CPU
     package or cores is tagged `role: cpu`; otherwise the role is `other`.
   - Drop readings below 5 °C or above 130 °C and count them in `droppedImplausible`.
   - If no zone is readable, the series is `null` with reason `not-exposed` (user tier) or
     `tier` (exposed only when elevated).
   - Alternative: vendor tools. Rejected: they are not universal and not zero-dependency.
5. **Throttle signals are turbo-aware.** We store `perfPct` (actual performance relative
   to base, which can exceed 100), `perfLimitPct` (share of time performance was limited),
   and `throttleReasons[]` when exposed. `% of Maximum Frequency` is kept only as a legacy
   field with a confound note.
6. **Power is sampled every continuous tick from one cheap source.** Each value carries
   `asOf`. Transitions are emitted as events `{at, from, to}`. The scheme is stored as
   `{name, guid}`, and views show the name.
7. **GPU total is derived** as the max over engine types of the summed per-engine
   utilization, when no platform total exists.
   - The cheap total path runs in the continuous tier only if its measured cost is under
     the sampler's per-tick budget. Otherwise it moves to the trigger tier, with reason
     recorded.
   - Per-process GPU data runs on trigger, only for in-scope PIDs, and its `pollMs` is
     recorded.
8. **Network is aggregate per active adapter:** bytes/s in and out, errors, and
   `isVpn` (adapter description/type heuristic, recorded as `vpnHeuristic`). There is no
   per-process network (OQ-8).
9. **EcoQoS is removed.** It almost always returned `denied`/`unknown`, cost a compile,
   and its data was mislabelled as at-hang state (R02-P1-6, R03-P2-7). There is no
   cheaper substitute that returns data, so the datum is listed as not collected in
   `collection.notCollected[]` with that reason.
10. **DPC % and interrupt %** stay continuous series. `diagnosis-cause-rules` needs them
    (rule 11).

## Data / schema shape

Per tick, the continuous record gains the following (each leaf value is a provenance
record from sampling-engine; shortened here to the value):

```json
{
  "cpu":   { "totalPct": 37.2, "queuePerCore": 0.4, "dpcPct": 1.1, "interruptPct": 0.6,
             "perfPct": 148, "perfLimitPct": 0, "throttleReasons": [] },
  "mem":   { "committedBytes": 16.1e9, "commitLimitBytes": 20.3e9, "committedPct": 79.3,
             "pagesInPerS": 120, "pagesOutPerS": 0, "pagefileUsePct": 8 },
  "disk":  { "latencyMs": 4.2, "queue": 0.3, "busyPct": 12, "readBps": 1.2e6, "writeBps": 3.4e5 },
  "net":   [ { "adapter": "Wi-Fi", "inBps": 2.1e4, "outBps": 9e3, "errors": 0, "isVpn": false } ],
  "gpu":   { "totalUtilPct": 6, "vramUsedMB": 512, "tempC": null, "tempReason": "not-exposed" },
  "thermal": { "zones": [ { "label": "CPU package", "role": "cpu", "c": 71.0 } ], "droppedImplausible": 1 },
  "power": { "ac": true, "acAsOf": "...", "batteryPct": 99, "batteryAsOf": "...",
             "powerMode": "best-power-efficiency", "energySaver": false },
  "sys":   { "handleCount": 98213 },
  "procs": { "groups":  [ { "group": "postgres", "cpuPctMachine": 22.5, "readBps": 3e6, "writeBps": 8e6, "wsMB": 900, "privateMB": 1100 } ],
             "system":  [ { "member": "Security software", "cpuPctMachine": 9.8 },
                          { "member": "Memory Compression", "wsMB": 640 } ],
             "outOfScope": { "groupCount": 113, "cpuPctMachine": 14.0, "readBps": 1e5, "writeBps": 2e5, "wsMB": 5400 } }
}
```

Run-level fields:
- `machine.logicalCpus`
- `power.scheme {name, guid}`
- `power.transitions[] {at, from, to}`
- `gpu.perProcessOnTrigger[] {at, pollMs, byGroup}` (in-scope groups only)

Every series key that is unavailable for the whole run appears once in
`collection.failures[]` with `{inference, collector, mode, reason}`. Each sample stores
`null` for it (never 0).

## Non-binding implementation hints

These name APIs, which the specs deliberately do not.
- **Throttle:** `\Processor Information(_Total)\% Processor Performance`, `% Performance
  Limit`, `Performance Limit Flags` (when present), and `% Processor Utility`. All are
  readable unelevated on the reference laptop (R02 §0).
- **Temperature:** `\Thermal Zone Information(*)\Temperature` (Kelvin; convert with
  `K - 273.15`), plus `% Passive Limit` and `Throttle Reasons`. Read unelevated. The admin
  `MSAcpi_ThermalZoneTemperature` path is not used.
- **Per-process CPU/I/O:** `\Process(*)\% Processor Time`, `IO Read Bytes/sec`, `IO Write
  Bytes/sec`, and `ID Process` in one counter query inside the long-lived sampler. Map
  instance to PID through `ID Process`, then reduce through the resolver before
  persisting. `Process V2` instances (`name:pid`) avoid instance-name ambiguity where
  available.
- **Commit:** `\Memory\Committed Bytes`, `\Memory\Commit Limit`. Paging:
  `\Memory\Pages Input/sec`, `\Memory\Pages Output/sec`, `\Paging File(_Total)\% Usage`.
- **Disk:** `\PhysicalDisk(_Total)\Avg. Disk sec/Transfer` (× 1000 for ms),
  `Current Disk Queue Length`, `% Idle Time` (busy = 100 - idle), `Disk Read Bytes/sec`,
  `Disk Write Bytes/sec`.
- **Network:** `\Network Interface(*)\Bytes Received/sec`, `Bytes Sent/sec`,
  `Packets Received Errors`. Adapter descriptions containing VPN/TAP/WireGuard/AnyConnect/
  GlobalProtect/Fortinet are a VPN heuristic; record which pattern matched.
- **GPU:** `\GPU Engine(*)\Utilization Percentage` summed by `engtype_*` (take the max over
  engine types for the total), and `\GPU Adapter Memory(*)\Dedicated Usage` for VRAM.
  Per-PID `pid_N` grouping runs on trigger only.
- **Handles:** `\Process(_Total)\Handle Count`.
- **Battery parser bug:** the current output is a single line
  `line=Online;pct=100` while the parser expects one key per line. Split on `;` (or emit
  one key per line) and add a canned-output test. `BatteryLifePercent` of 255 or
  `BatteryChargeStatus` = NoSystemBattery means "no battery". Only then may check-stub say
  "no battery".
- **Power mode overlay:** the effective power mode (best power efficiency / balanced /
  best performance) is exposed by the power settings API (`PowerGetEffectiveOverlayScheme`)
  and in the registry under the power schemes key. Energy Saver state is exposed by the
  system power status (`SystemStatusFlag`/`EnergySaverStatus` on Windows 11). A
  long-lived PowerShell host can P/Invoke these once per tick cheaply.
- **Security software:** `\Process(MsMpEng*)\% Processor Time / logicalCpus`. Other
  products come from the system set's registered-security-product list.

## Risks / Trade-offs

- [Per-process counter query is heavy with many processes] → Measure its cost per tick
  through sampling-engine's observer budget. If it exceeds budget, drop to every Nth tick
  and record the achieved cadence for the `procs` series separately.
- [Process instance names are ambiguous (`node#3`)] → Map through the PID counter in the
  same query, and discard samples where the PID mapping changed mid-query.
- [Thermal zones are mislabelled by OEM firmware] → Store the raw label and do not infer
  a CPU role from a value. Diagnosis rules only use zones tagged `role: cpu`. Otherwise
  they use the throttle signals.
- [The VPN heuristic misclassifies adapters] → Store `vpnHeuristic` (the matched pattern)
  so IT can verify. The flag is advisory and never a cause by itself.
- [Removing EcoQoS loses a datum some users ran once] → It returned no data on any local
  trace (R03-P2-7). Listing it under not-collected keeps the decision visible.
- [The GPU total costs more than the tick budget on some drivers] → The sampler's budget
  moves it to the trigger tier automatically, with reason recorded.

## Migration

- Additive series follow plan §2 (a dated `2.x` section in `SCHEMA-CHANGELOG.md`).
- EcoQoS field removal (`ecoQoS`, `ecoDeferred`, `weightMs.eco`) is a removal. While
  `telltale-json/2` is a draft (IMPLEMENTATION-PLAN §2), it is recorded in a dated `2.x`
  changelog section without a version bump. Readers (`trend`) treat missing
  EcoQoS fields as absent, never as an error.
- `metrics` requirement text loses API names. `METRIC_REGISTRY.md` keeps the API mapping
  as the implementation reference (update its rows in the same PR).

## Open Questions

- OQ-2 (system set): default used is OS components (System, Registry, Memory
  Compression, dwm, Search indexer, "Windows services"), registered security products,
  and virtualization hosts. OneDrive-like sync clients are user software and are sampled
  only when in scope.
- OQ-8 (network depth): default used is per-adapter aggregate throughput and errors plus
  VPN-adapter presence. No per-process network (DEF-7).
