// The stand-alone leaderboard page (boards.html): browse every song's world board. Public data only, no sign-in.
// List logic and fetching live in boardsview.js; this file is the DOM.
import { t as tr, fmt, setLang, getLang, applyStatic, detect, LANGS } from './i18n.js';
import { API_BASE } from './cloud.js';
import { CATEGORIES } from './songs.js';
import { buildLibrary, setMeasured } from './library.js';
import { ratingOf } from './listview.js';
import { esc, badgeHTML, nameHTML, starsBar } from './rowfmt.js';
import { BOARD_SORTS, loadSnapshot, loadBoard, songRows, loadView, saveView } from './boardsview.js';

const $ = id => document.getElementById(id);
const store = (() => { try { return localStorage; } catch { return { getItem: () => null, setItem() {} }; } })();
const apiBase = (() => { try { return store.getItem('ringbeat.api') || API_BASE; } catch { return API_BASE; } })();
const REFRESH = 30e3;
const DEBOUNCE = 250;

// Follow the game's language setting (read only: the game owns that entry); the header button switches for this visit.
try { setLang((JSON.parse(store.getItem('ringbeat.v1')) || {}).lang || detect(navigator.languages)); } catch { setLang(detect(navigator.languages)); }

let entries = buildLibrary();
const view = loadView(store);
let snap = null, loadError = false;
let cur = '';                    // the song under the cursor
let open = false;                // narrow screens: the board is open instead of the list
const deep = new Map();          // 'id|diff' -> rows | 'loading' | 'failed'
let timer = 0;
const wide = () => matchMedia('(min-width: 720px)').matches;
const chartOf = id => (entries.find(e => e.id === id) || {}).chart;
const key = (id = cur) => id + '|' + chartOf(id);
const rows = () => songRows(snap, entries, view);
const starsOf = e => { const r = ratingOf(e); return starsBar(r, tr('{v} of 5 stars', { v: fmt(r / 2, 1) })); };
const date = ms => ms ? new Date(ms).toLocaleDateString(getLang()) : '';
const pct = a => (typeof a === 'number' ? fmt(Math.round(a * 1000) / 10, 1) + '%' : '');

function paintBar() {
  const sel = (id, label, on) => `<button type="button" role="tab" data-id="${id}" aria-selected="${on}">${esc(tr(label))}</button>`;
  $('bd-cats').innerHTML = [{ id: 'all', label: 'All' }, ...CATEGORIES].map(c => sel(c.id, c.label, c.id === view.category)).join('');
  $('bd-sort').innerHTML = BOARD_SORTS.map(s => `<option value="${s.id}">${esc(tr(s.label))}</option>`).join('');
  $('bd-sort').value = view.sort;
  $('bd-lang').textContent = getLang().toUpperCase();
  paintAge();
}
function paintAge() {
  const s = snap && snap.built ? Math.max(0, Math.round((Date.now() - snap.built) / 1000)) : -1;
  $('bd-age').textContent = s < 0 ? '' : s < 90 ? tr('Updated {n} sec ago', { n: s }) :
    s < 5400 ? tr('Updated {n} min ago', { n: Math.round(s / 60) }) : tr('Updated {n} h ago', { n: Math.round(s / 3600) });
}

function paintList() {
  const list = rows();
  if (!list.some(r => r.entry.id === cur)) cur = list[0] ? list[0].entry.id : '';
  const ol = $('bd-list');
  if (!snap) { ol.innerHTML = ''; return; }
  ol.innerHTML = list.map(({ entry: e, leader }) => `<li><button type="button" class="bd-row${e.id === cur ? ' cur' : ''}" data-id="${esc(e.id)}">` +
    `<span class="t">${esc(e.title)}</span><span class="s">${starsOf(e)}</span>` +
    `<span class="lead">${leader ? `${fmt(leader.score)} ${esc(leader.grade)}${badgeHTML(leader)} ${nameHTML(leader)}` : esc(tr('No scores yet'))}</span></button></li>`).join('') ||
    `<li class="bd-msg">${esc(tr('No songs match.'))}</li>`;
}

function paintDetail() {
  const el = $('bd-detail'), e = entries.find(x => x.id === cur);
  if (loadError && !snap) {
    el.innerHTML = `<div class="bd-msg">${esc(tr('Could not load the boards.'))}<br><button type="button" id="bd-retry">${esc(tr('Retry'))}</button></div>`;
    return;
  }
  if (!snap) { el.innerHTML = `<div class="bd-msg">${esc(tr('Loading'))}<span class="bd-dots"></span></div>`; return; }
  if (!e) { el.innerHTML = ''; return; }
  const state = deep.get(key());
  const runs = Array.isArray(state) ? state : (snap.boards[key()] || []);
  const note = state === 'loading' ? `<span class="bd-dots"></span>` : state === 'failed' ? esc(tr('Showing the top 10 only.')) : '';
  el.innerHTML = `<h2>${esc(e.title)}</h2><div class="hint">${esc(e.tag)} · ${starsOf(e)} ${note}</div>` +
    (runs.length ? `<table class="bd-table"><thead><tr><th class="n">#</th><th>${esc(tr('Player'))}</th><th class="n">${esc(tr('Score'))}</th><th>${esc(tr('Grade'))}</th>` +
      `<th class="n opt">${esc(tr('Acc'))}</th><th class="n opt">${esc(tr('Combo'))}</th><th class="opt">${esc(tr('Date'))}</th></tr></thead><tbody>` +
      runs.map((r, i) => `<tr><td class="n">${r.rank || i + 1}</td><td class="nm-c">${nameHTML(r)}${badgeHTML(r, true)}</td><td class="n">${fmt(r.score)}</td><td>${esc(r.grade)}</td>` +
        `<td class="n opt">${pct(r.accuracy)}</td><td class="n opt">${fmt(r.maxCombo || 0)}</td><td class="opt">${esc(date(r.playedAt))}</td></tr>`).join('') + '</tbody></table>'
      : `<div class="bd-msg">${esc(tr('No scores yet'))}</div>`);
}

function paintSoft() {
  $('bd-soft-l').textContent = open ? '' : tr('Open');
  $('bd-soft-r').textContent = open ? tr('Back') : '';
  document.querySelector('.bd').classList.toggle('open', open);
}
const paint = () => { paintBar(); paintList(); paintDetail(); paintSoft(); };

// Top 10 shows at once from the snapshot; the full board comes when it is opened (or, on wide screens, when the cursor rests on it).
function wantDeep() {
  clearTimeout(timer);
  if (!cur || !snap) return;
  const k = key(), id = cur, diff = chartOf(id);
  if (Array.isArray(deep.get(k)) || deep.get(k) === 'loading') return;
  if (!open && !wide()) return;
  timer = setTimeout(() => {
    deep.set(k, 'loading'); paintDetail();
    loadBoard(fetch, apiBase, id, diff).then(r => deep.set(k, r), () => deep.set(k, 'failed')).finally(() => { if (key() === k) paintDetail(); });
  }, open ? 0 : DEBOUNCE);
}

function select(id, scroll = true) {
  cur = id; paintList(); paintDetail(); wantDeep();
  const b = document.querySelector('.bd-row.cur');
  if (b && scroll) b.scrollIntoView({ block: 'nearest' });
}
function move(d) {
  const list = rows(); if (!list.length) return;
  const i = Math.max(0, list.findIndex(r => r.entry.id === cur));
  select(list[(i + d + list.length) % list.length].entry.id);
}
function setView(patch) {
  Object.assign(view, patch); saveView(store, view);
  open = false; paint(); wantDeep();
}
function cycle(items, id, d) { return items[(items.findIndex(x => x === id) + d + items.length) % items.length]; }
const CATS = ['all', ...CATEGORIES.map(c => c.id)];

function openBoard() { if (!cur) return; open = true; paintSoft(); wantDeep(); paintDetail(); }
function closeBoard() { open = false; paintSoft(); const b = document.querySelector('.bd-row.cur'); if (b) b.focus(); }

async function refresh() {
  try { snap = await loadSnapshot(fetch, apiBase, snap); loadError = false; }
  catch { loadError = true; }
  paint(); wantDeep();
}

$('bd-cats').onclick = e => { const b = e.target.closest('button'); if (b) setView({ category: b.dataset.id }); };
$('bd-sort').onchange = e => setView({ sort: e.target.value });
$('bd-q').oninput = e => { view.query = e.target.value; paintList(); paintDetail(); wantDeep(); };
$('bd-list').onclick = e => { const b = e.target.closest('.bd-row'); if (!b) return; select(b.dataset.id, false); if (!wide()) openBoard(); };
$('bd-list').ondblclick = openBoard;
$('bd-soft-l').onclick = openBoard;
$('bd-soft-r').onclick = closeBoard;
$('bd-detail').onclick = e => { if (e.target.id === 'bd-retry') { loadError = false; paint(); refresh(); } };
$('bd-lang').onclick = () => {
  const codes = Object.keys(LANGS);
  setLang(cycle(codes, getLang(), 1)); applyStatic(); paint();
};

addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const inField = /^(INPUT|SELECT)$/.test(e.target.tagName);
  if (inField) {
    if (e.key === 'Escape' || (e.key === 'ArrowDown' && e.target.tagName === 'INPUT')) { e.preventDefault(); e.target.blur(); $('bd-list').focus(); }
    return;
  }
  const k = e.key;
  const onList = e.target === document.body || e.target.id === 'bd-list' || e.target.classList.contains('bd-row');
  if ((k === 'Enter' || k === 'Backspace') && !onList) return; // a focused button or link keeps its own Enter
  if (k === 'ArrowDown') move(1);
  else if (k === 'ArrowUp') move(-1);
  else if (k === 'Enter' || k === 'ArrowRight') { if (!open) openBoard(); else return; }
  else if (k === 'ArrowLeft' || k === 'Escape' || k === 'Backspace') { if (open) closeBoard(); else return; }
  else if (k === '/') $('bd-q').focus();
  else if (k === '[' || k === ']') setView({ category: cycle(CATS, view.category, k === ']' ? 1 : -1) });
  else return;
  e.preventDefault();
});

applyStatic();
paint();
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, REFRESH);
setInterval(paintAge, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

// Bot-measured ratings load after the first paint, as in the game; the list re-sorts once they arrive.
fetch(new URL('./difficulty.json', import.meta.url))
  .then(r => (r.ok ? r.json() : null))
  .then(data => { if (!data) return; setMeasured(data); entries = buildLibrary(); paint(); })
  .catch(() => { /* estimated ratings stay */ });

// Test hook, like the game's (smoke test only reads it).
window.__boards = { view, rows, get cur() { return cur; }, get open() { return open; } };
