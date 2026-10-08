'use strict';
// Container visibility over time. One poll = `docker ps` (id, name, image) + `docker stats --no-stream`
// (CPU %, memory used / limit), both time-bounded. Raw output is parsed here and dropped; only in-scope
// containers keep names, everything else becomes {count, cpuPct, memUsedMB, memLimitMB}.
const { R, reasonFromExec } = require('./reasons');

const UNIT_MB = { b: 1 / 1048576, kb: 1 / 1024, kib: 1 / 1024, mb: 1, mib: 1, gb: 1024, gib: 1024, tb: 1048576, tib: 1048576 };
function parseSizeMB(s) {
  const m = String(s || '').trim().match(/^([\d.,]+)\s*([A-Za-z]+)$/);
  if (!m) return null;
  const f = UNIT_MB[m[2].toLowerCase()];
  const n = parseFloat(m[1].replace(',', '.'));
  return f === undefined || !Number.isFinite(n) ? null : n * f;
}
const parsePct = (s) => { const n = parseFloat(String(s || '').replace('%', '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const round1 = (x) => Math.round(x * 10) / 10;

function jsonLines(text) {
  const out = [];
  for (const ln of String(text || '').split('\n')) {
    const t = ln.trim();
    if (!t.startsWith('{')) continue;
    try { out.push(JSON.parse(t)); } catch { /* a torn line is skipped */ }
  }
  return out;
}

// `docker ps --format "{{json .}}"` -> [{id, name, image, status}]
function parsePs(text) {
  return jsonLines(text).map((o) => ({ id: String(o.ID || ''), name: String(o.Names || o.Name || '').split(',')[0], image: String(o.Image || ''), status: String(o.Status || '') })).filter((r) => r.id && r.name);
}
// `docker stats --no-stream --format "{{json .}}"` -> [{id, name, cpuPct, memUsedMB, memLimitMB}]
function parseStats(text) {
  return jsonLines(text).map((o) => {
    const [used, limit] = String(o.MemUsage || '').split('/');
    return { id: String(o.ID || o.Container || ''), name: String(o.Name || ''), cpuPct: parsePct(o.CPUPerc), memUsedMB: parseSizeMB(used), memLimitMB: parseSizeMB(limit) };
  }).filter((r) => r.id || r.name);
}

// image "registry:5000/library/postgres:16" -> "postgres"
const imageBase = (image) => String(image || '').split('@')[0].split('/').pop().split(':')[0];

// a container is in scope when its name or its image's base name is named in the scope
function makeInScope(resolver) {
  return (c) => {
    const byName = resolver.classifyName(c.name);
    if (byName === 'in') return true;
    const img = imageBase(c.image);
    if (img && resolver.classifyName(img) === 'in') return true;
    if (byName === 'out') resolver.noteOutName(c.name);
    return false;
  };
}

// pure: parsed ps + stats -> {series: [...in scope], outOfScope: {count, cpuPct, memUsedMB, memLimitMB}|null, running: [...], names}
function buildSample({ ps, stats, resolver, atIso }) {
  const inScope = makeInScope(resolver);
  const byId = new Map(), byName = new Map();
  for (const s of stats) { if (s.id) byId.set(s.id.slice(0, 12), s); if (s.name) byName.set(s.name, s); }
  const series = [];
  const out = { count: 0, cpuPct: 0, memUsedMB: 0, memLimitMB: 0 };
  const running = [];
  for (const c of ps) {
    const s = byId.get(c.id.slice(0, 12)) || byName.get(c.name) || null;
    running.push({ id: c.id, name: c.name, image: c.image });
    if (inScope(c)) {
      series.push({ at: atIso, name: c.name, cpuPct: s && s.cpuPct !== null ? round1(s.cpuPct) : null, memUsedMB: s && s.memUsedMB !== null ? round1(s.memUsedMB) : null, memLimitMB: s && s.memLimitMB !== null ? Math.round(s.memLimitMB) : null });
    } else {
      out.count++;
      if (s) { out.cpuPct += s.cpuPct || 0; out.memUsedMB += s.memUsedMB || 0; out.memLimitMB += s.memLimitMB || 0; }
    }
  }
  return {
    series,
    outOfScope: out.count ? { at: atIso, count: out.count, cpuPct: round1(out.cpuPct), memUsedMB: round1(out.memUsedMB), memLimitMB: Math.round(out.memLimitMB) } : null,
    running,
  };
}

// poll once. exec: EXEC.execA-compatible. Returns {ok, reason, sample?, atMs}
async function pollContainers({ exec, resolver, ctx = null, timeoutMs = 3000, now = Date.now }) {
  const atMs = now();
  const atIso = new Date(atMs).toISOString();
  // both calls run together so the poll stays inside one budget; stats is ignored when nothing is running
  const [psR, stR] = await Promise.all([
    exec('docker', ['ps', '--format', '{{json .}}'], { timeoutMs, tier: 'onTrigger', ctx }),
    exec('docker', ['stats', '--no-stream', '--format', '{{json .}}'], { timeoutMs, tier: 'onTrigger', ctx }),
  ]);
  const psReason = reasonFromExec(psR, { timeoutMs });
  if (psReason) return { ok: false, reason: psReason, atMs, atIso };
  const ps = parsePs(psR.stdout);
  if (!ps.length) return { ok: true, atMs, atIso, sample: { series: [], outOfScope: null, running: [] }, note: R.NO_CONTAINERS };
  const stReason = reasonFromExec(stR, { timeoutMs });
  // ps worked but stats did not: lifecycle is still known; values are null with the reason
  const stats = stReason ? [] : parseStats(stR.stdout);
  const sample = buildSample({ ps, stats, resolver, atIso });
  return { ok: true, atMs, atIso, sample, statsReason: stReason };
}

// back-off: double the interval after a timeout, up to maxS; any success resets it
function nextInterval({ baseS = 10, currentS = 10, outcome, maxS = 60 }) {
  return outcome === 'timeout' ? Math.min(maxS, currentS * 2) : baseS;
}

module.exports = { parsePs, parseStats, parseSizeMB, parsePct, imageBase, makeInScope, buildSample, pollContainers, nextInterval };
