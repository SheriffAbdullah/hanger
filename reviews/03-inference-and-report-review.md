# Review 03: inference hierarchy, report output, IT usefulness

Reviewer: Opus (review only, no code changed). Scope: the logic ladder from raw data to inference, and everything the tool outputs. Raw collector internals and spec structure belong to other reviewers. They are touched here only where they decide whether an inference is valid.

Evidence base:
- `tools/hanger/hanger.js` (1669 lines), `render-print.js`, `render-charts.js`, `trend.js`.
- `openspec/explorations/orders-framework.md`, `ontology.md`, `persona-it.md`, and `openspec/specs/evidence-surface/spec.md`.
- The tracked sample `reports/sample-hanger.{md,html,json}`.
- 25 local, untracked trace JSONs in `reports/`, which I read but did not change.
- Renders I produced in the scratchpad: `sample.print.html` and `.png`, `sample.charts.html` and `.png`, and `sample.print.pdf`. I rendered them from a repaired copy of the sample JSON, because the shipped one does not parse (P0-1).

---

## 0. Bottom line

The repo has a real, documented evidence ladder. The data layer underneath it is honest about gaps (`collection.failures`, null-not-zero, receipts). The top two rungs are where it breaks:

1. **The headline verdict is wrong on the repo's own flagship sample.** `reports/sample-hanger.md` says `STATE: RAM-BOUND`. The same file shows 0 hangs, commit 52 to 65% (threshold 85), and pagefile usage at 8%. The two reasons behind the verdict both come from the first seconds of the trace: one 500 ms `os.freemem` sample, and one pages/sec spike on the first probe, which took 8.8 s because the tool itself was starting up. The HTML colours this verdict green (`ok`). The cause text then predicts "Playwright timeouts, Docker OOM risk" on a machine where Docker is not installed.
2. **The verdict is named after RAM, but it is really "two of any seven predicates fired".** Any two of these produce `RAM-BOUND`: a stall, a disk stall, or 1002 events from the Application log that are not filtered to the trace window. Per-hang RCA blames memory using the commit peak for the whole trace, not the value at the hang.
3. **IT cannot get a usable artifact out of a default run.** With `anonymize: true` in the shipped config, the JSON (the declared "truth") is invalid. That also breaks `--print` and `--charts`. No ready-to-send summary or email exists. The static system profile (asset block) is collected but not shown in the MD or HTML. Only RAM, commit and pages are charted. CPU, disk, Defender, `%maxFreq`, AC/battery and temperature are collected per probe but never drawn.

An IT admin who receives today's sample would reject it within a minute: "RAM-BOUND, zero freezes, commit 52%, and $900/mo lost?" The bones are good. The inference layer needs to be rebuilt to be per-hang, at-hang, and many-cause, with provenance. The report needs reordering for the IT reader.

---

## 1. The hierarchy as actually implemented

The docs (`orders-framework.md` L3-42, `ontology.md`) name four orders: zeroth-data, zeroth-analysis, first-order (named states), second-order (rates, correlations, culprit confidence), with "Nth-order" ruled out of scope. In the code the ladder looks like this.

| Order (owner's term) | Doc name | What it is in code | Inputs → outputs | Where |
|---|---|---|---|---|
| **L0 Raw data** | zeroth-data | `samples[]` (os.freemem every `INTERVAL`); `spawnProbes[]` (2 s: `node -e ""` spawn latency + one PDH bundle of about 25 counters + plug state); end snapshots (tasklist WS rollup, `privateTop`, CIM cmdlines, GPU per-PID, docker/wsl, Event 1002/1000/2004, WER, admin tier); `userMarks[]` | collectors → timestamped rows | `hanger.js` L1130-1236, L745-813, L1266-1303, L1424 |
| **L1 Named states** | first-order | `hangEvents` (`ms >= --hang 800`); seven `reasons[]` predicates (commit peak, min-free, secs>85, pages peak+"sustained", disk stall, 1002 count, STALL count) | L0 → booleans + strings | L1332, L1436-1448 |
| **L2 Derived** | second-order | rates, %frozen, MTTR (L1360-1365); ±10 s pre/post context (L1346-1357); calmShare (L1421); `pagesSus` (L1440); discriminator deltas (L560-593); cost v1/v2 (L1469-1477, L539) | L0/L1 → numbers | as listed |
| **L3 Inference** | (verdict, RCA) | **three parallel, unconnected inferences:** (a) `verdict` + `cause` (L1451-1468); (b) per-hang `rca[].ranked` with confidences (L1479-1492); (c) `discriminator.call` ram-signal / reimage-signal / unclear (L560). Plus a fourth: (d) the pack renderer invents its own `STALL-OBSERVED / SUSTAINED-PRESSURE / NO-STALL` taxonomy (`render-print.js` L68-71) | L1/L2 → labels | as listed |
| Presentation | views | MD, legacy HTML, print.html, charts.html, console STATE card, pack JSON, trend table | L0-L3 → pages | L1587-1666, render-*.js, trend.js |

### Coherence verdict: the ladder exists, but L3 is not built on L2

- **The verdict ignores RCA, RCA ignores the verdict, and the discriminator ignores both.** They can disagree, and nothing reconciles them. In the sample, the verdict says RAM-BOUND, RCA says `no-stall-observed` at 0.5, and the discriminator says `unclear` ("no hangs observed... cannot separate RAM vs bloat"). The report prints only the verdict prominently.
- **Signals are collected and then dropped before inference.** CPU saturation, AV (Defender) and disk feed only RCA. Throttle (`maxFreq`), plug state, EcoQoS, `osConfirmed` (Responding=false) and `userMarks` feed **nothing** in L3:
  - `maxFreq` is only printed (L1598, render-print L184-188).
  - `osConfirmed` is set at L1201 and never read.
  - `userMarks` appear only in a chart (render-charts L135).
  - Across 14 local traces with hangs, `osConfirmed` was `false` on every hang. The OS never once agreed that a hang happened. That is the most important disconfirming fact the tool has, and it is silently discarded.
- **The documented second order was never built.** "correlations (`hang.ms ~ lagged metric`, r/n/lag)" and "culprit confidence `0.4·share+0.3·co-occur+0.2·paging+0.1·event`" (`orders-framework.md` L34, `ontology.md` L14) do not exist in code (grep: no hits). The RCA confidences are hand-set constants: 0.4, 0.35, 0.2, and `0.4+0.3x+0.15` (L1485-1489). They are not computed from evidence.
- **The drill-down claim is only half true.** `orders-framework.md` L42 says any verdict traces to the rules, then to the signals, then to the collectors. In practice `reasons[]` are pre-formatted strings, not structured references. Nothing names which probe (tSec) produced the peak or minimum that fired a rule. An IT reader cannot click from "pages/sec peak 4513" to "probe t+2s, bundleMs 8849, first probe of the run".

### Are the inferences supported by the evidence beneath them?

| Claim | Supported? | Problem | Cite |
|---|---|---|---|
| `STATE: RAM-BOUND` | **Often no** | Fires on `reasons.length >= 2`, where the reasons include non-RAM predicates: disk stall, 1002 events, STALL count. One stall plus one disk stall gives "RAM-BOUND". | L1446-1452 |
| min-free reason | No (single sample) | `Math.min` over every 500 ms `os.freemem` sample. One sample is enough. This violates spec "Single samples are not presented as evidence" (`evidence-surface/spec.md` L88-91). | L1310, L1437 |
| pages "sustained" | No | `pagesSus` is the mean of all probes when there are no hangs. With 5 probes, one spike makes it "sustained". Sample: (4513+173+20+337+35)/5 = 1016, which "passes" >200. | L1440-1445 |
| pages/sec as thrash | Weak | `Memory\Pages/sec` counts hard faults, including image and mapped-file reads. In the sample `pagesIn == pages` on every probe (all reads) while `Paging File % Usage` was 8%. The tool spawns PowerShell and .NET every 2 s, so it generates page-ins itself. **5 of the last 7 local traces (commit 48-53%, 0 hangs) were labelled PRESSURED by pages spikes alone.** | L749, L761, L806 |
| Event-1002 reason | No (wrong window) | `Get-WinEvent ... -MaxEvents 5` with no `StartTime`, so days-old app hangs count as evidence for *this trace*. | L1302-1304, L1447 |
| "EXHAUSTION" 2004 | No (wrong provider) | Not filtered to `Resource-Exhaustion-Detector`. The sample prints "EXHAUSTION Successfully logged OS information". | L1303, sample.md L48 |
| RCA "memory-pressure stall" | Overreach | Trigger is `h.pages > TH.pages` **OR trace-wide `committedPeak >= 85`**, so every hang inherits memory blame from any peak in the trace. Real trace 13-08-14, hang t+22: commit 83%, pages 292 at the hang, both under threshold, yet ranked memory-pressure at 0.52. | L1482 |
| RCA AV alibi | Mis-scaled | `\Process(MsMpEng*)\% Processor Time` is per-core (0-1200% on 12 threads). Local traces show 75-184% (1-2 full cores) at hangs. It is compared with "20" and capped at a fixed 0.35, always ranked **below** memory. | L757, L1484-1487 |
| STALL = "the 2-3s freezes you felt" | **Unvalidated proxy** | It measures process-creation latency (`cmd /c node -e ""`). That latency is very sensitive to Defender real-time scanning and HP Sure Click process-creation hooks, exactly the security stack this laptop runs. `userMarks` are never compared with it, and `osConfirmed` was always false. The heading asserts what the data has not shown. | L1138-1139, L1614 |
| Cause text | Fabricated | Hard-coded "Playwright timeouts, Docker OOM risk" (L1454) and "Re-run under full Docker+Playwright load" (L1460), whatever is actually running. | L1454-1460 |
| Cost v1 | Fabricated | `costNote` assumes 45 min/day lost by default. The sample prints **$900/mo with 0 hangs**. Cost v2 (computed, $0) exists but MD and HTML show v1. | L1469-1473, sample.md L22 |
| Discriminator | Reasonable shape | Calm-vs-hang commit delta is the right *kind* of test. It needs n per side and confidence. Pack mode recomputes it with **current CLI thresholds**, not the trace's recorded ones, which breaks reproducibility. | L560-593, L710-712 |
| Throttle disprover | Wrong statistic | Uses the trace-wide min of `% of Maximum Frequency`. Idle dips are normal. It should be judged at the hang, it is ignored on battery ("<60 on AC"), and it is never an input to L3. | L1325, L1598 |

**False-positive risk: high.** The tool is its own biggest load in short traces. The first probe's bundle took 8849 ms in the sample, and loop-lag max was 12.9 s in trace 13-08-14. Most traces are 10-12 s (5-6 probes), so one startup artifact decides the STATE. Nothing enforces a minimum n for an inference. INSUFFICIENT-EVIDENCE fires only at zero samples (L1464).

**Where the evidence is genuinely strong:** trace `13-08-14` (60 s, battery, commit peak 92%, 40.5 s over 85%, min-free 0.13 GB, 5 stalls, node.exe growing 4.8 to 6.2 GB). That is a credible memory-pressure case. The tool should be able to say why that trace is strong and the sample is not. Today both get the same label.

---

## 2. Findings, prioritized

### P0 (blocks IT acceptance or is factually wrong)

**P0-1. Anonymized JSON is invalid, so the "truth" layer and both renderers break on default config.**
- `anon()` (L285-291) runs on the serialized JSON string (L1585, L734) and replaces `C:\\Users\\name` with `C:\Users\<user>` (single backslash). The result is an invalid `\U` escape.
- `hanger.config.json` ships `"anonymize": true`, so every default run writes broken JSON.
- The committed `reports/sample-hanger.json` fails `JSON.parse` at L461.
- `render-print.js` exits with "Invalid JSON", and `--print`/`--charts` fail silently into a console line (L1664). `trend.js` skips the file (`catch { return null }`, trend L55), so trend history silently loses runs.
- The "recompute reproduces" promise (`evidence-surface/spec.md` L69-77) cannot be checked by anyone.
- Fix: anonymize the object before stringify, or escape the replacement.

**P0-2. The STATE label overreaches its evidence (see the table in §1).**
- RAM-named but driven by any two predicates.
- Single-sample min-free and spike-driven "sustained" paging.
- Unwindowed 1002 events.
- Shipped sample is wrong on its face: 0 hangs, commit 65% max, called RAM-BOUND.

**P0-3. RCA blames memory using trace-wide state, not at-hang state.** L1482 `committedPeak`. Every hang in a trace that touched 85% once is "memory-pressure stall".

**P0-4. Hang-ground-truth is asserted, not validated.**
- "The 2-3s freezes you felt" (L1614) rests on spawn latency only.
- `osConfirmed=false` on all observed hangs, and `userMarks` are unused in inference.
- For the owner's scenario (Postgres and Docker hang), there is no workload-side latency at all: no `psql SELECT 1` round-trip, no `docker info` latency, no UI-responsiveness probe.

**P0-5. Fabricated or boilerplate content in the evidence.**
- Default-assumption cost ($900/mo at 0 hangs) is shown as the main cost.
- Canned cause text mentions Docker and Playwright when neither is present.
- The legacy HTML colours RAM-BOUND green, because the class test is `/not sufficient/` (L1651), a string the verdict no longer contains.
- `render-print.js` L189 prints "Battery (unplugged)" when plug state is **unknown** (`plugged === null`).

### P1 (IT will push back or cannot act)

**P1-1. No ready-to-send artifact.**
- No email, ticket text or summary paragraph anywhere (grep: zero hits for email/draft/ticket).
- The owner's intent explicitly includes a draftable evidence message.
- "Attach for IT" (L1640) is two lines telling the user to attach files.

**P1-2. Static system profile is collected but hidden.**
- `assetBlock()` (manufacturer, model, RAM fitted, disk free, OS caption and build) goes to JSON and console only. It is not in MD, legacy HTML, or the trace print view (the print "machine" row lists cpuModel and "12 cores", which are really 12 *threads*; an i7-1255U has 10 cores).
- **Never collected:** BIOS version and date, GPU adapter and driver version, disk model and media type (NVMe/SSD), pagefile config (size, system-managed), battery health (design vs full-charge capacity), physical core count, installed RAM slots and speed, Docker/WSL memory limits (`.wslconfig`), Postgres `shared_buffers` and `work_mem` (`ontology.md` L19 promises pg_settings; none exists in code).

**P1-3. Charts cover 3 of the 10+ series IT wants.**
- `render-charts.js` draws RAM used %, commit % and pages/s, plus a spawn scatter (L149-228).
- Collected per probe but **not charted**: CPU % and queue, disk sec/transfer and queue, Defender CPU, `%maxFreq` (the throttle proxy), plug state and battery %, DPC/interrupt %, pagefile %, standby/modified MB, available MB. GPU per-PID exists only as an end snapshot. Temperature exists only in admin tier and is never charted.
- The charts page **omits the STATE/verdict entirely**. Its "Summary (read this first)" has stats only.
- Charts depend on the jsDelivr CDN. Locked-down IT machines often block it, and the print path hides every canvas (L351). **A printed or PDF chart pack therefore contains no charts.**
- Positives: one shared `t (s)` axis across both charts, HANG markLines labelled with ms, and an honest 0-100 % axis.
- Weaknesses:
  - The log pages axis hides how flat or spiky it is. Annotate the spike.
  - Wall-clock is not on the axis, so IT cannot line it up with their own logs.
  - User marks are plotted at y=threshold on the latency chart only.
  - Nothing shows *workload* start/stop (when Postgres or Docker was started).

**P1-4. Report order is wrong for the IT reader.** MD (L1591-1642) puts a 17-row mixed metric table straight after the verdict: machine, power, tier, admin, loop lag, Warp, GPU, WER, cost. Hang rows, the actual incident, come after that, and the system profile never appears. Scope or redaction appears near the bottom, and the scope line only shows with `--only`. See §4 for the target order.

**P1-5. Short traces decide the STATE.** The default is 60 s, but most real runs in `reports/` are 10-12 s. Nothing gates an inference on n. For example: "<10 probes → INSUFFICIENT-EVIDENCE for any STATE; report observations only".

**P1-6. Taxonomy drift.** The trace says `RAM-BOUND / PRESSURED / OK`. The pack print says `STALL-OBSERVED / SUSTAINED-PRESSURE / NO-STALL`. The discriminator says `ram-signal / reimage-signal / unclear`. RCA uses free-text causes. An IT reader comparing two artifacts sees four vocabularies.

**P1-7. Thermal is unreadable even when collected.** The admin `MSAcpi_ThermalZoneTemperature` dump prints `67.1/25.1/.../0.1°C` (13-08-14 MD). These are ACPI zones, not CPU package temperature, and include nonsense values. There is no user-tier temperature at all, and it never feeds L3.

### P2 (polish, noise, cost of carrying)

- **P2-1. Unrounded numbers** in the MD: `Committed start→end 64.7166289074152→52.34...`, `Pages/sec 18176.0803...` (L1602-1603). RCA `supporting` strings carry 13-decimal floats.
- **P2-2. Raw shell errors in the evidence:** "'docker' is not recognized as an internal or external command" (sample.md L52). It should read "Docker: not installed".
- **P2-3. The `winEvents:timeout` failure is mislabelled.** `Get-WinEvent` writes to stderr when there are zero events. It reads as a collector timeout in "collection gaps".
- **P2-4. Duplicate line** at L1452-1453 (`verdict = ...` twice).
- **P2-5. Pack math is wrong:** `windowS: latest.summary.granularityMs / 1000 * latest.spawnProbes.length` (L689) mixes the sample interval with the 2 s probe cadence.
- **P2-6. Inconsistent flags.** The print method footnote says `warp=true` while the MD says Warp "(not seen)". `hasWarp` and `warpSeenMB` disagree (L1369 vs L1228-1230).
- **P2-7. EcoQoS map is mostly `unknown`/`denied`** across all local traces. It costs a C# compile and adds no information.
- **P2-8. Dev-specific vocabulary IT does not need:** "Warp / openspec+node seen", "prover self-block confound", "loop lag".

---

## 3. Add / remove (inference layer)

### ADD: missing inferences for common hang causes

Each rule below should emit `{id, fired, at[] (tSec list), inputs[] (probe refs + values), threshold, n, confidence, disprover, confounds}`, evaluated **at each hang and over calm windows**, never on a trace-wide peak. Most inputs are already collected. Collector work is in the Handoff notes.

| # | Inference | Fires when (at hang, sustained n≥3 probes) | Already collected? | IT action it unlocks |
|---|---|---|---|---|
| 1 | **Commit limit pressure** | `committed ≥ 90` **and** pagefile % rising **and** `availMB` < 5% of RAM | yes | RAM upgrade / pagefile size |
| 2 | **Hard-fault thrash (real swap)** | `Pages Input/sec` high **and** `Paging File % Usage` rising **and** modified-list growing (not image loads) | partly (need Pages Output/sec) | RAM vs workload limit |
| 3 | **Docker Desktop / WSL2 vmmem dominance** | `vmmem`/`VmmemWSL` WS ≥ X% of RAM, and `.wslconfig` memory limit absent or high | vmmem via tasklist; `.wslconfig` no | set `.wslconfig memory=`; not a RAM purchase |
| 4 | **Postgres memory/IO** | postgres group WS + `shared_buffers`/`work_mem` vs RAM; disk sec/transfer at hang on the data volume | WS yes; pg_settings no | tune config before hardware |
| 5 | **One-process dominance / leak** | one group ≥ 40% of used RAM, or monotonic growth across the trace (e.g. node 4.8→6.2 GB in 13-08-14) | yes (culpritsAtHang over time) | "fix the app", not the laptop |
| 6 | **AV / endpoint-security contention** | MsMpEng (normalized per core) or Sure Click CPU high at hang **and** spawn latency elevated while memory is calm | yes | AV exclusions for dev folders (very common, cheap fix) |
| 7 | **Thermal / power throttling** | `%maxFreq` < 60 **at hang** while CPU is busy; on battery or power plan is efficiency | yes (`maxFreq`, plug, scheme) | plug in / change plan / cooling, not RAM |
| 8 | **Battery saver / power plan** | plug=false or scheme ∈ {saver, HP Optimized cap} during hangs; compare hang rate AC vs BAT | yes per probe | "just plug it in" dispute settled |
| 9 | **Disk stall** | `Avg. Disk sec/Transfer` > 25 ms **and** queue ≥ 1 at hang, sustained | yes | disk health/SMART, not RAM |
| 10 | **CPU saturation** | `cpuPct` > 90 and queue > 2×cores at hang | yes (cpuPct unused) | CPU-bound workload |
| 11 | **DPC/ISR storm (driver)** | `% DPC + % Interrupt` > 10-15% at hang | yes, unused | driver/BIOS update (IT owns this) |
| 12 | **GPU contention** | per-PID GPU engine ≥ 90% or dedicated VRAM near full at hang | per-PID at hang only when calm | driver / external display issue |
| 13 | **OS-confirmed hang** | `osConfirmed` or user mark within ±2 s of a STALL | yes, unused | promotes STALL from proxy to fact |
| 14 | **Observer self-load guard** | `bundleMs` > 2000 or `slipS` > 1 at a probe → exclude that probe from every rule | yes (`bundleMs`, `slipS`) | removes the tool's own startup artifacts |

**Rebuild L3 as one cause ranking, not three labels.**
- Per hang: rank all fired rules by an evidence score. The score should combine:
  - (a) whether the signal crossed its threshold *at* the hang;
  - (b) the delta from calm windows (hang vs calm mean, with n on each side);
  - (c) the share of hangs where it fired (co-occurrence);
  - (d) whether OS or user confirmation exists.
- Roll up per trace as: "N of M hangs coincide with X". The headline then becomes a **measured association**, e.g. "5/5 freezes occurred with commit ≥ 90% (calm 62%)". It should not be a causal label.
- Keep the word "cause" only for the disprover structure the RCA already has, which is good.
- Let the discriminator be one output of this ranking, not a separate engine.

### REMOVE / demote

- **Cost v1** (`costNote`, L1469-1473) everywhere. Keep v2, which is computed, and show it only when hangs > 0. It belongs at the end, as context.
- **Loop-lag row** from IT views (L1604). It is admitted to be polluted (L1551). Keep it in JSON only.
- **Warp/openspec/"flags"** rows and the `hasWarp/hasOpenspec` flags. These are the developer's personal stack, and IT gets nothing from them.
- **Legacy `.html` output** (L1645-1652). It duplicates print.html with worse fidelity and has the wrong colour class. Make print.html the HTML.
- **EcoQoS batch** (L1238-1252) unless it can return data. Today it is almost all `unknown`/`denied`.
- **1002/1000/2004 "events"** as verdict input until they are windowed to the trace and filtered by provider. Until then, show them as "history" in the appendix.
- **`PRESSURED` as a STATE** on a single predicate. A single crossing is an observation, not a state.
- **The canned consequence sentence** in `cause` (L1454, L1457, L1460).

### What matters vs doesn't to an IT reader who asked for evidence

| Matters | Doesn't |
|---|---|
| Did the freeze happen, and when (wall clock), confirmed how (OS / user mark / probe) | loop-lag, prover confound notes |
| What was different at the freeze vs calm (delta, n) | per-PID GPU maps with n=520 |
| Which process grew or dominated, with its identity | Warp/openspec seen MB |
| Power state and throttle at the freeze | cost in $/mo (managers, not IT) |
| Hardware/OS/driver/BIOS profile and config (pagefile, WSL limits) | sha1 of the filter set (keep in JSON only) |
| What was **not** observed (scope declaration, gaps, tier) | schema/registry version strings in the headline |
| The ask: a specific, cheap action (AV exclusion, `.wslconfig`, driver update, RAM) | ASCII bar art |

---

## 4. Output audit

### What is produced today

| Output | When | Earns its place? | Notes |
|---|---|---|---|
| `hanger-*.json` | every trace | **Yes, it is the truth.** Broken under anonymize (P0-1) | Holds L0-L3. Good: thresholds and sources recorded, failures listed |
| `.md` | every trace | Partly | Wrong order, hidden asset block, unrounded numbers, raw shell errors |
| `.html` (legacy) | every trace | **No** | Duplicate of the print view; wrong colour (P0-5) |
| `.print.html` | `--print` | **Yes (best artifact)** | Clean A4, numbered sections, receipts, method footnote. Fix power-unknown bug, add profile, add an inline SVG mini-timeline |
| `.charts.html` | `--charts` | Partly | Only 2 charts; no STATE; CDN-dependent; print hides charts |
| `pack-*.json` (+ print) | `pack` | Yes for the fleet-IT persona | Recomputes with current thresholds (provenance gap); different STATE vocabulary |
| watch JSONL + `--rollup` | `watch` | Yes (sustained evidence over days) | Not rendered to any view or chart |
| `trend` console table | `trend` | Marginal | Console only; silently drops invalid JSONs |
| Console STATE card | every trace | Fine for the developer | — |
| **Email / ticket draft** | — | **Missing** | Owner requirement |
| **PDF** | via browser | OK | `print.html` → "Save as PDF" works. I produced `sample.print.pdf` with headless Edge |
| CSV | — | Not needed | JSON + table fallbacks suffice |

### Visual judgment (rendered sample, as a stranger or IT admin)

- **print.html:** looks professional and fits one A4 page. **But:**
  - The big box says `STATE: RAM-BOUND`, and then reason 2 reads `committed peak 65.0% (>=85)`. The threshold is shown next to a value that **did not** cross it, and nothing marks pass or fail. Each reason needs a ✓/✗ (or "crossed / not crossed").
  - The power card shows a raw `Power Scheme GUID: fb5220ff-...`.
  - The cost card gives `$900/mo` equal weight with power.
  - There is no system profile section and no chart.
- **charts.html:**
  - Chart 1 overlays three series on dual axes (linear % and log pages). The pages spike at t=2 s dominates and is not annotated as "first probe, tool start-up (bundle 8.8 s)".
  - Chart 2 (latency scatter) with 5 calm dots and no hangs carries no information. Hide it when hangs = 0, or show the threshold band.
  - There is no wall-clock axis, no workload-start annotation, and no AC/battery band.

### Required visual set for IT (one shared wall-clock x-axis, stacked small multiples)

1. **Freeze strip:** spawn latency + user marks + OS-confirmed markers, with the threshold line. Every chart below gets the same vertical hang bands.
2. **Memory:** used %, commit %, available MB; pagefile % on its own panel; pages input/output (not log, or log with an annotation).
3. **CPU:** total %, queue length (normalized per core), Defender/AV CPU (normalized), DPC+ISR %.
4. **Clock / thermal / power:** `%maxFreq`; AC vs battery as a background band; battery %; temperature when available (otherwise a labelled "not available at user tier").
5. **Disk:** sec/transfer (ms) + queue.
6. **GPU:** total utilization and VRAM (only if the GPU rule fires or data exists, per the owner's "if necessary").
7. **Top processes over time:** stacked area of the top 5 groups' MB (from culpritsAtHang and mid snapshots). This is the picture that shows "node grew 4.8→6.2 GB".
8. Workload annotations: when Postgres or Docker started, from the declared scope or process first-seen.

Rules for all charts:
- Honest fixed axes (0-100 for %).
- Units in axis titles.
- n shown in every caption.
- Charts drawn as **inline SVG rendered at build time**, so they survive print, PDF and offline. Drop the CDN.

### Target report order (IT reader)

1. **Header:** asset name or serial, date, duration, tier, and **declared scope** ("Monitored: postgres, docker, node. Not monitored: everything else, N groups / X MB"). It must be visible on page 1.
2. **Finding (3 lines):** "N freezes ≥ 800 ms in T min (confirmed by: OS/user/probe). At freezes: commit X% vs Y% calm (n/n); top grower: Z. Not observed: throttling, disk stall, AV contention." Then the confidence and the evidence strength (trace length, n).
3. **What IT can do:** ranked, cheap first (AV exclusion, `.wslconfig` limit, power plan, driver/BIOS, RAM), each tied to the rule that supports it.
4. **Evidence:** hang table with at-hang vs calm values per rule, then the charts (above).
5. **System profile (static):** manufacturer/model/serial, CPU (cores/threads/base clock), RAM fitted/slots/speed, disk model/type/free, GPU + driver, BIOS version/date, OS edition/build, uptime, power plan (name, not GUID), battery health, pagefile config, security stack present (Defender, Sure Click), Docker/WSL/Postgres config.
6. **Gaps and receipts:** collection failures in plain words, tier, redaction/scope receipts, thresholds with sources.
7. **Appendix:** full culprit table, event-log history (windowed vs historical, clearly split), method footnote, JSON filename + hash.
8. **Ready-to-send message:** a separate `.email.txt` plus a copy block at the top of print.html (template in §5).

---

## 5. Is it useful? Would IT accept it?

**Today: no, mainly because of the flagship sample.** An IT admin would push back on:
1. "Your report says RAM-BOUND with zero freezes and 52% commit." (P0-2)
2. "$900/month lost? You measured zero hangs." (P0-5)
3. "How do you know spawning `node.exe` is the freeze the user felt? Windows never flagged a hung app." (P0-4)
4. "Your JSON doesn't open." (P0-1)
5. "What model is this, what BIOS, what driver?" (P1-2)
6. "Defender was using 1-2 cores at your hangs and you ranked it last." (§1 AV row)
7. "10-second trace? Run it during the actual Postgres/Docker workload for 10+ minutes." (P1-5)

**What already earns trust (keep it):**
- Thresholds are recorded with citations (`TH_SRC` L217).
- Disprovers on every RCA candidate.
- `collection.failures[]` with null-not-zero.
- Redaction receipts with MB withheld.
- Calm-vs-hang framing.
- Tier labelling.
- The "per-trace, never a machine verdict" discipline.

These are exactly the things persona-it.md lists as instant-reject guards, which is rare and valuable.

**With the P0/P1 fixes it becomes strong evidence.** Trace `13-08-14` re-rendered under the rebuilt L3 would read roughly: "5 freezes in 60 s on battery; at every freeze commit ≥ 80% and node.exe growing 4.8→6.2 GB; calm commit Y%; Defender 1-2 cores at 4/5 freezes; no throttling, no disk stall." An IT admin can act on that, either with an AV exclusion and an app-memory fix, or with a RAM upgrade.

### Draft email template (what the tool should generate, filled from JSON)

```
Subject: Freeze evidence - <model> <serial> - <N> freezes in <T> min

During <workload, from declared scope> on <date> (<AC|battery>, <power plan>), the
laptop froze <N> times for <=<worst> s (threshold 800 ms; <k> confirmed by Windows
/ by user mark).
At the freezes: memory commit <X>% vs <Y>% when calm (n=<a>/<b>); <top process>
grew <m1>-><m2> GB; CPU clock <f>% of max (no throttling); disk <d> ms (no stall);
Defender <c> cores.
Not monitored by choice: <scope exclusion summary>. Not measurable without admin: <gaps>.
Machine: <CPU>, <RAM> GB, <disk>, Windows <build>, BIOS <ver>.
Suggested next step (cheapest first): <ranked actions>.
Full report + raw data attached (<files>, sha256 <hash>).
```

---

## 6. Recommended change list (not applied)

**Fix first (P0)**
1. Anonymize the object, not the serialized string. Then re-generate `reports/sample-hanger.*` and add a `JSON.parse` self-check before writing (`hanger.js` L285-291, L1585, L734).
2. Replace the `reasons.length >= 2` STATE with the per-hang rule engine (§3). Rename the STATE to an association ("freezes coincide with memory pressure, N/M") or drop it in favour of the ranked list. Require at-hang values, probe-level provenance, and a minimum n (≥ 10 probes, ≥ 3 for "sustained").
3. Exclude self-load probes (`bundleMs` > 2000 / `slipS` > 1) from every rule.
4. Window event-log queries to the trace (`StartTime`) and filter 2004 by provider.
5. Remove cost v1 and the canned cause text. Fix the legacy HTML colour (or delete the legacy HTML). Fix "unknown → Battery" in render-print L189.
6. Bring `osConfirmed` and `userMarks` into L3 as confirmation, and say "probe-only" when neither confirms.

**Add (P1)**
7. The rules in §3 (AV-normalized, throttle-at-hang, power AC-vs-BAT, DPC, vmmem/WSL, Postgres config, process dominance and growth, real swap).
8. A system profile section in every view. Also collect BIOS, GPU and driver, disk model and type, pagefile, battery health, cores vs threads (handoff).
9. A workload-latency probe for the declared scope (`psql -c "select 1"` round-trip, `docker info` latency) next to the generic spawn probe.
10. An email/ticket draft (`.email.txt` + a copy block in print.html).
11. Stacked small-multiple charts on one wall-clock axis with hang bands, as inline SVG (works offline and in print). Add CPU, disk, AV, clock, power and top-process-over-time panels. Put STATE/finding on the charts page.
12. A scope declaration on page 1 of every view, always shown, including "open scope".

**Reorder**
13. MD/print order per §4: header + scope → finding → actions → evidence + charts → profile → gaps/receipts → appendix → email.

**Remove / demote**
14. Legacy `.html`; loop-lag, Warp/openspec rows and the flags line in IT views; EcoQoS batch; `PRESSURED` on one predicate; raw docker stderr; unrounded floats.
15. One vocabulary across trace, pack, print, charts and trend.

---

## Handoff notes

### For the spec reviewer
- `evidence-surface/spec.md` L88-91 ("single samples are not proof") is **violated by the shipped code** (min-free, pages peak). Add a requirement-level minimum-n and "at-hang, not trace-wide" rule for any L3 input, with a scenario using the sample's numbers as the failing case.
- L93-101 ("JSON is truth, views match") needs a scenario that **parses** the JSON after anonymization. Currently nothing tests it, and the shipped sample fails.
- `orders-framework.md` L34 and `ontology.md` L14 promise correlations and a culprit-confidence formula that do not exist in code. Either specify them as requirements with acceptance tests or delete them from the docs. As written, the docs over-claim.
- The STATE vocabulary is specified only for trace (`RAM-BOUND (this trace)`). Specify one taxonomy for trace, pack, print and charts. Also specify that a STATE must be supported by ≥ 1 at-hang rule and must name the rule.
- Add requirements for:
  - the ready-to-send summary/email (owner intent, absent from every spec);
  - the static system profile fields IT needs;
  - "declared scope visible on page 1";
  - the chart set with a shared wall-clock axis and hang bands;
  - offline/print-safe charts.
- Cost: the spec allows "derived context alongside inputs" (L21-26). Specify that cost requires hangs > 0 and measured inputs only, with no default-assumed minutes.

### For the data-layer reviewer
- `anon()` serialization bug (L285-291) corrupts JSON. It is a data-integrity issue first.
- **Observer effect:** a PowerShell spawn plus a .NET `Get-Counter` per 2 s probe raises pages/sec (image loads) and CPU. The first bundle took 8849 ms in the sample, and loop-lag max was 12.9 s in 13-08-14. Measure and record tool self-cost per probe (own PIDs' CPU and faults) so L3 can subtract or exclude it. Consider one long-lived PowerShell or a typeperf session instead of a spawn per probe.
- `Pages/sec` alone cannot separate thrash from image loads. Add `Memory\Pages Output/sec` and `Paging File(_Total)\% Usage` deltas (pagefile % is collected, but there is no output rate). Record `Memory\Committed Bytes` and `Commit Limit` absolutely, not only as a %.
- `\Process(MsMpEng*)\% Processor Time` is not normalized by logical CPU count. Store a normalized value or record the CPU count next to it. Consider the Sure Click (`Br*`) CPU as well.
- `% of Maximum Frequency` is kept per probe, but the summary is `min` only. Keep it at-hang. User-tier CPU temperature is absent: decide whether a vendor or WMI source exists, or document the gap clearly. ACPI thermal-zone values (incl. 0.1 °C) need filtering and zone labels.
- Event-log collectors lack `StartTime` windowing and provider filters (1002/1000/2004, L1302-1303). The "timeout" failure mode is mis-assigned when there are zero events.
- Missing static collectors needed by IT: `Win32_BIOS` (version/date), `Win32_VideoController` (name, DriverVersion), `Get-PhysicalDisk` (MediaType/Model, user tier OK), `Win32_PageFileUsage`/`Win32_PageFileSetting`, `Win32_Processor` (NumberOfCores/LogicalProcessors), `powercfg /batteryreport` capacity fields (design vs full charge), the power-plan friendly name, `.wslconfig` contents, and Postgres `SHOW shared_buffers, work_mem, max_connections` when postgres is in scope.
- `osConfirmed`/`osHungWindows` and `userMarks` are collected but never consumed. Ensure they are timestamped to the probe they belong to, so L3 can join them within ±2 s.
- Plug state is recorded per probe (`probe.plugged`), but the summary keeps only the end value (`report.power`). Keep the AC/BAT transitions so charts can band them.
- Workload-side latency probes for the declared scope (Postgres round-trip, `docker info`) do not exist. They are the closest thing to "the hang the user felt" for the owner's scenario.
