'use strict';
// Non-blocking key capture. A tiny child process owns raw-mode stdin and stamps each key press with
// Date.now() at read time, so the stamp cannot be delayed by synchronous work in the main process.
// The parent just receives the already-stamped lines whenever its event loop is free.
//   K|<epoch ms>   a key press (a mark)
//   I|<epoch ms>   Ctrl+C (an interrupt, not a mark)
//   P|<epoch ms>   the workload phase key ('p', only when TELLTALE_PHASE_KEY=1)
const { spawn } = require('child_process');
const path = require('path');

const CHILD = path.join(__dirname, 'keycap-child.js');

// stdin: 'inherit' for a real terminal; 'pipe' lets a test inject key presses
function startKeyCapture({ onMark, onInterrupt = () => {}, onPhase = () => {}, stdin = 'inherit', spawnFn = spawn, nodePath = process.execPath, childPath = CHILD } = {}) {
  const child = spawnFn(nodePath, [childPath], { stdio: [stdin, 'pipe', 'ignore'], windowsHide: true });
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      const m = line.match(/^([KIP])\|(\d+)$/);
      if (!m) continue;
      const atMs = +m[2];
      if (m[1] === 'I') onInterrupt(atMs); else if (m[1] === 'P') onPhase(atMs); else onMark(atMs);
    }
  });
  child.on('error', () => { /* no key capture available; the run continues without marks */ });
  return { child, stop() { try { child.kill(); } catch { /* gone */ } } };
}

module.exports = { startKeyCapture, CHILD };
