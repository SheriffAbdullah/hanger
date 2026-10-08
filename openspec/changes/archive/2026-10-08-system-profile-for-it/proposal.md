# Proposal: system-profile-for-it

## Why

IT asks "what machine is this?" before it reads any hang evidence. Today the v12 asset block
has no requirement behind it and covers only manufacturer, model, total RAM, C: free and OS
build. It never shows the serial: a bug reads the serial from a source that does not carry
it. The block does not appear in any view. It also lacks the facts that decide between
"add RAM", "fix config" and "replace laptop": BIOS, memory modules and slots, disk type,
GPU and driver, pagefile configuration, power plan name, battery health, and virtualization
platform (R01-P1-5, R02-P1-12, R03-P1-2). It mislabels 12 logical processors as "12 cores".

## What Changes

- New capability `system-profile`. It defines a static system profile that is collected
  once per run and written to report JSON under `systemProfile`.
- Every fact is a record `{value|null, unit?, source, tier, asOf, unavailableReason?}`. A
  fact is never blank and never zero-for-unknown.
- Fact groups:
  - **processor**: model, physical cores, logical processors, base and max clock
  - **memory**: installed, modules, speed, slots
  - **storage**: per-disk model, media type, bus, capacity, health; system-volume free
  - **graphics**: adapters, VRAM, driver version and date
  - **firmware and OS**: manufacturer, model, firmware serial, BIOS vendor/version/date,
    OS edition/version/build, last boot, VBS / memory-integrity state
  - **power and battery**: plan friendly name, power mode, design vs full-charge capacity
  - **virtual memory**: pagefile layout, system-managed flag, commit limit
  - **virtualization platform**: WSL, VM platform, Docker Desktop version
  - **security and management**: registered security products, domain/MDM join
- Fixes the serial bug: the serial comes from the firmware source.
- Fixes the cores-vs-threads mislabel.
- User tier by default. Admin-only facts are collected only when elevated and are labelled
  with their tier. Collection cost is bounded and recorded.
- The console run summary prints a one-line profile. Rendering the profile in MD and HTML
  views belongs to `report-and-visualization`, which consumes `systemProfile`.
- **BREAKING (JSON consumers):** `systemProfile` supersedes the v12 `asset` block. `asset`
  is kept for one schema minor as a derived alias, then removed. This is recorded in
  `SCHEMA-CHANGELOG.md` as a `2.x` additive entry.

## Capabilities

### New Capabilities
- `system-profile`: static hardware, firmware, OS, power, virtual-memory, virtualization
  and security facts for an IT reader. Every fact carries a source, tier and as-of time, or
  an explicit unavailable reason.

### Modified Capabilities
- None. No existing requirement changes (see `openspec/IMPLEMENTATION-PLAN.md` §4).

## Impact

- **Code:**
  - new `tools/telltale/lib/system-profile.js`
  - one call site in `tools/telltale/telltale.js` (report assembly, console summary)
  - `assetBlock()` reduced to an alias derived from the profile
- **Tests:** new `tools/telltale/test/system-profile.test.js`, plus canned collector
  outputs in `tools/telltale/test/fixtures/system-profile/`.
- **Schema:** additive `systemProfile`. The `SCHEMA-CHANGELOG.md` entry is required.
- **Dependencies:** `fix-report-integrity` (test harness, schema v2, null-not-zero). Runs
  in parallel with `software-inventory-and-scope`. The merge hotspot is report assembly:
  merge the scope change first.
- **Not in this change:**
  - workload configuration facts (Postgres memory settings, configured WSL memory cap):
    owned by `workload-session-and-containers`
  - view rendering: owned by `report-and-visualization`

## Findings addressed

- R01-P1-4: signal coverage gaps (disk type and static-facts part)
- R01-P1-5: static IT facts unspecified
- R01-REC-2: new capability for system facts
- R02-P1-12: static profile gaps; serial bug
- R02-M-3: battery health only with admin and --sleep-study
- R02-REC-10: complete IT static profile with source and as-of
- R03-P1-2: static profile collected but hidden; facts never collected; cores vs threads mislabelled
- R03-REC-8: system profile section in every view; collect the missing facts (collection part; rendering in `report-and-visualization`)
