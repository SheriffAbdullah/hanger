'use strict';
// One section model for every shareable view (report-views "Shareable report section order").
// Built ONLY from the report JSON; the Markdown writer and the HTML writer only format it, so
// their order and content cannot drift. Sections, in order:
//   header, finding, actions, evidence, profile, gaps, appendix
const { plain, isRec } = require('../sampler/record');
const scopeLib = require('../scope');
const vocab = require('../diagnosis/vocabulary');
const { walkFacts } = require('../system-profile');
const { fmt, na, n2, roundDisplay, unitText } = require('./format');
const inputCheck = require('./input-check');
const storageBlock = require('./storage-block');
const { extract, clock, dateText, offsetLabel, get, numOf, ms } = require('./series');

const SECTION_ORDER = ['header', 'finding', 'actions', 'evidence', 'profile', 'gaps', 'appendix'];
const TITLES = { header: 'Run and scope', finding: 'Finding', actions: 'What IT can do', evidence: 'Evidence', profile: 'System profile', gaps: 'Gaps and receipts', appendix: 'Appendix' };

const label = (cls) => vocab.CLASS_LABEL[cls] || String(cls || 'not recorded');
const durTxt = (s) => { const n = numOf(s); if (n === null) return 'not available'; return n < 120 ? `${n2(n)} s` : `${n2(+(n / 60).toFixed(1))} min`; };
const minTxt = (s) => { const n = numOf(s); return n === null ? 'not available' : `${n2(+(n / 60).toFixed(1))} min`; };

// ---------------- plain-language collection gaps ----------------
const SIGNALS = [
  [/docker|container/i, 'Docker'], [/admin/i, 'Admin-only signals'], [/nvidia/i, 'NVIDIA GPU details'], [/gpu/i, 'GPU'], [/thermal|temperature/i, 'Temperature'],
  [/wer|event/i, 'Windows event history'], [/sys\.asset|systemprofile|profile/i, 'System profile'], [/spawn|hang\./i, 'Freeze probe'], [/pack\./i, 'Evidence pack'],
  [/disk/i, 'Disk counters'], [/net/i, 'Network counters'], [/power|battery/i, 'Power and battery'], [/gpu/i, 'GPU'], [/counter/i, 'Performance counters'],
];
const MODE_TEXT = { missing: 'not available', tier: 'needs administrator rights', 'counter-missing': 'counter not available', timeout: 'timed out', denied: 'access denied', 'not-exposed': 'not exposed by this machine', 'skipped-overload': 'skipped to keep the machine responsive', 'over-budget': 'skipped (over the time budget)', failed: 'failed', parse: 'could not be read', 'session-restart': 'the sampler restarted', 'disk-full': 'disk full', truncated: 'cut short' };
const RAW = /not recognized|exit code|exitcode|stderr|\bat line\b|\bat \S+:\d+|exception|traceback|\bPS [A-Z]:\\|CategoryInfo|FullyQualifiedErrorId/i;
function signalName(f) {
  const key = `${f.inference || ''} ${f.collector || ''}`;
  for (const [re, name] of SIGNALS) if (re.test(key)) return name;
  const c = String(f.collector || f.inference || 'a collector').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ');
  return c.charAt(0).toUpperCase() + c.slice(1);
}
function plainReason(f) {
  const reason = typeof f.reason === 'string' ? f.reason.trim() : '';
  if (reason && !RAW.test(reason)) return reason.length > 140 ? `${reason.slice(0, 137)}...` : reason;
  return MODE_TEXT[f.mode] || 'not available';
}
const gapSentence = (f) => `${signalName(f)}: ${plainReason(f)}`;
const GAP_REASON = { 'collector-late': 'the sampler was delayed (heavy load or a stalled collector)' };

// ---------------- facts shared by several sections ----------------
function factVal(profile, path) {
  const f = get(profile, path);
  if (!f || typeof f !== 'object' || !('value' in f)) return { text: null, reason: 'not recorded in this file', fact: null };
  if (f.value === null || f.value === undefined) return { text: null, reason: f.unavailableReason || 'no reason recorded', fact: f };
  return { text: factText(f), raw: f.value, reason: null, fact: f };
}
function factText(f) {
  const v = f.value;
  if (v === null || v === undefined) return na(f.unavailableReason);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return fmt(v, f.unit || '');
  if (Array.isArray(v)) return v.length ? v.map(entryText).join(' | ') : 'none';
  if (typeof v === 'object') return entryText(v);
  return String(v);
}
function entryText(e) {
  if (e === null || typeof e !== 'object') return String(e);
  const parts = [];
  for (const [k, x] of Object.entries(e)) {
    if (/UnavailableReason$/.test(k)) continue;
    if (x === null || x === undefined) { parts.push(`${humanize(k)}: ${na(e[`${k}UnavailableReason`])}`); continue; }
    parts.push(`${humanize(k)}: ${typeof x === 'number' ? n2(x) : String(x)}`);
  }
  return parts.join(', ');
}
function humanize(k) {
  const s = String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return (s.charAt(0).toUpperCase() + s.slice(1)).replace(/gb/g, 'GB').replace(/mb/g, 'MB').replace(/mts/g, 'MT/s').replace(/wh/g, 'Wh');
}
const PROFILE_GROUP_TITLES = { identity: 'Identity', processor: 'Processor', memory: 'Memory', storage: 'Storage', graphics: 'Graphics', firmware: 'Firmware', os: 'Operating system', power: 'Power', virtualMemory: 'Virtual memory', virtualization: 'Virtualization', security: 'Security and management', userInput: 'Supplied by you' };
const PROFILE_LABELS = { 'processor.physicalCores': 'Physical cores', 'processor.logicalProcessors': 'Logical processors (threads)', 'processor.baseClockMHz': 'Base clock', 'processor.maxClockMHz': 'Maximum clock', 'memory.installedGB': 'Installed memory', 'memory.slotsUsed': 'Memory slots used', 'memory.slotsTotal': 'Memory slots total', 'storage.systemVolume': 'System volume', 'storage.wearPct': 'Drive wear', 'firmware.biosVersion': 'BIOS version', 'firmware.biosDate': 'BIOS date', 'firmware.biosVendor': 'BIOS vendor', 'os.vbs': 'Virtualization-based security', 'os.uptimeMin': 'Uptime at start of run', 'power.planName': 'Power plan', 'power.powerMode': 'Power mode', 'power.batteryDesignWh': 'Battery design capacity', 'power.batteryFullChargeWh': 'Battery full-charge capacity', 'power.batteryHealthPct': 'Battery health', 'virtualization.vmPlatform': 'Virtual Machine Platform state', 'virtualization.hyperV': 'Hyper-V state' };

function profileRows(profile) {
  const rows = [];
  walkFacts(profile, (f, p) => {
    const rel = p.replace(/^systemProfile\./, '');
    const [group, ...rest] = rel.split('.');
    const leaf = rest.join('.');
    rows.push({
      group: PROFILE_GROUP_TITLES[group] || humanize(group),
      fact: PROFILE_LABELS[`${group}.${leaf}`] || humanize(leaf),
      value: factText(f), available: f.value !== null && f.value !== undefined,
      source: `${f.source || 'not recorded'}${f.tier && f.tier !== 'user' ? ` (${f.tier} tier)` : ''}`,
    });
  });
  return rows;
}

// the set of facts a "Not measurable without admin" line may name
function adminOnly(r) {
  const out = new Set();
  const profile = r.systemProfile;
  if (profile) walkFacts(profile, (f, p) => { if ((f.value === null || f.value === undefined) && /admin|elevat/i.test(f.unavailableReason || '')) { const rel = p.replace(/^systemProfile./, ''); const [g, ...rest] = rel.split('.'); const l = rest.join('.'); out.add((PROFILE_LABELS[g + '.' + l] || humanize(l)).toLowerCase()); } });
  for (const row of r.spawnProbes || []) {
    const zr = get(row, 'thermal.zonesReason');
    if (typeof zr === 'string' && /admin|elevat/i.test(zr)) { out.add('temperature'); break; }
  }
  for (const f of r['collection.failures'] || []) if (f.mode === 'tier' || (/admin|elevat/i.test(f.reason || '') && f.mode !== 'parse')) out.add(f.mode === 'tier' ? 'admin-only signals (thermal sensors, drive health, system monitor)' : signalName(f).toLowerCase());
  return [...out];
}

// ---------------- finding ----------------
const SIGNAL_LABEL = { 'mem.committed_pct': 'commit', 'mem.avail_mb': 'available memory', 'cpu.pct_total': 'CPU', 'cpu.queue_per_cpu': 'CPU run queue per processor', 'disk.latency_ms': 'disk latency', 'security.cpu_pct': 'security-software CPU' };
const sigLabel = (id) => SIGNAL_LABEL[id] || String(id || 'value');

function topGrower(ex) {
  const P = ex.S.procs;
  if (P.ticks.length < 2) return null;
  let best = null;
  for (const name of P.top) {
    if (P.observerGroups.includes(name)) continue;
    const vals = P.ticks.map((tk) => (tk.g[name] ? tk.g[name].v : null)).filter((v) => v !== null);
    if (vals.length < 2) continue;
    const a = vals[0], b = vals[vals.length - 1];
    if (b - a >= 100 && b >= a * 1.1 && (!best || b - a > best.d)) best = { name, a, b, d: b - a };
  }
  return best;
}

// checked-and-not-seen classes, from the per-hang rule results stored in the diagnosis
function notObserved(d, leadingClass) {
  if (!d || !Array.isArray(d.hangs) || !d.hangs.length) return [];
  const byClass = new Map();
  for (const h of d.hangs) for (const rl of h.rules || []) {
    const c = byClass.get(rl.class) || { fired: false, evaluated: false };
    if (rl.fired === true && !(rl.disprover && rl.disprover.result === 'disproved')) c.fired = true;
    if (rl.fired === true || rl.fired === false) c.evaluated = true;
    byClass.set(rl.class, c);
  }
  return [...byClass.entries()].filter(([c, v]) => !v.fired && v.evaluated && c !== leadingClass && vocab.isCauseClass(c)).map(([c]) => label(c));
}

function findingLines(ctx) {
  const { diagnosis: d, summary: s } = ctx;
  if (!d || !d.finding) return { head: 'Finding: not recorded', lines: ['This file carries no diagnosis (recorded by an older version of the tool); re-capture with this version.'], notObserved: [] };
  const f = d.finding;
  const thr = numOf(get(d, 'hangDefinition.thresholdMs')) ?? numOf(get(s, 'hangThresholdMs'));
  const thrTxt = thr === null ? 'the hang threshold' : `${n2(thr)} ms`;
  const hangs = numOf(get(s, 'hangEventCount')) ?? (Array.isArray(d.hangs) ? d.hangs.length : 0);
  const obsTxt = ctx.observedS === null ? 'the observed time' : durTxt(ctx.observedS);
  const c = f.confirmations || {};
  const conf = [`${c['user-mark'] ?? 0} confirmed by your marks`, `${c['os-not-responding'] ?? 0} by Windows`];
  if (c['workload-probe']) conf.push(`${c['workload-probe']} by the workload probe`);
  const ist = inputCheck.inputState(ctx.inputStall);
  if (ist.state === 'running' || c['input-stall'] !== undefined) conf.push(`${c['input-stall'] ?? 0} by the input-response check`);
  else if (ist.state === 'unavailable') conf.push('the input-response check was not available');
  else if (ist.state === 'not-requested') conf.push('the input-response check was turned off');
  conf.push(`${c['probe-only'] ?? 0} by the probe alone`);
  const excl = numOf(f.excludedHangs) || 0;
  const lead = (d.rollup || [])[0];
  const no = notObserved(d, lead && lead.class);
  const lines = [];
  if (!hangs) {
    lines.push(`No freeze of ${thrTxt} or more was observed in ${obsTxt} of observation.`);
    lines.push(f.sentence);
  } else {
    lines.push(excl ? `${hangs} freeze${hangs === 1 ? '' : 's'} of ${thrTxt} or more in ${obsTxt}; ${excl} of them excluded because the tool itself was loading the machine; of the ${hangs - excl} remaining: ${conf.join(', ')}.` : `${hangs} freeze${hangs === 1 ? '' : 's'} of ${thrTxt} or more in ${obsTxt} (${conf.join(', ')}).`);
    if (lead && vocab.isCauseClass(f.class) && lead.hangMean !== null && lead.hangMean !== undefined) {
      const u = lead.unit || '';
      const g = ctx.grower;
      lines.push(`At freezes: ${sigLabel(lead.signal)} ${fmt(lead.hangMean, u)} vs ${lead.calm && lead.calm.mean !== null ? `${fmt(lead.calm.mean, u)} calm` : 'no calm baseline'} (n=${lead.hangN}/${lead.calm ? lead.calm.n : 0}); leading cause: ${label(f.class)} in ${lead.hangs} of ${lead.of} usable freezes${g ? `; largest growth in a monitored program: ${g.name} ${n2(g.a)} -> ${n2(g.b)} MB` : ''}.`);
    } else lines.push(f.sentence);
    const tail = [];
    if (no.length) tail.push(`Not observed: ${no.join(', ')}.`);
    if (f.confidence !== undefined && f.confidence !== null) tail.push(`Confidence ${n2(f.confidence)} (derived from the rule, not a probability); evidence strength: ${f.strength}.`);
    else tail.push(`Evidence strength: ${f.strength}.`);
    lines.push(tail.join(' '));
  }
  return { head: `Finding: ${label(f.class)}`, class: f.class, lines, notObserved: no, excluded: excl };
}

// ---------------- evidence ----------------
function hangRows(r, d) {
  const hangs = (d && d.hangs) || [];
  // columns: rules evaluated (fired true/false) at any freeze, fired ones first
  const cols = new Map();
  for (const h of hangs) for (const rl of h.rules || []) {
    if (rl.fired !== true && rl.fired !== false) continue;
    const c = cols.get(rl.id) || { id: rl.id, cls: rl.class, fired: 0, calm: null, unit: (rl.threshold && rl.threshold.unit) || '' };
    if (rl.fired === true) c.fired++;
    if (!c.calm && rl.calm && rl.calm.mean !== null && rl.calm.mean !== undefined) c.calm = { mean: rl.calm.mean, n: rl.calm.n, signal: rl.calm.signal };
    cols.set(rl.id, c);
  }
  const colList = [...cols.values()].sort((a, b) => b.fired - a.fired).slice(0, 6);
  const notEval = new Map();
  for (const h of hangs) for (const rl of h.rules || []) if (rl.fired === null && !cols.has(rl.id)) notEval.set(rl.id, rl.reason || 'not evaluable');
  const byAt = new Map((r.hangEvents || []).map((h) => [h.at, h]));
  const off = Number.isFinite(get(r, 'run.utcOffsetMin')) ? get(r, 'run.utcOffsetMin') : null;
  const rows = hangs.map((h, i) => {
    const he = byAt.get(h.at);
    const top = he && Array.isArray(he.culpritsAtHang) && he.culpritsAtHang.length ? `${he.culpritsAtHang[0].name || 'a program'} ${he.culpritsAtHang[0].totalMB !== undefined ? `${n2(he.culpritsAtHang[0].totalMB)} MB` : ''}`.trim() : 'not recorded';
    const cells = colList.map((c) => {
      const rl = (h.rules || []).find((x) => x.id === c.id);
      if (!rl || (rl.fired !== true && rl.fired !== false)) return 'not evaluated';
      const inp = (rl.inputs || [])[0];
      const val = inp ? fmt(inp.value, inp.unit === '%' || inp.unit === 'MB' || inp.unit === 'ms' ? inp.unit : (inp.unit || '')) : 'no value stored';
      return `${val}${rl.fired === true ? ' (fired)' : ''}${rl.disprover && rl.disprover.result === 'disproved' ? ' (disproved)' : ''}`;
    });
    return { n: `H${i + 1}`, when: clock(ms(h.at) ?? 0, off), freeze: fmt(h.ms, 'ms'), confirmed: (h.confirmedBy || []).length ? h.confirmedBy.map((x) => inputCheck.confirmLabel(x)).join(', ') : 'probe only', top, cells };
  });
  const head = ['#', 'When', 'Freeze', 'Confirmed by', 'Largest in-scope load at freeze', ...colList.map((c) => `${c.id}${c.calm ? ` (calm ${fmt(c.calm.mean, c.unit)}, n=${c.calm.n})` : ''}`)];
  return { head, rows: rows.map((x) => [x.n, x.when, x.freeze, x.confirmed, x.top, ...x.cells]), notEval: [...notEval.entries()].map(([id, why]) => `${id}: ${why}`) };
}

function summaryKv(r) {
  const s = r.summary || {};
  const k = [];
  const add = (a, b) => k.push([a, b]);
  add('Probes and samples', `${numOf(get(r, 'window.probesObserved')) ?? 'n/a'} of ${numOf(get(r, 'window.probesExpected')) ?? 'n/a'} probes, ${numOf(get(r, 'window.samplesObserved')) ?? 'n/a'} of ${numOf(get(r, 'window.samplesExpected')) ?? 'n/a'} samples over ${durTxt(get(r, 'window.observedS'))}`);
  add('RAM used (average)', fmt(s.avgUsedPct, '%', get(s, 'nulls.avgUsedPct')));
  add('Commit (peak)', fmt(s.committedPeak, '%', get(s, 'nulls.committedPeak')));
  add('Lowest free memory', fmt(s.minFreeGB, 'GB', get(s, 'nulls.minFreeGB')));
  add('Paging (peak, pages/s)', fmt(s.pagesPeak, '/s', get(s, 'nulls.pagesPeak')));
  add('Freeze-probe time (median / 95th / worst)', `${fmt(s.spawnP50ms, 'ms', get(s, 'nulls.spawnP50ms'))} / ${fmt(s.spawnP95ms, 'ms', get(s, 'nulls.spawnP95ms'))} / ${fmt(s.spawnMaxMs, 'ms', get(s, 'nulls.spawnMaxMs'))} (n=${numOf(s.totalSpawnProbes) ?? 'n/a'})`);
  add('Lowest CPU clock (% of maximum)', fmt(s.maxFreqMin, '%', get(s, 'nulls.maxFreqMin')));
  return k;
}

// ---------------- appendix ----------------
function eventsBlock(r) {
  const ev = r.events || {};
  const out = { during: [], history: [] };
  const iw = ev.inWindow || {};
  const kinds = [['appHang', 'application not-responding events'], ['appCrash', 'application crash events'], ['resourceExhaustion', 'low-resource events']];
  for (const [k, name] of kinds) {
    const list = Array.isArray(iw[k]) ? iw[k] : null;
    if (list === null) out.during.push(`${name}: not recorded (events reading ${ev.mode || 'not recorded'})`);
    else out.during.push(`${name}: ${list.length}${list.length ? ` (${list.slice(0, 3).map((e) => (e.at ? clock(ms(e.at) ?? 0, Number.isFinite(get(r, 'run.utcOffsetMin')) ? get(r, 'run.utcOffsetMin') : null) : '?')).join(', ')})` : ''}`);
    const h = get(ev, `history.${k}`);
    if (h) out.history.push(`${name}: ${h.count}${h.countCapped ? '+' : ''} before this run${h.newest ? `, newest ${String(h.newest).slice(0, 10)}` : ''}${h.horizonDays ? `, looking back ${h.horizonDays} days` : ''}`);
  }
  const w = r.wer;
  if (w) out.history.push(`Windows Error Reporting archive: ${get(w, 'history.apphang') ?? 'n/a'} application-hang reports of ${get(w, 'history.total') ?? 'n/a'} (${get(w, 'history.window') || 'window not recorded'}); during this run: ${get(w, 'inRun.apphang') ?? 'n/a'}`);
  return out;
}

function methodNotes(r) {
  const d = r.diagnosis;
  const n = [];
  const s = r.summary || {};
  if (d && d.hangDefinition) {
    const hd = d.hangDefinition;
    n.push(`Freeze definition: a probe that starts a trivial program takes ${n2(hd.thresholdMs)} ms or more (threshold source: ${hd.source}). It samples every ${n2(hd.intervalS)} s.`);
    for (const c of hd.cannotSee || []) n.push(`This test cannot see: ${c}.`);
  }
  if (d && d.usable) n.push(`Usable probes: ${d.usable.probes} (${d.usable.excluded} excluded). Minimum for any cause ranking: ${d.usable.minimum}; for "sustained": ${d.usable.sustainedMin}.`);
  for (const o of (d && d.observations) || []) n.push(`${o}.`);
  if (d && d.thresholds) {
    const t = Object.entries(d.thresholds).map(([id, x]) => `${id} ${n2(x.value)}${unitText(x.unit)} (${x.origin || 'default'}; ${x.source || 'source not recorded'})`);
    if (t.length) n.push(`Rule thresholds, all provisional unless a source says otherwise: ${t.join('; ')}.`);
  }
  const c = get(r, 'sampling.cadence');
  if (c) n.push(`Continuous sampling: nominal ${n2(c.nominalS)} s, achieved median ${c.achievedMedianS === null || c.achievedMedianS === undefined ? 'n/a' : n2(c.achievedMedianS)} s (n=${c.n ?? 'n/a'}).`);
  const ob = r.observer;
  if (ob && (ob.wsMB !== null && ob.wsMB !== undefined)) n.push(`Cost of this tool during the run: about ${n2(ob.wsMB)} MB of memory; it is excluded from every culprit and rollup.`);
  if (get(s, 'thresholds.status')) n.push(`Thresholds are ${s.thresholds.status}.`);
  return n;
}

function culpritRows(r) {
  return (r.culprits || []).map((c) => [c.name || '?', c.detail && c.detail !== c.friendly ? `${c.friendly ? `${c.friendly} - ` : ''}${c.detail}` : (c.friendly || ''), c.totalMB !== undefined ? fmt(c.totalMB, 'MB') : 'n/a', c.instances !== undefined ? String(c.instances) : 'n/a', c.category || '']);
}

function timeLostLines(r) {
  const t = r.diagnosis && r.diagnosis.timeLost;
  if (!t || !(t.hangs > 0)) return [];
  const out = [`Measured: ${n2(t.frozenS)} s frozen across ${t.hangs} freeze${t.hangs === 1 ? '' : 's'} in ${durTxt(t.observedS)} observed (mean ${n2(t.meanFreezeS)} s per freeze).`];
  if (t.userSupplied) out.push(`Extrapolation from figures you supplied (${n2(t.userSupplied.activeMinPerDay)} active min/day at ${n2(t.userSupplied.ratePerHr)}/hr): about ${n2(t.userSupplied.lostMinPerDay)} min/day.`);
  return out;
}

// ---------------- builders ----------------
function actionsBlocks(d) {
  const list = d && (Array.isArray(d.suggestedActions) ? d.suggestedActions : Array.isArray(d.actions) ? d.actions : null);
  if (!d) return [{ t: 'p', text: 'No diagnosis is recorded in this file, so no action can be tied to evidence.' }];
  if (list === null) return [{ t: 'p', text: d.rollup && d.rollup.length ? 'Suggested actions are not recorded in this file (written before action mapping existed); the ranked causes are in the Evidence section.' : 'No action suggested by this evidence.' }];
  if (!list.length) return [{ t: 'p', text: 'No action suggested by this evidence.' }];
  return [{ t: 'ol', items: list.map((a) => {
    const ids = (a.ruleIds || (Array.isArray(a.rules) ? a.rules.map((x) => (x && x.id) || x) : []) || []).concat(!a.ruleIds && !Array.isArray(a.rules) && a.ruleId ? [a.ruleId] : []);
    const hg = a.hangs && typeof a.hangs === 'object' ? a.hangs : null;
    const k = hg ? hg.k : (a.hangs ?? a.k), M = hg ? hg.of : (a.of ?? a.M ?? a.hangsOf);
    const bits = [];
    if (ids.length) bits.push(`rule ${ids.join(', ')}`);
    if (k !== undefined && M !== undefined) bits.push(`${k} of ${M} freezes`);
    if (a.confidence !== undefined && a.confidence !== null) bits.push(`confidence ${n2(a.confidence)}`);
    return `${a.text || a.label || a.key}${bits.length ? ` (${bits.join('; ')})` : ''}`;
  }) }];
}

function traceSections(raw, files = {}) {
  const r = plain(raw);
  const ex = extract(raw);
  const d = r.diagnosis || null;
  const off = ex.off;
  const prof = r.systemProfile || null;
  const model = prof ? factVal(prof, 'identity.model') : { text: null, reason: 'no system profile recorded in this file' };
  const serial = prof ? factVal(prof, 'identity.serial') : { text: null, reason: 'no system profile recorded in this file' };
  const startMs = ms(get(r, 'run.startedAt') || r.startedAt);
  const observedS = numOf(get(r, 'window.observedS'));
  const st = get(r, 'run.status');
  const finished = st === 'complete';
  const fnd = findingLines({ diagnosis: d, summary: r.summary || {}, observedS, grower: topGrower(ex), inputStall: r.inputStall });
  const scopeLines = scopeLib.declarationLines(r.scope, r.outOfScope);
  const open = r.scope && r.scope.mode === 'open';

  const header = { id: 'header', blocks: [
    { t: 'title', text: `Freeze evidence - ${model.text || 'machine model not available'} (${serial.text || 'serial unavailable'})`, sub: `${startMs === null ? 'date not recorded' : `${dateText(startMs, off)} ${clock(startMs, off)} ${offsetLabel(off)}`} - observed ${durTxt(observedS)}` },
    { t: 'banner', cls: open ? 'open-scope' : 'scope', title: open ? 'SCOPE (OPEN)' : 'SCOPE', lines: scopeLines },
    { t: 'kv', rows: [
      ['Machine', model.text || na(model.reason)],
      ['Serial', serial.text || na(serial.reason)],
      ['Run date', startMs === null ? 'not recorded' : `${dateText(startMs, off)} ${clock(startMs, off)} ${offsetLabel(off)}`],
      ['Observed duration', durTxt(observedS)],
      ['Collection tier', r.tier || 'not recorded'],
      ['Run finished', finished ? 'yes' : `NO - run status "${st || 'not recorded'}"${get(r, 'run.endReason') ? ` (${r.run.endReason})` : ''}; evidence was kept up to the point the run stopped`],
      ['Report data', `${r.schema || 'schema not recorded'}${files.jsonName ? ` (${files.jsonName})` : ''}`],
      ...(files.emailName ? [['Email draft', `${files.emailName} (a draft file only; the tool never sends anything)`]] : []),
    ] },
  ] };

  const finding = { id: 'finding', blocks: [{ t: 'finding', head: fnd.head, lines: fnd.lines, cls: fnd.class || 'none' }] };
  const actions = { id: 'actions', blocks: actionsBlocks(d) };

  const ev = hangRows(r, d);
  const evidenceBlocks = [];
  if (d && Array.isArray(d.rollup) && d.rollup.length) {
    evidenceBlocks.push({ t: 'sub', text: 'Ranked causes' });
    evidenceBlocks.push({ t: 'table', cls: 'ranked', head: ['Rank', 'Cause', 'Rule', 'Freezes', 'At freeze vs calm', 'Confidence'], rows: d.rollup.map((x, i) => [String(i + 1), label(x.class), x.id, `${x.hangs} of ${x.of}`, x.hangMean === null || x.hangMean === undefined ? 'not applicable' : `${sigLabel(x.signal)} ${fmt(x.hangMean, x.unit || '')} vs ${x.calm && x.calm.mean !== null && x.calm.mean !== undefined ? fmt(x.calm.mean, x.unit || '') : 'no baseline'} (n=${x.hangN}/${x.calm ? x.calm.n : 0})`, n2(x.confidence)]) });
  } else if (d) evidenceBlocks.push({ t: 'p', text: 'No cause rule fired, so no cause is ranked.' });
  evidenceBlocks.push({ t: 'sub', text: ev.rows.length ? 'Freezes: value at freeze for each rule that was evaluated' : 'Freezes' });
  if (ev.rows.length) {
    evidenceBlocks.push({ t: 'table', cls: 'hangs', head: ev.head, rows: ev.rows });
    if (fnd.excluded) evidenceBlocks.push({ t: 'p', cls: 'note', text: `${fnd.excluded} further freeze${fnd.excluded === 1 ? ' is' : 's are'} not listed: the tool itself was loading the machine at that moment, so they do not count as evidence.` });
    if (ev.notEval.length) evidenceBlocks.push({ t: 'p', cls: 'note', text: `Rules that could not be evaluated: ${ev.notEval.join('; ')}.` });
  } else evidenceBlocks.push({ t: 'p', text: 'No probe reached the freeze threshold, so there is no at-freeze versus calm comparison. The calm run is summarized below.' });
  evidenceBlocks.push(...inputCheck.inputCheckBlocks({ inputStall: r.inputStall, probeAgreement: d && d.probeAgreement, corroboration: d && d.inputStallCorroboration, observerHelper: get(r, 'sampling.observer.helper'), off }));
  evidenceBlocks.push(...storageBlock.storageBlocks(r));
  evidenceBlocks.push({ t: 'sub', text: 'Run summary' });
  evidenceBlocks.push({ t: 'kv', rows: summaryKv(r) });
  evidenceBlocks.push({ t: 'sub', text: 'Charts' });
  evidenceBlocks.push({ t: 'charts' });
  const evidence = { id: 'evidence', blocks: evidenceBlocks };

  const prow = prof ? profileRows(prof) : [];
  const profile = { id: 'profile', blocks: prof
    ? [{ t: 'table', cls: 'profile', head: ['Group', 'Fact', 'Value', 'Source'], rows: prow.map((x) => [x.group, x.fact, x.value, x.source]), count: prow.length }]
    : [{ t: 'p', text: `System profile: ${na('this file has no system profile; re-capture with this version')}` }] };

  // gaps
  const fails = (r['collection.failures'] || []).map(gapSentence);
  const gapBlocks = [];
  gapBlocks.push({ t: 'sub', text: 'Could not be measured' });
  gapBlocks.push(fails.length ? { t: 'ul', cls: 'gaps-failure', items: fails } : { t: 'p', text: 'Every collector reported data.' });
  const tierLines = [];
  if (r.admin && r.admin.tier === 'user' && !(r['collection.failures'] || []).some((f) => f.mode === 'tier')) tierLines.push('Admin-only signals: not collected because the run was not elevated.');
  const adm = adminOnly(r);
  const unobs = (get(r, 'sampling.unobserved') || []).map((u) => `Not observed from ${clock(ms(u.start) ?? 0, off)} to ${clock(ms(u.end) ?? 0, off)} (${n2(u.durationS)} s): ${GAP_REASON[u.reason] || u.reason || 'no reason recorded'}.`);
  const byDesign = (r['collection.notCollected'] || []).map((x) => `${x.datum}: not collected - ${x.reason}`);
  const wlUn = [];
  const cu = get(r, 'workload.containers.unavailable');
  if (cu && cu.reason && !fails.some((x) => /^Docker:/.test(x))) wlUn.push(`Docker: ${cu.reason}`);
  const vmU = get(r, 'workload.vm.hostMemUnavailable');
  if (vmU) wlUn.push(`WSL2/VM memory: ${vmU}`);
  const other = [...tierLines, ...wlUn];
  if (other.length) { gapBlocks.push({ t: 'sub', text: 'Not available in this run' }); gapBlocks.push({ t: 'ul', cls: 'gaps-tier', items: other }); }
  if (unobs.length) { gapBlocks.push({ t: 'sub', text: 'Unobserved intervals' }); gapBlocks.push({ t: 'ul', cls: 'gaps-unobserved', items: unobs }); }
  if (byDesign.length) { gapBlocks.push({ t: 'sub', text: 'Left out by design' }); gapBlocks.push({ t: 'ul', cls: 'gaps-design', items: byDesign }); }
  gapBlocks.push({ t: 'sub', text: 'Receipts' });
  gapBlocks.push({ t: 'kv', rows: [
    ['Not measurable without admin', adm.length ? adm.join('; ') : 'none'],
    ['Scope', `${r.scope ? `${r.scope.mode} (${r.scope.source || 'source not recorded'})` : 'not recorded'}${r.scope && r.scope.counts ? `; ${r.scope.counts.inScopeGroups} in scope, ${r.scope.counts.systemGroups} system, ${r.scope.counts.outOfScopeGroups} outside scope` : ''}`],
    ['Anonymized', r.anonymized ? 'yes' : 'no'],
    ['Windows event reading', get(r, 'events.mode') || 'not recorded'],
  ] });
  const gaps = { id: 'gaps', blocks: gapBlocks };

  const evs = eventsBlock(r);
  const tl = timeLostLines(r);
  const app = [];
  const cr = culpritRows(r);
  app.push({ t: 'sub', text: 'In-scope culprit table (end of run)' });
  app.push(cr.length ? { t: 'table', cls: 'culprits', head: ['Name', 'Who it is', 'Total', 'Processes', 'Category'], rows: cr } : { t: 'p', text: 'No named culprits are recorded in this file.' });
  app.push({ t: 'sub', text: 'Windows events during this run' });
  app.push({ t: 'ul', items: evs.during });
  app.push({ t: 'sub', text: 'History before this run' });
  app.push({ t: 'ul', items: evs.history.length ? evs.history : ['not recorded'] });
  app.push({ t: 'sub', text: 'Method' });
  app.push({ t: 'ul', items: methodNotes(r) });
  if (tl.length) { app.push({ t: 'sub', text: 'Measured time lost (context only)' }); app.push({ t: 'ul', items: tl }); }
  app.push({ t: 'sub', text: 'Files' });
  const fileRows = [];
  if (files.jsonName) fileRows.push([files.jsonName, files.jsonSha256 ? `sha256 ${files.jsonSha256}` : 'sha256 not computed']);
  if (files.htmlName) fileRows.push([files.htmlName, files.htmlSha256 ? `sha256 ${files.htmlSha256}` : 'this file (a file cannot carry its own hash; the email draft lists it)']);
  app.push(fileRows.length ? { t: 'kv', rows: fileRows } : { t: 'p', text: 'File names and hashes are added when the report is written to disk.' });
  const appendix = { id: 'appendix', blocks: app };

  return { kind: 'trace', title: header.blocks[0].text, sections: [header, finding, actions, evidence, profile, gaps, appendix].map((s) => ({ ...s, title: TITLES[s.id] })), ex, adminOnly: adm, finding: fnd };
}

// ---------------- pack ----------------
function packSections(raw, files = {}) {
  const p = plain(raw);
  const prof = p.systemProfile || null;
  const model = prof ? factVal(prof, 'identity.model') : { text: null, reason: 'this pack has no system profile' };
  const serial = prof ? factVal(prof, 'identity.serial') : { text: null, reason: 'this pack has no system profile' };
  const traceFile = get(p, 'provenance.traceReport') || get(p, 'hangs.source') || 'the trace file';
  const missing = (what) => ({ t: 'p', cls: 'not-in-pack', text: `Not in pack: ${what} - see trace ${traceFile}.` });
  const f = p.finding || null;
  const sus = p.sustained || {}, hg = p.hangs || {};
  const open = p.scope && p.scope.mode === 'open';
  const header = { id: 'header', blocks: [
    { t: 'title', text: `Evidence pack - ${model.text || 'machine model not available'} (${serial.text || 'serial unavailable'})`, sub: `assembled ${p.assembledAt || 'not recorded'}` },
    { t: 'banner', cls: open ? 'open-scope' : 'scope', title: open ? 'SCOPE (OPEN)' : 'SCOPE', lines: scopeLib.declarationLines(p.scope, p.outOfScope) },
    { t: 'kv', rows: [['Machine', model.text || na(model.reason)], ['Serial', serial.text || na(serial.reason)], ['Assembled', p.assembledAt || 'not recorded'], ['Observed duration', hg.source ? `see trace ${traceFile}` : 'no trace in this pack'], ['Collection tier', p.tier || 'not recorded'], ['Report data', `${p.schema || 'schema not recorded'}${files.jsonName ? ` (${files.jsonName})` : ''}`]] },
  ] };
  const fl = f ? findingLines({ diagnosis: { finding: f, rollup: p.rollup || [], hangs: [], hangDefinition: { thresholdMs: hg.thresholdMs } }, summary: { hangEventCount: typeof hg.count === 'number' ? hg.count : null }, observedS: null, grower: null }) : null;
  const finding = { id: 'finding', blocks: [f ? { t: 'finding', head: fl.head, lines: [f.sentence, `Evidence strength: ${f.strength}.`], cls: f.class } : { t: 'finding', head: 'Finding: not recorded', lines: [p.findingNote || 'This pack carries no finding.'], cls: 'none' }] };
  const actions = { id: 'actions', blocks: [missing('suggested actions')] };
  const eb = [];
  eb.push({ t: 'sub', text: 'Sustained pressure' });
  eb.push({ t: 'kv', rows: [['Source', sus.source || 'not recorded'], ['Samples (n)', String(sus.n ?? 'n/a')], ['Commit peak', fmt(sus.commitPeak, '%')], ['Pages 95th percentile', fmt(sus.pagesP95, '/s')], ['Note', sus.note || sus.hangsNote || '']] });
  eb.push({ t: 'sub', text: 'Freezes in the trace' });
  eb.push({ t: 'kv', rows: [['Count', String(hg.count ?? 'n/a')], ['Worst', fmt(hg.worstMs, 'ms')], ['95th percentile', fmt(hg.p95Ms, 'ms')], ['Threshold', fmt(hg.thresholdMs, 'ms')], ['Rate', fmt(hg.hangRatePerMin, '', 'not recorded') + ' per minute']] });
  if ((hg.events || []).length) eb.push({ t: 'table', cls: 'hangs', head: ['When', 'Freeze', 'RAM used', 'Commit', 'Paging'], rows: hg.events.map((e) => [e.at ? String(e.at).slice(11, 19) : '?', fmt(e.ms, 'ms'), fmt(e.usedPct, '%'), fmt(e.committed, '%'), fmt(e.pages, '/s')]) });
  eb.push(...inputCheck.inputCheckBlocks({ inputStall: p.inputStall, probeAgreement: p.probeAgreement, corroboration: null, observerHelper: null, off: null }));
  eb.push({ t: 'sub', text: 'Charts' });
  eb.push(missing('per-sample charts'));
  const evidence = { id: 'evidence', blocks: eb };
  const prow = prof ? profileRows(prof) : [];
  const profile = { id: 'profile', blocks: prof ? [{ t: 'table', cls: 'profile', head: ['Group', 'Fact', 'Value', 'Source'], rows: prow.map((x) => [x.group, x.fact, x.value, x.source]), count: prow.length }] : [missing('system profile')] };
  const unread = (get(p, 'provenance.unreadableReports') || []).map((u) => `${u.file}: could not be read (${u.error})`);
  const gaps = { id: 'gaps', blocks: [
    { t: 'sub', text: 'Collection gaps' }, missing('collection failures'),
    ...(unread.length ? [{ t: 'sub', text: 'Unreadable reports' }, { t: 'ul', items: unread }] : []),
    { t: 'sub', text: 'Receipts' }, { t: 'kv', rows: [['Admin tier', p.admin && (p.admin.skipped || p.admin.tier) ? `${p.admin.tier || 'n/a'}${p.admin.skipped ? `; ${p.admin.skipped}` : ''}` : 'not recorded'], ['Anonymized', get(p, 'audit.anonymized') ? 'yes' : 'no']] },
  ] };
  const th = get(p, 'audit.thresholds') || {};
  const appendix = { id: 'appendix', blocks: [
    { t: 'sub', text: 'Method' },
    { t: 'ul', items: [`Thresholds used: ${Object.entries(th).map(([k, v]) => `${k} ${n2(v)}`).join(', ') || 'not recorded'} (source: ${get(p, 'audit.thresholdSource') || 'not recorded'}).`, `Trace used: ${traceFile}.`, `Sustained basis: ${get(p, 'provenance.sustainedBasis') || 'not recorded'}.`] },
    ...(tlLines(p) ),
    { t: 'sub', text: 'Culprit table' }, missing('the in-scope culprit table'),
    { t: 'sub', text: 'Files' }, files.jsonName ? { t: 'kv', rows: [[files.jsonName, files.jsonSha256 ? `sha256 ${files.jsonSha256}` : 'sha256 not computed']] } : { t: 'p', text: 'File names and hashes are added when the report is written to disk.' },
  ] };
  return { kind: 'pack', title: header.blocks[0].text, sections: [header, finding, actions, evidence, profile, gaps, appendix].map((s) => ({ ...s, title: TITLES[s.id] })), ex: null, adminOnly: [], finding: fl };
}
function tlLines(p) {
  const t = p.timeLost;
  if (!t || !(t.hangs > 0)) return [];
  return [{ t: 'sub', text: 'Measured time lost (context only)' }, { t: 'ul', items: [`Measured: ${n2(t.frozenS)} s frozen across ${t.hangs} freeze(s).`] }];
}

function isPack(d) { return !!(d && (d.schema === 'hanger-pack/1' || d.schema === 'telltale-pack/1' || d.tool === 'telltale pack/1' || d.tool === 'hanger pack/1' || (d.sustained && d.audit))); }
function buildSections(raw, files) { return isPack(raw) ? packSections(raw, files) : traceSections(raw, files); }

module.exports = { buildSections, traceSections, packSections, isPack, SECTION_ORDER, TITLES, profileRows, adminOnly, gapSentence, findingLines, factVal, inputCheck, durTxt, minTxt, label, sigLabel, topGrower, humanize };
void isRec; void roundDisplay;
