/* Day Planner — targets (week/month/quarter/year), daily tasks with end times,
   tinker alarm, calendar export, optional Supabase sync. No build step. */
(() => {
'use strict';

// ---------- storage ----------
const LS_STATE = 'dp.state.v1', LS_SET = 'dp.settings.v1', LS_ALERT = 'dp.alerts.v1';
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let state = load(LS_STATE, null) || { tasks: [], targets: [], deleted: {} };
state.tasks ||= []; state.targets ||= []; state.deleted ||= {};
let settings = Object.assign({ before: 5, repeats: 3, volume: 0.8, sbUrl: '', sbKey: '', lastSync: 0 }, load(LS_SET, {}));
// Vinu's Supabase project (public values — access is protected by row-level security)
const SB_URL = 'https://zylefmxvyorgxjnklgtr.supabase.co';
const SB_KEY = 'sb_publishable_QiFeAn5V7PBXDLkxMVkBag_q8PO7yoS';
const APP_URL = 'https://day-planner-cosmo-zen.vercel.app/';
if (!settings.sbUrl) settings.sbUrl = SB_URL;
if (!settings.sbKey) settings.sbKey = SB_KEY;
// alert bookkeeping is per-device (each device should ring), never synced
let alerts = load(LS_ALERT, { fired: {}, pre: {}, snooze: {} });

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();

function commit() {
  save(LS_STATE, state);
  render();
  syncSoon();
  pushSchedule();
}

// ---------- dates ----------
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const todayStr = () => ymd(new Date());
const endTs = t => { const d = parseYmd(t.date); const [h, m] = t.end.split(':').map(Number); d.setHours(h, m, 0, 0); return d.getTime(); };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = s => { const d = parseYmd(s); return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
const fmtTime = hm => { let [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(m)} ${ap}`; };

function isoWeek(d) { // returns [isoYear, week]
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return [t.getUTCFullYear(), Math.ceil(((t - y0) / 864e5 + 1) / 7)];
}
function periodKey(p, s) {
  const d = parseYmd(s), y = d.getFullYear(), m = d.getMonth();
  if (p === 'week') { const [wy, w] = isoWeek(d); return `${wy}-W${pad(w)}`; }
  if (p === 'month') return `${y}-${pad(m + 1)}`;
  if (p === 'quarter') return `${y}-Q${Math.floor(m / 3) + 1}`;
  return `${y}`;
}
function periodStart(p, s) { // first day (ymd) of the period containing s
  const d = parseYmd(s);
  if (p === 'week') { const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return ymd(d); }
  if (p === 'month') return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  if (p === 'quarter') return ymd(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1));
  return ymd(new Date(d.getFullYear(), 0, 1));
}
function periodShift(p, s, n) {
  const d = parseYmd(periodStart(p, s));
  if (p === 'week') d.setDate(d.getDate() + 7 * n);
  else if (p === 'month') d.setMonth(d.getMonth() + n);
  else if (p === 'quarter') d.setMonth(d.getMonth() + 3 * n);
  else d.setFullYear(d.getFullYear() + n);
  return ymd(d);
}
function periodEnd(p, s) { return addDays(periodShift(p, s, 1), -1); }
function periodLabel(p, s) {
  const d = parseYmd(s);
  if (p === 'week') { const [, w] = isoWeek(d); return `Week ${w}`; }
  if (p === 'month') return `${MON[d.getMonth()]} ${d.getFullYear()}`;
  if (p === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
  return `${d.getFullYear()}`;
}
function periodRange(p, s) {
  const a = parseYmd(periodStart(p, s)), b = parseYmd(periodEnd(p, s));
  return `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`;
}
const P_NAME = { week: 'Weekly', month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' };

// ---------- data helpers ----------
const liveTasks = () => state.tasks;
const tasksOn = s => liveTasks().filter(t => t.date === s).sort((a, b) => a.end.localeCompare(b.end));
const targetsFor = (p, key) => state.targets.filter(g => g.period === p && g.key === key);
const targetById = id => state.targets.find(g => g.id === id);
function targetProgress(g) {
  const linked = state.tasks.filter(t => t.targetId === g.id);
  const done = linked.filter(t => t.done).length;
  return { done, linked: linked.length, pct: Math.min(100, Math.round(done / Math.max(1, g.goal) * 100)) };
}
// targets a task on date s may count toward: the 4 periods that contain s
const targetsCovering = s => ['week', 'month', 'quarter', 'year'].flatMap(p => targetsFor(p, periodKey(p, s)));

function upsertTask(t) {
  t.updatedAt = now();
  const i = state.tasks.findIndex(x => x.id === t.id);
  if (i >= 0) state.tasks[i] = t; else state.tasks.push(t);
  commit();
}
function removeTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  state.deleted[id] = now(); commit();
}
function upsertTarget(g) {
  g.updatedAt = now();
  const i = state.targets.findIndex(x => x.id === g.id);
  if (i >= 0) state.targets[i] = g; else state.targets.push(g);
  commit();
}
function removeTarget(id) {
  state.targets = state.targets.filter(g => g.id !== id);
  state.tasks.forEach(t => { if (t.targetId === id) { t.targetId = ''; t.updatedAt = now(); } });
  state.deleted[id] = now(); commit();
}

const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const shortDate = s => { const d = parseYmd(s); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
// Unfinished tasks from earlier days move to today as pending (same end time).
function carryOver() {
  const t0 = todayStr(); let moved = 0;
  for (const t of state.tasks) {
    if (t.done || t.date >= t0) continue;
    t.carriedFrom ||= t.date;
    t.carryCount = (t.carryCount || 0) + 1;
    t.date = t0; t.updatedAt = now(); moved++;
    delete alerts.fired[t.id]; delete alerts.pre[t.id]; delete alerts.snooze[t.id];
  }
  if (moved) { save(LS_ALERT, alerts); save(LS_STATE, state); toast(`${moved} unfinished task${moved > 1 ? 's' : ''} moved to today`); }
  return moved;
}

// ---------- UI state ----------
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let selDay = todayStr();
let selPeriod = 'week';
let periodAnchor = todayStr();

function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

function showView(v) {
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === 'view-' + v));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('#fab').classList.toggle('hidden', v === 'settings');
  $('#fab').dataset.mode = v === 'targets' ? 'target' : 'task';
  $('#fab').setAttribute('aria-label', v === 'targets' ? 'Add target' : 'Add task');
  render();
}

// ---------- render ----------
function render() {
  renderToday(); renderTargets(); renderSettings(); renderSyncBadge();
}

function relTime(ms) {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 1) return ms >= 0 ? 'in under a minute' : 'just ended';
  const txt = m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${Math.round(m / 1440)}d`;
  return ms >= 0 ? `in ${txt}` : `${txt} overdue`;
}

function renderToday() {
  const t0 = todayStr();
  $('#dayLabel').textContent = selDay === t0 ? 'Today' : selDay === addDays(t0, 1) ? 'Tomorrow' : selDay === addDays(t0, -1) ? 'Yesterday' : DOW[parseYmd(selDay).getDay()];
  $('#dayDate').textContent = fmtDate(selDay);

  // week strip (Mon–Sun)
  const ws = periodStart('week', selDay);
  $('#weekStrip').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const s = addDays(ws, i), d = parseYmd(s);
    const has = state.tasks.some(t => t.date === s && !t.done);
    return `<button data-day="${s}" class="${s === selDay ? 'sel' : ''} ${s === t0 ? 'today' : ''}">${DOW[d.getDay()].slice(0, 2)}<b>${d.getDate()}</b>${has ? '<i class="pip"></i>' : ''}</button>`;
  }).join('');

  // target chips for periods containing selDay
  const gs = targetsCovering(selDay);
  $('#targetStrip').innerHTML = gs.map(g => {
    const pr = targetProgress(g);
    return `<button class="tchip" data-target="${g.id}"><div class="lbl">${P_NAME[g.period]} · ${pr.done}/${g.goal}</div><div class="nm">${esc(g.title)}</div><div class="bar ${pr.pct >= 100 ? 'full' : ''}"><i style="width:${pr.pct}%"></i></div></button>`;
  }).join('');
  $('#targetStrip').classList.toggle('hidden', !gs.length);

  const list = tasksOn(selDay);
  const n = now();
  $('#taskList').innerHTML = list.map(t => {
    const due = endTs(t) - n;
    const g = t.targetId && targetById(t.targetId);
    let status = '';
    if (!t.done && selDay === t0) status = due < 0 ? `<span class="late">${relTime(due)}</span>` : due < 3600e3 ? `<span class="due-soon">${relTime(due)}</span>` : `<span>${relTime(due)}</span>`;
    else if (!t.done && due < 0) status = '<span class="late">missed</span>';
    if (t.done) status = `<span class="done-tag">✓ Completed${t.doneAt ? ' ' + fmtTime(hm(new Date(t.doneAt))) : ''}</span>`;
    if (t.carriedFrom && !t.done) status += `<span class="tag carry">↪ Moved from ${shortDate(t.carriedFrom)}</span>`;
    return `<li class="task ${t.done ? 'done' : ''} ${!t.done && due < 0 ? 'overdue' : ''}">
      <button class="check" data-toggle="${t.id}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}">${t.done ? '✓' : ''}</button>
      <button class="t-body" data-edit="${t.id}">
        <div class="t-title">${esc(t.title)}</div>
        <div class="t-meta">${status}${g ? `<span class="tag">🎯 ${esc(g.title)}</span>` : ''}${t.notes ? '<span>📝</span>' : ''}</div>
      </button>
      <div class="t-time">${fmtTime(t.end)}</div>
    </li>`;
  }).join('');
  $('#emptyTasks').classList.toggle('hidden', list.length > 0);
  const done = list.filter(t => t.done).length;
  $('#dayProgress').textContent = list.length ? `${done}/${list.length} done` : '';
  $('#icsDay').classList.toggle('hidden', !!LN || !list.some(t => !t.done && endTs(t) > n));
}

function renderTargets() {
  document.querySelectorAll('#periodSeg button').forEach(b => b.classList.toggle('on', b.dataset.p === selPeriod));
  $('#periodLabel').textContent = periodLabel(selPeriod, periodAnchor);
  $('#periodRange').textContent = periodRange(selPeriod, periodAnchor);
  const gs = targetsFor(selPeriod, periodKey(selPeriod, periodAnchor));
  $('#targetList').innerHTML = gs.map(g => {
    const pr = targetProgress(g);
    return `<li><button class="target" data-target="${g.id}">
      <div class="row1"><div class="nm">${esc(g.title)}</div><div class="ct">${pr.done} / ${g.goal}</div></div>
      <div class="bar ${pr.pct >= 100 ? 'full' : ''}"><i style="width:${pr.pct}%"></i></div>
      <div class="sub">${pr.pct >= 100 ? '🎉 Target achieved' : `${pr.pct}% · ${pr.linked} task${pr.linked === 1 ? '' : 's'} linked`}</div>
    </button></li>`;
  }).join('');
  $('#emptyTargets').classList.toggle('hidden', gs.length > 0);
}

function renderSettings() {
  $('#setBefore').value = String(settings.before);
  if (LN) { // Android app
    $('#icsAll').closest('.btn-row').classList.add('hidden');
    $('#enableNotif').classList.remove('hidden'); $('#enableNotif').textContent = 'Allow alarms';
    $('#notifHint').textContent = 'Alarms ring as Android notifications with the tinker, even when the app is closed. Tap “Allow alarms” once, and allow “Alarms & reminders” if Android asks.';
    $('#setRepeats').value = String(settings.repeats); $('#setVolume').value = String(settings.volume);
    return;
  }
  $('#setRepeats').value = String(settings.repeats);
  $('#setVolume').value = String(settings.volume);
  const hint = $('#notifHint'), btn = $('#enableNotif');
  if (!('Notification' in window)) {
    btn.classList.add('hidden');
    hint.textContent = isIOS() && !isStandalone()
      ? 'On iPhone: open in Safari → Share → Add to Home Screen, then open from the home screen to enable notifications.'
      : 'Notifications are not available here. Keep the app open, or add alarms to Calendar.';
  } else if (Notification.permission === 'granted') {
    btn.classList.add('hidden'); hint.textContent = '✓ Notifications are on.';
  } else {
    btn.classList.remove('hidden'); hint.textContent = Notification.permission === 'denied' ? 'Notifications are blocked in system settings.' : '';
  }
  if (isIOS()) hint.textContent += ' iPhone tip: when the app is closed, use “Add to Calendar” so the alarm still rings.';
}

// ---------- editors ----------
const taskDlg = $('#taskDlg'), targetDlg = $('#targetDlg');
let editingTask = null, editingTarget = null;

function openTask(t) {
  editingTask = t || null;
  $('#taskDlgTitle').textContent = t ? 'Edit task' : 'New task';
  $('#tTitle').value = t?.title || '';
  $('#tDate').value = t?.date || selDay;
  if (t) $('#tEnd').value = t.end;
  else { const d = new Date(Date.now() + 3600e3); $('#tEnd').value = `${pad(d.getHours())}:00`; }
  $('#tNotes').value = t?.notes || '';
  $('#tDelete').classList.toggle('hidden', !t);
  $('#tDone').classList.toggle('hidden', !t);
  if (t) { $('#tDone').textContent = t.done ? '↩ Mark not done' : '✓ Mark done'; $('#tDone').classList.toggle('undo', !!t.done); }
  fillTargetSelect(t?.targetId || '');
  taskDlg.showModal();
  if (!t) setTimeout(() => $('#tTitle').focus(), 50);
}
function fillTargetSelect(cur) {
  const gs = targetsCovering($('#tDate').value || selDay);
  $('#tTarget').innerHTML = '<option value="">— None —</option>' +
    gs.map(g => `<option value="${g.id}" ${g.id === cur ? 'selected' : ''}>${P_NAME[g.period]}: ${esc(g.title)}</option>`).join('');
}
$('#tDate').addEventListener('change', () => fillTargetSelect($('#tTarget').value));
$('#taskForm').addEventListener('submit', e => {
  e.preventDefault();
  const t = editingTask ? { ...editingTask } : { id: uid(), done: false, createdAt: now() };
  const changedTime = !editingTask || editingTask.date !== $('#tDate').value || editingTask.end !== $('#tEnd').value;
  t.title = $('#tTitle').value.trim();
  t.date = $('#tDate').value; t.end = $('#tEnd').value;
  t.targetId = $('#tTarget').value; t.notes = $('#tNotes').value.trim();
  if (!t.title) return;
  if (changedTime) { delete alerts.fired[t.id]; delete alerts.pre[t.id]; delete alerts.snooze[t.id]; save(LS_ALERT, alerts); }
  upsertTask(t); taskDlg.close();
  if (!editingTask) toast(`Tinker set for ${fmtTime(t.end)}`);
  if (t.date !== selDay) { selDay = t.date; render(); }
});
$('#tDone').addEventListener('click', () => {
  if (!editingTask) return;
  const t = state.tasks.find(x => x.id === editingTask.id); if (!t) return;
  t.done = !t.done; t.doneAt = t.done ? now() : null; upsertTask(t); taskDlg.close();
  if (t.done) toast('Nice — done ✓');
});
$('#tDelete').addEventListener('click', () => {
  if (editingTask && confirm('Delete this task?')) { removeTask(editingTask.id); taskDlg.close(); }
});

function openTarget(g) {
  editingTarget = g || null;
  $('#targetDlgTitle').textContent = g ? 'Edit target' : 'New target';
  $('#gTitle').value = g?.title || '';
  $('#gPeriod').value = g?.period || selPeriod;
  $('#gGoal').value = g?.goal || 5;
  $('#gPeriod').disabled = !!g;
  $('#gDelete').classList.toggle('hidden', !g);
  updatePeriodHint();
  targetDlg.showModal();
}
function updatePeriodHint() {
  const p = $('#gPeriod').value;
  const anchor = editingTarget ? editingTarget.anchor : (p === selPeriod ? periodAnchor : (viewIs('targets') ? periodAnchor : selDay));
  $('#gPeriodHint').textContent = `For ${periodLabel(p, anchor)} (${periodRange(p, anchor)})`;
  $('#gPeriodHint').dataset.anchor = anchor;
}
const viewIs = v => $('#view-' + v).classList.contains('active');
$('#gPeriod').addEventListener('change', updatePeriodHint);
$('#targetForm').addEventListener('submit', e => {
  e.preventDefault();
  const g = editingTarget ? { ...editingTarget } : { id: uid(), createdAt: now() };
  g.title = $('#gTitle').value.trim(); if (!g.title) return;
  g.goal = Math.max(1, parseInt($('#gGoal').value, 10) || 1);
  if (!editingTarget) {
    g.period = $('#gPeriod').value;
    g.anchor = periodStart(g.period, $('#gPeriodHint').dataset.anchor);
    g.key = periodKey(g.period, g.anchor);
  }
  upsertTarget(g); targetDlg.close();
});
$('#gDelete').addEventListener('click', () => {
  if (editingTarget && confirm('Delete this target? Linked tasks are kept.')) { removeTarget(editingTarget.id); targetDlg.close(); }
});
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
[taskDlg, targetDlg].forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

// ---------- events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-toggle],[data-edit],[data-day],[data-target],[data-view],[data-p]');
  if (!el) return;
  if (el.dataset.toggle) {
    const t = state.tasks.find(x => x.id === el.dataset.toggle);
    if (t) { t.done = !t.done; t.doneAt = t.done ? now() : null; upsertTask(t); if (t.done) toast('Nice — done ✓'); }
  } else if (el.dataset.edit) openTask(state.tasks.find(x => x.id === el.dataset.edit));
  else if (el.dataset.day) { selDay = el.dataset.day; renderToday(); }
  else if (el.dataset.target) openTarget(targetById(el.dataset.target));
  else if (el.dataset.view) showView(el.dataset.view);
  else if (el.dataset.p) { selPeriod = el.dataset.p; renderTargets(); }
});
$('#prevDay').onclick = () => { selDay = addDays(selDay, -1); renderToday(); };
$('#nextDay').onclick = () => { selDay = addDays(selDay, 1); renderToday(); };
$('#dayLabel').onclick = () => { selDay = todayStr(); renderToday(); };
$('#prevPeriod').onclick = () => { periodAnchor = periodShift(selPeriod, periodAnchor, -1); renderTargets(); };
$('#nextPeriod').onclick = () => { periodAnchor = periodShift(selPeriod, periodAnchor, 1); renderTargets(); };
$('#periodLabel').onclick = () => { periodAnchor = todayStr(); renderTargets(); };
$('#fab').onclick = () => $('#fab').dataset.mode === 'target' ? openTarget() : openTask();
$('#addTarget').onclick = () => openTarget();

$('#setBefore').onchange = e => { settings.before = +e.target.value; save(LS_SET, settings); pushSchedule(); };
$('#setRepeats').onchange = e => { settings.repeats = +e.target.value; save(LS_SET, settings); };
$('#setVolume').oninput = e => { settings.volume = +e.target.value; save(LS_SET, settings); };
$('#testSound').onclick = () => playTinker(1);
$('#enableNotif').onclick = async () => {
  if (LN) {
    try { nativeReady = null; await nativeInit(); const ex = await LN.checkExactNotificationSetting?.(); if (ex && ex.exact_alarm !== 'granted') await LN.changeExactNotificationSetting(); } catch {}
    nativeSchedule(); toast('Alarms enabled'); renderSettings(); return;
  }
  try { await Notification.requestPermission(); } catch {}
  renderSettings();
};

// ---------- sound ----------
let actx = null, tinkerBuf = null, tinkerEl = null;
// synthesize the bell chime (no audio file needed): 4 bell strikes with harmonics
function tinkerSamples(sr) {
  const out = new Float32Array(Math.floor(1.9 * sr));
  for (const [f, t0, a] of [[1568, 0, .5], [2093, .18, .45], [2637, .36, .4], [2093, .62, .3]]) {
    const s0 = Math.floor(t0 * sr), n = Math.min(Math.floor(1.25 * sr), out.length - s0);
    for (let i = 0; i < n; i++) {
      const t = i / sr, env = Math.exp(-t * 5) * (1 - Math.exp(-t * 800)), w = 2 * Math.PI * f * t;
      out[s0 + i] += a * env * (Math.sin(w) + .45 * Math.sin(w * 2.76) * Math.exp(-t * 4) + .2 * Math.sin(w * 5.4) * Math.exp(-t * 9));
    }
  }
  let m = 0; for (const v of out) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < out.length; i++) out[i] /= m * 1.1;
  return out;
}
function tinkerWavUrl() { // fallback for when Web Audio isn't running
  const sr = 22050, s = tinkerSamples(sr), b = new DataView(new ArrayBuffer(44 + s.length * 2));
  const str = (o, x) => [...x].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); b.setUint32(4, 36 + s.length * 2, true); str(8, 'WAVEfmt '); b.setUint32(16, 16, true);
  b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true);
  b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, s.length * 2, true);
  s.forEach((v, i) => b.setInt16(44 + i * 2, v * 32767, true));
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
async function initAudio() {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') await actx.resume();
    if (!tinkerBuf) {
      const s = tinkerSamples(actx.sampleRate);
      tinkerBuf = actx.createBuffer(1, s.length, actx.sampleRate);
      tinkerBuf.getChannelData(0).set(s);
    }
  } catch { /* fall back to <audio> */ }
  try { tinkerEl ||= new Audio(tinkerWavUrl()); } catch {}
}
// unlock audio on first interaction (iOS/Chrome autoplay rules)
['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, function once() {
  initAudio(); document.removeEventListener(ev, once, true);
}, true));

let ringTimer = null;
function playOnce() {
  if (actx && tinkerBuf && actx.state === 'running') {
    const src = actx.createBufferSource(), gain = actx.createGain();
    gain.gain.value = settings.volume; src.buffer = tinkerBuf;
    src.connect(gain).connect(actx.destination); src.start();
  } else {
    try { tinkerEl ||= new Audio(tinkerWavUrl()); tinkerEl.volume = settings.volume; tinkerEl.currentTime = 0; tinkerEl.play().catch(() => {}); } catch {}
  }
}
async function playTinker(times) {
  await initAudio();
  stopTinker();
  let n = 0;
  const go = () => { playOnce(); n++; if (n < times) ringTimer = setTimeout(go, 2200); };
  go();
}
function stopTinker() { clearTimeout(ringTimer); ringTimer = null; }

// ---------- alarms ----------
let alarmQueue = [], alarmShowing = null;
function notify(title, body, tag) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.ready.then(r => r.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', requireInteraction: true, renotify: true }));
      } else new Notification(title, { body, tag, icon: 'icons/icon-192.png' });
    }
  } catch {}
}
function triggerAt(t) { return alerts.snooze[t.id] || endTs(t); }

function checkAlarms() {
  const n = now(), before = settings.before * 60000;
  let dirty = false;
  for (const t of state.tasks) {
    if (t.done) continue;
    const at = triggerAt(t);
    const key = t.id + '@' + at;
    // pre-alert: open the app before the end time
    if (before > 0 && !alerts.snooze[t.id] && !alerts.pre[t.id] && n >= at - before && n < at) {
      alerts.pre[t.id] = key; dirty = true;
      const mins = Math.max(1, Math.round((at - n) / 60000));
      window.desktop?.alarm({ title: t.title, kind: 'pre' });
      notify(`⏳ ${t.title}`, `Ends in ${mins} min (${fmtTime(t.end)})`, 'pre-' + t.id);
      toast(`⏳ “${t.title}” ends in ${mins} min`);
    }
    // end-time alert (ignore alarms more than 30 min stale, e.g. app opened next morning)
    if (alerts.fired[t.id] !== key && n >= at && n - at < 30 * 60000) {
      alerts.fired[t.id] = key; dirty = true;
      alarmQueue.push(t.id);
    }
  }
  if (dirty) save(LS_ALERT, alerts);
  if (!alarmShowing && alarmQueue.length) showAlarm(alarmQueue.shift());
  if (viewIs('today')) renderToday(); // refresh countdowns
}

function showAlarm(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t || t.done) { alarmShowing = null; if (alarmQueue.length) showAlarm(alarmQueue.shift()); return; }
  alarmShowing = id;
  $('#alarmKind').textContent = alerts.snooze[id] ? 'Snooze over' : "Time's up";
  $('#alarmTitle').textContent = t.title;
  $('#alarmTime').textContent = `End time ${fmtTime(t.end)}`;
  $('#alarm').classList.remove('hidden');
  window.desktop?.alarm({ title: t.title, kind: 'end' });
  notify(`🔔 ${t.title}`, `End time reached (${fmtTime(t.end)})`, 'end-' + t.id);
  playTinker(settings.repeats);
}
function closeAlarm() {
  stopTinker(); $('#alarm').classList.add('hidden'); alarmShowing = null;
  if (alarmQueue.length) setTimeout(() => showAlarm(alarmQueue.shift()), 400);
}
$('#alarmDone').onclick = () => {
  const t = state.tasks.find(x => x.id === alarmShowing);
  if (t) { t.done = true; t.doneAt = now(); delete alerts.snooze[t.id]; save(LS_ALERT, alerts); upsertTask(t); }
  closeAlarm();
};
$('#alarmSnooze').onclick = () => {
  alerts.snooze[alarmShowing] = now() + 5 * 60000; save(LS_ALERT, alerts); pushSchedule();
  toast('Snoozed 5 minutes'); closeAlarm();
};
$('#alarmDismiss').onclick = closeAlarm;

// share upcoming schedule with the Windows desktop shell (it wakes the window even if hidden)
// Android app (Capacitor): schedule real system notifications so alarms ring even when closed
const NATIVE = !!window.Capacitor?.isNativePlatform?.();
const LN = NATIVE && window.Capacitor.registerPlugin ? window.Capacitor.registerPlugin('LocalNotifications') : null;
const hashId = s => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h % 1000000000) * 2; };
let nativeReady = null;
async function nativeInit() {
  if (!LN) return false;
  nativeReady ||= (async () => {
    try {
      const p = await LN.checkPermissions();
      if (p.display !== 'granted') await LN.requestPermissions();
      await LN.createChannel({ id: 'tinker', name: 'Task alarms', description: 'Tinker at task end times', importance: 5, sound: 'tinker.wav', vibration: true, visibility: 1 });
      LN.addListener?.('localNotificationActionPerformed', () => { checkAlarms(); });
      return true;
    } catch { return false; }
  })();
  return nativeReady;
}
let nativeTimer = null;
function nativeSchedule() {
  if (!LN) return;
  clearTimeout(nativeTimer);
  nativeTimer = setTimeout(async () => {
    if (!(await nativeInit())) return;
    try {
      const pend = await LN.getPending();
      if (pend.notifications?.length) await LN.cancel({ notifications: pend.notifications.map(x => ({ id: x.id })) });
      const n = now(), before = settings.before * 60000, list = [];
      for (const t of state.tasks.filter(t => !t.done).sort((a, b) => triggerAt(a) - triggerAt(b))) {
        const at = triggerAt(t); if (at <= n || list.length >= 60) continue;
        const id = hashId(t.id);
        list.push({ id, title: `🔔 ${t.title}`, body: `End time reached (${fmtTime(t.end)})`, channelId: 'tinker', sound: 'tinker.wav', schedule: { at: new Date(at), allowWhileIdle: true } });
        if (before > 0 && at - before > n) list.push({ id: id + 1, title: `⏳ ${t.title}`, body: `Ends in ${settings.before} min (${fmtTime(t.end)})`, channelId: 'tinker', sound: 'tinker.wav', schedule: { at: new Date(at - before), allowWhileIdle: true } });
      }
      if (list.length) await LN.schedule({ notifications: list });
    } catch (e) { console.warn('native schedule failed', e); }
  }, 400);
}

function pushSchedule() {
  nativeSchedule();
  if (!window.desktop?.schedule) return;
  const n = now(), before = settings.before * 60000;
  const items = state.tasks.filter(t => !t.done).map(t => ({ id: t.id, title: t.title, at: triggerAt(t), before }))
    .filter(x => x.at > n - 60000);
  window.desktop.schedule(items);
}

// ---------- calendar (.ics) ----------
function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function icsDt(ms) { const d = new Date(ms); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`; }
function makeICS(tasks) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Day Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const t of tasks) {
    const end = endTs(t);
    const g = t.targetId && targetById(t.targetId);
    lines.push('BEGIN:VEVENT', `UID:${t.id}@dayplanner`, `DTSTAMP:${stamp}`,
      `DTSTART:${icsDt(end - 15 * 60000)}`, `DTEND:${icsDt(end)}`,
      `SUMMARY:${icsEsc('⏰ ' + t.title)}`,
      `DESCRIPTION:${icsEsc((g ? 'Target: ' + g.title + '\n' : '') + (t.notes || '') + '\nEnds at ' + fmtTime(t.end))}`);
    if (settings.before > 0) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(t.title)}`, `TRIGGER;RELATED=END:-PT${settings.before}M`, 'END:VALARM');
    lines.push('BEGIN:VALARM', 'ACTION:AUDIO', `TRIGGER;RELATED=END:PT0M`, 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc('Time\'s up: ' + t.title)}`, `TRIGGER;RELATED=END:PT0M`, 'END:VALARM',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function downloadICS(tasks, name) {
  if (!tasks.length) { toast('No upcoming tasks to add'); return; }
  const ics = makeICS(tasks);
  if (window.desktop?.saveFile) { window.desktop.saveFile(name, ics); return; }
  if (isIOS()) { // iOS opens data: calendar URLs straight into Calendar's "Add All"
    location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics); return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$('#icsDay').onclick = () => downloadICS(tasksOn(selDay).filter(t => !t.done && endTs(t) > now()), `planner-${selDay}.ics`);
$('#icsAll').onclick = () => downloadICS(state.tasks.filter(t => !t.done && endTs(t) > now()).sort((a, b) => endTs(a) - endTs(b)), 'planner-upcoming.ics');

// ---------- backup ----------
$('#exportJson').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `day-planner-backup-${todayStr()}.json`; document.body.appendChild(a); a.click(); a.remove();
};
$('#importJson').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.tasks) || !Array.isArray(data.targets)) throw new Error('Not a planner backup');
    state = merge(state, data); commit(); toast('Backup imported');
  } catch (err) { alert('Could not import: ' + err.message); }
  e.target.value = '';
};

// ---------- sync (Supabase) ----------
function mergeList(a = [], b = [], deleted) {
  const m = new Map();
  for (const x of [...a, ...b]) { const cur = m.get(x.id); if (!cur || (x.updatedAt || 0) > (cur.updatedAt || 0)) m.set(x.id, x); }
  return [...m.values()].filter(x => !(deleted[x.id] >= (x.updatedAt || 0)));
}
function merge(a, b) {
  const deleted = { ...(a.deleted || {}) };
  for (const [k, v] of Object.entries(b.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, v);
  // forget tombstones older than 90 days
  const cutoff = now() - 90 * 864e5;
  for (const k of Object.keys(deleted)) if (deleted[k] < cutoff) delete deleted[k];
  return { tasks: mergeList(a.tasks, b.tasks, deleted), targets: mergeList(a.targets, b.targets, deleted), deleted };
}

let sb = null, sbUser = null, syncState = 'local', syncTimer = null, syncing = false;
function setSync(s, msg) { syncState = s; if (msg !== undefined) { const el = $('#sbMsg'); el.textContent = msg; el.className = 'small msg ' + (s === 'err' ? 'err' : s === 'ok' ? 'ok' : ''); } renderSyncBadge(); }
function renderSyncBadge() {
  const b = $('#syncBadge'); b.dataset.state = sbUser ? syncState : 'local';
  $('#syncText').textContent = !sbUser ? 'On this device' : syncState === 'busy' ? 'Syncing…' : syncState === 'err' ? 'Sync issue' : 'Synced';
  $('#syncOut').classList.toggle('hidden', !!sbUser);
  $('#syncIn').classList.toggle('hidden', !sbUser);
  if (sbUser) {
    $('#sbWho').textContent = sbUser.email;
    $('#sbLast').textContent = settings.lastSync ? 'Last synced ' + new Date(settings.lastSync).toLocaleString() : '';
  } else {
    $('#sbUrl').value ||= settings.sbUrl; $('#sbKey').value ||= settings.sbKey;
  }
}
$('#syncBadge').onclick = () => { showView('settings'); if (sbUser) syncNow(); };

function makeClient(url, key) {
  if (!window.supabase?.createClient) throw new Error('Sync library failed to load');
  return window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'dp.auth' } });
}
async function initSync() {
  if (!settings.sbUrl || !settings.sbKey) { if (carryOver()) commit(); return; }
  try {
    sb = makeClient(settings.sbUrl, settings.sbKey);
    const { data } = await sb.auth.getSession();
    sbUser = data.session?.user || null;
    sb.auth.onAuthStateChange((_e, session) => { sbUser = session?.user || null; renderSyncBadge(); });
    renderSyncBadge();
    if (sbUser) syncNow(); else if (carryOver()) commit();
  } catch (e) { setSync('err', e.message); if (carryOver()) commit(); }
}
function readCreds() {
  const url = $('#sbUrl').value.trim().replace(/\/+$/, ''), key = $('#sbKey').value.trim();
  const email = $('#sbEmail').value.trim(), pass = $('#sbPass').value;
  if (!/^https:\/\/.+/.test(url) || !key) throw new Error('Enter your Supabase project URL and anon key.');
  if (!email || pass.length < 6) throw new Error('Enter your email and a password (6+ characters).');
  settings.sbUrl = url; settings.sbKey = key; save(LS_SET, settings);
  sb = makeClient(url, key);
  sb.auth.onAuthStateChange((_e, session) => { sbUser = session?.user || null; renderSyncBadge(); });
  return { email, pass };
}
$('#sbSignIn').onclick = async () => {
  try {
    const { email, pass } = readCreds(); setSync('busy', 'Signing in…');
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    sbUser = data.user; $('#sbPass').value = ''; setSync('ok', 'Signed in. Syncing…'); await syncNow();
  } catch (e) { setSync('err', e.message || String(e)); }
};
$('#sbSignUp').onclick = async () => {
  try {
    const { email, pass } = readCreds(); setSync('busy', 'Creating account…');
    const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: location.hostname.endsWith('vercel.app') ? location.origin + '/' : APP_URL } });
    if (error) throw error;
    if (data.session) { sbUser = data.user; setSync('ok', 'Account created. Syncing…'); await syncNow(); }
    else setSync('ok', 'Check your email to confirm, then tap Sign in.');
  } catch (e) { setSync('err', e.message || String(e)); }
};
$('#sbSignOut').onclick = async () => { try { await sb?.auth.signOut(); } catch {} sbUser = null; setSync('local', 'Signed out. Your data stays on this device.'); };
$('#sbSyncNow').onclick = () => syncNow(true);

async function syncNow(verbose) {
  if (!sb || !sbUser || syncing) return;
  syncing = true; setSync('busy');
  try {
    const { data, error } = await sb.from('planner').select('data').eq('user_id', sbUser.id).maybeSingle();
    if (error) throw error;
    const merged = data?.data ? merge(state, data.data) : state;
    let changedLocal = JSON.stringify(merged) !== JSON.stringify(state);
    state = merged; save(LS_STATE, state);
    if (carryOver()) changedLocal = true;
    const { error: e2 } = await sb.from('planner').upsert({ user_id: sbUser.id, data: state, updated_at: new Date().toISOString() });
    if (e2) throw e2;
    settings.lastSync = now(); save(LS_SET, settings);
    setSync('ok', verbose ? 'Synced ✓' : undefined);
    if (changedLocal) { render(); pushSchedule(); } else renderSyncBadge();
  } catch (e) {
    const m = e.message || String(e);
    setSync('err', /relation .*planner|does not exist|schema cache/i.test(m) ? 'The “planner” table is missing — run supabase-setup.sql in your Supabase SQL editor.' : m);
  } finally { syncing = false; }
}
function syncSoon() { if (!sbUser) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1500); }
setInterval(() => syncNow(), 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (sbUser) syncNow(); else if (carryOver()) commit(); checkAlarms(); } });
window.addEventListener('online', () => syncNow());

// ---------- platform ----------
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isStandalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
// iPhone install guide: shows in-page, tailored to the browser the link was opened in
function showIOSHelp() {
  if (!isIOS() || isStandalone() || NATIVE) return;
  try { if (localStorage.getItem('dp.iosHelpHidden') === '1') return; } catch {}
  const ua = navigator.userAgent;
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  const inApp = /FBAN|FBAV|Instagram|Line\/|WhatsApp|LinkedInApp|Twitter|Snapchat/.test(ua) || (!/Safari\//.test(ua) && !otherBrowser);
  const body = $('#iosHelpBody');
  if (otherBrowser || inApp) {
    body.innerHTML = `<h4>📱 To install, open this page in Safari</h4>
      <ol><li>Tap <b>Copy link</b> below.</li>
      <li>Open the <b>Safari</b> app (blue compass icon).</li>
      <li>Tap the address bar, <b>paste</b>, and tap <b>Go</b>.</li>
      <li>This box will then show the next steps.</li></ol>
      <button class="copy" id="iosCopy">Copy link</button>`;
    $('#iosCopy').onclick = async () => {
      const url = 'https://day-planner-cosmo-zen.vercel.app/';
      try { await navigator.clipboard.writeText(url); toast('Link copied — now open Safari'); }
      catch { prompt('Copy this link, then open it in Safari:', url); }
    };
  } else {
    body.innerHTML = `<h4>📱 Add Day Planner to your iPhone</h4>
      <ol><li>Tap the <span class="kbd">⬆</span> <b>Share</b> button at the bottom of Safari.<br><span class="muted small">Don't see it? Tap <span class="kbd">•••</span> first, then <b>Share</b>. If the bottom bar is hidden, scroll the page up a little.</span></li>
      <li>In the panel that opens, <b>swipe up</b> and tap <b>Add to Home Screen</b> <span class="kbd">⊞</span>.<br><span class="muted small">Not listed? Tap <b>More</b> / <b>Edit Actions</b> at the bottom and add it.</span></li>
      <li>Tap <b>Add</b> (top right).</li>
      <li>Open <b>Planner</b> from your Home Screen, then Settings → <b>Sign in</b>.</li></ol>`;
  }
  $('#iosHelp').classList.remove('hidden');
}
$('#iosHelpClose').onclick = () => { $('#iosHelp').classList.add('hidden'); try { localStorage.setItem('dp.iosHelpHidden', '1'); } catch {} };
if (!NATIVE && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.desktop?.onAlarmTick?.(() => checkAlarms()); // desktop shell asks us to check right when a task is due

// ---------- start ----------
// roll the selected day over at midnight
setInterval(() => { const t = todayStr(); if (renderToday._day && renderToday._day !== t) { if (selDay === renderToday._day) selDay = t; if (sbUser) syncNow(); else if (carryOver()) commit(); } renderToday._day = t; }, 30000);
renderToday._day = todayStr();
render();
showView('today');
initSync();
showIOSHelp();
pushSchedule();
checkAlarms();
setInterval(checkAlarms, 5000);

// test hook
window.__dp = { get state() { return state; }, merge, periodKey, makeICS, checkAlarms, alerts: () => alerts };
})();
