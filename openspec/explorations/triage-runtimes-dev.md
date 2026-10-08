# Triage — runtimes + devtools + data (live 2026-10-07)

| exe | current label (KNOWN) | verdict | live evidence | corrected label or proof-needed |
|---|---|---|---|---|
| node.exe | Node.js runtime | CONFIRMED (on-disk; not running) | Not in Get-Process/tasklist/CIM. On PATH `C:\Program Files\nodejs\node.exe`: Company=[Node.js] Desc=[Node.js JavaScript Runtime] Ver=24.21.0 | Keep label. Live role needs cmdline when running — see dual-behavior flag |
| opencode.exe | opencode AI agent | CORRECTED | 3 live PIDs (6468/8232/19600), path `...\npm\node_modules\@opencode\cli\bin\opencode.exe`; Company=[Oven] Desc=[Bun] Prod=[Bun]. Cmdlines: `serve --service` (19600) vs bare (6468, 8232) | **Bun-compiled opencode agent (service vs interactive)**. One label hides two behaviors — split by cmdline |
| claude.exe | Claude app | CORRECTED | PID 17772, path `...\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`; Company=[Anthropic PBC] Desc=[Claude Code]. Cmdline: `--resume 113f7322-…` | **Claude Code CLI agent (session resume)**, not desktop "Claude app" |
| warp.exe | Warp terminal | CONFIRMED | 2 PIDs (26516/29640), `C:\Users\...\Programs\Warp\warp.exe`; Company=[Denver Technologies, Inc] Desc=[Warp] | Keep label |
| docker.exe | Docker CLI | GUESS (absent) | Not running; not on PATH; no `docker*` service; `C:\Program Files\Docker\…` absent | Proof-needed: `docker ps` / install path. Do not assert CLI present |
| dockerd.exe | Docker daemon | GUESS (absent) | Same as above; plus `vmmem` not running (consistent with no WSL2 VM) | Proof-needed: daemon process or service + `vmmem` co-presence |
| vmmem | Docker WSL2 VM (all containers) | GUESS (absent) | `Get-Process vmmem*` empty; no Docker install | Proof-needed: running `vmmem*` + `docker stats` to confirm Docker vs generic WSL2 |
| postgres.exe | PostgreSQL database | GUESS (absent) | Not running; not on PATH; no `postgresql*` service; `C:\Program Files\PostgreSQL` absent | Proof-needed: service/process + cmdline `dbname=` marker |
| redis-server.exe | Redis cache | GUESS (absent) | Not running; not on PATH; no `redis*` service | Proof-needed: running process + port/conf cmdline |
| chrome-headless-shell.exe | Playwright Chromium (headless) | GUESS (absent, no Playwright) | No such process. Full-CIM cmdline scan for `playwright\|user-data-dir\|chrome-headless`: zero `playwright` hits — only Edge/WebView2 `user-data-dir` (SearchHost/Widgets) + Edge crashpad | Proof-needed: live `chrome-headless-shell.exe` cmdline containing `playwright` marker. Label is aspirational until then |

Dual-behavior flag: `node.exe` per `appLabel` (telltale.js:387-391) collapses three roles into one label — plain script (`Node: <file>.js`), Playwright runner (`/playwright/i`), worker thread (shares parent cmdline, indistinguishable). Any future `node.exe` row must carry its cmdline; `opencode.exe` same (serve vs interactive above); `claude.exe` same (`--resume <session>` vs fresh).
