# Change: hanger-v09 — honesty overhaul (5-audit synthesis)

## Why
Five auditors (manifesto, manager, engineer, vision, user-advocate) converged:
STATE naming fixed the word but not the theater. An IT/finance reader still gets
n=6 stats without n-disclosure, uncited provisional thresholds, cost fiction with
hidden assumptions, redaction that reads as cherry-picking, and single traces
presented where only longitudinal watch data persuades. Daily use still leaks
(`--hide` memory), hides throttle truth (maxFreq in JSON only — now in MD),
and never auto-escalates watch→trace.

## What Changes
- n-disclosure on every second-order stat (`p95 … (n=6)`, hang-rate with window)
  + multi-trace trend table from `reports/*.json` history; watch positioned as
  the primary evidence mode, trace as incident capture
- Cost block: all assumptions printed (days/mo basis, rate source, upgrade-vs-
  replace inputs) from `--cost-*` params; no silent defaults
- Redaction trust: per-hidden-name MB + sha1 filter fingerprint + "full JSON
  available to IT" note; receipts never row-silent, never name-silent in aggregate
- Thresholds: cite source per TH param or convert to bands with healthy ranges
  (manifesto metric discipline); ideals move TBD→cited-or-band
- `--watch-trigger`: watch spawns `trace` child on 3rd pressure streak (PerfMon-alert pattern)
- Locale-proof numbers: invariant-culture emission in ps() collectors (de-DE safety)
- File split if >1200 lines: `collectors/`, `report.js`; Mac-stub honesty label
  (declaration vs test) + schema assert per inference
