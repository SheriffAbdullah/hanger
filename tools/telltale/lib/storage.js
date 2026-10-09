'use strict';
// Pure storage view over one stored report (change: storage-coverage). No I/O, no side effects at require time.
// Joins the per-drive series (spawnProbes[].disk.drives) to the system profile (class, pagefile drive) and to the drives
// the user declared for the workload (report.storage.workloadDrives). Nothing here reads a serial number, and a placement
// is never inferred from process activity: it is yes/no from a record, or unknown with the reason.
const { plain } = require('./sampler/record');

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const val = (f) => (f && typeof f === 'object' && 'value' in f ? f.value : null);
const rowsOf = (report) => (Array.isArray(report && report.spawnProbes) ? report.spawnProbes : []).map((p) => plain(p));

// section recorded in the report: the user's declaration only
function declared({ workloadDrives = [] } = {}) {
  const list = (workloadDrives || []).map((d) => String(d).toUpperCase());
  return { workloadDrives: list.length ? list : null, workloadDrivesReason: list.length ? null : 'workload drive not declared', source: list.length ? 'scope-file' : 'not declared' };
}

function profileDisks(report) {
  const v = val(report && report.systemProfile && report.systemProfile.storage && report.systemProfile.storage.disks);
  return Array.isArray(v) ? v : [];
}
function pagefiles(report) {
  const f = report && report.systemProfile && report.systemProfile.virtualMemory && report.systemProfile.virtualMemory.pagefiles;
  return { known: !!f && Array.isArray(f.value), list: f && Array.isArray(f.value) ? f.value : [], reason: f && f.unavailableReason ? f.unavailableReason : 'pagefile not recorded' };
}
const pagefileLetters = (report) => [...new Set(pagefiles(report).list.map((p) => p && p.drive).filter(Boolean))];
const workloadLetters = (report) => (report && report.storage && Array.isArray(report.storage.workloadDrives) ? report.storage.workloadDrives.map((d) => String(d).toUpperCase()) : []);

// "NVMe SSD", "SATA HDD", or the part that is known; null with a reason when the profile has no disk with that number
function driveClass(report, diskNumber) {
  const d = profileDisks(report).find((x) => num(x.number) === diskNumber);
  if (!d) return { value: null, reason: profileDisks(report).length ? 'disk number not matched in the system profile' : 'no system profile disk records' };
  const parts = [d.bus, d.mediaType && d.mediaType !== 'unspecified' ? d.mediaType : null].filter(Boolean);
  return parts.length ? { value: parts.join(' '), reason: null } : { value: null, reason: 'media and bus type not reported' };
}

// every drive that has a series in the probes: [{drive, label, diskNumber, letters}]
function drivesSeen(report) {
  const seen = new Map();
  for (const p of rowsOf(report)) for (const d of (p.disk && Array.isArray(p.disk.drives) ? p.disk.drives : [])) if (d && d.drive && !seen.has(d.drive)) seen.set(d.drive, { drive: d.drive, label: d.label || d.drive, diskNumber: num(d.diskNumber), letters: Array.isArray(d.letters) ? d.letters : [] });
  return [...seen.values()].sort((a, b) => (a.diskNumber ?? 99) - (b.diskNumber ?? 99));
}

// yes / no / unknown for each placement
function placement(report, d) {
  const letters = d.letters || [];
  const pf = pagefiles(report);
  let pagefile;
  if (!pf.known) pagefile = { value: null, reason: pf.reason === 'pagefile not recorded' ? 'pagefile not recorded' : pf.reason };
  else if (!pf.list.length) pagefile = { value: false, reason: null };
  else if (pf.list.some((p) => !p.drive)) pagefile = { value: letters.some((l) => pagefileLetters(report).includes(l)) ? true : null, reason: 'a pagefile location has no drive letter' };
  else pagefile = { value: letters.some((l) => pagefileLetters(report).includes(l)), reason: null };
  if (pagefile.value === true) pagefile.reason = null;
  const wl = workloadLetters(report);
  const workload = !wl.length ? { value: null, reason: 'workload drive not declared' } : !letters.length ? { value: null, reason: 'drive has no volume letter' } : { value: letters.some((l) => wl.includes(l)), reason: null };
  return { pagefile, workload };
}

// volumes whose free space can matter: system volume, pagefile volumes, declared workload drives. null = judge every volume
function relevantVolumes(report) {
  const sv = val(report && report.systemProfile && report.systemProfile.storage && report.systemProfile.storage.systemVolume);
  const set = new Set([...(sv && sv.volume ? [String(sv.volume).toUpperCase()] : []), ...pagefileLetters(report), ...workloadLetters(report)]);
  return set.size ? [...set] : null;
}

function describeDrive(report, d) {
  const cls = driveClass(report, d.diskNumber);
  return { ...d, class: cls.value, classReason: cls.reason, ...placement(report, d), text: cls.value ? `${d.label}, ${cls.value}` : d.label };
}
const view = (report) => ({ drives: drivesSeen(report).map((d) => describeDrive(report, d)), relevantVolumes: relevantVolumes(report), workloadDrives: workloadLetters(report) });

// ---------------- per-process disk I/O at a probe: who drove it (in scope only) ----------------
// A name is only ever taken from the in-scope groups and the fixed system set; the out-of-scope aggregate carries no name.
const SYNC_CLIENT_RE = /^(onedrive|dropbox|googledrivefs|googledrive|box|boxsync|icloudservices|icloud|megasync|nextcloud|syncthing)(\.exe)?$/i;
const ioOf = (g) => {
  if (!g) return null;
  const a = num(g.readBps), b = num(g.writeBps);
  return a === null && b === null ? null : (a || 0) + (b || 0);
};
const MB = 1048576;

// row: a plain probe row. Returns one of
//   {kind:'not-recorded', text}                                 no per-process I/O on this probe
//   {kind:'named', group, bps, sharePct, totalBps, text}        an in-scope or system group holds >= sharePct of the observed I/O at >= minBps
//   {kind:'outside-scope', bps, groupCount, sharePct, text}     the anonymous aggregate leads: rate and group count only
//   {kind:'none', text}                                         I/O recorded but nothing dominates
function culprit(row, { minBps = 5 * MB, sharePct = 50 } = {}) {
  const p = row && row.procs;
  if (!p || !Array.isArray(p.groups)) return { kind: 'not-recorded', text: 'per-process disk I/O not recorded' };
  const named = [
    ...p.groups.filter((g) => g && g.group).map((g) => ({ name: g.group, bps: ioOf(g) })),
    ...(Array.isArray(p.system) ? p.system.filter((g) => g && g.member).map((g) => ({ name: g.member, bps: ioOf(g) })) : []),
  ].filter((x) => x.bps !== null);
  const out = p.outOfScope ? ioOf(p.outOfScope) : null;
  const other = p.otherInScope ? ioOf(p.otherInScope) : null;
  if (!named.length && out === null) return { kind: 'not-recorded', text: 'per-process disk I/O not recorded' };
  const total = named.reduce((a, x) => a + x.bps, 0) + (out || 0) + (other || 0);
  const top = named.sort((a, b) => b.bps - a.bps)[0] || null;
  const pct = (x) => (total > 0 ? Math.round(x / total * 1000) / 10 : null);
  if (out !== null && out >= minBps && (!top || out > top.bps) && out * 100 >= total * sharePct) {
    const n = p.outOfScope.groupCount;
    return { kind: 'outside-scope', bps: out, groupCount: Number.isFinite(n) ? n : null, sharePct: pct(out), totalBps: total,
      text: `disk I/O was dominated by load outside the declared scope (${Math.round(out / MB * 10) / 10} MB/s across ${Number.isFinite(n) ? `${n} group${n === 1 ? '' : 's'}` : 'an unknown number of groups'}); no process is named` };
  }
  if (top && top.bps >= minBps && top.bps * 100 >= total * sharePct) {
    return { kind: 'named', group: top.name, bps: top.bps, sharePct: pct(top.bps), totalBps: total,
      text: `${top.name} drove ${Math.round(top.bps / MB * 10) / 10} MB/s, ${pct(top.bps)}% of the observed disk I/O` };
  }
  return { kind: 'none', totalBps: total, text: 'no single process group held at least half of the observed disk I/O at the minimum rate' };
}

// in-scope or system groups that look like a file-sync client with I/O on this probe: [{group, bps}]
function syncClients(row, { minBps = MB } = {}) {
  const p = row && row.procs;
  if (!p) return [];
  const all = [
    ...(Array.isArray(p.groups) ? p.groups.filter((g) => g && g.group).map((g) => ({ group: g.group, bps: ioOf(g) })) : []),
    ...(Array.isArray(p.system) ? p.system.filter((g) => g && g.member).map((g) => ({ group: g.member, bps: ioOf(g) })) : []),
  ];
  return all.filter((x) => x.bps !== null && x.bps >= minBps && SYNC_CLIENT_RE.test(String(x.group)));
}

// the relevant volume with the least free percent on a probe: {volume, freePct, freeMB} or null
function lowestVolume(row, relevant) {
  const v = row && row.disk && Array.isArray(row.disk.volumes) ? row.disk.volumes.filter((x) => x && num(x.freePct) !== null && (!relevant || relevant.includes(String(x.volume).toUpperCase()))) : [];
  if (!v.length) return null;
  const m = v.slice().sort((a, b) => a.freePct - b.freePct)[0];
  return { volume: String(m.volume).toUpperCase(), freePct: m.freePct, freeMB: num(m.freeMB) };
}

// ---------------- storage panel (report views, email): per drive at the hangs versus calm ----------------
const mean = (a) => { const v = a.filter((x) => num(x) !== null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
const isHang = (p) => (typeof p.hang === 'boolean' ? p.hang : num(p.ms) !== null && p.ms >= 800);
// calm = under the recovery threshold and at least 10 s from every hang (the diagnosis engine's definition)
const atMs = (p) => { const t = Date.parse(p.at); return Number.isFinite(t) ? t : null; };
const isCalmIn = (rows) => { const hangMs = rows.filter(isHang).map(atMs).filter((t) => t !== null); return (p) => !isHang(p) && num(p.ms) !== null && p.ms < 400 && !hangMs.some((t) => atMs(p) !== null && Math.abs(atMs(p) - t) < 10000); };

function panel(report) {
  const rows = rowsOf(report);
  const hangs = rows.filter(isHang), calm = rows.filter(isCalmIn(rows));
  const base = view(report);
  const driveRow = (p, d) => (p.disk && Array.isArray(p.disk.drives) ? p.disk.drives.find((x) => x && x.drive === d.drive) : null);
  const stat = (set, d, f) => r1(mean(set.map((p) => { const x = driveRow(p, d); return x ? num(x[f]) : null; })));
  const drives = base.drives.map((d) => ({
    ...d,
    atHang: { latencyMs: stat(hangs, d, 'latencyMs'), queue: stat(hangs, d, 'queue'), busyPct: stat(hangs, d, 'busyPct'), readBps: stat(hangs, d, 'readBps'), writeBps: stat(hangs, d, 'writeBps'), n: hangs.filter((p) => driveRow(p, d)).length },
    calm: { latencyMs: stat(calm, d, 'latencyMs'), queue: stat(calm, d, 'queue'), busyPct: stat(calm, d, 'busyPct'), readBps: stat(calm, d, 'readBps'), writeBps: stat(calm, d, 'writeBps'), n: calm.filter((p) => driveRow(p, d)).length },
  }));
  const letters = new Set();
  for (const p of rows) for (const v of (p.disk && Array.isArray(p.disk.volumes) ? p.disk.volumes : [])) if (v && v.volume) letters.add(String(v.volume).toUpperCase());
  const volStat = (set, v, f) => r1(mean(set.map((p) => { const x = p.disk && Array.isArray(p.disk.volumes) ? p.disk.volumes.find((y) => y && String(y.volume).toUpperCase() === v) : null; return x ? num(x[f]) : null; })));
  const volumes = [...letters].sort().map((v) => ({
    volume: v, relevant: base.relevantVolumes ? base.relevantVolumes.includes(v) : null,
    atHang: { freePct: volStat(hangs, v, 'freePct'), freeMB: volStat(hangs, v, 'freeMB') }, calm: { freePct: volStat(calm, v, 'freePct'), freeMB: volStat(calm, v, 'freeMB') },
    firstFreeMB: (() => { const s = rows.map((p) => { const x = p.disk && Array.isArray(p.disk.volumes) ? p.disk.volumes.find((y) => y && String(y.volume).toUpperCase() === v) : null; return x ? num(x.freeMB) : null; }).filter((x) => x !== null); return s.length ? s[0] : null; })(),
    lastFreeMB: (() => { const s = rows.map((p) => { const x = p.disk && Array.isArray(p.disk.volumes) ? p.disk.volumes.find((y) => y && String(y.volume).toUpperCase() === v) : null; return x ? num(x.freeMB) : null; }).filter((x) => x !== null); return s.length ? s[s.length - 1] : null; })(),
  }));
  const failures = Array.isArray(report && report['collection.failures']) ? report['collection.failures'] : [];
  const why = (inf) => { const f = failures.find((x) => x && x.inference === inf); return f && f.reason ? f.reason : null; };
  // the slowest drive at the hangs (by mean latency), for the email line
  const slow = drives.filter((d) => d.atHang.latencyMs !== null).sort((a, b) => b.atHang.latencyMs - a.atHang.latencyMs)[0] || null;
  const pctOf = (v) => (v.atHang.freePct !== null ? v.atHang.freePct : v.calm.freePct);
  const low = volumes.filter((v) => v.relevant !== false && pctOf(v) !== null).sort((a, b) => pctOf(a) - pctOf(b))[0] || null;
  const minFree = (() => {
    let best = null;
    for (const p of rows) { const l = lowestVolume(p, base.relevantVolumes); if (l && (!best || l.freePct < best.freePct)) best = l; }
    return best;
  })();
  return {
    drives, volumes, slowest: slow, lowestFree: minFree, lowestAtHang: low,
    workloadDrives: base.workloadDrives, relevantVolumes: base.relevantVolumes,
    drivesReason: drives.length ? null : (why('disk.drives') || 'per-drive counters were not recorded in this report'),
    volumesReason: volumes.length ? null : (why('disk.volumes') || 'volume free-space counters were not recorded in this report'),
    hangProbes: hangs.length, calmProbes: calm.length,
  };
}

module.exports = { declared, driveClass, drivesSeen, placement, relevantVolumes, pagefileLetters, workloadLetters, describeDrive, view, rowsOf, culprit, syncClients, lowestVolume, panel, SYNC_CLIENT_RE };
