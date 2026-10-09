'use strict';
// Ready-to-send email draft (it-handoff). Built ONLY from the report JSON through the single binding table
// below; a missing path renders "not available", and a numeric trace check fails the render when the draft
// holds a number the JSON cannot back. The tool never sends anything: this module only returns text.
const crypto = require('crypto');
const { plain } = require('../sampler/record');
const { n2 } = require('./format');
const { get, numOf, ms, dateText } = require('./series');
const sec = require('./sections');
const inputCheck = require('./input-check');
const storageBlock = require('./storage-block');

const NA = 'not available';

// The one place to update when an upstream schema path moves (design.md "Email template").
const BIND = {
  model: 'systemProfile.identity.model.value',
  serial: 'systemProfile.identity.serial.value',
  hangCount: 'summary.hangEventCount',
  observedS: 'window.observedS',
  hangThresholdMs: 'diagnosis.hangDefinition.thresholdMs',
  longestMs: 'summary.spawnMaxMs',
  confirmations: 'diagnosis.finding.confirmations',
  startedAt: 'run.startedAt',
  utcOffsetMin: 'run.utcOffsetMin',
  planName: 'systemProfile.power.planName.value',
  scope: 'scope',
  outOfScope: 'outOfScope',
  phases: 'workload.phases',
  cpuModel: 'systemProfile.processor.model.value',
  installedGB: 'systemProfile.memory.installedGB.value',
  disks: 'systemProfile.storage.disks.value',
  osBuild: 'systemProfile.os.build.value',
  biosVersion: 'systemProfile.firmware.biosVersion.value',
  actions: 'diagnosis.suggestedActions',
  actionsAlt: 'diagnosis.actions',
  finding: 'diagnosis.finding',
  inputStall: 'inputStall',
  stallMs: 'inputStall.settings.stallMs.v',
  stallEpisodes: 'inputStall.episodes',
  agreement: 'diagnosis.probeAgreement',
};

class EmailTraceError extends Error {
  constructor(tokens) { super(`email draft contains number(s) not present in the report JSON: ${tokens.join(', ')}`); this.name = 'EmailTraceError'; this.tokens = tokens; }
}

const present = (v) => v !== null && v !== undefined && v !== '';
const text = (v) => (present(v) ? String(v) : NA);

function powerLabel(r) {
  const s = new Set();
  for (const p of r.spawnProbes || []) { const a = p.plugged === true || p.plugged === false ? p.plugged : get(p, 'power.ac'); if (a === true || a === false) s.add(a); }
  if (s.size === 2) return 'on both AC power and battery';
  if (s.has(true)) return 'on AC power';
  if (s.has(false)) return 'on battery';
  return 'power source not recorded';
}

function scopeSummary(r) {
  const sc = get(r, BIND.scope);
  if (!sc) return 'Scope: not recorded in the attached report.';
  if (sc.mode === 'open') return 'Scope: OPEN SCOPE: names of all running software may appear in the attached report.';
  const names = (sc.entries || []).map((e) => (e.name !== undefined ? e.name : e.pattern)).filter(Boolean);
  const out = get(sc, 'counts.outOfScopeGroups');
  return `Scope: monitored ${names.length ? names.join(', ') : 'nothing from your list'} plus the always-monitored system set (operating-system components, registered security products, virtualization hosts); ${present(out) ? `${out} other running group${out === 1 ? '' : 's'}` : 'all other software'} not monitored and not named.`;
}

// numbers the draft derives from JSON values (unit conversion), named so the checker can verify them
function derivedNumbers(r) {
  const out = new Set();
  const obs = numOf(get(r, BIND.observedS));
  if (obs !== null) out.add(+(obs / 60).toFixed(1));
  const lm = numOf(get(r, BIND.longestMs));
  if (lm !== null) { out.add(+(lm / 1000).toFixed(1)); out.add(+(lm / 1000).toFixed(2)); }
  return out;
}

// one line about the automatic input-response check; numbers come only from JSON values
function inputLine(r, freezes, conf, own) {
  const st = inputCheck.inputState(get(r, BIND.inputStall));
  if (st.state === 'absent') return null; // a report written before the check existed says nothing about it
  if (st.state === 'not-requested') return 'Input-response check: turned off by the user, so no input-response data was collected.';
  if (st.state === 'unavailable') { own(st.reason); return `Input-response check: not available (${st.reason}); no input-response figures are given.`; }
  const eps = get(r, BIND.stallEpisodes) || [];
  const thr = numOf(get(r, BIND.stallMs));
  const thrTxt = thr === null ? 'the stall threshold' : `${thr} ms`;
  if (!eps.length) return `Input-response check (automatic): no input-response stall was observed in the evaluated time (threshold ${thrTxt}); this does not show that the machine did not freeze.`;
  const seen = conf['input-stall'] ?? 0;
  const dh = get(r, 'diagnosis.hangs');
  const usableN = Array.isArray(dh) ? dh.length : (present(freezes) ? freezes : 0); // the counts in `conf` are over the usable hangs (the tool-slowed ones are excluded)
  const ag = get(r, BIND.agreement);
  const ratio = (x) => (x && x.den ? `${x.num} of ${x.den}` : null);
  const pr = ag && ag.status === 'evaluated' ? ratio(ag.precision) : null, rc = ag && ag.status === 'evaluated' ? ratio(ag.recall) : null;
  return `Input-response check (automatic, nothing typed or clicked is recorded): ${eps.length} stall episode${eps.length === 1 ? '' : 's'} at the ${thrTxt} threshold; ${freezes === 0 ? 'the process-start probe recorded no freeze to compare' : `${seen} of ${usableN} ${usableN === freezes ? '' : 'usable '}freeze${usableN === 1 ? '' : 's'} also seen by the check`}${pr ? `; probe precision ${pr}` : ''}${rc ? `, probe recall ${rc}` : ''}.`;
}

function buildEmail(raw, files = {}) {
  const r = plain(raw);
  const opaque = [];
  const own = (s) => { if (present(s)) opaque.push(String(s)); return s; };
  const model = own(get(r, BIND.model)), serial = own(get(r, BIND.serial));
  const n = numOf(get(r, BIND.hangCount)) ?? (Array.isArray(r.hangEvents) ? r.hangEvents.length : null);
  const obsS = numOf(get(r, BIND.observedS));
  const obsMin = obsS === null ? null : +(obsS / 60).toFixed(1);
  const thr = numOf(get(r, BIND.hangThresholdMs));
  const off = Number.isFinite(get(r, BIND.utcOffsetMin)) ? get(r, BIND.utcOffsetMin) : null;
  const start = ms(get(r, BIND.startedAt) || r.startedAt);
  const date = start === null ? NA : dateText(start, off);
  const plan = own(get(r, BIND.planName));
  const phases = (get(r, BIND.phases) || []).map((p) => own(p.label)).filter(Boolean);
  const conf = get(r, BIND.confirmations) || {};
  const longestS = numOf(get(r, BIND.longestMs)) === null ? null : +(numOf(get(r, BIND.longestMs)) / 1000).toFixed(1);
  const fnd = sec.findingLines({ diagnosis: r.diagnosis || null, summary: r.summary || {}, observedS: obsS, grower: null, inputStall: r.inputStall || null });

  const subject = `Subject: Freeze evidence - ${model ? text(model) : 'machine model not available'} ${serial ? text(serial) : 'serial unavailable'} - ${present(n) ? n : NA} freeze${n === 1 ? '' : 's'} in ${obsMin === null ? NA : obsMin} min`;
  const during = `During ${phases.length ? phases.join(', ') : 'normal work'} on ${date} (${powerLabel(r)}${present(plan) ? `, power plan ${plan}` : ''}),`;
  const body = [];
  if (n > 0) {
    body.push(`${during} the laptop froze ${n} time${n === 1 ? '' : 's'}${longestS === null ? '' : `, the longest for ${longestS} s`} (threshold ${present(thr) ? thr : NA} ms; ${conf['os-not-responding'] ?? 0} confirmed by Windows, ${conf['user-mark'] ?? 0} by your marks).`);
    if (fnd.lines.length > 1) body.push(`Finding: ${fnd.lines.slice(1).join(' ')}`);
  } else {
    body.push(`${during} no freeze of ${present(thr) ? `${thr} ms` : 'the hang threshold'} or more was observed in ${obsMin === null ? NA : obsMin} min.`);
    if (fnd.lines.length > 1) body.push(`Finding: ${fnd.lines.slice(1).join(' ')}`);
  }
  const inLine = inputLine(r, n, conf, own);
  if (inLine) body.push(inLine);
  body.push(storageBlock.emailStorageLine(r));
  body.push(scopeSummary(r));
  const adm = sec.adminOnly(r);
  body.push(`Not measurable without admin: ${adm.length ? adm.join('; ') : 'none'}.`);
  const cpu = own(get(r, BIND.cpuModel));
  const disk = (get(r, BIND.disks) || [])[0];
  if (disk) own(disk.model);
  const build = own(get(r, BIND.osBuild)), bios = own(get(r, BIND.biosVersion));
  const ram = get(r, BIND.installedGB);
  body.push(`Machine: ${present(cpu) ? cpu : NA}, ${present(ram) ? `${ram} GB RAM` : `RAM ${NA}`}, ${disk ? `${text(disk.model)} (${text(disk.mediaType)})` : `storage ${NA}`}, Windows build ${present(build) ? build : NA}, BIOS ${present(bios) ? bios : NA}.`);
  const acts = get(r, BIND.actions) || get(r, BIND.actionsAlt);
  const actTexts = Array.isArray(acts) ? acts.slice(0, 3).map((a, i) => `${i + 1}) ${a.text || a.label || a.key}`) : [];
  body.push(`Suggested next steps (cheapest first): ${actTexts.length ? actTexts.join('; ') : (!Array.isArray(acts) && (get(r, 'diagnosis.rollup') || []).length ? 'not recorded in the attached report' : 'none suggested by this evidence')}.`);
  const att = [];
  if (files.jsonName) { own(files.jsonName); att.push(`${files.jsonName} (sha256 ${files.jsonSha256 ? files.jsonSha256.slice(0, 12) : NA})`); if (files.jsonSha256) opaque.push(files.jsonSha256.slice(0, 12)); }
  if (files.htmlName) { own(files.htmlName); att.push(`${files.htmlName} (sha256 ${files.htmlSha256 ? files.htmlSha256.slice(0, 12) : 'listed in the .email.txt file'})`); if (files.htmlSha256) opaque.push(files.htmlSha256.slice(0, 12)); }
  body.push(`Attached: ${att.length ? att.join(', ') : NA}.`);
  const textOut = `${subject}\n\n${body.join('\n')}\n`;
  // scope entry names and the dates are opaque identity text, not measurements
  for (const e of get(r, `${BIND.scope}.entries`) || []) own(e.name !== undefined ? e.name : e.pattern);
  return { text: textOut, opaque, check: () => checkEmail(textOut, raw, opaque) };
}

// every numeric token must equal a JSON numeric value (at 0-3 decimals) or a named derived value; throws otherwise
function checkEmail(emailText, raw, opaque = []) {
  const r = plain(raw);
  const backed = new Set();
  const add = (v) => { for (let d = 0; d <= 3; d++) backed.add(+v.toFixed(d)); };
  (function walk(x) {
    if (typeof x === 'number' && Number.isFinite(x)) add(x);
    else if (Array.isArray(x)) { backed.add(x.length); x.forEach(walk); } else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  })(r);
  for (const v of derivedNumbers(r)) add(v);
  let t = String(emailText);
  for (const o of [...opaque].sort((a, b) => b.length - a.length)) if (o) t = t.split(o).join(' ');
  t = t.replace(/sha256/g, ' ').replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/(^|[\s;(])\d\) /g, '$1 ');
  const bad = [];
  for (const m of t.match(/-?\d+(?:\.\d+)?/g) || []) if (!backed.has(+m)) bad.push(m);
  if (bad.length) throw new EmailTraceError([...new Set(bad)]);
  return true;
}

const sha256File = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

module.exports = { buildEmail, checkEmail, EmailTraceError, BIND, sha256File };
