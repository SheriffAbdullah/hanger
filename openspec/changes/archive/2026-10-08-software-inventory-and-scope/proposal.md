# Proposal: software-inventory-and-scope

## Why

The owner's privacy model is **declared scope, not redaction**. The user first sees what is running, then chooses an allow-list. The run records only that scope, and every shareable report opens by stating the scope. Today the specs never mention scope (R01-P0-1). The code instead has a redaction model with a committed `hide: claude` default, receipts that print the hidden names, and a scope line placed after the culprit table (R01-P0-2). Scope is applied as a report-time filter, and out-of-scope process names still reach the persisted JSON. For example, `osHungWindows` lists unrelated apps 10 times in a `--only postgres` run (R02-P0-2). Without scope enforced when data is collected, and honest aggregates for everything outside it, a scoped report either leaks or misleads IT by omission (R01-P0-3).

## What Changes

- New `inventory` mode. It produces a **local-only** list of running software groups, with friendly names and resource share, written to a private folder. The list is never packed, attached, or embedded in a shareable view.
- New **user-authored scope file** (allow-list), recorded in every report with its provenance (path, content hash, source). Presets become templates that write a draft scope file. Ad-hoc `--only` is recorded with source `flag`.
- **Exact match semantics**: case-insensitive executable name or an explicit pattern. Friendly-label substring matching is removed. Descendants are included only when an entry opts in, pinned by PID plus creation time.
- An **always-monitored system set** (OS components, registered security products, virtualization hosts). The set is fixed and published, listed in every scope declaration, and never includes user applications.
- **One scope resolver** shared by trace, watch, inventory, pack, renderers, console, and logs.
- **Collection-time enforcement**. Every datum that names a process passes the resolver before it is written or printed. Paths covered: not-responding lists, light/melting snapshot, event-message excerpts, docker/WSL text, console HANG line, log redirect, GPU PID maps, watch JSONL, and receipts. Reports say "not recorded", never "never collected".
- **Out-of-scope load as anonymous aggregates** (count, memory, CPU share) at run level and at **every hang**, together with the in-scope share at each hang.
- A **scope declaration leads every shareable view**, before any per-process table. With no scope declared, every view states "OPEN SCOPE".
- **BREAKING**: `--hide`, `--focus`, and `--extras` are retired. Each exits with code 2 and a migration message. The committed `"hide": "claude"` default is removed from `telltale.config.json`.
- Raw command lines are never persisted. In-scope processes carry a derived application label and the rule that produced it.
- On-hang top-N is taken **within scope**, not overall-then-filtered.
- Non-goal stated: Telltale is not a software-compliance scanner. The IT persona's policy-gate text is updated to match.

## Capabilities

### New Capabilities
- `scope`: software inventory (local-only), user-authored allow-list and its provenance, match semantics, the system set, one resolver, the non-persistence guarantee, out-of-scope aggregates, scope declaration placement, and the non-goal.

### Modified Capabilities
- `metrics`: replaces the self-contradicting "Handles, threads, and tree snapshots" requirement with "On-hang process snapshot within declared scope".
- `tracking`: "Zero unknown process names" is qualified to in-scope processes and the system set. Unresolved rows never keep command lines.

## Impact

- Code: new `tools/telltale/lib/scope.js` (resolver, scope file loader, aggregates). `telltale.js` (every enumeration and output site, new `inventory` mode, flag retirement). `render-print.js` (scope block first). `trend.js` and the pack path (resolver use). `elevated-trace.bat` (log redirect).
- Config: `telltale.config.json` loses `hide`, `focus`, and `extras`. A new optional `scope` path key is added.
- Docs: `README.md` (scope workflow; fixes the stale `--preset dev` text), `openspec/explorations/persona-it.md` (policy gate becomes a non-goal).
- Tests: new `tools/telltale/test/scope.test.js` and `tools/telltale/test/canary-leak.js`.
- Schema: additive `scope` declaration and `outOfScope` aggregate blocks (SCHEMA-CHANGELOG `2.x` entry). `redacted.*` and `focus.*` are removed. This is recorded in a dated `2.x` changelog section, and the schema stays `telltale-json/2` while it is a draft (IMPLEMENTATION-PLAN §2).
- Depends on `fix-report-integrity` (test harness, lib seams, valid serialization).

## Findings addressed

- R01-P0-1: no baseline inventory, then choose, then scoped re-run flow
- R01-P0-2: scope disclosure framed as redaction; hide default; receipts leak; scope line trails the table
- R01-P0-3: in-scope vs out-of-scope share at each hang (data side; the cause rule is in diagnosis-engine-rebuild)
- R01-P1-3d: contradictory on-hang "process tree" requirement replaced
- R01-P1-3h: README dev preset text contradicts code
- R01-P1-3j: "never collected" claim; fallback matching silently changes semantics
- R01-P1-8: IT persona policy gate vs privacy; zero-unknown qualified to scope
- R01-REC-1: new `scope` capability
- R01-REC-5: tracking "zero unknown" qualified to declared scope
- R02-P0-2: scope not enforced at collection; out-of-scope names persisted
- R02-P1-4: scoped at-hang culprits taken top-3 overall then filtered
- R02-P1-10: inconsistent and over-broad scope semantics
- R02-P1-11: command lines persisted with weak scrubbing
- R02-P2-7: hide receipt lists exact matched exe names
- R02-REC-2: scope as a collection-time contract with canary test and local inventory
- R02-REC-8: top-N within scope (scope part of "repair misleading evidence")
- R03-REC-12: scope declaration on page 1 of every view, including open scope
