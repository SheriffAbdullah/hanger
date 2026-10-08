'use strict';
// Value-level anonymization: scrub strings (and keys) BEFORE serialization so the
// JSON text is never edited. Covers backslash/forward-slash profile paths on any drive,
// /home/<name>, C--Users-<name> encoded fragments, OneDrive - <Org> folders, hostname, username.
const os = require('os');

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function defaultCtx() {
  let username = '';
  try { username = os.userInfo().username || ''; } catch { /* no passwd entry */ }
  return { hostname: os.hostname(), username };
}

// ctx: { hostname, username, extra: [strings] }
function scrubString(s, ctx) {
  if (typeof s !== 'string' || !s) return s;
  const c = ctx || defaultCtx();
  let out = s;
  // profile paths on any drive, either slash direction (one or more separators)
  out = out.replace(/([A-Za-z]:)[\\/]+Users[\\/]+[^\\/:*?"<>|\r\n]+/gi, '$1\\Users\\<user>');
  out = out.replace(/\/home\/[^/\s"'\\]+/gi, '/home/<user>');
  // encoded fragments (Claude project dirs etc.): C--Users-<name>-rest
  const u = c.username ? escRe(c.username) : null;
  if (u) out = out.replace(new RegExp(`([A-Za-z])--Users-${u}`, 'gi'), '$1--Users-<user>');
  out = out.replace(/([A-Za-z])--Users-(?!<user>)[^-\s\\/"']+/gi, '$1--Users-<user>');
  // organization-named sync folders (plain and encoded)
  out = out.replace(/OneDrive - [^\\/\r\n"]+?(?=[\\/\r\n"]|$)/gi, 'OneDrive - <org>');
  out = out.replace(/OneDrive---[^\s\\/"'.]+/gi, 'OneDrive---<org>');
  for (const extra of c.extra || []) if (extra && extra.length >= 3) out = out.replace(new RegExp(escRe(extra), 'gi'), '<redacted>');
  if (c.hostname && c.hostname.length >= 2) out = out.replace(new RegExp(escRe(c.hostname), 'gi'), '<host>');
  if (c.username && c.username.length >= 3 && c.username.toLowerCase() !== 'user') out = out.replace(new RegExp(escRe(c.username), 'gi'), '<user>');
  return out;
}

// Deep copy with every string value and object key scrubbed. Never mutates the input.
function scrubValue(v, ctx) {
  const c = ctx || defaultCtx();
  if (typeof v === 'string') return scrubString(v, c);
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, c));
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    const o = {};
    for (const [k, val] of Object.entries(v)) o[scrubString(k, c)] = scrubValue(val, c);
    return o;
  }
  return v;
}

module.exports = { scrubString, scrubValue, scrubObject: scrubValue, defaultCtx };
