# Tasks

Prerequisites: `system-profile-for-it` and `diagnosis-engine-rebuild` are archived, and the fixtures from `fix-report-integrity` and `diagnosis-engine-rebuild` exist under `tools/hanger/test/fixtures/`. Run every command from the repository root in Git Bash, and quote paths that contain spaces.

## 1. Fixtures and section model

- [x] 1.1 Add report fixtures under `tools/hanger/test/fixtures/report/`, all synthetic and with no real machine data:
  - `full-signals.json`: 3 hangs, 2 user marks, an AC-to-battery transition, one unobserved interval, a workload phase and a container start;
  - `zero-hang.json`: commit 52-65%, 0 hangs, the R03 sample case;
  - `open-scope.json`;
  - `scoped-nothing-running.json`;
  - `gpu-present.json`;
  - `pack.json`.

  Verify: `node -e "for (const f of require('fs').readdirSync('tools/hanger/test/fixtures/report')) JSON.parse(require('fs').readFileSync('tools/hanger/test/fixtures/report/'+f,'utf8'))"` exits 0. [R03-P1-4]
- [x] 1.2 Create `tools/hanger/lib/render/sections.js`. It builds the ordered section model (header, finding, actions, evidence, profile, gaps, appendix) from a trace or pack JSON. The header renders the scope declaration from the `scope` record. Verify: `tools/hanger/test/render-sections.test.js` asserts the section order and that the header contains the scope declaration, for the trace and pack fixtures. [R03-REC-13][R03-O-1][R03-REC-12][R03-P1-4]
- [x] 1.3 Implement the finding section, reading only diagnosis output and its vocabulary: at most 3 lines with freeze count, confirmations, at-hang vs calm with n, top in-scope grower, not observed, and confidence/strength. Verify: the test asserts the `full-signals` values verbatim, and that `zero-hang` names no cause class and contains no memory label. [R03-O-2][R03-P1-6][R03-REC-15][R03-P0-5]
- [x] 1.4 Implement the "What IT can do" section from the diagnosis suggested actions, cheapest first, each showing its rule id. Verify: the test asserts the action order and the rule ids match the fixture's `diagnosis.actions`. [R03-O-3]
- [x] 1.5 Implement the evidence section: a hang table with at-hang vs calm values per fired rule, with n. Verify: the test asserts one row per hang and per-rule columns for `full-signals`. [R03-O-4]
- [x] 1.6 Implement the system profile section. Every fact shows its value and unit, or "not available (<reason>)", and the row count equals the fact count. Verify: the test with the `full-signals` profile (one null fact). [R03-O-5][R03-REC-8][R03-P1-2]
- [x] 1.7 Switch the MD, print/report, and pack views to read `systemProfile` instead of the legacy `asset` block. Then remove the `asset` alias from the report JSON and record the removal in `tools/hanger/SCHEMA-CHANGELOG.md` (a dated `2.x` section; no version bump while v2 is a draft, IMPLEMENTATION-PLAN §2). Verify: `grep -rn "\.asset\b\|asset\." tools/hanger/*.js tools/hanger/lib/render` returns no reader of `asset`, the renderer tests pass on fixtures without an `asset` key, and the changelog has the entry. [R03-P1-2][R03-REC-8]
- [x] 1.8 Implement the gaps section. Map every `collection.failures[]` entry, tier skip, and unobserved interval to a plain-language sentence, e.g. "Docker: not installed". Raw stderr and exit codes are never rendered. Verify: the test asserts N failures give N sentences, and that "is not recognized as an internal or external command" is absent. [R03-O-6][R03-P2-2][R03-REC-14]
- [x] 1.9 Implement the appendix:
  - the in-scope culprit table;
  - events split into "during this run" and "history before this run";
  - method notes;
  - measured cost only when hangs > 0 (OQ-9);
  - the JSON file name with its sha256.

  Verify: the test asserts the split headings exist, cost is absent for `zero-hang`, and the hash matches the fixture file. [R03-O-7]

## 2. Formatting and IT-view hygiene

- [x] 2.1 Create `tools/hanger/lib/render/format.js` (`fmt(value, provenance)`): precision from provenance, else the unit default, with units always appended. Null renders as "not available (<reason>)". Verify: `tools/hanger/test/render-format.test.js` checks that `64.7166289074152` with unit % renders "64.7%", that null renders the reason, and that no rendered fixture output contains a number with more than 2 decimals (regex `/\d+\.\d{3,}/` finds no match). [R03-P2-1][R03-REC-14]
- [x] 2.2 Remove loop-lag rows, Warp/openspec "seen" rows and flags, prover-confound text, and filter fingerprints from the MD and HTML views. The JSON fields stay. Any flag shown in two views reads the same JSON field. Verify: the test greps the rendered MD and HTML of every fixture for `loop lag|Warp|openspec|prover`, expects 0 hits, and asserts the fixture JSON still contains those fields. [R03-REM-2][R03-REM-3][R03-P2-6][R03-P2-8][R03-REC-14]
- [x] 2.3 Make every view consume the single finding vocabulary from `lib/diagnosis/vocabulary.js`. There are no local label tables in `render-print.js`, the MD writer, pack, or trend. Verify: `grep -rn "RAM-BOUND\|PRESSURED\|STALL-OBSERVED\|SUSTAINED-PRESSURE\|NO-STALL\|STATE:" tools/hanger` returns no hits outside tests and the changelog. [R03-P1-6][R03-REC-15]

## 3. Inline SVG charts

- [x] 3.1 Create `tools/hanger/lib/render/svg-charts.js`:
  - a shared wall-clock x-scale across panels;
  - line/step/band/marker primitives with no script needed;
  - percent axes fixed at 0-100;
  - axis titles with units;
  - captions with n, window, and source;
  - a `<details>` data table after each SVG;
  - downsampling above 2,000 points, stated in the caption.

  Verify: `tools/hanger/test/render-svg.test.js` asserts on `full-signals` that every panel has the same x-domain equal to the first and last sample wall times, that % axes read 0 and 100, and that every caption contains "n=". [R03-REC-11][R03-P1-3]
- [x] 3.2 Freeze strip panel: latency markers, threshold line, user marks, OS-confirmed markers. Verify: the test counts marks (2) and the threshold line in `full-signals`. [R03-V-1]
- [x] 3.3 Memory panel: used %, commit %, available MB, pagefile %, pages in/out on their own sub-panel with spike annotation, and the optional standby/modified panel when data exists. Verify: the test asserts the series ids present and the standby panel present only when the fixture has standby data. [R03-V-2][R02-P2-9]
- [x] 3.4 CPU panel: total %, queue per logical CPU, security-software CPU (% of machine), and DPC+interrupt %. Verify: the test asserts the 4 series and the 0-100 axis. [R03-V-3]
- [x] 3.5 Clock/thermal/power panel: performance %, performance-limit %, per-zone temperature or "Temperature: not available (<reason>)", and battery %. Verify: the test asserts the placeholder text on a fixture with null temperature. [R03-V-4]
- [x] 3.6 Disk panel: latency (ms), queue, busy %, throughput. Verify: the test asserts the series and units in the axis titles. [R03-V-5]
- [x] 3.7 GPU panel only when GPU data exists or a GPU rule fired. Verify: the test asserts it is absent on `full-signals` and present on `gpu-present`. [R03-V-6]
- [x] 3.8 Top in-scope processes panel: a stacked area of up to 5 in-scope groups plus one "outside declared scope (aggregate)" band. Verify: the test asserts at most 6 layers, and that no out-of-scope name from `scoped-nothing-running` appears in the HTML. [R03-V-7]
- [x] 3.9 Annotation overlay on every panel: hang bands, user marks, OS-confirmed markers, workload phase spans (labelled), lifecycle markers, AC/battery band, unobserved hatching. Verify: the test asserts each panel has 3 hang bands at identical x, 2 marks, 1 AC/battery boundary, 1 unobserved shading, and the label "docker compose up". [R03-V-8][R03-P1-3]
- [x] 3.10 Embed the panels in evidence section 4 of `.report.html`. No `<script>` is needed for charts, no external URL appears, and the print CSS never hides a chart or its ancestors. Verify: the test asserts the regex `/(src|href)=["']https?:|@import|url\(["']?https?:/` finds nothing, and that a parse of the `@media print` rules finds no `display:none`/`visibility:hidden` on a selector matching `.chart`, `svg`, or `section`. [R03-P1-3][R03-REC-11]

## 4. Output formats

- [x] 4.1 Make `render-print.js` the report renderer (trace + pack) on top of the section model. Output is `<stamp>.report.html`. Pack sections it lacks print "not in pack: see trace <file>". Verify: `node tools/hanger/render-print.js tools/hanger/test/fixtures/report/pack.json "$TMPDIR/p.report.html"` exits 0, and the test asserts the same heading order as the trace fixture. [R03-P1-4][R03-REC-13]
- [x] 4.2 Rewrite the MD writer in `hanger.js` to use the section model (same order as the HTML), referencing the `.email.txt` in the header. Verify: the test asserts the MD heading order equals the HTML heading order for every fixture. [R03-REC-13][R03-P1-4]
- [x] 4.3 Remove the legacy `.html` writer and `render-charts.js`. Make `--charts` an alias of `--print` with a deprecation notice. Make report and email output the default for `trace`/`record`, with a `--no-report` opt-out. Verify: a 20 s live trace (task 7.3) leaves exactly `.json/.md/.report.html/.email.txt` for its stamp, and `--charts` prints the deprecation line. [R03-REM-4][R03-REC-5][R03-P0-5][R03-REC-14]
- [x] 4.4 Update the README "Outputs" section: the formats keep/remove table, `--charts` deprecation, `--no-report`, and the note that the tool never sends anything. Verify: the README lists `.report.html` and `.email.txt`, and no longer mentions `.charts.html` as an output. [R01-REC-6]

## 5. Email draft

- [x] 5.1 Create `tools/hanger/lib/render/email.js`. It implements the template in design.md from a single JSON-path binding table. A missing path renders "not available". The subject is "Freeze evidence - <model> <serial> - <N> freezes in <T> min". Verify: `tools/hanger/test/email.test.js` checks the subject on `full-signals` and `zero-hang` ("0 freezes"), and that the zero-hang body names no cause. [R03-P1-1][R03-REC-10][R01-P1-7][R01-REC-6][R03-O-8]
- [x] 5.2 Add the numeric-trace checker. Every numeric token (excluding dates and the stamp) equals a JSON value at display precision or a JSON count. Identity strings equal JSON strings. An injected unbacked number fails the render with an error naming it. Verify: `email.test.js` runs the checker over every fixture and includes the negative case. [R01-REC-6][R03-REC-10]
- [x] 5.3 Add the scope and gaps lines: the open-scope warning sentence, the scoped summary (monitored entries plus out-of-scope group count, no names), and "Not measurable without admin: …". Verify: the test covers `open-scope` (warning present) and `scoped-nothing-running` (no out-of-scope names; the count is present). [R03-REC-12][R03-O-6]
- [x] 5.4 Add the attachment manifest. sha256 is computed from the bytes on disk of `.json` and `.report.html`. The inventory artifact is never listed. The same manifest appears in the HTML appendix. Verify: the test writes the outputs to a temp directory, recomputes the hashes, compares the prefixes, and greps for the inventory file name (0 hits). [R03-O-7][R03-O-8]
- [x] 5.5 Embed the email text as a copy block after section 3 in `.report.html`. Verify: the test asserts the copy-block text equals the `.email.txt` content. [R03-O-8][R03-REC-10]

## 6. Pack and trend consistency

- [x] 6.1 Render `pack` output through the same renderer and vocabulary. Make the trend table labels come from the shared vocabulary. Verify: `node tools/hanger/hanger.js pack --out "$TMPDIR/tt"` writes a `.report.html` whose headings match the trace order, and `node tools/hanger/hanger.js trend --out "$TMPDIR/tt"` shows no legacy STATE words. [R03-P1-6][R03-REC-15]

## 7. Integration check

- [x] 7.1 Render every fixture offline. Verify: `for f in tools/hanger/test/fixtures/report/*.json; do node tools/hanger/render-print.js "$f" "$TMPDIR/$(basename "$f" .json).report.html" || exit 1; done` exits 0 with the network adapter disabled or in airplane mode. `grep -l "https\?://" "$TMPDIR"/*.report.html` returns nothing. [R03-P1-3]
- [x] 7.2 Print to PDF headlessly and check that the charts are present. Verify: `"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="$TMPDIR/full.pdf" "file:///$(cygpath -m "$TMPDIR/full-signals.report.html")"` writes a PDF. A visual check of page 2 shows every chart panel. Fallback when Edge is unavailable: open the HTML in any browser, use Print → Save as PDF, and do the same check. Record which path you used in the review-gate note. [R03-P1-3][R03-REC-11]
- [x] 7.3 Run a live trace with report output. Verify: `node tools/hanger/hanger.js trace --duration 30 --anonymize --print --out "$TMPDIR/tt"`, then confirm that exactly `.json/.md/.report.html/.email.txt` exist for the stamp, the JSON parses, the email's first line starts with "Subject: Freeze evidence - ", and the report opens with header, scope, and finding before any table. [R03-O-1][R03-O-2][R03-REM-4]
- [x] 7.4 Run the full test suite and the privacy canary. Verify: `node --test tools/hanger/test/` passes, and `node tools/hanger/test/canary-leak.js` reports zero hits (it covers `.report.html` and `.email.txt`). [R03-REC-12]
- [x] 7.5 Bind the email template's JSON paths to the fields that actually shipped. Check every path in the design.md binding table against a fresh trace JSON and the archived `diagnosis`, `scope`, and `system-profile` specs, and correct the table and `lib/render/email.js` where they differ. Then freeze the schema: set `schemaStatus: "frozen"` and add a SCHEMA-CHANGELOG entry closing the v2 draft (IMPLEMENTATION-PLAN §2). Verify: `node tools/hanger/test/helpers/validate-report.js "$TMPDIR/tt/"hanger-*.json` passes with `schemaStatus` `frozen`, and `tools/hanger/test/email.test.js` asserts that no "not available" placeholder appears for the `full-signals` fixture. [R01-REC-6][R03-P1-1]
- [x] 7.6 Validate the change. Verify: `openspec validate report-and-visualization --strict` passes, and `openspec validate --all` reports no new failures.
- [x] 7.7 Write the review-gate note below with the date, the commands run from 7.1-7.6, the observed results, and the PDF path used.

## Review-gate note

Date 2026-10-08. Implementation agent (Sonnet); reviewer: owner to confirm.

- 1.x-6.x: `node --test tools/hanger/test/` = 410 tests green (new: render-report.test.js, email.test.js; report fixtures built by test/fixtures/build-report-fixtures.js into test/fixtures/report/). Fixtures: 5 trace fixtures + pack, valid JSON. The renderer is lib/render/{sections,format,series,svg-charts,html,md,email,index}.js; render-print.js is the CLI over it; lib/views.js and render-charts.js are deleted.
- 7.1 Offline: every fixture rendered by `node tools/hanger/render-print.js` (exit 0); a test asserts no `http(s)://`, no `<script`, and no print rule hiding a chart. The renderer has no network code, so airplane mode was not toggled (not done on this machine; structural check only).
- 7.2 PDF: Edge headless `--print-to-pdf` of a real 30 s report wrote a PDF of 345 KB versus 238 KB for the same HTML with the SVG charts stripped (charts print). Screenshots (Edge `--screenshot`) of the fixture and the real report were inspected: scope banner first, finding, copy block, evidence tables, every chart panel with its shared clock. No PDF-to-image tool is installed, so pages were judged from the screen render plus the size check.
- 7.3 Live: `node tools/hanger/hanger.js trace --duration 30 --anonymize --hang 150 --print --charts --out <scratch>` wrote exactly .json/.md/.report.html/.email.txt (plus the run stream .jsonl), the JSON validates, the email starts "Subject: Freeze evidence - ", `--charts` printed the deprecation line, times show UTC+05:30 from run.utcOffsetMin. A second 40 s default trace gave "no freeze observed". `pack --out` wrote pack-<stamp>.report.html with the same seven headings and "Not in pack" lines; `trend` shows only the new class names.
- 7.4 Canary: `node tools/hanger/test/canary-leak.js` -> canary hits: 0 (covers .report.html and .email.txt of the trace-print run).
- 7.5 Email JSON paths bound in lib/render/email.js BIND against a fresh trace JSON and the landed diagnosis (suggestedActions) and system-profile shapes; no "not available" in the full-signals draft. Schema frozen: schemaStatus "frozen" in lib/core-report.js, SCHEMA-CHANGELOG closing entry, validate-report.js rejects other statuses and any `asset`. diagnosis-cause-rules had landed (14 rule modules, actions.js, its changelog entry) before the freeze; its one shape addition (diagnosis.suggestedActions) is in the schema and rendered generically.
- 7.6 `openspec validate report-and-visualization --strict` valid; `openspec validate --all` 12 passed, 0 failed.
- Deviations: (a) a file cannot hold its own hash, so the HTML copy block's attachment line lists the JSON hash and says the report.html hash is in the .email.txt; every other line equals the email file. (b) The email number checker allows JSON leaves at 0-3 decimals plus named derived values (observed minutes, longest freeze seconds, array lengths). (c) "Top in-scope grower" in the finding is a descriptive first-to-last working set from the stored per-process series (not a diagnosis field). (d) Email lists next steps from diagnosis.suggestedActions; when the key is absent and a cause exists it says "not recorded".
