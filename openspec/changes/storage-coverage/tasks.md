# Tasks

Prerequisites (already archived on main): `data-signals-completeness`, `diagnosis-cause-rules`, `system-profile-for-it`, `report-and-visualization`, `software-inventory-and-scope`. Conventions: zero dependencies; `node --test tools/hanger/test/` passes after every task; new pure logic in `tools/hanger/lib/*.js` with no side effects at require time; cite requirement names, not line numbers. The report stays at `hanger-json/2` `frozen`.

## 1. Collection

- [x] 1.1 Extend `lib/collectors/disk.js` to read per-drive counters and per-volume free space through the shared counter session (wildcard families reduced per instance), and build `disk.drives[]` (label, disk number, letters, five provenance records) and `disk.volumes[]` (free percent and free MB records), null with reason otherwise. Verify: canned two-drive text in `test/storage-signals.test.js`. Closes: metrics "Per-drive disk signals", "Volume free space".
- [x] 1.2 Record one collection failure each for missing per-drive and missing volume counters. Verify: the missing-counters fixture asserts the two failures. Closes: metrics "Per-drive disk signals".
- [x] 1.3 Add disk number to the profile disk rows and the drive letter to each pagefile entry (null with reason when absent). Verify: `test/storage-view.test.js` (canned profile text: disk number, pagefile drive). Closes: system-profile "Storage facts", "Virtual memory configuration facts".
- [x] 1.4 Accept an optional `drives` list in the scope file, validate letter-and-colon, record it in the report key `storage.workloadDrives`. Verify: `test/storage-view.test.js` (scope file `drives`) and the updated defaults in `test/workload-scope.test.js`. Closes: scope "Sync clients are a confound only within scope" (scenario: scope file declares workload drives), system-profile "Drive placement of the pagefile and the workload".

## 2. Pure storage view

- [x] 2.1 Create `lib/storage.js`: drives seen in the probes, class joined from the profile by disk number, pagefile and workload placement (yes/no/unknown with reason), relevant volumes. Verify: `test/storage-view.test.js`. Closes: system-profile "Drive placement of the pagefile and the workload".
- [x] 2.2 Register signals for the per-drive and volume values (families addressed by drive or volume) and the relevant-volume free percent. Verify: `test/storage-signals.test.js` (signal ids against the real collector row); `rules/signal-mapping.test.js` continues to pass.

## 3. Diagnosis

- [x] 3.1 Add the recorded parameters of `disk-nearly-full` and `disk-stall` extras to `lib/diagnosis/rule-params.js`. Verify: recorded and config-override test in `test/rules/disk-nearly-full.test.js` and `test/rules/contract-shape.test.js`. Closes: diagnosis "Disk nearly full rule" (limits configurable and recorded).
- [x] 3.2 Add `lib/diagnosis/rules/disk-nearly-full.js` (drop-in, evaluated disprover, not evaluable when signals are missing) and the `storage-health` action mapping. Verify: `test/rules/disk-nearly-full.test.js` with nearly-full, healthy, falling, disproved and missing-counter fixtures. Closes: diagnosis "Disk nearly full rule".
- [x] 3.3 Extend `lib/diagnosis/rules/disk-stall.js` with the per-drive test, slow-drive naming and placement fields, and the extended disprover. Verify: `test/rules/disk-stall-drives.test.js` with multi-drive, healthy and pagefile fixtures; the existing disk-stall tests unchanged. Closes: diagnosis "Disk stall rule".
- [x] 3.4 Add culprit naming (in-scope or system group, anonymous aggregate otherwise) and the in-scope sync-client confound to both disk rules. Verify: out-of-scope-culprit fixture; `node tools/hanger/test/canary-leak.js` reports zero hits. Closes: diagnosis "Disk culprit naming stays within scope", scope "Sync clients are a confound only within scope".

## 4. Report, email, profile

- [x] 4.1 Add the storage block and per-drive chart series to the report renderers with placeholders. Verify: `test/storage-render.test.js` (Markdown and HTML, multi-drive and missing-data fixtures). Closes: report-views "Storage panel".
- [x] 4.2 Add the storage line to the email with trace-to-JSON binding. Verify: `test/storage-render.test.js` (including the traced-number check) and the adjusted placeholder test in `test/email.test.js`. Closes: it-handoff "Email states storage findings".
- [x] 4.3 Render the new profile facts (disk number, pagefile drive) in the system profile section. Verify: profile fact-row count equals the JSON fact count in `test/storage-render.test.js`. Closes: report-views "System profile section" (unchanged requirement, covers the new facts).

## 5. Schema and docs

- [x] 5.1 Add the dated 2.x section to `tools/hanger/SCHEMA-CHANGELOG.md`; keep schema `hanger-json/2` frozen; confirm the validator and an older report pass. Verify: `test/schema-version.test.js` additions. Closes: evidence-persistence "Storage fields are additive under the frozen schema".
- [x] 5.2 Document the storage signals, the `drives` scope key, the threshold keys and the OneDrive confound in `docs/USER-GUIDE.md`. Verify: the guide's scope example test still passes.

## 6. Integration

- [x] 6.1 Run `node --test tools/hanger/test/`, `node tools/hanger/test/canary-leak.js` and `openspec validate --all --strict`. Review-gate note (2026-10-09): `node --test tools/hanger/test/` 620/620 pass (was 566); `openspec validate --all --strict` 13/13 pass. `node tools/hanger/test/canary-leak.js` ran the scoped trace, watch, pack and print modes (all PASS) and then aborted at the input-response self-check "detector recorded episodes with the canary window in the foreground (none)" (needs an interactive desktop; unrelated to storage), so its final grep did not run; a manual case-insensitive grep of every artifact it wrote (json, jsonl, md, report.html, email.txt, pack, watch; private/ excluded) for the canary name found zero hits.
- [x] 6.2 Live check on Windows 11, no admin: a short trace to a temp directory; confirm per-drive entries, volume entries, the storage block and the email line. Review-gate note (2026-10-09): `node tools/hanger/hanger.js trace --duration 24 --scope <scope with drives C:> --no-input-stall --out <temp>`, no admin, Windows 11. Observed: `disk.drives` = Disk 0 (C:) with latency, queue, busy and throughput records; `disk.volumes` = C: 71.8% free, 349264 MB; `storage.workloadDrives` = ["C:"]; profile disk number 0 and pagefile drive C:; the Markdown storage block shows NVMe SSD, hosts pagefile yes, hosts workload yes, "no freeze observed" on the freeze side; the email line reads "Storage: no freeze observed, so no drive is singled out; lowest free space C: 71.8% (349264 MB)."; `validate-report.js` OK.
