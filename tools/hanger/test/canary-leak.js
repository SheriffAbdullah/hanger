#!/usr/bin/env node
'use strict';
// Privacy canary (software-inventory-and-scope): an idle out-of-scope process named zzcanary<rand>.exe is
// started, every mode runs scoped to `postgres`, and the canary name must appear in NO output file and in
// NO captured console text (case-insensitive). Live Windows check; not part of `node --test`.
//   node tools/hanger/test/canary-leak.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { grepArtifacts } = require('./helpers/grep-artifacts');

const HANGER = path.join(__dirname, '..', 'hanger.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-canary-'));
const outDir = path.join(tmp, 'out');
const invDir = path.join(tmp, 'inv-selfcheck'); // proves the canary is visible to the tool; excluded from the leak grep
const canaryName = `zzcanary${Math.random().toString(36).slice(2, 10)}`;
const canaryExe = path.join(tmp, `${canaryName}.exe`);
const captured = [];
let failures = 0;
const canaryNames = [canaryName];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };

function run(label, argv, timeoutMs = 300000) {
  // cwd is a scratch dir: no hanger.config.json / hanger.scope.json from the repo can change the scope
  const r = spawnSync(process.execPath, [HANGER, ...argv], { cwd: tmp, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  captured.push({ label, text: `${r.stdout || ''}\n${r.stderr || ''}` });
  console.log(`[canary] ${label}: exit ${r.status}`);
  return r;
}

async function main() {
let canary = null;
let canaryContainer = null; // a running container named like the canary, when a container runtime with a local image exists
try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(process.execPath, canaryExe);
  canary = spawn(canaryExe, ['-e', 'setInterval(()=>{},1e3)'], { stdio: 'ignore', windowsHide: true });
  const wait = Date.now() + 2000; while (Date.now() < wait) { /* let the process register */ }

  // out-of-scope container: its name and id must reach no file or console line either (skipped when Docker is not usable)
  const imgs = spawnSync('docker', ['images', '-q'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  const img = imgs.status === 0 ? String(imgs.stdout).split(/\r?\n/).map((x) => x.trim()).find(Boolean) : null;
  if (img) {
    const run1 = spawnSync('docker', ['run', '-d', '--rm', '--name', canaryName, img, 'sleep', '600'], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    if (run1.status === 0) { canaryContainer = canaryName; console.log('[canary] started canary container'); }
  }
  if (!canaryContainer) console.log('SKIP canary container: no usable Docker with a local image on this machine (the canned-output unit tests cover container names)');

  // self-check: the inventory (the only local-only listing) DOES see the canary, so zero hits elsewhere is meaningful
  run('inventory', ['inventory', '--out', invDir]);
  const invFiles = fs.existsSync(path.join(invDir, 'private')) ? fs.readdirSync(path.join(invDir, 'private')) : [];
  const invHits = invFiles.length ? grepArtifacts(path.join(invDir, 'private'), [canaryName]) : [];
  check(invHits.length > 0, `self-check: inventory lists the running canary (${invHits.length} hit(s) in private/)`);

  // --hang 1 turns every 2s probe into a hang, so the on-hang snapshot / not-responding / GPU paths all run
  const t1 = run('trace', ['trace', '--duration', '20', '--hang', '1', '--only', 'postgres', '--phase-now', '--out', outDir, '--log', path.join(outDir, 'run.log')]);
  check(t1.status === 0, 'scoped trace exits 0');
  const reports = fs.readdirSync(outDir).filter((f) => /^hanger-.*\.json$/.test(f)).sort();
  check(reports.length >= 1, 'scoped trace wrote a report');
  if (reports.length) {
    const j = JSON.parse(fs.readFileSync(path.join(outDir, reports[0]), 'utf8'));
    const hangs = j.hangEvents || [];
    check(j.scope && j.scope.counts && j.scope.counts.inScopeGroups === 0, 'nothing in scope: scope.counts.inScopeGroups === 0');
    check(j.outOfScope && Number.isFinite(j.outOfScope.memMB), 'run-level outOfScope.memMB is numeric');
    check(hangs.length >= 1, `trace recorded hangs to exercise (${hangs.length})`);
    check(hangs.every((h) => h.scopeShare && Number.isFinite(h.scopeShare.outOfScope.memMB) && h.scopeShare.inScope.memMB === 0), 'every hang row has numeric scopeShare.outOfScope.memMB and inScope.memMB 0');
  }
  run('watch', ['watch', '--watch-secs', '10', '--only', 'postgres', '--out', outDir]);
  run('pack', ['pack', '--only', 'postgres', '--out', outDir]);
  run('trace-print', ['trace', '--duration', '10', '--print', '--only', 'postgres', '--out', outDir]);

  // ---- input-response detector (input-response-stall-detector 16.1): typed text, window title and an out-of-scope foreground name ----
  // A test window (stall-window.ps1) has the title canary, receives synthetic typing of the key canary, and blocks its own UI
  // thread so the detector records episodes. Scenario A runs it scoped to powershell (in scope); scenario B runs it from a copy of
  // powershell.exe named zzfgcanary<rand>.exe while the scope is `postgres` (out-of-scope foreground that stalls).
  if (process.platform === 'win32' && !process.env.HANGER_CANARY_SKIP_INPUT) {
    const rnd = () => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 8).padEnd(8, 'q');
    const titleCanary = `zztitlecanary${rnd()}`, keyCanary = `zzkeycanary${rnd()}`, fgName = `zzfgcanary${rnd()}`;
    const psExe = path.join(process.env.WINDIR || 'C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const fgExe = path.join(tmp, `${fgName}.exe`);
    fs.copyFileSync(psExe, fgExe);
    const windowScript = path.join(__dirname, 'helpers', 'stall-window.ps1');
    const runScenario = async (label, onlyScope, exe, extra = []) => {
      const outA = path.join(outDir, label);
      fs.mkdirSync(outA, { recursive: true });
      const trace = spawn(process.execPath, [HANGER, 'trace', '--duration', '45', '--only', onlyScope, '--out', outA], { cwd: tmp, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      trace.stdout.on('data', (d) => { text += d; }); trace.stderr.on('data', (d) => { text += d; });
      const traceDone = new Promise((res) => trace.on('exit', (code) => res(code)));
      await new Promise((r) => setTimeout(r, 9000)); // helper start-up, then the window
      const win = spawn(exe, ['-STA', '-NoProfile', '-File', windowScript, '-StallMs', '1500', '-Times', '2', '-EverySec', '10', '-WarmupSec', '5', '-DurationSec', '28', '-TitleCanary', titleCanary, '-TypeText', keyCanary, ...extra], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let winOut = '';
      win.stdout.on('data', (d) => { winOut += d; });
      const winDone = new Promise((res) => win.on('exit', res));
      // self-check material: while the foreground canary application runs, the local-only inventory must be able to see its name
      let invSeen = null;
      if (label === 'input-out-of-scope') {
        await new Promise((r) => setTimeout(r, 6000));
        run('inventory-fg', ['inventory', '--out', path.join(tmp, 'inv-fg')]);
        const invDirFg = path.join(tmp, 'inv-fg', 'private');
        invSeen = fs.existsSync(invDirFg) ? grepArtifacts(invDirFg, [fgName]).length : 0;
      }
      await winDone;
      const code = await traceDone;
      captured.push({ label, text });
      console.log(`[canary] ${label}: trace exit ${code}`);
      return { code, text, winOut, outA, invSeen };
    };
    const A = await runScenario('input-in-scope', 'powershell', 'powershell');
    check(A.code === 0, 'input scenario A (in scope, typed text + title canary) trace exits 0');
    check(/TYPED \d+ True/.test(A.winOut), 'self-check: the typed canary text reached the test window (the tool could have seen it if it captured content)');
    const repA = fs.readdirSync(A.outA).filter((f) => /^hanger-.*\d\.json$/.test(f))[0];
    if (repA) {
      const j = JSON.parse(fs.readFileSync(path.join(A.outA, repA), 'utf8'));
      check(j.inputStall && j.inputStall.status === 'running' && j.inputStall.episodes.length >= 1, `self-check: the detector recorded episodes with the canary window in the foreground (${j.inputStall && j.inputStall.episodes ? j.inputStall.episodes.length : 'none'})`);
      check(j.inputStall.episodes.every((e) => e.foreground.kind === 'in-scope' && e.foreground.group === 'powershell'), 'in-scope episodes are named by group only');
    } else check(false, 'scenario A wrote a report');
    const B = await runScenario('input-out-of-scope', 'postgres', fgExe);
    check(B.code === 0, 'input scenario B (out-of-scope foreground that stalls) trace exits 0');
    check(B.invSeen > 0, `self-check: the local-only inventory saw the running ${'zzfgcanary'}* application (${B.invSeen} hit(s) in private/)`);
    const repB = fs.readdirSync(B.outA).filter((f) => /^hanger-.*\d\.json$/.test(f))[0];
    if (repB) {
      const j = JSON.parse(fs.readFileSync(path.join(B.outA, repB), 'utf8'));
      const eps = (j.inputStall && j.inputStall.episodes) || [];
      check(eps.length >= 1 && eps.every((e) => e.foreground.kind === 'out-of-scope' && e.foreground.group === undefined), `out-of-scope episodes are anonymous (${eps.length} episode(s), no group field)`);
      check(j.inputStall.outOfScope.episodes.v === eps.length, 'out-of-scope episodes are counted');
    } else check(false, 'scenario B wrote a report');
    // the three canaries are added to the leak search below
    canaryNames.push(titleCanary, keyCanary, fgName);
    // a helper stdout/console capture of scenario B and the helper files are inside outDir, so the grep below covers them
    spawnSync('taskkill', ['/F', '/IM', `${fgName}.exe`], { windowsHide: true });
  } else console.log('SKIP input-response canaries (set HANGER_CANARY_SKIP_INPUT or non-Windows)');
} finally {
  if (canary) { try { canary.kill(); } catch { /* already gone */ } }
  if (canaryContainer) spawnSync('docker', ['rm', '-f', canaryContainer], { windowsHide: true, timeout: 30000 });
  spawnSync('taskkill', ['/F', '/IM', `${canaryName}.exe`], { windowsHide: true });
}

// grep every output file and every captured console stream
const fileHits = grepArtifacts(outDir, canaryNames);
const consoleHits = [];
for (const c of captured) {
  if (c.label === 'inventory' || c.label === 'inventory-fg') continue; // inventory is the one local-only listing and prints names by design
  c.text.split('\n').forEach((line, i) => { if (canaryNames.some((n) => line.toLowerCase().includes(n))) consoleHits.push({ label: c.label, line: i + 1 }); });
}
for (const h of fileHits) console.log(`HIT file ${h.file}:${h.line}`);
for (const h of consoleHits) console.log(`HIT console ${h.label}:${h.line}`);
// the run-time guard is only a backstop: if it had to mask anything, a structural leak exists even though the output is clean
const backstop = captured.filter((c) => /scope guard masked/.test(c.text)).map((c) => c.label);
check(backstop.length === 0, `scope guard backstop never activated${backstop.length ? ` (${backstop.join(', ')})` : ''}`);
const total = fileHits.length + consoleHits.length;
console.log(`canary hits: ${total}`);
if (total === 0 && failures === 0) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp cleanup is best effort */ } } else console.log(`artifacts kept for inspection: ${tmp}`);
return total === 0 && failures === 0 ? 0 : 1;
}
main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
