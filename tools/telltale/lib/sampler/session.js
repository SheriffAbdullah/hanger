'use strict';
// The ONE long-lived counter session. A single PowerShell process reads every counter through one PDH query in a loop
// and writes one block per sample; no process is launched per tick. Protocol:
//   SKIP|<counter path>|<reason>        (start-up only: a counter that could not be created)
//   READY|<counter count>
//   BEGIN|<UTC read time, yyyy-MM-ddTHH:mm:ss.fffZ>
//   <counter path>=<invariant-culture value>   (one line per counter)
//   POWER|<Online|Offline|Unknown>|<battery percent, 255 unknown>|<battery flag, 128 none>|<overlay scheme guid>|<system status, 1 energy saver>
//   COST|<wildcard counter set>|<read ms>|<read every Nth tick>   (one per wildcard counter read this tick)
//   OBS|<session cpu seconds>|<session private bytes>|<node private bytes>
//   END
const { spawn } = require('child_process');

// requested counter path (may hold * wildcards) -> RegExp over a returned sample path (host part included)
function pathRegex(requested) {
  const body = requested.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^\\\\\\\\[^\\\\]+${body}$`);
}

// which requested paths returned at least one sample
function validatePaths(requested, returnedPaths) {
  const got = returnedPaths.map((s) => s.toLowerCase());
  const ok = [], missing = [];
  for (const p of requested) (got.some((g) => pathRegex(p).test(g)) ? ok : missing).push(p);
  return { ok, missing };
}

const BS = '\\';

// "\Category(instance)\Counter" -> {category, instance, counter}; instance may hold * wildcards
function parseCounterPath(p) {
  const s = String(p);
  if (s[0] !== BS) return null;
  const last = s.lastIndexOf(BS);
  if (last <= 0) return null;
  const head = s.slice(1, last), counter = s.slice(last + 1);
  const open = head.indexOf('(');
  if (open < 0) return counter ? { category: head, instance: '', counter } : null;
  if (!head.endsWith(')')) return null;
  return { category: head.slice(0, open), instance: head.slice(open + 1, -1), counter };
}

// The session script (PDH wrapper loop) lives in pdh-script.js.
const { buildSessionScript } = require('./pdh-script');

const encodePs = (script) => Buffer.from(script, 'utf16le').toString('base64');
// A command line is limited to ~32 K characters and the session script outgrew it, so the script travels on stdin and the
// command line carries only this bootstrap (piped multi-line input is not understood by `-Command -`, hence Invoke-Expression).
const BOOTSTRAP = '$s=[Console]::In.ReadToEnd(); Invoke-Expression $s';
const bootstrapArgs = () => ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(BOOTSTRAP)];

// Splits a stdout stream into protocol blocks; calls onBlock({atMs, atIso, lines, power, obs}).
function createBlockParser(onBlock, { onSkip = () => {}, onReady = () => {} } = {}) {
  let buf = '', cur = null;
  const handle = (line) => {
    if (!line) return;
    if (line.startsWith('SKIP|')) { const [, p, reason] = line.split('|'); onSkip(p, reason); return; }
    if (line.startsWith('READY|')) { onReady(Number(line.slice(6))); return; }
    if (line.startsWith('BEGIN|')) { cur = { atIso: line.slice(6), atMs: Date.parse(line.slice(6)), lines: [], power: null, obs: null, costs: [] }; return; }
    if (!cur) return;
    if (line === 'END') { const b = cur; cur = null; onBlock(b); return; }
    if (line.startsWith('POWER|')) { const [, l, p, flag, overlay, saver] = line.split('|'); cur.power = { line: l, pct: p, ...(flag !== undefined ? { flag, overlay, saver } : {}) }; return; }
    if (line.startsWith('COST|')) { const [, c, ms, every] = line.split('|'); cur.costs.push({ counter: c, ms: Number(ms), every: Number(every) }); return; }
    if (line.startsWith('OBS|')) { const [, c, p, n, hc, hp] = line.split('|'); cur.obs = { cpuS: c, privateB: p, nodePrivateB: n, ...(hc ? { helperCpuS: hc, helperPrivateB: hp } : {}) }; return; }
    cur.lines.push(line);
  };
  return {
    push(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
    },
  };
}

// Session manager with bounded restarts. spawnFn is injectable for tests.
function createSessionManager({ spawnFn = spawn, command = 'powershell', buildArgs, buildStdin = null, onBlock, onSkip, onReady, onRestart = () => {}, onGiveUp = () => {}, onSpawn = () => {}, maxRestarts = 3, restartDelayMs = 500, now = Date.now }) {
  let child = null, stopping = false, restarts = 0, handled = null;
  const parser = createBlockParser(onBlock, { onSkip, onReady });
  function start() {
    // the script is delivered on stdin when buildStdin is given: a command line is limited to ~32 K characters and the session script outgrew it
    const stdinText = typeof buildStdin === 'function' ? buildStdin() : null;
    try { child = spawnFn(command, buildArgs(), { windowsHide: true, stdio: [stdinText ? 'pipe' : 'ignore', 'pipe', 'ignore'] }); }
    catch (e) { child = {}; handleExit(`spawn failed: ${e.message}`); return; }
    if (stdinText && child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(stdinText); }
    onSpawn(child, restarts);
    if (child.stdout && child.stdout.setEncoding) child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => parser.push(String(d)));
    child.on('error', (e) => { if (!stopping) handleExit(`spawn error: ${e.message}`); });
    child.on('exit', (code, sig) => { if (!stopping) handleExit(`session exited (code ${code}, signal ${sig})`); });
  }
  function handleExit(reason) {
    if (handled === child) return; // error + exit both fire for one failed spawn
    handled = child;
    if (restarts >= maxRestarts) { onGiveUp(reason, restarts); return; }
    restarts++;
    onRestart({ n: restarts, atMs: now(), reason });
    setTimeout(() => { if (!stopping) start(); }, restartDelayMs);
  }
  return {
    start,
    stop() { stopping = true; try { if (child) child.kill(); } catch { /* already gone */ } },
    get pid() { return child ? child.pid : null; },
    get restarts() { return restarts; },
  };
}

module.exports = { parseCounterPath, pathRegex, validatePaths, buildSessionScript, encodePs, bootstrapArgs, BOOTSTRAP, createBlockParser, createSessionManager };
