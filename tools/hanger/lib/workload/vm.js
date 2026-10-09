'use strict';
// WSL2 / container VM visibility, layered:
//  (a) host-side VM memory: the working set of the VM host process, from the process poll (always available while it runs)
//  (b) the configured memory cap, from the user's VM config file
//  (c) guest-reported memory, only when an in-scope distro is ALREADY running (a stopped VM is never started)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { R, reasonFromExec, unresponsive } = require('./reasons');

const HOST_NAMES = /^(vmmem|vmmemwsl|vmmemcmzygote|vmmem[a-z]*)(\.exe)?$/i;
const isVmHostProcess = (name) => HOST_NAMES.test(String(name || '').trim());

// process rows [{name, memMB}] -> total VM host MB, or null with a reason
function hostMemFromRows(rows) {
  const hit = (rows || []).filter((r) => isVmHostProcess(r.name));
  if (!hit.length) return { value: null, unavailableReason: R.VM_STOPPED };
  const mb = hit.reduce((a, r) => a + (Number(r.memMB) || 0), 0);
  // the host process can exist while the platform hides its memory from user tier (reported as 0 / N/A)
  return mb > 0 ? { value: Math.round(mb) } : { value: null, unavailableReason: R.NOT_VISIBLE };
}

// tasklist /FO CSV /NH rows for the VM host process -> [{name, memMB}] ("N/A" memory is 0: hidden at user tier)
function parseVmHostRows(csv) {
  const rows = [];
  for (const l of String(csv || '').split(/\r?\n/)) {
    if (!l.includes('","')) continue;
    const p = l.trim().replace(/^"|"$/g, '').split('","');
    if (p.length < 5 || !isVmHostProcess(p[0])) continue;
    rows.push({ name: p[0], memMB: Math.round((parseInt(String(p[4]).replace(/[^\d]/g, ''), 10) || 0) / 1024) });
  }
  return rows;
}

// "8GB" "8192MB" "4096 M" "1TB" -> MB
function parseMemoryValue(s) {
  const m = String(s || '').trim().match(/^([\d.]+)\s*(tb|gb|mb|kb|t|g|m|k)?b?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = (m[2] || 'b').toLowerCase().replace(/b$/, '');
  const f = { t: 1048576, g: 1024, m: 1, k: 1 / 1024, '': 1 / 1048576 }[u];
  return Number.isFinite(n) && f !== undefined ? Math.round(n * f) : null;
}

// text of .wslconfig -> {capMB, processors?} ; INI, [wsl2] section, keys are case-insensitive
function parseWslConfig(text) {
  let section = '', capMB = null, found = false, swapMB = null, malformed = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, '').trim();
    if (!line) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { section = sec[1].toLowerCase(); continue; }
    if (line.startsWith('[')) { malformed = true; continue; }
    if (section !== 'wsl2') continue;
    const kv = line.match(/^([A-Za-z0-9_.]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    if (kv[1].toLowerCase() === 'memory') { found = true; capMB = parseMemoryValue(kv[2]); }
    if (kv[1].toLowerCase() === 'swap') swapMB = parseMemoryValue(kv[2]);
  }
  return { memoryKeyPresent: found, capMB, swapMB, malformed };
}

const SOURCE_CFG = 'user VM config';
function readConfiguredCap({ readFile = (p) => fs.readFileSync(p, 'utf8'), home = os.homedir(), file = null } = {}) {
  const p = file || path.join(home, '.wslconfig');
  let text;
  try { text = readFile(p); } catch (e) {
    if (e && e.code === 'ENOENT') return { value: null, unavailableReason: R.NO_CAP, source: SOURCE_CFG };
    return { value: null, unavailableReason: 'VM config unreadable', source: SOURCE_CFG };
  }
  const c = parseWslConfig(text);
  if (c.malformed) return { value: null, unavailableReason: 'VM config unreadable (malformed section header)', source: SOURCE_CFG };
  if (!c.memoryKeyPresent) return { value: null, unavailableReason: R.NO_CAP, source: SOURCE_CFG };
  if (c.capMB === null) return { value: null, unavailableReason: 'VM config unreadable (memory setting not understood)', source: SOURCE_CFG };
  return { value: c.capMB, unit: 'MB', source: SOURCE_CFG };
}

// `wsl -l -v` text (UTF-16 already decoded by the exec wrapper) -> [{name, state, version}]
function parseWslList(text) {
  const out = [];
  for (const raw of String(text || '').replace(/\0/g, '').split('\n')) {
    const l = raw.replace(/^\s*\*?\s*/, '').trim();
    if (!l || /^NAME\s+STATE/i.test(l)) continue;
    const p = l.split(/\s{2,}|\t+/).map((s) => s.trim()).filter(Boolean);
    const first = (p[0] || '').split(/\s+/);
    if (!first[0]) continue;
    out.push({ name: first[0], state: (p[1] || first[1] || '').toLowerCase(), version: p[2] || first[2] || '' });
  }
  return out;
}

// /proc/meminfo text -> {totalMB, usedMB}
function parseMeminfo(text) {
  const g = (k) => { const m = String(text || '').match(new RegExp('^' + k + ':\\s+(\\d+)\\s*kB', 'mi')); return m ? +m[1] / 1024 : null; };
  const total = g('MemTotal'), avail = g('MemAvailable');
  if (total === null) return null;
  return { totalMB: Math.round(total), usedMB: avail === null ? null : Math.round(total - avail) };
}

// One VM state poll: list distros (never starts one), then guest memory for an in-scope RUNNING distro only.
async function pollVm({ exec, resolver, ctx = null, timeoutMs = 3000 }) {
  const l = await exec('wsl.exe', ['-l', '-v'], { timeoutMs, tier: 'onTrigger', ctx });
  const reason = reasonFromExec(l, { timeoutMs });
  if (reason) return { ok: false, reason: reason === R.NOT_RUNNING ? R.NOT_RUNNING : reason, guestMem: { value: null, unavailableReason: reason } };
  const distros = parseWslList(l.stdout);
  const running = distros.filter((d) => d.state === 'running');
  if (!running.length) return { ok: true, distros: distros.length, runningCount: 0, guestMem: { value: null, unavailableReason: R.VM_STOPPED } };
  const target = running.find((d) => resolver.classifyName(d.name) === 'in');
  for (const d of distros) if (resolver.classifyName(d.name) === 'out') resolver.noteOutName(d.name);
  if (!target) return { ok: true, distros: distros.length, runningCount: running.length, guestMem: { value: null, unavailableReason: R.NOT_DECLARED } };
  const g = await exec('wsl.exe', ['-d', target.name, '-e', 'cat', '/proc/meminfo'], { timeoutMs, tier: 'onTrigger', ctx });
  const gr = reasonFromExec(g, { timeoutMs });
  if (gr) return { ok: true, distros: distros.length, runningCount: running.length, guestMem: { value: null, unavailableReason: gr } };
  const mi = parseMeminfo(g.stdout);
  return { ok: true, distros: distros.length, runningCount: running.length, guestMem: mi ? { value: mi.usedMB, totalMB: mi.totalMB, unit: 'MB', source: 'guest /proc/meminfo' } : { value: null, unavailableReason: R.FAILED } };
}

module.exports = { parseVmHostRows, isVmHostProcess, hostMemFromRows, parseMemoryValue, parseWslConfig, readConfiguredCap, parseWslList, parseMeminfo, pollVm, unresponsive };
