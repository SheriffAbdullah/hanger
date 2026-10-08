# Deep Runtime Introspection — Daemon-Frozen Fallbacks

Supplements `zero-net-containers-probes.md`. Signals readable when `docker stats` hangs. Rule: `inspect` (file-backed), one-shot SQL/INFO, host proxies. Never attach to user/Chromium PIDs.

## 1. Docker inspect (survives stats-freeze)

One call/container, 5s timeout, cache 30s.

- **Memory/MemorySwap limits**: Coll `docker inspect -f {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}`. Cost ~50ms. Down: use vmmem trend (§4) + `.wslconfig`. Infer: 0/unset = uncapped, growth is host-wide → feed `docker.mem_unbounded`.
- **OOMKillDisable + OOMKilled**: Coll `{{.HostConfig.OomKillDisable}} {{.State.OOMKilled}} {{.State.ExitCode}}`. Cost low. Down: Chromium exit-137 as proxy. Infer: OOMKilled + 137 = memory kill, not app bug → feed `docker.oom_kill`.
- **RestartCount + StartedAt**: Coll `{{.RestartCount}} {{.State.StartedAt}} {{.State.FinishedAt}}`. Cost low. Down: `docker ps -a` or PG reconnect storm. Infer: rising count + short deltas = crashloop → feed `docker.crashloop`.
- **Health status**: Coll `{{.State.Health.Status}}`. Cost low. Down: direct `SELECT 1` / `redis-cli PING`. Infer: `unhealthy` + port open = in-container dependency stall → feed `docker.unhealthy`.

## 2. Postgres — one connection, statement_timeout 2s

- **pg_settings**: Coll `SELECT name,setting FROM pg_settings WHERE name IN ('shared_buffers','work_mem','max_connections')`. Cost ~5ms. Down: last-known + `SELECT 1` latency. Infer: tiny buffers + many conns = churn → feed `db.pg_tuned_small`.
- **pg_stat_activity**: Coll `SELECT state,wait_event_type,count(*) FROM pg_stat_activity GROUP BY 1,2`. Cost ~5ms. Down: refused-vs-timeout class only. Infer: `Lock/LWLock` waits = contention; many `idle in transaction` = Node/Playwright leak → feed `db.pg_contention`.
- **pg_stat_database**: Coll `SELECT conflicts,deadlocks,blks_hit,blks_read FROM pg_stat_database WHERE datname=current_database()`. Cost ~5ms. Down: unknown, do not infer. Infer: deadlocks/conflicts delta >0 = retry-path stall → feed `db.pg_deadlock`.
- **bgwriter/checkpointer**: Coll `SELECT checkpoints_timed,checkpoints_req FROM pg_stat_bgwriter` (`pg_stat_checkpointer` PG17+). Cost ~5ms. Down: file-write probe. Infer: `checkpoints_req` surging = checkpoint pressure on artifact writes → feed `db.pg_checkpoint`.

## 3. Redis — one INFO call, 2s timeout

Coll `INFO memory persistence keyspace stats`.

- **memory**: Fields `used_memory,maxmemory,mem_fragmentation_ratio,evicted_keys`. Cost ~2ms. Down: our heap trend (§5) to exonerate CLI. Infer: frag >1.5 = allocator waste; evicted delta >0 = eviction stall → feed `db.redis_evict`.
- **persistence**: Fields `rdb_bgsave_in_progress,aof_rewrite_in_progress,rdb_last_bgsave_status`. Cost ~2ms. Down: host IO B/s spike as fork proxy. Infer: bgsave=1 + PING slow = fork latency → feed `db.redis_fork`.
- **keyspace/stats**: Fields `keyspace_hits,keyspace_misses,expired_keys`. Cost ~2ms. Down: none. Infer: misses≫hits = cache-thrash hitting PG → feed `db.cache_thrash`.

## 4. WSL aggregate proxy

- **.wslconfig**: Coll read `%USERPROFILE%\.wslconfig` once/run. Cost ~0. Down: assume 50% RAM default. Infer: vmmem near cap = WSL throttling everything → feed `wsl.cap_hit`.
- **wsl -l -v**: Coll states/versions. Cost ~100ms. Down: vmmem presence = VM alive. Infer: `Stopped` + vmmem high = unreclaimed, not leak → feed `wsl.stopped_held`.
- **vmmem WS trend**: Coll 3× tasklist `vmmem` WS samples. Cost low. Down: none — this IS the fallback. Infer: monotonic rise = aggregate pressure → feed `docker.page_pressure`.

## 5. Node self-only

- **process.memoryUsage**: Coll own CLI `heapUsed/rss` at probe start/end. Cost ~0. Down: n/a. Infer: flat heap + slow spawn = external stall → feed `stall.external`.
- **--report**: Coll `process.report.getReport()` on our crash only. Cost opt-in. Down: off. Infer: our OOM triage only, never Playwright PIDs → feed `stall.self_oom`.
