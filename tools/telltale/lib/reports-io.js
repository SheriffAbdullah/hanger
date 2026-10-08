'use strict';
// Loud report readers: every unreadable file is named with its error, never skipped.
const fs = require('fs');
const path = require('path');
const { plain } = require('./sampler/record');

const KNOWN = { 'telltale-json/1': 'v1', 'telltale-json/2': 'v2' };

function readReportFile(full) {
  let text;
  try { text = fs.readFileSync(full, 'utf8'); } catch (e) { return { ok: false, error: `cannot read: ${e.message}` }; }
  let report;
  try { report = JSON.parse(text); } catch (e) { return { ok: false, error: `invalid JSON: ${e.message}` }; }
  if (!report || typeof report !== 'object') return { ok: false, error: 'invalid report: not a JSON object' };
  // readers see plain numbers: provenance records are unwrapped through the one accessor (val/plain)
  return { ok: true, report: plain(report), raw: report };
}

// classify the declared schema; packs and unversioned objects are 'other'
function schemaVersion(report) {
  const s = report && report.schema;
  if (typeof s !== 'string') return { version: 'missing', schema: null };
  if (s.startsWith('telltale-json/')) return { version: KNOWN[s] || 'unknown', schema: s };
  return { version: 'other', schema: s };
}

// Scan telltale-*.json trace reports (oldest first). Each entry:
// {file, full, ok, error?, report?, version?, schema?}. Unknown schema => ok:false with a reason.
function scanTraceReports(outdir) {
  let files = [];
  try { files = fs.readdirSync(outdir).filter((f) => /^telltale-.*\.json$/.test(f)).sort(); } catch { return { files: [], dirError: true }; }
  const entries = files.map((file) => {
    const full = path.join(outdir, file);
    const r = readReportFile(full);
    if (!r.ok) return { file, full, ok: false, error: r.error };
    const v = schemaVersion(r.report);
    if (v.version === 'unknown' || v.version === 'missing' || v.version === 'other') {
      return { file, full, ok: false, error: `unknown schema ${v.schema === null ? '(none declared)' : `'${v.schema}'`}; this reader knows telltale-json/1 and /2` };
    }
    return { file, full, ok: true, report: r.report, version: v.version, schema: v.schema };
  });
  return { files: entries, dirError: false };
}

const V1_LABEL = 'v1 (pre-fix; rates may be overstated)';

module.exports = { readReportFile, schemaVersion, scanTraceReports, V1_LABEL };
