'use strict';
// Report pipeline: a written JSON report -> .md, .report.html and .email.txt (all views read the JSON only).
// Write order matters for the attachment manifest: json (hash) -> html (copy block) -> html hash -> email -> md.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildSections } = require('./sections');
const { renderHtml } = require('./html');
const { renderMarkdown } = require('./md');
const { buildEmail } = require('./email');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// render all views in memory from the raw report object and the on-disk names/hashes known so far
function renderAll(raw, { jsonName = null, jsonSha256 = null, htmlName = null, emailName = null, report = true, jsonBuf = null, anon = (x) => x } = {}) {
  const files = { jsonName, jsonSha256: jsonSha256 || (jsonBuf ? sha(jsonBuf) : null), htmlName: report ? htmlName : null, emailName: report ? emailName : null };
  const out = {};
  if (report) {
    // the HTML cannot contain its own hash, so its copy block carries the draft without it; the .email.txt carries the hash
    const draft = buildEmail(raw, { ...files, htmlSha256: null });
    draft.check();
    out.html = anon(renderHtml(buildSections(raw, files), files, anon(draft.text)));
    const htmlSha = sha(Buffer.from(out.html, 'utf8'));
    const email = buildEmail(raw, { ...files, htmlSha256: htmlSha });
    email.check();
    out.email = anon(email.text);
    out.htmlSha256 = htmlSha;
    out.md = anon(renderMarkdown(buildSections(raw, { ...files, htmlSha256: htmlSha }), { ...files, htmlSha256: htmlSha }));
  } else {
    out.md = anon(renderMarkdown(buildSections(raw, files), files));
  }
  return out;
}

// write the views next to `base` (path without extension) for a JSON file that is already on disk
function writeViews(base, { report = true, anon = (s) => s } = {}) {
  const jsonPath = `${base}.json`;
  const jsonBuf = fs.readFileSync(jsonPath);
  const raw = JSON.parse(jsonBuf.toString('utf8'));
  const stem = path.basename(base);
  const out = renderAll(raw, { jsonName: `${stem}.json`, jsonBuf, htmlName: `${stem}.report.html`, emailName: `${stem}.email.txt`, report, anon });
  const written = [];
  if (report) {
    fs.writeFileSync(`${base}.report.html`, out.html);
    fs.writeFileSync(`${base}.email.txt`, out.email);
    written.push(`${stem}.report.html`, `${stem}.email.txt`);
  }
  fs.writeFileSync(`${base}.md`, out.md);
  written.push(`${stem}.md`);
  return { written, htmlSha256: out.htmlSha256 || null };
}

module.exports = { renderAll, writeViews, sha };
