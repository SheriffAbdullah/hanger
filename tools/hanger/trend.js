#!/usr/bin/env node
// hanger trend — multi-report compare from reports/hanger-*.json (v10 first multi-file split).
// Reads every hanger-*.json in the out dir, prints one compare row each
// (date, finding class, hangs, worst, commitPeak, pagesPeak, plugged)
// plus delta of each row vs the newest report. Console output is ASCII-only.
const fs = require('fs');
const path = require('path');

// The class comes from the report's stored diagnosis (one vocabulary). A report from before the engine shows its old
// label as 'legacy:<label>': it is never mapped onto the new vocabulary.
function findingClass(r) {
  const d = r && r.diagnosis && r.diagnosis.finding;
  if (d && d.class) return d.class;
  const v = r && r.summary && r.summary.verdict;
  if (v) return 'legacy:' + String(v).replace(/^[A-Za-z]+:\s*/, '').replace(/\s*\(.*$/, '').slice(0, 16);
  return 'not-recorded';
}

function plugTxt(p) {
  if (p === true) return 'AC';
  if (p === false) return 'BAT';
  return '?';
}

const { readReportFile, schemaVersion, scanTraceReports } = require('./lib/reports-io');

// Returns readable rows; every unreadable or unknown-schema file is printed by name with its error.
function loadReports(outdir, skipped) {
  const scan = scanTraceReports(outdir);
  const rows = [];
  for (const e of scan.files) {
    if (!e.ok) { (skipped || []).push({ file: e.file, error: e.error }); continue; }
    rows.push(rowFrom(e.report, e.file, e.version));
  }
  return rows;
}

function loadOne(full, f, skipped) {
  const file = f || String(full).split(/[\\/]/).pop();
  try { require('./lib/scope').assertShareablePath(full); } catch (e) { (skipped || []).push({ file, error: e.message }); return null; }
  const rd = readReportFile(full);
  if (!rd.ok) { (skipped || []).push({ file, error: rd.error }); return null; }
  const v = schemaVersion(rd.report);
  if (v.version !== 'v2') {
    (skipped || []).push({ file, error: `unknown schema ${v.schema === null ? '(none declared)' : `'${v.schema}'`}; this reader knows hanger-json/2` });
    return null;
  }
  return rowFrom(rd.report, file, v.version);
}

function printSkipped(skipped) {
  for (const s of skipped) console.log(`[trend] SKIPPED ${s.file}: ${s.error}`);
}

function rowFrom(r, f, version) {
  {
    const s = r.summary || {};
    return {
      version, label: null,
      file: f,
      startedAt: String(r.startedAt || ''),
      date: String(r.startedAt || f.replace(/^hanger-/, '').replace(/\.json$/, '')).slice(0, 19).replace('T', ' '),
      verdict: findingClass(r),
      hangs: Number.isFinite(s.hangEventCount) ? s.hangEventCount : null, // unknown, never zero
      hangRate: Number.isFinite(s.hangRatePerMin) ? s.hangRatePerMin : null,
      worst: Number.isFinite(s.spawnMaxMs) ? Math.round(s.spawnMaxMs) : null,
      commit: Number.isFinite(s.committedPeak) ? s.committedPeak : null,
      pages: Number.isFinite(s.pagesPeak) ? s.pagesPeak : null,
      plugged: r.power ? r.power.plugged : null,
    };
  }
}

function deltaLine(name, a, b, digits) {
  const f = (v) => (v === null || v === undefined ? '?' : v);
  if (a === null || a === undefined || b === null || b === undefined) return `${name}: ${f(a)} vs ${f(b)} (delta ?)`;
  const d = +(a - b).toFixed(digits === undefined ? 1 : digits);
  return `${name}: ${a} vs ${b} (delta ${(d > 0 ? '+' : '') + d}, A-minus-B)`;
}

function runCompare(outdir, fileA, fileB) {
  const res = (p) => (p && fs.existsSync(p) ? p : path.join(outdir, p || ''));
  const pa = res(fileA), pb = res(fileB);
  const skipped = [];
  const a = fs.existsSync(pa) ? loadOne(pa, String(fileA).split(/[\\/]/).pop(), skipped) : null;
  const b = fs.existsSync(pb) ? loadOne(pb, String(fileB).split(/[\\/]/).pop(), skipped) : null;
  printSkipped(skipped);
  if (!a || !b) {
    console.log(`[compare] need two readable reports in ${outdir}; got A=${fileA || '(missing)'} B=${fileB || '(missing)'}`);
    return { compare: [], error: 'missing-file' };
  }
  console.log(`[compare] A=${a.file} (${a.date}, ${a.verdict}) vs B=${b.file} (${b.date}, ${b.verdict})`);
  console.log(deltaLine('hangs     ', a.hangs, b.hangs, 0));
  console.log(deltaLine('worstMs   ', a.worst, b.worst, 0));
  console.log(deltaLine('commit%   ', a.commit, b.commit, 1));
  console.log(deltaLine('pages/s   ', a.pages, b.pages, 0));
  console.log(deltaLine('hangRate/m', a.hangRate, b.hangRate, 2));
  console.log(`[compare] basis: A-minus-B deltas; + means A was worse. n per report = its hangs column.`);
  return { compare: [a, b] };
}

function runWindows(outdir, spec) {
  const skipped = [];
  const rows = loadReports(outdir, skipped);
  printSkipped(skipped);
  const tags =String(spec || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (tags.length !== 2) {
    console.log(`[compare] --windows needs "A,B" (two date/tag substrings matched against startedAt+filename)`);
    return { windows: [], error: 'bad-spec' };
  }
  const grp = (tag) => rows.filter((r) => (String(r.startedAt) + ' ' + r.file).includes(tag));
  const ga = grp(tags[0]), gb = grp(tags[1]);
  const agg = (rs, tag) => {
    if (!rs.length) return { tag, n: 0, note: 'no reports matched (unknown, not zero)' };
    const nums = (k) => rs.map((r) => r[k]).filter((v) => Number.isFinite(v));
    const max = (a) => (a.length ? Math.max(...a) : null);
    return {
      tag, n: rs.length, files: rs.map((r) => r.file),
      hangsTotal: rs.every((r) => r.hangs !== null) ? rs.reduce((x, r) => x + r.hangs, 0) : null,
      commitPeak: max(nums('commit')), pagesPeak: max(nums('pages')), worstPeak: max(nums('worst')),
      verdicts: [...new Set(rs.map((r) => r.verdict))].join('+'),
    };
  };
  const A = agg(ga, tags[0]), B = agg(gb, tags[1]);
  const j = (o) => (o.n ? `${o.tag}: n=${o.n} hangs=${o.hangsTotal} commitPk=${o.commitPeak} pagesPk=${o.pagesPeak} worstPk=${o.worstPeak} [${o.verdicts}]` : `${o.tag}: n=0 (${(o.note || '')})`);
  console.log(`[compare] windows over ${rows.length} reports in ${outdir}`);
  console.log(`  A ${j(A)}`);
  console.log(`  B ${j(B)}`);
  if (A.n && B.n) {
    console.log(deltaLine('hangsTotal', A.hangsTotal, B.hangsTotal, 0));
    console.log(deltaLine('commitPeak', A.commitPeak, B.commitPeak, 1));
    console.log(deltaLine('pagesPeak ', A.pagesPeak, B.pagesPeak, 0));
    console.log(deltaLine('worstPeak ', A.worstPeak, B.worstPeak, 0));
  }
  console.log(`[compare] basis: per-window peaks/totals with n; A-minus-B; unmatched window = unknown, never zero.`);
  return { windows: [A, B] };
}

function fmt(v, suffix) {
  return v === null || v === undefined ? '?' : `${v}${suffix || ''}`;
}

function runTrend(opts) {
  const outdir = (opts && opts.outdir) || path.join(__dirname, '..', '..', 'reports');
  const argv = process.argv.slice(2);
  const ci = argv.indexOf('--compare');
  if (ci >= 0) return runCompare(outdir, argv[ci + 1], argv[ci + 2]);
  const wi = argv.indexOf('--windows');
  if (wi >= 0) return runWindows(outdir, argv[wi + 1]);
  const skipped = [];
  const rows = loadReports(outdir, skipped);
  if (!rows.length) {
    console.log(`[trend] no readable hanger-*.json in ${outdir}${skipped.length ? ` (${skipped.length} unreadable)` : ''}`);
    printSkipped(skipped);
    return { rows: [], skipped };
  }
  rows.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.file < b.file ? -1 : 1));
  const newest = rows[rows.length - 1];
  const head = ['date', 'finding', 'hangs', 'worstMs', 'commit%', 'pages/s', 'plug', 'dHang', 'dWorst', 'dCommit'];
  console.log(`[trend] ${rows.length} reports in ${outdir} (newest: ${newest.file}; n per row = its hangs column)`);
  console.log(head.join(' | '));
  console.log('-'.repeat(92));
  for (const r of rows) {
    const dHang = (r.hangs === null || newest.hangs === null) ? null : r.hangs - newest.hangs;
    const dWorst = (r.worst === null || newest.worst === null) ? null : r.worst - newest.worst;
    const dCommit = (r.commit === null || newest.commit === null) ? null : +(r.commit - newest.commit).toFixed(1);
    console.log([
      r.date,
      r.verdict.padEnd(18),
      fmt(r.hangs).padEnd(5),
      fmt(r.worst).padEnd(7),
      fmt(r.commit).padEnd(7),
      fmt(r.pages).padEnd(8),
      plugTxt(r.plugged).padEnd(4),
      (dHang === null ? '?' : (dHang > 0 ? '+' : '') + dHang),
      dWorst === null ? '?' : (dWorst > 0 ? '+' : '') + dWorst,
      dCommit === null ? '?' : (dCommit > 0 ? '+' : '') + dCommit,
    ].join(' | ') + (r.label ? ' | ' + r.label : ''));
  }
  console.log(`[trend] delta basis: each row minus newest (${newest.file}); + means that run was worse.`);
  printSkipped(skipped);
  return { rows, newest: newest.file, skipped };
}

module.exports = { runTrend };
