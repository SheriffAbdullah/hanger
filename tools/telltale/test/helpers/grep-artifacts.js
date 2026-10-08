#!/usr/bin/env node
'use strict';
// node grep-artifacts.js <dir> <needle>... [--only <substring>]
// Reports every file and line containing any needle (case-insensitive); exits 1 on any hit.
const fs = require('fs');
const path = require('path');

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full)); else out.push(full);
  }
  return out;
}

function grepArtifacts(dir, needles, onlySubstring) {
  const hits = [];
  const lower = needles.filter(Boolean).map((n) => n.toLowerCase());
  for (const f of listFiles(dir)) {
    if (onlySubstring && !path.basename(f).includes(onlySubstring)) continue;
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      const l = line.toLowerCase();
      for (const n of lower) if (l.includes(n)) hits.push({ file: f, line: i + 1, needle: n });
    });
  }
  return hits;
}

if (require.main === module) {
  const a = process.argv.slice(2);
  const oi = a.indexOf('--only');
  const only = oi >= 0 ? a[oi + 1] : null;
  const rest = a.filter((_, i) => oi < 0 || (i !== oi && i !== oi + 1));
  const [dir, ...needles] = rest;
  if (!dir || !needles.length) { console.error('usage: grep-artifacts.js <dir> <needle>... [--only <substring>]'); process.exit(2); }
  const hits = grepArtifacts(dir, needles, only);
  for (const h of hits) console.log(`${h.file}:${h.line}: ${h.needle}`);
  console.log(hits.length ? `${hits.length} hit(s)` : 'no hits');
  process.exit(hits.length ? 1 : 0);
}
module.exports = { grepArtifacts };
