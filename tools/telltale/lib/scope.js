'use strict';
// Declared scope: one resolver decides, for every process-identifying datum, whether it is
// in scope (user allow-list), system set (fixed, published), or out of scope (anonymous aggregate only).
// No side effects at require time. Out-of-scope identity is held in memory only to decide membership.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const workloadExt = require('./workload/scope-ext');

const STATEMENT = 'Names of software outside this scope were not recorded.';
const OPEN_BANNER = 'OPEN SCOPE: names of all running software may appear in this report';
const MATCH_RULE = 'case-insensitive executable name (with or without .exe) or explicit * ? pattern; descendants only when an entry opts in';
const CPU_NOTE = 'per-process CPU not collected yet';
const OUT_TOKEN = '<out-of-scope>';
// The guard is a BACKSTOP (the resolver is the structural control). Bare occurrences of these words are
// ordinary vocabulary in the tool's own text ("exit code", "docker CLI absent", "Node"), so a bare match is not
// masked; the same names are still masked in their executable form (name.exe).
const BARE_EXEMPT = new Set(['timeout', 'node', 'docker', 'powershell', 'pwsh', 'wsl', 'chrome', 'chromium', 'playwright', 'warp', 'openspec', 'code',
  'search', 'settings', 'host', 'client', 'server', 'service', 'helper', 'agent', 'update', 'updater', 'setup', 'launcher', 'manager', 'notes',
  'photos', 'video', 'music', 'mail', 'calendar', 'store', 'edge', 'widgets', 'cmd', 'bash', 'tasklist', 'powercfg', 'defender', 'windows']);

// ---------- fixed, published system set (OQ-2). Exact names, lowercase, no .exe. Never user applications. ----------
const SYSTEM_SET = Object.freeze({
  listVersion: 1,
  categories: Object.freeze({
    os: Object.freeze(['system', 'system idle process', 'registry', 'memory compression', 'secure system', 'smss', 'csrss', 'wininit',
      'winlogon', 'services', 'lsass', 'fontdrvhost', 'dwm', 'svchost', 'searchindexer']),
    security: Object.freeze(['msmpeng', 'mpdefendercoreservice', 'nissrv', 'securityhealthservice', 'securityhealthsystray', 'mssense', 'sense']),
    virtualization: Object.freeze(['vmmem', 'vmmemwsl', 'vmmemcmfnd', 'vmcompute', 'vmwp', 'docker-desktop', 'docker-desktop-data']),
  }),
});
const SYSTEM_LABELS = { svchost: 'Windows services' };
const SYSTEM_INDEX = (() => {
  const m = new Map();
  for (const [cat, names] of Object.entries(SYSTEM_SET.categories)) for (const n of names) m.set(n, cat);
  return m;
})();

const normName = (n) => String(n === null || n === undefined ? '' : n).trim().toLowerCase().replace(/\.exe$/, '');
const systemCategory = (name) => SYSTEM_INDEX.get(normName(name)) || null;

class ScopeError extends Error {
  constructor(message) { super(message); this.name = 'ScopeError'; this.exitCode = 2; }
}

// ---------- scope file ----------
const TOP_KEYS = new Set(['version', 'entries', 'note', 'phases', 'probes', 'config']);
const ENTRY_KEYS = new Set(['name', 'pattern', 'includeDescendants', 'note', 'enabled']);
const BAD_PATTERN = /[\[\](){}|+^$\\]/;

function validateScopeObject(obj, where) {
  const fail = (m) => { throw new ScopeError(`scope file ${where}: ${m}`); };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail('root must be an object');
  for (const k of Object.keys(obj)) if (!TOP_KEYS.has(k)) fail(`unknown key "${k}"`);
  if (obj.version !== 1) fail(`"version" must be 1 (found ${JSON.stringify(obj.version)})`);
  if (!Array.isArray(obj.entries)) fail('"entries" must be an array');
  obj.entries.forEach((e, i) => {
    const at = `entries[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) fail(`${at} must be an object`);
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.has(k)) fail(`unknown key "${k}" in ${at}`);
    const hasName = e.name !== undefined, hasPattern = e.pattern !== undefined;
    if (hasName === hasPattern) fail(`${at} must have exactly one of "name" or "pattern"`);
    const v = hasName ? e.name : e.pattern;
    if (typeof v !== 'string' || !v.trim()) fail(`${at}.${hasName ? 'name' : 'pattern'} must be a non-empty string`);
    if (hasName && /[*?]/.test(v)) fail(`${at}.name contains a wildcard; use "pattern" for * and ?`);
    if (hasPattern && BAD_PATTERN.test(v)) fail(`${at}.pattern may use only * and ? as wildcards`);
    if (e.includeDescendants !== undefined && typeof e.includeDescendants !== 'boolean') fail(`${at}.includeDescendants must be true or false`);
    if (e.enabled !== undefined && typeof e.enabled !== 'boolean') fail(`${at}.enabled must be true or false`);
  });
  return obj;
}

// parse + validate scope-file text. Returns {entries (enabled only), all, sha256}.
function parseScopeText(text, where) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new ScopeError(`scope file ${where}: invalid JSON: ${e.message}`); }
  validateScopeObject(obj, where);
  const sha256 = crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  const enabled = obj.entries.filter((e) => e.enabled !== false)
    .map((e) => ({ ...(e.name !== undefined ? { name: e.name } : { pattern: e.pattern }), includeDescendants: e.includeDescendants === true, ...(e.note ? { note: e.note } : {}) }));
  const workload = workloadExt.validateWorkloadExt(obj, where, (m) => new ScopeError(m));
  return { entries: enabled, totalEntries: obj.entries.length, sha256, workload };
}

const TEMPLATES = Object.freeze({
  dev: Object.freeze([
    'node', 'docker', 'dockerd', 'com.docker.backend', 'docker desktop', 'postgres', 'redis-server', 'chromium', 'chrome-headless-shell',
  ]),
});

function templateEntries(name) {
  const list = TEMPLATES[name];
  if (!list) return null;
  return list.map((n) => ({ name: n, includeDescendants: false }));
}

// ---------- matcher ----------
const globToRegex = (g) => new RegExp('^' + g.toLowerCase().replace(/\.exe$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');

function createMatcher(entries) {
  const compiled = entries.map((e) => (e.name !== undefined
    ? { entry: e, name: normName(e.name), desc: e.includeDescendants === true }
    : { entry: e, re: globToRegex(e.pattern), desc: e.includeDescendants === true }));
  const match = (procName) => {
    const n = normName(procName);
    if (!n) return null;
    for (const c of compiled) if (c.name !== undefined ? c.name === n : c.re.test(n)) return c;
    return null;
  };
  return { entries, match, hasDescendantEntries: compiled.some((c) => c.desc) };
}

// ---------- scope loading ----------
function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
}

const RETIRED = ['hide', 'focus', 'extras'];
function retiredMessage(flag) {
  return `--${flag} was removed: list what to monitor in telltale.scope.json (see README "Scope")`;
}
// returns the first retired flag/config key found, or null
function findRetired(args, cfg) {
  for (const k of RETIRED) {
    if (args.includes(`--${k}`)) return { key: k, via: 'flag', message: retiredMessage(k) };
    if (cfg && Object.prototype.hasOwnProperty.call(cfg, k)) return { key: k, via: 'config', message: `config key "${k}" was removed: list what to monitor in telltale.scope.json (see README "Scope")` };
  }
  return null;
}

function buildDecl({ mode, source, filePath, sha256, entries, warnings }) {
  return {
    mode, source, path: filePath || null, sha256: sha256 || null,
    entries: entries.map((e) => ({ ...(e.name !== undefined ? { name: e.name } : { pattern: e.pattern }), includeDescendants: e.includeDescendants === true })),
    matchRule: MATCH_RULE,
    systemSet: { listVersion: SYSTEM_SET.listVersion, categories: Object.keys(SYSTEM_SET.categories), names: Object.values(SYSTEM_SET.categories).flat() },
    counts: { inScopeGroups: null, systemGroups: null, outOfScopeGroups: null },
    fallbacks: [],
    ...(warnings && warnings.length ? { warnings } : {}),
    statement: mode === 'open' ? OPEN_BANNER : STATEMENT,
  };
}

// Precedence: --only flag, then --scope PATH / config "scope", then --preset, then ./telltale.scope.json, else open scope.
// Throws ScopeError (exitCode 2) on an invalid scope file or retired flag. Never writes files.
function loadScope({ cfg = {}, args = [], cwd = process.cwd() } = {}) {
  const retired = findRetired(args, cfg);
  if (retired) throw new ScopeError(retired.message);
  const onlyRaw = argValue(args, '--only') !== undefined ? argValue(args, '--only') : (cfg.only !== undefined ? String(cfg.only) : '');
  const only = onlyRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const explicitPath = argValue(args, '--scope') || (cfg.scope ? String(cfg.scope) : undefined);
  const preset = (argValue(args, '--preset') || (cfg.preset !== undefined ? String(cfg.preset) : '')).toLowerCase();
  const warnings = [];
  let decl, entries, workload = null;
  if (only.length) {
    entries = only.map((n) => (/[*?]/.test(n) ? { pattern: n, includeDescendants: false } : { name: n, includeDescendants: false }));
    decl = buildDecl({ mode: 'allowlist', source: 'flag', entries });
  } else if (explicitPath || (!preset && fs.existsSync(path.join(cwd, 'telltale.scope.json')))) {
    const p = path.resolve(cwd, explicitPath || 'telltale.scope.json');
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch (e) { throw new ScopeError(`scope file ${p}: cannot read: ${e.message}`); }
    const parsed = parseScopeText(text.replace(/^﻿/, ''), p);
    entries = parsed.entries;
    workload = parsed.workload;
    if (!entries.length) warnings.push(`scope file ${p} has no enabled entries: only the system set is monitored (edit the file and set "enabled": true)`);
    decl = buildDecl({ mode: 'allowlist', source: 'file', filePath: p, sha256: parsed.sha256, entries, warnings });
  } else if (preset === 'dev') {
    entries = templateEntries('dev');
    decl = buildDecl({ mode: 'allowlist', source: 'template:dev', entries });
  } else {
    entries = [];
    if (preset && preset !== 'plain') warnings.push(`unknown --preset '${preset}' (want dev|plain) - using open scope`);
    decl = buildDecl({ mode: 'open', source: 'none', entries, warnings });
  }
  return { decl, matcher: createMatcher(entries), preset, workload: workload || { phases: [], probes: [], config: [] } };
}

// draft scope file written for --preset dev when none exists; returns the path or null
function writeTemplateDraft(cwd, presetName) {
  const list = templateEntries(presetName);
  const p = path.join(cwd, 'telltale.scope.json');
  if (!list || fs.existsSync(p)) return null;
  const body = { version: 1, note: `drafted from template:${presetName}; edit freely`, entries: list.map((e) => ({ ...e, enabled: true })) };
  try { fs.writeFileSync(p, JSON.stringify(body, null, 2) + '\n'); return p; } catch { return null; }
}

// ---------- resolver ----------
const RESOLVED = Symbol('telltale.scope.resolved');

function assertResolved(x, what = 'writer') {
  if (!x || x[RESOLVED] !== true) throw new TypeError(`${what} accepts only resolved process structures (got raw rows); route them through scope.resolve() first`);
  return x;
}

const round1 = (x) => Math.round(x * 10) / 10;

function totals(groupSet, rows) {
  const memMB = Math.round(rows.reduce((a, r) => a + (r.memMB || 0), 0));
  const cpuKnown = rows.every((r) => Number.isFinite(r.cpuPct));
  const t = { groups: groupSet.size, processes: rows.length, memMB, cpuPctOfMachine: cpuKnown ? round1(rows.reduce((a, r) => a + (r.cpuPct || 0), 0)) : null };
  if (!cpuKnown) t.cpuReason = CPU_NOTE;
  return t;
}

// open: no allow-list declared, so every non-system process is "in scope" (named, declared loudly as OPEN SCOPE)
function createResolver(matcher, { now = () => new Date(), open = false } = {}) {
  const pinned = new Set();            // descendant keys "pid:creationTime", fixed at process start
  const outNames = new Set();          // in-memory only: lowercase base names seen out of scope
  const fallbacks = [];
  let safeRe = null, safeReSize = -1;

  const recordFallback = (reason) => {
    const last = fallbacks[fallbacks.length - 1];
    if (last && last.reason === reason) return;
    if (fallbacks.length < 20) fallbacks.push({ at: now().toISOString(), reason });
  };

  function resolve(rows, opts = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const cls = new Array(list.length); // 'in' | 'sys' | 'out' | 'desc'
    const keyOf = (r) => `${r.pid}:${r.ct}`;
    const descRoot = new Array(list.length).fill(false); // member that spreads descendants
    list.forEach((r, i) => {
      const m = open ? null : matcher.match(r.name);
      if (open && !systemCategory(r.name)) { cls[i] = 'in'; return; }
      if (m) { cls[i] = 'in'; descRoot[i] = m.desc; if (m.desc && r.ct !== undefined && r.pid !== undefined) pinned.add(keyOf(r)); return; }
      cls[i] = systemCategory(r.name) ? 'sys' : 'out';
    });
    if (matcher.hasDescendantEntries) {
      const withTree = list.filter((r) => r.ppid !== undefined && r.ct !== undefined).length;
      const treeOk = !opts.treeUnavailable && withTree > 0 && withTree >= list.length * 0.5;
      if (!treeOk) recordFallback(opts.treeUnavailable ? `parent information unavailable: ${String(opts.treeUnavailable).slice(0, 100)}` : 'parent information unavailable for this snapshot; exact entry names only');
      else {
        const byPid = new Map();
        list.forEach((r, i) => byPid.set(String(r.pid), i));
        // previously pinned (pid, creation time) pairs stay in scope and keep spreading
        list.forEach((r, i) => { if (cls[i] === 'out' && pinned.has(keyOf(r))) { cls[i] = 'desc'; descRoot[i] = true; } });
        let grew = true;
        while (grew) {
          grew = false;
          list.forEach((r, i) => {
            if (cls[i] !== 'out') return;
            const pi = byPid.get(String(r.ppid));
            if (pi === undefined || !descRoot[pi]) return;
            if (!pinned.has(keyOf(list[pi]))) return;
            if (!(Number(r.ct) >= Number(list[pi].ct))) return; // parent pid reused: this process predates it
            cls[i] = 'desc'; descRoot[i] = true; pinned.add(keyOf(r)); grew = true;
          });
        }
      }
    }
    const inG = new Map(), sysG = new Map(), outG = new Set();
    const inRows = [], sysRows = [], outRows = [];
    const pidSet = new Set();
    list.forEach((r, i) => {
      if (cls[i] === 'out') { outG.add(normName(r.name)); outRows.push(r); const n = normName(r.name); if (n) outNames.add(n); return; }
      const sys = cls[i] === 'sys';
      const map = sys ? sysG : inG;
      const k = normName(r.name);
      let g = map.get(k);
      if (!g) {
        g = { name: r.name, totalMB: 0, n: 0, pids: [], category: sys ? 'system' : 'user' };
        if (sys) g.systemCategory = systemCategory(r.name);
        map.set(k, g);
      }
      g.totalMB += r.memMB || 0; g.n += 1;
      if (g.pids.length < 4) g.pids.push(r.pid);
      if (Number.isFinite(r.cpuPct)) g.cpuPct = round1((g.cpuPct || 0) + r.cpuPct);
      pidSet.add(String(r.pid));
      (sys ? sysRows : inRows).push(r);
    });
    const inScope = [...inG.values()].sort((a, b) => b.totalMB - a.totalMB);
    const system = [...sysG.values()].sort((a, b) => b.totalMB - a.totalMB);
    const share = {
      outOfScope: totals(outG, outRows), inScope: totals(inG, inRows), system: totals(sysG, sysRows),
      measuredAt: (opts.measuredAt || now()).toISOString(),
    };
    const res = {
      [RESOLVED]: true, inScope, system, share, measuredAt: share.measuredAt,
      counts: { inScopeGroups: inG.size, systemGroups: sysG.size, outOfScopeGroups: outG.size },
      pidSet: () => new Set(pidSet),
      // top-N ranked WITHIN scope + system (not overall-then-filtered)
      top: (n) => [...inScope, ...system].sort((a, b) => b.totalMB - a.totalMB).slice(0, n),
    };
    return res;
  }

  // classify a bare name (exact semantics only): 'in' | 'sys' | 'out'
  function classifyName(name) {
    if (open) return systemCategory(name) ? 'sys' : 'in';
    if (matcher.match(name)) return 'in';
    return systemCategory(name) ? 'sys' : 'out';
  }
  function noteOutName(name) { const n = normName(name); if (n && classifyName(name) === 'out') outNames.add(n); }

  // keep in-scope and system names, count the rest (never stores the rest)
  function filterNames(names) {
    const seen = new Set(), kept = [];
    let outCount = 0;
    for (const nm of names) {
      const k = normName(nm);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      if (classifyName(nm) === 'out') { outCount++; noteOutName(nm); } else kept.push(nm);
    }
    return { kept, outOfScopeCount: outCount };
  }

  function buildSafeRe() {
    if (safeRe && safeReSize === outNames.size) return safeRe;
    safeReSize = outNames.size;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const names = [...outNames].sort((a, b) => b.length - a.length);
    const long = names.filter((n) => n.length >= 3 && !BARE_EXEMPT.has(n)).map(esc);
    const short = names.filter((n) => n.length < 3 || BARE_EXEMPT.has(n)).map(esc);
    const parts = [];
    if (long.length) parts.push(`(?:${long.join('|')})(?:\\.exe)?`);
    if (short.length) parts.push(`(?:${short.join('|')})\\.exe`);
    safeRe = parts.length ? new RegExp(`(?<![A-Za-z0-9_.\\-])(?:${parts.join('|')})(?![A-Za-z0-9_])`, 'gi') : null;
    return safeRe;
  }
  let hits = 0;
  function scopeSafe(text) {
    if (typeof text !== 'string' || !outNames.size) return text;
    const re = buildSafeRe();
    if (!re) return text;
    return text.replace(re, () => { hits++; return OUT_TOKEN; });
  }
  // deep copy with every string passed through scopeSafe (backstop for free-text fields)
  function guard(value) {
    if (!outNames.size) return value;
    const walk = (v) => {
      if (typeof v === 'string') return scopeSafe(v);
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        const o = {};
        for (const [k, x] of Object.entries(v)) o[scopeSafe(k)] = walk(x);
        return o;
      }
      return v;
    };
    return walk(value);
  }

  return { matchData: () => buildMatchData(matcher, open, pinned), resolve, classifyName, filterNames, scopeSafe, guard, noteOutName, fallbacks, pinned,
    guardHits: () => hits, outNameCount: () => outNames.size };
}

// ---------- foreground classification (input-response stall detector) ----------
// The helper process decides scope membership for the foreground application at collection time, so it receives
// the resolver's match data (serializable) and runs classifyName() semantics itself. Only the in-scope / system group
// name, the literal 'out-of-scope', or 'unknown' may ever be stored.
function matchDataFor(resolver) { return resolver.matchData(); }
function buildMatchData(matcher, open, pinnedSet) {
  const entries = (matcher && matcher.entries ? matcher.entries : []).map((e) => (e.name !== undefined
    ? { name: normName(e.name), desc: e.includeDescendants === true }
    : { pattern: String(e.pattern).toLowerCase().replace(/\.exe$/, ''), desc: e.includeDescendants === true }));
  return {
    open: !!open, entries,
    system: [...SYSTEM_INDEX.keys()],
    hasDescendantEntries: entries.some((e) => e.desc),
    pinned: pinnedSet ? [...pinnedSet].map((k) => String(k).split(':')[0]) : [],
  };
}
// pure: same semantics as resolver.classifyName plus the pinned-descendant check.
// opts.pid: process id of the foreground application (compared with the pinned descendant ids, never stored)
function classifyForeground(matchData, exeName, opts = {}) {
  const n = normName(exeName);
  if (!n) return { kind: 'unknown', group: null, fallback: 'foreground executable name unreadable' };
  const md = matchData || { open: false, entries: [], system: [] };
  const sys = new Set(md.system || []);
  const glob = globToRegex;
  if (md.open) return sys.has(n) ? { kind: 'system', group: n } : { kind: 'in-scope', group: n };
  for (const e of md.entries || []) if (e.name !== undefined ? e.name === n : glob(e.pattern).test(n)) return { kind: 'in-scope', group: n };
  if (sys.has(n)) return { kind: 'system', group: n };
  if (md.hasDescendantEntries) {
    if (opts.pid !== undefined && (md.pinned || []).map(String).includes(String(opts.pid))) return { kind: 'in-scope', group: n };
    // descendants cannot be checked for this moment: narrower, never wider
    return { kind: 'out-of-scope', group: null, fallback: 'descendant relationship not checkable for the foreground application; classified out-of-scope' };
  }
  return { kind: 'out-of-scope', group: null };
}

// ---------- writers accept only resolved structures ----------
function rowsForJson(res, { n = 6, labeler } = {}) {
  assertResolved(res, 'JSON writer');
  return res.top(n).map((g) => {
    const lab = labeler ? labeler(g) : null;
    const row = { name: g.name, totalMB: g.totalMB, instances: g.n, category: g.category,
      ...(g.systemCategory ? { systemCategory: g.systemCategory } : {}),
      ...(lab ? { label: lab.label, labelRule: lab.rule } : {}),
      ...(g.cpuPct !== undefined ? { cpuPct: g.cpuPct } : {}) };
    Object.defineProperty(row, 'pids', { value: g.pids, enumerable: false }); // joins (GPU) only; never serialized
    return row;
  });
}
function rowsForConsole(res, n = 3) {
  assertResolved(res, 'console writer');
  return res.top(n).map((g) => `${g.name} ${g.totalMB}MB`);
}
function rowsForMarkdown(res, n = 6) {
  assertResolved(res, 'Markdown writer');
  return res.top(n).map((g) => `| ${g.name} | ${g.category} | ${g.totalMB} | ${g.n} |`);
}

// hang-row snapshot: culpritsAtHang ranked within scope plus the aggregate for the same moment
function hangSnapshot(res, labeler) {
  assertResolved(res, 'hang snapshot writer');
  return {
    culpritsAtHang: res.top(3).map((g) => ({ name: g.name, totalMB: g.totalMB, n: g.n, pids: g.pids, category: g.category, ...(labeler ? (() => { const l = labeler(g); return l ? { detail: l.label, labelRule: l.rule } : {}; })() : {}) })),
    scopeShare: res.share,
  };
}

// watch-log line fragment: top groups within scope + system set, and the anonymous out-of-scope aggregate.
// Built from the same resolved structure as the trace snapshot, so both modes agree on membership.
function watchRow(res, n = 3) {
  assertResolved(res, 'watch writer');
  return { top: res.top(n).map((g) => ({ name: g.name, totalMB: g.totalMB, category: g.category })), outOfScope: res.share.outOfScope };
}

// light process enumeration text ("name|pid|MB" per line) -> raw rows. Every row is returned; resolve BEFORE truncating.
function parseProcessList(stdout, isSelf = () => false) {
  return String(stdout || '').split('\n').map((l) => l.trim().split('|')).filter((p) => p.length === 3 && +p[2] > 0 && !isSelf(p[1]))
    .map(([name, pid, mb]) => ({ name, pid: +pid, memMB: +mb }));
}

// ---------- application labels (command line read in memory for in-scope PIDs only; never persisted) ----------
const baseName = (p) => String(p || '').split(/[/\\]/).pop();
const APP_LABEL_RULES = Object.freeze([
  { id: 'node-script', applies: (n) => n === 'node', derive: (cmd) => { const m = String(cmd).match(/([^\s"']+\.(?:m?js|cjs|ts))/); return m ? `Node: ${baseName(m[1])}` : null; } },
  { id: 'postgres-db', applies: (n) => n === 'postgres', derive: (cmd) => {
    const c = String(cmd); const m = c.match(/dbname=([^\s"']+)/) || c.match(/(?:^|\s)-D\s+"?([^"\s]+(?:\\[^"\s]+)*)"?/);
    return m ? `Postgres DB: ${baseName(m[1].replace(/[/\\]+$/, ''))}` : null;
  } },
  { id: 'container-name', applies: (n) => n === 'docker', derive: (cmd) => { const m = String(cmd).match(/--name[= ]+([A-Za-z0-9_.-]+)/); return m ? `Container: ${m[1]}` : null; } },
]);
// returns {label, rule}; falls back to the supplied friendly label with rule 'none'
function deriveLabel(procName, cmd, fallbackLabel) {
  const n = normName(procName);
  for (const r of APP_LABEL_RULES) {
    if (!r.applies(n)) continue;
    const l = cmd ? r.derive(cmd) : null;
    if (l) return { label: l, rule: r.id };
  }
  return { label: fallbackLabel || procName, rule: 'none' };
}

// ---------- docker / WSL text -> resolved rows (raw text is never stored) ----------
function parseDockerPs(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const sp = l.indexOf(' ');
    return { name: sp < 0 ? l : l.slice(0, sp), status: sp < 0 ? '' : l.slice(sp + 1) };
  }).filter((r) => r.name);
}
function parseDockerStats(text) {
  return String(text || '').split('\n').map((l) => l.trim().split('|')).filter((p) => p.length === 3 && p[0])
    .map(([name, mem, cpu]) => ({ name, mem: mem.trim(), cpu: cpu.trim() }));
}
function parseWslList(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const l = raw.replace(/^\s*\*?\s*/, '').trim();
    if (!l || /^NAME\s+STATE/i.test(l)) continue;
    const p = l.split(/\s{2,}|\t+/).map((s) => s.trim()).filter(Boolean);
    const first = p[0].split(/\s+/);
    if (!first[0]) continue;
    out.push({ name: first[0], state: p[1] || first[1] || '', version: p[2] || first[2] || '' });
  }
  return out;
}
// keeps in-scope/system names; everything else becomes a count
function resolveNamedRows(resolver, rows) {
  const kept = [];
  let outOfScope = 0;
  for (const r of rows) {
    if (resolver.classifyName(r.name) === 'out') { outOfScope++; resolver.noteOutName(r.name); } else kept.push(r);
  }
  return { kept, outOfScope };
}

// ---------- event excerpts: provider, id, time, and in-scope name matches only; never message text ----------
function sanitizeEventRecords(records, resolver) {
  return (records || []).map((r) => {
    const { message, ...rest } = r;
    const names = [];
    if (message) {
      for (const tok of String(message).match(/[A-Za-z0-9_.\-]+\.exe\b/gi) || []) {
        if (resolver.classifyName(tok) !== 'out') { if (!names.includes(tok)) names.push(tok); } else resolver.noteOutName(tok);
      }
    }
    return message === undefined ? rest : { ...rest, inScopeNames: names };
  });
}
function sanitizeEventsSection(section, resolver) {
  if (!section || !section.inWindow) return section;
  const inWindow = {};
  for (const [k, v] of Object.entries(section.inWindow)) inWindow[k] = sanitizeEventRecords(v, resolver);
  return { ...section, inWindow };
}

// ---------- GPU per-PID maps: keep allowed PIDs, aggregate the rest ----------
function scrubPidMap(m, allowedPids, valueKey, isSelf = () => false) {
  if (!m || m.unavailable || !m.byPid) return m;
  const byPid = {};
  let outPids = 0, outSum = 0;
  for (const [pid, v] of Object.entries(m.byPid)) {
    if (isSelf(pid)) continue;
    if (allowedPids.has(String(pid))) byPid[pid] = v;
    else { outPids++; outSum += Number(v && v[valueKey]) || 0; }
  }
  return { ...m, byPid, outOfScope: { pids: outPids, [valueKey]: +outSum.toFixed(1) } };
}

// ---------- inventory (local only) ----------
// groups: rolled-up rows [{name, totalMB, n}] from a local snapshot. The only writer that lists everything,
// and it only ever targets the private/ folder.
function buildInventory(groups, { friendlyFn, takenAt = new Date() } = {}) {
  const out = groups.map((g) => ({
    name: g.name, friendly: friendlyFn ? friendlyFn(g.name) : g.name, instances: g.n, memMB: g.totalMB,
    category: systemCategory(g.name) ? 'system' : 'user',
  })).sort((x, y) => y.memMB - x.memMB);
  return { shareable: false, takenAt: takenAt.toISOString(), note: 'LOCAL ONLY: lists every running software group. Never attach, pack, or share this file.', groups: out };
}
function draftScopeFromInventory(inv) {
  return {
    version: 1,
    note: 'Drafted from a local inventory. Every entry is disabled: set "enabled": true on what you want monitored, then run again.',
    entries: inv.groups.filter((g) => g.category === 'user').map((g) => {
      const e = { name: normName(g.name), includeDescendants: false, enabled: false };
      if (g.friendly && g.friendly !== g.name) e.note = g.friendly;
      return e;
    }),
  };
}

function isPrivatePath(p) {
  return String(p).split(/[\\/]+/).some((seg) => seg.toLowerCase() === 'private');
}
// shareable-artifact readers call this on every input path
function assertShareablePath(p) {
  if (isPrivatePath(p)) throw new ScopeError(`refusing ${p}: it is under a private/ folder (local-only inventory is never packed, rendered or attached)`);
  try {
    if (fs.existsSync(p) && fs.statSync(p).isFile() && fs.statSync(p).size < 5e6) {
      const head = fs.readFileSync(p, 'utf8').slice(0, 400);
      if (/"shareable"\s*:\s*false/.test(head)) throw new ScopeError(`refusing ${p}: file is marked "shareable": false (local-only inventory)`);
    }
  } catch (e) { if (e instanceof ScopeError) throw e; }
  return p;
}

// run-level aggregate record (report.outOfScope): out-of-scope totals plus in-scope and system totals, same moment
function runAggregate(res) {
  assertResolved(res, 'aggregate writer');
  const sh = res.share, o = sh.outOfScope;
  const slim = (t) => ({ memMB: t.memMB, cpuPctOfMachine: t.cpuPctOfMachine });
  return { groups: o.groups, processes: o.processes, memMB: o.memMB, cpuPctOfMachine: o.cpuPctOfMachine,
    ...(o.cpuReason ? { cpuReason: o.cpuReason } : {}), inScope: slim(sh.inScope), system: slim(sh.system), measuredAt: sh.measuredAt };
}

// ---------- declaration (leads every shareable view) ----------
function declarationLines(decl, outOfScope) {
  if (!decl) return ['Scope: not recorded in this file.'];
  if (decl.mode === 'open') return [OPEN_BANNER];
  const c = decl.counts || {};
  const ent = (decl.entries || []).map((e) => `${e.name !== undefined ? e.name : e.pattern}${e.includeDescendants ? ' (+descendants)' : ''}`);
  const out = outOfScope || {};
  const lines = [
    `Scope: ${decl.mode}${decl.source ? ` from ${decl.source}` : ' (recorded before scope declarations existed)'}${decl.path ? ` (${decl.path}${decl.sha256 ? `, sha256 ${decl.sha256.slice(0, 12)}` : ''})` : ''}`,
    `Monitored by your list: ${ent.length ? ent.join(', ') : 'nothing (only the system set)'}`,
    `Match rule: ${decl.matchRule}`,
    `System set (always monitored, list v${decl.systemSet && decl.systemSet.listVersion}): ${decl.systemSet ? decl.systemSet.categories.join(', ') : 'n/a'}`,
    `Groups: ${c.inScopeGroups ?? 'n/a'} in scope, ${c.systemGroups ?? 'n/a'} system, ${c.outOfScopeGroups ?? 'n/a'} outside scope`,
  ];
  if (out && out.memMB !== undefined && out.memMB !== null) lines.push(`Outside scope (anonymous aggregate): ${out.groups ?? '?'} groups, ${out.processes ?? '?'} processes, ${out.memMB} MB${out.cpuPctOfMachine === null || out.cpuPctOfMachine === undefined ? '' : `, ${out.cpuPctOfMachine}% CPU`}`);
  lines.push(decl.statement || STATEMENT);
  return lines;
}
function declarationMarkdown(decl, outOfScope) {
  const lines = declarationLines(decl, outOfScope);
  if (decl && decl.mode === 'open') return `## Scope\n**${lines[0]}**\n`;
  return `## Scope\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
}

module.exports = {
  BARE_EXEMPT, STATEMENT, OPEN_BANNER, MATCH_RULE, CPU_NOTE, OUT_TOKEN, SYSTEM_SET, SYSTEM_LABELS, APP_LABEL_RULES, TEMPLATES, RESOLVED,
  ScopeError, normName, systemCategory, parseScopeText, validateScopeObject, templateEntries, createMatcher, loadScope, writeTemplateDraft,
  matchDataFor, classifyForeground, createResolver, assertResolved, rowsForJson, rowsForConsole, rowsForMarkdown, hangSnapshot, runAggregate, watchRow, parseProcessList, deriveLabel,
  parseDockerPs, parseDockerStats, parseWslList, resolveNamedRows, sanitizeEventRecords, sanitizeEventsSection, scrubPidMap,
  buildInventory, draftScopeFromInventory, isPrivatePath, assertShareablePath, declarationLines, declarationMarkdown, findRetired, retiredMessage,
};
