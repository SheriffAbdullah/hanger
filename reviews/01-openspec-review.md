# Review 01: OpenSpec vs. product intent

Reviewer lane: spec correctness, completeness, and structure. Data collection mechanics belong to reviewer 02, and report/output/inference hierarchy to reviewer 03. Handoffs to both are at the end.
Scope reviewed: `openspec/specs/*` (3 capability specs), `openspec/changes/**` (2 active and 7 archived changes), `openspec/config.yaml`, `README.md`, `USER_PROBLEM.md`, `PRODUCT_MANIFESTO.md`, `METRIC_REGISTRY.md`, `hanger.config.json`, and the persona explorations. I spot-checked the code at the abstraction level in `tools/hanger/hanger.js` and `render-print.js`.
Baseline: commit `e2bacca` (main, clean).

## Verdict in one paragraph

The specs describe the product as it was at v0.5 (a hang-evidence surface with metric discipline), and they describe it well: the SHALLs are well-formed, the scenarios are concrete, and the "numbers + reasons + confidence, never verdicts" stance is strong. They do **not** describe the product the owner now wants. The owner's privacy model is a **baseline inventory, then a user-chosen allow-list, then a scoped re-run with the scope declared in the report**. No spec mentions it. What exists is spread across change proposals and code (`--only`, `--preset`, `--hide`, `--focus`, `--extras`), and it is framed as *redaction*, which is the model the owner explicitly rejected. Six changes (v06 to v13) were implemented and five were archived **without a single spec delta**. As a result, scope, GPU, the asset/IT facts block, the pack/IT deliverable, the presentation renderers, the weight policy, and cannot-observe evidence are all unspecified. Several existing spec claims are stale or contradicted by the code. The hang-diagnosis goal is specified as a ranked-cause procedure, but the spec never defines what a "hang" *is* to the user, and RCA cannot represent "the cause is outside your declared scope". That last gap is the one that makes scoping either honest or dishonest.

---

## P0: blocks the stated product intent

### P0-1. The baseline → choose → scoped re-run flow is absent from every spec
- `openspec/specs/*`: zero occurrences of scope, allow-list, inventory, or `--only`. In the specs, "baseline" means the **watch-mode time series** (`tracking/spec.md:4,8,13,71,101`), not a software/process inventory. This terminology collision will cause misreads. The owner's "baseline report" and the spec's "JSONL baseline" are different things.
- The flow exists only as an implementation fragment:
  - the allow-list in v08 tasks (`openspec/changes/archive/2026-10-07-hanger-v08/tasks.md:6`)
  - the presets in v10 (`.../hanger-v10/proposal.md:15-16`)
  - code at `hanger.js:342-363` and `410-417`
- No mode produces an **inventory of all running software/processes for the user to choose from**. `watch` keeps the top 3 groups (`hanger.js:1008`), and an open-scope trace writes top culprits into a report that is meant to be shared. The only "choice" UX is a yes/no "monitor extra processes?" prompt (`hanger.js:1042`), which is focus/collapse rather than scope selection.
- The specs never state that the inventory output is **private and local** (for the user's eyes, not part of the IT pack) while the scoped report **is** the shareable artifact. Today the open-scope report and the scoped report are the same artifact type, in the same `reports/` folder, with the same renderers.
- **Required:** a new capability spec, for example `scope`, with requirements for: (1) an inventory run and its local-only status; (2) a user-authored allow-list persisted with provenance (flag, config, or preset); (3) a scoped run that never *persists or emits* out-of-scope per-process identity; (4) a scope declaration rendered up front in every shareable view.

### P0-2. Scope disclosure in the report is not specified, and the current framing is redaction
- The owner's model is that nothing is hidden and the scope is declared. The repo's model is redaction plus receipts:
  - v08 proposal `:6-7,15-18` says "packs leak unsanctioned tools (Claude, personal apps)" and introduces "--hide ... drops matches".
  - v09 proposal `:18-19` adds "Redaction trust: per-hidden-name MB + sha1 filter fingerprint".
  - README `:31` ranks "allowlist (uncollected) beats redaction (hidden)" but keeps both.
- `hanger.config.json:3` ships **`"hide": "claude"` as a committed default**. Every run is therefore a redacted run unless the user notices.
- Redaction does not even achieve privacy. The receipts write the hidden pattern and per-name rows into the JSON and MD (`hanger.js:1568-1570`, `1624`), so `--hide claude` prints "claude" in the report. The 12-hex SHA1 of a short pattern list (`:1570`) can be reversed with a dictionary. The result is both "hidden" and "disclosed", which satisfies neither the user nor IT.
- In the MD view the scope line sits *after* the culprit table (`hanger.js:1626`), under the heading "What is consuming RAM (named, no unknowns)" (`:1619`). A scoped table titled as a complete picture is the exact misreading the owner wants to avoid.
- **Required:** a spec SHALL that every shareable view opens with a **Scope declaration**: the allow-list as authored, how it was matched, how many processes and groups were out of scope, and their aggregate resource share. It must also state that per-process identity outside scope was not recorded. Retire `--hide` from the spec (or mark it deprecated and non-shareable), and remove the committed `hide` default.

### P0-3. Scoped diagnosis can silently misattribute, and the spec has no "cause lies outside declared scope" outcome
- This is the ethical hinge. Suppose the user scopes to Postgres/Docker while out-of-scope software is what fills RAM. The report must still say *"the stall coincided with X GB / Y% CPU held by processes outside your declared scope"*. Otherwise the scoped report blames Docker for someone else's load, and IT is misled by omission.
- Nothing in the specs requires this. RCA (`metrics/spec.md:89-96`, `evidence-surface/spec.md:58-67`) ranks causes among the culprits it can see. In code, the per-hang record carries only an out-of-scope *group count* (`hanger.js:1171`), the out-of-scope MB exists only at the end snapshot (`:1381`, `:1566`), and RCA candidates have no out-of-scope term (`:1479-1492`).
- System-wide totals (commit %, CPU %, paging, disk) are unscoped by nature. The spec should say so explicitly and require **in-scope vs. out-of-scope share at each hang** as first-class evidence.
- **Required:** a requirement and scenario covering this case: given a scoped run and a hang where in-scope groups hold less than N% of commit, RCA ranks "load outside declared scope" as a candidate with its aggregate numbers, and the report says so in plain words.

### P0-4. Specs are frozen at v0.5; six shipped changes added no spec deltas
- None of the changes has a `specs/` delta folder. All are `proposal.md` + `tasks.md` only (see `openspec/changes/**`). Archiving therefore merged nothing. `config.yaml` declares `schema: spec-driven` (`:1`), but the workflow is proposal-driven.
- Shipped, but no spec requirement exists for:
  - weight policy / auto-degrade and cannot-observe `collection.failures[]` (v07)
  - drill-down app labels and scope/redaction/focus (v08)
  - presets, trend, and the JSON schema freeze (v10)
  - per-process GPU (v11)
  - asset block, cost v2, rollup, RAM-vs-reimage discriminator, and `pack` (v12)
  - printable and chart renderers (v13)
- Process breaches:
  - v08 was archived with `- [ ] Review; archive` unchecked (`.../v08/tasks.md:10`).
  - v09 is still "active", but its items say "absorbed: v10" (`hanger-v09/tasks.md:3-7`) and two remain open. It is a zombie change.
  - v13 is active with review unchecked (`hanger-v13/tasks.md:7`).
- **Required:** a spec-sync change that back-fills deltas for v06 to v13 (ADDED/MODIFIED/REMOVED), closes v09 (split its two open items into a new change), and adds a rule to `config.yaml` that a change cannot be archived without spec deltas and a checked review task.

---

## P1: correctness, completeness, and truthfulness

### P1-1. "Hang" is never defined in user terms
- `metrics/spec.md:57` defines `hang.count` as "probes with `probes.ms >= HANG_MS`" but never says what is probed. In code, the probe is wall time to spawn `node -e ""` through a shell every 2s (`hanger.js:1137-1139`).
- That is a reasonable proxy for "the machine is stalling", but it is not "my terminal/IDE/Postgres client froze". It is sensitive to AV-on-spawn and disk contention more than to UI responsiveness. The spec should name the proxy, state its validity limits, and require proxy validation against user marks.
- Precision/recall against `user.marks[]` *is* specified (`metrics/spec.md:65`), but it is not computed anywhere (no precision/recall in code), and marks carry no `hung|fine` kind or note (`hanger.js:1116-1120`), despite `tracking/spec.md:100-109`.
- **Required:** a "Hang definition" requirement covering the proxy, threshold, what the proxy cannot see, and a scenario in which marks are joined and precision/recall are reported with n.

### P1-2. "Exactly why it hangs" and "never certainty" are not reconciled
- The owner asks for *exactly* why. The specs forbid certainty (`evidence-surface/spec.md:58-67`). Both positions are defensible, but the spec must define what "a diagnosis" means as a testable output. A good candidate is: per hang, one **leading resource class** (memory / CPU / disk / thermal-power / GPU / outside-scope / undetermined), the **named in-scope process(es)** with deltas, a confidence, and the disprovers that were checked.
- Today the ranked RCA rows carry no process attribution at all (`hanger.js:1485-1489`). The "culprit" lives in a separate end-of-run table.
- The STATE label can contradict the cause class. `RAM-BOUND` fires on *any* two reasons (`hanger.js:1451-1452`), including "disk stall" + "N STALL events", neither of which is RAM. `evidence-surface/spec.md:10-19` constrains the label's *scope suffix* but not its *semantics*.
- **Required:** a requirement that the STATE label is derived from the leading RCA cause class, with a scenario covering two non-memory reasons, plus a per-hang diagnosis-record schema at the abstraction level.

### P1-3. Spec claims that the code contradicts
| Spec claim | Reality |
|---|---|
| Throttling is listed as a competing cause when `%maxFreq<60` on AC (`metrics/spec.md:30-36`) | RCA has no throttle/thermal candidate (`hanger.js:1485-1489`) |
| RAM cause is "marked disproved", and a disproved check excludes its cause (`metrics/spec.md:89-96`) | Disprovers are prose strings; nothing is ever marked disproved |
| Correlation uses same-window evidence (`evidence-surface/spec.md:60`) | The memory candidate fires on the *trace-wide* `committedPeak` (`hanger.js:1482`), not the hang window |
| On-HANG snapshot includes the "process tree" (`metrics/spec.md:53`) | The same requirement's heading says tree is vNext (`:47-48`). The spec contradicts itself |
| Confidence capped at 0.85 (`metrics/spec.md:81` heading) | The scenario says "at most 0.95" (`:86`). Internal contradiction (code uses 0.85) |
| Never invokes ETW sessions (`metrics/spec.md:18`) | `--wpr` ETW capture shipped in v06 (`.../v06/tasks.md:6,8`) |
| "v0.6 deferrals ... land in v0.6" (`metrics/spec.md:106-107`, `tracking/spec.md:110-111`) | v0.6 shipped. Handles/threads/tree, correlation, weighted formula, per-bucket WER, and mark kinds are still not done. The deferral notes are stale |
| `--preset dev` excludes `code` (README `:29-30`) | The dev list includes `code` and `playwright` (`hanger.js:413`), and `--help` omits both (`:194`) |
| Purpose cites "registry v0.4" (`metrics/spec.md:4`) | Code is v13 |
| Allow-list "never collected" (code comment `hanger.js:319-320`, v08 `:6`, MD `:1626`) | All processes and command lines are enumerated, then filtered (`:326`). The honest claim is "never persisted/emitted". Under load, scope falls back to name-substring matching (`:1168`), which changes scope semantics mid-run |

### P1-4. Signal coverage vs. the owner's list
| Signal | In spec? | Notes |
|---|---|---|
| RAM / commit / paging | Yes (`metrics/spec.md:8-28`) | Good |
| CPU total, queue | Yes | **Per-process CPU missing.** It is in the registry (`METRIC_REGISTRY.md:33`) but has no SHALL and is not implemented |
| GPU | Only as a word in `evidence-surface/spec.md:30` | v11 per-process GPU shipped with no spec. The "if relevant" condition needs a rule (e.g. record availability; attribute only when the counters exist) |
| Temperature | **No** | Code: admin-only thermal zone (`hanger.js:936-939`) + nvidia GPU temp (`:895`). Thermal is the most-requested laptop signal and has no requirement, no non-admin path, and no "unavailable + reason" scenario |
| Plugged-in / battery | Yes (`tracking/spec.md:53-60`) | Good. The best-specified signal |
| Disk | Partial (queue only, `metrics/spec.md:8`) | Disk latency, free space, and drive type are not in specs |
| Network | **No** | Deferred in v05 (`.../v05/proposal.md:35`), never revisited. Needed at least for Docker pulls and DB-over-network stalls. Either specify it or list it as a non-goal |
| Docker/WSL | Only "docker state best-effort" (`metrics/spec.md:54`) | Per-container memory/CPU and the WSL VM memory ceiling are not specified (see P1-6) |
| Events (AppHang/WER) | Yes (`tracking/spec.md:74-98`) | Good |

### P1-5. Static IT facts are unspecified
- The v12 asset block (manufacturer, model, serial, RAM fitted, disk free, OS caption/build, warranty) plus `machine.cpuModel`/cores (`hanger.js:482-534`, `1526`) exist without a requirement.
- Missing from both spec and code for an IT audience: **CPU model in the asset block** (it lives in a separate `machine` object), core/thread count, **GPU model(s)**, RAM speed/slots/upgradeability, storage type (SSD/HDD/NVMe) and capacity, BIOS/firmware version, pagefile configuration, active power plan, Docker/WSL resource limits, and uptime since last boot (present but unspecified).
- **Required:** a "System facts" requirement listing the datum set at the abstraction level, with "unknown + reason, never blank" (already the code's behavior) as a scenario.

### P1-6. The workload-driving story is not specified
- The intent is to run the tool *while* Postgres/Docker reproduce the hang. The specs have no notion of a **capture session tied to a workload**: nothing for naming or tagging the workload phase, marking start and stop of "docker compose up" / "load test", or comparing idle vs. loaded.
- These pieces exist only as v12 `trend --windows` / `--compare` (`.../v12/proposal.md:15`) and persona-developer P2 (`persona-developer.md:65`).
- Trace duration is silently clamped to 10-300s (`hanger.js:25`). An intermittent hang under a long-running workload may not reproduce in 5 minutes. The specs say nothing about duration limits, and `watch` (unbounded) has no hang probes (`tracking/spec.md:14`).
- Workload-specific facts that decide Docker hangs are unspecified: the WSL2/VM memory cap and per-container memory. vmmem is treated only as an aggregate label.
- **Required:** a "Workload session" requirement: tagged phases, minimum/maximum duration stated in the report, and an idle-vs-loaded comparison scenario.

### P1-7. The IT deliverable (email/report) is not specified
- The owner's pain point is "draft an email for IT". There is no requirement for an IT-ready summary: a short plain-text or MD block (subject, machine facts, declared scope, N hangs, leading cause, attached files) that the user can paste.
- `pack` (v12) and `render-print.js` (v13) are close to this, but no spec governs them, and there is no "email body" artifact. Cross-lane: reviewer 03 owns its shape. This lane flags that **no SHALL requires the deliverable to exist**.

### P1-8. Tension between the IT persona and the privacy intent is unresolved
- `persona-it.md:27` treats "unsanctioned/unsigned binaries buried instead of flagged" as an *instant reject*, and `:33` wants a "Policy gate: signature/allowlist check". That directly opposes the owner's intent.
- The spec needs an explicit **non-goal**: Hanger is the *user's* evidence tool, not a compliance or software-inventory scanner for IT. The legitimacy comes from *declared* scope plus out-of-scope *aggregate* disclosure (P0-3), not from enumerating everything.
- The `tracking/spec.md:35-51` "zero unknown process names" requirement should be qualified as "within declared scope".

---

## P2: structure, hygiene, over-specification

1. **Over-specified collectors.** Specs name `Get-Counter`, `tasklist`, `powercfg`, `MsMpEng*`, `Get-Process PM`, and `wmic` (`metrics/spec.md:8,18-19,39`). By the owner's own standard (datum, not API), this belongs in `METRIC_REGISTRY.md` or design notes. The spec should keep "no admin required for the core set" and "the monitor's own cost is accounted" as abstract SHALLs.
2. **Non-goals live outside the specs.** They are in `USER_PROBLEM.md:22-24`, `PRODUCT_MANIFESTO.md:3-6`, and v05 `:48-50`. Add them to `evidence-surface`: no purchase verdict; no compliance scanning; no fleet SaaS; no remote upload; Windows-only today (macOS/Linux as a contract stub only).
3. **Verdict creep.** v12 adds "RAM upgrade $ vs laptop replace $" and a "RAM-vs-reimage discriminator" (`.../v12/proposal.md:13-19`). The manifesto says "does NOT say buy 32GB" (`PRODUCT_MANIFESTO.md:5`). The specs only cover cost as "derived context" (`evidence-surface/spec.md:21-26`). Specify the discriminator's output vocabulary so it cannot read as a recommendation.
4. **Install/run contract.** "Install once" has no requirement. README covers it (Node 18+, no deps, no admin, `README.md:8-11`), but the spec should state prerequisites, the no-admin core, and the admin-tier upgrades (tiering is in `USER_PROBLEM.md:29-32` and v06, not in specs).
5. **Config defaults drift.** `hanger.config.json` sets `interval: 500` and `anonymize: true` while the code default is 1000 (`hanger.js:28`). Defaults that change evidence (anonymize, hide, preset, interval) should be recorded in the report with their source. `DURATION_SRC` exists for duration only (`:27`).
6. **Purpose lines are stale.** `evidence-surface/spec.md:4` is fine. `tracking/spec.md:4` says "Always-on", but nothing is always-on (watch is user-started; no service). Either reword it or specify a background/service mode.
7. **Scenario quality nit.** `tracking/spec.md:92` reads "WHEN the `Responding==false` poll returns false", which is a double negative that inverts meaning on a quick read. Rewrite as "WHEN the process reports not-responding".
8. **Traceability.** Requirements have no IDs, and tasks cite line numbers (`.../v05/tasks.md:6-7`) that rot. Give requirements stable IDs (e.g. `SCOPE-01`) and reference them from tasks.

---

## Recommended spec changes (not applied)

1. **New capability `scope`** (closes P0-1 to P0-3, P1-8):
   - `Inventory run is local-only`: an inventory lists all running software and process groups with friendly names, is written outside the shareable pack, and is never embedded in a shareable view.
   - `User-declared allow-list`: the allow-list is authored by the user (or a named preset), persisted with provenance, and has defined match semantics (exact group or friendly name plus descendants). A scenario covers fallback matching under load being *reported*.
   - `Out-of-scope identity is never persisted`: out-of-scope per-process names, PIDs, command lines, and per-process GPU/CPU never appear in JSON, MD, or HTML. Only aggregates appear.
   - `Scope declaration leads every shareable view`: allow-list, match rule, in-scope/out-of-scope counts, and aggregate MB/CPU, placed before any culprit table.
   - `Out-of-scope load is a diagnosable cause`: the scenario from P0-3.
   - REMOVED or DEPRECATED: `--hide` redaction as a privacy mechanism. Committed default config must not redact.
2. **New capability `system-facts`** (P1-5): the datum list, "unknown + reason", collected once per run, and the admin-only items labeled with their tier.
3. **MODIFY `metrics`:**
   - Abstract away collectors (P2-1).
   - Add per-process CPU, temperature (CPU/GPU/thermal zone with tier and unavailable-reason), GPU (conditional), disk latency/free, and network (or declare it a non-goal).
   - Fix the 0.85/0.95 and tree contradictions.
   - Drop the stale v0.6 deferral blocks and re-home them in a dated "Deferred" section with an owning change.
   - Replace the ETW prohibition with "opt-in, admin-only, disclosed".
4. **MODIFY `evidence-surface`:**
   - Add a "Hang definition and proxy validity" requirement (P1-1).
   - Add a "Diagnosis record" requirement: leading cause class + named in-scope processes + confidence + disprovers checked + an explicit `undetermined` and `outside-scope` (P1-2).
   - Make the STATE label derive from the cause class.
   - Add non-goals (P2-2).
5. **MODIFY `tracking`:** add "Workload session" (tagged phases, idle-vs-loaded, duration bounds disclosed) (P1-6). Qualify "zero unknown names" to declared scope. Fix the Responding scenario wording. Reword the "always-on" purpose line.
6. **New capability `it-deliverable`** (P1-7): a paste-ready summary (subject line, system facts, scope declaration, hang count/rate with n, leading cause with confidence, attachments list), plus the printable one-pager. JSON stays truth, and the summary contains no numbers absent from the JSON (reuse `evidence-surface/spec.md:93-101`).
7. **Process:** back-fill spec deltas for v06 to v13 in one `spec-sync` change, close or split v09, un-archive or re-review v08, and add archive gates to `openspec/config.yaml` (deltas present + review task checked).

---

## Handoff notes

**For reviewer 02 (data layer):**
- Verify the "out-of-scope never persisted" property across *every* path: watch JSONL, the per-hang name-match fallback (`hanger.js:1168`), GPU PID maps (`:1494-1522`), docker container names, the WER/AppHang/Responding lists (`:150`, `:1198`, `:1255`, which return *all* non-responding process names unscoped), and event-log excerpts.
- Per-process CPU and network are not collected. Thermal is admin-only. Power state appears to be sampled at start and refreshed only occasionally (`hanger.js:1128`); confirm it is truly per-sample as `tracking/spec.md:54` requires.
- The hang proxy is shell + `node -e ""` spawn latency (`hanger.js:1138`). Assess its confounds (AV on process creation, cmd.exe startup) and whether a lighter or more UI-representative probe exists.
- The memory RCA candidate uses trace-wide `committedPeak`, not hang-window values (`hanger.js:1482`).
- The asset block lacks CPU model, GPU model, storage type, BIOS, and WSL/Docker memory limits.

**For reviewer 03 (report/output/inference):**
- The scope declaration must lead the report. Today it trails the culprit table (`hanger.js:1626`), and the table heading claims completeness (`:1619`). `render-print.js:206` shows only the scope *mode* for traces, not the allow-list.
- The STATE label `RAM-BOUND` can fire on non-memory reasons (`hanger.js:1451-1452`). Inference hierarchy needs a cause-class-to-label mapping.
- RCA rows lack process attribution and an "outside declared scope" cause. Throttle/thermal and GPU are missing as candidates. Disprovers are prose, not evaluated.
- Redaction receipts print the hidden pattern names (`hanger.js:1568-1570`, `1624`, `render-print.js:113`). If `--hide` survives, its rendering contradicts its purpose.
- No paste-ready IT email/summary artifact exists. `pack` + `--print` are the nearest building blocks.
- The cost block and RAM-vs-reimage discriminator need verdict-free wording to stay within the manifesto.
