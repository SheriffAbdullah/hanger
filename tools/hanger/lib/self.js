'use strict';
// Self-exclusion by PID set: the tool, and every process it spawned, must never appear
// as a culprit. Their cost is reported separately as `observer`.
const selfPids = new Set([process.pid]);

const registerPid = (pid) => { if (Number.isFinite(pid) && pid > 0) selfPids.add(pid); };
const isSelf = (pid, set = selfPids) => set.has(Number(pid));
const listSelfPids = () => [...selfPids];

// rows: [{name, pid, memMB}]. Returns the rows without self PIDs plus the observer tally.
function excludeSelf(rows, set = selfPids) {
  const kept = [], mine = [];
  for (const r of rows) (set.has(Number(r.pid)) ? mine : kept).push(r);
  return { rows: kept, observer: { n: mine.length, wsMB: mine.reduce((a, r) => a + (r.memMB || 0), 0), pids: mine.map((r) => r.pid) } };
}

// also drop descendants of any self PID (rows carry ppid, e.g. the CIM snapshot)
function excludeSelfTree(rows, set = selfPids) {
  const all = new Set(set);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows) {
      if (!all.has(Number(r.pid)) && all.has(Number(r.ppid))) { all.add(Number(r.pid)); grew = true; }
    }
  }
  return rows.filter((r) => !all.has(Number(r.pid)));
}

module.exports = { registerPid, isSelf, listSelfPids, excludeSelf, excludeSelfTree, selfPids };
