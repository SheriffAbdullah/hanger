'use strict';
// Diagnosis engine: one pure function, diagnose(report, opts) -> diagnosis. Replayable from a stored report.
// It builds the context once (observer guard, calm windows, marks, confirmations), runs every rule module found in
// ./rules at each usable hang, derives confidence from recorded components, ranks per hang, rolls up per run and
// derives the finding, hardware-versus-configuration signal and time-lost from that ranking. No other inference path exists.
//
// RULE MODULE FORMAT (the contract wave 6 and later changes extend; see README "Diagnosis rules"):
//   module.exports = {
//     id, class, phrase, valueLabel,        // class is one of vocabulary.CAUSE_CLASSES; phrase/valueLabel are sentence words
//     after: [ruleIds]?,                    // rules whose results this one reads (engine orders evaluation)
//     priority?: number,                    // breaks an exact confidence tie (higher first; default 0)
//     evaluate(ctx, hang, prior) -> { fired: true|false|null, reason, inputs[], threshold{value,unit,source,origin}, n,
//         calmSignal?, hangValue?, effThreshold?, direction?: 'higher'|'lower', confounds?[], extra?,
//         class? (a variant class for this hang, e.g. database-memory-io: memory or disk; defaults to the module class) },
//     disprove(ctx, hang) -> { check, result: 'disproved'|'not-disproved'|'not-evaluable', values[] },
//     describe?(ctx, firedResults, rollupEntry) -> string|null     // optional extra words for the finding sentence
//   }
// Inputs are built with ctx.input(probe, signalName) so each carries {ref, signal, at, value, unit}.
// fired:null means "could not evaluate" and must carry a reason. Dropping a file into ./rules is the only registration.
const fs = require('fs');
const path = require('path');
const { buildContext, MIN_USABLE, SUSTAINED_MIN } = require('./context');
const conf = require('./confidence');
const vocab = require('./vocabulary');
const signals = require('./signals');
const { deriveActions } = require('./actions');
const agreementLib = require('../input/agreement');
const { evaluatedFromSection } = require('../input/report');

const ENGINE = 'diagnosis/1';
const RULES_DIR = path.join(__dirname, 'rules');
const FIRED = [true, false, null];
const DISPROVER = ['disproved', 'not-disproved', 'not-evaluable'];
const CANNOT_SEE = ['freezes shorter than the probe interval', 'UI input lag that does not delay process start'];

class RuleContractError extends Error {
  constructor(ruleId, problems) { super(`rule '${ruleId}' breaks the rule contract: ${problems.join('; ')}`); this.name = 'RuleContractError'; this.ruleId = ruleId; this.problems = problems; }
}

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const fmt = (x) => (x === null || x === undefined ? 'n/a' : Math.abs(x) >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));
const unitText = (u) => (u === '%' || u === '% of machine' ? '%' : u === 'ms' ? ' ms' : u === 'MB' ? ' MB' : u ? ` ${u}` : '');

function loadRules(dir = RULES_DIR) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('_')).sort().map((f) => require(path.join(dir, f)));
}

// module shape check (at load) -------------------------------------------------------------------------------
function validateRuleModule(r) {
  const p = [];
  if (!r || typeof r !== 'object') throw new RuleContractError('?', ['not an object']);
  if (typeof r.id !== 'string' || !r.id) p.push('missing id');
  if (!vocab.isCauseClass(r.class)) p.push(`class '${r.class}' is not a cause class in the vocabulary`);
  if (typeof r.evaluate !== 'function') p.push('missing evaluate()');
  if (typeof r.disprove !== 'function') p.push('missing disprove()');
  if (p.length) throw new RuleContractError(r && r.id || '?', p);
}

// result shape check (per hang) --------------------------------------------------------------------------------
function validateRaw(rule, raw) {
  const p = [];
  if (!raw || typeof raw !== 'object') throw new RuleContractError(rule.id, ['evaluate() returned nothing']);
  if (!FIRED.includes(raw.fired)) p.push('fired must be true, false or null');
  if (!Array.isArray(raw.inputs)) p.push('inputs[] missing');
  else raw.inputs.forEach((i, k) => { for (const f of ['ref', 'signal', 'at']) if (!i || typeof i[f] !== 'string') p.push(`inputs[${k}].${f} missing`); if (!i || !('value' in i) || !('unit' in i)) p.push(`inputs[${k}] needs value and unit`); });
  const t = raw.threshold;
  if (!t || !finite(t.value) || !t.unit || !t.source || !t.origin) p.push('threshold{value,unit,source,origin} incomplete');
  if (!finite(raw.n)) p.push('n missing');
  if (raw.fired === null && !raw.reason) p.push('fired:null needs a reason naming what is missing');
  if (p.length) throw new RuleContractError(rule.id, p);
}
function validateDisprover(rule, d) {
  const p = [];
  if (!d || typeof d.check !== 'string' || !d.check) p.push('disprover.check missing');
  if (!d || !DISPROVER.includes(d.result)) p.push('disprover.result must be disproved|not-disproved|not-evaluable');
  if (!d || !Array.isArray(d.values)) p.push('disprover.values[] missing');
  if (p.length) throw new RuleContractError(rule.id, p);
}
// final per-hang result: every field of the published contract
const RESULT_FIELDS = ['id', 'class', 'fired', 'reason', 'at', 'inputs', 'threshold', 'n', 'calm', 'components', 'confidence', 'disprover', 'confounds'];
function validateResult(res) {
  const missing = RESULT_FIELDS.filter((f) => !(f in res));
  if (missing.length) throw new RuleContractError(res.id || '?', [`result lacks ${missing.join(', ')}`]);
  return true;
}

// evaluation order: a rule runs after the rules named in `after`
function orderRules(rules) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const out = [], seen = new Set(), stack = new Set();
  const visit = (r) => {
    if (seen.has(r.id)) return;
    if (stack.has(r.id)) throw new RuleContractError(r.id, ['circular `after` dependency']);
    stack.add(r.id);
    for (const a of r.after || []) if (byId.has(a)) visit(byId.get(a));
    stack.delete(r.id); seen.add(r.id); out.push(r);
  };
  rules.forEach(visit);
  return out;
}

// a more specific explanation wins an exact tie (e.g. outside-scope over machine-wide memory pressure)
const prio = (rules, id) => { const r = rules.find((x) => x.id === id); return r && Number.isFinite(r.priority) ? r.priority : 0; };
const effective = (res) => res.fired === true && res.disprover.result !== 'disproved';

function probeInterval(ctx) {
  const t = ctx.probes.map((q) => q.tSec).filter(finite);
  if (t.length < 2) return null;
  const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
  return r1(d[Math.floor(d.length / 2)]);
}

function scopeText(ctx) {
  const s = ctx.scope;
  if (!s) return 'scope not recorded';
  if (s.mode === 'open') return 'open scope';
  const names = (s.entries || []).map((e) => (e.name !== undefined ? e.name : e.pattern)).filter(Boolean);
  return `scoped: ${names.slice(0, 8).join(', ') || s.mode}`;
}

// weight of each confirmation source for the K component; a hang takes the highest weight among its sources.
// input-stall is an instrument, not a person: alone it counts half (owner decision OQ-3)
const CONFIRM_WEIGHTS = Object.freeze({ 'user-mark': 1, 'os-not-responding': 1, 'workload-probe': 1, 'input-stall': 0.5, 'probe-only': 0 });
const confirmWeight = (confirmedBy) => Math.max(0, ...confirmedBy.map((k) => (k in CONFIRM_WEIGHTS ? CONFIRM_WEIGHTS[k] : 1)));

function confirmCounts(hangs, withInput = false) {
  const c = { 'user-mark': 0, 'os-not-responding': 0, 'workload-probe': 0, 'probe-only': 0 };
  if (withInput) c['input-stall'] = 0;
  for (const h of hangs) { if (h.confirmedBy[0] === 'probe-only') c['probe-only']++; for (const k of h.confirmedBy) if (k !== 'probe-only') c[k]++; }
  return c;
}
function confirmText(c, hangsN) {
  const parts = [];
  if (c['user-mark']) parts.push(`${c['user-mark']} confirmed by user mark`);
  if (c['os-not-responding']) parts.push(`${c['os-not-responding']} by the OS not-responding check`);
  if (c['workload-probe']) parts.push(`${c['workload-probe']} by the workload probe`);
  if (c['input-stall']) parts.push(`${c['input-stall']} by the input-response check`);
  if (c['probe-only']) parts.push(`${c['probe-only']} probe-only`);
  return parts.length ? parts.join(', ') : `${hangsN} probe-only`;
}

function timeLost(ctx, report, opts) {
  if (!ctx.hangs.length) return null;
  const frozenS = r1(ctx.hangs.reduce((a, h) => a + (finite(h.ms) ? h.ms / 1000 : 0), 0));
  const observedS = report.window && finite(report.window.observedS) ? report.window.observedS : null;
  const out = { basis: 'measured', hangs: ctx.hangs.length, frozenS, observedS, meanFreezeS: Math.round(frozenS / ctx.hangs.length * 100) / 100, userSupplied: null };
  const uc = opts.userCost;
  if (uc && finite(uc.activeMin) && finite(uc.ratePerHr) && observedS > 0) {
    const lostMinPerDay = Math.round((frozenS / observedS) * uc.activeMin * 10) / 10;
    out.userSupplied = { label: 'user-supplied extrapolation', activeMinPerDay: uc.activeMin, ratePerHr: uc.ratePerHr, lostMinPerDay, costPerDay: Math.round(lostMinPerDay / 60 * uc.ratePerHr * 100) / 100 };
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------
function diagnose(report, opts = {}) {
  const rules = orderRules(opts.rules || loadRules());
  rules.forEach(validateRuleModule);
  const ctx = buildContext(report, opts);
  const hangSet = report.settings && report.settings.thresholds && report.settings.thresholds.hang;
  const usableN = ctx.usable.length;
  const out = {
    engine: ENGINE,
    hangDefinition: { probe: 'process-start-latency', thresholdMs: ctx.TH.hang, source: hangSet && hangSet.source ? hangSet.source : 'default', intervalS: probeInterval(ctx), cannotSee: CANNOT_SEE.slice() },
    usable: { probes: usableN, excluded: ctx.excluded.length, minimum: MIN_USABLE, sustainedMin: SUSTAINED_MIN },
    excludedProbes: ctx.excluded,
    calm: { definition: `usable, latency < ${ctx.TH.recovery} ms, not within 10 s of a hang`, n: ctx.calm.length, means: {} },
    proxyValidation: ctx.proxyValidation,
    marks: { joined: ctx.marks.joined, unmatched: ctx.marks.unmatched },
    confidenceModel: { confirmationWeights: { ...CONFIRM_WEIGHTS }, weights: { ...conf.MODEL.weights }, penaltyPerConfound: conf.MODEL.penaltyPerConfound, penaltyMax: conf.MODEL.penaltyMax, cap: conf.MODEL.cap },
    thresholds: {},
    probeAgreement: null, inputStallCorroboration: null,
    hangs: [], rollup: [], finding: null, observations: [], hwConfigSignal: null, timeLost: null,
    eventsUsed: ctx.eventsUsed, eventsHistory: ctx.eventsHistory,
  };
  const hangEntries = ctx.hangs.map((h) => ({ q: h, entry: { ref: h.ref, at: h.p.at, ms: h.ms, confirmedBy: h.confirmedBy, helperLate: h.helperLate, ...(h.helperLateReason ? { helperLateReason: h.helperLateReason } : {}), ...(h.p.scopeShare ? { scopeShare: h.p.scopeShare } : {}), rules: [], ranked: [] } }));
  const canRank = ctx.hangs.length > 0 && usableN >= MIN_USABLE;

  if (canRank) {
    // pass 1: evaluate every rule at every usable hang
    const raws = new Map(); // rule.id -> [{q, entry, res, raw}]
    for (const { q, entry } of hangEntries) {
      const prior = {};
      for (const rule of rules) {
        const raw = rule.evaluate(ctx, q, prior); validateRaw(rule, raw);
        const disp = rule.disprove(ctx, q); validateDisprover(rule, disp);
        const confounds = (raw.confounds || []).map((c) => ({ id: c.id, text: c.text, active: c.active !== false }));
        const calm = raw.calmSignal ? ctx.calmMean(raw.calmSignal) : { mean: null, n: 0, signal: null };
        const res = {
          id: rule.id, class: raw.class && vocab.isCauseClass(raw.class) ? raw.class : rule.class, fired: raw.fired, reason: raw.reason || null,
          at: [...new Set(raw.inputs.map((i) => i.at))],
          inputs: raw.inputs, threshold: raw.threshold, n: raw.n,
          calm: { mean: calm.mean, n: calm.n, signal: calm.signal },
          components: null, confidence: null,
          disprover: { check: disp.check, result: disp.result, values: disp.values },
          confounds, ...(raw.extra ? { extra: raw.extra } : {}),
        };
        prior[rule.id] = res;
        entry.rules.push(res);
        if (!raws.has(rule.id)) raws.set(rule.id, []);
        raws.get(rule.id).push({ q, entry, res, raw });
        out.thresholds[rule.id] = raw.threshold;
      }
    }
    // pass 2: co-occurrence and confirmation shares, components, confidence
    const usableHangsN = hangEntries.length;
    for (const rule of rules) {
      const rows = raws.get(rule.id) || [];
      const eff = rows.filter((x) => effective(x.res));
      const O = usableHangsN ? eff.length / usableHangsN : 0;
      const K = eff.length ? eff.reduce((a, x) => a + confirmWeight(x.q.confirmedBy), 0) / eff.length : 0;
      for (const x of eff) {
        const calm = x.res.calm;
        const d = conf.deltaComponent({ v: x.raw.hangValue, calmMean: calm.mean, calmN: calm.n, threshold: x.raw.effThreshold, direction: x.raw.direction });
        const active = x.res.confounds.filter((c) => c.active).length;
        const c = { C: 1, D: Math.round(d.D * 100) / 100, O: Math.round(O * 100) / 100, K: Math.round(K * 100) / 100 };
        const cv = conf.confidence({ ...c, activeConfounds: active });
        x.res.components = { ...c, P: cv.P, ...(d.flag ? { flags: [d.flag] } : {}) };
        x.res.confirmationWeight = confirmWeight(x.q.confirmedBy);
        x.res.confidence = cv.value;
        x.res.hangValue = finite(x.raw.hangValue) ? Math.round(x.raw.hangValue * 100) / 100 : null;
      }
      for (const x of rows) if (!effective(x.res)) x.res.components = x.res.components || null;
    }
    // per-hang ranking
    for (const { entry } of hangEntries) {
      entry.ranked = entry.rules.filter(effective)
        .sort((a, b) => b.confidence - a.confidence || prio(rules, b.id) - prio(rules, a.id) || (b.components.O - a.components.O) || a.id.localeCompare(b.id)).map((r) => r.id);
      entry.rules.forEach(validateResult);
    }
    // roll-up
    for (const rule of rules) {
      const eff = (raws.get(rule.id) || []).filter((x) => effective(x.res));
      if (!eff.length) continue;
      const hv = eff.map((x) => x.res.hangValue).filter(finite);
      const calm = eff[0].res.calm;
      const sample = eff[0].res;
      out.rollup.push({ id: rule.id, class: eff[0].res.class, hangs: eff.length, of: usableHangsN, confidence: Math.round(avg(eff.map((x) => x.res.confidence)) * 100) / 100,
        hangMean: hv.length ? r1(avg(hv)) : null, hangN: hv.length, calm: { mean: calm.mean, n: calm.n }, unit: signals.unitOf(calm.signal) || sample.threshold.unit, signal: calm.signal });
    }
    out.rollup.sort((a, b) => b.confidence - a.confidence || prio(rules, b.id) - prio(rules, a.id) || b.hangs - a.hangs || a.id.localeCompare(b.id));
    for (const rule of rules) for (const x of raws.get(rule.id) || []) if (x.res.calm.signal && !(x.res.calm.signal in out.calm.means) && x.res.calm.mean !== null) out.calm.means[x.res.calm.signal] = x.res.calm.mean;
    out.hangs = hangEntries.map((x) => x.entry);
    out.finding = buildFinding({ ctx, out, rules, raws, hangEntries });
    out.hwConfigSignal = hwConfig(ctx, out, report);
  } else {
    out.hangs = hangEntries.map((x) => x.entry);
    out.observations = observations(ctx, report);
    out.finding = buildNoRankFinding(ctx, out);
  }
  attachInputStall(out, ctx);
  out.timeLost = timeLost(ctx, report, opts);
  out.suggestedActions = deriveActions(out);
  return out;
}

// second-order values: recomputable from the stored first-order data (episodes, probes, evaluable intervals)
function attachInputStall(out, ctx) {
  const sec = ctx.inputSection;
  const stateOf = !sec ? { status: 'predates', reason: 'report predates the input-response check' } : { status: sec.status, reason: sec.reason || (sec.status === 'not-requested' ? 'the input-response check was turned off by the user' : null) };
  out.hangDefinition.inputResponse = { status: !sec ? 'not evaluated' : sec.status, ...(stateOf.reason ? { reason: stateOf.reason } : {}), ...(sec && sec.cannotSee ? { cannotSee: sec.cannotSee.slice() } : {}) };
  if (!sec || sec.status !== 'running') {
    out.probeAgreement = agreementLib.probeAgreement({ status: 'not-running', reason: stateOf.reason, hangs: [], episodes: [] });
    out.inputStallCorroboration = agreementLib.corroboration({ status: 'not-running', reason: stateOf.reason, episodes: [] });
    return;
  }
  const settings = sec.settings || {};
  const hangs = ctx.allHangs.map((q) => ({ ref: q.ref, atMs: q.atMs, ms: q.ms, osConfirmed: q.confirmedBy.includes('os-not-responding') }));
  out.probeAgreement = agreementLib.probeAgreement({
    status: 'running', hangs, episodes: ctx.stallEpisodes, evaluated: evaluatedFromSection(sec),
    probeIntervalS: probeInterval(ctx), stallMs: settings.stallMs ? settings.stallMs.v : null,
  });
  out.inputStallCorroboration = agreementLib.corroboration({ status: 'running', episodes: ctx.stallEpisodes });
}

function sufficiency(ctx) {
  return ctx.usable.length >= MIN_USABLE ? 'sufficient' : `insufficient (${ctx.usable.length} usable probes, minimum ${MIN_USABLE})`;
}
function baseFinding(ctx, cls, sentence, extra = {}) {
  const hangs = ctx.hangs;
  const r = ctx.report;
  return {
    class: cls, sentence, strength: sufficiency(ctx),
    confirmations: confirmCounts(hangs, !!(ctx.inputSection && ctx.inputSection.status === 'running')),
    excludedHangs: ctx.excludedHangs.length,
    scope: scopeText(ctx),
    window: { start: (r.run && r.run.startedAt) || r.startedAt || null, end: (r.run && r.run.endedAt) || null, observedS: r.window && finite(r.window.observedS) ? r.window.observedS : null },
    ...extra,
  };
}

function buildNoRankFinding(ctx, out) {
  const lat = ctx.usable.map((q) => q.ms).filter(finite);
  const worst = lat.length ? Math.max(...lat) : null;
  const exTxt = ctx.excluded.length ? `; ${ctx.excluded.length} probe(s) excluded as observer-affected` : '';
  if (!ctx.probes.length) return baseFinding(ctx, 'insufficient-evidence', 'No hang probes were recorded, so nothing can be said about freezes in this run.');
  if (!ctx.allHangs.length) {
    return baseFinding(ctx, 'no-freeze-observed', `No freeze observed: 0 of ${ctx.usable.length} usable probes reached ${ctx.TH.hang} ms${worst !== null ? ` (slowest ${Math.round(worst)} ms)` : ''}${exTxt}. This is not evidence that the machine never freezes.`);
  }
  const why = ctx.hangs.length === 0 ? `all ${ctx.allHangs.length} hang(s) were observer-affected` : `${ctx.usable.length} usable probes, minimum ${MIN_USABLE}`;
  return baseFinding(ctx, 'insufficient-evidence', `${ctx.allHangs.length} hang(s) seen but no cause is ranked (${why})${exTxt}.`);
}

function observations(ctx, report) {
  const obs = [];
  obs.push(`${ctx.usable.length} usable probes of ${ctx.probes.length}${ctx.excluded.length ? ` (${ctx.excluded.length} excluded: ${[...new Set(ctx.excluded.flatMap((e) => e.reasons))].join(', ')})` : ''}`);
  const cm = ctx.usable.map((q) => ctx.sig(q, 'mem.committed_pct')).filter(finite);
  if (cm.length) obs.push(`commit ${Math.round(Math.min(...cm))}-${Math.round(Math.max(...cm))}% across ${cm.length} usable probes`);
  for (const h of ctx.allHangs) {
    const c = ctx.sig(h, 'mem.committed_pct'), a = ctx.sig(h, 'mem.avail_mb');
    obs.push(`hang ${Math.round(h.ms)} ms at ${h.p.at} (t+${h.tSec}s)${c !== null ? `, commit ${c}%` : ''}${a !== null ? `, available ${a} MB` : ''}${h.excluded ? ` [excluded: ${h.excluded.join(', ')}]` : ''}`);
  }
  void report;
  return obs;
}

function buildFinding({ ctx, out, rules, raws, hangEntries }) {
  const top = out.rollup[0];
  const usableHangs = hangEntries.length;
  if (!top) {
    const listed = rules.map((rule) => {
      const rows = raws.get(rule.id) || [];
      const nulls = rows.filter((x) => x.res.fired === null).length;
      const disproved = rows.filter((x) => x.res.fired === true && x.res.disprover.result === 'disproved').length;
      const reason = rows.map((x) => x.res.reason).find(Boolean) || null;
      return { id: rule.id, class: rule.class, firedAtHangs: 0, notEvaluable: nulls, disproved, reason };
    });
    return baseFinding(ctx, 'undetermined', `${usableHangs} usable hang(s) with ${ctx.usable.length} usable probes, but no rule fired (or every fired rule was disproved); no cause is named.`, { rulesChecked: listed });
  }
  const rule = rules.find((r) => r.id === top.id);
  const firedRes = (raws.get(top.id) || []).filter((x) => effective(x.res)).map((x) => x.res);
  const conf = confirmCounts(ctx.hangs, !!(ctx.inputSection && ctx.inputSection.status === 'running'));
  const label = vocab.CLASS_LABEL[top.class] || top.class;
  const extra = typeof rule.describe === 'function' ? rule.describe(ctx, firedRes, top) : null;
  const u = unitText(top.unit);
  const values = top.class === 'outside-scope' || top.hangMean === null ? '' : `; ${rule.valueLabel || 'value'} ${fmt(top.hangMean)}${u} at hangs vs ${top.calm.mean === null ? 'no calm baseline' : `${fmt(top.calm.mean)}${u} calm`} (hangs n=${top.hangN}, calm n=${top.calm.n})`;
  const sentence = `${top.hangs} of ${top.of} usable hangs coincide with ${top.class === 'outside-scope' && extra ? extra : label}${values}${top.class === 'outside-scope' || !extra ? '' : `; ${extra}`}; ${confirmText(conf, ctx.hangs.length)}`;
  return baseFinding(ctx, top.class, sentence, { ruleId: top.id, confidence: top.confidence });
}

function hwConfig(ctx, out, report) {
  const mem = out.rollup.find((r) => r.id === 'memory-pressure');
  const hv = ctx.hangs.map((h) => ctx.sig(h, 'mem.committed_pct')).filter(finite);
  const calm = ctx.calmMean('mem.committed_pct');
  const atHang = { mean: hv.length ? r1(avg(hv)) : null, n: hv.length };
  const calmOut = { mean: calm.mean === null ? null : r1(calm.mean), n: calm.n };
  if (mem && mem.hangs / mem.of >= 0.5) return { value: 'pressure-at-freezes', atHang, calm: calmOut };
  const totalMB = report.machine && finite(report.machine.totalGB) ? report.machine.totalGB * 1024 : null;
  const big = ctx.hangs.map((h) => h.p.culpritsAtHang && h.p.culpritsAtHang[0] && h.p.culpritsAtHang[0].totalMB).filter(finite);
  if (!mem && totalMB && big.length && avg(big) / totalMB >= 0.4) return { value: 'large-resident-without-pressure', atHang, calm: calmOut, largestGroupPctOfRam: Math.round(avg(big) / totalMB * 100) };
  return { value: 'not-separable', atHang, calm: calmOut };
}

// attach to a report (used by every writer: complete, interrupted, recovered)
function attachDiagnosis(report, opts = {}) {
  report.diagnosis = diagnose(report, opts);
  return report;
}

module.exports = { CONFIRM_WEIGHTS, confirmWeight, diagnose, attachDiagnosis, loadRules, orderRules, validateResult, validateRuleModule, RuleContractError, effective, ENGINE, RULES_DIR, signals };
