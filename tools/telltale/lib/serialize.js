'use strict';
// Write JSON, read it back, parse it. A failed read-back is an error, never silent.
const fs = require('fs');

// opts.serialize(obj) -> text (injectable for tests); opts.stderr for messages.
function writeJsonChecked(file, obj, opts = {}) {
  const serialize = opts.serialize || ((o) => JSON.stringify(o, null, 2));
  const err = opts.stderr || ((m) => console.error(m));
  let text;
  try { text = serialize(obj); } catch (e) {
    err(`[telltale] cannot serialize ${file}: ${e.message}`);
    return { ok: false, file, error: e.message };
  }
  fs.writeFileSync(file, text);
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    const bad = `${file}.invalid`;
    try { fs.renameSync(file, bad); } catch { try { fs.writeFileSync(bad, text); } catch { /* best effort */ } }
    err(`[telltale] INVALID JSON written to ${file} (kept as ${bad}): ${e.message}`);
    return { ok: false, file, invalidFile: bad, error: e.message };
  }
  return { ok: true, file };
}

// Convenience: on failure set a non-zero exit code and report failure so callers skip views.
function writeJsonCheckedOrFail(file, obj, opts = {}) {
  const r = writeJsonChecked(file, obj, opts);
  if (!r.ok) process.exitCode = 1;
  return r;
}

module.exports = { writeJsonChecked, writeJsonCheckedOrFail };
