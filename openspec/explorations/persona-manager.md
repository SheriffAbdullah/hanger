# Persona: Engineering Manager

## 1. Story (3 lines)
I own sprint velocity and hardware budget for 6–12 devs; finance asks "prove it" for every upgrade.
I can't read ETW traces and won't open JSON — I need one page I can forward to IT/finance.
If Telltale can't turn freezes into lost-hours + team pattern + cost context, I buy nothing.

## 2. Evidence I demand

**Must (no page, no signature):**
- **Hours lost with basis printed on the page.** `lost_min/day = hangs/min × mean_freeze_s × active_min/day`, with `n, window, threshold flag (--hang 800)` shown. Example: `3 hangs in 60s (n=30 probes) → 180/hr × 2.1s = 6.3 min/hr → ~45 min/day over 7.5hr day`. No basis = no number.
- **Team-wide or one box?** `trend` rollup: same STATE + top culprit on ≥3 machines / ≥5 traces before I treat it as systemic. One 60s trace is an anecdote.
- **Upgrade-vs-replace math (context, never verdict).** `waste $/mo = lost_hr/day × rate ($/hr flag, default disclosed) × 20d` vs. `RAM upgrade $ / laptop replace $` side-by-side. Manifesto rule: numbers only, no "deserves 32GB."
- **Fits one printable page.** STATE card + 3 HANG rows + top-5 named culprits + power line + cost line. Must render to paper/PDF (MD → print-CSS HTML), not dashboard-only.

**Should:**
- Calm window alongside hang window ("11:40 green 62% / 11:47 red 86% + node 753MB") so I see it's load-linked, not always-broken.
- Power disprover in one line: `AC + Best performance + min %maxFreq 95 → not throttling`.
- Plain-English culprits: `Br-uxendm.exe → Brother printer utility (signed: Brother)`, never raw `svchost.exe ×97`.

**Could:**
- WER AppHang history count (is this chronic?).
- Docker/WSL + GPU footnotes for platform-team triage.

## 3. What makes me say no (red flags)
- Single-sample proof ("commit 86% once") or averaged-away data with no `n/window/cadence`.
- `unresolved` process rows in top-5, or silent redaction without totals.
- Verdict theater: "buy new laptop" with no recompute path; thresholds hidden.
- Non-printable output, broken pagination, or JSON-or-bust handoff to finance.

## 4. Pipeline(s) Telltale must build for me
1. **Cost-arithmetic pipeline (second-order, versioned):** hang rate → frozen % → lost-min/day → $/day/mo with flags recorded; recompute from JSON reproduces the page.
2. **Trend / team-rollup pipeline:** `trend` over `reports/telltale-*.json` → per-machine STATE history + cross-machine culprit frequency; answers "pattern or one box."
3. **Printable renderer pipeline:** JSON (truth) → one-page MD/HTML with print CSS (STATE, HANG table, culprit table, power line, cost line + method footnote). Presentation is a renderer — paper/PDF is the contract.
