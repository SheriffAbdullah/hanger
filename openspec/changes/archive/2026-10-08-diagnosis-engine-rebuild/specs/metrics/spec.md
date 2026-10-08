## REMOVED Requirements

### Requirement: Culprit attribution capped below certainty (vNext: exact 0.4/0.3/0.2/0.1 formula; now: provisional ranked RCA, conf capped 0.85)
**Reason**: The heading (cap 0.85) and its scenario (at most 0.95) contradict each other. The confidences in code are hand-set constants, and the 0.4/0.3/0.2/0.1 formula was never built. The cost clause relied on a default-assumed 45 min/day.
**Migration**: Confidence is now specified by `diagnosis` "Confidence derived from evidence" (derived components, cap 0.95). Time-lost is specified by `diagnosis` "Time-lost context uses measured inputs only". The fixed-weight culprit formula and lagged correlation are deferred (IMPLEMENTATION-PLAN DEF-2).

### Requirement: Ordered RCA procedure with disprovers
**Reason**: The disprovers were prose strings that were never evaluated. The memory check used the trace-wide commit peak instead of the hang window.
**Migration**: Specified by `diagnosis` "Cause rule contract", "Disprovers are evaluated", "Observer-affected probes excluded from inference", "Memory pressure at the hang rule", "CPU saturation rule", "Disk stall rule", and "Security-software contention rule".
