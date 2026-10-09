'use strict';
/* hanger report renderer: a trace or pack JSON -> one self-contained, printable .report.html (A4).
 * Usage: node render-print.js <trace-or-pack.json> [out.report.html] [--email out.email.txt]
 * The JSON is truth: this renders only what the file holds. No dependencies, no network, no script needed
 * for any chart (they are inline SVG), so the page prints to PDF with every chart.
 * Section order (trace and pack): run and scope, finding, what IT can do, evidence (+ charts), system profile,
 * gaps and receipts, appendix. The ready-to-send email draft is embedded after section 3.
 */
const fs = require('fs');
const path = require('path');
const { readReportFile, schemaVersion } = require('./lib/reports-io');
const scopeLib = require('./lib/scope');
const { buildSections, isPack } = require('./lib/render/sections');
const { renderHtml } = require('./lib/render/html');
const { buildEmail } = require('./lib/render/email');
const { sha } = require('./lib/render');

function render(raw, files = {}) {
  if (isPack(raw)) return renderHtml(buildSections(raw, files), files, null);
  const draft = buildEmail(raw, { ...files, htmlSha256: null });
  draft.check();
  return renderHtml(buildSections(raw, files), files, draft.text);
}

function main() {
  const args = process.argv.slice(2);
  if (!args[0] || args[0] === '-h' || args[0] === '--help') {
    console.log('Usage: node render-print.js <trace-or-pack.json> [out.report.html] [--email out.email.txt]');
    process.exit(args[0] ? 0 : 1);
  }
  const ei = args.indexOf('--email');
  const emailOut = ei >= 0 ? args[ei + 1] : null;
  const pos = args.filter((a, i) => !a.startsWith('--') && !(ei >= 0 && i === ei + 1));
  const inPath = path.resolve(pos[0]);
  try { scopeLib.assertShareablePath(inPath); } catch (e) { console.error(e.message); process.exit(2); }
  if (!fs.existsSync(inPath)) { console.error(`Input not found: ${inPath}`); process.exit(1); }
  const rd = readReportFile(inPath);
  if (!rd.ok) { console.error(`${path.basename(inPath)}: ${rd.error}`); process.exit(1); }
  const data = rd.raw;
  if (!isPack(data)) {
    const v = schemaVersion(data);
    if (v.version === 'v1') { console.error(`${path.basename(inPath)}: report is telltale-json/1 (pre-fix, legacy id); renderers need hanger-json/2 - re-capture with this version`); process.exit(1); }
    if (v.version !== 'v2') { console.error(`${path.basename(inPath)}: unknown schema ${v.schema === null ? '(none declared)' : `'${v.schema}'`}; renderer reads hanger-json/2`); process.exit(1); }
  }
  const name = path.basename(inPath);
  const files = { jsonName: name, jsonSha256: sha(fs.readFileSync(inPath)) };
  const outPath = pos[1] ? path.resolve(pos[1]) : path.join(path.dirname(inPath), `${name.replace(/\.json$/i, '')}.report.html`);
  try {
    const html = render(data, files);
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`Wrote ${outPath} (${isPack(data) ? 'pack' : 'trace'}, ${html.length} bytes)`);
    if (emailOut && !isPack(data)) {
      const em = buildEmail(data, { ...files, htmlName: path.basename(outPath), htmlSha256: sha(fs.readFileSync(outPath)) });
      em.check();
      fs.writeFileSync(path.resolve(emailOut), em.text, 'utf8');
      console.log(`Wrote ${path.resolve(emailOut)}`);
    }
  } catch (e) { console.error(`${name}: ${e.message}`); process.exit(1); }
}

if (require.main === module) main();
module.exports = { render, isPack };
