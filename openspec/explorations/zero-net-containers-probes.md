# Zero-Net / Containers / Active Probes — Zeroth-Order Surface

No admin, local-first. Supplements `METRIC_REGISTRY.md` + `telltale.js` probeBundle/spawn/docker sections.

## 1. Network (local counters only)

- **Per-process IO Read/Write B/s**: `Get-Counter '\Process(*)\IO Read|Write Bytes/sec'` or `Get-Process` delta. Unit B/s. Cost med (instance remap). Confound: shared `svchost`, short-lived children inflate n.
- **TCP state×process deltas**: `Get-NetTCPConnection` → group State+OwningProcess, join tasklist. Unit count/state. Cost med (~200ms). Confound: TIME_WAIT churn ≠ stall; PID reuse.
- **Gateway/DNS/VPN adapter status**: `Get-NetAdapter Status + Get-NetRoute 0.0.0.0 + VPN MediaState`. Unit enum. Cost low, once/run. Confound: virtual (WSL/vEthernet) always up.
- **TcpClient connect latency**: `TcpClient.ConnectAsync(gateway:80)+Measure`. Unit ms. Cost low. Confound: target throttles; cold SYN vs congestion.
- **Ping**: `Test-Connection -Count 2 gateway/8.8.8.8`. Unit ms/loss%. Cost low. Confound: ICMP deprioritized; Wi-Fi jitter.
- **Resolve-DnsName ms**: `Measure { Resolve-DnsName example.com }`. Unit ms. Cost low. Confound: cache hit masks outage; first query cold.
- **Postgres SELECT 1 ms**: timed `psql -c "SELECT 1"`. Unit ms. Cost low. Confound: cold connection vs query stall.
- **redis-cli PING ms**: timed `redis-cli PING`. Unit ms. Cost low. Confound: cold fork vs eviction stall.

## 2. Containers / WSL / DB memory

- **docker ps vs stats + timeouts**: `docker ps --format` (fast) + `stats --no-stream`, 10s timeout, never gate verdict. Unit text/%/MB. Cost: ps low, stats blocks when frozen. Confound: stats hang IS signal.
- **wsl -l -v**: collector `wsl -l -v`. Unit state/version. Cost low. Confound: stopped distro ≠ freed vmmem.
- **vmmem WS as host proxy**: tasklist `vmmem` WS sum. Unit MB. Cost low. Confound: one VM for all containers; WS includes shared.
- **.wslconfig caps**: read `%USERPROFILE%\.wslconfig` memory/swap. Unit text. Cost once. Confound: needs restart.
- **pg_settings shared_buffers**: `SHOW shared_buffers; max_connections`. Unit MB. Cost low. Confound: OS cache dwarfs setting.
- **Redis INFO memory/maxmemory**: `INFO memory`. Unit MB/% + evicted_keys. Cost low. Confound: fragmentation inflates used.

## 3. Active probes WE run

- **node -e spawn ms**: `sh('node -e ""')` wall ms (telltale 2s). Unit ms. Cost ~30-80ms self-load. Confound: AV cold-start; bundle AFTER spawn.
- **hrtime/setImmediate drift**: 50ms `hrtime→setImmediate` delta. Unit ms. Cost negligible. Confound: sync execSync self-block — supporting only.
- **1ms timer-slack overshoot**: `setTimeout(1)` actual-vs-expected. Unit ms. Cost negligible. Confound: coalescing/power-throttle.
- **echo/cmd baseline**: timed `cmd /c echo ok`. Unit ms. Cost low. Confound: conhost/pty slower than raw spawn.
- **file-read ms**: timed 1MB tmp read. Unit ms. Cost low. Confound: cache hit hides stall.
- **keypress user marks**: stdin raw keypress wall timestamps. Unit timestamps. Cost zero. Confound: ~200ms reaction lag; TTY only.

## 4. Direct inferences → first-order feed

- TCP ok + SELECT slow → local/DB stall, not network. Feed `db.local_stall`.
- Ping/DNS ok + TcpClient slow → target/port block, not link. Feed `net.port_block`.
- IO B/s spike in one PID + spawn 2000ms → that child blocks. Feed `proc.blocker`.
- spawn 2000ms + loop normal → child-spawn/IO, not event-loop. Feed `stall.spawn_io`.
- Loop drift high + spawn normal → event-loop/scheduler. Feed `stall.event_loop`.
- vmmem growth + pages/sec high → WSL paging. Feed `docker.page_pressure`.
- stats timeout + ps ok → daemon frozen. Feed `docker.daemon_frozen`.
- User mark with no probe hang → sub-800ms microfreeze; lower HANG_MS. Feed `hang.threshold_tune`.
