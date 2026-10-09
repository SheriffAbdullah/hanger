# Proposal: spec-sync-v06-v13

## Why

The main specs still describe v0.5. Changes v06 to v13 shipped and were archived (or left open) without a single spec delta. As a result, `openspec validate --all` fails, and several spec claims contradict the code: ETW is said to be banned while `--wpr` ships, purpose lines are stale, and the deferral notes are out of date (R01-P0-4, R01-P1-3f/g/i). Every later change in `openspec/IMPLEMENTATION-PLAN.md` is gated on `openspec validate --strict`. This change makes the baseline truthful and green first. It touches no product code, so it can run in parallel with `fix-report-integrity`.

## What Changes

- Rewrite the OS first-order collection requirement at the datum level, with no API or collector names. Admin-only collection, including whole-run kernel trace capture, is restated as opt-in, elevated-only, skipped with a recorded reason when unelevated, and disclosed by output path. This replaces the old "never ETW" claim, which the code contradicts.
- Back-fill shipped v06-v13 behavior that survives the review-driven rebuild:
  - capability tiers;
  - the portability contract check (`check-stub`);
  - multi-report trend and comparison;
  - the approval pack;
  - the sustained watch rollup;
  - declared non-goals;
  - the install and run contract.
- Leave out shipped behavior that later changes rework, and point to its owner (see design.md, "Not back-filled"): scope, redaction, presets, GPU, the asset block, renderers, the weight policy, the discriminator, and cost.
- Direct main-spec edits at archive time (non-requirement text only):
  - fix the stale Purpose lines in `metrics` and `tracking`;
  - replace both "v0.6 deferrals" blocks with a dated "Deferred" section that points to IMPLEMENTATION-PLAN §6.5.
- Process repairs:
  - close the zombie `hanger-v09` by relocating its two open items, then archive it with `--skip-specs`;
  - review and archive `hanger-v13` with `--skip-specs`;
  - record the missing v08 review;
  - add archive gates and citation rules to `openspec/config.yaml`.
- Docs: mark the correlation and culprit-confidence formula claims in `orders-framework.md` and `ontology.md` as not implemented (DEF-2).

No product behavior changes. Nothing is **BREAKING**.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `metrics`: MODIFIED "OS first-order bundle via no-admin collectors"; ADDED "Capability-tiered collection", "Portability contract check".
- `evidence-surface`: ADDED "Declared non-goals", "Install and run contract".
- `tracking`: ADDED "Multi-report trend and comparison", "Approval pack assembly", "Sustained watch rollup".

## Impact

- Files: `openspec/specs/{metrics,tracking}/spec.md` (Purpose and Deferred sections, edited directly), `openspec/config.yaml`, `openspec/changes/hanger-v09/`, `openspec/changes/hanger-v13/`, `openspec/changes/archive/2026-10-07-hanger-v08/tasks.md`, `openspec/explorations/orders-framework.md`, `openspec/explorations/ontology.md`.
- No changes to `tools/hanger/**`, `hanger.config.json`, or `README.md` (README preset text belongs to `software-inventory-and-scope`).
- Unblocks: `openspec validate --all --strict` as a gate for every later change.

## Findings addressed

- R01-P0-4: v06-v13 surviving behavior is back-filled as deltas. v09 is closed and archived, v13 is reviewed and archived, and the v08 review is recorded.
- R01-P1-3f: the ETW contradiction is resolved. Kernel trace capture is opt-in, elevated-only, and disclosed.
- R01-P1-3g: the stale "v0.6 deferrals" blocks are replaced by a dated Deferred section (DEF-1..DEF-3).
- R01-P1-3i: the `metrics` Purpose no longer cites "registry v0.4".
- R01-P2-1: the collection requirement is datum-level, with no API names. The remaining requirements are made abstract by their owning change (data-signals-completeness).
- R01-P2-2: non-goals now live in `evidence-surface` as a requirement.
- R01-P2-4: the install/run contract is a requirement.
- R01-P2-6: the "Always-on" purpose line in `tracking` is reworded.
- R01-P2-8: a config.yaml rule says tasks cite requirement names and finding IDs, never source line numbers. Requirement headers stay unchanged, because renaming them would break MODIFIED matching across changes.
- R01-REC-3 (part): ETW opt-in, abstract collectors, and the dated Deferred section. Signal additions belong to data-signals-completeness.
- R01-REC-4 (part): non-goals are added. The hang definition and diagnosis record belong to diagnosis-engine-rebuild.
- R01-REC-5 (part): the always-on purpose is reworded. Workload session, scope qualification, and Responding wording belong to other changes.
- R01-REC-7: back-fill, v09 close/split, v08 re-review record, and archive gates in config.yaml.
- R03-L3-3 (part): the docs that over-claim correlations and the culprit formula are marked "not implemented, see DEF-2". The engine-side replacement belongs to diagnosis-engine-rebuild.
