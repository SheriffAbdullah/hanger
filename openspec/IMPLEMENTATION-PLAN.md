# Implementation plan: review-driven rebuild (R01 + R02 + R03)

Source reviews: `reviews/01-openspec-review.md` (R01), `reviews/02-data-layer-review.md` (R02),
`reviews/03-inference-and-report-review.md` (R03). Baseline commit `e2bacca`.

This file is the contract between the spec author and the implementation agents. It holds:
1. the change list, order, and dependency graph;
2. parallel waves;
3. one brief per change for a Sonnet implementation agent;
4. the requirement-ownership matrix (which change may MODIFY/REMOVE each existing requirement);
5. open questions for the owner, each with the default the agents will use;
6. the traceability table: every P0/P1/P2 finding and recommendation in R01-R03 mapped to a change and task.

## 0. Product intent (owner) that every change serves

Install once. Run during the hanging workload (Postgres, Docker). Determine why the laptop
hangs and produce evidence for IT plus a ready-to-send email. Privacy is **scope, not
redaction**: inventory what runs locally, the user chooses an allow-list, the run collects
only that scope, the scope is declared prominently, and the analysis says so honestly
when the load is outside the declared scope. Visuals: RAM, CPU, GPU (if relevant),
temperature, AC/battery, disk, and more. IT also gets static system facts.
Specs state the **datum or behavior**, never the API that obtains it. API hints live
only in each `design.md` and are non-binding.

## 1. Changes, order, dependencies

| # | Change id | One-line scope | Depends on | Wave |
|---|---|---|---|---|
| 1 | `spec-sync-v06-v13` | Spec hygiene: back-fill surviving v06-v13 behavior, fix spec contradictions, close zombie changes, add archive gates. **No product code.** | none | W1 |
| 2 | `fix-report-integrity` | Valid JSON under anonymize, loud readers, schema v2, incremental persistence, real timebase, observed-window rates, self-exclusion, event windowing, effective settings. Creates the test harness. | none | W1 |
| 3 | `software-inventory-and-scope` | Local inventory, scope file, one resolver, collection-time enforcement, leak closure, scope declaration first, out-of-scope aggregates, retire `--hide`. | 2 | W2 |
| 4 | `system-profile-for-it` | Static facts for IT with value-or-unavailable-reason, source, and tier. | 2 | W2 |
| 5 | `sampling-engine-and-provenance` | Cheap continuous sampler, budgeted on-trigger heavy work, unobserved gaps, observer cost, long capture, non-blocking marks, per-value provenance. | 2, 3 | W3 |
| 6 | `data-signals-completeness` | Per-process CPU and I/O, temperature, turbo-aware throttle, battery %, commit bytes, paging direction, disk, network, GPU, AV normalization. | 5 | W4 |
| 7 | `workload-session-and-containers` | Workload phases and lifecycle markers, Docker/WSL2 time series and caps, opt-in workload latency probe and config facts. | 5 | W4 |
| 8 | `diagnosis-engine-rebuild` | One ranked cause list judged per hang vs calm, hang definition, confirmations, min-n, derived confidence, evidence refs, outside-scope cause, headline finding, cost and canned-text removal. | 3, 6, 7 | W5 |
| 9 | `diagnosis-cause-rules` | The nine remaining cause rules from R03 §3 plus rule-to-action mapping. | 8 | W6 |
| 10 | `report-and-visualization` | Report order, inline-SVG charts on one wall-clock axis, offline/print, formats keep/remove, system-profile section, email draft. | 4, 8 | W6 |

Why this differs from the suggested 7-change decomposition:
- **Spec hygiene moved to wave 1 (was #7).** It is code-free. Closing the zombie v09/v13
  changes makes `openspec validate --all` green, and every later change uses that as a gate.
  It only MODIFIES requirements no other change touches (see §4), so it cannot conflict.
- **Data signals split in three (5, 6, 7).** The sampler rewrite is a prerequisite for adding
  signals cheaply (R02-P1-3, R02-REC-5). Docker/WSL/workload is a separate subsystem.
  Each part now fits one agent session.
- **Diagnosis split in two (8, 9).** The engine and the five migrated core rules are one
  coherent unit. The nine new rules are mechanical once the rule contract exists.

### Dependency graph

```
W1:  [1 spec-sync]          [2 fix-report-integrity]
                                   |
                     +-------------+-------------+
W2:          [3 inventory-and-scope]      [4 system-profile]
                     |                            |
W3:          [5 sampling-engine] <---(also 2)     |
                     |                            |
              +------+------+                     |
W4:   [6 data-signals]  [7 workload-session]      |
              +------+------+                     |
W5:          [8 diagnosis-engine] (needs 3,6,7)   |
                     |                            |
              +------+------------------+---------+
W6:   [9 cause-rules]          [10 report-and-visualization] (needs 4, 8)
```

### Parallel groups and merge hotspots

| Wave | Parallel | Merge hotspot | Rule |
|---|---|---|---|
| W1 | 1 and 2 | none (1 touches only `openspec/`, `README.md`) | free |
| W2 | 3 and 4 | `tools/telltale/telltale.js` report assembly (`report = {...}`) | 4 writes a new module `lib/system-profile.js` and adds one key to the report. 3 owns everything else in assembly. Merge 3 first. |
| W4 | 6 and 7 | collector registration in the sampler from change 5 | Both add collectors through the registration interface change 5 creates. Neither edits the sampler core. |
| W6 | 9 and 10 | none: 9 edits `lib/diagnosis/rules/*`, 10 edits renderers | 10 renders whatever rules exist. Rules added by 9 appear without renderer changes. |

Each agent works on its own branch or git worktree, runs the full test suite before
handing back, and rebases onto the current main before merge.

## 2. Shared conventions for every implementation agent

- **Do not change behavior outside your change's specs.** If a requirement in another
  change blocks you, stop and report it rather than editing that change.
- **Tests:** zero dependencies. `node --test tools/telltale/test/` must pass. Change 2
  creates the harness, `test/fixtures/`, and `test/helpers/` (`validate-report.js`,
  `grep-artifacts.js`). Collector parsing is unit-tested on canned output text. Live
  collection is verified by the smoke commands in each `tasks.md`.
- **Live verification (project rule, `openspec/config.yaml`):** a task is ticked only after
  the stated live Windows command ran, plus a review-gate note in the change's `tasks.md`
  (date, command, observed result).
- **Validation:** `openspec validate <change-id> --strict` must pass. Its INFO output must not
  contain "Archive would refuse" for any MODIFIED/REMOVED header.
- **Traceability:** every task carries the finding IDs it closes, e.g. `[R02-P0-1]`.
  Tasks cite requirement names, never source line numbers (line numbers rot, R01-P2-8).
- **Report schema:** change 2 bumps the schema to `telltale-json/2` and records it in
  `tools/telltale/SCHEMA-CHANGELOG.md`. For the whole program (changes 2-10), v2 is a
  **draft**: the report carries `schemaStatus: "draft"`. Every change that adds, renames,
  or removes a field (e.g. `redacted.*`/`focus.*` removal in change 3, the `asset` alias
  removal in change 10) adds a dated `2.x` changelog section listing the fields, and
  stays at `telltale-json/2`. Change 10's last task sets `schemaStatus: "frozen"`. After
  that, the changelog's normal rule applies again: any later removal or rename bumps to `/3`.
- **Module seams:** new logic goes in `tools/telltale/lib/*.js` as functions with no side
  effects at require time, so tests can require them. `telltale.js` keeps the CLI and
  orchestration. Change 2 adds the `require.main === module` guard.
- **Privacy canary:** from change 3 onward, `node tools/telltale/test/canary-leak.js` must
  report zero hits. It is added to the integration task of every later change.

## 3. Per-change agent briefs

Each brief summarizes the scope. The authoritative content is the change folder
(`openspec/changes/<id>/`): proposal, design, specs, and tasks.

### 3.1 `spec-sync-v06-v13` (W1)
- **Scope:** spec and docs only. Back-fill surviving v06-v13 behavior (tiers, check-stub
  portability contract, trend/compare, watch rollup, pack, non-goals, install contract).
  Make the collector requirement abstract, and turn ETW from "never" into "opt-in, admin,
  disclosed". Replace stale "v0.6 deferrals" blocks and purpose lines with a dated
  Deferred section. Archive v09 and v13 with `--skip-specs` after moving their open items.
  Record the v08 review. Add archive gates to `config.yaml`.
- **Files:** `openspec/specs/*/spec.md` (direct edits only for Purpose and Deferred
  sections), `openspec/config.yaml`, `openspec/changes/telltale-v09|v13/`,
  `openspec/changes/archive/2026-10-07-telltale-v08/tasks.md`, `README.md` (prerequisites
  and contract wording only), `openspec/explorations/orders-framework.md` and `ontology.md`
  (mark the correlation and culprit-formula claims as not implemented).
- **Done when:** `openspec validate --all --strict` passes, `openspec list` shows no
  zombie changes, and every scenario in the delta holds against the current code (each is
  verified by a stated command).

### 3.2 `fix-report-integrity` (W1)
- **Scope:** test harness. Anonymize values before serialization, plus a post-write
  parse-back self-check. Readers (pack, trend, renderers) report unreadable files.
  Schema v2 and changelog. Append-only incremental persistence with an "unfinished"
  marker. Wall-clock time per sample. Rates over the observed window. Null-not-zero.
  Self-exclusion of the tool's own process tree. Event-log windowing and provider filter.
  WER window labels. Wall-clock watch duration. No silent duration clamp. Effective
  settings with source. Recompute with recorded thresholds. Honest "not recorded" scope
  wording. Fix the print-view unknown-power bug. Regenerate the shipped sample from a
  synthetic fixture.
- **Files:** `tools/telltale/telltale.js`, new `tools/telltale/lib/{serialize,anonymize,timebase,persist,events}.js`,
  `trend.js`, `render-print.js`, `render-charts.js` (reader only), `SCHEMA-CHANGELOG.md`,
  new `tools/telltale/test/**`, `reports/sample-telltale.*`.
- **Done when:** a 30 s `--anonymize` trace parses. Killing a trace mid-run leaves a
  parseable stream marked unfinished. A 20 s trace on a loaded box reports a rate over the
  real window. Pack and trend print the name of any unreadable file. All tests pass.

### 3.3 `software-inventory-and-scope` (W2)
- **Scope:** `inventory` mode writes a local-only artifact outside the shareable set.
  User-authored scope file with provenance. Exact-name match semantics, descendants
  opt-in. Always-monitored system set. One resolver for every mode and output. Every datum
  that names a process passes through the resolver before it is written or printed
  (hung-window lists, event text, docker/WSL text, GPU maps, console, logs). Out-of-scope
  load as anonymous aggregates at every hang. Scope declaration first in MD and print.
  Remove the `hide` config default, retire `--hide/--focus/--extras`, never persist raw
  command lines, and add the canary test. Update `persona-it.md` with the non-goal.
- **Files:** new `tools/telltale/lib/scope.js`, `telltale.js` (every enumeration and output
  site), `telltale.config.json`, `elevated-trace.bat`, `render-print.js` (scope block only),
  `README.md`, `openspec/explorations/persona-it.md`, new `tools/telltale/test/canary-leak.js`.
- **Done when:** the canary test reports zero hits for trace, watch, inventory, pack, MD,
  print, console, and log. A scoped run with nothing in scope still records out-of-scope
  aggregates at every hang. `--hide` exits with a migration message.

### 3.4 `system-profile-for-it` (W2)
- **Scope:** static facts collected once per run. Each fact is
  `{value | null, unit?, source, tier, asOf, unavailableReason?}`. Fix the serial bug.
  Report physical cores vs logical processors correctly. Facts: firmware, memory modules,
  storage, GPU and driver, pagefile configuration, power plan name and mode, battery
  health, VBS, virtualization platform versions, security products, domain/MDM join.
- **Files:** new `tools/telltale/lib/system-profile.js`, one call site in `telltale.js`,
  the console summary line, tests with canned outputs.
- **Done when:** an unelevated run on the reference laptop fills every user-tier fact or
  gives a reason. `test/system-profile.test.js` passes on canned outputs.

### 3.5 `sampling-engine-and-provenance` (W3)
- **Scope:** replace the spawn-a-shell-per-tick bundle with a long-lived sampler that has
  no per-tick process launches beyond the hang probe. Achieved cadence is recorded and
  gaps are written as unobserved intervals. Heavy collectors run on trigger within a
  budget, replacing the "melting" gate. Observer CPU, commit, and I/O are measured. Long
  capture (hours). Key-press marks are captured without being blocked by collection.
  Collector registration interface for changes 6 and 7. Per-value provenance (unit,
  window, n, source, measuredAt, precision). Locale-independent parsing.
- **Files:** new `tools/telltale/lib/sampler/*.js`, `telltale.js` trace and watch loops,
  `COLLECTORS` registry migration, tests.
- **Done when:** on a loaded box a 120 s trace achieves at most 2.5 s median cadence for the
  continuous tier, records gaps, and records observer cost. A 2-hour capture stays within
  the declared overhead budget.

### 3.6 `data-signals-completeness` (W4)
- **Scope:** collect per-process CPU % (machine-normalized) and disk I/O for in-scope
  groups, the system set, and the out-of-scope aggregate. Temperature time series
  (unelevated where exposed, labelled, implausible values dropped). Turbo-aware
  performance %, performance-limit %, and throttle reasons. Battery % parser fix, AC/battery
  transitions with as-of time, power-mode overlay and Energy Saver. Commit bytes and
  commit limit. Pages in/out and pagefile %. Disk latency (ms), queue, busy %, and
  throughput. Aggregate network and VPN-adapter presence. GPU utilization and VRAM when
  exposed, at bounded cost. Defender/AV CPU normalized. System handle count. Remove the
  EcoQoS batch.
- **Files:** `tools/telltale/lib/collectors/*.js` (registered through change 5's interface),
  `telltale.js` (registration only), tests with canned outputs.
- **Done when:** a trace on the reference laptop shows every signal as a time series or
  null with a reason. Battery % is numeric on a laptop. AV CPU is at most 100.

### 3.7 `workload-session-and-containers` (W4)
- **Scope:** user phase tags (start, stop, label) via key and flag. Lifecycle markers for
  in-scope process start/exit and container start/stop. Per-container CPU/memory time
  series for in-scope containers. WSL2 VM memory cap and guest memory where visible.
  Opt-in workload latency probe declared in the scope file (timing only, output
  discarded). Opt-in workload configuration facts (Postgres memory settings, configured
  WSL memory cap). Idle-vs-loaded comparison in the run summary.
- **Files:** new `tools/telltale/lib/workload/*.js`, scope-file schema extension
  (`probes`, `config`), tests.
- **Done when:** with Docker Desktop running a Postgres container in scope, a trace records
  container stats over time, start/stop markers, and a latency series. Without Docker,
  every one of these is null with a reason.

### 3.8 `diagnosis-engine-rebuild` (W5)
- **Scope:** new `lib/diagnosis/` engine. Hang definition and confirmation (OS
  not-responding limited to in-scope, non-suspended processes; user marks within ±2 s).
  Precision/recall vs marks. Exclusion of observer-affected probes. Calm windows. Minimum n
  (at least 10 usable probes overall, at least 3 for "sustained"). Rule contract. Derived
  confidence. Evaluated disprovers. Evidence references to probe indices. Outside-scope
  cause. `undetermined` outcome. Headline finding from the leading cause. One vocabulary.
  Five migrated core rules (memory pressure at hang, CPU saturation, disk stall,
  security-software contention, observer guard). Remove cost v1, canned cause text, and
  the `reasons.length >= 2` STATE. The discriminator becomes an output of the ranking.
- **Files:** new `tools/telltale/lib/diagnosis/{engine,rules/*,vocabulary}.js`, `telltale.js`
  (replaces the verdict/rca/discriminator block), `render-print.js` (vocabulary only),
  `trend.js` (vocabulary only), tests with fixtures including the R03 sample case.
- **Done when:** the R03 sample fixture (0 hangs, commit 52-65%) yields "no freeze
  observed" with no memory label. The 13-08-14-like fixture yields memory pressure with
  derived confidence and evidence references. All tests pass.

### 3.9 `diagnosis-cause-rules` (W6)
- **Scope:** rules for commit-limit pressure, hard-fault thrash, VM memory dominance,
  database memory/I/O, single-process dominance/growth, thermal/power throttling,
  battery/power plan, DPC/ISR storm, and GPU contention. Each rule has fixture tests for
  fires, does-not-fire, and disproved. Rule-to-action mapping (cheapest first).
- **Files:** `tools/telltale/lib/diagnosis/rules/*.js`, `lib/diagnosis/actions.js`, tests.
- **Done when:** each rule has three passing fixture tests and appears in the ranked list
  with evidence references.

### 3.10 `report-and-visualization` (W6)
- **Scope:** fixed section order (scope, finding, actions, evidence and charts, system
  profile, gaps, appendix). Inline-SVG small-multiple charts on one wall-clock axis with
  hang, mark, workload, and AC/battery annotations, built at render time with no CDN, and
  shown in print/PDF. Display precision and units. Plain-language gaps. IT views drop
  developer-only rows. Formats: keep JSON, MD, `.report.html`, and `.email.txt`; remove
  legacy `.html` and fold `.charts.html` into `.report.html`. Ready-to-send email draft
  filled only from JSON, with an attachment manifest and hashes.
- **Files:** `render-print.js` (becomes the report renderer), new `lib/render/svg-charts.js`,
  new `lib/render/email.js`, `render-charts.js` (removed or kept as an alias), the MD writer
  in `telltale.js`, tests (HTML snapshot assertions and an email-from-fixture test).
- **Done when:** rendering the fixtures offline gives an HTML whose printed PDF contains the
  charts. The email draft contains only numbers present in the JSON (automated check).

## 4. Requirement ownership matrix (prevents archive conflicts)

Each existing requirement is MODIFIED or REMOVED by **at most one** change. "Unchanged"
means no change touches it. ADDED requirement names are unique per capability.

| Capability | Existing requirement (exact header) | Owner | Op |
|---|---|---|---|
| metrics | OS first-order bundle via no-admin collectors | spec-sync-v06-v13 | MODIFIED |
| metrics | OS healthy ranges and confounds recorded | — | unchanged |
| metrics | Power and backing-store alibis | data-signals-completeness | MODIFIED |
| metrics | App/process rollups with friendly names | data-signals-completeness | MODIFIED |
| metrics | Handles, threads, and tree snapshots (vNext — provisional: on-HANG tasklist + Private top groups ship now) | software-inventory-and-scope | REMOVED (replaced by ADDED "On-hang process snapshot within declared scope") |
| metrics | Hang events with explicit threshold parameter | fix-report-integrity | MODIFIED |
| metrics | Frozen share, MTTR, and user ground truth | fix-report-integrity | MODIFIED |
| metrics | Hang context windows and lagged correlation | fix-report-integrity | MODIFIED |
| metrics | Culprit attribution capped below certainty (vNext: exact 0.4/0.3/0.2/0.1 formula; now: provisional ranked RCA, conf capped 0.85) | diagnosis-engine-rebuild | REMOVED (moved to `diagnosis`) |
| metrics | Ordered RCA procedure with disprovers | diagnosis-engine-rebuild | REMOVED (moved to `diagnosis`) |
| metrics | Self-load accounting excluded from verdict | fix-report-integrity | MODIFIED |
| tracking | Watch mode light continuous loop | fix-report-integrity | MODIFIED |
| tracking | Trace mode deep bundles | fix-report-integrity | MODIFIED |
| tracking | Zero unknown process names | software-inventory-and-scope | MODIFIED |
| tracking | Power truth per sample | data-signals-completeness | MODIFIED |
| tracking | Calm-linked evidence alongside hang evidence | — | unchanged |
| tracking | WER AppHang history counts | fix-report-integrity | MODIFIED |
| tracking | OS-confirm via Responding poll | diagnosis-engine-rebuild | MODIFIED |
| tracking | User ground-truth marks | diagnosis-engine-rebuild | MODIFIED |
| evidence-surface | Evidence surface, never verdict-maker | diagnosis-engine-rebuild | MODIFIED |
| evidence-surface | Observe the machine with timestamps | fix-report-integrity | MODIFIED |
| evidence-surface | Number every metric | sampling-engine-and-provenance | MODIFIED |
| evidence-surface | Reason every number | — | unchanged |
| evidence-surface | Trace causes with ranked confidence, never certainty | diagnosis-engine-rebuild | MODIFIED |
| evidence-surface | First-order data is never overwritten by second-order computation | fix-report-integrity | MODIFIED |
| evidence-surface | Metric discipline on every metric | — | unchanged |
| evidence-surface | JSON is truth, MD and HTML are views | fix-report-integrity | MODIFIED |
| evidence-surface | Thresholds are recorded and provisional | — | unchanged |

New capabilities and their creators: `evidence-persistence` (fix-report-integrity), `scope`
(software-inventory-and-scope), `system-profile` (system-profile-for-it), `sampling`
(sampling-engine-and-provenance), `diagnosis` (diagnosis-engine-rebuild; extended by
diagnosis-cause-rules), `report-views` and `it-handoff` (report-and-visualization).

ADDED requirements in existing capabilities:
- `metrics`: spec-sync-v06-v13 (Capability-tiered collection; Portability contract check),
  fix-report-integrity (Every sample carries its measurement wall-clock time; Rates and
  shares use the observed window; Absent data is null with a reason),
  software-inventory-and-scope (On-hang process snapshot within declared scope),
  data-signals-completeness (see its spec), workload-session-and-containers (see its spec).
- `tracking`: spec-sync-v06-v13 (Multi-report trend and comparison; Approval pack
  assembly; Sustained watch rollup), fix-report-integrity (OS event records windowed to
  the run), workload-session-and-containers (Workload session phases; Workload lifecycle
  markers).
- `evidence-surface`: spec-sync-v06-v13 (Declared non-goals; Install and run contract).

Archive order must follow the waves. A later change's ADDED requirements may reference
earlier capabilities by name. None of them MODIFY a requirement created by another
change in this plan.

## 5. Open questions for the owner (agents use the recommended default unless overruled)

| # | Question | Recommended default (used by agents) | Affects |
|---|---|---|---|
| OQ-1 | What happens when no scope file exists? | Run in **open scope**, declared loudly: console banner and page 1 of every view say "OPEN SCOPE: names of all running software may appear in this report". The email draft repeats it. `record` (one-click) runs `inventory` first if no scope file exists and asks the user to save a scope, then proceeds. | 3, 10 |
| OQ-2 | Is there an always-monitored "system set" outside the user's choice? | Yes: OS components (System, Registry, Memory Compression, dwm, Search indexer, svchost grouped as "Windows services"), security products registered with the OS (Defender and similar), and virtualization hosts (vmmem/VmmemWSL). The set is fixed, published in the README, and listed in the scope declaration. User applications are never in it. | 3, 6, 8 |
| OQ-3 | Remove `--hide`, `--focus`, `--extras` outright? | Yes (**BREAKING**). Each flag exits with code 2 and a one-line migration message pointing to the scope file. The committed `"hide": "claude"` default is deleted. | 3 |
| OQ-4 | Keep the legacy `.html` output? | No. Remove it. `.report.html` (the print renderer, with inline charts) is the only HTML view. | 10 |
| OQ-5 | Persist command lines at all? | Never persist raw command lines. For in-scope processes, persist only a derived label (script base name, database name, container name) and the rule that produced it. | 3 |
| OQ-6 | Do scope entries include descendant processes? | Only when the entry says `includeDescendants: true`. The descendant set is fixed at process start (PID + creation time) to avoid PID reuse. | 3 |
| OQ-7 | May the tool run a user-declared workload command (e.g. a `select 1` round trip)? | Yes, opt-in, declared in the scope file. Timing only, output discarded, 5 s timeout, never run elevated. | 7 |
| OQ-8 | Network depth? | Aggregate throughput and errors per active adapter, plus VPN-adapter presence. No per-process network. | 6 |
| OQ-9 | Keep cost arithmetic? | Keep only measured cost (v2), only when at least 1 hang is observed, in the appendix. Never on page 1 or in the email. Remove v1. | 8, 10 |
| OQ-10 | Separate charts file? | No. Charts are inlined in `.report.html`. `--charts` stays as a deprecated alias of `--print` for one release. | 10 |
| OQ-11 | Default and maximum duration? | `trace` default stays 60 s, `record` default becomes 10 min, maximum 8 h. Any clamp is printed and recorded. | 2, 5 |
| OQ-12 | Keep a `STATE:` label? | Replace it with a "Finding" sentence and a leading cause class from the fixed vocabulary. The word "STATE" is dropped from all outputs. | 8, 10 |
| OQ-13 | Name registered security products in the system profile? | Yes. They are IT-installed and needed for the security-contention rule. | 4 |
| OQ-14 | Read old `telltale-json/1` reports? | `trend` reads v1 for the fields it shows and labels them "v1 (pre-fix; rates may be overstated)". `pack` and renderers require v2 and say so when given v1. | 2 |
| OQ-15 | Minimum-evidence thresholds? | At least 10 usable probes for any cause ranking, and at least 3 probes for "sustained". Below that the output is "insufficient evidence". | 8 |
| OQ-17 | Should `trace`/`record` write `.report.html` and `.email.txt` by default? | Yes. `--no-report` opts out. The email is a draft file only; the tool never sends anything. | 10 |
| OQ-18 | Keep the `--cost-*` flags? | `--cost-min` is deprecated (it assumed lost minutes). `--cost-rate` stays as an input to measured cost only. | 8 |
| OQ-16 | How should the shipped sample be produced? | Generate it from a synthetic, deterministic fixture (no real machine data), so it is valid and PII-free by construction. | 2 |

## 6. Traceability: every finding and recommendation

ID scheme. `R01-P0-1` = review 01, P0 item 1. `-REC-n` = numbered recommendation.
`R01-P1-3a..j` = rows of R01's P1-3 contradiction table, in order. `R02-M-n` = R02 §1
coverage-matrix rows not repeated in R02 §2. `R03-L3-n` = R03 §1 coherence findings.
`R03-ADD-n` = R03 §3 rule table rows. `R03-REM-n` = R03 §3 remove list.
`R03-V-n`/`R03-O-n` = R03 §4 required visuals and report order. Handoff notes
(R01-H*, R02-H*, R03-H*) restate findings; §6.4 maps each one to its primary ID.

"Tasks" lists the task numbers in the owning change's `tasks.md` that carry the ID tag.
Where two changes share an ID, the first one listed is primary.

### 6.1 R01: OpenSpec vs product intent

| ID | Finding / recommendation | Change | Tasks |
|---|---|---|---|
<!-- TRACE:R01 -->
| R01-P0-1 | Baseline inventory -> choose -> scoped re-run flow absent from every spec; "baseline" term collides | `software-inventory-and-scope` | software-inventory-and-scope: 1.1, 3.1, 3.2, 3.8 |
| R01-P0-2 | Scope disclosure unspecified; framing is redaction; committed hide default; receipts print hidden names; scope line trails culprit table | `software-inventory-and-scope` | software-inventory-and-scope: 3.4, 3.5, 3.6, 4.3, 5.2 |
| R01-P0-3 | No "cause lies outside declared scope" outcome; in/out-of-scope share at each hang missing | `software-inventory-and-scope`<br>`diagnosis-engine-rebuild` | software-inventory-and-scope: 1.5, 2.2, 4.2<br>diagnosis-engine-rebuild: 4.5 |
| R01-P0-4 | Specs frozen at v0.5; v06-v13 shipped without deltas; v08 unchecked review, zombie v09, v13 unreviewed | `spec-sync-v06-v13` | spec-sync-v06-v13: 1.1, 1.4, 1.5, 1.6, 1.7, 1.9, 3.2, 3.3, 3.4, 4.1 |
| R01-P1-1 | "Hang" never defined in user terms; precision/recall vs marks not computed; marks lack kind/note | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 2.1, 2.3, 2.5, 6.2 |
| R01-P1-2 | Diagnosis record undefined; RCA rows lack process attribution; STATE label can contradict cause class | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 1.3, 3.3, 5.2 |
| R01-P1-3a | Spec says throttle is an RCA candidate; code has none | `diagnosis-cause-rules`<br>`data-signals-completeness` | diagnosis-cause-rules: 5.1<br>data-signals-completeness: 2.1 |
| R01-P1-3b | Disprovers are prose; nothing is marked disproved | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 3.2 |
| R01-P1-3c | Memory candidate uses trace-wide committedPeak, not hang window | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 4.1 |
| R01-P1-3d | On-hang "process tree" spec contradicts its own vNext heading | `software-inventory-and-scope` | software-inventory-and-scope: 2.2 |
| R01-P1-3e | Confidence cap 0.85 heading vs 0.95 scenario | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 3.1 |
| R01-P1-3f | Spec bans ETW while --wpr ships | `spec-sync-v06-v13` | spec-sync-v06-v13: 1.2, 1.3 |
| R01-P1-3g | Stale "v0.6 deferrals" blocks | `spec-sync-v06-v13` | spec-sync-v06-v13: 2.3 |
| R01-P1-3h | README says dev preset excludes code; code includes code and playwright; --help omits both | `software-inventory-and-scope` | software-inventory-and-scope: 3.3, 4.3 |
| R01-P1-3i | Purpose cites registry v0.4 | `spec-sync-v06-v13` | spec-sync-v06-v13: 2.1 |
| R01-P1-3j | "Never collected" claim false; fallback name-matching under load changes scope semantics | `fix-report-integrity`<br>`software-inventory-and-scope` | fix-report-integrity: 9.5<br>software-inventory-and-scope: 1.3, 3.4 |
| R01-P1-4 | Signal coverage gaps: per-process CPU, GPU rule, temperature, disk latency/free/type, network, Docker/WSL | `data-signals-completeness`<br>`workload-session-and-containers`<br>`system-profile-for-it` | data-signals-completeness: 2.2, 3.3, 3.4, 4.1, 5.1, 7.1<br>workload-session-and-containers: 4.1, 4.2, 7.1<br>system-profile-for-it: 2.3, 5.1 |
| R01-P1-5 | Static IT facts unspecified (CPU in asset, cores/threads, GPU, RAM slots/speed, storage type, BIOS, pagefile, power plan, WSL/Docker limits, uptime) | `system-profile-for-it` | system-profile-for-it: 1.3, 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 4.1, 5.1 |
| R01-P1-6 | No workload session (phases, idle vs loaded); trace silently clamped to 300 s; watch has no probes; WSL cap unspecified | `workload-session-and-containers`<br>`fix-report-integrity`<br>`sampling-engine-and-provenance` | workload-session-and-containers: 1.1, 2.1, 2.2, 2.3, 4.3, 8.1<br>fix-report-integrity: 8.2, 8.3<br>sampling-engine-and-provenance: 5.1, 5.2, 7.2 |
| R01-P1-7 | No SHALL requires the IT deliverable / email to exist | `report-and-visualization` | report-and-visualization: 5.1 |
| R01-P1-8 | IT persona policy gate contradicts privacy intent; need non-goal; qualify "zero unknown names" to declared scope | `software-inventory-and-scope` | software-inventory-and-scope: 4.4 |
| R01-P2-1 | Specs over-specify collectors (API names) | `spec-sync-v06-v13`<br>`data-signals-completeness` | spec-sync-v06-v13: 1.1<br>data-signals-completeness: 6.2 |
| R01-P2-2 | Non-goals live outside specs | `spec-sync-v06-v13` | spec-sync-v06-v13: 1.8 |
| R01-P2-3 | Verdict creep: RAM-vs-reimage discriminator and upgrade $ need neutral vocabulary | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 5.5 |
| R01-P2-4 | Install/run contract has no requirement | `spec-sync-v06-v13` | spec-sync-v06-v13: 1.8 |
| R01-P2-5 | Config defaults drift (interval, anonymize); evidence-changing defaults not recorded with source | `fix-report-integrity` | fix-report-integrity: 8.2 |
| R01-P2-6 | Stale purpose lines ("Always-on") | `spec-sync-v06-v13` | spec-sync-v06-v13: 2.2 |
| R01-P2-7 | Responding scenario double negative | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 2.4 |
| R01-P2-8 | No stable requirement IDs; tasks cite rotting line numbers | `spec-sync-v06-v13` | spec-sync-v06-v13: 3.1 |
| R01-REC-1 | New capability `scope` (inventory local-only, allow-list with provenance, out-of-scope never persisted, declaration first, outside-scope cause, retire --hide) | `software-inventory-and-scope` | software-inventory-and-scope: 1.1, 3.1, 5.5, 5.6 |
| R01-REC-2 | New capability for system facts | `system-profile-for-it` | system-profile-for-it: 1.1, 3.2, 5.2, 5.4 |
| R01-REC-3 | Modify metrics: abstract collectors, add signals, fix contradictions, dated Deferred section, ETW opt-in | `spec-sync-v06-v13`<br>`data-signals-completeness` | spec-sync-v06-v13: 2.1, 2.3<br>data-signals-completeness: 6.2 |
| R01-REC-4 | Modify evidence-surface: hang definition, diagnosis record, STATE from cause class, non-goals | `diagnosis-engine-rebuild`<br>`spec-sync-v06-v13` | diagnosis-engine-rebuild: 5.2, 6.4<br>spec-sync-v06-v13: 1.8 |
| R01-REC-5 | Modify tracking: workload session, qualify zero-unknown, Responding wording, always-on purpose | `workload-session-and-containers`<br>`software-inventory-and-scope`<br>`diagnosis-engine-rebuild`<br>`spec-sync-v06-v13` | workload-session-and-containers: 2.1, 2.2, 8.4<br>software-inventory-and-scope: 4.4<br>diagnosis-engine-rebuild: 2.4<br>spec-sync-v06-v13: 2.2 |
| R01-REC-6 | New it-deliverable capability: paste-ready summary with no numbers absent from JSON | `report-and-visualization` | report-and-visualization: 4.4, 5.1, 5.2, 7.5 |
| R01-REC-7 | Process: back-fill v06-v13 deltas, close/split v09, re-review v08, archive gates in config.yaml | `spec-sync-v06-v13` | spec-sync-v06-v13: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2 |

### 6.2 R02: Data layer

| ID | Finding / recommendation | Change | Tasks |
|---|---|---|---|
<!-- TRACE:R02 -->
| R02-P0-1 | Anonymized reports are invalid JSON; pack/trend skip silently ($0 cost, "no trace") | `fix-report-integrity` | fix-report-integrity: 2.1, 2.2, 3.1, 11.2, 11.4 |
| R02-P0-2 | Scope not enforced at collection; out-of-scope names persisted (osHungWindows, melting snapshot, event 2004 text, docker/WSL strings, console/log, full cmdline enumeration) | `software-inventory-and-scope` | software-inventory-and-scope: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 4.1, 5.4 |
| R02-P0-3 | No per-process CPU or per-process disk I/O | `data-signals-completeness` | data-signals-completeness: 4.1, 4.3, 4.4, 7.2 |
| R02-P0-4 | No temperature time series; %maxFreq misses turbo-laptop throttling | `data-signals-completeness` | data-signals-completeness: 2.1, 2.2 |
| R02-P0-5 | Battery % always null (parser); check-stub states "desktop/no battery" on a laptop | `data-signals-completeness` | data-signals-completeness: 1.1, 1.4 |
| R02-P0-6 | Nothing persisted until run end; Ctrl+C / hang / reboot loses all | `fix-report-integrity` | fix-report-integrity: 4.1, 4.2, 4.3, 11.3 |
| R02-P0-7 | Timebase fictional under load; rates divided by nominal duration | `fix-report-integrity` | fix-report-integrity: 5.1, 5.2, 5.3, 11.2 |
| R02-P1-1 | OS-confirmation noise from suspended UWP apps; deferred polls copied onto earlier hangs | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 2.4, 6.3 |
| R02-P1-2 | Event-log reasons not time-bounded; "no events" recorded as timeout | `fix-report-integrity` | fix-report-integrity: 7.1, 7.2 |
| R02-P1-3 | Melting gate makes calm path dead code under load | `sampling-engine-and-provenance` | sampling-engine-and-provenance: 2.2, 3.3, 3.4, 7.1 |
| R02-P1-4 | Scoped at-hang culprits are top-3 overall then filtered | `software-inventory-and-scope` | software-inventory-and-scope: 2.2 |
| R02-P1-5 | No self-exclusion; tool labelled as top culprit | `fix-report-integrity` | fix-report-integrity: 6.1 |
| R02-P1-6 | EcoQoS collected post-trace but stored on hang rows | `data-signals-completeness` | data-signals-completeness: 6.1 |
| R02-P1-7 | WSL2 / Docker Desktop VM is a black box | `workload-session-and-containers` | workload-session-and-containers: 3.1, 4.1, 4.2, 4.3, 8.2 |
| R02-P1-8 | Defender CPU per-core scaled vs 20% threshold; observer-induced scanning unflagged | `data-signals-completeness`<br>`diagnosis-engine-rebuild` | data-signals-completeness: 4.2<br>diagnosis-engine-rebuild: 4.4 |
| R02-P1-9 | Trace capped at 300 s | `sampling-engine-and-provenance`<br>`fix-report-integrity` | sampling-engine-and-provenance: 5.1, 5.2, 7.2<br>fix-report-integrity: 8.2, 8.3 |
| R02-P1-10 | Scope semantics inconsistent (watch vs trace) and over-broad (substring, PPID closure, PID reuse) | `software-inventory-and-scope` | software-inventory-and-scope: 1.2, 1.3, 2.1 |
| R02-P1-11 | Command lines persisted with weak scrubbing | `software-inventory-and-scope`<br>`fix-report-integrity` | software-inventory-and-scope: 3.7<br>fix-report-integrity: 2.1 |
| R02-P1-12 | Static profile gaps; serial bug | `system-profile-for-it` | system-profile-for-it: 2.5, 4.1, 4.4, 5.1 |
| R02-P1-13 | Commit absolute bytes and commit limit not stored | `data-signals-completeness` | data-signals-completeness: 3.1 |
| R02-P1-14 | Per-value unit/window/n/collector contract not implemented; schema not bumped | `sampling-engine-and-provenance`<br>`fix-report-integrity` | sampling-engine-and-provenance: 1.1, 1.3, 6.2, 6.4<br>fix-report-integrity: 3.2, 3.3 |
| R02-P2-1 | GPU total never available; per-PID poll costs 11-16 s | `data-signals-completeness` | data-signals-completeness: 5.1, 5.2 |
| R02-P2-2 | No network signals; no handle/thread/GDI counts | `data-signals-completeness` | data-signals-completeness: 3.4, 3.5 |
| R02-P2-3 | Zero / Infinity defaults where null-with-reason is required | `fix-report-integrity` | fix-report-integrity: 5.4 |
| R02-P2-4 | False precision (15-decimal values) | `sampling-engine-and-provenance` | sampling-engine-and-provenance: 1.1, 6.2 |
| R02-P2-5 | Power state up to 30 s stale with no as-of time | `data-signals-completeness` | data-signals-completeness: 1.2 |
| R02-P2-6 | watch --watch-secs is iteration-counted (10 s became 33 s) | `fix-report-integrity` | fix-report-integrity: 8.1 |
| R02-P2-7 | --hide receipt lists exact matched exe names | `software-inventory-and-scope` | software-inventory-and-scope: 3.6 |
| R02-P2-8 | WER counts all-time, not per window | `fix-report-integrity` | fix-report-integrity: 7.3 |
| R02-P2-9 | DPC/interrupt % and standby/modified data collected but unused | `diagnosis-cause-rules`<br>`report-and-visualization` | diagnosis-cause-rules: 2.2, 6.1<br>report-and-visualization: 3.3 |
| R02-M-1 | Memory compression visible only when it ranks in top-N | `data-signals-completeness` | data-signals-completeness: 4.2 |
| R02-M-2 | OneDrive / Search indexer activity not sampled | `data-signals-completeness` | data-signals-completeness: 4.2 |
| R02-M-3 | Battery health only with admin and --sleep-study | `system-profile-for-it` | system-profile-for-it: 2.6, 3.1 |
| R02-M-4 | Power-mode overlay / Energy Saver invisible | `data-signals-completeness` | data-signals-completeness: 1.3 |
| R02-REC-1 | Scrub values before serializing; parse-back self-check; readers report unreadable files | `fix-report-integrity` | fix-report-integrity: 1.5, 2.3, 3.1 |
| R02-REC-2 | Scope as collection-time contract: one resolver, names pass resolver before store/print, aggregates only, canary test, local inventory | `software-inventory-and-scope` | software-inventory-and-scope: 1.4, 2.1, 4.1, 5.1, 5.4 |
| R02-REC-3 | Stream trace to disk incrementally; unfinished marker | `fix-report-integrity` | fix-report-integrity: 4.1, 4.2, 4.3 |
| R02-REC-4 | Fix timebase: measurement wall-clock, observed-window rates, unobserved intervals, marks not blocked | `fix-report-integrity`<br>`sampling-engine-and-provenance` | fix-report-integrity: 5.1, 5.2<br>sampling-engine-and-provenance: 3.1, 3.2, 5.3, 7.3 |
| R02-REC-5 | Split cheap continuous sampling from heavy on-trigger snapshots; measure/attribute/exclude observer; remove cap for cheap tier | `sampling-engine-and-provenance`<br>`fix-report-integrity` | sampling-engine-and-provenance: 2.1, 2.3, 3.1, 3.3, 4.1, 6.3, 7.1<br>fix-report-integrity: 6.1 |
| R02-REC-6 | Add per-process CPU/IO, temperature + throttle reason, performance % and limit %, commit bytes/limit, disk busy/throughput, power-mode flag, battery % | `data-signals-completeness` | data-signals-completeness: 1.3, 2.1, 2.3, 3.1, 3.3, 4.1, 7.1 |
| R02-REC-7 | Docker/WSL first-class: container time series, lifecycle markers, VM cap, guest memory | `workload-session-and-containers` | workload-session-and-containers: 3.1, 4.1, 4.3, 7.1, 8.1, 8.3 |
| R02-REC-8 | Repair misleading evidence: UWP not-responding, windowed events, normalized CPU, EcoQoS timestamp, top-N within scope | `diagnosis-engine-rebuild`<br>`fix-report-integrity`<br>`data-signals-completeness`<br>`software-inventory-and-scope` | diagnosis-engine-rebuild: 2.4, 4.6<br>fix-report-integrity: 7.1<br>data-signals-completeness: 4.1, 6.1<br>software-inventory-and-scope: 2.2 |
| R02-REC-9 | Implement per-value contract; bump schema | `sampling-engine-and-provenance`<br>`fix-report-integrity` | sampling-engine-and-provenance: 1.3, 6.1, 6.2, 6.4<br>fix-report-integrity: 3.2 |
| R02-REC-10 | Complete IT static profile with source and as-of | `system-profile-for-it` | system-profile-for-it: 1.2, 1.3, 2.9, 2.10, 3.1, 4.3, 5.3 |

### 6.3 R03: Inference and report

| ID | Finding / recommendation | Change | Tasks |
|---|---|---|---|
<!-- TRACE:R03 -->
| R03-P0-1 | Anonymized JSON invalid; renderers and trend break or skip | `fix-report-integrity` | fix-report-integrity: 2.2, 3.1, 11.2 |
| R03-P0-2 | STATE label overreaches: any two predicates, single-sample min-free, spike "sustained" paging, unwindowed 1002 | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 1.2, 2.6, 5.2, 5.3 |
| R03-P0-3 | RCA blames memory using trace-wide peak | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 1.2, 4.1 |
| R03-P0-4 | Hang ground truth asserted not validated; no workload-side latency | `diagnosis-engine-rebuild`<br>`workload-session-and-containers` | diagnosis-engine-rebuild: 2.1, 2.5, 6.2<br>workload-session-and-containers: 5.1, 5.2 |
| R03-P0-5 | Fabricated content: default cost $900 at 0 hangs, canned Docker/Playwright text, legacy HTML green, print "Battery" when unknown | `diagnosis-engine-rebuild`<br>`report-and-visualization`<br>`fix-report-integrity` | diagnosis-engine-rebuild: 5.3, 5.4, 5.7<br>report-and-visualization: 1.3, 4.3<br>fix-report-integrity: 9.3 |
| R03-P1-1 | No ready-to-send email / ticket artifact | `report-and-visualization` | report-and-visualization: 5.1, 7.5 |
| R03-P1-2 | Static profile collected but hidden; BIOS/GPU/disk/pagefile/battery health/cores/slots/WSL/Postgres never collected; cores vs threads mislabelled | `system-profile-for-it`<br>`report-and-visualization`<br>`workload-session-and-containers` | system-profile-for-it: 2.1, 2.2, 2.3, 2.7, 2.8, 4.1, 5.1<br>report-and-visualization: 1.6, 1.7<br>workload-session-and-containers: 4.3, 6.1 |
| R03-P1-3 | Charts cover 3 of 10+ series; no finding on charts page; CDN-dependent; print hides charts; no wall clock; marks/workload not shown | `report-and-visualization` | report-and-visualization: 3.1, 3.9, 3.10, 7.1, 7.2 |
| R03-P1-4 | Report order wrong for IT reader | `report-and-visualization` | report-and-visualization: 1.1, 1.2, 4.1, 4.2 |
| R03-P1-5 | Short traces decide the STATE; no minimum n | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 2.6 |
| R03-P1-6 | Taxonomy drift: four vocabularies across trace/pack/discriminator/RCA | `diagnosis-engine-rebuild`<br>`report-and-visualization` | diagnosis-engine-rebuild: 1.1, 5.6<br>report-and-visualization: 1.3, 2.3, 6.1 |
| R03-P1-7 | Thermal unreadable: unlabelled ACPI zones incl. 0.1 C; no user tier; not in inference | `data-signals-completeness`<br>`diagnosis-cause-rules` | data-signals-completeness: 2.2<br>diagnosis-cause-rules: 5.1 |
| R03-P2-1 | Unrounded numbers in MD and RCA strings | `report-and-visualization`<br>`sampling-engine-and-provenance` | report-and-visualization: 2.1<br>sampling-engine-and-provenance: 1.1 |
| R03-P2-2 | Raw shell errors in evidence ("docker is not recognized") | `report-and-visualization` | report-and-visualization: 1.8 |
| R03-P2-3 | winEvents "timeout" when there are zero events | `fix-report-integrity` | fix-report-integrity: 7.2 |
| R03-P2-4 | Duplicate verdict assignment line | `fix-report-integrity` | fix-report-integrity: 9.4 |
| R03-P2-5 | Pack windowS math mixes sample interval with probe cadence | `fix-report-integrity` | fix-report-integrity: 9.2 |
| R03-P2-6 | Warp flags disagree between print and MD | `report-and-visualization` | report-and-visualization: 2.2 |
| R03-P2-7 | EcoQoS map mostly unknown/denied; costs a compile | `data-signals-completeness` | data-signals-completeness: 6.1 |
| R03-P2-8 | Developer vocabulary in IT views (Warp, prover confound, loop lag) | `report-and-visualization` | report-and-visualization: 2.2 |
| R03-L3-1 | Three (four) parallel unconnected inferences: verdict, RCA, discriminator, pack taxonomy | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 1.1, 5.1, 5.5, 5.6 |
| R03-L3-2 | Signals dropped before inference: maxFreq, plug state, EcoQoS, osConfirmed, userMarks | `diagnosis-engine-rebuild`<br>`diagnosis-cause-rules` | diagnosis-engine-rebuild: 2.5<br>diagnosis-cause-rules: 1.1, 5.1, 5.2 |
| R03-L3-3 | Documented correlations and culprit-confidence formula never built; docs over-claim | `diagnosis-engine-rebuild`<br>`spec-sync-v06-v13` | diagnosis-engine-rebuild: 3.1, 5.8<br>spec-sync-v06-v13: 2.4 |
| R03-L3-4 | Drill-down half true: reasons are pre-formatted strings without probe references | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 1.3, 3.3 |
| R03-L3-5 | pages/sec counts image loads; tool's own spawns generate page-ins | `diagnosis-cause-rules`<br>`sampling-engine-and-provenance` | diagnosis-cause-rules: 2.2<br>sampling-engine-and-provenance: 4.1, 4.3 |
| R03-L3-6 | Pack recomputes discriminator with current CLI thresholds, not recorded ones | `fix-report-integrity` | fix-report-integrity: 9.1 |
| R03-L3-7 | Throttle disprover uses trace-wide min; ignored on battery; not an inference input | `diagnosis-cause-rules` | diagnosis-cause-rules: 5.1 |
| R03-ADD-1 | Rule: commit limit pressure | `diagnosis-cause-rules` | diagnosis-cause-rules: 2.1 |
| R03-ADD-2 | Rule: hard-fault thrash (real swap); needs pages output/sec | `diagnosis-cause-rules`<br>`data-signals-completeness` | diagnosis-cause-rules: 2.2<br>data-signals-completeness: 3.2 |
| R03-ADD-3 | Rule: Docker Desktop / WSL2 vmmem dominance with .wslconfig cap | `diagnosis-cause-rules`<br>`workload-session-and-containers` | diagnosis-cause-rules: 3.1<br>workload-session-and-containers: 4.3 |
| R03-ADD-4 | Rule: Postgres memory/IO with shared_buffers/work_mem | `diagnosis-cause-rules`<br>`workload-session-and-containers` | diagnosis-cause-rules: 3.2<br>workload-session-and-containers: 6.1 |
| R03-ADD-5 | Rule: one-process dominance / leak growth | `diagnosis-cause-rules` | diagnosis-cause-rules: 4.1 |
| R03-ADD-6 | Rule: AV / endpoint-security contention (normalized) | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 4.4 |
| R03-ADD-7 | Rule: thermal / power throttling at hang | `diagnosis-cause-rules` | diagnosis-cause-rules: 5.1 |
| R03-ADD-8 | Rule: battery saver / power plan, AC vs battery hang rate | `diagnosis-cause-rules` | diagnosis-cause-rules: 5.2 |
| R03-ADD-9 | Rule: disk stall at hang, sustained | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 4.3 |
| R03-ADD-10 | Rule: CPU saturation (cpuPct and queue per core) | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 4.2 |
| R03-ADD-11 | Rule: DPC/ISR storm | `diagnosis-cause-rules` | diagnosis-cause-rules: 6.1 |
| R03-ADD-12 | Rule: GPU contention | `diagnosis-cause-rules` | diagnosis-cause-rules: 6.2 |
| R03-ADD-13 | Rule: OS- or user-confirmed hang promotes proxy | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 2.5 |
| R03-ADD-14 | Rule: observer self-load guard excludes probes | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 2.2 |
| R03-REM-1 | Remove cost v1 everywhere; v2 only with hangs > 0, at the end | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 5.4 |
| R03-REM-2 | Remove loop-lag row from IT views | `report-and-visualization` | report-and-visualization: 2.2 |
| R03-REM-3 | Remove Warp/openspec rows and flags | `report-and-visualization` | report-and-visualization: 2.2 |
| R03-REM-4 | Remove legacy .html output | `report-and-visualization` | report-and-visualization: 4.3, 7.3 |
| R03-REM-5 | Remove EcoQoS batch unless it returns data | `data-signals-completeness` | data-signals-completeness: 6.1 |
| R03-REM-6 | Events 1002/1000/2004 not verdict input until windowed and provider-filtered | `fix-report-integrity`<br>`diagnosis-engine-rebuild` | fix-report-integrity: 7.1<br>diagnosis-engine-rebuild: 4.6 |
| R03-REM-7 | PRESSURED as a state on one predicate | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 5.3 |
| R03-REM-8 | Canned consequence sentence in cause | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 5.3 |
| R03-REC-1 | Anonymize object not string; regenerate sample; parse self-check | `fix-report-integrity` | fix-report-integrity: 1.4, 2.1, 2.2, 2.3, 10.1 |
| R03-REC-2 | Replace reasons>=2 STATE with per-hang rule engine; association wording; min n | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 2.6, 5.1, 5.2, 6.1 |
| R03-REC-3 | Exclude self-load probes from every rule | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 2.2 |
| R03-REC-4 | Window event-log queries; filter 2004 by provider | `fix-report-integrity` | fix-report-integrity: 7.1 |
| R03-REC-5 | Remove cost v1, canned text; fix legacy colour (delete legacy HTML); fix unknown->Battery | `diagnosis-engine-rebuild`<br>`report-and-visualization`<br>`fix-report-integrity` | diagnosis-engine-rebuild: 5.4<br>report-and-visualization: 4.3<br>fix-report-integrity: 9.3 |
| R03-REC-6 | osConfirmed and userMarks into inference as confirmation; "probe-only" otherwise | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 2.3, 2.5, 6.5 |
| R03-REC-7 | Add the §3 rules (AV-normalized, throttle-at-hang, AC vs BAT, DPC, vmmem/WSL, Postgres, dominance/growth, real swap) | `diagnosis-cause-rules`<br>`diagnosis-engine-rebuild` | diagnosis-cause-rules: 1.1, 1.2, 1.3, 7.1, 7.2, 8.2<br>diagnosis-engine-rebuild: 4.1, 4.2, 4.3, 4.4 |
| R03-REC-8 | System profile section in every view; collect BIOS/GPU/disk/pagefile/battery health/cores vs threads | `system-profile-for-it`<br>`report-and-visualization` | system-profile-for-it: 2.4, 2.5, 4.2, 4.4, 5.5<br>report-and-visualization: 1.6, 1.7 |
| R03-REC-9 | Workload latency probe for declared scope | `workload-session-and-containers` | workload-session-and-containers: 1.1, 1.2, 5.1, 5.2, 8.1 |
| R03-REC-10 | Email / ticket draft (.email.txt + copy block) | `report-and-visualization` | report-and-visualization: 5.1, 5.2, 5.5 |
| R03-REC-11 | Stacked small-multiple charts on wall-clock axis, inline SVG, finding on charts | `report-and-visualization` | report-and-visualization: 3.1, 3.10, 7.2 |
| R03-REC-12 | Scope declaration on page 1 of every view, including open scope | `software-inventory-and-scope`<br>`report-and-visualization` | software-inventory-and-scope: 3.5, 5.2, 5.3<br>report-and-visualization: 1.2, 5.3, 7.4 |
| R03-REC-13 | Reorder MD/print per §4 | `report-and-visualization` | report-and-visualization: 1.2, 4.1, 4.2 |
| R03-REC-14 | Remove/demote: legacy HTML, loop-lag, Warp, EcoQoS, PRESSURED, raw docker stderr, unrounded floats | `report-and-visualization`<br>`data-signals-completeness`<br>`diagnosis-engine-rebuild` | report-and-visualization: 1.8, 2.1, 2.2, 4.3<br>data-signals-completeness: 6.1<br>diagnosis-engine-rebuild: 5.3 |
| R03-REC-15 | One vocabulary across trace, pack, print, charts, trend | `diagnosis-engine-rebuild`<br>`report-and-visualization` | diagnosis-engine-rebuild: 1.1, 5.6<br>report-and-visualization: 1.3, 2.3, 6.1 |
| R03-V-1 | Chart: freeze strip (latency, marks, OS-confirmed, threshold) with shared hang bands | `report-and-visualization` | report-and-visualization: 3.2 |
| R03-V-2 | Chart: memory (used %, commit %, available MB, pagefile %, pages in/out) | `report-and-visualization` | report-and-visualization: 3.3 |
| R03-V-3 | Chart: CPU (total %, queue per core, AV CPU normalized, DPC+ISR %) | `report-and-visualization` | report-and-visualization: 3.4 |
| R03-V-4 | Chart: clock/thermal/power (performance %, AC/battery band, battery %, temperature or "not available") | `report-and-visualization` | report-and-visualization: 3.5 |
| R03-V-5 | Chart: disk (latency ms, queue) | `report-and-visualization` | report-and-visualization: 3.6 |
| R03-V-6 | Chart: GPU only if rule fires or data exists | `report-and-visualization` | report-and-visualization: 3.7 |
| R03-V-7 | Chart: top processes over time (stacked) | `report-and-visualization` | report-and-visualization: 3.8 |
| R03-V-8 | Workload annotations (start/stop) on charts | `report-and-visualization` | report-and-visualization: 3.9 |
| R03-O-1 | Order: header with asset, date, duration, tier, declared scope on page 1 | `report-and-visualization` | report-and-visualization: 1.2, 7.3 |
| R03-O-2 | Order: 3-line finding with confirmation, at-hang vs calm, not observed, confidence, strength | `report-and-visualization` | report-and-visualization: 1.3, 7.3 |
| R03-O-3 | Order: what IT can do, cheapest first, tied to rules | `report-and-visualization`<br>`diagnosis-cause-rules` | report-and-visualization: 1.4<br>diagnosis-cause-rules: 7.1 |
| R03-O-4 | Order: evidence (hang table at-hang vs calm per rule, charts) | `report-and-visualization` | report-and-visualization: 1.5 |
| R03-O-5 | Order: system profile | `report-and-visualization` | report-and-visualization: 1.6 |
| R03-O-6 | Order: gaps and receipts in plain words | `report-and-visualization` | report-and-visualization: 1.8, 5.3 |
| R03-O-7 | Order: appendix (culprit table, events windowed vs history, method, JSON name + hash) | `report-and-visualization` | report-and-visualization: 1.9, 5.4 |
| R03-O-8 | Order: ready-to-send message (.email.txt + copy block) | `report-and-visualization` | report-and-visualization: 5.1, 5.4, 5.5 |

### 6.3b Relocated open items from the zombie change `telltale-v09` (R01-P0-4)

| ID | Item | Change | Tasks |
|---|---|---|---|
<!-- TRACE:v09 -->
| v09-split | File split / module seams (lib/) with require.main guard | `fix-report-integrity` | fix-report-integrity: 1.1, 1.2, 1.3 |
| v09-locale | Invariant-culture (locale-independent) number parsing | `sampling-engine-and-provenance` | sampling-engine-and-provenance: 1.2 |
| v09-thresholds | Threshold citations applied to defaults or labelled provisional | `diagnosis-engine-rebuild` | diagnosis-engine-rebuild: 3.4 |

### 6.4 Handoff notes (restatements mapped to primary IDs)

| Handoff | Content | Primary ID(s) |
|---|---|---|
| R01-H02-1 | Verify out-of-scope never persisted on every path (watch, name-match fallback, GPU maps, docker, WER/AppHang/Responding lists, event excerpts) | R02-P0-2, R02-REC-2 |
| R01-H02-2 | Per-process CPU and network not collected; thermal admin-only; power sampled every 30 s | R02-P0-3, R02-P0-4, R02-P2-2, R02-P2-5 |
| R01-H02-3 | Hang proxy is a shell + runtime spawn; assess confounds, lighter probe | R01-P1-1, R03-P0-4, DEF-8 |
| R01-H02-4 | Memory RCA uses trace-wide committedPeak | R01-P1-3c, R03-P0-3 |
| R01-H02-5 | Asset block lacks CPU, GPU, storage type, BIOS, WSL/Docker limits | R01-P1-5, R02-P1-12 |
| R01-H03-1 | Scope declaration must lead; print shows mode only | R01-P0-2, R03-REC-12 |
| R01-H03-2 | RAM-BOUND fires on non-memory reasons; need cause-class mapping | R01-P1-2, R03-P0-2 |
| R01-H03-3 | RCA lacks process attribution, outside-scope cause, throttle/GPU candidates; disprovers prose | R01-P1-2, R01-P0-3, R01-P1-3a, R01-P1-3b, R03-ADD-12 |
| R01-H03-4 | Redaction receipts print hidden names | R01-P0-2, R02-P2-7 |
| R01-H03-5 | No paste-ready IT summary | R01-P1-7, R03-P1-1 |
| R01-H03-6 | Cost and discriminator need verdict-free wording | R01-P2-3, R03-REM-1 |
| R02-HS-1 | Spec promises unimplemented items (per-value contract, proc.cpu, Private at hang, tree, per-bucket WER, never zeros) | R02-P1-14, R02-P0-3, DEF-1, DEF-3, R02-P2-3 |
| R02-HS-2 | Need requirements: real timebase, crash-safe persistence, observer budget, scope before persistence/console, local inventory | R02-P0-7, R02-P0-6, R02-REC-5, R02-REC-2, R01-P0-1 |
| R02-HS-3 | Temperature and throttle need an unelevated series or null-with-reason | R02-P0-4 |
| R02-HS-4 | Cadence stated as achieved under load, gaps recorded | R02-REC-4, R02-P1-3 |
| R02-HS-5 | "Baseline" overloaded; rename one | R01-P0-1 (watch log renamed in fix-report-integrity; "inventory" in scope change) |
| R02-HR-1 | Rates and shares divided by nominal duration; pre/post windows mix timebases | R02-P0-7 |
| R02-HR-2 | osConfirmed unreliable | R02-P1-1 |
| R02-HR-3 | Event 1002 reason and events text can be days old | R02-P1-2, R03-REM-6 |
| R02-HR-4 | Throttle inference cannot fire on turbo laptops | R02-P0-4, R03-ADD-7 |
| R02-HR-5 | Defender alibi mis-scaled; observer causes part of it | R02-P1-8, R03-ADD-6 |
| R02-HR-6 | Counter values are post-stall (up to 14 s after the hang) | R02-REC-4, R02-REC-5 (measuredAt per value; diagnosis uses measuredAt) |
| R02-HR-7 | Discriminator and RAM verdict rest on WS + commit only | R02-P0-3, R03-L3-1 |
| R02-HR-8 | Top culprit can be the tool itself | R02-P1-5 |
| R02-HR-9 | Anonymized reports do not parse; renderer tests run on fixed input | R02-P0-1 |
| R03-HS-1 | Single-sample rule violated; add min-n and at-hang rule with sample as failing case | R03-P1-5, R03-P0-2 |
| R03-HS-2 | "JSON is truth" needs a scenario that parses anonymized JSON | R03-P0-1 |
| R03-HS-3 | Docs promise correlations and culprit formula | R03-L3-3, DEF-2 |
| R03-HS-4 | One STATE taxonomy, must name its rule | R03-P1-6, R01-P1-2 |
| R03-HS-5 | Requirements for email, static profile, scope on page 1, chart set, offline charts | R03-P1-1, R01-P1-5, R03-REC-12, R03-P1-3 |
| R03-HS-6 | Cost requires hangs > 0 and measured inputs | R03-REM-1 |
| R03-HD-1 | anon() corrupts JSON | R03-P0-1 |
| R03-HD-2 | Observer effect: measure tool self-cost per probe; long-lived session instead of spawn per probe | R02-REC-5, R03-L3-5 |
| R03-HD-3 | Add pages output/sec, pagefile deltas, commit bytes and limit | R03-ADD-2, R02-P1-13 |
| R03-HD-4 | Normalize Defender CPU; consider other endpoint security CPU | R02-P1-8 |
| R03-HD-5 | Keep %maxFreq at hang; user-tier temperature; filter and label ACPI zones | R02-P0-4, R03-P1-7, R03-L3-7 |
| R03-HD-6 | Event-log windowing and provider filters; zero-events mislabelled timeout | R02-P1-2, R03-P2-3 |
| R03-HD-7 | Missing static collectors (BIOS, video, physical disk, pagefile, processor cores, battery capacity, plan name, .wslconfig, Postgres settings) | R02-P1-12, R03-P1-2 |
| R03-HD-8 | osConfirmed/userMarks timestamped to probe for ±2 s join | R03-REC-6, R02-REC-4 |
| R03-HD-9 | Keep AC/battery transitions for chart bands | R02-P2-5, R03-V-4 |
| R03-HD-10 | Workload-side latency probes do not exist | R03-REC-9 |

### 6.5 Deferred items

| ID | Item | Why deferred | Revisit |
|---|---|---|---|
| DEF-1 | Per-process handles/threads/GDI counts and a full process-tree snapshot | Not needed by any of the 14 cause rules. The system-wide handle count is collected (data-signals-completeness). Tree capture conflicts with the scope minimization rule. | After diagnosis-cause-rules, if a handle-leak rule is proposed |
| DEF-2 | Lagged Pearson/Spearman hang correlation and the 0.4/0.3/0.2/0.1 culprit-confidence formula | Replaced by the derived at-hang vs calm confidence in `diagnosis`. Docs are corrected by spec-sync-v06-v13. | When ≥ 30 hangs per run are common enough for correlation to have power |
| DEF-3 | Per-fault-bucket WER grouping | WER counts are labelled history with their window (fix-report-integrity). Bucket grouping adds no evidence for the in-run diagnosis. | With a crash-focused rule |
| DEF-4 | Rendering the watch log as charts/views | The trace report is the IT deliverable. Watch rollup stays a JSON/console output. | After report-and-visualization ships the chart engine (reusable) |
| DEF-5 | Fleet percentiles and helpdesk ticket linkage (persona-it Should/Could) | Conflicts with the non-goal "no fleet service". | Owner decision only |
| DEF-6 | macOS/Linux collectors | Windows-only today. The contract stub is kept (spec-sync-v06-v13 "Portability contract check"). | Separate port initiative |
| DEF-7 | Per-process network attribution | OQ-8 default: aggregate only | If a network-bound rule is needed |
| DEF-8 | UI-responsiveness probe (window message round trip) as a second hang proxy | The workload latency probe (workload-session-and-containers) and user marks give validation for now. A UI probe needs a window-owning helper. | After proxy precision/recall data exists from real runs |
