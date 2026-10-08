# Tasks

Prerequisite: `fix-report-integrity` is archived (it provides the test harness, schema v2,
and the null-with-reason rule). This change runs in parallel with
`software-inventory-and-scope`. Merge that change first; the report-assembly block is the
merge hotspot.

Repo root in Git Bash:
`cd <repo-root>`

## 1. Module skeleton and fact record

- [x] 1.1 Create `tools/telltale/lib/system-profile.js`. It exports `fact(value, {source, tier, unit, reason})`, `parseProfile(text)`, and `collectProfile({elevated, anonymize, shell, now})`. Requiring it has no side effects. Verify: `node -e "require('./tools/telltale/lib/system-profile.js')"` exits 0 with no output. [R01-REC-2]
- [x] 1.2 Implement `fact()` with these rules: null always gets an `unavailableReason`; an empty string becomes null with reason "empty value from source"; `asOf` is ISO-8601. Verify: `node --test tools/telltale/test/system-profile.test.js` passes the "fact record" cases (null-with-reason, no empty string, provenance present). [R02-REC-10]
- [x] 1.3 Add a tree-walk test helper. It asserts that every leaf has `source`, a `tier` in {user, admin, user-input}, and `asOf`, and that no leaf is an empty string. Verify: the helper fails on a deliberately broken fixture and passes on a good one (both cases are in the test file). [R02-REC-10, R01-P1-5]

## 2. Fact groups with canned-output tests

Each task adds canned output under `tools/telltale/test/fixtures/system-profile/` and test
cases that mirror the spec scenarios.

- [x] 2.1 Processor facts: model, physical cores, logical processors, base and max clock. Add a fixture for 10 cores and 12 threads. Rename any "cores" label derived from the logical count to "logical processors". Verify: the test asserts `physicalCores` = 10 and `logicalProcessors` = 12, and that `grep -c "12 cores"` on the digest output is 0. [R03-P1-2, R01-P1-5]
- [x] 2.2 Memory facts: installed, modules (size, speed, form factor or soldered), slots used and total. Add fixtures for 2x8 GB and for missing array info. Verify: the "Two-module laptop" and "Slot count not exposed" tests pass. [R01-P1-5, R03-P1-2]
- [x] 2.3 Storage facts: per-disk model, media type, bus, capacity, and health; system volume free and total. Add fixtures for NVMe SSD healthy and for health unreadable. Verify: the "NVMe SSD recorded" and "Health unreadable at user tier" tests pass. [R01-P1-4, R01-P1-5, R03-P1-2]
- [x] 2.4 Graphics facts: adapter name, dedicated memory (with a `lowerBound` flag at the reporting ceiling), driver version, and driver date. Verify: the "Integrated adapter recorded" and "Capped memory flagged" tests pass. [R01-P1-5, R03-REC-8]
- [x] 2.5 Firmware and OS facts:
  - serial from the firmware source; `--serial` overrides with `source: user-input`
  - BIOS vendor, version, and date
  - OS edition, version, and build
  - last boot and uptime
  - VBS and memory-integrity state
  - hostname set to `<host>` under anonymize; serial stays real

  Verify: the "Serial read from firmware", "User override recorded as user input", and "Anonymized run keeps serial, hides hostname" tests pass. [R02-P1-12, R03-REC-8]
- [x] 2.6 Power and battery facts: plan friendly name (never a bare GUID), power-mode setting, and design vs full-charge capacity with health %. Use a user-tier source first, then admin fallback with a tier label. A machine with no battery gets null with the reason "no battery present". Verify: the "Plan name not a bare identifier", "Battery health at user tier", and "No battery" tests pass. [R02-M-3, R01-P1-5]
- [x] 2.7 Virtual memory facts: pagefile locations and sizes, the system-managed flag, and the commit limit. Verify: the "System-managed pagefile" test passes. [R01-P1-5, R03-P1-2]
- [x] 2.8 Virtualization platform facts:
  - WSL installed and version (decode UTF-16 output)
  - VM platform and Hyper-V state
  - Docker Desktop version and its configured memory and CPU allocation, read from settings only
  - a `workloadConfigRef` pointer, not re-collected

  Verify: the "WSL present, Docker absent" test passes, and the "No workload started by profiling" test passes against the recording shell stub. [R01-P1-5, R03-P1-2]
- [x] 2.9 Security and management facts: registered security products and their state, plus domain-join and MDM enrollment. Do not list any other software. Verify: the "Registered security product named" and "No other software listed" tests pass. [R02-REC-10]
- [x] 2.10 Add a locale fixture (comma decimals, non-ISO dates). Verify: the parsed numbers and dates are correct in the test. [R02-REC-10]

## 3. Tiering and bounded cost

- [x] 3.1 Gate admin-only facts on elevation. On an unelevated run, record `{value: null, tier: 'admin', unavailableReason: 'requires elevation'}`. Set `systemProfile.tier` to the run tier. Verify: the "Unelevated run labels admin facts" and "Elevated run fills admin facts" tests pass (the elevation flag is injected). [R02-M-3, R02-REC-10]
- [x] 3.2 Run all user-tier groups in one batched shell session that emits delimited blocks. Give each group its own timeout and set an overall timeout. Record `collectionMs`. Verify: the "Slow group times out alone" test passes with a stub that delays only the storage block. [R01-REC-2]

## 4. Wire into the report

- [x] 4.1 Call `collectProfile()` once in `telltale.js` before sampling starts. Write the result to the report under `systemProfile`. Derive the legacy `asset` block from it as an alias. Fix the console "threads" label. Verify: the fixture-driven report-assembly test asserts one `systemProfile`, that `collectedAt` is earlier than the first sample, and that `asset.serial` equals `systemProfile.identity.serial.value`. [R01-P1-5, R02-P1-12, R03-P1-2]
- [x] 4.2 Print a one-line `[profile] <model> | <cpu> (<cores>C/<threads>T) | <RAM> GB | <disk type> | OS <build> | BIOS <ver>` digest. Verify: the "Console digest printed" test captures stdout from the summary function. [R03-REC-8]
- [x] 4.3 Add a dated `2.x` entry to `tools/telltale/SCHEMA-CHANGELOG.md` for `systemProfile`, listing all fields. Record that `asset` is now a derived alias scheduled for removal by `report-and-visualization`. Verify: the changelog entry exists and `node tools/telltale/test/helpers/validate-report.js <fixture report>` passes. [R02-REC-10]
- [x] 4.4 Add a README note that the serial is shown to IT, the hostname follows `--anonymize`, and security product names are listed (OQ-13 default). Verify: `grep -n "serial" README.md` shows the note. [R02-P1-12, R03-REC-8]

## 5. Integration check

- [x] 5.1 Live unelevated run on the Windows reference laptop: `node tools/telltale/telltale.js trace --duration 30 --anonymize --out "$TMPDIR/tt-profile"`. Then `node tools/telltale/test/helpers/validate-report.js "$TMPDIR"/tt-profile/telltale-*.json`. Verify: the report parses; every user-tier fact has a value or a reason; serial, BIOS, disk media type, physical cores vs logical processors, and the plan name are present; `collectionMs` is recorded. [R01-P1-4, R01-P1-5, R02-P1-12, R03-P1-2]
- [x] 5.2 Run the full suite: `node --test tools/telltale/test/`. Verify: exit 0. [R01-REC-2]
- [x] 5.3 Run the privacy canary: `node tools/telltale/test/canary-leak.js`. It exists once `software-inventory-and-scope` has merged; if this change merges first, re-run it after that merge. Verify: zero hits; the profile names no software other than registered security products. [R02-REC-10]
- [x] 5.4 Run `openspec validate system-profile-for-it --strict`. Verify: valid. [R01-REC-2]
- [x] 5.5 Add a review-gate note under this section with the date, the commands run, the observed profile facts (redacted serial), and the facts that were unavailable and why. Verify: the note is present before archive. [R03-REC-8]

## Workflow follow-up

- Archive after `software-inventory-and-scope` and after the review-gate note: `openspec archive system-profile-for-it`.
- Rendering the profile in MD, the report HTML, and the email belongs to `report-and-visualization` (R03-REC-8 view part).

## Review-gate note (2026-10-07)

Commands run (Windows 11, unelevated, HP ProBook 440 G9, i7-1255U):
- `node --test tools/telltale/test/` before: 45 pass / 0 fail; after: 78 pass / 0 fail (33 new in `system-profile.test.js`).
- `node tools/telltale/telltale.js trace --duration 30 --anonymize --out <scratchpad>/tt-profile` then `validate-report.js` on the JSON: OK. `collectedAt` (09:59:42.667Z) precedes the first sample (09:59:54.107Z); `collectionMs` 5173; the provenance walker reports 0 problems; `asset.serial` equals `systemProfile.identity.serial.value`; hostname `<host>`, serial real.
- Console: `[profile] HP ProBook 440 14 inch G9 Notebook PC | 12th Gen Intel(R) Core(TM) i7-1255U (10C/12T) | 16 GB | NVMe SSD | OS build 26200 | BIOS U85 Ver. 01.19.01`.
- `openspec validate system-profile-for-it --strict`: valid.

Observed facts (serial redacted here: `5CD*******`): physical cores 10, logical processors 12, 1x16 GB SODIMM 3200 MT/s in 2 slots, Samsung NVMe SSD 512 GB Healthy, Intel UHD driver 32.0.101.7088, BIOS U85 Ver. 01.19.01, VBS and memory integrity running, power plan "HP Optimized (Modern Standby)", pagefile C:\pagefile.sys (user-managed, no fixed max), commit limit 31.08 GB, WSL 3.0.1.0, Defender enabled and up to date, Azure AD joined, MDM enrolled.

Unavailable, with reasons (all recorded in the JSON):
- `processor.maxClockMHz`: max turbo clock not exposed at user tier.
- `power.batteryDesignWh` and `batteryHealthPct`: the design-capacity battery class returns "Generic failure" unelevated; full-charge capacity (36 Wh) is read. The admin fallback (battery report) is implemented but not run live (no elevation available).
- `storage.wearPct`, `virtualization.vmPlatform`, `hyperV`: `requires elevation` (tier admin). Not run live.
- `dockerDesktopVersion` and `dockerDesktopLimits`: not installed.

Deviations and open items:
- 5.3 (closed 2026-10-07): `node tools/telltale/test/canary-leak.js` re-run after `software-inventory-and-scope` landed and again after the sampler rewrite: `canary hits: 0`, scope guard backstop never activated. The canary greps every artifact of trace, watch, inventory, pack, MD, print and console/log, which includes the full `systemProfile` block; the profile holds only registered security product names, so no out-of-scope process name can reach it. The profile test asserts no software name other than registered security products appears.
- Admin-tier paths (battery report, disk wear, optional features) are tested on canned output only.
- Group time limit is 8 s, overall limit 25 s. Live cost is 5 to 12 s because the groups share one PowerShell process.
- `--serial`, `--warranty-date`, `--warranty-note` feed the profile as `user-input`.
- Added `systemProfile.groupStatus` and `security.azureAdJoined` (not in the spec; additive).
