# Workflow — explore → argue → fold → build (Hanger data ladder)

## Phase 1 — EXPLORE (now, divergent, no killing ideas)
1. Survey exists: `openspec/explorations/zero-*.md` (4 surfaces) + `orders-framework.md`.
2. Index it: `survey-index.md` — full inventory, overlap map, depth-probe backlog.
3. Probe deeper where indexed gaps are: thermal/throttle, standby-cache lists,
   container/DB runtime introspection (separate files, parallel agents).

## Phase 2 — ARGUE (convergent, the tribunal)
For every datapoint: cost/sample × signal strength × confound load → KEEP / KILL /
DEFER, one line each with reason. Recorded in `openspec/explorations/dividend.md`.
Rule: killing requires naming the cheaper substitute. Nothing killed silently.

## Phase 3 — FOLD (proposal)
Winners → `openspec/changes/hanger-v06/proposal.md` + tasks. Spec SHALLs updated;
losers stay listed as rejected-with-reason (not deleted).

## Phase 4 — BUILD (gated)
Implement → smoke (watch + trace) → review agent (approve/conditional/reject per item)
→ fix → `openspec archive`. Then the next survey round.

Gates: no phase starts without the previous artifact committed.
