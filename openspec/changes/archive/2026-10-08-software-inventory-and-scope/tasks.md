# Tasks

Prerequisite: `fix-report-integrity` is merged (test harness at `tools/telltale/test/`, lib seams, value-level serialization, schema v2). Run commands from the repo root in Git Bash. `$T` is a fresh temp dir (`T="$(mktemp -d)"`).

## 1. Scope model and resolver

- [x] 1.1 Create `tools/telltale/lib/scope.js` with:
  - scope-file loading and validation (version 1; exactly one of `name`/`pattern`; only `*`/`?` in patterns; unknown key → exit 2 naming path and key);
  - provenance (`source`, `path`, `sha256`);
  - the `SYSTEM_SET` constant (os/security/virtualization, `listVersion: 1`).

  Verify: `node --test tools/telltale/test/scope.test.js` covers a valid file, an unknown key (`regex`), both name and pattern present, and a matching sha256. [R01-P0-1] [R01-REC-1]
- [x] 1.2 Implement the matcher: case-insensitive exact executable name with or without `.exe`, plus glob patterns. No friendly-label or command-line matching. Verify: unit test where entry `code` matches `code.exe` but not `opencode.exe` or `claude.exe` labelled "Claude Code CLI". [R02-P1-10]
- [x] 1.3 Implement descendant opt-in pinned by `(pid, creationTime)`, plus a fallback that narrows to exact names and records `scope.fallbacks[]`. Verify: unit tests for opt-in on/off, PID reuse with a different creation time staying out of scope, and a fallback recorded with reason. [R02-P1-10] [R01-P1-3j]
- [x] 1.4 Implement `resolve(rows)` returning `{inScope, system, outAggregate}` and `scopeSafe(text)`. Writers accept only resolved structures (a type tag or frozen wrapper). Verify: unit test that passing a raw row to the JSON/MD/console writer throws. [R02-REC-2]
- [x] 1.5 Implement the out-of-scope aggregate: groups, processes, memMB, and cpuPctOfMachine (null with reason "per-process CPU not collected yet" until data-signals-completeness), plus inScope and system totals with `measuredAt`. Verify: unit test with canned rows (3 in, 2 system, 5 out) gives exact totals. [R01-P0-3]

## 2. Wire every mode and output through the resolver

- [x] 2.1 Replace `ONLY`/`hit`/`applyScope` with the resolver in trace, watch, record, and pack. Watch and trace share one matcher. Verify: unit test feeds the same canned rows to the watch-line builder and the trace-snapshot builder and gets equal in-scope name sets. [R02-P1-10] [R02-REC-2]
- [x] 2.2 On-hang snapshot: rank top-N within in-scope plus system rows, not overall-then-filter. Attach `scopeShare` to every hang row. Record `snapshotSkippedReason` when skipped. Verify: unit test where in-scope postgres is 5th largest overall and is kept, with zero out-of-scope names in `culpritsAtHang`. This replaces the removed contradictory "Handles, threads, and tree snapshots" requirement (no process tree claimed). [R02-P1-4] [R02-REC-8] [R01-P0-3] [R01-P1-3d]
- [x] 2.3 Light/melting snapshot path: resolve before truncation, with no unscoped names. Verify: unit test of the light-path parser with canned output containing an out-of-scope name yields none in the output. [R02-P0-2]
- [x] 2.4 Not-responding list: keep only in-scope and system names, and store `outOfScopeNotResponding` as a count. Verify: unit test with canned names `Microsoft.Notes,postgres` and scope `postgres` gives `["postgres"]` plus count 1. [R02-P0-2]
- [x] 2.5 Event excerpts (1002/1000/2004): store provider, id, time, and in-scope name match only. Never store message text. Verify: unit test whose message text contains an out-of-scope exe name yields no occurrence of it in the stored record. [R02-P0-2]
- [x] 2.6 Docker/WSL: parse container and distro rows, resolve them, and remove the raw `docker.ps/stats/wsl` strings from the report. Out-of-scope containers become an aggregate count. Verify: unit test with canned `docker ps` text containing two containers, one in scope, stores one name. [R02-P0-2]
- [x] 2.7 GPU PID maps: replace `scrubGpu` hide/scope logic with the resolver. Out-of-scope PIDs become an aggregate. Verify: unit test with a canned byPid map. [R02-P0-2]
- [x] 2.8 Console output (HANG line, live table, state card, asset line) goes through resolved structures or `scopeSafe`. Verify: unit test captures the logger output for a canned hang containing an out-of-scope name and finds zero matches. [R02-P0-2]
- [x] 2.9 `elevated-trace.bat`: stop redirecting raw console output. The run writes its own resolved log file. Verify: review the diff, and the canary test (4.1) covers the log in an elevated run when available. [R02-P0-2]
- [x] 2.10 Watch JSONL: top groups resolved, with the out-of-scope aggregate per line. Verify: unit test on the line builder. [R02-P0-2]

## 3. Inventory, scope file authoring, declaration, retirement

- [x] 3.1 Add the `inventory` mode, which writes `<out>/private/inventory-<stamp>.json` with `"shareable": false` and nothing else. Add `--write-scope`, which drafts `telltale.scope.json` with all entries `"enabled": false`. Verify: `node tools/telltale/telltale.js inventory --out "$T"` creates exactly one file under `$T/private/` (`find "$T" -type f | wc -l` prints 1). [R01-P0-1] [R01-REC-1]
- [x] 3.2 Pack, renderers, and the attachment list refuse paths under `private/` with a message. Verify: `node tools/telltale/render-print.js "$T/private/inventory-*.json" x.html` exits non-zero naming the path. [R01-P0-1]
- [x] 3.3 Presets become templates: `--preset dev` writes a draft scope file if none exists (node, docker executables, postgres, redis-server, chromium; no `code`, no `playwright`) and records `source: "template:dev"`. `plain` means open scope. Verify: unit test of the template contents. [R01-P1-3h]
- [x] 3.4 Scope declaration record at the report root, with `statement` "Names of software outside this scope were not recorded." Remove every "never collected" string from code. Verify: `grep -rn "never collected" tools/telltale` returns nothing, plus a unit test of the declaration shape. [R01-P1-3j] [R01-P0-2]
- [x] 3.5 Put the declaration first. In MD, a "Scope" section precedes any per-process table. In print HTML, the scope block (entries, match rule, system set, counts, out-of-scope total) is the first section after the title. The console summary and pack carry it too. Open scope reads "OPEN SCOPE: names of all running software may appear in this report". Verify: unit tests on the MD generator and `render-print.js` with a fixture check that the index of "Scope" is less than the index of the first process table, and the open-scope string is present. [R01-P0-2] [R03-REC-12]
- [x] 3.6 Retire `--hide`, `--focus`, `--extras` and their config keys (exit 2 with migration message). Delete `redacted.*` and `focus.*` from the report. Remove `hide`/`focus`/`extras` from `telltale.config.json`. Bump the schema per IMPLEMENTATION-PLAN §2 and record it in `tools/telltale/SCHEMA-CHANGELOG.md`. Verify: `node tools/telltale/telltale.js trace --hide claude; echo $?` prints 2. `node -e "const c=require('./telltale.config.json');process.exit(['hide','focus','extras'].some(k=>k in c)?1:0)"` exits 0. [R01-P0-2] [R02-P2-7]
- [x] 3.7 Command lines: read only for in-scope PIDs. Derive labels through `APP_LABEL_RULES` (`node-script`, `postgres-db`, `container-name`, `none`) and persist `{label, rule}` only. Remove `culprits[].cmd`. Verify: unit test where the label for `node C:\work\api\server.js --password=hunter2` is `Node: server.js` and the serialized output lacks `hunter2` and `C:\work\api`. [R02-P1-11]
- [x] 3.8 `record` with no scope file runs inventory first, prints the draft path, and asks on a TTY. Without a TTY it runs open scope and declares it. Verify: `echo | node tools/telltale/telltale.js record --duration 10 --out "$T"` produces a report whose `scope.mode` is `open`. [R01-P0-1]

## 4. Privacy canary and docs

- [x] 4.1 Add `tools/telltale/test/canary-leak.js`. It:
  - copies `process.execPath` to `$TMP/zzcanary<rand>.exe` and runs it idle;
  - runs `trace --duration 20`, `watch --watch-secs 10`, `pack`, and `trace --duration 10 --print`, all with `--only postgres --out <tmpdir>`, capturing stdout and stderr;
  - greps every file under `<tmpdir>` and the captured console, case-insensitively, for the canary name;
  - prints hits and exits 1 on any hit;
  - always kills the canary.

  Verify: `node tools/telltale/test/canary-leak.js` exits 0 and prints `canary hits: 0`. [R02-REC-2] [R02-P0-2]
- [x] 4.2 Add a scoped trace with nothing in scope to the canary run, asserting `scope.counts.inScopeGroups === 0` and a numeric `scopeShare.outOfScope.memMB` on every hang (or at run level when there are 0 hangs). Verify: the canary script's assertion output. [R01-P0-3]
- [x] 4.3 README: add a "Scope" section (inventory → edit scope file → scoped run → declaration). Add the published system set list. Fix the `--preset dev` text. Remove `--hide`/`--focus`/`--only ... --hide` usage. Verify: `grep -n "hide\|focus" README.md` returns only the removal note. [R01-P1-3h] [R01-P0-2]
- [x] 4.4 Update `openspec/explorations/persona-it.md`:
  - replace "unsanctioned binaries buried instead of flagged" and the "Policy gate: signature/allowlist check" with the non-goal (declared scope + anonymous aggregates; not a compliance scanner);
  - qualify redaction-audit language as "scope declaration audit".

  Verify: `grep -n "Policy gate" openspec/explorations/persona-it.md` shows the non-goal wording. [R01-P1-8] [R01-REC-5]

## 5. Integration check

- [x] 5.1 Full unit suite. Verify: `node --test tools/telltale/test/` passes. [R02-REC-2]
- [x] 5.2 Live scoped run on Windows: `node tools/telltale/telltale.js trace --duration 30 --only postgres --anonymize --print --out "$T"`. Then check that `node tools/telltale/test/helpers/validate-report.js "$T"/telltale-*.json` passes, and that the MD and print HTML show the Scope block before any process table. Verify: the command output and a manual check of the first section. [R01-P0-2] [R03-REC-12]
- [x] 5.3 Live open-scope run: `node tools/telltale/telltale.js trace --duration 20 --out "$T"`. Verify: `grep -c "OPEN SCOPE" "$T"/telltale-*.md` is at least 1. [R03-REC-12]
- [x] 5.4 Canary run on Windows. Verify: `node tools/telltale/test/canary-leak.js` exits 0 with `canary hits: 0`. [R02-P0-2] [R02-REC-2]
- [x] 5.5 OpenSpec validation. Verify: `openspec validate software-inventory-and-scope --strict` passes with no "Archive would refuse" line. [R01-REC-1]
- [x] 5.6 Review-gate note. Append to this file a dated note: commands run, machine, canary result, and any fallback recorded. Verify: the note exists below. [R01-REC-1]

## Workflow follow-up

- Archive after `fix-report-integrity` is archived and the review gate is recorded: `openspec archive software-inventory-and-scope -y`.

## Review-gate note (5.6)

2026-10-07, Windows 11 Pro 10.0.26200, HP ProBook 440 G9 (unelevated, tier=user), Node 24, `fix-report-integrity` working tree (uncommitted).

- `node --test tools/telltale/test/` -> 104 tests, 104 pass, 0 fail (26 new in `test/scope.test.js`).
- 1.x/2.x/3.x unit checks: scope file load and validation, exact-name matcher, descendants (opt-in, PID reuse, fallback recorded), resolver totals (3 in / 2 system / 5 out), raw rows rejected by writers, same-name-set for watch and trace builders, in-scope postgres ranked 5th kept, light-path/not-responding/event/docker/WSL/GPU/console/labels, inventory shape and private-path refusal, Scope block before any per-process table (MD and print), retired flags exit 2.
- 3.1 live: `node tools/telltale/telltale.js inventory --out <tmp>` -> exactly one file, `<tmp>/private/inventory-<stamp>.json`, `"shareable": false` (115 groups on this machine).
- 3.6 live: `trace --hide claude` -> exit 2 with the migration message; `telltale.config.json` no longer has hide/focus/extras.
- 3.8 live: `echo | node tools/telltale/telltale.js record --duration 10 --out <tmp>` -> inventory written under `<tmp>/private/`, draft `telltale.scope.draft.json` written to the cwd with every entry disabled, run continued in open scope, report `scope.mode` = `open`, source `none`.
- 5.2 live: `trace --duration 30 --only postgres --anonymize --print --out <tmp>` -> exit 0; `validate-report.js` OK; MD "## Scope" and the print page "Scope (what this report covers)" both precede every process table (print: scope block at offset 3972, State 4754, culprit table 5951).
- 5.3 live: `trace --duration 20 --out <tmp>` -> `grep -c "OPEN SCOPE"` on the MD = 1 (first block after the title).
- 5.4 live canary (`node tools/telltale/test/canary-leak.js`, two runs): `canary hits: 0`. The canary `zzcanary<rand>.exe` was confirmed visible to the tool (inventory lists it), and `trace --hang 1` made every probe a hang so the snapshot, not-responding and GPU paths ran with the canary running. Nothing in scope: `scope.counts.inScopeGroups` = 0, run-level `outOfScope.memMB` numeric, every hang row has numeric `scopeShare.outOfScope.memMB` and `inScope.memMB` 0. The run-time guard backstop never activated ("scope guard masked" absent).
- 5.5: `openspec validate software-inventory-and-scope --strict` -> valid, no "Archive would refuse" line.
- Fallbacks recorded: none in these runs (no scope entry used `includeDescendants`; fallback behaviour is covered by the unit test).
- 2.9 note: `elevated-trace.bat` now uses `--log` (the run's own scope-resolved log) instead of raw `> log 2>&1`. No elevated run was possible here (no admin session), so the elevated log is covered by the same `--log` code path in the canary (`run.log` is grepped).
- Deviations: see the hand-off report (record no longer implies `--preset dev`; `pack [trace.json]` accepts an optional file; canned cause text left in place).
