# Design

## Context

See proposal.md (Why). Constraints inherited from earlier waves:
- `sampling-engine-and-provenance` supplies a long-lived sampler and a collector registration interface. Each collector declares a weight, a budget, and a cadence. Every value carries provenance `{unit, windowS, n, source, measuredAt, precision}`. Gaps are recorded as unobserved intervals. Collectors here register through that interface and never edit the sampler core. This avoids conflicts with `data-signals-completeness`, which runs in parallel.
- `software-inventory-and-scope` supplies the scope file and the single resolver. Every process name, container name, image name, or distro name passes through the resolver before it is stored or printed. Out-of-scope items contribute only anonymous aggregates.
- `fix-report-integrity` supplies incremental (append-only) persistence and the wall-clock timebase.

## Goals / Non-Goals

**Goals:**
- Make the owner's scenario (Postgres plus Docker) observable over time, with workload context next to every hang.
- Give a workload-side freeze signal that diagnosis can use as a confirmation source.
- Provide the inputs for the VM memory dominance and database memory/I/O rules.

**Non-Goals:**
- No in-container profiling (per-query stats, guest process lists).
- No storage of credentials, and no prompting for passwords.
- No cause inference here. Rules live in `diagnosis-engine-rebuild` and `diagnosis-cause-rules`.
- No per-container network or block-I/O series in this change (they may be added later through the same registration).

## Decisions

1. **Phases are user-declared, not inferred.** The user presses a key (e.g. `p`) to toggle a phase with the label from `--phase <label>`, or from the scope file `phases` list in order. A plain start/stop flag pair (`--phase loaded` at launch) opens a phase at run start.
   *Alternative:* infer "loaded" from CPU or memory thresholds. Rejected: that is circular, because diagnosis would compare a phase defined by the signal it compares.
2. **Phase bounds are persisted immediately** as stream records, so an interrupted run still shows which phase the hang fell in (reuses the incremental persistence from `fix-report-integrity`).
3. **Idle vs loaded comparison is computed in the run summary** per signal: mean, p95, n per side, and the unobserved seconds per side. Time outside any phase is "untagged" and is never merged into either side.
4. **Container series run at a bounded cadence** (default every 10 s, budget 3 s per call). This is a heavy collector, and the registration interface enforces its budget. A call that exceeds its budget yields a null sample with reason `timeout` and backs off (doubling the interval up to 60 s).
   *Alternative:* sample at the 2 s continuous cadence. Rejected: the daemon call is too expensive on a starved box.
5. **Lifecycle markers come from diffing successive in-scope snapshots** (process PID + creation time, container id + start time). Only in-scope items are diffed. Out-of-scope items are filtered before the diff, so their lifecycle never exists in memory as records.
   *Alternative:* subscribe to a daemon event stream. Allowed as a hint, but the diff is the baseline because it also works for native processes.
6. **VM visibility is layered.** (a) The host-side VM memory, always available when the VM host process runs (it is in the always-monitored system set, OQ-2). (b) The configured VM memory cap, read from user config. (c) Guest-reported total/used memory, only if the guest is already running. The tool never starts a stopped distro or VM.
7. **Latency probe** (OQ-7 default): opt-in per scope-file entry. The command is an argv array (no shell string). The tool records wall time to exit and the exit status class (ok / nonzero / timeout / not-found). Output is discarded and never logged. Timeout is 5 s by default. The probe is never elevated. The probe stops after 3 consecutive not-found results and records that reason.
8. **Configuration facts are opt-in and credential-free.** A database fact is read only when its database is in scope and reachable through the user's existing environment (e.g. passwordless local auth or an existing service file). If authentication is needed, the result is `unavailable: authentication required (credentials are never stored)`.

## Data / schema shape

Scope-file extension (additive):
```json
{
  "phases": ["idle", "loaded"],
  "probes": [{ "name": "pg-select1", "command": ["psql", "-h", "localhost", "-c", "select 1"], "timeoutMs": 5000, "everySec": 5 }],
  "config": [{ "kind": "postgres", "connection": "host=localhost port=5432" }, { "kind": "wsl" }]
}
```
`connection` is a non-secret hint. Any key named like `password`/`pwd`/`secret` is rejected at load with a message.

Report (JSON, `hanger-json/2`, changelog `2.x` additive):
```json
"workload": {
  "phases": [{ "label": "loaded", "startAt": "ISO", "endAt": "ISO|null", "source": "key|flag|scope-file" }],
  "phaseSummary": { "<signalId>": { "idle": {"mean":0,"p95":0,"n":0,"unobservedS":0}, "loaded": {"...":0}, "untaggedN": 0 } },
  "markers": [{ "at": "ISO", "kind": "process-start|process-exit|container-start|container-stop", "name": "<in-scope label>", "id": "pid:creation|container-short-id" }],
  "containers": { "series": [{ "at": "ISO", "name": "<in-scope>", "cpuPct": 0, "memUsedMB": 0, "memLimitMB": 0 }],
                  "outOfScope": [{ "at": "ISO", "count": 0, "cpuPct": 0, "memUsedMB": 0 }],
                  "unavailable": null, "provenance": {"unit":"...","windowS":10,"source":"container-runtime"} },
  "vm": { "hostMemMB": [{ "at": "ISO", "value": 0 }], "configuredCapMB": { "value": null, "unavailableReason": "no cap configured (default applies)", "source": "user VM config" },
          "guestMem": { "value": null, "unavailableReason": "VM not running" } },
  "probes": { "pg-select1": [{ "at": "ISO", "ms": 0, "status": "ok|nonzero|timeout|not-found" }] },
}
"workloadConfig": [{ "kind": "postgres", "fact": "shared_buffers", "value": "128MB", "source": "database settings", "unavailableReason": null },
                   { "kind": "wsl", "fact": "memoryCapMB", "value": 8192, "source": "user VM config", "unavailableReason": null }]
```
Opt-in configuration facts (database memory settings, configured WSL memory cap) live under the top-level report key `workloadConfig` (not under `workload`). `system-profile-for-it` references this key through its `workloadConfigRef` pointer, so the key name and the fact record shape are a stable interface.
Plain-language reasons use a fixed vocabulary: `not installed`, `not running`, `unresponsive (timed out after N s)`, `not visible at user tier`, `authentication required (credentials are never stored)`, `not declared in scope`.

## Non-binding implementation hints

- Containers: `docker stats --no-stream --format "{{json .}}"` and `docker ps --format "{{json .}}"`. `docker events --since/--until --filter type=container` may supplement the snapshot diff. Map "not recognized" / ENOENT → `not installed`, and "cannot connect to the Docker daemon" → `not running`.
- VM host memory: the `vmmem`/`VmmemWSL` working set from the existing process collector (system set).
- WSL: `wsl.exe -l -v` (output is UTF-16LE; decode it) for running state. `%UserProfile%\.wslconfig` `[wsl2] memory=` for the cap. If the distro is running, `wsl.exe -d <distro> -e cat /proc/meminfo` for guest memory. Only when the distro is in scope or the cap is requested; never start a distro.
- Postgres: `psql -XAt -c "SHOW shared_buffers" -c "SHOW work_mem" -c "SHOW max_connections"` using the connection hint plus `PGCONNECT_TIMEOUT=3`. If the database runs in a container, use `docker exec <in-scope container> psql ...`.
- Run probes with `child_process.spawn(argv[0], argv.slice(1), { shell: false, windowsHide: true, stdio: 'ignore' })` and a kill-on-timeout.

## Risks / Trade-offs

- [Credentials leak via the scope file or a probe command] → Reject secret-like keys at load. The command is never echoed to console, logs, or the report (only its `name`). Output is discarded.
- [Command injection through the probe command] → argv array only, no shell, and never elevated. A scope file whose command is a string is rejected.
- [Docker daemon hangs and stalls the sampler] → Hard timeout per call, child killed on timeout, exponential back-off, collector weight heavy with a budget. A null with reason `unresponsive` is itself evidence.
- [Container names outside scope leak] → Resolver filtering before any record is built. The canary test includes a canary container name when Docker is present.
- [Probe adds load during a hang (observer effect)] → Default `everySec` ≥ 5. Probe wall time is counted in observer cost. Diagnosis treats a probe timeout as a confirmation only together with the generic probe.
- [Guest memory unavailable on most runs] → Layered design. Host-side VM memory and the cap are enough for the VM dominance rule.

## Migration

Additive only. Old scope files without `phases/probes/config` behave as before. Reports gain `workload`, and readers that ignore unknown keys are unaffected. No rollback steps beyond reverting the change.

## Open Questions

- OQ-7 (owner): may the tool run a user-declared workload command? Default used here: **yes, opt-in in the scope file, timing only, output discarded, 5 s timeout, never elevated.**
