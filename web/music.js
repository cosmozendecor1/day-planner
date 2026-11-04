/* Music tab: one tap to Amazon Music, quick searches, and your own saved playlist links.
   Amazon does not allow its music to play inside other apps, so these open Amazon Music itself (the app on a phone, the web player on a laptop). */
(() => {
'use strict';
const KEY = 'dp.music.v1', HOME = 'https://music.amazon.in/';
const IDEAS = [['Focus', 'focus'], ['Lo-fi', 'lofi'], ['Instrumental', 'instrumental'], ['Hindi chill', 'hindi chill'], ['Workout', 'workout'], ['Classical', 'classical']];
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let st = { lists: [] };
try { st = JSON.parse(localStorage.getItem(KEY)) || st; } catch {}
st.lists = Array.isArray(st.lists) ? st.lists : [];
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
const ok = u => { try { const h = new URL(u).hostname; return /(^|\.)amazon\.(in|com)$|(^|\.)amzn\.(to|com)$/.test(h) && /^https:/.test(u); } catch { return false; } };

function render() {
  const el = $('#view-music'); if (!el) return;
  el.innerHTML = `<div class="l-head"><div><h2 class="l-title">Music</h2><span class="muted small">Amazon Music while you plan and work</span></div></div>
  <div class="card m-hero"><div class="m-ico">🎵</div><a class="primary-btn wide m-open" href="${HOME}" target="_blank" rel="noopener">Open Amazon Music</a>
  <p class="muted small" style="margin:10px 0 0">Amazon does not allow its music to play inside other apps, so this opens Amazon Music itself (the app on your phone, the web player on your laptop). Your planner and alarms keep running.</p></div>
  <div class="card"><h3>Quick searches</h3><div class="m-chips">${IDEAS.map(i => `<a class="ghost-btn m-chip" href="${HOME}search/${encodeURIComponent(i[1])}" target="_blank" rel="noopener">${esc(i[0])}</a>`).join('')}</div></div>
  <div class="card"><h3>Your playlists</h3>${st.lists.length ? `<ul class="m-list">${st.lists.map((l, i) => `<li><a class="m-link" href="${esc(l.url)}" target="_blank" rel="noopener">▶ ${esc(l.name)}</a><button class="icon-btn m-del" data-mdel="${i}" aria-label="Remove">×</button></li>`).join('')}</ul>` : '<p class="muted small">Add the playlists you like, then start them in one tap. In Amazon Music, open a playlist, tap Share, copy the link and paste it here.</p>'}
  <form id="musicForm" class="m-form"><input id="mName" maxlength="40" placeholder="Name, e.g. Deep work" required><input id="mUrl" type="url" placeholder="Paste the Amazon Music link" required><button class="primary-btn" type="submit">Add</button></form><p id="mMsg" class="small msg"></p>
  <p class="muted small">Saved on this device only.</p></div>`;
}
document.addEventListener('submit', e => {
  if (e.target.id !== 'musicForm') return; e.preventDefault();
  const name = $('#mName').value.trim(), url = $('#mUrl').value.trim();
  if (!ok(url)) { $('#mMsg').textContent = 'That does not look like an Amazon Music link (it should start with https://music.amazon).'; $('#mMsg').className = 'small msg err'; return; }
  st.lists.push({ name, url }); save(); render();
});
document.addEventListener('click', e => { const b = e.target.closest('[data-mdel]'); if (b) { st.lists.splice(+b.dataset.mdel, 1); save(); render(); } });
window.addEventListener('load', render);
render();
})();
