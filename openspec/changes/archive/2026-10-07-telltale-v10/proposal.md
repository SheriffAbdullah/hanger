# Change: telltale-v10 — CLI-first tool, one demographic, backend moat

## Why
Demographic: Windows dev, Docker + Node + Playwright, 8-16GB box, must prove
hangs to management. They live in the terminal — MD/HTML packs are attachments,
not the product. Strategy: CLI prints the evidence live (tables, HANG rows,
STATE card); files stay as receipts. Moat = backend depth nobody else bothers
with on Windows: PPID-closure attribution, EcoQoS per-PID, weight-policy
auto-degrade, timestamped hang events with power truth, collector↔inference
contract (mac-stub). Presentation stays thin by design.

## What Changes
- `trace`/`watch` render live CLI tables (per-probe sparkline, HANG banners,
  end-of-run STATE card with reasons + top culprits + power line); files unchanged
- Sensible defaults for the demographic: 60s trace, scope presets
  (`--preset dev|plain`: dev = node/docker/postgres/redis/chromium/warp)
- Backend moat (no new UI): watch-trigger auto-trace, multi-trace trend compare
  (`telltale trend`), JSON schema v1 freeze + changelog, single-flight collector
  cache (one CIM/WMI walk shared per snapshot round)
- Docs: README as the 60-second pitch (problem → one command → evidence);
  honesty items from v0.9 ride along (n-disclosure, cost basis, receipts)
