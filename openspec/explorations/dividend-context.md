# Dividend Context — Tribunal Verdict (Power + Proc-Identity + OS-Events + Net + Container/DB + Probes)

Owner pain first: "plugged in, still hangs" must be answerable every sample; zero unknown names; local-vs-network stall must split; frozen-daemon must still yield signal.

## Verdicts — KEEP / KILL / DEFER + reason (cost × signal × confound)

**Power:** KEEP scheme GUID+name — ~200ms once/run, proves HP-Optimized cap story. KEEP plug+battery% — ~300ms, enables AC-vs-BAT refutation. KEEP Win32_Battery+BatteryStatus — ~400ms once/run, discharge-rate truth. KEEP AC/DC derived — free, feeds throttle rule. KEEP maxFreq+clocks — bundled/cheap, EC-cap detector. DEFER ThermalZone — often invisible, confirm visibility first.
**Identity:** KEEP tasklist rollup — 200–500ms, one call feeds four domains. KEEP Get-Process Responding+Path — ~500ms, only OS-confirmed hung set. KEEP FileDescription+Source top-8 + unresolved flag — ~400ms, kills unknown-name pain. KEEP svchost -s split — ~300ms on-HANG, stops host-aggregate blame. DEFER Win32_Process CommandLine depth≤3 — ~500ms + secret-redaction burden, take only on-HANG. KILL Sysmon ID1/ID5 as required — install-gated luxury; substitute tasklist spawn-delta.
**OS events:** KEEP App 1002 hang rows — ~500ms, ±60s corroboration. KEEP App 1000/1001 crash+bucket — same call batch, crash-vs-hang split. KEEP System 2004/41 — cheap, exhaustion-vs-reboot split. KEEP WER counts only — ~400ms, history-prior with no dump cost. KILL WLAN/DNS channels as routine — PII (SSID/host) × on-demand; substitute adapter/gateway enum. DEFER RAC store — location note only until reader exists.
**Network:** KEEP TCP state×proc deltas — ~200ms, TIME_WAIT churn discounted by join. KEEP SELECT 1 + redis PING — ms each, TCP-ok-but-SELECT-slow = local stall proof. KEEP adapter/gateway/VPN enum — low once/run, link-vs-port split. KEEP TcpClient-connect — cheap, port-block detector. KILL per-proc IO B/s routine — med cost + svchost/remap confound; substitute TCP+SELECT split. DEFER ping/DNS-resolve — ICMP-deprioritized + cache-hit confounds; on-demand only.
**Container/DB:** KEEP docker ps + vmmem WS — low, survives daemon freeze. KEEP wsl -l -v + .wslconfig — cheap, cap-hit story. KEEP pg_settings + Redis INFO memory — ~ms, tuned-small/evict signals. KILL docker stats routine — blocks when frozen; substitute ps+vmmem trend. KILL full docker-inspect sweep — 4 fields × containers luxury; substitute ps -a + SELECT 1/PING. DEFER pg_stat_activity/bgwriter + Redis persistence/keyspace — ~5ms but needs timeout discipline; take on-HANG only.
**Probes:** KEEP node spawn ms — 30–80ms, IS the hang. KEEP 1ms timer-slack — negligible, spawn-vs-loop splitter. KEEP echo + file-read baselines — cheap, IO-vs-spawn split. KEEP user marks — zero cost, threshold calibrator. DEFER hrtime drift — self-block confound, supporting-only. KILL --report routine — opt-in self-OOM only; substitute process.memoryUsage flat-heap check.

Luxury questioned: per-engine GPU full `(*)`, Sysmon channel, full inspect — all high-cost/low-coverage vs substitutes above.

## Kept set — registry-ready rows

`power.scheme/plugged/batteryPct/maxFreq` | `proc.rollup/identity+unresolved/svcGroup/oshung_responding[]` | `sys.event_hang/crash/exhaust/boot41 + wer_apphang_total` | `net.tcp_by_state + db.select1_ms/redis_ping_ms + link.enum` | `docker.ps/vmmem_ws/wsl_state/wslconfig + db.pg_tuned_small/redis_mem` | `probe.spawn_ms/timer_slack/echo/file_read + user.marks[]` → `hang.context[±10s]` + RCA step 5.
