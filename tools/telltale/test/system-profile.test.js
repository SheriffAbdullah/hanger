'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sp = require('../lib/system-profile');
const { checkProfile } = require('./helpers/profile-walk');
const { scrubValue } = require('../lib/anonymize');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', 'system-profile', n), 'utf8');
const NOW = new Date('2026-10-07T10:00:00.000Z');
const parse = (name, o = {}) => sp.parseProfile(fx(name), Object.assign({ now: NOW }, o));
const allLeaves = (p) => { const a = []; sp.walkFacts(p, (f, k) => a.push([k, f])); return a; };

// ---- fact record
test('fact record: null always carries a reason, no empty strings, provenance present', () => {
  const a = sp.fact('', { source: 's', tier: 'user' });
  assert.strictEqual(a.value, null);
  assert.strictEqual(a.unavailableReason, 'empty value from source');
  const b = sp.fact(null, { source: 's', tier: 'user' });
  assert.ok(b.unavailableReason.length > 0);
  const c = sp.fact(NaN, { source: 's' });
  assert.strictEqual(c.value, null);
  assert.ok(c.unavailableReason);
  const d = sp.fact(0, { source: 's', tier: 'user' });
  assert.strictEqual(d.value, 0); // zero is real when the source reported zero
  assert.strictEqual(d.unavailableReason, undefined);
  assert.match(d.asOf, /^\d{4}-\d{2}-\d{2}T/);
  assert.strictEqual(d.tier, 'user');
});

// ---- walk helper fails on a broken fixture and passes on a good one
test('provenance walker: passes a good profile, flags a deliberately broken one', () => {
  const good = parse('full.txt');
  assert.deepStrictEqual(checkProfile(good), []);
  const bad = JSON.parse(JSON.stringify(good));
  bad.processor.model.source = '';
  bad.processor.physicalCores.tier = 'root';
  bad.memory.installedGB.asOf = 'yesterday';
  bad.os.edition.value = '';
  bad.firmware.biosVersion.value = null; delete bad.firmware.biosVersion.unavailableReason;
  const probs = checkProfile(bad);
  assert.ok(probs.some((p) => /processor\.model: missing source/.test(p)), probs.join('\n'));
  assert.ok(probs.some((p) => /bad tier/.test(p)));
  assert.ok(probs.some((p) => /asOf not ISO/.test(p)));
  assert.ok(probs.some((p) => /empty-string value/.test(p)));
  assert.ok(probs.some((p) => /null without reason/.test(p)));
});

test('every leaf of the full fixture has source, tier and ISO asOf', () => {
  const leaves = allLeaves(parse('full.txt'));
  assert.ok(leaves.length > 30);
  for (const [k, f] of leaves) {
    assert.ok(f.source, k);
    assert.ok(['user', 'admin', 'user-input'].includes(f.tier), k);
    assert.match(f.asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, k);
  }
});

// ---- failed source / unknown never zero
test('failed source yields null with reason; empty firmware block, no empty strings anywhere', () => {
  const p = sp.parseProfile('###firmware###\n###processor###\nmodel=X\ncores=2\nlogical=4\nbaseMHz=1000\n', { now: NOW });
  assert.strictEqual(p.firmware.biosVersion.value, null);
  assert.ok(p.firmware.biosVersion.unavailableReason.length > 0);
  for (const [k, f] of allLeaves(p)) assert.notStrictEqual(f.value, '', k);
  assert.deepStrictEqual(checkProfile(p), []);
});

test('unknown is never zero: missing module speed is null with a reason', () => {
  const p = parse('partial-timeout.txt');
  const m = p.memory.modules.value[0];
  assert.strictEqual(m.speedMTs, null);
  assert.ok(m.speedUnavailableReason);
  assert.strictEqual(p.identity.serial.value, null);
  assert.ok(p.identity.serial.unavailableReason);
});

// ---- processor
test('cores and threads are separate facts; digest never says "12 cores"', () => {
  const p = parse('full.txt');
  assert.strictEqual(p.processor.physicalCores.value, 10);
  assert.strictEqual(p.processor.logicalProcessors.value, 12);
  assert.strictEqual(p.processor.physicalCores.unit, 'cores');
  assert.strictEqual(p.processor.logicalProcessors.unit, 'threads');
  assert.strictEqual(p.processor.baseClockMHz.value, 1700);
  assert.strictEqual(p.processor.maxClockMHz.value, null);
  assert.ok(p.processor.maxClockMHz.unavailableReason);
  const line = sp.digestLine(p);
  assert.ok(!/12 cores/.test(line), line);
  assert.match(line, /10C\/12T/);
});

// ---- memory
test('two-module laptop', () => {
  const p = parse('full.txt');
  assert.strictEqual(p.memory.installedGB.value, 16);
  assert.strictEqual(p.memory.modules.value.length, 2);
  for (const m of p.memory.modules.value) { assert.strictEqual(m.sizeGB, 8); assert.strictEqual(m.speedMTs, 3200); assert.strictEqual(m.formFactor, 'SODIMM'); }
  assert.strictEqual(p.memory.slotsUsed.value, 2);
  assert.strictEqual(p.memory.slotsTotal.value, 2);
});

test('slot count not exposed: slotsTotal null with reason, modules still recorded', () => {
  const p = parse('partial-timeout.txt');
  assert.strictEqual(p.memory.slotsTotal.value, null);
  assert.ok(p.memory.slotsTotal.unavailableReason);
  assert.strictEqual(p.memory.modules.value.length, 1);
});

// ---- storage
test('NVMe SSD recorded with system volume', () => {
  const p = parse('full.txt');
  const d = p.storage.disks.value[0];
  assert.strictEqual(d.mediaType, 'SSD');
  assert.strictEqual(d.bus, 'NVMe');
  assert.strictEqual(d.capacityGB, 512);
  assert.strictEqual(d.health, 'Healthy');
  assert.strictEqual(typeof p.storage.systemVolume.value.freeGB, 'number');
  assert.strictEqual(typeof p.storage.systemVolume.value.totalGB, 'number');
  assert.strictEqual(p.storage.systemVolume.value.volume, 'C:');
});

test('disk health unreadable at user tier: null with tier reason, other disk facts present', () => {
  const t = fx('full.txt').replace('|Healthy', '|');
  const p = sp.parseProfile(t, { now: NOW });
  const d = p.storage.disks.value[0];
  assert.strictEqual(d.health, null);
  assert.match(d.healthUnavailableReason, /user tier/);
  assert.strictEqual(d.model, 'SAMSUNG MZVLQ512HBLU');
  assert.strictEqual(d.mediaType, 'SSD');
  assert.strictEqual(d.capacityGB, 512);
});

// ---- graphics
test('integrated adapter recorded; capped memory flagged as lower bound', () => {
  const p = parse('full.txt');
  const a = p.graphics.adapters.value[0];
  assert.ok(a.name && a.driverVersion);
  assert.match(a.driverDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!a.lowerBound);
  const capped = sp.parseProfile('###graphics###\nrow:adapter|Old GPU|4294967295|1.0|2020-01-02\n', { now: NOW });
  assert.strictEqual(capped.graphics.adapters.value[0].lowerBound, true);
});

// ---- firmware / OS / identity
test('serial read from firmware source; placeholder serial is not accepted', () => {
  const p = parse('full.txt');
  assert.strictEqual(p.identity.serial.value, '5CD1234XYZ');
  assert.strictEqual(p.identity.serial.source, 'firmware-bios');
  const ph = sp.parseProfile('###firmware###\nserial=To Be Filled By O.E.M.\n', { now: NOW });
  assert.strictEqual(ph.identity.serial.value, null);
  assert.match(ph.identity.serial.unavailableReason, /placeholder/);
  assert.strictEqual(p.firmware.biosVersion.value, 'U85 Ver. 01.19.01');
  assert.strictEqual(p.firmware.biosDate.value, '2024-05-01');
  assert.strictEqual(p.os.build.value, '26200');
  assert.strictEqual(p.os.vbs.value, 'running');
  assert.strictEqual(p.os.memoryIntegrity.value, 'running');
  assert.strictEqual(p.os.uptimeMin.value, 1796); // 2026-10-06T04:03:53Z to 2026-10-07T10:00:00Z
});

test('user serial override is recorded as user input', () => {
  const p = parse('full.txt', { userInput: { serial: 'MY-SERIAL-1' } });
  assert.strictEqual(p.identity.serial.value, 'MY-SERIAL-1');
  assert.strictEqual(p.identity.serial.source, 'user-input');
  assert.strictEqual(p.identity.serial.tier, 'user-input');
});

test('anonymized run keeps serial, hides hostname; plain run shows hostname', () => {
  const a = parse('full.txt', { anonymize: true });
  assert.strictEqual(a.identity.hostname.value, '<host>');
  assert.strictEqual(a.identity.serial.value, '5CD1234XYZ');
  const plain = parse('full.txt');
  assert.strictEqual(plain.identity.hostname.value, 'LAPTOP-TESTHOST');
  const scrubbed = scrubValue(plain, { hostname: 'LAPTOP-TESTHOST', username: 'nobody-here' });
  assert.strictEqual(scrubbed.identity.serial.value, '5CD1234XYZ');
  assert.strictEqual(scrubbed.identity.hostname.value, '<host>');
});

// ---- power
test('plan name is a friendly name, never a bare identifier (nested parens ok)', () => {
  assert.strictEqual(sp.parsePlanName('Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)'), 'Balanced');
  assert.strictEqual(sp.parsePlanName('Power Scheme GUID: fb5220ff-7e1a-47aa-9a42-50ffbf45c673  (HP Optimized (Modern Standby))'), 'HP Optimized (Modern Standby)');
  assert.strictEqual(sp.parsePlanName('Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e'), null);
  const p = parse('full.txt');
  assert.strictEqual(p.power.planName.value, 'Balanced');
  assert.match(p.power.powerMode.value, /Best performance/);
});

test('battery health at user tier: 45000 and 40500 mWh give 90 percent', () => {
  const p = parse('full.txt');
  assert.strictEqual(p.power.batteryDesignWh.value, 45);
  assert.strictEqual(p.power.batteryFullChargeWh.value, 40.5);
  assert.strictEqual(p.power.batteryHealthPct.value, 90);
  assert.strictEqual(p.power.batteryHealthPct.tier, 'user');
});

test('no battery: battery facts null with reason "no battery present", never zero', () => {
  const p = parse('no-battery-no-docker.txt');
  for (const k of ['batteryDesignWh', 'batteryFullChargeWh', 'batteryHealthPct']) {
    assert.strictEqual(p.power[k].value, null, k);
    assert.strictEqual(p.power[k].unavailableReason, 'no battery present', k);
  }
});

test('battery capacity unreadable at user tier names the tier; admin fallback fills it and is labelled admin', () => {
  const t = '###power###\nscheme=Power Scheme GUID: x  (Balanced)\nbatteryPresent=True\nerr:designMWh=Generic failure\nfullMWh=36025\n';
  const u = sp.parseProfile(t, { now: NOW });
  assert.strictEqual(u.power.batteryHealthPct.value, null);
  assert.match(u.power.batteryHealthPct.unavailableReason, /user tier/);
  const e = sp.parseProfile(t + '###batteryAdmin###\ndesignMWh=40000\nfullMWh=36000\n', { now: NOW, elevated: true });
  assert.strictEqual(e.power.batteryHealthPct.value, 90);
  assert.strictEqual(e.power.batteryHealthPct.tier, 'admin');
  assert.strictEqual(e.power.batteryDesignWh.tier, 'admin');
});

// ---- virtual memory
test('system-managed pagefile with commit limit', () => {
  const p = parse('full.txt');
  assert.strictEqual(p.virtualMemory.systemManaged.value, true);
  assert.strictEqual(p.virtualMemory.pagefiles.value.length, 1);
  assert.strictEqual(p.virtualMemory.pagefiles.value[0].location, 'C:\\pagefile.sys');
  assert.strictEqual(p.virtualMemory.pagefiles.value[0].currentMB, 15814);
  assert.ok(p.virtualMemory.pagefiles.value[0].maxUnavailableReason);
  assert.ok(p.virtualMemory.commitLimitGB.value > 0);
});

// ---- virtualization
test('WSL present, Docker absent', () => {
  const p = parse('full.txt');
  assert.strictEqual(p.virtualization.wslVersion.value, '2.3.26.0');
  assert.strictEqual(p.virtualization.wslInstalled.value, true);
  assert.strictEqual(p.virtualization.dockerDesktopVersion.value, null);
  assert.strictEqual(p.virtualization.dockerDesktopVersion.unavailableReason, 'not installed');
  assert.strictEqual(p.virtualization.dockerDesktopLimits.value, null);
});

test('Docker Desktop configured limits come from settings only', () => {
  const t = '###virt###\nrow:wsl|WSL version: 2.1.0.0\ndockerVersion=4.30.0\ndockerMemoryMiB=8192\ndockerCpus=4\n';
  const p = sp.parseProfile(t, { now: NOW });
  assert.strictEqual(p.virtualization.dockerDesktopVersion.value, '4.30.0');
  assert.deepStrictEqual(p.virtualization.dockerDesktopLimits.value, { memoryMiB: 8192, cpus: 4 });
});

test('no workload started by profiling: recording shell stub sees no container or distro command', () => {
  const seen = [];
  const shell = (script) => { seen.push(script); return { stdout: fx('full.txt') }; };
  sp.collectProfile({ shell, now: NOW });
  sp.collectProfile({ shell, now: NOW, elevated: true });
  assert.strictEqual(seen.length, 2);
  for (const s of seen) {
    assert.ok(!/\bdocker(\.exe)?\s+(run|exec|ps|inspect|stats|start|container|compose|info|version)\b/i.test(s), 'docker command found');
    assert.ok(!/wsl(\.exe)?\s+(-d|--distribution|-l|--list|-e|--exec|--status|--shutdown|-u)\b/i.test(s), 'wsl distro command found');
    assert.ok(/wsl\.exe --version/.test(s), 'only the version query is allowed');
    assert.ok(!/(Start-Process|Invoke-Command|New-Item|Stop-Service|Restart-|Install-|Enable-|Disable-|Set-Content|Out-File)/i.test(s), 'script must be read-only');
  }
});

// ---- security
test('registered security product named; no other software listed', () => {
  const p = parse('full.txt');
  assert.deepStrictEqual(p.security.products.value, [{ name: 'Windows Defender', state: 'enabled, signatures up to date' }]);
  assert.strictEqual(p.security.domainJoined.value, false);
  assert.strictEqual(p.security.azureAdJoined.value, true);
  assert.strictEqual(p.security.mdmEnrolled.value, true);
  const text = JSON.stringify(p);
  assert.ok(!/Slack|Postgres/.test(text), 'unrelated application names must not appear in the profile');
});

test('group failure reasons: ERROR block and missing block', () => {
  const p = parse('no-battery-no-docker.txt');
  assert.strictEqual(p.security.products.value, null);
  assert.match(p.security.products.unavailableReason, /source error: access denied/);
  assert.strictEqual(p.identity.manufacturer.value, null);
  assert.strictEqual(p.identity.manufacturer.unavailableReason, 'no output from source');
});

// ---- locale
test('de-DE style fixture: comma/dot numbers and dd.MM.yyyy dates parse correctly', () => {
  const p = parse('de-DE.txt');
  assert.strictEqual(p.processor.baseClockMHz.value, 2400);
  assert.strictEqual(p.memory.installedGB.value, 8);
  assert.strictEqual(p.memory.modules.value[0].speedMTs, 3200);
  assert.strictEqual(p.storage.systemVolume.value.freeGB, 112.2);
  assert.strictEqual(p.firmware.biosDate.value, '2026-10-07');
  assert.strictEqual(p.os.lastBoot.value, '2026-10-06T04:03:53.000Z');
  assert.strictEqual(sp.parseNum('1,5'), 1.5);
  assert.strictEqual(sp.parseNum('1.234,5'), 1234.5);
  assert.strictEqual(sp.parseNum('abc'), null);
  assert.strictEqual(sp.parseDate('not a date'), null);
});

// ---- tier gating
test('unelevated run labels admin facts; elevated run fills them', () => {
  const p = parse('full.txt');
  assert.strictEqual(p.tier, 'user');
  for (const f of [p.storage.wearPct, p.virtualization.vmPlatform, p.virtualization.hyperV]) {
    assert.strictEqual(f.value, null);
    assert.strictEqual(f.tier, 'admin');
    assert.strictEqual(f.unavailableReason, 'requires elevation');
  }
  const t = fx('full.txt') + '###storageAdmin###\nwearPct=7\n###features###\nvmPlatform=Enabled\nhyperV=Disabled\n';
  const e = sp.parseProfile(t, { now: NOW, elevated: true });
  assert.strictEqual(e.tier, 'admin');
  assert.strictEqual(e.storage.wearPct.value, 7);
  assert.strictEqual(e.storage.wearPct.tier, 'admin');
  assert.strictEqual(e.virtualization.vmPlatform.value, true);
  assert.strictEqual(e.virtualization.hyperV.value, false);
  assert.strictEqual(e.virtualization.hyperV.tier, 'admin');
  assert.deepStrictEqual(checkProfile(e), []);
  assert.deepStrictEqual(checkProfile(p), []);
});

test('the unelevated script has no admin-only query; the elevated one adds them', () => {
  const u = sp.buildScript({ elevated: false });
  const e = sp.buildScript({ elevated: true });
  assert.ok(!/Get-StorageReliabilityCounter|Get-WindowsOptionalFeature|batteryreport/.test(u));
  assert.ok(/Get-StorageReliabilityCounter/.test(e) && /Get-WindowsOptionalFeature/.test(e));
});

// ---- bounded cost
test('slow group times out alone: storage null with "timeout after", others keep values, collectionMs recorded', () => {
  const p = sp.collectProfile({ shell: () => ({ stdout: fx('partial-timeout.txt') }), now: NOW });
  assert.strictEqual(p.storage.disks.value, null);
  assert.match(p.storage.disks.unavailableReason, /^timeout after 8000 ms/);
  assert.match(p.storage.systemVolume.unavailableReason, /^timeout after/);
  assert.strictEqual(p.processor.model.value, 'Test CPU');
  assert.strictEqual(p.memory.installedGB.value, 8);
  assert.strictEqual(p.firmware.biosVersion.value, 'U1');
  assert.ok(p.collectionMs > 0);
  assert.strictEqual(p.collectedAt, NOW.toISOString());
});

test('overall timeout or spawn failure: every group null with a reason, profile still returned', () => {
  const t = sp.collectProfile({ shell: () => ({ stdout: '', timedOut: true }), now: NOW, overallTimeoutMs: 1234 });
  assert.match(t.processor.model.unavailableReason, /timeout after 1234 ms/);
  const th = sp.collectProfile({ shell: () => { throw new Error('boom'); }, now: NOW });
  assert.match(th.processor.model.unavailableReason, /collector threw: boom/);
  assert.deepStrictEqual(checkProfile(t), []);
  assert.deepStrictEqual(checkProfile(th), []);
});

test('script gives each group its own time limit', () => {
  const s = sp.buildScript({ limitMs: 4321 });
  assert.match(s, /\$limit = 4321/);
  assert.match(s, /TIMEOUT/);
  assert.match(s, /runspacefactory/);
});

// ---- report assembly helpers
test('legacy asset alias derives from the profile', () => {
  const p = parse('full.txt');
  const a = sp.deriveAsset(p, {});
  assert.strictEqual(a.serial, p.identity.serial.value);
  assert.strictEqual(a.manufacturer, 'HP');
  assert.strictEqual(a.ramFittedGB, 16);
  assert.match(a.diskNote, /^C: 121\.1\/475\.0GB free$/);
  assert.strictEqual(a.diskFreePct, 25.5);
  assert.strictEqual(a.osCaption, 'Microsoft Windows 11 Business');
  assert.match(a.osBuild, /build 26200/);
  const empty = sp.deriveAsset(sp.parseProfile('', { now: NOW }), {});
  assert.strictEqual(empty.serial, 'unknown');
  assert.strictEqual(empty.ramFittedGB, null);
});

test('console digest names model, processor, memory and OS build', () => {
  const line = sp.digestLine(parse('full.txt'));
  assert.ok(line.startsWith('[profile] '));
  assert.match(line, /ProBook/);
  assert.match(line, /i7-1255U/);
  assert.match(line, /16 GB/);
  assert.match(line, /NVMe SSD/);
  assert.match(line, /OS build 26200/);
  assert.match(line, /BIOS U85/);
  assert.match(sp.digestLine(sp.parseProfile('', { now: NOW })), /unavailable/);
});

test('module is side-effect free; off-Windows collection is null-with-reason', () => {
  assert.strictEqual(typeof sp.collectProfile, 'function');
  if (process.platform !== 'win32') assert.match(sp.collectProfile({}).processor.model.unavailableReason, /Windows-only/);
});
