# Design: spec-sync-v06-v13

## Context

See proposal.md, "Why". Three main specs exist (`metrics`, `tracking`, `evidence-surface`). The change folders for v05-v13 hold only `proposal.md` and `tasks.md`, so archiving them merged nothing. `openspec validate --all` currently fails on `telltale-v09` and `telltale-v13`, because neither has deltas. The review-driven plan (`openspec/IMPLEMENTATION-PLAN.md`) assigns each existing requirement to at most one change (§4). This change owns only "OS first-order bundle via no-admin collectors".

## Goals / Non-Goals

**Goals:**
- Main specs describe surviving shipped behavior truthfully, and every scenario holds against the current code.
- `openspec validate --all --strict` passes after this change is archived.
- Process gates in `config.yaml` stop new zero-delta archives.

**Non-Goals:**
- No product code, config, or README edits.
- No back-fill of behavior that a later change reworks (see "Not back-filled").
- No requirement renames. Header text is the cross-change key for MODIFIED/REMOVED.

## Decisions

1. **Back-fill only behavior that survives.**
   - Back-filling `--hide`, presets, or the STATE label just so a later change can REMOVE them would add churn and create cross-change MODIFY conflicts.
   - Alternative considered: back-fill everything v06-v13 shipped, then let later changes REMOVE it. Rejected because it doubles the delta volume and violates the one-owner rule in IMPLEMENTATION-PLAN §4.

2. **Kernel trace capture is opt-in and disclosed, not banned.**
   - The shipped `--wpr` feature is legitimate admin-tier evidence.
   - Alternative considered: delete `--wpr`. Rejected because it is an owner-approved admin tier (`USER_PROBLEM.md` "Capability-tiered collection") and costs nothing when unused.

3. **Purpose and Deferred text are edited directly in the main specs at archive time.** OpenSpec ignores `## Purpose` in deltas for existing capabilities, and non-requirement sections cannot be expressed as deltas.

4. **Stable IDs via finding tags, not requirement renames (R01-P2-8).**
   - Requirement names act as IDs.
   - Tasks cite the requirement name plus finding IDs.
   - Alternative considered: prefix headers with `MET-01`. Rejected because it breaks every in-flight MODIFIED header match.

5. **v09/v13 closure.**
   - The two open v09 items are relocated:
     - threshold citations go to diagnosis-engine-rebuild;
     - invariant-culture numbers go to sampling-engine-and-provenance;
     - the file split goes to fix-report-integrity's `lib/` seams.
   - Both changes are then archived with `--skip-specs`. v13's renderers are re-specified by report-and-visualization.

### Not back-filled (owner change)

| Shipped behavior | Owner |
|---|---|
| `--only`/presets/`--hide`/`--focus`/`--extras`, scope receipts, app labels | software-inventory-and-scope |
| Weight policy and auto-degrade, `collection.failures[]` | sampling-engine-and-provenance |
| Per-process GPU (v11) | data-signals-completeness |
| Asset block (v12) | system-profile-for-it |
| Cost v2, RAM-vs-reimage discriminator, STATE label | diagnosis-engine-rebuild |
| print/charts renderers (v13) | report-and-visualization |
| JSON schema freeze/changelog (v10) | fix-report-integrity |

## Data / schema shape

No report schema change. Shape of the `config.yaml` addition:

```yaml
rules:
  archive:
    - A change is archived only when it has spec deltas, or .openspec.yaml sets skip_specs with a one-line reason
    - The change's review task is checked with a review-gate note (date, command, observed result)
    - openspec validate <id> --strict passes with no "Archive would refuse" lines
  tasks:
    - Tasks cite requirement names and review finding IDs (e.g. [R02-P0-1]); never source line numbers
```

## Non-binding implementation hints

- Verify that scenarios hold with these commands:
  - `node tools/telltale/telltale.js check-stub --strict`
  - `node tools/telltale/telltale.js trend`
  - `node tools/telltale/telltale.js watch --rollup weekly`
  - `node tools/telltale/telltale.js pack`
  - `grep -n "LogName='Security'" tools/telltale/telltale.js`
  - `grep -n "wmic" tools/telltale/telltale.js`
- Tier detection today is an administrator-role check at startup. The admin snapshot returns `{tier:'user', skipped:'process not elevated...'}`, and the kernel trace capture prints "needs elevation: skipped" when unelevated. The ETL path is written to `report.wprEtl`.
- Archive closure: `openspec archive telltale-v09 --skip-specs -y` and `openspec archive telltale-v13 --skip-specs -y`.

## Risks / Trade-offs

- [A back-filled scenario does not hold on the current code] → Every scenario names a command. Task 4.1 runs each one before archive and fixes the spec wording, never the code.
- [A later change needs to MODIFY a requirement this change ADDs] → The ADDED names here are absent from every other change's MODIFIED list (IMPLEMENTATION-PLAN §4). Any future need goes through a new change after archive.
- [The pack/trend scenarios become stale when fix-report-integrity changes reader behavior] → The scenarios here describe only assembly and comparison. Unreadable-file handling lives in `evidence-persistence`.

## Migration

None for users. Archive order: this change can be archived any time in W1. Archive v09 and v13 within this change's tasks.

## Open Questions

None. The plan's OQ-n defaults do not affect this change.
