'use strict';
// Workload configuration facts (opt-in via scope-file `config[]`). Credential-free:
//  - a database is queried only when it is IN SCOPE, with a <= 3 s connect timeout and password prompting disabled;
//  - if authentication is needed the fact is null with a fixed reason; nothing is stored or asked.
// Fact record: {kind, fact, value, unit?, source, unavailableReason}
const { R, reasonFromExec } = require('./reasons');
const vm = require('./vm');

const PG_SETTINGS = ['shared_buffers', 'work_mem', 'max_connections'];
const PG_SOURCE = 'database settings';

const fact = (kind, name, value, source, unavailableReason = null, extra = {}) => ({ kind, fact: name, value: value === undefined ? null : value, source, unavailableReason, ...extra });
const allNull = (kind, names, source, reason) => names.map((n) => fact(kind, n, null, source, reason));

// `psql -XAt -c "SHOW a" -c "SHOW b" -c "SHOW c"` prints one value per line, in order
function parsePgSettings(stdout, names = PG_SETTINGS) {
  const lines = String(stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < names.length) return null;
  return names.map((n, i) => ({ name: n, value: lines[i] }));
}

// connection hint "host=localhost port=5432" -> psql args (a libpq key=value string is passed as the dbname argument)
function pgArgs(connection) {
  const args = ['-X', '-A', '-t', '-w']; // -w: never prompt for a password
  if (connection) args.push(connection);
  for (const s of PG_SETTINGS) args.push('-c', `SHOW ${s}`);
  return args;
}

async function collectPostgres({ entry, exec, resolver, ctx = null, timeoutMs = 4000 }) {
  const kind = 'postgres';
  // in scope: a postgres process (or the named container) is declared
  const inScope = entry.container ? resolver.classifyName(entry.container) === 'in' : (resolver.classifyName('postgres') === 'in' || resolver.classifyName('postgres.exe') === 'in');
  if (!inScope) return allNull(kind, PG_SETTINGS, PG_SOURCE, R.NOT_DECLARED); // no query is made
  const env = { ...process.env, PGCONNECT_TIMEOUT: '3' };
  let r;
  if (entry.container) r = await exec('docker', ['exec', entry.container, 'psql', ...pgArgs(entry.connection)], { timeoutMs, tier: 'once', ctx, opts: { env } });
  else r = await exec('psql', pgArgs(entry.connection), { timeoutMs, tier: 'once', ctx, opts: { env } });
  const reason = reasonFromExec(r, { timeoutMs });
  if (reason) return allNull(kind, PG_SETTINGS, PG_SOURCE, reason === R.FAILED ? 'unavailable (the database did not answer)' : reason);
  const parsed = parsePgSettings(r.stdout);
  if (!parsed) return allNull(kind, PG_SETTINGS, PG_SOURCE, 'unavailable (the database reply was not understood)');
  return parsed.map((p) => fact(kind, p.name, p.value, PG_SOURCE));
}

function collectWsl({ vmApi = vm, readConfiguredCap }) {
  const cap = (readConfiguredCap || vmApi.readConfiguredCap)();
  return [fact('wsl', 'memoryCapMB', cap.value, cap.source, cap.unavailableReason || null, cap.value !== null ? { unit: 'MB' } : {})];
}

// entries: scope-file config[] ; returns the flat workloadConfig[] list
async function collectConfigFacts({ entries, exec, resolver, ctx = null, readConfiguredCap }) {
  const out = [];
  for (const e of entries || []) {
    if (e.kind === 'postgres') out.push(...await collectPostgres({ entry: e, exec, resolver, ctx }));
    else if (e.kind === 'wsl') out.push(...collectWsl({ readConfiguredCap }));
  }
  return out;
}

module.exports = { collectConfigFacts, collectPostgres, collectWsl, parsePgSettings, pgArgs, PG_SETTINGS };
