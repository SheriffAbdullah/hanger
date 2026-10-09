'use strict';
// workload-session-and-containers 1.1 / 1.2: scope-file extension (phases, probes[], config[])
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../lib/scope');
const { parseScopeText } = S;

const base = (extra) => JSON.stringify({ version: 1, entries: [{ name: 'postgres' }], ...extra });
const load = (extra) => parseScopeText(base(extra), 'test.json');

test('valid extension: phases, a probe with defaults, config entries', () => {
  const r = load({
    phases: ['idle', 'loaded'],
    probes: [{ name: 'pg-select1', command: ['psql', '-h', 'localhost', '-c', 'select 1'] }],
    config: [{ kind: 'postgres', connection: 'host=localhost port=5432' }, { kind: 'wsl' }],
  });
  assert.deepStrictEqual(r.workload.phases, ['idle', 'loaded']);
  assert.deepStrictEqual(r.workload.probes[0], { name: 'pg-select1', command: ['psql', '-h', 'localhost', '-c', 'select 1'], timeoutMs: 5000, everySec: 5 });
  assert.strictEqual(r.workload.config.length, 2);
});

test('old scope files without the new keys behave as before', () => {
  const r = load({});
  assert.deepStrictEqual(r.workload, { phases: [], probes: [], config: [], drives: [] });
});

test('a shell-string command is rejected with a message', () => {
  assert.throws(() => load({ probes: [{ name: 'p', command: 'psql -c "select 1"' }] }), /argument list.*not a shell string/);
});

test('a probe without a name is rejected', () => {
  assert.throws(() => load({ probes: [{ command: ['psql'] }] }), /name is required/);
});

test('secret-like keys are rejected naming the key, in probes and in config', () => {
  assert.throws(() => load({ probes: [{ name: 'p', command: ['psql'], password: 'x' }] }), /key named "password"/);
  assert.throws(() => load({ config: [{ kind: 'postgres', PGPASSWORD: 'x' }] }), /key named "PGPASSWORD"/);
  assert.throws(() => load({ config: [{ kind: 'postgres', apiToken: 'x' }] }), /key named "apiToken"/);
  assert.throws(() => load({ config: [{ kind: 'postgres', secret_note: 'x' }] }), /key named "secret_note"/);
});

test('a credential inside the connection hint or an argument is rejected', () => {
  assert.throws(() => load({ config: [{ kind: 'postgres', connection: 'host=localhost password=hunter2' }] }), /credential/);
  assert.throws(() => load({ probes: [{ name: 'p', command: ['psql', 'postgres://u:pw@localhost/db'] }] }), /credential/);
});

test('bounds: everySec has a floor, timeoutMs has a range, names are unique, unknown kinds fail', () => {
  assert.throws(() => load({ probes: [{ name: 'p', command: ['x'], everySec: 1 }] }), /everySec/);
  assert.throws(() => load({ probes: [{ name: 'p', command: ['x'], timeoutMs: 10 }] }), /timeoutMs/);
  assert.throws(() => load({ probes: [{ name: 'p', command: ['x'] }, { name: 'p', command: ['y'] }] }), /unique/);
  assert.throws(() => load({ config: [{ kind: 'mysql' }] }), /kind/);
  assert.throws(() => load({ phases: [''] }), /phases/);
});

test('the README example scope file passes the loader (1.2)', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'USER-GUIDE.md'), 'utf8');
  const m = readme.match(/```json\s*\n(\{[^`]*"probes"[^`]*\})\s*\n```/);
  assert.ok(m, 'README has a scope-file example with probes');
  const r = parseScopeText(m[1], 'README example');
  assert.ok(r.workload.probes.length >= 1 && r.workload.config.length >= 1 && r.workload.phases.length >= 1);
});

test('loadScope returns the workload extension from a scope file and empty defaults otherwise', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-wlscope-'));
  fs.writeFileSync(path.join(d, 'telltale.scope.json'), base({ phases: ['idle'], probes: [{ name: 'q', command: ['node', '-e', ''] }] }));
  const withFile = S.loadScope({ cfg: {}, args: [], cwd: d });
  assert.deepStrictEqual(withFile.workload.phases, ['idle']);
  assert.strictEqual(withFile.workload.probes[0].name, 'q');
  const none = S.loadScope({ cfg: {}, args: ['--only', 'postgres'], cwd: d });
  assert.deepStrictEqual(none.workload, { phases: [], probes: [], config: [], drives: [] });
});
