const $ = (s) => document.querySelector(s), app = $('#app');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hue = (s) => ([...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360;
const av = (n, sz = '') => `<i class="av ${sz}" style="--h:${hue(n)}">${esc(String(n).trim()[0] || '?').toUpperCase()}</i>`;
const chip = (c) => `<span class="chip ${c > 0 ? 'pos' : c < 0 ? 'neg' : 'zero'}">${c > 0 ? '+' : ''}${inr(c)}</span>`;
const inr = (c) => (c < 0 ? '-' : '') + '₹' + (Math.abs(c) / 100).toFixed(2);
let token = localStorage.t, name = localStorage.n, myId = +localStorage.i, cur = null, authMode = 'login';

function toast(m, bad) { const t = $('#toast'); t.textContent = m; t.className = bad ? 'bad' : 'ok'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.textContent = ''), 4000); }
async function api(path, method = 'GET', body) {
  let r;
  try { r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) }); }
  catch { throw new Error('Network error — check your connection and try again'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { localStorage.clear(); token = null; setTimeout(view, 0); }
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}
const run = async (f) => { try { await f(); } catch (e) { toast(e.message, 1); } };

async function view() {
  $('#who').innerHTML = token ? `${av(name)}<span>${esc(name)}</span><button class="link" data-a="logout">Log out</button>` : '';
  if (!token) return authView();
  app.innerHTML = '<div class="app-view"><p class="mut">Loading…</p></div>';
  try { cur ? await groupView() : await groupsView(); } catch (e) { toast(e.message, 1); cur = null; app.innerHTML = '<div class="app-view"><button data-a="back">Retry</button></div>'; }
}
function authView() {
  const reg = authMode === 'reg';
  app.innerHTML = `<div class="hero-split">
    <div class="hero-promise">
      <section class="hero">
        <div class="hero-badge">✦ Smart Debt Simplification</div>
        <h2>Split bills.<br><span class="hero-emphasis">Not friendships.</span></h2>
        <p class="hero-lead">Track shared expenses and settle up with the fewest payments.</p>
      </section>
      <div class="facts-strip">
        <div class="fact-cell">
          <span class="fact-label">SETTLEMENT ENGINE</span>
          <span class="fact-val">Fewest Transfers</span>
        </div>
        <div class="fact-cell">
          <span class="fact-label">SPLIT CALCULATION</span>
          <span class="fact-val">Equal · Exact · %</span>
        </div>
        <div class="fact-cell">
          <span class="fact-label">LEDGER ACCURACY</span>
          <span class="fact-val">Sub-cent Precision</span>
        </div>
      </div>
    </div>
    <div class="hero-frame-wrap">
      <div class="framed-object">
        <form id="${reg ? 'reg' : 'login'}" class="card auth">
          <h2>${reg ? 'Create your account' : 'Welcome back'}</h2>
          <p class="auth-sub">${reg ? 'Sign up to start splitting expenses with friends' : 'Log in to manage your groups and debts'}</p>
          ${reg ? '<input type="text" name="name" placeholder="Your name" required maxlength="60" autocomplete="name">' : ''}
          <input type="email" name="email" placeholder="Email" required autocomplete="email">
          <input type="password" name="password" placeholder="Password (8+ characters)" required minlength="8" autocomplete="${reg ? 'new-password' : 'current-password'}">
          <button type="submit">${reg ? 'Sign up' : 'Log in'}</button>
          <button type="button" class="link auth-toggle" data-a="toggle">${reg ? 'Have an account? Log in' : 'New here? Sign up'}</button>
        </form>
      </div>
    </div>
  </div>`;
}
async function groupsView() {
  const gs = await api('/groups');
  app.innerHTML = `<div class="app-view">
    <div class="view-header"><h2>Your groups</h2></div>
    ${gs.length ? `<div class="grid">${gs.map((g) => `<button class="gcard" data-a="open" data-id="${g.id}">${av(g.name)}<span class="grow"><b>${esc(g.name)}</b><span class="sub">Open group →</span></span></button>`).join('')}</div>` : '<div class="card empty">No groups yet. Create your first one below 👇</div>'}
    <form id="newg" class="card"><h3>New group</h3><input type="text" name="name" placeholder="e.g. Goa Trip, Flat 4B" required maxlength="60"><button type="submit">Create group</button></form>
  </div>`;
}
async function groupView() {
  const s = await api('/groups/' + cur), nm = Object.fromEntries(s.members.map((m) => [m.id, m.name]));
  const isOwner = s.group.owner_id === myId, bal = s.balances[myId] || 0;
  app.innerHTML = `<div class="app-view">
    <div class="view-nav"><button class="link" data-a="back">← All groups</button></div>
    <div class="view-header"><h2>${esc(s.group.name)}</h2></div>
    <div class="card sum ${bal < 0 ? 'owe' : bal > 0 ? 'get' : 'settled'}">
      <span class="mut">${bal < 0 ? 'You owe' : bal > 0 ? 'You are owed' : 'You are all settled up ✓'}</span>
      ${bal ? `<b>${inr(Math.abs(bal))}</b>` : '<div class="settled-check">No outstanding debts 🎉</div>'}
    </div>
    <div class="card">
      <h3>Balances</h3>
      ${s.members.map((m) => `<div class="row">${av(m.name)}<span>${esc(m.name)}${m.id === myId ? ' <span class="sub">(you)</span>' : ''}</span>${chip(s.balances[m.id])}</div>`).join('')}
    </div>
    <div class="card">
      <h3>Suggested payments</h3>
      ${s.transfers.length ? s.transfers.map((t) => `<div class="row payment-process">${av(nm[t.from], 'sm')}<span class="process-connection"><span class="process-name">${esc(nm[t.from])}</span> <span class="process-arrow">⟶</span> <span class="process-name">${esc(nm[t.to])}</span> <b class="process-val">${inr(t.cents)}</b></span>${t.from === myId ? `<button data-a="settle" data-to="${t.to}" data-c="${t.cents}" class="settle-btn">Mark paid</button>` : ''}</div>`).join('') : '<div class="empty">Nobody owes anything 🎉</div>'}
    </div>
    <form id="exp" class="card"><details open><summary>Add expense</summary>
      <input type="text" name="description" placeholder="What was it for?" required maxlength="100">
      <input type="number" name="amount" step="0.01" min="0.01" placeholder="Total amount (₹)" required>
      <select name="payerId">${s.members.map((m) => `<option value="${m.id}" ${m.id === myId ? 'selected' : ''}>Paid by ${esc(m.name)}</option>`).join('')}</select>
      <select name="mode"><option value="equal">Split equally</option><option value="exact">Exact amounts (₹)</option><option value="percent">Percentages (%)</option></select>
      <p class="mut">Tick who shares it. For exact or percent, enter each person's value.</p>
      <div class="participants-list">
        ${s.members.map((m) => `<div class="row" data-u="${m.id}"><input type="checkbox" checked>${av(m.name, 'sm')}<span>${esc(m.name)}</span><input type="number" step="0.01" min="0" placeholder="value"></div>`).join('')}
      </div>
      <button type="submit">Add expense</button></details>
    </form>
    <div class="card">
      <h3>Expenses</h3>
      ${s.expenses.length ? s.expenses.map((e) => `<div class="row">${av(nm[e.payer_id])}<span>${esc(e.descr)}<br><span class="sub">${esc(nm[e.payer_id])} paid · ${new Date(e.at + 'Z').toLocaleDateString()}</span></span><b class="val-mono">${inr(e.cents)}</b>${e.payer_id === myId || isOwner ? `<button class="danger" data-a="del" data-id="${e.id}" title="Delete">✕</button>` : ''}</div>`).join('') : '<div class="empty">No expenses yet. Add the first one above.</div>'}
    </div>
    ${isOwner ? '<form id="addm" class="card"><h3>Add member</h3><input type="email" name="email" placeholder="Their registered email" required><button type="submit">Add member</button></form>' : ''}
  </div>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return; const d = b.dataset;
  run(async () => {
    if (d.a === 'logout') { localStorage.clear(); token = cur = null; }
    else if (d.a === 'toggle') authMode = authMode === 'reg' ? 'login' : 'reg';
    else if (d.a === 'back') cur = null;
    else if (d.a === 'open') cur = d.id;
    else if (d.a === 'del') { await api(`/groups/${cur}/expenses/${d.id}`, 'DELETE'); toast('Expense deleted'); }
    else if (d.a === 'settle') { await api(`/groups/${cur}/settlements`, 'POST', { toId: +d.to, amount: d.c / 100 }); toast('Payment recorded'); }
    await view();
  });
});
document.addEventListener('submit', (e) => {
  e.preventDefault(); const f = e.target, v = Object.fromEntries(new FormData(f));
  run(async () => {
    if (f.id === 'login' || f.id === 'reg') {
      const r = await api(f.id === 'reg' ? '/register' : '/login', 'POST', v);
      token = localStorage.t = r.token; name = localStorage.n = r.name; myId = r.id; localStorage.i = r.id;
    } else if (f.id === 'newg') { await api('/groups', 'POST', { name: v.name }); toast('Group created'); }
    else if (f.id === 'addm') { await api(`/groups/${cur}/members`, 'POST', { email: v.email }); toast('Member added'); }
    else if (f.id === 'exp') {
      const rows = [...f.querySelectorAll('.row[data-u]')].filter((r) => r.querySelector('[type=checkbox]').checked), data = {};
      if (v.mode === 'equal') data.participants = rows.map((r) => +r.dataset.u);
      else data[v.mode === 'exact' ? 'amounts' : 'percents'] = Object.fromEntries(rows.map((r) => [r.dataset.u, +r.querySelector('[type=number]').value || 0]));
      await api(`/groups/${cur}/expenses`, 'POST', { description: v.description, amount: +v.amount, payerId: +v.payerId, mode: v.mode, data });
      toast('Expense added');
    }
    await view();
  });
});
view();
