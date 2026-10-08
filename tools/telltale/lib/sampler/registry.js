'use strict';
// Collector registry (design: "Collector registration contract"). Changes 6 and 7 add collectors
// through registerCollector() without editing the sampler core.
//   tier: continuous | on-trigger | once | probe
//   continuous  -> contributes counter paths to the ONE shared counter session (source.kind 'counter-session')
//   on-trigger  -> runs on hang / schedule / end within budgetMs
//   once        -> run once per run (start or end)
//   probe       -> the single allowed per-tick process launch (the hang probe; source.kind 'hang-probe')
const TIERS = ['continuous', 'on-trigger', 'once', 'probe'];

function createRegistry() {
  const byId = new Map();
  function registerCollector(def) {
    if (!def || typeof def !== 'object') throw new Error('registerCollector: definition required');
    const { id, tier, unit, source } = def;
    if (!id || typeof id !== 'string') throw new Error('registerCollector: id required');
    if (byId.has(id)) throw new Error(`registerCollector: duplicate id '${id}'`);
    if (!TIERS.includes(tier)) throw new Error(`registerCollector: '${id}' has invalid tier '${tier}'`);
    if (!unit) throw new Error(`registerCollector: '${id}' is missing a unit`);
    if (tier === 'continuous' && !(source && source.kind === 'counter-session'))
      throw new Error(`registerCollector: continuous collector '${id}' must use the shared counter session (source.kind 'counter-session'); it may not launch its own process`);
    if (tier === 'probe' && !(source && source.kind === 'hang-probe'))
      throw new Error(`registerCollector: probe collector '${id}' must have source.kind 'hang-probe'`);
    if ((tier === 'on-trigger' || tier === 'once') && !(def.budgetMs > 0))
      throw new Error(`registerCollector: ${tier} collector '${id}' needs budgetMs > 0`);
    const entry = { weight: tier === 'continuous' || tier === 'probe' ? 'light' : 'heavy', triggers: [], adminOnly: false, scopeAware: false, ...def };
    byId.set(id, entry);
    return entry;
  }
  const get = (id) => byId.get(id) || null;
  const list = () => [...byId.values()];
  const byTier = (t) => list().filter((c) => c.tier === t);
  // union of counter paths contributed by continuous collectors (stable order, deduped)
  function counterPaths() {
    const seen = new Set(), out = [];
    for (const c of byTier('continuous')) for (const p of c.source.paths || []) if (!seen.has(p.toLowerCase())) { seen.add(p.toLowerCase()); out.push(p); }
    return out;
  }
  // wildcard counters whose instances come and go (processes, GPU engines, adapters): [{path, reducer, budgetMs}]
  function dynamicCounters() {
    const seen = new Set(), out = [];
    for (const c of byTier('continuous')) for (const d of c.source.dynamic || []) if (!seen.has(d.path.toLowerCase())) { seen.add(d.path.toLowerCase()); out.push({ budgetMs: c.budgetMs || 0, ...d }); }
    return out;
  }
  // legacy view for check-stub and --help: {id: {weight, budgetMs, policy, inference, tier}}
  function legacyView() {
    const o = {};
    for (const c of list()) o[c.id] = { weight: c.weight, budgetMs: c.budgetMs || 0, policy: c.policy || c.tier, inference: c.inference, tier: c.tier };
    return o;
  }
  return { registerCollector, get, list, byTier, counterPaths, dynamicCounters, legacyView };
}

module.exports = { createRegistry, TIERS };
