const test = require('node:test'), assert = require('node:assert');
const { splitAmount, netBalances, simplify } = require('../lib/settle');
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('equal split distributes leftover cents', () => {
  const s = splitAmount(100, 'equal', [1, 2, 3]);
  assert.equal(sum(s), 100); assert.deepEqual(Object.values(s).sort(), [33, 33, 34]);
});
test('equal split supports a subset of participants', () => {
  assert.deepEqual(splitAmount(1000, 'equal', [1, 2, 3], { participants: [1, 3] }), { 1: 500, 3: 500 });
});
test('exact split must match total', () => {
  assert.throws(() => splitAmount(1000, 'exact', [1, 2], { amounts: { 1: 4, 2: 5 } }), /add up/);
  assert.equal(sum(splitAmount(1000, 'exact', [1, 2], { amounts: { 1: 4, 2: 6 } })), 1000);
});
test('percent split sums exactly and rejects bad totals', () => {
  assert.equal(sum(splitAmount(1001, 'percent', [1, 2, 3], { percents: { 1: 33.3, 2: 33.3, 3: 33.4 } })), 1001);
  assert.throws(() => splitAmount(1000, 'percent', [1, 2], { percents: { 1: 50, 2: 40 } }), /100/);
});
test('rejects non-members and unknown modes', () => {
  assert.throws(() => splitAmount(100, 'equal', [1, 2], { participants: [9] }));
  assert.throws(() => splitAmount(100, 'weird', [1]));
});
test('simplify clears all debts with <= n-1 payments', () => {
  const net = netBalances([1, 2, 3, 4], [{ id: 1, cents: 4000 }], [{ id: 1, cents: 1000 }, { id: 2, cents: 1000 }, { id: 3, cents: 1000 }, { id: 4, cents: 1000 }], []);
  const t = simplify(net);
  assert.ok(t.length <= 3);
  t.forEach((p) => { net[p.from] += p.cents; net[p.to] -= p.cents; });
  assert.ok(Object.values(net).every((v) => v === 0));
});
test('settlements reduce balances', () => {
  const net = netBalances([1, 2], [{ id: 1, cents: 1000 }], [{ id: 2, cents: 1000 }], [{ from_id: 2, to_id: 1, cents: 1000 }]);
  assert.deepEqual(simplify(net), []);
});
