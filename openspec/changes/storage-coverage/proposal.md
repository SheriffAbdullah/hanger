# Proposal

## Why

Storage is the least covered resource in a Telltale report. Disk latency, queue, busy time and throughput are recorded only as a machine total, so a slow drive hides behind a fast one, and the report cannot say which drive was slow. A volume that is nearly full is a common cause of freezes (paging, indexing, sync clients, update staging) and no rule looks at free space at all. The system profile lists the pagefile but not which drive holds it, so a slow drive that hosts the pagefile cannot be told apart from a slow drive that does not. The disk-stall rule says a disk stalled but never says which in-scope program was driving the I/O.

## What Changes

- **Per-drive disk signals:** latency, queue, busy time and read and write throughput per physical drive on the continuous tier, each a provenance record, beside the machine total. Each drive is identified by a non-sensitive label (disk number, media and bus class, volume letters), never a serial number. When the platform does not expose per-drive data the value is null with a reason.
- **Volume free space:** free percent and free MB per volume on the continuous tier, so a low-free-space trend can be judged.
- **Disk nearly full rule:** a new drop-in cause rule that fires at a hang when a relevant volume is low on free space, and when free space is falling. Thresholds are provisional and configurable; the confidence is derived; the disprover is evaluated; missing signals make the rule not evaluable, never negative.
- **Pagefile placement:** the system profile records which drive each pagefile lives on. The report derives, for each drive, whether it hosts the pagefile and whether it hosts the monitored workload (declared by the user in the scope file).
- **Disk-stall rule uses per-drive data:** the rule can fire on a single slow drive that the machine total hides, names the slow drive by label, says whether it hosts the pagefile or the workload, and, where per-process disk I/O exists, names an in-scope process that drove the I/O. Out-of-scope processes stay anonymous: only the aggregate is reported.
- **Rendering:** the report gets a storage table (per drive, with hang and calm values, free space, pagefile and workload placement) and per-drive series in the disk charts; the email gets one storage line; the system profile section lists the new facts. Every item has a placeholder with its reason when unavailable.
- **Schema:** additive fields only, under the frozen `telltale-json/2` policy, with a dated `2.x` entry in `SCHEMA-CHANGELOG.md`. Validators and readers tolerate reports without the new fields.
- **Known confound:** a sync client (for example OneDrive) reading or writing files under the monitored folders is a confound for any disk finding. It is shown only when the client is in the declared scope, so no new identity is ever disclosed.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `metrics`: MODIFIED "Disk latency, queue, utilization, and throughput"; ADDED "Per-drive disk signals" and "Volume free space".
- `diagnosis`: MODIFIED "Disk stall rule"; ADDED "Disk nearly full rule" and "Disk culprit naming stays within scope".
- `system-profile`: MODIFIED "Storage facts" and "Virtual memory configuration facts"; ADDED "Drive placement of the pagefile and the workload".
- `report-views`: ADDED "Storage panel".
- `it-handoff`: ADDED "Email states storage findings".
- `evidence-persistence`: ADDED "Storage fields are additive under the frozen schema".
- `scope`: ADDED "Sync clients are a confound only within scope".

## Impact

- `tools/telltale/lib/collectors/disk.js` (per-drive and per-volume parsing), `lib/diagnosis/signals.js`, `lib/diagnosis/cause-signals.js`, new `lib/storage.js` (pure drive, volume and pagefile view), `lib/diagnosis/rules/disk-stall.js`, new `lib/diagnosis/rules/disk-nearly-full.js`, `lib/diagnosis/rule-params.js`, `lib/diagnosis/actions.js`.
- `lib/system-profile.js` (disk number, pagefile drive), `lib/workload/scope-ext.js` (declared workload drives), `telltale.js` (report key `storage`).
- `lib/render/*` (storage table, per-drive series, email line, profile labels), `docs/USER-GUIDE.md` (one section).
- `tools/telltale/SCHEMA-CHANGELOG.md`: a `2.x` additive section.
- Tests and fixtures: nearly full disk, healthy disk, multi-drive, missing counters, out-of-scope culprit.

## Findings addressed

- Storage coverage gaps: per-drive signals, free space, pagefile placement, and culprit naming for disk causes.
