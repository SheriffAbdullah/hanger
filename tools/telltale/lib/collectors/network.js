'use strict';
// Aggregate network activity per adapter plus VPN-adapter presence. Never per process (declared non-goal).
const { rows, unavailable } = require('./common');

const DYNAMIC = [
  { path: '\\Network Interface(*)\\Bytes Received/sec', reducer: 'raw' }, { path: '\\Network Interface(*)\\Bytes Sent/sec', reducer: 'raw' },
  { path: '\\Network Interface(*)\\Packets Received Errors', reducer: 'raw' }, { path: '\\Network Interface(*)\\Packets Outbound Errors', reducer: 'raw' },
];

// advisory heuristic on the adapter description; the matched rule is stored so IT can verify it
const VPN_RULES = [
  ['anyconnect', /anyconnect/i], ['globalprotect', /globalprotect|pangp/i], ['fortinet', /fortinet|forticlient/i], ['wireguard', /wireguard|wintun/i],
  ['openvpn', /openvpn|tap-windows|\btap\b.*adapter/i], ['vpn', /\bvpn\b/i], ['zscaler', /zscaler/i], ['pulse-secure', /pulse secure|juniper/i], ['nordlynx', /nordlynx/i],
];
const PSEUDO = /loopback|isatap|teredo|6to4/i;

function vpnRule(name) {
  for (const [rule, re] of VPN_RULES) if (re.test(name)) return rule;
  return null;
}

function build(idx, { mk }) {
  const inR = rows(idx, 'network interface', 'bytes received/sec');
  const outR = new Map(rows(idx, 'network interface', 'bytes sent/sec').map((r) => [r.inst, r.v]));
  const errIn = new Map(rows(idx, 'network interface', 'packets received errors').map((r) => [r.inst, r.v]));
  const errOut = new Map(rows(idx, 'network interface', 'packets outbound errors').map((r) => [r.inst, r.v]));
  const adapters = [];
  for (const r of inR) {
    if (PSEUDO.test(r.inst) || !Number.isFinite(r.v)) continue;
    const out = outR.get(r.inst);
    const e1 = errIn.get(r.inst), e2 = errOut.get(r.inst);
    const rule = vpnRule(r.inst);
    const inBps = Math.round(r.v), outBps = Number.isFinite(out) ? Math.round(out) : null;
    adapters.push({ adapter: r.inst, inBps, outBps, errors: Number.isFinite(e1) || Number.isFinite(e2) ? Math.round((Number.isFinite(e1) ? e1 : 0) + (Number.isFinite(e2) ? e2 : 0)) : null,
      active: inBps + (outBps || 0) > 0, isVpn: rule !== null, vpnRule: rule });
  }
  void mk;
  const net = { prov: { unit: 'bytes/s', windowS: 2, n: 1, src: 'network.adapters@counterSession', prec: 1 }, adapters: adapters.length ? adapters : null };
  const failures = [];
  if (!adapters.length) { net.reason = 'not-exposed'; failures.push(unavailable('signals.network', 'net.adapters', 'not-exposed', 'no network adapter counters are exposed')); }
  return { net, failures };
}

module.exports = { DYNAMIC, build, vpnRule, id: 'signals.network', inference: 'net.aggregate' };
