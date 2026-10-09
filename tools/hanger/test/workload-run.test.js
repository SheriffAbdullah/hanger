'use strict';
// workload-session-and-containers 8.2 as an automated check: a real trace where every launch fails like a missing
// binary (HANGER_TEST_FAIL_ALL), so no Docker, WSL or probe command runs. Phase keys are injected through the
// same capture helper a terminal uses. Verifies the section shape, the fixed reasons, and that no raw shell text leaks.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateFile } = require('./helpers/validate-report');
const { grepArtifacts } = require('./helpers/grep-artifacts');

const HANGER = path.join(__dirname, '..', 'hanger.js');

test('trace without Docker: workload section present, phases tagged, every container value null with a fixed reason', { timeout: 120000 }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-wlrun-'));
  const scope = path.join(d, 'scope.json');
  fs.writeFileSync(scope, JSON.stringify({
    version: 1, entries: [{ name: 'postgres' }],
    probes: [{ name: 'pg-select1', command: ['zz-missing-probe-binary', '--canaryarg'], everySec: 2 }],
    config: [{ kind: 'wsl' }, { kind: 'postgres', connection: 'host=localhost' }],
  }));
  const out = path.join(d, 'out');
  const r = spawnSync(process.execPath, [HANGER, 'trace', '--duration', '12', '--scope', scope, '--phase', 'loaded', '--out', out], {
    cwd: d, encoding: 'utf8', timeout: 110000, windowsHide: true, input: '',
    env: { ...process.env, HANGER_TEST_FAIL_ALL: '1', HANGER_TEST_PHASE_KEYS: '3,8' },
  });
  assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`.slice(-1500));
  const file = fs.readdirSync(out).filter((f) => /^hanger-.*\.json$/.test(f))[0];
  assert.ok(file, 'report written');
  const v = validateFile(path.join(out, file));
  assert.ok(v.ok, v.problems.join('; '));
  const w = v.obj.workload;
  assert.ok(w, 'workload section present');
  assert.strictEqual(w.phases.length, 1);
  assert.strictEqual(w.phases[0].label, 'loaded');
  assert.strictEqual(w.phases[0].source, 'key');
  assert.strictEqual(w.phases[0].endStatus, 'closed');
  assert.ok(w.phases[0].startAt < w.phases[0].endAt);
  assert.ok(w.phaseSummary && w.phaseSummary.ramUsedPct.loaded.n >= 1, 'idle-versus-loaded summary has n on the tagged side');
  assert.strictEqual(w.containers.series.length, 0);
  assert.strictEqual(w.containers.unavailable.reason, 'not installed');
  assert.strictEqual(w.vm.hostMemMB.length, 0);
  assert.ok(w.vm.configuredCapMB && ('value' in w.vm.configuredCapMB), 'configured cap is a value or a reason');
  assert.deepStrictEqual(w.declared.probes, ['pg-select1']);
  assert.ok(w.probes['pg-select1'].length >= 1 && w.probes['pg-select1'].every((p) => p.status === 'not-found'));
  assert.strictEqual(w.probeStops.length, 1, 'stopped after 3 consecutive not-found');
  const pg = v.obj.workloadConfig.filter((f) => f.kind === 'postgres');
  assert.ok(pg.length === 3 && pg.every((f) => f.value === null && typeof f.unavailableReason === 'string'));
  // the run stream carries the phase bounds as they happened (survives a kill)
  const stream = fs.readdirSync(out).filter((f) => f.endsWith('.jsonl') && !f.endsWith('.input.jsonl'))[0];
  const recs = fs.readFileSync(path.join(out, stream), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.type === 'wl-phase');
  assert.deepStrictEqual(recs.map((x) => x.action), ['start', 'end']);
  // no raw shell text and no probe command text anywhere
  const hits = grepArtifacts(out, ['not recognized', 'canaryarg', 'zz-missing-probe-binary']);
  assert.deepStrictEqual(hits, []);
  assert.ok(!/canaryarg|zz-missing-probe-binary/.test(`${r.stdout}${r.stderr}`), 'console never echoes the probe command');
});
