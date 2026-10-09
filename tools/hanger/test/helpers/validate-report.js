#!/usr/bin/env node
'use strict';
// node validate-report.js <file>...  -> exit 0 when every file is a valid report, 1 with reasons otherwise.
// Valid = parses as JSON, has schema/run/window/settings/summary, and holds no NaN/Infinity anywhere.
const fs = require('fs');
const { isRec, decimalsOf } = require('../../lib/sampler/record');
const { BARE_VALUE_KEYS } = require('../../lib/sampler/records');

const REQUIRED = ['schema', 'run', 'window', 'settings', 'summary'];

function validateText(text) {
  const problems = [];
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { ok: false, problems: [`invalid JSON: ${e.message}`] }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, problems: ['root is not an object'] };
  for (const k of REQUIRED) if (!(k in obj)) problems.push(`missing required key '${k}'`);
  // hanger-json/2 is frozen (report-and-visualization): the status must be declared and an `asset` alias must be gone
  if (obj.schema === 'hanger-json/2' || obj.schema === 'telltale-json/2') {
    if (!['draft', 'frozen'].includes(obj.schemaStatus)) problems.push(`schemaStatus must be 'draft' or 'frozen' (found ${JSON.stringify(obj.schemaStatus)})`);
    if ('asset' in obj) problems.push("legacy 'asset' alias present (removed from hanger-json/2; read systemProfile)");
  }
  const walk = (v, p) => {
    if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`non-finite number at ${p}`);
    else if (typeof v === 'string' && /^(-?Infinity|NaN)$/.test(v)) problems.push(`string "${v}" at ${p}`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
  };
  walk(obj, '$');
  // provenance contract (sampling-engine-and-provenance): probe/sample/hang rows hold records, never bare value keys,
  // and no record carries more decimals than its declared precision
  const bare = new Set(BARE_VALUE_KEYS);
  const rows = (arr, name) => (Array.isArray(arr) ? arr : []).forEach((row, i) => {
    if (!row || typeof row !== 'object') return;
    for (const [k, x] of Object.entries(row)) {
      if (bare.has(k) && typeof x === 'number') problems.push(`bare unitless numeric key '${k}' at ${name}[${i}] (expected a provenance record)`);
    }
  });
  // enforced on any report that stores provenance records (older plain-number streams recovered later are not rewritten)
  const usesRecords = [obj.spawnProbes, obj.samples, obj.hangEvents].some((arr) => Array.isArray(arr) && arr.some((row) => row && typeof row === 'object' && Object.values(row).some(isRec)));
  if ((obj.schema === 'hanger-json/2' || obj.schema === 'telltale-json/2') && (usesRecords || (obj.sampling && obj.sampling.provenance === true))) {
    rows(obj.spawnProbes, 'spawnProbes'); rows(obj.samples, 'samples'); rows(obj.hangEvents, 'hangEvents');
  }
  const prec = (v, p) => {
    if (isRec(v)) {
      if (typeof v.v === 'number' && Number.isFinite(v.prec) && v.prec > 0 && decimalsOf(v.v) > decimalsOf(v.prec)) problems.push(`value ${v.v} has more decimals than its precision ${v.prec} at ${p}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => prec(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) prec(x, `${p}.${k}`);
  };
  prec(obj, '$');
  // input-response check (input-response-stall-detector): numeric leaves inside inputStall are provenance records, or one of a few
  // named structural counters; a bare measurement (durationMs: 1840) is rejected with its path
  if (obj.inputStall && typeof obj.inputStall === 'object') {
    const PLAIN_OK = new Set(['samples', 'timeouts', 'badLines', 'num', 'den', 'value', 'n', 'windowS', 'prec', 'v', 'S', 'L', 'X', 'N', 'G', 'tickMs']);
    const inStall = (v, p, underRecord, under) => {
      if (typeof v === 'number') {
        const leaf = p.split('.').pop().replace(/\[\d+\]$/, '');
        const arr = /\[\d+\]$/.test(p.split('.').pop());
        const okPath = under.includes('sampleRefs') || under.includes('confidence');
        if (!underRecord && !okPath && !PLAIN_OK.has(leaf) && !(arr && under.includes('sampleRefs'))) problems.push(`bare number at ${p} (inputStall values must be provenance records)`);
        return;
      }
      if (Array.isArray(v)) { v.forEach((x, i) => inStall(x, `${p}[${i}]`, underRecord, under)); return; }
      if (v && typeof v === 'object') {
        const rec = isRec(v) || (typeof v.v === 'number' && 'unit' in v); // provenance record, or a {v, unit, source} setting
        for (const [k, x] of Object.entries(v)) inStall(x, `${p}.${k}`, rec, [...under, k]);
      }
    };
    inStall(obj.inputStall, '$.inputStall', false, []);
  }
  // storage-coverage (additive 2.x fields): optional, so an older report passes; when present they must be well formed, and
  // anything the validator does not understand inside them is ignored. A drive label never carries a serial number.
  if (obj.storage !== undefined) {
    const w = obj.storage && obj.storage.workloadDrives;
    if (!obj.storage || typeof obj.storage !== 'object' || Array.isArray(obj.storage)) problems.push('storage must be an object');
    else if (w !== null && w !== undefined && (!Array.isArray(w) || w.some((x) => typeof x !== 'string' || !/^[A-Z]:$/.test(x)))) problems.push('storage.workloadDrives must be null or a list of drive letters such as "D:"');
  }
  for (const [i, row] of (Array.isArray(obj.spawnProbes) ? obj.spawnProbes : []).entries()) {
    const dk = row && row.disk;
    if (!dk || typeof dk !== 'object') continue;
    if (dk.drives !== undefined && dk.drives !== null && !Array.isArray(dk.drives)) problems.push(`spawnProbes[${i}].disk.drives must be null or a list`);
    if (dk.volumes !== undefined && dk.volumes !== null && !Array.isArray(dk.volumes)) problems.push(`spawnProbes[${i}].disk.volumes must be null or a list`);
    if (dk.drives === null && typeof dk.drivesReason !== 'string') problems.push(`spawnProbes[${i}].disk.drives is null without a drivesReason`);
    if (dk.volumes === null && typeof dk.volumesReason !== 'string') problems.push(`spawnProbes[${i}].disk.volumes is null without a volumesReason`);
    for (const d of Array.isArray(dk.drives) ? dk.drives : []) if (d && /serial/i.test(Object.keys(d).join(' ') + String(d.label))) problems.push(`spawnProbes[${i}].disk.drives holds a serial number`);
  }
  // a bare Infinity/NaN token is not valid JSON, so JSON.parse already rejected it; belt and braces:
  if (/:\s*-?(Infinity|NaN)\b/.test(text)) problems.push('raw Infinity/NaN token in text');
  return { ok: problems.length === 0, problems, obj };
}

function validateFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { ok: false, problems: [`cannot read: ${e.message}`] }; }
  return validateText(text);
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: validate-report.js <file>...'); process.exit(2); }
  let bad = 0;
  for (const f of files) {
    const r = validateFile(f);
    if (r.ok) console.log(`OK   ${f}`);
    else { bad++; console.log(`FAIL ${f}`); for (const p of r.problems) console.log(`     - ${p}`); }
  }
  process.exit(bad ? 1 : 0);
}
module.exports = { validateText, validateFile };
