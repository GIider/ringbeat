// Bootstrap, screen state machine, wiring.
// States: title -> select <-> (custom | settings <-> calibration | training) -> countin -> playing <-> paused -> results -> select

import { generateChart } from './chart.js';
import { sliceChart, scaleChart } from './practice.js';
import { Synth } from './synth.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Input, KEY_LABELS, eventAudioTime } from './input.js';
import { encodeSong, decodeSong } from './share.js';
import { Calibration } from './calibration.js';
import { settings, saveSettings as save, num } from './settings.js';
import { buildLibrary, customEntry, formatLength } from './library.js';
import { createScores } from './scores.js';
import { Pad, BTN, buttonName, laneForSlot, DEFAULT_BINDINGS, cloneBindings } from './gamepad.js';
import { STAGES, buildStageChart, stagePassed } from './tutorial.js';
import * as nav from './nav.js';
import { coverURL } from './cover.js';

const $ = id => document.getElementById(id);

// ---- core objects ----
const synth = new Synth();
synth.volume = settings.volume;
const game = new Game(synth);
const renderer = new Renderer($('stage'));
renderer.scrollTime = settings.scrollTime;
game.fx = renderer.fx;
const input = new Input({ getCtx: () => synth.ctx, canvas: $('stage'), laneAt: x => renderer.laneAt(x) });
input.onPress = (lane, t) => { lastDevice = 'kbd'; game.press(lane, t); };
input.onRelease = (lane, t) => game.release(lane, t);
const calibration = new Calibration(synth);
const scores = createScores();
const pad = new Pad();

// ---- screen state ----
let state = 'title';
let lastDevice = 'kbd'; // decides which labels the lanes show
const screens = {
  title: $('title'), select: $('select'), custom: $('custom'), settings: $('settings'),
  training: $('training'), tutorial: $('tutorial'), results: $('results'), paused: $('pause'), calibration: $('calib'),
};
function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  $('btn-pause').hidden = !(state === 'countin' || state === 'playing');
  if (name !== 'select' && name !== 'custom') stopPreview();
  $('tut-caption').hidden = !(run && run.tutorial && (state === 'countin' || state === 'playing' || state === 'paused'));
  const el = screens[name];
  if (el) requestAnimationFrame(() => { if (!el.contains(document.activeElement)) focusDefault(el); });
}
function setState(s, screen) { state = s; show(screen); input.enabled = s === 'countin' || s === 'playing'; }
function focusDefault(el) {
  const d = el.querySelector('[data-default]:not([disabled])') || nav.focusables(el)[0];
  if (d && !el.hidden) d.focus({ preventScroll: true });
}
const activeScreen = () => screens[state === 'countin' || state === 'playing' ? '' : state];

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---- library & selection ----
const builtins = buildLibrary();
let custom = null;       // library entry for the user's custom song, or null
let selectedId = '';

function setCustom(rtttl) {
  custom = rtttl && rtttl.trim() ? customEntry(rtttl) : null;
  if (custom) { settings.customRtttl = rtttl.slice(0, 4000); save(); }
}
const entries = () => (custom ? [...builtins, custom] : builtins);
const entryById = id => entries().find(e => e.id === id) || null;
const selectedEntry = () => entryById(selectedId) || entries()[0];

// ---- preview (plays the song straight through, optionally cut at maxSec) ----
let previewTimer = null, autoPreviewTimer = null;
function stopPreview() {
  clearTimeout(previewTimer); clearTimeout(autoPreviewTimer);
  previewTimer = autoPreviewTimer = null;
  if (synth.ctx) synth.stopAll();
  $('btn-preview').textContent = '▶ Preview';
  $('btn-custom-preview').textContent = 'Preview';
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
  $('btn-preview').textContent = '■ Stop';
  $('btn-custom-preview').textContent = 'Stop';
  previewTimer = setTimeout(stopPreview, (end * beat + 0.4) * 1000);
}
function togglePreview(entry) {
  if (previewTimer) stopPreview(); else startPreview(entry);
}

// ---- song select screen ----
const gradeClass = g => (g === 'S' || g === 'A' || g === 'D') ? 'g-' + g : '';
function badgeHTML(run) {
  return run && run.ap ? ' <span class="badge ap">AP</span>' : run && run.fc ? ' <span class="badge">FC</span>' : '';
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
const starsText = n => '★'.repeat(n) + '<span class="off">' + '★'.repeat(5 - n) + '</span>';

function renderList() {
  const box = $('song-list');
  box.textContent = '';
  for (const e of entries()) {
    const b = document.createElement('button');
    b.className = 'song-row';
    b.dataset.id = e.id;
    b.setAttribute('role', 'option');
    const rec = scores.get(e.id, settings.difficulty);
    const best = rec && rec.best;
    b.innerHTML =
      `<img class="th" src="${coverURL(e.id)}" alt="">` +
      `<span class="t">${esc(e.title)}</span>` +
      `<span class="m">${esc(e.tag)}${e.tag ? ' · ' : ''}${e.bpm} BPM · ${formatLength(e.length)}</span>` +
      `<span class="b">${best ? `<span class="${gradeClass(best.grade)}">${esc(best.grade)}</span>${badgeHTML(best)}` : ''}</span>`;
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
  for (const b of $('song-list').children) b.classList.toggle('cur', b.dataset.id === selectedId);
}

function renderDetail() {
  const e = selectedEntry();
  if (!e) return;
  const d = settings.difficulty;
  $('d-cover').src = coverURL(e.id);
  $('d-title').textContent = e.title;
  $('d-meta').textContent = `${e.tag ? e.tag + ' · ' : ''}${e.bpm} BPM · ${formatLength(e.length)} · ${e.notes[d]} notes`;
  $('d-stars').innerHTML = starsText(e.stars[d]);
  const rec = scores.get(e.id, d);
  $('d-best').innerHTML = rec
    ? `<b>${rec.best.score}</b> · <span class="${gradeClass(rec.best.grade)}">${esc(rec.best.grade)}</span> · ` +
      `${rec.best.accuracy.toFixed(1)}% · ${rec.best.maxCombo}x${badgeHTML(rec.best)}`
    : '<span class="hint">No plays yet</span>';
  const top = $('d-top');
  top.textContent = '';
  for (const r of (rec ? rec.top : [])) {
    const li = document.createElement('li');
    li.innerHTML = `${r.score} · ${esc(r.grade)} · ${r.accuracy.toFixed(1)}%${badgeHTML(r)}`;
    top.appendChild(li);
  }
  for (const b of $('diff-seg').children) b.classList.toggle('sel', b.dataset.diff === d);
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
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
  if (changed) {
    stopPreview();
    if (settings.preview && state === 'select' && synth.ctx) {
      autoPreviewTimer = setTimeout(() => startPreview(selectedEntry(), 10), 450);
    }
  }
}

function setDifficulty(d) {
  settings.difficulty = d; save();
  renderList();
  renderDetail();
}
function cycleDifficulty(step) {
  const order = ['easy', 'normal', 'hard'];
  const i = Math.max(0, Math.min(2, order.indexOf(settings.difficulty) + step));
  if (order[i] !== settings.difficulty) setDifficulty(order[i]);
}

function openSelect() {
  renderList();
  renderDetail();
  setState('select', 'select');
  const row = Array.from($('song-list').children).find(b => b.dataset.id === selectedId);
  if (row) requestAnimationFrame(() => { row.scrollIntoView({ block: 'nearest' }); row.focus({ preventScroll: true }); });
}

// ---- custom song screen ----
const area = $('rtttl');
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
    setCustom(text);
    selectedId = e.id;
    settings.lastSongId = e.id; save();
  }
  $('btn-custom-play').disabled = !e;
  $('btn-custom-preview').disabled = !e;
  $('btn-share').disabled = !e;
}
function openCustom() {
  area.value = settings.customRtttl || '';
  $('share-msg').textContent = '';
  updateCustomStatus();
  setState('custom', 'custom');
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
  run = r;
  stopPreview();
  let chart;
  try {
    if (r.tutorial) {
      chart = buildStageChart(STAGES[r.tutorial.stage]);
    } else {
      chart = generateChart(r.entry.song, { difficulty: r.diff });
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
  input.setLanes(chart.lanes);
  padHeld.forEach(s => s.clear());
  if (r.tutorial) showCaption(r.tutorial.stage);
  game.start(chart, { leadIn: r.tutorial ? 1.5 : 2, backing: settings.backing, calibration: settings.calibration });
  setState('countin', null);
  return true;
}
function restartRun() { if (run) startRun(run); }

function playSelected() {
  const e = selectedEntry();
  if (e) startRun({ entry: e, diff: settings.difficulty, training: null });
}

function leaveToSelect() {
  game.stop();
  input.reset();
  openSelect();
}

function pauseGame() {
  if (state !== 'countin' && state !== 'playing') return;
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
async function resumeGame() {
  if (state !== 'paused') return;
  await game.resume();
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
  $('r-heading').textContent = training ? 'Practice' : 'Results';
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
  setState('results', 'results');
};

function nextSong() {
  const list = entries();
  const i = Math.max(0, list.findIndex(e => e.id === (run ? run.entry.id : selectedId)));
  const e = list[(i + 1) % list.length];
  selectedId = e.id;
  settings.lastSongId = e.id; save();
  startRun({ entry: e, diff: run ? run.diff : settings.difficulty, training: null });
}

// ---- tutorial ----
function controlsHTML() {
  const keys = KEY_LABELS[4].map(k => `<b>${k}</b>`).join(' ');
  const pad = [0, 1, 2, 3].map(i => `<b>${buttonName(settings.padBindings[i][0])}</b>`).join(' ');
  return `<p>Notes fall down four lanes. Hit each one as it reaches the white line.</p>` +
    `<p>Keyboard: ${keys}<br>Gamepad: ${pad} (or d-pad)<br>Touch: tap and hold the lanes</p>` +
    `<p>There are two note types — <b>taps</b> and <b>holds</b>. This takes about a minute.</p>`;
}
function openTutorial(stage = -1) {
  $('btn-tut-go').textContent = 'Start tutorial';
  $('btn-tut-skip').hidden = false;
  $('tut-title').textContent = 'Welcome to Ringbeat';
  $('tut-body').innerHTML = controlsHTML();
  run = null;
  setState('tutorial', 'tutorial');
}
function tutorialOutro() {
  game.stop();
  $('tut-title').textContent = "You're ready!";
  $('tut-body').innerHTML =
    `<p>Hit every note for a <b>Full Combo</b>, all Perfect for an <b>All Perfect</b>.</p>` +
    `<p><b>Training</b> (song select) slows songs down and loops sections.</p>` +
    `<p>If hits feel early or late, try <b>Settings → Calibrate</b>. You can replay this tutorial from Settings.</p>`;
  $('btn-tut-go').textContent = 'Pick a song';
  $('btn-tut-skip').hidden = true;
  run = { tutorial: { done: true } };
  setState('tutorial', 'tutorial');
}
function showCaption(i) {
  const st = STAGES[i];
  $('tut-caption').innerHTML = `<b>${esc(st.title)}</b>${esc(st.text)}<div class="step">Step ${i + 1} of ${STAGES.length}</div>`;
}
function tutorialStageDone(r) {
  const i = run.tutorial.stage;
  if (!stagePassed(STAGES[i], r)) { toast('Not quite — try again', 1500); startRun(run); return; }
  if (i + 1 < STAGES.length) { toast('Nice!', 1000); startRun({ entry: null, diff: 'normal', training: null, tutorial: { stage: i + 1 } }); }
  else tutorialOutro();
}
function finishTutorial() {
  game.stop();
  input.reset();
  run = null;
  settings.tutorialDone = true; save();
  openSelect();
}
function tutorialGo() {
  if (run && run.tutorial && run.tutorial.done) finishTutorial();
  else startRun({ entry: null, diff: 'normal', training: null, tutorial: { stage: 0 } });
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
function openSettings() {
  capturingSlot = -1;
  renderBindings();
  showOffset();
  setState('settings', 'settings');
}

// ---- gamepad routing ----
const padHeld = [new Set(), new Set(), new Set(), new Set()]; // lane -> pressed button indices
function slotsFor(index) {
  const out = [];
  for (let s = 0; s < 4; s++) if (settings.padBindings[s].includes(index)) out.push(s);
  return out;
}
function usePad() { lastDevice = 'pad'; document.body.classList.add('using-pad'); }
function useMouse() { document.body.classList.remove('using-pad'); }

pad.onConnect = id => { toast('Controller connected: ' + id.replace(/\(.*\)/, '').trim().slice(0, 40)); };
pad.onDisconnect = () => {
  toast('Controller disconnected');
  if (state === 'countin' || state === 'playing') pauseGame();
};

pad.onButton = (index, down, ts) => {
  usePad();
  if (state === 'countin' || state === 'playing') {
    if (!down) { releasePad(index, ts); return; }
    if (index === BTN.START) return pauseGame();
    if (index === BTN.BACK) return restartRun();
    pressPad(index, ts);
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
    case 'select': break;
    case 'tutorial': finishTutorial(); break;
    case 'custom': case 'training': case 'settings': openSelect(); break;
    case 'results': openSelect(); break;
    case 'paused': resumeGame(); break;
    case 'calibration': leaveCalibration(); break;
    case 'countin': case 'playing': pauseGame(); break;
  }
}

function menuButton(index) {
  const root = activeScreen();
  switch (index) {
    case BTN.A: case BTN.START:
      if (state === 'title') { startFromTitle(); return; }
      if (root) nav.confirm(root);
      break;
    case BTN.B: back(); break;
    case BTN.LB: if (state === 'select') cycleDifficulty(-1); break;
    case BTN.RB: if (state === 'select') cycleDifficulty(1); break;
    case BTN.Y: if (state === 'select') openTraining(); break;
  }
}
pad.onNav = dir => {
  const root = activeScreen();
  if (!root || state === 'title') return;
  usePad();
  if (capturingSlot >= 0) return;
  if (!nav.adjust(document.activeElement, dir)) nav.move(root, dir);
};

// ---- wiring ----
function startFromTitle() {
  synth.ensure();
  if (!settings.tutorialDone) openTutorial(); else openSelect();
}

function wire() {
  // settings controls
  const v = $('volume'), sc = $('scroll'), bk = $('backing'), pv = $('pref-preview');
  v.value = settings.volume * 100; sc.value = settings.scrollTime; bk.checked = settings.backing; pv.checked = settings.preview;
  v.oninput = () => { settings.volume = v.value / 100; synth.setVolume(settings.volume); save(); };
  sc.oninput = () => { settings.scrollTime = +sc.value; $('scroll-val').textContent = sc.value + 's'; save(); };
  $('scroll-val').textContent = sc.value + 's';
  bk.onchange = () => { settings.backing = bk.checked; save(); };
  pv.onchange = () => { settings.preview = pv.checked; save(); if (!pv.checked) stopPreview(); };
  $('btn-calibrate').onclick = startCalibration;
  $('btn-settings').onclick = openSettings;
  $('btn-settings-back').onclick = openSelect;
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
  for (const b of $('diff-seg').children) b.onclick = () => setDifficulty(b.dataset.diff);
  $('btn-play').onclick = playSelected;
  $('btn-training').onclick = openTraining;
  $('btn-preview').onclick = () => togglePreview(selectedEntry());
  $('btn-custom').onclick = openCustom;

  // custom
  area.addEventListener('input', () => { stopPreview(); updateCustomStatus(); });
  $('btn-custom-play').onclick = () => { const e = customEntry(area.value); if (e) startRun({ entry: e, diff: settings.difficulty, training: null }); };
  $('btn-custom-preview').onclick = () => { const e = customEntry(area.value); if (e) togglePreview(e); };
  $('btn-custom-back').onclick = openSelect;
  $('btn-share').onclick = async () => {
    const url = location.origin + location.pathname + encodeSong(area.value.trim());
    try { history.replaceState(null, '', url); } catch { /* ignore */ }
    try { await navigator.clipboard.writeText(url); $('share-msg').textContent = 'Link copied!'; }
    catch { $('share-msg').textContent = 'Copy this: ' + url; }
  };

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

  window.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') { useMouse(); lastDevice = 'kbd'; } });
  window.addEventListener('keydown', onKey);
  // Gamepad input may not count as a user gesture; resume a suspended context on the next key/click.
  const wake = () => { if (synth.ctx && synth.ctx.state === 'suspended' && game.state !== 'paused') synth.ctx.resume(); };
  window.addEventListener('keydown', wake, true);
  window.addEventListener('pointerdown', wake, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); }); // audio clock keeps running when hidden

  // Initial selection: share link > last played > first song
  const shared = decodeSong(location.hash);
  if (shared && customEntry(shared)) { setCustom(shared); selectedId = custom.id; }
  else {
    setCustom(settings.customRtttl);
    selectedId = entryById(settings.lastSongId) ? settings.lastSongId : builtins[0].id;
  }
  showOffset();
  show('title');
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target.tagName;
  const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type === 'text');
  if (state === 'title') {
    if (e.code !== 'Tab' && !e.repeat && !e.code.startsWith('Shift')) { e.preventDefault(); startFromTitle(); }
    return;
  }
  if (e.code === 'Escape') {
    if (capturingSlot >= 0) { capturingSlot = -1; renderBindings(); } else back();
    return;
  }
  if (e.code === 'KeyR' && !typing && ['countin', 'playing', 'paused', 'results'].includes(state)) { restartRun(); return; }
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
    lastDevice = 'kbd';
    nav.move(root, dirs[e.code]);
  }
}

// ---- frame loop ----
function frame() {
  requestAnimationFrame(frame);
  pad.poll();
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
  if (!game.active) { renderer.drawIdle(); return; }
  game.update(game.songTime());
  if (!game.active || game.state === 'done') return;
  const t = game.songTime();
  if (state === 'countin' && t >= 0) state = 'playing';
  renderer.draw(game, t);
}

wire();
requestAnimationFrame(frame);
window.__ringbeat = { game, scores, settings }; // debug/test hook (tests/smoke.html)
