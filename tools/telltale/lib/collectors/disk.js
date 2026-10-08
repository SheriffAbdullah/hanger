'use strict';
// Disk transfer latency (ms), queue, busy %, and read/write throughput (system total).
const { one, unavailable } = require('./common');

const COUNTERS = ['\\PhysicalDisk(_Total)\\Avg. Disk sec/Transfer', '\\PhysicalDisk(_Total)\\Current Disk Queue Length', '\\PhysicalDisk(_Total)\\% Idle Time',
  '\\PhysicalDisk(_Total)\\Disk Read Bytes/sec', '\\PhysicalDisk(_Total)\\Disk Write Bytes/sec'];

function build(idx, { mk }) {
  const sec = one(idx, 'physicaldisk', 'avg. disk sec/transfer');
  const queue = one(idx, 'physicaldisk', 'current disk queue length');
  const idle = one(idx, 'physicaldisk', '% idle time');
  const rd = one(idx, 'physicaldisk', 'disk read bytes/sec');
  const wr = one(idx, 'physicaldisk', 'disk write bytes/sec');
  const busy = idle === null ? null : Math.min(100, Math.max(0, 100 - idle));
  const src = (k) => `disk.${k}@counterSession`;
  const disk = {
    latencyMs: mk(sec === null ? null : sec * 1000, 'ms', { prec: 0.1, src: src('latencyMs') }),
    queue: mk(queue, 'count', { prec: 0.1, src: src('queue') }),
    busyPct: mk(busy, '%', { prec: 1, src: src('busyPct') }),
    readBps: mk(rd, 'bytes/s', { prec: 1, src: src('readBps') }),
    writeBps: mk(wr, 'bytes/s', { prec: 1, src: src('writeBps') }),
  };
  const failures = [];
  const present = { latencyMs: sec, queue, busyPct: idle, readBps: rd, writeBps: wr };
  for (const [k, v] of Object.entries(present)) if (v === null) failures.push(unavailable('signals.disk', `disk.${k}`, 'not-exposed', `${k} counter returned no value`));
  return { disk, failures };
}

module.exports = { COUNTERS, build, id: 'signals.disk', inference: 'disk.latency' };
