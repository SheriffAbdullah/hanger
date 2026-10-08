'use strict';
// Walk every fact record in a system profile; return a list of provenance problems.
const { walkFacts } = require('../../lib/system-profile');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const TIERS = ['user', 'admin', 'user-input'];

function checkProfile(profile) {
  const problems = [];
  let leaves = 0;
  walkFacts(profile, (f, p) => {
    leaves++;
    if (!f.source || typeof f.source !== 'string') problems.push(`${p}: missing source`);
    if (!TIERS.includes(f.tier)) problems.push(`${p}: bad tier ${f.tier}`);
    if (typeof f.asOf !== 'string' || !ISO.test(f.asOf)) problems.push(`${p}: asOf not ISO-8601`);
    if (f.value === '') problems.push(`${p}: empty-string value`);
    if (f.value === null && !(typeof f.unavailableReason === 'string' && f.unavailableReason.trim())) problems.push(`${p}: null without reason`);
    const deep = (v, q) => {
      if (v === '') problems.push(`${q}: empty string inside value`);
      else if (Array.isArray(v)) v.forEach((x, i) => deep(x, `${q}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) deep(x, `${q}.${k}`);
    };
    deep(f.value, `${p}.value`);
  });
  if (leaves === 0) problems.push('no fact records found');
  return problems;
}
module.exports = { checkProfile };
