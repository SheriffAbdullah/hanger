'use strict';
// Fixed plain-language reason vocabulary. Raw stderr / shell text never reaches a report or view.
const R = Object.freeze({
  NOT_INSTALLED: 'not installed',
  NOT_RUNNING: 'not running',
  NOT_VISIBLE: 'not visible at user tier',
  AUTH: 'authentication required (credentials are never stored)',
  NOT_DECLARED: 'not declared in scope',
  NO_CAP: 'no cap configured (default applies)',
  VM_STOPPED: 'VM not running',
  NO_CONTAINERS: 'no containers running',
  ELEVATED_NO_PROBE: 'probes are not run from an elevated session',
  FAILED: 'unavailable (the platform call failed)',
});
const unresponsive = (ms) => `unresponsive (timed out after ${Math.max(1, Math.round(ms / 1000))} s)`;

// result of EXEC.execA -> a fixed reason (or null when the call succeeded). Raw text is read only to classify it.
function reasonFromExec(r, { timeoutMs = 3000 } = {}) {
  if (!r) return R.FAILED;
  if (r.timedOut) return unresponsive(timeoutMs);
  if (r.enoent) return R.NOT_INSTALLED;
  if (r.code === 0) return null;
  const t = `${r.stderr || ''} ${r.stdout || ''}`;
  // order matters: the daemon-pipe message also says "cannot find the file"
  if (/cannot connect|is the docker daemon running|error during connect|dockerdesktoplinuxengine|connection refused|could not connect|no connection could be made|server closed the connection/i.test(t)) return R.NOT_RUNNING;
  if (/is not recognized as an internal|command not found|executable file not found|no such file or directory|ENOENT/i.test(t)) return R.NOT_INSTALLED;
  if (/password|authentication|no pg_hba|fe_sendauth/i.test(t)) return R.AUTH;
  return R.FAILED;
}

module.exports = { R, unresponsive, reasonFromExec };
