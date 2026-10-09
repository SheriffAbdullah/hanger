'use strict';
// Legacy "telltale" aliases (the product was renamed to Hanger). Kept for ONE release, then removed.
// Nothing here is silent: every legacy name that is honored prints a one-line rename hint.
const fs = require('fs');
const path = require('path');

// reports already on disk carry the old schema id; both ids are the same frozen schema
const SCHEMA_V2 = 'hanger-json/2';
const LEGACY_SCHEMA_V2 = 'telltale-json/2';
const LEGACY_SCHEMA_V1 = 'telltale-json/1';
const LEGACY_PACK_SCHEMA = 'telltale-pack/1';

const isV2Schema = (s) => s === SCHEMA_V2 || s === LEGACY_SCHEMA_V2;
const isSchemaFamily = (s) => typeof s === 'string' && (s.startsWith('hanger-json/') || s.startsWith('telltale-json/'));
// output file stems: hanger-<stamp>.* (new) and telltale-<stamp>.* (written by earlier versions)
const TRACE_JSON_RE = /^(hanger|telltale)-.*\.json$/;
const stripStem = (name) => String(name).replace(/^(hanger|telltale)-/, '');

// TELLTALE_FOO=... -> HANGER_FOO (the new name wins when both are set). Returns the aliased names.
function applyLegacyEnv(env = process.env, log = console.log) {
  const used = [];
  for (const k of Object.keys(env)) {
    if (!k.startsWith('TELLTALE_')) continue;
    const next = 'HANGER_' + k.slice('TELLTALE_'.length);
    if (env[next] === undefined) env[next] = env[k];
    used.push(k);
  }
  if (used.length) log(`[hanger] deprecated environment variable${used.length > 1 ? 's' : ''} ${used.join(', ')}: rename to ${used.map((k) => 'HANGER_' + k.slice(9)).join(', ')} (the old names are read for one more release)`);
  return used;
}

// Find a file by its new name, falling back to the legacy name with a rename hint. Returns a path or null.
function findWithLegacy(dir, newName, legacyName, log = console.log) {
  const p = path.join(dir, newName);
  if (fs.existsSync(p)) return p;
  const old = path.join(dir, legacyName);
  if (fs.existsSync(old)) {
    log(`[hanger] found legacy ${legacyName}: using it. Rename it to ${newName} (legacy names are read for one more release)`);
    return old;
  }
  return null;
}

module.exports = { SCHEMA_V2, LEGACY_SCHEMA_V1, LEGACY_SCHEMA_V2, LEGACY_PACK_SCHEMA, isV2Schema, isSchemaFamily, TRACE_JSON_RE, stripStem, applyLegacyEnv, findWithLegacy };
