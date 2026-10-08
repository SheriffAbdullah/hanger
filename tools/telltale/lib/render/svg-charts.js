'use strict';
// Inline-SVG small-multiple charts on ONE wall-clock axis (report-views "Signal charts on one wall-clock axis").
// No script, no external reference: every series is drawn into the markup at render time, so a printed or
// PDF copy contains the charts. Reads the extraction from ./series; invents nothing.
const { esc, n2 } = require('./format');
const { clock, offsetLabel } = require('./series');
const inputStateText = (A) => (A.inputStatus === 'not-requested' ? 'the input-response check was turned off by the user' : A.inputStatus === 'absent' ? 'the input-response check was not available (report predates the input-response check)' : `the input-response check was not available (${A.inputReason || 'no reason recorded'})`);

const W = 720, ML = 74, MR = 12, PW = W - ML - MR;
const TOP = 28, SUB_H = 70, GAP = 26, AXIS_H = 22, PH_H = 22;
const MAX_POINTS = 2000, MAX_TABLE_ROWS = 240;
const COLORS = ['#1f3a5f', '#b3261e', '#2e6b34', '#8a5a00', '#5e35b1', '#455a64'];
const DASHES = ['', '6 3', '2 2', '8 3 2 3', '', '4 2'];

// min/max envelope per bucket keeps spikes; first and last points are always kept
function downsample(pts, max = MAX_POINTS) {
  const valid = pts.length;
  if (valid <= max) return { pts, from: valid, to: valid };
  const out = [pts[0]];
  const buckets = Math.floor((max - 2) / 2);
  const size = (valid - 2) / buckets;
  for (let b = 0; b < buckets; b++) {
    const lo = 1 + Math.floor(b * size), hi = Math.min(valid - 1, 1 + Math.floor((b + 1) * size));
    let mn = null, mx = null;
    for (let i = lo; i < hi; i++) { const p = pts[i]; if (p.v === null) continue; if (!mn || p.v < mn.v) mn = p; if (!mx || p.v > mx.v) mx = p; }
    const pair = [mn, mx].filter(Boolean).sort((a, b2) => a.t - b2.t);
    for (const p of pair) if (out[out.length - 1] !== p) out.push(p);
  }
  out.push(pts[valid - 1]);
  return { pts: out, from: valid, to: out.length };
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / e;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return m * e;
}
const tick = (v) => { const n = Number(v); if (!Number.isFinite(n)) return ''; const a = Math.abs(n); return String(a >= 100 ? Math.round(n) : +n.toFixed(a >= 10 ? 1 : 2)); };

function sub({ id, title, unit, domain, series, kind = 'lines', hlines = [], note = null, reason = null, annotatePeak = false, placeholderLabel = null }) {
  return { id, title, unit, domain, series, kind, hlines, note, reason, annotatePeak, placeholderLabel };
}

function autoDomain(series, lo0 = 0, pad = 1.1, floorHi = 1) {
  let mx = -Infinity;
  for (const s of series) for (const p of s.pts) if (p.v !== null && p.v > mx) mx = p.v;
  if (!Number.isFinite(mx)) return [lo0, floorHi];
  return [lo0, niceMax(Math.max(mx * pad, floorHi))];
}
const mk = (id, label, col, extra = {}) => ({ id, label, pts: col.pts, n: col.n, src: col.src, ...extra });
const withData = (list) => list.filter((s) => s.n > 0);

// Which panels exist and what each shows (design.md "Chart panels")
function planPanels(ex) {
  const S = ex.S, panels = [];
  const gpuFired = !!(ex.r.diagnosis && Array.isArray(ex.r.diagnosis.rollup) && ex.r.diagnosis.rollup.some((x) => x.class === 'gpu'));

  // 1 freeze strip
  const thr = ex.thresholdMs;
  const maxMs = S.probeMs.pts.reduce((a, p) => Math.max(a, p.v || 0), 0);
  panels.push({ id: 'freeze', title: 'Freeze strip', subs: [sub({
    id: 'probe', title: 'Hang-probe latency (ms)', unit: 'ms', kind: 'points',
    domain: [0, niceMax(Math.max((thr || 800) * 3, maxMs * 1.05))],
    series: S.probeMs.n ? [mk('probeMs', 'probe latency (ms)', S.probeMs, { thresholdMs: thr })] : [],
    hlines: thr ? [{ v: thr, label: `hang threshold ${n2(thr)} ms` }] : [],
    reason: S.probeMs.n ? null : (S.probeMs.reason || 'no probe latency was recorded'),
  })] });

  // 2 memory
  const memPct = withData([mk('ramUsed', 'RAM used (%)', S.ramUsed), mk('commit', 'commit (% of limit)', S.commit), mk('pagefile', 'pagefile use (%)', S.pagefile)]);
  const memSubs = [sub({ id: 'mem-pct', title: 'RAM used, commit, pagefile (%)', unit: '%', domain: [0, 100], series: memPct, reason: memPct.length ? null : (S.commit.reason || 'no memory percentages were recorded') })];
  const availS = withData([mk('avail', 'available memory (MB)', S.avail)]);
  memSubs.push(sub({ id: 'mem-avail', title: 'Available memory (MB)', unit: 'MB', domain: autoDomain(availS), series: availS, reason: availS.length ? null : (S.avail.reason || 'available memory was not recorded') }));
  const pg = withData([mk('pagesIn', 'pages in (/s)', S.pagesIn), mk('pagesOut', 'pages out (/s)', S.pagesOut)]);
  memSubs.push(sub({ id: 'mem-pages', title: 'Pages in and out (pages/s)', unit: 'pages/s', domain: autoDomain(pg, 0, 1.1, 10), series: pg, annotatePeak: true, reason: pg.length ? null : (S.pagesIn.reason || 'paging counters were not recorded') }));
  panels.push({ id: 'memory', title: 'Memory', subs: memSubs });

  // 3 CPU
  const cpuPct = withData([mk('cpu', 'total CPU (%)', S.cpu), mk('defender', 'security-software CPU (% of machine)', S.defender), mk('dpcIntr', 'DPC + interrupt (%)', S.dpcIntr)]);
  const qS = withData([mk('queue', 'run queue per logical CPU', S.queue)]);
  panels.push({ id: 'cpu', title: 'CPU', subs: [
    sub({ id: 'cpu-pct', title: 'Total CPU, security software, DPC + interrupt (%)', unit: '%', domain: [0, 100], series: cpuPct, reason: cpuPct.length ? null : (S.cpu.reason || 'CPU counters were not recorded') }),
    sub({ id: 'cpu-queue', title: 'Run queue per logical CPU (count)', unit: 'count', domain: autoDomain(qS, 0, 1.1, 2), series: qS, reason: qS.length ? null : (S.queue.reason || 'run queue was not recorded') }),
  ] });

  // 4 clock / thermal / power
  const perf = withData([mk('perf', 'performance (% of base)', S.perf), mk('perfLimit', 'performance limit (%)', S.perfLimit)]);
  const pfHi = Math.max(150, ...perf.flatMap((s) => s.pts.map((p) => p.v || 0)));
  const subs4 = [sub({ id: 'clock', title: 'Clock: performance and limit (% of base clock)', unit: '% of base', domain: [0, niceMax(pfHi)], series: perf, reason: perf.length ? null : (S.perf.reason || 'clock counters were not recorded') })];
  const zs = S.zones.filter((z) => z.n > 0);
  const pick = (zs.some((z) => z.role === 'cpu' || z.role === 'gpu') ? zs.filter((z) => z.role === 'cpu' || z.role === 'gpu') : zs.sort((a, b) => b.max - a.max).slice(0, 4));
  if (pick.length) subs4.push(sub({ id: 'temp', title: 'Temperature by labelled zone (C)', unit: 'C', domain: [0, 110], series: pick.map((z) => ({ id: `zone-${z.label}`, label: `${z.label} (${z.role})`, pts: z.pts, n: z.n, src: S.zonesSrc })) }));
  else subs4.push(sub({ id: 'temp', title: 'Temperature (C)', unit: 'C', domain: [0, 110], series: [], reason: S.zonesReason || 'no temperature zone was recorded', placeholderLabel: 'Temperature' }));
  if (S.hasBattery === false) subs4.push(sub({ id: 'battery', title: 'Battery (%)', unit: '%', domain: [0, 100], series: [], reason: 'no battery is present', placeholderLabel: 'Battery' }));
  else {
    const b = withData([mk('battery', 'battery (%)', S.battery)]);
    subs4.push(sub({ id: 'battery', title: 'Battery (%)', unit: '%', domain: [0, 100], series: b, reason: b.length ? null : (S.battery.reason || 'battery level was not recorded'), placeholderLabel: 'Battery' }));
  }
  panels.push({ id: 'clock-thermal-power', title: 'Clock / thermal / power', subs: subs4 });

  // 5 disk
  const dl = withData([mk('diskLat', 'latency (ms)', S.diskLat)]);
  const dq = withData([mk('diskQ', 'queue length', S.diskQ)]);
  const db = withData([mk('diskBusy', 'busy (%)', S.diskBusy)]);
  const dt = withData([mk('diskTput', 'throughput (MB/s)', S.diskTput)]);
  panels.push({ id: 'disk', title: 'Disk', subs: [
    sub({ id: 'disk-lat', title: 'Disk latency (ms)', unit: 'ms', domain: autoDomain(dl, 0, 1.1, 10), series: dl, reason: dl.length ? null : (S.diskLat.reason || 'disk latency was not recorded'), placeholderLabel: 'Disk latency' }),
    sub({ id: 'disk-queue', title: 'Disk queue length (count)', unit: 'count', domain: autoDomain(dq, 0, 1.1, 2), series: dq, reason: dq.length ? null : (S.diskQ.reason || 'disk queue was not recorded'), placeholderLabel: 'Disk queue' }),
    sub({ id: 'disk-busy', title: 'Disk busy (%)', unit: '%', domain: [0, 100], series: db, reason: db.length ? null : (S.diskBusy.reason || 'disk busy time was not recorded'), placeholderLabel: 'Disk busy' }),
    sub({ id: 'disk-tput', title: 'Disk throughput (MB/s)', unit: 'MB/s', domain: autoDomain(dt, 0, 1.1, 1), series: dt, reason: dt.length ? null : (S.diskTput.reason || 'disk throughput was not recorded'), placeholderLabel: 'Disk throughput' }),
  ] });

  // 6 GPU (only when data exists or a GPU rule fired)
  const gu = withData([mk('gpuUtil', 'utilization (%)', S.gpuUtil)]);
  const gv = withData([mk('gpuVram', 'dedicated memory used (MB)', S.gpuVram)]);
  if (gu.length || gv.length || gpuFired) {
    panels.push({ id: 'gpu', title: 'GPU', subs: [
      sub({ id: 'gpu-util', title: 'GPU utilization (%)', unit: '%', domain: [0, 100], series: gu, reason: gu.length ? null : (S.gpuUtil.reason || 'GPU utilization was not recorded'), placeholderLabel: 'GPU utilization' }),
      sub({ id: 'gpu-vram', title: 'GPU dedicated memory (MB)', unit: 'MB', domain: autoDomain(gv), series: gv, reason: gv.length ? null : (S.gpuVram.reason || 'GPU memory was not recorded'), placeholderLabel: 'GPU memory' }),
    ] });
  }

  // 7 top in-scope processes (stacked) + the anonymous outside-scope aggregate
  const P = S.procs;
  const ramMB = (ex.r.machine && ex.r.machine.totalGB) ? Math.round(ex.r.machine.totalGB * 1024) : null;
  if (P.ticks.length) {
    const layers = P.top.map((name) => ({ id: `proc-${name}`, label: `${name}${P.observerGroups.includes(name) ? ' (includes this tool)' : ''}`, pts: P.ticks.map((tk) => ({ t: tk.t, v: tk.g[name] ? tk.g[name].v : 0 })), n: P.ticks.length, src: P.src }));
    if (P.hasOutAgg) layers.push({ id: 'proc-outside', label: 'load outside the declared scope (aggregate)', pts: P.ticks.map((tk) => ({ t: tk.t, v: tk.out === null ? 0 : tk.out })), n: P.ticks.length, src: P.src, outside: true });
    const stackMax = Math.max(...P.ticks.map((tk) => P.top.reduce((a, nme) => a + (tk.g[nme] ? tk.g[nme].v : 0), 0) + (tk.out || 0)), 1);
    panels.push({ id: 'processes', title: 'Top in-scope processes', subs: [sub({ id: 'proc-stack', title: 'Working set of the top in-scope groups (MB, stacked)', unit: 'MB', kind: 'stack', domain: [0, ramMB && ramMB >= stackMax ? ramMB : niceMax(stackMax * 1.05)], series: layers,
      note: `Top ${P.top.length} monitored groups by peak working set${P.omittedGroups ? `; ${P.omittedGroups} smaller monitored group(s) are not stacked` : ''}. Axis runs to the installed RAM${ramMB ? ` (${n2(ramMB)} MB)` : ''}.` })] });
  } else {
    panels.push({ id: 'processes', title: 'Top in-scope processes', subs: [sub({ id: 'proc-stack', title: 'Working set of the top in-scope groups (MB, stacked)', unit: 'MB', kind: 'stack', domain: [0, 1], series: [], reason: 'no per-process series was recorded in this file', placeholderLabel: 'Per-process memory' })] });
  }

  // 8 standby / modified (only when data exists)
  const sb = withData([mk('standby', 'standby cache (MB)', S.standby), mk('modified', 'modified list (MB)', S.modified)]);
  if (sb.length) panels.push({ id: 'standby', title: 'Standby / modified', subs: [sub({ id: 'standby', title: 'Standby and modified memory (MB)', unit: 'MB', domain: autoDomain(sb), series: sb })] });
  return panels;
}

// ---- drawing ----
function renderPanel(ex, panel) {
  const { t0, t1 } = ex.domain, off = ex.off;
  const A = ex.annotations;
  const x = (t) => +(ML + ((Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0)) * PW).toFixed(1);
  const subs = panel.subs;
  const subBlockH = (s) => (s.series.length || s.kind === 'stack' && s.series.length ? SUB_H : 26);
  let y = TOP;
  const geo = subs.map((s) => { const h = s.series.length ? SUB_H : 26; const g = { y0: y + GAP, h }; y += GAP + h; return g; });
  const stallRow = panel.id === 'freeze' && (A.stalls || []).length > 0;
  const H = y + AXIS_H + (stallRow ? 14 : 0);
  const uid = `${panel.id}`;
  const parts = [];
  let down = null;

  // underlay: battery periods, hang windows, unobserved intervals (behind the series)
  const under = [];
  for (const p of A.power) if (p.state === 'battery') under.push(`<rect class="power-battery" x="${x(p.t0)}" y="${TOP}" width="${Math.max(1, x(p.t1) - x(p.t0)).toFixed(1)}" height="${H - TOP - AXIS_H}" fill="#e3ebf6"><title>on battery</title></rect>`);
  for (const u of A.unobserved) under.push(`<rect class="unobserved" x="${x(u.t0)}" y="${TOP}" width="${Math.max(2, x(u.t1) - x(u.t0)).toFixed(1)}" height="${H - TOP - AXIS_H}" fill="url(#hatch-${uid})"><title>unobserved${u.reason ? `: ${esc(u.reason)}` : ''}</title></rect>`);
  for (const h of A.hangs) under.push(`<rect class="hang-band" data-hang="${h.i}" x="${x(h.t0)}" y="${TOP}" width="${Math.max(2.5, x(h.t1) - x(h.t0)).toFixed(1)}" height="${H - TOP - AXIS_H}" fill="#d32f2f" fill-opacity="0.2"><title>freeze H${h.i}: ${n2(h.ms)} ms at ${clock(h.t0, off)}</title></rect>`);

  // automatically detected input-response stalls: hatched amber bands, distinct from the solid red freeze bands
  for (const st of A.stalls || []) under.push(`<rect class="stall-band" data-stall="${st.i}" x="${x(st.t0)}" y="${TOP}" width="${Math.max(2.5, x(st.t1) - x(st.t0)).toFixed(1)}" height="${H - TOP - AXIS_H}" fill="url(#stall-${uid})" stroke="#8a5a00" stroke-width="0.6"><title>input-response stall S${st.i}: ${n2((st.t1 - st.t0))} ms at ${clock(st.t0, off)}</title></rect>`);

  const body = [];
  subs.forEach((s, k) => {
    const g = geo[k];
    const yy = (v) => +(g.y0 + g.h - ((Math.min(Math.max(v, s.domain[0]), s.domain[1]) - s.domain[0]) / ((s.domain[1] - s.domain[0]) || 1)) * g.h).toFixed(1);
    const unitAttr = esc(s.unit || '');
    body.push(`<g class="subplot" data-sub="${esc(s.id)}" data-unit="${unitAttr}" data-domain="${s.domain[0]},${s.domain[1]}">`);
    body.push(`<text class="axis-title" x="${ML}" y="${g.y0 - 8}" font-size="10" font-weight="bold">${esc(s.title)}</text>`);
    if (!s.series.length) {
      body.push(`<rect x="${ML}" y="${g.y0}" width="${PW}" height="${g.h}" fill="none" stroke="#999" stroke-dasharray="3 3"/>`);
      body.push(`<text class="placeholder" x="${ML + 8}" y="${g.y0 + 16}" font-size="10">${esc(`${s.placeholderLabel || s.title}: not available (${s.reason || 'no data recorded'})`)}</text>`);
      body.push('</g>');
      return;
    }
    // frame, grid and y ticks
    body.push(`<rect class="plot" x="${ML}" y="${g.y0}" width="${PW}" height="${g.h}" fill="none" stroke="#555" stroke-width="0.8"/>`);
    const mid = (s.domain[0] + s.domain[1]) / 2;
    for (const v of [s.domain[0], mid, s.domain[1]]) {
      body.push(`<line x1="${ML}" y1="${yy(v)}" x2="${ML + PW}" y2="${yy(v)}" stroke="#ccc" stroke-width="0.5"/>`);
      body.push(`<text class="tick y" x="${ML - 5}" y="${yy(v) + 3}" font-size="9" text-anchor="end">${tick(v)}</text>`);
    }
    for (const hl of s.hlines) {
      body.push(`<line class="threshold" x1="${ML}" y1="${yy(hl.v)}" x2="${ML + PW}" y2="${yy(hl.v)}" stroke="#b3261e" stroke-width="1" stroke-dasharray="5 3"/>`);
      body.push(`<text class="threshold-label" x="${ML + PW - 3}" y="${yy(hl.v) - 3}" font-size="9" text-anchor="end" fill="#b3261e">${esc(hl.label)}</text>`);
    }
    if (s.kind === 'stack') {
      const ticks = s.series[0].pts.map((p) => p.t);
      const cum = ticks.map(() => 0);
      s.series.forEach((ser, li) => {
        const lower = cum.slice();
        ser.pts.forEach((p, i) => { cum[i] += p.v || 0; });
        const fwd = ticks.map((t, i) => `${x(t)} ${yy(cum[i])}`);
        const back = ticks.map((t, i) => `${x(t)} ${yy(lower[i])}`).reverse();
        const outside = ser.outside;
        const fill = outside ? '#999' : COLORS[li % COLORS.length];
        body.push(`<path class="layer${outside ? ' layer-outside' : ''}" data-layer="${esc(ser.label)}" d="M${fwd.join(' L')} L${back.join(' L')} Z" fill="${fill}" fill-opacity="${outside ? 0.55 : 0.7}" stroke="${fill}" stroke-width="0.6"${outside ? ' stroke-dasharray="3 2"' : ''}/>`);
      });
    } else {
      s.series.forEach((ser, li) => {
        const ds = downsample(ser.pts);
        if (ds.from !== ds.to) down = down ? { from: Math.max(down.from, ds.from), to: Math.max(down.to, ds.to) } : ds;
        const color = COLORS[li % COLORS.length], dash = DASHES[li % DASHES.length];
        if (s.kind === 'points') {
          body.push(`<path class="series s-${esc(ser.id)}" d="${pathD(ds.pts, x, yy, A.unobserved)}" fill="none" stroke="${color}" stroke-width="0.8" stroke-opacity="0.6"/>`);
          for (const p of ds.pts) if (p.v !== null) {
            const hang = ser.thresholdMs && p.v >= ser.thresholdMs;
            body.push(`<circle class="probe${hang ? ' probe-hang' : ''}" cx="${x(p.t)}" cy="${yy(p.v)}" r="${hang ? 3.6 : 2}" fill="${hang ? '#b3261e' : color}"/>`);
          }
        } else {
          body.push(`<path class="series s-${esc(ser.id)}" d="${pathD(ds.pts, x, yy, A.unobserved)}" fill="none" stroke="${color}" stroke-width="1.4"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
          if (ser.n <= 40) for (const p of ds.pts) if (p.v !== null) body.push(`<circle cx="${x(p.t)}" cy="${yy(p.v)}" r="1.6" fill="${color}"/>`);
        }
        if (s.annotatePeak) {
          let mx = null; const vals = ser.pts.filter((p) => p.v !== null).map((p) => p.v).sort((a, b) => a - b);
          for (const p of ser.pts) if (p.v !== null && (!mx || p.v > mx.v)) mx = p;
          const med = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
          if (mx && mx.v >= 100 && mx.v > med * 3) body.push(`<text class="peak-note" x="${Math.min(x(mx.t), ML + PW - 4)}" y="${Math.max(g.y0 + 9, yy(mx.v) + 9)}" font-size="9" text-anchor="${x(mx.t) > ML + PW * 0.7 ? 'end' : 'start'}">peak ${tick(mx.v)}/s at ${clock(mx.t, off)}</text>`);
        }
      });
    }
    body.push('</g>');
  });

  // top overlays: marks, OS-confirmed triangles, phases, lifecycle markers, AC/battery boundary
  const over = [];
  const bottom = H - AXIS_H;
  const phaseRows = [];
  for (const ph of A.phases) {
    const x0 = x(ph.t0), x1 = x(ph.t1);
    phaseRows.push(`<g class="phase"><rect x="${x0}" y="2" width="${Math.max(2, x1 - x0).toFixed(1)}" height="${PH_H - 6}" fill="#b0bec5" fill-opacity="0.7" stroke="#455a64" stroke-width="0.6"/><text x="${x0 + 3}" y="${PH_H - 9}" font-size="9">${esc(ph.label)}${ph.open ? ' (open)' : ''}</text><line x1="${x0}" y1="${TOP}" x2="${x0}" y2="${bottom}" stroke="#455a64" stroke-width="0.6" stroke-dasharray="1 3"/></g>`);
  }
  over.push(...phaseRows);
  for (const m of A.markers) over.push(`<g class="lifecycle"><line x1="${x(m.t)}" y1="${PH_H - 6}" x2="${x(m.t)}" y2="${bottom}" stroke="#2e6b34" stroke-width="1"/><text x="${x(m.t) + 2}" y="${PH_H + 3}" font-size="8" fill="#2e6b34">${esc(`${m.kind.replace('container-', 'container ').replace('process-', 'process ')}: ${m.name}`)}</text></g>`);
  for (const m of A.marks) over.push(`<line class="user-mark" x1="${x(m.t)}" y1="${TOP}" x2="${x(m.t)}" y2="${bottom}" stroke="#000" stroke-width="1.1" stroke-dasharray="4 3"><title>your mark${m.kind ? ` (${esc(m.kind)})` : ''} at ${clock(m.t, off)}</title></line>`);
  for (const o of A.osConfirmed) over.push(`<path class="os-confirmed" d="M${x(o.t) - 4} ${TOP - 1} L${x(o.t) + 4} ${TOP - 1} L${x(o.t)} ${TOP + 7} Z" fill="#000"><title>confirmed by Windows (H${o.i})</title></path>`);
  for (const b of A.boundaries) over.push(`<line class="ac-batt-boundary" x1="${x(b.t)}" y1="${TOP}" x2="${x(b.t)}" y2="${bottom}" stroke="#1f3a5f" stroke-width="1.2" stroke-dasharray="1 2"><title>${b.from} to ${b.to} at ${clock(b.t, off)}</title></line>`);

  // x axis ticks (wall clock)
  const axis = [];
  for (let i = 0; i <= 4; i++) {
    const t = t0 + ((t1 - t0) * i) / 4;
    axis.push(`<line x1="${x(t)}" y1="${bottom}" x2="${x(t)}" y2="${bottom + 4}" stroke="#555"/><text class="tick x" x="${x(t)}" y="${bottom + 15}" font-size="9" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${clock(t, off)}</text>`);
  }
  // the freeze-strip panel also shows the stalls as their own row under the strip
  if (stallRow) {
    const ry = y + 3;
    over.push(`<g class="stall-row"><text x="${ML - 5}" y="${ry + 8}" font-size="8" text-anchor="end">stalls</text>${A.stalls.map((st) => `<rect class="stall-row-band" x="${x(st.t0)}" y="${ry}" width="${Math.max(2.5, x(st.t1) - x(st.t0)).toFixed(1)}" height="8" fill="url(#stall-${uid})" stroke="#8a5a00" stroke-width="0.6"/>`).join('')}</g>`);
  }
  const svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(panel.title)} chart" data-x0="${t0}" data-x1="${t1}" font-family="Arial, Helvetica, sans-serif">`
    + `<defs><pattern id="stall-${uid}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="5" height="5" fill="#ffe0a3" fill-opacity="0.55"/><line x1="0" y1="0" x2="0" y2="5" stroke="#8a5a00" stroke-width="1.6"/></pattern><pattern id="hatch-${uid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#777" stroke-width="1.5"/></pattern></defs>`
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`
    + `<g class="underlay">${under.join('')}</g>${body.join('')}<g class="overlays">${over.join('')}</g><g class="x-axis">${axis.join('')}</g></svg>`;
  void subBlockH; void parts;
  return { svg, down };
}

function pathD(pts, x, y, unobserved) {
  let d = '', pen = false, prev = null;
  for (const p of pts) {
    if (p.v === null) { pen = false; prev = null; continue; }
    if (pen && prev && unobserved.some((u) => u.t0 < p.t && u.t1 > prev.t)) pen = false;
    d += `${pen ? 'L' : 'M'}${x(p.t)} ${y(p.v)} `;
    pen = true; prev = p;
  }
  return d.trim();
}

function dataTable(panel, off) {
  const cols = [];
  for (const s of panel.subs) for (const ser of s.series) cols.push({ ser, unit: s.unit });
  if (!cols.length) return '';
  const times = new Set();
  for (const c of cols) for (const p of c.ser.pts) if (p.v !== null) times.add(p.t);
  let ts = [...times].sort((a, b) => a - b);
  const total = ts.length;
  if (ts.length > MAX_TABLE_ROWS) { const step = ts.length / MAX_TABLE_ROWS; ts = Array.from({ length: MAX_TABLE_ROWS }, (_, i) => ts[Math.floor(i * step)]); }
  const maps = cols.map((c) => new Map(c.ser.pts.map((p) => [p.t, p.v])));
  const head = `<tr><th>time</th>${cols.map((c) => `<th>${esc(c.ser.label)}</th>`).join('')}</tr>`;
  const rows = ts.map((t) => `<tr><td>${clock(t, off)}</td>${maps.map((m) => { const v = m.get(t); return `<td class="r">${v === undefined || v === null ? '-' : n2(v)}</td>`; }).join('')}</tr>`).join('');
  return `<details class="datatable"><summary>Data table: ${total} time points${total > ts.length ? `, ${ts.length} shown` : ''}</summary><table class="dt"><thead>${head}</thead><tbody>${rows}</tbody></table></details>`;
}

function legendHtml(panel) {
  const items = [];
  for (const s of panel.subs) {
    s.series.forEach((ser, li) => {
      const color = s.kind === 'stack' ? (ser.outside ? '#999' : COLORS[li % COLORS.length]) : COLORS[li % COLORS.length];
      const dash = DASHES[li % DASHES.length];
      items.push(`<li><svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="${color}" stroke-width="${s.kind === 'stack' ? 6 : 2}"${dash && s.kind !== 'stack' ? ` stroke-dasharray="${dash}"` : ''}/></svg> ${esc(ser.label)} <span class="n">n=${ser.n}</span></li>`);
    });
  }
  return items.length ? `<ul class="legend">${items.join('')}</ul>` : '';
}

function captionText(ex, panel, down) {
  const A = ex.domain, off = ex.off;
  const ns = []; const srcs = new Set();
  for (const s of panel.subs) for (const ser of s.series) { ns.push(ser.n); if (ser.src) srcs.add(String(ser.src).replace(/@.*$/, '')); }
  const nMax = ns.length ? Math.max(...ns) : 0;
  const srcTxt = srcs.size ? [...srcs].slice(0, 4).join(', ') : 'not recorded';
  return `${panel.title} - n=${nMax} samples, window ${clock(A.t0, off)}-${clock(A.t1, off)} ${offsetLabel(off)}, source ${srcTxt}${down ? `; downsampled from ${down.from} to ${down.to} points (min/max kept)` : ''}`;
}

// all panels as one HTML fragment, preceded by one overlay key
function renderCharts(ex) {
  const plan = planPanels(ex);
  const A = ex.annotations, off = ex.off;
  const keyBits = [];
  if (A.hangs.length) keyBits.push(`red bands = freezes (${A.hangs.map((h) => `H${h.i} ${clock(h.t0, off)} ${n2(h.ms)} ms`).join('; ')})`);
  if (A.inputStatus === 'running') keyBits.push(`hatched bands = automatically detected input-response stalls${A.stalls.length ? ` (${A.stalls.map((st) => `S${st.i} ${clock(st.t0, off)}`).join('; ')})` : ' (none detected in the evaluated time)'}`);
  else keyBits.push(inputStateText(A));
  if (A.marks.length) keyBits.push('dashed black lines = your marks');
  if (A.osConfirmed.length) keyBits.push('black triangles = confirmed by Windows');
  if (A.phases.length) keyBits.push('labelled bars at the top = workload phases');
  if (A.markers.length) keyBits.push('green lines = workload start/stop events');
  if (A.power.some((p) => p.state === 'battery')) keyBits.push('blue-gray background = on battery');
  if (A.unobserved.length) keyBits.push('hatched = not observed');
  const key = `<p class="chartkey"><strong>How to read the charts:</strong> every chart shares one clock (${offsetLabel(off)}, ${clock(ex.domain.t0, off)} to ${clock(ex.domain.t1, off)}). ${keyBits.length ? keyBits.join('; ') + '.' : 'No freezes, marks, phases or power changes were recorded in this run.'}</p>`;
  const panels = plan.map((p) => {
    const { svg, down } = renderPanel(ex, p);
    return { id: p.id, title: p.title, html: `<figure class="chart panel" data-panel="${esc(p.id)}"><h3 class="panel-title">${esc(p.title)}</h3>${svg}<figcaption class="caption">${esc(captionText(ex, p, down))}</figcaption>${legendHtml(p)}${(p.subs.find((s) => s.note) || {}).note ? `<p class="note">${esc(p.subs.find((s) => s.note).note)}</p>` : ''}${dataTable(p, off)}</figure>` };
  });
  return { key, panels, html: key + panels.map((p) => p.html).join('\n') };
}

module.exports = { renderCharts, planPanels, downsample, niceMax, MAX_POINTS };
