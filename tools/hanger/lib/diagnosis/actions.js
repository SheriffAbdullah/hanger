'use strict';
// Suggested actions: a FIXED rule-to-action table, ordered cheapest first by a fixed cost rank (never by confidence).
// deriveActions(diagnosis) is a pure function of the ranked per-hang rule results, so a stored report recomputes identically.
// Wording is neutral: no purchase verdict (a test scans every template for banned words). The engine calls this at the end
// of diagnose(); this module does not require the engine.

const ACTIONS = Object.freeze({
  'security-exclusions': { rank: 1, text: 'Review security-software exclusions for the workload folders' },
  'vm-memory-cap': { rank: 2, text: 'Set or lower the VM memory cap for the container platform' },
  'power-plan': { rank: 3, text: 'Use AC power and a balanced or performance power mode during the workload' },
  'driver-firmware': { rank: 4, text: 'Check driver and firmware (BIOS) updates' },
  'app-memory': { rank: 5, text: "Investigate the named application's memory use or configuration" },
  'storage-health': { rank: 6, text: 'Check storage health and free space' },
  'memory-capacity': { rank: 7, text: "Compare installed memory with the workload's commit need" },
});
const BANNED_WORDS = Object.freeze(['buy', 'upgrade', 'replace', 'deserve', 'insufficient']);

// rule result -> action key (null: the rule has no mapped action; the table above is the whole mapping)
function actionKeyOf(res) {
  switch (res.id) {
    case 'security-contention': return 'security-exclusions';
    case 'vm-memory-dominance': return 'vm-memory-cap';
    case 'battery-power-plan': return 'power-plan';
    case 'thermal-power-throttle': return res.extra && res.extra.limitKind === 'thermal' ? 'driver-firmware' : 'power-plan';
    case 'driver-interrupt-storm': case 'gpu-contention': return 'driver-firmware';
    case 'single-process-dominance': return 'app-memory';
    case 'database-memory-io': return res.class === 'disk' || (res.extra && res.extra.variant === 'io') ? 'storage-health' : 'app-memory';
    case 'disk-stall': case 'disk-nearly-full': return 'storage-health';
    case 'commit-limit-pressure': case 'hard-fault-thrash': return 'memory-capacity';
    default: return null;
  }
}

const effective = (res) => res.fired === true && res.disprover && res.disprover.result !== 'disproved';
const r2 = (x) => Math.round(x * 100) / 100;

function deriveActions(diagnosis) {
  const hangs = (diagnosis && Array.isArray(diagnosis.hangs)) ? diagnosis.hangs : [];
  const of = hangs.length;
  const byKey = new Map();
  for (const hang of hangs) {
    for (const res of hang.rules || []) {
      if (!effective(res)) continue;
      const key = actionKeyOf(res);
      if (!key) continue;
      let a = byKey.get(key);
      if (!a) { a = { key, hangs: new Set(), rules: new Map(), names: new Set() }; byKey.set(key, a); }
      a.hangs.add(hang.ref);
      const r = a.rules.get(res.id) || { id: res.id, hangRefs: new Set(), conf: [] };
      r.hangRefs.add(hang.ref);
      if (Number.isFinite(res.confidence)) r.conf.push(res.confidence);
      a.rules.set(res.id, r);
      if (res.extra && typeof res.extra.group === 'string' && (key === 'app-memory')) a.names.add(res.extra.group);
    }
  }
  return [...byKey.values()].sort((x, y) => ACTIONS[x.key].rank - ACTIONS[y.key].rank).map((a) => {
    const rules = [...a.rules.values()].map((r) => ({ id: r.id, hangs: r.hangRefs.size, of, confidence: r.conf.length ? r2(r.conf.reduce((p, c) => p + c, 0) / r.conf.length) : null }));
    return {
      key: a.key, rank: ACTIONS[a.key].rank, text: ACTIONS[a.key].text,
      ruleIds: rules.map((r) => r.id), rules,
      hangs: { k: a.hangs.size, of, label: `${a.hangs.size}/${of}` },
      confidence: rules.reduce((m, r) => (r.confidence !== null && (m === null || r.confidence > m) ? r.confidence : m), null),
      ...(a.names.size ? { names: [...a.names].sort() } : {}),
    };
  });
}

module.exports = { ACTIONS, BANNED_WORDS, actionKeyOf, deriveActions };
