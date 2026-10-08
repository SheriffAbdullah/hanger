#!/usr/bin/env node
'use strict';
// Deterministic synthetic fixtures for the diagnosis engine (no real machine data).
//   diagnosis/sample-r03.json      5 probes, 0 hangs, commit 52-65%, first probe bundle 8849 ms (the R03 shipped-sample case)
//   diagnosis/memory-13-08-14.json 30 probes (irregular spacing: the probe loop slows on a hung box), 5 hangs at commit 88-92%, calm commit ~62% (n=18), 2 hung user marks
// Usage: node build-diagnosis-fixtures.js [outDir]   (default: ./diagnosis)
const fs = require('fs');
const path = require('path');
const { assemble, probeAt, sampleAt, rng, iso, buildAll } = require('./build-fixtures');

function buildMemory() {
  const rnd = rng(1314);
  const samples = [];
  for (let t = 1; t <= 68; t++) samples.push(sampleAt(t, 66 + rnd() * 4));
  const excluded = [2, 4, 6, 8];
  const calmEarly = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const nearHang = [21, 24, 27];
  const hangs = [30, 35, 40, 45, 50];
  const calmLate = [61, 62, 63, 64, 65, 66, 67, 68];
  const hangCommit = [88, 90, 91, 92, 89];
  const probes = [];
  const calmP = (t, i) => probeAt(t, { ms: 120 + Math.round(rnd() * 100), usedPct: 66 + rnd() * 3, committed: 60 + rnd() * 4.2, pages: 50 + Math.round(rnd() * 60), plugged: false, batteryPct: 58, cpuQ: 1 });
  excluded.forEach((t, i) => probes.push({ ...calmP(t, i), availMB: 5200 }));
  calmEarly.forEach((t, i) => probes.push({ ...calmP(t, i), availMB: 5200 - i * 10 }));
  nearHang.forEach((t, i) => probes.push({ ...probeAt(t, { ms: 260 + i * 20, usedPct: 78 + i * 2, committed: 70 + i * 5, pages: 120, plugged: false, batteryPct: 58 }), availMB: 2800 - i * 300 }));
  hangs.forEach((t, i) => probes.push({ ...probeAt(t, { ms: 1400 + i * 300, usedPct: 93, committed: hangCommit[i], pages: 900 + i * 40, plugged: false, batteryPct: 58, cpuQ: 3, hang: true }), availMB: 280 + i * 15 }));
  calmLate.forEach((t, i) => probes.push({ ...calmP(t, i), availMB: 5000 + i * 10 }));
  const marks = [
    { tSec: 30.8, at: iso(30.8), kind: 'hung', note: 'terminal froze' },
    { tSec: 40.5, at: iso(40.5), kind: 'hung', note: 'editor froze' },
  ];
  return assemble('memory-13-08-14', { nominalS: 60, intervalMs: 1000, samples, probes, marks, plugged: false, batteryPct: 58,
    culprits: [{ name: 'node.exe', friendly: 'Node.js runtime', detail: 'Node.js runtime', totalMB: 6349, instances: 14, source: 'known' }] });
}

function buildAllDiagnosis() {
  return { 'sample-r03.json': buildAll()['sample-r03.json'], 'memory-13-08-14.json': buildMemory() };
}

function writeAll(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const all = buildAllDiagnosis();
  for (const [f, rep] of Object.entries(all)) fs.writeFileSync(path.join(outDir, f), JSON.stringify(rep, null, 2) + '\n');
  return all;
}

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(__dirname, 'diagnosis'));
  writeAll(out);
  console.log(`wrote 2 diagnosis fixtures to ${out}`);
}
module.exports = { buildAllDiagnosis, writeAll, buildMemory };
