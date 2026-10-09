'use strict';
// "Input-response check" subsection and the confirmation-label map, built only from report JSON (pure).
// Every figure comes from `inputStall`, `diagnosis.probeAgreement`, `diagnosis.inputStallCorroboration` and
// `sampling.observer.helper`. An unavailable value reads "not available (reason)"; out-of-scope episodes appear only as a count and total.
const { isRec, plain } = require('../sampler/record');
const { fmt, na, n2 } = require('./format');
const { clock, get, numOf, ms } = require('./series');

// one label map for every view; an unknown label renders as-is
const CONFIRM_LABEL = { 'user-mark': 'your mark', 'os-not-responding': 'Windows', 'workload-probe': 'workload probe', 'input-stall': 'input-response check', 'probe-only': 'probe only' };
const confirmLabel = (k) => CONFIRM_LABEL[k] || String(k);

const CORROB_LABEL = { 'probe-hang': 'spawn-probe hang', 'os-not-responding': 'Windows not-responding', 'user-mark': 'your mark', 'workload-probe': 'workload probe', 'helper-late': 'helper late period' };
const REASON_LABEL = { 'elevated-foreground': 'higher-privilege foreground application', locked: 'locked screen', 'secure-desktop': 'secure desktop', 'remote-session': 'remote-desktop session', 'suspend-resume': 'suspend and resume', 'no-foreground': 'no foreground window', 'helper-exited': 'helper exited' };
const reasonText = (r) => REASON_LABEL[r] || String(r);

// 'running' | 'unavailable' | 'not-requested' | 'absent'
function inputState(section) {
  if (!section || typeof section !== 'object') return { state: 'absent', reason: 'report predates the input-response check' };
  if (section.status === 'running') return { state: 'running', reason: null };
  if (section.status === 'not-requested') return { state: 'not-requested', reason: section.reason || 'turned off by the user' };
  return { state: 'unavailable', reason: section.reason || 'no reason recorded' };
}

const has = (v) => v !== null && v !== undefined;
const ratioText = (r) => {
  if (!r) return 'not evaluated';
  if (r.status === 'not evaluated') return `not evaluated (${r.reason || 'no reason recorded'})`;
  if (!r.den) return 'not evaluated (no cases in evaluated time)';
  return `${r.num}/${r.den} (${n2(r.value)})`;
};
const isoClock = (iso, off) => { const t = ms(iso); return t === null ? 'n/a' : clock(t, off); };

// c: { inputStall, probeAgreement, corroboration, observerHelper, off }
function inputCheckBlocks(c) {
  const s = c.inputStall;
  const st = inputState(s);
  const blocks = [{ t: 'sub', text: 'Input-response check' }];
  if (st.state === 'absent') { blocks.push({ t: 'p', cls: 'not-in-pack', text: `Input-response check: ${na(st.reason)}` }); return blocks; }
  if (st.state === 'unavailable') { blocks.push({ t: 'p', cls: 'not-in-pack', text: `Input-response check: ${na(st.reason)}` }); return blocks; }
  if (st.state === 'not-requested') { blocks.push({ t: 'p', text: `Input-response check: turned off by the user${s.source ? ` (${s.source})` : ''}. No input-response data was collected.` }); return blocks; }

  const off = c.off === undefined ? null : c.off;
  const set = s.settings || {};
  const thr = set.stallMs ? `${set.stallMs.v} ms` : 'the stall threshold';
  const eps = Array.isArray(s.episodes) ? s.episodes : [];
  const ev = s.evaluable || {};
  blocks.push({ t: 'p', text: `This check is automatic and needs no action from you. A small separate helper notes when input happened and how long the foreground application took to answer a trivial liveness request; when it did not answer within ${thr} the moment is recorded as a stall. It records the fact and time of input only, never what was typed or clicked, window titles, clipboard contents or pointer positions, and names the foreground application only when it is in the declared scope. The thresholds are provisional.` });

  const inScope = eps.filter((e) => e.foreground && e.foreground.kind !== 'out-of-scope');
  const outN = numOf(get(s, 'outOfScope.episodes')) ?? eps.length - inScope.length;
  if (!eps.length) blocks.push({ t: 'p', text: `No input-response stall was observed in the evaluated time (${fmt(ev.evaluatedS, 's')} evaluated). This does not show that the machine did not freeze: the check only sees applications that stop answering while input is recent.` });
  else {
    blocks.push({ t: 'p', text: `${eps.length} input-response stall episode${eps.length === 1 ? '' : 's'} detected automatically${outN ? ` (${outN} in applications outside the declared scope, counted below without names)` : ''}.` });
    if (inScope.length) {
      blocks.push({ t: 'table', cls: 'stalls', head: ['#', 'Start', 'Duration', 'Worst answer time', 'Foreground', 'Ended', 'Also seen by', 'Confidence'], rows: inScope.map((e) => [
        e.id, isoClock(e.startAt, off), fmt(e.durationMs, 'ms'), fmt(e.worstLatencyMs, 'ms'),
        e.foreground.group || e.foreground.kind, e.endReason || 'not recorded',
        (e.corroboratedBy || []).length ? e.corroboratedBy.map((k) => CORROB_LABEL[k] || k).join(', ') : 'nothing else',
        e.confidence ? `${n2(e.confidence.value)}${(e.guards || []).length ? ` (${e.guards.join(', ')})` : ''}` : 'not recorded',
      ]) });
    }
  }
  if (outN) blocks.push({ t: 'p', text: `Episodes in applications outside the declared scope: ${outN}, ${fmt(get(s, 'outOfScope.totalMs'), 'ms')} in total (no application is named).` });

  // time accounting
  const ne = Array.isArray(ev.notEvaluable) ? ev.notEvaluable : [];
  const neByReason = new Map();
  for (const x of ne) neByReason.set(x.reason, (neByReason.get(x.reason) || 0) + (numOf(x.durationS) || 0));
  const kv = [
    ['Observed by the helper', fmt(ev.observedS, 's')],
    ['Evaluated (input recent)', fmt(ev.evaluatedS, 's')],
    ['Idle (no recent input, never probed)', fmt(ev.idleS, 's')],
    ['Not evaluable', `${fmt(ev.notEvaluableS, 's')}${neByReason.size ? `: ${[...neByReason.entries()].map(([r, sec]) => `${reasonText(r)} ${n2(sec)} s`).join(', ')}` : ''}`],
  ];

  // corroboration
  const co = c.corroboration;
  if (co && co.status === 'evaluated') {
    kv.push(['Episodes also seen by', `spawn-probe hang ${co.probeHang.num}/${co.probeHang.den}; Windows not-responding ${co.osNotResponding.num}/${co.osNotResponding.den}; your mark ${co.userMark.num}/${co.userMark.den}; workload probe ${co.workloadProbe.num}/${co.workloadProbe.den}; helper late period ${co.helperLate.num}/${co.helperLate.den}; nothing else ${co.none.num}/${co.none.den}`]);
  } else kv.push(['Episodes also seen by', co && co.reason ? `not evaluated (${co.reason})` : 'not evaluated']);

  // agreement with the spawn probe
  const ag = c.probeAgreement;
  if (ag && ag.status === 'evaluated') {
    kv.push(['Probe precision against felt stalls', `${ratioText(ag.precision)} - spawn-probe hangs during evaluated time that overlap a stall, join tolerance ${ag.toleranceMs} ms`]);
    kv.push(['Probe recall against felt stalls', `${ratioText(ag.recall)} - stalls that overlap a probe hang`]);
    kv.push(['Recall for stalls at least as long as the probe interval', ratioText(ag.recallAtProbeResolution)]);
    const ex = ag.excluded || {};
    kv.push(['Probe hangs left out of precision', `${ex.idle || 0} while idle, ${ex.notEvaluable || 0} while not evaluable, ${ex.unobserved || 0} while unobserved`]);
    kv.push(['Probe hangs with no stall', (ag.probeHangsWithoutStall || []).length ? ag.probeHangsWithoutStall.map((x) => `${x.ref} at ${isoClock(x.at, off)}${x.reason ? ` (${x.reason})` : ''}`).join('; ') : 'none']);
    kv.push(['Stalls with no probe hang', (ag.stallsWithoutProbeHang || []).length ? ag.stallsWithoutProbeHang.map((x) => `${x.ref} at ${isoClock(x.at, off)}, ${n2(x.durationMs)} ms`).join('; ') : 'none']);
    if (ag.note) kv.push(['Note', ag.note]);
  } else kv.push(['Probe agreement with felt stalls', `not evaluated (${(ag && ag.reason) || 'not computed'})`]);

  // flags
  const fl = s.flags || {};
  const flagBits = [];
  for (const g of fl.chronicSlowGroups || []) flagBits.push(`${g.group} flagged chronically slow (its episodes never confirm a freeze)`);
  for (const g of fl.ignored || []) flagBits.push(`${g.group} ignored by configuration (${g.samples} sample${g.samples === 1 ? '' : 's'})`);
  const cb = s.calmBaseline || {};
  if (cb.noisy) flagBits.push(`detector flagged noisy${cb.noisyWhy && cb.noisyWhy.p95Ms !== undefined ? ` (calm 95th percentile ${n2(cb.noisyWhy.p95Ms)} ms against a limit of ${n2(cb.noisyWhy.limitMs)} ms)` : ''}`);
  const fgd = numOf(fl.foregroundChangedDropped);
  if (fgd) flagBits.push(`${fgd} measurement${fgd === 1 ? '' : 's'} dropped because the foreground window changed`);
  kv.push(['Flags', flagBits.length ? flagBits.join('; ') : 'none']);
  kv.push(['Calm baseline (answer time while no stall)', has(cb.medianMs) ? `median ${fmt(cb.medianMs, 'ms')}, 95th percentile ${fmt(cb.p95Ms, 'ms')}, maximum ${fmt(cb.maxMs, 'ms')} over ${fmt(cb.n, 'count')} measurements` : na(cb.medianMsReason || 'no evaluated moment was measured')]);

  // helper lateness and cost
  const hl = s.helperLateness || {};
  const periods = hl.latePeriods || [];
  kv.push(['Helper wake lateness (its own timer)', has(hl.medianMs) ? `median ${fmt(hl.medianMs, 'ms')}, 95th percentile ${fmt(hl.p95Ms, 'ms')}, maximum ${fmt(hl.maxMs, 'ms')}; ${periods.length} late period${periods.length === 1 ? '' : 's'}${periods.length ? `: ${periods.map((p) => `${isoClock(p.startAt, off)}-${isoClock(p.endAt, off)} (up to ${fmt(p.maxMs, 'ms')})`).join('; ')}` : ''}` : na(hl.medianMsReason || 'no wake-ups were recorded')]);
  const hc = c.observerHelper;
  kv.push(['Helper cost', hc && has(hc.cpuPct) ? `${fmt(hc.cpuPct, '%')} of one logical processor, peak ${fmt(hc.privateMB, 'MB')} private memory (limits ${hc.limits.cpuPct}% and ${hc.limits.privateMB} MB${hc.exceeded ? '; EXCEEDED' : ''})` : na('helper cost was not recorded')]);
  blocks.push({ t: 'kv', rows: kv });
  if ((s.unobserved || []).length) blocks.push({ t: 'p', cls: 'note', text: `Unobserved by the check: ${s.unobserved.map((u) => `${isoClock(u.from, off)}-${isoClock(u.to, off)} (${reasonText(u.reason)})`).join('; ')}.` });
  if (Array.isArray(s.cannotSee) && s.cannotSee.length) { blocks.push({ t: 'p', cls: 'note', text: 'What this check cannot see:' }); blocks.push({ t: 'ul', items: s.cannotSee.slice() }); }
  return blocks;
}

// one-line state text used by the chart key, finding and email
function stateText(section) {
  const st = inputState(section);
  if (st.state === 'running') return null;
  if (st.state === 'not-requested') return 'the input-response check was turned off by the user';
  if (st.state === 'absent') return 'the input-response check is not available (report predates the input-response check)';
  return `the input-response check was not available (${st.reason})`;
}

module.exports = { inputCheckBlocks, inputState, stateText, confirmLabel, CONFIRM_LABEL, CORROB_LABEL, ratioText };
void isRec; void plain;
