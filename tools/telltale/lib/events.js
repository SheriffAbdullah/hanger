'use strict';
// OS event-log and WER windowing. Pure: query builders return script text, parsers take output text.
// Records are evidence only if they fall inside the run window (start - lead .. end);
// older records are history (count + newest), never summary reasons.

const LEAD_S = 60;
const EXHAUSTION_PROVIDER = 'Microsoft-Windows-Resource-Exhaustion-Detector';
const MAX_EVENTS = 50;
const HISTORY_DAYS = 90; // bounded scan: an unbounded query on an empty log takes minutes (looked like a timeout)

// One line per record: <utc ISO>|<id>|<provider>|<message (only when withMessage)>
function eventQueryScript(logName, id, { withMessage = false, provider = null } = {}) {
  const prov = provider ? `; ProviderName='${provider}'` : '';
  const msg = withMessage ? `+ '|' + (($_.Message -replace '[\\r\\n|]+',' ').Substring(0,[Math]::Min(120,$_.Message.Length)))` : `+ '|'`;
  return `Get-WinEvent -FilterHashtable @{LogName='${logName}'; ID=${id}${prov}; StartTime=(Get-Date).AddDays(-${HISTORY_DAYS})} -MaxEvents ${MAX_EVENTS} -ErrorAction SilentlyContinue -ErrorVariable gwe | ForEach-Object { $_.TimeCreated.ToUniversalTime().ToString('o') + '|' + $_.Id + '|' + $_.ProviderName ${msg} } | Out-String -Width 400; foreach ($e in $gwe) { if ($e.Exception.Message -notmatch 'No events were found') { [Console]::Error.WriteLine($e.Exception.Message) } }; exit 0`;
}

function parseEventLines(stdout) {
  const out = [];
  for (const line of String(stdout || '').split('\n')) {
    const p = line.trim().split('|');
    if (p.length < 3) continue;
    const ms = Date.parse(p[0]);
    if (!Number.isFinite(ms)) continue;
    const rec = { at: new Date(ms).toISOString(), id: +p[1], provider: p[2] };
    if (p[3]) rec.message = p.slice(3).join('|').trim();
    out.push(rec);
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

function classifyError(stderr) {
  const s = String(stderr || '');
  if (!s.trim() || /no events were found/i.test(s)) return null;
  if (/timed? ?out|ETIMEDOUT/i.test(s)) return 'timeout';
  if (/denied|unauthori[sz]ed|privilege/i.test(s)) return 'denied';
  return 'error';
}

// raw: { appHang, appCrash, resourceExhaustion } each {stdout, stderr}
function buildEventsSection({ raw, runStartMs, runEndMs, leadS = LEAD_S }) {
  const fromMs = runStartMs - leadS * 1000;
  const section = {
    window: { from: new Date(fromMs).toISOString(), to: new Date(runEndMs).toISOString(), leadS },
    mode: 'none-in-window',
    inWindow: { appHang: [], appCrash: [], resourceExhaustion: [] },
    history: {},
  };
  const failures = [];
  const errModes = [];
  for (const [key, r] of Object.entries(raw)) {
    let recs = parseEventLines(r && r.stdout);
    if (key === 'resourceExhaustion') recs = recs.filter((x) => x.provider === EXHAUSTION_PROVIDER);
    const inWin = recs.filter((x) => Date.parse(x.at) >= fromMs && Date.parse(x.at) <= runEndMs);
    const older = recs.filter((x) => Date.parse(x.at) < fromMs);
    section.inWindow[key] = inWin;
    section.history[key] = { count: older.length, newest: older.length ? older[0].at : null, countCapped: recs.length >= MAX_EVENTS, horizonDays: HISTORY_DAYS };
    const em = classifyError(r && r.stderr);
    if (em) { errModes.push(em); failures.push({ key, mode: em, reason: String(r.stderr).slice(0, 150) }); }
  }
  const any = Object.values(section.inWindow).some((a) => a.length);
  if (any) section.mode = 'ok';
  else if (errModes.length) section.mode = errModes[0];
  return { section, failures };
}

// WER archive listing, one line per .wer: <utc ISO LastWriteTime>|<1 if EventName=AppHang else 0>
function werListingScript() {
  return `$d=$env:ProgramData + '\\Microsoft\\Windows\\WER\\ReportArchive'; if (Test-Path $d) { Get-ChildItem $d -Recurse -Filter *.wer -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 200 | ForEach-Object { $_.LastWriteTime.ToUniversalTime().ToString('o') + '|' + $(if (Select-String -Path $_.FullName -Pattern 'EventName=AppHang' -SimpleMatch -Quiet) { 1 } else { 0 }) }; 'listed' } else { 'absent' }`;
}

function parseWerListing(stdout, runStartMs, runEndMs, cap = 200) {
  const rows = [];
  let present = true;
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim();
    if (t === 'absent') present = false;
    const m = t.match(/^(\S+)\|([01])$/);
    if (!m) continue;
    const ms = Date.parse(m[1]);
    if (Number.isFinite(ms)) rows.push({ ms, hang: m[2] === '1' });
  }
  const inRunRows = rows.filter((r) => r.ms >= runStartMs && r.ms <= runEndMs);
  const count = (a) => ({ total: a.length, apphang: a.filter((r) => r.hang).length });
  return {
    archivePresent: present,
    searchedWindow: { from: new Date(runStartMs).toISOString(), to: new Date(runEndMs).toISOString() },
    inRun: count(inRunRows),
    history: { ...count(rows), window: 'all-time', capped: rows.length >= cap },
  };
}

module.exports = { HISTORY_DAYS, LEAD_S, EXHAUSTION_PROVIDER, eventQueryScript, parseEventLines, buildEventsSection, werListingScript, parseWerListing, classifyError };
