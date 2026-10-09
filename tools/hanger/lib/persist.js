'use strict';
// Append-only JSONL run stream: one record per line, flushed per record, so a hang,
// Ctrl+C or reboot never loses what was already measured.
const fs = require('fs');
const path = require('path');

function openStream(file) {
  const fd = fs.openSync(file, 'a');
  let closed = false;
  return {
    file,
    append(type, rec) {
      if (closed) return;
      try { fs.writeSync(fd, JSON.stringify({ type, ...rec }) + '\n'); } catch { /* disk full etc: keep running */ }
    },
    close() {
      if (closed) return;
      closed = true;
      try { fs.closeSync(fd); } catch { /* already closed */ }
    },
  };
}

// Read a stream; bad lines (e.g. a torn last write) are counted, never fatal.
function readStream(file) {
  const records = [];
  let bad = 0;
  for (const ln of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!ln.trim()) continue;
    try { records.push(JSON.parse(ln)); } catch { bad++; }
  }
  return { records, badLines: bad };
}

const strip = (r) => { const { type, ...rest } = r; void type; return rest; };

// records -> run state (same arrays the live loop holds in memory)
function stateFromRecords(records) {
  const start = records.find((r) => r.type === 'run-start') || null;
  const end = [...records].reverse().find((r) => r.type === 'run-end') || null;
  return {
    start, end,
    samples: records.filter((r) => r.type === 'sample').map(strip),
    probes: records.filter((r) => r.type === 'probe').map(strip),
    marks: records.filter((r) => r.type === 'mark').map(strip),
    failures: records.filter((r) => r.type === 'failure').map(strip),
    hangs: records.filter((r) => r.type === 'hang').map(strip),
    csamples: records.filter((r) => r.type === 'csample').map(strip),
    gaps: records.filter((r) => r.type === 'gap').map(strip),
    heavyRuns: records.filter((r) => r.type === 'heavy').map(strip),
    sampling: [...records].reverse().find((r) => r.type === 'sampling') || null,
    lag: [...records].reverse().find((r) => r.type === 'lag') || null,
    patches: records.filter((r) => r.type === 'probe-patch').map(strip),
    powerTransitions: records.filter((r) => r.type === 'power-transition').map(strip),
    signals: strip([...records].reverse().find((r) => r.type === 'signals') || { type: 'signals' }),
    inputHelper: strip([...records].reverse().find((r) => r.type === 'input-helper') || { type: 'input-helper' }),
    inputHelperExit: (([...records].reverse().find((r) => r.type === 'input-helper-exit')) ? strip([...records].reverse().find((r) => r.type === 'input-helper-exit')) : null),
    wl: records.filter((r) => typeof r.type === 'string' && r.type.startsWith('wl-')), // workload session records (type kept)
  };
}

// probe-patch records add post-hoc fields to a probe already written (matched by its `at`)
function applyPatches(state) {
  if (!state.patches || !state.patches.length) return state;
  const byAt = new Map(state.probes.map((p) => [p.at, p]));
  for (const { at, patch } of state.patches) { const p = byAt.get(at); if (p && patch) Object.assign(p, patch); }
  return state;
}

function recover(streamFile) {
  const { records, badLines } = readStream(streamFile);
  const state = applyPatches(stateFromRecords(records));
  return { ...state, inputHelper: Object.keys(state.inputHelper).length ? state.inputHelper : null, badLines, streamName: path.basename(streamFile), streamDir: path.dirname(path.resolve(streamFile)) };
}

module.exports = { openStream, readStream, stateFromRecords, recover };
