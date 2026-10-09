# Proposal: diagnosis-engine-rebuild

## Why

The inference layer (L3) is four parallel, unconnected labels: the `STATE` verdict, per-hang RCA, the RAM-vs-reimage discriminator, and the pack renderer's own taxonomy. They can disagree, and nothing reconciles them (R03-L3-1). The headline `RAM-BOUND` fires on any two of seven predicates, including non-memory ones. It uses single samples and unwindowed event-log rows (R03-P0-2). RCA blames memory from the *trace-wide* commit peak rather than the value at the hang (R03-P0-3, R01-P1-3c). Confidences are hand-set constants. The spec contradicts itself (0.85 vs 0.95, R01-P1-3e). Disprovers are prose that is never evaluated (R01-P1-3b).

"Hang" is never defined in user terms or validated against what the user felt (R01-P1-1, R03-P0-4). OS confirmation is polluted by suspended UWP apps (R02-P1-1). The shipped sample says `RAM-BOUND` at 0 hangs and 52-65% commit, with a $900/month assumed cost and canned "Docker OOM" text (R03-P0-5). An IT reader rejects that within a minute. The data changes in waves 1-4 (scope aggregates, real timebase, provenance, normalized signals) are only useful if one honest engine consumes them.

## What Changes

- **BREAKING** Replace the `reasons.length >= 2` STATE logic, the per-hang `rca[]` constants, and the separate discriminator with **one diagnosis engine**. It ranks causes per hang, judging the value at the hang against calm windows. It rolls the ranking up per run as "N of M hangs coincide with X".
- Define a **hang in user terms**: the proxy (process-start latency probe), the recorded threshold, what the proxy cannot see, and its confirmation sources (user mark within ±2 s, OS not-responding of an in-scope non-suspended process, workload latency probe). Unconfirmed hangs are labelled "probe-only". Precision and recall against user marks are computed with n.
- Exclude **observer-affected probes** (tool-slowed collection, the startup window) from every rule, and count the exclusions.
- Set a **minimum evidence** bar: at least 10 usable probes before any ranking, and at least 3 probes for anything called "sustained". A single sample is never evidence. Below the bar the output is `insufficient-evidence`, with observations only.
- Define a **rule contract**. Every rule emits `{id, fired, at[], inputs[] (probe refs), threshold+source, n, calm, confidence, disprover result, confounds}`. **Confidence is derived** from evidence components (no constants), capped at 0.95. Disprovers are **evaluated** as disproved, not-disproved, or not-evaluable.
- Migrate the four core rules to at-hang semantics: memory pressure, CPU saturation, disk stall, and security-software contention (with machine-normalized AV CPU). Add the observer guard, the OS/user confirmation rule, and a new **outside-declared-scope** cause.
- **BREAKING** Replace the `STATE:` label with a **headline finding**: an association sentence plus a cause class from one fixed vocabulary, used by trace, pack, print, charts, trend, and email. `PRESSURED` on one predicate is gone.
- **BREAKING** Remove cost v1 (assumed 45 min/day) and the canned consequence text. Measured time-lost appears only with at least 1 hang, and only in the appendix. The discriminator becomes an output of the ranking with neutral vocabulary.
- OS event records (1002/1000/2004) enter inference only when windowed to the run and provider-filtered. Thresholds cite a source or are labelled provisional (open v09 item).

## Capabilities

### New Capabilities
- `diagnosis`: the single cause-ranking engine. It covers the hang definition and confirmation, evidence minimums, calm windows, the rule contract, derived confidence, evaluated disprovers, evidence references, the outside-scope and undetermined outcomes, the headline finding, the vocabulary, and the core rules. `diagnosis-cause-rules` extends it.

### Modified Capabilities
- `evidence-surface`: "Evidence surface, never verdict-maker": the finding label derives from the leading cause class. "Trace causes with ranked confidence, never certainty": "same window" now means at the hang vs calm.
- `tracking`: "OS-confirm via Responding poll": in-scope and non-suspended processes only, polled at the hang, wording fixed. "User ground-truth marks": hung/fine kinds, notes, and a ±2 s join.
- `metrics`: REMOVED "Culprit attribution capped below certainty (…)" and "Ordered RCA procedure with disprovers". Both move into `diagnosis`.

## Impact

- Code: new `tools/hanger/lib/diagnosis/{engine,vocabulary,confidence}.js` and `lib/diagnosis/rules/*.js`. `tools/hanger/hanger.js` replaces the verdict/cause/reasons/rca/discriminator/costNote block and the console STATE card. `render-print.js`, `render-charts.js`, `trend.js`, and pack mode read `diagnosis.finding` (vocabulary only; layout belongs to `report-and-visualization`).
- Schema: `summary.verdict`, `summary.cause`, `summary.costNote`, `summary.costParams`, `rca[]`, and `summary.discriminator` are removed. `diagnosis{}` is added. Removals are recorded in a dated `2.x` SCHEMA-CHANGELOG section; the schema stays `hanger-json/2` because v2 is a draft until report-and-visualization freezes it (IMPLEMENTATION-PLAN §2). `trend` reads older reports' verdict strings as legacy labels.
- Depends on: `software-inventory-and-scope` (per-hang in/out-of-scope aggregates), `sampling-engine-and-provenance` (provenance, unobserved intervals, observer cost), `data-signals-completeness` (normalized AV CPU, CPU %, disk ms), and `workload-session-and-containers` (workload latency probe).
- Docs: `openspec/explorations/orders-framework.md` and `ontology.md` mark the correlation and 0.4/0.3/0.2/0.1 formula claims as superseded by `diagnosis` (DEF-2).

## Findings addressed

- R01-P0-3: outside-declared-scope cause in the ranking.
- R01-P1-1: hang defined in user terms; precision/recall vs marks; mark kinds.
- R01-P1-2: diagnosis record; finding derived from the leading cause class.
- R01-P1-3b: disprovers evaluated and recorded.
- R01-P1-3c: memory rule judged at the hang, not on the trace-wide peak.
- R01-P1-3e: the 0.85/0.95 contradiction is removed; derived confidence capped at 0.95.
- R01-P2-3: neutral vocabulary for the hardware-vs-configuration signal.
- R01-P2-7: Responding scenario wording fixed.
- R01-REC-4: evidence-surface carries the hang definition, diagnosis record, and label from the cause class.
- R01-REC-5: tracking Responding wording (other parts belong to other changes).
- R02-P1-1: OS confirmation excludes suspended/background apps and is never copied from end-of-run polls.
- R02-P1-8: security-software rule uses normalized CPU and lists observer-induced scanning as a confound.
- R02-REC-8: misleading-evidence repairs on the inference side (UWP, windowed events).
- R03-P0-2: STATE overreach replaced by the rule engine.
- R03-P0-3: at-hang memory evidence.
- R03-P0-4: hang confirmation sources and proxy validation.
- R03-P0-5: cost v1 and canned text removed (legacy HTML and print battery belong to other changes).
- R03-P1-5: minimum-evidence gate.
- R03-P1-6: one vocabulary.
- R03-L3-1: one engine replaces four inferences.
- R03-L3-2: confirmations and plug/throttle inputs reach inference (throttle and power rules come in `diagnosis-cause-rules`).
- R03-L3-3: undeclared formula superseded by derived confidence; correlation deferred (DEF-2).
- R03-L3-4: evidence references to probes.
- R03-ADD-6: security-software contention rule.
- R03-ADD-9: disk stall rule.
- R03-ADD-10: CPU saturation rule.
- R03-ADD-13: OS/user-confirmed hang rule.
- R03-ADD-14: observer self-load guard.
- R03-REM-1: cost v1 removed.
- R03-REM-6: event records gated on windowing.
- R03-REM-7: PRESSURED removed.
- R03-REM-8: canned consequence sentence removed.
- R03-REC-2: per-hang rule engine with association wording and minimum n.
- R03-REC-3: self-load probes excluded.
- R03-REC-5: cost v1 and canned text removed (inference part).
- R03-REC-6: osConfirmed and userMarks used as confirmation; "probe-only" otherwise.
- R03-REC-7: the core rules from the list (the rest come in `diagnosis-cause-rules`).
- R03-REC-14: PRESSURED demoted (other removals belong to other changes).
- R03-REC-15: one vocabulary across outputs.
