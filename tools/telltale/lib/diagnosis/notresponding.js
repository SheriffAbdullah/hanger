'use strict';
// OS "not responding" check at a hang. Pure: the script text is built here, the poll output is parsed here.
// Only an in-scope, foreground process can confirm a hang: suspended and background-only (store) apps are reported
// "not responding" by the OS at any time, so they are dropped here and their names are never recorded.

const POLL_WINDOW_MS = 2000; // a poll that started later than this after the hang is not evaluated for that hang

// one line per not-responding process that owns a window: <name>|<1 if every thread is suspended else 0>
const POLL_SCRIPT = "Get-Process -ErrorAction SilentlyContinue | Where-Object { -not $_.Responding -and $_.MainWindowHandle -ne 0 } | ForEach-Object { $s = 0; try { $t = @($_.Threads); if ($t.Count -gt 0 -and @($t | Where-Object { $_.ThreadState -eq 'Wait' -and $_.WaitReason -eq 'Suspended' }).Count -eq $t.Count) { $s = 1 } } catch { }; $_.Name + '|' + $s }";

// store apps the OS parks in the background; used only when the suspended flag is missing from the poll line
const BACKGROUND_APP_RE = /^(Microsoft\.|SystemSettings$|ApplicationFrameHost$|TextInputHost$|ShellExperienceHost$|StartMenuExperienceHost$|SearchHost$|WidgetService$|Widgets$|LockApp$)/i;

function parsePoll(stdout) {
  const rows = [];
  for (const raw of String(stdout || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [name, flag] = line.split('|');
    if (!name) continue;
    const suspended = flag === '1' || (flag === undefined && BACKGROUND_APP_RE.test(name));
    rows.push({ name: name.trim(), suspended });
  }
  return rows;
}

// -> the fields stored on the hang row. resolver.filterNames keeps in-scope and system names and counts the rest.
//   confirmed: true | false | null; state: 'confirmed' | 'denied' | 'not-evaluated'
function evaluatePoll({ stdout, resolver, hangAtMs, hangStartMs = hangAtMs, pollAtMs, limitMs = POLL_WINDOW_MS }) {
  const pollAt = Number.isFinite(pollAtMs) ? new Date(pollAtMs).toISOString() : null;
  if (Number.isFinite(hangStartMs) && Number.isFinite(pollAtMs) && pollAtMs < hangStartMs) {
    return { osConfirmed: null, osConfirmState: 'not-evaluated', osPollAt: pollAt, osUnavailableReason: 'the shared poll ran before this hang began; not attached to this hang' };
  }
  if (Number.isFinite(hangAtMs) && Number.isFinite(pollAtMs) && pollAtMs - hangAtMs > limitMs) {
    return { osConfirmed: null, osConfirmState: 'not-evaluated', osPollAt: pollAt, osUnavailableReason: `poll started ${((pollAtMs - hangAtMs) / 1000).toFixed(1)} s after the hang (limit ${limitMs / 1000} s); not attached to this hang` };
  }
  const rows = parsePoll(stdout);
  const live = rows.filter((r) => !r.suspended);
  const names = [...new Set(live.map((r) => r.name))];
  const kept = resolver ? resolver.filterNames(names) : { kept: names, outOfScopeCount: 0 };
  const confirmed = kept.kept.length > 0;
  return {
    osConfirmed: confirmed, osConfirmState: confirmed ? 'confirmed' : 'denied', osPollAt: pollAt,
    osHungWindows: kept.kept.slice(0, 8), outOfScopeNotResponding: kept.outOfScopeCount, suspendedIgnored: rows.length - live.length,
  };
}

module.exports = { POLL_SCRIPT, POLL_WINDOW_MS, parsePoll, evaluatePoll };
