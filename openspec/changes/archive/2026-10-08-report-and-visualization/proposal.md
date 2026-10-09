# Proposal: report-and-visualization

## Why

An IT reader who receives today's report rejects it within a minute. The verdict comes first, a 17-row mixed table follows, and the incident (hang rows) comes after that. The system profile is never shown. Only 3 of 10+ collected series are charted. The charts need a CDN, and the print path hides them, so a PDF has no charts. There is no ready-to-send email, which is the deliverable the owner asked for (R01-P1-7, R03-P1-1, R03-P1-3, R03-P1-4). By wave 6 the evidence underneath is sound: scope, signals, profile, and the diagnosis engine. This change makes the report present that evidence in the order IT reads it, and adds a draft message the user can paste.

## What Changes

- A fixed section order for every shareable view (MD and HTML, trace and pack). The order is header with scope, then finding, what IT can do, evidence and charts, system profile, gaps and receipts, and appendix.
- A first-page finding of at most 3 lines, built from the diagnosis engine's ranked cause list and its vocabulary. Views never compute their own labels (R03-P1-6).
- Small-multiple charts on one shared wall-clock axis covering the freeze strip, memory, CPU, clock/thermal/power, disk, GPU (conditional), and the top in-scope processes over time. Every chart carries annotations for hang bands, user marks, OS confirmations, workload markers, AC/battery bands, and unobserved gaps.
- Charts are inline SVG generated at render time. They need no network and appear in print/PDF.
- A system-profile section in every view. Gaps are stated in plain language, with no raw shell errors.
- Display precision rules and units on every displayed number.
- Developer-only diagnostics leave IT views: loop lag, Warp/openspec rows, and prover confound text. They stay in JSON.
- **BREAKING**: the legacy `.html` output is removed. `.report.html` (the former print view) is the only HTML view.
- **BREAKING**: `.charts.html` is folded into `.report.html`. `--charts` becomes a deprecated alias of `--print` for one release.
- A new `.email.txt` ready-to-send draft per trace, plus a copy block in `.report.html`. Every number in it traces to the JSON. It states the scope and the gaps. It lists the attachments with sha256. The tool never sends anything.

## Capabilities

### New Capabilities
- `report-views`: section order, first-page finding, system-profile section, plain-language gaps, chart set and annotations, offline/print charts, display precision, IT-view exclusions, output formats.
- `it-handoff`: the ready-to-send email draft, its traceability to the JSON, its scope and gaps statements, and the attachment manifest.

### Modified Capabilities
- None. The scope-declaration content is owned by `scope` ("Scope declaration leads every shareable view", change `software-inventory-and-scope`). The finding vocabulary is owned by `diagnosis` (change `diagnosis-engine-rebuild`). This change renders both and does not restate them.

## Impact

- Code: `tools/hanger/render-print.js` becomes the report renderer (trace + pack). New `tools/hanger/lib/render/{sections,svg-charts,format,email}.js`. `render-charts.js` is removed (or kept as a thin alias shim for one release). The MD writer and the legacy HTML writer in `hanger.js` are replaced: the MD uses the shared section model, and the legacy HTML is deleted.
- Outputs: `.html` and `.charts.html` are no longer written. `.report.html` and `.email.txt` are new. `--print` is on by default for `trace` and `record` (see design D5).
- Tests: new `tools/hanger/test/render-*.test.js` and `email.test.js` using fixtures from `fix-report-integrity` and `diagnosis-engine-rebuild`.
- Docs: README "Outputs" section.
- Dependencies: none added. ECharts and the CDN are removed.

## Findings addressed

- R01-P1-7: No SHALL requires the IT deliverable / email to exist
- R01-REC-6: it-deliverable capability, a paste-ready summary with no numbers absent from the JSON
- R02-P2-9: standby/modified data unused (optional memory panel). The DPC part is in diagnosis-cause-rules.
- R03-P0-5: legacy HTML coloured green (removed). The cost and canned-text parts are in diagnosis-engine-rebuild, and the print "Battery" part is in fix-report-integrity.
- R03-P1-1: No ready-to-send email / ticket artifact
- R03-P1-2: Static profile collected but hidden (view side)
- R03-P1-3: Charts cover 3 of 10+ series, no finding on the charts page, CDN-dependent, print hides charts, no wall clock, marks and workload not shown
- R03-P1-4: Report order wrong for the IT reader
- R03-P1-6: Taxonomy drift (view side: consume one vocabulary)
- R03-P2-1: Unrounded numbers
- R03-P2-2: Raw shell errors in the evidence
- R03-P2-6: Warp flags disagree between print and MD
- R03-P2-8: Developer vocabulary in IT views
- R03-REM-2: Remove the loop-lag row from IT views
- R03-REM-3: Remove the Warp/openspec rows and flags
- R03-REM-4: Remove the legacy .html output
- R03-REC-5: Delete the legacy HTML (view part)
- R03-REC-8: System profile section in every view
- R03-REC-10: Email / ticket draft
- R03-REC-11: Small-multiple inline-SVG charts on a wall-clock axis, with the finding on the chart page
- R03-REC-12: Scope declaration on page 1 (rendering)
- R03-REC-13: Reorder MD/print
- R03-REC-14: Remove/demote legacy HTML, loop lag, Warp, raw docker stderr, unrounded floats (view part)
- R03-REC-15: One vocabulary across outputs (view part)
- R03-V-1: Freeze strip chart
- R03-V-2: Memory chart
- R03-V-3: CPU chart
- R03-V-4: Clock/thermal/power chart
- R03-V-5: Disk chart
- R03-V-6: GPU chart, conditional
- R03-V-7: Top processes over time
- R03-V-8: Workload annotations
- R03-O-1: Header with scope on page 1
- R03-O-2: 3-line finding
- R03-O-3: What IT can do
- R03-O-4: Evidence
- R03-O-5: System profile
- R03-O-6: Gaps and receipts
- R03-O-7: Appendix
- R03-O-8: Ready-to-send message
