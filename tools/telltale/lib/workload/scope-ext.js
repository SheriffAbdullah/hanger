'use strict';
// Scope-file extension (additive): optional "phases", "probes[]" and "config[]".
// Validation only; nothing here runs a command. Old scope files without these keys behave as before.
const SECRET_KEY = /pass|pwd|secret|token/i;
const SECRET_IN_TEXT = /pass(word|file)?\s*=|pwd\s*=|secret\s*=|token\s*=|:\/\/[^/\s:@]+:[^@\s]+@/i;
const PROBE_KEYS = new Set(['name', 'command', 'timeoutMs', 'everySec', 'note']);
const CONFIG_KEYS = new Set(['kind', 'connection', 'container', 'note']);
const CONFIG_KINDS = new Set(['postgres', 'wsl']);
const MIN_EVERY_SEC = 2;

// returns {phases, probes, config, drives} (normalized, defaults applied); throws Error(message) naming the problem.
function validateWorkloadExt(obj, where, makeError = (m) => new Error(m)) {
  const fail = (m) => { throw makeError(`scope file ${where}: ${m}`); };
  const out = { phases: [], probes: [], config: [], drives: [] };
  if (obj.drives !== undefined) {
    if (!Array.isArray(obj.drives)) fail('"drives" must be a list of drive letters such as ["D:"]');
    obj.drives.forEach((d, i) => { if (typeof d !== 'string' || !/^[A-Za-z]:$/.test(d.trim())) fail(`drives[${i}] (${JSON.stringify(d)}) must be a drive letter and colon such as "D:"`); });
    out.drives = [...new Set(obj.drives.map((d) => d.trim().toUpperCase()))];
  }
  if (obj.phases !== undefined) {
    if (!Array.isArray(obj.phases) || obj.phases.some((p) => typeof p !== 'string' || !p.trim() || p.length > 40)) fail('"phases" must be a list of non-empty strings (40 characters at most)');
    out.phases = obj.phases.map((p) => p.trim());
  }
  if (obj.probes !== undefined) {
    if (!Array.isArray(obj.probes)) fail('"probes" must be an array');
    obj.probes.forEach((p, i) => {
      const at = `probes[${i}]`;
      if (!p || typeof p !== 'object' || Array.isArray(p)) fail(`${at} must be an object`);
      for (const k of Object.keys(p)) {
        if (SECRET_KEY.test(k)) fail(`${at} has a key named "${k}": credentials are never stored; use your existing environment or a service file`);
        if (!PROBE_KEYS.has(k)) fail(`unknown key "${k}" in ${at}`);
      }
      if (typeof p.name !== 'string' || !p.name.trim()) fail(`${at}.name is required (the probe is reported by name only)`);
      if (typeof p.command === 'string') fail(`${at}.command must be an argument list (an array of strings), not a shell string; the probe is never run through a shell`);
      if (!Array.isArray(p.command) || !p.command.length || p.command.some((a) => typeof a !== 'string')) fail(`${at}.command must be a non-empty array of strings`);
      if (p.command.some((a) => SECRET_IN_TEXT.test(a))) fail(`${at}.command contains what looks like a credential; credentials are never stored`);
      const timeoutMs = p.timeoutMs === undefined ? 5000 : p.timeoutMs;
      if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) fail(`${at}.timeoutMs must be between 100 and 60000`);
      const everySec = p.everySec === undefined ? 5 : p.everySec;
      if (!Number.isFinite(everySec) || everySec < MIN_EVERY_SEC) fail(`${at}.everySec must be at least ${MIN_EVERY_SEC} (the probe adds load while the machine is struggling)`);
      out.probes.push({ name: p.name.trim(), command: p.command.slice(), timeoutMs, everySec });
    });
    const names = out.probes.map((p) => p.name);
    if (new Set(names).size !== names.length) fail('probe names must be unique');
  }
  if (obj.config !== undefined) {
    if (!Array.isArray(obj.config)) fail('"config" must be an array');
    obj.config.forEach((c, i) => {
      const at = `config[${i}]`;
      if (!c || typeof c !== 'object' || Array.isArray(c)) fail(`${at} must be an object`);
      for (const k of Object.keys(c)) {
        if (SECRET_KEY.test(k)) fail(`${at} has a key named "${k}": credentials are never stored; use your existing environment or a service file`);
        if (!CONFIG_KEYS.has(k)) fail(`unknown key "${k}" in ${at}`);
      }
      if (!CONFIG_KINDS.has(c.kind)) fail(`${at}.kind must be "postgres" or "wsl"`);
      for (const k of ['connection', 'container']) if (c[k] !== undefined && typeof c[k] !== 'string') fail(`${at}.${k} must be a string`);
      if (c.connection && SECRET_IN_TEXT.test(c.connection)) fail(`${at}.connection contains what looks like a credential; credentials are never stored`);
      out.config.push({ kind: c.kind, ...(c.connection ? { connection: c.connection } : {}), ...(c.container ? { container: c.container } : {}) });
    });
  }
  return out;
}

module.exports = { validateWorkloadExt, SECRET_KEY, MIN_EVERY_SEC };
