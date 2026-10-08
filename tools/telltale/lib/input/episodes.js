'use strict';
// Pure episode builder for the input-response stall detector. No I/O, no clock, no side effects at require time.
// Input: the helper's stall samples, not-evaluable spans and 10 s window records (all with ISO `at` stamps made by the
// helper). Output: episodes, blips and counts. Times are epoch ms; durations are ms.
//
// sample: { at, latencyMs, timeout?, fg:{kind,group}, helperLate? }       (one per over-threshold measurement)
// span:   { from, to, reason }                                             (not evaluable)
// window: { from, to, durMs, evalMs, idleMs, skipMs, measured, stalls, fgChanged, groups:{g:{n,over}}, active:[[a,b]], lat*, late* }
const MERGE_JITTER_MS = 100; // the start-to-start gap between samples may exceed the merge gap by this much (timer jitter)

const ms = (iso) => { const t = typeof iso === 'number' ? iso : Date.parse(iso); return Number.isFinite(t) ? t : null; };
const fgKey = (fg) => `${(fg && fg.kind) || 'unknown'}:${(fg && fg.group) || ''}`;

function normalizeSamples(samples) {
  return (samples || []).map((s, i) => ({ ref: i, atMs: ms(s.at), latencyMs: Number(s.latencyMs), timeout: !!s.timeout, fg: s.fg || { kind: 'unknown', group: null }, helperLate: !!s.helperLate }))
    .filter((s) => s.atMs !== null && Number.isFinite(s.latencyMs)).sort((a, b) => a.atMs - b.atMs);
}
function normalizeSpans(spans) {
  return (spans || []).map((s) => ({ from: ms(s.from), to: ms(s.to), reason: s.reason || 'unknown' })).filter((s) => s.from !== null && s.to !== null && s.to >= s.from).sort((a, b) => a.from - b.from);
}

// settings: { stallMs, mergeGapMs, ignoreGroups?[] }
function buildEpisodes({ samples, spans, settings, runEndMs = null }) {
  const stallMs = settings.stallMs, mergeGap = settings.mergeGapMs;
  const ignore = new Set((settings.ignoreGroups || []).map((g) => String(g).toLowerCase()));
  const sp = normalizeSpans(spans);
  const all = normalizeSamples(samples);
  const inSpan = (t) => sp.some((x) => t >= x.from && t < x.to);
  let droppedInSpan = 0;
  const ignored = {};
  const live = [];
  for (const s of all) {
    if (inSpan(s.atMs)) { droppedInSpan++; continue; }
    if ((s.fg.kind === 'in-scope' || s.fg.kind === 'system') && s.fg.group && ignore.has(String(s.fg.group).toLowerCase())) { ignored[s.fg.group] = (ignored[s.fg.group] || 0) + 1; continue; }
    live.push(s);
  }
  const solid = live.filter((s) => !s.helperLate);
  const late = live.filter((s) => s.helperLate);

  // cluster by start-to-start gap and foreground
  const clusters = [];
  for (const s of solid) {
    const c = clusters[clusters.length - 1];
    if (c && fgKey(c.fg) === fgKey(s.fg) && s.atMs - c.items[c.items.length - 1].atMs <= mergeGap + MERGE_JITTER_MS) c.items.push(s);
    else clusters.push({ fg: s.fg, items: [s] });
  }
  const episodes = [];
  let blips = 0;
  for (const c of clusters) {
    const worst = Math.max(...c.items.map((x) => x.latencyMs));
    if (c.items.length >= 2 || worst >= 2 * stallMs) episodes.push({ fg: c.fg, items: c.items.slice() });
    else blips++;
  }
  // late-tagged samples never form an episode alone; they stay referenced when they touch one
  let helperLateSamples = 0;
  for (const s of late) {
    const ep = episodes.find((e) => s.atMs >= e.items[0].atMs - mergeGap - MERGE_JITTER_MS && s.atMs <= e.items[e.items.length - 1].atMs + mergeGap + MERGE_JITTER_MS && fgKey(e.fg) === fgKey(s.fg));
    if (ep) { ep.items.push(s); ep.items.sort((a, b) => a.atMs - b.atMs); ep.hasLate = true; } else helperLateSamples++;
  }
  const out = episodes.map((e, i) => {
    const first = e.items[0], last = e.items[e.items.length - 1];
    let endMs = Math.max(...e.items.map((x) => x.atMs + x.latencyMs));
    let endReason = last.timeout ? 'unanswered' : 'answered';
    const cut = sp.find((x) => x.from >= first.atMs && x.from - endMs <= mergeGap);
    if (cut) { endMs = Math.min(endMs, cut.from); endReason = `not-evaluable:${cut.reason}`; }
    else if (runEndMs !== null && runEndMs - endMs <= mergeGap) endReason = 'run-end';
    const guards = e.hasLate ? ['helper-late'] : [];
    return {
      id: `ep${i + 1}`, startMs: first.atMs, endMs, durationMs: Math.max(0, endMs - first.atMs),
      worstLatencyMs: Math.max(...e.items.map((x) => x.latencyMs)), samples: e.items.length, sampleRefs: e.items.map((x) => x.ref),
      timeouts: e.items.filter((x) => x.timeout).length, foreground: { kind: e.fg.kind, group: e.fg.group || null }, endReason, guards,
    };
  });
  return { episodes: out, blips, ignored, helperLateSamples, droppedInSpan };
}

// evaluated / idle / not-evaluable / observed milliseconds from the window records (helper time accounting)
function evaluable({ windows, spans }) {
  const w = windows || [];
  const sum = (k) => w.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  return {
    observedMs: sum('durMs'), evaluatedMs: sum('evalMs'), idleMs: sum('idleMs'), notEvaluableMs: sum('skipMs'),
    measured: sum('measured'), windows: w.length,
    notEvaluable: normalizeSpans(spans).map((s) => ({ fromMs: s.from, toMs: s.to, durationMs: s.to - s.from, reason: s.reason })),
  };
}

// absolute input-recent (evaluated) intervals from window records: active spans are offsets from the window start
function activeIntervals(windows) {
  const out = [];
  for (const w of windows || []) {
    const base = ms(w.from);
    if (base === null) continue;
    for (const a of w.active || []) if (Array.isArray(a) && a.length === 2) out.push({ fromMs: base + a[0], toMs: base + a[1] });
  }
  return out.sort((a, b) => a.fromMs - b.fromMs);
}

module.exports = { buildEpisodes, evaluable, activeIntervals, normalizeSamples, normalizeSpans, MERGE_JITTER_MS, ms, fgKey };
