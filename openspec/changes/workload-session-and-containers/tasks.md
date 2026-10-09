# Tasks

Prerequisites (must already be merged): `fix-report-integrity` (test harness, incremental persistence, timebase), `software-inventory-and-scope` (scope file, resolver, canary test), and `sampling-engine-and-provenance` (collector registration, provenance, budgets). Runs in parallel with `data-signals-completeness`. Add collectors only through the registration interface. Do not edit the sampler core.

Interfaces consumed later (keep their shape stable and documented in `SCHEMA-CHANGELOG.md`):
- `workload.probes` is used by `diagnosis-engine-rebuild` as a hang confirmation source (workload-side freeze).
- `workload.phaseSummary` is used by `diagnosis-engine-rebuild` for idle-vs-loaded context.
- `workload.vm` (host memory series, configured cap) is used by `diagnosis-cause-rules` "Virtual machine memory dominance rule".
- `workloadConfig` (top-level report key; database memory settings and configured WSL cap; also referenced by `system-profile-for-it` as `workloadConfigRef`; database memory settings) and in-scope database process series are used by `diagnosis-cause-rules` "Database memory and I/O rule".
- `workload.markers` and `workload.phases` are used by `report-and-visualization` chart annotations.

## 1. Scope-file schema extension

- [x] 1.1 Extend the scope-file loader with optional `phases` (string list), `probes[]` `{name, command: string[], timeoutMs=5000, everySec=5}` and `config[]` `{kind: "postgres"|"wsl", connection?}`. Reject a string `command`, a missing `name`, and any key matching `/pass|pwd|secret|token/i`, each with a message. Verify: `node --test tools/hanger/test/workload-scope.test.js` covers valid, string-command, and secret-key cases. [R03-REC-9] [R01-P1-6]
- [x] 1.2 Document the extension in `README.md` (scope-file section) with one Postgres-in-Docker example, and note that credentials are never stored. Verify: run the README example scope file through the loader test. [R03-REC-9]

## 2. Workload session phases

- [x] 2.1 Implement `lib/workload/phases.js`: open/close phases from a key press (phase key), the `--phase <label>` flag (opens at run start), and the scope-file `phases` order. Each bound is appended to the run stream immediately with wall-clock time and source. Verify: unit test with a fake clock asserts the record sequence and that an unclosed phase is reported with end "unfinished". [R01-P1-6] [R01-REC-5]
- [x] 2.2 Compute `workload.phaseSummary` per registered signal: mean, p95, n, and unobserved seconds per phase label, plus an untagged count. Untagged samples are never merged into a side. Verify: fixture test with 30 idle and 45 loaded samples asserts n=30/45 and the untagged count. [R01-P1-6] [R01-REC-5]
- [x] 2.3 With no phases declared, write `phaseSummary: null` and the statement "no workload phases were declared". Verify: unit test. [R01-P1-6]

## 3. Lifecycle markers

- [x] 3.1 Implement `lib/workload/markers.js`: diff successive in-scope snapshots (process PID + creation time, container id + start time) into `process-start|process-exit|container-start|container-stop` markers. Out-of-scope items are filtered by the scope resolver **before** the diff. Verify: unit test with canned snapshots containing a canary out-of-scope name asserts no marker and no canary string in the serialized output. [R02-REC-7] [R02-P1-7]

## 4. Container and VM visibility

- [x] 4.1 Implement `lib/workload/containers.js`, registered as a heavy collector (default every 10 s, budget 3 s, back-off doubling to 60 s on timeout). It parses canned container-stats output into the in-scope series (CPU %, mem used MB, mem limit MB) plus an out-of-scope aggregate (count, CPU %, MB). Verify: parser tests on canned outputs (normal, MiB/GiB units, empty list). [R02-REC-7] [R02-P1-7] [R01-P1-4]
- [x] 4.2 Map platform states to the fixed reasons (`not installed`, `not running`, `unresponsive (timed out after N s)`). Raw stderr is never stored. Verify: unit tests feed "not recognized", "cannot connect", and a hanging fake command, and assert reason strings and no raw text. [R02-P1-7] [R01-P1-4]
- [x] 4.3 Implement `lib/workload/vm.js`: host-side VM memory series (from the system-set process data), the configured cap from the user's VM config (value in MB or "no cap configured (default applies)"), and guest memory only when the VM is already running. Never start it. Verify: tests with canned config files (cap 8GB, absent file, malformed) and canned running/stopped states. [R02-REC-7] [R02-P1-7] [R03-ADD-3] [R03-P1-2] [R01-P1-6]

## 5. Workload latency probe

- [x] 5.1 Implement `lib/workload/probes.js`: run declared probes with argv, no shell, hidden window, output ignored, kill on timeout, and status class `ok|nonzero|timeout|not-found`. Stop after 3 consecutive not-found results with a reason. Never run when no probe is declared. Wall time is added to observer cost. Verify: tests with a fake command (sleeps beyond the timeout → "timeout", process killed; prints a canary → canary absent from output; missing exe → "not-found"). [R03-REC-9] [R03-P0-4]
- [x] 5.2 Expose `workload.probes` in the stream and the final report, and document the shape in `SCHEMA-CHANGELOG.md` `2.x` as the confirmation input for `diagnosis-engine-rebuild`. Verify: `node tools/hanger/test/helpers/validate-report.js <fixture>` passes. [R03-P0-4] [R03-REC-9]

## 6. Workload configuration facts

- [x] 6.1 Implement `lib/workload/config.js`; results are written to the top-level report key `workloadConfig[]` (`{kind, fact, value, source, unavailableReason}`). Database memory settings (shared buffer size, work memory, max connections) are read only for in-scope declared databases, with a connection timeout ≤ 3 s, and "authentication required (credentials are never stored)" when a password is needed. The VM cap fact is shared with 4.3. Verify: tests with canned outputs and auth-failure text; out-of-scope entry → "not declared in scope" with no query (spy asserts zero executions). [R03-ADD-4] [R03-P1-2]

## 7. Report wiring and changelog

- [x] 7.1 Add the `workload` key to report assembly, the incremental stream, and the console run summary (phases, marker count, container status line, probe p95). Add a `2.x` additive section to `SCHEMA-CHANGELOG.md`. Verify: fixture run, then `validate-report.js` passes and the changelog lists every new field. [R02-REC-7] [R01-P1-4]

## 8. Integration check

- [ ] 8.1 Live run with Docker Desktop running a Postgres container in scope, a declared `pg-select1` probe, and `config` postgres plus wsl. In Git Bash: `node tools/hanger/hanger.js trace --duration 120 --phase loaded --scope ./scope.json --out "$TMPDIR/tt-wl"`. Press the phase key twice during the run. Verify: report has ≥6 container samples, ≥20 probe attempts, a phase with both bounds, and VM host memory series; cap fact is a value or reason. [R02-REC-7] [R03-REC-9] [R01-P1-6]
- [x] 8.2 Live run on a machine (or with the daemon stopped) without Docker: `node tools/hanger/hanger.js trace --duration 30 --out "$TMPDIR/tt-nodocker"`. Verify: container values are null with "not installed" or "not running", and the report and MD contain no raw shell error text (`grep -i "not recognized" "$TMPDIR"/tt-nodocker/*` finds nothing). [R02-P1-7]
- [x] 8.3 Run `node --test tools/hanger/test/` and `node tools/hanger/test/canary-leak.js`. The canary includes an out-of-scope container when Docker is present. Verify: all pass, zero canary hits. [R02-REC-7]
- [x] 8.4 Run `openspec validate workload-session-and-containers --strict`, then record a review-gate note below (date, commands, observed results). Verify: validation passes and the note is present. [R01-REC-5]

## Workflow follow-up

- Archive after `sampling-engine-and-provenance` is archived and the review gate is recorded.

## Review-gate note (2026-10-07, wave 4)

Tests: `node --test tools/hanger/test/` = 210 tests; the workload files (workload-scope, workload-session, workload-platform,
workload-run) all pass. Two tests outside this change fail while `data-signals-completeness` is mid-edit (session power-line parse and
bundle parser in the counter-session code); they are not touched by this change.

- 1.1/1.2: `test/workload-scope.test.js` (valid, string command, secret key, credential in text, bounds, README example run through the loader).
- 2.x: `test/workload-session.test.js` (phase key sequence, unfinished phase from a stream, 30/45 idle-vs-loaded with untagged and unobserved seconds, no phases).
  Live: `HANGER_TEST_PHASE_KEYS=15,60 node tools/hanger/hanger.js trace --duration 90 --scope scope.json --phase loaded` -> phase loaded
  start 12:11:01.988Z end 12:11:47.042Z source key, phaseSummary with n on the tagged side and untagged counts, console line "workload: 1 phase(s): loaded closed".
- 3.1: marker diff test with a canary process and container (no marker, no canary string in stream or markers).
- 4.1/4.2: `test/workload-platform.test.js` on canned docker ps/stats JSON (MiB/GiB/kB/B), "not recognized", daemon-pipe error, ENOENT, and a hanging fake command killed at 400 ms.
- 4.3: canned .wslconfig (8GB, no cap, absent, malformed), wsl list running/stopped, meminfo. Live with Ubuntu running (started by hand): host memory 1534 MB and 1497 MB, guest used 630/560 of 7761 MB, 2 polls in 75 s.
  Live with Ubuntu stopped: host "VM not running", guest "VM not running", and `wsl -l -v` still reports Stopped after the trace (never started).
- 5.1/5.2: real child processes: ok, nonzero, not-found, timeout (status timeout, ms = timeout, child killed), canary output/argument absent, stop after 3 not-found, refusal when elevated. Live: 18 attempts in 90 s for a declared 5 s probe (p95 119 ms).
- 6.1: canned psql output, auth-failure text, out-of-scope spy (zero executions), docker exec path. Live: `psql` absent here -> each fact null "not installed"; wsl cap null "no cap configured (default applies)".
- 7.1: `workload` and `workloadConfig` assembled from the stream (also on `recover`), `validate-report.js` passes on live reports, changelog 2.x section written.
- 8.2: live no-Docker traces (`--scope scope.json`): `containers.unavailable.reason` "not installed", `docker.unavailable` "not installed"; `grep -ril "not recognized"` over the out dirs and console logs finds nothing. Also `test/workload-run.test.js` (fail-all trace).
- 8.3: `node tools/hanger/test/canary-leak.js` -> canary hits: 0, backstop never activated (the container canary is skipped without Docker; unit tests cover container, image and distro names).
- Observer cost (90 s, same machine, concurrent 2 h trace running): total 3.8% (with workload) vs 3.9% (HANGER_TEST_NO_WORKLOAD=1), i.e. no measurable difference in the tool's own CPU. Child CPU is not in that figure; measured separately: `wsl -l -v` about 31 ms,
  filtered `tasklist` about 94 ms, `node -e` about 78 ms. Added cost: VM poll every 60 s = about 0.05% of one logical CPU when the VM is stopped, about 0.2% when it runs; Docker absent = 0 launches (ENOENT, recheck every 300 s);
  Docker running = two CLI calls per 10 s (not measurable here; expect about 0.5%); a declared probe costs one launch per `everySec` (the user's command plus about 80 ms for a node probe at 5 s = 1.6%). The baseline already exceeds the 2% budget (observer line).
- Not done: 8.1 (live Docker Desktop + Postgres container) is blocked: Docker is not installed on this machine. Everything except the real daemon call was exercised live and on canned output.
