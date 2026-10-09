# Change: hanger-v05 — always-on baseline, named processes, power truth

## Why
Owner needs usage-pattern tracking whether hanging or calm, zero unknown process
names, and per-sample power truth (plugged? optimized? throttled?) to separate
"unplugged throttles" from "plugged in, still hangs". Seven rival dives (WPR/WPA,
Sysinternals, DEX, ThousandEyes, Netdata/Glances, LatencyMon, DebugDiag/WER) each
contributed adoptable mechanisms (table below); without this change Hanger only
does incident traces with raw exe names and no power context.

## What Changes
- `hanger watch` (light 2s JSONL baseline + pressure hint) alongside `hanger trace`
- Human process identities: KNOWN map → FileDescription fallback → `unresolved` flag
- Power truth per sample: plugged, battery %, scheme, %max frequency
- Calm-linked evidence, WER AppHang counts, Responding OS-confirm, enriched hang context
- Specs: `evidence-surface` (9), `metrics` (11), `tracking` (8); v0.6 deferrals noted in specs

## Why (USER_PROBLEM.md)
Owner needs: (1) usage-pattern tracking whether hanging or calm; (2) zero unknown
process names — exactly what consumes RAM, in human words; (3) battery/power truth
per sample (plugged?, optimized?, throttled?) to separate "unplugged throttles" from
"plugged in, still hangs". Manifesto stands: numbers + reasons + RCA, no verdicts.

## Adopted from rival dives (7/7)
| Source | Adopted feature | Registry id |
|---|---|---|
| Netdata `apps.plugin` + `apps_os_windows.c` | friendly-name fallback: FileDescription/service name, `svchost -s` split, group patterns | `proc.friendly` |
| Glances `glances_batpercent.py` | plugged + percent per sample | `power.plugged`, `power.battery_pct` |
| Netdata `proc.plugin` PSI + `proc_vmstat.c` | minor/major fault split (`Page Reads/sec` already bundled; add per-proc on-HANG) | `mem.hard_reads_per_sec`, `proc.faults.<name>` |
| LatencyMon docs | timer-slack probe (isolated), DPC/ISR % in bundle, WhySoSlow factor list per HANG | `sched.timer_slack_ms`, `sys.dpc_isr`, `rca.factor_list` |
| WPR/WPA | `Pages Input/sec` + pagefile% mid-run, pool-nonpaged + uptime, opt-in `--wpr` capture | `disk.pagefile_vs_app`, `sys.boot_context` |
| Sysinternals (CLI-parse) | `Responding==false` OS-confirm, PPID/CommandLine trees, Sysmon ID1/5 if present | `hang.os_confirm`, `proc.tree` |
| DebugDiag/WER | fault-bucket grouping `(exe,ms-bin,commit-bin)`, WER archive counts, gated `--dump` | `wer.bucket_count`, `dump.minidump_optin` |
| DEX (ControlUp/SysTrack) | penalty score as LABELED composite (never headline), impact-min/5m buckets, self-baseline mean+2σ from `reports/*.json` | `hanger.score`, `hang.impact_min`, `baseline.delta` |
| ThousandEyes model | TCP-vs-SELECT1 local/network split, per-proc net I/O, Wi-Fi/DNS event rows per HANG | `net.vs_app`, `net.io_perproc`, `sys.event_net` |

## v0.5 scope (this change)
1. `watch` mode: light continuous loop (RAM/commit/pages/top-groups/battery/power/score
   every 2s → JSONL baseline). `trace` mode: current deep 2s-bundle + spawn probes.
   Watch auto-suggests `trace` when pressure (commit>85 or pages>500 sustained).
2. `proc.friendly`: KNOWN map (warp, node, Brother, Defender, vmmem→Docker WSL2 VM…)
   + FileDescription fallback in one ps call; `unresolved` flagged, never silent.
3. Power truth per sample: `power.plugged` (AC/battery), `power.battery_pct`,
   scheme GUID, `% of Maximum Frequency` in bundle.
4. Calm-linked evidence: every pack prints green windows too (min/avg/max + top),
   not just HANG rows.

## Non-goals
No fleet SaaS, no ETW/admin collectors (opt-in flags only), no presentation redesign,
no verdict-theater (score stays labeled composite).
