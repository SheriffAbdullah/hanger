'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseTasklist, rollup } = require('../lib/numbers');
const { excludeSelf, excludeSelfTree } = require('../lib/self');

const csv = [
  '"node.exe","4242","Console","1","2,700,000 K"',
  '"node.exe","5000","Console","1","300,000 K"',
  '"tasklist.exe","4300","Console","1","9,000 K"',
  '"chrome.exe","6000","Console","1","500,000 K"',
].join('\n');

test('canned tasklist containing the tool PID yields no row with that PID', () => {
  const selfSet = new Set([4242, 4300]);
  const { rows, observer } = excludeSelf(parseTasklist(csv), selfSet);
  assert.ok(!rows.some((r) => selfSet.has(r.pid)));
  assert.strictEqual(observer.n, 2);
  assert.ok(observer.wsMB > 2500);
  const groups = rollup(rows);
  const node = groups.find((g) => g.name === 'node.exe');
  assert.ok(node.totalMB < 400, 'the other node.exe group does not absorb the tool memory');
});

test('descendants of the tool are excluded from ppid-bearing snapshots', () => {
  const rows = [{ pid: 1, ppid: 0, name: 'a' }, { pid: 2, ppid: 1, name: 'child' }, { pid: 3, ppid: 2, name: 'grandchild' }, { pid: 9, ppid: 0, name: 'other' }];
  assert.deepStrictEqual(excludeSelfTree(rows, new Set([1])).map((r) => r.pid), [9]);
});
