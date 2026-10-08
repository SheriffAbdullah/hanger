# Persona: IT Asset Admin (approver for 200 laptops)

## 1. Story (3 lines)
I own the fleet: purchase dates, warranty expiries, images, and security policy for 200 laptops. Users file "machine too slow" tickets daily; I must separate hardware exhaustion from bloat, misconfig, and unsanctioned software before I spend. One anecdotal screenshot never unlocks budget — a reproducible, policy-clean evidence pack might.

## 2. Evidence I demand

**Must (no pack without these):**
- Asset context block: hostname/serial, model (e.g. HP ProBook), RAM fitted, disk free %, OS build, purchase date + warranty status. A trace without age/warranty is unactionable.
- Sustained-vs-threshold over weeks, not one 10s trace: `watch` aggregates — % work-hours with committed >85%, pages/sec p95/day, hang events ≥800ms/day, n + window + cadence per metric. Single-sample counters are not proof.
- RAM-vs-reimage discriminator: top-group MB with signed identity (publisher + path) + startup/AV load (Defender scan overlap?) + committed/pages at hang vs calm. `node 753MB + commit 86% at HANG vs 62% calm` = RAM case; `Br-uxendm.exe 2283MB bloat + clean commit` = reimage/remove case.
- Scope declaration audit: the declared scope (source, scope-file path and SHA-256, entries, match rule, always-monitored system set) first in the pack, the out-of-scope load as an anonymous aggregate (group/process/memory totals, never names), `collection.tier: user|admin`, `unavailable` reasons. I re-run the same scope file to reproduce; what is outside the scope must be counted, never silent.
- Admin-tier signals when elevatable: thermal throttle (%maxFreq <60 on AC), SMART health, Sysmon/driver faults, WER AppHang/Event-1002 history. Tier must be labeled; user-tier gaps must say why, not zero-fill.

**Should:**
- Ticket linkage: helpdesk ticket count for this asset (last 90d), calm-window proof ("all green at 11:40, AC + Best performance") alongside hang rows.
- Power truth per sample: AC/battery, scheme GUID, battery % — kills "just plug it in" disputes.
- Cost/time-lost with explicit params (`--cost-min/--cost-rate`, workdays/mo) as context only, never a verdict.

**Could:**
- Fleet percentile: this asset's p95 commit/hang-rate vs fleet median; warranty-batch defect clustering.

## 3. Instant reject (red flags)
- Unknown rows (`unresolved`) presented as fact, or out-of-scope MB missing from the aggregate totals — looks like tampering to inflate a claim.
- Thresholds unstated or changed between runs (`--hang 800` unrecorded); JSON/MD disagree; averages with n=1.
- Privacy violation: full cmdlines, usernames, hostnames, container names leaked despite `--anonymize`; raw docker strings unmasked.
- Security risk: EDR/Defender disabled to "improve numbers." (The always-monitored system set keeps registered security products visible.) Non-goal: Telltale is not a software-compliance scanner; it does not flag unsanctioned or unsigned software outside the user's declared scope. Its legitimacy rests on declared scope plus anonymous aggregates.
- Cherry-picked 10s pressure trace with no calm baseline and no multi-day `watch` trend.

## 4. Pipelines Telltale must build for me
1. **Fleet intake:** `watch` (light continuous) → weekly rollup per asset + ticket join → triage queue (replace / reimage / remove-bloat / monitor).
2. **Approval pack:** one JSON (truth) + MD/HTML view with asset block, sustained metrics, hang↔pressure RCA with confidence, filter/tier audit, power truth, reimage-vs-RAM call supported by numbers.
3. **Policy gate (non-goal; replaced by a scope declaration audit):** verify the declared scope, its file hash and the out-of-scope aggregate; reject packs that fail reproducibility before they reach my desk. Not a policy gate: no signature or allowlist check of software outside the declared scope (non-goal: not a compliance scanner).
