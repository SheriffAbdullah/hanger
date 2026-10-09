'use strict';
// Workload phases: user-declared (never inferred from the signals they are compared on).
// Every bound is appended to the run stream the moment it occurs, so an interrupted run still shows which
// phase a hang fell in. Reports are rebuilt from the stream records:
//   {type:'wl-phase', action:'start'|'end', label, at, source:'key'|'flag'|'scope-file'}
const { pct } = require('../numbers');

const round = (v, d = 2) => +Number(v).toFixed(d);

// labels: queue of labels used by successive key presses (the --phase flag, else the scope file's phases).
// The last label repeats when the queue runs out.
function createPhases({ labels = [], labelSource = 'scope-file', now = Date.now, sink = null } = {}) {
  const queue = labels.slice();
  let used = 0, open = null;
  const toIso = (ms) => new Date(ms).toISOString();
  const emit = (r) => { if (sink) sink.append('wl-phase', r); return r; };
  const nextLabel = () => {
    const l = queue.length ? queue[Math.min(used, queue.length - 1)] : `phase-${used + 1}`;
    used++;
    return l;
  };
  function start(source, label, atMs = now()) {
    if (open) end(source, atMs); // a new phase closes the previous one at the same instant
    open = { label: label || nextLabel(), source };
    return emit({ action: 'start', label: open.label, at: toIso(atMs), source });
  }
  function end(source, atMs = now()) {
    if (!open) return null;
    const r = emit({ action: 'end', label: open.label, at: toIso(atMs), source });
    open = null;
    return r;
  }
  // phase key: opens the next labelled phase, or closes the open one
  function toggle(atMs = now()) { return open ? end('key', atMs) : start('key', undefined, atMs); }
  // a flag-opened phase at run start (--phase-now)
  function startAtRun(atMs = now()) { return start('flag', undefined, atMs); }
  return { start, end, toggle, startAtRun, get open() { return open ? { ...open } : null; }, labelSource };
}

// stream records -> phases [{label, startAt, endAt|null, endStatus, source}]
function phasesFromRecords(recs) {
  const out = [];
  let cur = null;
  for (const r of recs.filter((x) => x.type === 'wl-phase').sort((a, b) => (a.at < b.at ? -1 : 1))) {
    if (r.action === 'start') {
      if (cur) { cur.endAt = null; cur.endStatus = 'unfinished'; out.push(cur); }
      cur = { label: r.label, startAt: r.at, endAt: null, endStatus: 'unfinished', source: r.source };
    } else if (r.action === 'end' && cur && cur.label === r.label) {
      cur.endAt = r.at; cur.endStatus = 'closed'; out.push(cur); cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// signals: {id: [{atMs, v}]}; gaps: [{start, end}] ISO; runEndMs closes an unfinished phase for sample matching.
// Untagged samples (inside no phase) are counted and never merged into any label's side.
function phaseSummary(phases, signals, { gaps = [], runEndMs = null } = {}) {
  if (!phases.length) return null;
  const spans = phases.map((p) => ({ label: p.label, a: Date.parse(p.startAt), b: p.endAt ? Date.parse(p.endAt) : (runEndMs !== null ? runEndMs : Date.parse(p.startAt)) }));
  const labels = [...new Set(phases.map((p) => p.label))];
  const unobs = {};
  for (const l of labels) {
    unobs[l] = round(spans.filter((s) => s.label === l).reduce((tot, s) => tot + gaps.reduce((a, g) => {
      const lo = Math.max(s.a, Date.parse(g.start)), hi = Math.min(s.b, Date.parse(g.end));
      return a + (hi > lo ? (hi - lo) / 1000 : 0);
    }, 0), 0), 1);
  }
  const out = {};
  for (const [id, pts] of Object.entries(signals)) {
    const sides = {};
    for (const l of labels) sides[l] = [];
    let untagged = 0;
    for (const p of pts) {
      if (!Number.isFinite(p.v)) continue;
      const hit = spans.find((s) => p.atMs >= s.a && p.atMs <= s.b);
      if (hit) sides[hit.label].push(p.v); else untagged++;
    }
    const row = {};
    for (const l of labels) {
      const v = sides[l];
      row[l] = v.length ? { mean: round(mean(v)), p95: round(pct(v, 95)), n: v.length, unobservedS: unobs[l] } : { mean: null, p95: null, n: 0, unobservedS: unobs[l] };
    }
    row.untaggedN = untagged;
    out[id] = row;
  }
  return out;
}

module.exports = { createPhases, phasesFromRecords, phaseSummary };
