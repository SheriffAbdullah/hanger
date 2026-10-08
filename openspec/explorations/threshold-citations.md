# Threshold citations (v0.6 first-order params)

Scope: ground each provisional default in the closest citable band; none are universal constants. Calibrate all on the owner's box.

## HANG 800ms (`--hang`)
- Source: Nielsen / Nielsen Norman Group "Response Time Limits" — 0.1s feels instant, 1s keeps flow, 10s loses attention (https://www.nngroup.com/articles/response-times-3-important-limits/).
- Cited band: 100ms (instant) / 1000ms (flow breaks). 800ms sits just under the 1s flow-break.
- Proposal: keep 800ms; report excess-over-threshold too. Confidence: **cited**.
- Calibrate: sweep 400/800/1200ms vs `user.marks[]` precision/recall; pick max F1 on ≥20 traces.

## COMMIT 85% / severe 90 (`--commit`)
- Source: MS "Troubleshoot performance problems in Windows" — healthy = Available MBytes >10% or ≥4GB free (https://learn.microsoft.com/en-us/troubleshoot/windows-server/performance/troubleshoot-performance-problems-in-windows); counter semantics in MS "Introduction to the page file" (Committed/Commit Limit).
- Cited band: watch ~85%, severe ~90% (≈ complement of the 10%-free rule).
- Proposal: keep 85/90. Confidence: **derived**.
- Calibrate: plot hang-rate vs commit peak; find knee between 80–95%.

## MIN-FREE 2.0GB / severe 1.5 (`--min-free`)
- Source: same MS doc (>10% or 4GB free); SCOM practice commonly alerts Available MBytes at 500MB–3GB depending on box size.
- Cited band: 0.5–4GB; scale by total RAM (2GB ≈ 10–25% of 8–16GB laptops).
- Proposal: keep 2.0/1.5GB but note `--min-free` should optionally scale (e.g. 10% of total). Confidence: **derived**.
- Calibrate: correlate minFree with hang-rate; test absolute vs % rule.

## PAGES 500/s (`--pages`)
- Source: no modern MS number; legacy SQL-era guidance (">5 pages/s sustained, add RAM") is obsolete at modern page sizes; registry judges on 5s avg (<50 idle, <200 loaded).
- Cited band: none current — treat 500/s sustained as aggressive thrash flag.
- Proposal: keep 500/s on 5s average, require sustained in W (not single spike). Confidence: **guess**.
- Calibrate: record pages/sec distributions in calm vs hang windows; ROC for 200/500/1000.

## QUEUE 4 (`--queue`)
- Source: MS AskPerf "Overview of Processor Bottlenecks" + BizTalk "System-Level Bottlenecks" — sustained Processor Queue Length >5 indicates bottleneck (https://learn.microsoft.com/en-us/biztalk/technical-guides/system-level-bottlenecks); MS PerfMon troubleshooting: ≥2 per processor is suspect.
- Cited band: 2/core … 5 total sustained.
- Proposal: keep 4 total; normalize per-core later (queue/cores). Confidence: **cited-ish**.
- Calibrate: divide by core count; compare hang vs calm queue distributions.

## DISK 0.025s + queue>2 (`--disk-sec`)
- Source: MS "Troubleshoot Slow SQL Server Performance Caused by I/O" — Avg Disk sec/Transfer consistently >10–15ms = bottleneck (https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/performance/troubleshoot-sql-io-performance).
- Cited band: 10ms warn / 15ms bottleneck (HDD-era); SSDs should sit <10ms.
- Proposal: keep 0.025s as conservative stall flag; split SSD (<0.015) vs HDD (<0.025) later. Confidence: **cited**.
- Calibrate: require queue>0 (meaningless at queue=0); ROC hang vs calm latency.

## DEFENDER 20% (`--defender`)
- Source: none — no vendor threshold for MsMpEng share; heuristic "single background process owning 1/5 CPU during a hang is notable."
- Cited band: none.
- Proposal: keep 20% as alibi flag, not verdict. Confidence: **guess**.
- Calibrate: distribution of Defender % in hang vs calm windows; check co-occurrence only.

## RECOVERY 400ms (`--recovery`)
- Source: none; derived as ~½× HANG, above one healthy spawn (~100–200ms) and below hang.
- Cited band: none.
- Proposal: keep 400ms for MTTR/next-probe-OK. Confidence: **guess**.
- Calibrate: histogram of next-probe ms after hangs; bimodal split = natural cutoff.

## RAM-HIGH 85 (PRESSURE_SUSTAINED)
- Source: cross-ref Apple Activity Monitor memory-pressure colors (green/yellow/red = qualitative, no published numeric; https://support.apple.com/guide/activity-monitor/actmntr34865/mac) + Windows 75–85 watch bands.
- Cited band: 75 watch / 85 pressure (Windows convention); Apple confirms color-not-percent thinking.
- Proposal: keep 85 with duration ≥30% of trace. Confidence: **derived**.
- Calibrate: vary 80/85/90 × duration fraction; stability of verdict flips.

## CONTEXT ±10s (W)
- Source: none; methodology choice = 5 probes/side at 2s cadence, covers pre/post deltas and lagged correlation (0/5/15s lags).
- Cited band: none.
- Proposal: keep ±10s; widen only if lags demand. Confidence: **guess**.
- Calibrate: test ±5/±10/±20s effect on pre/post delta significance and culprit ΔMB ranking.

Cross-cutting: Resplendence LatencyMon bands (<2000µs suitable, 2000–4000µs doubtful for realtime audio, https://resplendence.com/latencymon_using) are the model for "band, not point" reporting but measure kernel DPC/ISR latency, not spawn/probe latency — do not import numerically.
