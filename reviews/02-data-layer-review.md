# 02 — Data-layer review (collectors, cadence, schema, storage, scope)

Reviewer: Opus (review only, no code changed). Date: 2026-10-07. Commit reviewed: `e2bacca`.
Scope: everything that *obtains, timestamps, filters, and persists* a datum. Implementation choices (which API or command) are not critiqued. The questions are whether the datum is obtained, whether it can be trusted, whether its unit, time, and provenance are clear, whether it degrades honestly, and whether its cadence can explain a hang.

Primary code: `tools/hanger/hanger.js` (single 1,639-line file; all line refs below are to it unless noted).
Contract docs compared against: `METRIC_REGISTRY.md`, `openspec/specs/metrics/spec.md`, `openspec/specs/tracking/spec.md`, `tools/hanger/SCHEMA-CHANGELOG.md`.

---

## 0. What I actually ran (read-only, outputs in scratchpad only)

Machine: HP ProBook 440 G9 laptop, i7-1255U (12 threads), 15.6 GB RAM, Windows 11 Business 26200, on AC, not elevated, Docker not installed, WSL Ubuntu stopped. The box was already under load, with commit at 87-92% and pages/sec in the thousands. That is a realistic hang-scenario machine.

| Run | Requested | Observed |
|---|---|---|
| `--help` | — | OK |
| `check-stub` | — | 16/16 "GREEN" in **52 s**. The per-PID GPU poll alone took **16.5 s**. Battery reported "unknown (desktop/no battery)" on a laptop at 99%. |
| `trace --duration 20` (repo config: interval 500, anonymize, hide claude) | 20 s | **169 s wall**. Probe slip reached **58.4 s** by nominal t+20 s. Bundle took **2.5–14.1 s** per probe (the registry says ~0.1–0.3 s). Event-loop max lag was 6.8 s. The end phase took about 90 s. |
| Resulting JSON | — | **Not valid JSON** (`Bad escaped character … line 584`). The committed `reports/sample-hanger.json` also fails `JSON.parse` (line 461). |
| `watch --watch-secs 10` | 10 s, "every 2 s" | **33 s wall**, 5 rows at a real cadence of about 4–5.5 s. `batteryPct: null` on every row. |
| `pack` | — | "hangs: unknown … no trace report found" and **cost $0**, because the trace JSON from the run above could not be parsed and was skipped without any message. |
| `trace --duration 10 --only postgres --hang 100` (Postgres not running, so **nothing** should be in scope) | — | 5 hang rows. Every row contains `osHungWindows: ["Microsoft.Notes","SystemSettings"]` with `osConfirmed: true`, so **out-of-scope process names are written into the scoped JSON 10 times**. `docker.wsl` lists the distro name. |
| Ad-hoc probe (unelevated) | — | Thermal-zone temperatures (9 zones, including CPU), passive-limit %, throttle reasons, `% Performance Limit`, `% Processor Performance` (= **148%**, turbo), absolute Committed Bytes and Commit Limit, disk % idle, and total handle count are **all readable without admin** on this laptop. |

---

## 1. Coverage matrix

Legend: **Hang** = needed to explain a hang. **IT** = needed for the static IT profile. **Today** = yes / partial / no. Cadence is the *real* cadence observed on a loaded box, not the nominal one.

### 1a. Memory

| Signal / fact | Hang | IT | Today | Fidelity / risk notes |
|---|---|---|---|---|
| RAM available / used % | Y | – | **yes** | `samples[]` every INTERVAL (`:1132-1135`) plus `availMB` in the bundle. **The timestamps are nominal, not wall-clock** (`tSec=(i+1)*INTERVAL`, `:1134`). In my run, 40 samples labelled 0.5–20 s actually covered about 78 s, with gaps of up to 14 s while the bundle blocked the loop. Gaps fall exactly at the stressed moments. |
| Commit % in use | Y | – | **yes** | Bundle (`:747`). The key `committed` has no unit, and values are stored with 15 decimals. |
| Commit absolute bytes / commit limit | Y | Y | **no** | Only the ratio is kept. IT cannot tell "too little RAM" from "pagefile capped" without the limit. The data is readable unelevated (verified). |
| Pagefile usage % | Y | – | **yes** | Bundle `:762`. The registry says start/end only, but the code samples every probe, which is better. |
| Pagefile configuration (size, system-managed, location) | – | Y | **no** | |
| Standby / modified / nonpaged pool | Y | – | **yes** | Discovered once (`:236-251`) and parsed `:794-804`. MB unit is in the key name. Good. |
| Hard faults (pages input/s, pages/s), soft faults | Y | – | **yes** | `:749-751,761`. Confound: every probe starts a fresh shell and runtime process. On a starved box, loading those images is itself a source of page-ins. This is not flagged anywhere. |
| Memory compression size | Y | – | partial | Only as a process WS row (`Memory Compression` in `KNOWN`), only when it ranks in the top-N. |
| Per-process memory at hang | Y | – | **partial** | Top-3 *working set* only (`:1165`), sampled *after* the stall. When scoped, the top-3 is taken from **all** processes and only then filtered (`:1165-1170`), so in-scope evidence vanishes whenever out-of-scope processes are bigger (see P1-4). |
| Per-process private/commit | Y | – | **partial** | End of run only (`privateTop`, `:1271`), never at hang. The spec says the verdict uses Private (`metrics/spec.md:39-45`), but the only at-hang data is WS. |
| WSL2 / Docker Desktop VM internal memory | Y | Y | **no** | Only the host-side `vmmem*` WS row when it ranks, and one end-of-run `docker stats` (`:1281`). No guest memory, no VM memory cap (`.wslconfig`), no container memory over time. |

### 1b. CPU

| Signal / fact | Hang | IT | Today | Fidelity / risk notes |
|---|---|---|---|---|
| Total CPU % | Y | – | **yes** | Bundle `:753`. |
| Run queue / context switches / DPC / interrupt % | Y | – | **yes** | `:752,754,758-759`. DPC and interrupt % are collected but never used. |
| **Per-process CPU** | **Y** | – | **no** | Nothing samples per-process CPU except the Defender counter and the end-of-run `docker stats`. `proc.cpu.<group>` is in the registry (`METRIC_REGISTRY.md:33`) but not implemented. **A CPU-bound Postgres, node, or indexer cannot be named.** |
| Frequency / throttling | Y | – | **partial, misleading** | `% of Maximum Frequency` (`:760`) is capped at base-clock 100%. On this turbo laptop the real performance figure was **148%** while maxFreq stayed at **100** on every probe. A laptop thermally clamped from 4.7 GHz down to base clock still reads "100% of max". The "<60 = throttled" heuristic (`:1598`) misses most real laptop throttling. `% Performance Limit` and throttle-reason data exist unelevated and are not collected. |
| EcoQoS / power-throttled processes | Y | – | **partial, mislabelled** | Collected **post-trace** (`:1240-1251`) and then written into each hang row as `h.ecoQoS` as if it were the state at the hang. On my run every PID came back `denied` or `unknown`, so the datum was not obtained. |
| CPU model / thread count | – | Y | **yes** | `machine.cpuModel/cpus` (`:1526`). Base/max clock, core topology (P/E cores), and microcode/BIOS are missing. |

### 1c. Thermal / power

| Signal / fact | Hang | IT | Today | Fidelity / risk notes |
|---|---|---|---|---|
| **Laptop temperature (time series)** | **Y** | Y | **no** | The only path is admin-only, a **single sample at the end** (`:938-939`), using an ACPI class that is often empty on laptops. This laptop exposes 9 thermal zones including CPU **unelevated** (verified). The owner explicitly asked for this and today it is effectively absent. |
| Thermal throttle reason / passive limit | Y | – | **no** | Readable unelevated (verified). |
| AC vs battery | Y | Y | **yes** | `powerState()` every 30 s (`:1222`). The stored per-probe `plugged` value can be up to 30 s stale and no "as-of" time is attached. |
| **Battery %** | Y | Y | **no, broken** | The PowerShell output is **one line** (`line=Online;pct=100`), but the parser expects one key per line (`:467-474`). `pct` is never parsed, so `batteryPct` is **always null**. check-stub then reports "desktop/no battery" on a laptop, which is a false statement written into the evidence. |
| Battery saver / Energy Saver / power-mode slider | Y | Y | **no** | Only `powercfg /GETACTIVESCHEME`, once at start (`:1079`). On Windows 11 the power-mode overlay ("Best power efficiency") and Energy Saver throttle CPU without changing the scheme, so they are invisible. |
| Power scheme name | – | Y | **yes** | Once per run. On this box it was "HP Optimized (Modern Standby)". |
| Battery health / design vs full capacity | – | Y | **partial** | Only with admin **and** `--sleep-study` (`:950-956`). |

### 1d. GPU

| Signal / fact | Hang | IT | Today | Fidelity / risk notes |
|---|---|---|---|---|
| GPU total utilization (time series) | P2 | – | **no** | The bundle `_Total` path is always null on WDDM, and the code admits this (`:765-768, :1534`). |
| GPU per-process util / VRAM | P2 | – | **partial** | At hang only when "calm", which never happened on this box (see melting below), plus an end snapshot. The poll costs **11.5–16.5 s** here, against 1–3 s claimed at `:100-102`. Degrades honestly with a reason. Good. |
| GPU model / driver version | – | Y | **no** | `nvidia-smi` gives util, mem and temp only, and only on NVIDIA. |

### 1e. Disk / network

| Signal / fact | Hang | IT | Today | Fidelity / risk notes |
|---|---|---|---|---|
| Disk queue / latency (_Total) | Y | – | **yes** | `:755-756`. `diskSec` is stored in seconds and the key carries no unit. |
| Disk busy % / throughput | Y | – | **no** | |
| Per-process disk I/O | Y | – | **no** | Needed to name the indexer, Defender, OneDrive or a Postgres checkpoint as the I/O source. |
| Disk free | – | Y | **yes** | C: only, as an asset (`:520-532`). |
| Disk model / media type / health | – | Y | **partial** | SMART is admin-only, end of run, a truncated text blob (`:942-943`). |
| Network (throughput, errors, VPN adapter) | P2 | Y | **no** | Nothing at all. |

### 1f. Processes, scope, workload

| Signal / fact | Hang | IT | Today | Fidelity / risk notes |
|---|---|---|---|---|
| **Process inventory for the baseline / selection step** | – | – | **no** | No mode produces "here is everything running, pick what to monitor". `watch` keeps the top-3 only (`:1008`). An open-scope trace keeps the top-6 culprits plus the top-20 by WS. Already raised as a spec gap in `reviews/01-openspec-review.md:21-23`. |
| Scope enforced at collection time? | – | – | **no (report-time filter)** | Every enumeration (tasklist `:1080,1161,1227,1277`; full Win32_Process **with every command line** `:326`; Get-Process `:1181,1198,1271`; per-PID GPU `:842`) collects **all** processes, and scope is applied in memory afterwards. The comments "never collected" (`:319-320, :1381, :1626`) and the report text ("N groups … never collected") are **false**. The honest wording is "collected, not persisted", and even that is not fully true (next row). |
| **Out-of-scope leakage into persisted data** | – | – | **leaks** | (1) `osHungWindows` lists all non-responding process names, unscoped (`:1198-1201, :1255-1257`). **Verified**: 10 occurrences in a `--only postgres` run. (2) The melting-path light snapshot applies `isRedacted` but **not** the `ONLY` scope (`:1180-1187`). (3) `events.exhaustion2004` stores the first 120 chars of the resource-exhaustion message, which normally names the top memory consumers (`:1303`). (4) `docker.ps/stats/wsl` raw strings are masked only for `--hide`, not for scope (`:1291-1295, :1575`). (5) Console output names hung windows (`:1219`), and `elevated-trace.bat` redirects console output into `reports/elevated-run.log`. (6) Watch mode scopes by exe-name substring only (`:1006`) while trace also matches friendly labels: two different scope semantics. |
| Scope matching precision | – | – | **risky** | Substring match on exe name **or friendly label** (`:419, :345`). The `dev` preset includes `code` (`:413`) even though README `:29-30` says `code` is intentionally out. `code` substring-matches `opencode.exe` and the label "Claude Code CLI" for `claude.exe` (`:426`), so the dev preset pulls in agent tools the user may not want. A PPID closure from a matched VS Code adopts every shell and tool launched from its terminal. PID reuse can adopt unrelated processes. |
| `--hide` receipt | – | – | by design, note | `redacted.perName` writes the exact hidden exe names and MB (`:1569`). That works as a receipt, but it discloses more than the pattern did (pattern `vpn` becomes `CorpVPNClient.exe=210MB`). |
| Command lines persisted | – | – | **risk** | `culprits[].cmd` keeps up to 160 chars of the command line (`:1392`). These can carry tokens, passwords, DB names and client paths. `anon()` only rewrites `C:\Users\<name>` with backslashes. Forward-slash paths, other drives, OneDrive org folders and other encodings pass through. Verified: `C--Users-AbdullahSher…` survived anonymization in my run. |
| Self-exclusion | Y | – | **no** | The tool never excludes its own PID or its children. In my run the top end culprit was `node.exe` labelled **"Node: hanger.js"** with 2.6 GB. The label came from the tool's own command line and was applied to the whole 4-process node group (`:1387-1392`). The probe's `powershell.exe` and `node -e` children also count in rollups. |
| Postgres native attribution | Y | – | partial | Grouped by `postgres.exe`, with a label from the command line (`:397`). WS only, no CPU or I/O. |
| Postgres / any service in a container | Y | – | **no** | Only one end-of-run `docker stats` row per container (`:1281`): no time series, no start/stop, nothing at the hang. |
| Workload markers (container start/stop, process start/exit) | Y | – | **no** | Only user keypress marks (`:1118-1122`). Those are timestamped **when the blocked event loop gets round to them**, which can be up to 14 s late in my run, not when the key was pressed. |
| Defender / AV activity | Y | – | **partial** | The MsMpEng CPU counter is in every probe. The value is per-core scaled (79–190% observed), so the 20% threshold (`:212, :224`) is meaningless on a 12-thread box. No other AV or EDR is sampled. The tool's own process creation every 2 s is a plausible Defender trigger and is not flagged as a confound. |
| OneDrive / Search indexer activity | Y | – | **no** | Named in `KNOWN`, but nothing samples their CPU or I/O. |
| Handles / threads / GDI | P2 | – | **no** | Spec defers this (`metrics/spec.md:47-48`). Total handle count is readable unelevated. |
| OS hang confirmation | Y | – | **misleading** | "Not Responding" process names include **suspended UWP apps**, which always report not-responding. `osConfirmed: true` on **every** hang in both of my runs came from `Microsoft.Notes` and `SystemSettings`, not from the workload. Deferred polls (`:1254-1257`) copy end-of-trace results onto earlier hangs. |
| OS event logs (1002 / 1000 / 2004) | Y | – | **partial, untimed** | `-MaxEvents 5` with **no time-window filter** (`:1302-1303`). My report showed a 2004 event from the **previous day**. `hangCount` (`:1304`) feeds a verdict reason (`:1447`) from events that may be days old. "No events found" is logged as `mode: 'timeout'` (`:1305`). |
| WER history | P2 | – | partial | All-time archive counts (`:1424`), not per-window or per-bucket as the spec says (`tracking/spec.md:75-85`). |

### 1g. Static IT profile

| Fact | IT | Today | Notes |
|---|---|---|---|
| Manufacturer / model | Y | **yes** | `:495-499` |
| Serial | Y | **no (bug)** | Read from a class that does not carry it (`:495,500`), so it is always "unknown" unless `--serial` is passed. The BIOS serial was readable unelevated on this box. |
| RAM fitted | Y | yes | Total only. No module count, speed, or soldered vs free slots. Those decide "add RAM vs replace laptop". |
| OS caption / build | Y | yes | |
| BIOS version / date, VBS / Memory Integrity, Hyper-V / WSL / Docker versions and limits, GPU / driver, disk model, pagefile config, power mode, domain / MDM | Y | **no** | |
| Uptime | Y | yes | `machine.uptimeMin`. |

### 1h. Cross-cutting

| Concern | Today | Notes |
|---|---|---|
| Time alignment across samplers | **poor** | RAM samples use nominal offsets (`:1134`). Probes have a wall-clock `at` taken **before** a 2.5–14 s bundle whose own sample timestamps are thrown away (`:771`). Power is up to 30 s stale. EcoQoS and some OS-confirm data are post-trace. Events are untimed. Context windows (±10 s, `:1333-1336`) mix nominal-time RAM samples with probe tSec, so a "±10 s" window can really span 30+ s of wall time. |
| Effective cadence | **≈5–8 s, not 2 s** | Measured. With 2–3 s freezes, the spawn probe overlaps a freeze roughly 30–50% of the time. |
| "Melting" gate | **always on under load** | `melting()` trips when the bundle exceeds 1000 ms (`:108`), but the bundle *itself* took 2.3–14 s. On this box the calm path (PPID scope closure, live OS-confirm, at-hang GPU) **never ran**. The fallback is now the main path. |
| Duration | **capped at 300 s** | `:25`. A tool meant to "observe during the hanging workload" cannot run a trace longer than 5 minutes. `watch` runs unbounded but has no hang probes. |
| Persistence / crash safety | **end-of-run only** | The trace JSON is written once, at `:1585`, after an end phase of about 90 s. A hard hang, a forced reboot, a closed terminal or Ctrl+C (`:1060`) loses **everything**. Only `watch` appends incrementally. |
| Overhead | **high on the target box** | Per probe: one shell plus runtime spawn and one full PowerShell start. On a hang: tasklist plus process enumeration. End phase: a GPU poll of 11–16 s, a full process-and-command-line enumeration, and event-log queries. The observer adds commit, page-ins and Defender scans to a machine that is already starved. `bundleMs` and `slipS` are recorded (good), but `hangRatePerMin`, `pctFrozen` and `over85` are divided by **nominal** DURATION (`:1312, :1360, :1544`), not by the real window. My 20 s run (78 s real) reported 3 hangs/min where the true rate was about 0.8/min. |
| Units / provenance per value | **no** | The spec requires `{id, value, unit, windowS, n, collector}` per value (`metrics/spec.md:4,14`; `METRIC_REGISTRY.md:3`). The code emits bare keys (`committed`, `pages`, `cpuQ`, `diskSec`, `defender`, `maxFreq`) with no units, no window and no collector. |
| Null vs zero | **mixed** | Many fields correctly stay null with a reason (GPU, asset). But `diskSecPeak/diskQPeak` default to **0** when no data (`:1321-1322`), `pagesAvg` to 0 (`:1326`), `pct([])` to 0 (`:929-930`), and `minFree` to `Infinity` when there are no samples (`:1310`). |
| Schema versioning | **violated** | SCHEMA-CHANGELOG says any additive field needs a new `schema` value. v1.1 additions and the later GPU, asset, costV2 and discriminator blocks all still ship as `hanger-json/1`. |
| Report validity | **broken when anonymized** | `anon()` runs on the **serialized** JSON and turns `C:\\Users\\x` into `C:\Users\<user>` (`:285-290, :1585, :734`). That produces an invalid `\U` escape. Downstream readers (`latestTraceReport` `:661`, `trend.js:39-53`) skip unparsable files **silently**. Anonymize is the repo default (`hanger.config.json`). |

---

## 2. Findings

### P0: the evidence is wrong, lost, or leaks

1. **Anonymized reports are invalid JSON, and every consumer skips them silently.** `anon()` rewrites path text inside already-serialized JSON and emits single backslashes (`:285-290`, applied at `:1585`, `:734`). Verified on a fresh run and on the committed `reports/sample-hanger.json`. `pack` then reported "no trace report found" and **$0 cost**, and `trend` drops the file. With `anonymize: true` as the repo default, the IT handoff path is broken end to end.
2. **Scope is not enforced at collection, and out-of-scope names reach the persisted report.** Verified with `--only postgres`: unrelated process names appear in every hang row through `osHungWindows`. Code paths that also leak: the melting light snapshot ignores `ONLY` (`:1180-1187`), the event-2004 message text (`:1303`), raw docker/WSL strings (`:1575`), the console and log (`:1219` plus `elevated-trace.bat`), and the full-command-line enumeration of every process (`:326`), held in memory. The report claims "never collected" (`:1626`). The owner's privacy model is a declared scope, with nothing outside it stored. That is the core promise, and it is broken.
3. **No per-process CPU and no per-process I/O.** The tool cannot say *which* process saturated CPU or disk at a hang. It only ranks working set. For "Postgres plus Docker makes my laptop hang", CPU and I/O attribution are half the answer.
4. **No temperature time series, and the throttling datum is wrong for turbo laptops.** Temperature is admin-only, one sample, at the end. `% of Maximum Frequency` stays at 100 while a laptop is clamped from turbo to base clock. Unelevated temperature, throttle-reason and real-performance data exist on this exact laptop. The owner named temperature explicitly.
5. **Battery % is always null (parser bug), and check-stub then states "desktop/no battery" on a laptop.** `:467-474`. That is a false fact written into evidence.
6. **Nothing is persisted until the run ends.** A tool for machines that hang must survive the hang. A forced reboot or Ctrl+C mid-trace loses all trace data (`:1060, :1585`).
7. **Timebase is fictional under load.** RAM samples carry nominal offsets (`:1134`), the real cadence is 2.5–7× slower than labelled, and rates and shares are divided by nominal duration (`:1312, :1360, :1544`). Measured: a "20 s" trace covered 78 s of probes, and the hang rate was overstated about 4×. Every downstream number (hang rate, % frozen, cost, discriminator) inherits this.

### P1: the evidence is misleading or incomplete

1. **OS-confirmation is noise.** Suspended UWP apps make `osConfirmed: true` on every hang (verified twice). Deferred polls copy end-of-run results onto earlier hangs (`:1254-1257`).
2. **Event-log reasons are not time-bounded.** `hangCount` from the last 5 events of all time feeds a verdict reason (`:1302-1304, :1447`). "No events" is recorded as `timeout` (`:1305`).
3. **The melting gate makes the "calm" path dead code on exactly the machines this tool targets.** Its threshold (bundle > 1 s, `:108`) is below the bundle's own normal cost under load (2.3–14 s measured).
4. **Scoped at-hang culprits are top-3 overall, then filtered** (`:1165-1170`). In-scope offenders ranked 4th or lower disappear, which produced empty `culpritsAtHang` in my scoped run.
5. **No self-exclusion.** The tool's own node and probe children are attributed as workload. The whole node group was labelled "Node: hanger.js" (`:1387-1392`).
6. **EcoQoS state is collected post-trace but stored on hang rows** as if it were at-hang state (`:1244-1250`). It was all denied or unknown here.
7. **WSL2 / Docker Desktop VM is a black box.** There is no guest memory, no VM cap, no container time series and no container lifecycle. This is the owner's headline scenario (Docker plus Postgres).
8. **Defender CPU is per-core scaled** (observed 79–190%) against a 20% threshold. Observer-induced Defender scanning is not flagged as a confound.
9. **Trace capped at 300 s** (`:25`). The intermittent-hang use case needs long, cheap, persistent capture with on-trigger deep snapshots.
10. **Scope semantics are inconsistent and over-broad.** Watch uses name-only matching and trace adds friendly labels. Substring matching pulls `opencode` and `claude` into `dev` via "code", and the code contradicts the README on `code`. PPID closure can adopt unrelated trees.
11. **Command lines persisted with weak scrubbing.** Up to 160 chars, which can contain secrets or client paths. `anon` covers one path shape only, and a username fragment was verified to survive.
12. **Static profile gaps for IT:** serial bug (`:495`), no BIOS, RAM modules, disk model, GPU/driver, VBS/HVCI, pagefile config, power-mode overlay or Energy Saver.
13. **Commit absolute / commit limit not stored**, only the ratio.
14. **The per-value unit / window / n / collector contract** promised by the spec is not implemented. Schema version is not bumped despite shape changes.

### P2: polish and edge cases

1. GPU total utilization is never available. The per-PID poll is 11–16 s, against 1–3 s documented (`:100-102`).
2. No network signals (VPN, OneDrive sync bandwidth) and no handle, thread or GDI counts.
3. Zero and Infinity defaults where null-with-reason is required (`:1310, :1321-1322, :1326, :929`).
4. False precision: 15-decimal percentages everywhere.
5. Power state is up to 30 s stale per probe, with no as-of time.
6. Watch `--watch-secs N` is iteration-counted (`:977`): 10 s became 33 s.
7. The `--hide` receipt lists exact matched exe names (`:1569`). Document this, or make it opt-in.
8. WER counts are all-time, not per window or bucket (spec drift).
9. DPC and interrupt % are collected but unused. Standby and modified data are rich but unused downstream.

---

## 3. Recommendations (not applied)

Ordered by leverage. Each is phrased as a data-layer requirement, not an API choice.

1. **Fix serialization before anything else.** Scrub *values* before serializing, never the serialized text. Add a post-write self-check (`parse it back or fail loudly`), and make every reader **report** an unreadable file instead of skipping it.
2. **Make scope a collection-time contract.**
   - Define one scope resolver, used by every mode, with exact-name or explicit-pattern matching. Drop friendly-label substring matching.
   - Any datum that names a process passes through the resolver *before* it is stored or printed. That covers OS-hung lists, event messages, container and WSL text, console lines, logs, the hide receipt and GPU maps.
   - Out-of-scope processes may only contribute *anonymous aggregates* (count, total MB, total CPU %).
   - Add a test that greps every persisted artifact and the console for a canary out-of-scope process name.
   - Deliver the inventory step as a **separate local-only artifact** that never enters the shareable pack.
3. **Stream to disk incrementally** in the same schema for `trace`: append-only JSONL per sample and per hang, then a summary at the end. A run killed mid-hang must leave usable evidence plus a marker saying "run did not finish".
4. **Fix the timebase.**
   - Every sample carries the wall-clock time of the *measurement* (the counter's own timestamp where available), plus `windowS`.
   - Rates and shares use the real observed window.
   - Expected-vs-actual sample gaps are recorded as explicit "unobserved" intervals.
   - User marks are timestamped by something that is not blocked by collection.
5. **Split cheap continuous sampling from heavy on-trigger snapshots, and measure the observer.**
   - The continuous sampler must keep its cadence when the machine is starved: no per-tick process launches.
   - Heavy work (enumeration, GPU, CIM) runs only on trigger, with a budget.
   - Attribute the tool's own CPU, commit and I/O and exclude its process tree from culprits.
   - Remove the 300 s cap for the cheap tier.
6. **Add the missing hang-diagnosis signals** at the continuous cadence:
   - per-process CPU % and disk I/O for the in-scope set plus the anonymous out-of-scope aggregate;
   - thermal-zone temperature and throttle reason;
   - real performance % (turbo-aware) and performance-limit %;
   - commit bytes and commit limit;
   - disk busy % and throughput;
   - a power-mode overlay or Energy Saver flag and a parsed battery %.
7. **Docker / WSL as a first-class source.** Record a container stats time series, container start/stop events as workload markers, the VM memory cap and guest-reported memory where available. Where any of these is not visible, record a null with a reason.
8. **Repair misleading evidence.**
   - Exclude suspended or background-UWP processes from "not responding", and limit OS-confirm to in-scope processes.
   - Time-bound event-log queries to the trace window, and store event timestamps relative to it.
   - Normalize per-process CPU to % of total machine.
   - Store EcoQoS as end-of-run with its real timestamp, not on hang rows.
   - Take scoped at-hang culprits as top-N *within scope*.
9. **Implement the per-value contract** the spec already promises (`unit`, `windowS`, `n`, `collector`, `at`). Bump the schema version as SCHEMA-CHANGELOG requires.
10. **Complete the IT static profile:**
    - BIOS serial, version and date;
    - RAM modules, speed and free slots;
    - disk model, type and health (unelevated where possible);
    - GPU and driver;
    - VBS/HVCI state;
    - pagefile configuration;
    - WSL/Docker versions and caps;
    - power mode.

    Label each with its source and as-of time.

---

## 4. Handoff notes

### For the spec reviewer
- The spec promises things the code does not do: the per-value `{id, unit, windowS, n, collector}` contract (`metrics/spec.md:4,14`), `proc.cpu.<group>`, Private-based verdicts at hang, on-HANG process tree, per-bucket WER, and "never zeros". Either the spec states these as unimplemented, or they become acceptance tests.
- The spec needs explicit requirements for:
  - a **real-time timebase** (wall-clock per sample, real-window rates);
  - **crash-safe incremental persistence**;
  - an **observer budget**, with self-exclusion and self-attribution;
  - **scope enforced before persistence and before console/log output**, with a canary-leak test;
  - a **local-only inventory artifact**, which extends `reviews/01-openspec-review.md` P0-3.
- Temperature and throttle are owner-named signals. The spec currently treats thermal as admin-only and end-of-run. It should require an unelevated time series where the platform exposes one, and null-with-reason otherwise.
- Spec cadence ("2s bundle, ~0.1–0.3 s") is contradicted by measurement: 2.5–14 s bundles and an effective cadence of about 5–8 s. Cadence requirements should be stated as *achieved under load*, with gaps recorded.
- "Baseline" is overloaded: the spec uses it for the watch JSONL, the owner for the process inventory. Rename one of them.

### For the report / inference reviewer
- **Do not trust any rate or share in existing reports.** `hangRatePerMin`, `pctFrozen*`, `secsOver85`, `costV2` and `mttr` are all divided by nominal duration while the real window is 2–4× longer under load. Pre/post ±10 s contexts mix nominal-time RAM samples with probe times.
- **`osConfirmed` is unreliable** (suspended UWP apps). Any confidence boost or narrative built on "OS-confirmed hang" should be suspended until it is fixed.
- **The `hangCount` (Event 1002) reason and the `events.*` text can be days old.** The verdict reason "N OS hang events" (`:1447`) is not evidence about this trace.
- **The throttle inference** "maxFreq <60 on AC = throttled" cannot fire on turbo laptops. "Not throttled" conclusions are unsupported.
- **The Defender alibi** compares a per-core-scaled value (up to N×100) against 20%. It fires on nearly every probe on a 12-thread box, and the observer itself plausibly causes part of the Defender load.
- **Counter values are post-stall**: they are sampled during a bundle that starts after the spawn probe and can take up to 14 s. "Commit at hang" means "commit up to about 14 s after the hang".
- **The discriminator and RAM-bound verdict rest on WS rollups and commit %** only. There is no per-process CPU or I/O, so a CPU- or I/O-caused hang will be misread as memory, or as "unclear", whenever commit is high for unrelated reasons.
- **The top culprit can be the tool itself** ("Node: hanger.js"). Rendering should not present it as workload until self-exclusion lands.
- Anonymized reports currently do not parse. Any renderer or trend test passing today is running on non-anonymized or hand-fixed input (the committed sample also fails to parse).
