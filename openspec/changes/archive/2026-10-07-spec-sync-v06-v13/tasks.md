# Tasks

Spec and docs only. Do NOT edit `tools/hanger/**`, `hanger.config.json`, or `README.md`.
Run the commands from the repo root in Git Bash. Some commands below use an empty config,
so the repo's `anonymize`/`hide` defaults do not apply. Create it once:
`echo {} > "$TMPDIR/tt-empty.json"`.

## 1. Verify that the back-filled scenarios hold against current code

- [x] 1.1 Run an unelevated trace and confirm that every probe has the OS first-order keys and that the tier is `user`. Verify: `node tools/hanger/hanger.js trace --duration 20 --config "$TMPDIR/tt-empty.json" --out "$TMPDIR/tt-sync"`, then `node -e "const fs=require('fs'),d=process.argv[1];const f=fs.readdirSync(d).filter(x=>/^hanger-.*\.json$/.test(x)).pop();const r=JSON.parse(fs.readFileSync(d+'/'+f));console.log(r.tier,r.spawnProbes.every(p=>['committed','pages','cpuQ','diskQ','defender','maxFreq'].every(k=>k in p)),r.admin&&r.admin.skipped)" "$TMPDIR/tt-sync"` prints `user true <reason>`. [R01-P0-4] [R01-P2-1]
- [x] 1.2 Confirm that the source contains no security-event-log query and no deprecated WMI command-line tool. Verify: `grep -nE "LogName *= *'Security'|wmic" tools/hanger/hanger.js` prints nothing. [R01-P1-3f]
- [x] 1.3 Confirm that the kernel-trace opt-in is skipped and disclosed when unelevated. Verify: `node tools/hanger/hanger.js trace --duration 10 --wpr --config "$TMPDIR/tt-empty.json" --out "$TMPDIR/tt-sync"` prints `--wpr needs elevation: skipped`, and the newest JSON has `wprEtl: null`. [R01-P1-3f]
- [x] 1.4 Confirm the portability contract check and strict mode. Verify: `node tools/hanger/hanger.js check-stub --strict` prints `strict: all 16 stub entries map to COLLECTORS rows`, one GREEN/RED line per entry, and a `<g>/<n> green` summary. Then copy `tools/hanger/mac-stub.json` to `$TMPDIR`, add an entry with collector id `nope`, and confirm the documented orphan behavior by reading the strict-mode code path. Do not edit the shipped stub. [R01-P0-4]
- [x] 1.5 Confirm trend, compare, and missing-file behavior. Verify: `node tools/hanger/hanger.js trend --out "$TMPDIR/tt-sync"` prints `[trend] N reports`; `node tools/hanger/hanger.js trend --compare A.json missing.json --out "$TMPDIR/tt-sync"` prints `need two readable reports`. [R01-P0-4]
- [x] 1.6 Confirm pack assembly with one trace and with an empty directory. Verify: `node tools/hanger/hanger.js pack --config "$TMPDIR/tt-empty.json" --out "$TMPDIR/tt-sync"` writes `pack-*.json` with `provenance.traceReport` set and a `sustained.source` that starts with `trace-window`. `node tools/hanger/hanger.js pack --config "$TMPDIR/tt-empty.json" --out "$TMPDIR/tt-emptydir"` gives `sustained.source: none` and `hangs.count: unknown`. [R01-P0-4]
- [x] 1.7 Confirm the watch rollup with and without rows. Verify: `node tools/hanger/hanger.js watch --watch-secs 6 --config "$TMPDIR/tt-empty.json" --out "$TMPDIR/tt-sync"`, then `node tools/hanger/hanger.js watch --rollup weekly --out "$TMPDIR/tt-sync"` prints a day row with `n=` and `n/a` for hangs. Run the rollup against `$TMPDIR/tt-emptydir` and confirm it prints `no baseline rows ... (0 files)`. [R01-P0-4]
- [x] 1.8 Confirm the non-goals and install contract. Verify: `grep -nE "https?\.request|fetch\(|net\.connect" tools/hanger/*.js` shows no upload path; `ls package.json node_modules` fails; `git check-ignore reports/x.json` prints the path; `node tools/hanger/hanger.js --help` exits 0. [R01-P2-2] [R01-P2-4] [R01-REC-4]
- [x] 1.9 If any check in 1.1-1.8 does not hold, adjust only the wording of the matching scenario in `specs/` so it describes the current code truthfully. Never change code. Verify: `openspec validate spec-sync-v06-v13 --strict` passes. [R01-P0-4]

## 2. Direct main-spec and docs edits (non-requirement text, done at archive time)

- [x] 2.1 After archiving this change, edit the `## Purpose` of `openspec/specs/metrics/spec.md`. Drop "registry v0.4". State the purpose as the metric contract: first-order OS and process sets, hang events, and self-load accounting. Verify: `grep -n "registry v0.4" openspec/specs/metrics/spec.md` prints nothing. [R01-P1-3i] [R01-REC-3]
- [x] 2.2 Edit the `## Purpose` of `openspec/specs/tracking/spec.md`. Replace "Always-on" with "User-started", describing the `watch` light continuous log plus deep `trace` capture. Rename "JSONL baseline" to "watch log" in the Purpose only. Verify: `grep -ni "always-on" openspec/specs/tracking/spec.md` prints nothing. [R01-P2-6] [R01-REC-5]
- [x] 2.3 In both `metrics` and `tracking` main specs, replace the `## v0.6 deferrals` block with a `## Deferred` section. List DEF-1 (handles/threads/tree), DEF-2 (lagged correlation and culprit formula), and DEF-3 (per-bucket WER), each with "see openspec/IMPLEMENTATION-PLAN.md §6.5" and today's date. Verify: `grep -n "v0.6 deferrals" openspec/specs/*/spec.md` prints nothing, and `openspec validate --specs --strict` passes. [R01-P1-3g] [R01-REC-3]
- [x] 2.4 In `openspec/explorations/orders-framework.md` and `openspec/explorations/ontology.md`, annotate the lagged-correlation and `0.4·share+0.3·co-occur+0.2·paging+0.1·event` claims as "not implemented; see DEF-2 in IMPLEMENTATION-PLAN §6.5". Verify: `grep -n "DEF-2" openspec/explorations/orders-framework.md openspec/explorations/ontology.md` shows both files. [R03-L3-3]

## 3. Process repairs

- [x] 3.1 Add the `archive` rules and the `tasks` citation rule (requirement names and finding IDs, never source line numbers) to `openspec/config.yaml`, as shown in design.md. Verify: `openspec validate --all --strict` still parses the config, and `grep -n "never source line numbers" openspec/config.yaml` matches. [R01-REC-7] [R01-P2-8]
- [x] 3.2 Close `hanger-v09`. In its `tasks.md`, mark the two open items as relocated: "Threshold citations → diagnosis-engine-rebuild" and "Invariant-culture numbers → sampling-engine-and-provenance; file split → fix-report-integrity lib seams". Tick "Smoke + review; archive" with a note citing `reviews/01-openspec-review.md`. Then run `openspec archive hanger-v09 --skip-specs -y`. Verify: `openspec list` no longer shows `hanger-v09`. [R01-P0-4] [R01-REC-7]
- [x] 3.3 Close `hanger-v13`. Tick "Review; archive" with a note citing `reviews/01-03` and "renderers re-specified by report-and-visualization". Then run `openspec archive hanger-v13 --skip-specs -y`. Verify: `openspec list` shows no `hanger-v13`. [R01-P0-4] [R01-REC-7]
- [x] 3.4 Record the v08 review. In `openspec/changes/archive/2026-10-07-hanger-v08/tasks.md`, tick "Review; archive" and add a review note citing `reviews/01-openspec-review.md` P0-2 and `reviews/02-data-layer-review.md` P0-2. The note must say that the redaction model is superseded by software-inventory-and-scope. Verify: `openspec validate --archived` reports no unchecked task for v08. [R01-P0-4] [R01-REC-7]

## 4. Integration check

- [x] 4.1 Archive this change, then validate everything. Verify: `openspec archive spec-sync-v06-v13 -y` succeeds with no "not found" header errors, and `openspec validate --all --strict` reports 0 failures. [R01-P0-4] [R01-REC-7]
- [x] 4.2 Append a review-gate note to this file (date, the commands from 1.1-1.8 and 4.1, observed results) under `## Review gate`. Verify: the section exists and lists each command with its result. [R01-REC-7]

## Workflow follow-up

- Groups 2 and 3 run after 4.1's archive step where they edit main specs. The implementer orders them: 1 → 3.1 → archive (4.1) → 2 → 3.2-3.4 → re-run `openspec validate --all --strict` → 4.2.

## Review gate

Date 2026-10-07, Windows 11, unelevated shell (tier=user), Node 18+, empty config.
- 1.1 `trace --duration 20 --config empty` then JSON check: printed `user true process not elevated; re-run as admin for thermal/SMART/Sysmon/WER-sys/SeDebug`. Holds.
- 1.2 `grep -nE "LogName *= *'Security'|wmic" tools/hanger/hanger.js`: no output. Holds.
- 1.3 `trace --duration 10 --wpr`: printed `--wpr needs elevation: skipped (tier=user)`; JSON `wprEtl: null`. Holds. Elevated disclosure scenario (path recorded, stop on exit/SIGINT/crash) not run (no elevated shell); SIGINT and uncaughtException stop hooks confirmed by reading the code.
- 1.4 `check-stub --strict`: `strict: all 16 stub entries map to COLLECTORS rows`, 16 GREEN lines, `16/16 green`; orphan path read in code (prints `STRICT FAIL: orphan stub entries`, exitCode 1). Holds.
- 1.5 `trend --out`: `[trend] 2 reports ...` with delta columns; `--compare A missing.json`: `need two readable reports ... got A=... B=missing.json`; two valid files print A-minus-B deltas and a basis line. Wording fixed: compare error names both files, not only the missing one.
- 1.6 `pack`: pack-*.json with `provenance.traceReport` set, `sustained.source` = `trace-window (no baseline JSONL; single-window, not sustained)`; empty dir: `sustained.source: none`, `hangs.count: unknown`. Holds.
- 1.7 `watch --watch-secs 6` then `watch --rollup weekly`: day row `n=3 ... hangs/day n/a`; empty dir: `no baseline rows ... (0 files)`. Wording fixed: the rollup column is paging-rate (pages/s) p95, not hard-fault p95.
- 1.8 No `https.request|fetch(|net.connect` in tools/hanger/*.js; no package.json or node_modules; `git check-ignore reports/x.json` prints the path; `--help` exit 0. Holds. Wording fixed: the non-goal bans reporting installed software to IT, so it does not conflict with local-only inventory in software-inventory-and-scope. Trend row wording fixed to `commit %, paging rate`.
- 1.9 `openspec validate spec-sync-v06-v13 --strict`: valid.
- 3.1 config.yaml gained `archive` rules and the tasks citation rule.
- 4.1 `openspec archive spec-sync-v06-v13 -y`: specs updated (evidence-surface +2; metrics +2 ~1; tracking +3), no header errors. Groups 2 and 3.2-3.4 then done: Purpose and Deferred edits, explorations annotated, v09 and v13 archived with `--skip-specs` (each given `.openspec.yaml` with `skip_specs: true`), v08 review recorded.
- Final: `openspec validate --all --strict`: 12 passed, 0 failed; `openspec list` shows no hanger-v09 or hanger-v13. `openspec validate --archived` still flags 2026-10-06-hanger-v05 (1 pre-existing unchecked task, out of scope) and this change (tasks ticked after archive; now complete).
