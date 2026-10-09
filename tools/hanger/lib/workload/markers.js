'use strict';
// Lifecycle markers: diff successive IN-SCOPE snapshots of processes and containers.
// Out-of-scope items are dropped by the scope resolver BEFORE the diff, so their lifecycle never exists
// as records in memory, the stream, the report or the console.
//   marker: {at, kind: process-start|process-exit|container-start|container-stop, name, id}
// A process is identified by pid + creation time when the snapshot has one, else pid + image name (a pid
// that reappears under another image counts as an exit and a start). A container by its short id.

const shortId = (id) => String(id || '').slice(0, 12);

function createMarkerTracker({ resolver, now = () => new Date(), sink = null, includeProcesses = true } = {}) {
  const prev = { process: null, container: null };
  const markers = [];
  const emit = (kind, name, id, atIso) => {
    const m = { at: atIso, kind, name, id };
    markers.push(m);
    if (sink) sink.append('wl-marker', m);
    return m;
  };

  // rows: [{name, pid, ct?}]; the first snapshot is the baseline (no marker for what was already running)
  function observeProcesses(rows, atMs = now().getTime()) {
    if (!includeProcesses) return [];
    const cur = new Map();
    for (const r of rows || []) {
      if (!r || !r.name) continue;
      const c = resolver.classifyName(r.name);
      if (c !== 'in') { if (c === 'out') resolver.noteOutName(r.name); continue; } // system set is not workload lifecycle
      cur.set(`${r.pid}:${r.ct !== undefined ? r.ct : String(r.name).toLowerCase()}`, { name: r.name, pid: r.pid });
    }
    const out = [];
    const iso = new Date(atMs).toISOString();
    if (prev.process) {
      for (const [k, v] of cur) if (!prev.process.has(k)) out.push(emit('process-start', v.name, `pid:${v.pid}`, iso));
      for (const [k, v] of prev.process) if (!cur.has(k)) out.push(emit('process-exit', v.name, `pid:${v.pid}`, iso));
    }
    prev.process = cur;
    return out;
  }

  // containers: [{id, name, image?}] of the running set. Caller passes only a successful poll (a failed
  // poll must not look like "everything stopped"). inScopeFn decides membership (name or image).
  function observeContainers(containers, inScopeFn, atMs = now().getTime()) {
    const cur = new Map();
    for (const c of containers || []) {
      if (!c || !c.id) continue;
      if (!inScopeFn(c)) continue;
      cur.set(shortId(c.id), { name: c.name });
    }
    const out = [];
    const iso = new Date(atMs).toISOString();
    if (prev.container) {
      for (const [k, v] of cur) if (!prev.container.has(k)) out.push(emit('container-start', v.name, k, iso));
      for (const [k, v] of prev.container) if (!cur.has(k)) out.push(emit('container-stop', v.name, k, iso));
    }
    prev.container = cur;
    return out;
  }
  return { observeProcesses, observeContainers, markers };
}

module.exports = { createMarkerTracker, shortId };
