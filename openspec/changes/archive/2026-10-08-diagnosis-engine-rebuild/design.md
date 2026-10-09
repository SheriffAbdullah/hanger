# Design: diagnosis-engine-rebuild

## Context

See proposal.md for the motivation. Today `hanger.js` builds L3 in one block: `reasons[]`, then `verdict`/`cause`, then `rca[]` (constants 0.4/0.35/0.2 and `0.4+0.3x+0.15`), then `discriminate()`, then `costNote` v1. The pack and print renderers re-derive their own labels. By wave 5 the earlier changes provide:
- per-probe values with provenance (unit, window, n, measuredAt) and recorded unobserved intervals and observer cost (`sampling-engine-and-provenance`);
- machine-normalized security CPU, per-process CPU, disk latency in ms, temperature, and performance % (`data-signals-completeness`);
- per-hang in-scope and out-of-scope aggregates and in-scope-only not-responding checks (`software-inventory-and-scope`);
- workload latency probe series and phase markers (`workload-session-and-containers`);
- windowed, provider-filtered event records (`fix-report-integrity`).

This change consumes those inputs. It adds no collectors.

## Goals / Non-Goals

**Goals**
- One pure function, `diagnose(report) → diagnosis`, that is deterministic and replayable from stored first-order data with recorded thresholds.
- Every number in a finding resolves to a stored data point.
- Honest outcomes: `no-freeze-observed`, `insufficient-evidence`, `undetermined`, `outside-scope`.

**Non-Goals**
- The nine additional rules (commit limit, thrash, VM memory, database, dominance/growth, throttle, power plan, DPC, GPU). They belong to `diagnosis-cause-rules`, which plugs into the rule contract defined here.
- Report layout, charts, and the email draft (`report-and-visualization`). This change only supplies `diagnosis.finding` and the vocabulary.
- Lagged correlation and the fixed-weight culprit formula (DEF-2).

## Decisions

### D1. Association wording, not causal labels
The headline is "N of M usable hangs coincide with <class>; at hangs X vs calm Y (n/n)".
- **Alternative:** keep a causal STATE label (`RAM-BOUND`). Rejected: one trace cannot prove causation (manifesto), and the label contradicted its own evidence in the shipped sample.
- **Alternative:** no headline at all. Rejected: IT needs a one-line lead (R03 §4 order item 2).

### D2. One engine, rules as plugins
`lib/diagnosis/engine.js` iterates over the registered rules (`lib/diagnosis/rules/*.js`), each exporting `{id, class, evaluate(ctx, hang) → RuleResult, disprove(ctx, hang) → {check, result, values}}`. Ranking, roll-up, finding, discriminator, and time-lost are engine outputs.
- **Alternative:** keep the verdict, RCA, and discriminator but reconcile them. Rejected: three code paths will drift again (R03-L3-1).

### D3. Confidence is derived from five recorded components
For rule r at usable hang h:

```
C  = 1 if r crossed its threshold at h, else 0                  (at-hang crossing)
D  = clamp01((v_h - calmMean) / (threshold - calmMean))         (hang-vs-calm delta, normalized;
     0 if calmMean >= threshold or calm n < 3; flagged "calm-insufficient")
     for "lower is worse" signals (available MB) the sign is flipped
O  = (# usable hangs where r fired) / (# usable hangs)          (co-occurrence share)
K  = (# fired hangs with any confirmation) / (# fired hangs)    (confirmation share: user mark | OS | workload probe)
P  = min(0.3, 0.1 × # active confounds at h)                    (confound penalty)

conf(r,h) = min(0.95, (0.35·C + 0.25·D + 0.25·O + 0.15·K) × (1 − P))
conf(r,run) = mean of conf(r,h) over hangs where r fired
```

The weights are published constants of the formula, recorded in `diagnosis.confidenceModel`. They are not per-rule constants: a rule's confidence changes only when its evidence changes. The cap stays at 0.95, which resolves the 0.85/0.95 contradiction (R01-P1-3e).
- **Alternative:** a Bayesian/likelihood model. Rejected: no labelled data to fit it, and IT cannot read it back.
- **Alternative:** the 0.4/0.3/0.2/0.1 ontology formula. Deferred (DEF-2). Its "share" term needs a per-process attribution model that is not yet validated.

**Worked example A: 13-08-14-like fixture.** 60 s, battery. 30 probes, 4 excluded (startup and observer), 26 usable. 5 hangs, all usable. Memory rule: commit at the hangs 88-92% (mean 90), calm mean 62% (n=18), threshold 85.
- C=1, D=clamp01((90−62)/(85−62))=1.0, O=5/5=1.0.
- 2 of 5 hangs have a user mark, so K=0.4. No active confounds, so P=0.
- conf = 0.35+0.25+0.25+0.06 = **0.91**.
- Security rule at 4 of 5 hangs: normalized 12% vs calm 1.5%, but memory fired, so per its spec the rule does not fire. It is listed as checked, not fired.
- Finding: `memory`, "5 of 5 usable hangs coincide with memory pressure; commit 90% at hangs vs 62% calm (n=5/18); 2 confirmed by user mark, 3 probe-only".

**Worked example B: R03 shipped sample.** 5 probes, 0 hangs, commit 52-65%. Probe 1 has bundle 8849 ms, so it is excluded and 4 probes are usable.
- 0 hangs gives class `no-freeze-observed`. Usable 4 < 10 gives strength "insufficient (4 usable probes, minimum 10)".
- No rule is evaluated for ranking. Observations list the commit range and the excluded startup probe.
- No memory class, no cost.

### D4. Observer exclusion before any rule
Exclusion predicates: collection time > 2000 ms, slip > 1 s, `t < 10 s`, or first probe. Change 5 records observer cost (`probe.observer`). Excluded probes stay in the first-order data (never deleted). They are only filtered out of rule inputs.
- **Alternative:** subtract the observer's cost from the counters. Rejected for now: attribution per counter is not reliable. Recorded as a refinement for later.

### D5. Minimum evidence (OQ-15 default)
At least 10 usable probes before ranking. At least 3 probes for "sustained". Below the minimum, the engine emits observations only.

### D6. Outside-scope cause
Inputs come from the scope change's per-hang `{inScope: {commitMB, cpuPct}, outOfScope: {commitMB, cpuPct, groups}}`. The rule fires when machine commit ≥ the commit threshold or CPU > 90%, **and** the in-scope share is below 30% on that same axis. In open scope it is not evaluable.

### D7. Neutral hardware-vs-configuration signal
`discriminator` is replaced by `diagnosis.hwConfigSignal ∈ {pressure-at-freezes, large-resident-without-pressure, not-separable}`, computed from the memory rule's at-hang vs calm deltas and the largest in-scope group share. A test lint bans `/\b(buy|upgrade|replace|purchase|reimage)\b/i` in all diagnosis strings.

### D8. Time-lost (OQ-9 default)
Shown only with at least 1 usable hang. Measured: `frozenS = Σ hang durations`, `observedS` from the timebase. Extrapolation to per-day or currency happens only if the user passes `--active-min` and `--cost-rate`, labelled user-supplied. Rendered in the appendix only. Cost v1 is deleted.

## Data / schema shape (`hanger-json/2`, draft)

```jsonc
"diagnosis": {
  "engine": "diagnosis/1",
  "hangDefinition": { "probe": "process-start-latency", "thresholdMs": 800, "source": "default|flag|config",
                      "intervalS": 2, "cannotSee": ["freezes shorter than the probe interval", "UI input lag that does not delay process start"] },
  "usable": { "probes": 26, "excluded": 4, "minimum": 10, "sustainedMin": 3 },
  "excludedProbes": [ { "ref": "spawnProbes[0]", "reasons": ["startup-window", "observer-slow"] } ],
  "calm": { "definition": "usable, latency < 400 ms, not within 10 s of a hang", "n": 18,
            "means": { "mem.committed_pct": 62.1, "cpu.pct_total": 23.0 } },
  "proxyValidation": { "status": "validated|not validated", "precision": {"num": 2, "den": 4}, "recall": {"num": 2, "den": 3} },
  "confidenceModel": { "weights": { "C": 0.35, "D": 0.25, "O": 0.25, "K": 0.15 }, "penaltyPerConfound": 0.1, "penaltyMax": 0.3, "cap": 0.95 },
  "thresholds": { "mem.commit": { "value": 85, "unit": "%", "source": "provisional|<citation>", "origin": "default|flag|config" } },
  "hangs": [ {
    "ref": "spawnProbes[17]", "at": "2026-10-06T13:08:36.2Z", "ms": 2140,
    "confirmedBy": ["user-mark"],             // or ["probe-only"]
    "scopeShare": { "inScopeCommitPct": 41, "outOfScopeCommitMB": 3100 },
    "rules": [ {
      "id": "memory-pressure", "class": "memory", "fired": true,   // true|false|null
      "reason": null,
      "at": ["2026-10-06T13:08:36.2Z"],
      "inputs": [ { "ref": "spawnProbes[17]", "signal": "mem.committed_pct", "at": "…", "value": 91.0, "unit": "%" } ],
      "threshold": { "value": 85, "unit": "%", "source": "provisional", "origin": "default" },
      "n": 1, "calm": { "mean": 62.1, "n": 18 },
      "components": { "C": 1, "D": 1.0, "O": 1.0, "K": 0.4, "P": 0 },
      "confidence": 0.91,
      "disprover": { "check": "commit < 70% and available > 2 GB across ±10 s", "result": "not-disproved", "values": [] },
      "confounds": []
    } ],
    "ranked": ["memory-pressure"]               // disproved and unfired rules omitted
  } ],
  "rollup": [ { "id": "memory-pressure", "class": "memory", "hangs": 5, "of": 5, "confidence": 0.91 } ],
  "finding": { "class": "memory", "sentence": "5 of 5 usable hangs coincide with memory pressure; …",
               "strength": "sufficient|insufficient (4 usable probes, minimum 10)",
               "confirmations": { "user-mark": 2, "os-not-responding": 0, "workload-probe": 0, "probe-only": 3 },
               "scope": "scoped: postgres, docker | open scope", "window": { "start": "…", "end": "…", "observedS": 60 } },
  "observations": [ "…" ],                    // only when ranking is not possible
  "hwConfigSignal": { "value": "pressure-at-freezes", "atHang": { "mean": 90, "n": 5 }, "calm": { "mean": 62, "n": 18 } },
  "timeLost": null,                           // or { "frozenS": 10.7, "observedS": 600, "userSupplied": { … } | null }
  "eventsUsed": [ { "id": 1002, "at": "…", "provider": "Application Hang" } ],
  "eventsHistory": [ … ]
}
```

Vocabulary (`lib/diagnosis/vocabulary.js`): `memory | cpu | disk | thermal-power | gpu | security-software | outside-scope | undetermined | no-freeze-observed | insufficient-evidence`. Rule-id to class map: memory-pressure→memory, cpu-saturation→cpu, disk-stall→disk, security-contention→security-software, outside-scope→outside-scope. `diagnosis-cause-rules` adds the rest. `observer-guard` and `confirmation` are engine stages, not ranked causes.

## Non-binding implementation hints

- Build `ctx` once: usable probes, calm set, means per signal, marks joined (±2 s), windowed events, scope shares. Rules read only `ctx` and the hang. This keeps rules pure and fixture-testable.
- Fixtures: put `fixtures/diagnosis/sample-r03.json` (shape copied from `reports/sample-hanger.json` values) and `fixtures/diagnosis/memory-13-08-14.json` (synthetic, 30 probes) under `tools/hanger/test/fixtures/`, plus small hand-built cases per scenario. Use the fixture builder from `fix-report-integrity`.
- Write a reference-resolution test helper that walks `diagnosis.hangs[].rules[].inputs[].ref` and asserts each one resolves into the same JSON with an equal value and `at`.
- Console: replace `stateCard` with a "Finding" card that prints `finding.sentence`, the confirmations, and the top 3 rollup rows.
- `trend.js`: map v1/v2 `summary.verdict` strings to `legacy:<string>`, and use `diagnosis.finding.class` for v3.
- Pack: compute the finding from the stored `diagnosis` of the referenced trace. Never recompute with current CLI thresholds.
- Not-responding check: exclude processes whose UWP/package state is suspended or that have no main window. Keep only in-scope groups via the scope resolver. Record `pollAt`.

## Risks / Trade-offs

- [Formula weights look arbitrary] → They are published in the report, the same for every rule, and covered by a monotonicity test (more evidence never lowers confidence). Revisit once marks provide labelled data.
- [Minimum n = 10 suppresses findings on short runs] → The finding says why and how many probes were usable, and `record` defaults to 10 min (OQ-11).
- [Calm set empty on a fully hung box] → D is flagged `calm-insufficient` and set to 0, and the finding states "no calm baseline". C and O still carry the evidence.
- [Excluding observer-slow probes drops genuine hangs on a melting box] → Excluded hangs are still counted and shown as observations. The finding reports "k hangs excluded as observer-affected".
- [Removing keys breaks old consumers] → Schema bump to `/3` with a changelog entry. `trend` reads legacy verdicts as labelled legacy.

## Migration

- Removed: `summary.verdict`, `summary.cause`, `summary.costNote`, `summary.costParams`, `summary.costV2`, `summary.discriminator`, and top-level `rca`. Added: `diagnosis`.
- `SCHEMA-CHANGELOG.md` gets a dated `2.x` section listing them. The schema string stays `hanger-json/2` because v2 is a draft until report-and-visualization freezes it (IMPLEMENTATION-PLAN §2).
- Regenerate `reports/sample-hanger.*` from the synthetic fixture, so it now reads `no-freeze-observed`.
- Rollback: revert the change. v2 reports remain readable by the old code.

## Open Questions

Deferrable. Defaults are taken from IMPLEMENTATION-PLAN §5.
- OQ-9 (cost): default is measured time-lost only with at least 1 hang, appendix only, no v1.
- OQ-12 (STATE label): default is that the word "STATE" is dropped. The finding sentence and class replace it.
- OQ-15 (minimum evidence): default is at least 10 usable probes and at least 3 for sustained.
