'use strict';
// System profile for IT (change: system-profile-for-it).
// Static facts collected once per run. Every leaf is a fact record:
//   { value | null, unit?, source, tier, asOf, unavailableReason?, ... }
// A null value always carries unavailableReason. Unknown is never "" and never 0.
// No side effects at require time. Parsing is a pure function of the collector text.
const os = require('os');
const { spawnSync } = require('child_process');

const TIERS = ['user', 'admin', 'user-input'];
const GROUP_TIMEOUT_MS = 8000;
const OVERALL_TIMEOUT_MS = 25000;

// ---------------------------------------------------------------- fact record
const isoNow = (now) => (now instanceof Date ? now : new Date(now || Date.now())).toISOString();

// fact(value, {source, tier, unit, reason, asOf, extra})
function fact(value, o = {}) {
  const f = {};
  let v = value;
  let reason = o.reason;
  if (typeof v === 'string') v = v.trim();
  if (v === '' ) { v = null; reason = 'empty value from source'; }
  if (v === undefined) v = null;
  if (typeof v === 'number' && !Number.isFinite(v)) { v = null; reason = reason || 'non-finite value from source'; }
  f.value = v;
  if (o.unit) f.unit = o.unit;
  f.source = o.source || 'unknown';
  f.tier = o.tier || 'user';
  f.asOf = o.asOf || isoNow();
  if (v === null) f.unavailableReason = (reason && String(reason).trim()) || 'not reported by source';
  if (o.extra) Object.assign(f, o.extra);
  return f;
}

// ------------------------------------------------------------- number / date
// Locale-tolerant: "1.234,5" "1,5" "1 234" "1234.5". Returns null when not numeric.
function parseNum(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).trim().replace(/\s/g, '');
  if (!t || !/^-?[\d.,]+$/.test(t)) return null;
  const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // the later separator is the decimal mark
    if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // a single comma followed by exactly 3 digits and more digits before is a thousands mark
    t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if ((t.match(/\./g) || []).length > 1 || /^[1-9]\d{0,2}\.\d{3}$/.test(t)) {
    // "8.589.934.592" and "2.400" are thousands marks (every quantity parsed here is an integer)
    t = t.replace(/\./g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ISO-8601 in, ISO-8601 out; also dd.MM.yyyy[ HH:mm:ss] (de-DE style) and yyyy-MM-dd.
function parseDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (m) {
    if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(t.length === 10 ? t : (m[7] ? t : t.replace(' ', 'T') + 'Z'));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const pad = (x) => String(x).padStart(2, '0');
    const date = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    return m[4] ? `${date}T${m[4]}:${m[5]}:${m[6] || '00'}.000Z` : date;
  }
  return null;
}

// ------------------------------------------------------------ block parsing
// Collector text: groups delimited by "###name###". Lines inside a group are
//   key=value                 scalar
//   row:<list>|a|b|c          list row
//   TIMEOUT <ms>              group exceeded its time limit
//   ERROR <message>           group threw
//   err:<key>=<message>       one value could not be read
function parseBlocks(text) {
  const groups = {};
  let cur = null;
  const lines = String(text || '').replace(/\u0000/g, '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h = line.match(/^###([A-Za-z0-9_]+)###$/);
    if (h) { cur = groups[h[1]] = { kv: {}, rows: {}, status: 'ok', reason: null }; continue; }
    if (!cur || !line) continue;
    let m;
    if ((m = line.match(/^TIMEOUT\s+(\d+)/))) { cur.status = 'timeout'; cur.reason = `timeout after ${m[1]} ms`; continue; }
    if ((m = line.match(/^ERROR\s+(.*)$/))) { cur.status = 'error'; cur.reason = `source error: ${m[1].slice(0, 160)}`; continue; }
    if ((m = line.match(/^row:([A-Za-z0-9_]+)\|(.*)$/))) { (cur.rows[m[1]] = cur.rows[m[1]] || []).push(m[2].split('|').map((x) => x.trim())); continue; }
    const eq = line.indexOf('=');
    if (eq > 0) cur.kv[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return groups;
}

// helper bound to one group: produces facts with the group's failure reason applied
function groupReader(g, ctx, defaultSource) {
  const failed = !g || g.status !== 'ok';
  const groupReason = !g ? (ctx.missingReason || 'no output from source') : (g.status !== 'ok' ? g.reason : null);
  return {
    failed, groupReason,
    kv: (k) => (g && g.kv[k] !== undefined && g.kv[k] !== '' ? g.kv[k] : null),
    rows: (name) => (g && g.rows[name]) || [],
    mk(value, { source, unit, reason, tier, key, extra } = {}) {
      let r = reason;
      if (value === null || value === undefined || value === '') {
        r = failed ? groupReason : (r || (key && g && g.kv['err:' + key] ? `source error: ${g.kv['err:' + key].slice(0, 140)}` : 'not reported by source'));
        value = null;
      }
      return fact(value, { source: source || defaultSource, unit, reason: r, tier: tier || 'user', asOf: ctx.asOf, extra });
    },
    err: (k) => (g && g.kv['err:' + k]) || null,
  };
}

const PLACEHOLDER_SERIAL = /^(0+|to be filled by o\.?e\.?m\.?|default string|system serial number|none|n\/a|not specified|not applicable|123456789.*|\.+|-+)$/i;
const GB = 1024 ** 3;
const round = (n, d = 1) => (n === null ? null : +n.toFixed(d));

// ----------------------------------------------------------- group builders
function buildIdentity(g, ctx) {
  const r = groupReader(g, ctx, 'firmware-system-info');
  const host = ctx.anonymize ? '<host>' : (r.kv('hostname') || ctx.hostname || null);
  return {
    hostname: fact(host, { source: 'os', tier: 'user', asOf: ctx.asOf, reason: 'hostname not reported' }),
    manufacturer: r.mk(r.kv('manufacturer'), { key: 'manufacturer' }),
    model: r.mk(r.kv('model'), { key: 'model' }),
    // serial: filled in by build() from the firmware group (or a user override)
  };
}

function buildProcessor(g, ctx) {
  const r = groupReader(g, ctx, 'cpu-info');
  const cores = parseNum(r.kv('cores')), logical = parseNum(r.kv('logical')), base = parseNum(r.kv('baseMHz'));
  return {
    model: r.mk(r.kv('model'), { key: 'model' }),
    physicalCores: r.mk(cores > 0 ? cores : null, { unit: 'cores', key: 'cores' }),
    logicalProcessors: r.mk(logical > 0 ? logical : null, { unit: 'threads', key: 'logical' }),
    baseClockMHz: r.mk(base > 0 ? base : null, { unit: 'MHz', key: 'baseMHz' }),
    maxClockMHz: r.mk(parseNum(r.kv('maxMHz')) > 0 ? parseNum(r.kv('maxMHz')) : null, { unit: 'MHz', reason: 'max turbo clock not exposed at user tier', key: 'maxMHz' }),
  };
}

const FORM_FACTORS = { 8: 'DIMM', 12: 'SODIMM', 6: 'soldered', 11: 'soldered' };
function buildMemory(g, ctx) {
  const r = groupReader(g, ctx, 'physical-memory-info');
  const mods = r.rows('module').map((f) => {
    const size = parseNum(f[1]) > 0 ? round(parseNum(f[1]) / GB, 2) : null;
    const speed = parseNum(f[2]) > 0 ? parseNum(f[2]) : (parseNum(f[3]) > 0 ? parseNum(f[3]) : null);
    const ff = FORM_FACTORS[parseNum(f[4])] || null;
    const mod = { slot: f[0] || null, sizeGB: size, speedMTs: speed, formFactor: ff };
    if (size === null) mod.sizeUnavailableReason = 'module size not reported';
    if (speed === null) mod.speedUnavailableReason = 'module speed not reported by source';
    if (ff === null) mod.formFactorUnavailableReason = 'form factor not exposed';
    return mod;
  });
  const totalBytes = parseNum(r.kv('totalBytes'));
  let installed = null, installedSource = 'physical-memory-info';
  const modSum = mods.reduce((a, m) => a + (m.sizeGB || 0), 0);
  if (mods.length && modSum > 0) installed = round(modSum, 2);
  else if (totalBytes > 0) { installed = round(totalBytes / GB, 2); installedSource = 'firmware-system-info (usable memory)'; }
  const slotsTotal = parseNum(r.kv('slotsTotal'));
  return {
    installedGB: r.mk(installed, { unit: 'GB', source: installedSource, key: 'totalBytes' }),
    modules: r.mk(mods.length ? mods : null, { reason: 'no memory module records exposed', key: 'modules' }),
    slotsUsed: r.mk(mods.length ? mods.length : null, { reason: 'no memory module records exposed' }),
    slotsTotal: r.mk(slotsTotal > 0 ? slotsTotal : null, { reason: 'memory array slot count not exposed by firmware', key: 'slotsTotal' }),
  };
}

function buildStorage(g, ctx) {
  const r = groupReader(g, ctx, 'physical-disk-info');
  const disks = r.rows('disk').map((f) => {
    const media = /^(ssd|hdd)$/i.test(f[1]) ? f[1].toUpperCase() : 'unspecified';
    const cap = parseNum(f[3]) > 0 ? round(parseNum(f[3]) / 1e9, 0) : null; // vendor capacity: decimal GB
    const health = f[4] || null;
    const num = parseNum(f[5]);
    const d = { model: f[0] || null, mediaType: media, bus: f[2] || null, capacityGB: cap, health, number: num !== null && num >= 0 ? num : null };
    if (d.number === null) d.numberUnavailableReason = 'disk number not reported';
    if (!d.bus) d.busUnavailableReason = 'bus type not reported';
    if (cap === null) d.capacityUnavailableReason = 'capacity not reported';
    if (!health) d.healthUnavailableReason = `health status not readable at ${ctx.elevated ? 'admin' : 'user'} tier`;
    return d;
  });
  const vol = r.rows('vol').find((f) => f[0] && f[0].toUpperCase() === String(r.kv('systemDrive') || 'C:').toUpperCase()) || r.rows('vol')[0];
  let sv = null;
  if (vol && parseNum(vol[2]) > 0 && parseNum(vol[1]) !== null) sv = { volume: vol[0], freeGB: round(parseNum(vol[1]) / GB, 1), totalGB: round(parseNum(vol[2]) / GB, 1) };
  const out = {
    disks: r.mk(disks.length ? disks : null, { reason: 'no physical disk records returned', key: 'disks' }),
    systemVolume: r.mk(sv, { source: 'logical-disk-info', unit: 'GB', reason: 'system volume not reported', key: 'volume' }),
  };
  return out;
}

function buildGraphics(g, ctx) {
  const r = groupReader(g, ctx, 'video-controller-info');
  const ads = r.rows('adapter').map((f) => {
    const bytes = parseNum(f[1]);
    const a = { name: f[0] || null, dedicatedMB: bytes > 0 ? Math.round(bytes / 1048576) : null, driverVersion: f[2] || null, driverDate: parseDate(f[3]) };
    if (bytes >= 4294967295 - 1048576) a.lowerBound = true; // reporting ceiling (32-bit field)
    if (a.dedicatedMB === null) a.dedicatedUnavailableReason = 'dedicated memory not reported';
    if (!a.driverVersion) a.driverVersionUnavailableReason = 'driver version not reported';
    if (!a.driverDate) a.driverDateUnavailableReason = 'driver date not reported';
    return a;
  }).filter((a) => a.name);
  return { adapters: r.mk(ads.length ? ads : null, { reason: 'no display adapter records returned', key: 'adapters' }) };
}

function buildFirmware(g, ctx) {
  const r = groupReader(g, ctx, 'firmware-bios');
  const date = (parseDate(r.kv('biosDate')) || '').slice(0, 10) || null; // BIOS date is a calendar date
  return {
    biosVendor: r.mk(r.kv('biosVendor'), { key: 'biosVendor' }),
    biosVersion: r.mk(r.kv('biosVersion'), { key: 'biosVersion' }),
    biosDate: r.mk(date, { reason: r.kv('biosDate') ? 'BIOS date not parsable' : undefined, key: 'biosDate' }),
  };
}

function buildSerial(g, ctx, userSerial) {
  if (userSerial) return fact(String(userSerial), { source: 'user-input', tier: 'user-input', asOf: ctx.asOf });
  const r = groupReader(g, ctx, 'firmware-bios');
  const s = r.kv('serial');
  if (s && PLACEHOLDER_SERIAL.test(s)) return r.mk(null, { reason: 'firmware reports a placeholder serial', source: 'firmware-bios' });
  return r.mk(s, { source: 'firmware-bios', key: 'serial', reason: 'firmware did not report a serial' });
}

function buildOs(g, ctx) {
  const r = groupReader(g, ctx, 'os-info');
  const lastBoot = parseDate(r.kv('lastBoot'));
  let uptime = null;
  if (lastBoot && lastBoot.length > 10) {
    const ms = new Date(ctx.asOf).getTime() - new Date(lastBoot).getTime();
    if (ms >= 0) uptime = Math.round(ms / 60000);
  }
  const vbsRaw = parseNum(r.kv('vbs'));
  const vbsMap = { 0: 'off', 1: 'enabled, not running', 2: 'running' };
  const svc = r.kv('securityServices');
  const hvci = svc === null ? null : (svc.split(',').map((x) => x.trim()).includes('2') ? 'running' : 'off');
  return {
    edition: r.mk(r.kv('caption'), { key: 'caption' }),
    version: r.mk(r.kv('version'), { key: 'version' }),
    build: r.mk(r.kv('build'), { key: 'build' }),
    lastBoot: r.mk(lastBoot, { reason: r.kv('lastBoot') ? 'last boot time not parsable' : undefined, key: 'lastBoot' }),
    uptimeMin: r.mk(uptime, { unit: 'min', reason: 'last boot time unavailable', source: 'os-info (derived from last boot and profile time)' }),
    vbs: r.mk(vbsRaw !== null && vbsMap[vbsRaw] !== undefined ? vbsMap[vbsRaw] : null, { source: 'device-guard-info', reason: 'virtualization-based security state not exposed', key: 'vbs' }),
    memoryIntegrity: r.mk(hvci, { source: 'device-guard-info', reason: 'memory-integrity state not exposed', key: 'securityServices' }),
  };
}

const OVERLAYS = {
  '00000000-0000-0000-0000-000000000000': 'Balanced (default overlay)',
  '961cc777-2547-4f9d-8174-7d86181b8a7a': 'Best power efficiency',
  '3af9b8d9-7c97-431d-ad78-34a8bfa6f4be': 'Better performance',
  'ded574b5-45a0-4f42-8737-46345c09c238': 'Best performance',
};
function parsePlanName(s) {
  if (!s) return null;
  // "Power Scheme GUID: <guid>  (Friendly Name (maybe nested))": text from the first "(" after the GUID to the last ")"
  const m = String(s).match(/\(\s*(.+)\)\s*\*?\s*$/);
  return m && m[1].trim() ? m[1].trim() : null;
}
function buildPower(g, adminG, ctx) {
  const r = groupReader(g, ctx, 'powercfg');
  const plan = parsePlanName(r.kv('scheme'));
  const ov = (k) => { const v = r.kv(k); if (!v) return null; return OVERLAYS[v.toLowerCase()] || `overlay ${v}`; };
  const ac = ov('overlayAc'), dc = ov('overlayDc');
  const mode = ac && dc ? (ac === dc ? ac : `AC: ${ac}; battery: ${dc}`) : (ac || dc);
  const present = r.kv('batteryPresent');
  const noBattery = !r.failed && present !== null && /^false$/i.test(present);
  let design = parseNum(r.kv('designMWh')), full = parseNum(r.kv('fullMWh'));
  let batTier = 'user', batSource = 'battery-static-data';
  if (!noBattery && !(design > 0 && full > 0) && ctx.elevated && adminG && adminG.status === 'ok') {
    const d2 = parseNum(adminG.kv.designMWh), f2 = parseNum(adminG.kv.fullMWh);
    if (d2 > 0 && f2 > 0) { design = d2; full = f2; batTier = 'admin'; batSource = 'battery-report'; }
  }
  const nbReason = 'no battery present';
  const miss = (what, k) => {
    const e = r.err(k);
    const base = ctx.elevated ? `${what} not exposed by this machine at admin tier` : `${what} not readable at user tier; admin tier may expose it`;
    return e ? `${base} (${e.trim().slice(0, 60)})` : base;
  };
  const mkBat = (v, unit, k) => {
    if (noBattery) return fact(null, { source: 'battery-static-data', tier: 'user', asOf: ctx.asOf, reason: nbReason });
    return r.mk(v > 0 ? v : null, { unit, source: batSource, tier: batTier, reason: miss(k === 'designMWh' ? 'design capacity' : 'full-charge capacity', k), key: k });
  };
  const health = design > 0 && full > 0 ? Math.round((full / design) * 100) : null;
  return {
    planName: r.mk(plan, { reason: r.kv('scheme') ? 'plan name not parsable from active scheme' : undefined, key: 'scheme' }),
    powerMode: r.mk(mode, { reason: 'power mode overlay not set or not readable', key: 'overlayAc' }),
    batteryDesignWh: noBattery ? mkBat(null, 'Wh', 'designMWh') : mkBat(design > 0 ? round(design / 1000, 1) : null, 'Wh', 'designMWh'),
    batteryFullChargeWh: noBattery ? mkBat(null, 'Wh', 'fullMWh') : mkBat(full > 0 ? round(full / 1000, 1) : null, 'Wh', 'fullMWh'),
    batteryHealthPct: noBattery ? mkBat(null, '%', 'health') : r.mk(health, { unit: '%', source: batSource, tier: batTier, reason: miss('battery capacity', design > 0 ? 'fullMWh' : 'designMWh'), key: 'health' }),
  };
}

function buildVirtualMemory(g, ctx) {
  const r = groupReader(g, ctx, 'pagefile-info');
  const auto = r.kv('systemManaged');
  const sysManaged = auto === null ? null : /^true$/i.test(auto);
  const settings = r.rows('setting');
  const pfs = r.rows('pagefile').map((f) => {
    const st = settings.find((s) => (s[0] || '').toLowerCase() === (f[0] || '').toLowerCase());
    const maxMB = st && parseNum(st[2]) > 0 ? parseNum(st[2]) : null;
    const initMB = st && parseNum(st[1]) > 0 ? parseNum(st[1]) : null;
    const dl = /^([A-Za-z]:)/.exec(String(f[0] || ''));
    const p = { location: f[0] || null, drive: dl ? dl[1].toUpperCase() : null, currentMB: parseNum(f[1]) > 0 ? parseNum(f[1]) : null, initialMB: initMB, maxMB };
    if (initMB === null) p.initialUnavailableReason = sysManaged ? 'system-managed: no fixed initial size' : 'initial size not reported';
    if (p.drive === null) p.driveUnavailableReason = 'pagefile location has no drive letter';
    if (p.currentMB === null) p.currentUnavailableReason = 'current size not reported';
    if (maxMB === null) p.maxUnavailableReason = sysManaged ? 'system-managed: no fixed maximum' : (st ? 'no fixed maximum configured (source reports 0)' : 'maximum size not reported');
    return p;
  });
  const lim = parseNum(r.kv('commitLimitBytes'));
  return {
    pagefiles: r.mk(pfs.length ? pfs : null, { reason: 'no pagefile configured or reported', key: 'pagefiles' }),
    systemManaged: r.mk(sysManaged, { key: 'systemManaged' }),
    commitLimitGB: r.mk(lim > 0 ? round(lim / GB, 2) : null, { unit: 'GB', source: 'os-info (total virtual memory = commit limit)', reason: 'commit limit not reported', key: 'commitLimitBytes' }),
  };
}

function buildVirtualization(g, featG, ctx) {
  const r = groupReader(g, ctx, 'wsl-docker-info');
  let wslVer = null;
  for (const f of r.rows('wsl')) {
    const m = String(f[0] || '').match(/(\d+(?:\.\d+){1,3})/);
    if (m) { wslVer = m[1]; break; }
  }
  const wslErr = r.err('wsl');
  const dockerVer = r.kv('dockerVersion');
  const mem = parseNum(r.kv('dockerMemoryMiB')), cpus = parseNum(r.kv('dockerCpus'));
  let limits = null, limReason = 'Docker Desktop not installed';
  if (dockerVer) {
    if (mem > 0 || cpus > 0) limits = { memoryMiB: mem > 0 ? mem : null, cpus: cpus > 0 ? cpus : null };
    else limReason = r.kv('dockerSettings') === 'absent' ? 'Docker Desktop settings file not found' : 'no explicit memory or CPU limit in Docker Desktop settings (WSL2 backend follows the WSL VM cap)';
  }
  const adminFact = (key, label) => {
    if (!ctx.elevated) return fact(null, { source: 'windows-optional-features', tier: 'admin', asOf: ctx.asOf, reason: 'requires elevation' });
    const fr = groupReader(featG, ctx, 'windows-optional-features');
    const v = fr.kv(key);
    return fr.mk(v === null ? null : /^enabled$/i.test(v), { source: 'windows-optional-features', tier: 'admin', reason: `${label} state not reported` });
  };
  return {
    wslInstalled: r.mk(r.failed ? null : wslVer !== null, { key: 'wsl' }),
    wslVersion: r.mk(wslVer, { reason: wslErr ? 'not installed' : 'WSL version text not parsable', key: 'wsl' }),
    vmPlatform: adminFact('vmPlatform', 'virtual machine platform'),
    hyperV: adminFact('hyperV', 'Hyper-V'),
    dockerDesktopVersion: r.mk(dockerVer, { reason: 'not installed', key: 'dockerVersion' }),
    dockerDesktopLimits: r.mk(limits, { reason: limReason, key: 'dockerSettings' }),
  };
}

function decodeProductState(n) {
  if (n === null) return null;
  const enabled = (n & 0x1000) !== 0;
  const upToDate = (n & 0x10) === 0;
  return `${enabled ? 'enabled' : 'disabled'}, signatures ${upToDate ? 'up to date' : 'out of date'}`;
}
function buildSecurity(g, ctx) {
  const r = groupReader(g, ctx, 'security-center');
  const prods = r.rows('av').map((f) => ({ name: f[0] || null, state: decodeProductState(parseNum(f[1])) || 'state not reported' })).filter((p) => p.name);
  const yn = (v) => (v === null ? null : /^(yes|true)$/i.test(v));
  const domain = yn(r.kv('partOfDomain')) || yn(r.kv('domainJoinedDsreg'));
  const domainKnown = r.kv('partOfDomain') !== null || r.kv('domainJoinedDsreg') !== null;
  return {
    products: r.mk(prods.length ? prods : null, { reason: r.err('av') ? `source error: ${r.err('av').slice(0, 120)}` : 'no security products registered with the OS', key: 'av' }),
    domainJoined: r.mk(domainKnown ? !!domain : null, { source: 'domain-join-info', key: 'partOfDomain' }),
    azureAdJoined: r.mk(yn(r.kv('azureAdJoined')), { source: 'device-registration-status', key: 'azureAdJoined' }),
    mdmEnrolled: r.mk(yn(r.kv('mdmEnrolled')), { source: 'device-registration-status', key: 'mdmEnrolled' }),
  };
}

// ------------------------------------------------------------------ parseProfile
// parseProfile(text, {elevated, anonymize, now, hostname, userInput:{serial,warrantyDate,warrantyNote}, missingReason})
function parseProfile(text, opts = {}) {
  const asOf = isoNow(opts.now);
  const ctx = { asOf, elevated: !!opts.elevated, anonymize: !!opts.anonymize, hostname: opts.hostname, missingReason: opts.missingReason };
  const G = parseBlocks(text);
  const ui = opts.userInput || {};
  const identity = buildIdentity(G.identity, ctx);
  identity.serial = buildSerial(G.firmware, ctx, ui.serial);
  const userFact = (v, what) => fact(v || null, { source: 'user-input', tier: 'user-input', asOf, reason: `${what} not supplied` });
  return {
    collectedAt: asOf,
    collectionMs: null,
    tier: ctx.elevated ? 'admin' : 'user',
    identity,
    processor: buildProcessor(G.processor, ctx),
    memory: buildMemory(G.memory, ctx),
    storage: Object.assign(buildStorage(G.storage, ctx), { wearPct: ctx.elevated ? groupReader(G.storageAdmin, ctx, 'storage-reliability').mk(parseNum((G.storageAdmin || { kv: {} }).kv.wearPct), { unit: '%', tier: 'admin', reason: 'wear counter not exposed' }) : fact(null, { source: 'storage-reliability', tier: 'admin', asOf, reason: 'requires elevation' }) }),
    graphics: buildGraphics(G.graphics, ctx),
    firmware: buildFirmware(G.firmware, ctx),
    os: buildOs(G.os, ctx),
    power: buildPower(G.power, G.batteryAdmin, ctx),
    virtualMemory: buildVirtualMemory(G.vmem, ctx),
    virtualization: buildVirtualization(G.virt, G.features, ctx),
    security: buildSecurity(G.security, ctx),
    workloadConfigRef: 'see workloadConfig (owned by workload-session-and-containers)',
    userInput: { warrantyDate: userFact(ui.warrantyDate, 'warranty date'), warrantyNote: userFact(ui.warrantyNote, 'warranty note') },
    groupStatus: Object.fromEntries(Object.entries(G).map(([k, v]) => [k, v.status])),
  };
}

// ------------------------------------------------------------ PowerShell script
// One batched session. Every fact group runs in its own runspace with its own time limit;
// a group that exceeds it emits "TIMEOUT <ms>" while the others are kept. Read-only queries only.
// Never touches containers, WSL distributions or any workload.
function buildScript({ elevated = false, limitMs = GROUP_TIMEOUT_MS } = {}) {
  const groups = {
    identity: `$cs = Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 7
'manufacturer=' + $cs.Manufacturer
'model=' + $cs.Model
'hostname=' + $env:COMPUTERNAME`,
    processor: `$p = @(Get-CimInstance Win32_Processor -OperationTimeoutSec 7)
'model=' + ($p[0].Name -replace '\\s+',' ').Trim()
'cores=' + (($p | Measure-Object NumberOfCores -Sum).Sum)
'logical=' + (($p | Measure-Object NumberOfLogicalProcessors -Sum).Sum)
'baseMHz=' + $p[0].MaxClockSpeed`,
    memory: `$cs = Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 7
'totalBytes=' + $cs.TotalPhysicalMemory
Get-CimInstance Win32_PhysicalMemory -OperationTimeoutSec 7 | ForEach-Object { 'row:module|' + $_.DeviceLocator + '|' + $_.Capacity + '|' + $_.Speed + '|' + $_.ConfiguredClockSpeed + '|' + $_.FormFactor }
$a = Get-CimInstance Win32_PhysicalMemoryArray -OperationTimeoutSec 7 | Select-Object -First 1
if ($a) { 'slotsTotal=' + $a.MemoryDevices }`,
    storage: `Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object { 'row:disk|' + ($_.FriendlyName -replace '\\|','/') + '|' + $_.MediaType + '|' + $_.BusType + '|' + $_.Size + '|' + $_.HealthStatus + '|' + $_.DeviceId }
'systemDrive=' + $env:SystemDrive
Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -OperationTimeoutSec 7 | ForEach-Object { 'row:vol|' + $_.DeviceID + '|' + $_.FreeSpace + '|' + $_.Size }`,
    graphics: `Get-CimInstance Win32_VideoController -OperationTimeoutSec 7 | ForEach-Object { 'row:adapter|' + ($_.Name -replace '\\|','/') + '|' + $_.AdapterRAM + '|' + $_.DriverVersion + '|' + $(if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { '' }) }`,
    firmware: `$b = Get-CimInstance Win32_BIOS -OperationTimeoutSec 7
'biosVendor=' + $b.Manufacturer
'biosVersion=' + $b.SMBIOSBIOSVersion
'biosDate=' + $(if ($b.ReleaseDate) { $b.ReleaseDate.ToString('yyyy-MM-dd') } else { '' })
'serial=' + $b.SerialNumber`,
    os: `$o = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 7
'caption=' + $o.Caption
'version=' + $o.Version
'build=' + $o.BuildNumber
'lastBoot=' + $o.LastBootUpTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
try { $dg = Get-CimInstance -Namespace root\\Microsoft\\Windows\\DeviceGuard -ClassName Win32_DeviceGuard -OperationTimeoutSec 7 -ErrorAction Stop
  'vbs=' + $dg.VirtualizationBasedSecurityStatus
  'securityServices=' + (@($dg.SecurityServicesRunning) -join ',') } catch { 'err:vbs=' + $_.Exception.Message.Split([char]10)[0] }`,
    power: `'scheme=' + ((powercfg /getactivescheme | Select-Object -First 1))
try { $k = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes' -ErrorAction Stop
  if ($k.ActiveOverlayAcPowerScheme) { 'overlayAc=' + $k.ActiveOverlayAcPowerScheme }
  if ($k.ActiveOverlayDcPowerScheme) { 'overlayDc=' + $k.ActiveOverlayDcPowerScheme } } catch { 'err:overlayAc=' + $_.Exception.Message.Split([char]10)[0] }
$bat = @(Get-CimInstance Win32_Battery -OperationTimeoutSec 7)
'batteryPresent=' + ($bat.Count -gt 0)
if ($bat.Count -gt 0) {
  try { $d = Get-CimInstance -Namespace root\\wmi -ClassName BatteryStaticData -OperationTimeoutSec 7 -ErrorAction Stop | Select-Object -First 1; if ($d.DesignedCapacity) { 'designMWh=' + $d.DesignedCapacity } } catch { 'err:designMWh=' + $_.Exception.Message.Split([char]10)[0] }
  try { $f = Get-CimInstance -Namespace root\\wmi -ClassName BatteryFullChargedCapacity -OperationTimeoutSec 7 -ErrorAction Stop | Select-Object -First 1; if ($f.FullChargedCapacity) { 'fullMWh=' + $f.FullChargedCapacity } } catch { 'err:fullMWh=' + $_.Exception.Message.Split([char]10)[0] }
}`,
    vmem: `$cs = Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 7
'systemManaged=' + $cs.AutomaticManagedPagefile
Get-CimInstance Win32_PageFileUsage -OperationTimeoutSec 7 | ForEach-Object { 'row:pagefile|' + $_.Name + '|' + $_.AllocatedBaseSize }
Get-CimInstance Win32_PageFileSetting -OperationTimeoutSec 7 | ForEach-Object { 'row:setting|' + $_.Name + '|' + $_.InitialSize + '|' + $_.MaximumSize }
$o = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 7
if ($o.TotalVirtualMemorySize) { 'commitLimitBytes=' + ([int64]$o.TotalVirtualMemorySize * 1024) }`,
    virt: `try { $t = (& wsl.exe --version 2>$null) | Out-String; foreach ($l in ($t -replace [char]0,'' -split "\`r?\`n")) { if ($l.Trim()) { 'row:wsl|' + $l.Trim() } } } catch { 'err:wsl=' + $_.Exception.Message.Split([char]10)[0] }
if ($LASTEXITCODE -ne 0 -and -not $t) { 'err:wsl=wsl not installed or legacy version' }
$u = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Docker Desktop','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Docker Desktop' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($u -and $u.DisplayVersion) { 'dockerVersion=' + $u.DisplayVersion
  $sf = @("$env:APPDATA\\Docker\\settings-store.json", "$env:APPDATA\\Docker\\settings.json") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($sf) { try { $j = Get-Content $sf -Raw | ConvertFrom-Json; if ($j.MemoryMiB) { 'dockerMemoryMiB=' + $j.MemoryMiB } elseif ($j.memoryMiB) { 'dockerMemoryMiB=' + $j.memoryMiB }; if ($j.Cpus) { 'dockerCpus=' + $j.Cpus } elseif ($j.cpus) { 'dockerCpus=' + $j.cpus } } catch { 'err:dockerSettings=' + $_.Exception.Message.Split([char]10)[0] } } else { 'dockerSettings=absent' }
}`,
    security: `try { Get-CimInstance -Namespace root\\SecurityCenter2 -ClassName AntiVirusProduct -OperationTimeoutSec 7 -ErrorAction Stop | ForEach-Object { 'row:av|' + ($_.displayName -replace '\\|','/') + '|' + $_.productState } } catch { 'err:av=' + $_.Exception.Message.Split([char]10)[0] }
$cs = Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 7
'partOfDomain=' + $cs.PartOfDomain
try { $d = (& dsregcmd.exe /status 2>$null) | Out-String
  if ($d -match 'AzureAdJoined\\s*:\\s*(\\w+)') { 'azureAdJoined=' + $Matches[1] }
  if ($d -match 'DomainJoined\\s*:\\s*(\\w+)') { 'domainJoinedDsreg=' + $Matches[1] }
  'mdmEnrolled=' + [bool]($d -match 'MdmUrl\\s*:\\s*\\S+') } catch { 'err:azureAdJoined=' + $_.Exception.Message.Split([char]10)[0] }`,
  };
  if (elevated) {
    groups.storageAdmin = `$w = Get-PhysicalDisk | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue | Where-Object { $null -ne $_.Wear } | Measure-Object Wear -Maximum
if ($w.Count -gt 0) { 'wearPct=' + $w.Maximum }`;
    groups.features = `Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform,Microsoft-Hyper-V-All -ErrorAction SilentlyContinue | ForEach-Object { if ($_.FeatureName -eq 'VirtualMachinePlatform') { 'vmPlatform=' + $_.State } else { 'hyperV=' + $_.State } }`;
    groups.batteryAdmin = `$f = Join-Path $env:TEMP ('tt-bat-' + [guid]::NewGuid().ToString('N') + '.xml')
powercfg /batteryreport /xml /output $f | Out-Null
if (Test-Path $f) { try { $x = [xml](Get-Content $f -Raw); $b = @($x.BatteryReport.Batteries.Battery)[0]; if ($b) { 'designMWh=' + $b.DesignCapacity; 'fullMWh=' + $b.FullChargeCapacity } } finally { Remove-Item $f -Force -ErrorAction SilentlyContinue } }`;
  }
  const esc = (s) => s.replace(/'/g, "''");
  const defs = Object.entries(groups).map(([n, body]) => `  @{n='${n}'; sb='${esc(body)}'}`).join(",\n");
  return `$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture
$limit = ${limitMs}
$defs = @(
${defs}
)
$pool = [runspacefactory]::CreateRunspacePool(1, 8); $pool.Open()
$jobs = foreach ($d in $defs) {
  $p = [powershell]::Create(); $p.RunspacePool = $pool
  [void]$p.AddScript([scriptblock]::Create($d.sb))
  [pscustomobject]@{ n = $d.n; p = $p; h = $p.BeginInvoke(); t0 = [DateTime]::UtcNow }
}
$sb = New-Object System.Text.StringBuilder
foreach ($j in $jobs) {
  [void]$sb.AppendLine('###' + $j.n + '###')
  $left = [int]($limit - ([DateTime]::UtcNow - $j.t0).TotalMilliseconds); if ($left -lt 0) { $left = 0 }
  if ($j.h.AsyncWaitHandle.WaitOne($left)) {
    try { foreach ($l in @($j.p.EndInvoke($j.h))) { [void]$sb.AppendLine([string]$l) } } catch { [void]$sb.AppendLine('ERROR ' + $_.Exception.Message.Split([char]10)[0]) }
    foreach ($e in $j.p.Streams.Error) { [void]$sb.AppendLine('err:stream=' + ([string]$e).Split([char]10)[0]) }
  } else { [void]$sb.AppendLine('TIMEOUT ' + $limit) }
}
[Console]::Out.Write($sb.ToString()); [Console]::Out.Flush()
[Environment]::Exit(0)
`;
}

// default shell: one powershell session via -EncodedCommand (no quoting issues)
function defaultShell(script, timeoutMs) {
  const enc = Buffer.from(script, 'utf16le').toString('base64');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return { stdout: r.stdout || '', stderr: r.stderr || '', timedOut: !!(r.error && r.error.code === 'ETIMEDOUT'), error: r.error ? String(r.error.message || r.error) : null };
}

// collectProfile({elevated, anonymize, shell, now, userInput, groupTimeoutMs, overallTimeoutMs})
// Windows only; elsewhere every fact is null with a reason. Never throws.
function collectProfile(opts = {}) {
  const t0 = Date.now();
  const nowFn = typeof opts.now === 'function' ? opts.now : () => (opts.now || new Date());
  const startAt = nowFn();
  const elevated = !!opts.elevated;
  const shell = opts.shell || defaultShell;
  const groupMs = opts.groupTimeoutMs || GROUP_TIMEOUT_MS;
  const overallMs = opts.overallTimeoutMs || OVERALL_TIMEOUT_MS;
  let out = { stdout: '' };
  let missingReason = 'no output from source';
  if (!opts.shell && process.platform !== 'win32') missingReason = `profile collectors are Windows-only (platform ${process.platform})`;
  else {
    try {
      out = shell(buildScript({ elevated, limitMs: groupMs }), overallMs) || { stdout: '' };
      if (out.timedOut) missingReason = `timeout after ${overallMs} ms`;
      else if (out.error) missingReason = `collector failed to start: ${String(out.error).slice(0, 120)}`;
    } catch (e) { missingReason = `collector threw: ${String(e.message || e).slice(0, 120)}`; }
  }
  const profile = parseProfile(out.stdout || '', { elevated, anonymize: opts.anonymize, now: startAt, userInput: opts.userInput, hostname: os.hostname(), missingReason });
  profile.collectionMs = Math.max(1, Date.now() - t0);
  return profile;
}

// ---------------------------------------------------------- derived outputs
const val = (f) => (f && f.value !== null && f.value !== undefined ? f.value : null);

function digestLine(p) {
  const u = (x, fallback = 'unavailable') => (x === null || x === undefined ? fallback : x);
  const disks = val(p.storage && p.storage.disks);
  const disk = disks && disks[0] ? [disks[0].bus, disks[0].mediaType].filter((x) => x && x !== 'unspecified').join(' ') || 'disk type unavailable' : 'disk unavailable';
  const cores = val(p.processor.physicalCores), thr = val(p.processor.logicalProcessors);
  const cpu = `${u(val(p.processor.model))} (${u(cores, '?')}C/${u(thr, '?')}T)`;
  const mk = val(p.identity.manufacturer), md = val(p.identity.model);
  const model = (mk && md && md.toLowerCase().startsWith(mk.toLowerCase()) ? md : [mk, md].filter(Boolean).join(' ')) || 'model unavailable';
  const ram = val(p.memory.installedGB);
  return `[profile] ${model} | ${cpu} | ${ram === null ? 'RAM unavailable' : ram + ' GB'} | ${disk} | OS build ${u(val(p.os.build))} | BIOS ${u(val(p.firmware.biosVersion))}`;
}

// legacy v12 `asset` block derived from the profile (alias for one schema minor)
function deriveAsset(p, o = {}) {
  const unk = 'unknown';
  const sv = val(p.storage && p.storage.systemVolume);
  const ram = val(p.memory.installedGB);
  const serial = val(p.identity.serial);
  return {
    hostname: val(p.identity.hostname) || unk,
    manufacturer: val(p.identity.manufacturer) || unk,
    model: val(p.identity.model) || unk,
    serial: serial || unk,
    ramFittedGB: ram,
    ramFittedNote: ram !== null ? `${ram}GB fitted` : `unknown (${p.memory.installedGB.unavailableReason})`,
    diskFreePct: sv ? +((sv.freeGB / sv.totalGB) * 100).toFixed(1) : null,
    diskNote: sv ? `${sv.volume} ${sv.freeGB.toFixed(1)}/${sv.totalGB.toFixed(1)}GB free` : `unknown (${p.storage.systemVolume.unavailableReason})`,
    osCaption: val(p.os.edition) || unk,
    osBuild: val(p.os.version) ? `version ${val(p.os.version)} build ${val(p.os.build) || unk}` : unk,
    warrantyDate: val(p.userInput && p.userInput.warrantyDate) || o.warrantyDate || unk,
    warrantyNote: val(p.userInput && p.userInput.warrantyNote) || o.warrantyNote || unk,
    source: 'derived from systemProfile (alias; removed by report-and-visualization)',
  };
}

// every leaf fact record in a profile (used by tests and the provenance walk)
function walkFacts(node, visit, pathStr = 'systemProfile') {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  if ('value' in node && 'source' in node) { visit(node, pathStr); return; }
  for (const [k, v] of Object.entries(node)) walkFacts(v, visit, `${pathStr}.${k}`);
}

module.exports = { fact, parseProfile, parseBlocks, collectProfile, buildScript, digestLine, deriveAsset, walkFacts, parseNum, parseDate, parsePlanName, TIERS, GROUP_TIMEOUT_MS, OVERALL_TIMEOUT_MS };
