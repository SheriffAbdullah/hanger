# Change: telltale-v08 — drill-down attribution + redaction/focus (presentation)

## Why
Two presentation gaps block real use: (1) process names don't answer "WHICH Node?
which container? which DB?" — no drill-down from exe → app → instance; (2) evidence
packs leak unsanctioned tools (Claude, personal apps) and drown signal in noise —
no way to hide processes or focus on a watchlist (docker, node, teams, db) with
extras opt-in. Both are presentation-layer (no new collectors, except reusing
CommandLine + docker stats we already can reach).

## What Changes
- Drill-down: CommandLine capture for top processes → app labels
  (`Node: server.js`, `Postgres: dbname`, `Playwright Chromium`, per-container
  Docker rows when daemon responsive); MD culprits table gains App/Detail column.
- Redaction: `--hide patt,ern` drops matches from MD/HTML/JSON (count + MB noted,
  never silent); `--focus a,b` keeps watchlist front, collapses rest into one
  "other" row; `--extras show|hide` (default: show unfocused, hide focused).
- Interactive `--extras ask` when TTY: "monitor extra processes?" prompt.
