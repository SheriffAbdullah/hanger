# Design: system-profile-for-it

## Context

See proposal.md (Why). The current `assetBlock()` in `tools/hanger/hanger.js` makes three
queries. It fills `unknown` strings on failure and records failures in
`collection.failures[]`. The serial is read from a source that never carries it, so it is
always `unknown` unless `--serial` is passed. On the reference laptop (HP ProBook 440 G9,
i7-1255U, unelevated) R02 verified that the firmware serial is readable without admin.
`machine.cpus` holds the logical processor count but is rendered as "cores".

This change depends on `fix-report-integrity`, which provides:
- the `node --test` harness and fixtures directory
- schema `hanger-json/2` and `SCHEMA-CHANGELOG.md` discipline
- the null-with-reason rule ("Absent data is null with a reason")
- values-first anonymization

## Goals / Non-Goals

**Goals:**
- One self-contained module that returns the full profile and has no side effects at
  require time.
- Every fact is traceable to a source, a tier and an as-of time.
- Collector parsing is unit-testable on canned outputs, with no live machine needed for CI.
- Bounded cost, recorded per fact group.

**Non-Goals:**
- Rendering the profile in MD/HTML/email. That belongs to `report-and-visualization`.
- Workload configuration facts: Postgres memory settings and the configured WSL2 VM memory
  cap from the user's WSL config file. `workload-session-and-containers` owns those. The
  profile references them by key (`workloadConfig.*`) and does not re-collect them.
- Time-varying signals (temperature, battery %, performance %). Those belong to
  `data-signals-completeness`.
- Compliance scanning or a software inventory. Only *security products registered with the
  OS* are named (OQ-13). The profile never lists other installed or running software
  (see `scope` non-goal).
- Warranty lookup. Warranty stays a user-supplied input (`--warranty-date`, `--warranty-note`
  or config), recorded with source `user-input`.

## Decisions

1. **Per-fact record instead of strings.** Every leaf is
   `{value, unit?, source, tier, asOf, unavailableReason?}`. The alternative was to keep the
   flat strings (`ramFittedNote: "unknown (...)"`). Those cannot be distinguished from real
   values by a reader and cannot carry a tier. The record makes "unknown + reason, never
   blank" machine-checkable.
2. **Collected once per run, at start.** At start the machine is least loaded by the
   observer. The alternative, collecting at end, is when R02 measured a ~90 s end phase on
   a loaded box. The `asOf` field records the actual time.
3. **Fact groups run independently with their own timeout.** If one slow or failing source
   (e.g. a disk health query) times out, only that group is marked unavailable with reason
   `timeout after N ms`. The rest of the profile is kept. Total profile time is recorded as
   `systemProfile.collectionMs`.
4. **One batched query session per run where possible.** The non-binding hint below uses a
   single shell session that runs all user-tier queries and emits one delimited block per
   group. This avoids one process launch per fact. The alternative of one launch per query
   would cost about 10 launches. The sampler work in `sampling-engine-and-provenance` may
   later supply a long-lived session. This change must not depend on it.
5. **Tier labelling.**
   - `tier: "user"` facts are always attempted.
   - `tier: "admin"` facts are attempted only when the run is elevated. Otherwise they are
     recorded as `{value: null, unavailableReason: "requires elevation", tier: "admin"}`.
   - Battery design vs full-charge capacity is attempted at user tier first. Many laptops
     expose it unelevated. It falls back to admin and is never silently zero (R02-M-3).
6. **Serial from firmware.** `firmware.serial` comes from the firmware/BIOS source.
   `--serial` remains an override with `source: "user-input"`. The serial is **not**
   anonymized, because IT needs it to identify the asset. The hostname **is** replaced by
   `<host>` under `--anonymize`. The README and proposal state this.
7. **Cores vs threads.** `processor.physicalCores` and `processor.logicalProcessors` are
   separate facts. Any label derived from `machine.cpus` is renamed "logical processors".
8. **Compatibility alias.** `asset` is derived from `systemProfile` for one 2.x minor,
   so the existing `pack` and print views keep working. It is removed when
   `report-and-visualization` lands.

## Data / schema shape

```json
"systemProfile": {
  "collectedAt": "2026-10-07T10:00:00.000Z",
  "collectionMs": 2140,
  "tier": "user",
  "identity": {
    "hostname":     {"value": "<host>", "source": "os", "tier": "user", "asOf": "..."},
    "manufacturer": {"value": "HP", "source": "firmware-system-info", "tier": "user", "asOf": "..."},
    "model":        {"value": "HP ProBook 440 15.6 inch G9 Notebook PC", "source": "firmware-system-info", "tier": "user", "asOf": "..."},
    "serial":       {"value": "5CD...", "source": "firmware-bios", "tier": "user", "asOf": "..."}
  },
  "processor": {
    "model":             {"value": "12th Gen Intel(R) Core(TM) i7-1255U", "source": "...", "tier": "user", "asOf": "..."},
    "physicalCores":     {"value": 10, "unit": "cores", "source": "...", "tier": "user", "asOf": "..."},
    "logicalProcessors": {"value": 12, "unit": "threads", "source": "...", "tier": "user", "asOf": "..."},
    "baseClockMHz":      {"value": 1700, "unit": "MHz", "...": "..."},
    "maxClockMHz":       {"value": null, "unavailableReason": "max turbo clock not exposed at user tier", "source": "...", "tier": "user", "asOf": "..."}
  },
  "memory": {
    "installedGB": {"value": 16, "unit": "GB", "...": "..."},
    "modules":     {"value": [{"slot": "DIMM A", "sizeGB": 8, "speedMTs": 3200, "formFactor": "SODIMM"}], "...": "..."},
    "slotsUsed":   {"value": 2, "...": "..."},
    "slotsTotal":  {"value": 2, "...": "..."}
  },
  "storage": {
    "disks":        {"value": [{"model": "...", "mediaType": "SSD", "bus": "NVMe", "capacityGB": 512, "health": "Healthy"}], "...": "..."},
    "systemVolume": {"value": {"freeGB": 120.4, "totalGB": 475.8}, "...": "..."}
  },
  "graphics": {"adapters": {"value": [{"name": "...", "dedicatedMB": 128, "driverVersion": "31.0.101.x", "driverDate": "2024-05-01"}], "...": "..."}},
  "firmware": {"biosVendor": {}, "biosVersion": {}, "biosDate": {}},
  "os": {"edition": {}, "version": {}, "build": {}, "lastBoot": {}, "uptimeMin": {}, "vbs": {}, "memoryIntegrity": {}},
  "power": {"planName": {}, "powerMode": {}, "batteryDesignWh": {}, "batteryFullChargeWh": {}, "batteryHealthPct": {}},
  "virtualMemory": {"pagefiles": {}, "systemManaged": {}, "commitLimitGB": {}},
  "virtualization": {"wslInstalled": {}, "wslVersion": {}, "vmPlatform": {}, "hyperV": {}, "dockerDesktopVersion": {}, "dockerDesktopLimits": {}},
  "security": {"products": {}, "domainJoined": {}, "mdmEnrolled": {}},
  "workloadConfigRef": "see workloadConfig (owned by workload-session-and-containers)",
  "userInput": {"warrantyDate": {"value": null, "source": "user-input", "unavailableReason": "not supplied"}}
}
```

Rules:
- `value: null` always comes with `unavailableReason`.
- `0` is a real value only when the source reported zero.
- `asOf` is ISO-8601 wall-clock time.
- `dockerDesktopLimits` holds Docker Desktop's *configured* memory/CPU allocation, read from
  its settings without starting a container or running a workload. When reading it
  requires a running daemon or workload, it is null with that reason.

## Non-binding implementation hints

These are candidate sources (from the R02/R03 handoffs), all known to be user-tier on
Windows 11 unless marked otherwise.
- **identity, firmware:** `Win32_ComputerSystem` (Manufacturer, Model, TotalPhysicalMemory,
  PartOfDomain); `Win32_BIOS` (SerialNumber, SMBIOSBIOSVersion, Manufacturer, ReleaseDate).
  The serial bug: today the serial is read from `Win32_ComputerSystem`.
- **processor:** `Win32_Processor` (Name, NumberOfCores, NumberOfLogicalProcessors,
  MaxClockSpeed, which is the base clock on most Intel parts).
- **memory:** `Win32_PhysicalMemory` (Capacity, ConfiguredClockSpeed, Speed, DeviceLocator,
  FormFactor); `Win32_PhysicalMemoryArray` (MemoryDevices = slots total).
- **storage:**
  - `Get-PhysicalDisk` (FriendlyName, MediaType, BusType, Size, HealthStatus)
  - `Win32_LogicalDisk` for the system volume
  - SMART detail stays admin tier
- **graphics:** `Win32_VideoController` (Name, AdapterRAM, which is capped at 4 GB so treat
  it as a lower bound; DriverVersion, DriverDate).
- **OS:** `Win32_OperatingSystem` (Caption, Version, BuildNumber, LastBootUpTime);
  `Win32_DeviceGuard` in `root\Microsoft\Windows\DeviceGuard` (VBS and HVCI state).
- **power:**
  - `powercfg /getactivescheme` (parse the friendly name in parentheses)
  - power-mode overlay from the user power settings registry key
  - battery capacity from `root\wmi` `BatteryStaticData`/`BatteryFullChargedCapacity`
    (often unelevated); fallback `powercfg /batteryreport /xml` (may need admin)
- **virtual memory:** `Win32_PageFileUsage`, `Win32_PageFileSetting`;
  `Win32_ComputerSystem.AutomaticManagedPagefile`; commit limit from the
  `\Memory\Commit Limit` counter.
- **virtualization:** `wsl --version` / `wsl --status` (decode UTF-16 output);
  `Get-WindowsOptionalFeature` (may need admin, so use tier fallback); Docker Desktop
  version from its install metadata; configured limits from Docker Desktop's
  `settings-store.json`/`settings.json`.
- **security:** `root\SecurityCenter2` `AntiVirusProduct` (displayName, productState);
  `dsregcmd /status` (AzureAdJoined, DomainJoined, MDM URLs).
- Run all user-tier queries in one PowerShell invocation that prints
  `###group###` delimited blocks. The parser is a pure function `parseProfile(text)`
  unit-tested on canned blocks.
- Use invariant culture for number formatting in emitted text.

## Risks / Trade-offs

- **[Risk]** A batched query session can hang on one slow provider (disk health, WSL) and
  stall the whole profile. → **Mitigation:** each group has its own timeout inside the
  session plus an outer timeout. A timed-out group becomes `unavailableReason: "timeout after N ms"`.
- **[Risk]** `AdapterRAM` is capped at 4 GB, so VRAM is under-reported. → **Mitigation:**
  label it as `lower-bound` in the fact's source note, or use a registry-qualified source
  when one exists.
- **[Risk]** The serial is personal-ish data shared with IT. → **Mitigation:** this is
  intentional and IT requires it. State it in the README. The hostname still follows
  `--anonymize`.
- **[Risk]** Security-product names could be read as a software inventory. →
  **Mitigation:** limited to products registered with the OS security center. No other
  software is named (OQ-13).
- **[Risk]** Profile collection adds start-up load that pollutes the first probes. →
  **Mitigation:** collect it before the sampler starts. Its duration is recorded and the
  diagnosis engine's observer guard can exclude the overlapping window.
- **[Risk]** Locale differences (dates, decimals) corrupt parsing. → **Mitigation:**
  invariant-culture emission and ISO dates. Tests include a de-DE style fixture.

## Migration Plan

1. Add the module and `systemProfile` alongside `asset`. `asset` becomes a derived alias
   (2.x additive changelog entry).
2. `report-and-visualization` switches views to `systemProfile`. Then `asset` is removed
   under the schema rules (rename/remove bumps the major).
3. Rollback: drop the call site. `asset` is still derivable from the earlier code path.

## Open Questions

- OQ-13 (owner): should registered security products be named in the profile? **Default
  used: yes.** They are IT-installed and needed for the security-software contention rule.
  If overruled, `security.products` becomes `{value: null, unavailableReason: "excluded by owner policy"}`.
