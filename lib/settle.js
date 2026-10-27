// Pure money logic. All amounts are integer cents to avoid floating-point errors.
function splitAmount(total, mode, ids, data = {}) {
  const ok = (u) => ids.includes(+u);
  if (mode === 'equal') {
    const p = [...new Set((data.participants || ids).map(Number))];
    if (!p.length || !p.every(ok)) throw new Error('Choose at least one valid participant');
    const base = Math.floor(total / p.length);
    let rem = total - base * p.length;
    return Object.fromEntries(p.map((u) => [u, base + (rem-- > 0 ? 1 : 0)]));
  }
  if (mode === 'exact') {
    const e = Object.entries(data.amounts || {}).map(([u, v]) => [+u, Math.round(v * 100)]);
    if (!e.length || !e.every(([u, c]) => ok(u) && Number.isInteger(c) && c >= 0)) throw new Error('Invalid exact amounts');
    if (e.reduce((s, [, c]) => s + c, 0) !== total) throw new Error('Exact amounts must add up to the total');
    return Object.fromEntries(e);
  }
  if (mode === 'percent') {
    const e = Object.entries(data.percents || {}).map(([u, v]) => [+u, +v]);
    if (!e.length || !e.every(([u, v]) => ok(u) && v >= 0)) throw new Error('Invalid percentages');
    if (Math.abs(e.reduce((s, [, v]) => s + v, 0) - 100) > 0.001) throw new Error('Percentages must add up to 100');
    const sh = e.map(([u, v]) => [u, Math.floor((total * v) / 100)]);
    let rem = total - sh.reduce((s, [, c]) => s + c, 0);
    for (let i = 0; rem > 0; i = (i + 1) % sh.length) { sh[i][1]++; rem--; }
    return Object.fromEntries(sh);
  }
  throw new Error('Unknown split mode');
}

// net > 0: the group owes this person; net < 0: this person owes the group.
function netBalances(ids, paid, owed, settles) {
  const net = Object.fromEntries(ids.map((i) => [i, 0]));
  paid.forEach((r) => (net[r.id] += r.cents));
  owed.forEach((r) => (net[r.id] -= r.cents));
  settles.forEach((s) => { net[s.from_id] += s.cents; net[s.to_id] -= s.cents; });
  return net;
}

// Greedy: repeatedly match the largest debtor with the largest creditor.
// Produces at most n-1 payments for n people with non-zero balances.
function simplify(net) {
  const c = [], d = [];
  for (const [u, v] of Object.entries(net)) { if (v > 0) c.push([+u, v]); else if (v < 0) d.push([+u, -v]); }
  const out = [];
  while (c.length && d.length) {
    c.sort((a, b) => b[1] - a[1]); d.sort((a, b) => b[1] - a[1]);
    const m = Math.min(c[0][1], d[0][1]);
    out.push({ from: d[0][0], to: c[0][0], cents: m });
    c[0][1] -= m; d[0][1] -= m;
    if (!c[0][1]) c.shift();
    if (!d[0][1]) d.shift();
  }
  return out;
}
module.exports = { splitAmount, netBalances, simplify };
