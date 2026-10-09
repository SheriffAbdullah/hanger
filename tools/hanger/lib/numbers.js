'use strict';
// Pure number/parse helpers moved verbatim from hanger.js (no side effects at require time).

const num = (v) => {
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : null;
};

// percentile over a numeric array; returns 0 on empty (legacy). Use pctOrNull for null-with-reason.
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const pctOrNull = (arr, p) => (arr.length ? pct(arr, p) : null);

function parseTasklist(csv) {
  const rows = [];
  for (const l of csv.split('\n')) {
    if (!l.includes('","')) continue;
    // split CSV respecting quotes: "name","pid",...
    const parts = l.trim().replace(/^"|"$/g, '').split('","');
    if (parts.length < 5) continue;
    const memKB = parseInt(parts[4].replace(/[^\d]/g, ''), 10);
    if (!memKB) continue;
    rows.push({ name: parts[0], pid: +parts[1] || 0, memMB: Math.round(memKB / 1024) });
  }
  rows.sort((a, b) => b.memMB - a.memMB);
  return rows;
}

// roll up duplicates (Br-uxendm x2 -> one culprit row)
function rollup(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.name.toLowerCase();
    if (!m.has(k)) m.set(k, { name: r.name, totalMB: 0, n: 0, pids: [] });
    const e = m.get(k);
    e.totalMB += r.memMB; e.n += 1;
    if (e.pids.length < 4) e.pids.push(r.pid);
  }
  return [...m.values()].sort((a, b) => b.totalMB - a.totalMB);
}

module.exports = { num, pct, pctOrNull, parseTasklist, rollup };
