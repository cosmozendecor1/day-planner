/* CosmoZen Launch Board inside Day Planner: one app, one login, one sync.
   Reads and writes the Supabase table dashboard_tasks with the same signed-in session the planner uses (row-level security: owner only).
   A planner task is linked to a Launch task by "#cz:<id>" in its notes. The database keeps both ticks in step (planner tick -> Launch Done and back). */
(() => {
'use strict';
const TABLE = 'dashboard_tasks', LBL = { done: 'Done', wip: 'In progress', blocked: 'Blocked' };
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const loadLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let rows = [], filter = 'all', query = '', closed = loadLS('cz.launch.closed', {}), loading = false, pulledAt = 0, errMsg = '', editing = null, editStatus = 'wip', openRows = {};
const dp = () => window.__dp || {};
const client = () => dp().client && dp().client();
const user = () => dp().user && dp().user();
const view = () => $('#view-launch');
const active = () => view() && view().classList.contains('active');
const toast = m => { const el = $('#toast'); if (!el) return; el.textContent = m; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2600); };
const links = id => ((dp().state || {}).tasks || []).filter(t => t.notes && new RegExp('#cz:' + id + '(?![a-z0-9])').test(t.notes));
const fmtLink = t => { const d = new Date(t.date + 'T00:00:00'), td = new Date(); td.setHours(0, 0, 0, 0); const diff = Math.round((d - td) / 864e5); return (diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : d.toLocaleDateString([], { day: 'numeric', month: 'short' })) + ' ' + t.end; };

async function pull() {
  const sb = client(), u = user();
  if (!sb || !u) { rows = []; render(); return; }
  if (loading) return; loading = true; errMsg = '';
  try {
    const { data, error } = await sb.from(TABLE).select('*').eq('deleted', false).order('group_order').order('task_order').limit(2000);
    if (error) throw error;
    rows = data || []; pulledAt = Date.now();
  } catch (e) { errMsg = /relation|does not exist|schema cache/i.test(e.message || '') ? 'The Launch Board table is missing in this Supabase project.' : (e.message || String(e)); }
  loading = false; render();
}

function groups() {
  const m = new Map();
  rows.forEach(r => { if (!m.has(r.group_title)) m.set(r.group_title, { title: r.group_title, order: r.group_order, live: r.group_live || '', items: [] }); const g = m.get(r.group_title); if (r.group_live && !g.live) g.live = r.group_live; g.items.push(r); });
  return [...m.values()].sort((a, b) => a.order - b.order).map(g => (g.items.sort((a, b) => a.task_order - b.task_order), g));
}

function render() {
  const el = view(); if (!el) return;
  const signed = !!user();
  if (!signed) {
    el.innerHTML = '<div class="card"><h3>🚀 Launch Board</h3><p class="muted">Sign in once in Settings and your Launch Board appears here, in the same app as your planner.</p><button class="primary-btn wide" data-view="settings">Go to Settings</button></div>'; return;
  }
  const all = rows, c = { done: 0, wip: 0, blocked: 0 }; all.forEach(r => c[r.status] = (c[r.status] || 0) + 1);
  const pct = all.length ? Math.round(100 * c.done / all.length) : 0, q = query.trim().toLowerCase();
  let html = `<div class="l-head"><div><h2 class="l-title">Launch Board</h2><span class="muted small">Getting CosmoZen live${pulledAt ? ' · updated ' + new Date(pulledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span></div><button class="icon-btn" data-lrefresh aria-label="Refresh">↻</button></div>
  <div class="l-stats"><div class="card l-stat ok"><b>${c.done}</b><span>Done</span></div><div class="card l-stat wip"><b>${c.wip}</b><span>In progress</span></div><div class="card l-stat blk"><b>${c.blocked}</b><span>Blocked</span></div><div class="card l-stat"><b>${all.length}</b><span>Total</span></div></div>
  <div class="bar l-bar${pct === 100 ? ' full' : ''}"><i style="width:${pct}%"></i></div><p class="muted small" style="margin:6px 0 12px">${pct}% done</p>
  <div class="seg l-seg">${[['all', 'All'], ['wip', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']].map(f => `<button data-lf="${f[0]}" class="${filter === f[0] ? 'on' : ''}">${f[1]}</button>`).join('')}</div>
  <input class="l-search" type="search" placeholder="Search tasks and notes" value="${esc(query)}" aria-label="Search Launch tasks">`;
  if (errMsg) html += `<p class="msg err small">${esc(errMsg)}</p>`;
  if (loading && !rows.length) html += '<p class="muted center">Loading your Launch Board…</p>';
  let shown = 0;
  groups().forEach(g => {
    const list = g.items.filter(r => (filter === 'all' || r.status === filter) && (!q || (r.title + ' ' + (r.note || '')).toLowerCase().includes(q)));
    if (!list.length && (filter !== 'all' || q)) return; shown += list.length;
    const dn = g.items.filter(r => r.status === 'done').length, shut = !!closed[g.title] && !q && filter === 'all';
    html += `<section class="card l-group${shut ? ' shut' : ''}"><button class="l-gh" data-lg="${esc(g.title)}"><h3>${esc(g.title)}</h3><span class="muted small">${dn}/${g.items.length}</span><i>▾</i></button>${g.live ? `<p class="muted small l-live">${esc(g.live)}</p>` : ''}<ul class="l-rows">`;
    list.forEach(r => {
      const ln = links(r.id);
      html += `<li class="l-row${openRows[r.id] ? ' open' : ''}" data-id="${esc(r.id)}"><button class="l-pill ${esc(r.status)}" data-lcycle="${esc(r.id)}" aria-label="Change status">${LBL[r.status] || r.status}</button>
      <div class="l-body" data-lopen="${esc(r.id)}"><div class="l-t">${esc(r.title)}</div>${r.note ? `<div class="l-n">${esc(r.note)}</div>` : ''}
      <div class="l-meta">${ln.map(t => `<span class="tag${t.done ? ' done-tag' : ''}">📅 ${esc(fmtLink(t))}${t.done ? ' ✓' : ''}</span>`).join('')}${r.status !== 'done' && !ln.length ? `<button class="l-plan" data-lplan="${esc(r.id)}">+ Plan it today</button>` : ''}</div></div>
      <button class="icon-btn l-edit" data-ledit="${esc(r.id)}" aria-label="Edit">✎</button></li>`;
    });
    html += '</ul></section>';
  });
  if (!shown && (filter !== 'all' || q)) html += '<p class="muted center">Nothing matches.</p>';
  html += '<button class="primary-btn wide" data-ladd>+ Add Launch task</button>';
  const keep = document.activeElement && document.activeElement.classList.contains('l-search');
  el.innerHTML = html;
  if (keep) { const i = $('.l-search', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}

async function setStatus(id, status) {
  const sb = client(), r = rows.find(x => x.id === id); if (!sb || !r) return;
  const had = links(id).length, was = r.status; r.status = status; render();
  const { error } = await sb.from(TABLE).update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { r.status = was; render(); toast('Could not save: ' + error.message); return; }
  toast(status === 'done' ? (had ? 'Done ✓ and ticked in your planner' : 'Done ✓') : 'Updated');
  if (had && dp().syncNow) setTimeout(() => dp().syncNow(), 600);
}

function planIt(id) {
  const r = rows.find(x => x.id === id); if (!r || !dp().addPlanTask) return;
  // end time: the next full hour at least an hour away; after 9 pm it goes to 9 am tomorrow
  const n = new Date(Date.now() + 36e5); n.setMinutes(0, 0, 0); n.setHours(n.getHours() + 1);
  let date = new Date(), hh = n.getHours();
  if (n.getDate() !== date.getDate() || hh >= 21) { date = new Date(Date.now() + 864e5); hh = 9; } else if (hh < 9) hh = 9;
  const pad = x => String(x).padStart(2, '0'), ymd = x => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  dp().addPlanTask({ title: 'CosmoZen: ' + r.title, date: ymd(date), end: `${pad(hh)}:00`, notes: '#cz:' + r.id });
  render();
}

function openEdit(id) {
  editing = id ? rows.find(x => x.id === id) : null; editStatus = editing ? editing.status : 'wip';
  const dlg = $('#launchDlg'); if (!dlg) return;
  $('#lTitleH').textContent = editing ? 'Edit Launch task' : 'New Launch task';
  $('#lTitle').value = editing ? editing.title : ''; $('#lNote').value = editing ? (editing.note || '') : '';
  const gs = groups(); $('#lGroup').innerHTML = gs.map(g => `<option value="${esc(g.title)}"${editing && editing.group_title === g.title ? ' selected' : ''}>${esc(g.title)}</option>`).join('') + '<option value="__new">+ New group…</option>';
  $('#lNewGroup').value = ''; $('#lNewGroup').classList.add('hidden'); $('#lDelete').classList.toggle('hidden', !editing);
  paintEditStatus(); dlg.showModal();
}
function paintEditStatus() { document.querySelectorAll('#lStatus button').forEach(b => b.classList.toggle('on', b.dataset.s === editStatus)); }

async function saveEdit() {
  const sb = client(); if (!sb) return;
  const title = $('#lTitle').value.trim(); if (!title) return;
  let g = $('#lGroup').value, order, live = '';
  if (g === '__new') { g = $('#lNewGroup').value.trim(); if (!g) return; order = rows.reduce((m, r) => Math.max(m, r.group_order), -1) + 1; }
  else { const ex = rows.find(r => r.group_title === g); order = ex ? ex.group_order : 0; live = ex ? ex.group_live : ''; }
  const body = { title, note: $('#lNote').value.trim(), status: editStatus, group_title: g, group_order: order, group_live: live || '', updated_at: new Date().toISOString() };
  let res;
  if (editing) {
    if (editing.group_title !== g) body.task_order = rows.filter(r => r.group_title === g).reduce((m, r) => Math.max(m, r.task_order), -1) + 1;
    res = await sb.from(TABLE).update(body).eq('id', editing.id);
  } else {
    body.id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); body.deleted = false;
    body.task_order = rows.filter(r => r.group_title === g).reduce((m, r) => Math.max(m, r.task_order), -1) + 1;
    res = await sb.from(TABLE).insert(body);
  }
  if (res.error) { toast('Could not save: ' + res.error.message); return; }
  $('#launchDlg').close(); toast('Saved'); pull();
}

async function removeEdit() {
  const sb = client(); if (!sb || !editing || !confirm('Delete this Launch task?')) return;
  const { error } = await sb.from(TABLE).update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', editing.id);
  if (error) { toast('Could not delete: ' + error.message); return; }
  $('#launchDlg').close(); toast('Deleted'); pull();
}

document.addEventListener('click', e => {
  const t = e.target;
  if (t.closest('[data-view="launch"]')) { setTimeout(pull, 0); return; }
  if (!view() || !view().contains(t) && !t.closest('#launchDlg')) return;
  let b;
  if ((b = t.closest('[data-lf]'))) { filter = b.dataset.lf; render(); }
  else if ((b = t.closest('[data-lg]'))) { closed[b.dataset.lg] = !closed[b.dataset.lg]; saveLS('cz.launch.closed', closed); render(); }
  else if ((b = t.closest('[data-lcycle]'))) { const r = rows.find(x => x.id === b.dataset.lcycle); if (r) setStatus(r.id, r.status === 'wip' ? 'done' : 'wip'); }
  else if ((b = t.closest('[data-lplan]'))) planIt(b.dataset.lplan);
  else if ((b = t.closest('[data-lopen]'))) { openRows[b.dataset.lopen] = !openRows[b.dataset.lopen]; render(); }
  else if ((b = t.closest('[data-ledit]'))) openEdit(b.dataset.ledit);
  else if (t.closest('[data-ladd]')) openEdit(null);
  else if (t.closest('[data-lrefresh]')) { pull(); if (dp().syncNow) dp().syncNow(true); }
  else if ((b = t.closest('#lStatus button'))) { editStatus = b.dataset.s; paintEditStatus(); }
  else if (t.closest('#lCancel')) $('#launchDlg').close();
  else if (t.closest('#lDelete')) removeEdit();
});
document.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('l-search')) { query = e.target.value; render(); } });
document.addEventListener('change', e => { if (e.target.id === 'lGroup') $('#lNewGroup').classList.toggle('hidden', e.target.value !== '__new'); });
document.addEventListener('submit', e => { if (e.target.id === 'launchForm') { e.preventDefault(); saveEdit(); } });

// mark planner tasks that are linked to a Launch task
function decorate() {
  document.querySelectorAll('#taskList .task, #failedList .task').forEach(li => {
    const tg = li.querySelector('[data-toggle]'), id = tg && tg.dataset.toggle; if (!id) return;
    const t = ((dp().state || {}).tasks || []).find(x => x.id === id), m = t && t.notes && t.notes.match(/#cz:([a-z0-9]+)/);
    const meta = li.querySelector('.t-meta'); if (!meta) return;
    let chip = meta.querySelector('.cz-chip');
    if (!m) { if (chip) chip.remove(); return; }
    if (!chip) { chip = document.createElement('span'); chip.className = 'tag cz-chip'; meta.appendChild(chip); }
    const r = rows.find(x => x.id === m[1]); chip.textContent = '🚀 Launch'; chip.title = r ? 'Launch Board: ' + r.title : 'Linked to the Launch Board';
  });
}
function watch() { const l = $('#taskList'); if (l) new MutationObserver(decorate).observe(l, { childList: true }); decorate(); }

window.addEventListener('dp:auth', () => { pull(); });
window.addEventListener('dp:synced', () => { decorate(); if (active() || rows.length) pull(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && active()) pull(); });
setInterval(() => { if (active() && !document.hidden) pull(); }, 60000);
window.addEventListener('load', () => { watch(); if (location.hash === '#launch') { const b = document.querySelector('.tabbar [data-view="launch"]'); if (b) b.click(); } setTimeout(pull, 800); });
window.__launch = { pull, get rows() { return rows; } };
})();
