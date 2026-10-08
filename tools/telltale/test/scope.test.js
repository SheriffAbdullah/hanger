'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const S = require('../lib/scope');
const { renderAll } = require('../lib/render');
const base = require('./fixtures/sample-r03.json');

const TELLTALE = path.join(__dirname, '..', 'telltale.js');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tt-scope-'));
const mk = (entries) => S.createMatcher(entries);
const row = (name, pid, memMB, extra = {}) => ({ name, pid, memMB, ...extra });

// ---------- 1.1 scope file ----------
test('valid scope file loads with provenance and a sha256 of the file bytes', () => {
  const d = tmpDir();
  const text = JSON.stringify({ version: 1, entries: [{ name: 'postgres', includeDescendants: false, note: 'local DB' }, { pattern: 'node*', enabled: true }] }, null, 2);
  fs.writeFileSync(path.join(d, 'telltale.scope.json'), text);
  const { decl } = S.loadScope({ cfg: {}, args: [], cwd: d });
  assert.strictEqual(decl.mode, 'allowlist');
  assert.strictEqual(decl.source, 'file');
  assert.strictEqual(decl.path, path.join(d, 'telltale.scope.json'));
  assert.strictEqual(decl.sha256, crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'));
  assert.deepStrictEqual(decl.entries.map((e) => e.name || e.pattern), ['postgres', 'node*']);
  assert.strictEqual(decl.statement, 'Names of software outside this scope were not recorded.');
});

test('invalid scope files stop the run naming the path and the key', () => {
  const d = tmpDir();
  const p = path.join(d, 'telltale.scope.json');
  fs.writeFileSync(p, JSON.stringify({ version: 1, entries: [{ name: 'postgres', regex: '^pg' }] }));
  assert.throws(() => S.loadScope({ cfg: {}, args: [], cwd: d }), (e) => e.exitCode === 2 && e.message.includes(p) && e.message.includes('regex'));
  fs.writeFileSync(p, JSON.stringify({ version: 1, entries: [{ name: 'a', pattern: 'b*' }] }));
  assert.throws(() => S.loadScope({ cfg: {}, args: [], cwd: d }), /exactly one of "name" or "pattern"/);
  fs.writeFileSync(p, JSON.stringify({ version: 1, entries: [{ pattern: 'a[0-9]*' }] }));
  assert.throws(() => S.loadScope({ cfg: {}, args: [], cwd: d }), /only \* and \?/);
  fs.writeFileSync(p, JSON.stringify({ version: 2, entries: [] }));
  assert.throws(() => S.loadScope({ cfg: {}, args: [], cwd: d }), /"version" must be 1/);
  fs.writeFileSync(p, '{ not json');
  assert.throws(() => S.loadScope({ cfg: {}, args: [], cwd: d }), /invalid JSON/);
});

test('--only is recorded as source flag; no scope at all is open scope; a template records its name', () => {
  const d = tmpDir();
  const f = S.loadScope({ cfg: {}, args: ['trace', '--only', 'postgres'], cwd: d });
  assert.strictEqual(f.decl.source, 'flag');
  assert.deepStrictEqual(f.decl.entries.map((e) => e.name), ['postgres']);
  const o = S.loadScope({ cfg: {}, args: ['trace'], cwd: d });
  assert.strictEqual(o.decl.mode, 'open');
  assert.match(o.decl.statement, /^OPEN SCOPE: names of all running software may appear in this report$/);
  const t = S.loadScope({ cfg: {}, args: ['trace', '--preset', 'dev'], cwd: d });
  assert.strictEqual(t.decl.source, 'template:dev');
});

test('dev template: node, docker executables, postgres, redis-server, chromium; never code or playwright', () => {
  const names = S.templateEntries('dev').map((e) => e.name);
  for (const n of ['node', 'postgres', 'redis-server', 'chromium']) assert.ok(names.includes(n), n);
  assert.ok(names.some((n) => /docker/.test(n)));
  assert.ok(!names.includes('code') && !names.includes('playwright'));
});

// ---------- 1.2 matcher ----------
test('entry "code" matches code.exe but not opencode.exe or claude.exe (friendly labels never match)', () => {
  const m = mk([{ name: 'code' }]);
  assert.ok(m.match('code.exe'));
  assert.ok(m.match('Code.EXE'));
  assert.ok(!m.match('opencode.exe'));
  assert.ok(!m.match('claude.exe'));
  const g = mk([{ pattern: 'node*' }]);
  assert.ok(g.match('node.exe') && g.match('nodemon.exe') && !g.match('xnode.exe'));
});

// ---------- 1.3 descendants ----------
test('descendants are in scope only when the entry opts in; PID reuse is not adopted; fallback is recorded', () => {
  const rows = [row('node.exe', 100, 50, { ppid: 1, ct: 1000 }), row('cmd.exe', 200, 5, { ppid: 100, ct: 1500 })];
  const off = S.createResolver(mk([{ name: 'node', includeDescendants: false }])).resolve(rows);
  assert.deepStrictEqual(off.inScope.map((g) => g.name), ['node.exe']);
  assert.strictEqual(off.share.outOfScope.processes, 1);

  const r = S.createResolver(mk([{ name: 'node', includeDescendants: true }]));
  const on = r.resolve(rows);
  assert.deepStrictEqual(on.inScope.map((g) => g.name).sort(), ['cmd.exe', 'node.exe']);

  // pid 200 is reused later by an unrelated process with a different creation time and a dead parent
  const later = r.resolve([row('node.exe', 100, 50, { ppid: 1, ct: 1000 }), row('unrelated.exe', 200, 9, { ppid: 777, ct: 9999 })]);
  assert.deepStrictEqual(later.inScope.map((g) => g.name), ['node.exe']);
  // a process whose parent pid is node's but which started BEFORE node did is a reused-ppid case
  const stale = r.resolve([row('node.exe', 100, 50, { ppid: 1, ct: 1000 }), row('old.exe', 300, 3, { ppid: 100, ct: 500 })]);
  assert.deepStrictEqual(stale.inScope.map((g) => g.name), ['node.exe']);

  // parent information unavailable: exact names only, never widened, fallback recorded with reason
  const fb = S.createResolver(mk([{ name: 'node', includeDescendants: true }]));
  const res = fb.resolve([row('node.exe', 100, 50), row('cmd.exe', 200, 5)]);
  assert.deepStrictEqual(res.inScope.map((g) => g.name), ['node.exe']);
  assert.strictEqual(fb.fallbacks.length, 1);
  assert.match(fb.fallbacks[0].reason, /parent information unavailable/);
  assert.ok(fb.fallbacks[0].at);
});

// ---------- 1.4 / 1.5 resolver ----------
test('resolve() totals: 3 in scope, 2 system, 5 out of scope', () => {
  const r = S.createResolver(mk([{ name: 'postgres' }, { name: 'redis-server' }]));
  const res = r.resolve([
    row('postgres.exe', 1, 100), row('postgres.exe', 2, 50), row('redis-server.exe', 3, 30),
    row('MsMpEng.exe', 4, 500), row('Memory Compression', 5, 700),
    row('a.exe', 6, 10), row('b.exe', 7, 20), row('b.exe', 8, 20), row('c.exe', 9, 30), row('d.exe', 10, 40),
  ], { measuredAt: new Date('2026-01-01T00:00:00Z') });
  assert.strictEqual(res.share.inScope.processes, 3);
  assert.strictEqual(res.share.inScope.memMB, 180);
  assert.strictEqual(res.share.inScope.groups, 2);
  assert.strictEqual(res.share.system.processes, 2);
  assert.strictEqual(res.share.system.memMB, 1200);
  assert.deepStrictEqual({ g: res.share.outOfScope.groups, p: res.share.outOfScope.processes, mb: res.share.outOfScope.memMB }, { g: 4, p: 5, mb: 120 });
  assert.strictEqual(res.share.outOfScope.cpuPctOfMachine, null);
  assert.strictEqual(res.share.outOfScope.cpuReason, 'per-process CPU not collected yet');
  assert.strictEqual(res.measuredAt, '2026-01-01T00:00:00.000Z');
  const agg = S.runAggregate(res);
  assert.strictEqual(agg.memMB, 120);
  assert.strictEqual(agg.inScope.memMB, 180);
  assert.strictEqual(agg.system.memMB, 1200);
  // out-of-scope identity is absent from the serialized structures
  assert.ok(!/a\.exe|b\.exe|c\.exe|d\.exe/.test(JSON.stringify([res.inScope, res.system, res.share, agg])));
});

test('writers accept only resolved structures: raw rows throw', () => {
  const raw = [row('postgres.exe', 1, 100)];
  assert.throws(() => S.rowsForJson(raw), /resolved/);
  assert.throws(() => S.rowsForConsole(raw), /resolved/);
  assert.throws(() => S.rowsForMarkdown(raw), /resolved/);
  assert.throws(() => S.hangSnapshot(raw), /resolved/);
  assert.throws(() => S.watchRow(raw), /resolved/);
  assert.throws(() => S.runAggregate(raw), /resolved/);
  const res = S.createResolver(mk([{ name: 'postgres' }])).resolve(raw);
  assert.doesNotThrow(() => S.rowsForJson(res));
});

test('open scope names everything except nothing is out of scope; system set is still categorised', () => {
  const r = S.createResolver(mk([]), { open: true });
  const res = r.resolve([row('whatever.exe', 1, 10), row('dwm.exe', 2, 20)]);
  assert.deepStrictEqual(res.inScope.map((g) => g.name), ['whatever.exe']);
  assert.deepStrictEqual(res.system.map((g) => g.name), ['dwm.exe']);
  assert.strictEqual(res.share.outOfScope.processes, 0);
});

test('system set: fixed, versioned, never user applications', () => {
  assert.strictEqual(S.SYSTEM_SET.listVersion, 1);
  assert.deepStrictEqual(Object.keys(S.SYSTEM_SET.categories), ['os', 'security', 'virtualization']);
  for (const n of ['MsMpEng.exe', 'Memory Compression', 'vmmem', 'svchost.exe', 'dwm.exe']) assert.ok(S.systemCategory(n), n);
  for (const n of ['chrome.exe', 'msedge.exe', 'node.exe', 'slack.exe', 'code.exe']) assert.strictEqual(S.systemCategory(n), null, n);
});

// ---------- 2.1 watch and trace agree ----------
test('watch line and trace snapshot builders see the same in-scope name set', () => {
  const rows = [row('postgres.exe', 1, 100), row('redis-server.exe', 2, 30), row('MsMpEng.exe', 3, 500), row('chrome.exe', 4, 900)];
  const r = S.createResolver(mk([{ name: 'postgres' }, { name: 'redis-server' }]));
  const w = S.watchRow(r.resolve(rows), 3).top.map((g) => g.name).sort();
  const t = S.hangSnapshot(r.resolve(rows)).culpritsAtHang.map((g) => g.name).sort();
  assert.deepStrictEqual(w, t);
  assert.ok(!w.includes('chrome.exe'));
});

// ---------- 2.2 on-hang snapshot within scope ----------
test('in-scope postgres ranked 5th overall is kept; no out-of-scope name in culpritsAtHang', () => {
  const rows = [row('big1.exe', 1, 900), row('big2.exe', 2, 800), row('big3.exe', 3, 700), row('big4.exe', 4, 600), row('postgres.exe', 5, 500), row('tiny.exe', 6, 1)];
  const res = S.createResolver(mk([{ name: 'postgres' }])).resolve(rows);
  const hs = S.hangSnapshot(res);
  assert.deepStrictEqual(hs.culpritsAtHang.map((c) => c.name), ['postgres.exe']);
  assert.ok(!/big\d|tiny/.test(JSON.stringify(hs)));
  assert.strictEqual(hs.scopeShare.inScope.memMB, 500);
  assert.strictEqual(hs.scopeShare.outOfScope.memMB, 3001);
  assert.ok(hs.scopeShare.measuredAt);
});

// ---------- 2.3 light path ----------
test('light path parser output resolved before truncation leaves no out-of-scope names', () => {
  const canned = 'secretapp|10|900\npostgres|11|50\nother|12|40\nnode|13|5\n';
  const rows = S.parseProcessList(canned, (pid) => String(pid) === '13');
  assert.strictEqual(rows.length, 3); // self pid 13 dropped, nothing truncated
  const res = S.createResolver(mk([{ name: 'postgres' }])).resolve(rows);
  const out = JSON.stringify(S.hangSnapshot(res));
  assert.ok(out.includes('postgres'));
  assert.ok(!/secretapp|other/.test(out));
});

// ---------- 2.4 not-responding ----------
test('not-responding list keeps in-scope and system names and counts the rest', () => {
  const r = S.createResolver(mk([{ name: 'postgres' }]));
  const f = r.filterNames(['Microsoft.Notes', 'postgres', 'MsMpEng']);
  assert.deepStrictEqual(f.kept, ['postgres', 'MsMpEng']);
  assert.strictEqual(f.outOfScopeCount, 1);
});

// ---------- 2.5 events ----------
test('event excerpts keep provider, id, time and in-scope matches; message text is dropped', () => {
  const r = S.createResolver(mk([{ name: 'postgres' }]));
  const recs = [{ at: '2026-01-01T00:00:00.000Z', id: 2004, provider: 'Microsoft-Windows-Resource-Exhaustion-Detector',
    message: 'Windows ran low on memory: zzsecret.exe (123) consumed 9000 bytes, postgres.exe (456) consumed 100' }];
  const out = S.sanitizeEventRecords(recs, r);
  const text = JSON.stringify(out);
  assert.ok(!/zzsecret/i.test(text));
  assert.ok(!('message' in out[0]));
  assert.deepStrictEqual(out[0].inScopeNames, ['postgres.exe']);
  assert.deepStrictEqual([out[0].provider, out[0].id, out[0].at], [recs[0].provider, 2004, recs[0].at]);
  // the same name is now masked from any later free text too
  assert.ok(!/zzsecret/i.test(r.scopeSafe('crash of zzsecret.exe seen')));
});

// ---------- 2.6 docker / WSL ----------
test('docker ps with two containers, one in scope, stores one name and a count', () => {
  const r = S.createResolver(mk([{ name: 'pg-main' }]));
  const rows = S.parseDockerPs('pg-main Up 2 hours\nsecret-web Up 5 minutes\n');
  assert.strictEqual(rows.length, 2);
  const res = S.resolveNamedRows(r, rows);
  assert.deepStrictEqual(res.kept.map((x) => x.name), ['pg-main']);
  assert.strictEqual(res.outOfScope, 1);
  assert.ok(!/secret-web/.test(JSON.stringify(res)));
  const st = S.parseDockerStats('pg-main|120MiB / 1GiB|3.5%\nsecret-web|10MiB / 1GiB|0.1%\n');
  assert.strictEqual(S.resolveNamedRows(r, st).kept.length, 1);
});

test('WSL distro list parses; docker-desktop is system set, other distros are counted', () => {
  const r = S.createResolver(mk([]));
  const rows = S.parseWslList('  NAME              STATE           VERSION\n* Ubuntu-private    Running         2\n  docker-desktop    Running         2\n');
  assert.deepStrictEqual(rows.map((x) => x.name), ['Ubuntu-private', 'docker-desktop']);
  const res = S.resolveNamedRows(r, rows);
  assert.deepStrictEqual(res.kept.map((x) => x.name), ['docker-desktop']);
  assert.strictEqual(res.outOfScope, 1);
});

// ---------- 2.7 GPU maps ----------
test('GPU PID maps keep allowed PIDs and aggregate the rest', () => {
  const map = { byPid: { 10: { pct: 5, n: 1 }, 11: { pct: 30, n: 2 }, 12: { pct: 1, n: 1 } }, n: 4, ms: 5 };
  const out = S.scrubPidMap(map, new Set(['10']), 'pct', (pid) => String(pid) === '12');
  assert.deepStrictEqual(Object.keys(out.byPid), ['10']);
  assert.deepStrictEqual(out.outOfScope, { pids: 1, pct: 30 });
});

// ---------- 2.8 console ----------
test('console text for a hang naming an out-of-scope process is guarded', () => {
  const r = S.createResolver(mk([{ name: 'postgres' }]));
  r.resolve([row('zzcanaryabc.exe', 1, 10), row('postgres.exe', 2, 5)]);
  const line = '  !! HANG 900ms at t+10s osConfirm=zzcanaryabc,postgres  top zzcanaryabc.exe 10MB';
  const safe = r.scopeSafe(line);
  assert.ok(!/zzcanaryabc/i.test(safe));
  assert.ok(/postgres/.test(safe));
  assert.ok(!/zzcanaryabc/i.test(JSON.stringify(r.guard({ a: [line], zzcanaryabc: 1 }))));
});

// ---------- 3.1 inventory ----------
test('inventory is non-shareable and drafts a scope with every entry disabled', () => {
  const inv = S.buildInventory([{ name: 'postgres.exe', totalMB: 400, n: 7 }, { name: 'dwm.exe', totalMB: 100, n: 1 }, { name: 'zz.exe', totalMB: 5, n: 1 }], { friendlyFn: (n) => n });
  assert.strictEqual(inv.shareable, false);
  assert.strictEqual(inv.groups.find((g) => g.name === 'dwm.exe').category, 'system');
  const draft = S.draftScopeFromInventory(inv);
  assert.strictEqual(draft.version, 1);
  assert.ok(draft.entries.length === 2 && draft.entries.every((e) => e.enabled === false));
  assert.doesNotThrow(() => S.validateScopeObject(draft, 'draft'));
});

test('inventory CLI writes exactly one file under private/', () => {
  const d = tmpDir();
  const r = spawnSync(process.execPath, [TELLTALE, 'inventory', '--out', d], { encoding: 'utf8', cwd: d, timeout: 120000 });
  assert.strictEqual(r.status, 0, r.stderr);
  const all = [];
  (function walk(p) { for (const e of fs.readdirSync(p, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(p, e.name)) : all.push(path.join(p, e.name))); })(d);
  assert.strictEqual(all.length, 1);
  assert.ok(/[\\/]private[\\/]inventory-.*\.json$/.test(all[0]));
  assert.strictEqual(JSON.parse(fs.readFileSync(all[0], 'utf8')).shareable, false);
});

// ---------- 3.2 private paths ----------
test('renderers and pack refuse paths under private/', () => {
  const d = tmpDir();
  fs.mkdirSync(path.join(d, 'private'));
  const p = path.join(d, 'private', 'inventory-x.json');
  fs.writeFileSync(p, JSON.stringify({ shareable: false, groups: [] }));
  assert.throws(() => S.assertShareablePath(p), (e) => e.message.includes(p));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'render-print.js'), p, path.join(d, 'x.html')], { encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0);
  assert.ok(r.stderr.includes(p), r.stderr);
  const pk = spawnSync(process.execPath, [TELLTALE, 'pack', p, '--out', d], { encoding: 'utf8', cwd: d, timeout: 120000 });
  assert.notStrictEqual(pk.status, 0);
  assert.ok(pk.stderr.includes(p), pk.stderr);
  assert.ok(!fs.readdirSync(d).some((f) => /^pack-/.test(f)));
  const flagged = path.join(d, 'plain.json');
  fs.writeFileSync(flagged, '{"shareable": false, "groups": []}');
  assert.throws(() => S.assertShareablePath(flagged), /shareable/);
});

// ---------- 3.4 declaration ----------
test('declaration shape and wording; no "never collected" anywhere in the tool source', () => {
  const { decl } = S.loadScope({ cfg: {}, args: ['trace', '--only', 'postgres'], cwd: tmpDir() });
  for (const k of ['mode', 'source', 'path', 'sha256', 'entries', 'matchRule', 'systemSet', 'counts', 'fallbacks', 'statement']) assert.ok(k in decl, k);
  assert.strictEqual(decl.systemSet.listVersion, 1);
  assert.deepStrictEqual(decl.systemSet.categories, ['os', 'security', 'virtualization']);
  const phrase = 'never' + ' collected';
  const hits = [];
  (function walk(p) {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) { if (e.name !== 'test' && e.name !== 'node_modules') walk(full); } else if (/\.(js|md|json|bat)$/.test(e.name) && fs.readFileSync(full, 'utf8').toLowerCase().includes(phrase)) hits.push(full);
    }
  })(path.join(__dirname, '..'));
  assert.deepStrictEqual(hits, []);
});

// ---------- 3.5 declaration leads every view ----------
test('Markdown and report HTML put the scope declaration before any per-process table', () => {
  const scoped = JSON.parse(JSON.stringify(base));
  scoped.scope = { ...S.loadScope({ cfg: {}, args: ['x', '--only', 'postgres'], cwd: tmpDir() }).decl, counts: { inScopeGroups: 1, systemGroups: 4, outOfScopeGroups: 90 } };
  scoped.outOfScope = { groups: 90, processes: 200, memMB: 6000, cpuPctOfMachine: null, inScope: { memMB: 400 }, system: { memMB: 900 }, measuredAt: 'x' };
  const f = { jsonName: 'x.json', htmlName: 'x.report.html', emailName: 'x.email.txt' };
  const out = renderAll(scoped, f);
  const md = out.md;
  assert.ok(md.indexOf('SCOPE') >= 0 && md.indexOf('SCOPE') < md.indexOf('Finding:'));
  assert.ok(md.indexOf('SCOPE') < md.indexOf('In-scope culprit table'));
  assert.match(md, /Names of software outside this scope were not recorded./);
  assert.match(md, /6000 MB/);
  const html = out.html;
  assert.ok(html.indexOf('class="banner') >= 0 && html.indexOf('class="banner') < html.indexOf('data-section="finding"'));
  assert.ok(html.indexOf('class="banner') < html.indexOf('In-scope culprit table'));

  const open = JSON.parse(JSON.stringify(base));
  open.scope = S.loadScope({ cfg: {}, args: ['x'], cwd: tmpDir() }).decl;
  const o = renderAll(open, f);
  assert.ok(o.md.indexOf('OPEN SCOPE: names of all running software may appear in this report') < o.md.indexOf('Finding:'));
  assert.match(o.html, /OPEN SCOPE: names of all running software may appear in this report/);
  assert.match(o.email, /OPEN SCOPE: names of all running software may appear in the attached report./);
});

// ---------- 3.6 retirement ----------
test('--hide / --focus / --extras exit 2 with a migration message; the committed config has none of them', () => {
  for (const flag of ['--hide', '--focus', '--extras']) {
    const r = spawnSync(process.execPath, [TELLTALE, 'trace', flag, 'claude'], { encoding: 'utf8', cwd: tmpDir(), timeout: 60000 });
    assert.strictEqual(r.status, 2, `${flag}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr + r.stdout, /telltale\.scope\.json/);
  }
  const d = tmpDir();
  const r = spawnSync(process.execPath, [TELLTALE, 'trace', '--hide', 'claude', '--out', d], { encoding: 'utf8', cwd: d, timeout: 60000 });
  assert.strictEqual(r.status, 2);
  assert.deepStrictEqual(fs.readdirSync(d), []);
  assert.strictEqual(S.findRetired(['trace'], { hide: 'claude' }).via, 'config');
  const cfg = require('../../../telltale.config.json');
  for (const k of ['hide', 'focus', 'extras']) assert.ok(!(k in cfg), k);
});

// ---------- 3.7 command lines ----------
test('node script label derived; the command line, secrets and paths never reach the output', () => {
  const cmd = 'node C:\\work\\api\\server.js --password=hunter2';
  const l = S.deriveLabel('node.exe', cmd, 'Node.js runtime');
  assert.deepStrictEqual(l, { label: 'Node: server.js', rule: 'node-script' });
  const res = S.createResolver(mk([{ name: 'node' }])).resolve([row('node.exe', 50, 80)]);
  const rows = S.rowsForJson(res, { labeler: (g) => S.deriveLabel(g.name, cmd, 'Node.js runtime') });
  const text = JSON.stringify(rows);
  assert.ok(text.includes('Node: server.js') && text.includes('node-script'));
  assert.ok(!/hunter2|C:\\\\work|\\\\api/.test(text));
  assert.deepStrictEqual(S.deriveLabel('postgres.exe', 'postgres -D C:\\pgdata\\mydb', 'PostgreSQL database'), { label: 'Postgres DB: mydb', rule: 'postgres-db' });
  assert.deepStrictEqual(S.deriveLabel('svchost.exe', 'x', 'Windows service host'), { label: 'Windows service host', rule: 'none' });
});

// ---------- input-response stall detector: foreground classifier shares the resolver's semantics ----------
const KIND = { in: 'in-scope', sys: 'system', out: 'out-of-scope' };
function fgAgrees(entries, names, { open = false } = {}) {
  const m = mk(entries);
  const r = S.createResolver(m, { open });
  const md = S.matchDataFor(r);
  for (const n of names) {
    const c = S.classifyForeground(md, n);
    assert.strictEqual(c.kind, KIND[r.classifyName(n)], `${n}: classifyForeground vs resolver`);
    assert.strictEqual(JSON.stringify(md).includes('zzfgcanary'), false);
  }
}
test('classifyForeground agrees with resolver.classifyName: substring does not match', () => fgAgrees([{ name: 'postgres' }], ['postgres', 'Postgres.exe', 'postgresql-helper', 'mypostgres', 'svchost', 'zzfgcanary']));
test('classifyForeground agrees with resolver.classifyName: extension is optional, case ignored', () => fgAgrees([{ name: 'Code.exe' }], ['code', 'CODE.EXE', 'codex']));
test('classifyForeground agrees with resolver.classifyName: * and ? patterns', () => fgAgrees([{ pattern: 'node*' }, { pattern: 'psq?' }], ['node', 'nodemon.exe', 'psql', 'psqlx', 'anode']));
test('classifyForeground agrees with resolver.classifyName: system set and open scope', () => { fgAgrees([], ['dwm', 'msmpeng', 'vmmem', 'notepad'], { open: false }); fgAgrees([], ['dwm', 'notepad', 'zzfgcanary'], { open: true }); });
test('classifyForeground names only the group of an in-scope or system application; out-of-scope carries no name', () => {
  const md = S.matchDataFor(S.createResolver(mk([{ name: 'code' }]), {}));
  assert.deepStrictEqual(S.classifyForeground(md, 'Code.exe'), { kind: 'in-scope', group: 'code' });
  assert.deepStrictEqual(S.classifyForeground(md, 'dwm.exe'), { kind: 'system', group: 'dwm' });
  assert.deepStrictEqual(S.classifyForeground(md, 'zzfgcanary1.exe'), { kind: 'out-of-scope', group: null });
  assert.strictEqual(S.classifyForeground(md, '').kind, 'unknown');
});
test('classifyForeground never widens scope: descendants that cannot be checked are out-of-scope with a fallback, pinned ids are in scope', () => {
  const m = mk([{ name: 'postgres', includeDescendants: true }]);
  const r = S.createResolver(m, {});
  const md = S.matchDataFor(r);
  assert.strictEqual(md.hasDescendantEntries, true);
  const c = S.classifyForeground(md, 'worker.exe', { pid: 4242 });
  assert.strictEqual(c.kind, 'out-of-scope');
  assert.ok(c.fallback && c.fallback.length > 5);
  // a descendant pinned by the resolver (pid:creation time) is recognised by pid
  const rows = [{ name: 'postgres.exe', pid: 10, ppid: 1, ct: 100, memMB: 1 }, { name: 'worker.exe', pid: 4242, ppid: 10, ct: 200, memMB: 1 }];
  r.resolve(rows);
  const md2 = S.matchDataFor(r);
  assert.deepStrictEqual(S.classifyForeground(md2, 'worker.exe', { pid: 4242 }), { kind: 'in-scope', group: 'worker' });
  assert.strictEqual(S.classifyForeground(md2, 'worker.exe', { pid: 999 }).kind, 'out-of-scope');
});
test('matchDataFor is serializable and carries no out-of-scope names', () => {
  const r = S.createResolver(mk([{ name: 'postgres' }]), {});
  r.resolve([row('zzfgcanary9.exe', 7, 10)]);
  const text = JSON.stringify(S.matchDataFor(r));
  assert.ok(!/zzfgcanary9/.test(text));
  assert.deepStrictEqual(JSON.parse(text).entries, [{ name: 'postgres', desc: false }]);
});
