# Design

## Context

The continuous tier already reads one machine-total disk set, per-process I/O (reduced through the scope resolver before storage), and the static system profile. The diagnosis engine runs drop-in rules over a frozen `telltale-json/2` report. This change adds data and a rule without changing the engine, the sampler core, or the scope resolver.

## Goals / Non-Goals

**Goals:**
- Tell a slow drive from a fast one, and say whether the slow one holds the pagefile or the workload.
- Judge low free space as a cause, honestly, with provisional thresholds.
- Name an in-scope process behind disk I/O when the data supports it, without ever naming an out-of-scope one.

**Non-Goals:**
- No SMART or wear reading beyond what the system profile already does at its tier.
- No file-level tracing (no per-file or per-path I/O); the workload drive is a user declaration, not an inference.
- No purchase or replacement verdict. Actions stay neutral.

## Decisions

1. **Per-drive series ride the existing counter session.** The physical-disk counters are read with a wildcard family reduced as `raw` (one line per instance), as network adapters are. No new process, no new cadence. The total instance stays the machine total. (API hint, non-binding.)
   *Alternative:* a storage query per tick. Rejected: heavy on a starved machine.
2. **Drive identity is the counter instance, joined to the profile later.** The instance text is a disk number plus volume letters (for example `0 C:`), which is not sensitive. The stored label is `Disk <n> (<letters>)`. Media and bus class come from the system profile by disk number and are joined when rendering, by one pure module (`lib/storage.js`), so a stored report recomputes identically and an older profile without a disk number yields "class unavailable".
3. **Free space is a volume series, not a drive series.** Free percent and free MB per volume letter on the continuous tier. The rule judges the volumes that matter: the system volume, volumes holding a pagefile, and volumes the user declared as workload drives. If none can be determined, every volume is judged and the rule says so.
4. **Disk nearly full is a drop-in rule (`disk-nearly-full`, class `disk`).** It fires at a hang when a relevant volume is below `lowFreePct` (default 10 %) on at least 3 usable probes within 10 s of the hang, or below the higher `warnFreePct` (default 15 %) while free space is falling by at least `fallMB` (default 500 MB) across the run. Defaults are provisional, overridable from the config `rules` object, and recorded under `summary.thresholds.rules`. Disprover: free percent at or above `disproveFreePct` (default 25 %) on every relevant volume at 2 of 3 or more hangs. Not evaluable when no relevant volume has a reading.
   *Alternative:* a fixed absolute GB floor. Rejected: percent and absolute space mean different things on a 256 GB and a 2 TB drive; the rule records both in its extra.
5. **Disk stall keeps its machine-total test and adds a per-drive test.** The rule fires when the machine total meets the existing condition, or when any single drive does. The result names the slowest qualifying drive. A drive with no reading at the hang is not a negative.
6. **Placement is declared or recorded, never guessed.** The pagefile drive comes from the profile's pagefile location. The workload drive comes only from an optional `drives` list in the scope file (for example `["D:"]`), recorded in the report. With no declaration the report says "workload drive not declared".
7. **Culprit naming reuses the stored per-process I/O.** At the hang, the largest I/O among in-scope groups and the fixed system set is compared with the out-of-scope aggregate. A name is given only when that group holds at least half of the observed I/O and at least the minimum rate (provisional). When the out-of-scope aggregate leads, the result says the I/O was dominated by load outside the declared scope, with its rate and group count, and names nothing.
8. **Sync clients are a confound only when in scope.** If an in-scope or system-set group is a known sync client and shows I/O in the window, the disk rules record a confound naming it. If it is not in scope, nothing about it is shown, so the privacy canary stays green. The user guide states the OneDrive case as a known confound.

## Risks / Trade-offs

- A drive instance can disappear mid-run (removable drive): its series simply ends; no value is invented.
- Thresholds are provisional guesses; the report says so and the config can override them.
- Free-space trend over a short run is weak evidence; the rule requires the low-free-space level, and the trend only widens the level to the warning line.

## Implementation notes

- The drive and volume signal families live in `lib/diagnosis/signals.js` (beside `disk.latency_ms`); only `proc.outside_io_bps` (an anonymous aggregate rate, never a name) is in `lib/diagnosis/cause-signals.js`.
- The finding sentence still uses the class label "disk stall" for the `disk` class; `disk-nearly-full` adds its own words through `describe()` ("the cause is a nearly full volume: C: had 5% free"), so the engine and the vocabulary did not change.
- The storage panel's calm values use the engine's calm definition (under the recovery threshold and at least 10 s from every hang); its freeze values are means over the hang probes, so the panel can be recomputed from a stored report.
- The email line takes the slow-drive latency only from the stored `disk-stall` result (a JSON value), so the trace-to-JSON check holds; with no stall it names the slowest drive without a number.
