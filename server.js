const express = require('express'), bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+, no native build needed
const jwt = require('jsonwebtoken'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const { splitAmount, netBalances, simplify } = require('./lib/settle');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) { console.error('JWT_SECRET (16+ chars) is required'); process.exit(1); }

const db = new DatabaseSync(process.env.DB_PATH || 'data.db');
const tx = (f) => { db.exec('BEGIN'); try { const r = f(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
db.exec(`
PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grps(id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS members(group_id INTEGER REFERENCES grps(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id), PRIMARY KEY(group_id,user_id));
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES grps(id) ON DELETE CASCADE, payer_id INTEGER NOT NULL REFERENCES users(id), cents INTEGER NOT NULL, descr TEXT NOT NULL, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS splits(expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id), cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settlements(id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES grps(id) ON DELETE CASCADE, from_id INTEGER NOT NULL REFERENCES users(id), to_id INTEGER NOT NULL REFERENCES users(id), cents INTEGER NOT NULL, at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

const E = (s, m) => Object.assign(new Error(m), { status: s });
const h = (f) => (q, r, n) => { try { f(q, r); } catch (e) { n(e); } };
const toCents = (x) => { const c = Math.round(Number(x) * 100); if (!Number.isFinite(c) || c <= 0 || c > 1e10) throw E(400, 'Amount must be a positive number'); return c; };
const sign = (id) => jwt.sign({ id }, SECRET, { expiresIn: '7d' });

const auth = (q, r, n) => { try { q.uid = jwt.verify((q.headers.authorization || '').slice(7), SECRET).id; n(); } catch { n(E(401, 'Please log in again')); } };
const member = (q, r, n) => {
  q.gid = +q.params.id;
  if (!db.prepare('SELECT 1 FROM members WHERE group_id=? AND user_id=?').get(q.gid, q.uid)) return n(E(404, 'Group not found'));
  n();
};

const mem = (g) => db.prepare('SELECT u.id,u.name,u.email FROM members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY u.name').all(g);
const net = (g) => {
  const a = (sql) => db.prepare(sql).all(g);
  return netBalances(mem(g).map((m) => m.id),
    a('SELECT payer_id id, SUM(cents) cents FROM expenses WHERE group_id=? GROUP BY payer_id'),
    a('SELECT s.user_id id, SUM(s.cents) cents FROM splits s JOIN expenses e ON e.id=s.expense_id WHERE e.group_id=? GROUP BY s.user_id'),
    a('SELECT from_id,to_id,cents FROM settlements WHERE group_id=?'));
};
const state = (g) => {
  const balances = net(g);
  return {
    group: db.prepare('SELECT id,name,owner_id FROM grps WHERE id=?').get(g), members: mem(g), balances, transfers: simplify(balances),
    expenses: db.prepare("SELECT e.id,e.descr,e.cents,e.payer_id,e.at,(SELECT json_group_array(json_object('u',user_id,'c',cents)) FROM splits WHERE expense_id=e.id) splits FROM expenses e WHERE group_id=? ORDER BY e.id DESC").all(g).map((e) => ({ ...e, splits: JSON.parse(e.splits) })),
  };
};

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, message: { error: 'Too many attempts, try again later' } });

app.post('/api/register', limiter, h((q, r) => {
  const { email, name, password } = q.body || {};
  if (!/^\S+@\S+\.\S+$/.test(email || '') || !String(name || '').trim() || String(password || '').length < 8)
    throw E(400, 'Valid email, name and a password of 8+ characters are required');
  try {
    const i = db.prepare('INSERT INTO users(email,name,hash) VALUES(?,?,?)').run(email.toLowerCase(), name.trim().slice(0, 60), bcrypt.hashSync(password, 10));
    r.status(201).json({ token: sign(i.lastInsertRowid), name: name.trim(), id: i.lastInsertRowid });
  } catch (e) { if (/UNIQUE/.test(String(e.message))) throw E(409, 'Email already registered'); throw e; }
}));
app.post('/api/login', limiter, h((q, r) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(q.body?.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(String(q.body?.password || ''), u.hash)) throw E(401, 'Wrong email or password');
  r.json({ token: sign(u.id), name: u.name, id: u.id });
}));

app.get('/api/groups', auth, h((q, r) => r.json(db.prepare('SELECT g.id,g.name FROM grps g JOIN members m ON m.group_id=g.id WHERE m.user_id=? ORDER BY g.id DESC').all(q.uid))));
app.post('/api/groups', auth, h((q, r) => {
  const name = String(q.body?.name || '').trim();
  if (!name || name.length > 60) throw E(400, 'Group name is required (max 60 chars)');
  const id = tx(() => {
    const g = db.prepare('INSERT INTO grps(name,owner_id) VALUES(?,?)').run(name, q.uid).lastInsertRowid;
    db.prepare('INSERT INTO members VALUES(?,?)').run(g, q.uid); return g;
  });
  r.status(201).json({ id });
}));
app.get('/api/groups/:id', auth, member, h((q, r) => r.json(state(q.gid))));

app.post('/api/groups/:id/members', auth, member, h((q, r) => {
  if (db.prepare('SELECT owner_id FROM grps WHERE id=?').get(q.gid).owner_id !== q.uid) throw E(403, 'Only the group owner can add members');
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(String(q.body?.email || '').toLowerCase());
  if (!u) throw E(404, 'No registered user with that email — ask them to sign up first');
  if (db.prepare('SELECT 1 FROM members WHERE group_id=? AND user_id=?').get(q.gid, u.id)) throw E(409, 'Already a member');
  db.prepare('INSERT INTO members VALUES(?,?)').run(q.gid, u.id);
  r.status(201).json(state(q.gid));
}));

app.post('/api/groups/:id/expenses', auth, member, h((q, r) => {
  const { description, amount, payerId, mode = 'equal', data = {} } = q.body || {};
  if (!String(description || '').trim()) throw E(400, 'Description is required');
  const cents = toCents(amount), ids = mem(q.gid).map((m) => m.id);
  if (!ids.includes(payerId)) throw E(400, 'Payer must be a group member');
  let shares; try { shares = splitAmount(cents, mode, ids, data); } catch (e) { throw E(400, e.message); }
  tx(() => {
    const id = db.prepare('INSERT INTO expenses(group_id,payer_id,cents,descr) VALUES(?,?,?,?)').run(q.gid, payerId, cents, description.trim().slice(0, 100)).lastInsertRowid;
    for (const [u, c] of Object.entries(shares)) db.prepare('INSERT INTO splits VALUES(?,?,?)').run(id, +u, c);
  });
  r.status(201).json(state(q.gid));
}));
app.delete('/api/groups/:id/expenses/:eid', auth, member, h((q, r) => {
  const e = db.prepare('SELECT payer_id FROM expenses WHERE id=? AND group_id=?').get(+q.params.eid, q.gid);
  if (!e) throw E(404, 'Expense not found');
  if (e.payer_id !== q.uid && db.prepare('SELECT owner_id FROM grps WHERE id=?').get(q.gid).owner_id !== q.uid) throw E(403, 'Only the payer or group owner can delete this');
  db.prepare('DELETE FROM expenses WHERE id=?').run(+q.params.eid);
  r.json(state(q.gid));
}));

app.post('/api/groups/:id/settlements', auth, member, h((q, r) => {
  const cents = toCents(q.body?.amount), to = q.body?.toId;
  if (to === q.uid || !mem(q.gid).some((m) => m.id === to)) throw E(400, 'Pick another group member to pay');
  const mine = net(q.gid)[q.uid];
  if (!(mine < 0) || cents > -mine) throw E(409, 'That is more than you currently owe');
  db.prepare('INSERT INTO settlements(group_id,from_id,to_id,cents) VALUES(?,?,?,?)').run(q.gid, q.uid, to, cents);
  r.status(201).json(state(q.gid));
}));

app.use('/api', (q, r, n) => n(E(404, 'Not found')));
app.use((e, q, r, n) => {
  if (e.type === 'entity.parse.failed') e = E(400, 'Malformed JSON');
  const s = e.status || 500; if (s === 500) console.error(e);
  r.status(s).json({ error: s === 500 ? 'Internal server error' : e.message });
});
const port = process.env.PORT || 3000;
if (require.main === module) app.listen(port, () => console.log(`SettleUp on :${port}`));
module.exports = app;
