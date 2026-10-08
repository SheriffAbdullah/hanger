# Telltale

**Hang evidence for machines that gaslight you.**

Your laptop freezes for two seconds while Postgres and Docker are running, and IT replies *"looks fine, show me evidence."*
Telltale watches the machine while it hangs, works out what the numbers say, and hands you a report and a ready-to-send email. Nothing to install, nothing to configure first.

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![platform: Windows 10/11](https://img.shields.io/badge/platform-Windows%2010%2F11-informational)
![dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen)

<!-- Sample output: reports/sample-telltale.md (synthetic data, safe to share) -->

## Why

Intermittent hangs are hard to prove. You can't reproduce them on demand, the ticket needs numbers, and gathering them by hand while the machine is stalling is miserable. Telltale does the gathering and is explicit about what it knows and what it doesn't.

- **Evidence, not a verdict.** It never says "buy more RAM" or decides whether you deserve a new machine. Every number carries a unit, window, sample count and source.
- **Honest causes.** One ranked list of candidate causes, judged at each hang against calm periods, with derived confidence and a "what would disprove this" line. If nothing is supported, it says `no-freeze-observed`.
- **Privacy by declared scope, not redaction.** Run an inventory, choose what Telltale may name, re-run scoped to that. Software outside your scope is recorded only as an anonymous total, never written to disk, logs or the console, and every report opens by stating the scope.
- **It notices hangs you feel.** An automatic check flags moments when you typed or clicked and the app in front didn't answer. It never reads what you type or any window titles.

## Quick start

Requires Windows 10 or 11, Node 18+ and PowerShell 5.1. No admin and no `npm install`.

```powershell
git clone https://github.com/sheriffabdullah/machine-not-sufficient.git
cd machine-not-sufficient

node tools/telltale/telltale.js watch --watch-secs 10            # 10 s sanity check
node tools/telltale/telltale.js inventory --write-scope          # what is running? (local only)
# edit telltale.scope.json: set "enabled": true on what you want monitored
node tools/telltale/telltale.js trace --duration 120 --anonymize # work normally while it records
```

A run writes a report you can send to IT:

| File | What it is |
|---|---|
| `telltale-<stamp>.report.html` | Print-ready report with charts (opens with scope, then the finding) |
| `telltale-<stamp>.md` | Same content as Markdown |
| `telltale-<stamp>.email.txt` | Ready-to-send message; every number is checked against the JSON |
| `telltale-<stamp>.json` | The evidence (schema `telltale-json/2`, frozen) |
| `telltale-<stamp>.jsonl` | Append-only stream written as it measures, so a crash loses nothing |

## What it captures

RAM and commit, per-process CPU and disk I/O, CPU clock and throttling, temperature, battery and AC state, power plan, disk latency and queue, network, GPU, Docker and WSL2 over time, and workload phases (idle vs loaded). A static system profile covers processor, OS build, RAM, disk type, GPU, BIOS, power plan and WSL limits.

## How it decides

Raw observations become numbers, numbers become a reasoned cause list, and presentation is only a renderer. Rules cover memory and commit pressure, hard-fault thrash, CPU saturation, AV contention, thermal and power throttling, Docker/WSL memory, Postgres settings, a single dominant process, driver interrupts and GPU contention. See the [product manifesto](PRODUCT_MANIFESTO.md) and the [user guide](docs/USER-GUIDE.md).

## Documentation

- [User guide](docs/USER-GUIDE.md): modes, scope, signals, diagnosis, outputs and the input-response check
- [Product manifesto](PRODUCT_MANIFESTO.md): what it is, what it refuses to be
- [Schema changelog](tools/telltale/SCHEMA-CHANGELOG.md) and [metric registry](METRIC_REGISTRY.md)
- [Specifications](openspec/specs/): the requirements, written with OpenSpec

## Development

```powershell
node --test tools/telltale/test/     # zero-dependency test suite
openspec validate --all --strict     # spec validation
```

Contributions are welcome. Open an issue before large changes; every behavior change starts as an OpenSpec change under `openspec/changes/`. Changes that touch collection must keep the privacy canary test green.

## Limitations

- Windows only for now; `check-stub` defines the contract a Mac or Linux port must meet.
- A hang is currently measured as slow process start-up plus the input-response check; neither is proof alone, and the report says how many hangs were corroborated.
- Some signals (disk wear, VM platform, some temperatures) need an elevated run and show "unavailable" with a reason otherwise.
- Security products may flag helper processes on managed machines; Telltale falls back and reports what was unavailable.

## License

[MIT](LICENSE)
