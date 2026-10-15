// Bootstrap, screen state machine, wiring.
// States: title -> select <-> (options | info | custom | settings <-> calibration | training) -> countin -> playing <-> paused -> results -> select
// Every menu is a <section> inside the phone's LCD; during play the phone moves aside and shows "now playing".

import { generateChart } from './chart.js';
import { sliceChart, scaleChart } from './practice.js';
import { Synth } from './synth.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Input, KEY_LABELS, eventAudioTime } from './input.js';
import { encodeSong, decodeSong } from './share.js';
import { Calibration } from './calibration.js';
import { settings, saveSettings as save, num } from './settings.js';
import { buildLibrary, customEntry, formatLength, setMeasured } from './library.js';
import { CATEGORIES } from './songs.js';
import { SORTS, FILTERS, applyView, nextOf, prevOf, ratingOf } from './listview.js';
import { createScores } from './scores.js';
import { createMySongs, splitRtttl, rtttlProblem, MAX_SONGS } from './mysongs.js';
import * as comp from './composer.js';
import { Pad, BTN, buttonName, laneForSlot, DEFAULT_BINDINGS, cloneBindings } from './gamepad.js';
import { STAGES, buildStageChart, stagePassed, goalText, failReason } from './tutorial.js';
import * as nav from './nav.js';
import { coverRows } from './cover.js';
import { SPRITES, spriteHTML, setSprite, signal, battery, ringing } from './pixelart.js';
import { VERSION } from './version.js';
import { perf } from './perf.js';
import { createHud, copyReport } from './perfhud.js';

const $ = id => document.getElementById(id);

// ---- core objects ----
const synth = new Synth();
synth.volume = settings.volume;
synth.voice = settings.voice;
const game = new Game(synth);
const renderer = new Renderer($('stage'));
renderer.scrollTime = settings.scrollTime;
// Rolling quality of the last judgements drives the phones' signal bars.
const QUALITY = { perfect: 1, great: 0.8, good: 0.5, miss: 0 };
const recent = new Float32Array(16);
let recentN = 0;
game.fx = {
  press: renderer.fx.press,
  judge: (lane, j) => { renderer.fx.judge(lane, j); recent[recentN++ % recent.length] = QUALITY[j]; },
};
const input = new Input({ getCtx: () => synth.ctx, canvas: $('stage'), laneAt: x => renderer.laneAt(x) });
input.onPress = (lane, t) => { setDevice('kbd'); game.press(lane, t); };
input.onRelease = (lane, t) => game.release(lane, t);
const calibration = new Calibration(synth);
const scores = createScores();
const pad = new Pad();

// ---- screen state ----
let state = 'title';
let lastDevice = 'kbd'; // decides which labels the lanes show
const screens = {
  title: $('title'), select: $('select'), options: $('options'), custom: $('custom'),
  mysongs: $('mysongs'), songmenu: $('songmenu'), composer: $('composer'), diffpick: $('diffpick'),
  settings: $('settings'), training: $('training'), tutorial: $('tutorial'), results: $('results'), paused: $('pause'),
  calibration: $('calib'), nowplaying: $('nowplaying'),
};
const inPlay = () => state === 'countin' || state === 'playing' || state === 'resuming';
function show(name) {
  name = name || (inPlay() ? 'nowplaying' : name);
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  $('btn-pause').hidden = !inPlay();
  if (!['select', 'custom', 'options', 'mysongs', 'songmenu', 'composer', 'diffpick'].includes(name)) stopPreview();
  const tut = !!(run && run.tutorial && (inPlay() || state === 'paused'));
  $('np-caption').hidden = !tut;
  const el = screens[name];
  if (el) {
    refreshChrome(el);
    paintRanges(el);
    if (inPlay()) { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }
    else requestAnimationFrame(() => { if (!el.contains(document.activeElement)) focusDefault(el); });
  }
  setMode();
}
function setState(s, screen) { state = s; show(screen); input.enabled = s === 'countin' || s === 'playing'; }
// Status bar title + soft-key labels come from the visible screen's data attributes.
function refreshChrome(el = screens[Object.keys(screens).find(k => !screens[k].hidden)]) {
  if (!el) return;
  $('st-title').textContent = el.dataset.title || '';
  $('soft-left').textContent = el.dataset.softLeft || '';
  $('soft-right').textContent = el.dataset.softRight || '';
}
// Sliders paint their filled segments from --p.
function paintRange(el) {
  const min = +el.min || 0, max = +el.max || 100;
  el.style.setProperty('--p', ((el.value - min) / (max - min) * 100).toFixed(1) + '%');
}
function paintRanges(root) { root.querySelectorAll('input[type=range]').forEach(paintRange); }
function focusDefault(el) {
  const cur = el === screens.select && Array.from($('song-list').children).find(b => b.dataset.id === selectedId);
  const d = cur || el.querySelector('[data-default]:not([disabled])') || nav.focusables(el)[0];
  if (d && !el.hidden) { d.focus({ preventScroll: true }); light(d); }
}
// The highlighted list item follows focus but stays lit while focus is elsewhere (e.g. on a phone key).
let lit = null;
function light(el) {
  const item = el && el.closest && el.closest('.menu > *');
  if (!item || item === lit) return;
  if (lit) lit.classList.remove('hl');
  lit = item; lit.classList.add('hl');
}
const activeScreen = () => screens[state === 'countin' || state === 'playing' || state === 'resuming' ? '' : state];

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  // Pop up in the middle of the phone's LCD when it is on screen, else at the bottom of the viewport.
  const r = $('phone').classList.contains('off') ? null : $('lcd').getBoundingClientRect();
  const onLcd = !!(r && r.width > 0 && r.left >= 0 && r.right <= window.innerWidth + 1);
  t.classList.toggle('on-lcd', onLcd);
  t.style.left = onLcd ? r.left + r.width / 2 + 'px' : '';
  t.style.top = onLcd ? r.top + r.height / 2 + 'px' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---- library & selection ----
let builtins = buildLibrary(); // rebuilt once difficulty.json has loaded
const mysongs = createMySongs();
let customs = [];        // library entries for the player's saved songs ({...entry, uid})
let selectedId = '';

function refreshCustoms() {
  const seen = new Set();
  customs = [];
  for (const s of mysongs.list()) {
    const e = customEntry(s.rtttl);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    customs.push({ ...e, title: s.name || e.title, uid: s.uid });
  }
}
const entries = () => (customs.length ? [...builtins, ...customs] : builtins);
const entryById = id => entries().find(e => e.id === id) || null;
const selectedEntry = () => entryById(selectedId) || visible()[0] || entries()[0];
// Entries after the song-select sort/filter (for the current difficulty).
const visible = () => applyView(entries(), settings.view, settings.difficulty, scores);

// ---- preview (plays the song straight through, optionally cut at maxSec) ----
let previewTimer = null, autoPreviewTimer = null;
function stopPreview() {
  clearTimeout(previewTimer); clearTimeout(autoPreviewTimer);
  previewTimer = autoPreviewTimer = null;
  if (synth.ctx) synth.stopAll();
  $('btn-preview').textContent = 'Preview';
  for (const id of ['btn-custom-preview', 'sm-preview', 'comp-preview']) $(id).textContent = 'Preview';
}
function startPreview(entry, maxSec = Infinity) {
  stopPreview();
  if (!entry) return;
  const ctx = synth.ensure();
  const beat = 60 / entry.song.bpm, t0 = ctx.currentTime + 0.15;
  let end = 0;
  for (const n of entry.song.notes) {
    if (n.isRest) continue;
    if (n.startBeat * beat > maxSec) break;
    synth.playNote({ midi: n.midi, when: t0 + n.startBeat * beat, duration: n.durBeat * beat * 0.92 });
    end = Math.max(end, n.startBeat + n.durBeat);
  }
  $('btn-preview').textContent = 'Stop preview';
  for (const id of ['btn-custom-preview', 'sm-preview', 'comp-preview']) $(id).textContent = 'Stop preview';
  previewTimer = setTimeout(stopPreview, (end * beat + 0.4) * 1000);
}
function togglePreview(entry) {
  if (previewTimer) stopPreview(); else startPreview(entry);
}

// ---- song select screen ----
function badgeHTML(run) {
  return run && run.ap ? '<span class="badge ap">AP</span>' : run && run.fc ? '<span class="badge">FC</span>' : '';
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
// Five stars filled proportionally to a 1..10 rating (half-star precision), e.g. 6.0 -> 3 stars.
function starsText(rating) {
  const pct = Math.max(0, Math.min(100, Math.round(rating * 5) * 2));
  return `<span class="stars-bar" role="img" aria-label="${(rating / 2).toFixed(1)} of 5 stars">` +
    `<span class="off">★★★★★</span><span class="on" style="width:${pct}%">★★★★★</span></span>`;
}

// Category chips: All + each category (+ Custom when a custom song exists), with song counts.
function categoryTabs() {
  const all = entries();
  const tabs = [{ id: 'all', label: 'All' }, ...CATEGORIES];
  if (customs.length) tabs.push({ id: 'custom', label: 'Custom' });
  return tabs.map(t => ({ ...t, count: t.id === 'all' ? all.length : all.filter(e => e.category === t.id).length }));
}
function renderCategories() {
  const tabs = categoryTabs();
  if (!tabs.some(t => t.id === settings.view.category)) settings.view.category = 'all';
  const t = tabs.find(x => x.id === settings.view.category);
  $('view-cat').textContent = `Category: ${t.label} (${t.count})`;
  $('sel-cat').textContent = `${t.label} (${t.count})`;
  const sort = SORTS.find(x => x.id === settings.view.sort), filter = FILTERS.find(x => x.id === settings.view.filter);
  $('sel-sub').textContent = `${sort.label} · ${cap(settings.difficulty)}${filter.id === 'all' ? '' : ' · ' + filter.label}`;
}
function setCategory(id) {
  settings.view.category = id; save();
  const keep = selectedEntry();
  if (keep && !visible().includes(keep)) selectSong((visible()[0] || keep).id, false);
  renderList();
  renderDetail();
  if (state === 'select') focusCurrentRow();
}
function cycleCategory(step) {
  const tabs = categoryTabs().filter(t => t.count > 0);
  const i = tabs.findIndex(t => t.id === settings.view.category);
  setCategory(tabs[(i + step + tabs.length) % tabs.length].id);
}

function renderList() {
  renderCategories();
  const box = $('song-list');
  box.textContent = '';
  const list = visible();
  $('view-sort').textContent = 'Sort: ' + SORTS.find(x => x.id === settings.view.sort).label;
  $('view-filter').textContent = 'Show: ' + FILTERS.find(x => x.id === settings.view.filter).label;
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint empty';
    p.textContent = 'No songs match this filter.';
    box.appendChild(p);
  }
  for (const e of list) {
    const b = document.createElement('button');
    b.className = 'song-row';
    b.dataset.id = e.id;
    b.setAttribute('role', 'option');
    const rec = scores.get(e.id, settings.difficulty);
    const best = rec && rec.best;
    b.innerHTML =
      spriteHTML(SPRITES[e.category] || SPRITES.custom, 2) +
      `<span class="t">${esc(e.title)}</span>` +
      `<span class="b">${best ? `${esc(best.grade)}${badgeHTML(best)}` : ''}</span>`;
    b.addEventListener('focus', () => selectSong(e.id, false));
    b.addEventListener('click', ev => {
      if (selectedId !== e.id) selectSong(e.id, false);
      else if (ev.detail === 0) playSelected(); // keyboard / gamepad confirm; mouse uses double-click
    });
    b.addEventListener('dblclick', playSelected);
    box.appendChild(b);
  }
  markSelected();
}
function markSelected() {
  for (const b of $('song-list').children) {
    const on = b.dataset.id === selectedId;
    b.classList.toggle('cur', on);
    b.setAttribute('aria-selected', String(on));
  }
}

function renderDetail() {
  selectHints();
  const e = selectedEntry();
  if (!e) return;
  const d = settings.difficulty, rec = scores.get(e.id, d);
  $('sel-info').innerHTML =
    `<div>${starsText(ratingOf(e, d))}<b>${ratingOf(e, d).toFixed(1)}</b>` +
    (rec ? ` · ${rec.best.score} ${esc(rec.best.grade)}${badgeHTML(rec.best)}` : ' · New') + `</div>` +
    `<div>${e.bpm} BPM · ${formatLength(e.length)} · ${e.notes[d]} notes${e.tag ? ' · ' + esc(e.tag) : ''}</div>`;
}

function selectSong(id, scroll = true) {
  if (!entryById(id)) return;
  const changed = id !== selectedId;
  selectedId = id;
  settings.lastSongId = id; save();
  markSelected();
  renderDetail();
  if (scroll) {
    const row = Array.from($('song-list').children).find(b => b.dataset.id === id);
    if (row) revealRow(row);
  }
  if (changed) {
    stopPreview();
    if (settings.preview && state === 'select' && synth.ctx) {
      autoPreviewTimer = setTimeout(() => startPreview(selectedEntry(), 10), 450);
    }
  }
}

function setView(key, list, step = 1) {
  settings.view[key] = (step < 0 ? prevOf : nextOf)(list, settings.view[key]);
  save();
  const keep = selectedEntry();
  if (keep && !visible().includes(keep)) selectSong((visible()[0] || keep).id, false);
  renderList();
  renderDetail();
  if (state === 'select') focusCurrentRow();
}
function focusCurrentRow() {
  requestAnimationFrame(() => { // look the row up late: the list may have been re-rendered or the selection moved
    if (state !== 'select') return;
    const row = Array.from($('song-list').children).find(b => b.dataset.id === selectedId);
    if (row) { revealRow(row); row.focus({ preventScroll: true }); }
  });
}
// Keep the cursor row inside the list viewport (centred when it had to jump), without scrolling the page.
function revealRow(row) {
  const list = $('song-list'), lr = list.getBoundingClientRect(), rr = row.getBoundingClientRect();
  if (rr.top < lr.top || rr.bottom > lr.bottom) list.scrollTop += rr.top + rr.height / 2 - (lr.top + lr.height / 2);
}
function openSelect() {
  renderList();
  renderDetail();
  setState('select', 'select');
  focusCurrentRow();
}
function openOptions() { renderCategories(); setState('options', 'options'); }

// ---- my songs: library list, per-song menu, composer, text/paste screen ----
const area = $('rtttl');
const slug = n => (String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song');
const rtttlName = (text, name) => { const i = text.indexOf(':'); return i < 0 ? text : String(name).replace(/[:,]/g, ' ') + text.slice(i); };
let curUid = '';           // song shown in the song menu
const curSong = () => mysongs.get(curUid);
const curEntry = () => customs.find(e => e.uid === curUid) || null;

function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function copyText(text, el, label) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* insecure context or denied: try legacy copy */ }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    const prev = document.activeElement;
    document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    if (prev && prev.focus) prev.focus();
  }
  el.textContent = ok ? label + ' copied to clipboard!' : "Couldn't access the clipboard";
}
// Select + remember the saved song; persists nothing else.
function afterSongsChanged(select) {
  refreshCustoms();
  const e = select && customs.find(c => c.uid === select.uid);
  if (e) { selectedId = e.id; settings.lastSongId = e.id; save(); }
}
// Why a save failed, in words the player can act on.
function saveProblem(text) {
  const p = rtttlProblem(text);
  if (p) return 'Cannot save: ' + p;
  if (mysongs.isFull()) return `My songs is full (max ${MAX_SONGS}): delete a song first`;
  return 'Cannot save: browser storage is unavailable';
}
function openMySongs(msg = '') {
  const list = $('ms-list');
  list.textContent = '';
  for (const e of customs) {
    const b = document.createElement('button');
    b.dataset.uid = e.uid;
    b.textContent = `${e.title} · ${e.notes.normal} notes · ${formatLength(e.length)}`;
    list.append(b);
  }
  $('ms-msg').textContent = msg || (customs.length ? '' : 'No songs yet. Make one with New song.');
  $('ms-new').disabled = $('ms-paste').disabled = mysongs.isFull();
  $('ms-export').disabled = !customs.length;
  setState('mysongs', 'mysongs');
  const cur = customs.find(c => c.uid === curUid);
  const b = cur && list.querySelector(`[data-uid="${cur.uid}"]`);
  if (b) { b.focus({ preventScroll: true }); light(b); }
}
function openSongMenu(uid) {
  curUid = uid;
  const e = curEntry();
  if (!e) { openMySongs(); return; }
  $('sm-title').textContent = e.title;
  $('sm-meta').textContent = `${e.bpm} BPM · ${e.notes.normal} notes · ${formatLength(e.length)}`;
  $('sm-msg').textContent = '';
  setState('songmenu', 'songmenu');
}
function importSharedText(text) {
  const r = mysongs.importText(text);
  refreshCustoms();
  return r;
}

// -- difficulty picker: also the song's detail screen (Info / Best / Top runs tabs for the focused difficulty) --
function cap(s) { return s[0].toUpperCase() + s.slice(1); }
let dpBack = null, dpEntry = null, dpDiff = 'normal', dpTab = 0;
const DP_TABS = ['Info', 'Best', 'Top'];
function setDpTab(i) {
  const n = Math.max(0, Math.min(DP_TABS.length - 1, i));
  if (n === dpTab) return;
  dpTab = n;
  renderDpPanel();
  synth.keyClick();
}
function renderDpPanel() {
  const e = dpEntry, d = dpDiff;
  if (!e) return;
  DP_TABS.forEach((_, i) => { const t = $('dp-tab-' + i); t.classList.toggle('sel', i === dpTab); t.setAttribute('aria-selected', String(i === dpTab)); });
  const rec = scores.get(e.id, d), box = $('dp-panel');
  if (dpTab === 0) {
    const tricky = e.tags && e.tags[d] && e.tags[d].length ? `<div class="hint">Tricky: ${esc(e.tags[d].join(', '))}</div>` : '';
    box.innerHTML = `<div>${cap(d)} ${starsText(ratingOf(e, d))}<b>${ratingOf(e, d).toFixed(1)}</b><span class="hint"> / 10</span></div>` +
      `<div>${e.notes[d]} notes</div>${tricky}`;
  } else if (dpTab === 1) {
    box.innerHTML = rec
      ? `<div><b>${rec.best.score}</b> · <b>${esc(rec.best.grade)}</b>${badgeHTML(rec.best)}</div>` +
        `<div>${rec.best.accuracy.toFixed(1)}% · ${rec.best.maxCombo}x combo</div>`
      : '<div class="hint">No plays yet</div>';
  } else {
    box.textContent = '';
    const ol = document.createElement('ol');
    ol.className = 'top';
    for (const r of (rec ? rec.top : [])) {
      const li = document.createElement('li');
      li.innerHTML = `${r.score} · ${esc(r.grade)} · ${r.accuracy.toFixed(1)}%${badgeHTML(r)}`;
      ol.appendChild(li);
    }
    if (!ol.children.length) box.innerHTML = '<div class="hint">No plays yet</div>'; else box.appendChild(ol);
  }
}
function askDifficulty(entry, ret, retLabel, goBack, uid, training = false) {
  dpBack = goBack;
  dpEntry = entry;
  dpTab = 0;
  setSprite($('dp-cover'), coverRows(entry.id, entry.category), 2);
  $('dp-title').textContent = entry.title;
  $('dp-meta').textContent = `${entry.tag ? entry.tag + ' · ' : ''}${entry.bpm} BPM · ${formatLength(entry.length)}`;
  for (const b of $('diffpick').querySelectorAll('[data-diff]')) {
    const d = b.dataset.diff, n = entry.notes[d] || 0, r = scores.get(entry.id, d);
    b.textContent = cap(d) + (n ? ` · ${'★'.repeat(entry.stars[d] || 1)} · ${n}` : ' · no notes') +
      (r ? ` · ${r.best.grade}${r.ap ? ' ★' : r.fc ? ' ✓' : ''}` : '');
    b.disabled = !n;
    b.toggleAttribute('data-default', d === settings.difficulty && !!n);
    b.onfocus = () => { dpDiff = d; renderDpPanel(); };
    b.onclick = () => {
      settings.difficulty = d;
      if (uid) { selectedId = entry.id; settings.lastSongId = entry.id; }
      save();
      if (training) { openTraining(); return; }
      startRun({ entry, diff: d, training: null, ret, retLabel });
    };
  }
  if (!$('diffpick').querySelector('[data-default]')) {
    const f = $('diffpick').querySelector('[data-diff]:not([disabled])');
    if (f) f.setAttribute('data-default', '');
  }
  const def = $('diffpick').querySelector('[data-default]');
  dpDiff = def ? def.dataset.diff : 'normal';
  renderDpPanel();
  setState('diffpick', 'diffpick');
}

// -- composer --
let cs = null, csUid = '', csDirty = false, csMenu = false, csLast = 0;
function compEntry() {
  return cs && cs.notes.length ? customEntry(comp.toRTTTL(cs)) : null;
}
function renderComposer() {
  const dur = cs.notes[cs.cursor - 1] ? cs.notes[cs.cursor - 1].dur : cs.pen.dur;
  $('comp-info').textContent = `${cs.name || 'Untitled'} · ${cs.bpm} BPM · 1/${dur} · oct ${cs.pen.oct}${csDirty ? ' · *' : ''}`;
  const box = $('comp-notes');
  box.textContent = '';
  const caret = () => { const c = document.createElement('span'); c.className = 'caret'; return c; };
  const from = Math.max(0, cs.cursor - 14), to = Math.min(cs.notes.length, from + 28);
  if (from > 0) { const m = document.createElement('span'); m.textContent = '…'; box.append(m); }
  if (cs.cursor === from) box.append(caret());
  for (let i = from; i < to; i++) {
    const n = cs.notes[i], sp = document.createElement('span');
    sp.textContent = (n.p === 'p' ? '–' : comp.noteLabel(n)) + (n.dotted ? '.' : '') + '/' + n.dur;
    if (n.p === 'p') sp.className = 'rest';
    if (i === cs.cursor - 1) sp.classList.add('cur');
    box.append(sp);
    if (i + 1 === cs.cursor) box.append(caret());
  }
  if (to < cs.notes.length) { const m = document.createElement('span'); m.textContent = '…'; box.append(m); }
  const e = compEntry(), st = $('comp-status');
  st.className = 'status ' + (e ? 'ok' : 'err');
  st.textContent = e ? `${cs.notes.length} notes · ${formatLength(e.length)}` : cs.notes.length ? 'Needs a playable note' : 'Press 1-7 to enter notes';
  $('comp-play').disabled = $('comp-preview').disabled = $('comp-save').disabled = !e;
  $('comp-bpm').value = cs.bpm; $('comp-bpm-val').textContent = cs.bpm;
  paintRange($('comp-bpm'));
}
function openComposer(text = '', uid = '') {
  try { cs = text ? comp.fromRTTTL(text) : comp.create(); } catch { cs = comp.create(); toast('Could not read that song'); }
  csUid = uid; csDirty = false; csMenu = false;
  $('comp-name').value = cs.name;
  $('comp-menu').hidden = true; $('comp-edit').hidden = false;
  screens.composer.dataset.softLeft = 'Menu'; screens.composer.dataset.softRight = 'Del';
  renderComposer();
  setState('composer', 'composer');
}
function setCompMenu(open) {
  csMenu = open;
  $('comp-menu').hidden = !open; $('comp-edit').hidden = open;
  screens.composer.dataset.softLeft = open ? 'Select' : 'Menu';
  screens.composer.dataset.softRight = open ? 'Back' : 'Del';
  refreshChrome(screens.composer);
  renderComposer();
  requestAnimationFrame(() => focusDefault(screens.composer));
  if (open) { const d = $('comp-play'); if (!d.disabled) d.focus({ preventScroll: true }); }
}
function compSound() {
  const n = cs.notes[cs.cursor - 1];
  if (!n || n.p === 'p') return;
  const ctx = synth.ensure();
  synth.playNote({ midi: comp.midiOf(n), when: ctx.currentTime + 0.01, duration: 0.25 });
}
const LETTER_KEYS = { c: '1', d: '2', e: '3', f: '4', g: '5', a: '6', b: '7', p: '0' };
// k: '0'-'7' notes, '8'/'9' length -/+, '*' dot, '#' sharp, left/right cursor, up/down pitch, del, add (controller)
function compInput(k) {
  if (LETTER_KEYS[k]) k = LETTER_KEYS[k];
  if (previewTimer) stopPreview();
  let changed = true, sound = true;
  switch (k) {
    case '8': comp.changeDur(cs, -1); break;
    case '9': comp.changeDur(cs, 1); break;
    case '*': changed = comp.toggleDot(cs); break;
    case '#': changed = comp.toggleSharp(cs); break;
    case 'left': comp.move(cs, -1); changed = false; break;
    case 'right': comp.move(cs, 1); changed = false; break;
    case 'up': changed = comp.stepPitch(cs, 1); break;
    case 'down': changed = comp.stepPitch(cs, -1); break;
    case 'del': changed = comp.backspace(cs); sound = false; break;
    case 'add': changed = comp.addNote(cs); break;
    case 'rest': changed = comp.addRest(cs); sound = false; break;
    default:
      if (/^[0-7]$/.test(k)) { changed = comp.pressNote(cs, k, performance.now()); sound = k !== '0'; }
      else return;
  }
  if (changed) csDirty = true;
  if (!changed && ['*', '#', 'up', 'down', 'add'].includes(k)) toast('Not possible here', 900);
  if (changed && sound) compSound();
  else if (k === 'left' || k === 'right') { const n = cs.notes[cs.cursor - 1]; if (n && n.p !== 'p') compSound(); }
  renderComposer();
}
function saveComposer() {
  cs.name = $('comp-name').value;
  const text = comp.toRTTTL(cs);
  if (!customEntry(text)) { toast('Add a note first'); return false; }
  const s = csUid && mysongs.get(csUid) ? mysongs.update(csUid, { rtttl: text, name: cs.name || 'Untitled' }) : mysongs.add(cs.name || 'Untitled', text);
  if (!s) { toast(saveProblem(text)); return false; }
  csUid = s.uid; csDirty = false;
  afterSongsChanged(s);
  toast('Saved');
  renderComposer();
  return true;
}
function leaveComposer() {
  stopPreview();
  if (csUid) openSongMenu(csUid); else openMySongs();
}

// -- text / paste screen --
let txtUid = '';
function updateCustomStatus() {
  const st = $('status');
  const text = area.value.trim();
  const e = text ? customEntry(text) : null;
  if (!e) {
    st.className = 'status err';
    st.textContent = '✗ ' + (text ? 'Not a valid RTTTL song (needs name:d=4,o=5,b=120:notes)' : 'Paste an RTTTL string');
  } else {
    st.className = 'status ok';
    const w = e.song.warnings;
    st.textContent = `✓ ${e.title} · ${e.bpm} BPM · ${e.notes.normal} notes` +
      (w.length ? ` · ⚠ ${w.slice(0, 3).join('; ')}${w.length > 3 ? ` (+${w.length - 3} more)` : ''}` : '');
  }
  for (const id of ['btn-custom-save', 'btn-custom-play', 'btn-custom-preview', 'btn-custom-compose']) $(id).disabled = !e;
}
function openCustom(text = '', uid = '') {
  area.value = text; txtUid = uid;
  const e0 = text ? customEntry(text) : null;
  $('custom-name').value = e0 ? e0.song.name : '';
  $('share-msg').textContent = '';
  updateCustomStatus();
  setState('custom', 'custom');
}

// ---- training mode (toggle beside the difficulties) ----
let trainingMode = false;
function setTrainingMode(on) {
  trainingMode = on;
  const b = $('btn-train-mode');
  b.classList.toggle('sel', on);
  b.setAttribute('aria-pressed', String(on));
  b.textContent = 'Training: ' + (on ? 'On' : 'Off');
  $('btn-play').textContent = on ? 'Train' : 'Play';
  screens.select.dataset.title = on ? 'Training' : 'Ringing tones';
  refreshChrome();
}

// ---- training options ----
function openTraining() {
  const e = selectedEntry(), t = settings.training;
  $('t-song').textContent = `${e.title} · ${settings.difficulty}`;
  $('t-speed').value = Math.round(t.speed * 100);
  $('t-loop').checked = t.loop;
  $('t-a').value = Math.round(t.a * 100);
  $('t-b').value = Math.round(t.b * 100);
  updateTrainingLabels();
  setState('training', 'training');
}
function updateTrainingLabels() {
  const t = settings.training;
  $('t-speed-val').textContent = Math.round(t.speed * 100) + '%';
  $('t-a-val').textContent = Math.round(t.a * 100) + '%';
  $('t-b-val').textContent = Math.round(t.b * 100) + '%';
  $('t-a').disabled = $('t-b').disabled = !t.loop;
}

// ---- play / pause / results ----
let run = null; // { entry, diff, training: null | {speed, loop, a, b} }

function laneLabels(lanes) {
  if (lastDevice === 'pad') {
    return Array.from({ length: lanes }, (_, i) => {
      const slot = lanes === 3 ? i + 1 : i;
      return buttonName(settings.padBindings[slot][0]);
    });
  }
  return KEY_LABELS[lanes];
}

function startRun(r) {
  // A melody can have no playable notes at the chosen difficulty (e.g. only very short notes on Easy):
  // charts exist for every difficulty it can be played at, so use the nearest one that has notes.
  if (r.entry && r.entry.notes && !r.entry.notes[r.diff]) {
    const alt = ['normal', 'hard', 'easy'].find(d => r.entry.notes[d] > 0);
    if (alt) { toast(`No notes on ${r.diff}: playing ${alt}`); r.diff = alt; }
  }
  run = r;
  for (const id of ['btn-quit', 'btn-menu']) $(id).textContent = r.retLabel || 'Song select';
  stopPreview();
  let chart;
  try {
    if (r.tutorial) {
      chart = buildStageChart(STAGES[r.tutorial.stage]);
    } else {
      chart = perf.time('chartgen', () => generateChart(r.entry.song, { difficulty: r.diff }));
    }
    if (r.training) {
      const { speed, loop, a, b } = r.training;
      if (loop) chart = sliceChart(chart, a * chart.length, b * chart.length);
      if (speed !== 1) chart = scaleChart(chart, speed);
    }
  } catch (e) {
    toast('✗ ' + e.message, 3500);
    return false;
  }
  synth.ensure();
  synth.setVolume(settings.volume);
  renderer.title = r.tutorial ? STAGES[r.tutorial.stage].title : r.entry.title;
  renderer.trainingLabel = r.training
    ? `TRAINING ${Math.round(r.training.speed * 100)}%` +
      (r.training.loop ? ` · LOOP ${Math.round(r.training.a * 100)}–${Math.round(r.training.b * 100)}%` : '')
    : '';
  renderer.scrollTime = settings.scrollTime;
  renderer.setLanes(chart.lanes, laneLabels(chart.lanes));
  renderer.resetState();
  screens.nowplaying.dataset.title = renderer.title;
  recent.fill(1); recentN = 0;
  phoneCache.key = '';
  input.setLanes(chart.lanes);
  padHeld.forEach(s => s.clear());
  if (r.tutorial) showCaption(r.tutorial.stage);
  game.start(chart, { leadIn: r.tutorial ? 1.5 : 2, backing: settings.backing, calibration: settings.calibration });
  setState('countin', null);
  return true;
}
function restartRun() { resumeEnd = 0; renderer.resumeCount = 0; if (run) startRun(run); }

function playSelected() {
  const e = selectedEntry();
  if (e) askDifficulty(e, null, null, openSelect, null, trainingMode);
}

function leaveToSelect() {
  resumeEnd = 0;
  renderer.resumeCount = 0;
  game.stop();
  input.reset();
  leaveRun();
}
// Custom songs played from the composer / song menu / text screen return there, everything else to song select.
function leaveRun() {
  const ret = run && run.ret;
  run = ret ? null : run;
  if (ret) ret(); else openSelect();
}

function pauseGame() {
  if (state !== 'countin' && state !== 'playing' && state !== 'resuming') return;
  resumeEnd = 0;
  renderer.resumeCount = 0;
  game.pause();
  input.reset();
  padHeld.forEach(s => s.clear());
  state = 'paused';
  input.enabled = false;
  $('btn-pause-options').hidden = !(run && run.training);
  const tut = !!(run && run.tutorial);
  $('btn-quit').hidden = tut;
  $('btn-tut-skip-pause').hidden = !tut;
  show('paused');
}
// Resume shows a 3-2-1 countdown first. The audio context stays suspended meanwhile, so song time is frozen.
let resumeEnd = 0;
function resumeGame() {
  if (state !== 'paused') return;
  resumeEnd = performance.now() + 3000;
  renderer.resumeCount = 3;
  setState('resuming', null);
}
async function finishResume() {
  resumeEnd = 0;
  renderer.resumeCount = 0;
  await game.resume();
  if (state !== 'resuming') return;
  setState(game.songTime() < 0 ? 'countin' : 'playing', null);
}

const HIST_BINS = 9, HIST_RANGE = 0.135;
function renderHistogram(deltas) {
  const box = $('r-hist');
  box.textContent = '';
  const bins = new Array(HIST_BINS).fill(0);
  for (const d of deltas) {
    const i = Math.floor((Math.max(-HIST_RANGE, Math.min(HIST_RANGE - 1e-9, d)) + HIST_RANGE) / (2 * HIST_RANGE) * HIST_BINS);
    bins[i]++;
  }
  const max = Math.max(1, ...bins);
  bins.forEach((n, i) => {
    const el = document.createElement('div');
    el.style.height = Math.max(2, Math.round(46 * n / max)) + 'px';
    if (i === (HIST_BINS - 1) / 2) el.className = 'mid';
    el.title = n + ' hits';
    box.appendChild(el);
  });
  if (deltas.length >= 10) {
    const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    const ms = Math.round(mean * 1000);
    $('r-offset').textContent = Math.abs(ms) < 8
      ? 'Timing is centered.'
      : `Average hit: ${Math.abs(ms)} ms ${ms > 0 ? 'late' : 'early'}` +
        (Math.abs(ms) >= 20 ? ' — try Settings → Calibrate' : '');
  } else {
    $('r-offset').textContent = '';
  }
}

game.onFinish = r => {
  input.reset();
  padHeld.forEach(s => s.clear());
  if (run && run.tutorial) { tutorialStageDone(r); return; }
  const training = run && run.training;
  if (training && training.loop) { // looped practice: go again immediately
    toast(`Loop: ${r.score} · ${r.accuracy.toFixed(1)}% · ${r.grade}${r.fc ? ' · FC' : ''}`, 1800);
    startRun(run);
    return;
  }
  $('r-heading').textContent = screens.results.dataset.title = training ? 'Practice' : 'Results';
  $('r-song').textContent = run ? `${run.entry.title} · ${run.diff}` +
    (training && training.speed !== 1 ? ` · ${Math.round(training.speed * 100)}%` : '') : '';
  $('r-score').textContent = r.score;
  $('r-grade').textContent = r.grade;
  $('r-grade').dataset.grade = r.grade;
  $('r-acc').textContent = r.accuracy.toFixed(1) + '%';
  $('r-combo').textContent = r.maxCombo;
  $('r-p').textContent = r.counts.perfect;
  $('r-g').textContent = r.counts.great;
  $('r-o').textContent = r.counts.good;
  $('r-m').textContent = r.counts.miss;
  const banner = $('r-banner');
  banner.hidden = !r.fc;
  banner.className = 'banner' + (r.ap ? ' ap' : '');
  banner.textContent = r.ap ? 'ALL PERFECT' : r.fc ? 'FULL COMBO' : '';
  if (r.fc) { void banner.offsetWidth; banner.classList.add('celebrate'); } // restart the pop on every results screen
  const best = $('r-best');
  best.hidden = true;
  if (training) {
    best.hidden = false; best.textContent = 'Practice runs are not saved'; best.style.color = 'var(--dim)';
  } else if (run) {
    const rec = scores.record(run.entry.id, run.diff, r);
    best.style.color = '';
    if (rec.isNewBest) { best.hidden = false; best.textContent = '★ NEW BEST ★'; }
    else if (rec.rank) { best.hidden = false; best.textContent = `Rank #${rec.rank}`; }
  }
  renderHistogram(r.deltas);
  setResultsPage(0);
  setState('results', 'results');
};

let resultsPage = 0;
function setResultsPage(n) {
  resultsPage = Math.max(0, Math.min(2, n));
  for (const el of document.querySelectorAll('#results .r-page')) el.hidden = +el.dataset.page !== resultsPage;
  for (const el of document.querySelectorAll('#r-tabs button')) el.classList.toggle('sel', +el.dataset.page === resultsPage);
}

function nextSong() {
  const list = visible().length ? visible() : entries();
  const i = Math.max(0, list.findIndex(e => e.id === (run ? run.entry.id : selectedId)));
  const e = list[(i + 1) % list.length];
  selectedId = e.id;
  settings.lastSongId = e.id; save();
  startRun({ entry: e, diff: run ? run.diff : settings.difficulty, training: null, ret: run && run.ret, retLabel: run && run.retLabel });
}

// ---- tutorial ----
function controlsHTML() {
  const keys = KEY_LABELS[4].map(k => `<b>${k}</b>`).join(' ');
  const pad = [0, 1, 2, 3].map(i => `<b>${buttonName(settings.padBindings[i][0])}</b>`).join(' ');
  return `<p>Notes fall down four lanes. Hit each one as it reaches the glowing line.</p>` +
    `<p>Keyboard: ${keys}<br>Gamepad: ${pad} (or d-pad)<br>Touch: tap and hold the lanes</p>` +
    `<p>There are two note types — <b>taps</b> and <b>holds</b>. This takes about a minute.</p>`;
}
function tutProgress(done, current) {
  const n = STAGES.length;
  const boxes = STAGES.map((_, i) => (i < done ? '■' : i === current ? '▣' : '□')).join(' ');
  $('tut-progress').hidden = false;
  $('tut-progress').textContent = `${boxes}   ${current >= 0 ? `Lesson ${current + 1} of ${n}` : `${n} lessons`}`;
}
function openTutorial() {
  $('btn-tut-go').textContent = 'Start tutorial';
  $('btn-tut-skip').hidden = false;
  $('tut-title').textContent = 'Welcome to Ringbeat';
  $('tut-body').innerHTML = controlsHTML() +
    `<p>${STAGES.length} short lessons. Pass each one to move on.</p>`;
  tutProgress(0, -1);
  run = { tutorial: { stage: -1 } };
  setState('tutorial', 'tutorial');
}
// Lesson card: text + goal, waits for the player to confirm before the round starts.
function openLesson(i, failed) {
  const st = STAGES[i];
  $('tut-title').textContent = failed ? `Try again: ${st.title}` : st.title;
  $('tut-body').innerHTML =
    (failed ? `<p><b>Not quite</b> — ${esc(failed)}.</p>` : '') +
    `<p>${esc(st.text)}</p><p>${esc(goalText(st))}</p>`;
  $('btn-tut-go').textContent = failed ? 'Retry lesson' : 'Start lesson';
  $('btn-tut-skip').hidden = false;
  tutProgress(i, i);
  run = { tutorial: { stage: i, pending: true } };
  setState('tutorial', 'tutorial');
}
function lessonPassed(i) {
  const last = i + 1 >= STAGES.length;
  $('tut-title').textContent = `Lesson ${i + 1} passed ✓`;
  $('tut-body').innerHTML = `<p>${esc(STAGES[i].title)} mastered.</p>`;
  $('btn-tut-go').textContent = last ? 'Continue' : 'Next lesson';
  $('btn-tut-skip').hidden = false;
  tutProgress(i + 1, -1);
  run = { tutorial: { stage: i, passed: true } };
  setState('tutorial', 'tutorial');
}
function tutorialOutro() {
  game.stop();
  $('tut-title').textContent = "You're ready!";
  $('tut-body').innerHTML =
    `<p>Hit every note for a <b>Full Combo</b>, all Perfect for an <b>All Perfect</b>.</p>` +
    `<p><b>Training</b> (in Options) slows songs down and loops sections.</p>` +
    `<p>If hits feel early or late, try <b>Settings → Calibrate</b>. You can replay this tutorial from Settings.</p>`;
  $('btn-tut-go').textContent = 'Pick a song';
  $('btn-tut-skip').hidden = true;
  tutProgress(STAGES.length, -1);
  run = { tutorial: { done: true } };
  setState('tutorial', 'tutorial');
}
function showCaption(i) {
  $('np-caption').textContent = `Lesson ${i + 1}/${STAGES.length} · ${goalText(STAGES[i])}`;
}
function tutorialStageDone(r) {
  const i = run.tutorial.stage;
  if (!stagePassed(STAGES[i], r)) { game.stop(); openLesson(i, failReason(STAGES[i], r)); return; }
  game.stop();
  lessonPassed(i);
}
function finishTutorial() {
  game.stop();
  input.reset();
  run = null;
  $('tut-progress').hidden = true;
  settings.tutorialDone = true; save();
  openSelect();
}
function tutorialGo() {
  const t = run && run.tutorial;
  if (t && t.done) finishTutorial();
  else if (t && t.passed) { if (t.stage + 1 < STAGES.length) openLesson(t.stage + 1); else tutorialOutro(); }
  else if (t && t.stage >= 0) startRun({ entry: null, diff: 'normal', training: null, tutorial: { stage: t.stage } });
  else openLesson(0);
}

// ---- calibration screen ----
function showOffset() {
  const t = Math.round(settings.calibration * 1000) + ' ms';
  $('calib-offset').textContent = t; $('menu-offset').textContent = t;
}
function startCalibration() {
  stopPreview();
  setState('calibration', 'calibration');
  $('calib-msg').textContent = 'Tap (any key, button or the pad) in time with the ticks.';
  $('calib-count').textContent = '0 taps';
  calibration.start();
}
function leaveCalibration() {
  calibration.running = false;
  synth.stopAll();
  openSettings();
}
function nudge(ms) {
  settings.calibration = num(settings.calibration + ms / 1000, -0.5, 0.5, 0);
  save(); showOffset();
}
function calibTap(e) {
  if (!calibration.running || calibration.finished) return;
  calibration.recordTap(eventAudioTime(synth.ctx, e));
  $('calib-count').textContent = calibration.taps.length + ' taps';
}

// ---- settings screen & controller bindings ----
let capturingSlot = -1;
const SLOT_NAMES = ['Left lane', 'Lane 2', 'Lane 3', 'Right lane'];
function renderBindings() {
  const g = $('bind-grid');
  g.textContent = '';
  for (let s = 0; s < 4; s++) {
    const b = document.createElement('button');
    const names = settings.padBindings[s].map(buttonName).join(' ');
    b.textContent = capturingSlot === s ? `${SLOT_NAMES[s]}: press a button…` : `${SLOT_NAMES[s]}: ${names}`;
    b.classList.toggle('capture', capturingSlot === s);
    b.onclick = () => { capturingSlot = s; renderBindings(); };
    g.appendChild(b);
  }
  updatePadStatus();
}
function updatePadStatus() {
  const first = pad.list()[0];
  $('pad-status').textContent = first ? `Connected: ${first.id}` : 'No controller detected — press a button on it.';
}
function bindButton(index) {
  const s = capturingSlot;
  capturingSlot = -1;
  for (let o = 0; o < 4; o++) {
    if (o !== s) settings.padBindings[o] = settings.padBindings[o].filter(x => x !== index);
    if (!settings.padBindings[o].length) settings.padBindings[o] = DEFAULT_BINDINGS[o].filter(x => x !== index).slice(0, 1);
  }
  settings.padBindings[s] = [index];
  save(); renderBindings();
}
let settingsFrom = 'select';
function openSettings(from = 'select') {
  settingsFrom = from;
  document.querySelectorAll('#settings .menu-only').forEach(el => { el.hidden = from === 'paused'; });
  capturingSlot = -1;
  renderBindings();
  showOffset();
  setState('settings', 'settings');
}

function closeSettings() {
  capturingSlot = -1;
  if (settingsFrom === 'paused') setState('paused', 'paused'); else openSelect();
}

// ---- gamepad routing ----
const padHeld = [new Set(), new Set(), new Set(), new Set()]; // lane -> pressed button indices
function slotsFor(index) {
  const out = [];
  for (let s = 0; s < 4; s++) if (settings.padBindings[s].includes(index)) out.push(s);
  return out;
}
// Switch the active input device; device-dependent labels refresh only on change.
function setDevice(d) {
  document.body.classList.toggle('using-pad', d === 'pad');
  if (lastDevice === d) return;
  lastDevice = d;
  selectHints();
}
function usePad() { setDevice('pad'); }
function useMouse() { setDevice('kbd'); }

function selectHints() {
  const pad = lastDevice === 'pad';
  const bn = buttonName;
  $('sel-arrow-l').textContent = pad ? bn(BTN.LB) : '◄';
  $('sel-arrow-r').textContent = pad ? bn(BTN.RB) : '►';
  $('sel-hint').textContent = pad
    ? `${bn(BTN.LB)}/${bn(BTN.RB)} Category · ${bn(BTN.LT)} Sort`
    : '◄► Category · D/F Sort';
}

pad.onConnect = id => { toast('Controller connected: ' + id.replace(/\(.*\)/, '').trim().slice(0, 40)); };
pad.onDisconnect = () => {
  toast('Controller disconnected');
  if (state === 'countin' || state === 'playing' || state === 'resuming') pauseGame();
};

pad.onButton = (index, down, ts) => {
  usePad();
  if (state === 'countin' || state === 'playing' || state === 'resuming') {
    if (!down) { releasePad(index, ts); return; }
    if (index === BTN.START) return pauseGame();
    if (index === BTN.BACK) return restartRun();
    if (state !== 'resuming') pressPad(index, ts);
    return;
  }
  if (!down) return;
  if (capturingSlot >= 0 && state === 'settings') { bindButton(index); return; }
  if (state === 'calibration') {
    if (index === BTN.B || index === BTN.START) leaveCalibration();
    else calibTap({ timeStamp: ts });
    return;
  }
  menuButton(index);
};

function pressPad(index, ts) {
  const lanes = game.chart.lanes;
  const time = eventAudioTime(synth.ctx, { timeStamp: ts });
  for (const slot of slotsFor(index)) {
    const lane = laneForSlot(slot, lanes);
    const set = padHeld[lane];
    const was = set.size;
    set.add(index);
    if (!was) game.press(lane, time);
  }
}
function releasePad(index, ts) {
  const time = eventAudioTime(synth.ctx, { timeStamp: ts });
  padHeld.forEach((set, lane) => {
    if (set.delete(index) && set.size === 0) game.release(lane, time);
  });
}

function back() {
  switch (state) {
    case 'title': break;
    case 'select': stopPreview(); setState('title', 'title'); break;
    case 'options': openSelect(); break;
    case 'tutorial': finishTutorial(); break;
    case 'settings': closeSettings(); break;
    case 'training': openSelect(); break;
    case 'mysongs': openSelect(); break;
    case 'diffpick': if (dpBack) dpBack(); else openSelect(); break;
    case 'songmenu': openMySongs(); break;
    case 'custom': if (txtUid) openSongMenu(txtUid); else openMySongs(); break;
    case 'composer':
      if (csMenu) setCompMenu(false);
      else if (csDirty && compEntry()) { setCompMenu(true); toast('Unsaved: Save or Exit'); }
      else leaveComposer();
      break;
    case 'results': leaveRun(); break;
    case 'paused': resumeGame(); break;
    case 'calibration': leaveCalibration(); break;
    case 'countin': case 'playing': case 'resuming': pauseGame(); break;
  }
}

function menuButton(index) {
  const root = activeScreen();
  switch (index) {
    case BTN.A: case BTN.START:
      if (state === 'title') { startFromTitle(); return; }
      if (state === 'composer' && !csMenu) { if (index === BTN.A) compInput('add'); else setCompMenu(true); return; }
      if (root) nav.confirm(root);
      break;
    case BTN.B: back(); break;
    case BTN.X:
      if (state === 'select') openOptions();
      else if (state === 'composer' && !csMenu) { const e = compEntry(); if (e) togglePreview(e); }
      break;
    case BTN.LB: if (state === 'composer' && !csMenu) compInput('8'); else if (state === 'select') cycleCategory(-1); else if (state === 'results') navigate('left'); break;
    case BTN.RB: if (state === 'composer' && !csMenu) compInput('9'); else if (state === 'select') cycleCategory(1); else if (state === 'results') navigate('right'); break;
    case BTN.Y: if (state === 'composer' && !csMenu) compInput('rest'); else if (state === 'select') setTrainingMode(!trainingMode); break;
    case BTN.LT: if (state === 'select') setView('sort', SORTS); break;
  }
}
pad.onNav = dir => {
  usePad();
  if (capturingSlot >= 0) return;
  navigate(dir);
};
// Shared by arrow keys, d-pad and the phone keypad (2/4/6/8).
function navigate(dir) {
  const root = activeScreen();
  if (!root || state === 'title') return;
  if (state === 'composer' && !csMenu) { compInput(dir); return; }
  if (state === 'select' && (dir === 'left' || dir === 'right')) { cycleCategory(dir === 'left' ? -1 : 1); return; }
  if (state === 'diffpick' && (dir === 'left' || dir === 'right')) { setDpTab(dpTab + (dir === 'left' ? -1 : 1)); return; }
  if (state === 'results' && (dir === 'left' || dir === 'right')) {
    const p = resultsPage;
    setResultsPage(p + (dir === 'left' ? -1 : 1));
    if (resultsPage !== p) synth.keyClick();
    return;
  }
  if (!nav.adjust(document.activeElement, dir)) nav.move(root, dir);
}

// ---- phone keys & soft keys ----
function softLeft() {
  switch (state) {
    case 'title': startFromTitle(); break;
    case 'select': openOptions(); break;
    case 'composer': if (csMenu) nav.confirm(activeScreen()); else setCompMenu(true); break;
    case 'countin': case 'playing': case 'resuming': pauseGame(); break;
    default: { const root = activeScreen(); if (root) nav.confirm(root); }
  }
}
function phoneKey(key) {
  if (state === 'composer' && !csMenu) {
    if (key === 'softL') setCompMenu(true);
    else if (key === 'softR') compInput('del');
    else if (key === 'ok') { const e = compEntry(); if (e) togglePreview(e); }
    else compInput(key);
    return;
  }
  if (!inPlay()) synth.keyClick();
  if (state === 'title') { startFromTitle(); return; }
  if (state === 'calibration' && key !== 'softR' && key !== 'softL' && key !== 'ok') { calibTap({ timeStamp: performance.now() }); return; }
  switch (key) {
    case 'softL': softLeft(); break;
    case 'softR': back(); break;
    case 'ok': case '5': if (inPlay()) pauseGame(); else { const root = activeScreen(); if (root) nav.confirm(root); } break;
    case '2': navigate('up'); break;
    case '8': navigate('down'); break;
    case '4': navigate('left'); break;
    case '6': navigate('right'); break;
  }
}

// ---- wiring ----
let booted = false;
function startFromTitle() {
  synth.ensure();
  if (!booted) { booted = true; synth.jingle(); }
  if (!settings.tutorialDone) openTutorial(); else openSelect();
}

function wire() {
  // settings controls
  const v = $('volume'), sc = $('scroll'), bk = $('backing'), pv = $('pref-preview');
  v.value = settings.volume * 100; sc.value = settings.scrollTime; bk.checked = settings.backing; pv.checked = settings.preview;
  v.oninput = () => { settings.volume = v.value / 100; synth.setVolume(settings.volume); save(); };
  sc.oninput = () => { settings.scrollTime = +sc.value; renderer.scrollTime = settings.scrollTime; $('scroll-val').textContent = sc.value + 's'; save(); };
  $('scroll-val').textContent = sc.value + 's';
  bk.onchange = () => { settings.backing = bk.checked; game.backing = settings.backing; save(); };
  pv.onchange = () => { settings.preview = pv.checked; save(); if (!pv.checked) stopPreview(); };
  const voiceLabel = () => { $('set-voice').textContent = 'Tone: ' + (settings.voice === 'buzzer' ? 'Buzzer' : 'Smooth'); };
  voiceLabel();
  $('set-voice').onclick = () => {
    settings.voice = synth.voice = settings.voice === 'buzzer' ? 'smooth' : 'buzzer';
    save(); voiceLabel();
    synth.ensure();
    synth.playNote({ midi: 76, when: synth.ctx.currentTime + 0.02, duration: 0.12 });
  };
  document.addEventListener('input', e => { if (e.target.type === 'range') paintRange(e.target); });
  $('btn-calibrate').onclick = startCalibration;
  $('btn-settings').onclick = () => openSettings();
  $('btn-pause-settings').onclick = () => openSettings('paused');
  $('btn-settings-back').onclick = closeSettings;
  $('btn-bind-reset').onclick = () => { settings.padBindings = cloneBindings(DEFAULT_BINDINGS); capturingSlot = -1; save(); renderBindings(); toast('Controller buttons reset'); };
  let resetTimer = 0;
  $('btn-reset-scores').onclick = e => {
    const b = e.currentTarget;
    if (resetTimer) {
      clearTimeout(resetTimer); resetTimer = 0;
      scores.clear(); b.textContent = 'Reset highscores'; toast('Highscores cleared');
    } else {
      b.textContent = 'Really reset? Press again';
      resetTimer = setTimeout(() => { resetTimer = 0; b.textContent = 'Reset highscores'; }, 3000);
    }
  };

  // tutorial
  $('btn-tut-go').onclick = tutorialGo;
  $('btn-tut-skip').onclick = finishTutorial;
  $('btn-tut-skip-pause').onclick = finishTutorial;
  $('btn-tutorial').onclick = () => { synth.ensure(); openTutorial(); };

  // title / select
  $('btn-start').onclick = startFromTitle;
  $('view-sort').onclick = () => setView('sort', SORTS);
  $('view-filter').onclick = () => setView('filter', FILTERS);
  $('view-cat').onclick = () => cycleCategory(1);
  $('btn-play').onclick = playSelected;
  $('btn-train-mode').onclick = () => setTrainingMode(!trainingMode);
  $('btn-preview').onclick = () => togglePreview(selectedEntry());

  // my songs
  $('ms-new').onclick = () => openComposer();
  $('ms-paste').onclick = () => openCustom();
  $('ms-back').onclick = openSelect;
  $('ms-list').onclick = e => { const b = e.target.closest('button'); if (b) openSongMenu(b.dataset.uid); };
  $('ms-import').onclick = () => $('ms-file').click();
  $('ms-file').onchange = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let r;
    try {
      const text = await f.text(), lines = splitRtttl(text);
      if (text.trim()[0] !== '{' && text.trim()[0] !== '[' && lines.length === 1 && customEntry(lines[0])) {
        openCustom(lines[0]); // one song: let the player name it before saving
        toast('Name it, then Save');
        return;
      }
      r = importSharedText(text);
    } catch { r = { added: 0, skipped: 1 }; }
    openMySongs(`Imported ${r.added}${r.skipped ? `, skipped ${r.skipped}` : ''}`);
  };
  $('ms-export').onclick = () => { download('ringbeat-songs.json', mysongs.exportJSON(), 'application/json'); $('ms-msg').textContent = 'Exported ' + mysongs.count() + ' songs'; };

  // one song
  $('sm-play').onclick = () => { const e = curEntry(); if (e) askDifficulty(e, () => openSongMenu(e.uid), 'My song', () => openSongMenu(e.uid), e.uid); };
  $('sm-preview').onclick = () => { const e = curEntry(); if (e) togglePreview(e); };
  $('sm-edit').onclick = () => { const s = curSong(); if (s) openComposer(s.rtttl, s.uid); };
  $('sm-dup').onclick = () => {
    const d = mysongs.duplicate(curUid);
    if (!d) { toast(mysongs.isFull() ? `My songs is full (max ${MAX_SONGS})` : 'Could not duplicate: storage unavailable'); return; }
    refreshCustoms(); openSongMenu(d.uid);
  };
  $('sm-file').onclick = () => { const s = curSong(); if (s) { download(slug(s.name) + '.rtttl', s.rtttl + '\n'); $('sm-msg').textContent = 'Saved ' + slug(s.name) + '.rtttl'; } };
  $('sm-copy').onclick = () => { const s = curSong(); if (s) copyText(s.rtttl, $('sm-msg'), 'Text'); };
  $('sm-share').onclick = async () => {
    const s = curSong(); if (!s) return;
    const url = location.origin + location.pathname + encodeSong(s.rtttl);
    await copyText(url, $('sm-msg'), 'Link');
  };
  let delArmed = 0;
  $('sm-del').onclick = () => {
    if (Date.now() - delArmed > 4000) { delArmed = Date.now(); $('sm-del').textContent = 'Really delete?'; setTimeout(() => { $('sm-del').textContent = 'Delete'; }, 4000); return; }
    delArmed = 0; $('sm-del').textContent = 'Delete';
    mysongs.remove(curUid); curUid = '';
    refreshCustoms();
    if (!entryById(selectedId)) selectedId = (visible()[0] || builtins[0]).id;
    openMySongs('Deleted');
  };
  $('sm-back').onclick = () => openMySongs();

  // composer
  $('comp-left').onclick = () => compInput('left');
  $('comp-right').onclick = () => compInput('right');
  $('comp-resume').onclick = () => setCompMenu(false);
  $('comp-play').onclick = () => {
    const e = compEntry();
    if (!e) return;
    stopPreview();
    const toComposer = () => { setState('composer', 'composer'); setCompMenu(false); };
    askDifficulty(e, toComposer, 'Composer', () => { setState('composer', 'composer'); setCompMenu(true); });
  };
  $('comp-preview').onclick = () => { const e = compEntry(); if (e) togglePreview(e); };
  $('comp-save').onclick = saveComposer;
  $('comp-name').addEventListener('input', () => { cs.name = $('comp-name').value; csDirty = true; renderComposer(); });
  $('comp-bpm').addEventListener('input', () => { cs.bpm = +$('comp-bpm').value; csDirty = true; renderComposer(); });
  $('comp-clear').onclick = () => { comp.clear(cs); csDirty = true; renderComposer(); toast('Cleared'); };
  $('comp-text').onclick = () => { cs.name = $('comp-name').value; openCustom(comp.toRTTTL(cs), csUid); };
  $('comp-exit').onclick = leaveComposer;

  // text / paste
  $('btn-custom').onclick = () => openMySongs();
  area.addEventListener('input', () => {
    stopPreview(); updateCustomStatus();
    const e = customEntry(area.value);
    if (e && document.activeElement === area) $('custom-name').value = e.song.name;
  });
  $('btn-custom-save').onclick = () => {
    const text = area.value.trim();
    const e = customEntry(text);
    if (!e) return;
    const name = $('custom-name').value.trim() || e.song.name || 'Untitled';
    const named = rtttlName(text, name); // the name lives inside the RTTTL, so keep both in sync
    const same = mysongs.list().find(x => x.rtttl === named);
    const s = same || (txtUid && mysongs.get(txtUid) ? mysongs.update(txtUid, { rtttl: named, name }) : mysongs.add(name, named));
    if (!s) { toast(saveProblem(named)); return; }
    txtUid = s.uid; area.value = s.rtttl; afterSongsChanged(s);
    toast(same ? 'Already in My songs' : 'Saved to My songs');
    openSongMenu(s.uid);
  };
  $('btn-custom-play').onclick = () => {
    const e = customEntry(area.value);
    if (!e) return;
    const toText = () => { setState('custom', 'custom'); updateCustomStatus(); };
    askDifficulty(e, toText, 'RTTTL text', toText);
  };
  $('btn-custom-preview').onclick = () => { const e = customEntry(area.value); if (e) togglePreview(e); };
  $('btn-custom-compose').onclick = () => { if (customEntry(area.value)) openComposer(area.value.trim(), txtUid); };
  $('btn-custom-back').onclick = back;

  // training
  const t = settings.training;
  $('t-speed').oninput = e => { t.speed = e.target.value / 100; updateTrainingLabels(); save(); };
  $('t-loop').onchange = e => { t.loop = e.target.checked; updateTrainingLabels(); save(); };
  $('t-a').oninput = e => {
    t.a = Math.min(e.target.value / 100, t.b - 0.1);
    e.target.value = Math.round(t.a * 100); updateTrainingLabels(); save();
  };
  $('t-b').oninput = e => {
    t.b = Math.max(e.target.value / 100, t.a + 0.1);
    e.target.value = Math.round(t.b * 100); updateTrainingLabels(); save();
  };
  $('btn-train-start').onclick = () => {
    const e = selectedEntry();
    startRun({ entry: e, diff: settings.difficulty, training: { speed: t.speed, loop: t.loop, a: t.a, b: t.b } });
  };
  $('btn-train-back').onclick = openSelect;

  // play / pause / results
  $('btn-pause').onclick = pauseGame;
  $('btn-resume').onclick = resumeGame;
  $('btn-restart').onclick = restartRun;
  $('btn-pause-options').onclick = () => { game.stop(); input.reset(); openTraining(); };
  $('btn-quit').onclick = leaveToSelect;
  for (const t of document.querySelectorAll('#r-tabs button')) t.onclick = () => setResultsPage(+t.dataset.page);
  { // horizontal swipe flips results pages
    let sx = null;
    const r = $('results');
    r.addEventListener('pointerdown', e => { sx = e.clientX; });
    r.addEventListener('pointerup', e => {
      if (sx !== null && Math.abs(e.clientX - sx) > 40) navigate(e.clientX < sx ? 'right' : 'left');
      sx = null;
    });
  }
  $('btn-retry').onclick = restartRun;
  $('btn-next').onclick = nextSong;
  $('btn-menu').onclick = leaveToSelect;

  // calibration
  $('calib-pad').addEventListener('pointerdown', e => { e.preventDefault(); calibTap(e); });
  $('nudge-minus').onclick = () => nudge(-5);
  $('nudge-plus').onclick = () => nudge(5);
  $('calib-reset').onclick = () => { settings.calibration = 0; save(); showOffset(); };
  $('calib-done').onclick = leaveCalibration;
  $('calib-again').onclick = startCalibration;

  // phone keys + soft-key labels (pointerdown, and never steal focus from the list)
  for (const k of document.querySelectorAll('#phone .k')) {
    k.addEventListener('pointerdown', e => { e.preventDefault(); phoneKey(k.dataset.key); });
    k.addEventListener('click', e => { if (e.detail === 0) phoneKey(k.dataset.key); }); // keyboard-less AT activation
  }
  $('soft-left').addEventListener('pointerdown', e => { e.preventDefault(); phoneKey('softL'); });
  $('soft-right').addEventListener('pointerdown', e => { e.preventDefault(); phoneKey('softR'); });
  setSprite($('boot-art'), ringing(0), 3);
  $('boot-version').textContent = 'v' + VERSION;
  document.addEventListener('focusin', e => light(e.target));
  window.addEventListener('resize', layout);

  window.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') useMouse(); });
  window.addEventListener('keydown', onKey);
  // Gamepad input may not count as a user gesture; resume a suspended context on the next key/click.
  const wake = () => { if (synth.ctx && synth.ctx.state === 'suspended' && game.state !== 'paused') synth.ctx.resume(); };
  window.addEventListener('keydown', wake, true);
  window.addEventListener('pointerdown', wake, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); }); // audio clock keeps running when hidden

  // Initial selection: share link > last played > first song
  const shared = decodeSong(location.hash);
  // The old single custom slot becomes the first saved song.
  if (settings.customRtttl && !mysongs.count()) mysongs.add(settings.customRtttl.split(':')[0] || 'My song', settings.customRtttl);
  if (settings.customRtttl) { settings.customRtttl = ''; save(); }
  refreshCustoms();
  const takeShared = text => {
    if (!text || !customEntry(text)) return false;
    const r = importSharedText(text);
    const e = customs.find(c => c.rtttl === text.trim());
    if (e) { selectedId = e.id; settings.lastSongId = e.id; save(); }
    else if (!r.added) toast('My songs is full');
    return !!e;
  };
  if (!takeShared(shared)) selectedId = entryById(settings.lastSongId) ? settings.lastSongId : builtins[0].id;
  window.addEventListener('hashchange', () => {
    const t = decodeSong(location.hash);
    if (t && takeShared(t)) { toast('Shared song saved to My songs'); if (state === 'select') openSelect(); }
  });
  showOffset();
  show('title');
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  setDevice('kbd');
  const tag = e.target.tagName;
  const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type === 'text');
  if (state === 'title') {
    if (e.code !== 'Tab' && !e.repeat && !e.code.startsWith('Shift')) { e.preventDefault(); startFromTitle(); }
    return;
  }
  if (e.code === 'F3') { e.preventDefault(); setPerf(!perf.enabled); return; }
  if (e.code === 'F4' && perf.enabled) { e.preventDefault(); copyReport(perf); return; }
  const menu = !inPlay() && state !== 'calibration';
  // RTTTL textarea: Enter leaves (Shift+Enter = newline); Up/Down leave from the first/last position.
  if (tag === 'TEXTAREA' && !inPlay() && !e.shiftKey) {
    const t = e.target, atStart = t.selectionStart === 0 && t.selectionEnd === 0,
      atEnd = t.selectionStart === t.value.length && t.selectionEnd === t.value.length;
    const dir = e.code === 'Enter' ? 'down' : e.code === 'ArrowDown' && atEnd ? 'down' : e.code === 'ArrowUp' && atStart ? 'up' : '';
    if (dir) { e.preventDefault(); synth.keyClick(); navigate(dir); return; }
  }
  // Single-line text fields: up/down and Enter leave the field (left/right stay with the caret).
  if (tag === 'INPUT' && e.target.type === 'text' && !inPlay() && ['ArrowUp', 'ArrowDown', 'Enter'].includes(e.code)) {
    e.preventDefault();
    synth.keyClick();
    navigate(e.code === 'ArrowUp' ? 'up' : 'down');
    return;
  }
  if (state === 'composer' && !csMenu && !typing) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : '';
    let act = '';
    if (e.code === 'Backspace' || e.code === 'Delete') act = 'del';
    else if (/^[0-9*#]$/.test(k) || /^[a-gp]$/.test(k)) act = k;
    else if (k === '.') act = '*';
    else if (k === '+') act = '#';
    if (act) { e.preventDefault(); compInput(act); return; }
    if ((e.code === 'Space' || e.code === 'Enter') && tag !== 'BUTTON') {
      e.preventDefault();
      if (!e.repeat) { const en = compEntry(); if (en) togglePreview(en); }
      return;
    }
  }
  if (e.code === 'Escape' || (e.code === 'Backspace' && !typing)) {
    e.preventDefault();
    if (menu) synth.keyClick();
    if (capturingSlot >= 0) { capturingSlot = -1; renderBindings(); } else back();
    return;
  }
  if (state === 'results' && !typing && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
    e.preventDefault(); navigate(e.code === 'BracketRight' ? 'right' : 'left'); return;
  }
  if (state === 'select' && !typing && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
    e.preventDefault(); cycleCategory(e.code === 'BracketRight' ? 1 : -1); return;
  }
  if (state === 'select' && !typing && tag !== 'SELECT' && ['KeyD', 'KeyF'].includes(e.code)) {
    e.preventDefault();
    if (e.repeat) return;
    synth.keyClick();
    if (e.code === 'KeyD' || e.code === 'KeyF') setView('sort', SORTS, e.code === 'KeyF' ? 1 : -1);
    return;
  }
  if (state === 'select' && !typing && e.code === 'KeyO') { e.preventDefault(); synth.keyClick(); openOptions(); return; }
  if (menu && !e.repeat && (e.code === 'Enter' || e.code === 'Space') && !typing) synth.keyClick();
  if (e.code === 'KeyR' && !typing && ['countin', 'playing', 'resuming', 'paused', 'results'].includes(state)) { restartRun(); return; }
  if (state === 'calibration' && !e.repeat) {
    if (tag === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) return;
    calibTap(e);
    return;
  }
  const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const root = activeScreen();
  if (dirs[e.code] && root && !typing && !(tag === 'SELECT')) {
    const range = tag === 'INPUT' && e.target.type === 'range';
    if (range && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return; // native slider handling
    e.preventDefault();
    setDevice('kbd');
    if (!(state === 'composer' && !csMenu)) synth.keyClick();
    navigate(dirs[e.code]);
  }
}

// ---- phone layout: where the phone, the side phone and the highway sit in the current mode ----
let mode = '';
function setMode() {
  const over = (game.active || demoRun) && (state === 'paused' || (state === 'settings' && settingsFrom === 'paused'));
  const m = inPlay() ? 'play' : over ? 'pause' : 'menu';
  if (m === mode) return;
  if (m === 'menu') phoneIdle();
  mode = document.body.dataset.mode = m;
}
function layout(animate = false) {
  const vw = window.innerWidth, vh = window.innerHeight, body = document.body, ph = $('phone');
  const compact = vw < 600 || vh < 520;
  body.classList.toggle('compact', compact);
  let x, y, w, h;
  if (compact) { x = 0; y = 0; w = vw; h = vh; }
  else {
    // Whole phone when it fits; on short screens grow it so the LCD stays roomy and let the keypad run off the bottom
    // (the navigation keys, ~68% down, stay on screen).
    h = Math.min(1100, Math.max(vh * 0.96, Math.min((vh * 0.98 - 6) / 0.685, 940)));
    w = h / 2; x = (vw - w) / 2; y = Math.max(vh * 0.02, (vh - h) / 2);
  }
  ph.classList.toggle('no-anim', !animate);
  Object.assign(ph.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  // Pixel text stays on whole device pixels: 2 or 3 CSS px per font pixel. The play canvas uses the same grid.
  const lcdW = compact ? vw : w * 0.745, fs = lcdW >= 470 ? 30 : 20;
  ph.style.setProperty('--fs', fs + 'px');
  ph.style.setProperty('--u', fs / 10 + 'px');
  renderer.setPixelScale(fs / 10);
  const lg = $('legend');
  body.classList.toggle('legend-on', !compact && x >= 286);
  lg.style.left = Math.max(16, x - 270) + 'px';
  if (!animate) requestAnimationFrame(() => ph.classList.remove('no-anim'));
  if (state === 'select') setTimeout(focusCurrentRow, animate ? 600 : 0); // keep the cursor row in view after a resize
}

// Idle phone: full signal and battery.
function phoneIdle() {
  setSprite($('st-signal'), signal(5), 2);
  setSprite($('st-battery'), battery(4), 2);
}
// Live phone displays while a song runs: progress, time, signal (recent hit quality) and battery (time left).
const phoneCache = { key: '' };
function updatePhones(g, t) {
  const len = g.chart.length, p = Math.max(0, Math.min(1, t / len));
  const n = Math.min(recentN, recent.length) || 1;
  let q = 0; for (let i = 0; i < n; i++) q += recent[i];
  const sig = recentN ? Math.round(5 * q / n) : 5;
  const bat = Math.max(0, Math.ceil(4 * (1 - p) - 1e-6));
  const pct = Math.floor(p * 100);
  const key = pct + '|' + sig + '|' + bat;
  if (key === phoneCache.key) return;
  phoneCache.key = key;
  setSprite($('st-signal'), signal(sig), 2);
  setSprite($('st-battery'), battery(bat), 2);
}

// ---- dev-only screenshot states: ?demo=play|pause|select|options|info|results|fc|settings ----
let demoRun = null;
function demo(kind) {
  settings.tutorialDone = true;
  selectedId = entryById('nokia') ? 'nokia' : selectedId;
  openSelect();
  if (kind === 'options') openOptions();
  else if (kind === 'info') askDifficulty(selectedEntry(), openSelect, 'Select', openSelect);
  else if (kind === 'settings') openSettings();
  else if (kind === 'results' || kind === 'fc') {
    const demoFc = kind === 'fc';
    run = { entry: selectedEntry(), diff: settings.difficulty, training: null };
    game.onFinish({ score: 48210, maxCombo: 61, counts: { perfect: 52, great: 7, good: 2, miss: 1 }, accuracy: 94.6, grade: 'A',
      fc: demoFc, ap: false, deltas: [-0.03, -0.01, 0, 0.01, 0.02, 0, -0.02, 0.01, 0.005, 0.04, -0.05, 0.01] });
  } else if (kind === 'play' || kind === 'pause') {
    const e = selectedEntry();
    const chart = generateChart(e.song, { difficulty: settings.difficulty });
    const ctx = { currentTime: 0, suspend() {}, resume() {} };
    const g = new Game({ ctx, getLatency: () => 0, stopAll() {}, tick() {}, playNote: () => ({ release() {} }), playMiss() {} });
    g.fx = game.fx;
    g.start(chart, { leadIn: 0, backing: false });
    clearInterval(g.timer);
    const T = chart.length * 0.09 + 0.3;
    const ev = [];
    for (const n of chart.notes) {
      const end = n.time + (n.isHold ? n.duration : 0.05);
      if (end < T - 0.15) ev.push([n.time + 0.004, 1, n.lane], [end, 0, n.lane]);
    }
    ev.sort((a, b) => a[0] - b[0]);
    for (const [t, down, lane] of ev) { ctx.currentTime = t; g.update(t); if (down) g.press(lane, t); else g.release(lane, t); }
    ctx.currentTime = T;
    g.update(T);
    run = { entry: e, diff: settings.difficulty, training: null };
    renderer.title = e.title;
    renderer.setLanes(chart.lanes, laneLabels(chart.lanes));
    screens.nowplaying.dataset.title = e.title;
    demoRun = { g, T };
    if (kind === 'pause') { state = 'paused'; show('paused'); } else setState('playing', null);
    input.enabled = false;
  }
}

// ---- frame loop ----
const hud = createHud(perf);
function setPerf(on) {
  perf.enable(on);
  try { localStorage.setItem('ringbeat.perf', on ? '1' : ''); } catch { /* storage blocked */ }
  if (on) { perf.reset(); hud.show(); } else hud.hide();
}

function frame() {
  requestAnimationFrame(frame);
  perf.frame();
  perf.begin('pad');
  pad.poll();
  perf.end('pad');
  if (state === 'calibration') {
    $('calib-pad').style.setProperty('--pulse', calibration.pulse().toFixed(3));
    if (calibration.running && calibration.finished) {
      calibration.running = false;
      const r = calibration.result();
      if (r === null) {
        $('calib-msg').textContent = 'Not enough usable taps. Try again.';
      } else {
        settings.calibration = num(r, -0.5, 0.5, 0);
        save(); showOffset();
        $('calib-msg').textContent = `Measured offset: ${Math.round(r * 1000)} ms. Nudge or press Done.`;
      }
    }
    return;
  }
  if (state === 'settings' && (frame.n = (frame.n || 0) + 1) % 30 === 0) updatePadStatus();
  if (demoRun) { renderer.draw(demoRun.g, demoRun.T); updatePhones(demoRun.g, demoRun.T); return; }
  if (!game.active) {
    perf.begin('drawIdle');
    renderer.drawIdle();
    perf.end('drawIdle');
    return;
  }
  if (state === 'resuming') {
    const left = resumeEnd - performance.now();
    if (resumeEnd && left <= 0) finishResume();
    else if (resumeEnd) renderer.resumeCount = Math.ceil(left / 1000);
  }
  perf.begin('update');
  game.update(game.songTime());
  perf.end('update');
  if (!game.active || game.state === 'done') return;
  const t = game.songTime();
  if (state === 'countin' && t >= 0) state = 'playing';
  perf.begin('draw');
  renderer.draw(game, t);
  perf.end('draw');
  updatePhones(game, t);
}

// Bot-measured difficulty (optional: falls back to the density heuristic if missing). Loaded after first paint so a slow
// network never delays the UI; the list re-renders with the measured ratings once it arrives.
fetch(new URL('./difficulty.json', import.meta.url))
  .then(r => (r.ok ? r.json() : null))
  .then(data => {
    if (!data) return;
    setMeasured(data);
    builtins = perf.time('library', () => buildLibrary());
    renderList();
    renderDetail();
  })
  .catch(() => { /* offline / file missing */ });

wire();
phoneIdle();
setMode();
layout(); // place the phone before the first paint, without the slide
// Row heights change once the pixel font arrives: re-centre the cursor row then.
if (document.fonts) document.fonts.ready.then(() => { layout(); focusCurrentRow(); });
const demoKind = new URLSearchParams(location.search).get('demo');
if (demoKind) demo(demoKind);
let perfOn = /[?&]perf\b/.test(location.search);
try { perfOn = perfOn || !!localStorage.getItem('ringbeat.perf'); } catch { /* storage blocked */ }
if (perfOn) setPerf(true);
requestAnimationFrame(frame);
window.__ringbeat = { game, scores, settings, perf, mysongs, get state() { return state; } }; // debug/test hook (tests/smoke.html)
