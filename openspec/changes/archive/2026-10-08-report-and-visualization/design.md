# Design: report-and-visualization

## Context

See proposal.md (Why). Constraints:
- No dependencies: Node 18+, single-repo CLI, Windows-first, often on locked-down machines with no CDN access.
- JSON is truth (`evidence-surface` "JSON is truth, MD and HTML are views"). Renderers read only the trace/pack JSON (`hanger-json/2`) and never re-collect or re-infer.
- Upstream inputs this change consumes:
  - from `scope`: the scope-declaration record and the rule that it leads every shareable view;
  - from `system-profile`: the facts, each a value or null with an unavailable reason;
  - from `sampling`: per-value provenance, unobserved intervals, and wall-clock `measuredAt`;
  - from `diagnosis`: the ranked causes, headline finding, vocabulary, evidence references, and suggested actions;
  - from `metrics`/`tracking`: the time series, workload phases, and lifecycle markers.
- `render-print.js` today is the best artifact: A4, numbered sections, receipts. It becomes the single renderer. `render-charts.js` (ECharts via jsDelivr) is retired.

## Goals / Non-Goals

**Goals:**
- One section model, rendered to MD and HTML, so the order and content cannot drift between views.
- Charts that survive offline use, print, and PDF, with every collected signal on one wall-clock axis.
- A paste-ready email whose every number is mechanically checkable against the JSON.

**Non-Goals:**
- Sending email, uploading, or integrating with a ticketing system. The tool writes text files only.
- New inference. If a number or label is not in the JSON, the view does not show it.
- Rendering the watch log (deferred, DEF-4).
- Interactive charts (zoom, hover). Static SVG with a data-table fallback is enough for IT and print.

## Decisions

### D1. Charts are inline SVG generated at render time
- **Chosen:** a small in-repo SVG plotting module (`lib/render/svg-charts.js`). It handles line, step, band, and marker drawing on a shared x-scale. Output is embedded directly in `.report.html` and needs no script to display.
- **Alternatives:**
  - (a) Keep ECharts from the CDN. Rejected: it fails offline and on locked-down machines, and the print path hides the canvases (R03-P1-3).
  - (b) Vendor ECharts into the HTML (~1 MB inline). Rejected: heavy, still JS-dependent for print, and a licence/notice burden.
  - (c) Server-side PNG. Rejected: needs a rasterizer dependency.
- SVG is vector, so it stays crisp in PDF.

### D2. Single `.report.html`, no separate charts file
- **Chosen:** charts live in section 4 (Evidence) of `.report.html`. `--charts` becomes an alias of `--print` with a one-line deprecation notice for one release (OQ-10).
- **Alternative:** keep a separate charts file. Rejected: two artifacts drift. The charts page omitted the finding (R03-P1-3), and IT then has two files to read.

### D3. One section model feeds MD and HTML
- `lib/render/sections.js` builds an ordered array:
  `[{id:'header'}, {id:'finding'}, {id:'actions'}, {id:'evidence'}, {id:'profile'}, {id:'gaps'}, {id:'appendix'}]`.
  Each section carries structured rows. The MD writer and the HTML writer only format it.
- Tests assert the order on the section model once, and on both outputs by heading order.
- **Alternative:** two independent templates (today). Rejected: they caused the Warp-flag disagreement (R03-P2-6).

### D4. Display formatting is centralized
- `lib/render/format.js` owns rounding and units. Every displayed number passes through `fmt(value, provenance)`.
- Precision comes from the value's provenance (`sampling` "Stored precision matches measurement precision"). The display defaults are: % to 1 decimal, MB to integer, GB to 1 decimal, ms to integer, °C to integer, MHz/% perf to integer.
- `null` renders as "not available" plus the reason, never "0" or blank.

### D5. `--print` default
- `trace` and `record` write `.json`, `.md`, `.report.html`, and `.email.txt` by default.
- `--no-report` skips the HTML and the email (for CI).
- Rationale: the email and the report are the product's deliverable, not an opt-in extra.

### D6. Email is generated from the JSON by a template bound to JSON paths
- Placeholders are resolved through a whitelist of JSON paths. A missing value renders as "not available" (never invented).
- After rendering, a checker extracts every numeric token from the email. It asserts that each one equals a JSON value at its display precision, or is a count/derived integer present in the JSON (`summary.*`, `diagnosis.*`). Otherwise rendering fails loudly.

### D7. Pack uses the same renderer
- `pack` JSON renders through the same section model. Sections missing from a pack (e.g. per-probe charts) show an explicit "not in pack: see trace <file>" line, not a silent omission.

## Page 1 wireframe (`.report.html`, A4)

```
+--------------------------------------------------------------------------+
| Freeze evidence — <model> (<serial>)          <date> · observed <T> min  |
| Tier: user · Report schema hanger-json/2 · Run finished: yes|NO        |
| SCOPE: <rendered from scope declaration record — owned by `scope`>       |
+--------------------------------------------------------------------------+
| FINDING                                                                  |
| 5 freezes >=800 ms in 12.4 min (2 confirmed by user mark, 0 by Windows). |
| At freezes: commit 91% vs 62% calm (n=5/180); top in-scope grower:       |
| postgres 1.2->2.0 GB. Not observed: throttling, disk stall, AV load.     |
| Leading cause: memory pressure · confidence 0.62 · evidence: moderate    |
+--------------------------------------------------------------------------+
| WHAT IT CAN DO (cheapest first, each tied to a rule)                     |
| 1. Cap WSL2 VM memory (.wslconfig) — rule vm-memory-dominance            |
| 2. ...                                                                   |
+--------------------------------------------------------------------------+
| [copy block: ready-to-send email]                                        |
+--------------------------------------------------------------------------+
page 2+: 4 Evidence (hang table + charts) · 5 System profile · 6 Gaps · 7 Appendix
```

In the HTML the email copy block sits after section 3. It is visually separated and not a numbered section. In the MD, the email is a separate file referenced in the header.

## Chart panels (small multiples, shared x = wall-clock local time with UTC offset in caption)

| # | Panel | Series (unit) | Y axis | Shown when |
|---|---|---|---|---|
| 1 | Freeze strip | hang-probe latency (ms) as markers; threshold line; user marks; OS-confirmed markers | ms, linear 0..max(threshold×3, observed max) | always |
| 2 | Memory | RAM used (%), commit (% of limit), available (MB, secondary panel), pagefile use (%), pages in/out (pages/s, own sub-panel, linear with spike annotation) | 0-100 % fixed | always |
| 3 | CPU | total CPU (%), run queue per logical CPU, security-software CPU (% of machine), DPC+interrupt (%) | 0-100 % fixed; queue on own sub-panel | always |
| 4 | Clock / thermal / power | performance (% of base, may exceed 100), performance limit (%), temperature (°C, per labelled zone) or "not available: <reason>", battery (%) | perf 0..max(150, observed); °C 0..110; battery 0-100 | always (temperature sub-panel shows the reason when null) |
| 5 | Disk | latency (ms), queue length, busy (%), throughput (MB/s) | ms linear; % 0-100 | always |
| 6 | GPU | utilization (%), dedicated memory (MB) | 0-100 % | only when GPU data exists or a GPU rule fired |
| 7 | Top in-scope processes | stacked area of the top 5 in-scope groups (MB) plus an "outside scope (aggregate)" band | MB 0..RAM fitted | always (empty-scope runs show the aggregate band only) |
| 8 | Standby / modified (optional) | standby (MB), modified (MB) | MB | when data exists |

Overlays on every panel:
- hang bands: vertical, at each hang window;
- user marks: dashed line;
- workload phase spans: labelled band at the top;
- lifecycle markers: tick plus label;
- AC/battery: background band, battery tinted;
- unobserved intervals: hatched.

Each caption reads: `<signal> — n=<samples>, window <start>–<end>, source <provenance.source>`.
Each SVG is followed by a `<details>` data table holding the same values (accessibility and print fallback).

## Email template (`.email.txt`), placeholders bound to JSON paths

```
Subject: Freeze evidence - {profile.identity.model} {profile.identity.serial} - {summary.hangEventCount} freezes in {summary.observedMinutes} min

During {workload.phases[*].label | "normal work"} on {startedAt:date} ({power.summaryLabel}, {profile.power.planName}),
the laptop froze {summary.hangEventCount} times for up to {summary.spawnMaxS} s
(threshold {summary.hangThresholdMs} ms; {diagnosis.confirmation.os} confirmed by Windows, {diagnosis.confirmation.user} by user mark).
{diagnosis.finding.sentence}
Not observed: {diagnosis.notObserved[] joined}.
Scope: {scope.declaration.summary}   <- open scope adds: "OPEN SCOPE: names of all running software may appear in the attached report."
Not measurable without admin: {gaps.adminOnly[] joined | "none"}.
Machine: {profile.cpu.model}, {profile.memory.installedGB} GB RAM, {profile.storage.primary.model} ({profile.storage.primary.mediaType}), Windows {profile.os.build}, BIOS {profile.firmware.version}.
Suggested next steps (cheapest first): {diagnosis.actions[0..2].text joined}.
Attached: {attachments[].name} (sha256 {attachments[].sha256:12}).
```

Exact JSON paths are fixed by the upstream schemas. The binding table in `lib/render/email.js` is the single place to update them.

## Formats

| Output | Status | Note |
|---|---|---|
| `hanger-<stamp>.json` | keep | truth |
| `hanger-<stamp>.md` | keep | same section order as HTML |
| `hanger-<stamp>.report.html` | keep (renamed from `.print.html`) | the only HTML view; charts inline |
| `hanger-<stamp>.email.txt` | new | ready-to-send draft |
| `hanger-<stamp>.html` (legacy) | **remove** | duplicate with wrong colour class |
| `hanger-<stamp>.charts.html` | **remove** (folded) | `--charts` alias for one release |
| `pack-<stamp>.json` / `.report.html` | keep | same renderer and order |
| inventory artifact | never rendered or attached | local-only (`scope`) |

## Non-binding implementation hints

- SVG module: `xScale(tWallMs)` shared across panels. Each panel is a `<g>` with a fixed height (~110 px at A4 width 180 mm). Use `viewBox` so print scales. Stroke widths at least 1 px. Use a palette distinguishable in grayscale with dashed/solid variation.
- Hang bands come from `diagnosis` evidence windows (start/end wall time). Do not recompute them.
- Print CSS: `@media print { section { break-inside: avoid-page } svg { max-width: 100% } }`. Never `display:none` on a chart container.
- Read the sha256 for the manifest from the bytes on disk after writing (`crypto.createHash('sha256')`). Compute the report.html hash before the email is written. The email is not hashed into itself.
- Number checker in tests: regex `/-?\d+(?:\.\d+)?/g` over the email body, minus dates and the stamp, each token matched against a flattened map of JSON numeric leaves formatted with `fmt`.
- Headless PDF check: `msedge --headless --disable-gpu --print-to-pdf=out.pdf file:///.../x.report.html`, then assert the PDF size is above that of an SVG-stripped control, or grep the PDF for the `/Type /XObject`-free vector path operators. The structural HTML test is authoritative. The PDF check is a smoke test.

## Risks / Trade-offs

- [Hand-rolled SVG has fewer features than a chart library] → Static plots only. The panel list is fixed and small, and snapshot tests cover the geometry.
- [Long traces (8 h) produce large SVGs] → Downsample per panel to at most 2,000 points with min/max envelope preservation. State "downsampled from n to m" in the caption.
- [Email number checker false positives (e.g. "Windows 11", build numbers)] → Whitelist identity strings (model, build, BIOS) as opaque text. They do not go through the numeric check, but must equal JSON strings exactly.
- [Removing `.html` breaks a user's habit] → The README notes the change and `.report.html` is opened by the same double-click.
- [Upstream JSON paths shift] → One binding table plus a fixture test per upstream schema version.

## Migration

1. Ship the renderer behind the existing `--print` flag. Generate `.report.html` and `.email.txt` alongside the legacy outputs for one internal smoke run.
2. Flip the defaults (D5). Remove the legacy `.html` writer and `render-charts.js`, and alias `--charts`.
3. Update the README and `SCHEMA-CHANGELOG.md` (no JSON shape change; outputs list only).
4. Rollback: revert the commit. The JSON is unchanged, so earlier reports re-render with either version.

## Open Questions (owner; defaults used)

- **OQ-1** (no scope file): render the open-scope declaration from `scope` on page 1 and add the open-scope sentence to the email.
- **OQ-4** (legacy HTML): remove it.
- **OQ-9** (cost): measured cost appears only in the appendix and only when at least 1 hang was observed. It is never on page 1 or in the email.
- **OQ-10** (separate charts file): no. Charts are inline, and `--charts` is an alias for one release.
- **OQ-12** (STATE label): no "STATE" word anywhere. The finding sentence and leading cause class come from `diagnosis`.
