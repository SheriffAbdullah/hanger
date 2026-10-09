# hanger JSON schema changelog

## v1 (`schema: 'hanger-json/1'`) — 2026-10-07 (hanger-v10)

First frozen schema. Consumers may branch on the root `schema` string;
unknown future versions MUST be treated as unreadable, not guessed.

### Added
- `schema` (root string, always `'hanger-json/1'` in v1 reports).
- `redacted.perName[]` — `[{name, mb}]` per redacted group (receipt: which
  names the `--hide`/config filter removed and how many MB each held).
- `redacted.filterSha1` — first 12 hex chars of sha1 over the sorted hide
  patterns (receipt: proves which filter set produced the report without
  re-listing patterns elsewhere).

### Unchanged (still v1, text-only honesty riders — no shape change)
- `summary.costNote` wording now states basis (20 workdays/mo, rate source);
  still a free-text string.
- Markdown `p95`/`rate` rows carry `(n=…)` suffixes; still free text.
- `summary`, `hangEvents[]`, `culprits[]`, `scope`, `collection.failures`
  shapes unchanged.

## How to bump
Any additive/renamed/removed JSON field requires a new section here and a
new `schema` value (`hanger-json/2`, …). Console-only text changes do not.

## v1.1 (additive, no break)
- summary.thresholds (TH.* + ideal/status), summary.maxFreqMin, report.tier/admin/wprEtl/power{plugged,batteryPct}, scope{}, redacted.patterns receipt, hang context pre/post commit+pages+cpuQ+diskQ, probe weightMs/degraded/slipS/bundleMs/eco fields, collection.failures[], userMarks[], culprits detail/cmd.


## v2 (`schema: 'hanger-json/2'`, `schemaStatus: 'draft'` until the freeze entry at the end of this file) - 2026-10-07 (fix-report-integrity)

v2 is a DRAFT for the whole program (changes 2-10): further additive or breaking edits are
recorded as dated `2.x` sections below and stay at `hanger-json/2` until report-and-visualization
sets `schemaStatus: 'frozen'`. After that, any removal or rename bumps to `/3`.
Readers: `trend` reads v1 (labelled "v1 (pre-fix; rates may be overstated)") and v2; `pack` and the
renderers require v2; any other version is reported as unreadable, never guessed.

### Added
- `schemaStatus` (root): `'draft'` | `'frozen'`.
- `run {status, endReason, startedAt, endedAt, stream}`: `status` is `complete` | `interrupted` | `unfinished`; `stream` names the `.jsonl` file.
- `window {nominalS, observedS, probesExpected, probesObserved, samplesExpected, samplesObserved}`; every rate and share divides by `observedS`.
- `settings {duration, interval, anonymize, scope, thresholds{...}}`, each `{value, source: flag|config|default|record-default, requested?, clamped?{from,to,reason}}`.
- `observer {pidCount, wsMB, wsMBAvg, cpuPctAvg, note}`: cost of the tool and its helper processes (they are excluded from every culprit, rollup, top-process and GPU list).
- `summary.windowBasis` (`'observed'`), `summary.nulls {field: reason}`, `summary.diskSecPeak`, `summary.diskQPeak`, `summary.meanFreezeS`, `summary.secsOverRamHigh`, `summary.secsOverRamHighBasis`, `summary.loopN`, `summary.thresholds.settingSources`.
- `samples[].at` (ISO wall-clock measurement time); `hangEvents[].context.windowS` and `.basis`.
- `events.window {from,to,leadS}`, `events.mode` (`ok` | `none-in-window` | `timeout` | `denied` | `error`), `events.inWindow {appHang[], appCrash[], resourceExhaustion[]}`, `events.history {<kind>: {count, newest, countCapped, horizonDays}}`.
- `wer {archivePresent, searchedWindow{from,to}, inRun{total,apphang}, history{total,apphang,window,capped}}`.
- `scope.recordingNote`.
- Run stream `hanger-<stamp>.jsonl` (not part of the report JSON): one record per line, `type` in `run-start|sample|probe|hang|mark|failure|run-end`.
- Watch log: typed records (`type: 'watch-end'`) with `achievedMedianCadenceS`; sample rows are unchanged. Directory `reports/baseline/` renamed `reports/watch/` (old path still read).

### Changed
- `samples[].t` renamed `samples[].tSec`; both it and `spawnProbes[].tSec` are measured wall-clock offsets from run start, not `index * interval`.
- `summary.hangRatePerMin`, `pctFrozenFull`, `pctFrozenExcess`, `mttrMs`, `secsOver85` (now `secsOverRamHigh`), cost inputs: computed over `window.observedS`.
- `summary.secsOver85` is kept as a deprecated alias of `secsOverRamHigh` until report-and-visualization.
- `summary.hangCount` now counts OS application-hang events inside the run window only.
- `summary.werArchive` now carries the all-time history counts (`wer.inRun` has the in-run counts).
- Null-not-zero: `minFreeGB`, `committedPeak`, `pagesPeak`, `pagesAvg`, `diskSecPeak`, `diskQPeak`, percentiles, `mttrMs`, `spawn*`, `loop*`, `hangRatePerMin`, `pctFrozen*` are `null` (with an entry in `summary.nulls`) when no measurement exists; `mttrMs` is `null` with zero hangs.
- `slipS` is measured offset minus nominal offset.

### Removed
- `events.hang1002`, `events.crash1000`, `events.exhaustion2004` (free text; replaced by `events.inWindow` / `events.history`).
- `samples[].t` (renamed, see above).
- Pack: `audit.thresholds` now holds the thresholds recorded in the trace (`audit.thresholdSource`, `audit.thresholdsIgnoredFromCurrentFlags` added); `provenance.unreadableReports`, `provenance.v1ReportsSkipped` added; `cost` fields are `null` with a `basis` explanation when no readable v2 trace exists.

## v2.x (additive, still `hanger-json/2`, draft) - 2026-10-07 (system-profile-for-it)

### Added
- `systemProfile` (root, one per trace/record run): `{collectedAt, collectionMs, tier, workloadConfigRef, groupStatus{group: ok|timeout|error}, ...}` plus the groups below. Every leaf is a fact record `{value|null, unit?, source, tier: user|admin|user-input, asOf, unavailableReason?}`; `value: null` always has `unavailableReason`. List-valued facts (`modules`, `disks`, `adapters`, `pagefiles`, `products`) carry per-entry `*UnavailableReason` keys for entry fields that are null.
- `systemProfile.identity {hostname, manufacturer, model, serial}` (serial from the firmware source, `user-input` when `--serial` is given; kept under `--anonymize`; hostname is `<host>` under `--anonymize`).
- `systemProfile.processor {model, physicalCores, logicalProcessors, baseClockMHz, maxClockMHz}`.
- `systemProfile.memory {installedGB, modules[{slot,sizeGB,speedMTs,formFactor}], slotsUsed, slotsTotal}`.
- `systemProfile.storage {disks[{model,mediaType,bus,capacityGB,health}], systemVolume{volume,freeGB,totalGB}, wearPct (admin tier)}`.
- `systemProfile.graphics {adapters[{name,dedicatedMB,lowerBound?,driverVersion,driverDate}]}`.
- `systemProfile.firmware {biosVendor, biosVersion, biosDate}`.
- `systemProfile.os {edition, version, build, lastBoot, uptimeMin, vbs, memoryIntegrity}`.
- `systemProfile.power {planName, powerMode, batteryDesignWh, batteryFullChargeWh, batteryHealthPct}`.
- `systemProfile.virtualMemory {pagefiles[{location,currentMB,initialMB,maxMB}], systemManaged, commitLimitGB}`.
- `systemProfile.virtualization {wslInstalled, wslVersion, vmPlatform (admin), hyperV (admin), dockerDesktopVersion, dockerDesktopLimits{memoryMiB,cpus}}`.
- `systemProfile.security {products[{name,state}], domainJoined, azureAdJoined, mdmEnrolled}`.
- `systemProfile.userInput {warrantyDate, warrantyNote}` (source `user-input`).

### Changed
- `asset` is now derived from `systemProfile` (alias, same shape as v12: `hostname, manufacturer, model, serial, ramFittedGB, ramFittedNote, diskFreePct, diskNote, osCaption, osBuild, warrantyDate, warrantyNote, source`). The serial is now read from the firmware source (it was always `unknown` before). It is scheduled for removal by `report-and-visualization`; that removal is a `2.x` entry while the schema is a draft.
- The print view labels `machine.cpus` as logical processors (it was shown as "cores"). The JSON key `machine.cpus` is unchanged.

## v2.x (still `hanger-json/2`, draft) - 2026-10-07 (software-inventory-and-scope)

### Added
- `scope` (root, now the first content block after `settings`): `{mode: allowlist|open, source: file|template:<name>|flag|none, path, sha256, entries[{name|pattern, includeDescendants}], matchRule, systemSet{listVersion, categories[], names[]}, counts{inScopeGroups, systemGroups, outOfScopeGroups}, fallbacks[{at, reason}], warnings?, statement}`. `statement` is "Names of software outside this scope were not recorded." (allowlist) or "OPEN SCOPE: names of all running software may appear in this report" (open). Replaces the earlier `scope{mode, only, excludedGroups, excludedMB, treeNote, recordingNote}` shape.
- `outOfScope` (root): anonymous aggregate `{groups, processes, memMB, cpuPctOfMachine (null with cpuReason until per-process CPU exists), inScope{memMB, cpuPctOfMachine}, system{memMB, cpuPctOfMachine}, measuredAt}`.
- `spawnProbes[].scopeShare` / `hangEvents[].scopeShare` (every hang row): `{outOfScope{groups, processes, memMB, cpuPctOfMachine, cpuReason?}, inScope{...}, system{...}, measuredAt}`.
- `hangEvents[].snapshotSkippedReason` (string) when `culpritsAtHang` is null; `culpritsAtHang[].category` (`user|system`), `culpritsAtHang[].detail` + `labelRule`.
- `hangEvents[].outOfScopeNotResponding` (count); `osHungWindows` now lists only in-scope and system-set names.
- `culprits[].category` (`user|system`) and `culprits[].labelRule` (`node-script|postgres-db|container-name|none`); `culprits[].detail` is the derived application label.
- `gpu.*.byPid` and `gpuAtHang.*.byPid` keep in-scope and system PIDs only; `gpu.*.outOfScope {pids, pct|mb}` aggregates the rest.
- `docker {present, containers{total, inScope[{name,status}], outOfScopeCount}, statsOutOfScopeCount, wsl{present, distros[{name,state,version}], outOfScopeCount}}`.
- `events.inWindow.*[].inScopeNames` (exe names that matched the scope or system set).
- Watch log: typed record `{type: 'watch-scope', at, scope}` at the start of each watch log; watch rows carry `outOfScope` (aggregate) instead of `scopedOutGroups`.
- Pack: `scope` and `outOfScope` lead the pack; `audit.scopeSource`, `audit.scopeMode`.
- Local-only artifact `<out>/private/inventory-<stamp>.json` `{shareable: false, takenAt, note, groups[{name, friendly, instances, memMB, category}]}` (not a report; refused by pack, trend and the renderers).

### Removed
- `redacted.{patterns, rows, mb, perName, filterSha1}` and `focus.{list, extras}` (the redaction model is retired; `--hide/--focus/--extras` exit 2).
- `culprits[].cmd` and `culpritsAtHang[].cmd`: raw command lines are never persisted.
- `docker.ps`, `docker.stats`, `docker.wsl` raw strings (replaced by the structured `docker` block above); `probe.scopedOut`, `probe.redactedAtHang`.
- `events.inWindow.resourceExhaustion[].message` (message text is never stored).
- `scope.only`, `scope.excludedGroups`, `scope.excludedMB`, `scope.treeNote`, `scope.recordingNote` (superseded by the declaration above).
- Pack: `audit.hide`, `audit.only`, `audit.focus`, `audit.extras`, `audit.redacted`, `audit.scope`.

### Changed
- `privateTop`, `topProcesses`, `flags.has*` and `summary.warpSeenMB`/`openspecSeenMB` are computed from in-scope and system-set groups only (the top 12 / top 3 are taken within scope, not overall-then-filtered).
- Scope match semantics: exact executable name or `*`/`?` pattern; friendly-label and substring matching are removed. `--preset dev` is now a template (node, docker executables, postgres, redis-server, chromium; no `code`, no `playwright`).
- `record` no longer implies `--preset dev`.

## v2.x (still `hanger-json/2`, draft) - 2026-10-07 (sampling-engine-and-provenance)

Probes and samples now store per-value provenance records. The schema stays `hanger-json/2` (a draft until
report-and-visualization freezes it); the bare-key replacement below is recorded here as a rename.

### Added
- Provenance record `{v, unit, windowS, n, src, at, prec}` on every value of `spawnProbes[]`, `samples[]` and `hangEvents[]` rows. `v` is rounded at store time to `prec` (percent 0.1, MB 1, ms 1, seconds 0.001, count 1, per-second 1, disk latency 0.0001 s); `null` means not measured. `at` is the measurement wall-clock time (the counter read time for continuous values), `src` is the collector id and field (for example `counterBundle.committed@counterSession`), `windowS` is the averaging window in seconds, `n` the sample count. Readers unwrap records through one accessor (`plain()` / `val()` in `lib/sampler/record.js`).
- `sampling` (root): `{cadence{nominalS, achievedMedianS, achievedP95S, n, basis}, unobserved[{start, end, durationS, reason}], heavyRuns[{collector, trigger, at, elapsedMs, budgetMs, outcome: ok|over-budget|skipped|failed, reason, coalescedCalls?, partial?}], observer{cpuS, cpuSBySource{main, session}, cpuPctOneLogical, peakPrivateMB, ioReadMB, ioWriteMB, launchesPerMin{continuous, hangProbe, onTrigger, once}, launches{...}, scope, budget{cpuPctLimit, privateMBLimit, exceeded, items[{budget, value, limit, unit, windowS}]}}, duration{requestedS, usedS, source: flag|config|default|record-default, clampReason, actualS, wrapUpS, probesStartedAtS}}`. `observer` is the cost of the tool during the capture window and is never counted in a workload rollup.
- `window.spanS` and `window.unobservedS`; `window.observedS` is now the span minus unobserved time, so rates and shares exclude unobserved intervals.
- `spawnProbes[].bundleAt` (the continuous sample the probe was merged with, `null` when there was no sample within 4.5 s: values are then absent and `degraded[]` says so; a stale bundle is never carried forward). `snapshotPath` (`tasklist|get-process`), `snapshotCoalesced`, `osUnavailableReason`.
- `collection.failures[].at` (ISO time) on every failure; modes added: `session-restart`, `over-budget`, `failed`, `disk-full`, `truncated`; `parse` failures also carry `field`. Parse failures are recorded once per field per run.
- Run stream record types: `csample` (one continuous sample), `gap`, `heavy`, `probe-patch` (post-hoc fields for an earlier probe, matched by `at`). The report is rebuilt from the stream, so memory stays bounded however long the run is.
- Watch log: rows carry provenance records; typed records `watch-gap` and `watch-end.sampling`.
- Long capture: `--duration` up to 28800 s (8 h).

### Changed (rename of bare keys)
- Bare unitless probe/sample keys `committed`, `availMB`, `pages`, `faults`, `transFaults`, `cpuQ`, `cpuPct`, `ctx`, `diskQ`, `diskSec`, `defender`, `dpcPct`, `intrPct`, `maxFreq`, `pagesIn`, `pagefile`, `poolNonpagedMB`, `modifiedMB`, `standby*MB`, `standbyLifetimeS`, `gpuTotal`, `usedPct`, `freeGB`, `ms`, `slipS`, `batteryPct` are provenance records with the same key name (the key stays, the value becomes a record).
- Derived aggregates (`summary.*`, `hangEvents[].context.*`) stay plain numbers with unit-bearing key names; they are computed from the record values and rounded.
- `spawnProbes[].plugged` is the power-line state of the continuous sample read in the same second (it was up to 30 s stale).
- `trace` default and maximum: the 300 s cap is removed; `settings.duration.clamped.reason` is `maximum 8 h` above 28800 s.

### Removed
- `spawnProbes[].bundleMs` and `weightMs` (the counter bundle is read by the continuous session, not timed per tick); the per-tick PowerShell bundle and the "melting" gate (`MELT`, `melting()`, `gate()`); `summary.committedStart/End`, `pagesStart/End`, `availMB`, `cpuQueue` now come from the first and last continuous sample (no separate launches).

## v2.x (still `hanger-json/2`, draft) - 2026-10-07 (workload-session-and-containers)

Additive only. Readers that ignore unknown keys are unaffected; a trace written before this change has none of the keys below.

### Added
- `workload` (root, traces only): `{declared{phases[], probes[] (names only), config[] (kinds)}, phases[{label, startAt, endAt|null, endStatus: closed|unfinished, source: key|flag|scope-file}], phaseSummary, phasesNote?, markers[{at, kind: process-start|process-exit|container-start|container-stop, name, id}], markersNote, containers{series[{at, name, cpuPct, memUsedMB, memLimitMB}], outOfScope[{at, count, cpuPct, memUsedMB, memLimitMB}], unavailable{reason, since}|null, unavailablePeriods[{at, reason}], polls{ok, unavailable}, provenance{cpuPct, memUsedMB, memLimitMB: {unit, windowS, source}}}, vm{hostMemMB[{at, value}], hostMemUnavailable?, hostProvenance, configuredCapMB{value|null, unit?, unavailableReason?, source}, guestMem{series[{at, usedMB, totalMB}], source} | {value: null, unavailableReason}}, probes{<name>: [{at, ms, status: ok|nonzero|timeout|not-found}]}, probesNote?, probeStops?[{name, at, reason}]}`.
- `workload.phaseSummary` (null with `phasesNote: "no workload phases were declared"` when no phase was tagged): `{<signalId>: {<phaseLabel>: {mean, p95, n, unobservedS}, untaggedN}}`. Signal ids are the continuous-sample keys (`committed`, `pages`, `cpuQ`, ...), `ramUsedPct` and `spawnProbeMs`. Samples outside every phase are `untaggedN` and join neither side. This is the idle-versus-loaded input for `diagnosis-engine-rebuild`.
- `workload.probes` is the workload-side freeze confirmation input for `diagnosis-engine-rebuild`; `workload.vm` (host memory series, configured cap) is the input for the VM memory dominance rule; `workload.markers` and `workload.phases` annotate the report charts.
- `workloadConfig[]` (root, only when the scope file declares `config`): `{kind: postgres|wsl, fact, value, unit?, source, unavailableReason}`. Postgres facts are `shared_buffers`, `work_mem`, `max_connections` (source `database settings`); the WSL fact is `memoryCapMB` (source `user VM config`). `system-profile` reads this key through its `workloadConfigRef`.
- `docker.unavailable` and `docker.wsl.unavailable`: fixed-vocabulary reason (`not installed`, `not running`, `unresponsive (timed out after N s)`) when the end-of-run snapshot could not read the platform.
- Run stream record types: `wl-phase`, `wl-marker`, `wl-containers`, `wl-unavail`, `wl-vm`, `wl-vmcap`, `wl-probe`, `wl-probe-stop`, `wl-probe-refused`, `wl-config`. `run-start` gains `workloadDecl` and `workloadScoped`.
- Scope file (not the report): optional `phases[]`, `probes[{name, command[], timeoutMs=5000, everySec=5}]`, `config[{kind, connection?, container?}]`. Old scope files are unchanged.

### Removed
- `errors[]` no longer carries the raw container-platform stderr (it held shell text such as "'docker' is not recognized"); the fixed reason in `docker.unavailable` replaces it.

## v2.x (still `hanger-json/2`, draft) - 2026-10-07 (data-signals-completeness)

New per-sample series ride on the existing continuous-sample rows (`spawnProbes[]`, hang rows and the watch log), next to the legacy flat keys. Scalar values are provenance records `{v, unit, windowS, n, src, at, prec}`. Blocks that list several entities (`thermal`, `net`, `procs`) carry ONE block-level `prov` object instead of a record per number (a record on every group and adapter would make a 2-hour trace many times larger); their numbers are plain and rounded to `prov.prec`. Every unavailable value is `null` with a reason (never 0) and appears once in `collection.failures[]`.

### Added
- `spawnProbes[].cpu` `{perfPct (unit "% of base", can exceed 100), perfLimitPct (0 = not limited; stored as 100 minus the OS "% Performance Limit" counter), utilityPct, throttleReasons: string[] | null (+ throttleReasonsReason), dpcPct, interruptPct}`.
- `spawnProbes[].mem` `{committedBytes, commitLimitBytes, committedPct, pagesInPerS, pagesOutPerS, pagefileUsePct}`.
- `spawnProbes[].disk` `{latencyMs, queue, busyPct, readBps, writeBps}`; `spawnProbes[].sys.handleCount`.
- `spawnProbes[].thermal` `{prov, zones: [{label, role: cpu|gpu|other, c}] | null, zonesReason?, droppedImplausible}` (readings outside 5-130 C are dropped and counted); `spawnProbes[].gpu.tempC` from a graphics zone (null + `tempReason`).
- `spawnProbes[].net` `{prov, adapters: [{adapter, inBps, outBps, errors, active, isVpn, vpnRule}] | null, reason?}` (aggregate per adapter; never per process).
- `spawnProbes[].gpu` `{totalUtilPct (derived from engines, `note: "derived"`), vramUsedMB, tempC, reason?}`.
- `spawnProbes[].power` `{ac, acAsOf, batteryPct, batteryAsOf, hasBattery, powerMode: best-power-efficiency|balanced|best-performance|other:<guid>|null, powerModeAsOf, energySaver, <field>Reason}`.
- `spawnProbes[].procs` `{prov{windowS, src, at, logicalCpus, units{}, prec{}}, groups: [{group, cpuPctMachine, readBps, writeBps, wsMB, privateMB, instances, includesObserver?}] | null, system: [{member, ...same}], outOfScope: {groupCount, cpuPctMachine, readBps, writeBps, wsMB} (no names), otherInScope? (open scope keeps the busiest 25 groups), scopeNote?}`. In-scope and system-set names only; CPU is a share of the whole machine (0-100).
- Run level: `machine.logicalCpus`; `power.plan` `{name, guid}` (the legacy `power.scheme` text stays), `power.hasBattery`, `power.transitions[] {at, from: ac|battery, to}`; `procsSummary` (per-group mean and peak CPU, peak read/write, peak working set and private MB over the run, plus the out-of-scope aggregate peaks); `signals` (`{logicalCpus, ticks, procsTicks, counterFamilies{<set>: {reads, meanMs, maxMs, readEveryNthTick}}, powerTransitions, notCollected, notes}`); `collection.notCollected[] {datum, reason}`; `gpu.perProcessOnTrigger[] {at, pollMs, byGroup{<in-scope group>: {utilPct, vramMB, pids}}}`.
- `collection.failures[]` mode `not-exposed` (the platform does not expose a counter) and `skipped-overload` (a counter family exceeded its per-tick budget and is read every Nth tick; the read cadence is in `signals.counterFamilies`).
- Run stream record types `power-transition` and `signals`; watch log records `watch-power-transition`, and `watch-end.signals`. `run-start.logicalCpus`.

### Changed
- `spawnProbes[].defender` is the security-software CPU as a share of the whole machine (0-100, the sum of the registered security products); it was a per-core-scaled raw value (79-190 on 12 CPUs) compared with a 20 threshold. The default `--defender` threshold is unchanged and now means 20 percent of the machine.
- `gpu` (root) is now `{nvidia, perProcessOnTrigger[], note}`.
- `power.batteryPct` is parsed on a laptop (the one-line output was never split before); `check-stub` states "no system battery" only when the platform reports none.
- The continuous session no longer loads the WinForms assembly; the power line comes from one Win32 call. The session script travels on stdin (a command line is limited to about 32 K characters).

### Removed
- `spawnProbes[].ecoQoS`, `spawnProbes[].ecoDeferred`, `spawnProbes[].ecoMs` and the `eco` probe weight (the post-trace EcoQoS batch returned denied/unknown on every local trace and its data was stored on hang rows as at-hang state; it is listed in `collection.notCollected[]`). Readers treat the missing keys as absent.
- `gpu.engines`, `gpu.mem` and `gpu.bundleTotalNote` (the end-of-run full per-PID GPU poll, 6-16 s, is removed; per-process GPU is `gpu.perProcessOnTrigger`, in-scope groups only).

## v2.x (still `hanger-json/2`, draft) - 2026-10-08 (diagnosis-engine-rebuild)

One ranked cause list replaces the three parallel inferences. Every label derives from `diagnosis`.

### Added
- `diagnosis` {engine "diagnosis/1", hangDefinition {probe, thresholdMs, source, intervalS, cannotSee[]}, usable {probes, excluded, minimum, sustainedMin}, excludedProbes[] {ref, reasons[]}, calm {definition, n, means{}}, proxyValidation {status, precision{num,den,value}, recall{num,den,value}}, marks {joined[], unmatched[]}, confidenceModel {weights, penaltyPerConfound, penaltyMax, cap}, thresholds{<rule id>: {value, unit, source, origin}}, hangs[] {ref, at, ms, confirmedBy[], scopeShare?, rules[], ranked[]}, rollup[], finding {class, sentence, strength, confirmations{}, excludedHangs, scope, window, ruleId?, confidence?, rulesChecked?}, observations[], hwConfigSignal, timeLost, eventsUsed[], eventsHistory[]}.
- Each rule result: {id, class, fired true|false|null, reason, at[], inputs[] {ref, signal, at, value, unit, rawValue?}, threshold, n, calm {mean, n, signal}, components {C, D, O, K, P, flags?}, confidence, disprover {check, result, values[]}, confounds[], hangValue?, extra?}.
- Hang rows: `osConfirmState` (confirmed | denied | not-evaluated), `osPollAt`, `suspendedIgnored`.
- Pack: `finding`, `rollup`, `hwConfigSignal`, `timeLost`, `findingNote`, `provenance.findingBasis`.

### Removed
- `summary.verdict`, `summary.cause`, `summary.costNote`, `summary.costParams`, `summary.costV2`, `summary.discriminator`, top-level `rca`; pack `cost`, `discriminator`, `hangs.rca`.
- Flags `--cost-min`, `--ram-cost`, `--laptop-cost` are deprecated and ignored; `--active-min` and `--cost-rate` apply only when both are given (user-supplied extrapolation).
- `trend` shows pre-engine verdicts as `legacy:<label>`.

## v2.x (still `hanger-json/2`, draft) - 2026-10-08 (diagnosis-cause-rules)

Nine more cause rules and a suggested-actions list. Everything is additive; no field is removed or renamed.

### Added
- `diagnosis.suggestedActions[]` {key, rank (1 = cheapest), text, ruleIds[], rules[] {id, hangs, of, confidence}, hangs {k, of, label "k/M"}, confidence (the highest supporting rule mean), names? (in-scope or system-set group names, application-memory action only)}. Empty array when no rule fired or every fired rule was disproved. Fixed table, ordered by cost rank: security-exclusions, vm-memory-cap, power-plan, driver-firmware, app-memory, storage-health, memory-capacity.
- Nine rule ids appear in every hang's `diagnosis.hangs[].rules[]`, in `diagnosis.thresholds` and (when fired and not disproved) in `diagnosis.rollup[]`: `commit-limit-pressure`, `hard-fault-thrash`, `vm-memory-dominance`, `database-memory-io`, `single-process-dominance`, `thermal-power-throttle`, `battery-power-plan`, `driver-interrupt-storm`, `gpu-contention`. Each uses the existing rule-result shape. `extra` carries rule-specific values (page-file and modified-list deltas; VM cap {state absent|configured|unknown, valueMB, pctOfRam, text}; database group, variant memory|io, configured memory and missingInputs[]; group name, kind dominance|growth and snapshot values with refs and times; calm median performance, limit kind thermal|power|unknown, power source and limit reasons; per-side battery/AC {hangs, probes, observedMin, ratePerMin}, ratio and the power-mode shares; dedicated GPU memory total).
- New evidence signal ids in `inputs[].signal`: `mem.commit_of_limit_pct`, `mem.pagefile_pct`, `mem.pages_out_per_s`, `mem.pages_in_per_s`, `mem.modified_mb`, `mem.used_pct`, `cpu.perf_pct`, `cpu.perf_limit_pct`, `cpu.throttle_flag`, `cpu.dpc_intr_pct`, `gpu.engine_util_pct`, `gpu.vram_used_mb`, `power.on_ac`, `power.on_battery`, `power.efficiency_mode`, `thermal.cpu_c`, `proc.vm_host_mb`, `proc.vm_host_pct_ram`, and the families `proc.group_mem_mb[<group>]`, `proc.group_mem_pct_ram[<group>]`, `proc.group_share_pct[<group>]`, `proc.group_io_bps[<group>]` (in-scope and system-set group names only).
- `summary.thresholds.rules.<ruleId>.<param>` {value, unit, source "provisional (diagnosis-cause-rules design)", origin default|config}. Overridable from `hanger.config.json` as `{ "rules": { "<ruleId>": { "<param>": number } } }`. The rules read the recorded value, so a stored report recomputes identically.

### Changed
- A rule result's `class` may be a per-hang variant of the rule's own class (`database-memory-io` is `memory` or `disk`); `diagnosis.rollup[].class` follows the first effective result. All other rules keep a fixed class.
- A rule whose required signal was not recorded reports `fired: null` with a reason that names the signal (and the recorded collection failure when there is one), and `disprover.result: "not-evaluable"`. It is never reported as "ruled out".

## v2.x then FROZEN (still `hanger-json/2`) - 2026-10-08 (report-and-visualization)

Outputs and one field cleanup; the last change of the v2 program. v2 is now `schemaStatus: 'frozen'`.

### Added
- `run.utcOffsetMin` (minutes east of UTC on the capturing machine at run start): lets views show local wall-clock time. Absent in older v2 files; readers then show UTC.
- Pack: `systemProfile` (same shape as a trace's) replaces `asset`.

### Removed
- `asset` (root, trace) and `asset` (pack): the alias is gone; every view reads `systemProfile`. Console summary lines are derived from `systemProfile` at run time and never stored.
- `summary.secsOver85` (deprecated alias of `summary.secsOverRamHigh`).
- Output files: the legacy `.html` view and the separate `.charts.html` are no longer written. A run writes `.json`, `.md`, `.report.html` (charts inline, no external reference) and `.email.txt`. `--print` is a no-op and `--charts` prints a deprecation line; `--no-report` writes only `.json` and `.md`. This is an output change only; no JSON field depends on it.

### Freeze
- `schemaStatus` is `'frozen'` in every new report. From now on an additive field is a `2.x` entry; any removal or rename bumps the schema to `hanger-json/3`.
- Before the freeze, `diagnosis-cause-rules` had landed: its only shape addition (`diagnosis.suggestedActions[]`, entry above) is in this schema, and the renderers read it generically (rules added later appear in the views without renderer changes).
- Readers: `pack`, `trend` and the renderers accept `schemaStatus` `draft` or `frozen`; `test/helpers/validate-report.js` rejects any other status and any report that still carries `asset`.

## v2.x (still `hanger-json/2`, `schemaStatus` stays `frozen`) - 2026-10-08 (input-response-stall-detector)

Everything is additive: an optional root key, optional children and one widened enumeration. Nothing is renamed or removed, so this is a `2.x` entry and not a bump to `/3` (a bump would make `pack`, `trend` and every stored report unreadable by the new tool for no benefit). Absence of `inputStall` means the report predates the detector; every reader shows a placeholder.

### Added
- `inputStall` (root, optional): `status` (`running` | `unavailable` | `not-requested`), `reason`, `determinedAt`, `source` (not-requested only), `helper {build, file, badLines, orderlyEnd}`, `settings {stallMs, recentInputMs, mergeGapMs, lateMs, tickMs, timeoutMs: {v, unit, source, provisional}; ignoreGroups {v[], source}}`, `evaluable {observed {from, to}, activeSpans[] {from, to}, activeSpansTruncated, observedS, evaluatedS, idleS, notEvaluableS, measurements (provenance records), notEvaluable[] {from, to, durationS, reason}}`, `episodes[]` (or `null` with the reason when the check was unavailable) each `{id, startAt, endAt, durationMs, worstLatencyMs (records), samples, sampleRefs[], foreground {kind, group?}, endReason, guards[], corroboratedBy[], confidence {value, components {S,L,X,N,G}, weights}}`, `blips`, `calmBaseline {n, medianMs, p95Ms, maxMs, overThresholdPct, noisy, noisyWhy}`, `helperLateness {tickMs, n, medianMs, p95Ms, maxMs, latePeriods[] {startAt, endAt, maxMs}}`, `flags {chronicSlowGroups[], ignored[], foregroundChangedDropped, helperLateSamples, samplesInNotEvaluable}`, `outOfScope {episodes, totalMs}` (anonymous: counts and total only), `unobserved[]` (reason `helper-exited`), `cannotSee[]`. Every measurement is a provenance record (source `input-helper`).
- `settings.inputStall` (run settings): `enabled`, `stallMs`, `recentInputMs`, `mergeGapMs`, `lateMs`, `tickMs`, `timeoutMs`, `ignoreGroups`, each `{value, source: flag|config|default, requested?, clamped?}`.
- `diagnosis.probeAgreement {status, toleranceMs, stallMs, probeIntervalS, precision {num, den, value}, recall, recallAtProbeResolution, probeHangsWithoutStall[], stallsWithoutProbeHang[], excluded {idle, notEvaluable, unobserved}, outOfScopeEpisodes, probeHangsEvaluated, note?}` (`status: 'not evaluated'` with a reason when the check did not run or the report predates it) and `diagnosis.inputStallCorroboration {status, episodes, probeHang, osNotResponding, userMark, workloadProbe, helperLate, none: {num, den}}`. Plain `{num, den, value}` ratios like `proxyValidation`.
- `diagnosis.hangs[].helperLate` (`true` | `false` | `'not evaluated'`) with `helperLateReason` when not evaluated; `diagnosis.hangDefinition.inputResponse {status, reason?, cannotSee?}`; `diagnosis.confidenceModel.confirmationWeights` and `diagnosis.hangs[].rules[].confirmationWeight`.
- The label `input-stall` in `diagnosis.hangs[].confirmedBy[]` and, when the check ran, the key `input-stall` in `diagnosis.finding.confirmations`. Readers MUST display an unknown label unchanged.
- `sampling.observer.helper {cpuPct, privateMB, limits {cpuPct, privateMB}, exceeded, window}` (the helper's own cost, kept out of every workload rollup).
- Run stream records `input-helper` (status, reason, build, file, at) and `input-helper-exit`.
- Helper file `hanger-<stamp>.input.jsonl` (append-only, written only by the helper) with record types `input-helper` (start), `input-stall-sample`, `input-skip` (not-evaluable span), `input-late` (late period), `input-window` (10 s statistics) and `input-end`. It holds no key, character, window title, pointer position, per-event count or out-of-scope name.
- Pack: `inputStall`, `probeAgreement` and `inputStallThreshold {stallMs, source, ignoredCurrent}`; the recorded threshold wins over `--stall-ms`.

### Unchanged
- `schema` is `hanger-json/2` and `schemaStatus` is `frozen`. `validate-report.js` accepts the new keys, rejects a bare number for a measurement inside `inputStall`, and still accepts every older report.

## v2.x (still `hanger-json/2`, `schemaStatus` stays `frozen`) - 2026-10-09 (storage-coverage)

Additive only: optional keys and optional children. Nothing is renamed or removed, so this is a `2.x` entry and not a bump to `/3`. Absence of any of these fields means the report predates the change; every reader shows a "not available" placeholder with a reason and keeps working. Readers and validators MUST ignore storage fields they do not understand.

### Added
- `spawnProbes[].disk.drives` (continuous tier): one entry per physical drive, `{drive, label, diskNumber, letters[], latencyMs, queue, busyPct, readBps, writeBps}`; the five measurements are provenance records (unit, window, source `disk.drive.*@counterSession`, time, precision); `drive` is the counter instance text (for example `0 C:`) and `label` is `Disk <number> (<volume letters>)`. No serial number is read or stored. The machine-total `disk.latencyMs`, `queue`, `busyPct`, `readBps` and `writeBps` are unchanged. `disk.drives` is `null` with `disk.drivesReason` (for example `not-exposed`) when the platform does not expose per-drive counters; one `collection.failures[]` entry (`inference: disk.drives`) is recorded per run.
- `spawnProbes[].disk.volumes` (continuous tier): one entry per volume letter, `{volume, freePct, freeMB}` as provenance records; `null` with `disk.volumesReason` when not exposed (failure `disk.volumes`).
- `storage` (root): `{workloadDrives, workloadDrivesReason, source}`. `workloadDrives` is the optional `drives` list the user wrote in the scope file (for example `["D:"]`), or `null` with `workloadDrivesReason: "workload drive not declared"`. The workload drive is never inferred from process activity. The scope file gains the optional key `drives`.
- `systemProfile.storage.disks.value[].number` (the disk number that joins a per-drive series to its model class, bus and media type) and `numberUnavailableReason` when it was not reported.
- `systemProfile.virtualMemory.pagefiles.value[].drive` (for example `C:`) and `driveUnavailableReason` when the location has no drive letter.
- Rule `disk-nearly-full` (drop-in, class `disk`) in `diagnosis.hangs[].rules[]` with its provisional limits in `summary.thresholds.rules['disk-nearly-full']` (`lowFreePct`, `warnFreePct`, `fallMB`, `disproveFreePct`); `extra` holds `{volume, freePct, freeMB, viaWarning, relevantVolumes, trend {firstFreeMB, lastFreeMB, fellMB, fallMBNeeded, points}, ioCulprit}`. Rule `disk-stall` gains `extra {perDrive {recorded, machineTotalQualified, drives[]}, slowDrive {drive, label, class, meanLatencyMs, n, hostsPagefile {value, reason, text}, hostsWorkload {value, reason, text}}, culprit {kind: named | outside-scope | none | not-recorded, text, group?, bps?, sharePct?, groupCount?}}` and its recorded parameters `culpritMinBps`, `culpritSharePct`, `syncClientBps`. A culprit `group` is only ever an in-scope group or a member of the fixed system set; `outside-scope` carries a rate and a group count and no name.
- New signal ids in rule evidence `inputs[].signal`: `disk.drive_latency_ms[<drive>]`, `disk.drive_queue[<drive>]`, `disk.drive_busy_pct[<drive>]`, `disk.drive_io_bps[<drive>]`, `disk.volume_free_pct[<volume>]`, `disk.volume_free_mb[<volume>]`, `disk.relevant_free_pct`, `disk.relevant_free_mb`, `proc.outside_io_bps` (an anonymous aggregate rate).
- `diagnosis.suggestedActions[]` may list the existing action `storage-health` for the new rule.
- Views: a "Storage" block in the evidence section (per-drive hang-versus-calm table, volume free-space table, pagefile and workload placement), per-drive series in the disk charts, and one `Storage:` line in the email draft. These are renderings of the fields above, not new JSON.

### Unchanged
- `schema` is `hanger-json/2` and `schemaStatus` is `frozen`. `validate-report.js` accepts reports with and without the new keys, checks only that the new keys are well formed when present, and still accepts every older report.
