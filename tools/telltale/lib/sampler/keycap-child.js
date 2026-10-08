'use strict';
// Child process of keycap.js: stamps every key at read time. No dependency on the parent's event loop.
try { process.stdin.setRawMode(true); } catch { /* piped stdin (tests) or no TTY: still read data */ }
process.stdin.resume();
// TELLTALE_PHASE_KEY=1 (set when workload phases are declared): 'p' is the phase key, not a mark
const PHASE_KEY = process.env.TELLTALE_PHASE_KEY === '1';
process.stdin.on('data', (d) => {
  const t = Date.now();
  const kind = d && d[0] === 3 ? 'I' : (PHASE_KEY && d && (d[0] === 0x70 || d[0] === 0x50) ? 'P' : 'K');
  try { process.stdout.write(`${kind}|${t}\n`); } catch { process.exit(0); }
});
process.stdin.on('end', () => process.exit(0));
process.stdout.on('error', () => process.exit(0)); // parent gone
