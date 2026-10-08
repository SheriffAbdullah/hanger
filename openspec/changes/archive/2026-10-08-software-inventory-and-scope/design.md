# Design: software-inventory-and-scope

## Context

See proposal.md for motivation. The current code:
- builds scope from `--only`/`--preset` as a list of lowercase substrings;
- matches those substrings against exe names **or** friendly labels;
- applies scope after enumerating every process, including full command lines;
- writes several datum paths without consulting scope at all (R02-P0-2 list);
- runs a second, independent filter (`--hide`/`--focus`/`--extras`) with receipts that disclose the hidden names.

Watch matches by name only, while trace also matches labels, so the two modes disagree (R02-P1-10). This change depends on `fix-report-integrity` for the test harness (`node --test tools/telltale/test/`), the `require.main` guard, and value-level serialization.

## Goals / Non-Goals

**Goals**
- One resolver decides, for every process-identifying datum, one of three outcomes: in-scope, system set, or out-of-scope. It sits before every write or print.
- Out-of-scope processes contribute only anonymous aggregates.
- The user sees everything locally (inventory) and chooses. The shareable report declares the choice up front.
- An automated canary test proves non-persistence across every artifact and the console.

**Non-Goals**
- Hiding software from IT, or flagging "unsanctioned" software (not a compliance scanner).
- Preventing the OS from listing processes to the tool. Membership is decided in memory, and that transient read is disclosed.
- The outside-scope **cause** rule. That belongs to `diagnosis-engine-rebuild`, which consumes the aggregates defined here.
- Rendering the full report order. `report-and-visualization` owns that, and this change only guarantees that the scope block comes first.

## Decisions

1. **Scope file instead of a flag list.**
   - Choice: `telltale.scope.json` (default path at repo root; the `scope` key in config or `--scope PATH` overrides). The file is authored by the user, with `inventory --write-scope` producing a draft that has every entry commented as `"enabled": false`.
   - Alternatives considered: keep `--only` as the primary input (rejected: no provenance, no review step); an interactive picker only (rejected: not reproducible).
   - `--only a,b` still works and is recorded as `source: "flag"`.
2. **Match semantics: exact name or explicit pattern.**
   - Choice: case-insensitive executable base name, with or without `.exe`. An explicit `pattern` is a glob over the executable name only.
   - Alternative rejected: substring matching on friendly labels. It caused the `code` term to match `opencode.exe` and "Claude Code CLI".
   - Descendants are included only with `includeDescendants: true`. They are pinned as `(pid, creationTime)` when first seen, so PID reuse cannot adopt an unrelated process (OQ-6).
   - If membership cannot be fully resolved (for example, parent information is unavailable under load), the resolver falls back to the entry's own exact name only. The fallback is recorded as `scope.fallbacks[] {at, reason}`. It never widens the match.
3. **System set (OQ-2).**
   - Choice: a constant published list of exact names, grouped by category: `os` (System, Registry, Memory Compression, dwm, SearchIndexer, svchost grouped as "Windows services"), `security` (registered security products and their known service executables, e.g. MsMpEng), and `virtualization` (vmmem, VmmemWSL).
   - It is listed in the declaration and in the README.
   - Alternative rejected: let the user remove the system set. Diagnosis needs AV and VM visibility, and these are IT-owned components.
4. **Resolver is the only exit path.**
   - Every collector returns raw rows to the resolver, never to the report.
   - `resolve(rows)` returns `{inScope[], system[], outAggregate}`.
   - Output writers (JSON, stream, JSONL, MD, HTML, console logger) accept only resolved structures.
   - The console logger is a function that refuses free-text process names not obtained from the resolver. Debug strings go through `scopeSafe(text)`, which drops tokens matching out-of-scope names seen in the current snapshot.
5. **Open scope is explicit (OQ-1).**
   - With no scope file and no `--only`, the declaration is `{mode: "open"}`. Every view's first block reads "OPEN SCOPE: names of all running software may appear in this report".
   - `record` with no scope file runs `inventory` first, prints the draft path, and asks before continuing. Without a TTY, it runs open scope and declares it.
6. **Retire redaction (OQ-3, BREAKING).**
   - `--hide`, `--focus`, and `--extras` exit with code 2 and the message `--hide was removed: list what to monitor in telltale.scope.json (see README "Scope")`.
   - The `hide`, `focus`, and `extras` config keys produce the same error.
   - Report `redacted.*` and `focus.*` blocks are removed. This is a schema removal. While `telltale-json/2` is a draft (IMPLEMENTATION-PLAN §2) it is recorded in a dated `2.x` SCHEMA-CHANGELOG section without a version bump.
7. **Command lines (OQ-5).** Command lines are read only for in-scope processes, and only in memory to derive a label through a fixed rule table. Examples: `node-script` (base name of the first `.js`/`.mjs`/`.ts` argument), `postgres-db` (value of `-D` base name or `dbname`), `container-name`. The label and rule id are persisted; the raw command line never is.
8. **Inventory artifact is private.** It is written to `reports/private/inventory-<stamp>.json`. Pack, renderers, and the attachment manifest refuse paths under `private/`. The artifact itself carries `"shareable": false`.

## Data / schema shape

Scope file (`telltale.scope.json`):
```json
{
  "version": 1,
  "entries": [
    { "name": "postgres", "includeDescendants": false, "note": "local DB" },
    { "name": "com.docker.backend", "includeDescendants": true },
    { "pattern": "node*", "includeDescendants": false, "enabled": true }
  ]
}
```
Validation: `version` must be 1. Each entry has exactly one of `name` or `pattern`. Patterns may use only `*` and `?`. An unknown key is an error (exit 2 with the path and key).

Scope declaration (report root `scope`):
```json
{
  "mode": "allowlist" | "open",
  "source": "file" | "template:dev" | "flag",
  "path": "telltale.scope.json", "sha256": "<64 hex>",
  "entries": [ { "name": "postgres", "includeDescendants": false } ],
  "matchRule": "exact-name-or-pattern; descendants only when opted in",
  "systemSet": { "listVersion": 1, "categories": ["os","security","virtualization"] },
  "counts": { "inScopeGroups": 2, "systemGroups": 6, "outOfScopeGroups": 118 },
  "fallbacks": [ { "at": "<iso>", "reason": "parent info unavailable" } ],
  "statement": "Names of software outside this scope were not recorded."
}
```

Aggregate record (run level `outOfScope`, and per hang `hang.scopeShare`):
```json
{ "groups": 118, "processes": 214, "memMB": 6120, "cpuPctOfMachine": 31.5,
  "inScope": { "memMB": 820, "cpuPctOfMachine": 4.2 },
  "system":  { "memMB": 1900, "cpuPctOfMachine": 12.0 },
  "measuredAt": "<iso>" }
```
`cpuPctOfMachine` is null with a reason until `data-signals-completeness` supplies per-process CPU.

Inventory artifact (`reports/private/inventory-<stamp>.json`):
```json
{ "shareable": false, "takenAt": "<iso>", "groups": [ { "name": "postgres.exe", "friendly": "PostgreSQL", "instances": 7, "memMB": 412, "category": "user|system" } ] }
```

## Non-binding implementation hints

- Implement `lib/scope.js` with these exports:
  - `loadScope({cfg, args, cwd})` returns `{decl, matcher}`;
  - `resolver(matcher)` returns `{resolve(rows), scopeSafe(text), aggregates()}`;
  - `SYSTEM_SET`;
  - `APP_LABEL_RULES`.
- The current single choke points to rewire are `applyScope`, `hit`, `isRedacted`, `ONLY`, `HIDE`, `FOCUS`, and `EXTRAS` in `telltale.js`.
- Leak sites (R02 line refs at e2bacca):
  - `Where-Object { !$_.Responding }` list → keep only in-scope and system names; count the rest;
  - the light `Get-Process` path → resolve before `slice(0,3)`;
  - `res2004`/`hangs1002`/`crash1000` excerpts → `scopeSafe`;
  - `docker ps/stats` and `wsl -l` text → parse into rows, then resolve; never store raw text;
  - the `console.log` HANG line;
  - `elevated-trace.bat` → write the run's own resolved log, not raw stdout;
  - `scrubGpu` → use the resolver;
  - the watch top-3 group writer.
- Descendant pinning: take `ParentProcessId` and `CreationDate` from the existing CIM snapshot. Query command lines only for PIDs already known to be in scope (`Get-CimInstance Win32_Process -Filter "ProcessId=…"`).
- Canary: `copyFileSync(process.execPath, tmp/zzcanary<rand>.exe)`, then spawn it with `-e "setInterval(()=>{},1e3)"`, run the modes with `--only postgres --out <tmp>`, recursively grep `<tmp>` and the captured stdout/stderr case-insensitively, and kill the canary in `finally`.

## Risks / Trade-offs

- [Risk] Users relied on `--hide` → Mitigation: a clear exit-2 migration message, a README section, and `inventory --write-scope` makes authoring a scope a single step.
- [Risk] Exact-name matching misses helper processes (e.g. Docker's several executables) → Mitigation: templates list the known executable sets per product, and `includeDescendants` covers process trees.
- [Risk] Free-text fields (event messages) may still contain out-of-scope names that are not in the current snapshot → Mitigation: event excerpts are reduced to provider, id, and time, plus an in-scope name match. Message text is never stored.
- [Risk] Aggregates reveal that "something big" ran → Accepted. This is the honesty requirement (R01-P0-3), and it identifies nothing.
- [Risk] The transient in-memory read of all process names could be read as "collection" → Mitigation: reports state "not recorded". The design limits detail queries (command line, GPU, CPU) to in-scope PIDs where the platform allows.

## Migration

- **BREAKING** flags `--hide`, `--focus`, `--extras` and config keys `hide`, `focus`, `extras`: exit 2 with a message.
- `telltale.config.json`: remove `hide`, `focus`, and `extras`, and add `"scope": "telltale.scope.json"` (optional).
- `--preset dev|plain`: `dev` writes a draft scope file from the dev template (node, docker executables, postgres, redis-server, chromium) when none exists, and records `source: "template:dev"`. `code` and `playwright` are no longer in it (fixes R01-P1-3h). `plain` means open scope.
- Old reports carrying `redacted.*` remain readable by `trend` (field ignored).

## Open Questions

None blocking. The agents use the IMPLEMENTATION-PLAN defaults OQ-1 (open scope declared loudly; `record` runs inventory first), OQ-2 (fixed system set), OQ-3 (retire the flags), OQ-5 (no raw command lines), and OQ-6 (descendants opt-in, pinned by PID and creation time). If the owner overrules OQ-2, only `SYSTEM_SET` and its spec scenario change.
