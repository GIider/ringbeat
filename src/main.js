// Bootstrap, screen state machine, wiring.
// States: title -> menu -> (select | mysongs -> songmenu / composer / custom | stats | inbox -> message | profile
//   | settings <-> calibration); first visit to Tones: tutprompt -> tutorial
//   select <-> mods;  select -> countin -> playing <-> paused (-> resuming) -> results -> select
// Every screen is a <section> inside the phone's LCD; during play the #nowplaying screen holds the highway canvas.

import { generateChart } from './chart.js';
import * as mods from './mods.js';
import { Synth, VOICES } from './synth.js';
import { Game } from './game.js';
import { planBot, LADDER } from './bot.js';
import { createAutoplay } from './autoplay.js';
import { Renderer, INK } from './render.js';
import { scoreSeries, drawScoreChart } from './scorechart.js';
import { Input, KEY_LABELS, eventAudioTime } from './input.js';
import { encodeSong, decodeShare } from './share.js';
import { measureChartAsync } from './bot.js';
import { ratingFromMeasured } from './customrating.js';
import { Calibration } from './calibration.js';
import { settings, saveSettings as save, num, effectiveLang, onSave, sharedSettings, applyShared, RECENT_MAX } from './settings.js';
import { t as tr, tn, tm, fmt, setLang, applyStatic, LANGS, getLang } from './i18n.js';
import { esc, badgeHTML, nameHTML, starsBar } from './rowfmt.js';
import { buildLibrary, customEntry, formatLength, setMeasured } from './library.js';
import { CATEGORIES } from './songs.js';
import { onSwipe } from './swipe.js';
import { SORTS, applyView, nextOf, prevOf, ratingOf, sectionOf, sectionRange, jumpSection, randomOf } from './listview.js';
import { createScores } from './scores.js';
import { createStats, gradeTally, favourite, topSongs, rankSummary, formatDuration, currentStreak, dayKey, GRADES } from './stats.js';
import { MESSAGES, SENDER, unread, markRead } from './changelog.js';
import { GLYPHS, FAMILY } from './pixelfont.js';
import { MENU_IDS, menuFrame, PERSON_ART, ENVELOPE_SMALL_OPEN, ICON_W, ICON_H } from './menuicons.js';
import { createMySongs, splitRtttl, rtttlProblem, MAX_SONGS } from './mysongs.js';
import { createCloud, API_BASE } from './cloud.js';
import { createAdmin, PAGE as ADMIN_PAGE, playerLine, runLine, logLine } from './admin.js';
import { RULES, encodeLog } from './replay.js';
import * as comp from './composer.js';
import { Pad, BTN, buttonName, DEFAULT_BINDINGS, cloneBindings } from './gamepad.js';
import { STAGES, buildStageChart, stageDemoHTML } from './tutorial.js';
import * as nav from './nav.js';
import { SORT_ICONS, ICON_FIND, ICON_GLOBE, SPRITES, ICONS, ICONS_FAV, POPUPS, HEART, HEART_HALVES, categorySprite, spriteHTML, setSprite, signal, battery, envelope } from './pixelart.js';
import { createWelcome, measureGrid, CELL, runWelcome, HOLD_LIMIT, T as WT } from './welcome.js';
import { createTitle, REST as TITLE_REST, TITLE_EXTENT } from './titlefx.js';
import { VERSION, BUILD, buildLine } from './version.js';
import { perf } from './perf.js';
import { createCameoLayer } from './cameolayer.js';
import { createSequenceMatcher, createWipeGag, KONAMI, IMEI_CODE, IMEI_TAPS, fakeImei, formatImei } from './secrets.js';
import { createHud, copyReport } from './perfhud.js';
import { createNetDebug } from './netdebug.js';
import { resetFloatBoxes } from './floatbox.js';
import { createNetSignal } from './netsignal.js';
import { marquee, marqueeAll } from './marquee.js';
import { worldLines } from './worldlines.js';

const $ = id => document.getElementById(id);
setLang(effectiveLang());

// ---- core objects ----
const synth = new Synth();
let stepVoice = () => {}; // set in init: cycles the Tone setting and previews it
let tonePreview = null; // separate synth for Tone previews while paused
synth.volume = settings.volume;
synth.voice = settings.voice;
const game = new Game(synth);
const renderer = new Renderer($('stage'));
renderer.scrollTime = settings.scrollTime;
renderer.invert = settings.invert;
// Juice: layered sound + vibration on top of the renderer's visual effects. All gated by settings.juice.
let prevCombo = 0;
const buzz = ms => {
  if (!settings.juice || !settings.haptics) return;
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* ignore */ } }
  pad.rumble(Math.max(30, ms * 2)); // the shortest phone buzzes are too brief for a rumble motor
};
function juiceJudge(lane, j) {
  const c = game.combo;
  if (game.judgedCount <= 1) prevCombo = 0; // new run: don't inherit the last song's combo
  if (j === 'miss') {
    if (prevCombo >= 10) { synth.breakSlide(); buzz(20); }
  } else {
    if (j === 'perfect') { synth.ping(72); buzz(8); }
    if (c > prevCombo && (c === 10 || c === 25 || (c >= 50 && c % 50 === 0))) {
      synth.chirp();
      const sg = $('st-signal'); sg.classList.remove('blip'); void sg.offsetWidth; sg.classList.add('blip');
    }
  }
  prevCombo = c;
}
game.fx = {
  press: renderer.fx.press,
  banner: renderer.fx.banner,
  judge: (lane, j) => {
    renderer.fx.judge(lane, j);
    if (settings.juice) juiceJudge(lane, j); else prevCombo = game.combo;
  },
};
const input = new Input({ getCtx: () => synth.ctx, canvas: $('stage'), laneAt: x => renderer.laneAt(x) });
input.onPress = (lane, t) => { setDevice('kbd'); if (!isDemo()) game.press(lane, t); };
input.onRelease = (lane, t) => { if (!isDemo()) game.release(lane, t); };
const calibration = new Calibration(synth);
const scores = createScores();
const stats = createStats();
stats.backfill(scores.all()); // once, for players who had highscores before stats existed
const pad = new Pad();

// ---- screen state ----
let state = 'title';
let lastDevice = 'kbd'; // 'kbd' | 'pad' | 'touch'; decides which labels the lanes show
const screens = {
  title: $('title'), welcome: $('welcome'), menu: $('menu'), stats: $('stats'), inbox: $('inbox'), message: $('message'),
  profile: $('profile'), admin: $('admin'), select: $('select'), custom: $('custom'),
  hub: $('hub'), mysongs: $('mysongs'), songmenu: $('songmenu'), composer: $('composer'),
  settings: $('settings'), glyphs: $('glyphs'), tutorial: $('tutorial'), tutprompt: $('tutprompt'), loginprompt: $('loginprompt'), results: $('results'), paused: $('pause'),
  calibration: $('calib'), nowplaying: $('nowplaying'),
};
const inPlay = () => state === 'countin' || state === 'playing' || state === 'resuming';
function show(name) {
  name = name || (inPlay() ? 'nowplaying' : name);
  // Pause is a modal over the frozen playfield, not a screen of its own.
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name && !(name === 'paused' && k === 'nowplaying');
  document.body.classList.toggle('in-select', name === 'select');
  titleFx(name === 'title');
  if (name !== 'results') juiceResultsStop();
  if (name !== 'stats') statsCountStop();
  if (!['select', 'custom', 'mysongs', 'songmenu', 'composer'].includes(name)) stopPreview();
  const el = screens[name];
  if (el) {
    refreshChrome(el);
    paintRanges(el);
    if (inPlay()) { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }
    else requestAnimationFrame(() => { if (!el.contains(document.activeElement)) focusDefault(el); });
  }
  setMode();
  cameo.sync();
  if (!gagStates()) hideGag();
}
function setState(s, screen) { state = s; show(screen); input.enabled = s === 'countin' || s === 'playing'; }
// Status bar title + soft-key labels come from the visible screen's data attributes.
function refreshChrome(el = screens[Object.keys(screens).find(k => !screens[k].hidden)]) {
  if (!el) return;
  // The menu has no title of its own; while signed in, the player's name takes its place as the login indicator.
  const who = el === screens.menu && cloud.signedIn() ? (cloud.profile() || {}).name || '' : '';
  $('st-title').classList.remove('hello');
  $('st-title').textContent = who || tr(el.dataset.title || '') + (el.dataset.sub ? ' · ' + tr(el.dataset.sub) : '');
  for (const id of ['sel-arrow-l', 'sel-arrow-r']) $(id).hidden = el !== screens.select; // category arrows live in the title bar; show them before measuring
  $('st-title').classList.toggle('tap', el === screens.select);
  marquee($('st-title'));
  const left = tr(el.dataset.softLeft || ''), right = tr(el.dataset.softRight || '');
  $('soft-left').textContent = left;
  $('soft-right').textContent = right;
  $('soft-left').parentElement.classList.toggle('solo', !!left && !right);
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
  if (d && !el.hidden) {
    d.focus({ preventScroll: true }); light(d);
    // A screen keeps its scroll position while hidden; bring the focused default into view so the next arrow press doesn't jump.
    if (d === nav.focusables(el)[0]) el.scrollTop = 0; else d.scrollIntoView({ block: 'nearest' });
  }
}
// The highlighted list item follows focus but stays lit while focus is elsewhere (e.g. on a phone key).
let lit = null;
function light(el) {
  if (el && el.closest && el.closest('#set-tabs, .gl-grid') && lit) { lit.classList.remove('hl'); lit = null; return; }
  const item = el && el.closest && el.closest('.menu > *');
  if (!item || item === lit) return;
  if (lit) lit.classList.remove('hl');
  lit = item; lit.classList.add('hl');
}
const activeScreen = () => screens[state === 'countin' || state === 'playing' || state === 'resuming' ? '' : state];

// ---- dev mode: ?dev shows the cameo panel and the Admin app; ?dev=<cameo id> (or now) also plays cameos every few seconds.
// The profiler overlay and the request log are Settings › Developer (docs/DEVELOPMENT.md › Debug URLs and hooks) ----
const DEV = new URLSearchParams(location.search).has('dev');
const DEV_CAMEO = DEV ? new URLSearchParams(location.search).get('dev') || 'debug' : '';

// ---- easter eggs (decorative only: nothing here selects, navigates or touches saved data) ----
let cameoSignal = false; // a cameo is drawing the status bar
const cameo = createCameoLayer({
  canvas: $('cameo'),
  getState: () => state,
  enabled: () => settings.idleGags,
  dev: DEV_CAMEO,
  onStatus: st => {
    if (inPlay()) return;
    cameoSignal = !!st;
    if (!st) { phoneIdle(); return; }
    if (st.envelope) setSprite($('st-signal'), envelope(), 2);
    else if (st.signal != null) setSprite($('st-signal'), signal(st.signal), 2);
    if (st.battery != null) setSprite($('st-battery'), battery(st.battery), 2);
  },
  onChirp: () => { if (!previewTimer && !autoPreviewTimer) chirp([79, 84]); },
});
// Short buzzer notes, only if audio is already running (never unlocks or resumes the AudioContext).
function chirp(midis) {
  if (!synth.ctx || synth.ctx.state !== 'running') return;
  midis.forEach((midi, i) => synth.playNote({ midi, when: synth.ctx.currentTime + 0.02 + i * 0.12, duration: 0.1 }));
}
if (DEV) {
  const panel = document.createElement('div');
  panel.className = 'cameo-debug';
  panel.innerHTML = '<b>Cameo debug</b>';
  const add = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label; b.tabIndex = -1;
    b.addEventListener('pointerdown', e => e.preventDefault());
    b.addEventListener('click', () => { if (!inPlay()) fn(); });
    panel.appendChild(b);
  };
  for (const id of ['snake', 'space-impact', 'sms', 'signal-wobble', 'low-battery', 'parade']) add(id, () => cameo.play(id));
  add('welcome', () => { cameo.stop(); hideGag(); welcomeStart(Promise.resolve(true)); });
  add('stop', () => { cameo.stop(); hideGag(); });
  add('imei', showImei);
  add('wipe', startWipe);
  add('konami', konamiReward);
  const next = document.createElement('div');
  panel.insertBefore(next, panel.children[1]);
  const showNext = () => {
    const n = cameo.nextIn();
    next.textContent = 'next: ' + (n === null ? '—' : n === 'playing' ? 'playing' : Math.ceil(n) + ' s' + (cameo.paused() ? ' (paused)' : ''));
  };
  showNext(); setInterval(showNext, 250);
  document.body.appendChild(panel);
}
const konami = createSequenceMatcher(KONAMI);
const imeiCode = createSequenceMatcher(IMEI_CODE);
const wipe = createWipeGag();
let gagTimer = 0, gagHold = 0, gagTick = 0, holdFired = false;
// Hold gesture (C key, keyboard or phone): fires the wipe gag after HOLD_MS. It then runs on after the key is let go;
// the next C press stops it.
const HOLD_MS = 1200;
function beginHold(onFire) {
  endHold();
  holdFired = false;
  gagHold = setTimeout(() => { gagHold = 0; holdFired = true; onFire(); }, HOLD_MS);
}
function endHold() { clearTimeout(gagHold); gagHold = 0; return holdFired; }
const gagStates = () => ['title', 'menu', 'select'].includes(state);
function hideGag() {
  clearTimeout(gagTimer); clearTimeout(gagHold); clearInterval(gagTick);
  gagTimer = gagHold = gagTick = 0;
  if ($('gag')) $('gag').style.pointerEvents = '';
  wipe.cancel();
  if ($('gag')) $('gag').hidden = true;
  document.body.classList.remove('gag-on');
  if ($('gag-link')) $('gag-link').hidden = true;
  if ($('gag-art')) $('gag-art').hidden = true;
}
function showGag(title, text, bar = -1, segments = 0) {
  $('gag').hidden = false;
  document.body.classList.add('gag-on');
  $('gag-title').textContent = tm(title);
  $('gag-text').textContent = tm(text);
  const b = $('gag-bar');
  if (bar < 0) b.textContent = '';
  else if (b.children.length !== segments) b.innerHTML = '<i></i>'.repeat(segments);
  Array.from(b.children).forEach((c, i) => c.classList.toggle('on', i < bar));
}
function showImei() {
  hideGag();
  showGag('IMEI', formatImei(fakeImei(VERSION)) + '\nSW v' + VERSION + '\n' + (BUILD.number ? 'Build ' + BUILD.number + '\n' : '') +
    buildLine(BUILD, false));
  $('gag-link').hidden = false;
  setSprite($('gag-art'), SPRITES.avatar, lcdWidth() >= SEL_WIDE_PX ? 4 : 2);
  $('gag-art').hidden = false;
  $('gag').style.pointerEvents = 'auto'; // so the credit link is clickable
  gagTimer = setTimeout(hideGag, 8000);
}
function startWipe() {
  hideGag();
  wipe.start();
  gagTick = setInterval(() => {
    wipe.step(100);
    const v = wipe.view();
    if (!v) { hideGag(); return; }
    showGag('', v.text, v.bar, v.segments);
  }, 100);
  showGag('', tr('Clearing memory...'), 0, 12);
}
function konamiReward() {
  const lcd = $('lcd');
  lcd.classList.add('flash');
  setTimeout(() => lcd.classList.remove('flash'), 140);
  setTimeout(() => lcd.classList.add('flash'), 280);
  setTimeout(() => lcd.classList.remove('flash'), 420);
  chirp([72, 76, 79, 84]);
  cameo.parade();
}
// Fed passively from keyboard and gamepad; consumes nothing. Armed only on title/menu/select.
function eggToken(code) {
  if (!gagStates()) { konami.reset(); imeiCode.reset(); return; }
  if (!code) return;
  if (konami.feed(code)) { konamiReward(); showImei(); }
  if (imeiCode.feed(code)) showImei();
}
// Touch / mouse route to the IMEI panel: IMEI_TAPS quick taps on the version label.
let verTaps = 0, verTimer = 0;
function tapVersion() {
  clearTimeout(verTimer);
  verTimer = setTimeout(() => { verTaps = 0; }, 1200);
  if (++verTaps >= IMEI_TAPS) { verTaps = 0; showImei(); }
}

let toastTimer = 0;
function toast(msg, ms = 2200) { showToast(t => { t.textContent = tm(msg); t.classList.remove('icon', 'break'); }, ms); }
function showToast(fill, ms) {
  const t = $('toast');
  fill(t); t.hidden = false;
  // Pop up in the middle of the phone's LCD when it is on screen, else at the bottom of the viewport.
  const r = $('lcd').getBoundingClientRect();
  const onLcd = !!(r.width > 0 && r.left >= 0 && r.right <= window.innerWidth + 1);
  t.classList.toggle('on-lcd', onLcd);
  t.style.left = onLcd ? r.left + r.width / 2 + 'px' : '';
  t.style.top = onLcd ? r.top + r.height / 2 + 'px' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// Heart control animations, played inside the element that holds the resting heart sprite (the song details' heart button and
// the Glyphs viewer's cells; the element is position:relative). Added: the heart beats three times. Removed: it beats once,
// then cracks into two halves and pixel shards. The timings match style.css (.beat, .fx.break).
const SHARDS = [[-12, -9, -90], [11, -12, 120], [-15, 5, 60], [14, 8, -140], [-5, 15, 200], [6, 16, -70]]; // dx, dy, rot
const HEART_MS = { add: 1000, break: 1150 };
const HEART_CRACK_MS = 520; // the heart beats this long before it cracks (favBreak's crackAt)
function heartCrackHTML() {
  const half = (r, side) => `<span class="fx-half ${side}">${spriteHTML(r, 3)}</span>`;
  return `<span class="fx break"><span class="fx-whole">${spriteHTML(HEART, 3)}</span>${half(HEART_HALVES[0], 'l')}${half(HEART_HALVES[1], 'r')}` +
    SHARDS.map(([x, y, r], i) => `<i class="fx-shard" style="--dx:${x}px;--dy:${y}px;--rot:${r}deg;--n:${i}"></i>`).join('') + '</span>';
}
function playHeart(el, kind) {
  clearTimeout(el._heartT);
  el.querySelector('.fx')?.remove();
  el.classList.remove('beat', 'playing');
  void el.offsetWidth; // restart the animation
  if (kind === 'add') { el.classList.add('beat'); synth.favAdd(); }
  else {
    el.classList.add('playing'); // the resting heart hides under the overlay
    el.insertAdjacentHTML('beforeend', heartCrackHTML());
    synth.favBreak(HEART_CRACK_MS / 1000);
  }
  el._heartT = setTimeout(() => { el.classList.remove('beat', 'playing'); el.querySelector('.fx')?.remove(); }, HEART_MS[kind]);
}
// A favorite changed: animate the heart beside the song's name (when the details are on screen), else just the sound.
function favFx(id, kind) {
  const heart = $('sd-fav');
  if (state === 'select' && id === selectedId && heart.getClientRects().length) playHeart(heart, kind);
  else if (kind === 'add') synth.favAdd(); else synth.favBreak(0);
}

// ---- library & selection ----
let builtins = buildLibrary(); // rebuilt once difficulty.json has loaded
const mysongs = createMySongs();
let customs = [];        // library entries for the player's saved songs ({...entry, uid})
let selectedId = '';

// ---- cloud save: optional online profile (see docs/CLOUD.md); `ringbeat.api` in localStorage points at a local API ----
// `npm run dev:cloud` sets ringbeat.devlogin: the local API then offers a GitHub-free sign-in. ?api=prod undoes both.
if (new URLSearchParams(location.search).get('api') === 'prod') {
  try { localStorage.removeItem('ringbeat.api'); localStorage.removeItem('ringbeat.devlogin'); } catch { /* ignore */ }
}
const apiBase = (() => { try { return localStorage.getItem('ringbeat.api') || API_BASE; } catch { return API_BASE; } })();
const devLogin = (() => { try { return !!localStorage.getItem('ringbeat.devlogin') && !!localStorage.getItem('ringbeat.api'); } catch { return false; } })();
const netDebug = createNetDebug();
netDebug.enable(settings.netTracker);
const cloud = createCloud({
  scores, stats, mysongs, prefs: { sharedSettings, applyShared }, gameVersion: VERSION,
  isBusy: () => inPlay() || state === 'paused', // no sync while a song runs
  debug: netDebug,
  apiBase, devLogin,
});
onSave(() => cloud.schedule());
let settingsArrived = () => {}; // set up in wire()
// The signal icon as the connection light: only for signed-in players, and never over play or a cameo.
const netSignal = createNetSignal({
  paint: n => setSprite($('st-signal'), signal(n), 2),
  blocked: () => inPlay() || cameoSignal,
  reduced: () => still.matches,
});
const netView = () => { const n = cloud.netState(); return n !== 'off' && navigator.onLine === false ? 'offline' : n; };
const showNet = () => netSignal.setState(netView());
// Hover hint for the signal icon, worded for whatever it shows right now.
const signalTip = () => inPlay() ? tr('Signal: how well you are hitting the notes') : cameoSignal ? '' : ({
  off: tr('Not signed in, playing offline'), send: tr('Sending your progress…'), recv: tr('Receiving your progress…'),
  error: tr('Last sync failed, will retry'), offline: tr('No connection'),
}[netView()] || tr('Connected, everything is synced'));
$('st-signal').addEventListener('pointerenter', () => { $('st-signal').title = signalTip(); });
addEventListener('online', showNet);
addEventListener('offline', showNet);
cloud.onChange(e => {
  if (e === 'profile' || e === 'signedin' || e === 'signedout' || e.synced) refreshMenu();
  if ((e === 'profile' || e === 'signedin' || e === 'signedout') && state === 'menu') refreshChrome();
  if (e.net || e === 'signedin' || e === 'signedout') showNet();
  if (e.synced) {
    if (e.synced.has('settings')) {
      // Not in the middle of a song: scroll speed, voice and language change once the run is over.
      const apply = () => (inPlay() || state === 'paused' ? setTimeout(apply, 1000) : settingsArrived());
      apply();
    }
    if (e.synced.has('songs')) { refreshCustoms(); if (!entryById(selectedId)) selectedId = defaultSongId(); }
    if (state === 'select') renderList();
    else if (state === 'stats') renderStats();
    else if (state === 'mysongs') openMySongs();
    else if (state === 'menu') renderMenu();
  }
  if (e.ranks && state === 'stats') renderStats();
  if ((e === 'signedin' || e === 'signedout' || e.ranks) && state === 'select') { if (e === 'signedin') dpTab = 'world'; renderDpPanel(); }
  if (e === 'profile' || e === 'signedin') $('pf-name-input').value = (cloud.profile() || {}).name || '';
  if (state === 'profile') renderProfile();
});

function refreshCustoms() {
  cloud.schedule();
  const seen = new Set();
  customs = [];
  for (const s of mysongs.list()) {
    const e = customEntry(s.rtttl, s.rating);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    customs.push({ ...e, title: s.name || e.title, uid: s.uid });
  }
}
const entries = () => (customs.length ? [...builtins, ...customs] : builtins);
const entryById = id => entries().find(e => e.id === id) || null;
const selectedEntry = () => entryById(selectedId) || visible()[0] || entries()[0];
// Entries after the song-select sort/filter.
// The Favorites sort keeps the order it had when the list was entered: toggling a heart does not move the song under the cursor.
// The snapshot is dropped (the next visible() takes a fresh one) when the screen is entered or the view changes.
let sortFavs = null;
const visible = () => applyView(entries(), settings.view, scores, favKeep.size ? [...settings.favorites, ...favKeep] : settings.favorites, settings.recent, searchQuery, unplayedKeep ? [unplayedKeep] : [], sortFavs ||= settings.favorites.slice());
let searchQuery = '', selMoveAt = 0; // title/tag filter typed in the picker (not persisted); when the cursor last moved
// New players start on the top of the default view (easiest first), computed from the current ratings.
const defaultSongId = () => (applyView(builtins, { sort: 'diff-asc', category: 'all' }, scores)[0] || builtins[0]).id;

// ---- preview (plays the song straight through, optionally cut at maxSec) ----
let previewTimer = null, autoPreviewTimer = null;
function stopPreview() {
  clearTimeout(previewTimer); clearTimeout(autoPreviewTimer);
  previewTimer = autoPreviewTimer = null;
  if (synth.ctx) synth.stopAll();
  for (const id of ['btn-custom-preview', 'sm-preview', 'comp-preview']) $(id).textContent = tr('Preview');
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
  for (const id of ['btn-custom-preview', 'sm-preview', 'comp-preview']) $(id).textContent = tr('Stop preview');
  previewTimer = setTimeout(stopPreview, (end * beat + 0.4) * 1000);
}
function togglePreview(entry) {
  if (previewTimer) stopPreview(); else startPreview(entry);
}

// ---- song select screen ----
// Rating (internal 1..10) on the player-facing 5-star scale, e.g. 7 -> "3.5".
const starsValue = rating => fmt(rating / 2, 1);
// `~` in front of a rating that is only a guess (density heuristic, or a rating imported from someone else).
const estMark = e => (e && e.estimated ? '~' : '');
const starsText = rating => starsBar(rating, tr('{v} of 5 stars', { v: starsValue(rating) }));

// Category chips: All + each category (+ Custom when a custom song exists, + Favorites when there are any), with song counts.
function categoryTabs() {
  const all = entries();
  const count = t => t.id === 'all' ? all.length
    : t.id === 'favorites' ? all.filter(e => isFavorite(e.id) || favKeep.has(e.id)).length
    : t.id === 'recent' ? all.filter(e => settings.recent.includes(e.id)).length
    : t.id === 'unplayed' ? all.filter(e => e.id === unplayedKeep || !scores.get(e.id, e.chart)).length
    : all.filter(e => e.category === t.id).length;
  // Smart views (Recent, Unplayed) come right after All and only show up while they have songs.
  const tabs = [{ id: 'all', label: 'All' }, { id: 'recent', label: 'Recent' }, { id: 'unplayed', label: 'Unplayed' }, ...CATEGORIES];
  if (customs.length) tabs.push({ id: 'custom', label: 'Custom' });
  tabs.push({ id: 'favorites', label: 'Favorites' });
  return tabs.map(t => ({ ...t, count: count(t) })).filter(t => t.count > 0 || t.id === 'all');
}
function renderCategories() {
  const tabs = categoryTabs();
  if (!tabs.some(t => t.id === settings.view.category)) settings.view.category = 'all';
  viewTab = tabs.find(x => x.id === settings.view.category);
  // The strip is built once per tab set and only re-marked afterwards, so the current tab stays in the middle and the others scroll past it.
  const strip = $('sel-tabs'), sig = tabs.map(t => t.id + ':' + tr(t.label)).join('|');
  if (strip.dataset.sig !== sig) {
    strip.dataset.sig = sig;
    strip.textContent = '';
    for (const t of tabs) {
      const b = document.createElement('button');
      b.type = 'button'; b.tabIndex = -1; b.dataset.cat = t.id;
      b.textContent = tr(t.label);
      strip.appendChild(b);
    }
  }
  let cur = null;
  for (const b of strip.children) { const on = b.dataset.cat === viewTab.id; b.classList.toggle('sel', on); if (on) cur = b; }
  stripUncentered = !centerTab(); // measured while the screen is hidden: fitHead centres it once it shows
  renderPosition();
}
// Header: the category goes in the status title ("Tones · Video Games"); the row shows the cursor position and section ("3/61 · T").
// Uses the list and tab renderList() just built: this runs on every cursor move, which must stay cheap.
let viewList = [], viewTab = null;
function renderPosition() {
  const t = viewTab, list = viewList, at = list.findIndex(e => e.id === selectedId);
  if (!t) return;
  let sec = at < 0 ? '' : sectionOf(list[at], settings.view.sort);
  sec = sectionRange(sec, settings.view.sort, r => fmt(r, 1)); // the band as a range, stars in the same format as the stars value
    const cat = $('sel-cat'), pos = `${at < 0 ? '' : at + 1 + '/'}${searchQuery ? list.length : t.count}${sec ? ' · ' + sec : ''}`;
  cat.textContent = pos;
  queueHeadFit();
}
// Scroll the category strip so the current tab sits in the middle; false when the strip has no size yet (hidden screen).
let stripUncentered = false;
function centerTab(instant = false) {
  const strip = $('sel-tabs'), cur = strip.querySelector('.sel'), sr = strip.getBoundingClientRect();
  if (!cur || !sr.width) return false;
  const cr = cur.getBoundingClientRect(), delta = cr.left + cr.width / 2 - (sr.left + sr.width / 2);
  if (instant) { strip.style.scrollBehavior = 'auto'; strip.scrollLeft += delta; strip.style.scrollBehavior = ''; } else strip.scrollLeft += delta;
  return true;
}
// Header row: sort chip (icon + name), position text, Find (icon + word). When the words would crowd the middle text, only the icons show.
let headFitQueued = false;
const queueHeadFit = () => {
  if (headFitQueued) return;
  headFitQueued = true;
  requestAnimationFrame(() => { headFitQueued = false; if (!screens.select.hidden) fitHead(); });
};
function fitHead() {
  if (stripUncentered) stripUncentered = !centerTab(true); // the screen was hidden when the tabs were drawn
  const sortEl = $('sel-sort'), findEl = $('sel-find'), cat = $('sel-cat');
  const sort = SORTS.find(x => x.id === settings.view.sort), name = tr(sort.label), find = tr('Find');
  const icon = rows => spriteHTML(rows, 2);
  const crowded = () => cat.scrollWidth > cat.clientWidth + 1 || cat.clientWidth < 8;
  // full words first, then icons one chip at a time (all in one task, so nothing flickers)
  sortEl.innerHTML = icon(SORT_ICONS[sort.id]) + esc(name); findEl.innerHTML = icon(ICON_FIND) + esc(find);
  sortEl.setAttribute('aria-label', name); findEl.setAttribute('aria-label', find);
  sortEl.title = name;
  if (crowded()) sortEl.innerHTML = icon(SORT_ICONS[sort.id]);
  if (crowded()) findEl.innerHTML = icon(ICON_FIND);
}
// Move the cursor to list index `i` (clamped) and keep it in view.
function jumpTo(i) {
  const list = visible();
  if (!list.length) return;
  const e = list[Math.max(0, Math.min(list.length - 1, i))];
  if (e.id === selectedId) return;
  selectSong(e.id);
  focusCurrentRow();
}
const PAGE_ROWS = () => Math.max(3, Math.floor($('song-list').clientHeight / (($('song-list').firstElementChild || {}).offsetHeight || 28)) - 1);
function jumpPage(step) { jumpTo(visible().findIndex(e => e.id === selectedId) + step * PAGE_ROWS()); }
function randomSong() {
  const e = randomOf(visible(), selectedId);
  if (!e) return;
  selectSong(e.id);
  focusCurrentRow();
}
let thumbQueued = false;
const queueThumb = () => { // after the frame's layout, not forced from inside a render
  if (thumbQueued) return;
  thumbQueued = true;
  requestAnimationFrame(() => { thumbQueued = false; updateThumb(); });
};
function updateThumb() {
  const l = $('song-list'), t = $('sel-thumb'), over = l.scrollHeight > l.clientHeight + 1;
  t.hidden = !over;
  $('song-wrap').classList.toggle('thumb', over);
  if (!over) return;
  const h = Math.max(12, Math.round(l.clientHeight * l.clientHeight / l.scrollHeight));
  t.style.height = h + 'px';
  t.style.top = Math.round(l.scrollTop / (l.scrollHeight - l.clientHeight) * (l.clientHeight - h)) + 'px';
}
{
  const l = $('song-list');
  l.addEventListener('scroll', queueThumb, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(updateThumb).observe(l);
}
// A-Z strip (touch, sorted by title): the letters present, drag along it to jump.
function renderAz() {
  const list = viewList, az = $('sel-az'), on = settings.view.sort === 'title' && list.length > 12;
  $('song-wrap').classList.toggle('az', on);
  az.textContent = '';
  if (!on) return;
  for (const c of new Set(list.map(e => sectionOf(e, 'title')))) {
    const sp = document.createElement('span');
    sp.textContent = c; sp.dataset.letter = c;
    az.appendChild(sp);
  }
}
{
  const az = $('sel-az');
  const pick = ev => {
    const r = az.getBoundingClientRect(), n = az.children.length;
    if (!n) return;
    const c = az.children[Math.max(0, Math.min(n - 1, Math.floor((ev.clientY - r.top) / r.height * n)))].dataset.letter;
    const i = visible().findIndex(e => sectionOf(e, 'title') === c);
    if (i >= 0) jumpTo(i);
  };
  az.addEventListener('pointerdown', ev => { az.setPointerCapture(ev.pointerId); pick(ev); });
  az.addEventListener('pointermove', ev => { if (az.hasPointerCapture(ev.pointerId)) pick(ev); });
}

// ---- search (the "/" bar): live title / tag filter over the current category ----
$('sel-search').firstElementChild.innerHTML = spriteHTML(ICON_FIND, 2); // the search bar wears the same icon as the Find chip
const searchOpen = () => !$('sel-search').hidden;
function applySearch() {
  const keep = selectedEntry();
  renderList();
  if (!visible().includes(keep) && visible()[0]) selectSong(visible()[0].id, false);
  renderDetail();
  const row = Array.from($('song-list').children).find(b => b.dataset.id === selectedId);
  if (row) revealRow(row); // the list was rebuilt: bring the cursor row back into view (focus stays in the search box)
}
function openSearch() {
  $('sel-search').hidden = false;
  const q = $('sel-q');
  q.value = searchQuery;
  q.focus();
  q.select();
}
function closeSearch() {
  const had = searchQuery !== '';
  $('sel-search').hidden = true;
  searchQuery = '';
  $('sel-q').value = '';
  if (had) applySearch();
  if (state === 'select') focusCurrentRow();
}
{
  const q = $('sel-q');
  q.addEventListener('input', () => { searchQuery = q.value; applySearch(); });
  q.addEventListener('keydown', ev => {
    if (ev.code === 'Enter' || ev.code === 'ArrowDown') {
      ev.preventDefault(); ev.stopPropagation();
      if (ev.code === 'Enter' && searchQuery === '') closeSearch(); else focusCurrentRow();
    }
  });
  $('sel-find').addEventListener('pointerdown', ev => ev.preventDefault());
  $('sel-find').addEventListener('click', () => (searchOpen() ? closeSearch() : openSearch()));
}

// ---- category hub: every group at a glance ----
// kind 'cat': pick a category (with counts); 'sort': pick the sort order.
function openHub(kind = 'cat') {
  stopPreview();
  const grid = $('hub-grid');
  grid.textContent = '';
  screens.hub.dataset.title = kind === 'sort' ? 'Sort order' : 'Categories';
  if (kind === 'sort') {
    for (const s of SORTS) {
      const b = document.createElement('button'), cur = s.id === settings.view.sort;
      b.className = cur ? 'hub-card cur' : 'hub-card';
      b.dataset.sort = s.id;
      if (cur) b.dataset.default = '';
      b.innerHTML = `${spriteHTML(SORT_ICONS[s.id], 'u', 'cat')}<span class="t">${esc(tr(s.label))}</span>`;
      grid.appendChild(b);
    }
    setState('hub', 'hub');
    return;
  }
  for (const t of categoryTabs()) {
    const b = document.createElement('button');
    const cur = t.id === settings.view.category;
    b.className = cur ? 'hub-card cur' : 'hub-card';
    b.dataset.cat = t.id;
    if (cur) b.dataset.default = '';
    const icon = t.id === 'favorites' ? spriteHTML(categorySprite('custom', true), 'u', 'cat')
      : CATEGORIES.some(c => c.id === t.id) || t.id === 'custom' ? spriteHTML(categorySprite(t.id, false), 'u', 'cat') : '';
    b.innerHTML = `${icon}<span class="t">${esc(tr(t.label))}</span><span class="n">${t.count}</span>`;
    grid.appendChild(b);
  }
  setState('hub', 'hub');
}
function leaveHub() {
  setState('select', 'select');
  focusCurrentRow();
  scheduleAutoPreview();
}
$('hub-grid').addEventListener('click', ev => {
  const b = ev.target.closest('.hub-card');
  if (!b) return;
  if (b.dataset.sort) { if (b.dataset.sort !== settings.view.sort) setViewTo('sort', b.dataset.sort); }
  else if (b.dataset.cat !== settings.view.category || favKeep.size) setCategory(b.dataset.cat); // picking Favorites again reopens it
  leaveHub();
});
$('sel-tabs').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b && b.dataset.cat !== settings.view.category) { synth.keyClick(); setCategory(b.dataset.cat); } });
for (const id of ['sel-cat', 'st-title']) $(id).addEventListener('click', () => { if (state === 'select') { synth.keyClick(); openHub(); } }); // the category heading in the title bar is tappable too

function jumpSectionStep(step) {
  const list = visible();
  jumpTo(jumpSection(list, list.findIndex(e => e.id === selectedId), step, settings.view.sort));
}
function setCategory(id) {
  sortFavs = null;
  favKeep.clear(); unplayedKeep = null;
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

const isFavorite = id => settings.favorites.includes(id);
// Songs unfavorited while the Favorites view is open stay listed there (so an accidental tap can be undone) until the
// view is left: changing category, or opening Tones again.
const favKeep = new Set();
// The song just played from the Unplayed view stays listed there (keeping the player's place) until they change category or play another song.
let unplayedKeep = null;
function toggleFavorite(id = selectedId) {
  if (!entryById(id)) return;
  const on = !isFavorite(id);
  settings.favorites = on ? [...settings.favorites, id] : settings.favorites.filter(x => x !== id);
  if (!on && settings.view.category === 'favorites') favKeep.add(id); else favKeep.delete(id);
  save();
  renderList();
  renderPane();
  if (state === 'select') focusCurrentRow(); // the list may have re-sorted around the cursor
  // After focusCurrentRow's frame has put the row back in view, so the effect finds the icon where it ended up.
  requestAnimationFrame(() => requestAnimationFrame(() => favFx(id, on ? 'add' : 'break')));
}

function renderList() {
  const list = viewList = visible();
  renderCategories();
  const box = $('song-list');
  box.textContent = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint empty';
    p.textContent = tr('No songs match this filter.');
    box.appendChild(p);
  }
  for (const e of list) {
    const b = document.createElement('button');
    b.className = 'song-row';
    b.dataset.id = e.id;
    b.setAttribute('role', 'option');
    const rec = scores.get(e.id, e.chart);
    const best = rec && rec.best;
    const fav = isFavorite(e.id);
    if (fav) b.classList.add('fav');
    b.innerHTML =
      spriteHTML(categorySprite(e.category, fav), 'u', 'cat') +
      `<span class="t">${esc(e.title)}</span>` +
      `<span class="b">${best ? `${esc(best.grade)}${badgeHTML(rec)}` : ''}</span>`;
    box.appendChild(b);
  }
  renderAz();
  markSelected();
  queueThumb();
}
// One delegated set of row handlers instead of three listeners per row (the list is rebuilt on every view change).
{
  const box = $('song-list');
  const rowId = ev => { const r = ev.target.closest && ev.target.closest('.song-row'); return r ? r.dataset.id : null; };
  box.addEventListener('focusin', ev => { const id = rowId(ev); if (id) selectSong(id, false); });
  // Touch has no reliable double-click: a tap on the row that was already selected (before focus moved) plays it.
  let tapWasSelected = false, pressWasSelected = false; // pressWasSelected: any pointer (focusin selects the row before the click lands)
  const swiped = onSwipe(box, dir => cycleCategory(dir === 'left' ? 1 : -1));
  // The favorite toggle is the icon plus some room around it (a fingertip is much wider than the 2px-scale sprite).
  const inFavZone = ev => {
    const row = ev.target.closest && ev.target.closest('.song-row'), icon = row && row.querySelector('.spr.cat');
    if (!icon) return false;
    const r = icon.getBoundingClientRect();
    return ev.clientX <= r.right + Math.max(row.clientHeight * 0.75, 22);
  };
  box.addEventListener('pointerdown', ev => { pressWasSelected = rowId(ev) === selectedId; tapWasSelected = ev.pointerType !== 'mouse' && pressWasSelected; });
  box.addEventListener('click', ev => {
    const id = rowId(ev);
    if (!id || swiped()) return;
    // The icon of the selected row is the favorite toggle (a first tap on another row only selects it).
    if (pressWasSelected && selectedId === id && ev.detail !== 0 && inFavZone(ev)) { toggleFavorite(id); tapWasSelected = pressWasSelected = false; return; }
    if (selectedId !== id) selectSong(id, false);
    else if (ev.detail === 0 || tapWasSelected) playSelected(); // keyboard / gamepad confirm or touch re-tap; mouse uses double-click
    tapWasSelected = pressWasSelected = false;
  });
  box.addEventListener('dblclick', ev => { if (rowId(ev) && !inFavZone(ev)) playSelected(); });
}
function markSelected() {
  for (const b of $('song-list').children) {
    const on = b.dataset.id === selectedId;
    b.classList.toggle('cur', on);
    b.setAttribute('aria-selected', String(on));
    const t = b.querySelector('.t');
    if (t) { if (on) marquee(t); else if (t.classList.contains('scrolls')) t.classList.remove('scrolls'); }
  }
  renderPosition();
}

function renderDetail() {
  selectHints();
  const e = selectedEntry();
  if (!e) return;
  const rec = scores.get(e.id, e.chart);
  $('sel-info').innerHTML =
    `<div>${starsText(ratingOf(e))}<b>${estMark(e)}${starsValue(ratingOf(e))}</b><span class="hint"> / 5</span>` +
    (rec ? ` · ${rec.best.score} ${esc(rec.best.grade)}${badgeHTML(rec)}` : ' · ' + esc(tr('New'))) + `</div>` +
    `<div title="${esc(tn(e.notes[e.chart], '{n} note', '{n} notes'))}">${e.bpm} BPM · ${formatLength(e.length)}${e.tag ? ' · ' + esc(e.tag) : ''}</div>`;
  if (e.tag) marquee($('sel-info').children[1]); // a long author / source scrolls like a long title
  renderPane();
}

function selectSong(id, scroll = true) {
  if (!entryById(id)) return;
  const changed = id !== selectedId;
  selectedId = id;
  if (changed) selMoveAt = performance.now();
  settings.lastSongId = id; save();
  markSelected();
  renderDetail();
  if (scroll) {
    const row = Array.from($('song-list').children).find(b => b.dataset.id === id);
    if (row) revealRow(row);
  }
  if (changed) scheduleAutoPreview();
}

function scheduleAutoPreview() {
  stopPreview();
  if (settings.preview && state === 'select' && synth.ctx) {
    synth.ensure(); // resume a context suspended by tutorial pause/skip
    autoPreviewTimer = setTimeout(() => startPreview(selectedEntry(), 10), 450);
  }
}

function setView(key, list, step = 1) { setViewTo(key, (step < 0 ? prevOf : nextOf)(list, settings.view[key])); }
function setViewTo(key, id) {
  sortFavs = null;
  settings.view[key] = id;
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
// Small moves scroll just enough to keep one row of context past the cursor, smoothly; far jumps (page, group, random) centre the row at once.
function revealRow(row) {
  const list = $('song-list'), lr = list.getBoundingClientRect(), rr = row.getBoundingClientRect();
  const pad = Math.min(rr.height, lr.height / 4);
  const delta = rr.top < lr.top + pad ? rr.top - (lr.top + pad) : rr.bottom > lr.bottom - pad ? rr.bottom - (lr.bottom - pad) : 0;
  if (!delta) return;
  if (Math.abs(delta) > lr.height * 0.6) list.scrollTop += rr.top + rr.height / 2 - (lr.top + lr.height / 2);
  else list.scrollTo({ top: list.scrollTop + delta, behavior: still.matches ? 'auto' : 'smooth' });
}
function openSelect() {
  sortFavs = null; // coming back to the list: favorites float to the top again
  selDetail = false;
  $('select').classList.remove('detail');
  renderList();
  renderDetail();
  setState('select', 'select');
  focusCurrentRow();
  scheduleAutoPreview();
}

// ---- main menu: one item per screen, big animated icon, numbered scrollbar (3310 style) ----
const MENU = [
  { id: 'tones', title: 'Tones', open: () => { favKeep.clear(); unplayedKeep = null; if (settings.tutorialDone) openSelect(); else openTutPrompt(); } },
  { id: 'mysongs', title: 'My songs', open: () => openMySongs() },
  { id: 'stats', title: 'Stats', open: () => openStats() },
  { id: 'messages', title: 'Messages', open: () => { smsToned = false; openInbox(); } },
  { id: 'profile', title: 'Profile', open: () => openProfile() },
  { id: 'settings', title: 'Settings', open: () => openSettings('menu') },
];
// The Admin app shows in dev mode (?dev) and for a signed-in player with the developer flag; the token still gates it.
const ADMIN_ITEM = { id: 'admin', title: 'Admin', open: () => openAdmin() };
const adminOn = () => DEV || cloud.isDev();
function refreshMenu() {
  const has = MENU.includes(ADMIN_ITEM);
  if (has === adminOn()) return;
  const id = MENU[menuIdx].id;
  if (has) MENU.pop(); else MENU.push(ADMIN_ITEM);
  menuIdx = Math.max(0, MENU.findIndex(m => m.id === id));
  if (has) admin.lock(); // the flag or the sign-in is gone
  if (state === 'admin') openMenu(); else if (state === 'menu') renderMenu();
}
const MENU_FRAME_MS = 130;
const still = matchMedia('(prefers-reduced-motion: reduce)');
let menuIdx = 0, menuTick = 0, menuNext = 0;
if (adminOn()) MENU.push(ADMIN_ITEM);
let unit = 2; // CSS px per LCD pixel (set by layout)
let unit2 = 3; // ...and the bigger step the text screens use on a wide LCD (see style.css, .big-text)
const textUnit = () => (lcdWidth() >= SEL_WIDE_PX ? unit2 : unit);
const unreadCount = () => unread(settings.msgSeen).length;
// The icon is drawn at 2-4 LCD pixels per sprite pixel, as big as the screen comfortably allows.
let iconPx = 0;
function paintMenuIcon() {
  const it = MENU[menuIdx], box = screens.menu, el = $('mm-icon');
  const k = Math.max(2, Math.min(4, Math.floor(Math.min(box.clientWidth * 0.8 / ICON_W, box.clientHeight * 0.45 / ICON_H) / unit)));
  if (k * unit !== iconPx) { iconPx = k * unit; el._spr = ''; } // setSprite only resizes when the image changes
  setSprite(el, menuFrame(it.id, menuTick, { unread: it.id === 'messages' && unreadCount() > 0 }), iconPx);
}
// The title is double size; a long one ("Einstellungen") drops to one and a half times so it still fits the LCD.
function fitMenuTitle() {
  const t = $('mm-title');
  t.classList.remove('sm');
  if (t.scrollWidth > t.clientWidth) t.classList.add('sm');
}
function renderMenu(dir = 0) {
  const it = MENU[menuIdx], n = unreadCount();
  $('mm-title').textContent = tr(it.title);
  $('mm-go').textContent = tr(it.title);
  fitMenuTitle();
  $('mm-num').textContent = menuIdx + 1;
  $('mm-thumb').style.setProperty('--p', (menuIdx / (MENU.length - 1)).toFixed(3));
  $('mm-hint').textContent = it.id === 'messages' && n ? tn(n, '{n} new message', '{n} new messages') : '';
  paintMenuIcon();
  if (dir) {
    const b = $('mm-body');
    b.classList.remove('slide-up', 'slide-down'); void b.offsetWidth;
    b.classList.add(dir > 0 ? 'slide-up' : 'slide-down');
  }
}
function openMenu(id) {
  if (id) menuIdx = Math.max(0, MENU.findIndex(m => m.id === id));
  menuTick = 0; menuNext = performance.now() + MENU_FRAME_MS;
  setState('menu', 'menu');
  renderMenu(); // after showing: the icon is sized from the visible screen
}
function menuJump(i) {
  const to = (i + MENU.length) % MENU.length;
  if (to === menuIdx) return;
  const dir = i > menuIdx ? 1 : -1;
  menuIdx = to;
  menuTick = 0; menuNext = performance.now() + MENU_FRAME_MS;
  renderMenu(dir);
}
const menuStep = step => menuJump(menuIdx + step);
function menuSelect() {
  MENU[menuIdx].open();
}
// Called every frame while the menu is up: steps the icon animation (held still for reduced motion).
function menuAnim(now) {
  if (now < menuNext || still.matches) return;
  menuNext = now + MENU_FRAME_MS;
  menuTick++;
  paintMenuIcon();
}

// ---- stats: lifetime numbers on six pages (◄►) ----
const STAT_PAGES = ['Time', 'Score', 'Top', 'Grades', 'Notes', 'Online'];
let statPage = 0, statTimer = 0;
const fmtNum = n => fmt(Math.round(n));
const statRow = (label, value) => `<tr><td>${label}</td><td>${value}</td></tr>`;
// Highscore entries for songs that still exist (a deleted custom song no longer counts).
function knownScores() {
  const chart = new Map(entries().map(e => [e.id, e.chart]));
  return scores.all().filter(e => chart.get(e.id) === e.diff); // drops scores on a chart the song no longer plays
}
function openStats() {
  statPage = 0;
  setState('stats', 'stats'); // shown first, so the marquee can measure the rows
  renderStats();
}
function setStatPage(n) {
  const p = (n + STAT_PAGES.length) % STAT_PAGES.length;
  if (p === statPage) return;
  statPage = p;
  synth.keyClick();
  renderStats();
}
function statsCountStop() { clearInterval(statTimer); statTimer = 0; }
// Lifetime score ticks up like the results screen.
function statsCountUp(el, final) {
  statsCountStop();
  el.textContent = fmtNum(final);
  marquee(el);
  if (!settings.juice || still.matches || final < 1) return;
  const STEPS = 12;
  let i = 0;
  el.textContent = '0';
  statTimer = setInterval(() => {
    i++;
    el.textContent = fmtNum(i >= STEPS ? final : final * i / STEPS);
    if (i >= STEPS) { statsCountStop(); marquee(el); } else synth.tickUp(i);
  }, 45);
}
function scrollStats(dir) {
  const b = $('stat-page');
  b.scrollTop += (dir === 'down' ? 1 : -1) * Math.max(20, b.clientHeight * 0.6);
}
// The Online page: from the ranks last seen (cloud.myRanks asks for them, at most once in a while, in one sync).
function onlineStatsHTML() {
  if (!cloud.available()) return `<p class="hint center">${tr('Online features are unavailable.')}</p>`;
  if (!cloud.signedIn()) return `<p class="hint center">${tr('Sign in on the profile screen for world ranks.')}</p>`;
  const mr = cloud.myRanks(), chart = new Map(entries().map(e => [e.id, e.chart]));
  const rows = mr.rows.filter(r => chart.get(r.songId) === r.diff);
  if (!rows.length) return `<p class="hint center">${tr(mr.loading || !mr.at ? 'Loading…' : 'No world ranks yet.')}</p>`;
  const sum = rankSummary(rows);
  return `<div class="st-big">${tr('Top {n}%', { n: Math.max(1, sum.avgPct) })}</div><div class="hint center">${tr('average world rank')}</div>` +
    `<table>${statRow(tr('Boards'), fmtNum(sum.boards))}${statRow(tr('World #1'), fmtNum(sum.first))}${statRow(tr('Top 10'), fmtNum(sum.top10))}</table>` +
    `<div class="st-top">${rows.slice(0, 5).map(r => `<div class="st-row"><b class="st-name">${esc(entryById(r.songId).title)}</b>` +
      `<span class="n">#${r.rank}/${r.total}</span></div>`).join('')}</div>`;
}
// One stats page into `box`.
function paintStatPage(page, box, s, list) {
  const empty = s.runs === 0 ? `<p class="hint center">${tr('Play a song to start counting.')}</p>` : '';
  if (page === 'Time') {
    box.innerHTML =
      `<div class="st-big">${formatDuration(s.playtime)}</div><div class="hint center">${tr('total playtime')}</div>` +
      `<table>${statRow(tr('Runs'), fmtNum(s.runs))}${statRow(tr('Finished'), fmtNum(s.finished))}` +
      `${statRow(tr('Days played'), fmtNum(s.daysPlayed))}${statRow(tr('Streak'), tr('{n} · best {best}', { n: currentStreak(s), best: s.bestStreak }))}</table>` +
      empty;
  } else if (page === 'Score') {
    const fav = favourite(list), fe = fav && entryById(fav.id);
    box.innerHTML =
      `<div class="st-big stat-score"></div><div class="hint center">${tr('lifetime score')}</div>` +
      `<table>${statRow(tr('Best combo'), fmtNum(s.bestCombo))}${statRow(tr('Avg / run'), s.runs ? fmtNum(s.score / s.runs) : '—')}` +
      `${statRow(tr('Modded runs'), fmtNum(s.moddedRuns))}${statRow(tr('My songs runs'), fmtNum(s.customRuns))}</table>` +
      (fe ? `<div class="st-fav"><span class="ic">♪</span><b class="st-name">${esc(fe.title)}</b><span class="n">${fav.plays}×</span></div>` : empty);
    statsCountUp(box.querySelector('.stat-score'), s.score);
    marquee(box.querySelector('.st-name'));
  } else if (page === 'Top') {
    const rows = topSongs(list, Infinity).map(t => ({ e: entryById(t.id), plays: t.plays })).filter(r => r.e);
    box.innerHTML = rows.length
      ? `<div class="hint center">${tn(rows.length, '{n} song played', '{n} songs played')}</div><div class="st-scroll"><div class="st-top">${rows.map((r, i) =>
        `<div class="st-row"><span class="rk">${i + 1}.</span><b class="st-name">${esc(r.e.title)}</b><span class="n">${r.plays}×</span></div>`).join('')}</div></div>`
      : empty || `<p class="hint center">${tr('No songs played yet.')}</p>`;
    marqueeAll(box.querySelectorAll('.st-name'));
  } else if (page === 'Grades') {
    const t = gradeTally(list), max = Math.max(1, ...GRADES.map(g => t[g]));
    box.innerHTML =
      `<div class="center">${tr('{n}/{total} played', { n: t.played, total: entries().length })}</div>` +
      `<div class="gbars">${GRADES.map(g =>
        `<div class="gbar"><span>${t[g]}</span><i style="--h:${(t[g] / max).toFixed(3)}"></i><b>${g}</b></div>`).join('')}</div>` +
      `<div class="center"><span class="badge">FC</span> ${t.fc} &nbsp; <span class="badge ap">AP</span> ${t.ap}</div>`;
  } else if (page === 'Online') {
    box.innerHTML = onlineStatsHTML();
    for (const el of box.querySelectorAll('.st-name')) marquee(el);
  } else {
    const n = s.notes, hits = n.perfect + n.great + n.good, all = hits + n.miss;
    const acc = all ? fmt((n.perfect + n.great * 2 / 3 + n.good / 3) / all * 100, 1) + '%' : '—';
    const seg = k => (all ? (n[k] / all * 100).toFixed(2) : 0);
    box.innerHTML =
      `<div class="mixbar">${['perfect', 'great', 'good', 'miss'].map(k => `<i class="${k}" style="width:${seg(k)}%"></i>`).join('')}</div>` +
      `<table>${['perfect', 'great', 'good', 'miss'].map(k => statRow(`<i class="sw ${k}"></i>${cap(k)}`, fmtNum(n[k]))).join('')}` +
      `${statRow(tr('Accuracy'), acc)}${statRow(tr('Ghost taps'), fmtNum(s.ghosts))}` +
      `${statRow(tr('FC runs'), fmtNum(s.fcRuns))}${statRow(tr('AP runs'), fmtNum(s.apRuns))}</table>` + empty;
  }
}
// The big figures run as a marquee when a panel is too narrow for them.
const marqueeBig = box => marqueeAll(box.querySelectorAll('.st-big:not(.stat-score)'));
// Wide LCD: every page is a panel of one screen (nothing to page through); narrower: one page at a time, ◄ ► between them.
const statsAll = () => lcdWidth() >= SEL_WIDE_PX;
function renderStats() {
  statsCountStop();
  const s = stats.get(), list = knownScores(), all = statsAll(), box = $('stat-page');
  $('stat-all').hidden = !all;
  box.hidden = all;
  document.querySelector('#stats .st-tabs').hidden = all;
  screens.stats.dataset.softLeft = all ? 'Select' : '';
  if (state === 'stats') refreshChrome(screens.stats);
  if (all) {
    const grid = $('stat-all');
    grid.textContent = '';
    for (const page of STAT_PAGES) {
      const panel = document.createElement('section'), body = document.createElement('div'), h = document.createElement('h3');
      panel.className = 'stat-panel'; body.className = 'stat-page'; h.textContent = tr(page);
      panel.append(h, body); grid.append(panel);
      paintStatPage(page, body, s, list);
      marqueeBig(body);
    }
    fitStatScroll();
    return;
  }
  const page = STAT_PAGES[statPage];
  box.scrollTop = 0;
  $('stat-tab').textContent = `${tr(page)} ${statPage + 1}/${STAT_PAGES.length}`;
  paintStatPage(page, box, s, list);
  marqueeBig(box);
}
// The played-songs list in the wide grid has no room to scroll by hand: it runs up and down like a marquee when it is too long.
function fitStatScroll() {
  for (const box of document.querySelectorAll('#stat-all .st-scroll')) vScroll(box, box.firstElementChild);
}

// ---- admin (?dev or a dev-flag account): browse and moderate the online database with the admin token (docs/CLOUD.md › Moderation).
// The token is kept in memory only. Views form a stack; Back pops it and reloads the view underneath. ----
const admin = createAdmin({ apiBase, debug: netDebug });
let adStack = [], adRows = [], adMsg = '', adArm = '', adArmAt = 0;
function openAdmin() {
  adStack = []; adMsg = ''; adArm = '';
  setState('admin', 'admin');
  adminShow(admin.unlocked() ? { v: 'root' } : { v: 'unlock' });
}
function adminBack() {
  adMsg = ''; adArm = '';
  if (adStack.length > 1) { adStack.pop(); adminShow(adStack.pop()); } else openMenu('admin');
}
const adError = e => (e && e.status === 404 ? tr('Wrong token or not found') : e && e.status === 0 ? tr('No connection, try again later') : tr('Error {n}', { n: e ? e.status : '?' }));
// Loads what a view needs, then draws it. A failed load still draws the view (empty) with the error line.
async function adminShow(view) {
  adStack.push(view);
  const btn = (act, label, i = '') => `<button data-act="${act}" data-i="${i}">${esc(label)}</button>`;
  const rows = (items, act, line) => items.map((x, i) => btn(act, line(x), i)).join('');
  const pages = () => (view.offset ? btn('prev', tr('Previous page')) : '') + (adRows.length === ADMIN_PAGE ? btn('next', tr('Next page')) : '');
  let html = '', def = '';
  adRows = [];
  if (!['unlock', 'root'].includes(view.v)) $('ad-msg').textContent = tr('Working…');
  try {
    switch (view.v) {
      case 'unlock':
        // A real (empty) form owns the controls through form="…" so password managers see a login, while the controls stay direct children of .menu for styling and focus nav.
        html = `<form id="ad-form"></form><input type="text" name="username" value="admin" autocomplete="username" form="ad-form" hidden>`
          + `<label class="item"><span>${esc(tr('Token'))}</span> <input id="ad-token" name="password" type="password" form="ad-form" spellcheck="false" autocomplete="current-password"></label>`
          + btn('unlock', tr('Unlock')).replace('<button ', '<button type="submit" form="ad-form" ');
        break;
      case 'root':
        html = btn('players', tr('Players')) + btn('flagged', tr('Flagged runs')) + btn('maint', tr('Maintenance')) + btn('log', tr('Log')) + btn('lock', tr('Lock'));
        break;
      case 'players':
        adRows = await admin.players(view.q, view.offset);
        html = `<label class="item"><span>${esc(tr('Search'))}</span> <input id="ad-q" type="text" maxlength="16" spellcheck="false" autocomplete="off" value="${esc(view.q)}"></label>` +
          btn('search', tr('Search')) + rows(adRows, 'player', playerLine) + pages();
        def = adRows.length ? 'player' : '';
        break;
      case 'player':
        adRows = await admin.runs(view.p.id, view.offset);
        html = `<p class="hint">${esc(playerLine(view.p))}</p>` +
          btn('ban', view.p.banned ? tr('Whitelist (unban)') : tr('Blacklist (ban)')) +
          btn('hideplayer', view.p.hidden && !view.p.banned ? tr('Show on boards') : tr('Hide from boards')) +
          btn('delplayer', tr('Delete player')) + rows(adRows, 'run', runLine) + pages();
        break;
      case 'run':
        html = `<p class="hint">${esc(runLine(view.r))}</p>` + (view.r.flags ? btn('unflag', tr('Approve (clear flags)')) : '') +
          btn('hiderun', view.r.hidden ? tr('Show on boards') : tr('Hide from boards')) + btn('delrun', tr('Delete run'));
        break;
      case 'flagged':
        adRows = await admin.flagged();
        html = adRows.length ? rows(adRows, 'run', runLine) : `<p class="hint center">${esc(tr('Nothing flagged'))}</p>`;
        break;
      case 'maint': {
        const st = await admin.stats();
        html = `<p class="hint">${esc(Object.entries(st.counts).map(([k, n]) => `${k} ${n}`).join(' · '))}<br>${esc(tr('{n} runs pending, {m} expired rows', { n: st.pending, m: st.expired }))}<br>${esc(tr('{n} runs unverifiable', { n: st.stuck }))}</p>` +
          btn('purge', tr('Purge expired')) + btn('purgestuck', tr('Clear unverifiable runs')) + btn('rebuild', tr('Rebuild boards')) + btn('verify', tr('Verify pending runs'));
        break;
      }
      case 'log': {
        const log = await admin.log();
        html = log.length ? `<div class="hint ad-log">${log.map(l => `<div>${esc(logLine(l))}</div>`).join('')}</div>` : `<p class="hint center">${esc(tr('Log is empty'))}</p>`;
        break;
      }
    }
    if (!adMsg) $('ad-msg').textContent = '';
  } catch (e) { adMsg = adError(e); }
  if (state !== 'admin') return;
  const list = $('ad-list');
  list.innerHTML = html;
  if (adMsg) { $('ad-msg').textContent = adMsg; adMsg = ''; }
  const first = (def && list.querySelector(`[data-act="${def}"]`)) || list.querySelector('input, button');
  if (first) { first.toggleAttribute('data-default', true); first.focus({ preventScroll: true }); light(first); }
}
// Runs `fn` (may return a message), then redraws; `back` returns to the view underneath (the thing acted on is gone).
async function adminDo(fn, okMsg, { back = false } = {}) {
  adArm = '';
  try { adMsg = (await fn()) || okMsg; } catch (e) { adMsg = adError(e); back = false; }
  if (back && adStack.length > 1) adStack.pop();
  adminShow(adStack.pop());
}
// Destructive buttons need a second press within 4 s.
function adminArmed(b, key) {
  if (adArm === key && Date.now() - adArmAt < 4000) { adArm = ''; return true; }
  adArm = key; adArmAt = Date.now();
  b.textContent = tr('Press again to delete');
  return false;
}
function wireAdmin() {
  $('ad-list').onsubmit = e => e.preventDefault(); // the unlock form never navigates; the button's click handler does the work
  $('ad-list').onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const view = adStack[adStack.length - 1], row = adRows[+b.dataset.i];
    const go = v => { adArm = ''; adminShow(v); };
    const reload = patch => { adStack.pop(); go({ ...view, ...patch }); };
    switch (b.dataset.act) {
      case 'unlock':
        $('ad-msg').textContent = tr('Working…');
        try { await admin.unlock($('ad-token').value); adStack = []; adminShow({ v: 'root' }); }
        catch (err) { $('ad-msg').textContent = err.status === 404 ? tr('Wrong token') : adError(err); }
        break;
      case 'lock': admin.lock(); openMenu('admin'); break;
      case 'players': go({ v: 'players', q: '', offset: 0 }); break;
      case 'flagged': case 'maint': case 'log': go({ v: b.dataset.act }); break;
      case 'search': reload({ q: $('ad-q').value.trim(), offset: 0 }); break;
      case 'prev': case 'next': reload({ offset: Math.max(0, (view.offset || 0) + (b.dataset.act === 'next' ? ADMIN_PAGE : -ADMIN_PAGE)) }); break;
      case 'player': go({ v: 'player', p: row, offset: 0 }); break;
      case 'run': go({ v: 'run', r: row }); break;
      case 'ban': adminDo(() => admin.ban(view.p.id, !view.p.banned), view.p.banned ? tr('Whitelisted') : tr('Blacklisted'), { back: true }); break;
      case 'hideplayer': adminDo(() => admin.hidePlayer(view.p.id, !(view.p.hidden && !view.p.banned)), tr('Done'), { back: true }); break;
      case 'delplayer': if (adminArmed(b, 'delplayer')) adminDo(() => admin.deletePlayer(view.p.id), tr('Player deleted'), { back: true }); break;
      case 'unflag': adminDo(() => admin.unflag(view.r.id), tr('Approved'), { back: true }); break;
      case 'hiderun': adminDo(() => admin.hideRun(view.r.id, !view.r.hidden), tr('Done'), { back: true }); break;
      case 'delrun': if (adminArmed(b, 'delrun')) adminDo(() => admin.deleteRun(view.r.id), tr('Run deleted'), { back: true }); break;
      case 'purge': adminDo(async () => tr('Removed {n}', { n: (await admin.purgeExpired()).removed })); break;
      case 'purgestuck': if (adminArmed(b, 'purgestuck')) adminDo(async () => tr('Removed {n}', { n: (await admin.purgeStuck()).removed })); break;
      case 'rebuild': adminDo(() => admin.rebuild(), tr('Boards rebuilt')); break;
      case 'verify': adminDo(async () => tr('Verified {n}', { n: (await admin.verify()).verified })); break;
    }
  };
}

// ---- messages: the changelog as an SMS inbox ----
let msgIdx = 0, smsToned = false; // the SMS tone plays once per visit to Messages (reset when the menu opens it)
function openInbox(focusVersion = '') {
  const list = $('inbox-list');
  list.textContent = '';
  for (const [i, m] of MESSAGES.entries()) {
    const isNew = !settings.msgSeen.includes(m.version), b = document.createElement('button');
    b.dataset.i = i;
    b.className = 'msg-row' + (isNew ? ' new' : '');
    b.toggleAttribute('data-default', focusVersion ? m.version === focusVersion : i === 0);
    b.innerHTML = spriteHTML(isNew ? envelope() : ENVELOPE_SMALL_OPEN, lcdWidth() >= SEL_WIDE_PX ? 3 : 2) +
      `<span class="t">${esc(tr(m.title))}</span><span class="v">v${esc(m.version)}</span>`;
    list.append(b);
  }
  setState('inbox', 'inbox');
  marqueeAll(list.querySelectorAll('.t')); // shown first, so the marquee can measure the rows
}
function openMessage(i) { if (MESSAGES[i]) showMessage(i); }
// The 3310's "Special" SMS alert: ... -- ... (only once audio is running).
function smsTone() {
  if (!synth.ctx || synth.ctx.state !== 'running') return;
  let t = synth.ctx.currentTime + 0.02;
  for (const d of [0.05, 0.05, 0.05, 0.14, 0.14, 0.05, 0.05, 0.05]) { synth.playNote({ midi: 88, when: t, duration: d }); t += d + 0.05; }
}
function showMessage(i, quiet = false) {
  const m = MESSAGES[i];
  msgIdx = i;
  settings.msgSeen = markRead(settings.msgSeen, m.version); save();
  $('sms-from').textContent = SENDER;
  $('sms-date').textContent = `v${m.version} · ${m.date}`;
  $('sms-body').innerHTML = `<b>${esc(tr(m.title))}</b>\n${esc(tr(m.body))}`;
  $('sms-body').scrollTop = 0;
  screens.message.dataset.softLeft = i + 1 < MESSAGES.length ? 'Next' : '';
  setState('message', 'message');
  if (!quiet && !smsToned) { smsToned = true; smsTone(); }
}
// Flip to a neighbouring message (+1 = older) without the animation.
const stepMessage = d => { if (MESSAGES[msgIdx + d]) showMessage(msgIdx + d, true); };
// A results page taller than the screen (the world top 10 plus the players around the player) scrolls with up/down.
// -> false when the page fits, so the keys move between the buttons as before.
function scrollResults(dir) {
  const page = document.querySelector(`#results .r-page[data-page="${resultsPage}"]`);
  if (!page || page.scrollHeight <= page.clientHeight) return false;
  const at = page.scrollTop, max = page.scrollHeight - page.clientHeight;
  if (dir === 'up' ? at <= 0 : at >= max) return false; // at the end: on to the buttons
  page.scrollTop += (dir === 'down' ? 1 : -1) * Math.max(20, page.clientHeight * 0.6);
  return true;
}
function scrollMessage(dir) {
  const b = $('sms-body');
  b.scrollTop += (dir === 'down' ? 1 : -1) * Math.max(20, b.clientHeight * 0.4);
}

// ---- profile: the player card and the optional online profile ----
let pfMsg = '', pfDeleteArmed = 0;
// "Export my data" asks the server for everything it holds: one export per minute (the time is kept across reloads).
const EXPORT_COOLDOWN_MS = 60e3, EXPORT_KEY = 'ringbeat.exportAt';
let exportAt = 0, exportTick = 0;
try { exportAt = Number(localStorage.getItem(EXPORT_KEY)) || 0; } catch { /* storage blocked */ }
function paintExport() {
  const left = Math.ceil((exportAt + EXPORT_COOLDOWN_MS - Date.now()) / 1000), b = $('pf-export');
  if (left > 0) {
    b.disabled = true;
    b.textContent = tr('Export my data ({s} s)', { s: left });
    if (!exportTick) exportTick = setInterval(paintExport, 1000);
  } else {
    b.disabled = false;
    b.textContent = tr('Export my data');
    clearInterval(exportTick); exportTick = 0;
  }
}
function openProfile() {
  pfMsg = '';
  $('pf-name-input').value = (cloud.profile() || {}).name || '';
  setSprite($('pf-icon'), PERSON_ART, textUnit() * 2);
  renderProfile();
  setState('profile', 'profile');
}
function renderProfile() {
  paintExport();
  const s = stats.get(), on = cloud.signedIn(), p = cloud.profile();
  const pname = on && p ? p.name : tr('Player 1');
  $('pf-name').innerHTML = DEV || cloud.isDev() ? nameHTML({ name: pname, dev: true }) : esc(pname);
  $('pf-meta').replaceChildren(...(s.firstPlayed
    ? [tr('Since {date}', { date: dayKey(s.firstPlayed) }), tr('{time} played', { time: formatDuration(s.playtime) })]
    : [tr('New player')]).flatMap((t, i) => i ? [document.createElement('br'), t] : [t]));
  $('pf-signin').hidden = on;
  $('pf-signin').disabled = !cloud.available();
  for (const id of ['pf-name-row', 'pf-public', 'pf-signout', 'pf-export', 'pf-delete']) $(id).hidden = !on;
  $('pf-public').textContent = tr(p && p.public === false ? 'On leaderboards: Off' : 'On leaderboards: On');
  $('pf-signin').toggleAttribute('data-default', !on);
  $('pf-public').toggleAttribute('data-default', on);
  const at = cloud.lastSync();
  $('pf-msg').textContent = pfMsg ||
    (!cloud.available() ? tr('Online profiles are not available yet.')
    : !on ? tr('Sign in to keep settings, scores and songs in sync on all your devices.')
    : at ? tr('Synced {time}', { time: new Date(at).toLocaleString(getLang(), { dateStyle: 'short', timeStyle: 'short' }) })
    : tr('Not synced yet'));
}
async function profileAction(fn, okMsg) {
  pfMsg = tr('Working…'); renderProfile();
  try { await fn(); pfMsg = okMsg; } catch (e) { pfMsg = e && e.status === 400 ? tr('Names: 3-16 letters, digits, space . _ -') : tr('No connection, try again later'); }
  renderProfile();
}

// ---- per-run playtime for stats: song time actually played (pauses and menus excluded) ----
let runTime = 0, lastSongT = null;
// Demo mod: autoplay run, nothing it does is recorded and the player's own input is ignored.
const isDemo = () => !!(run && run.modsUsed && run.modsUsed.demo);
function commitTime() {
  if (runTime > 0 && run && run.entry && !run.tutorial && !isDemo()) stats.addPlaytime(runTime, run.diff);
  runTime = 0;
  lastSongT = null;
}
// A run left before its results (quit or restart) still counts its time.
function abortRun(kind) {
  if (!run || !run.entry || run.tutorial || !['running', 'paused'].includes(game.state)) return;
  commitTime();
  if (isDemo()) return;
  stats.recordAbort(kind);
}

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
  el.textContent = ok ? tr('{what} copied to clipboard!', { what: tr(label) }) : tr("Couldn't access the clipboard");
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
  if (p) return tr('Cannot save: {why}', { why: tm(p) });
  if (mysongs.isFull()) return tr('My songs is full (max {max}): delete a song first', { max: MAX_SONGS });
  return tr('Cannot save: browser storage is unavailable');
}
function openMySongs(msg = '') {
  const list = $('ms-list');
  list.textContent = '';
  for (const e of customs) {
    const b = document.createElement('button');
    b.dataset.uid = e.uid;
    b.textContent = `${e.title} · ${tn(e.notes[e.chart], '{n} note', '{n} notes')} · ${formatLength(e.length)}`;
    list.append(b);
  }
  $('ms-msg').textContent = tm(msg) || (customs.length ? '' : tr('No songs yet. Make one with New song.'));
  $('ms-new').disabled = $('ms-paste').disabled = mysongs.isFull();
  $('ms-export').disabled = !customs.length;
  setState('mysongs', 'mysongs');
  const cur = customs.find(c => c.uid === curUid);
  const b = cur && list.querySelector(`[data-uid="${cur.uid}"]`);
  if (b) { b.focus({ preventScroll: true }); light(b); }
}
// Song menu header: tempo / notes / length plus the rating (`~` = not measured on this device).
function renderSongMeta(e) {
  $('sm-meta').textContent = `${e.bpm} BPM · ${tn(e.notes[e.chart], '{n} note', '{n} notes')} · ${formatLength(e.length)} · ${estMark(e)}${starsValue(ratingOf(e))} ★`;
  $('sm-calc').textContent = curSong() && curSong().rating && !curSong().rating.imported ? tr('Recalculate difficulty') : tr('Calculate difficulty');
}
// Measures the open song with the bot ladder (bot.js) on its chart, showing a progress bar; stores the result.
let calcToken = 0, calcRunning = false;
async function calcDifficulty() {
  const song = curSong(), e = curEntry();
  if (!song || !e) return;
  if (calcRunning) { // pressing the button again while it runs cancels
    calcToken++; calcRunning = false;
    $('sm-bar').hidden = true; $('sm-msg').textContent = tr('Calculation stopped');
    return;
  }
  const bar = $('sm-bar'), msg = $('sm-msg');
  const my = ++calcToken, uid = curUid;
  const cancelled = () => my !== calcToken || state !== 'songmenu' || curUid !== uid;
  bar.hidden = false; setBar(0); msg.textContent = tr('Calculating difficulty… (press again to stop)'); calcRunning = true;
  let m = null;
  try {
    m = await measureChartAsync(generateChart(e.song, { difficulty: e.chart }), {}, setBar, cancelled);
  } catch { m = null; }
  if (my === calcToken) calcRunning = false;
  if (cancelled() || !m) return; // whoever cancelled has already updated the screen
  setBar(1);
  const rec = ratingFromMeasured({ normal: m, hard: m }); // the stored record keeps both slots; only the song's chart is shown
  if (!rec || !mysongs.setRating(uid, rec)) { bar.hidden = true; msg.textContent = tr("Couldn't store the rating"); return; }
  refreshCustoms();
  const fresh = curEntry();
  if (fresh) renderSongMeta(fresh);
  bar.hidden = true;
  msg.textContent = tr('Difficulty calculated');
}
const setBar = f => { $('sm-bar').firstElementChild.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; };
function openSongMenu(uid) {
  curUid = uid;
  const e = curEntry();
  if (!e) { openMySongs(); return; }
  $('sm-title').textContent = e.title;
  marquee($('sm-title'));
  calcToken++; // leaving or re-entering the menu abandons a running calculation
  calcRunning = false;
  renderSongMeta(e);
  $('sm-msg').textContent = '';
  $('sm-bar').hidden = true;
  setState('songmenu', 'songmenu');
}
function importSharedText(text) {
  const r = mysongs.importText(text);
  refreshCustoms();
  return r;
}

// -- song details: the right pane of the picker (a view of its own on narrow LCDs, reached with Select) --
function cap(s) { return tr(s[0].toUpperCase() + s.slice(1)); }
// One-row text (leaderboard lines): `html` sits in a marquee box, so a long line scrolls instead of wrapping.
const oneRow = html => `<span class="ln"><span class="mq">${html}</span></span>`;
const marqueeRows = root => marqueeAll(root.querySelectorAll('.ln, .dp-line'));
// One leaderboard row (picker, results): #rank, score, name, FC / mod pills. `name` is empty for the player's own local runs.
const boardRow = (r, rank, name = '') =>
  `<span class="rk">#${rank}</span><span class="sc">${r.score}</span><span class="ln nm"><span class="mq">${name}</span></span>` +
  `<span class="ln pl"><span class="mq">${badgeHTML(r, true)}</span></span>`;
const SEL_WIDE_PX = 800; // LCD width from which the details sit beside the list (keep in step with the @container rule in style.css)
const lcdWidth = () => document.querySelector('.screens').clientWidth; // the screens' own width is 0 while they are hidden
const selWide = () => lcdWidth() >= SEL_WIDE_PX;
let selDetail = false, dpEntry = null, dpTab = 'local', paneTimer = 0;
// Signed-in players get Global (first) and Local tabs; everyone else just sees their local runs.
const dpTabs = () => cloud.available() && cloud.signedIn();
// Narrow details view: previous / next song in the list (swipe down / up, or the up / down keys).
function stepSong(step) {
  const list = visible();
  if (list.length < 2) return;
  const i = list.findIndex(e => e.id === selectedId);
  synth.keyClick();
  selectSong(list[(i + step + list.length) % list.length].id, false); // the list is out of view; focusCurrentRow reveals the row when it comes back
}
function setSelDetail(on) {
  selDetail = on;
  $('select').classList.toggle('detail', on);
  if (on) { renderPane(); $('sd-go').focus({ preventScroll: true }); } else if (state === 'select') focusCurrentRow();
}
function toggleDpTab() { if (dpTabs()) setDpTab(dpTab === 'world' ? 'local' : 'world'); }
function setDpTab(tab) {
  dpTab = tab;
  renderDpPanel();
}
function renderDpPanel() {
  const e = dpEntry;
  if (!e) return;
  const box = $('dp-panel'), bar = $('dp-tabs');
  const tabs = dpTabs();
  if (!tabs) dpTab = 'local';
  bar.hidden = !tabs;
  for (const b of bar.querySelectorAll('button')) { const on = b.dataset.tab === dpTab; b.classList.toggle('sel', on); b.setAttribute('aria-selected', on); }
  box.textContent = '';
  if (dpTab === 'world') paintDpWorld(e, e.chart, box); else { paintDpLocal(e, e.chart, box); fitRows(box); marqueeRows(box); }
}
// The board panel shrinks to the room the pane has left (CSS: flex 0 1 auto).
// Rows that don't all fit scroll up and down like a marquee instead of being cut off.
function fitRows(box) {
  const ol = box.querySelector('ol');
  if (ol) vScroll(box, ol);
}
// `inner` runs up and down inside `box` (marquee-style, CSS .vscroll) when it is taller than the box.
function vScroll(box, inner) {
  inner.classList.remove('vscroll');
  const over = inner.offsetHeight - box.clientHeight;
  if (over > 1) {
    inner.style.setProperty('--dy', -over + 'px');
    inner.style.setProperty('--dur', Math.max(3, over / 30).toFixed(1) + 's');
    inner.classList.add('vscroll');
  }
}
function paintDpLocal(e, d, box) {
  const rec = scores.get(e.id, d);
  const ol = document.createElement('ol');
  ol.className = 'top';
  for (const [i, r] of (rec ? rec.top : []).entries()) {
    const li = document.createElement('li');
    li.className = 'brow';
    li.innerHTML = boardRow(r, i + 1);
    ol.appendChild(li);
  }
  if (!ol.children.length) box.innerHTML = `<div class="hint">${esc(tr('No plays yet'))}</div>`; else box.appendChild(ol);
}
// The world top runs from the leaderboard snapshot (refreshed after 30 seconds) and the players around the player's rank.
async function paintDpWorld(e, d, box) {
  const msg = text => { box.innerHTML = `<div class="hint">${esc(text)}</div>`; };
  const near = cloud.rankNear(e.id, d) || [];
  if (!near.length) msg(tr('Loading…'));
  const show = b => {
    if (dpEntry !== e || dpTab !== 'world') return;
    paintDpWorldLines(b, near, box, msg);
  };
  show(await cloud.board(e.id, d, show));
}
function paintDpWorldLines(b, near, box, msg) {
  const lines = b && b.rules === RULES ? worldLines(b.runs, near) : [];
  if (!lines.length) return msg(tr('No world ranks yet.'));
  const ol = document.createElement('ol');
  ol.className = 'top';
  for (const r of lines) {
    const li = document.createElement('li');
    li.className = 'brow' + (r.gap ? ' gap' : r.me ? ' cur' : '');
    li.innerHTML = r.gap ? '<span class="rk">…</span>' : boardRow(r, r.rank, nameHTML(r));
    ol.appendChild(li);
  }
  box.textContent = '';
  box.appendChild(ol);
  fitRows(box);
  marqueeRows(box);
}
// The pane follows the cursor: text at once, the cover and the leaderboard once the cursor rests (no work while scrolling).
function renderPane() {
  hideModHint(); // the cursor moved on: the bubble belonged to the last song's chips
  const e = selectedEntry();
  if (!e) return;
  const rec = scores.get(e.id, e.chart), best = rec && rec.best;
  $('sd-title').textContent = e.title;
  marquee($('sd-title'));
  $('sd-stars').innerHTML = `${starsText(ratingOf(e))}<b>${estMark(e)}${starsValue(ratingOf(e))}</b><span class="hint"> / 5</span>`;
  $('sd-tag').textContent = e.tag || tr(((CATEGORIES.find(c => c.id === e.category) || {}).label) || 'Custom');
  const rows = [[tr('BPM'), e.bpm], [tr('Length'), formatLength(e.length)], [tr('Plays'), rec ? rec.plays : 0], [tr('Grade'), best ? `<span class="badge">${esc(best.grade)}</span>${badgeHTML(rec)}` : '-']];
  $('sd-stats').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="ln"><span class="mq">${typeof v === 'string' && v.startsWith('<') ? v : esc(String(v))}</span></dd>`).join('');
  marqueeAll($('sd-stats').querySelectorAll('.ln')); // a narrow pane runs a long value instead of cutting it off
  marquee($('sd-tag'));
  const fav = isFavorite(e.id);
  if (!$('sd-fav').firstChild) { $('sd-fav').dataset.on = String(fav); $('sd-fav').innerHTML = spriteHTML(HEART, 3); }
  $('sd-fav').classList.toggle('on', fav);
  $('sd-fav').setAttribute('aria-pressed', String(fav));
  $('sd-go').disabled = !(e.notes[e.chart] || 0);
  refreshModsButton();
  clearTimeout(paneTimer);
  paneTimer = setTimeout(() => {
    if (state !== 'select' || selectedEntry() !== e) return;
    dpEntry = e;
    if (dpTabs() && !$('dp-tabs').dataset.seen) { $('dp-tabs').dataset.seen = '1'; dpTab = 'world'; }
    renderDpPanel();
  }, 160);
}

// -- composer --
let cs = null, csUid = '', csDirty = false, csMenu = false, csLast = 0;
function compEntry() {
  return cs && cs.notes.length ? customEntry(comp.toRTTTL(cs)) : null;
}
function renderComposer() {
  const dur = cs.notes[cs.cursor - 1] ? cs.notes[cs.cursor - 1].dur : cs.pen.dur;
  $('comp-info').textContent = `${cs.name || tr('Untitled')} · ${cs.bpm} BPM · 1/${dur} · oct ${cs.pen.oct}${csDirty ? ' · *' : ''}`;
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
  st.textContent = e ? `${tn(cs.notes.length, '{n} note', '{n} notes')} · ${formatLength(e.length)}` : cs.notes.length ? tr('Needs a playable note') : tr('Press 1-7 to enter notes');
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
    st.textContent = '✗ ' + (text ? tr('Not a valid RTTTL song (needs name:d=4,o=5,b=120:notes)') : tr('Paste an RTTTL string'));
  } else {
    st.className = 'status ok';
    const w = e.song.warnings;
    st.textContent = `✓ ${e.title} · ${e.bpm} BPM · ${tn(e.notes[e.chart], '{n} note', '{n} notes')}` +
      (w.length ? ` · ⚠ ${w.slice(0, 3).map(tm).join('; ')}${w.length > 3 ? ' ' + tr('(+{n} more)', { n: w.length - 3 }) : ''}` : '');
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

// ---- mods (sticky loadout: chips in the song picker, the full list on its own screen via Customize) ----
// The picker's Modifiers row: five chips, each cycles one setting. Tapping (or cycling) one explains the mod underneath.
const MOD_CHIPS = ['speed', 'style', 'visuals', 'input', 'mode'];
const modChips = m => ({
  speed: [fmt(m.speed, 1) + 'x', tr('Speed'), m.speed !== 1],
  style: [m.mirror ? 'MR' : 'ST', tr('Style'), m.mirror],
  visuals: [m.hidden ? 'HD' : '--', tr('Visuals'), m.hidden],
  input: [{ lenient: 'EZ', off: 'NM', strict: 'ST' }[m.judge], tr('Input'), m.judge !== 'off'],
  mode: [m.demo ? 'DEMO' : m.sudden ? 'SD' : '--', tr('Mode'), m.demo || m.sudden],
});
const MOD_HINTS = {
  'm-speed': 'Plays the song faster or slower. Pitch stays the same.',
  'm-mirror': 'Flips the lanes left to right.',
  'm-hidden': 'Notes vanish just before the hit line.',
  'm-sudden': 'The first miss or stray tap ends the run.',
  'm-demo': 'Plays the song perfectly. Score ×0, nothing is saved.',
  'm-judge': 'Lenient widens the timing windows, Strict narrows them.',
};
const JUDGE_LABELS = { lenient: 'Lenient', off: 'Normal', strict: 'Strict' };
const MOD_HINT_ID = { speed: 'm-speed', style: 'm-mirror', visuals: 'm-hidden', input: 'm-judge' };
let modChip = 0; // gamepad cursor over the chips
function refreshModsButton() {
  const m = mods.normalize(settings.mods), chips = modChips(m);
  MOD_CHIPS.forEach((k, i) => {
    const b = $('sd-chips').children[i], [v, label, on] = chips[k];
    b.innerHTML = `<b>${esc(v)}</b><span>${esc(label)}</span>`;
    b.classList.toggle('on', on);
    b.classList.toggle('cur', i === modChip && lastDevice === 'pad');
  });
  $('sd-mult').textContent = mods.isActive(m) ? mods.multText(mods.multiplier(m)) : '';
}
function showModHint(which) {
  const m = mods.normalize(settings.mods);
  const id = which === 'mode' ? (m.demo ? 'm-demo' : 'm-sudden') : MOD_HINT_ID[which];
  const pre = which === 'input' ? tr(JUDGE_LABELS[m.judge]) + ': ' : which === 'mode' && !m.demo && !m.sudden ? tr('Normal') + ': ' : '';
  if (!settings.modHints) return;
  const hint = $('sd-hint');
  hint.textContent = which === 'mode' && !m.demo && !m.sudden ? tr('Normal') : pre + tr(MOD_HINTS[id]);
  // A bubble over the board that fades out by itself: nothing on the screen moves.
  hint.classList.remove('show');
  void hint.offsetWidth; // restart the fade
  hint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(hideModHint, 4600);
}
let hintTimer = 0;
function hideModHint() { clearTimeout(hintTimer); $('sd-hint').classList.remove('show'); }
function cycleMod(which) {
  const m = mods.normalize(settings.mods);
  modChip = Math.max(0, MOD_CHIPS.indexOf(which));
  if (which === 'speed') setMod({ speed: mods.SPEEDS[(mods.SPEEDS.indexOf(m.speed) + 1) % mods.SPEEDS.length] });
  else if (which === 'style') setMod({ mirror: !m.mirror });
  else if (which === 'visuals') setMod({ hidden: !m.hidden });
  else if (which === 'input') setMod({ judge: mods.JUDGES[(mods.JUDGES.indexOf(m.judge) + 1) % mods.JUDGES.length] });
  else setMod(m.demo ? { demo: false } : m.sudden ? { sudden: false, demo: true } : { sudden: true });
  const n = mods.normalize(settings.mods), d = mods.normalize({});
  const off = which === 'speed' ? n.speed === d.speed : which === 'style' ? !n.mirror : which === 'visuals' ? !n.hidden : which === 'input' ? n.judge === d.judge : !n.demo && !n.sudden;
  if (off) hideModHint(); else showModHint(which); // switching a modifier off takes its bubble away at once
}
// Settings › Developer › Glyphs & icons: every font glyph and sprite, built once on first open.
let glyphsBuilt = false, glyphsLast = 0; // the focused cell is kept for the session
function buildGlyphs() {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const cell = (info, art, w = 0, extra = '') => `<button type="button" class="gl-cell"${w > 52 ? ` style="grid-column:span ${Math.ceil((w + 8) / 68)}"` : ''}${extra} data-info="${esc(info)}" aria-label="${esc(info)}">${art}</button>`;
  const TALL = ['phone', 'avatar', 'nokia'];
  const sprites = (obj, tag, tall = false) => Object.entries(obj).filter(([k]) => TALL.includes(k) === tall).map(([k, r]) => cell(`${tag} ${k} ${r[0].length}×${r.length}`, spriteHTML(r, 2), r[0].length * 2));
  const glyphs = Object.entries(GLYPHS).map(([ch, g]) => {
    const cp = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    const text = `<span class="gl-ch" style="font-family:'${FAMILY}'">${esc(ch)}<b>${esc(ch)}</b></span>`;
    return cell(`${ch} ${cp} ${g.w}×${g.rows.length}`, text + spriteHTML(g.rows, 3), g.w * 3);
  });
  // Pop-ups: focusing one replays its animation (heart pops, broken heart shakes), as the favorite effect does.
  const pops = Object.entries(POPUPS).map(([k, r]) => cell(`popup ${k} ${r[0].length}×${r.length}`, `<span class="gl-pop">${spriteHTML(r, 3)}</span>`, r[0].length * 3, ` data-pop="${k === 'heart' ? 'add' : 'break'}"`));
  const menu = MENU_IDS.map(id => cell(`menu ${id} ${ICON_W}×${ICON_H}`, spriteHTML(menuFrame(id, 0), 2), ICON_W * 2, `data-menu="${id}"`));
  // the Messages icon has a second look while mail waits: the sealed envelope with sparkles
  menu.push(cell(`menu messages (unread) ${ICON_W}×${ICON_H}`, spriteHTML(menuFrame('messages', 0, { unread: true }), 2), ICON_W * 2, 'data-menu="messages" data-unread="1"'));
  const sect = (title, cells) => `<div class="sub">${esc(title)}</div><div class="gl-grid" data-rows>${cells.join('')}</div>`;
  $('gl-body').innerHTML = `<div class="gl-grid" data-rows>${glyphs.join('')}</div>` + sect(tr('Icons'), sprites(SPRITES, 'icon')) + sect(tr('Category icons'), sprites(ICONS, 'category')) + sect(tr('Favorite icons'), sprites(ICONS_FAV, 'favorite')) + sect(tr('Large icons'), sprites(SPRITES, 'icon', true)) + sect(tr('Pop-ups'), pops) + sect(tr('Menu icons'), menu);
  glyphsBuilt = true;
}
// A focused menu icon plays its menu animation (held still for reduced motion); it rests on frame 0 otherwise.
let glyphAnim = null;
const popPlay = playHeart; // the Glyphs viewer shows the same animations as the heart button
function glyphAnimate(cell) {
  if (glyphAnim) { clearInterval(glyphAnim.timer); setSprite(glyphAnim.el, menuFrame(glyphAnim.id, 0, glyphAnim.opts), 2); glyphAnim = null; }
  if (cell && cell.dataset.pop && !still.matches) {
    popPlay(cell.querySelector('.gl-pop'), cell.dataset.pop);
    return;
  }
  const id = cell && cell.dataset.menu;
  if (!id || still.matches) return;
  const el = cell.querySelector('.spr');
  let n = 0;
  const opts = { unread: !!cell.dataset.unread };
  glyphAnim = { id, el, opts, timer: setInterval(() => setSprite(el, menuFrame(id, ++n, opts), 2), MENU_FRAME_MS) };
  setSprite(el, menuFrame(id, 0, opts), 2);
}
function openGlyphs() {
  if (!glyphsBuilt) buildGlyphs();
  $('gl-hint').textContent = '';
  const cells = $('gl-body').querySelectorAll('.gl-cell');
  cells.forEach((c, i) => { c.toggleAttribute('data-default', i === glyphsLast); });
  setState('glyphs', 'glyphs');
}
function setMod(patch) {
  settings.mods = mods.normalize({ ...settings.mods, ...patch });
  save();
  refreshModsButton();
}

// ---- play / pause / results ----
let run = null; // { entry, diff, ret, retLabel, tutorial, modsUsed }

function laneLabels(lanes) {
  if (lastDevice === 'pad') {
    return Array.from({ length: lanes }, (_, i) => {
      return buttonName(settings.padBindings[i][0]);
    });
  }
  return KEY_LABELS[lanes];
}

function startRun(r) {
  if (r.entry) r.diff = r.entry.chart; // a song plays one chart
  run = r;
  if (!r.tutorial && r.entry) {
    if (r.entry.id !== unplayedKeep) unplayedKeep = settings.view.category === 'unplayed' && !scores.get(r.entry.id, r.diff) ? r.entry.id : null; settings.recent = [r.entry.id, ...settings.recent.filter(x => x !== r.entry.id)].slice(0, RECENT_MAX); save(); }
  runTime = 0; lastSongT = null;
  for (const id of ['btn-quit', 'btn-menu']) $(id).textContent = tr(r.retLabel || 'Tones');
  stopPreview();
  let chart;
  try {
    if (r.tutorial) {
      chart = buildStageChart(STAGES[r.tutorial.stage]);
    } else {
      chart = perf.time('chartgen', () => generateChart(r.entry.song, { difficulty: r.diff }));
    }
    // Mods apply to normal runs only (not the tutorial). Snapshot them so results match what was played.
    r.modsUsed = !r.tutorial && mods.isActive(settings.mods) ? mods.normalize(settings.mods) : null;
    if (r.modsUsed) chart = mods.applyChart(chart, r.modsUsed);
    if (r.modsUsed && r.modsUsed.demo) r.autoplay = createAutoplay(chart);
  } catch (e) {
    toast('✗ ' + e.message, 3500);
    return false;
  }
  synth.ensure();
  synth.setVolume(settings.volume);
  renderer.title = r.tutorial ? tr(STAGES[r.tutorial.stage].title) : r.entry.title;
  renderer.scrollTime = settings.scrollTime;
  renderer.hidden = !!(r.modsUsed && r.modsUsed.hidden);
  renderer.modLabel = r.modsUsed ? mods.tags(r.modsUsed).join(' ') : '';
  renderer.setLanes(chart.lanes, laneLabels(chart.lanes));
  renderer.resetState();
  screens.nowplaying.dataset.title = renderer.title;
  setSprite($('st-signal'), signal(5), 2); // the bars stay full while playing
  input.setLanes(chart.lanes);
  padHeld.forEach(s => s.clear());
  game.start(chart, { leadIn: r.tutorial ? 1.5 : 2, backing: settings.backing, rollAudio: settings.rollAudio, calibration: settings.calibration,
    ...(r.modsUsed && mods.gameOptions(r.modsUsed)) });
  setState('countin', null);
  return true;
}
function restartRun() { abortRun('restart'); resumeEnd = 0; setResumeCount(0); if (run) startRun(run); }

// Wide LCD: the details are already beside the list, so Select plays. Narrow: the first Select opens them.
function playSelected() {
  const e = selectedEntry();
  if (!e) return;
  if (!selWide() && !selDetail) { setSelDetail(true); return; }
  save();
  startRun({ entry: e });
}

function leaveToSelect() {
  abortRun('quit');
  resumeEnd = 0;
  setResumeCount(0);
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
  setResumeCount(0);
  game.pause();
  commitTime(); // bank the time so far (the tab may be closed while paused)
  input.reset();
  padHeld.forEach(s => s.clear());
  state = 'paused';
  input.enabled = false;
  const tut = !!(run && run.tutorial);
  $('btn-quit').hidden = tut;
  $('btn-tut-back-pause').hidden = !tut;
  show('paused');
}
// Resume shows a 3-2-1 countdown first. The audio context stays suspended meanwhile, so song time is frozen.
let resumeEnd = 0;
let resumeShown = 0;
function setResumeCount(n) {
  if (n === resumeShown) return;
  resumeShown = n;
  $('np-count').hidden = n <= 0;
  if (n > 0) $('np-count-n').textContent = String(n);
}
function resumeGame() {
  if (state !== 'paused') return;
  resumeEnd = performance.now() + 3000;
  setResumeCount(3);
  setState('resuming', null);
}
async function finishResume() {
  resumeEnd = 0;
  setResumeCount(0);
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
    el.title = tn(n, '{n} hit', '{n} hits');
    box.appendChild(el);
  });
  if (deltas.length >= 10) {
    const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    const ms = Math.round(mean * 1000);
    $('r-offset').textContent = Math.abs(ms) < 8
      ? tr('Timing is centered.')
      : tr(ms > 0 ? 'Average hit: {ms} ms late' : 'Average hit: {ms} ms early', { ms: Math.abs(ms) }) +
        (Math.abs(ms) >= 20 ? tr(' — try Settings → Calibrate') : '');
  } else {
    $('r-offset').textContent = '';
  }
}

// Results flourish: the score ticks up in stepped increments, then the grade stamps in with a stinger.
var countTimer = 0; // var: show() can run before this line at boot
function juiceResultsStop() { clearInterval(countTimer); $('r-grade').style.visibility = ''; }
function juiceResults(r) {
  const scoreEl = $('r-score'), gradeEl = $('r-grade');
  clearInterval(countTimer);
  gradeEl.classList.remove('stamp');
  scoreEl.textContent = r.score;
  const still = !settings.juice || matchMedia('(prefers-reduced-motion: reduce)').matches || r.score < 1;
  if (still) return;
  const STEPS = 14, final = r.score;
  let i = 0;
  scoreEl.textContent = 0;
  gradeEl.style.visibility = 'hidden';
  countTimer = setInterval(() => {
    i++;
    if (i >= STEPS) {
      clearInterval(countTimer);
      scoreEl.textContent = final;
      gradeEl.style.visibility = '';
      void gradeEl.offsetWidth; gradeEl.classList.add('stamp');
      synth.stinger(r.grade);
      return;
    }
    scoreEl.textContent = Math.round(final * i / STEPS);
    synth.tickUp(i);
  }, 45);
}

game.onFinish = r => {
  input.reset();
  padHeld.forEach(s => s.clear());
  if (run && run.tutorial) { tutorialStageDone(); return; }
  // Mods fold their multiplier into the stored score; grade/accuracy stay raw.
  const used = run && run.modsUsed;
  if (used) {
    r.mult = mods.multiplier(used);
    r.score = Math.round(r.score * r.mult);
    r.mods = mods.tags(used);
  }
  commitTime();
  const demo = isDemo();
  if (run && run.entry && !demo) { stats.recordRun({ diff: run.diff, result: r, custom: run.entry.category === 'custom', modded: !!used }); cloud.schedule(); }
  screens.results.dataset.title = r.failed ? 'Failed' : 'Results';
  $('r-heading').textContent = tr(screens.results.dataset.title);
  $('r-song').textContent = run ? [run.entry.title, `${run.entry.bpm} BPM`, formatLength(run.entry.length)].join(' · ') + (used ? ` · ${r.mods.join(' ')} ${mods.multText(r.mult)}` : '') : '';
  juiceResults(r);
  $('r-grade').textContent = r.grade;
  $('r-grade').dataset.grade = r.grade;
  $('r-acc').textContent = fmt(r.accuracy, 1) + '%';
  $('r-combo').textContent = r.maxCombo;
  $('r-p').textContent = r.counts.perfect;
  $('r-g').textContent = r.counts.great;
  $('r-o').textContent = r.counts.good;
  $('r-m').textContent = r.counts.miss;
  $('r-ghost').textContent = r.ghosts ?? 0;
  const banner = $('r-banner');
  banner.hidden = !r.fc || demo;
  banner.className = 'banner' + (r.ap ? ' ap' : '');
  banner.textContent = r.ap ? tr('ALL PERFECT') : r.fc ? tr('FULL COMBO') : '';
  if (r.fc && !demo) { void banner.offsetWidth; banner.classList.add('celebrate'); } // restart the pop on every results screen
  const best = $('r-best');
  best.hidden = true;
  $('r-world').hidden = true;
  worldToken++;
  topRuns = { runs: [], rank: null };
  resultsSong = null;
  resultsBoard = boardTabs() ? 'world' : 'local'; // signed in: the world board first, the toggle switches to the local one
  resultsTimeline = r.timeline || null;
  if (demo) {
    // demo runs are never saved and show no best/rank line, but the board shows what the player has seen of this song
    if (run && run.entry) resultsSong = { id: run.entry.id, diff: run.diff };
  } else if (r.failed) {
    best.hidden = false; best.textContent = tr('Sudden death: run not saved'); best.style.color = 'var(--dim)';
  } else if (run) {
    r.date = Date.now();
    const rec = scores.record(run.entry.id, run.diff, r);
    // Only a new best goes up: a lower run can't change the player's place on any board.
    const runId = rec.isNewBest ? cloud.queueRun(run.entry.id, run.diff, r, r.mods || [], {
      replay: game.log ? encodeLog(game.log) : undefined, rules: RULES, loadout: run.modsUsed, // no log: ?demo=results
      rtttl: run.entry.id.startsWith('custom:') ? run.entry.rtttl : undefined,
    }) : null;
    resultsSong = { id: run.entry.id, diff: run.diff };
    showWorldRank(run.entry.id, run.diff, runId, rec.isNewBest, r.score);
    best.style.color = '';
    if (rec.isNewBest) { best.hidden = false; best.textContent = tr('★ NEW BEST ★'); }
    else if (rec.rank) { best.hidden = false; best.textContent = tr('Rank #{n}', { n: rec.rank }); }
    topRuns = { runs: scores.get(run.entry.id, run.diff)?.top || [], rank: rec.rank };
  }
  renderBoard();
  renderHistogram(r.deltas);
  setResultsPage(0);
  setState('results', 'results');
  marquee($('r-song'));
  fitRows($('r-boardbox'));
  drawResultsChart(); // after the screen is shown: the boxes are measured
};

// The results screen's world line. A new best goes up right away and its rank comes back with the same request; any
// other run can't move the player's rank, so the rank last seen shows without a request. The API re-plays each run and
// ranks its own score (docs/CLOUD.md › Leaderboards).
let worldToken = 0;
let worldRefresh = null; // repaints the "World #n of m" line when a newer snapshot lands (set for runs that are not a new best)
// The World page: the top ten (from the answer that ranked the run, else the leaderboard snapshot), then the players around the player's rank (they came
// back with the sync that ranked the run). Nothing here makes a request of its own.
function paintWorld(songId, diff, token = worldToken) {
  if (resultsBoard !== 'world') return;
  const ol = $('r-top'), msg = $('r-top-empty');
  ol.textContent = '';
  const say = text => { msg.hidden = !text; msg.textContent = text || ''; };
  if (!songId || !cloud.available()) return say(tr('Run not saved'));
  if (!cloud.signedIn()) return say(tr('Sign in for world ranks'));
  const add = (r, cls) => {
    const li = document.createElement('li');
    li.className = 'brow' + (cls ? ' ' + cls : r.me ? ' cur' : '');
    li.innerHTML = r.gap ? '<span class="rk">…</span>' : boardRow(r, r.rank, nameHTML(r));
    ol.appendChild(li);
  };
  const near = cloud.rankNear(songId, diff) || [];
  const paint = top => {
    if (token !== worldToken || resultsBoard !== 'world') return;
    ol.textContent = '';
    for (const r of worldLines(top, near)) add(r, r.gap ? 'gap' : '');
    say(ol.children.length ? '' : tr('No world ranks yet.'));
    marqueeAll(ol.querySelectorAll('.ln'));
    fitRows($('r-boardbox')); // the rows arrive after the screen was laid out: re-check whether they need to scroll
    if (worldRefresh) worldRefresh();
  };
  if (near.length) paint([]); else say(tr('Loading…'));
  const fresh = cloud.rankTop(songId, diff);
  if (fresh) paint(fresh);
  else cloud.board(songId, diff, b => paint((b && b.runs) || [])).then(b => paint((b && b.runs) || []));
}
async function showWorldRank(songId, diff, runId, isNewBest, score) {
  const el = $('r-world'), token = worldToken;
  if (!cloud.available()) return;
  el.hidden = false;
  paintWorld(songId, diff, token);
  if (!cloud.signedIn()) { el.textContent = tr('Sign in for world ranks'); return; }
  const known = () => {
    const k = cloud.rank(songId, diff);
    return k && tr('World #{n} of {total}', { n: k.rank, total: k.total });
  };
  if (!runId || !isNewBest) {
    // Not a new best: the rank last seen, corrected when the snapshot (a newer view of the board) lands.
    worldRefresh = () => {
      if (token !== worldToken) return;
      const text = known();
      el.hidden = !text;
      if (text) el.textContent = text;
    };
    worldRefresh();
    return;
  }
  worldRefresh = null;
  // The snapshot already says where this score lands: show that (dimmed) while the server's answer is on its way.
  const guess = cloud.guessRank(songId, diff, score);
  el.textContent = guess ? tr('World #{n} of {total}', { n: guess.rank, total: guess.total }) : tr('World rank…');
  el.style.opacity = guess ? '.6' : '';
  const verdict = (await cloud.submit())[runId];
  if (token !== worldToken) return;
  paintWorld(songId, diff, token);
  el.style.opacity = '';
  el.textContent = !verdict ? tr('World rank: no connection')
    : cloud.serverRules() !== RULES ? tr('Not ranked: update the game')
    : verdict.verified === -1 ? tr('Not ranked')
    : (verdict.verified === 1 && known()) || tr('World rank pending');
}

let resultsPage = 0, topRuns = { runs: [], rank: null };
let resultsBoard = 'local', resultsSong = null, resultsTimeline = null;
// Signed-in players can switch the one leaderboard between Global and Local.
const boardTabs = () => cloud.available() && cloud.signedIn();
function renderBoard() {
  const tabs = boardTabs();
  if (!tabs) resultsBoard = 'local';
  $('r-board-tabs').hidden = !tabs;
  for (const b of $('r-board-tabs').querySelectorAll('button')) { const on = b.dataset.board === resultsBoard; b.classList.toggle('sel', on); b.setAttribute('aria-selected', on); }
  if (resultsBoard === 'world') paintWorld(resultsSong && resultsSong.id, resultsSong && resultsSong.diff);
  else renderTopRuns();
  marqueeAll($('r-top').querySelectorAll('.ln'));
  fitRows($('r-boardbox'));
}
function setResultsBoard(b) { resultsBoard = b; renderBoard(); }
function drawResultsChart() {
  const cv = $('r-chart');
  if (!resultsTimeline || !cv.parentElement.clientWidth) return;
  drawScoreChart(cv, scoreSeries(resultsTimeline, Math.max(16, Math.min(80, Math.floor(cv.parentElement.clientWidth / unit / 5)))), unit);
}
function renderTopRuns() {
  const ol = $('r-top');
  $('r-top-empty').textContent = tr('Run not saved');
  ol.textContent = '';
  for (const [i, r] of topRuns.runs.entries()) {
    const li = document.createElement('li');
    li.className = 'brow' + (topRuns.rank === i + 1 ? ' cur' : '');
    li.innerHTML = boardRow(r, i + 1);
    ol.appendChild(li);
  }
  $('r-top-empty').hidden = topRuns.runs.length > 0;
}
// The World page needs an account; signed out, it isn't offered.
const resultsPages = () => document.querySelectorAll('#r-tabs button').length;
// Wide LCD: every page is a panel of one screen (the World list only when signed in), so there is nothing to page through.
const resultsAll = () => lcdWidth() >= SEL_WIDE_PX;
function setResultsPage(n) {
  resultsPage = Math.max(0, Math.min(resultsPages() - 1, n));
  const all = resultsAll();
  for (const el of document.querySelectorAll('#results .r-page')) el.hidden = all ? false : +el.dataset.page !== resultsPage;
  for (const el of document.querySelectorAll('#r-tabs button')) { const on = +el.dataset.page === resultsPage; el.classList.toggle('sel', on); el.setAttribute('aria-selected', on); }
  marqueeAll($('results').querySelectorAll('.r-page:not([hidden]) .ln'));
  fitRows($('r-boardbox'));
  drawResultsChart();
}

function stepResultsPage(step) {
  if (resultsAll()) return;
  const n = resultsPages();
  setResultsPage((resultsPage + step + n) % n);
  synth.keyClick();
}

// ---- tutorial ----
// Input hint for the device in use only; refreshed in place when the device changes.
function controlsHint() {
  if (lastDevice === 'pad') return tr('Pad: {pad}', { pad: [0, 1, 2, 3].map(i => `<b>${buttonName(settings.padBindings[i][0])}</b>`).join(' ') });
  if (lastDevice === 'touch') return tr('Touch: tap the lanes');
  return tr('Keys: {keys}', { keys: KEY_LABELS[4].map(k => `<b>${k}</b>`).join(' ') });
}
const controlsHTML = () => `<p id="tut-controls">${controlsHint()}</p>`;
function refreshTutorialCard() {
  const el = $('tut-controls');
  if (state === 'tutorial' && el && run && run.tutorial && !run.tutorial.done) el.innerHTML = controlsHint();
}
// One fixed-size box per lesson (not glyphs, whose widths differ), so the row never shifts between cards.
function tutProgress(done, current) {
  const n = STAGES.length;
  const el = $('tut-progress');
  el.hidden = false;
  el.innerHTML = STAGES.map((_, i) => `<i${i < done ? ' class="done"' : i === current ? ' class="cur"' : ''}></i>`).join('');
  el.setAttribute('aria-label', tr('Lesson {i} of {n}', { i: current >= 0 ? current + 1 : done, n }));
}
let tutDone = 0; // lessons played so far (seeded from the saved count when the tutorial starts)
// First time opening Tones: offer the tutorial (it stays reachable from Settings).
function openTutPrompt() { setState('tutprompt', 'tutprompt'); }
function skipTutPrompt() { settings.tutorialDone = true; save(); askLogin(openSelect); }
// Once per device, after the tutorial (played or skipped): offer the online features to a player who isn't signed in.
let afterLogin = openSelect;
function askLogin(then) {
  if (settings.loginAsked || !cloud.available() || cloud.signedIn()) { then(); return; }
  settings.loginAsked = true; save(); // before the page can leave for the sign-in
  afterLogin = then;
  setState('loginprompt', 'loginprompt');
}
function loginPromptYes() { location.href = cloud.signInUrl(location.origin + location.pathname + location.search); }
// Lesson card: diagram + text, waits for the player to confirm before the round starts.
function openLesson(i) {
  const st = STAGES[i];
  $('tut-title').textContent = tr(st.title);
  $('tut-body').innerHTML = stageDemoHTML(st) + tr(st.text).split('\n').map(p => `<p>${esc(p)}</p>`).join('') +
    (i === 0 ? controlsHTML() : '');
  $('btn-tut-go').textContent = tr('Start lesson');
  $('btn-tut-skip').textContent = tr('Skip tutorial');
  $('btn-tut-skip').hidden = i === 0 && !settings.tutorialDone; // the first-visit prompt already offered "No thanks"
  tutProgress(i, i);
  run = { tutorial: { stage: i, pending: true } };
  setState('tutorial', 'tutorial');
}
function tutorialOutro() {
  game.stop();
  $('tut-title').textContent = tr("You're ready!");
  $('tut-body').innerHTML =
    `<p>${tr('Chain hits to build a combo: every 10 raises your multiplier, up to x1.5 at 50. A miss resets it.')}</p>` +
    `<p>${tr('Hit every note for a <b>Full Combo</b>.')}</p>`;
  $('btn-tut-go').textContent = tr('Pick a song');
  $('btn-tut-skip').textContent = tr('Calibrate');
  $('btn-tut-skip').hidden = false;
  tutProgress(STAGES.length, -1);
  run = { tutorial: { done: true } };
  setState('tutorial', 'tutorial');
}
// Every finished round counts: the next lesson follows (no pass/fail).
function tutorialStageDone() {
  const i = run.tutorial.stage;
  game.stop();
  tutDone = Math.max(tutDone, i + 1);
  if (tutDone > settings.tutorialLessons) { settings.tutorialLessons = tutDone; save(); }
  tutorialNext(i);
}
function tutorialNext(i) { if (i + 1 < STAGES.length) openLesson(i + 1); else tutorialOutro(); }
function tutorialPrev() {
  const t = run && run.tutorial;
  if (t && t.done) openLesson(STAGES.length - 1); else if (t && t.stage > 0) openLesson(t.stage - 1);
}
// Left/right and swipes: back any time, forward only over lessons already played.
function tutorialStep(dir) {
  const t = run && run.tutorial;
  if (!t || game.active) return;
  if (dir < 0) tutorialPrev(); else if (!t.done && t.stage < tutDone) tutorialNext(t.stage);
}
function startTutorial() { tutDone = Math.min(settings.tutorialLessons, STAGES.length); openLesson(0); }
function finishTutorial(then = openSelect) {
  game.stop();
  input.reset();
  run = null;
  $('tut-progress').hidden = true;
  settings.tutorialDone = true; save();
  askLogin(then);
}
// The outro reuses the Skip button as "Calibrate".
function tutorialSkip() {
  if (run && run.tutorial && run.tutorial.done) finishTutorial(startCalibration); else finishTutorial();
}
function tutorialGo() {
  const t = run && run.tutorial;
  if (t && t.done) finishTutorial();
  else if (t && t.stage >= 0) startRun({ entry: null, diff: 'normal', tutorial: { stage: t.stage } });
}

// ---- calibration screen ----
function showOffset() {
  const t = Math.round(settings.calibration * 1000) + ' ms';
  $('calib-offset').textContent = t; $('menu-offset').textContent = t;
}
function startCalibration() {
  stopPreview();
  setState('calibration', 'calibration');
  $('calib-msg').textContent = tr('Tap (any key, button or the pad) in time with the ticks.');
  $('calib-count').textContent = tn(0, '{n} tap', '{n} taps');
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
  $('calib-count').textContent = tn(calibration.taps.length, '{n} tap', '{n} taps');
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
    b.textContent = capturingSlot === s ? tr('{slot}: press a button…', { slot: tr(SLOT_NAMES[s]) }) : `${tr(SLOT_NAMES[s])}: ${names}`;
    b.classList.toggle('capture', capturingSlot === s);
    b.onclick = () => { capturingSlot = s; renderBindings(); };
    g.appendChild(b);
  }
  updatePadStatus();
}
function updatePadStatus() {
  const first = pad.list()[0];
  $('pad-status').textContent = first ? tr('Connected: {id}', { id: first.id }) : '';
}
function bindButton(index) {
  const s = capturingSlot;
  capturingSlot = -1;
  for (let o = 0; o < 4; o++) {
    if (o !== s) settings.padBindings[o] = settings.padBindings[o].filter(x => x !== index);
    if (!settings.padBindings[o].length) {
      const used = new Set(Object.values(settings.padBindings).flat());
      const free = DEFAULT_BINDINGS[o].concat([BTN.A, BTN.B, BTN.X, BTN.Y]).find(x => x !== index && !used.has(x));
      settings.padBindings[o] = [free];
    }
  }
  settings.padBindings[s] = [index];
  save(); renderBindings();
}
let settingsFrom = 'menu';
let settingsTab = 'sound';
const ALL_SETTINGS_TABS = ['sound', 'gameplay', 'effects', 'general', 'developer', 'controller'];
// Button mapping is only offered while a controller is connected.
const settingsTabs = () => ALL_SETTINGS_TABS.filter(t => t !== 'controller' || pad.connected);
let shownTabs = '';
// The Vibration option lives where it applies: with Effects on a phone (navigator.vibrate), else with the Controller
// settings when a rumble-capable controller is connected, else nowhere.
function placeHaptics() {
  const row = $('pref-haptics').closest('label');
  // desktop Chromium has navigator.vibrate too (a no-op), so a touch screen is what marks a phone
  const home = navigator.vibrate && navigator.maxTouchPoints > 0 ? document.querySelector('[data-panel=effects]') : pad.canRumble ? $('pad-extras') : null;
  row.hidden = !home;
  if (home && row.parentNode !== home) home.appendChild(row);
}
// Wide LCD: every tab is a panel of one screen (no tab strip); narrower: one tab at a time between ◄ ►.
const settingsAll = () => lcdWidth() >= SEL_WIDE_PX;
function setSettingsTab(id, focus = false) {
  const tabs = settingsTabs();
  if (!tabs.includes(id)) id = tabs[0];
  shownTabs = tabs.join() + pad.canRumble;
  placeHaptics();
  settingsTab = id;
  capturingSlot = -1;
  for (const b of document.querySelectorAll('#set-tabs button')) {
    const on = b.dataset.tab === id;
    b.classList.toggle('sel', on); b.setAttribute('aria-selected', on);
  }
  const all = settingsAll();
  $('set-tabs').hidden = all;
  for (const p of document.querySelectorAll('#settings .set-panel')) p.hidden = all ? !tabs.includes(p.dataset.panel) : p.dataset.panel !== id;
  paintRanges(screens.settings);
  if (focus && !all) $('set-tabs').querySelector('.sel').focus();
}
function stepSettingsTab(step) {
  if (settingsAll()) return; // every tab is on screen
  const tabs = settingsTabs(), i = (tabs.indexOf(settingsTab) + step + tabs.length) % tabs.length;
  synth.keyClick();
  setSettingsTab(tabs[i], true);
}
// A controller was plugged in or removed while Settings is open.
function syncSettingsTabs() {
  if (state === 'settings' && settingsTabs().join() + pad.canRumble !== shownTabs) setSettingsTab(settingsTab);
}
function openSettings(from = 'menu') {
  settingsFrom = from;
  document.querySelectorAll('#settings .menu-only').forEach(el => { el.hidden = from === 'paused'; });
  capturingSlot = -1;
  renderBindings();
  showOffset();
  setState('settings', 'settings');
  setSettingsTab(settingsTab);
}

function closeSettings() {
  capturingSlot = -1;
  if (settingsFrom === 'paused') setState('paused', 'paused'); else openMenu('settings');
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
  refreshTutorialCard();
}
function usePad() { setDevice('pad'); }
function useMouse() { setDevice('kbd'); }

function selectHints() {
  const pad = lastDevice === 'pad';
  const bn = buttonName;
  $('sel-arrow-l').textContent = pad ? bn(BTN.LB) : '◄';
  $('sel-arrow-r').textContent = pad ? bn(BTN.RB) : '►';
  // Every key is listed in the panel beside the phone (shown when the screen is wide enough).
  const rows = pad
    ? [[[bn(BTN.LB), bn(BTN.RB)], tr('Category')], [[bn(BTN.LT)], tr('Sort')], [[bn(BTN.Y)], tr('All categories')],
      [[bn(BTN.RT), bn(BTN.BACK)], tr('Group')], [[bn(BTN.X), bn(BTN.R3)], tr('Modifiers')], [[bn(BTN.L3)], tr('Random')]]
    : [[['◄', '►'], tr('Category')], [['D', 'F'], tr('Sort')], [['J', 'K'], tr('Group')], [['V'], tr('Favorite')],
      [['1-5'], tr('Modifiers')], [['T'], tr('Board')], [['R'], tr('Random')], [['G'], tr('All categories')], [['PgUp', 'PgDn'], tr('Page')], [['/'], tr('Find')]];
  const side = $('sel-keys');
  side.replaceChildren();
  const head = document.createElement('b');
  head.textContent = tr('Song list');
  side.append(head);
  for (const [keys, label] of rows) {
    const div = document.createElement('div');
    for (const k of keys) { const kbd = document.createElement('kbd'); kbd.textContent = k; div.append(kbd); }
    div.append(' ' + label);
    side.append(div);
  }
}

pad.onConnect = id => { toast(tr('Controller connected: {id}', { id: id.replace(/\(.*\)/, '').trim().slice(0, 40) })); syncSettingsTabs(); };
pad.onDisconnect = () => {
  toast('Controller disconnected');
  syncSettingsTabs();
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
  eggToken({ [BTN.UP]: 'ArrowUp', [BTN.DOWN]: 'ArrowDown', [BTN.LEFT]: 'ArrowLeft', [BTN.RIGHT]: 'ArrowRight', [BTN.B]: 'KeyB', [BTN.A]: 'KeyA' }[index] || '');
  if (capturingSlot >= 0 && state === 'settings') { bindButton(index); return; }
  if (state === 'calibration') {
    if (index === BTN.B || index === BTN.START) leaveCalibration();
    else calibTap({ timeStamp: ts });
    return;
  }
  menuButton(index);
};

function pressPad(index, ts) {
  if (isDemo()) return;
  const time = eventAudioTime(synth.ctx, { timeStamp: ts });
  for (const slot of slotsFor(index)) {
    const lane = slot;
    const set = padHeld[lane];
    const was = set.size;
    set.add(index);
    if (!was) game.press(lane, time);
  }
}
function releasePad(index, ts) {
  if (isDemo()) return;
  const time = eventAudioTime(synth.ctx, { timeStamp: ts });
  padHeld.forEach((set, lane) => {
    if (set.delete(index) && set.size === 0) game.release(lane, time);
  });
}

function back() {
  switch (state) {
    case 'title': break;
    case 'welcome': skipWelcome(); break;
    case 'menu': setState('title', 'title'); break;
    case 'select': if (selDetail) { setSelDetail(false); break; } stopPreview(); openMenu('tones'); break;
    case 'hub': leaveHub(); break;
    case 'stats': case 'inbox': case 'profile': openMenu(); break;
    case 'admin': adminBack(); break;
    case 'message': openInbox(MESSAGES[msgIdx].version); break;
    case 'tutorial': finishTutorial(); break;
    case 'tutprompt': skipTutPrompt(); break;
    case 'loginprompt': afterLogin(); break;
    case 'settings': closeSettings(); break;
    case 'glyphs': openSettings(settingsFrom); break;
    case 'mysongs': openMenu('mysongs'); break;
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
  if (state === 'welcome') { skipWelcome(); return; }
  const root = activeScreen();
  switch (index) {
    case BTN.A: case BTN.START:
      if (state === 'title') { startFromTitle(); return; }
      if (state === 'composer' && !csMenu) { if (index === BTN.A) compInput('add'); else setCompMenu(true); return; }
      confirmScreen(root);
      break;
    case BTN.B: back(); break;
    case BTN.X:
      if (state === 'composer' && !csMenu) { const e = compEntry(); if (e) togglePreview(e); }
      else if (state === 'select') cycleMod(MOD_CHIPS[modChip]);
      break;
    case BTN.LB: if (state === 'composer' && !csMenu) compInput('8'); else if (state === 'select') cycleCategory(-1); else if (state === 'results' || state === 'stats' || state === 'message') navigate('left'); break;
    case BTN.RB: if (state === 'composer' && !csMenu) compInput('9'); else if (state === 'select') cycleCategory(1); else if (state === 'results' || state === 'stats' || state === 'message') navigate('right'); break;
    case BTN.Y: if (state === 'composer' && !csMenu) compInput('rest'); else if (state === 'select') openHub(); break;
    case BTN.LT: if (state === 'select') setView('sort', SORTS); break;
    case BTN.RT: if (state === 'select') jumpSectionStep(1); break;
    case BTN.BACK: if (state === 'select') jumpSectionStep(-1); break;
    case BTN.L3: if (state === 'select') randomSong(); break;
    case BTN.R3: if (state === 'select') { modChip = (modChip + 1) % MOD_CHIPS.length; refreshModsButton(); showModHint(MOD_CHIPS[modChip]); } break;
  }
}
let padStreak = 0, padStreakAt = 0;
pad.onNav = dir => {
  usePad();
  if (capturingSlot >= 0) return;
  // Holding up/down in the song list speeds up: after a few repeats it moves several rows per tick.
  const now = performance.now();
  padStreak = dir === padStreakDir && now - padStreakAt < 300 ? padStreak + 1 : 0;
  padStreakDir = dir; padStreakAt = now;
  if (state === 'select' && (dir === 'up' || dir === 'down') && padStreak >= 6) {
    jumpTo(visible().findIndex(e => e.id === selectedId) + (dir === 'down' ? 3 : -3));
    return;
  }
  navigate(dir);
};
let padStreakDir = '';
// Shared by arrow keys, d-pad and the phone keypad (2/4/6/8).
function navigate(dir) {
  const root = activeScreen();
  if (!root || state === 'title' || state === 'welcome') return;
  if (state === 'composer' && !csMenu) { compInput(dir); return; }
  if (state === 'menu') { menuStep(dir === 'up' || dir === 'left' ? -1 : 1); return; }
  if (state === 'stats' && statsAll()) return; // everything is on screen
  if (state === 'stats' && (dir === 'left' || dir === 'right')) { setStatPage(statPage + (dir === 'left' ? -1 : 1)); return; }
  if (state === 'stats' && (dir === 'up' || dir === 'down')) { scrollStats(dir); return; }
  if (state === 'results' && (dir === 'up' || dir === 'down') && scrollResults(dir)) return;
  if (state === 'message') { if (dir === 'up' || dir === 'down') scrollMessage(dir); else stepMessage(dir === 'right' ? 1 : -1); return; }
  if (state === 'tutorial' && (dir === 'left' || dir === 'right')) { tutorialStep(dir === 'left' ? -1 : 1); return; }
  if (state === 'select' && selDetail) { // the narrow details view: up / down step to the next / previous song, left / right switch the board
    if (dir === 'up' || dir === 'down') stepSong(dir === 'down' ? 1 : -1);
    if ((dir === 'left' || dir === 'right') && dpTabs()) { const tab = dir === 'left' ? 'world' : 'local'; if (tab !== dpTab) { synth.keyClick(); setDpTab(tab); } }
    return;
  }
  if (state === 'settings' && (dir === 'left' || dir === 'right') && document.activeElement.closest('#set-tabs')) {
    stepSettingsTab(dir === 'left' ? -1 : 1);
    return;
  }
  if (state === 'settings' && (dir === 'left' || dir === 'right') && document.activeElement.id === 'set-voice') {
    stepVoice(dir === 'left' ? -1 : 1);
    return;
  }
  if (state === 'select' && (dir === 'left' || dir === 'right') && document.activeElement.id !== 'sel-q') { cycleCategory(dir === 'left' ? -1 : 1); return; }
  // Up from the first song (a fresh press, not a held key running into the top) wraps to the last song.
  if (state === 'select' && dir === 'up' && !searchOpen() && performance.now() - selMoveAt > 400
    && visible()[0] && visible()[0].id === selectedId) { jumpTo(visible().length - 1); return; }
  // Down from the last song wraps to the first, the same way.
  if (state === 'select' && dir === 'down' && !searchOpen() && performance.now() - selMoveAt > 400
    && visible().length && visible()[visible().length - 1].id === selectedId) { jumpTo(0); return; }
  if (state === 'results' && (dir === 'left' || dir === 'right') && !resultsAll()) {
    stepResultsPage(dir === 'left' ? -1 : 1);
    return;
  }
  if (state === 'settings' && settingsAll() && (dir === 'up' || dir === 'down') && settingsVertical(dir === 'down' ? 1 : -1)) return;
  if (!nav.adjust(document.activeElement, dir)) nav.move(root, dir);
}
// All settings on screen in columns: up / down walk one column top to bottom, then continue at the other column (the generic spatial
// move would hop sideways to whatever sits closest in height). -> false when focus isn't in a panel.
function settingsVertical(step) {
  const cur = document.activeElement;
  if (!cur || !cur.closest || !cur.closest('.set-panel')) return false;
  const items = nav.focusables(screens.settings).filter(el => el.closest('.set-panel'));
  const colOf = el => Math.round(el.closest('.set-panel').getBoundingClientRect().left);
  const cols = [...new Set(items.map(colOf))].sort((a, b) => a - b).map(x => items.filter(el => colOf(el) === x).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top));
  const ci = cols.findIndex(c => c.includes(cur)), i = ci < 0 ? -1 : cols[ci].indexOf(cur);
  let target = ci >= 0 ? cols[ci][i + step] : null;
  if (!target && ci >= 0 && cols[ci + step]) target = step > 0 ? cols[ci + step][0] : cols[ci + step][cols[ci + step].length - 1];
  if (target) target.focus();
  return true; // at the very first / last item nothing moves
}

// ---- phone keys & soft keys ----
// Confirm on a screen: the focused control, else the screen's default one (focus may not have landed yet, e.g. right after a modal opens).
function confirmScreen(root) {
  if (!root) return;
  if (!nav.confirm(root)) { const d = root.querySelector('[data-default]:not([disabled])'); if (d) d.click(); }
}
function softLeft() {
  switch (state) {
    case 'title': startFromTitle(); break;
    case 'select': if (selDetail) playSelected(); else nav.confirm(activeScreen()); break; // the Menu key picks the song (on the narrow details view always: a focused heart or chip must not swallow it)
    case 'message': stepMessage(1); break;
    case 'stats': navigate('right'); break;
    case 'composer': if (csMenu) nav.confirm(activeScreen()); else setCompMenu(true); break;
    case 'countin': case 'playing': case 'resuming': pauseGame(); break;
    default: confirmScreen(activeScreen());
  }
}
// C key (right soft label on the bare LCD): Back fires on release; holding it ~1.2 s runs the fake memory wipe
// instead (title/menu/select), and the next press stops the wipe.
function softRightDown() {
  if (wipe.active) { hideGag(); return; }
  if (!gagStates()) { phoneKey('softR'); return; }
  beginHold(startWipe);
  const up = () => {
    window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    if (!endHold()) phoneKey('softR');
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
// Soft keys (the two bottom buttons; keyboard Enter/Esc and the gamepad reach the same handlers).
function phoneKey(key) {
  if (!$('gag').hidden && gagTimer) hideGag();
  if (state === 'composer' && !csMenu) {
    if (key === 'softL') setCompMenu(true);
    else if (key === 'softR') compInput('del');
    return;
  }
  if (!inPlay()) synth.keyClick();
  if (state === 'title') { startFromTitle(); return; }
  if (state === 'welcome') { skipWelcome(); return; }
  if (state === 'calibration' && key !== 'softR' && key !== 'softL') { calibTap({ timeStamp: performance.now() }); return; }
  if (key === 'softL') softLeft();
  else if (key === 'softR') back();
}

// ---- wiring ----
// Back from signing in: the full-LCD intro (welcome.js) replaces the title screen while the one-time code is exchanged, then the menu.
// Silent (no gesture yet); it can only be skipped once it has played to the end on this device. A failed exchange falls back to the title.
let welcomeStop = null, welcomeAnswered = false;
// Signal and battery icons are hidden (not removed, so the title bar keeps its layout) while the intro runs.
const statusIcons = on => { for (const id of ['st-signal', 'st-battery']) $(id).style.visibility = on ? '' : 'hidden'; };
function welcomeEnd(to, gesture) {
  if (welcomeStop) welcomeStop();
  welcomeStop = null;
  $('welcome-fx').hidden = true;
  cameoSignal = false; phoneIdle();
  statusIcons(true);
  if (to === 'title') setState('title', 'title');
  else if (to === 'none') return; // somebody else already navigated away
  else if (gesture) startFromTitle(); else openMenu('tones');
}
// Skipping needs a finished sign-in and an earlier full viewing on this device.
const skipWelcome = () => { if (state === 'welcome' && settings.welcomeSeen && welcomeAnswered) welcomeEnd('menu', true); };
function welcomeStart(exchange) {
  let ok = null, cancelled = false;
  welcomeAnswered = false;
  setState('welcome', 'welcome');
  cameoSignal = true; // the intro owns the status bar
  statusIcons(false);
  const fx = $('welcome-fx'), msg = $('welcome-msg'), bar = $('st-title');
  fx.hidden = false;
  msg.hidden = false; msg.classList.remove('ok'); msg.textContent = tr('Connecting…');
  welcomeStop = () => { cancelled = true; };
  requestAnimationFrame(() => { // measured once the phone is laid out
    if (cancelled) return;
    const { w, h } = measureGrid(fx), sim = createWelcome(w, h);
    const name = () => (cloud.profile() || {}).name || 'Player';
    exchange.then(r => { ok = r; if (r) { welcomeAnswered = true; sim.release(name()); } });
    welcomeStop = runWelcome(fx, sim, {
      onTick: () => {
        if (state !== 'welcome') { welcomeEnd('none'); return; }
        if (ok === false || sim.hold > HOLD_LIMIT) { if (sim.hold > HOLD_LIMIT) toast('Sign-in failed'); welcomeEnd('title'); return; }
        if (still.matches) sim.jump(WT.FADE);
        if (sim.tick === WT.FLASH) { msg.textContent = tr('Connected'); msg.classList.add('ok'); }
        if (sim.tick === WT.FADE) msg.hidden = true;
        if (sim.tick === WT.TITLE) { // the same name types into the title bar as the big one finishes
          bar.textContent = sim.name; bar.style.setProperty('--chars', [...sim.name].length || 1);
          void bar.offsetWidth; bar.classList.add('hello');
        }
      },
      onDone: () => { settings.welcomeSeen = true; save(); welcomeEnd('menu'); },
    });
  });
}

// The title's ringing 3310 (titlefx.js) on the LCD canvas while the title is up. Reduced motion paints one still frame.
let titleStop = null, titleOn = false;
function titleFx(on) {
  titleOn = on;
  if (titleStop) titleStop();
  titleStop = null;
  const fx = $('title-fx');
  fx.hidden = !on;
  if (!on) return;
  requestAnimationFrame(() => { // measured once the phone is laid out
    if (!titleOn || titleStop) return;
    // On a big LCD the scene is drawn with bigger cells (a whole multiple of the base cell) as long as the whole stack still fits.
    const box = fx.parentElement, lcd = box.getBoundingClientRect().bottom, text = $('title').querySelector('.blink').getBoundingClientRect().top;
    let m = 1;
    for (let k = 2; k <= 6; k++) {
      const cell = CELL * k;
      if (Math.floor(box.clientHeight / cell) - (Math.ceil((lcd - text) / cell) + 1) >= TITLE_EXTENT.rows && Math.floor(box.clientWidth / cell) >= TITLE_EXTENT.cols) m = k; else break;
    }
    const cell = CELL * m, { w, h } = measureGrid(fx, cell);
    const sim = createTitle(w, h, Math.ceil((lcd - text) / cell) + 1, settings.invert); // the DOM text under the scene is kept clear
    if (!still.matches) { titleStop = runWelcome(fx, sim); return; }
    sim.jump(TITLE_REST);
    const ctx = fx.getContext('2d');
    ctx.fillStyle = INK; // not the computed color: Dark Reader rewrites it light
    sim.draw((x, y) => ctx.fillRect(x, y, 1, 1));
    titleStop = () => ctx.clearRect(0, 0, fx.width, fx.height);
  });
}

let booted = false;
function startFromTitle() {
  synth.ensure();
  if (!booted) { booted = true; synth.jingle(); }
  openMenu('tones');
}

function wire() {
  // settings controls
  const v = $('volume'), sc = $('scroll'), bk = $('backing'), pv = $('pref-preview');
  v.value = settings.volume * 100; sc.value = settings.scrollTime; bk.checked = settings.backing; pv.checked = settings.preview; $('pref-gags').checked = settings.idleGags;
  v.oninput = () => { settings.volume = v.value / 100; synth.setVolume(settings.volume); save(); };
  sc.oninput = () => { settings.scrollTime = +sc.value; renderer.scrollTime = settings.scrollTime; $('scroll-val').textContent = sc.value + 's'; save(); };
  $('scroll-val').textContent = sc.value + 's';
  bk.onchange = () => { settings.backing = bk.checked; game.backing = settings.backing; save(); };
  const ra = $('pref-rollaudio');
  ra.checked = settings.rollAudio;
  ra.onchange = () => { settings.rollAudio = ra.checked; game.rollAudio = settings.rollAudio; save(); };
  const jc = $('pref-juice'), hp = $('pref-haptics');
  jc.checked = settings.juice; hp.checked = settings.haptics;
  const syncJuice = () => { renderer.juice = settings.juice; hp.disabled = !settings.juice; };
  syncJuice();
  jc.onchange = () => { settings.juice = jc.checked; syncJuice(); save(); };
  hp.onchange = () => { settings.haptics = hp.checked; save(); };
  const cp = $('pref-combopopup');
  cp.checked = settings.comboPopup; renderer.comboPopup = settings.comboPopup;
  cp.onchange = () => { settings.comboPopup = cp.checked; renderer.comboPopup = cp.checked; save(); };
  const po = $('pref-perf'), nt = $('pref-net');
  po.checked = settings.perfOverlay; nt.checked = settings.netTracker;
  po.onchange = () => setPerf(po.checked);
  nt.onchange = () => { settings.netTracker = nt.checked; netDebug.enable(nt.checked); save(); };
  const inv = $('pref-invert');
  inv.checked = settings.invert;
  inv.onchange = () => { settings.invert = inv.checked; renderer.invert = inv.checked; save(); };
  $('pref-compact').checked = settings.compactView;
  $('pref-compact').onchange = e => { settings.compactView = e.target.checked; save(); layout(true); };
  $('pref-modhints').checked = settings.modHints;
  $('pref-modhints').onchange = e => { settings.modHints = e.target.checked; save(); if (!e.target.checked) hideModHint(); };
  // Developer: wipe everything this device stores (settings, scores, stats, songs, the cloud sign-in). Three presses, each one more sure.
  {
    const asks = [() => tr('Delete save'), () => tr('ARE YOU REALLY SURE???'), () => tr('ARE YOU REALLY, REALLY SURE???')];
    let stage = 0, timer = 0;
    const label = () => { $('btn-delete-save').textContent = asks[stage](); };
    $('btn-delete-save').onclick = () => {
      clearTimeout(timer);
      if (++stage < asks.length) { label(); timer = setTimeout(() => { stage = 0; label(); }, 4000); return; }
      try {
        for (const k of Object.keys(localStorage).filter(k => k.startsWith('ringbeat.'))) localStorage.removeItem(k);
        Storage.prototype.setItem = () => {}; // nothing may write the save back while the page unloads
      } catch { /* storage blocked: nothing to delete */ }
      location.reload();
    };
    $('btn-delete-save').addEventListener('blur', () => { clearTimeout(timer); stage = 0; label(); }); // looking away cancels
    label();
  }
  $('pref-gags').onchange = e => { settings.idleGags = e.target.checked; save(); cameo.sync(); };
  pv.onchange = () => { settings.preview = pv.checked; save(); if (!pv.checked) stopPreview(); };
  const voiceName = () => ({ buzzer: tr('Buzzer'), smooth: tr('Smooth'), pulse: tr('Pulse'), triangle: tr('Triangle'), arp: tr('Arpeggio'), bell: tr('Bell'), organ: tr('Organ'), pluck: tr('Pluck'), saw: tr('Sawtooth'), gameboy: tr('Game Boy') })[settings.voice];
  const voiceLabel = () => { $('set-voice').textContent = tr('Tone: {voice}', { voice: voiceName() }); };
  const paintTitleLang = () => { $('title-lang').innerHTML = spriteHTML(ICON_GLOBE, 2) + `<span>${esc(getLang().toUpperCase())}</span>`; $('title-lang').title = tr('Language: {lang}', { lang: LANGS[getLang()] }); };
  const langLabel = () => { $('set-lang').innerHTML = spriteHTML(ICON_GLOBE, 2) + esc(tr('Language: {lang}', { lang: LANGS[getLang()] })); }; // the title screen's globe
  // Everything that was drawn from text is redrawn; screens opened later render fresh.
  const relocalize = () => {
    applyStatic();
    voiceLabel(); langLabel(); paintTitleLang(); paintExport();
    renderBindings(); refreshModsButton(); refreshChrome(); selectHints();
    for (const id of ['btn-quit', 'btn-menu']) $(id).textContent = tr((run && run.retLabel) || 'Tones');
  };
  relocalize();
  // Language toggle on the title screen: the globe plus the current code; a tap cycles the language like Settings › Language
  $('title-lang').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); $('set-lang').click(); });
  // Settings that arrived from another device: the controls, the live objects and the language follow.
  settingsArrived = () => {
    sc.value = settings.scrollTime; $('scroll-val').textContent = sc.value + 's';
    bk.checked = settings.backing; pv.checked = settings.preview; $('pref-gags').checked = settings.idleGags;
    ra.checked = settings.rollAudio; jc.checked = settings.juice; hp.checked = settings.haptics;
    cp.checked = settings.comboPopup; renderer.comboPopup = settings.comboPopup;
    inv.checked = settings.invert; renderer.invert = settings.invert;
    if (titleOn) titleFx(true);
    renderer.scrollTime = settings.scrollTime; game.backing = settings.backing; game.rollAudio = settings.rollAudio; synth.voice = settings.voice;
    po.checked = settings.perfOverlay; nt.checked = settings.netTracker;
    if (settings.perfOverlay !== perf.enabled) setPerf(settings.perfOverlay, false);
    netDebug.enable(settings.netTracker);
    syncJuice(); paintRanges(screens.settings); cameo.sync();
    setLang(effectiveLang()); relocalize();
  };
  $('set-lang').onclick = () => {
    const codes = Object.keys(LANGS);
    settings.lang = codes[(codes.indexOf(getLang()) + 1) % codes.length];
    save(); setLang(settings.lang); relocalize();
  };
  stepVoice = (sign = 1) => {
    settings.voice = synth.voice = VOICES[(VOICES.indexOf(settings.voice) + sign + VOICES.length) % VOICES.length];
    save(); voiceLabel();
    // While paused, ensure() on the main synth would resume its suspended context and un-freeze song time,
    // so the preview goes through a separate synth with its own AudioContext.
    const s = game.state === 'paused' ? (tonePreview ||= new Synth()) : synth;
    s.ensure();
    if (s !== synth) { s.voice = synth.voice; s.setVolume(synth.volume); }
    s.playNote({ midi: 76, when: s.ctx.currentTime + 0.02, duration: 0.12 });
  };
  $('set-voice').onclick = () => stepVoice(1);
  document.addEventListener('input', e => { if (e.target.type === 'range') paintRange(e.target); });
  $('btn-calibrate').onclick = startCalibration;
  $('set-prev').onclick = () => stepSettingsTab(-1);
  $('set-next').onclick = () => stepSettingsTab(1);
  for (const t of document.querySelectorAll('#set-tabs button')) t.onclick = () => { synth.keyClick(); setSettingsTab(t.dataset.tab); };
  onSwipe(screens.settings, (dir, e) => { if (e.target.type !== 'range') stepSettingsTab(dir === 'left' ? 1 : -1); });
  $('btn-pause-settings').onclick = () => openSettings('paused');
  $('btn-settings-back').onclick = closeSettings;
  $('btn-bind-reset').onclick = () => { settings.padBindings = cloneBindings(DEFAULT_BINDINGS); capturingSlot = -1; save(); renderBindings(); toast('Controller buttons reset'); };
  let resetTimer = 0;
  $('btn-reset-scores').onclick = e => {
    const b = e.currentTarget;
    if (resetTimer) {
      clearTimeout(resetTimer); resetTimer = 0;
      scores.clear(); stats.clear(); cloud.markReset(); b.textContent = tr('Reset scores & stats'); toast('Scores and stats cleared');
    } else {
      b.textContent = tr('Really reset? Press again');
      resetTimer = setTimeout(() => { resetTimer = 0; b.textContent = tr('Reset scores & stats'); }, 3000);
    }
  };

  // main menu: tap the item to open it, arrows / swipe / wheel to browse
  $('mm-go').onclick = menuSelect;
  $('mm-prev').onclick = e => { e.stopPropagation(); synth.keyClick(); menuStep(-1); };
  $('mm-next').onclick = e => { e.stopPropagation(); synth.keyClick(); menuStep(1); };
  for (const b of [$('mm-prev'), $('mm-next')]) b.addEventListener('pointerdown', e => e.preventDefault()); // keep focus on the item
  {
    let wheelAt = 0;
    const m = $('menu');
    const swiped = onSwipe(m, dir => { synth.keyClick(); menuStep(dir === 'left' || dir === 'up' ? 1 : -1); }, { axis: 'both', threshold: 30 });
    $('mm-body').addEventListener('click', () => { if (!swiped()) { synth.keyClick(); menuSelect(); } });
    m.addEventListener('wheel', e => {
      e.preventDefault();
      const now = performance.now();
      if (now - wheelAt < 180 || !e.deltaY) return;
      wheelAt = now; synth.keyClick(); menuStep(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
  }
  // stats: swipe or tap the arrows for pages
  {
    const st = $('stats');
    onSwipe(st, dir => navigate(dir === 'left' ? 'right' : 'left'));
    const arrows = st.querySelectorAll('.st-tabs .arrow');
    arrows[0].addEventListener('click', () => navigate('left'));
    arrows[1].addEventListener('click', () => navigate('right'));
  }
  // messages
  wireAdmin();
  $('inbox-list').onclick = e => { const b = e.target.closest('button'); if (b) openMessage(+b.dataset.i); };

  // tutorial
  $('btn-tp-yes').onclick = () => { synth.ensure(); startTutorial(); };
  $('btn-tp-no').onclick = skipTutPrompt;
  $('btn-lp-yes').onclick = loginPromptYes;
  $('btn-lp-no').onclick = () => afterLogin();
  $('btn-tut-go').onclick = tutorialGo;
  $('btn-tut-skip').onclick = tutorialSkip;
  $('btn-tut-back-pause').onclick = () => {
    const i = run.tutorial.stage;
    game.stop();
    input.reset();
    padHeld.forEach(s => s.clear());
    openLesson(i);
  };
  $('btn-tutorial').onclick = () => { synth.ensure(); startTutorial(); };

  // title / select
  $('btn-start').onclick = startFromTitle;
  const detailSwiped = onSwipe($('sel-detail'), dir => { if (selDetail) stepSong(dir === 'up' ? 1 : -1); }, { axis: 'y' });
  $('sd-chips').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !detailSwiped()) { synth.keyClick(); cycleMod(b.dataset.mod); } });
  $('sd-go').onclick = playSelected;
  $('sd-fav').onclick = () => toggleFavorite();
  $('dp-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.tab !== dpTab) { synth.keyClick(); setDpTab(b.dataset.tab); } });

  // mods
  $('btn-glyphs').onclick = openGlyphs;
  $('btn-float-reset').onclick = () => { resetFloatBoxes(); synth.keyClick(); };
  $('btn-glyphs-back').onclick = () => openSettings(settingsFrom);
  $('glyphs').addEventListener('focusout', e => { if (!e.relatedTarget || !e.relatedTarget.closest('.gl-cell')) glyphAnimate(null); });
  $('glyphs').addEventListener('focusin', e => {
    const c = e.target.closest('.gl-cell');
    if (!c) return;
    glyphAnimate(c);
    glyphsLast = Array.prototype.indexOf.call($('gl-body').querySelectorAll('.gl-cell'), c);
    $('gl-hint').textContent = c.dataset.info;
    marquee($('gl-hint'));
  });

  // my songs
  $('ms-new').onclick = () => openComposer();
  $('ms-paste').onclick = () => openCustom();
  $('ms-back').onclick = () => openMenu('mysongs');
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
    openMySongs(r.skipped ? tr('Imported {n}, skipped {skipped}', { n: r.added, skipped: r.skipped }) : tr('Imported {n}', { n: r.added }));
  };
  $('ms-export').onclick = () => { download('ringbeat-songs.json', mysongs.exportJSON(), 'application/json'); $('ms-msg').textContent = tn(mysongs.count(), 'Exported {n} song', 'Exported {n} songs'); };

  // profile
  $('pf-signin').onclick = () => { location.href = cloud.signInUrl(location.origin + location.pathname + location.search); };
  $('pf-rename').onclick = () => { const name = $('pf-name-input').value; profileAction(() => cloud.rename(name), tr('Name saved')); };
  $('pf-public').onclick = () => {
    const off = (cloud.profile() || {}).public === false;
    profileAction(() => cloud.setPublic(off), tr(off ? 'Your name shows on leaderboards' : 'Your runs are hidden from leaderboards'));
  };
  // Signed out, the Sign-in button takes over; the hint under the list says what signing in does.
  $('pf-signout').onclick = async () => { await profileAction(() => cloud.signOut(), ''); focusDefault(screens.profile); };
  $('pf-export').onclick = () => {
    exportAt = Date.now();
    try { localStorage.setItem(EXPORT_KEY, String(exportAt)); } catch { /* storage blocked */ }
    paintExport();
    profileAction(async () => {
      download('ringbeat-export.json', JSON.stringify(await cloud.exportData(), null, 2), 'application/json');
    }, tr('Data exported'));
  };
  $('pf-delete').onclick = () => {
    if (Date.now() - pfDeleteArmed > 4000) {
      pfDeleteArmed = Date.now(); pfMsg = tr('Deletes the online profile and its data. This device keeps its own. Press again to delete.'); renderProfile();
      return;
    }
    pfDeleteArmed = 0;
    profileAction(() => cloud.deleteAccount(), tr('Online profile deleted'));
  };
  $('pf-boards').onclick = () => { location.href = 'boards.html'; };
  $('pf-privacy').onclick = () => window.open('https://github.com/GIider/ringbeat/blob/main/docs/PRIVACY.md', '_blank', 'noopener,noreferrer');

  // one song
  $('sm-play').onclick = () => {
    const e = curEntry();
    if (!e) return;
    selectedId = e.id; settings.lastSongId = e.id; save();
    startRun({ entry: e, ret: () => openSongMenu(e.uid), retLabel: 'My song' });
  };
  $('sm-preview').onclick = () => { const e = curEntry(); if (e) togglePreview(e); };
  $('sm-edit').onclick = () => { const s = curSong(); if (s) openComposer(s.rtttl, s.uid); };
  $('sm-dup').onclick = () => {
    const d = mysongs.duplicate(curUid);
    if (!d) { toast(mysongs.isFull() ? tr('My songs is full (max {max})', { max: MAX_SONGS }) : 'Could not duplicate: storage unavailable'); return; }
    refreshCustoms(); openSongMenu(d.uid);
  };
  $('sm-file').onclick = () => { const s = curSong(); if (s) { download(slug(s.name) + '.rtttl', s.rtttl + '\n'); $('sm-msg').textContent = tr('Saved {file}', { file: slug(s.name) + '.rtttl' }); } };
  $('sm-copy').onclick = () => { const s = curSong(); if (s) copyText(s.rtttl, $('sm-msg'), 'Text'); };
  $('sm-calc').onclick = calcDifficulty;
  $('sm-share').onclick = async () => {
    const s = curSong(); if (!s) return;
    const url = location.origin + location.pathname + encodeSong(s.rtttl, s.rating);
    await copyText(url, $('sm-msg'), 'Link');
  };
  let delArmed = 0;
  $('sm-del').onclick = () => {
    if (Date.now() - delArmed > 4000) { delArmed = Date.now(); $('sm-del').textContent = tr('Really delete?'); setTimeout(() => { $('sm-del').textContent = tr('Delete'); }, 4000); return; }
    delArmed = 0; $('sm-del').textContent = tr('Delete');
    mysongs.remove(curUid); curUid = '';
    refreshCustoms();
    if (!entryById(selectedId)) selectedId = (visible()[0] || builtins[0]).id;
    openMySongs('Deleted');
  };
  $('sm-back').onclick = () => openMySongs();

  // composer
  $('comp-pad').addEventListener('click', e => { const b = e.target.closest('button'); if (b) compInput(b.dataset.k); });
  $('comp-pad').addEventListener('pointerdown', e => e.preventDefault());
  $('comp-left').onclick = () => compInput('left');
  $('comp-right').onclick = () => compInput('right');
  $('comp-resume').onclick = () => setCompMenu(false);
  $('comp-play').onclick = () => {
    const e = compEntry();
    if (!e) return;
    stopPreview();
    const toComposer = () => { setState('composer', 'composer'); setCompMenu(false); };
    startRun({ entry: e, ret: toComposer, retLabel: 'Composer' });
  };
  $('comp-preview').onclick = () => { const e = compEntry(); if (e) togglePreview(e); };
  $('comp-save').onclick = saveComposer;
  $('comp-name').addEventListener('input', () => { cs.name = $('comp-name').value; csDirty = true; renderComposer(); });
  $('comp-bpm').addEventListener('input', () => { cs.bpm = +$('comp-bpm').value; csDirty = true; renderComposer(); });
  $('comp-clear').onclick = () => { comp.clear(cs); csDirty = true; renderComposer(); toast('Cleared'); };
  $('comp-text').onclick = () => { cs.name = $('comp-name').value; openCustom(comp.toRTTTL(cs), csUid); };
  $('comp-exit').onclick = leaveComposer;

  // text / paste
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
    startRun({ entry: e, ret: toText, retLabel: 'RTTTL text' });
  };
  $('btn-custom-preview').onclick = () => { const e = customEntry(area.value); if (e) togglePreview(e); };
  $('btn-custom-compose').onclick = () => { if (customEntry(area.value)) openComposer(area.value.trim(), txtUid); };
  $('btn-custom-back').onclick = back;

  // play / pause / results
  for (const id of ['sel-arrow-l', 'sel-arrow-r', 'sel-sort']) $(id).addEventListener('pointerdown', e => e.preventDefault()); // keep focus on the song row
  $('sel-arrow-l').onclick = () => { synth.keyClick(); cycleCategory(-1); };
  $('sel-arrow-r').onclick = () => { synth.keyClick(); cycleCategory(1); };
  $('sel-sort').onclick = () => { synth.keyClick(); openHub('sort'); };
  onSwipe($('message'), dir => navigate(dir === 'left' ? 'right' : 'left'));
  $('welcome').addEventListener('click', skipWelcome);
  $('title').addEventListener('click', e => { if (state === 'title' && !e.target.closest('a, .boot-version, .title-lang')) startFromTitle(); });
  $('btn-resume').onclick = resumeGame;
  $('btn-restart').onclick = restartRun;
  $('btn-quit').onclick = leaveToSelect;
  // The tabs never hold focus: a focused tab would swallow Enter/A (re-clicking itself) while the footer button stays lit.
  for (const t of document.querySelectorAll('#r-tabs button')) {
    t.addEventListener('mousedown', e => e.preventDefault());
    t.onclick = () => {
      setResultsPage(+t.dataset.page);
      if (document.activeElement && document.activeElement.closest('#r-tabs')) focusDefault(screens.results);
    };
  }
  $('r-board-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.board !== resultsBoard) { synth.keyClick(); setResultsBoard(b.dataset.board); } });
  $('r-prev').onclick = () => stepResultsPage(-1);
  $('r-next').onclick = () => stepResultsPage(1);
  for (const t of document.querySelectorAll('#dp-tabs button')) t.onclick = () => setDpTab(t.dataset.tab);
  // horizontal swipe flips results pages
  onSwipe($('results'), dir => navigate(dir === 'left' ? 'right' : 'left'));
  // swipe through the tutorial lessons (swipe left = next)
  onSwipe($('tutorial'), dir => navigate(dir === 'left' ? 'right' : 'left'));
  $('btn-retry').onclick = restartRun;
  $('btn-menu').onclick = leaveToSelect;

  // calibration
  $('calib-pad').addEventListener('pointerdown', e => { e.preventDefault(); calibTap(e); });
  $('calib-pad').addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) calibTap(e); } });
  $('nudge-minus').onclick = () => nudge(-5);
  $('nudge-plus').onclick = () => nudge(5);
  $('calib-reset').onclick = () => { settings.calibration = 0; save(); showOffset(); };
  $('calib-done').onclick = leaveCalibration;
  $('calib-again').onclick = startCalibration;

  // soft-key labels (pointerdown, and never steal focus from the list)
  // the phone's two soft keys under the LCD do what the labels say: Select (left) and Back (right)
  document.querySelector('.navkey.l').addEventListener('pointerdown', e => { e.preventDefault(); phoneKey('softL'); });
  document.querySelector('.navkey.r').addEventListener('pointerdown', e => { e.preventDefault(); softRightDown(); });
  $('soft-left').addEventListener('pointerdown', e => { e.preventDefault(); phoneKey('softL'); });
  $('soft-right').addEventListener('pointerdown', e => { e.preventDefault(); softRightDown(); });
  $('boot-version').textContent = 'v' + VERSION;
  $('boot-build').textContent = buildLine(BUILD, false); // commit · date; the IMEI panel also shows the build number
  // The version and build lines are the tap target for the IMEI panel: they count taps instead of starting the game or opening GitHub
  // (the credit link is in the panel itself). Whole lines, not just the link text, so a fingertip can hit them.
  for (const el of document.querySelectorAll('.boot-version')) el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); tapVersion(); });
  document.addEventListener('focusin', e => light(e.target));
  window.addEventListener('resize', () => { queueHeadFit();  if (state === 'welcome') welcomeEnd('menu'); layout(); if (state === 'title') titleFx(true); if (state === 'menu') fitMenuTitle(); marquee($('st-title')); const t = document.querySelector('.song-row.cur .t'); if (t) marquee(t); if (state === 'inbox') marqueeAll($('inbox-list').querySelectorAll('.t')); });

  window.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') useMouse(); else setDevice('touch'); });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => { if (e.code === 'KeyC') endHold(); });
  window.addEventListener('blur', () => { endHold(); input.reset && input.reset(); });
  // Gamepad input may not count as a user gesture; resume a suspended context on the next key/click. The first gesture also creates the
  // context: after a sign-in redirect the page loads straight into the menu (no title press), and the menu sounds need a context.
  const wake = () => { if (game.state === 'paused') return; if (synth.ctx) synth.wake(); else synth.ensure(); };
  window.addEventListener('keydown', wake, true);
  window.addEventListener('pointerdown', wake, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseGame(); cloud.flush(); } else { cloud.wake(); if (game.state !== 'paused') synth.wake(); } // audio clock keeps running when hidden
  });
  window.addEventListener('pagehide', commitTime);

  // Back from signing in: the API hands over a one-time code (or the reason it failed) in the hash.
  let loginExchange = null;
  if (/^#login(-error)?=/.test(location.hash)) {
    const hash = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    if (hash.startsWith('#login-error=')) toast('Sign-in failed');
    else loginExchange = cloud.takeLoginHash(hash).then(ok => { if (ok) { cloud.sync('signed in'); cloud.board('', 'normal'); } return ok; }, () => { toast('Sign-in failed'); return false; });
  } else if (!demoKind) cloud.sync('start'); // ?demo= pages never touch the network
  if (!demoKind) cloud.board('', 'normal'); // signed in only: warms the world snapshot if it is stale, so the first picker and results are instant

  // Initial selection: share link > last played > first song
  const shared = decodeShare(location.hash);
  // The old single custom slot becomes the first saved song.
  if (settings.customRtttl && !mysongs.count()) mysongs.add(settings.customRtttl.split(':')[0] || 'My song', settings.customRtttl);
  if (settings.customRtttl) { settings.customRtttl = ''; save(); }
  refreshCustoms();
  const takeShared = share => {
    const text = share && share.rtttl;
    if (!text || !customEntry(text)) return false;
    const r = importSharedText(text);
    // The sender's rating is unverified: only used when this device has none yet (Recalculate replaces it).
    const saved = mysongs.list().find(x => x.rtttl === text.trim());
    if (saved && share.rating && !saved.rating) { mysongs.setRating(saved.uid, share.rating); refreshCustoms(); }
    const e = customs.find(c => c.rtttl === text.trim());
    if (e) { selectedId = e.id; settings.lastSongId = e.id; save(); }
    else if (!r.added) toast('My songs is full');
    return !!e;
  };
  if (!takeShared(shared)) selectedId = entryById(settings.lastSongId) ? settings.lastSongId : defaultSongId();
  window.addEventListener('hashchange', () => {
    const t = decodeShare(location.hash);
    if (t && takeShared(t)) { toast('Shared song saved to My songs'); if (state === 'select') openSelect(); }
  });
  showOffset();
  if (loginExchange) welcomeStart(loginExchange); else show('title');
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  setDevice('kbd');
  const tag = e.target.tagName;
  const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type === 'text');
  if (!typing && !e.repeat) {
    if (!$('gag').hidden && gagTimer) hideGag(); // any key dismisses the IMEI panel
    eggToken(e.code);
    if (e.code === 'KeyC' && wipe.active) hideGag();
    else if (e.code === 'KeyC' && gagStates() && !gagHold) beginHold(startWipe);
  }
  if (state === 'welcome') {
    if (e.code !== 'Tab' && !e.repeat && !e.code.startsWith('Shift')) { e.preventDefault(); skipWelcome(); }
    return;
  }
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
  if (e.code === 'Escape' && state === 'select' && (searchOpen() || searchQuery)) { e.preventDefault(); closeSearch(); return; }
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
  if (state === 'select' && !typing && tag !== 'SELECT' && !e.ctrlKey && !e.metaKey && !e.altKey
    && ['PageUp', 'PageDown', 'Home', 'End'].includes(e.code)) {
    e.preventDefault();
    setDevice('kbd');
    synth.keyClick();
    if (e.code === 'PageUp' || e.code === 'PageDown') jumpPage(e.code === 'PageDown' ? 1 : -1);
    else jumpTo(e.code === 'Home' ? 0 : Infinity);
    return;
  }
  if (state === 'select' && !typing && tag !== 'SELECT' && !e.ctrlKey && !e.metaKey && !e.altKey
    && (e.code === 'KeyJ' || e.code === 'KeyK')) {
    e.preventDefault();
    setDevice('kbd');
    synth.keyClick();
    jumpSectionStep(e.code === 'KeyK' ? 1 : -1);
    return;
  }
  // "/" is matched by the character it types, not its key: on layouts like German it sits on Shift+7
  const slash = e.key === '/' || e.code === 'Slash';
  if (state === 'select' && !typing && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey
    && (slash || (['KeyR', 'KeyG'].includes(e.code) && !e.shiftKey))) {
    e.preventDefault();
    synth.keyClick();
    if (slash) openSearch(); else if (e.code === 'KeyR') randomSong(); else openHub();
    return;
  }
  if (state === 'select' && !typing && tag !== 'SELECT' && ['KeyD', 'KeyF'].includes(e.code)) {
    e.preventDefault();
    if (e.repeat) return;
    synth.keyClick();
    if (e.code === 'KeyD' || e.code === 'KeyF') setView('sort', SORTS, e.code === 'KeyF' ? 1 : -1);
    return;
  }
  if (state === 'select' && !typing && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'KeyT'].includes(e.code)) {
    e.preventDefault();
    synth.keyClick();
    if (e.code === 'KeyT') toggleDpTab(); else cycleMod(MOD_CHIPS[+e.code.slice(5) - 1]);
    return;
  }
  if (state === 'select' && !typing && tag !== 'SELECT' && e.code === 'KeyV' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (e.repeat) return;
    toggleFavorite();
    return;
  }
  if (state === 'menu' && !typing && !e.repeat && /^[1-9]$/.test(e.key) && +e.key <= MENU.length) {
    e.preventDefault(); synth.keyClick(); menuJump(+e.key - 1); return;
  }
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

// ---- phone layout: body[data-mode], the LCD frame, LCD font/pixel scale and the key legend ----
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
  const small = vw < 600 || vh < 520; // too small for the frame: fullscreen is forced, so the setting has nothing to choose
  const framed = !small && !settings.compactView; // otherwise the LCD sits in the phone body
  $('pref-compact').closest('label').hidden = small;
  const bz = framed ? 20 : 0, tp = framed ? 44 : 0, peek = 64; // peek: how much of the body (and its soft keys) shows below the LCD
  let x = 0, y = 0, w = vw, h = vh, lh = vh, bb = 0;
  if (framed) {
    const lw = Math.min(1100, vw - 40 - 2 * bz, (vh - 16 - tp - peek) / 0.98);
    lh = lw * 0.98; w = lw + 2 * bz; x = (vw - w) / 2; y = 16;
    bb = peek + 300; h = tp + lh + bb; // the body runs on past the bottom edge of the window
  }
  ph.classList.toggle('framed', framed);
  ph.style.setProperty('--bz', bz + 'px');
  ph.style.setProperty('--tp', tp + 'px');
  ph.style.setProperty('--bb', bb + 'px');
  ph.style.setProperty('--lh', lh + 'px');
  ph.classList.toggle('no-anim', !animate);
  Object.assign(ph.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  // Pixel text stays on whole device pixels: 2 or 3 CSS px per font pixel. The play canvas uses the same grid.
  const lcdW = w - 2 * bz, fs = lcdW >= 470 ? 30 : 20;
  const dpr = window.devicePixelRatio || 1, u = Math.max(1, Math.round(fs / 10 * dpr)) / dpr; // whole device pixels per LCD pixel, even at DPR 1.25 / 2.625
  ph.style.setProperty('--fs', u * 10 + 'px');
  ph.style.setProperty('--u', u + 'px');
  // Text screens (messages, settings, profile, admin) are drawn one step bigger on a wide LCD: 4/3 of the pixel unit, still whole device pixels
  unit2 = Math.round(u * dpr * 4 / 3) / dpr;
  ph.style.setProperty('--fs2', unit2 * 10 + 'px');
  ph.style.setProperty('--u2', unit2 + 'px');
  const unit3 = Math.round(u * dpr * 5 / 3) / dpr; // the two question screens (tutorial? sign in?) go a step further
  ph.style.setProperty('--fs3', unit3 * 10 + 'px');
  ph.style.setProperty('--u3', unit3 + 'px');
  renderer.setPixelScale(u);
  if (unit !== u) {
    unit = u;
  }
  if (state === 'profile') { $('pf-icon')._spr = ''; setSprite($('pf-icon'), PERSON_ART, textUnit() * 2); }
  if (state === 'menu') paintMenuIcon();
  const lg = $('legend');
  body.classList.toggle('legend-on', framed && x >= 286);
  lg.style.left = Math.max(16, x - 270) + 'px';
  body.classList.toggle('selkeys-on', framed && vw - (x + w) >= 286);
  $('sel-keys').style.left = x + w + 16 + 'px';
  if (!animate) requestAnimationFrame(() => ph.classList.remove('no-anim'));
  if (state === 'select' && dpEntry) fitRows($('dp-panel'));
  queueHeadFit();
  if (state === 'stats') renderStats(); // wide <-> narrow: panels or pages
  if (state === 'settings') setSettingsTab(settingsTab);
  if (state === 'results') setResultsPage(resultsPage); // wide <-> narrow: panels or pages
  if (state === 'select') setTimeout(focusCurrentRow, animate ? 600 : 0); // keep the cursor row in view after a resize
}

// Idle phone: full signal and battery.
function phoneIdle() {
  netSignal.repaint();
  setSprite($('st-battery'), battery(4), 2);
}
// ---- dev-only screenshot states: ?demo=title|menu|select|info|play|pause|results|fc|settings|stats|inbox|profile|message ----
let demoRun = null, demoLabels = [];
const demoKind = new URLSearchParams(location.search).get('demo');
const DEMO_SEED = 11;
const DEMO_JUDGE_TEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
// A fixed spread of best runs on the rows around the selected song: every grade, FC, AP and a gap, always the same.
const DEMO_RUNS = [
  { grade: 'S', score: 91250, accuracy: 97.2, maxCombo: 74, fc: true }, { grade: 'A', score: 76420, accuracy: 93.5, maxCombo: 41 },
  { grade: 'B', score: 61900, accuracy: 88.0, maxCombo: 33 }, { grade: 'S', score: 98400, accuracy: 99.1, maxCombo: 88, fc: true, ap: true },
  { grade: 'B', score: 58300, accuracy: 86.7, maxCombo: 28 }, { grade: 'A', score: 80100, accuracy: 94.8, maxCombo: 60, fc: true },
  { grade: 'S', score: 95030, accuracy: 98.0, maxCombo: 70, fc: true }, { grade: 'C', score: 40210, accuracy: 79.4, maxCombo: 19 },
  { grade: 'A', score: 78800, accuracy: 94.1, maxCombo: 52 }, null,
  { grade: 'B', score: 57100, accuracy: 85.9, maxCombo: 25 }, { grade: 'S', score: 99000, accuracy: 99.5, maxCombo: 96, fc: true, ap: true },
];
function seedDemoScores() {
  const list = visible(), from = Math.max(0, list.findIndex(e => e.id === selectedId) - 5); // the rows around the cursor
  list.slice(from, from + DEMO_RUNS.length).forEach((e, i) => {
    if (DEMO_RUNS[i]) scores.record(e.id, e.chart, { ...DEMO_RUNS[i], date: Date.UTC(2026, 9, 10) + i * 36e5 });
  });
}
function demo(kind) {
  settings.tutorialDone = true;
  if (kind === 'title') return; // stays on the title screen
  selectedId = entryById('nokia') ? 'nokia' : selectedId;
  openSelect();
    if (kind === 'menu') openMenu('settings');
  else if (kind === 'stats') openStats();
  else if (kind === 'inbox') openInbox();
  else if (kind === 'profile') openProfile();
  else if (kind === 'message') showMessage(0);
  else if (kind === 'info') { if (!selWide()) setSelDetail(true); } // narrow LCDs: the details view (wide ones show the details beside the list)
  else if (kind === 'settings') openSettings();
  else if (kind === 'results' || kind === 'fc') {
    const demoFc = kind === 'fc';
    run = { entry: selectedEntry(), diff: selectedEntry().chart };
    game.onFinish({ score: 48210, maxCombo: 61, counts: { perfect: 52, great: 7, good: 2, miss: 1 }, accuracy: 94.6, grade: 'A', ghosts: demoFc ? 0 : 3,
      fc: demoFc, ap: false, deltas: [-0.03, -0.01, 0, 0.01, 0.02, 0, -0.02, 0.01, 0.005, 0.04, -0.05, 0.01], timeline: demoTimeline(selectedEntry()) });
  } else if (kind === 'play' || kind === 'pause') {
    const e = selectedEntry();
    const chart = generateChart(e.song, { difficulty: e.chart });
    const ctx = { currentTime: 0, suspend() {}, resume() {} };
    const g = new Game({ ctx, getLatency: () => 0, stopAll() {}, tick() {}, playNote: () => ({ release() {} }), playMiss() {} });
    g.fx = game.fx;
    g.start(chart, { leadIn: 0, backing: false });
    clearInterval(g.timer);
    // Seeded mid-skill bot plays up to T; judgements are recorded so labels can be re-stamped with realistic ages.
    const T = chart.notes[Math.floor(chart.notes.length / 2)].time + 0.12; // just after a hit, so a fresh label shows
    const judged = [];
    let at = 0;
    g.fx = { press: game.fx.press, judge: (lane, j) => { judged.push({ lane, j, t: at }); game.fx.judge(lane, j); }, banner: game.fx.banner };
    for (const ev of planBot(chart, LADDER[3], DEMO_SEED)) {
      if (ev.t > T) break;
      at = ev.t; ctx.currentTime = ev.t; g.update(ev.t);
      if (ev.type === 'press') g.press(ev.lane, ev.t); else g.release(ev.lane, ev.t);
    }
    at = T; ctx.currentTime = T;
    g.update(T);
    const recent = new Map(); // newest judgement per lane that is still on screen
    for (const x of judged) if (T - x.t < 0.45) recent.set(x.lane, { ...x, age: T - x.t });
    demoLabels = [...recent.values()];
    run = { entry: e, diff: e.chart };
    renderer.title = e.title;
    renderer.setLanes(chart.lanes, laneLabels(chart.lanes));
    screens.nowplaying.dataset.title = e.title;
    demoRun = { g, T };
    if (kind === 'pause') { state = 'paused'; show('paused'); } else setState('playing', null);
    input.enabled = false;
  }
}

// A fixed, plausible run over the entry's own chart (fixture for ?demo=results: strong start, a rough patch in the middle).
function demoTimeline(e) {
  const chart = generateChart(e.song, { difficulty: e.chart });
  const events = chart.notes.map((n, i) => {
    const p = n.time / chart.length, rough = p > 0.45 && p < 0.6;
    const k = (i * 7 + 3) % 10;
    return [n.time, rough ? [1, 2 / 3, 1 / 3, 0, 0, 2 / 3, 1, 0, 1 / 3, 2 / 3][k] : k === 4 ? 2 / 3 : 1];
  });
  return { length: chart.length, noteTimes: chart.notes.map(n => n.time), events, ghosts: [chart.length * 0.18, chart.length * 0.52, chart.length * 0.53] };
}

// ---- frame loop ----
const hud = createHud(perf);
function setPerf(on, remember = true) {
  perf.enable(on);
  if (remember) { settings.perfOverlay = on; save(); }
  const box = document.getElementById('pref-perf');
  if (box) box.checked = on;
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
        $('calib-msg').textContent = tr('Not enough usable taps. Try again.');
      } else {
        settings.calibration = num(r, -0.5, 0.5, 0);
        save(); showOffset();
        $('calib-msg').textContent = tr('Measured offset: {ms} ms. Nudge or press Done.', { ms: Math.round(r * 1000) });
      }
    }
    return;
  }
  if (state === 'settings' && (frame.n = (frame.n || 0) + 1) % 30 === 0) { updatePadStatus(); syncSettingsTabs(); }
  if (state === 'menu') menuAnim(performance.now());
  if (demoRun) {
    const now = performance.now() / 1000;
    renderer.labels.forEach((l, i) => {
      const d = demoLabels[i];
      if (d) { l.t = now - d.age; l.lane = d.lane; l.text = tr(DEMO_JUDGE_TEXT[d.j]); } else l.t = -10;
    });
    renderer.draw(demoRun.g, demoRun.T); return;
  }
  if (!game.active) {
    perf.begin('drawIdle');
    renderer.drawIdle();
    perf.end('drawIdle');
    return;
  }
  if (state === 'resuming') {
    const left = resumeEnd - performance.now();
    if (resumeEnd && left <= 0) finishResume();
    else if (resumeEnd) setResumeCount(Math.ceil(left / 1000));
  }
  perf.begin('update');
  const t = game.songTime(); // one clock read per frame: update and draw see the same time
  if (state === 'countin' || state === 'playing') {
    if (lastSongT !== null) runTime += Math.max(0, Math.min(0.25, t - lastSongT));
    lastSongT = t;
  } else lastSongT = null;
  if (run && run.autoplay && game.state === 'running') run.autoplay.step(t, game, game.calibration);
  game.update(t);
  perf.end('update');
  if (!game.active || game.state === 'done') return;
  if (state === 'countin' && t >= 0) state = 'playing';
  perf.begin('draw');
  renderer.draw(game, t);
  perf.end('draw');
}

// Bot-measured difficulty (optional: falls back to the density heuristic if missing). Loaded after first paint so a slow
// network never delays the UI; the list re-renders with the measured ratings once it arrives.
fetch(new URL('./difficulty.json', import.meta.url))
  .then(r => (r.ok ? r.json() : null))
  .then(data => {
    if (!data) return;
    setMeasured(data);
    const fallback = defaultSongId();
    builtins = perf.time('library', () => buildLibrary());
    if (!settings.lastSongId && selectedId === fallback) selectedId = defaultSongId();
    if (demoKind === 'select') seedDemoScores(); // after the re-sort: the rows around the cursor are final now
    renderList();
    renderDetail();
    if (state === 'select') focusCurrentRow(); // the re-sort moved the cursor row
  })
  .catch(() => { /* offline / file missing */ });

$('loading')?.remove();
wire();
showNet();
phoneIdle();
setMode();
layout(); // place the phone before the first paint, without the slide
// Row heights change once the pixel font arrives: re-centre the cursor row then.
if (document.fonts) document.fonts.ready.then(() => { layout(); focusCurrentRow(); });
if (demoKind) demo(demoKind);
try { // the overlay used to be remembered outside the settings: adopt that once
  if (localStorage.getItem('ringbeat.perf')) { settings.perfOverlay = true; save(); }
  localStorage.removeItem('ringbeat.perf');
} catch { /* storage blocked */ }
if (settings.perfOverlay) setPerf(true, false);
requestAnimationFrame(frame);
window.__ringbeat = { game, scores, stats, settings, perf, mysongs, cloud, admin, entries, get state() { return state; } }; // debug/test hook (tests/smoke.html)
